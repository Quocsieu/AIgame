import { LIMITS } from '../config/limits.js';
import { Diagnostic } from '../contracts/canonical.contract.js';

export interface NormalizedResult {
  normalized: string;
  truncated: boolean;
  originalLength: number;
  finalLength: number;
  diagnostics: Diagnostic[];
}

export function normalizeText(
  rawText: string,
  maxLength: number = LIMITS.MAX_EXTRACTED_TEXT_LENGTH
): NormalizedResult {
  const diagnostics: Diagnostic[] = [];

  if (!rawText || rawText.trim().length === 0) {
    return {
      normalized: '',
      truncated: false,
      originalLength: 0,
      finalLength: 0,
      diagnostics: [
        {
          code: 'EMPTY_CONTENT',
          message: 'Extracted content is empty or contains only whitespace.',
          severity: 'warning',
        },
      ],
    };
  }

  // 1. Unicode NFC normalization
  let cleaned = rawText.normalize('NFC');

  // 2. Strip zero-width characters and unusual control characters
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, '');
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 3. Normalize newlines
  cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 4. Normalize horizontal whitespace on lines
  const lines = cleaned.split('\n').map(line => {
    return line.replace(/[\u00A0\t]+/g, ' ').replace(/[ ]{2,}/g, ' ').trim();
  });

  // 5. Rejoin and collapse consecutive empty lines to maximum 2 newlines
  cleaned = lines.join('\n');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  const originalLength = cleaned.length;
  let truncated = false;

  // 6. Enforce max length limit deterministically
  if (cleaned.length > maxLength) {
    truncated = true;
    cleaned = cleaned.slice(0, maxLength).trim();
    diagnostics.push({
      code: 'CONTENT_TRUNCATED',
      message: `Extracted content exceeded limit of ${maxLength} characters (was ${originalLength}). Content was truncated deterministically.`,
      severity: 'warning',
    });
  }

  return {
    normalized: cleaned,
    truncated,
    originalLength,
    finalLength: cleaned.length,
    diagnostics,
  };
}
