import { LIMITS } from '../config/limits.js';
import {
  CanonicalDocument,
  Diagnostic,
  DocumentSection,
} from '../contracts/canonical.contract.js';
import { normalizeText } from '../normalizers/content.normalizer.js';
import { AppError } from '../utils/errors.js';
import { parseQuestionsFromText } from '../utils/question.parser.js';

function assertSafeUtf8Buffer(buffer: Buffer, fileName: string): string {
  // Reject binary payloads containing NUL bytes in the first 8KB
  const checkLen = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0x00) {
      throw new AppError(
        'INVALID_TEXT_FILE',
        `File "${fileName}" contains binary null bytes and is not a valid UTF-8 text document.`,
        422
      );
    }
  }

  const rawText = buffer.toString('utf-8').replace(/^\uFEFF/, '');
  return rawText;
}

export async function extractTextContent(
  buffer: Buffer,
  fileName: string,
  sourceId: string,
  format: 'TXT' | 'MARKDOWN' = 'TXT'
): Promise<CanonicalDocument> {
  if (buffer.length > LIMITS.MAX_FILE_BYTES) {
    throw new AppError(
      'FILE_TOO_LARGE',
      `File size (${buffer.length} bytes) exceeds limit of ${LIMITS.MAX_FILE_BYTES} bytes`,
      413
    );
  }

  const rawText = assertSafeUtf8Buffer(buffer, fileName);
  const diagnostics: Diagnostic[] = [];
  const normalized = normalizeText(rawText);
  diagnostics.push(...normalized.diagnostics);

  const sections: DocumentSection[] = [];

  if (format === 'MARKDOWN') {
    const lines = normalized.normalized.split('\n');
    let currentTitle = 'Giới thiệu';
    let currentLines: string[] = [];
    let sectionIdx = 1;

    const flushSection = () => {
      const content = currentLines.join('\n').trim();
      if (content.length > 0) {
        sections.push({
          title: currentTitle,
          content,
          provenance: {
            sourceId,
            sourceType: 'MARKDOWN',
            sourceLocation: fileName,
            section: currentTitle,
            paragraphIndex: sectionIdx++,
          },
        });
      }
      currentLines = [];
    };

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        flushSection();
        currentTitle = headingMatch[2].trim();
      } else {
        currentLines.push(line);
      }
    }
    flushSection();
  }

  if (sections.length === 0) {
    const paragraphs = normalized.normalized
      .split('\n\n')
      .map(p => p.trim())
      .filter(Boolean);

    paragraphs.forEach((p, idx) => {
      sections.push({
        title: `Đoạn ${idx + 1}`,
        content: p,
        provenance: {
          sourceId,
          sourceType: format,
          sourceLocation: fileName,
          section: `Đoạn ${idx + 1}`,
          paragraphIndex: idx + 1,
        },
      });
    });
  }

  const extractedItems = parseQuestionsFromText(normalized.normalized, {
    sourceId,
    sourceType: format,
    sourceLocation: fileName,
  });

  const firstH1Match = format === 'MARKDOWN' ? normalized.normalized.match(/^#\s+(.+)$/m) : null;
  const docTitle = firstH1Match
    ? firstH1Match[1].trim()
    : fileName.replace(/\.[^/.]+$/, '');

  return {
    sourceId,
    sourceType: format,
    sourceName: fileName,
    sourceLocation: fileName,
    title: docTitle,
    sections,
    text: normalized.normalized,
    extractedItems,
    metadata: {
      originalSize: buffer.length,
      characterCount: normalized.finalLength,
      extractedAt: new Date().toISOString(),
      contentType: format === 'MARKDOWN' ? 'text/markdown' : 'text/plain',
    },
    diagnostics,
  };
}
