import { z } from 'zod';

export const SourceTypeEnum = z.enum(['WEBSITE', 'DOCX', 'XLSX', 'PDF']);
export type SourceType = z.infer<typeof SourceTypeEnum>;

export const ProvenanceReferenceSchema = z.object({
  sourceId: z.string(),
  sourceType: SourceTypeEnum,
  sourceLocation: z.string(),
  page: z.number().int().positive().optional(),
  sheet: z.string().optional(),
  row: z.number().int().positive().optional(),
  section: z.string().optional(),
  paragraphIndex: z.number().int().nonnegative().optional(),
});
export type ProvenanceReference = z.infer<typeof ProvenanceReferenceSchema>;

export const ExtractedQuestionItemSchema = z.object({
  id: z.string(),
  questionText: z.string().min(1),
  choices: z.array(z.string()).optional(),
  correctAnswer: z.string().optional(),
  explanation: z.string().optional(),
  sourceReference: ProvenanceReferenceSchema,
});
export type ExtractedQuestionItem = z.infer<typeof ExtractedQuestionItemSchema>;

export const DocumentSectionSchema = z.object({
  title: z.string().optional(),
  content: z.string(),
  provenance: ProvenanceReferenceSchema,
});
export type DocumentSection = z.infer<typeof DocumentSectionSchema>;

export const DiagnosticSeverityEnum = z.enum(['info', 'warning', 'error']);
export type DiagnosticSeverity = z.infer<typeof DiagnosticSeverityEnum>;

export const DiagnosticSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: DiagnosticSeverityEnum,
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;

export const DocumentMetadataSchema = z.object({
  originalSize: z.number().nonnegative(),
  characterCount: z.number().nonnegative(),
  extractedAt: z.string(),
  contentType: z.string().optional(),
  pageCount: z.number().int().nonnegative().optional(),
  sheetCount: z.number().int().nonnegative().optional(),
});
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;

export const CanonicalDocumentSchema = z.object({
  sourceId: z.string(),
  sourceType: SourceTypeEnum,
  sourceName: z.string(),
  sourceLocation: z.string(),
  title: z.string(),
  pages: z.array(z.object({
    pageNumber: z.number().int().positive(),
    text: z.string(),
  })).optional(),
  sections: z.array(DocumentSectionSchema),
  text: z.string(),
  extractedItems: z.array(ExtractedQuestionItemSchema),
  metadata: DocumentMetadataSchema,
  diagnostics: z.array(DiagnosticSchema),
});
export type CanonicalDocument = z.infer<typeof CanonicalDocumentSchema>;

export const IngestionResultSchema = z.object({
  sourceCount: z.number().int().nonnegative(),
  sources: z.array(CanonicalDocumentSchema),
  normalizedContent: z.string(),
});
export type IngestionResult = z.infer<typeof IngestionResultSchema>;

