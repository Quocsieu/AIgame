import * as cheerio from 'cheerio';
import { LIMITS } from '../config/limits.js';
import {
  CanonicalDocument,
  DocumentSection,
  Diagnostic,
} from '../contracts/canonical.contract.js';
import { normalizeText } from '../normalizers/content.normalizer.js';
import { AppError } from '../utils/errors.js';
import { validateSafeUrl } from '../utils/ssrf.validator.js';

const MAX_REDIRECTS = 3;

async function readBoundedResponseBuffer(
  response: Response,
  maxBytes: number,
  controller: AbortController
): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const declaredBytes = parseInt(contentLength, 10);
    if (!Number.isNaN(declaredBytes) && declaredBytes > maxBytes) {
      controller.abort();
      throw new AppError(
        'RESPONSE_TOO_LARGE',
        `Website content length (${declaredBytes} bytes) exceeds limit of ${maxBytes} bytes`,
        413
      );
    }
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel().catch(() => {});
            controller.abort();
            throw new AppError(
              'RESPONSE_TOO_LARGE',
              `Website response stream exceeded limit of ${maxBytes} bytes`,
              413
            );
          }
          chunks.push(value);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return combined;
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new AppError(
      'RESPONSE_TOO_LARGE',
      `Website response payload (${buffer.byteLength} bytes) exceeds limit of ${maxBytes} bytes`,
      413
    );
  }
  return new Uint8Array(buffer);
}

export async function extractWebsiteContent(
  rawUrl: string,
  sourceId: string
): Promise<CanonicalDocument> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LIMITS.HTTP_REQUEST_TIMEOUT_MS);

  let currentUrlStr = rawUrl;
  let safeUrl: URL;
  let response: Response | null = null;
  let buffer: Uint8Array;

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      safeUrl = await validateSafeUrl(currentUrlStr);

      try {
        response = await fetch(safeUrl.toString(), {
          signal: controller.signal,
          headers: {
            'User-Agent': 'AI-Game-Platform-Bot/1.0 (+http://localhost)',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          redirect: 'manual',
        });
      } catch (err: unknown) {
        if (err instanceof AppError) throw err;
        if (err instanceof Error && err.name === 'AbortError') {
          throw new AppError('HTTP_TIMEOUT', `Request to ${rawUrl} timed out after ${LIMITS.HTTP_REQUEST_TIMEOUT_MS}ms`, 504);
        }
        throw new AppError('FETCH_FAILED', `Failed to fetch URL ${rawUrl}: ${err instanceof Error ? err.message : String(err)}`, 502);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new AppError('HTTP_ERROR', `Redirect response (${response.status}) missing Location header`, 502);
        }
        if (redirectCount >= MAX_REDIRECTS) {
          throw new AppError(
            'TOO_MANY_REDIRECTS',
            `Website exceeded maximum allowed redirects (${MAX_REDIRECTS})`,
            400
          );
        }
        try {
          currentUrlStr = new URL(location, safeUrl).toString();
        } catch {
          throw new AppError('INVALID_URL', `Invalid redirect Location header: "${location}"`, 400);
        }
        continue;
      }

      break;
    }

    if (!response) {
      throw new AppError('FETCH_FAILED', `Failed to fetch URL ${rawUrl}`, 502);
    }

    if (!response.ok) {
      throw new AppError('HTTP_ERROR', `Website responded with HTTP status ${response.status} (${response.statusText})`, response.status);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml+xml')) {
      throw new AppError(
        'UNSUPPORTED_CONTENT_TYPE',
        `Expected HTML or text content type, got "${contentType}"`,
        415
      );
    }

    buffer = await readBoundedResponseBuffer(response, LIMITS.MAX_WEBSITE_RESPONSE_BYTES, controller);
  } catch (err: unknown) {
    if (err instanceof AppError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AppError('HTTP_TIMEOUT', `Request to ${rawUrl} timed out after ${LIMITS.HTTP_REQUEST_TIMEOUT_MS}ms`, 504);
    }
    throw new AppError('FETCH_FAILED', `Failed to fetch URL ${rawUrl}: ${err instanceof Error ? err.message : String(err)}`, 502);
  } finally {
    clearTimeout(timeoutId);
  }

  const contentType = response.headers.get('content-type') || '';
  safeUrl = safeUrl!;
  const html = new TextDecoder('utf-8').decode(buffer);
  const $ = cheerio.load(html);

  // Remove noise elements
  $('script, style, noscript, svg, iframe, nav, footer, aside, header').remove();

  // Extract page title
  const pageTitle = $('title').first().text().trim() ||
    $('h1').first().text().trim() ||
    safeUrl.hostname;

  // Extract sections
  const sections: DocumentSection[] = [];
  const textChunks: string[] = [];
  const diagnostics: Diagnostic[] = [];

  const contentElements = $('h1, h2, h3, h4, h5, h6, p, ul, ol, table');

  let currentSectionTitle = pageTitle;
  let currentSectionLines: string[] = [];

  function commitSection() {
    if (currentSectionLines.length > 0) {
      const sectionContent = currentSectionLines.join('\n\n').trim();
      if (sectionContent.length > 0) {
        sections.push({
          title: currentSectionTitle,
          content: sectionContent,
          provenance: {
            sourceId,
            sourceType: 'WEBSITE',
            sourceLocation: safeUrl.toString(),
            section: currentSectionTitle,
          },
        });
        textChunks.push(sectionContent);
      }
      currentSectionLines = [];
    }
  }

  contentElements.each((_, el) => {
    const tagName = (el as any).tagName?.toLowerCase?.() || '';
    const elementText = $(el).text().replace(/\s+/g, ' ').trim();
    if (!elementText) return;

    if (tagName.startsWith('h')) {
      commitSection();
      currentSectionTitle = elementText;
      currentSectionLines.push(elementText);
    } else {
      currentSectionLines.push(elementText);
    }
  });

  commitSection();

  if (textChunks.length === 0) {
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    if (bodyText) {
      textChunks.push(bodyText);
      sections.push({
        title: pageTitle,
        content: bodyText,
        provenance: {
          sourceId,
          sourceType: 'WEBSITE',
          sourceLocation: safeUrl.toString(),
          section: 'body',
        },
      });
    }
  }

  const rawExtractedText = textChunks.join('\n\n');
  const normalized = normalizeText(rawExtractedText);
  diagnostics.push(...normalized.diagnostics);

  return {
    sourceId,
    sourceType: 'WEBSITE',
    sourceName: safeUrl.hostname,
    sourceLocation: safeUrl.toString(),
    title: pageTitle,
    sections,
    text: normalized.normalized,
    extractedItems: [],
    metadata: {
      originalSize: buffer.byteLength,
      characterCount: normalized.finalLength,
      extractedAt: new Date().toISOString(),
      contentType,
    },
    diagnostics,
  };
}
