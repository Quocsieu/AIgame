import crypto from 'node:crypto';
import { LIMITS } from '../config/limits.js';
import { CanonicalDocument } from '../contracts/canonical.contract.js';
import { Difficulty, GameType } from '../contracts/game.contract.js';
import { getDatabase } from '../storage/sqlite.db.js';
import { AiQuestionService } from './ai.question.service.js';

export interface AiProviderUsageMetadata {
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  usageReportedByProvider: boolean;
}

export interface RecordAiCallInput {
  userId?: string | null;
  provider: string;
  model: string;
  operation: string;
  status: 'SUCCESS' | 'FAILED';
  errorCode?: string | null;
  latencyMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  usageIsEstimated?: boolean;
  requestedQuestions?: number;
  generatedQuestions?: number;
  validQuestions?: number;
  rejectedQuestions?: number;
  duplicateQuestions?: number;
  diagnosticsCount?: number;
  gameType?: GameType;
  difficulty?: Difficulty;
  sourceCount?: number;
}

export interface AiObservabilitySummary {
  timeRange: {
    from: string | null;
    to: string | null;
  };
  totals: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    averageLatencyMs: number | null;
    callsWithReportedTokens: number;
    callsWithUnknownTokens: number;
    reportedInputTokens: number | null;
    reportedOutputTokens: number | null;
    reportedTotalTokens: number | null;
    estimatedCostUsd: number | null;
    pricingConfigured: boolean;
  };
  questionQuality: {
    totalRequested: number;
    totalGeneratedRaw: number;
    totalValidAccepted: number;
    totalRejectedInvalid: number;
    totalDuplicatesFiltered: number;
    totalDiagnostics: number;
    acceptanceRatePercent: number | null;
  };
  byModel: Array<{
    provider: string;
    model: string;
    calls: number;
    successCount: number;
    failedCount: number;
    reportedTotalTokens: number | null;
  }>;
  errorBreakdown: Array<{
    errorCode: string;
    count: number;
  }>;
  recentLogs: Array<{
    logId: string;
    provider: string;
    model: string;
    operation: string;
    status: string;
    errorCode: string | null;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    estimatedCostUsd: number | null;
    requestedQuestions: number;
    validQuestions: number;
    rejectedQuestions: number;
    duplicateQuestions: number;
    gameType: string | null;
    difficulty: string | null;
    createdAt: string;
  }>;
}

export interface BenchmarkCaseResult {
  caseId: string;
  name: string;
  gameType: GameType;
  passed: boolean;
  validQuestionCount: number;
  expectedValidCount: number;
  diagnosticsCount: number;
  checks: {
    schemaValid: boolean;
    answersValid: boolean;
    duplicatesFiltered: boolean;
    vietnameseLanguage: boolean;
    provenanceAttached: boolean;
  };
  error?: string;
}

export class AiObservabilityService {
  /**
   * Computes estimated cost ONLY when actual token counts are reported AND pricing is configured.
   */
  public computeEstimatedCostUsd(
    inputTokens: number | null | undefined,
    outputTokens: number | null | undefined
  ): number | null {
    if (
      inputTokens === null ||
      inputTokens === undefined ||
      outputTokens === null ||
      outputTokens === undefined
    ) {
      return null;
    }

    const inRate = LIMITS.GEMINI_INPUT_COST_PER_1M_USD;
    const outRate = LIMITS.GEMINI_OUTPUT_COST_PER_1M_USD;
    if (inRate === null || outRate === null || !Number.isFinite(inRate) || !Number.isFinite(outRate)) {
      return null;
    }

    const cost = (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate;
    return Math.round(cost * 1_000_000) / 1_000_000;
  }

  /**
   * Records an AI generation call in SQLite without logging raw prompts, source files, or secrets.
   */
  public recordAiCall(input: RecordAiCallInput): string {
    const db = getDatabase();
    const logId = `ailog_${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();

    const hasInput = typeof input.inputTokens === 'number' && Number.isFinite(input.inputTokens);
    const hasOutput = typeof input.outputTokens === 'number' && Number.isFinite(input.outputTokens);

    const inputTokens = hasInput ? Math.max(0, Math.floor(input.inputTokens!)) : null;
    const outputTokens = hasOutput ? Math.max(0, Math.floor(input.outputTokens!)) : null;
    const totalTokens =
      typeof input.totalTokens === 'number' && Number.isFinite(input.totalTokens)
        ? Math.max(0, Math.floor(input.totalTokens))
        : inputTokens !== null && outputTokens !== null
          ? inputTokens + outputTokens
          : null;

    const estimatedCostUsd = this.computeEstimatedCostUsd(inputTokens, outputTokens);

    db.prepare(
      `INSERT INTO ai_usage_logs (
        log_id, user_id, provider, model, operation, status, error_code,
        latency_ms, input_tokens, output_tokens, total_tokens, usage_is_estimated,
        estimated_cost_usd, requested_questions, generated_questions, valid_questions,
        rejected_questions, duplicate_questions, diagnostics_count, game_type,
        difficulty, source_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      logId,
      input.userId ?? null,
      input.provider,
      input.model,
      input.operation,
      input.status,
      input.errorCode ?? null,
      Math.max(0, Math.round(input.latencyMs)),
      inputTokens,
      outputTokens,
      totalTokens,
      input.usageIsEstimated ? 1 : 0,
      estimatedCostUsd,
      input.requestedQuestions ?? 0,
      input.generatedQuestions ?? 0,
      input.validQuestions ?? 0,
      input.rejectedQuestions ?? 0,
      input.duplicateQuestions ?? 0,
      input.diagnosticsCount ?? 0,
      input.gameType ?? null,
      input.difficulty ?? null,
      input.sourceCount ?? 0,
      nowIso
    );

    return logId;
  }

  /**
   * Queries aggregated AI observability metrics for a given time range and optional user scope.
   */
  public getSummary(options: {
    from?: string;
    to?: string;
    userId?: string | null;
    limitRecent?: number;
  } = {}): AiObservabilitySummary {
    const db = getDatabase();
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.userId !== undefined) {
      if (options.userId === null) {
        conditions.push('user_id IS NULL');
      } else {
        conditions.push('user_id = ?');
        params.push(options.userId);
      }
    }

    if (options.from) {
      conditions.push('created_at >= ?');
      params.push(options.from);
    }

    if (options.to) {
      conditions.push('created_at <= ?');
      params.push(options.to);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const aggRow = db
      .prepare(
        `SELECT
          COUNT(*) as total_calls,
          SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success_calls,
          SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed_calls,
          AVG(latency_ms) as avg_latency,
          SUM(CASE WHEN total_tokens IS NOT NULL THEN 1 ELSE 0 END) as calls_with_tokens,
          SUM(CASE WHEN total_tokens IS NULL THEN 1 ELSE 0 END) as calls_without_tokens,
          SUM(input_tokens) as sum_input_tokens,
          SUM(output_tokens) as sum_output_tokens,
          SUM(total_tokens) as sum_total_tokens,
          SUM(estimated_cost_usd) as sum_cost_usd,
          SUM(requested_questions) as sum_requested,
          SUM(generated_questions) as sum_generated,
          SUM(valid_questions) as sum_valid,
          SUM(rejected_questions) as sum_rejected,
          SUM(duplicate_questions) as sum_duplicates,
          SUM(diagnostics_count) as sum_diagnostics
        FROM ai_usage_logs ${whereClause}`
      )
      .get(...params) as Record<string, any>;

    const totalCalls = Number(aggRow?.total_calls || 0);
    const callsWithTokens = Number(aggRow?.calls_with_tokens || 0);
    const totalGeneratedRaw = Number(aggRow?.sum_generated || 0);
    const totalValidAccepted = Number(aggRow?.sum_valid || 0);

    const byModelRows = db
      .prepare(
        `SELECT
          provider,
          model,
          COUNT(*) as calls,
          SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success_count,
          SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed_count,
          SUM(total_tokens) as sum_tokens
        FROM ai_usage_logs ${whereClause}
        GROUP BY provider, model
        ORDER BY calls DESC`
      )
      .all(...params) as Record<string, any>[];

    const errorConditions = [...conditions, "status = 'FAILED'", 'error_code IS NOT NULL'];
    const errorWhere = `WHERE ${errorConditions.join(' AND ')}`;
    const errorRows = db
      .prepare(
        `SELECT error_code, COUNT(*) as cnt
        FROM ai_usage_logs ${errorWhere}
        GROUP BY error_code
        ORDER BY cnt DESC`
      )
      .all(...params) as Record<string, any>[];

    const recentLimit = Math.min(50, Math.max(1, options.limitRecent ?? 15));
    const recentRows = db
      .prepare(
        `SELECT * FROM ai_usage_logs ${whereClause} ORDER BY created_at DESC LIMIT ?`
      )
      .all(...params, recentLimit) as Record<string, any>[];

    const pricingConfigured =
      LIMITS.GEMINI_INPUT_COST_PER_1M_USD !== null &&
      LIMITS.GEMINI_OUTPUT_COST_PER_1M_USD !== null;

    return {
      timeRange: {
        from: options.from || null,
        to: options.to || null,
      },
      totals: {
        totalCalls,
        successfulCalls: Number(aggRow?.success_calls || 0),
        failedCalls: Number(aggRow?.failed_calls || 0),
        averageLatencyMs:
          totalCalls > 0 && aggRow?.avg_latency !== null
            ? Math.round(Number(aggRow.avg_latency))
            : null,
        callsWithReportedTokens: callsWithTokens,
        callsWithUnknownTokens: Number(aggRow?.calls_without_tokens || 0),
        reportedInputTokens:
          callsWithTokens > 0 && aggRow?.sum_input_tokens !== null
            ? Number(aggRow.sum_input_tokens)
            : null,
        reportedOutputTokens:
          callsWithTokens > 0 && aggRow?.sum_output_tokens !== null
            ? Number(aggRow.sum_output_tokens)
            : null,
        reportedTotalTokens:
          callsWithTokens > 0 && aggRow?.sum_total_tokens !== null
            ? Number(aggRow.sum_total_tokens)
            : null,
        estimatedCostUsd:
          pricingConfigured && callsWithTokens > 0 && aggRow?.sum_cost_usd !== null
            ? Math.round(Number(aggRow.sum_cost_usd) * 1_000_000) / 1_000_000
            : null,
        pricingConfigured,
      },
      questionQuality: {
        totalRequested: Number(aggRow?.sum_requested || 0),
        totalGeneratedRaw,
        totalValidAccepted,
        totalRejectedInvalid: Number(aggRow?.sum_rejected || 0),
        totalDuplicatesFiltered: Number(aggRow?.sum_duplicates || 0),
        totalDiagnostics: Number(aggRow?.sum_diagnostics || 0),
        acceptanceRatePercent:
          totalGeneratedRaw > 0
            ? Math.round((totalValidAccepted / totalGeneratedRaw) * 100)
            : null,
      },
      byModel: byModelRows.map(r => ({
        provider: String(r.provider),
        model: String(r.model),
        calls: Number(r.calls),
        successCount: Number(r.success_count || 0),
        failedCount: Number(r.failed_count || 0),
        reportedTotalTokens:
          r.sum_tokens !== null && r.sum_tokens !== undefined ? Number(r.sum_tokens) : null,
      })),
      errorBreakdown: errorRows.map(r => ({
        errorCode: String(r.error_code),
        count: Number(r.cnt),
      })),
      recentLogs: recentRows.map(r => ({
        logId: String(r.log_id),
        provider: String(r.provider),
        model: String(r.model),
        operation: String(r.operation),
        status: String(r.status),
        errorCode: r.error_code ? String(r.error_code) : null,
        latencyMs: Number(r.latency_ms),
        inputTokens: r.input_tokens !== null ? Number(r.input_tokens) : null,
        outputTokens: r.output_tokens !== null ? Number(r.output_tokens) : null,
        totalTokens: r.total_tokens !== null ? Number(r.total_tokens) : null,
        estimatedCostUsd:
          r.estimated_cost_usd !== null ? Number(r.estimated_cost_usd) : null,
        requestedQuestions: Number(r.requested_questions),
        validQuestions: Number(r.valid_questions),
        rejectedQuestions: Number(r.rejected_questions),
        duplicateQuestions: Number(r.duplicate_questions),
        gameType: r.game_type ? String(r.game_type) : null,
        difficulty: r.difficulty ? String(r.difficulty) : null,
        createdAt: String(r.created_at),
      })),
    };
  }

  /**
   * Runs a deterministic, fixture-based AI quality benchmark suite verifying:
   * - Schema compliance
   * - Valid answer matching
   * - Duplicate filtering & partial-batch recovery
   * - Vietnamese language compliance
   * - Source provenance attachment
   */
  public async runDeterministicBenchmark(): Promise<{
    allPassed: boolean;
    totalCases: number;
    passedCases: number;
    results: BenchmarkCaseResult[];
    executedAt: string;
  }> {
    const fixtureDoc: CanonicalDocument = {
      sourceId: 'src_benchmark_vn',
      sourceType: 'PDF',
      sourceName: 'tai_lieu_an_toan_giao_thong.pdf',
      sourceLocation: 'upload://tai_lieu_an_toan_giao_thong.pdf',
      title: 'Cẩm Nang An Toàn Giao Thông & Bảo Dưỡng Xe Máy',
      sections: [
        {
          title: 'Quy định tốc độ & Mũ bảo hiểm',
          content:
            'Người điều khiển xe mô tô, xe gắn máy bắt buộc phải đội mũ bảo hiểm đạt chuẩn quốc gia và cài quai đúng quy cách. Tốc độ tối đa trong khu vực đông dân cư đối với xe máy là 50 km/h (đường không có dải phân cách cứng).',
          provenance: {
            sourceId: 'src_benchmark_vn',
            sourceType: 'PDF',
            sourceLocation: 'upload://tai_lieu_an_toan_giao_thong.pdf',
            section: 'Quy định tốc độ & Mũ bảo hiểm',
            page: 1,
          },
        },
        {
          title: 'Bảo dưỡng định kỳ',
          content:
            'Dầu nhớt động cơ khoáng nên được thay mới sau mỗi 1.500 đến 2.000 km vận hành. Áp suất lốp sau tiêu chuẩn khi chở hai người là 225 kPa.',
          provenance: {
            sourceId: 'src_benchmark_vn',
            sourceType: 'PDF',
            sourceLocation: 'upload://tai_lieu_an_toan_giao_thong.pdf',
            section: 'Bảo dưỡng định kỳ',
            page: 2,
          },
        },
      ],
      text: 'Người điều khiển xe mô tô bắt buộc đội mũ bảo hiểm đạt chuẩn. Tốc độ tối đa khu đông dân cư là 50 km/h. Dầu nhớt thay mỗi 1.500 - 2.000 km.',
      extractedItems: [],
      metadata: {
        originalSize: 2048,
        characterCount: 350,
        pageCount: 2,
        extractedAt: new Date().toISOString(),
      },
      diagnostics: [],
    };

    const cases: Array<{
      caseId: string;
      name: string;
      gameType: GameType;
      expectedValidCount: number;
      fixtureOutput: any[];
    }> = [
      {
        caseId: 'bench_mc_dedup_recovery',
        name: 'Trắc nghiệm (MULTIPLE_CHOICE) + Lọc trùng + Phục hồi câu lỗi',
        gameType: 'MULTIPLE_CHOICE',
        expectedValidCount: 2,
        fixtureOutput: [
          {
            id: 'q1',
            type: 'MULTIPLE_CHOICE',
            question: 'Chu kỳ thay dầu nhớt khoáng cho xe máy là bao nhiêu km?',
            choices: ['A. 500 km', 'B. 1.500 - 2.000 km', 'C. 5.000 km', 'D. 10.000 km'],
            correctAnswer: 'B. 1.500 - 2.000 km',
            explanation: 'Tài liệu trang 2 nêu rõ dầu nhớt khoáng thay sau mỗi 1.500 đến 2.000 km.',
            difficulty: 'EASY',
          },
          {
            id: 'q1_dup',
            type: 'MULTIPLE_CHOICE',
            question: '  chu kỳ thay dầu nhớt khoáng cho xe máy là bao nhiêu km? ',
            choices: ['A. 500 km', 'B. 1.500 - 2.000 km', 'C. 5.000 km', 'D. 10.000 km'],
            correctAnswer: 'B. 1.500 - 2.000 km',
            explanation: 'Bản trùng lặp.',
            difficulty: 'EASY',
          },
          {
            id: 'q_bad',
            type: 'MULTIPLE_CHOICE',
            question: 'Câu hỏi thiếu đáp án hợp lệ?',
            choices: ['A. Chỉ 1 lựa chọn'],
            correctAnswer: 'A. Chỉ 1 lựa chọn',
          },
          {
            id: 'q2',
            type: 'MULTIPLE_CHOICE',
            question: 'Áp suất lốp sau tiêu chuẩn khi chở hai người là bao nhiêu?',
            choices: ['A. 150 kPa', 'B. 200 kPa', 'C. 225 kPa', 'D. 300 kPa'],
            correctAnswer: 'C. 225 kPa',
            explanation: 'Theo mục Bảo dưỡng định kỳ trang 2, áp suất lốp sau là 225 kPa.',
            difficulty: 'MEDIUM',
          },
        ],
      },
      {
        caseId: 'bench_crossword_vn',
        name: 'Ô chữ (CROSSWORD) chuẩn hóa tiếng Việt có dấu sang ASCII in hoa',
        gameType: 'CROSSWORD',
        expectedValidCount: 1,
        fixtureOutput: [
          {
            id: 'q_cw',
            type: 'CROSSWORD',
            question: 'Vật dụng bắt buộc phải đội khi điều khiển xe mô tô (9 chữ cái)?',
            crosswordClue: 'Đội trên đầu để bảo vệ an toàn khi đi xe máy',
            crosswordAnswer: 'Mũ bảo hiểm',
            correctAnswer: 'Mũ bảo hiểm',
            explanation: 'Người điều khiển xe mô tô bắt buộc đội mũ bảo hiểm đạt chuẩn.',
            difficulty: 'EASY',
          },
        ],
      },
      {
        caseId: 'bench_mixed_modes',
        name: 'Chế độ Hỗn hợp (MIXED) kết hợp cả 4 dạng câu hỏi trong cùng một bộ đề',
        gameType: 'MIXED',
        expectedValidCount: 4,
        fixtureOutput: [
          {
            id: 'q_mix_1',
            type: 'MULTIPLE_CHOICE',
            question: 'Tốc độ tối đa của xe máy trên đường khu đông dân cư không có dải phân cách cứng là bao nhiêu?',
            choices: ['A. 40 km/h', 'B. 50 km/h', 'C. 60 km/h', 'D. 70 km/h'],
            correctAnswer: 'B. 50 km/h',
            explanation: 'Trang 1 quy định tốc độ tối đa là 50 km/h.',
            difficulty: 'EASY',
          },
          {
            id: 'q_mix_2',
            type: 'QUICK_BUTTON',
            question: 'Người điều khiển xe gắn máy bắt buộc phải đội mũ bảo hiểm và cài quai đúng quy cách.',
            choices: ['Đúng', 'Sai'],
            correctAnswer: 'Đúng',
            explanation: 'Quy định bắt buộc tại trang 1.',
            difficulty: 'EASY',
          },
          {
            id: 'q_mix_3',
            type: 'FILL_IN_THE_BLANK',
            question: 'Áp suất lốp sau tiêu chuẩn khi chở hai người là _______ kPa.',
            correctAnswer: '225',
            acceptedAlternatives: ['225 kPa'],
            explanation: 'Áp suất lốp sau tiêu chuẩn là 225 kPa.',
            difficulty: 'MEDIUM',
          },
          {
            id: 'q_mix_4',
            type: 'CROSSWORD',
            question: 'Dung dịch bôi trơn động cơ cần thay sau mỗi 1.500 - 2.000 km (7 chữ cái)?',
            crosswordClue: 'Dung dịch bôi trơn động cơ xe máy',
            crosswordAnswer: 'Dầu nhớt',
            correctAnswer: 'Dầu nhớt',
            explanation: 'Dầu nhớt động cơ khoáng thay mỗi 1.500 - 2.000 km.',
            difficulty: 'MEDIUM',
          },
        ],
      },
    ];

    const results: BenchmarkCaseResult[] = [];
    const vietnameseCharRegex = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

    for (const benchCase of cases) {
      const isolatedService = new AiQuestionService({
        generateJson: async () => benchCase.fixtureOutput,
      });

      try {
        const spec = await isolatedService.generateGame(
          [fixtureDoc],
          {
            sourceId: fixtureDoc.sourceId,
            gameType: benchCase.gameType,
            questionCount: benchCase.fixtureOutput.length,
            difficulty: 'MEDIUM',
          },
          { skipObservabilityLog: true }
        );

        const schemaValid = spec.questions.length === benchCase.expectedValidCount;
        const answersValid = spec.questions.every(q => {
          if (q.type === 'CROSSWORD') {
            return /^[A-Z0-9]+$/.test(q.correctAnswer);
          }
          return q.correctAnswer.trim().length > 0;
        });
        const duplicatesFiltered =
          new Set(spec.questions.map(q => q.question.trim().toLowerCase())).size ===
          spec.questions.length;
        const vietnameseLanguage = spec.questions.every(q => vietnameseCharRegex.test(q.question));
        const provenanceAttached = spec.questions.every(
          q => q.sourceReference && q.sourceReference.sourceId === fixtureDoc.sourceId
        );

        const passed =
          schemaValid &&
          answersValid &&
          duplicatesFiltered &&
          vietnameseLanguage &&
          provenanceAttached;

        results.push({
          caseId: benchCase.caseId,
          name: benchCase.name,
          gameType: benchCase.gameType,
          passed,
          validQuestionCount: spec.questions.length,
          expectedValidCount: benchCase.expectedValidCount,
          diagnosticsCount: spec.diagnostics?.length || 0,
          checks: {
            schemaValid,
            answersValid,
            duplicatesFiltered,
            vietnameseLanguage,
            provenanceAttached,
          },
        });
      } catch (err) {
        results.push({
          caseId: benchCase.caseId,
          name: benchCase.name,
          gameType: benchCase.gameType,
          passed: false,
          validQuestionCount: 0,
          expectedValidCount: benchCase.expectedValidCount,
          diagnosticsCount: 0,
          checks: {
            schemaValid: false,
            answersValid: false,
            duplicatesFiltered: false,
            vietnameseLanguage: false,
            provenanceAttached: false,
          },
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const passedCases = results.filter(r => r.passed).length;
    return {
      allPassed: passedCases === results.length,
      totalCases: results.length,
      passedCases,
      results,
      executedAt: new Date().toISOString(),
    };
  }
}

export const aiObservabilityService = new AiObservabilityService();

