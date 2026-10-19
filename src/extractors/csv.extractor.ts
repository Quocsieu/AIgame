import { LIMITS } from '../config/limits.js';
import {
  CanonicalDocument,
  Diagnostic,
  DocumentSection,
  ExtractedQuestionItem,
} from '../contracts/canonical.contract.js';
import { normalizeText } from '../normalizers/content.normalizer.js';
import { AppError } from '../utils/errors.js';

interface HeaderMapping {
  questionCol: number;
  choiceCols: { label: string; col: number }[];
  answerCol: number;
  explanationCol: number;
}

function detectCsvHeaders(headerRow: string[]): HeaderMapping | null {
  let questionCol = -1;
  const choiceCols: { label: string; col: number }[] = [];
  let answerCol = -1;
  let explanationCol = -1;

  for (let i = 0; i < headerRow.length; i++) {
    const val = String(headerRow[i] || '').trim().toLowerCase();
    if (!val) continue;

    if (val.includes('question') || val.includes('câu hỏi') || val.includes('cau hoi') || val.includes('prompt')) {
      questionCol = i;
    } else if (val === 'a' || val === 'option a' || val === 'choice a' || val.includes('lựa chọn a')) {
      choiceCols.push({ label: 'A', col: i });
    } else if (val === 'b' || val === 'option b' || val === 'choice b' || val.includes('lựa chọn b')) {
      choiceCols.push({ label: 'B', col: i });
    } else if (val === 'c' || val === 'option c' || val === 'choice c' || val.includes('lựa chọn c')) {
      choiceCols.push({ label: 'C', col: i });
    } else if (val === 'd' || val === 'option d' || val === 'choice d' || val.includes('lựa chọn d')) {
      choiceCols.push({ label: 'D', col: i });
    } else if (val.includes('correct') || val.includes('answer') || val.includes('đáp án') || val.includes('dap an') || val === 'key') {
      answerCol = i;
    } else if (val.includes('explanation') || val.includes('giải thích') || val.includes('giai thich')) {
      explanationCol = i;
    }
  }

  if (questionCol !== -1) {
    return { questionCol, choiceCols, answerCol, explanationCol };
  }
  return null;
}

/**
 * RFC-4180 compliant CSV parser supporting quoted fields, escaped quotes, and UTF-8.
 */
export function parseCsvRows(rawCsv: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < rawCsv.length; i++) {
    const ch = rawCsv[i];
    const next = rawCsv[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentCell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (ch === '\r' && next === '\n') {
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += ch;
      }
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  return rows.filter(row => row.some(cell => cell.length > 0));
}

export async function extractCsvContent(
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

  const checkLen = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0x00) {
      throw new AppError(
        'INVALID_CSV_FILE',
        `File "${fileName}" contains binary null bytes and is not a valid CSV file.`,
        422
      );
    }
  }

  const rawCsv = buffer.toString('utf-8').replace(/^\uFEFF/, '');
  const rows = parseCsvRows(rawCsv);

  const diagnostics: Diagnostic[] = [];
  const sections: DocumentSection[] = [];
  const extractedItems: ExtractedQuestionItem[] = [];
  const sheetName = fileName.replace(/\.[^/.]+$/, '') || 'CSV';

  if (rows.length === 0) {
    diagnostics.push({
      code: 'EMPTY_CSV',
      message: `CSV file "${fileName}" contains no data rows.`,
      severity: 'warning',
    });
  } else {
    const firstRow = rows[0];
    const headerMapping = detectCsvHeaders(firstRow);
    const startRowIdx = headerMapping ? 1 : 0;
    const isGenericHeader = !headerMapping && rows.length > 1;
    const columnHeaders = isGenericHeader ? firstRow : [];

    let sheetText = `[Sheet: ${sheetName}]\n`;

    for (let r = startRowIdx; r < rows.length; r++) {
      const rowCells = rows[r];
      const rowNum = r + 1;
      if (rowCells.every(c => c === '')) continue;

      if (headerMapping) {
        const questionText = rowCells[headerMapping.questionCol] || '';
        if (!questionText) continue;

        const choices: string[] = [];
        for (const choice of headerMapping.choiceCols) {
          const val = rowCells[choice.col];
          if (val) {
            choices.push(`${choice.label}. ${val}`);
          }
        }

        const correctAnswer = headerMapping.answerCol !== -1 ? rowCells[headerMapping.answerCol] : undefined;
        const explanation = headerMapping.explanationCol !== -1 ? rowCells[headerMapping.explanationCol] : undefined;

        extractedItems.push({
          id: `${sourceId}_csv_r${rowNum}`,
          questionText,
          choices: choices.length > 0 ? choices : undefined,
          correctAnswer: correctAnswer || undefined,
          explanation: explanation || undefined,
          sourceReference: {
            sourceId,
            sourceType: 'CSV',
            sourceLocation: fileName,
            sheet: sheetName,
            row: rowNum,
          },
        });

        const line = `Row ${rowNum}: ${questionText} ${choices.join(' ')} ${correctAnswer ? `[Answer: ${correctAnswer}]` : ''}`.trim();
        sheetText += `${line}\n`;
      } else {
        const formattedCells =
          isGenericHeader && r > 0
            ? rowCells.map((val, cIdx) => (columnHeaders[cIdx] ? `${columnHeaders[cIdx]}: ${val}` : val)).join(' | ')
            : rowCells.join(' | ');
        sheetText += `Row ${rowNum}: ${formattedCells}\n`;
      }
    }

    sections.push({
      title: `Sheet: ${sheetName}`,
      content: sheetText.trim(),
      provenance: {
        sourceId,
        sourceType: 'CSV',
        sourceLocation: fileName,
        sheet: sheetName,
        section: sheetName,
      },
    });
  }

  const normalized = normalizeText(sections.map(s => s.content).join('\n\n'));
  diagnostics.push(...normalized.diagnostics);

  return {
    sourceId,
    sourceType: 'CSV',
    sourceName: fileName,
    sourceLocation: fileName,
    title: sheetName,
    sections,
    text: normalized.normalized,
    extractedItems,
    metadata: {
      originalSize: buffer.length,
      characterCount: normalized.finalLength,
      extractedAt: new Date().toISOString(),
      contentType: 'text/csv',
      sheetCount: 1,
    },
    diagnostics,
  };
}

