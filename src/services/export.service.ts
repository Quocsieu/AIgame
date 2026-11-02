import * as XLSX from 'xlsx';
import { LIMITS } from '../config/limits.js';
import { GameSpecification } from '../contracts/game.contract.js';
import { evaluatePerformanceResult } from '../game/game.scoring.js';
import {
  GameScoreboardSummary,
  PersistedPracticeSessionRecord,
} from '../storage/persistence.repository.js';
import { AppError } from '../utils/errors.js';

export type ExportFormat = 'csv' | 'json';
export type ScoreboardExportFormat = 'csv' | 'xlsx' | 'json';

const DANGEROUS_FORMULA_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Neutralizes spreadsheet formula injection for string values in both CSV and XLSX cells.
 * Any string cell starting with =, +, -, @, \t, or \r (even after leading spaces) is prefixed with a single quote (').
 */
export function sanitizeSpreadsheetText(rawValue: unknown): string | number | boolean {
  if (rawValue === null || rawValue === undefined) {
    return '';
  }

  if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
    return rawValue;
  }

  const str = String(rawValue);
  const trimmedLeading = str.replace(/^[ \u00A0]+/, '');

  if (trimmedLeading.length > 0 && DANGEROUS_FORMULA_PREFIXES.has(trimmedLeading[0])) {
    return `'${str}`;
  }

  return str;
}

/**
 * Neutralizes spreadsheet formula injection (CSV Injection) and escapes RFC-4180 CSV cells.
 * Any string cell starting with =, +, -, @, \t, or \r (even after leading spaces) is prefixed with a single quote (').
 */
export function escapeSafeCsvCell(rawValue: unknown): string {
  const safeVal = sanitizeSpreadsheetText(rawValue);
  if (typeof safeVal === 'number' || typeof safeVal === 'boolean') {
    return String(safeVal);
  }

  const str = String(safeVal);
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
        timeLimitSeconds: q.timeLimitSeconds ?? spec.settings.timePerQuestion,
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
      'Loại câu hỏi',
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
      'QUIZ',
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

  /**
   * Exports a comprehensive Scoreboard & Attempt History for a game in CSV, XLSX, or JSON format.
   * Neutralizes Formula Injection in both CSV and XLSX cells.
   */
  public exportGameScoreboard(
    scoreboard: GameScoreboardSummary,
    format: ScoreboardExportFormat
  ): { contentType: string; filename: string; body: string | Buffer } {
    const safeSlug = scoreboard.gameId.replace(/[^a-zA-Z0-9_-]/g, '_');

    if (format === 'json') {
      return {
        contentType: 'application/json; charset=utf-8',
        filename: `${safeSlug}_scoreboard.json`,
        body: JSON.stringify(
          {
            ...scoreboard,
            exportedAt: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    }

    const headers = [
      'Hạng',
      'Họ và tên',
      'Phòng ban / Đơn vị',
      'Trạng thái',
      'Lượt chính thức',
      'Tổng số lượt thi',
      'Số lần cấp thi lại',
      'Số câu đúng',
      'Tổng số câu',
      'Tỷ lệ đúng (%)',
      'Điểm đạt được',
      'Điểm tối đa',
      'Kết quả Đạt/Chưa đạt',
      'Xếp loại đánh giá',
      'Nhận xét',
      'Thời gian làm bài (giây)',
      'Thời điểm hoàn thành',
    ];

    const translateStatus = (status: string): string => {
      switch (status) {
        case 'COMPLETED':
          return 'Đã hoàn thành';
        case 'IN_PROGRESS':
          return 'Đang làm bài';
        case 'PENDING':
        default:
          return 'Chưa tham gia';
      }
    };

    const sourceEntries =
      Array.isArray(scoreboard.allEntries) && scoreboard.allEntries.length > 0
        ? scoreboard.allEntries
        : scoreboard.entries;

    const summaryRows: unknown[][] = sourceEntries.map((entry, idx) => {
      const hasFinished = entry.status === 'COMPLETED';
      const evalRes = hasFinished
        ? evaluatePerformanceResult({
            correctAnswers: entry.correctAnswers,
            totalQuestions: entry.totalQuestions,
            totalScore: entry.score,
            maxPossibleScore: entry.maxPossibleScore,
            sessionMode: scoreboard.sessionMode,
            passThresholdPercent: scoreboard.passThresholdPercent,
          })
        : null;

      return [
        entry.rank ?? idx + 1,
        entry.fullName,
        entry.departmentUnit || '',
        translateStatus(entry.status),
        entry.officialAttemptNumber ?? 0,
        entry.usedAttempts,
        entry.retakeGrantedCount,
        entry.correctAnswers,
        entry.totalQuestions,
        entry.accuracyPercent,
        entry.score,
        entry.maxPossibleScore,
        hasFinished
          ? entry.isPassed === null
            ? 'N/A'
            : entry.isPassed
              ? 'Đạt'
              : 'Chưa đạt'
          : 'Chưa thi',
        evalRes ? evalRes.tierLabel : '',
        evalRes ? evalRes.comment : '',
        Number((entry.durationMs / 1000).toFixed(1)),
        entry.finishedAt || '',
      ];
    });

    if (format === 'csv') {
      return {
        contentType: 'text/csv; charset=utf-8',
        filename: `${safeSlug}_scoreboard.csv`,
        body: buildCsvDocument(headers, summaryRows),
      };
    }

    // XLSX Export with 2 sheets: "Bang Diem Tong Hop" and "Lich Su Luot Thi"
    const workbook = XLSX.utils.book_new();

    const sanitizedSummaryAoA: Array<Array<string | number | boolean>> = [
      headers.map(h => sanitizeSpreadsheetText(h)),
      ...summaryRows.map(row => row.map(cell => sanitizeSpreadsheetText(cell))),
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(sanitizedSummaryAoA);
    XLSX.utils.book_append_sheet(workbook, wsSummary, 'Bang Diem Tong Hop');

    const historyHeaders = [
      'Mã lượt thi',
      'Họ và tên',
      'Phòng ban / Đơn vị',
      'Lần thi thứ',
      'Là lượt chính thức',
      'Hình thức',
      'Trạng thái lượt',
      'Số câu đúng',
      'Tổng số câu',
      'Tỷ lệ đúng (%)',
      'Điểm đạt được',
      'Điểm tối đa',
      'Đạt / Chưa đạt',
      'Xếp loại đánh giá',
      'Thời gian làm bài (giây)',
      'Bắt đầu lúc',
      'Kết thúc lúc',
    ];

    const historyRows: Array<Array<string | number | boolean>> = [
      historyHeaders.map(h => sanitizeSpreadsheetText(h)),
    ];

    for (const entry of sourceEntries) {
      for (const att of entry.attemptHistory) {
        const isOfficial = entry.officialAttemptId === att.attemptId;
        const attEval = evaluatePerformanceResult({
          correctAnswers: att.correctAnswers,
          totalQuestions: att.totalQuestions,
          totalScore: att.score,
          maxPossibleScore: att.maxPossibleScore,
          sessionMode: att.sessionMode,
          passThresholdPercent: scoreboard.passThresholdPercent,
        });
        historyRows.push(
          [
            att.attemptId,
            att.displayName,
            att.departmentUnit || '',
            att.attemptNumber,
            isOfficial ? 'Chính thức' : 'Phụ / Lịch sử',
            att.deliveryMode === 'MULTIPLAYER' ? 'Phòng trực tiếp' : 'Cá nhân (Solo)',
            att.state,
            att.correctAnswers,
            att.totalQuestions,
            att.accuracyPercent,
            att.score,
            att.maxPossibleScore,
            att.isPassed === null ? 'N/A' : att.isPassed ? 'Đạt' : 'Chưa đạt',
            attEval.tierLabel,
            Number((att.durationMs / 1000).toFixed(1)),
            att.startedAt,
            att.finishedAt || '',
          ].map(cell => sanitizeSpreadsheetText(cell))
        );
      }
    }

    const wsHistory = XLSX.utils.aoa_to_sheet(historyRows);
    XLSX.utils.book_append_sheet(workbook, wsHistory, 'Lich Su Luot Thi');

    const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    return {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${safeSlug}_scoreboard.xlsx`,
      body: xlsxBuffer,
    };
  }
}

export const exportService = new ExportService();
