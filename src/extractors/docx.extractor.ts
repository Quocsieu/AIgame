import mammoth from 'mammoth';
import { LIMITS } from '../config/limits.js';
import {
  CanonicalDocument,
  DocumentSection,
  Diagnostic,
} from '../contracts/canonical.contract.js';
import { normalizeText } from '../normalizers/content.normalizer.js';
import { parseQuestionsFromText } from '../utils/question.parser.js';
import { AppError } from '../utils/errors.js';

export async function extractDocxContent(
  buffer: Buffer,
  fileName: string,
  sourceId: string
): Promise<CanonicalDocument> {
  if (buffer.length > LIMITS.MAX_FILE_BYTES) {
    throw new AppError(
      'FILE_TOO_LARGE',
      `File size (${buffer.length} bytes) exceeds limit of ${LIMITS.MAX_FILE_BYTES} bytes`,
      413
    );
  }

  const diagnostics: Diagnostic[] = [];

  let rawText = '';
  try {
    const textResult = await mammoth.extractRawText({ buffer });
    rawText = textResult.value || '';
    if (textResult.messages && textResult.messages.length > 0) {
      for (const msg of textResult.messages) {
        diagnostics.push({
          code: 'DOCX_PARSE_NOTICE',
          message: msg.message,
          severity: msg.type === 'error' ? 'error' : 'warning',
        });
      }
    }
  } catch (err: unknown) {
    throw new AppError(
      'DOCX_EXTRACTION_FAILED',
      `Failed to parse DOCX file: ${err instanceof Error ? err.message : String(err)}`,
      422
    );
  }

  const normalized = normalizeText(rawText);
  diagnostics.push(...normalized.diagnostics);

  const sections: DocumentSection[] = [];
  const paragraphs = normalized.normalized.split('\n\n').filter(p => p.trim().length > 0);

  paragraphs.forEach((p, idx) => {
    sections.push({
      title: `Paragraph ${idx + 1}`,
      content: p.trim(),
      provenance: {
        sourceId,
        sourceType: 'DOCX',
        sourceLocation: fileName,
        paragraphIndex: idx + 1,
      },
    });
  });

  const extractedItems = parseQuestionsFromText(normalized.normalized, {
    sourceId,
    sourceType: 'DOCX',
    sourceLocation: fileName,
  });

  return {
    sourceId,
    sourceType: 'DOCX',
    sourceName: fileName,
    sourceLocation: fileName,
    title: fileName.replace(/\.[^/.]+$/, ''),
    sections,
    text: normalized.normalized,
    extractedItems,
    metadata: {
      originalSize: buffer.length,
      characterCount: normalized.finalLength,
      extractedAt: new Date().toISOString(),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    diagnostics,
  };
}

