import * as XLSX from 'xlsx';
import { LIMITS } from '../config/limits.js';
import { GameSpecification } from '../contracts/game.contract.js';
import { evaluatePerformanceResult } from '../game/game.scoring.js';
import {
  GameScoreboardSummary,
  PersistedPracticeSessionRecord,
  PlayExamHistoryDetail,
} from '../storage/persistence.repository.js';
import { AppError } from '../utils/errors.js';
import type { AdminAiCostReport } from './ai.observability.service.js';

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

  /**
   * Exports a Play/Exam History Detail record (Solo or Multiplayer, Play or Exam) in CSV, XLSX, or JSON format.
   * Neutralizes Formula Injection in both CSV and XLSX cells and never exposes unrevealed exam answers.
   */
  public exportPlayExamHistoryDetail(
    detail: PlayExamHistoryDetail,
    format: ScoreboardExportFormat
  ): { contentType: string; filename: string; body: string | Buffer } {
    const safeSlug = detail.historyId.replace(/[^a-zA-Z0-9_-]/g, '_');

    if (format === 'json') {
      const { ownerUserId: _omitOwner, ...safeDetail } = detail;
      return {
        contentType: 'application/json; charset=utf-8',
        filename: `${safeSlug}_history.json`,
        body: JSON.stringify(
          {
            ...safeDetail,
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
      'Mã nhân viên',
      'Tên game',
      'Chế độ',
      'Hình thức',
      'Trạng thái',
      'Số câu đúng',
      'Số câu sai',
      'Tổng số câu',
      'Tỷ lệ đúng (%)',
      'Điểm đạt được',
      'Điểm tối đa',
      'Kết quả Đạt/Chưa đạt',
      'Xếp loại đánh giá',
      'Lần làm thứ',
      'Tổng số lượt',
      'Thời gian làm bài (giây)',
      'Thời điểm bắt đầu',
      'Thời điểm hoàn thành',
    ];

    const translateStatus = (st: string): string => {
      switch (st) {
        case 'AUTO_SUBMITTED':
          return 'Tự động thu bài';
        case 'CLOSED':
          return 'Đã đóng';
        case 'COMPLETED':
        default:
          return 'Đã hoàn thành';
      }
    };

    const modeLabel = detail.sessionMode === 'EXAM' ? 'Thi nghiêm túc' : 'Chơi';
    const deliveryLabel =
      detail.deliveryMode === 'MULTIPLAYER'
        ? `Nhóm${detail.roomCode ? ` (Phòng ${detail.roomCode})` : ''}`
        : 'Cá nhân';

    const rows: unknown[][] = detail.participants.map((p, idx) => {
      const evalRes = evaluatePerformanceResult({
        correctAnswers: p.correctAnswers,
        totalQuestions: p.totalQuestions,
        totalScore: p.score,
        maxPossibleScore: p.maxPossibleScore,
        sessionMode: detail.sessionMode,
        passThresholdPercent: detail.passThresholdPercent,
      });

      const passLabel =
        detail.sessionMode === 'EXAM'
          ? p.isPassed === null
            ? 'N/A'
            : p.isPassed
              ? 'Đạt'
              : 'Chưa đạt'
          : 'Không áp dụng';

      return [
        p.rank ?? idx + 1,
        p.fullName,
        p.departmentUnit || '',
        p.employeeCode || '',
        detail.gameTitle,
        modeLabel,
        deliveryLabel,
        translateStatus(p.status),
        p.correctAnswers,
        p.wrongAnswers,
        p.totalQuestions,
        p.accuracyPercent,
        p.score,
        p.maxPossibleScore,
        passLabel,
        evalRes.tierLabel,
        p.attemptNumber,
        p.usedAttempts,
        Number((p.durationMs / 1000).toFixed(1)),
        p.startedAt || detail.startedAt || '',
        p.finishedAt || detail.finishedAt || '',
      ];
    });

    if (format === 'csv') {
      return {
        contentType: 'text/csv; charset=utf-8',
        filename: `${safeSlug}_history.csv`,
        body: buildCsvDocument(headers, rows),
      };
    }

    const workbook = XLSX.utils.book_new();
    const sanitizedAoA: Array<Array<string | number | boolean>> = [
      headers.map(h => sanitizeSpreadsheetText(h)),
      ...rows.map(row => row.map(cell => sanitizeSpreadsheetText(cell))),
    ];
    const wsResults = XLSX.utils.aoa_to_sheet(sanitizedAoA);
    XLSX.utils.book_append_sheet(workbook, wsResults, 'Ket Qua Phien');

    const metaRows: Array<Array<string | number | boolean>> = [
      ['Thông tin phiên', 'Giá trị'].map(h => sanitizeSpreadsheetText(h)),
      ['Mã lịch sử', sanitizeSpreadsheetText(detail.historyId)],
      ['Tên game', sanitizeSpreadsheetText(detail.gameTitle)],
      ['Loại game', sanitizeSpreadsheetText(detail.gameType)],
      ['Chế độ', sanitizeSpreadsheetText(modeLabel)],
      ['Hình thức', sanitizeSpreadsheetText(deliveryLabel)],
      ['Trạng thái', sanitizeSpreadsheetText(translateStatus(detail.status))],
      ['Số người tham gia', detail.participantCount],
      ['Điểm trung bình', detail.averageScore],
      ['Điểm cao nhất', detail.highestScore],
      ['Điểm tối đa', detail.maxPossibleScore],
      ['Độ chính xác trung bình (%)', detail.averageAccuracy],
      ['Chính sách tính điểm', sanitizeSpreadsheetText(detail.officialAttemptPolicy)],
      ['Ngưỡng đạt (%)', detail.passThresholdPercent],
      ['Thời gian bắt đầu', sanitizeSpreadsheetText(detail.startedAt || '')],
      ['Thời gian kết thúc', sanitizeSpreadsheetText(detail.finishedAt || '')],
    ];
    const wsMeta = XLSX.utils.aoa_to_sheet(metaRows);
    XLSX.utils.book_append_sheet(workbook, wsMeta, 'Thong Tin Phien');

    if (detail.questionBreakdown && detail.questionBreakdown.length > 0) {
      const qHeaders = [
        'Câu số',
        'Nội dung câu hỏi',
        'Câu trả lời của người chơi',
        'Kết quả',
        'Điểm đạt được',
        'Thời gian phản hồi (ms)',
        'Đáp án đúng',
        'Giải thích',
      ];
      const qAoA: Array<Array<string | number | boolean>> = [
        qHeaders.map(h => sanitizeSpreadsheetText(h)),
        ...detail.questionBreakdown.map(q =>
          [
            q.questionIndex,
            q.questionText,
            q.playerAnswer,
            q.timedOut
              ? 'Hết giờ / Thu bài'
              : q.isCorrect === null || q.isCorrect === undefined
                ? '[Bảo mật cho đến khi công bố]'
                : q.isCorrect
                  ? 'Đúng'
                  : 'Sai',
            q.pointsEarned !== null && q.pointsEarned !== undefined
              ? q.pointsEarned
              : '[Bảo mật cho đến khi công bố]',
            q.responseTimeMs,
            q.correctAnswer !== null ? q.correctAnswer : '[Bảo mật cho đến khi công bố]',
            q.explanation !== null ? q.explanation : '',
          ].map(c => sanitizeSpreadsheetText(c))
        ),
      ];
      const wsQuestions = XLSX.utils.aoa_to_sheet(qAoA);
      XLSX.utils.book_append_sheet(workbook, wsQuestions, 'Chi Tiet Cau Hoi');
    }

    const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    return {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${safeSlug}_history.xlsx`,
      body: xlsxBuffer,
    };
  }

  /**
   * Exports Admin AI Usage Logs in CSV (with UTF-8 BOM) or Excel (.xlsx) format.
   * Never converts null/unreported token counts or costs to 0 — marks them clearly as 'Chưa xác định'.
   * Neutralizes Formula Injection in all cells.
   */
  public exportAdminAiUsageLogs(
    logs: Record<string, any>[],
    format: 'csv' | 'xlsx'
  ): { contentType: string; filename: string; body: string | Buffer } {
    if (logs.length > LIMITS.EXPORT_MAX_ROWS) {
      throw new AppError(
        'EXPORT_LIMIT_EXCEEDED',
        `AI usage log row count (${logs.length}) exceeds maximum allowed (${LIMITS.EXPORT_MAX_ROWS}).`,
        400
      );
    }

    const headers = [
      'STT',
      'Mã Log',
      'Thời Gian (UTC)',
      'Mã Game',
      'Tên Game',
      'Provider',
      'Model',
      'Thao Tác (Operation)',
      'Hạng Mục Ảnh (Slot)',
      'Trạng Thái',
      'Mã Lỗi',
      'Độ Trễ (ms)',
      'Input Tokens',
      'Output Tokens',
      'Tổng Tokens',
      'Chi Phí Ước Tính (USD)',
      'Số Câu Tạo',
      'Số Câu Hợp Lệ',
    ];

    const formatNullableMetric = (val: unknown): number | string => {
      if (val === null || val === undefined || val === '') {
        return 'Chưa xác định';
      }
      const num = Number(val);
      return Number.isFinite(num) ? num : 'Chưa xác định';
    };

    const rows: unknown[][] = logs.map((r, idx) => [
      idx + 1,
      r.log_id || '',
      r.created_at || '',
      r.game_id || 'Chưa gắn game',
      r.game_title || 'Chưa xác định',
      r.provider || '',
      r.model || '',
      r.operation || '',
      r.asset_slot || '',
      r.status || '',
      r.error_code || '',
      typeof r.latency_ms === 'number' ? r.latency_ms : Number(r.latency_ms || 0),
      formatNullableMetric(r.input_tokens),
      formatNullableMetric(r.output_tokens),
      formatNullableMetric(r.total_tokens),
      formatNullableMetric(r.estimated_cost_usd),
      typeof r.generated_questions === 'number' ? r.generated_questions : Number(r.generated_questions || 0),
      typeof r.valid_questions === 'number' ? r.valid_questions : Number(r.valid_questions || 0),
    ]);

    const dateStamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      return {
        contentType: 'text/csv; charset=utf-8',
        filename: `ai_usage_logs_${dateStamp}.csv`,
        body: buildCsvDocument(headers, rows),
      };
    }

    const workbook = XLSX.utils.book_new();
    const sanitizedAoA: Array<Array<string | number | boolean>> = [
      headers.map(h => sanitizeSpreadsheetText(h)),
      ...rows.map(row => row.map(cell => sanitizeSpreadsheetText(cell))),
    ];
    const wsLogs = XLSX.utils.aoa_to_sheet(sanitizedAoA);
    XLSX.utils.book_append_sheet(workbook, wsLogs, 'Nhat Ky AI Usage');

    const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    return {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `ai_usage_logs_${dateStamp}.xlsx`,
      body: xlsxBuffer,
    };
  }

  /**
   * Exports the 4-Sheet AI Token & Cost Report (.xlsx) for Budget Management:
   * - Sheet 1: TỔNG QUAN
   * - Sheet 2: CHI PHÍ TỪNG GAME
   * - Sheet 3: CHI TIẾT API
   * - Sheet 4: BẢNG GIÁ AI
   */
  public exportAdminAiCostReportExcel(report: AdminAiCostReport): {
    contentType: string;
    filename: string;
    body: Buffer;
  } {
    const workbook = XLSX.utils.book_new();
    const dateStamp = (report.generatedAt || new Date().toISOString()).slice(0, 10);

    const fmtNullMetric = (val: number | null | undefined, unknownLabel = 'Chưa xác định'): number | string => {
      if (val === null || val === undefined || !Number.isFinite(val)) {
        return unknownLabel;
      }
      return val;
    };

    const applyColumnFormats = (
      ws: XLSX.WorkSheet,
      headerRowIndex0: number,
      dataRowCount: number,
      colFormats: Record<number, string>
    ) => {
      const startRow = headerRowIndex0 + 1;
      const endRow = headerRowIndex0 + dataRowCount + 1;
      for (let r = startRow; r <= endRow; r++) {
        for (const [colIdxStr, fmt] of Object.entries(colFormats)) {
          const c = Number(colIdxStr);
          const cellRef = XLSX.utils.encode_cell({ r, c });
          const cell = ws[cellRef];
          if (cell && cell.t === 'n') {
            cell.z = fmt;
          }
        }
      }
    };

    // =========================================================================
    // SHEET 1: TỔNG QUAN
    // =========================================================================
    const periodLabel = (() => {
      const f = report.filtersApplied;
      if (f.from || f.to) {
        return `${f.from ? f.from.slice(0, 10) : 'Đầu kỳ'} đến ${f.to ? f.to.slice(0, 10) : 'Hiện tại'} (${f.preset})`;
      }
      return 'Toàn thời gian (ALL)';
    })();

    const sheet1Rows: Array<Array<unknown>> = [
      ['BÁO CÁO CHI PHÍ SỬ DỤNG AI — AI GAME PLATFORM V3', '', '', '', ''],
      ['Kỳ báo cáo', periodLabel, '', 'Thời gian xuất báo cáo', report.generatedAt],
      [
        'Chế độ gói cước cấu hình',
        report.billingModeConfigured,
        '',
        'Tỷ giá USD/VND áp dụng',
        report.exchangeRate.usdToVndRate,
      ],
      [
        'Bộ lọc Model / Loại game / Tác vụ',
        `Model: ${report.filtersApplied.model || 'Tất cả'} | Loại game: ${report.filtersApplied.gameType || 'Tất cả'} | Tác vụ: ${report.filtersApplied.taskType || 'Tất cả'}`,
        '',
        'Nguồn tỷ giá',
        report.exchangeRate.source,
      ],
      ['', '', '', '', ''],
      ['I. CHỈ SỐ TỔNG QUAN (KPIs)', 'Giá trị', 'Đơn vị / Tiền tệ', 'Ghi chú đối soát', ''],
      [
        '1. Tổng số lượt tạo game (Generations)',
        report.summary.totalGameGenerations,
        'lượt tạo game',
        `Số lượt đủ dữ liệu tính trung bình: ${report.summary.eligibleGenerationsForAverage}`,
        '',
      ],
      [
        '2. Tổng số request gọi AI',
        report.summary.totalAiRequests,
        'request',
        `Thành công: ${report.summary.successfulRequests} | Thất bại: ${report.summary.failedRequests}`,
        '',
      ],
      ['3. Tổng Input Tokens', report.summary.inputTokens, 'tokens', 'Đã bao gồm Cached Input Tokens từ Gemini API', ''],
      ['4. Tổng Output Tokens', report.summary.outputTokens, 'tokens', 'Candidates tokens từ phản hồi AI', ''],
      ['5. Tổng Cached Tokens', report.summary.cachedTokens, 'tokens', 'Tính theo đơn giá cache (không cộng trùng vào tổng)', ''],
      ['6. Tổng Thinking Tokens', report.summary.thinkingTokens, 'tokens', 'Tokens suy luận (Gemini 2.5 tính theo giá output)', ''],
      ['7. Tổng Tokens tiêu thụ', report.summary.totalTokens, 'tokens', 'Tổng toàn bộ tokens thực tế đã ghi nhận', ''],
      [
        '8. Tổng chi phí thực trả ước tính (USD)',
        report.summary.actualCostUsd,
        'USD',
        report.billingModeConfigured === 'FREE'
          ? 'Đang ở chế độ FREE Tier ($0 thực trả)'
          : 'Tính theo chế độ gói cước của từng request',
        '',
      ],
      [
        '9. Tổng chi phí thực trả ước tính (VND)',
        report.summary.actualCostVnd,
        'VND',
        `Quy đổi theo tỷ giá ${report.exchangeRate.usdToVndRate.toLocaleString('vi-VN')} VND/USD`,
        '',
      ],
      [
        '10. Tổng chi phí quy đổi theo gói trả phí Paid Tier (USD)',
        report.summary.paidEquivalentCostUsd,
        'USD',
        'Dùng để lập kế hoạch ngân sách ngay cả khi đang chạy Free Tier',
        '',
      ],
      [
        '11. Tổng chi phí quy đổi theo gói trả phí Paid Tier (VND)',
        report.summary.paidEquivalentCostVnd,
        'VND',
        `Quy đổi theo tỷ giá ${report.exchangeRate.usdToVndRate.toLocaleString('vi-VN')} VND/USD`,
        '',
      ],
      [
        '12. Chi phí trung bình mỗi game — Thực trả (USD)',
        fmtNullMetric(report.summary.avgActualCostPerGameUsd),
        'USD / game',
        `Tính trên ${report.summary.eligibleGenerationsForAverage} lượt tạo game hợp lệ`,
        '',
      ],
      [
        '13. Chi phí trung bình mỗi game — Thực trả (VND)',
        fmtNullMetric(report.summary.avgActualCostPerGameVnd),
        'VND / game',
        `Tính trên ${report.summary.eligibleGenerationsForAverage} lượt tạo game hợp lệ`,
        '',
      ],
      [
        '14. Chi phí trung bình mỗi game — Quy đổi Paid Tier (USD)',
        fmtNullMetric(report.summary.avgPaidEquivalentCostPerGameUsd),
        'USD / game',
        `Tính trên ${report.summary.eligibleGenerationsForAverage} lượt tạo game hợp lệ`,
        '',
      ],
      [
        '15. Chi phí trung bình mỗi game — Quy đổi Paid Tier (VND)',
        fmtNullMetric(report.summary.avgPaidEquivalentCostPerGameVnd),
        'VND / game',
        `Tính trên ${report.summary.eligibleGenerationsForAverage} lượt tạo game hợp lệ`,
        '',
      ],
      [
        '16. Model tiêu thụ chi phí nhiều nhất',
        report.summary.highestCostModel || 'Chưa có dữ liệu',
        'Model',
        'Xếp hạng theo tổng chi phí quy đổi Paid Tier',
        '',
      ],
      [
        '17. Số request thiếu dữ liệu token / đơn giá',
        `Thiếu usage: ${report.summary.requestsWithUnknownUsage} | Thiếu bảng giá: ${report.summary.requestsWithPriceUnavailable}`,
        'request',
        'Các bản ghi thiếu dữ liệu được đánh dấu riêng, không tự bịa số 0',
        '',
      ],
      ['', '', '', '', ''],
      [
        'II. DỰ PHÓNG CHI PHÍ KHI MỞ RỘNG QUY MÔ (100 / 1.000 / 10.000 LƯỢT TẠO GAME)',
        '',
        '',
        '',
        '',
      ],
      [
        'Quy mô dự kiến',
        'Tổng Tokens dự kiến',
        'Chi phí thực trả dự kiến (USD)',
        'Chi phí thực trả dự kiến (VND)',
        'Chi phí Paid Tier dự kiến (USD)',
        'Chi phí Paid Tier dự kiến (VND)',
        'Ghi chú công thức',
      ],
      ...report.scalingProjections.map((p) => [
        p.label,
        fmtNullMetric(p.projectedTotalTokens),
        fmtNullMetric(p.projectedActualCostUsd),
        fmtNullMetric(p.projectedActualCostVnd),
        fmtNullMetric(p.projectedPaidEquivalentCostUsd),
        fmtNullMetric(p.projectedPaidEquivalentCostVnd),
        p.formulaNote,
      ]),
      ['', '', '', '', '', '', ''],
      ['III. PHÂN BỔ CHI PHÍ THEO MODEL AI', '', '', '', '', '', ''],
      [
        'Provider',
        'Model AI',
        'Số request',
        'Tổng Tokens',
        'Chi phí thực trả (USD)',
        'Chi phí Paid Tier (USD)',
        'Chi phí Paid Tier (VND)',
        'Tỷ trọng (%)',
      ],
      ...(report.byModel.length > 0
        ? report.byModel.map((m) => [
            m.provider,
            m.model,
            m.requestCount,
            m.totalTokens,
            m.actualCostUsd,
            m.paidEquivalentCostUsd,
            m.paidEquivalentCostVnd,
            m.shareOfPaidCostPercent,
          ])
        : [['Chưa có dữ liệu', '', 0, 0, 0, 0, 0, 0]]),
    ];

    const sanitizedSheet1 = sheet1Rows.map((row) => row.map((c) => sanitizeSpreadsheetText(c)));
    const wsOverview = XLSX.utils.aoa_to_sheet(sanitizedSheet1);
    wsOverview['!cols'] = [
      { wch: 46 },
      { wch: 26 },
      { wch: 24 },
      { wch: 30 },
      { wch: 26 },
      { wch: 26 },
      { wch: 42 },
      { wch: 16 },
    ];
    wsOverview['!views'] = [{ state: 'frozen', ySplit: 6 }];
    XLSX.utils.book_append_sheet(workbook, wsOverview, 'TỔNG QUAN');

    // =========================================================================
    // SHEET 2: CHI PHÍ TỪNG GAME
    // =========================================================================
    const sheet2Headers = [
      'STT',
      'Game ID / Generation ID',
      'Tên game',
      'Loại game',
      'Thời gian tạo',
      'Model sử dụng',
      'Số request AI',
      'Input Tokens',
      'Output Tokens',
      'Cached Tokens',
      'Thinking Tokens',
      'Tổng Tokens',
      'Chi phí thực trả (USD)',
      'Chi phí thực trả (VND)',
      'Chi phí quy đổi Paid Tier (USD)',
      'Chi phí quy đổi Paid Tier (VND)',
      'Trạng thái',
    ];

    const sheet2DataRows: Array<Array<unknown>> = report.byGame.map((g, idx) => [
      idx + 1,
      g.gameId || g.generationId || g.generationKey,
      g.gameTitle,
      g.gameType,
      g.createdAt,
      g.modelsUsed.join(', '),
      g.requestCount,
      fmtNullMetric(g.inputTokens),
      fmtNullMetric(g.outputTokens),
      fmtNullMetric(g.cachedTokens ?? 0),
      fmtNullMetric(g.thinkingTokens ?? 0),
      fmtNullMetric(g.totalTokens),
      fmtNullMetric(g.actualCostUsd),
      fmtNullMetric(g.actualCostVnd),
      fmtNullMetric(g.paidEquivalentCostUsd),
      fmtNullMetric(g.paidEquivalentCostVnd),
      g.status,
    ]);

    const sheet2TotalRow: Array<unknown> = [
      'TỔNG CỘNG',
      `${report.summary.totalGameGenerations} lượt tạo game`,
      '',
      '',
      '',
      '',
      report.summary.totalAiRequests,
      report.summary.inputTokens,
      report.summary.outputTokens,
      report.summary.cachedTokens,
      report.summary.thinkingTokens,
      report.summary.totalTokens,
      report.summary.actualCostUsd,
      report.summary.actualCostVnd,
      report.summary.paidEquivalentCostUsd,
      report.summary.paidEquivalentCostVnd,
      `TB Paid/Game: ${
        report.summary.avgPaidEquivalentCostPerGameUsd !== null
          ? `$${report.summary.avgPaidEquivalentCostPerGameUsd.toFixed(6)}`
          : 'Chưa xác định'
      }`,
    ];

    const sanitizedSheet2 = [
      sheet2Headers.map((h) => sanitizeSpreadsheetText(h)),
      ...sheet2DataRows.map((r) => r.map((c) => sanitizeSpreadsheetText(c))),
      sheet2TotalRow.map((c) => sanitizeSpreadsheetText(c)),
    ];
    const wsGames = XLSX.utils.aoa_to_sheet(sanitizedSheet2);
    wsGames['!cols'] = [
      { wch: 6 },
      { wch: 28 },
      { wch: 38 },
      { wch: 18 },
      { wch: 24 },
      { wch: 26 },
      { wch: 14 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 16 },
      { wch: 16 },
      { wch: 22 },
      { wch: 22 },
      { wch: 26 },
      { wch: 26 },
      { wch: 20 },
    ];
    wsGames['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: Math.max(1, sheet2DataRows.length), c: sheet2Headers.length - 1 },
      }),
    };
    wsGames['!views'] = [{ state: 'frozen', ySplit: 1 }];
    applyColumnFormats(wsGames, 0, sheet2DataRows.length + 1, {
      6: '#,##0',
      7: '#,##0',
      8: '#,##0',
      9: '#,##0',
      10: '#,##0',
      11: '#,##0',
      12: '$#,##0.000000',
      13: '#,##0 "₫"',
      14: '$#,##0.000000',
      15: '#,##0 "₫"',
    });
    XLSX.utils.book_append_sheet(workbook, wsGames, 'CHI PHÍ TỪNG GAME');

    // =========================================================================
    // SHEET 3: CHI TIẾT API
    // =========================================================================
    const sheet3Headers = [
      'STT',
      'Request ID',
      'Generation ID',
      'Game ID',
      'Tên game',
      'Thời gian',
      'Provider',
      'Model',
      'Task Type',
      'Operation',
      'Input Tokens',
      'Output Tokens',
      'Cached Tokens',
      'Thinking Tokens',
      'Total Tokens',
      'Status',
      'Billing Mode',
      'Pricing Status',
      'Cost USD (Thực trả)',
      'Cost VND (Thực trả)',
      'Paid Equivalent USD',
      'Paid Equivalent VND',
      'Latency (ms)',
      'Ghi chú',
    ];

    const sheet3DataRows: Array<Array<unknown>> = report.apiLogs.map((r, idx) => [
      idx + 1,
      r.requestId,
      r.generationId || 'Chưa gắn',
      r.gameId || 'Chưa lưu / Đã xóa',
      r.gameTitle || 'Chưa xác định',
      r.createdAt,
      r.provider,
      r.model,
      r.taskType,
      r.operation,
      fmtNullMetric(r.inputTokens),
      fmtNullMetric(r.outputTokens),
      fmtNullMetric(r.cachedTokens ?? 0),
      fmtNullMetric(r.thinkingTokens ?? 0),
      fmtNullMetric(r.totalTokens),
      r.status,
      r.billingMode,
      r.pricingStatus,
      fmtNullMetric(r.actualCostUsd),
      fmtNullMetric(r.actualCostVnd),
      fmtNullMetric(r.paidEquivalentCostUsd),
      fmtNullMetric(r.paidEquivalentCostVnd),
      r.latencyMs,
      r.dataNote || (r.errorCode ? `Mã lỗi: ${r.errorCode}` : 'Hợp lệ'),
    ]);

    const sheet3TotalRow: Array<unknown> = [
      'TỔNG CỘNG',
      `${report.summary.totalAiRequests} requests`,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      report.summary.inputTokens,
      report.summary.outputTokens,
      report.summary.cachedTokens,
      report.summary.thinkingTokens,
      report.summary.totalTokens,
      `OK: ${report.summary.successfulRequests} / Lỗi: ${report.summary.failedRequests}`,
      report.billingModeConfigured,
      '',
      report.summary.actualCostUsd,
      report.summary.actualCostVnd,
      report.summary.paidEquivalentCostUsd,
      report.summary.paidEquivalentCostVnd,
      '',
      '',
    ];

    const sanitizedSheet3 = [
      sheet3Headers.map((h) => sanitizeSpreadsheetText(h)),
      ...sheet3DataRows.map((r) => r.map((c) => sanitizeSpreadsheetText(c))),
      sheet3TotalRow.map((c) => sanitizeSpreadsheetText(c)),
    ];
    const wsApi = XLSX.utils.aoa_to_sheet(sanitizedSheet3);
    wsApi['!cols'] = [
      { wch: 6 },
      { wch: 28 },
      { wch: 24 },
      { wch: 24 },
      { wch: 32 },
      { wch: 24 },
      { wch: 12 },
      { wch: 24 },
      { wch: 28 },
      { wch: 26 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 16 },
      { wch: 15 },
      { wch: 12 },
      { wch: 14 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 22 },
      { wch: 22 },
      { wch: 14 },
      { wch: 44 },
    ];
    wsApi['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: Math.max(1, sheet3DataRows.length), c: sheet3Headers.length - 1 },
      }),
    };
    wsApi['!views'] = [{ state: 'frozen', ySplit: 1 }];
    applyColumnFormats(wsApi, 0, sheet3DataRows.length + 1, {
      10: '#,##0',
      11: '#,##0',
      12: '#,##0',
      13: '#,##0',
      14: '#,##0',
      18: '$#,##0.000000',
      19: '#,##0 "₫"',
      20: '$#,##0.000000',
      21: '#,##0 "₫"',
      22: '#,##0',
    });
    XLSX.utils.book_append_sheet(workbook, wsApi, 'CHI TIẾT API');

    // =========================================================================
    // SHEET 4: BẢNG GIÁ AI
    // =========================================================================
    const sheet4Headers = [
      'Provider',
      'Model',
      'Tên hiển thị',
      'Giá Input / 1M Tokens (USD)',
      'Giá Output / 1M Tokens (USD)',
      'Giá Cache Input / 1M Tokens (USD)',
      'Giá Tạo ảnh / Ảnh (USD)',
      'Đơn vị tính',
      'Phiên bản bảng giá',
      'Ngày hiệu lực',
      'Nguồn giá tham chiếu',
      'Tỷ giá USD/VND',
      'Ngày áp dụng tỷ giá',
      'Ghi chú',
    ];

    const sheet4DataRows: Array<Array<unknown>> = report.pricingCatalog.map((p) => [
      p.provider,
      p.model,
      p.displayName,
      p.inputPricePer1MUsd,
      p.outputPricePer1MUsd,
      p.cachedInputPricePer1MUsd,
      p.imagePriceUsd !== null ? p.imagePriceUsd : 'Tính theo token',
      p.unitDescription,
      p.pricingVersion,
      p.effectiveFrom,
      p.sourceUrl,
      report.exchangeRate.usdToVndRate,
      report.exchangeRate.effectiveDate,
      p.notes || '',
    ]);

    const sanitizedSheet4 = [
      sheet4Headers.map((h) => sanitizeSpreadsheetText(h)),
      ...sheet4DataRows.map((r) => r.map((c) => sanitizeSpreadsheetText(c))),
    ];
    const wsPricing = XLSX.utils.aoa_to_sheet(sanitizedSheet4);
    wsPricing['!cols'] = [
      { wch: 12 },
      { wch: 26 },
      { wch: 30 },
      { wch: 26 },
      { wch: 26 },
      { wch: 28 },
      { wch: 22 },
      { wch: 38 },
      { wch: 22 },
      { wch: 16 },
      { wch: 32 },
      { wch: 18 },
      { wch: 20 },
      { wch: 48 },
    ];
    wsPricing['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: Math.max(1, sheet4DataRows.length), c: sheet4Headers.length - 1 },
      }),
    };
    wsPricing['!views'] = [{ state: 'frozen', ySplit: 1 }];
    applyColumnFormats(wsPricing, 0, sheet4DataRows.length, {
      3: '$#,##0.00000',
      4: '$#,##0.00000',
      5: '$#,##0.00000',
      6: '$#,##0.00000',
      11: '#,##0 "₫"',
    });
    XLSX.utils.book_append_sheet(workbook, wsPricing, 'BẢNG GIÁ AI');

    const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    return {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `AI_Game_Cost_Report_${dateStamp}.xlsx`,
      body: xlsxBuffer,
    };
  }
}

export const exportService = new ExportService();
