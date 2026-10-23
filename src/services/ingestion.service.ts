import path from 'node:path';
import { LIMITS } from '../config/limits.js';
import {
  CanonicalDocument,
  IngestionResult,
  IngestionResultSchema,
} from '../contracts/canonical.contract.js';
import { extractCsvContent } from '../extractors/csv.extractor.js';
import { extractDocxContent } from '../extractors/docx.extractor.js';
import { extractPdfContent } from '../extractors/pdf.extractor.js';
import { extractTextContent } from '../extractors/text.extractor.js';
import { extractWebsiteContent } from '../extractors/website.extractor.js';
import { extractXlsxContent } from '../extractors/xlsx.extractor.js';
import { sourceStore } from '../storage/source.store.js';
import { AppError } from '../utils/errors.js';

export interface UploadedFilePayload {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

export interface IngestSourcesInput {
  urls?: string[];
  files?: UploadedFilePayload[];
  ownerUserId?: string | null;
}

export class IngestionService {
  public async ingest(input: IngestSourcesInput): Promise<IngestionResult> {
    const urls = (input.urls || []).map(u => u.trim()).filter(Boolean);
    const files = input.files || [];
    const ownerUserId = input.ownerUserId || null;

    if (urls.length === 0 && files.length === 0) {
      throw new AppError('NO_SOURCES_PROVIDED', 'At least one URL or file must be provided.', 400);
    }

    if (urls.length > LIMITS.MAX_URLS_PER_REQUEST) {
      throw new AppError(
        'LIMIT_EXCEEDED',
        `Maximum ${LIMITS.MAX_URLS_PER_REQUEST} URLs are allowed per request, received ${urls.length}.`,
        400
      );
    }

    if (files.length > LIMITS.MAX_FILES_PER_REQUEST) {
      throw new AppError(
        'LIMIT_EXCEEDED',
        `Maximum ${LIMITS.MAX_FILES_PER_REQUEST} files are allowed per request, received ${files.length}.`,
        400
      );
    }

    const totalBytes = files.reduce((acc, f) => acc + (f.size || f.buffer?.length || 0), 0);
    if (totalBytes > LIMITS.MAX_TOTAL_FILE_BYTES) {
      throw new AppError(
        'TOTAL_FILE_SIZE_EXCEEDED',
        `Tổng dung lượng các tệp (${(totalBytes / (1024 * 1024)).toFixed(1)}MB) vượt quá giới hạn 25MB cho phép.`,
        413
      );
    }

    for (const file of files) {
      const fileSize = file.size || file.buffer?.length || 0;
      if (fileSize > LIMITS.MAX_FILE_BYTES) {
        throw new AppError(
          'FILE_TOO_LARGE',
          `Tệp "${file.originalname}" (${(fileSize / (1024 * 1024)).toFixed(1)}MB) vượt quá dung lượng tối đa 10MB cho phép.`,
          413
        );
      }
    }

    const documents: CanonicalDocument[] = [];
    let sourceCounter = 1;

    // 1. Process Website URLs
    for (const url of urls) {
      const sourceId = `src_url_${Date.now()}_${sourceCounter++}`;
      const doc = await extractWebsiteContent(url, sourceId);
      documents.push(doc);
      sourceStore.save(doc, Date.now(), ownerUserId);
    }

    // 2. Process Files
    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const sourceId = `src_file_${Date.now()}_${sourceCounter++}`;

      let doc: CanonicalDocument;

      if (ext === '.docx') {
        doc = await extractDocxContent(file.buffer, file.originalname, sourceId);
      } else if (ext === '.xlsx') {
        doc = await extractXlsxContent(file.buffer, file.originalname, sourceId);
      } else if (ext === '.pdf') {
        doc = await extractPdfContent(file.buffer, file.originalname, sourceId);
      } else if (ext === '.txt') {
        doc = await extractTextContent(file.buffer, file.originalname, sourceId, 'TXT');
      } else if (ext === '.md' || ext === '.markdown') {
        doc = await extractTextContent(file.buffer, file.originalname, sourceId, 'MARKDOWN');
      } else if (ext === '.csv') {
        doc = await extractCsvContent(file.buffer, file.originalname, sourceId);
      } else {
        throw new AppError(
          'UNSUPPORTED_FILE_TYPE',
          `Unsupported file extension "${ext}". Supported types are .docx, .xlsx, .pdf, .txt, .md, and .csv.`,
          415
        );
      }

      documents.push(doc);
      sourceStore.save(doc, Date.now(), ownerUserId);
    }

    // Combine normalized content
    const combinedText = documents
      .map(d => `--- Source: ${d.sourceName} (${d.sourceType}) ---\n${d.text}`)
      .join('\n\n');

    const result: IngestionResult = {
      sourceCount: documents.length,
      sources: documents,
      normalizedContent: combinedText,
    };

    return IngestionResultSchema.parse(result);
  }
}

export const ingestionService = new IngestionService();
