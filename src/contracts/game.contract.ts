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

    const normalizedChoiceTexts = data.choices.map(c =>
      c.replace(/^[A-Da-d0-9][\.\)]\s*/, '').trim().toLowerCase()
    );
    const uniqueChoices = new Set(normalizedChoiceTexts);
    if (uniqueChoices.size !== 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MULTIPLE_CHOICE choices must be distinct (no duplicate choices).',
        path: ['choices'],
      });
      return;
    }

    const cleanAnswer = data.correctAnswer.trim().toLowerCase();
    const answerMatchesChoice = data.choices.some(c => {
      const choiceLower = c.trim().toLowerCase();
      return (
        choiceLower === cleanAnswer ||
        choiceLower.startsWith(`${cleanAnswer}.`) ||
        choiceLower.startsWith(`${cleanAnswer})`) ||
        cleanAnswer.startsWith(choiceLower)
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
    if (!data.choices || data.choices.length !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'QUICK_BUTTON question must have exactly 2 choices: ["Đúng", "Sai"].',
        path: ['choices'],
      });
    } else if (data.choices[0] !== 'Đúng' || data.choices[1] !== 'Sai') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'QUICK_BUTTON choices must be exactly ["Đúng", "Sai"].',
        path: ['choices'],
      });
    }

    if (data.correctAnswer !== 'Đúng' && data.correctAnswer !== 'Sai') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'QUICK_BUTTON correctAnswer must be either "Đúng" or "Sai".',
        path: ['correctAnswer'],
      });
    }
  }

  if (data.type === 'CROSSWORD') {
    const word = data.crosswordAnswer || data.correctAnswer;
    const asciiNormalized = word
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/\s+/g, '');
    if (!/^[A-Za-z0-9]+$/.test(asciiNormalized)) {
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
  description: z.string().trim().min(1).max(1000).optional(),
  questions: z.array(GameQuestionSchema).min(1).max(20),
});
export type UpdateGameQuestionsRequest = z.infer<typeof UpdateGameQuestionsRequestSchema>;



