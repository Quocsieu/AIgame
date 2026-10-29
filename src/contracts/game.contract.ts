import { z } from 'zod';
import {
  AdventureConfigSchema,
  GenerateAdventureConfigInputSchema,
  IndustryIdEnum,
} from './adventure.contract.js';
import {
  CanonicalDocument,
  CanonicalDocumentSchema,
  ProvenanceReferenceSchema,
  SourceTypeEnum,
} from './canonical.contract.js';

export * from './adventure.contract.js';

export const TargetTraditionalGameTypeEnum = z.enum([
  'QUIZ',
  'TRUE_FALSE',
  'TYPE_ANSWER',
  'PUZZLE',
  'SLIDER',
  'PIN_ANSWER',
]);
export type TargetTraditionalGameType = z.infer<typeof TargetTraditionalGameTypeEnum>;

export const PriorityTraditionalGameTypeEnum = z.enum([
  'QUIZ',
  'TRUE_FALSE',
  'TYPE_ANSWER',
  'PUZZLE',
]);
export type PriorityTraditionalGameType = z.infer<typeof PriorityTraditionalGameTypeEnum>;

export const QuestionTypeEnum = z.enum([
  'QUIZ',
  'TRUE_FALSE',
  'TYPE_ANSWER',
  'PUZZLE',
  'SLIDER',
  'PIN_ANSWER',
  'MULTIPLE_CHOICE',
  'FILL_IN_THE_BLANK',
  'QUICK_BUTTON',
  'CROSSWORD',
]);
export type QuestionType = z.infer<typeof QuestionTypeEnum>;

export const GameTypeEnum = z.enum([
  'QUIZ',
  'TRUE_FALSE',
  'TYPE_ANSWER',
  'PUZZLE',
  'SLIDER',
  'PIN_ANSWER',
  'MULTIPLE_CHOICE',
  'FILL_IN_THE_BLANK',
  'QUICK_BUTTON',
  'CROSSWORD',
  'MIXED',
  'ADVENTURE',
]);
export type GameType = z.infer<typeof GameTypeEnum>;

/**
 * Danh sách loại game được phép tạo mới qua POST /api/games/generate:
 * - 4 dạng truyền thống ưu tiên: QUIZ (MULTIPLE_CHOICE), TRUE_FALSE (QUICK_BUTTON),
 *   TYPE_ANSWER (FILL_IN_THE_BLANK), PUZZLE
 * - Dạng giả lập tương tác: ADVENTURE
 * - Loại bỏ các dạng cũ không nằm trong danh sách tạo mới (CROSSWORD, MIXED)
 *   và chưa mở tạo mới cho 2 dạng chuẩn bị kiến trúc (SLIDER, PIN_ANSWER).
 */
export const CreatableGameTypeEnum = z.enum([
  'QUIZ',
  'TRUE_FALSE',
  'TYPE_ANSWER',
  'PUZZLE',
  'MULTIPLE_CHOICE',
  'QUICK_BUTTON',
  'FILL_IN_THE_BLANK',
  'ADVENTURE',
]);
export type CreatableGameType = z.infer<typeof CreatableGameTypeEnum>;

export const DifficultyEnum = z.enum(['EASY', 'MEDIUM', 'HARD']);
export type Difficulty = z.infer<typeof DifficultyEnum>;

export const ScoringModeEnum = z.enum(['STANDARD', 'SPEED_BONUS', 'STREAK']);
export type ScoringMode = z.infer<typeof ScoringModeEnum>;

export const MAX_ANSWER_LENGTH = 500;

export const SliderQuestionConfigSchema = z
  .object({
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().positive(),
    correctValue: z.number().finite(),
    tolerance: z.number().nonnegative().default(0),
    unit: z.string().trim().max(40).optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.min >= cfg.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SLIDER min must be strictly less than max.',
        path: ['min'],
      });
    }
    if (cfg.correctValue < cfg.min || cfg.correctValue > cfg.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SLIDER correctValue must be within [min, max].',
        path: ['correctValue'],
      });
    }
    if (cfg.step > cfg.max - cfg.min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SLIDER step cannot exceed (max - min).',
        path: ['step'],
      });
    }
  });
export type SliderQuestionConfig = z.infer<typeof SliderQuestionConfigSchema>;

export const PinCoordinateSystemEnum = z.enum(['NORMALIZED_PERCENT_100']);
export type PinCoordinateSystem = z.infer<typeof PinCoordinateSystemEnum>;

export const PinAnswerQuestionConfigSchema = z
  .object({
    imageUrl: z
      .string()
      .trim()
      .min(1)
      .max(2048)
      .refine(
        val => /^https?:\/\/[^\s]+$/i.test(val) || /^\/[^\s]*$/.test(val),
        'PIN_ANSWER imageUrl must be a safe http(s) URL or relative asset path.'
      ),
    coordinateSystem: PinCoordinateSystemEnum.default('NORMALIZED_PERCENT_100'),
    targetX: z.number().min(0).max(100),
    targetY: z.number().min(0).max(100),
    radius: z.number().positive().max(50),
  });
export type PinAnswerQuestionConfig = z.infer<typeof PinAnswerQuestionConfigSchema>;

function normalizeChoiceCompare(text: string): string {
  return text.trim().normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
}

function stripOptionLetterPrefix(text: string): string {
  return normalizeChoiceCompare(text.replace(/^[A-Da-d][\.\)]\s*/, ''));
}

const TRUE_POLARITY_TOKENS = new Set(['đúng', 'dung', 'true', 'có', 'co', 'yes', 'chính xác']);
const FALSE_POLARITY_TOKENS = new Set(['sai', 'false', 'không', 'khong', 'no', 'không đúng']);

export function normalizeTrueFalsePolarity(text: string): 'TRUE' | 'FALSE' | null {
  const norm = normalizeChoiceCompare(text);
  if (TRUE_POLARITY_TOKENS.has(norm)) return 'TRUE';
  if (FALSE_POLARITY_TOKENS.has(norm)) return 'FALSE';
  return null;
}

export function isStrictTrueFalseChoicePair(choices: string[]): boolean {
  if (!Array.isArray(choices) || choices.length !== 2) return false;
  const p0 = normalizeTrueFalsePolarity(choices[0]);
  const p1 = normalizeTrueFalsePolarity(choices[1]);
  return (p0 === 'TRUE' && p1 === 'FALSE') || (p0 === 'FALSE' && p1 === 'TRUE');
}

export function parsePuzzleSequence(raw: string): string[] {
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === 'string')
          .map(item => item.trim())
          .filter(Boolean);
      }
    } catch {
      // Fall back to delimiter split
    }
  }

  if (trimmed.includes('|')) {
    return trimmed
      .split('|')
      .map(part => part.trim())
      .filter(Boolean);
  }

  if (trimmed.includes('->')) {
    return trimmed
      .split('->')
      .map(part => part.trim())
      .filter(Boolean);
  }

  if (trimmed.includes('→')) {
    return trimmed
      .split('→')
      .map(part => part.trim())
      .filter(Boolean);
  }

  if (trimmed.includes('\n')) {
    return trimmed
      .split(/\r?\n/)
      .map(part => part.trim())
      .filter(Boolean);
  }

  return [trimmed];
}

export function formatCanonicalPuzzleAnswer(orderedItems: string[]): string {
  return orderedItems.map(item => item.trim()).filter(Boolean).join(' | ');
}

export function shufflePuzzleChoicesForClient(
  choices: string[],
  correctAnswer: string,
  seedInput: string
): string[] {
  if (!Array.isArray(choices) || choices.length <= 1) {
    return Array.isArray(choices) ? [...choices] : [];
  }

  const items = [...choices];
  let hash = 2166136261;
  for (let i = 0; i < seedInput.length; i++) {
    hash ^= seedInput.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  for (let i = items.length - 1; i > 0; i--) {
    hash ^= i + 1;
    hash = Math.imul(hash, 16777619);
    const j = Math.abs(hash) % (i + 1);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }

  const canonical = parsePuzzleSequence(correctAnswer).map(c => normalizeChoiceCompare(c));
  const shuffledNorm = items.map(c => normalizeChoiceCompare(c));
  const isIdenticalToCanonical =
    canonical.length === shuffledNorm.length &&
    canonical.every((val, idx) => val === shuffledNorm[idx]);

  if (isIdenticalToCanonical && items.length > 1) {
    const first = items.shift()!;
    items.push(first);
  }

  return items;
}

export const BaseQuestionSchema = z.object({
  id: z.string(),
  type: QuestionTypeEnum,
  question: z.string().min(3),
  choices: z.array(z.string().min(1)).optional(),
  correctAnswer: z.string().min(1),
  acceptedAlternatives: z.array(z.string()).optional(),
  explanation: z.string().optional(),
  difficulty: DifficultyEnum.default('MEDIUM'),
  sourceReference: ProvenanceReferenceSchema,
  crosswordClue: z.string().optional(),
  crosswordAnswer: z.string().optional(),
  sliderConfig: SliderQuestionConfigSchema.optional(),
  pinConfig: PinAnswerQuestionConfigSchema.optional(),
});

export const GameQuestionSchema = BaseQuestionSchema.superRefine((data, ctx) => {
  if (data.type === 'MULTIPLE_CHOICE' || data.type === 'QUIZ') {
    if (!data.choices || data.choices.length !== 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${data.type} question must have exactly 4 choices.`,
        path: ['choices'],
      });
      return;
    }

    const normalizedChoiceTexts = data.choices.map(c => stripOptionLetterPrefix(c));
    const uniqueChoices = new Set(normalizedChoiceTexts);
    if (uniqueChoices.size !== 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${data.type} choices must be distinct (no duplicate choices).`,
        path: ['choices'],
      });
      return;
    }

    const trimmedCorrect = data.correctAnswer.trim();
    const upperLetter = trimmedCorrect.toUpperCase().replace(/^([A-D])[\.\)]$/, '$1');
    const isLetterKey = ['A', 'B', 'C', 'D'].includes(upperLetter);
    const normCorrect = normalizeChoiceCompare(trimmedCorrect);
    const strippedCorrect = stripOptionLetterPrefix(trimmedCorrect);

    const answerMatchesChoice =
      isLetterKey ||
      data.choices.some(c => {
        const normChoice = normalizeChoiceCompare(c);
        const strippedChoice = stripOptionLetterPrefix(c);
        return (
          normChoice === normCorrect ||
          (strippedChoice.length > 0 && strippedChoice === strippedCorrect)
        );
      });

    if (!answerMatchesChoice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${data.type} correct answer "${data.correctAnswer}" does not match any of the provided choices.`,
        path: ['correctAnswer'],
      });
    }
  }

  if (data.type === 'TRUE_FALSE') {
    if (!data.choices || !isStrictTrueFalseChoicePair(data.choices)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TRUE_FALSE question must have exactly 2 binary choices (e.g., ["Đúng", "Sai"] or ["True", "False"]).',
        path: ['choices'],
      });
      return;
    }

    const answerPolarity = normalizeTrueFalsePolarity(data.correctAnswer);
    const choicePolarities = data.choices.map(c => normalizeTrueFalsePolarity(c));
    if (!answerPolarity || !choicePolarities.includes(answerPolarity)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `TRUE_FALSE correctAnswer "${data.correctAnswer}" must be a valid True/False value matching the choices.`,
        path: ['correctAnswer'],
      });
    }
  }

  if (data.type === 'QUICK_BUTTON') {
    if (!data.choices || data.choices.length < 2 || data.choices.length > 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'QUICK_BUTTON question must have between 2 and 4 choices.',
        path: ['choices'],
      });
      return;
    }

    const normalizedButtons = data.choices.map(c => normalizeChoiceCompare(c));
    if (normalizedButtons.some(c => c.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'QUICK_BUTTON choices cannot be empty.',
        path: ['choices'],
      });
      return;
    }

    if (new Set(normalizedButtons).size !== data.choices.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'QUICK_BUTTON choices must be distinct.',
        path: ['choices'],
      });
      return;
    }

    const normCorrect = normalizeChoiceCompare(data.correctAnswer);
    const answerPolarity = normalizeTrueFalsePolarity(data.correctAnswer);
    const matchesChoiceDirectly = normalizedButtons.includes(normCorrect);
    const matchesTrueFalsePolarity =
      isStrictTrueFalseChoicePair(data.choices) &&
      answerPolarity !== null &&
      data.choices.some(c => normalizeTrueFalsePolarity(c) === answerPolarity);

    if (!matchesChoiceDirectly && !matchesTrueFalsePolarity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `QUICK_BUTTON correctAnswer "${data.correctAnswer}" must match one of the provided choices.`,
        path: ['correctAnswer'],
      });
    }
  }

  if (data.type === 'TYPE_ANSWER' || data.type === 'FILL_IN_THE_BLANK') {
    if (Array.isArray(data.choices) && data.choices.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${data.type} question must not include selectable choices.`,
        path: ['choices'],
      });
      return;
    }

    if (!data.correctAnswer || data.correctAnswer.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${data.type} question must have a non-empty correctAnswer.`,
        path: ['correctAnswer'],
      });
    }
  }

  if (data.type === 'PUZZLE') {
    if (!data.choices || data.choices.length < 3 || data.choices.length > 6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PUZZLE question must have between 3 and 6 items to order in choices.',
        path: ['choices'],
      });
      return;
    }

    const normalizedItems = data.choices.map(c => normalizeChoiceCompare(c));
    if (normalizedItems.some(c => c.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PUZZLE items cannot be empty.',
        path: ['choices'],
      });
      return;
    }

    if (new Set(normalizedItems).size !== data.choices.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PUZZLE items must be distinct (no duplicate items in sequence).',
        path: ['choices'],
      });
      return;
    }

    const canonicalOrder = parsePuzzleSequence(data.correctAnswer);
    if (canonicalOrder.length !== data.choices.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `PUZZLE correctAnswer must specify the ordered sequence of all ${data.choices.length} items.`,
        path: ['correctAnswer'],
      });
      return;
    }

    const normalizedOrder = canonicalOrder.map(c => normalizeChoiceCompare(c));
    if (new Set(normalizedOrder).size !== data.choices.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PUZZLE correctAnswer sequence cannot contain duplicate items.',
        path: ['correctAnswer'],
      });
      return;
    }

    const itemSet = new Set(normalizedItems);
    const allMatch = normalizedOrder.every(item => itemSet.has(item));
    if (!allMatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PUZZLE correctAnswer sequence must contain the exact same items as choices.',
        path: ['correctAnswer'],
      });
    }
  }

  if (data.type === 'SLIDER') {
    if (!data.sliderConfig) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SLIDER question requires a valid sliderConfig.',
        path: ['sliderConfig'],
      });
      return;
    }
    const numericAnswer = Number(data.correctAnswer);
    if (!Number.isFinite(numericAnswer) || Math.abs(numericAnswer - data.sliderConfig.correctValue) > 1e-6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SLIDER correctAnswer must match sliderConfig.correctValue.',
        path: ['correctAnswer'],
      });
    }
  }

  if (data.type === 'PIN_ANSWER') {
    if (!data.pinConfig) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PIN_ANSWER question requires a valid pinConfig.',
        path: ['pinConfig'],
      });
    }
  }

  if (data.type === 'CROSSWORD') {
    const word = data.crosswordAnswer || data.correctAnswer;
    const parts = word
      .split(/[|;]/)
      .map(part =>
        part
          .trim()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/đ/g, 'd')
          .replace(/Đ/g, 'D')
          .replace(/\s+/g, '')
      )
      .filter(Boolean);
    if (parts.length === 0 || !parts.every(p => /^[A-Za-z0-9]+$/.test(p))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CROSSWORD answer word must be alphanumeric without special symbols.',
        path: ['correctAnswer'],
      });
    }
  }
});
export type GameQuestion = z.infer<typeof GameQuestionSchema>;

export const MixedQuestionDistributionSchema = z.object({
  MULTIPLE_CHOICE: z.number().int().min(0).max(100).default(40),
  QUICK_BUTTON: z.number().int().min(0).max(100).default(20),
  FILL_IN_THE_BLANK: z.number().int().min(0).max(100).default(20),
  CROSSWORD: z.number().int().min(0).max(100).default(20),
}).refine(
  (data) => (data.MULTIPLE_CHOICE ?? 0) + (data.QUICK_BUTTON ?? 0) + (data.FILL_IN_THE_BLANK ?? 0) + (data.CROSSWORD ?? 0) === 100,
  {
    message: 'Tổng tỷ lệ các loại câu hỏi cho chế độ MIXED phải bằng chính xác 100%.',
  }
);
export type MixedQuestionDistribution = z.infer<typeof MixedQuestionDistributionSchema>;

export const GameSettingsSchema = z.object({
  questionCount: z.number().int().min(1).max(100).default(5),
  timePerQuestion: z.number().int().min(5).max(120).default(20),
  scoringMode: ScoringModeEnum.default('STANDARD'),
  adventureConfig: AdventureConfigSchema.optional(),
  mixedDistribution: MixedQuestionDistributionSchema.optional(),

});
export type GameSettings = z.infer<typeof GameSettingsSchema>;

export const SourceSummaryItemSchema = z.object({
  sourceId: z.string(),
  sourceType: SourceTypeEnum,
  sourceName: z.string(),
  sourceLocation: z.string(),
});
export type SourceSummaryItem = z.infer<typeof SourceSummaryItemSchema>;

export const GameSpecificationSchema = z.object({
  gameId: z.string(),
  ownerUserId: z.string().nullable().optional(),
  isPublic: z.boolean().optional(),
  title: z.string().trim().min(1, 'Tên game không được để trống').max(100, 'Tên game không được vượt quá 100 ký tự'),
  description: z.string(),
  gameType: GameTypeEnum,
  questions: z.array(GameQuestionSchema).min(1),
  settings: GameSettingsSchema,
  sourceSummary: z.object({
    sourceCount: z.number().int().nonnegative(),
    sources: z.array(SourceSummaryItemSchema),
  }),
  diagnostics: z.array(z.string()).optional(),
  generatedAt: z.string(),
});
export type GameSpecification = z.infer<typeof GameSpecificationSchema>;

export const GenerateGameRequestSchema = z.object({
  sourceId: z.string().optional(),
  sourceIds: z.array(z.string()).optional(),
  sources: z.array(CanonicalDocumentSchema).optional(),
  gameType: CreatableGameTypeEnum,
  difficulty: DifficultyEnum.optional(),
  scoringMode: ScoringModeEnum.optional(),
  questionCount: z.number().int().min(1).max(100).default(5).optional(),
  timePerQuestion: z.number().int().min(5).max(120).default(20).optional(),
  title: z.string().trim().min(1, 'Tên game không được để trống').max(100, 'Tên game không được vượt quá 100 ký tự').optional(),
  topicFocus: z.string().trim().max(300).optional(),
  sectionFilter: z.array(z.string().trim().min(1)).optional(),
  mixedDistribution: MixedQuestionDistributionSchema.optional(),
  industryId: IndustryIdEnum.optional(),
  customIndustryName: z.string().trim().max(120).optional(),
  adventureSelectionMode: z.enum(['AI_DETECT', 'MANUAL']).optional(),
  adventureConfig: GenerateAdventureConfigInputSchema.optional(),

}).refine(
  data => {
    const hasValidSourceId =
      typeof data.sourceId === 'string' && data.sourceId.trim().length > 0;
    const hasValidSourceIds =
      Array.isArray(data.sourceIds) &&
      data.sourceIds.some(id => typeof id === 'string' && id.trim().length > 0);
    const hasValidSources =
      Array.isArray(data.sources) &&
      data.sources.length > 0 &&
      data.sources.some(s => typeof s?.sourceId === 'string' && s.sourceId.trim().length > 0);
    return hasValidSourceId || hasValidSourceIds || hasValidSources;
  },
  {
    message: 'Either "sourceId", "sourceIds", or "sources" must be provided.',
    path: ['sourceId'],
  }
);
export type GenerateGameRequest = z.infer<typeof GenerateGameRequestSchema>;

export const UpdateGameQuestionsRequestSchema = z.object({
  title: z.string().trim().min(1, 'Tên game không được để trống').max(100, 'Tên game không được vượt quá 100 ký tự').optional(),
  description: z.string().trim().max(1000).optional(),
  questions: z.array(GameQuestionSchema).min(1).max(100),
  settings: z
    .object({
      timePerQuestion: z.number().int().min(5).max(120).optional(),
      adventureConfig: GenerateAdventureConfigInputSchema.optional(),
      scoringMode: ScoringModeEnum.optional(),
      mixedDistribution: MixedQuestionDistributionSchema.optional(),
    
    })
    .optional(),
  isPublic: z.boolean().optional(),
});
export type UpdateGameQuestionsRequest = z.infer<typeof UpdateGameQuestionsRequestSchema>;
