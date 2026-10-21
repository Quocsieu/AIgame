import { z } from 'zod';
import {
  CanonicalDocument,
  CanonicalDocumentSchema,
  ProvenanceReferenceSchema,
  SourceTypeEnum,
} from './canonical.contract.js';

export const QuestionTypeEnum = z.enum([
  'MULTIPLE_CHOICE',
  'FILL_IN_THE_BLANK',
  'QUICK_BUTTON',
  'CROSSWORD',
]);
export type QuestionType = z.infer<typeof QuestionTypeEnum>;

export const GameTypeEnum = z.enum([
  'MULTIPLE_CHOICE',
  'FILL_IN_THE_BLANK',
  'QUICK_BUTTON',
  'CROSSWORD',
  'MIXED',
]);
export type GameType = z.infer<typeof GameTypeEnum>;

export const DifficultyEnum = z.enum(['EASY', 'MEDIUM', 'HARD']);
export type Difficulty = z.infer<typeof DifficultyEnum>;

export const ScoringModeEnum = z.enum(['STANDARD', 'SPEED_BONUS', 'STREAK']);
export type ScoringMode = z.infer<typeof ScoringModeEnum>;

export const MAX_ANSWER_LENGTH = 500;

function normalizeChoiceCompare(text: string): string {
  return text.trim().normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
}

function stripOptionLetterPrefix(text: string): string {
  return normalizeChoiceCompare(text.replace(/^[A-Da-d][\.\)]\s*/, ''));
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
});

export const GameQuestionSchema = BaseQuestionSchema.superRefine((data, ctx) => {
  if (data.type === 'MULTIPLE_CHOICE') {
    if (!data.choices || data.choices.length !== 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MULTIPLE_CHOICE question must have exactly 4 choices.',
        path: ['choices'],
      });
      return;
    }

    const normalizedChoiceTexts = data.choices.map(c => stripOptionLetterPrefix(c));
    const uniqueChoices = new Set(normalizedChoiceTexts);
    if (uniqueChoices.size !== 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MULTIPLE_CHOICE choices must be distinct (no duplicate choices).',
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
        message: `MULTIPLE_CHOICE correct answer "${data.correctAnswer}" does not match any of the provided choices.`,
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
    if (!normalizedButtons.includes(normCorrect)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `QUICK_BUTTON correctAnswer "${data.correctAnswer}" must match one of the provided choices.`,
        path: ['correctAnswer'],
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

export const GameSettingsSchema = z.object({
  questionCount: z.number().int().min(1).max(20).default(5),
  timePerQuestion: z.number().int().min(5).max(120).default(20),
  scoringMode: ScoringModeEnum.default('STANDARD'),
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
  title: z.string().min(1),
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
  gameType: GameTypeEnum,
  difficulty: DifficultyEnum.optional(),
  scoringMode: ScoringModeEnum.optional(),
  questionCount: z.number().int().min(1).max(20).default(5).optional(),
  timePerQuestion: z.number().int().min(5).max(120).default(20).optional(),
  title: z.string().min(1).optional(),
  topicFocus: z.string().trim().max(300).optional(),
  sectionFilter: z.array(z.string().trim().min(1)).optional(),
}).refine(data => data.sourceId || (data.sourceIds && data.sourceIds.length > 0) || (data.sources && data.sources.length > 0), {
  message: 'Either "sourceId", "sourceIds", or "sources" must be provided.',
  path: ['sourceId'],
});
export type GenerateGameRequest = z.infer<typeof GenerateGameRequestSchema>;

export const UpdateGameQuestionsRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  questions: z.array(GameQuestionSchema).min(1).max(20),
  settings: z
    .object({
      timePerQuestion: z.number().int().min(5).max(120).optional(),
      scoringMode: ScoringModeEnum.optional(),
    })
    .optional(),
  isPublic: z.boolean().optional(),
});
export type UpdateGameQuestionsRequest = z.infer<typeof UpdateGameQuestionsRequestSchema>;



