import path from 'node:path';
import { LIMITS } from '../config/limits.js';
import {
  CanonicalDocument,
  IngestionResult,
  IngestionResultSchema,
} from '../contracts/canonical.contract.js';
import { extractDocxContent } from '../extractors/docx.extractor.js';
import { extractPdfContent } from '../extractors/pdf.extractor.js';
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
}

export class IngestionService {
  public async ingest(input: IngestSourcesInput): Promise<IngestionResult> {
    const urls = (input.urls || []).map(u => u.trim()).filter(Boolean);
    const files = input.files || [];

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

    const documents: CanonicalDocument[] = [];
    let sourceCounter = 1;

    // 1. Process Website URLs
    for (const url of urls) {
      const sourceId = `src_url_${Date.now()}_${sourceCounter++}`;
      const doc = await extractWebsiteContent(url, sourceId);
      documents.push(doc);
      sourceStore.save(doc);
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
      } else {
        throw new AppError(
          'UNSUPPORTED_FILE_TYPE',
          `Unsupported file extension "${ext}". Supported types are .docx, .xlsx, and .pdf.`,
          415
        );
      }

      documents.push(doc);
      sourceStore.save(doc);
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
