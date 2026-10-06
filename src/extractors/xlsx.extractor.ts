import * as xlsx from 'xlsx';
import { LIMITS } from '../config/limits.js';
import {
  CanonicalDocument,
  DocumentSection,
  Diagnostic,
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

function detectHeaders(headerRow: string[]): HeaderMapping | null {
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

export async function extractXlsxContent(
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

  let workbook: xlsx.WorkBook;
  try {
    workbook = xlsx.read(buffer, { type: 'buffer' });
  } catch (err: unknown) {
    throw new AppError(
      'XLSX_EXTRACTION_FAILED',
      `Failed to parse Excel workbook: ${err instanceof Error ? err.message : String(err)}`,
      422
    );
  }

  const diagnostics: Diagnostic[] = [];
  const sections: DocumentSection[] = [];
  const extractedItems: ExtractedQuestionItem[] = [];
  const textLines: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = xlsx.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    if (rows.length === 0) {
      diagnostics.push({
        code: 'EMPTY_SHEET',
        message: `Worksheet "${sheetName}" is empty.`,
        severity: 'info',
      });
      continue;
    }

    const firstRow = rows[0].map(c => String(c).trim());
    const headerMapping = detectHeaders(firstRow);
    const startRowIdx = headerMapping ? 1 : 0;

    let sheetText = `[Sheet: ${sheetName}]\n`;

    for (let r = startRowIdx; r < rows.length; r++) {
      const row = rows[r];
      const rowCells = row.map(c => String(c ?? '').trim());
      const rowNum = r + 1;

      if (rowCells.every(c => c === '')) continue;

      if (headerMapping) {
        const questionText = rowCells[headerMapping.questionCol] || '';
        if (!questionText) continue;

        const choices: string[] = [];
        for (const choice of headerMapping.choiceCols) {
          const choiceVal = rowCells[choice.col];
          if (choiceVal) {
            choices.push(`${choice.label}. ${choiceVal}`);
          }
        }

        const correctAnswer = headerMapping.answerCol !== -1 ? rowCells[headerMapping.answerCol] : undefined;
        const explanation = headerMapping.explanationCol !== -1 ? rowCells[headerMapping.explanationCol] : undefined;

        extractedItems.push({
          id: `${sourceId}_${sheetName}_r${rowNum}`,
          questionText,
          choices: choices.length > 0 ? choices : undefined,
          correctAnswer: correctAnswer || undefined,
          explanation: explanation || undefined,
          sourceReference: {
            sourceId,
            sourceType: 'XLSX',
            sourceLocation: fileName,
            sheet: sheetName,
            row: rowNum,
          },
        });

        const line = `Row ${rowNum}: ${questionText} ${choices.join(' ')} ${correctAnswer ? `[Answer: ${correctAnswer}]` : ''}`.trim();
        sheetText += `${line}\n`;
      } else {
        if (rowCells.length >= 2 && rowCells[0] && rowCells[1] && rowCells.length <= 3) {
          extractedItems.push({
            id: `${sourceId}_${sheetName}_r${rowNum}`,
            questionText: rowCells[0],
            correctAnswer: rowCells[1],
            explanation: rowCells[2] || undefined,
            sourceReference: {
              sourceId,
              sourceType: 'XLSX',
              sourceLocation: fileName,
              sheet: sheetName,
              row: rowNum,
            },
          });
        } else if (rowCells.length >= 5) {
          const choices = [
            `A. ${rowCells[1]}`,
            `B. ${rowCells[2]}`,
            `C. ${rowCells[3]}`,
            `D. ${rowCells[4]}`,
          ].filter(c => !c.endsWith('. '));

          extractedItems.push({
            id: `${sourceId}_${sheetName}_r${rowNum}`,
            questionText: rowCells[0],
            choices: choices.length > 0 ? choices : undefined,
            correctAnswer: rowCells[5] || undefined,
            sourceReference: {
              sourceId,
              sourceType: 'XLSX',
              sourceLocation: fileName,
              sheet: sheetName,
              row: rowNum,
            },
          });
        } else {
          diagnostics.push({
            code: 'AMBIGUOUS_ROW_STRUCTURE',
            message: `Worksheet "${sheetName}" row ${rowNum} structure is ambiguous. Preserved as text.`,
            severity: 'info',
          });
        }

        const line = `Row ${rowNum}: ${rowCells.filter(Boolean).join(' | ')}`;
        sheetText += `${line}\n`;
      }
    }

    sections.push({
      title: `Sheet: ${sheetName}`,
      content: sheetText.trim(),
      provenance: {
        sourceId,
        sourceType: 'XLSX',
        sourceLocation: fileName,
        sheet: sheetName,
      },
    });

    textLines.push(sheetText);
  }

  const rawCombinedText = textLines.join('\n\n');
  const normalized = normalizeText(rawCombinedText);
  diagnostics.push(...normalized.diagnostics);

  return {
    sourceId,
    sourceType: 'XLSX',
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
      sheetCount: workbook.SheetNames.length,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    diagnostics,
  };
}
