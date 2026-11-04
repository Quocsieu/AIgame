import crypto from 'node:crypto';
import {
  AI_MODEL_PRICING_CATALOG,
  AiBillingMode,
  AiExchangeRateConfig,
  AiModelPricingRule,
  AiPricingStatus,
  AiTaskType,
  calculateAiCallCost,
  getConfiguredBillingMode,
  getExchangeRateConfig,
} from '../config/ai-pricing.config.js';
import { LIMITS } from '../config/limits.js';
import { CanonicalDocument } from '../contracts/canonical.contract.js';
import { CreatableGameType, Difficulty, GameType } from '../contracts/game.contract.js';
import { getDatabase, resolveDefaultDatabasePath } from '../storage/sqlite.db.js';
import { AiQuestionService } from './ai.question.service.js';

export interface AiProviderUsageMetadata {
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens?: number | null;
  thinkingTokens?: number | null;
  totalTokens: number | null;
  usageReportedByProvider: boolean;
}

export interface RecordAiCallInput {
  requestId?: string | null;
  generationId?: string | null;
  userId?: string | null;
  gameId?: string | null;
  gameTitleSnapshot?: string | null;
  assetSlot?: string | null;
  provider: string;
  model: string;
  operation: string;
  taskType?: AiTaskType | string | null;
  sourceType?: 'URL' | 'FILE' | 'TOPIC' | 'MIXED' | string | null;
  status: 'SUCCESS' | 'FAILED';
  errorCode?: string | null;
  latencyMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  thinkingTokens?: number | null;
  totalTokens?: number | null;
  usageIsEstimated?: boolean;
  billingMode?: AiBillingMode | string | null;
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
    gameId: string | null;
    assetSlot: string | null;
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

export interface AdminAiCostReportFilters {
  from?: string;
  to?: string;
  preset?: 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'THIS_MONTH' | 'ALL' | 'CUSTOM';
  model?: string;
  gameType?: string;
  taskType?: string;
  questionCount?: number | string | null;
  requestedQuestions?: number | string | null;
  status?: string | null;
}

export interface AdminAiCostApiLogItem {
  requestId: string;
  logId: string;
  generationId: string | null;
  gameId: string | null;
  gameTitle: string | null;
  gameType: string | null;
  userId: string | null;
  createdAt: string;
  provider: string;
  model: string;
  operation: string;
  taskType: string;
  sourceType: string | null;
  assetSlot: string | null;
  status: string;
  errorCode: string | null;
  latencyMs: number;
  requestedQuestions: number;
  generatedQuestions: number;
  validQuestions: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  thinkingTokens: number | null;
  totalTokens: number | null;
  billingMode: AiBillingMode;
  pricingVersion: string;
  pricingStatus: AiPricingStatus;
  inputPricePer1MUsd: number | null;
  outputPricePer1MUsd: number | null;
  cachedPricePer1MUsd: number | null;
  imagePriceUsd: number | null;
  exchangeRateUsdVnd: number;
  inputCostUsd: number | null;
  outputCostUsd: number | null;
  inputCostVnd: number | null;
  outputCostVnd: number | null;
  actualCostUsd: number | null;
  actualCostVnd: number | null;
  paidEquivalentCostUsd: number | null;
  paidEquivalentCostVnd: number | null;
  dataNote: string | null;
}

export interface AdminAiCostGameItem {
  generationKey: string;
  generationId: string | null;
  gameId: string | null;
  gameTitle: string;
  gameType: string;
  createdAt: string;
  modelsUsed: string[];
  requestedQuestions: number;
  generatedQuestions: number;
  requestCount: number;
  successCount: number;
  failedCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  thinkingTokens: number | null;
  totalTokens: number | null;
  inputCostUsd: number | null;
  outputCostUsd: number | null;
  inputCostVnd: number | null;
  outputCostVnd: number | null;
  actualCostUsd: number | null;
  actualCostVnd: number | null;
  paidEquivalentCostUsd: number | null;
  paidEquivalentCostVnd: number | null;
  status: 'SUCCESS' | 'PARTIAL' | 'PARTIAL_FAILURE' | 'FAILED' | 'USAGE_UNAVAILABLE' | 'PRICE_UNAVAILABLE';
  hasUnknownUsage: boolean;
  hasPriceUnavailable: boolean;
  isSavedInLibrary: boolean;
  requests: AdminAiCostApiLogItem[];
}

export interface AdminAiCostModelBreakdownItem {
  provider: string;
  model: string;
  requestCount: number;
  successCount: number;
  failedCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  actualCostUsd: number;
  actualCostVnd: number;
  paidEquivalentCostUsd: number;
  paidEquivalentCostVnd: number;
  shareOfPaidCostPercent: number;
  pricingStatus: string;
}

export interface AdminAiCostScalingProjectionItem {
  scaleGenerations: number;
  label: string;
  basisEligibleGenerations: number;
  avgTokensPerGeneration: number | null;
  projectedTotalTokens: number | null;
  avgActualCostPerGameUsd: number | null;
  avgActualCostPerGameVnd: number | null;
  projectedActualCostUsd: number | null;
  projectedActualCostVnd: number | null;
  avgPaidEquivalentCostPerGameUsd: number | null;
  avgPaidEquivalentCostPerGameVnd: number | null;
  projectedPaidEquivalentCostUsd: number | null;
  projectedPaidEquivalentCostVnd: number | null;
  formulaNote: string;
}

export interface AdminAiCostReport {
  generatedAt: string;
  filtersApplied: {
    preset: string;
    from: string | null;
    to: string | null;
    model: string | null;
    gameType: string | null;
    taskType: string | null;
    questionCount?: number | null;
    status?: string | null;
  };
  billingModeConfigured: AiBillingMode;
  exchangeRate: AiExchangeRateConfig;
  persistenceStatus: {
    databasePath: string;
    isEphemeralWarning: boolean;
    warningMessage: string | null;
  };
  summary: {
    totalGameGenerations: number;
    eligibleGenerationsForAverage: number;
    totalAiRequests: number;
    successfulRequests: number;
    failedRequests: number;
    requestsWithReportedTokens: number;
    requestsWithUnknownUsage: number;
    requestsWithPriceUnavailable: number;
    requestsWithUnknownBilling: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    thinkingTokens: number;
    totalTokens: number;
    actualCostUsd: number;
    actualCostVnd: number;
    paidEquivalentCostUsd: number;
    paidEquivalentCostVnd: number;
    avgTokensPerGame: number | null;
    avgActualCostPerGameUsd: number | null;
    avgActualCostPerGameVnd: number | null;
    avgPaidEquivalentCostPerGameUsd: number | null;
    avgPaidEquivalentCostPerGameVnd: number | null;
    highestCostModel: string | null;
  };
  scalingProjections: AdminAiCostScalingProjectionItem[];
  byModel: AdminAiCostModelBreakdownItem[];
  byGame: AdminAiCostGameItem[];
  apiLogs: AdminAiCostApiLogItem[];
  pricingCatalog: AiModelPricingRule[];
}

export class AiObservabilityService {
  /**
   * Computes estimated cost ONLY when actual token counts are reported AND pricing is configured.
   */
  public computeEstimatedCostUsd(
    inputTokens: number | null | undefined,
    outputTokens: number | null | undefined,
    model?: string,
    provider = 'gemini',
    cachedTokens?: number | null,
    thinkingTokens?: number | null
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
      if (!model) {
        return null;
      }
    } else if (!model || model === 'gemini-2.5-flash') {
      const cost = (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate;
      return Math.round(cost * 1_000_000) / 1_000_000;
    }

    const calc = calculateAiCallCost({
      provider,
      model: model || 'gemini-2.5-flash',
      status: 'SUCCESS',
      inputTokens,
      outputTokens,
      cachedTokens: cachedTokens ?? null,
      thinkingTokens: thinkingTokens ?? null,
    });
    return calc.paidEquivalentCostUsd !== null
      ? Math.round(calc.paidEquivalentCostUsd * 1_000_000) / 1_000_000
      : null;
  }

  /**
   * Infers standard task_type from operation/assetSlot when not explicitly provided.
   */
  public inferTaskType(operation: string, assetSlot?: string | null, gameType?: string | null): AiTaskType {
    const op = String(operation || '').toUpperCase();
    const slot = String(assetSlot || '').toLowerCase();
    if (op.includes('SUPPLEMENTAL') || op.includes('RETRY')) {
      return 'QUESTION_SUPPLEMENTAL_RETRY';
    }
    if (op.includes('IMAGE') || slot) {
      if (slot === 'cover' || op.includes('COVER')) {
        return 'COVER_IMAGE_GENERATION';
      }
      return 'ADVENTURE_SPRITE_GENERATION';
    }
    if (op.includes('CONTENT') || op.includes('ANALY')) {
      return 'CONTENT_ANALYSIS';
    }
    if (String(gameType || '').toUpperCase() === 'ADVENTURE' && op.includes('ADVENTURE')) {
      return 'ADVENTURE_DESIGN';
    }
    if (op.includes('GENERATE')) {
      return 'QUESTION_GENERATION';
    }
    return 'OTHER';
  }

  /**
   * Records an AI generation call in SQLite without logging raw prompts, source files, or secrets.
   * Wrapped in defensive error handling so logging failure never breaks game generation.
   */
  public recordAiCall(input: RecordAiCallInput): string {
    const logId = input.requestId && String(input.requestId).trim()
      ? String(input.requestId).trim()
      : `ailog_${crypto.randomUUID()}`;
    try {
      const db = getDatabase();
      const nowIso = new Date().toISOString();

      const hasInput = typeof input.inputTokens === 'number' && Number.isFinite(input.inputTokens);
      const hasOutput = typeof input.outputTokens === 'number' && Number.isFinite(input.outputTokens);
      const hasCached = typeof input.cachedTokens === 'number' && Number.isFinite(input.cachedTokens);
      const hasThinking = typeof input.thinkingTokens === 'number' && Number.isFinite(input.thinkingTokens);

      const inputTokens = hasInput ? Math.max(0, Math.floor(input.inputTokens!)) : null;
      const outputTokens = hasOutput ? Math.max(0, Math.floor(input.outputTokens!)) : null;
      const cachedTokens = hasCached ? Math.max(0, Math.floor(input.cachedTokens!)) : null;
      const thinkingTokens = hasThinking ? Math.max(0, Math.floor(input.thinkingTokens!)) : null;

      const taskType = (input.taskType as AiTaskType) || this.inferTaskType(input.operation, input.assetSlot, input.gameType);

      const costCalc = calculateAiCallCost({
        provider: input.provider,
        model: input.model,
        status: input.status,
        taskType,
        inputTokens,
        outputTokens,
        cachedTokens,
        thinkingTokens,
        totalTokens:
          typeof input.totalTokens === 'number' && Number.isFinite(input.totalTokens)
            ? Math.max(0, Math.floor(input.totalTokens))
            : null,
        billingMode: input.billingMode,
      });

      const totalTokens = costCalc.totalTokens;
      const estimatedCostUsd = this.computeEstimatedCostUsd(
        inputTokens,
        outputTokens,
        input.model,
        input.provider,
        cachedTokens,
        thinkingTokens
      );

      db.prepare(
        `INSERT INTO ai_usage_logs (
          log_id, request_id, generation_id, user_id, game_id, game_title_snapshot, asset_slot,
          provider, model, operation, task_type, source_type, status, error_code,
          latency_ms, input_tokens, output_tokens, cached_tokens, thinking_tokens, total_tokens,
          usage_is_estimated, estimated_cost_usd,
          billing_mode, pricing_version, pricing_status,
          cost_usd, cost_vnd, paid_equivalent_cost_usd, paid_equivalent_cost_vnd,
          exchange_rate_usd_vnd, input_price_per_1m_usd, output_price_per_1m_usd,
          cached_price_per_1m_usd, image_price_usd, data_note,
          requested_questions, generated_questions, valid_questions,
          rejected_questions, duplicate_questions, diagnostics_count, game_type,
          difficulty, source_count, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?
        )`
      ).run(
        logId,
        logId,
        input.generationId ?? null,
        input.userId ?? null,
        input.gameId ?? null,
        input.gameTitleSnapshot ?? null,
        input.assetSlot ?? null,
        input.provider,
        input.model,
        input.operation,
        taskType,
        input.sourceType ?? null,
        input.status,
        input.errorCode ?? null,
        Math.max(0, Math.round(input.latencyMs)),
        costCalc.inputTokens,
        costCalc.outputTokens,
        costCalc.cachedTokens,
        costCalc.thinkingTokens,
        totalTokens,
        input.usageIsEstimated ? 1 : 0,
        estimatedCostUsd,
        costCalc.billingMode,
        costCalc.pricingVersion,
        costCalc.pricingStatus,
        costCalc.actualCostUsd,
        costCalc.actualCostVnd,
        costCalc.paidEquivalentCostUsd,
        costCalc.paidEquivalentCostVnd,
        costCalc.exchangeRateUsdVnd,
        costCalc.inputPricePer1MUsd,
        costCalc.outputPricePer1MUsd,
        costCalc.cachedPricePer1MUsd,
        costCalc.imagePriceUsd,
        costCalc.dataNote,
        input.requestedQuestions ?? 0,
        input.generatedQuestions ?? (input.validQuestions ?? 0),
        input.validQuestions ?? (input.status === 'SUCCESS' ? (input.generatedQuestions ?? 0) : 0),
        input.rejectedQuestions ?? 0,
        input.duplicateQuestions ?? 0,
        input.diagnosticsCount ?? 0,
        input.gameType ?? null,
        input.difficulty ?? null,
        input.sourceCount ?? 0,
        nowIso
      );
    } catch (err) {
      // Never allow observability logging failure to crash game generation
      console.error('[AiObservabilityService.recordAiCall] Non-fatal logging error:', err);
    }

    return logId;
  }

  /**
   * Links all AI logs sharing a `generationId` to the final `gameId` and `gameTitle` once created.
   */
  public linkGenerationLogsToGame(generationId: string, gameId: string, gameTitle?: string | null): void {
    if (!generationId || !gameId) return;
    try {
      const db = getDatabase();
      if (gameTitle && gameTitle.trim()) {
        db.prepare(
          `UPDATE ai_usage_logs
           SET game_id = COALESCE(game_id, ?),
               game_title_snapshot = COALESCE(game_title_snapshot, ?)
           WHERE generation_id = ?`
        ).run(gameId, gameTitle.trim(), generationId);
      } else {
        db.prepare(
          `UPDATE ai_usage_logs
           SET game_id = COALESCE(game_id, ?)
           WHERE generation_id = ?`
        ).run(gameId, generationId);
      }
    } catch (err) {
      console.error('[AiObservabilityService.linkGenerationLogsToGame] Non-fatal error:', err);
    }
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
        gameId: r.game_id ? String(r.game_id) : null,
        assetSlot: r.asset_slot ? String(r.asset_slot) : null,
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
   * Resolves date bounds from preset or explicit `from`/`to` ISO strings.
   */
  public resolveDateBounds(filters: AdminAiCostReportFilters = {}): {
    preset: string;
    from: string | null;
    to: string | null;
  } {
    const preset = (filters.preset || 'ALL').toUpperCase();
    const now = new Date();

    if (filters.from || filters.to) {
      let fromIso = filters.from ? String(filters.from).trim() : null;
      let toIso = filters.to ? String(filters.to).trim() : null;
      if (fromIso && /^\d{4}-\d{2}-\d{2}$/.test(fromIso)) {
        fromIso = `${fromIso}T00:00:00.000Z`;
      }
      if (toIso && /^\d{4}-\d{2}-\d{2}$/.test(toIso)) {
        toIso = `${toIso}T23:59:59.999Z`;
      }
      return { preset: filters.preset || 'CUSTOM', from: fromIso, to: toIso };
    }

    if (preset === 'TODAY') {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
      return { preset: 'TODAY', from: start.toISOString(), to: now.toISOString() };
    }
    if (preset === 'LAST_7_DAYS') {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { preset: 'LAST_7_DAYS', from: start.toISOString(), to: now.toISOString() };
    }
    if (preset === 'LAST_30_DAYS') {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { preset: 'LAST_30_DAYS', from: start.toISOString(), to: now.toISOString() };
    }
    if (preset === 'THIS_MONTH') {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
      return { preset: 'THIS_MONTH', from: start.toISOString(), to: now.toISOString() };
    }

    return { preset: 'ALL', from: null, to: null };
  }

  /**
   * Builds the comprehensive Admin AI Token & Cost Report (used by both Admin UI and Excel Export).
   */
  public getAdminAiCostReport(filters: AdminAiCostReportFilters = {}): AdminAiCostReport {
    const db = getDatabase();
    const dateBounds = this.resolveDateBounds(filters);
    const conditions: string[] = [];
    const params: any[] = [];

    if (dateBounds.from) {
      conditions.push('l.created_at >= ?');
      params.push(dateBounds.from);
    }
    if (dateBounds.to) {
      conditions.push('l.created_at <= ?');
      params.push(dateBounds.to);
    }
    if (filters.model && filters.model.trim() && filters.model.trim().toUpperCase() !== 'ALL') {
      conditions.push('LOWER(l.model) = LOWER(?)');
      params.push(filters.model.trim());
    }
    if (filters.gameType && filters.gameType.trim() && filters.gameType.trim().toUpperCase() !== 'ALL') {
      conditions.push('UPPER(COALESCE(l.game_type, g.game_type, \'\')) = UPPER(?)');
      params.push(filters.gameType.trim());
    }
    if (filters.taskType && filters.taskType.trim() && filters.taskType.trim().toUpperCase() !== 'ALL') {
      conditions.push('UPPER(COALESCE(l.task_type, \'\')) = UPPER(?)');
      params.push(filters.taskType.trim());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rawRows = db
      .prepare(
        `SELECT
          l.rowid AS log_rowid,
          l.*,
          g.title AS joined_game_title,
          g.game_type AS joined_game_type,
          (SELECT COUNT(*) FROM game_questions gq WHERE gq.game_id = l.game_id) AS joined_game_question_count,
          CASE WHEN g.game_id IS NOT NULL THEN 1 ELSE 0 END AS is_saved_in_library
        FROM ai_usage_logs l
        LEFT JOIN games g ON g.game_id = l.game_id
        ${whereClause}
        ORDER BY l.created_at DESC, l.rowid DESC`
      )
      .all(...params) as Record<string, any>[];

    const exchange = getExchangeRateConfig();
    const configuredBillingMode = getConfiguredBillingMode();

    const allApiLogs: AdminAiCostApiLogItem[] = rawRows.map((row) => {
      const logId = String(row.log_id);
      const requestId = row.request_id ? String(row.request_id) : logId;
      const provider = String(row.provider || 'gemini');
      const model = String(row.model || 'unknown');
      const operation = String(row.operation || 'GENERATE');
      const assetSlot = row.asset_slot ? String(row.asset_slot) : null;
      const gameType = row.game_type
        ? String(row.game_type)
        : row.joined_game_type
          ? String(row.joined_game_type)
          : null;
      const taskType = row.task_type
        ? String(row.task_type)
        : this.inferTaskType(operation, assetSlot, gameType);
      const status = String(row.status || 'SUCCESS');
      const requestedQuestions = Number(row.requested_questions || 0);
      const generatedQuestions = Number(row.generated_questions || 0);
      const validQuestions = Number(row.valid_questions || 0);

      const rawIn = row.input_tokens !== null && row.input_tokens !== undefined ? Number(row.input_tokens) : null;
      const rawOut = row.output_tokens !== null && row.output_tokens !== undefined ? Number(row.output_tokens) : null;
      const rawCached = row.cached_tokens !== null && row.cached_tokens !== undefined ? Number(row.cached_tokens) : null;
      const rawThinking = row.thinking_tokens !== null && row.thinking_tokens !== undefined ? Number(row.thinking_tokens) : null;
      const rawTotal = row.total_tokens !== null && row.total_tokens !== undefined ? Number(row.total_tokens) : null;

      // Compute dynamic catalog calculation for legacy rows or rows whose model alias was added to the catalog
      const hasM9Pricing =
        row.pricing_status !== null &&
        row.pricing_status !== undefined &&
        String(row.pricing_status) !== 'PRICE_UNAVAILABLE';
      const fallbackCalc = calculateAiCallCost({
        provider,
        model,
        status,
        taskType,
        inputTokens: rawIn,
        outputTokens: rawOut,
        cachedTokens: rawCached,
        thinkingTokens: rawThinking,
        totalTokens: rawTotal,
        billingMode: row.billing_mode ? String(row.billing_mode) : configuredBillingMode,
      });

      const billingMode: AiBillingMode = row.billing_mode
        ? (String(row.billing_mode) as AiBillingMode)
        : fallbackCalc.billingMode || configuredBillingMode;
      const pricingVersion =
        hasM9Pricing && row.pricing_version
          ? String(row.pricing_version)
          : fallbackCalc.pricingVersion || 'LEGACY';
      const pricingStatus: AiPricingStatus =
        hasM9Pricing && row.pricing_status
          ? (String(row.pricing_status) as AiPricingStatus)
          : fallbackCalc.pricingStatus || 'OK';

      const resolvedInputPricePer1MUsd =
        row.input_price_per_1m_usd !== null && row.input_price_per_1m_usd !== undefined
          ? Number(row.input_price_per_1m_usd)
          : fallbackCalc.inputPricePer1MUsd ?? null;
      const resolvedOutputPricePer1MUsd =
        row.output_price_per_1m_usd !== null && row.output_price_per_1m_usd !== undefined
          ? Number(row.output_price_per_1m_usd)
          : fallbackCalc.outputPricePer1MUsd ?? null;
      const resolvedCachedPricePer1MUsd =
        row.cached_price_per_1m_usd !== null && row.cached_price_per_1m_usd !== undefined
          ? Number(row.cached_price_per_1m_usd)
          : fallbackCalc.cachedPricePer1MUsd ?? null;
      const resolvedImagePriceUsd =
        row.image_price_usd !== null && row.image_price_usd !== undefined
          ? Number(row.image_price_usd)
          : fallbackCalc.imagePriceUsd ?? null;
      const resolvedExchangeRateUsdVnd =
        row.exchange_rate_usd_vnd !== null && row.exchange_rate_usd_vnd !== undefined
          ? Number(row.exchange_rate_usd_vnd)
          : exchange.usdToVndRate;

      let reqInputCostUsd: number | null = fallbackCalc.inputCostUsd;
      let reqOutputCostUsd: number | null = fallbackCalc.outputCostUsd;
      let reqInputCostVnd: number | null = fallbackCalc.inputCostVnd;
      let reqOutputCostVnd: number | null = fallbackCalc.outputCostVnd;

      if (
        rawIn !== null &&
        rawOut !== null &&
        resolvedInputPricePer1MUsd !== null &&
        resolvedOutputPricePer1MUsd !== null &&
        pricingStatus !== 'PRICE_UNAVAILABLE'
      ) {
        const safeIn = Math.max(0, Math.round(rawIn));
        const safeOut = Math.max(0, Math.round(rawOut));
        const safeCached =
          rawCached !== null && Number.isFinite(rawCached) ? Math.max(0, Math.round(rawCached)) : 0;
        const safeThinking =
          rawThinking !== null && Number.isFinite(rawThinking)
            ? Math.max(0, Math.round(rawThinking))
            : 0;
        const effectiveCached = Math.min(safeIn, safeCached);
        const nonCachedInput = Math.max(0, safeIn - effectiveCached);
        const cachedRate =
          resolvedCachedPricePer1MUsd !== null
            ? resolvedCachedPricePer1MUsd
            : resolvedInputPricePer1MUsd * 0.25;
        const thinkingAlreadyInOutput =
          safeThinking > 0 &&
          rawTotal !== null &&
          Number.isFinite(rawTotal) &&
          Math.round(rawTotal) <= safeIn + safeOut;
        const billableOutput = thinkingAlreadyInOutput ? safeOut : safeOut + safeThinking;

        reqInputCostUsd = Number(
          (
            (nonCachedInput / 1_000_000) * resolvedInputPricePer1MUsd +
            (effectiveCached / 1_000_000) * cachedRate
          ).toFixed(8)
        );
        reqOutputCostUsd = Number(
          ((billableOutput / 1_000_000) * resolvedOutputPricePer1MUsd).toFixed(8)
        );
        reqInputCostVnd = Math.round(reqInputCostUsd * resolvedExchangeRateUsdVnd);
        reqOutputCostVnd = Math.round(reqOutputCostUsd * resolvedExchangeRateUsdVnd);
      }

      const actualCostUsd =
        row.cost_usd !== null && row.cost_usd !== undefined
          ? Number(row.cost_usd)
          : fallbackCalc.actualCostUsd;
      const actualCostVnd =
        row.cost_vnd !== null && row.cost_vnd !== undefined
          ? Number(row.cost_vnd)
          : fallbackCalc.actualCostVnd;
      const paidEquivalentCostUsd =
        row.paid_equivalent_cost_usd !== null && row.paid_equivalent_cost_usd !== undefined
          ? Number(row.paid_equivalent_cost_usd)
          : fallbackCalc.paidEquivalentCostUsd !== null
            ? fallbackCalc.paidEquivalentCostUsd
            : row.estimated_cost_usd !== null && row.estimated_cost_usd !== undefined
              ? Number(row.estimated_cost_usd)
              : null;
      const paidEquivalentCostVnd =
        row.paid_equivalent_cost_vnd !== null && row.paid_equivalent_cost_vnd !== undefined
          ? Number(row.paid_equivalent_cost_vnd)
          : fallbackCalc.paidEquivalentCostVnd !== null
            ? fallbackCalc.paidEquivalentCostVnd
            : paidEquivalentCostUsd !== null
              ? Math.round(paidEquivalentCostUsd * resolvedExchangeRateUsdVnd)
              : null;

      const gameTitle = row.joined_game_title
        ? String(row.joined_game_title)
        : row.game_title_snapshot
          ? String(row.game_title_snapshot)
          : null;

      return {
        requestId,
        logId,
        generationId: row.generation_id ? String(row.generation_id) : null,
        gameId: row.game_id ? String(row.game_id) : null,
        gameTitle,
        gameType,
        userId: row.user_id ? String(row.user_id) : null,
        createdAt: String(row.created_at),
        provider,
        model,
        operation,
        taskType,
        sourceType: row.source_type ? String(row.source_type) : null,
        assetSlot,
        status,
        errorCode: row.error_code ? String(row.error_code) : null,
        latencyMs: Number(row.latency_ms || 0),
        requestedQuestions,
        generatedQuestions,
        validQuestions,
        inputTokens: rawIn,
        outputTokens: rawOut,
        cachedTokens: rawCached,
        thinkingTokens: rawThinking,
        totalTokens: fallbackCalc.totalTokens ?? rawTotal,
        billingMode,
        pricingVersion,
        pricingStatus,
        inputPricePer1MUsd: resolvedInputPricePer1MUsd,
        outputPricePer1MUsd: resolvedOutputPricePer1MUsd,
        cachedPricePer1MUsd: resolvedCachedPricePer1MUsd,
        imagePriceUsd: resolvedImagePriceUsd,
        exchangeRateUsdVnd: resolvedExchangeRateUsdVnd,
        inputCostUsd: reqInputCostUsd,
        outputCostUsd: reqOutputCostUsd,
        inputCostVnd: reqInputCostVnd,
        outputCostVnd: reqOutputCostVnd,
        actualCostUsd,
        actualCostVnd,
        paidEquivalentCostUsd,
        paidEquivalentCostVnd,
        dataNote: row.data_note ? String(row.data_note) : fallbackCalc.dataNote ?? null,
      };
    });

    // Aggregate per Game / Generation
    const gameGroups = new Map<
      string,
      {
        generationKey: string;
        generationId: string | null;
        gameId: string | null;
        gameTitle: string;
        gameType: string;
        createdAt: string;
        modelsSet: Set<string>;
        requests: AdminAiCostApiLogItem[];
        rowIds: number[];
        joinedQuestionCount: number;
        isSavedInLibrary: boolean;
      }
    >();

    rawRows.forEach((rawRow, idx) => {
      const item = allApiLogs[idx];
      const rowId = Number(rawRow.log_rowid || 0);
      const joinedQCount = Number(rawRow.joined_game_question_count || 0);
      // Group by gameId if present, else by generationId if present, else by logId
      const key = item.gameId
        ? `game:${item.gameId}`
        : item.generationId
          ? `gen:${item.generationId}`
          : `req:${item.logId}`;

      const existing = gameGroups.get(key);
      if (!existing) {
        const fallbackTitle = item.gameTitle
          ? item.gameTitle
          : item.gameId
            ? `Game ${item.gameId}`
            : item.generationId
              ? `Lượt tạo AI (${item.generationId.slice(0, 14)})`
              : `Tác vụ AI lẻ (${item.logId.slice(0, 12)})`;
        gameGroups.set(key, {
          generationKey: key,
          generationId: item.generationId,
          gameId: item.gameId,
          gameTitle: fallbackTitle,
          gameType: item.gameType || 'UNKNOWN',
          createdAt: item.createdAt,
          modelsSet: new Set([item.model]),
          requests: [item],
          rowIds: [rowId],
          joinedQuestionCount: joinedQCount,
          isSavedInLibrary: Boolean(rawRow.is_saved_in_library),
        });
      } else {
        existing.modelsSet.add(item.model);
        existing.requests.push(item);
        existing.rowIds.push(rowId);
        if (joinedQCount > existing.joinedQuestionCount) {
          existing.joinedQuestionCount = joinedQCount;
        }
        if (item.gameId && !existing.gameId) existing.gameId = item.gameId;
        if (item.generationId && !existing.generationId) existing.generationId = item.generationId;
        if (item.gameTitle && existing.gameTitle.startsWith('Lượt tạo AI')) {
          existing.gameTitle = item.gameTitle;
        }
        if (item.gameType && existing.gameType === 'UNKNOWN') {
          existing.gameType = item.gameType;
        }
        if (rawRow.is_saved_in_library) {
          existing.isSavedInLibrary = true;
        }
        if (item.createdAt > existing.createdAt) {
          existing.createdAt = item.createdAt;
        }
      }
    });

    const allByGame: AdminAiCostGameItem[] = Array.from(gameGroups.values()).map((grp) => {
      let reqCount = grp.requests.length;
      let successCount = 0;
      let failedCount = 0;
      let sumIn = 0;
      let sumOut = 0;
      let sumCached = 0;
      let sumThinking = 0;
      let sumTotal = 0;
      let hasAnyTokens = false;
      let hasTokenCost = false;
      let sumInputCostUsd = 0;
      let sumOutputCostUsd = 0;
      let sumInputCostVndExact = 0;
      let sumOutputCostVndExact = 0;
      let sumOtherCostVndExact = 0;
      let hasUnknownUsage = false;
      let hasPriceUnavailable = false;
      let sumActualUsd = 0;
      let sumActualVnd = 0;
      let hasActualCost = false;
      let sumPaidUsd = 0;
      let sumPaidVnd = 0;
      let hasPaidCost = false;

      // Determine requestedQuestions and generatedQuestions (actual valid questions) for this game creation run
      const indexedReqs = grp.requests.map((r, i) => ({ req: r, rowId: grp.rowIds[i] || 0 }));
      const primaryQuestionReqs = indexedReqs.filter(
        ({ req }) =>
          req.operation === 'GENERATE_QUESTIONS' ||
          (req.taskType === 'QUESTION_GENERATION' && !req.operation.includes('SUPPLEMENTAL'))
      );
      const suppQuestionReqs = indexedReqs.filter(
        ({ req }) =>
          req.operation.includes('SUPPLEMENTAL') || req.taskType === 'QUESTION_SUPPLEMENTAL_RETRY'
      );

      let gameRequestedQuestions = 0;
      if (primaryQuestionReqs.length > 0) {
        gameRequestedQuestions = Math.max(0, ...primaryQuestionReqs.map(({ req }) => req.requestedQuestions));
      } else {
        gameRequestedQuestions = Math.max(0, ...grp.requests.map((r) => r.requestedQuestions));
      }
      if (gameRequestedQuestions === 0 && grp.joinedQuestionCount > 0) {
        gameRequestedQuestions = grp.joinedQuestionCount;
      }

      let gameGeneratedQuestions = 0;
      if (primaryQuestionReqs.length > 0 && suppQuestionReqs.length > 0) {
        const maxPrimaryRowId = Math.max(...primaryQuestionReqs.map((x) => x.rowId));
        const maxSuppRowId = Math.max(...suppQuestionReqs.map((x) => x.rowId));
        if (maxPrimaryRowId > maxSuppRowId) {
          // Recorded via AiQuestionService.generateGame where primary GENERATE_QUESTIONS is logged last with total validQuestions
          const latestPrimary = primaryQuestionReqs.reduce((a, b) => (a.rowId >= b.rowId ? a : b)).req;
          gameGeneratedQuestions = latestPrimary.validQuestions;
        } else {
          // Recorded sequentially (primary first, supplemental second): sum validQuestions across batches
          gameGeneratedQuestions = grp.requests.reduce((acc, r) => acc + r.validQuestions, 0);
        }
      } else if (primaryQuestionReqs.length > 0) {
        gameGeneratedQuestions = Math.max(...primaryQuestionReqs.map(({ req }) => req.validQuestions));
      } else {
        gameGeneratedQuestions = grp.requests.reduce((acc, r) => acc + r.validQuestions, 0);
      }
      if (
        gameGeneratedQuestions === 0 &&
        grp.joinedQuestionCount > 0 &&
        grp.requests.some((r) => r.status === 'SUCCESS')
      ) {
        gameGeneratedQuestions = grp.joinedQuestionCount;
      }

      for (const r of grp.requests) {
        if (r.status === 'SUCCESS') successCount++;
        else failedCount++;

        const rate =
          r.exchangeRateUsdVnd && Number.isFinite(r.exchangeRateUsdVnd) && r.exchangeRateUsdVnd > 0
            ? r.exchangeRateUsdVnd
            : exchange.usdToVndRate;

        if (r.inputTokens !== null && r.outputTokens !== null) {
          hasAnyTokens = true;
          sumIn += r.inputTokens;
          sumOut += r.outputTokens;
          sumCached += r.cachedTokens || 0;
          sumThinking += r.thinkingTokens || 0;
          sumTotal +=
            r.totalTokens !== null
              ? r.totalTokens
              : r.inputTokens + r.outputTokens + (r.thinkingTokens || 0);

          if (r.pricingStatus === 'PRICE_UNAVAILABLE') {
            hasPriceUnavailable = true;
          } else if (r.inputCostUsd !== null && r.outputCostUsd !== null) {
            hasTokenCost = true;
            sumInputCostUsd += r.inputCostUsd;
            sumOutputCostUsd += r.outputCostUsd;
            sumInputCostVndExact += r.inputCostUsd * rate;
            sumOutputCostVndExact += r.outputCostUsd * rate;

            if (r.paidEquivalentCostUsd !== null) {
              const extraUsd = Math.max(
                0,
                Number((r.paidEquivalentCostUsd - (r.inputCostUsd + r.outputCostUsd)).toFixed(8))
              );
              if (extraUsd > 0) {
                sumOtherCostVndExact += extraUsd * rate;
              }
            }
          } else {
            hasPriceUnavailable = true;
          }
        } else {
          // Request has no token counts (e.g., flat-rate image call, missing usageMetadata on success, or failed call)
          if (r.pricingStatus === 'OK' && r.paidEquivalentCostUsd !== null) {
            sumOtherCostVndExact += r.paidEquivalentCostUsd * rate;
          } else if (r.status === 'SUCCESS') {
            if (r.pricingStatus === 'PRICE_UNAVAILABLE') {
              hasPriceUnavailable = true;
            } else if (r.pricingStatus === 'USAGE_UNAVAILABLE') {
              hasUnknownUsage = true;
            }
          }
        }

        if (r.actualCostUsd !== null && r.actualCostVnd !== null) {
          hasActualCost = true;
          sumActualUsd += r.actualCostUsd;
          sumActualVnd += r.actualCostVnd;
        }
        if (r.paidEquivalentCostUsd !== null && r.paidEquivalentCostVnd !== null) {
          hasPaidCost = true;
          sumPaidUsd += r.paidEquivalentCostUsd;
          sumPaidVnd += r.paidEquivalentCostVnd;
        }
      }

      // If every request in the group lacked usage or price and no tokens/costs were recorded
      if (!hasAnyTokens && !hasPaidCost) {
        if (grp.requests.some((r) => r.pricingStatus === 'PRICE_UNAVAILABLE')) {
          hasPriceUnavailable = true;
        }
        if (grp.requests.some((r) => r.pricingStatus === 'USAGE_UNAVAILABLE')) {
          hasUnknownUsage = true;
        }
      }

      const allPrimaryFailed =
        primaryQuestionReqs.length > 0 &&
        primaryQuestionReqs.every(({ req }) => req.status === 'FAILED') &&
        !grp.isSavedInLibrary;

      let status: AdminAiCostGameItem['status'] = 'SUCCESS';
      if (failedCount === reqCount || allPrimaryFailed) {
        status = 'FAILED';
      } else if (
        failedCount > 0 ||
        (gameRequestedQuestions > 0 &&
          gameGeneratedQuestions > 0 &&
          gameGeneratedQuestions < gameRequestedQuestions)
      ) {
        status = 'PARTIAL';
      }

      const gameInputCostUsd =
        hasTokenCost && !hasPriceUnavailable && !hasUnknownUsage
          ? Number(sumInputCostUsd.toFixed(8))
          : null;
      const gameOutputCostUsd =
        hasTokenCost && !hasPriceUnavailable && !hasUnknownUsage
          ? Number(sumOutputCostUsd.toFixed(8))
          : null;
      const gameInputCostVnd =
        gameInputCostUsd !== null ? Math.round(sumInputCostVndExact) : null;
      const gameOutputCostVnd =
        gameOutputCostUsd !== null ? Math.round(sumOutputCostVndExact) : null;

      const gamePaidCostUsd =
        hasPaidCost && !hasPriceUnavailable && !hasUnknownUsage
          ? Number(sumPaidUsd.toFixed(8))
          : null;
      const gamePaidCostVnd =
        gamePaidCostUsd !== null
          ? Math.round(
              sumInputCostVndExact + sumOutputCostVndExact + sumOtherCostVndExact
            )
          : null;

      const gameActualCostUsd =
        hasActualCost && !hasPriceUnavailable && !hasUnknownUsage
          ? Number(sumActualUsd.toFixed(8))
          : null;
      const gameActualCostVnd =
        gameActualCostUsd !== null
          ? configuredBillingMode === 'FREE' && gameActualCostUsd === 0
            ? 0
            : gamePaidCostVnd !== null && gameActualCostUsd === gamePaidCostUsd
              ? gamePaidCostVnd
              : Math.round(sumActualVnd)
          : null;

      return {
        generationKey: grp.generationKey,
        generationId: grp.generationId,
        gameId: grp.gameId,
        gameTitle: grp.gameTitle,
        gameType: grp.gameType,
        createdAt: grp.createdAt,
        modelsUsed: Array.from(grp.modelsSet),
        requestedQuestions: gameRequestedQuestions,
        generatedQuestions: gameGeneratedQuestions,
        requestCount: reqCount,
        successCount,
        failedCount,
        inputTokens: hasAnyTokens ? sumIn : null,
        outputTokens: hasAnyTokens ? sumOut : null,
        cachedTokens: hasAnyTokens ? sumCached : null,
        thinkingTokens: hasAnyTokens ? sumThinking : null,
        totalTokens: hasAnyTokens ? sumTotal : null,
        inputCostUsd: gameInputCostUsd,
        outputCostUsd: gameOutputCostUsd,
        inputCostVnd: gameInputCostVnd,
        outputCostVnd: gameOutputCostVnd,
        actualCostUsd: gameActualCostUsd,
        actualCostVnd: gameActualCostVnd,
        paidEquivalentCostUsd: gamePaidCostUsd,
        paidEquivalentCostVnd: gamePaidCostVnd,
        status,
        hasUnknownUsage,
        hasPriceUnavailable,
        isSavedInLibrary: grp.isSavedInLibrary,
        requests: grp.requests,
      };
    });

    // Apply optional per-game-creation filters: questionCount (requestedQuestions) and status (SUCCESS / PARTIAL / FAILED)
    const rawQuestionCountFilter =
      filters.questionCount !== undefined && filters.questionCount !== null && String(filters.questionCount).trim() !== ''
        ? Number(filters.questionCount)
        : filters.requestedQuestions !== undefined &&
            filters.requestedQuestions !== null &&
            String(filters.requestedQuestions).trim() !== ''
          ? Number(filters.requestedQuestions)
          : null;
    const targetQuestionCount =
      rawQuestionCountFilter !== null && Number.isFinite(rawQuestionCountFilter) && rawQuestionCountFilter > 0
        ? Math.round(rawQuestionCountFilter)
        : null;

    const rawStatusFilter =
      filters.status && String(filters.status).trim() && String(filters.status).trim().toUpperCase() !== 'ALL'
        ? String(filters.status).trim().toUpperCase()
        : null;

    const hasGameLevelFilter = targetQuestionCount !== null || rawStatusFilter !== null;
    const byGame = hasGameLevelFilter
      ? allByGame.filter((g) => {
          if (targetQuestionCount !== null && g.requestedQuestions !== targetQuestionCount) {
            return false;
          }
          if (rawStatusFilter !== null) {
            if (rawStatusFilter === 'PARTIAL' || rawStatusFilter === 'PARTIAL_FAILURE') {
              if (g.status !== 'PARTIAL' && g.status !== 'PARTIAL_FAILURE') return false;
            } else if (g.status !== rawStatusFilter) {
              return false;
            }
          }
          return true;
        })
      : allByGame;

    const allowedLogIds = hasGameLevelFilter
      ? new Set(byGame.flatMap((g) => g.requests.map((r) => r.logId)))
      : null;
    const apiLogs = allowedLogIds
      ? allApiLogs.filter((r) => allowedLogIds.has(r.logId))
      : allApiLogs;

    // Aggregate by Model
    const modelMap = new Map<string, Omit<AdminAiCostModelBreakdownItem, 'shareOfPaidCostPercent'>>();
    for (const r of apiLogs) {
      const key = `${r.provider}::${r.model}`;
      const existing = modelMap.get(key) || {
        provider: r.provider,
        model: r.model,
        requestCount: 0,
        successCount: 0,
        failedCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        thinkingTokens: 0,
        totalTokens: 0,
        actualCostUsd: 0,
        actualCostVnd: 0,
        paidEquivalentCostUsd: 0,
        paidEquivalentCostVnd: 0,
        pricingStatus: r.pricingStatus === 'PRICE_UNAVAILABLE' ? 'PRICE_UNAVAILABLE' : 'OK',
      };
      existing.requestCount += 1;
      if (r.status === 'SUCCESS') existing.successCount += 1;
      else existing.failedCount += 1;
      existing.inputTokens += r.inputTokens || 0;
      existing.outputTokens += r.outputTokens || 0;
      existing.cachedTokens += r.cachedTokens || 0;
      existing.thinkingTokens += r.thinkingTokens || 0;
      existing.totalTokens += r.totalTokens || 0;
      existing.actualCostUsd = Number((existing.actualCostUsd + (r.actualCostUsd || 0)).toFixed(8));
      existing.actualCostVnd += r.actualCostVnd || 0;
      existing.paidEquivalentCostUsd = Number(
        (existing.paidEquivalentCostUsd + (r.paidEquivalentCostUsd || 0)).toFixed(8)
      );
      existing.paidEquivalentCostVnd += r.paidEquivalentCostVnd || 0;
      if (r.pricingStatus === 'PRICE_UNAVAILABLE') {
        existing.pricingStatus = 'PRICE_UNAVAILABLE';
      }
      modelMap.set(key, existing);
    }

    const totalPaidCostAllModels = Array.from(modelMap.values()).reduce(
      (acc, m) => acc + m.paidEquivalentCostUsd,
      0
    );

    const byModel: AdminAiCostModelBreakdownItem[] = Array.from(modelMap.values())
      .map((m) => ({
        ...m,
        actualCostVnd: Math.round(m.actualCostVnd),
        paidEquivalentCostVnd: Math.round(m.paidEquivalentCostVnd),
        shareOfPaidCostPercent:
          totalPaidCostAllModels > 0
            ? Number(((m.paidEquivalentCostUsd / totalPaidCostAllModels) * 100).toFixed(2))
            : 0,
      }))
      .sort((a, b) => b.paidEquivalentCostUsd - a.paidEquivalentCostUsd || b.totalTokens - a.totalTokens);

    // Compute overall summary KPIs
    let totalIn = 0;
    let totalOut = 0;
    let totalCached = 0;
    let totalThinking = 0;
    let totalTok = 0;
    let totalActualUsd = 0;
    let totalActualVnd = 0;
    let totalPaidUsd = 0;
    let totalPaidVnd = 0;
    let successReq = 0;
    let failedReq = 0;
    let reqWithReportedTokens = 0;
    let reqWithUnknownUsage = 0;
    let reqWithPriceUnavailable = 0;
    let reqWithUnknownBilling = 0;

    for (const r of apiLogs) {
      if (r.status === 'SUCCESS') successReq++;
      else failedReq++;

      if (r.inputTokens !== null && r.outputTokens !== null) {
        reqWithReportedTokens++;
        totalIn += r.inputTokens;
        totalOut += r.outputTokens;
        totalCached += r.cachedTokens || 0;
        totalThinking += r.thinkingTokens || 0;
        totalTok += r.totalTokens || 0;
      } else {
        reqWithUnknownUsage++;
      }

      if (r.pricingStatus === 'PRICE_UNAVAILABLE') {
        reqWithPriceUnavailable++;
      }
      if (r.billingMode === 'UNKNOWN') {
        reqWithUnknownBilling++;
      }

      totalActualUsd += r.actualCostUsd || 0;
      totalActualVnd += r.actualCostVnd || 0;
      totalPaidUsd += r.paidEquivalentCostUsd || 0;
      totalPaidVnd += r.paidEquivalentCostVnd || 0;
    }

    totalActualUsd = Number(totalActualUsd.toFixed(8));
    totalActualVnd = Math.round(totalActualVnd);
    totalPaidUsd = Number(totalPaidUsd.toFixed(8));
    totalPaidVnd = Math.round(totalPaidVnd);

    // Eligible generations for Average Cost Per Game & Scaling Projections:
    // Only include game generations that have valid paidEquivalentCostUsd !== null and !hasPriceUnavailable and !hasUnknownUsage
    const eligibleGames = byGame.filter(
      (g) =>
        g.paidEquivalentCostUsd !== null &&
        !g.hasPriceUnavailable &&
        !g.hasUnknownUsage &&
        g.status !== 'FAILED'
    );
    const eligibleCount = eligibleGames.length;

    const avgTokensPerGame =
      eligibleCount > 0
        ? Math.round(eligibleGames.reduce((acc, g) => acc + (g.totalTokens || 0), 0) / eligibleCount)
        : null;

    const eligibleActualGames = eligibleGames.filter((g) => g.actualCostUsd !== null);
    const avgActualCostPerGameUsd =
      eligibleActualGames.length > 0
        ? Number(
            (
              eligibleActualGames.reduce((acc, g) => acc + (g.actualCostUsd || 0), 0) /
              eligibleActualGames.length
            ).toFixed(8)
          )
        : null;
    const avgActualCostPerGameVnd =
      avgActualCostPerGameUsd !== null ? Math.round(avgActualCostPerGameUsd * exchange.usdToVndRate) : null;

    const avgPaidEquivalentCostPerGameUsd =
      eligibleCount > 0
        ? Number(
            (
              eligibleGames.reduce((acc, g) => acc + (g.paidEquivalentCostUsd || 0), 0) / eligibleCount
            ).toFixed(8)
          )
        : null;
    const avgPaidEquivalentCostPerGameVnd =
      avgPaidEquivalentCostPerGameUsd !== null
        ? Math.round(avgPaidEquivalentCostPerGameUsd * exchange.usdToVndRate)
        : null;

    const scales = [
      { scale: 100, label: '100 lượt tạo game' },
      { scale: 1000, label: '1.000 lượt tạo game' },
      { scale: 10000, label: '10.000 lượt tạo game' },
    ];

    const scalingProjections: AdminAiCostScalingProjectionItem[] = scales.map(({ scale, label }) => {
      const projTokens = avgTokensPerGame !== null ? avgTokensPerGame * scale : null;
      const projActualUsd =
        avgActualCostPerGameUsd !== null ? Number((avgActualCostPerGameUsd * scale).toFixed(6)) : null;
      const projActualVnd =
        projActualUsd !== null ? Math.round(projActualUsd * exchange.usdToVndRate) : null;
      const projPaidUsd =
        avgPaidEquivalentCostPerGameUsd !== null
          ? Number((avgPaidEquivalentCostPerGameUsd * scale).toFixed(6))
          : null;
      const projPaidVnd =
        projPaidUsd !== null ? Math.round(projPaidUsd * exchange.usdToVndRate) : null;

      return {
        scaleGenerations: scale,
        label,
        basisEligibleGenerations: eligibleCount,
        avgTokensPerGeneration: avgTokensPerGame,
        projectedTotalTokens: projTokens,
        avgActualCostPerGameUsd,
        avgActualCostPerGameVnd,
        projectedActualCostUsd: projActualUsd,
        projectedActualCostVnd: projActualVnd,
        avgPaidEquivalentCostPerGameUsd,
        avgPaidEquivalentCostPerGameVnd,
        projectedPaidEquivalentCostUsd: projPaidUsd,
        projectedPaidEquivalentCostVnd: projPaidVnd,
        formulaNote:
          eligibleCount > 0
            ? `Dự phóng dựa trên trung bình ${eligibleCount} lượt tạo game hợp lệ (Chi phí TB × ${scale.toLocaleString('vi-VN')} lượt)`
            : 'Chưa đủ dữ liệu lượt tạo game hợp lệ để dự phóng',
      };
    });

    const dbPath = resolveDefaultDatabasePath();
    const isRenderEnv = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
    const hasCustomPersistentDbPath = Boolean(
      process.env.DATABASE_PATH && !process.env.DATABASE_PATH.includes('data/platform.sqlite')
    );
    const isEphemeralWarning = isRenderEnv && !hasCustomPersistentDbPath;

    return {
      generatedAt: new Date().toISOString(),
      filtersApplied: {
        preset: dateBounds.preset,
        from: dateBounds.from,
        to: dateBounds.to,
        model: filters.model || null,
        gameType: filters.gameType || null,
        taskType: filters.taskType || null,
        questionCount: targetQuestionCount,
        status: rawStatusFilter,
      },
      billingModeConfigured: configuredBillingMode,
      exchangeRate: exchange,
      persistenceStatus: {
        databasePath: dbPath,
        isEphemeralWarning,
        warningMessage: isEphemeralWarning
          ? 'Cảnh báo: Render đang dùng ổ đĩa tạm (ephemeral filesystem). Khi redeploy/restart container, dữ liệu SQLite cục bộ sẽ bị reset trừ khi gắn Render Persistent Disk (DATABASE_PATH=/var/data/platform.sqlite). Nên xuất báo cáo Excel định kỳ.'
          : null,
      },
      summary: {
        totalGameGenerations: byGame.length,
        eligibleGenerationsForAverage: eligibleCount,
        totalAiRequests: apiLogs.length,
        successfulRequests: successReq,
        failedRequests: failedReq,
        requestsWithReportedTokens: reqWithReportedTokens,
        requestsWithUnknownUsage: reqWithUnknownUsage,
        requestsWithPriceUnavailable: reqWithPriceUnavailable,
        requestsWithUnknownBilling: reqWithUnknownBilling,
        inputTokens: totalIn,
        outputTokens: totalOut,
        cachedTokens: totalCached,
        thinkingTokens: totalThinking,
        totalTokens: totalTok,
        actualCostUsd: totalActualUsd,
        actualCostVnd: totalActualVnd,
        paidEquivalentCostUsd: totalPaidUsd,
        paidEquivalentCostVnd: totalPaidVnd,
        avgTokensPerGame,
        avgActualCostPerGameUsd,
        avgActualCostPerGameVnd,
        avgPaidEquivalentCostPerGameUsd,
        avgPaidEquivalentCostPerGameVnd,
        highestCostModel: byModel.length > 0 ? byModel[0].model : null,
      },
      scalingProjections,
      byModel,
      byGame,
      apiLogs,
      pricingCatalog: AI_MODEL_PRICING_CATALOG,
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
      gameType: CreatableGameType;
      expectedValidCount: number;
      fixtureOutput: any[];
    }> = [
      {
        caseId: 'bench_mc_dedup_recovery',
        name: 'Quiz / Trắc nghiệm (MULTIPLE_CHOICE) + Lọc trùng + Phục hồi câu lỗi',
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
        caseId: 'bench_puzzle_vn',
        name: 'Sắp xếp thứ tự (PUZZLE) kiểm tra quy trình chuẩn hóa trình tự',
        gameType: 'PUZZLE',
        expectedValidCount: 1,
        fixtureOutput: [
          {
            id: 'q_pz',
            type: 'PUZZLE',
            question: 'Sắp xếp đúng quy trình chuẩn bị và kiểm tra an toàn xe mô tô trước khi vận hành:',
            choices: [
              'Đội mũ bảo hiểm đạt chuẩn và cài quai đúng quy cách',
              'Kiểm tra áp suất lốp (trước 200 kPa, sau 225 kPa)',
              'Vận hành xe tuân thủ tốc độ tối đa 50 km/h trong khu đông dân cư',
            ],
            correctAnswer:
              'Đội mũ bảo hiểm đạt chuẩn và cài quai đúng quy cách | Kiểm tra áp suất lốp (trước 200 kPa, sau 225 kPa) | Vận hành xe tuân thủ tốc độ tối đa 50 km/h trong khu đông dân cư',
            explanation: 'Trình tự chuẩn bị và vận hành an toàn theo tài liệu.',
            difficulty: 'EASY',
          },
        ],
      },
      {
        caseId: 'bench_adventure_modes',
        name: 'Chế độ Đi cảnh (ADVENTURE) kết hợp đa dạng câu hỏi truyền thống',
        gameType: 'ADVENTURE',
        expectedValidCount: 4,
        fixtureOutput: [
          {
            id: 'q_adv_1',
            type: 'MULTIPLE_CHOICE',
            question: 'Tốc độ tối đa của xe máy trên đường khu đông dân cư không có dải phân cách cứng là bao nhiêu?',
            choices: ['A. 40 km/h', 'B. 50 km/h', 'C. 60 km/h', 'D. 70 km/h'],
            correctAnswer: 'B. 50 km/h',
            explanation: 'Trang 1 quy định tốc độ tối đa là 50 km/h.',
            difficulty: 'EASY',
          },
          {
            id: 'q_adv_2',
            type: 'QUICK_BUTTON',
            question: 'Người điều khiển xe gắn máy bắt buộc phải đội mũ bảo hiểm và cài quai đúng quy cách.',
            choices: ['Đúng', 'Sai'],
            correctAnswer: 'Đúng',
            explanation: 'Quy định bắt buộc tại trang 1.',
            difficulty: 'EASY',
          },
          {
            id: 'q_adv_3',
            type: 'FILL_IN_THE_BLANK',
            question: 'Áp suất lốp sau tiêu chuẩn khi chở hai người là _______ kPa.',
            correctAnswer: '225',
            acceptedAlternatives: ['225 kPa'],
            explanation: 'Áp suất lốp sau tiêu chuẩn là 225 kPa.',
            difficulty: 'MEDIUM',
          },
          {
            id: 'q_adv_4',
            type: 'PUZZLE',
            question: 'Sắp xếp trình tự bảo dưỡng định kỳ động cơ và lốp xe máy:',
            choices: [
              'Kiểm tra áp suất lốp trước 200 kPa',
              'Kiểm tra áp suất lốp sau 225 kPa',
              'Thay dầu nhớt khoáng sau mỗi 1.500 - 2.000 km',
            ],
            correctAnswer:
              'Kiểm tra áp suất lốp trước 200 kPa | Kiểm tra áp suất lốp sau 225 kPa | Thay dầu nhớt khoáng sau mỗi 1.500 - 2.000 km',
            explanation: 'Trình tự kiểm tra bảo dưỡng định kỳ tại trang 2.',
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
            ...(benchCase.gameType === 'ADVENTURE'
              ? {
                  adventureConfig: {
                    questionTypes: ['MULTIPLE_CHOICE', 'QUICK_BUTTON', 'FILL_IN_THE_BLANK', 'PUZZLE'],
                  },
                }
              : {}),
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

