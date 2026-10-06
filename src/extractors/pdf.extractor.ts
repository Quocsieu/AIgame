// @ts-ignore
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { LIMITS } from '../config/limits.js';
import {
  CanonicalDocument,
  DocumentSection,
  Diagnostic,
  ExtractedQuestionItem,
} from '../contracts/canonical.contract.js';
import { normalizeText } from '../normalizers/content.normalizer.js';
import { parseQuestionsFromText } from '../utils/question.parser.js';
import { AppError } from '../utils/errors.js';

export async function extractPdfContent(
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

  const pageTexts: { pageNumber: number; text: string }[] = [];

  function customPageRender(pageData: any) {
    return pageData.getTextContent().then((textContent: any) => {
      let lastY: number | undefined;
      let pageStr = '';
      if (textContent && Array.isArray(textContent.items)) {
        for (const item of textContent.items) {
          if (lastY === undefined || lastY === item.transform[5]) {
            pageStr += item.str + ' ';
          } else {
            pageStr += '\n' + item.str + ' ';
          }
          lastY = item.transform[5];
        }
      }
      const pageIndex = pageData.pageNumber || (pageData.pageIndex !== undefined ? pageData.pageIndex + 1 : pageTexts.length + 1);
      pageTexts.push({
        pageNumber: pageIndex,
        text: pageStr.trim(),
      });
      return pageStr;
    });
  }

  let pdfData: { numpages: number; text: string; info: any };
  try {
    pdfData = await pdf(buffer, {
      pagerender: customPageRender,
    });
  } catch (err: unknown) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'PDF_TEXT_EXTRACTION_UNAVAILABLE',
      `Failed to parse PDF or extract text: ${err instanceof Error ? err.message : String(err)}`,
      422
    );
  }

  const rawTotalText = pdfData.text || '';
  if (rawTotalText.trim().length === 0) {
    throw new AppError(
      'PDF_TEXT_EXTRACTION_UNAVAILABLE',
      'The provided PDF contains no extractable text. Scanned or image-only PDFs are not supported without OCR.',
      422
    );
  }

  const diagnostics: Diagnostic[] = [];
  const normalized = normalizeText(rawTotalText);
  diagnostics.push(...normalized.diagnostics);

  const sections: DocumentSection[] = [];
  const extractedItems: ExtractedQuestionItem[] = [];

  pageTexts.sort((a, b) => a.pageNumber - b.pageNumber);

  for (const page of pageTexts) {
    const pageNormalized = normalizeText(page.text);
    if (pageNormalized.normalized.length === 0) continue;

    sections.push({
      title: `Page ${page.pageNumber}`,
      content: pageNormalized.normalized,
      provenance: {
        sourceId,
        sourceType: 'PDF',
        sourceLocation: fileName,
        page: page.pageNumber,
      },
    });

    const pageQuestions = parseQuestionsFromText(pageNormalized.normalized, {
      sourceId,
      sourceType: 'PDF',
      sourceLocation: fileName,
      page: page.pageNumber,
    });

    extractedItems.push(...pageQuestions);
  }

  return {
    sourceId,
    sourceType: 'PDF',
    sourceName: fileName,
    sourceLocation: fileName,
    title: fileName.replace(/\.[^/.]+$/, ''),
    pages: pageTexts,
    sections,
    text: normalized.normalized,
    extractedItems,
    metadata: {
      originalSize: buffer.length,
      characterCount: normalized.finalLength,
      pageCount: pdfData.numpages,
      extractedAt: new Date().toISOString(),
      contentType: 'application/pdf',
    },
    diagnostics,
  };
}
