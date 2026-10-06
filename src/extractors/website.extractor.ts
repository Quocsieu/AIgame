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

export async function extractWebsiteContent(
  rawUrl: string,
  sourceId: string
): Promise<CanonicalDocument> {
  const safeUrl = await validateSafeUrl(rawUrl);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LIMITS.HTTP_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(safeUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AI-Game-Platform-Bot/1.0 (+http://localhost)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AppError('HTTP_TIMEOUT', `Request to ${rawUrl} timed out after ${LIMITS.HTTP_REQUEST_TIMEOUT_MS}ms`, 504);
    }
    throw new AppError('FETCH_FAILED', `Failed to fetch URL ${rawUrl}: ${err instanceof Error ? err.message : String(err)}`, 502);
  } finally {
    clearTimeout(timeoutId);
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

  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > LIMITS.MAX_WEBSITE_RESPONSE_BYTES) {
    throw new AppError(
      'RESPONSE_TOO_LARGE',
      `Website content length (${contentLength} bytes) exceeds limit of ${LIMITS.MAX_WEBSITE_RESPONSE_BYTES} bytes`,
      413
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > LIMITS.MAX_WEBSITE_RESPONSE_BYTES) {
    throw new AppError(
      'RESPONSE_TOO_LARGE',
      `Website response payload (${buffer.byteLength} bytes) exceeds limit of ${LIMITS.MAX_WEBSITE_RESPONSE_BYTES} bytes`,
      413
    );
  }

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
