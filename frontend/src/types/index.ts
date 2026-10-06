export type GameType = 'MULTIPLE_CHOICE' | 'FILL_IN_THE_BLANK' | 'QUICK_BUTTON' | 'CROSSWORD';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type ScoringMode = 'STANDARD' | 'SPEED_BONUS' | 'STREAK';

export interface ProvenanceReference {
  sourceId: string;
  sourceType: 'WEBSITE' | 'DOCX' | 'XLSX' | 'PDF';
  sourceLocation: string;
  page?: number;
  sheet?: string;
  row?: number;
  sectionHeading?: string;
}

export interface GameQuestion {
  id: string;
  type: GameType;
  question: string;
  choices?: string[];
  correctAnswer: string;
  acceptedAlternatives?: string[];
  explanation?: string;
  difficulty: Difficulty;
  crosswordClue?: string;
  crosswordAnswer?: string;
  sourceReference: ProvenanceReference;
}

export interface GameSpecification {
  gameId: string;
  title: string;
  description: string;
  gameType: GameType;
  questions: GameQuestion[];
  settings: {
    questionCount: number;
    timePerQuestion: number;
    scoringMode: ScoringMode;
  };
  sourceSummary?: {
    sourceCount: number;
    sources: any[];
  };
  generatedAt: string;
}

export interface SanitizedQuestion {
  id: string;
  type: GameType;
  question: string;
  choices?: string[];
  difficulty: Difficulty;
  crosswordClue?: string;
  questionIndex: number;
  totalQuestions: number;
  timePerQuestion: number;
  deadlineAt?: number;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  displayName: string;
  score: number;
  correctCount: number;
  streak: number;
  totalResponseTimeMs: number;
  connected: boolean;
}

export interface PlayerQuestionResult {
  questionId: string;
  answer: string;
  isCorrect: boolean;
  pointsEarned: number;
  responseTimeMs: number;
  answeredAt: number;
}

export interface IngestedSource {
  sourceId: string;
  sourceType: string;
  sourceName: string;
  sourceLocation: string;
  metadata?: {
    characterCount?: number;
  };
  tokenEstimate?: number;
}

export interface CreateRoomResponse {
  roomId: string;
  roomCode: string;
  hostToken: string;
  joinUrl: string;
  capacity: number;
}

export interface QrResponse {
  roomCode: string;
  joinUrl: string;
  qrDataUrl: string;
}

