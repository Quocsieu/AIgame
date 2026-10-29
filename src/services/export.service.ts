import { LIMITS } from '../config/limits.js';
import { GameSpecification } from '../contracts/game.contract.js';
import { PersistedPracticeSessionRecord } from '../storage/persistence.repository.js';
import { AppError } from '../utils/errors.js';

export type ExportFormat = 'csv' | 'json';

const DANGEROUS_FORMULA_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Neutralizes spreadsheet formula injection (CSV Injection) and escapes RFC-4180 CSV cells.
 * Any string cell starting with =, +, -, @, \t, or \r (even after leading spaces) is prefixed with a single quote (').
 */
export function escapeSafeCsvCell(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) {
    return '';
  }

  if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
    return String(rawValue);
  }

  let str = String(rawValue);
  const trimmedLeading = str.replace(/^[ \u00A0]+/, '');

  if (trimmedLeading.length > 0 && DANGEROUS_FORMULA_PREFIXES.has(trimmedLeading[0])) {
    str = `'${str}`;
  }

  const needsQuotes =
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r') ||
    str.startsWith("'");

  if (needsQuotes) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function buildCsvDocument(headers: string[], rows: unknown[][]): string {
  if (rows.length > LIMITS.EXPORT_MAX_ROWS) {
    throw new AppError(
      'EXPORT_LIMIT_EXCEEDED',
      `Export row count (${rows.length}) exceeds maximum allowed (${LIMITS.EXPORT_MAX_ROWS}).`,
      400
    );
  }

  const headerLine = headers.map(escapeSafeCsvCell).join(',');
  const dataLines = rows.map(row => row.map(escapeSafeCsvCell).join(','));
  // Prefix UTF-8 BOM (\uFEFF) so Microsoft Excel renders Vietnamese diacritics properly
  return `\uFEFF${[headerLine, ...dataLines].join('\r\n')}\r\n`;
}

export class ExportService {
  /**
   * Exports a GameSpecification's question bank in safe CSV or JSON format.
   * Strips any internal server file paths or secrets.
   */
  public exportGameQuestions(
    spec: GameSpecification,
    format: 'csv' | 'json'
  ): { contentType: string; filename: string; body: string } {
    if (!spec.questions || spec.questions.length === 0) {
      throw new AppError('EMPTY_EXPORT_DATA', 'Game specification contains no questions to export.', 400);
    }

    if (spec.questions.length > LIMITS.EXPORT_MAX_ROWS) {
      throw new AppError(
        'EXPORT_LIMIT_EXCEEDED',
        `Question count (${spec.questions.length}) exceeds export limit (${LIMITS.EXPORT_MAX_ROWS}).`,
        400
      );
    }

    const safeSlug = spec.gameId.replace(/[^a-zA-Z0-9_-]/g, '_');

    const sourceNameMap = new Map<string, string>();
    for (const s of spec.sourceSummary?.sources || []) {
      sourceNameMap.set(s.sourceId, s.sourceName);
    }

    const sanitizedQuestions = spec.questions.map((q, index) => {
      const ref = q.sourceReference;
      const safeSourceName = sourceNameMap.get(ref.sourceId) || ref.sourceLocation.split(/[\\/]/).pop() || ref.sourceId;
      return {
        index: index + 1,
        id: q.id,
        type: q.type,
        difficulty: q.difficulty,
        question: q.question,
        choices: q.choices || [],
        sliderConfig: q.sliderConfig || null,
        correctAnswer: q.correctAnswer,
        acceptedAlternatives: q.acceptedAlternatives || [],
        crosswordClue: q.crosswordClue || null,
        crosswordAnswer: q.crosswordAnswer || null,
        explanation: q.explanation || '',
        sourceReference: {
          sourceType: ref.sourceType,
          sourceName: safeSourceName,
          section: ref.section || null,
          page: ref.page ?? null,
          sheet: ref.sheet || null,
          row: ref.row ?? null,
        },
      };
    });

    if (format === 'json') {
      const payload = {
        gameId: spec.gameId,
        title: spec.title,
        description: spec.description,
        gameType: spec.gameType,
        scoringMode: spec.settings.scoringMode,
        timePerQuestion: spec.settings.timePerQuestion,
        questionCount: sanitizedQuestions.length,
        exportedAt: new Date().toISOString(),
        questions: sanitizedQuestions,
      };

      return {
        contentType: 'application/json; charset=utf-8',
        filename: `${safeSlug}_questions.json`,
        body: JSON.stringify(payload, null, 2),
      };
    }

    const headers = [
      'STT',
      'Mã câu hỏi',
      'Loại câu hỏi',
      'Độ khó',
      'Câu hỏi',
      'Lựa chọn A',
      'Lựa chọn B',
      'Lựa chọn C',
      'Lựa chọn D',
      'Đáp án đúng',
      'Đáp án thay thế / Gợi ý ô chữ',
      'Giải thích',
      'Nguồn tham chiếu',
    ];

    const rows = sanitizedQuestions.map(q => {
      const choiceA = q.choices[0] || '';
      const choiceB = q.choices[1] || '';
      const choiceC = q.choices[2] || '';
      const choiceD = q.choices[3] || '';
      const extraInfo =
        q.type === 'CROSSWORD'
          ? q.crosswordClue || ''
          : q.acceptedAlternatives.join(' | ');

      const refParts = [q.sourceReference.sourceName, `(${q.sourceReference.sourceType})`];
      if (q.sourceReference.section) refParts.push(`Mục: ${q.sourceReference.section}`);
      if (q.sourceReference.page) refParts.push(`Trang: ${q.sourceReference.page}`);
      if (q.sourceReference.sheet) refParts.push(`Sheet: ${q.sourceReference.sheet}`);
      if (q.sourceReference.row) refParts.push(`Dòng: ${q.sourceReference.row}`);

      return [
        q.index,
        q.id,
        q.type,
        q.difficulty,
        q.question,
        choiceA,
        choiceB,
        choiceC,
        choiceD,
        q.correctAnswer,
        extraInfo,
        q.explanation,
        refParts.join(' - '),
      ];
    });

    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `${safeSlug}_questions.csv`,
      body: buildCsvDocument(headers, rows),
    };
  }

  /**
   * Exports a completed practice session result in safe CSV or JSON format.
   */
  public exportPracticeSession(
    session: PersistedPracticeSessionRecord,
    format: 'csv' | 'json'
  ): { contentType: string; filename: string; body: string } {
    const safeSlug = session.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const accuracy =
      session.totalQuestions > 0
        ? Math.round((session.correctAnswers / session.totalQuestions) * 100)
        : 0;

    if (format === 'json') {
      const payload = {
        sessionId: session.sessionId,
        gameId: session.gameId,
        gameTitle: session.gameTitle,
        gameType: session.gameType,
        scoringMode: session.scoringMode,
        state: session.state,
        totalQuestions: session.totalQuestions,
        correctAnswers: session.correctAnswers,
        wrongAnswers: session.wrongAnswers,
        accuracyPercent: accuracy,
        totalScore: session.totalScore,
        maxPossibleScore: session.maxPossibleScore,
        maxStreak: session.maxStreak,
        durationMs: session.durationMs,
        startedAt: session.startedAt,
        finishedAt: session.finishedAt,
        exportedAt: new Date().toISOString(),
        questionResults: session.questionResults.map((r, i) => ({
          index: i + 1,
          questionId: r.questionId,
          submittedAnswer: r.answer,
          isCorrect: r.isCorrect,
          pointsEarned: r.pointsEarned,
          responseTimeMs: r.responseTimeMs,
          correctAnswer: r.correctAnswer,
          explanation: r.explanation || '',
        })),
      };

      return {
        contentType: 'application/json; charset=utf-8',
        filename: `${safeSlug}_result.json`,
        body: JSON.stringify(payload, null, 2),
      };
    }

    const headers = [
      'STT',
      'Mã câu hỏi',
      'Câu trả lời đã nộp',
      'Kết quả',
      'Điểm đạt được',
      'Thời gian phản hồi (ms)',
      'Đáp án đúng',
      'Giải thích',
    ];

    const rows = session.questionResults.map((r, idx) => [
      idx + 1,
      r.questionId,
      r.answer,
      r.isCorrect ? 'Đúng' : 'Sai',
      r.pointsEarned,
      r.responseTimeMs,
      r.correctAnswer,
      r.explanation || '',
    ]);

    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `${safeSlug}_result.csv`,
      body: buildCsvDocument(headers, rows),
    };
  }
}

export const exportService = new ExportService();
