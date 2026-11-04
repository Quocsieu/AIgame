import { LIMITS } from './limits.js';

export type AiBillingMode = 'FREE' | 'PAID' | 'UNKNOWN';
export type AiPricingStatus = 'OK' | 'PRICE_UNAVAILABLE' | 'USAGE_UNAVAILABLE' | 'UNKNOWN_BILLING_MODE';

export type AiTaskType =
  | 'QUESTION_GENERATION'
  | 'QUESTION_SUPPLEMENTAL_RETRY'
  | 'CONTENT_ANALYSIS'
  | 'ADVENTURE_DESIGN'
  | 'COVER_IMAGE_GENERATION'
  | 'ADVENTURE_SPRITE_GENERATION'
  | 'OTHER';

export interface AiModelPricingRule {
  provider: string;
  model: string;
  aliases: string[];
  displayName: string;
  inputPricePer1MUsd: number;
  outputPricePer1MUsd: number;
  cachedInputPricePer1MUsd: number;
  imagePriceUsd: number | null;
  unitDescription: string;
  pricingVersion: string;
  effectiveFrom: string;
  sourceUrl: string;
  notes?: string;
}

export interface AiExchangeRateConfig {
  usdToVndRate: number;
  effectiveDate: string;
  source: string;
}

export const AI_PRICING_VERSION = 'gemini-pricing-2026-05';
export const AI_PRICING_SOURCE_URL = 'https://ai.google.dev/pricing';
export const AI_PRICING_EFFECTIVE_DATE = '2026-05-01';

/**
 * Official Google Gemini API Paid-Tier Pricing Catalog (USD per 1,000,000 tokens or per image).
 * Source: https://ai.google.dev/pricing
 */
export const AI_MODEL_PRICING_CATALOG: AiModelPricingRule[] = [
  {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    aliases: [
      'gemini-2.5-flash',
      'gemini-2.5-flash-preview',
      'gemini-2.5-flash-preview-04-17',
      'gemini-2.5-flash-preview-05-20',
      'models/gemini-2.5-flash',
    ],
    displayName: 'Gemini 2.5 Flash',
    inputPricePer1MUsd: 0.30,
    outputPricePer1MUsd: 2.50,
    cachedInputPricePer1MUsd: 0.075,
    imagePriceUsd: null,
    unitDescription: 'USD / 1M tokens (Output bao gồm Thinking tokens)',
    pricingVersion: AI_PRICING_VERSION,
    effectiveFrom: AI_PRICING_EFFECTIVE_DATE,
    sourceUrl: AI_PRICING_SOURCE_URL,
    notes: 'Model mặc định tạo câu hỏi & phân tích nội dung. Output rate áp dụng cho cả candidates + thinking tokens.',
  },
  {
    provider: 'gemini',
    model: 'gemini-2.5-flash-lite',
    aliases: [
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash-lite-preview',
      'gemini-2.0-flash-lite',
      'models/gemini-2.5-flash-lite',
      'models/gemini-2.0-flash-lite',
    ],
    displayName: 'Gemini 2.5 / 2.0 Flash-Lite',
    inputPricePer1MUsd: 0.075,
    outputPricePer1MUsd: 0.30,
    cachedInputPricePer1MUsd: 0.01875,
    imagePriceUsd: null,
    unitDescription: 'USD / 1M tokens',
    pricingVersion: AI_PRICING_VERSION,
    effectiveFrom: AI_PRICING_EFFECTIVE_DATE,
    sourceUrl: AI_PRICING_SOURCE_URL,
    notes: 'Model tốc độ cao, chi phí thấp.',
  },
  {
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    aliases: [
      'gemini-2.0-flash',
      'gemini-2.0-flash-001',
      'gemini-2.0-flash-exp',
      'models/gemini-2.0-flash',
    ],
    displayName: 'Gemini 2.0 Flash',
    inputPricePer1MUsd: 0.10,
    outputPricePer1MUsd: 0.40,
    cachedInputPricePer1MUsd: 0.025,
    imagePriceUsd: null,
    unitDescription: 'USD / 1M tokens',
    pricingVersion: AI_PRICING_VERSION,
    effectiveFrom: AI_PRICING_EFFECTIVE_DATE,
    sourceUrl: AI_PRICING_SOURCE_URL,
    notes: 'Model Gemini 2.0 tiêu chuẩn.',
  },
  {
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    aliases: [
      'gemini-2.5-pro',
      'gemini-2.5-pro-preview',
      'gemini-1.5-pro',
      'gemini-1.5-pro-latest',
      'models/gemini-2.5-pro',
      'models/gemini-1.5-pro',
    ],
    displayName: 'Gemini 2.5 / 1.5 Pro',
    inputPricePer1MUsd: 1.25,
    outputPricePer1MUsd: 10.00,
    cachedInputPricePer1MUsd: 0.3125,
    imagePriceUsd: null,
    unitDescription: 'USD / 1M tokens (<= 200k context)',
    pricingVersion: AI_PRICING_VERSION,
    effectiveFrom: AI_PRICING_EFFECTIVE_DATE,
    sourceUrl: AI_PRICING_SOURCE_URL,
    notes: 'Model suy luận chuyên sâu.',
  },
  {
    provider: 'gemini',
    model: 'gemini-1.5-flash',
    aliases: [
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash-8b',
      'models/gemini-1.5-flash',
    ],
    displayName: 'Gemini 1.5 Flash',
    inputPricePer1MUsd: 0.075,
    outputPricePer1MUsd: 0.30,
    cachedInputPricePer1MUsd: 0.01875,
    imagePriceUsd: null,
    unitDescription: 'USD / 1M tokens',
    pricingVersion: AI_PRICING_VERSION,
    effectiveFrom: AI_PRICING_EFFECTIVE_DATE,
    sourceUrl: AI_PRICING_SOURCE_URL,
    notes: 'Model Gemini 1.5 Flash thế hệ trước.',
  },
  {
    provider: 'gemini',
    model: 'gemini-2.5-flash-image',
    aliases: [
      'gemini-2.5-flash-image',
      'gemini-2.5-flash-image-preview',
      'gemini-3.1-flash-image',
      'gemini-3.1-flash-image-preview',
      'gemini-2.0-flash-preview-image-generation',
      'gemini-2.0-flash-exp-image-generation',
      'imagen-3.0-generate-002',
      'models/gemini-2.5-flash-image',
      'models/gemini-3.1-flash-image',
      'models/gemini-2.0-flash-preview-image-generation',
    ],
    displayName: 'Gemini 2.5 Flash Image / Image Generation',
    inputPricePer1MUsd: 0.30,
    outputPricePer1MUsd: 2.50,
    cachedInputPricePer1MUsd: 0.075,
    imagePriceUsd: 0.039,
    unitDescription: 'USD / 1M input tokens + $0.039 / ảnh (hoặc theo output tokens ~1290 tokens/ảnh)',
    pricingVersion: AI_PRICING_VERSION,
    effectiveFrom: AI_PRICING_EFFECTIVE_DATE,
    sourceUrl: AI_PRICING_SOURCE_URL,
    notes: 'Model tạo ảnh bìa game & sprite Adventure 2D. Nếu API không trả output tokens thì tính phí $0.039/ảnh thành công.',
  },
];

export function getExchangeRateConfig(): AiExchangeRateConfig {
  const rawRate = process.env.AI_USD_VND_EXCHANGE_RATE
    ? parseFloat(process.env.AI_USD_VND_EXCHANGE_RATE)
    : 25500;
  const usdToVndRate = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 25500;
  return {
    usdToVndRate,
    effectiveDate: process.env.AI_USD_VND_EFFECTIVE_DATE || AI_PRICING_EFFECTIVE_DATE,
    source: process.env.AI_USD_VND_SOURCE || 'Cấu hình hệ thống (AI_USD_VND_EXCHANGE_RATE, mặc định 25,500 VND/USD)',
  };
}

export function getConfiguredBillingMode(overrideMode?: string | null): AiBillingMode {
  const raw = (overrideMode || process.env.AI_BILLING_MODE || 'PAID').trim().toUpperCase();
  if (raw === 'FREE' || raw === 'FREE_TIER') return 'FREE';
  if (raw === 'PAID' || raw === 'PAID_TIER' || raw === 'PAY_AS_YOU_GO') return 'PAID';
  if (raw === 'UNKNOWN') return 'UNKNOWN';
  return 'PAID';
}

export function findModelPricingRule(model: string, provider = 'gemini'): AiModelPricingRule | null {
  const normalizedModel = String(model || '').trim().toLowerCase();
  const normalizedProvider = String(provider || 'gemini').trim().toLowerCase();
  if (!normalizedModel || normalizedModel === 'none' || normalizedModel === 'unknown') {
    return null;
  }

  // Check if explicit env overrides are active on LIMITS (backward-compatible with legacy tests)
  const envInputOverride = LIMITS.GEMINI_INPUT_COST_PER_1M_USD;
  const envOutputOverride = LIMITS.GEMINI_OUTPUT_COST_PER_1M_USD;
  const hasExplicitEnvOverride =
    envInputOverride !== null &&
    envOutputOverride !== null &&
    Number.isFinite(envInputOverride) &&
    Number.isFinite(envOutputOverride) &&
    envInputOverride >= 0 &&
    envOutputOverride >= 0;

  for (const rule of AI_MODEL_PRICING_CATALOG) {
    if (
      rule.model.toLowerCase() === normalizedModel ||
      rule.aliases.some((alias) => alias.toLowerCase() === normalizedModel)
    ) {
      if (hasExplicitEnvOverride) {
        return {
          ...rule,
          inputPricePer1MUsd: envInputOverride!,
          outputPricePer1MUsd: envOutputOverride!,
          cachedInputPricePer1MUsd: Number((envInputOverride! * 0.25).toFixed(6)),
          pricingVersion: `${rule.pricingVersion}+env-override`,
        };
      }
      return rule;
    }
  }

  // If model is not in catalog, only use env override if explicitly set in LIMITS
  if (hasExplicitEnvOverride && normalizedProvider.includes('gemini')) {
    return {
      provider: normalizedProvider,
      model: normalizedModel,
      aliases: [normalizedModel],
      displayName: model,
      inputPricePer1MUsd: envInputOverride!,
      outputPricePer1MUsd: envOutputOverride!,
      cachedInputPricePer1MUsd: Number((envInputOverride! * 0.25).toFixed(6)),
      imagePriceUsd: null,
      unitDescription: 'USD / 1M tokens (Env override)',
      pricingVersion: 'env-override',
      effectiveFrom: AI_PRICING_EFFECTIVE_DATE,
      sourceUrl: 'Environment Override (GEMINI_INPUT_COST_PER_1M_USD / GEMINI_OUTPUT_COST_PER_1M_USD)',
    };
  }

  return null;
}

export interface CalculateAiCallCostInput {
  provider: string;
  model: string;
  status: string;
  taskType?: AiTaskType | string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens?: number | null;
  thinkingTokens?: number | null;
  totalTokens?: number | null;
  billingMode?: AiBillingMode | string | null;
}

export interface CalculateAiCallCostResult {
  billingMode: AiBillingMode;
  pricingVersion: string;
  pricingStatus: AiPricingStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  thinkingTokens: number | null;
  totalTokens: number | null;
  nonCachedInputTokens: number | null;
  billableOutputTokens: number | null;
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

/**
 * Calculates token usage and cost for a single AI API call without double-counting cached or thinking tokens.
 *
 * Non-Double-Counting Rules for Google Gemini API `usageMetadata`:
 * 1. `promptTokenCount` (`inputTokens`) ALREADY includes `cachedContentTokenCount` (`cachedTokens`).
 *    Therefore:
 *      - `effectiveCachedTokens = Math.min(inputTokens, Math.max(0, cachedTokens || 0))`
 *      - `nonCachedInputTokens = Math.max(0, inputTokens - effectiveCachedTokens)`
 * 2. `totalTokenCount` = `promptTokenCount + candidatesTokenCount + thoughtsTokenCount`.
 *    - `candidatesTokenCount` (`outputTokens`) does NOT include `thoughtsTokenCount` (`thinkingTokens`) in raw Gemini responses,
 *      unless a custom caller pre-summed them. We check `totalTokens`:
 *      If `totalTokens !== null && totalTokens < inputTokens + outputTokens + thinkingTokens`, then `thinkingTokens` is already inside `outputTokens`.
 *      Otherwise, `billableOutputTokens = outputTokens + thinkingTokens` and `computedTotalTokens = inputTokens + billableOutputTokens`.
 * 3. Never fabricate tokens when API does not report usage (`inputTokens === null && outputTokens === null`).
 * 4. Never default unknown model pricing to `0` (`PRICE_UNAVAILABLE` -> cost is `null`).
 */
export function calculateAiCallCost(input: CalculateAiCallCostInput): CalculateAiCallCostResult {
  const billingMode = getConfiguredBillingMode(input.billingMode);
  const exchange = getExchangeRateConfig();
  const rule = findModelPricingRule(input.model, input.provider);

  const hasTokenUsage =
    input.inputTokens !== null &&
    input.inputTokens !== undefined &&
    Number.isFinite(input.inputTokens) &&
    input.inputTokens >= 0 &&
    input.outputTokens !== null &&
    input.outputTokens !== undefined &&
    Number.isFinite(input.outputTokens) &&
    input.outputTokens >= 0;

  const isImageTask =
    input.taskType === 'COVER_IMAGE_GENERATION' ||
    input.taskType === 'ADVENTURE_SPRITE_GENERATION' ||
    String(input.model || '').toLowerCase().includes('image');

  const isSuccess = input.status === 'SUCCESS';

  // If no rule exists for this model -> PRICE_UNAVAILABLE (cost must be null, never 0)
  if (!rule) {
    const safeIn = hasTokenUsage ? Math.round(input.inputTokens!) : null;
    const safeOut = hasTokenUsage ? Math.round(input.outputTokens!) : null;
    const safeCached =
      input.cachedTokens !== null && input.cachedTokens !== undefined && Number.isFinite(input.cachedTokens)
        ? Math.max(0, Math.round(input.cachedTokens))
        : null;
    const safeThinking =
      input.thinkingTokens !== null && input.thinkingTokens !== undefined && Number.isFinite(input.thinkingTokens)
        ? Math.max(0, Math.round(input.thinkingTokens))
        : null;
    let safeTotal: number | null = null;
    if (input.totalTokens !== null && input.totalTokens !== undefined && Number.isFinite(input.totalTokens)) {
      safeTotal = Math.round(input.totalTokens);
    } else if (safeIn !== null && safeOut !== null) {
      safeTotal = safeIn + safeOut + (safeThinking || 0);
    }

    return {
      billingMode,
      pricingVersion: 'PRICE_UNAVAILABLE',
      pricingStatus: 'PRICE_UNAVAILABLE',
      inputTokens: safeIn,
      outputTokens: safeOut,
      cachedTokens: safeCached,
      thinkingTokens: safeThinking,
      totalTokens: safeTotal,
      nonCachedInputTokens: safeIn !== null ? Math.max(0, safeIn - (safeCached || 0)) : null,
      billableOutputTokens: safeOut !== null ? safeOut + (safeThinking || 0) : null,
      inputPricePer1MUsd: null,
      outputPricePer1MUsd: null,
      cachedPricePer1MUsd: null,
      imagePriceUsd: null,
      exchangeRateUsdVnd: exchange.usdToVndRate,
      inputCostUsd: null,
      outputCostUsd: null,
      inputCostVnd: null,
      outputCostVnd: null,
      actualCostUsd: null,
      actualCostVnd: null,
      paidEquivalentCostUsd: null,
      paidEquivalentCostVnd: null,
      dataNote: `PRICE_UNAVAILABLE: Chưa có cấu hình đơn giá cho model "${input.model || 'unknown'}"`,
    };
  }

  // Check if usage is missing
  if (!hasTokenUsage) {
    // Special case: successful image generation where Gemini Image API did not return token counts
    // but we have a per-image rate on the pricing rule
    if (isImageTask && isSuccess && rule.imagePriceUsd !== null && rule.imagePriceUsd > 0) {
      const paidUsd = Number(rule.imagePriceUsd.toFixed(8));
      const paidVnd = Math.round(paidUsd * exchange.usdToVndRate);
      const actualUsd = billingMode === 'FREE' ? 0 : billingMode === 'PAID' ? paidUsd : null;
      const actualVnd = billingMode === 'FREE' ? 0 : billingMode === 'PAID' ? paidVnd : null;
      const pricingStatus: AiPricingStatus = billingMode === 'UNKNOWN' ? 'UNKNOWN_BILLING_MODE' : 'OK';
      return {
        billingMode,
        pricingVersion: rule.pricingVersion,
        pricingStatus,
        inputTokens: null,
        outputTokens: null,
        cachedTokens: null,
        thinkingTokens: null,
        totalTokens: null,
        nonCachedInputTokens: null,
        billableOutputTokens: null,
        inputPricePer1MUsd: rule.inputPricePer1MUsd,
        outputPricePer1MUsd: rule.outputPricePer1MUsd,
        cachedPricePer1MUsd: rule.cachedInputPricePer1MUsd,
        imagePriceUsd: rule.imagePriceUsd,
        exchangeRateUsdVnd: exchange.usdToVndRate,
        inputCostUsd: null,
        outputCostUsd: null,
        inputCostVnd: null,
        outputCostVnd: null,
        actualCostUsd: actualUsd,
        actualCostVnd: actualVnd,
        paidEquivalentCostUsd: paidUsd,
        paidEquivalentCostVnd: paidVnd,
        dataNote: 'IMAGE_FLAT_PRICE: API không trả token usage, tính theo đơn giá tạo ảnh ($/ảnh).',
      };
    }

    return {
      billingMode,
      pricingVersion: rule.pricingVersion,
      pricingStatus: 'USAGE_UNAVAILABLE',
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
      thinkingTokens: null,
      totalTokens: null,
      nonCachedInputTokens: null,
      billableOutputTokens: null,
      inputPricePer1MUsd: rule.inputPricePer1MUsd,
      outputPricePer1MUsd: rule.outputPricePer1MUsd,
      cachedPricePer1MUsd: rule.cachedInputPricePer1MUsd,
      imagePriceUsd: rule.imagePriceUsd,
      exchangeRateUsdVnd: exchange.usdToVndRate,
      inputCostUsd: null,
      outputCostUsd: null,
      inputCostVnd: null,
      outputCostVnd: null,
      actualCostUsd: null,
      actualCostVnd: null,
      paidEquivalentCostUsd: null,
      paidEquivalentCostVnd: null,
      dataNote: 'USAGE_UNAVAILABLE: Phản hồi từ AI provider không chứa usageMetadata.',
    };
  }

  // Both pricing rule and token usage exist!
  const rawIn = Math.max(0, Math.round(input.inputTokens!));
  const rawOut = Math.max(0, Math.round(input.outputTokens!));
  const rawCached =
    input.cachedTokens !== null && input.cachedTokens !== undefined && Number.isFinite(input.cachedTokens)
      ? Math.max(0, Math.round(input.cachedTokens))
      : 0;
  const rawThinking =
    input.thinkingTokens !== null && input.thinkingTokens !== undefined && Number.isFinite(input.thinkingTokens)
      ? Math.max(0, Math.round(input.thinkingTokens))
      : 0;

  // 1. Prevent double-counting cached tokens (promptTokenCount includes cachedContentTokenCount)
  const effectiveCached = Math.min(rawIn, rawCached);
  const nonCachedInput = Math.max(0, rawIn - effectiveCached);

  // 2. Prevent double-counting thinking tokens:
  // If caller provided totalTokens and totalTokens <= rawIn + rawOut (when rawThinking > 0),
  // then rawOut already includes rawThinking. Otherwise, billable output is rawOut + rawThinking.
  let thinkingAlreadyInOutput = false;
  if (
    rawThinking > 0 &&
    input.totalTokens !== null &&
    input.totalTokens !== undefined &&
    Number.isFinite(input.totalTokens) &&
    Math.round(input.totalTokens) <= rawIn + rawOut
  ) {
    thinkingAlreadyInOutput = true;
  }

  const billableOutput = thinkingAlreadyInOutput ? rawOut : rawOut + rawThinking;
  const computedTotalTokens =
    input.totalTokens !== null && input.totalTokens !== undefined && Number.isFinite(input.totalTokens)
      ? Math.max(rawIn + rawOut, Math.round(input.totalTokens))
      : rawIn + billableOutput;

  // 3. Compute Paid-Tier Equivalent Cost in USD
  const inputCostUsd = (nonCachedInput / 1_000_000) * rule.inputPricePer1MUsd;
  const cachedCostUsd = (effectiveCached / 1_000_000) * rule.cachedInputPricePer1MUsd;
  const tokenInputCostUsd = Number((inputCostUsd + cachedCostUsd).toFixed(8));
  const tokenOutputCostUsd = Number(((billableOutput / 1_000_000) * rule.outputPricePer1MUsd).toFixed(8));
  let outputCostUsd = (billableOutput / 1_000_000) * rule.outputPricePer1MUsd;

  // If this is a successful image generation task where outputTokens === 0, apply per-image fee
  const hasFlatImageFee =
    isImageTask && isSuccess && billableOutput === 0 && rule.imagePriceUsd !== null && rule.imagePriceUsd > 0;
  if (hasFlatImageFee) {
    outputCostUsd = rule.imagePriceUsd!;
  }

  const tokenInputCostVnd = Math.round(tokenInputCostUsd * exchange.usdToVndRate);
  const tokenOutputCostVnd = Math.round(tokenOutputCostUsd * exchange.usdToVndRate);

  const paidEquivalentCostUsd = Number((inputCostUsd + cachedCostUsd + outputCostUsd).toFixed(8));
  const paidEquivalentCostVnd = Math.round(paidEquivalentCostUsd * exchange.usdToVndRate);

  let actualCostUsd: number | null = null;
  let actualCostVnd: number | null = null;
  let pricingStatus: AiPricingStatus = 'OK';
  let dataNote: string | null = null;

  if (billingMode === 'FREE') {
    actualCostUsd = 0;
    actualCostVnd = 0;
    dataNote = 'FREE_TIER: Chi phí thực trả = $0 (Có tính chi phí quy đổi Paid Tier để lập ngân sách).';
  } else if (billingMode === 'PAID') {
    actualCostUsd = paidEquivalentCostUsd;
    actualCostVnd = paidEquivalentCostVnd;
  } else {
    pricingStatus = 'UNKNOWN_BILLING_MODE';
    actualCostUsd = null;
    actualCostVnd = null;
    dataNote = 'UNKNOWN_BILLING_MODE: Chưa xác định chế độ gói cước (FREE/PAID), chỉ hiển thị chi phí quy đổi Paid Tier.';
  }

  return {
    billingMode,
    pricingVersion: rule.pricingVersion,
    pricingStatus,
    inputTokens: rawIn,
    outputTokens: rawOut,
    cachedTokens: input.cachedTokens !== null && input.cachedTokens !== undefined ? effectiveCached : null,
    thinkingTokens: input.thinkingTokens !== null && input.thinkingTokens !== undefined ? rawThinking : null,
    totalTokens: computedTotalTokens,
    nonCachedInputTokens: nonCachedInput,
    billableOutputTokens: billableOutput,
    inputPricePer1MUsd: rule.inputPricePer1MUsd,
    outputPricePer1MUsd: rule.outputPricePer1MUsd,
    cachedPricePer1MUsd: rule.cachedInputPricePer1MUsd,
    imagePriceUsd: rule.imagePriceUsd,
    exchangeRateUsdVnd: exchange.usdToVndRate,
    inputCostUsd: tokenInputCostUsd,
    outputCostUsd: tokenOutputCostUsd,
    inputCostVnd: tokenInputCostVnd,
    outputCostVnd: tokenOutputCostVnd,
    actualCostUsd,
    actualCostVnd,
    paidEquivalentCostUsd,
    paidEquivalentCostVnd,
    dataNote,
  };
}
