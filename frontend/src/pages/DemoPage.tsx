import React, { useEffect, useRef, useState } from 'react';
import { GameModeSelectionModal } from '../components/GameModeSelectionModal.js';
import { SoloPlayer } from '../components/SoloPlayer.js';

import {
  applyPresetToAdventureConfig, buildDefaultAdventureConfig,
  INDUSTRY_CATALOG,
  syncAdventureStagesWithQuestions,
} from '../config/adventureThemes.js';
import { GameTypeSelector } from '../components/GameTypeSelector.js';
const LegacyConfiguratorNoop: React.FC<{ onChange?: (nextCfg: AdventureConfig) => void; [key: string]: any }> = () => null;
import { useToast } from '../components/ToastContext.js';
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  CheckIcon,
  CircleShapeIcon,
  ClockIcon,
  CopyIcon,
  DiamondIcon,
  FileTextIcon,
  FlameIcon,
  GamepadIcon,
  GlobeIcon,
  HomeIcon,
  InfoIcon,
  LockIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  SparklesIcon,
  SpinnerIcon,
  SquareShapeIcon,
  StarIcon,
  TrashIcon,
  TriangleIcon,
  TrophyIcon,
  UploadIcon,
  UsersIcon,
  XMarkIcon,
} from '../components/Icons.js';
import {
  createPracticeSession,
  createRoom,
  downloadGameExport,
  fetchRoomQr,
  generateGame,
  ingestSources,
  analyzeAdventureContextApi,
  retryAdventureAssetsApi,
  saveEditedQuestions,
  uploadCustomAudioApi,
  fetchGameParticipantsApi,
  upsertGameParticipantsApi,
  deleteGameParticipantApi,
  clearGameParticipantsApi,
  grantParticipantRetakeApi,
  publishExamAnswersApi,
  closeGameExamApi,
  reopenGameExamApi,
  fetchGameScoreboardApi,
  downloadGameScoreboardExport,
  parseRosterFileApi,
  type RosterParsePreviewResult,
} from '../services/api.js';
import {
  SOUND_PACK_CATALOG,
  SFX_CUE_CATALOG,
  mapSoundPackToPresetId,
  normalizeGameAudioConfig,
  resolveSoundPackDefinition,
  soundManager,
} from '../services/audio.js';
import {
  buildDefaultQuestionDistributionForTypes,
  calculateMixedTypeCounts,
  type AuthenticatedUser,
  type Difficulty,
  type GameQuestion,
  type GameSpecification,
  type GameType,
  type IngestedSource,
  type MixedQuestionDistribution,
  type ProvenanceReference,
  type AdventureConfig,
  type IndustryId,
  type QuestionType,
  type ScoringMode,
  type SessionMode,
  type RosterMode,
  type OfficialAttemptPolicy,
  type GameAudioConfig,
  type SoundPackId,
  type SfxCueType,
  type ParticipantRosterItem,
  type GameScoreboardSummary,
} from '../types/index.js';

interface DemoPageProps {
  onNavigateToHost?: (roomCode: string, hostToken: string) => void;
  onNavigateToPlay?: (roomCode: string) => void;
  onNavigateToSoloPlay?: (spec: GameSpecification) => void;
  onNavigateToSoloPresentation?: (spec: GameSpecification) => void;
  initialSpec?: GameSpecification | null;
  onCurrentSpecChange?: (spec: GameSpecification | null) => void;
  autoStartSoloPlay?: boolean;
  onExitSoloPlay?: () => void;
  onNavigateToLibrary?: () => void;
  initialGameType?: GameType;
  initialSourceTab?: 'URL' | 'FILE' | 'TOPIC';
  onBackToHome?: () => void;
}

const CREATOR_CURRENT_SESSION_KEY = 'ai_game_creator_current_session_v1';

interface CreatorSessionSnapshot {
  spec: GameSpecification;
  saveStatus: 'unsaved' | 'saved' | 'dirty';
  savedForLater: boolean;
  customGameTitle: string;
}

const readCreatorSessionSnapshot = (): CreatorSessionSnapshot | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CREATOR_CURRENT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      parsed.spec &&
      typeof parsed.spec.gameId === 'string' &&
      Array.isArray(parsed.spec.questions) &&
      parsed.spec.questions.length > 0
    ) {
      return {
        spec: parsed.spec as GameSpecification,
        saveStatus:
          parsed.saveStatus === 'saved' || parsed.saveStatus === 'dirty'
            ? parsed.saveStatus
            : 'unsaved',
        savedForLater: Boolean(parsed.savedForLater),
        customGameTitle:
          typeof parsed.customGameTitle === 'string' && parsed.customGameTitle.trim().length > 0
            ? parsed.customGameTitle
            : parsed.spec.title || '',
      };
    }
  } catch {
    // Ignore sessionStorage read errors
  }
  return null;
};

const writeCreatorSessionSnapshot = (snapshot: CreatorSessionSnapshot | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (!snapshot) {
      window.sessionStorage.removeItem(CREATOR_CURRENT_SESSION_KEY);
    } else {
      window.sessionStorage.setItem(CREATOR_CURRENT_SESSION_KEY, JSON.stringify(snapshot));
    }
  } catch {
    // Ignore sessionStorage quota/write errors
  }
};

const MAX_URLS = 5;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_TOTAL_FILE_BYTES = 25 * 1024 * 1024; // 25 MB total across all files

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatGameTypeLabel = (type: string): string => {
  switch (type) {
    case 'QUIZ':
    case 'MULTIPLE_CHOICE':
      return 'Trắc nghiệm 4 lựa chọn';
    case 'TRUE_FALSE':
    case 'QUICK_BUTTON':
      return 'Đúng hoặc Sai';
    case 'TYPE_ANSWER':
    case 'FILL_IN_THE_BLANK':
      return 'Điền vào chỗ trống';
    case 'PUZZLE':
      return 'Sắp xếp thứ tự';
    case 'SLIDER':
      return 'Thanh trượt giá trị';
    case 'CROSSWORD':
      return 'Ô chữ từ khóa';
    case 'MIXED':
      return 'Hỗn hợp';
    case 'ADVENTURE':
      return 'Đi cảnh theo ngành nghề';
    default:
      return type;
  }
};

const formatScoringModeLabel = (mode: ScoringMode): string => {
  switch (mode) {
    case 'STANDARD':
      return 'Điểm chuẩn (100đ/câu)';
    case 'SPEED_BONUS':
      return 'Thưởng tốc độ (+50đ tối đa)';
    case 'STREAK':
      return 'Chuỗi liên tiếp (Streak Bonus)';
    default:
      return mode;
  }
};

const normalizeCrosswordAscii = (text: string): string =>
  text
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/\s+/g, '');

const formatProvenanceBadge = (ref?: ProvenanceReference): string => {
  if (!ref) return 'Nguồn tài liệu';
  const parts: string[] = [];
  if (ref.sourceLocation) {
    parts.push(ref.sourceLocation);
  }
  const sectionName = ref.section || ref.sectionHeading;
  if (sectionName) {
    parts.push(`Mục: ${sectionName}`);
  }
  if (typeof ref.page === 'number') {
    parts.push(`Trang ${ref.page}`);
  }
  if (ref.sheet) {
    parts.push(`Sheet: ${ref.sheet}`);
  }
  if (typeof ref.row === 'number') {
    parts.push(`Dòng ${ref.row}`);
  }
  return parts.join(' • ') || ref.sourceType;
};

const MAX_ANSWER_LENGTH = 500;

const normalizeChoiceCompare = (text: string): string =>
  text.trim().normalize('NFC').toLowerCase().replace(/\s+/g, ' ');

const stripOptionLetterPrefix = (text: string): string =>
  normalizeChoiceCompare(text.replace(/^[A-Da-d][\.\)]\s*/, ''));

const validateQuestionItem = (q: GameQuestion): string | null => {
  if (!q.question || q.question.trim().length < 3) {
    return 'Nội dung câu hỏi phải có ít nhất 3 ký tự.';
  }
  if (!q.correctAnswer || q.correctAnswer.trim().length === 0) {
    return 'Đáp án đúng không được để trống.';
  }

  if (q.type === 'MULTIPLE_CHOICE' || q.type === 'QUIZ') {
    if (!q.choices || q.choices.length !== 4) {
      return 'Câu hỏi Quiz phải có đúng 4 lựa chọn.';
    }
    if (q.choices.some(c => !c || c.trim().length === 0)) {
      return 'Không được để trống bất kỳ lựa chọn A, B, C, D nào.';
    }
    const normalizedTexts = q.choices.map(c => stripOptionLetterPrefix(c));
    if (new Set(normalizedTexts).size !== 4) {
      return '4 lựa chọn A, B, C, D phải khác nhau (không được trùng lặp).';
    }
    const trimmedAns = q.correctAnswer.trim();
    const upperLetter = trimmedAns.toUpperCase().replace(/^([A-D])[\.\)]$/, '$1');
    const isLetterKey = ['A', 'B', 'C', 'D'].includes(upperLetter);
    const normAns = normalizeChoiceCompare(trimmedAns);
    const strippedAns = stripOptionLetterPrefix(trimmedAns);

    const matchesChoice =
      isLetterKey ||
      q.choices.some(c => {
        const normC = normalizeChoiceCompare(c);
        const strippedC = stripOptionLetterPrefix(c);
        return normC === normAns || (strippedC.length > 0 && strippedC === strippedAns);
      });
    if (!matchesChoice) {
      return `Đáp án đúng "${q.correctAnswer}" phải khớp với một trong 4 lựa chọn A, B, C, D.`;
    }
  }

  if (q.type === 'QUICK_BUTTON' || q.type === 'TRUE_FALSE') {
    if (!q.choices || q.choices.length < 2 || q.choices.length > 4) {
      return 'Câu hỏi True/False phải có 2 lựa chọn (Đúng / Sai).';
    }
    const normButtons = q.choices.map(c => normalizeChoiceCompare(c));
    if (normButtons.some(c => c.length === 0)) {
      return 'Các lựa chọn không được để trống.';
    }
    if (new Set(normButtons).size !== q.choices.length) {
      return 'Các lựa chọn phải khác nhau.';
    }
    const normAns = normalizeChoiceCompare(q.correctAnswer);
    if (!normButtons.includes(normAns)) {
      return `Đáp án đúng "${q.correctAnswer}" phải khớp với một trong các nút lựa chọn.`;
    }
  }

  if (q.type === 'PUZZLE') {
    if (!q.choices || q.choices.length < 3 || q.choices.length > 6) {
      return 'Câu hỏi Puzzle phải có từ 3 đến 6 mục cần sắp xếp.';
    }
    const normItems = q.choices.map(c => normalizeChoiceCompare(c));
    if (normItems.some(c => c.length === 0)) {
      return 'Không được để trống mục nào trong danh sách sắp xếp Puzzle.';
    }
    if (new Set(normItems).size !== q.choices.length) {
      return 'Các mục trong câu hỏi Puzzle phải khác nhau (không trùng lặp).';
    }
  }

  if (q.type === 'SLIDER') {
    const cfg = q.sliderConfig;
    if (!cfg) {
      return 'Câu hỏi Slider bắt buộc phải có cấu hình thanh trượt (sliderConfig).';
    }
    if (!Number.isFinite(cfg.min) || !Number.isFinite(cfg.max) || cfg.min >= cfg.max) {
      return 'Giá trị Min phải nhỏ hơn giá trị Max trên thanh trượt.';
    }
    const range = cfg.max - cfg.min;
    if (!Number.isFinite(cfg.step) || cfg.step <= 0 || cfg.step > range) {
      return 'Bước nhảy (Step) phải lớn hơn 0 và không vượt quá khoảng (Max - Min).';
    }
    if (!Number.isFinite(cfg.correctValue) || cfg.correctValue < cfg.min || cfg.correctValue > cfg.max) {
      return `Giá trị đúng (${cfg.correctValue}) phải nằm trong khoảng [${cfg.min}, ${cfg.max}].`;
    }
    const stepsFromMin = (cfg.correctValue - cfg.min) / cfg.step;
    if (Math.abs(stepsFromMin - Math.round(stepsFromMin)) > 1e-4) {
      return 'Giá trị đúng phải khớp với bước nhảy từ Min (Min + k × Step).';
    }
    if (!Number.isFinite(cfg.tolerance) || cfg.tolerance < 0 || cfg.tolerance >= range) {
      return 'Sai số cho phép (Tolerance) phải >= 0 và nhỏ hơn khoảng (Max - Min).';
    }
  }

  if (q.type === 'CROSSWORD') {
    const rawWord = q.crosswordAnswer || q.correctAnswer;
    const parts = rawWord
      .split(/[|;]/)
      .map(part => normalizeCrosswordAscii(part))
      .filter(Boolean);
    if (parts.length === 0 || !parts.every(p => /^[A-Z0-9]+$/.test(p))) {
      return 'Từ khóa Ô chữ phải chỉ gồm chữ cái và chữ số (không chứa ký tự đặc biệt).';
    }
  }

  return null;
};

export const DemoPage: React.FC<DemoPageProps> = ({
  onNavigateToHost,
  onNavigateToPlay,
  onNavigateToSoloPlay,
  onNavigateToSoloPresentation,
  initialSpec,
  onCurrentSpecChange,
  autoStartSoloPlay,
  onExitSoloPlay,
  onNavigateToLibrary,
  initialGameType,
  initialSourceTab,
  onBackToHome,
}) => {
  const toast = useToast();
  const initialSessionSnapRef = useRef<CreatorSessionSnapshot | null>(readCreatorSessionSnapshot());
  const effectiveBootSpec: GameSpecification | null =
    initialSpec &&
    initialSessionSnapRef.current &&
    initialSessionSnapRef.current.spec.gameId === initialSpec.gameId
      ? initialSessionSnapRef.current.spec
      : initialSpec || initialSessionSnapRef.current?.spec || null;
  const effectiveBootSaveStatus: 'unsaved' | 'saved' | 'dirty' =
    initialSpec &&
    (!initialSessionSnapRef.current ||
      initialSessionSnapRef.current.spec.gameId !== initialSpec.gameId)
      ? 'saved'
      : initialSessionSnapRef.current?.saveStatus || (initialSpec ? 'saved' : 'unsaved');
  const effectiveBootSavedForLater: boolean =
    initialSpec &&
    (!initialSessionSnapRef.current ||
      initialSessionSnapRef.current.spec.gameId !== initialSpec.gameId)
      ? true
      : Boolean(initialSessionSnapRef.current?.savedForLater || initialSpec);
  const syncedGameIdRef = useRef<string | null>(effectiveBootSpec?.gameId || null);

  // Multi-source state (Batch 4 & Batch 8)
  const [urls, setUrls] = useState<string[]>(['']);
  const [files, setFiles] = useState<File[]>([]);
  const [sourceTab, setSourceTab] = useState<'URL' | 'FILE' | 'TOPIC'>(initialSourceTab || 'URL');

  useEffect(() => {
    if (initialSourceTab) {
      setSourceTab(initialSourceTab);
    }
  }, [initialSourceTab]);

  // Tên game bắt buộc
  const [customGameTitle, setCustomGameTitle] = useState(
    () =>
      (effectiveBootSpec
        ? initialSessionSnapRef.current?.spec.gameId === effectiveBootSpec.gameId
          ? initialSessionSnapRef.current.customGameTitle
          : effectiveBootSpec.title
        : '') || ''
  );

  // AI configuration state (Batch 4 & Batch 5)
  const [gameType, setGameType] = useState<GameType>(
    () => initialGameType || effectiveBootSpec?.gameType || 'MULTIPLE_CHOICE'
  );

  useEffect(() => {
    if (initialGameType) {
      setGameType(initialGameType);
    }
  }, [initialGameType]);
  const [difficulty, setDifficulty] = useState<Difficulty>('MEDIUM');
  const [scoringMode, setScoringMode] = useState<ScoringMode>(
    () => effectiveBootSpec?.settings?.scoringMode || 'STANDARD'
  );
  const [questionCount, setQuestionCount] = useState(
    () => effectiveBootSpec?.questions?.length || 5
  );
  const [timePerQuestion, setTimePerQuestion] = useState(
    () => effectiveBootSpec?.settings?.timePerQuestion || 20
  );
  // V2 Settings State (Phase 1, 2, 4)
  const [sessionMode, setSessionMode] = useState<SessionMode>(
    () => effectiveBootSpec?.settings?.sessionMode || 'PLAY'
  );
  const [passThresholdPercent, setPassThresholdPercent] = useState<number>(
    () => effectiveBootSpec?.settings?.passThresholdPercent ?? 50
  );
  const [officialAttemptPolicy, setOfficialAttemptPolicy] = useState<OfficialAttemptPolicy>(
    () =>
      effectiveBootSpec?.settings?.officialAttemptPolicy ||
      (effectiveBootSpec?.settings?.sessionMode === 'EXAM' ? 'LATEST_ATTEMPT' : 'HIGHEST_SCORE')
  );
  const [rosterMode, setRosterMode] = useState<RosterMode>(
    () => effectiveBootSpec?.settings?.rosterMode || 'FREE_TEXT'
  );
  const normalizeCreatorAudioConfig = (raw?: Partial<GameAudioConfig> | null): GameAudioConfig => {
    return normalizeGameAudioConfig(raw);
  };

  const [audioConfig, setAudioConfig] = useState<GameAudioConfig>(() =>
    normalizeCreatorAudioConfig(effectiveBootSpec?.settings?.audioConfig)
  );
  const [isAudioPreviewPlaying, setIsAudioPreviewPlaying] = useState<boolean>(false);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(() => soundManager.isMuted());
  const [isUploadingAudio, setIsUploadingAudio] = useState<boolean>(false);
  const [uploadingSfxCue, setUploadingSfxCue] = useState<SfxCueType | null>(null);

  // V2/V3 BTC Roster & Scoreboard Manager State + Inline Creator Roster State
  const [isBtcModalOpen, setIsBtcModalOpen] = useState<boolean>(false);
  const [btcActiveTab, setBtcActiveTab] = useState<'ROSTER' | 'SCOREBOARD'>('ROSTER');
  const [btcParticipants, setBtcParticipants] = useState<ParticipantRosterItem[]>([]);
  const [btcRosterPasteText, setBtcRosterPasteText] = useState<string>('');
  const [btcScoreboard, setBtcScoreboard] = useState<GameScoreboardSummary | null>(null);
  const [isLoadingBtcData, setIsLoadingBtcData] = useState<boolean>(false);
  const [isSavingRoster, setIsSavingRoster] = useState<boolean>(false);
  const [isPublishingAnswers, setIsPublishingAnswers] = useState<boolean>(false);
  const [isClosingExam, setIsClosingExam] = useState<boolean>(false);
  const [confirmCloseExamOpen, setConfirmCloseExamOpen] = useState<boolean>(false);
  const [creatorRosterTab, setCreatorRosterTab] = useState<'MANUAL' | 'IMPORT'>('MANUAL');
  const [creatorRosterSingleName, setCreatorRosterSingleName] = useState<string>('');
  const [creatorRosterSingleDept, setCreatorRosterSingleDept] = useState<string>('');
  const [creatorRosterSingleError, setCreatorRosterSingleError] = useState<string | null>(null);
  const [creatorRosterImportPreview, setCreatorRosterImportPreview] =
    useState<RosterParsePreviewResult | null>(null);
  const [isParsingRosterFile, setIsParsingRosterFile] = useState<boolean>(false);
  const [showExamRosterError, setShowExamRosterError] = useState<boolean>(false);
  const [editingRosterRowIdx, setEditingRosterRowIdx] = useState<number | null>(null);
  const [editingRosterRowName, setEditingRosterRowName] = useState<string>('');
  const [editingRosterRowDept, setEditingRosterRowDept] = useState<string>('');
  const loadedRosterGameIdRef = useRef<string | null>(null);

  const formatParticipantsToPasteText = (items: Array<{
    fullName: string;
    departmentUnit?: string | null;
    employeeCode?: string | null;
    contactInfo?: string | null;
  }>): string => {
    return items
      .map((item) => {
        const parts = [
          (item.fullName || '').replace(/\s+/g, ' ').trim(),
          (item.departmentUnit || '').replace(/\s+/g, ' ').trim(),
          (item.employeeCode || '').replace(/\s+/g, ' ').trim(),
          (item.contactInfo || '').replace(/\s+/g, ' ').trim(),
        ];
        while (parts.length > 1 && !parts[parts.length - 1]) {
          parts.pop();
        }
        return parts.join(' | ');
      })
      .filter(Boolean)
      .join('\n');
  };

  const parsedRosterDraft = React.useMemo(() => {
    const rawLines = btcRosterPasteText.split(/\r?\n/);
    const validItems: Array<{
      lineIndex: number;
      lineNumber: number;
      participantId?: string;
      fullName: string;
      departmentUnit?: string;
      employeeCode?: string;
      contactInfo?: string;
    }> = [];
    const invalidLines: Array<{
      lineNumber: number;
      rawLine: string;
      reason: string;
    }> = [];
    const usedParticipantIds = new Set<string>();
    const nameCounts = new Map<string, number>();

    rawLines.forEach((rawLine, idx) => {
      const trimmed = rawLine.trim();
      if (!trimmed) return;
      const lineNumber = idx + 1;
      const parts = trimmed.split(/[|\t,;]/).map((p) => p.replace(/\s+/g, ' ').trim());
      const fullName = parts[0] || '';
      const departmentUnit = parts[1] || '';
      const employeeCode = parts[2] || '';
      const contactInfo = parts[3] || '';

      if (fullName.length < 2) {
        invalidLines.push({
          lineNumber,
          rawLine: trimmed,
          reason: 'Họ tên quá ngắn (tối thiểu 2 ký tự)',
        });
        return;
      }
      if (!/\p{L}/u.test(fullName)) {
        invalidLines.push({
          lineNumber,
          rawLine: trimmed,
          reason: 'Họ tên phải chứa chữ cái hợp lệ',
        });
        return;
      }

      const normFullKey = `${fullName.toLowerCase()}|${departmentUnit.toLowerCase()}|${employeeCode.toLowerCase()}`;
      const normNameOnly = fullName.toLowerCase();
      let matchedExisting = btcParticipants.find(
        (p) =>
          !usedParticipantIds.has(p.participantId) &&
          `${(p.fullName || '').replace(/\s+/g, ' ').trim().toLowerCase()}|${(p.departmentUnit || '').replace(/\s+/g, ' ').trim().toLowerCase()}|${(p.employeeCode || '').replace(/\s+/g, ' ').trim().toLowerCase()}` ===
            normFullKey
      );
      if (!matchedExisting) {
        matchedExisting = btcParticipants.find(
          (p) =>
            !usedParticipantIds.has(p.participantId) &&
            (p.fullName || '').replace(/\s+/g, ' ').trim().toLowerCase() === normNameOnly
        );
      }
      if (matchedExisting) {
        usedParticipantIds.add(matchedExisting.participantId);
      }

      nameCounts.set(normNameOnly, (nameCounts.get(normNameOnly) || 0) + 1);
      validItems.push({
        lineIndex: idx,
        lineNumber,
        participantId: matchedExisting?.participantId,
        fullName,
        departmentUnit: departmentUnit || undefined,
        employeeCode: employeeCode || undefined,
        contactInfo: contactInfo || undefined,
      });
    });

    const duplicateNames: string[] = [];
    let duplicateCount = 0;
    for (const [normKey, count] of nameCounts.entries()) {
      if (count > 1) {
        duplicateCount += count - 1;
        const sample =
          validItems.find((it) => it.fullName.toLowerCase() === normKey)?.fullName || normKey;
        duplicateNames.push(sample);
      }
    }

    return {
      validItems,
      invalidLines,
      duplicateNames,
      duplicateCount,
    };
  }, [btcRosterPasteText, btcParticipants]);

  const [topicFocus, setTopicFocus] = useState('');
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [mixedDistribution, setMixedDistribution] = useState<MixedQuestionDistribution>(() =>
    effectiveBootSpec?.settings?.mixedDistribution || {
      MULTIPLE_CHOICE: 40,
      QUICK_BUTTON: 20,
      FILL_IN_THE_BLANK: 20,
      CROSSWORD: 20,
    }
  );

  const [ingestedSources, setIngestedSources] = useState<IngestedSource[]>([]);
  const [generatedSpec, setGeneratedSpec] = useState<GameSpecification | null>(
    () => effectiveBootSpec
  );
  const [editingQuestionIdx, setEditingQuestionIdx] = useState<number | null>(null);
  const [editingQuestionDraft, setEditingQuestionDraft] = useState<GameQuestion | null>(null);
  const [editingQuestionError, setEditingQuestionError] = useState<string | null>(null);
  const [questionPage, setQuestionPage] = useState<number>(1);
  const [isQuestionListCollapsed, setIsQuestionListCollapsed] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'unsaved' | 'saving' | 'saved' | 'dirty' | 'error'>(
    () => effectiveBootSaveStatus
  );
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [isPlaytestOpen, setIsPlaytestOpen] = useState<boolean>(false);
  const [playtestSpec, setPlaytestSpec] = useState<GameSpecification | null>(null);
  const QUESTIONS_PER_PAGE = 10;

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(() =>
    effectiveBootSpec ? 4 : 1
  );

  const [roomCode, setRoomCode] = useState('');
  const [hostToken, setHostToken] = useState('');
  const [joinUrl, setJoinUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');

  const [isIngesting, setIsIngesting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingSpec, setIsSavingSpec] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const isIngestingRef = useRef(false);
  const isGeneratingRef = useRef(false);
  const activeIngestPromiseRef = useRef<Promise<IngestedSource[] | null> | null>(null);

  // Modal Chọn chế độ chơi (Luồng 1 & Luồng 2)
  const [isModeModalOpen, setIsModeModalOpen] = useState(false);
  const [modeModalSpec, setModeModalSpec] = useState<GameSpecification | null>(null);

  // the9bit Creator Studio UX enhancements (Gate 3.2 & 3.3)
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false);
  const [showQuestionEditor, setShowQuestionEditor] = useState(false);
  const [savedForLater, setSavedForLater] = useState(() => effectiveBootSavedForLater);
  const [adventureIndustryMode, setAdventureIndustryMode] = useState<'AI_DETECT' | IndustryId>('AI_DETECT');
  const [customIndustryName, setCustomIndustryName] = useState<string>('');
  const [customSubEnvironment, setCustomSubEnvironment] = useState<string>('');
  const [adventureConfig, setAdventureConfig] = useState<AdventureConfig>(() =>
    effectiveBootSpec?.settings?.adventureConfig
      ? syncAdventureStagesWithQuestions(
          effectiveBootSpec.settings.adventureConfig,
          effectiveBootSpec.questions
        )
      : buildDefaultAdventureConfig('theme_edu_campus', 5)
  );
  const [isReanalyzingAdventure, setIsReanalyzingAdventure] = useState<boolean>(false);
  const [showAdventureFullscreenPreview, setShowAdventureFullscreenPreview] = useState<boolean>(false);
  const [adventureQuestionTypes, setAdventureQuestionTypes] = useState<QuestionType[]>(() =>
    Array.isArray(effectiveBootSpec?.settings?.adventureConfig?.questionTypes) &&
    effectiveBootSpec!.settings.adventureConfig!.questionTypes.length > 0
      ? effectiveBootSpec!.settings.adventureConfig!.questionTypes
      : ['MULTIPLE_CHOICE', 'QUICK_BUTTON']
  );
  const [adventureQuestionDistribution, setAdventureQuestionDistribution] =
    useState<MixedQuestionDistribution>(() =>
      effectiveBootSpec?.settings?.adventureConfig?.questionDistribution || {
        MULTIPLE_CHOICE: 50,
        QUICK_BUTTON: 50,
        FILL_IN_THE_BLANK: 0,
        CROSSWORD: 0,
      }
    );

  const toggleAdventureQuestionType = (qType: QuestionType) => {
    setAdventureQuestionTypes(prev => {
      const next = prev.includes(qType) ? prev.filter(t => t !== qType) : [...prev, qType];
      if (next.length === 0) {
        setAdventureQuestionDistribution({
          MULTIPLE_CHOICE: 0,
          QUICK_BUTTON: 0,
          FILL_IN_THE_BLANK: 0,
          CROSSWORD: 0,
        });
      } else {
        setAdventureQuestionDistribution(buildDefaultQuestionDistributionForTypes(next));
      }
      return next;
    });
  };

  useEffect(() => {
    if (initialSpec && initialSpec.gameId !== syncedGameIdRef.current) {
      syncedGameIdRef.current = initialSpec.gameId;
      loadedRosterGameIdRef.current = null;
      setGeneratedSpec(initialSpec);
      setCustomGameTitle(initialSpec.title || '');
      setGameType(initialSpec.gameType);
      setScoringMode(initialSpec.settings.scoringMode);
      setTimePerQuestion(initialSpec.settings.timePerQuestion);
      setQuestionCount(initialSpec.questions.length);
      if (initialSpec.settings?.sessionMode) {
        setSessionMode(initialSpec.settings.sessionMode);
      }
      if (typeof initialSpec.settings?.passThresholdPercent === 'number') {
        setPassThresholdPercent(initialSpec.settings.passThresholdPercent);
      }
      if (initialSpec.settings?.officialAttemptPolicy) {
        setOfficialAttemptPolicy(initialSpec.settings.officialAttemptPolicy);
      }
      if (initialSpec.settings?.rosterMode) {
        setRosterMode(initialSpec.settings.rosterMode);
      }
      if (initialSpec.settings?.audioConfig) {
        setAudioConfig(normalizeCreatorAudioConfig(initialSpec.settings.audioConfig));
      }
      if (initialSpec.settings?.mixedDistribution) {
        setMixedDistribution(initialSpec.settings.mixedDistribution);
      }
      if (initialSpec.settings?.adventureConfig) {
        const advQTypes =
          Array.isArray(initialSpec.settings.adventureConfig.questionTypes) &&
          initialSpec.settings.adventureConfig.questionTypes.length > 0
            ? initialSpec.settings.adventureConfig.questionTypes
            : (['MULTIPLE_CHOICE', 'QUICK_BUTTON'] as QuestionType[]);
        setAdventureQuestionTypes(advQTypes);
        if (initialSpec.settings.adventureConfig.questionDistribution) {
          setAdventureQuestionDistribution(
            initialSpec.settings.adventureConfig.questionDistribution
          );
        } else {
          setAdventureQuestionDistribution(
            buildDefaultQuestionDistributionForTypes(advQTypes)
          );
        }
        setAdventureConfig(
          syncAdventureStagesWithQuestions(initialSpec.settings.adventureConfig, initialSpec.questions)
        );
      }
      setEditingQuestionIdx(null);
      setEditingQuestionDraft(null);
      setEditingQuestionError(null);
      setQuestionPage(1);
      setIsQuestionListCollapsed(false);
      setSaveStatus('saved');
      setSaveErrorMessage(null);
      setSavedForLater(true);
      setIsPlaytestOpen(false);
      setPlaytestSpec(null);
      setRoomCode('');
      setCurrentStep(4);
      setShowAdventureFullscreenPreview(false);
      writeCreatorSessionSnapshot({
        spec: initialSpec,
        saveStatus: 'saved',
        savedForLater: true,
        customGameTitle: initialSpec.title || '',
      });
    }
  }, [initialSpec]);

  // Tự động tải danh sách người tham gia khi mở lại game đã lưu hoặc khởi tạo trang có sẵn gameId
  useEffect(() => {
    const activeGameId = generatedSpec?.gameId;
    if (!activeGameId || loadedRosterGameIdRef.current === activeGameId) {
      return;
    }
    loadedRosterGameIdRef.current = activeGameId;
    let cancelled = false;
    fetchGameParticipantsApi(activeGameId, { mode: 'admin' })
      .then((res) => {
        if (cancelled) return;
        const loaded = Array.isArray(res.participants) ? res.participants : [];
        setBtcParticipants(loaded);
        if (res.rosterMode) {
          setRosterMode(res.rosterMode);
        }
        if (loaded.length > 0) {
          setBtcRosterPasteText(formatParticipantsToPasteText(loaded));
        }
      })
      .catch(() => {
        // Ignore if new/unpersisted draft
      });
    return () => {
      cancelled = true;
    };
  }, [generatedSpec?.gameId]);

  // Đồng bộ trạng thái âm thanh và dừng phát nhạc nghe thử khi thoát khỏi trang Tạo Game
  useEffect(() => {
    const unsubscribe = soundManager.subscribe(() => {
      setIsAudioPreviewPlaying(soundManager.getIsPreviewing());
      setIsAudioMuted(soundManager.isMuted());
    });
    return () => {
      unsubscribe();
      soundManager.stopPreview();
    };
  }, []);

  const startAudioPreviewWithFeedback = (cfg: GameAudioConfig) => {
    if (cfg.presetId === 'NONE' || cfg.soundPackId === 'NONE' || cfg.enabled === false) {
      soundManager.stopPreview();
      setIsAudioPreviewPlaying(false);
      return;
    }
    if ((cfg.presetId === 'CUSTOM' || cfg.soundPackId === 'CUSTOM') && !cfg.customAudioUrl) {
      soundManager.stopPreview();
      setIsAudioPreviewPlaying(false);
      toast.warning(
        'Vui lòng tải lên tệp âm thanh (.mp3, .wav, .ogg) trước khi nghe thử nhạc tùy chỉnh.',
        'Chưa có tệp nhạc'
      );
      return;
    }
    const started = soundManager.playPreview(cfg, {
      onStateChange: (playing) => {
        setIsAudioPreviewPlaying(playing);
      },
      onError: (msg) => {
        setIsAudioPreviewPlaying(false);
        toast.error(msg, 'Không thể phát âm thanh');
      },
    });
    setIsAudioPreviewPlaying(started);
    setIsAudioMuted(soundManager.isMuted());
  };

  const handleToggleAudioPreview = () => {
    if (isAudioPreviewPlaying || soundManager.getIsPreviewing()) {
      soundManager.stopPreview();
      setIsAudioPreviewPlaying(false);
    } else {
      startAudioPreviewWithFeedback(audioConfig);
    }
  };

  const handleStopAudioPreview = () => {
    soundManager.stopPreview();
    setIsAudioPreviewPlaying(false);
  };

  const handleToggleCreatorAudioMute = () => {
    const nextMuted = soundManager.toggleMute();
    setIsAudioMuted(nextMuted);
  };

  const handleCreatorAudioVolumeChange = (volPercent: number) => {
    const clampedPercent = Math.max(0, Math.min(100, Math.round(volPercent)));
    const normalizedVol = Number((clampedPercent / 100).toFixed(2));
    soundManager.setVolume(clampedPercent);
    if (isAudioMuted && clampedPercent > 0) {
      soundManager.setMuted(false);
      setIsAudioMuted(false);
    }
    const nextCfg: GameAudioConfig = {
      ...audioConfig,
      volume: normalizedVol,
    };
    setAudioConfig(nextCfg);
    if (generatedSpec) {
      setGeneratedSpec((prev) =>
        prev
          ? {
              ...prev,
              settings: {
                ...prev.settings,
                audioConfig: nextCfg,
              },
            }
          : prev
      );
      setSavedForLater(false);
      setSaveStatus('dirty');
    }
  };

  const handleCustomAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsUploadingAudio(true);
    try {
      const uploaded = await uploadCustomAudioApi(file);
      const nextCfg: GameAudioConfig = {
        ...audioConfig,
        enabled: true,
        bgmEnabled: true,
        presetId: 'CUSTOM',
        soundPackId:
          audioConfig.soundPackId && audioConfig.soundPackId !== 'NONE'
            ? audioConfig.soundPackId
            : 'ARCADE_FUN',
        customAudioUrl: uploaded.audioUrl,
        customAudioName: uploaded.fileName,
      };
      setAudioConfig(nextCfg);
      if (isAudioPreviewPlaying || soundManager.getIsPreviewing()) {
        startAudioPreviewWithFeedback(nextCfg);
      }
      if (generatedSpec) {
        setGeneratedSpec((prev) =>
          prev
            ? {
                ...prev,
                settings: {
                  ...prev.settings,
                  audioConfig: nextCfg,
                },
              }
            : prev
        );
        setSavedForLater(false);
        setSaveStatus('dirty');
      }
      toast.success(`Đã tải lên nhạc nền "${uploaded.fileName}" thành công!`, 'Tải nhạc thành công');
    } catch (err: any) {
      toast.error(err.message || 'Không thể tải tệp âm thanh lên.', 'Lỗi tải tệp âm thanh');
    } finally {
      setIsUploadingAudio(false);
    }
  };

  const handleCustomSfxOverrideUpload = async (
    cue: SfxCueType,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploadingSfxCue(cue);
    try {
      const uploaded = await uploadCustomAudioApi(file);
      const nextOverrides = {
        ...(audioConfig.customSfxOverrides || {}),
        [cue]: {
          url: uploaded.audioUrl,
          audioUrl: uploaded.audioUrl,
          fileName: uploaded.fileName,
        },
      };
      const nextCfg: GameAudioConfig = {
        ...audioConfig,
        enabled: true,
        sfxEnabled: true,
        customSfxOverrides: nextOverrides,
      };
      setAudioConfig(nextCfg);
      if (generatedSpec) {
        setGeneratedSpec((prev) =>
          prev
            ? {
                ...prev,
                settings: {
                  ...prev.settings,
                  audioConfig: nextCfg,
                },
              }
            : prev
        );
        setSavedForLater(false);
        setSaveStatus('dirty');
      }
      soundManager.previewSfxCue(cue, nextCfg);
      toast.success(
        `Đã tải hiệu ứng tùy chỉnh "${uploaded.fileName}" cho hiệu ứng [${cue}]!`,
        'Tải hiệu ứng thành công'
      );
    } catch (err: any) {
      toast.error(err.message || 'Không thể tải tệp hiệu ứng âm thanh.', 'Lỗi tải âm thanh');
    } finally {
      setUploadingSfxCue(null);
    }
  };

  const applyUpdatedRosterPasteText = (nextText: string) => {
    setBtcRosterPasteText(nextText);
    const hasAnyValid = nextText
      .split(/\r?\n/)
      .map((l) => l.split(/[|\t,;]/)[0]?.replace(/\s+/g, ' ').trim() || '')
      .some((name) => name.length >= 2 && /\p{L}/u.test(name));
    if (hasAnyValid) {
      setShowExamRosterError(false);
    }
    const nextRosterMode: RosterMode =
      sessionMode === 'EXAM'
        ? 'PRECONFIGURED'
        : hasAnyValid
        ? rosterMode === 'HYBRID'
          ? 'HYBRID'
          : 'PRECONFIGURED'
        : 'FREE_TEXT';
    setRosterMode(nextRosterMode);
    if (generatedSpec) {
      setGeneratedSpec((prev) =>
        prev
          ? {
              ...prev,
              settings: {
                ...prev.settings,
                rosterMode: nextRosterMode,
              },
            }
          : prev
      );
      setSavedForLater(false);
      setSaveStatus('dirty');
    }
  };

  const handleAddSingleRosterPerson = () => {
    const cleanName = creatorRosterSingleName.replace(/\s+/g, ' ').trim();
    const cleanDept = creatorRosterSingleDept.replace(/\s+/g, ' ').trim();
    if (cleanName.length < 2 || !/\p{L}/u.test(cleanName)) {
      setCreatorRosterSingleError('Vui lòng nhập họ tên hợp lệ (ít nhất 2 ký tự và có chữ cái).');
      return;
    }
    setCreatorRosterSingleError(null);
    const newLine = cleanDept ? `${cleanName} | ${cleanDept}` : cleanName;
    const nextText = btcRosterPasteText.trim()
      ? `${btcRosterPasteText.replace(/\s+$/, '')}\n${newLine}`
      : newLine;
    applyUpdatedRosterPasteText(nextText);
    setCreatorRosterSingleName('');
    setCreatorRosterSingleDept('');
  };

  const handleDeleteRosterDraftRow = (targetLineIndex: number) => {
    const rawLines = btcRosterPasteText.split(/\r?\n/);
    const filtered = rawLines.filter((_, idx) => idx !== targetLineIndex);
    applyUpdatedRosterPasteText(filtered.join('\n'));
    if (editingRosterRowIdx === targetLineIndex) {
      setEditingRosterRowIdx(null);
    }
  };

  const handleSaveEditedRosterDraftRow = (targetLineIndex: number) => {
    const cleanName = editingRosterRowName.replace(/\s+/g, ' ').trim();
    const cleanDept = editingRosterRowDept.replace(/\s+/g, ' ').trim();
    if (cleanName.length < 2 || !/\p{L}/u.test(cleanName)) {
      toast.error('Họ tên phải có ít nhất 2 ký tự và chứa chữ cái hợp lệ.', 'Tên chưa hợp lệ');
      return;
    }
    const rawLines = btcRosterPasteText.split(/\r?\n/);
    if (targetLineIndex >= 0 && targetLineIndex < rawLines.length) {
      const existingParts = rawLines[targetLineIndex]
        .split(/[|\t,;]/)
        .map((p) => p.replace(/\s+/g, ' ').trim());
      const nextParts = [
        cleanName,
        cleanDept,
        existingParts[2] || '',
        existingParts[3] || '',
      ];
      while (nextParts.length > 1 && !nextParts[nextParts.length - 1]) {
        nextParts.pop();
      }
      rawLines[targetLineIndex] = nextParts.join(' | ');
      applyUpdatedRosterPasteText(rawLines.join('\n'));
    }
    setEditingRosterRowIdx(null);
  };

  const handlePreviewCreatorRosterFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsParsingRosterFile(true);
    try {
      const preview = await parseRosterFileApi(file);
      setCreatorRosterImportPreview(preview);
      if (preview.validCount === 0 && preview.invalidRows.length > 0) {
        toast.warning(
          `Tệp "${file.name}" không có dòng hợp lệ nào (${preview.invalidRows.length} dòng lỗi).`,
          'Kiểm tra tệp danh sách'
        );
      } else {
        toast.info(
          `Đã đọc tệp "${file.name}": ${preview.validCount} người hợp lệ${
            preview.duplicateCount > 0 ? `, ${preview.duplicateCount} dòng trùng tên` : ''
          }. Nhấn "Xác nhận nhập" để áp dụng.`,
          'Xem trước danh sách'
        );
      }
    } catch (err: any) {
      toast.error(err.message || 'Không thể đọc tệp danh sách (.xlsx/.csv).', 'Lỗi đọc tệp');
    } finally {
      setIsParsingRosterFile(false);
    }
  };

  const handleConfirmCreatorRosterImport = (mode: 'APPEND' | 'REPLACE' = 'APPEND') => {
    if (!creatorRosterImportPreview || creatorRosterImportPreview.participants.length === 0) {
      return;
    }
    const importedBlock = formatParticipantsToPasteText(creatorRosterImportPreview.participants);
    const nextText =
      mode === 'REPLACE' || !btcRosterPasteText.trim()
        ? importedBlock
        : `${btcRosterPasteText.replace(/\s+$/, '')}\n${importedBlock}`;
    applyUpdatedRosterPasteText(nextText);
    const addedCount = creatorRosterImportPreview.participants.length;
    setCreatorRosterImportPreview(null);
    toast.success(
      mode === 'REPLACE'
        ? `Đã thay thế danh sách bằng ${addedCount} người từ tệp!`
        : `Đã gộp thêm ${addedCount} người vào danh sách tham gia!`,
      'Nhập danh sách thành công'
    );
  };

  const loadBtcRosterAndScoreboard = async (targetGameId?: string) => {
    const gId = targetGameId || generatedSpec?.gameId;
    if (!gId) return;
    setIsLoadingBtcData(true);
    try {
      const [rosterRes, sbRes] = await Promise.all([
        fetchGameParticipantsApi(gId, { mode: 'admin' }).catch(() => ({
          gameId: gId,
          rosterMode,
          participants: [],
        })),
        fetchGameScoreboardApi(gId).catch(() => null),
      ]);
      const loadedParticipants = rosterRes.participants || [];
      setBtcParticipants(loadedParticipants);
      loadedRosterGameIdRef.current = gId;
      setBtcRosterPasteText(formatParticipantsToPasteText(loadedParticipants));
      if (rosterRes.rosterMode) {
        setRosterMode(rosterRes.rosterMode);
      }
      if (sbRes) {
        setBtcScoreboard(sbRes);
      }
    } finally {
      setIsLoadingBtcData(false);
    }
  };

  const handleOpenBtcManager = async () => {
    if (!generatedSpec) return;
    setIsBtcModalOpen(true);
    // Đảm bảo game đã được lưu vào DB trước khi tải danh sách thí sinh
    let activeSpec = generatedSpec;
    if (saveStatus === 'unsaved' || saveStatus === 'dirty') {
      const saved = await handleSaveSpecEdits(generatedSpec.isPublic);
      if (saved) activeSpec = saved;
    }
    await loadBtcRosterAndScoreboard(activeSpec.gameId);
  };

  const handleSaveBtcRoster = async () => {
    if (!generatedSpec) return;
    const validDrafts = parsedRosterDraft.validItems.map((it) => ({
      participantId: it.participantId,
      fullName: it.fullName,
      departmentUnit: it.departmentUnit,
      employeeCode: it.employeeCode,
      email: it.contactInfo,
      contactInfo: it.contactInfo,
    }));

    if (sessionMode === 'EXAM' && validDrafts.length === 0) {
      setShowExamRosterError(true);
      toast.error(
        'Chế độ Thi nghiêm túc bắt buộc phải có danh sách thí sinh (ít nhất 1 người hợp lệ).',
        'Thiếu danh sách thí sinh'
      );
      return;
    }

    const effectiveRosterMode: RosterMode =
      sessionMode === 'EXAM'
        ? 'PRECONFIGURED'
        : validDrafts.length > 0
        ? rosterMode === 'HYBRID'
          ? 'HYBRID'
          : 'PRECONFIGURED'
        : 'FREE_TEXT';

    setIsSavingRoster(true);
    try {
      const res = await upsertGameParticipantsApi(generatedSpec.gameId, {
        participants: validDrafts,
        replaceAll: true,
        rosterMode: effectiveRosterMode,
      });
      setBtcParticipants(res.participants);
      setRosterMode(effectiveRosterMode);
      setBtcRosterPasteText(formatParticipantsToPasteText(res.participants));
      toast.success(
        `Đã lưu danh sách người tham gia (${res.participants.length} người)!`,
        'Đã cập nhật danh sách'
      );
      await loadBtcRosterAndScoreboard(generatedSpec.gameId);
    } catch (err: any) {
      toast.error(err.message || 'Không thể lưu danh sách thí sinh.', 'Lỗi lưu danh sách');
    } finally {
      setIsSavingRoster(false);
    }
  };

  const handleImportRosterFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const parsed = await parseRosterFileApi(file);
      if (parsed.participants.length > 0) {
        const block = formatParticipantsToPasteText(parsed.participants);
        applyUpdatedRosterPasteText(
          btcRosterPasteText.trim() ? `${btcRosterPasteText.replace(/\s+$/, '')}\n${block}` : block
        );
        toast.info(
          `Đã nạp ${parsed.participants.length} người từ tệp "${file.name}". Nhấn "Lưu danh sách thí sinh" để áp dụng.`
        );
      } else {
        toast.warning(`Tệp "${file.name}" không có dòng hợp lệ nào.`);
      }
    } catch {
      toast.error('Không thể đọc tệp danh sách thí sinh.');
    }
  };

  const handleGrantRetake = async (participantId: string, fullName: string) => {
    if (!generatedSpec) return;
    try {
      await grantParticipantRetakeApi(generatedSpec.gameId, participantId, 1);
      toast.success(`Đã cấp thêm 1 lượt thi lại cho "${fullName}"!`, 'Cấp quyền thi lại');
      await loadBtcRosterAndScoreboard(generatedSpec.gameId);
    } catch (err: any) {
      toast.error(err.message || 'Không thể cấp quyền thi lại.', 'Lỗi cấp quyền');
    }
  };

  const handlePublishExamAnswers = async () => {
    if (!generatedSpec || isPublishingAnswers) return;
    setIsPublishingAnswers(true);
    try {
      await publishExamAnswersApi(generatedSpec.gameId);
      setGeneratedSpec((prev) =>
        prev
          ? {
              ...prev,
              settings: {
                ...prev.settings,
                answersPublished: true,
                answersPublishedAt: new Date().toISOString(),
              },
            }
          : prev
      );
      toast.success('Đã công bố đáp án chính thức cho kỳ thi!', 'Công bố đáp án');
      await loadBtcRosterAndScoreboard(generatedSpec.gameId);
    } catch (err: any) {
      toast.error(err.message || 'Không thể công bố đáp án khi kỳ thi đang diễn ra.', 'Chưa thể công bố đáp án');
    } finally {
      setIsPublishingAnswers(false);
    }
  };

  const handleCloseExam = async () => {
    if (!generatedSpec || isClosingExam) return;
    setIsClosingExam(true);
    try {
      const res = await closeGameExamApi(generatedSpec.gameId);
      setConfirmCloseExamOpen(false);
      setGeneratedSpec((prev) =>
        prev
          ? {
              ...prev,
              settings: {
                ...prev.settings,
                examStatus: 'CLOSED',
                examClosedAt: res.examClosedAt,
              },
            }
          : prev
      );
      toast.success(
        `Đã kết thúc đợt thi! Tự động thu và chấm điểm ${res.totalAutoSubmitted} lượt thi đang diễn ra.`,
        'Đợt thi đã kết thúc'
      );
      await loadBtcRosterAndScoreboard(generatedSpec.gameId);
    } catch (err: any) {
      toast.error(err.message || 'Không thể kết thúc đợt thi.', 'Lỗi kết thúc đợt thi');
    } finally {
      setIsClosingExam(false);
    }
  };

  const handleReopenExam = async () => {
    if (!generatedSpec || isClosingExam) return;
    setIsClosingExam(true);
    try {
      await reopenGameExamApi(generatedSpec.gameId);
      setGeneratedSpec((prev) =>
        prev
          ? {
              ...prev,
              settings: {
                ...prev.settings,
                examStatus: 'OPEN',
                examClosedAt: null,
              },
            }
          : prev
      );
      toast.success('Đã mở lại đợt thi!', 'Đã mở đợt thi');
      await loadBtcRosterAndScoreboard(generatedSpec.gameId);
    } catch (err: any) {
      toast.error(err.message || 'Không thể mở lại đợt thi.', 'Lỗi mở lại đợt thi');
    } finally {
      setIsClosingExam(false);
    }
  };

  // Đồng bộ game vừa tạo / chỉnh sửa trong phiên hiện tại vào sessionStorage và parent state
  useEffect(() => {
    if (!generatedSpec) return;
    syncedGameIdRef.current = generatedSpec.gameId;
    const persistedStatus: 'unsaved' | 'saved' | 'dirty' =
      saveStatus === 'saved' ? 'saved' : saveStatus === 'dirty' ? 'dirty' : 'unsaved';
    writeCreatorSessionSnapshot({
      spec: generatedSpec,
      saveStatus: persistedStatus,
      savedForLater,
      customGameTitle: customGameTitle.trim() || generatedSpec.title || '',
    });
    if (onCurrentSpecChange && initialSpec !== generatedSpec) {
      onCurrentSpecChange(generatedSpec);
    }
  }, [generatedSpec, saveStatus, savedForLater, customGameTitle]);

  // Available section/page titles from ingested documents
  const availableSections = React.useMemo(() => {
    const set = new Set<string>();
    for (const src of ingestedSources) {
      if (Array.isArray(src.sections)) {
        for (const sec of src.sections) {
          const label = sec.title || sec.provenance?.section;
          if (label && label.trim().length > 0 && set.size < 24) {
            set.add(label.trim());
          }
        }
      }
    }
    return Array.from(set);
  }, [ingestedSources]);

  const handleAddUrlField = () => {
    if (urls.length >= MAX_URLS) {
      toast.warning(`Tối đa ${MAX_URLS} địa chỉ URL mỗi lần trích xuất.`, 'Giới hạn số lượng URL');
      return;
    }
    setUrls(prev => [...prev, '']);
  };

  const handleRemoveUrlField = (idx: number) => {
    if (urls.length <= 1) {
      setUrls(['']);
      return;
    }
    setUrls(prev => prev.filter((_, i) => i !== idx));
  };

  const handleUrlChange = (idx: number, val: string) => {
    setUrls(prev => prev.map((u, i) => (i === idx ? val : u)));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedList = Array.from(e.target.files || []);
    if (selectedList.length === 0) return;

    const allowedExtensions = ['.pdf', '.docx', '.xlsx', '.txt', '.md', '.markdown', '.csv'];
    const currentFiles = [...files];
    let currentTotalBytes = currentFiles.reduce((acc, f) => acc + f.size, 0);

    for (const f of selectedList) {
      if (currentFiles.length >= MAX_FILES) {
        toast.warning(`Chỉ hỗ trợ tối đa ${MAX_FILES} tệp tài liệu trong một lần tải lên.`, 'Vượt số lượng tệp');
        break;
      }

      const ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        toast.error(`Định dạng "${ext}" của tệp "${f.name}" không được hỗ trợ. Vui lòng chọn tệp .pdf, .docx, .xlsx, .txt, .md, .csv.`, 'Định dạng không hỗ trợ');
        continue;
      }

      if (f.size > MAX_FILE_BYTES) {
        toast.error(`Tệp "${f.name}" (${formatFileSize(f.size)}) vượt quá dung lượng tối đa 10MB.`, 'Tệp quá lớn');
        continue;
      }

      if (currentTotalBytes + f.size > MAX_TOTAL_FILE_BYTES) {
        toast.error(`Tổng dung lượng các tệp vượt quá 25MB khi thêm "${f.name}" (${formatFileSize(currentTotalBytes + f.size)}).`, 'Vượt tổng dung lượng');
        break;
      }

      if (currentFiles.some(existing => existing.name === f.name && existing.size === f.size)) {
        toast.warning(`Tệp "${f.name}" đã được chọn trước đó.`, 'Tệp trùng lặp');
        continue;
      }

      currentFiles.push(f);
      currentTotalBytes += f.size;
    }

    setFiles(currentFiles);
    e.target.value = '';
  };

  const handleRemoveFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const runTrackedIngestion = (
    ingestTask: () => Promise<IngestedSource[] | null>
  ): Promise<IngestedSource[] | null> => {
    if (activeIngestPromiseRef.current) {
      return activeIngestPromiseRef.current;
    }

    isIngestingRef.current = true;
    setIsIngesting(true);

    const trackedPromise = (async () => {
      try {
        return await ingestTask();
      } finally {
        activeIngestPromiseRef.current = null;
        isIngestingRef.current = false;
        setIsIngesting(false);
      }
    })();

    activeIngestPromiseRef.current = trackedPromise;
    return trackedPromise;
  };

  const handleIngest = async (): Promise<string | null> => {
    if (isIngesting || isIngestingRef.current) {
      if (activeIngestPromiseRef.current) {
        const awaited = await activeIngestPromiseRef.current;
        return awaited?.[0]?.sourceId || null;
      }
      return null;
    }

    const cleanUrls = urls.map(u => u.trim()).filter(Boolean);
    if (cleanUrls.length === 0 && files.length === 0) {
      toast.error('Vui lòng nhập ít nhất một địa chỉ URL hoặc chọn tệp tài liệu tải lên.', 'Thiếu thông tin');
      return null;
    }

    for (const u of cleanUrls) {
      try {
        const parsedUrl = new URL(u);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          toast.error(`Địa chỉ URL "${u}" phải bắt đầu bằng http:// hoặc https://.`, 'URL không hợp lệ');
          return null;
        }
      } catch {
        toast.error(`Địa chỉ URL "${u}" không đúng định dạng hợp lệ.`, 'URL không hợp lệ');
        return null;
      }
    }

    if (cleanUrls.length > MAX_URLS) {
      toast.error(`Tối đa ${MAX_URLS} URL mỗi lần trích xuất.`, 'Vượt giới hạn URL');
      return null;
    }

    if (files.length > MAX_FILES) {
      toast.error(`Tối đa ${MAX_FILES} tệp tài liệu mỗi lần trích xuất.`, 'Vượt giới hạn tệp');
      return null;
    }

    const totalFileBytes = files.reduce((acc, f) => acc + f.size, 0);
    if (totalFileBytes > MAX_TOTAL_FILE_BYTES) {
      toast.error(`Tổng dung lượng các tệp (${formatFileSize(totalFileBytes)}) vượt quá giới hạn 25MB.`, 'Vượt tổng dung lượng');
      return null;
    }

    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`Tệp "${f.name}" (${formatFileSize(f.size)}) vượt quá dung lượng tối đa 10MB.`, 'Tệp quá lớn');
        return null;
      }
    }

    const ingestedList = await runTrackedIngestion(async () => {
      const toastId = toast.loading('Đang xử lý và trích xuất nội dung nguồn...');
      try {
        const sources = await ingestSources({
          urls: cleanUrls,
          files,
        });
        const validSources = Array.isArray(sources)
          ? sources.filter(s => s && typeof s.sourceId === 'string' && s.sourceId.trim().length > 0)
          : [];
        if (validSources.length === 0) {
          throw new Error('Không tìm thấy ID nguồn hợp lệ sau khi trích xuất tài liệu.');
        }

        toast.removeToast(toastId);
        setIngestedSources(validSources);
        setSelectedSections([]);
        const totalChars = validSources.reduce(
          (acc, s) => acc + (s.metadata?.characterCount || 0),
          0
        );

        toast.success(
          `Đã nạp thành công ${validSources.length} nguồn tài liệu (${totalChars.toLocaleString('vi-VN')} ký tự).`,
          'Trích xuất thành công'
        );
        setCurrentStep(3);
        return validSources;
      } catch (err: any) {
        toast.removeToast(toastId);
        toast.error(err.message || 'Không thể trích xuất nội dung nguồn.', 'Lỗi nhập dữ liệu');
        return null;
      }
    });

    return ingestedList?.[0]?.sourceId || null;
  };

  const handleGenerate = async (
    targetSourceId?: string,
    overrideSources?: IngestedSource[]
  ): Promise<GameSpecification | null> => {
    if (isGenerating || isGeneratingRef.current) return null;

    let resolvedOverrideSources = overrideSources;
    if (
      (!resolvedOverrideSources || resolvedOverrideSources.length === 0) &&
      activeIngestPromiseRef.current
    ) {
      const awaitedSources = await activeIngestPromiseRef.current;
      if (!awaitedSources || awaitedSources.length === 0) {
        return null;
      }
      resolvedOverrideSources = awaitedSources;
    }

    const activeSources = (
      resolvedOverrideSources && resolvedOverrideSources.length > 0
        ? resolvedOverrideSources
        : ingestedSources
    ).filter(s => s && typeof s.sourceId === 'string' && s.sourceId.trim().length > 0);

    const cleanTargetId = typeof targetSourceId === 'string' ? targetSourceId.trim() : '';
    const sIds = Array.from(
      new Set([
        ...(cleanTargetId ? [cleanTargetId] : []),
        ...activeSources.map(s => s.sourceId.trim()),
      ])
    );
    const primaryId = cleanTargetId || sIds[0] || null;
    if (!primaryId || sIds.length === 0) {
      toast.error('Vui lòng hoàn thành Bước 2 (Nhập nội dung nguồn) trước.', 'Chưa có nội dung');
      return null;
    }

    if (gameType === 'MIXED') {
      const sum =
        (mixedDistribution.MULTIPLE_CHOICE || 0) +
        (mixedDistribution.QUICK_BUTTON || 0) +
        (mixedDistribution.FILL_IN_THE_BLANK || 0) +
        (mixedDistribution.CROSSWORD || 0);
      if (sum !== 100) {
        toast.error(
          `Tổng tỷ lệ các loại câu hỏi cho chế độ MIXED hiện tại là ${sum}%. Bạn cần điều chỉnh để tổng đúng chính xác 100%.`,
          'Tỷ lệ câu hỏi chưa đúng 100%'
        );
        return null;
      }
    }

    if (gameType === 'ADVENTURE') {
      if (adventureQuestionTypes.length === 0) {
        toast.error('Vui lòng chọn ít nhất một loại câu hỏi.', 'Thiếu loại câu hỏi');
        return null;
      }
      const advSum =
        (adventureQuestionDistribution.MULTIPLE_CHOICE || 0) +
        (adventureQuestionDistribution.QUICK_BUTTON || 0) +
        (adventureQuestionDistribution.FILL_IN_THE_BLANK || 0) +
        (adventureQuestionDistribution.CROSSWORD || 0);
      if (advSum !== 100) {
        toast.error(
          `Tổng tỷ lệ các loại câu hỏi trong game đi cảnh hiện tại là ${advSum}%. Bạn cần điều chỉnh để tổng đúng chính xác 100%.`,
          'Tỷ lệ câu hỏi chưa đúng 100%'
        );
        return null;
      }
    }

    const validRosterItemsForGen = parsedRosterDraft.validItems.map((it) => ({
      participantId: it.participantId,
      fullName: it.fullName,
      departmentUnit: it.departmentUnit,
      employeeCode: it.employeeCode,
      email: it.contactInfo,
      contactInfo: it.contactInfo,
    }));

    if (sessionMode === 'EXAM' && validRosterItemsForGen.length === 0) {
      setShowExamRosterError(true);
      toast.error(
        'Chế độ Thi nghiêm túc bắt buộc phải có danh sách thí sinh (ít nhất 1 người hợp lệ). Vui lòng nhập hoặc import danh sách người tham gia.',
        'Thiếu danh sách thí sinh'
      );
      return null;
    }

    const effectiveRosterModeForGen: RosterMode =
      sessionMode === 'EXAM'
        ? 'PRECONFIGURED'
        : validRosterItemsForGen.length > 0
        ? rosterMode === 'HYBRID'
          ? 'HYBRID'
          : 'PRECONFIGURED'
        : 'FREE_TEXT';
    setRosterMode(effectiveRosterModeForGen);

    isGeneratingRef.current = true;
    setIsGenerating(true);
    const toastId = toast.loading('Đang yêu cầu AI tổng hợp câu hỏi và phương án trả lời...');

    try {
      const rawSpec = await generateGame({
        sourceId: primaryId,
        sourceIds: sIds,
        sources: activeSources.length > 0 ? activeSources : undefined,

        gameType,
        difficulty,
        scoringMode,
        questionCount,
        timePerQuestion,
        sessionMode,
        passThresholdPercent,
        officialAttemptPolicy,
        rosterMode: effectiveRosterModeForGen,
        requireRoster: sessionMode === 'EXAM',
        participants: validRosterItemsForGen,
        audioConfig,
        topicFocus: topicFocus.trim() || undefined,
        sectionFilter: selectedSections.length > 0 ? selectedSections : undefined,
        title: customGameTitle.trim() || undefined,
        mixedDistribution: gameType === 'MIXED' ? mixedDistribution : undefined,
        adventureConfig:
          gameType === 'ADVENTURE'
            ? adventureIndustryMode === 'AI_DETECT'
              ? ({
                  aiDetectedIndustry: true,
                  questionTypes: adventureQuestionTypes,
                  questionDistribution: adventureQuestionDistribution,
                } as any)
              : ({
                  industryId: adventureIndustryMode,
                  industryLabel:
                    adventureIndustryMode === 'CUSTOM'
                      ? customIndustryName.trim() || 'Ngành nghề Tùy chỉnh'
                      : INDUSTRY_CATALOG.find(i => i.industryId === adventureIndustryMode)?.label,
                  ...(adventureIndustryMode === 'CUSTOM' && customSubEnvironment.trim()
                    ? { subEnvironment: customSubEnvironment.trim() }
                    : {}),
                  aiDetectedIndustry: false,
                  questionTypes: adventureQuestionTypes,
                  questionDistribution: adventureQuestionDistribution,
                } as any)
            : undefined,
      });

      const spec: GameSpecification = {
        ...rawSpec,
        settings: {
          ...rawSpec.settings,
          sessionMode,
          passThresholdPercent,
          officialAttemptPolicy,
          rosterMode: effectiveRosterModeForGen,
          audioConfig,
        },
      };

      toast.removeToast(toastId);
      syncedGameIdRef.current = spec.gameId;
      loadedRosterGameIdRef.current = spec.gameId;
      setGeneratedSpec(spec);
      if (validRosterItemsForGen.length > 0) {
        fetchGameParticipantsApi(spec.gameId, { mode: 'admin' })
          .then((res) => {
            if (Array.isArray(res.participants)) {
              setBtcParticipants(res.participants);
            }
          })
          .catch(() => {});
      } else {
        setBtcParticipants([]);
      }
      if (spec.settings?.adventureConfig) {
        setAdventureConfig(
          syncAdventureStagesWithQuestions(spec.settings.adventureConfig, spec.questions)
        );
      }
      setCustomGameTitle(spec.title);
      setEditingQuestionIdx(null);
      setEditingQuestionDraft(null);
      setEditingQuestionError(null);
      setQuestionPage(1);
      setIsQuestionListCollapsed(false);
      setSaveStatus('unsaved');
      setSaveErrorMessage(null);
      setSavedForLater(false);
      setIsPlaytestOpen(false);
      setPlaytestSpec(null);
      setRoomCode('');
      setIsModeModalOpen(false);
      writeCreatorSessionSnapshot({
        spec,
        saveStatus: 'unsaved',
        savedForLater: false,
        customGameTitle: spec.title,
      });
      onCurrentSpecChange?.(spec);
      toast.success(
        spec.questions.length < questionCount
          ? `Đã tạo thành công "${spec.title}" với ${spec.questions.length}/${questionCount} câu hỏi hợp lệ trích xuất từ nguồn thực tế (không tự nhân bản câu giả).`
          : `Đã tạo thành công bộ câu hỏi "${spec.title}" (${spec.questions.length} câu)! Bạn có thể xem trước nội dung hoặc bắt đầu chơi khi sẵn sàng.`,
        'Tạo game thành công'
      );
      setCurrentStep(4);
      setShowAdventureFullscreenPreview(false);
      if (spec.gameType === 'ADVENTURE') {
        setShowAdventureFullscreenPreview(false);
      }
      return spec;
    } catch (err: any) {
      toast.removeToast(toastId);
      if (err.code === 'AI_KEY_NOT_CONFIGURED') {
        toast.error(
          'GEMINI_API_KEY chưa được cấu hình. Vui lòng thiết lập khóa trong tệp môi trường của máy chủ để tạo trò chơi bằng AI.',
          'Chưa có khóa AI'
        );
      } else {
        toast.error(err.message || 'Tạo trò chơi bằng AI thất bại.', 'Lỗi tạo trò chơi');
      }
      return null;
    } finally {
      isGeneratingRef.current = false;
      setIsGenerating(false);
    }
  };

  const handleCreateGameUnified = async () => {
    // Chống submit trùng lặp đồng bộ (ngăn double-click trước khi React kịp re-render)
    if (isGenerating || isGeneratingRef.current) {
      return;
    }

    if (sessionMode === 'EXAM' && parsedRosterDraft.validItems.length === 0) {
      setShowExamRosterError(true);
      toast.error(
        'Chế độ Thi nghiêm túc bắt buộc phải có danh sách thí sinh (ít nhất 1 người hợp lệ). Vui lòng nhập hoặc import danh sách người tham gia.',
        'Thiếu danh sách thí sinh'
      );
      return;
    }

    // Nếu quá trình tải/trích xuất nguồn đang diễn ra, tự động đợi hoàn tất rồi mới tạo game (Trường hợp A)
    if (activeIngestPromiseRef.current || isIngesting || isIngestingRef.current) {
      if (activeIngestPromiseRef.current) {
        const awaitedSources = await activeIngestPromiseRef.current;
        const validAwaited = (awaitedSources || []).filter(
          s => s && typeof s.sourceId === 'string' && s.sourceId.trim().length > 0
        );
        if (validAwaited.length === 0) {
          return;
        }
        setSavedForLater(false);
        setShowQuestionEditor(false);
        setIsModeModalOpen(false);
        await handleGenerate(validAwaited[0].sourceId.trim(), validAwaited);
      }
      return;
    }

    if (gameType === 'MIXED') {
      const mixedSum =
        (mixedDistribution.MULTIPLE_CHOICE || 0) +
        (mixedDistribution.QUICK_BUTTON || 0) +
        (mixedDistribution.FILL_IN_THE_BLANK || 0) +
        (mixedDistribution.CROSSWORD || 0);
      if (mixedSum !== 100) {
        toast.error(
          `Tổng tỷ lệ các loại câu hỏi cho chế độ MIXED hiện tại là ${mixedSum}%. Bạn cần điều chỉnh để tổng đúng chính xác 100%.`,
          'Tỷ lệ câu hỏi chưa đúng 100%'
        );
        return;
      }
    }

    if (gameType === 'ADVENTURE') {
      if (adventureQuestionTypes.length === 0) {
        toast.error('Vui lòng chọn ít nhất một loại câu hỏi.', 'Thiếu loại câu hỏi');
        return;
      }
      const advSum =
        (adventureQuestionDistribution.MULTIPLE_CHOICE || 0) +
        (adventureQuestionDistribution.QUICK_BUTTON || 0) +
        (adventureQuestionDistribution.FILL_IN_THE_BLANK || 0) +
        (adventureQuestionDistribution.CROSSWORD || 0);
      if (advSum !== 100) {
        toast.error(
          `Tổng tỷ lệ các loại câu hỏi trong game đi cảnh hiện tại là ${advSum}%. Bạn cần điều chỉnh để tổng đúng chính xác 100%.`,
          'Tỷ lệ câu hỏi chưa đúng 100%'
        );
        return;
      }
    }

    let trimmedTitle = customGameTitle.trim();
    const cleanUrls = urls.map(u => u.trim()).filter(Boolean);
    const hasFiles = files.length > 0;
    const hasTopic = topicFocus.trim().length > 0;
    const validExistingSources = ingestedSources.filter(
      s => s && typeof s.sourceId === 'string' && s.sourceId.trim().length > 0
    );

    if (!cleanUrls.length && !hasFiles && !hasTopic && validExistingSources.length === 0) {
      toast.error('Vui lòng dán link URL, chọn file tài liệu hoặc nhập chủ đề trước khi tạo.', 'Thiếu nguồn nội dung');
      return;
    }

    if (!trimmedTitle) {
      if (sourceTab === 'TOPIC' && hasTopic) {
        trimmedTitle = `Chủ đề: ${topicFocus.trim().slice(0, 50)}`;
      } else if (cleanUrls.length > 0) {
        try {
          const parsed = new URL(cleanUrls[0]);
          trimmedTitle = `Đấu trường ${parsed.hostname}`;
        } catch {
          trimmedTitle = `Đấu trường ${formatGameTypeLabel(gameType)}`;
        }
      } else if (hasFiles) {
        trimmedTitle = `Kiến thức từ ${files[0].name.replace(/\.[^/.]+$/, '')}`;
      } else {
        trimmedTitle = `Bộ câu hỏi ${formatGameTypeLabel(gameType)}`;
      }
      setCustomGameTitle(trimmedTitle);
    }

    let activeSourcesForRun: IngestedSource[] = validExistingSources;

    if (sourceTab === 'TOPIC' && hasTopic) {
      const ingested = await runTrackedIngestion(async () => {
        try {
          const sources = await ingestSources({ sampleText: topicFocus.trim() });
          setIngestedSources(sources);
          return sources;
        } catch (err: any) {
          toast.error(err.message || 'Không thể xử lý nội dung chủ đề.', 'Lỗi nạp chủ đề');
          return null;
        }
      });
      if (!ingested || ingested.length === 0) return;
      activeSourcesForRun = ingested;
    } else if (
      (sourceTab === 'URL' && cleanUrls.length > 0) ||
      (sourceTab === 'FILE' && hasFiles) ||
      cleanUrls.length > 0 ||
      hasFiles
    ) {
      const ingested = await runTrackedIngestion(async () => {
        try {
          const sources = await ingestSources({
            urls: sourceTab === 'URL' || cleanUrls.length > 0 ? cleanUrls : [],
            files: sourceTab === 'FILE' || hasFiles ? files : [],
          });
          setIngestedSources(sources);
          setSelectedSections([]);
          return sources;
        } catch (err: any) {
          toast.error(err.message || 'Không thể trích xuất nội dung nguồn.', 'Lỗi nhập dữ liệu');
          return null;
        }
      });
      if (!ingested || ingested.length === 0) return;
      activeSourcesForRun = ingested;
    } else if (hasTopic) {
      const ingested = await runTrackedIngestion(async () => {
        try {
          const sources = await ingestSources({ sampleText: topicFocus.trim() });
          setIngestedSources(sources);
          return sources;
        } catch (err: any) {
          toast.error(err.message || 'Không thể xử lý nội dung chủ đề.', 'Lỗi nạp chủ đề');
          return null;
        }
      });
      if (!ingested || ingested.length === 0) return;
      activeSourcesForRun = ingested;
    }

    const validActiveSources = activeSourcesForRun.filter(
      s => s && typeof s.sourceId === 'string' && s.sourceId.trim().length > 0
    );
    const primarySourceId = validActiveSources[0]?.sourceId?.trim();
    if (!primarySourceId || validActiveSources.length === 0) {
      toast.error('Không tìm thấy ID nguồn hợp lệ. Vui lòng nhập nội dung nguồn trước.', 'Thiếu nguồn nội dung');
      return;
    }

    setSavedForLater(false);
    setShowQuestionEditor(false);
    setIsModeModalOpen(false);
    await handleGenerate(primarySourceId, validActiveSources);
  };

  // Validate entire specification before Room Creation or Single-Player Practice
  const validateSpecBeforeLaunch = (spec: GameSpecification | null): boolean => {
    if (!spec) {
      toast.error('Vui lòng tạo bộ câu hỏi trước.', 'Chưa có bộ câu hỏi');
      return false;
    }
    if (!spec.title || spec.title.trim().length === 0) {
      toast.error('Tiêu đề bộ câu hỏi không được để trống.', 'Lỗi kiểm tra câu hỏi');
      return false;
    }
    if (spec.title.trim().length > 100) {
      toast.error('Tên game không được vượt quá 100 ký tự.', 'Lỗi kiểm tra câu hỏi');
      return false;
    }
    if (!spec.questions || spec.questions.length === 0) {
      toast.error('Bộ câu hỏi phải có ít nhất 1 câu hỏi.', 'Lỗi kiểm tra câu hỏi');
      return false;
    }

    const effectiveMode = spec.settings?.sessionMode || sessionMode;
    if (
      effectiveMode === 'EXAM' &&
      parsedRosterDraft.validItems.length === 0 &&
      btcParticipants.length === 0
    ) {
      setShowExamRosterError(true);
      toast.error(
        'Chế độ Thi nghiêm túc bắt buộc phải có danh sách thí sinh (ít nhất 1 người hợp lệ). Vui lòng nhập hoặc import danh sách người tham gia.',
        'Thiếu danh sách thí sinh'
      );
      return false;
    }

    const seenQuestions = new Set<string>();
    for (let i = 0; i < spec.questions.length; i++) {
      const q = spec.questions[i];
      const err = validateQuestionItem(q);
      if (err) {
        setIsQuestionListCollapsed(false);
        setEditingQuestionIdx(i);
        setEditingQuestionDraft(cloneQuestionDraft(q));
        setEditingQuestionError(err);
        setQuestionPage(Math.floor(i / QUESTIONS_PER_PAGE) + 1);
        toast.error(`Câu hỏi #${i + 1}: ${err}`, 'Câu hỏi chưa hợp lệ');
        return false;
      }
      const normKey = q.question.trim().toLowerCase().replace(/\s+/g, ' ');
      if (seenQuestions.has(normKey)) {
        const dupMsg = `Câu hỏi #${i + 1} bị trùng nội dung với một câu hỏi trước đó.`;
        setIsQuestionListCollapsed(false);
        setEditingQuestionIdx(i);
        setEditingQuestionDraft(cloneQuestionDraft(q));
        setEditingQuestionError(dupMsg);
        setQuestionPage(Math.floor(i / QUESTIONS_PER_PAGE) + 1);
        toast.error(dupMsg, 'Trùng lặp câu hỏi');
        return false;
      }
      seenQuestions.add(normKey);
    }

    return true;
  };

  const handleCreateRoom = async (targetSpec?: GameSpecification): Promise<string | null> => {
    const spec = targetSpec || generatedSpec;
    if (!validateSpecBeforeLaunch(spec)) {
      return null;
    }

    const validRosterItems = parsedRosterDraft.validItems.map((it) => ({
      participantId: it.participantId,
      fullName: it.fullName,
      departmentUnit: it.departmentUnit,
      employeeCode: it.employeeCode,
      email: it.contactInfo,
      contactInfo: it.contactInfo,
    }));
    const effectiveRosterModeForRoom: RosterMode =
      sessionMode === 'EXAM'
        ? 'PRECONFIGURED'
        : validRosterItems.length > 0
        ? rosterMode === 'HYBRID'
          ? 'HYBRID'
          : 'PRECONFIGURED'
        : 'FREE_TEXT';

    setIsCreatingRoom(true);
    const toastId = toast.loading('Đang khởi tạo phòng chơi và tạo mã QR tham gia...');

    try {
      if (spec?.gameId && (validRosterItems.length > 0 || btcParticipants.length > 0)) {
        await upsertGameParticipantsApi(spec.gameId, {
          participants: validRosterItems,
          replaceAll: true,
          rosterMode: effectiveRosterModeForRoom,
        }).catch(() => {});
      }

      const roomData = await createRoom({
        gameId: spec!.gameId,
        gameSpecification: {
          ...spec!,
          settings: {
            ...spec!.settings,
            questionCount: spec!.questions.length,
            scoringMode,
            timePerQuestion,
            sessionMode,
            passThresholdPercent,
            officialAttemptPolicy,
            rosterMode: effectiveRosterModeForRoom,
            audioConfig,
            ...(spec!.gameType === 'ADVENTURE'
              ? {
                  adventureConfig: syncAdventureStagesWithQuestions(
                    spec!.settings?.adventureConfig || adventureConfig,
                    spec!.questions
                  ),
                }
              : {}),
          },
        },
        capacity: 300,
      });

      setRoomCode(roomData.roomCode);
      setHostToken(roomData.hostToken);
      setJoinUrl(roomData.joinUrl);

      try {
        const qr = await fetchRoomQr(roomData.roomCode);
        setQrDataUrl(qr.qrDataUrl);
      } catch {
        // QR fetch optional fallback
      }

      toast.removeToast(toastId);
      toast.success(
        `Phòng [${roomData.roomCode}] đã được tạo thành công với sức chứa tối đa 300 người chơi!`,
        'Tạo phòng thành công'
      );
      return roomData.roomCode;
    } catch (err: any) {
      toast.removeToast(toastId);
      toast.error(err.message || 'Không thể tạo phòng chơi.', 'Lỗi tạo phòng');
      return null;
    } finally {
      setIsCreatingRoom(false);
    }
  };

  // ==========================================
  // Question Editor Handlers (Batch 6)
  // ==========================================

  const cloneQuestionDraft = (q: GameQuestion): GameQuestion => ({
    ...q,
    choices: q.choices ? [...q.choices] : undefined,
    sliderConfig: q.sliderConfig ? { ...q.sliderConfig } : undefined,
    acceptedAlternatives: q.acceptedAlternatives ? [...q.acceptedAlternatives] : undefined,
    sourceReference: { ...q.sourceReference },
  });

  const handleStartEditQuestion = (index: number) => {
    if (!generatedSpec || !generatedSpec.questions[index]) return;
    setEditingQuestionIdx(index);
    setEditingQuestionDraft(cloneQuestionDraft(generatedSpec.questions[index]));
    setEditingQuestionError(null);
    const targetPage = Math.floor(index / QUESTIONS_PER_PAGE) + 1;
    setQuestionPage(targetPage);
  };

  const handleCancelEditQuestion = () => {
    setEditingQuestionIdx(null);
    setEditingQuestionDraft(null);
    setEditingQuestionError(null);
  };

  const handleUpdateQuestionDraft = (updater: (q: GameQuestion) => GameQuestion) => {
    setEditingQuestionDraft((prev) => (prev ? updater(prev) : prev));
    setEditingQuestionError(null);
  };

  const normalizeDraftQuestionCandidate = (draft: GameQuestion): GameQuestion => ({
    ...draft,
    question: draft.question.trim(),
    correctAnswer: draft.correctAnswer.trim(),
    ...(draft.type === 'CROSSWORD'
      ? {
          crosswordClue: (draft.crosswordClue || draft.question).trim(),
          crosswordAnswer: (draft.crosswordAnswer || draft.correctAnswer).trim().replace(/\s+/g, ''),
          correctAnswer: (draft.crosswordAnswer || draft.correctAnswer).trim().replace(/\s+/g, ''),
        }
      : {}),
  });

  const handleCommitQuestionEdit = (
    index: number,
    options?: { silent?: boolean }
  ): GameSpecification | null => {
    if (!generatedSpec || !editingQuestionDraft) return null;
    const candidate = normalizeDraftQuestionCandidate(editingQuestionDraft);

    const validationErr = validateQuestionItem(candidate);
    if (validationErr) {
      setEditingQuestionError(validationErr);
      toast.error(`Câu hỏi #${index + 1}: ${validationErr}`, 'Câu hỏi chưa hợp lệ');
      return null;
    }

    const normCandidateKey = candidate.question.toLowerCase().replace(/\s+/g, ' ');
    for (let i = 0; i < generatedSpec.questions.length; i++) {
      if (i === index) continue;
      const otherKey = generatedSpec.questions[i].question.trim().toLowerCase().replace(/\s+/g, ' ');
      if (otherKey === normCandidateKey) {
        const dupMsg = `Nội dung câu hỏi #${index + 1} bị trùng lặp với câu hỏi #${i + 1}.`;
        setEditingQuestionError(dupMsg);
        toast.error(dupMsg, 'Trùng lặp câu hỏi');
        return null;
      }
    }

    const nextQuestions = generatedSpec.questions.map((q, i) => (i === index ? candidate : q));
    const updatedSpec: GameSpecification = {
      ...generatedSpec,
      questions: nextQuestions,
      settings: {
        ...generatedSpec.settings,
        questionCount: nextQuestions.length,
        ...(generatedSpec.gameType === 'ADVENTURE'
          ? {
              adventureConfig: syncAdventureStagesWithQuestions(
                generatedSpec.settings?.adventureConfig || adventureConfig,
                nextQuestions
              ),
            }
          : {}),
      },
    };
    setGeneratedSpec(updatedSpec);
    setEditingQuestionIdx(null);
    setEditingQuestionDraft(null);
    setEditingQuestionError(null);
    setSavedForLater(false);
    setSaveStatus('dirty');
    setSaveErrorMessage(null);
    if (!options?.silent) {
      toast.success(
        `Đã cập nhật câu hỏi #${index + 1}. Nhấn "Lưu Game" để lưu vào hệ thống.`,
        'Đã cập nhật câu hỏi'
      );
    }
    return updatedSpec;
  };

  const handleUpdateQuestion = (index: number, updater: (q: GameQuestion) => GameQuestion) => {
    if (!generatedSpec) return;
    const nextQuestions = generatedSpec.questions.map((q, i) => (i === index ? updater(q) : q));
    setGeneratedSpec({
      ...generatedSpec,
      questions: nextQuestions,
      settings: {
        ...generatedSpec.settings,
        questionCount: nextQuestions.length,
      },
    });
    setSavedForLater(false);
    setSaveStatus('dirty');
  };

  const handleDeleteQuestion = (index: number) => {
    if (!generatedSpec) return;
    if (generatedSpec.questions.length <= 1) {
      toast.warning('Bộ câu hỏi phải giữ lại ít nhất 1 câu hỏi.', 'Không thể xóa');
      return;
    }
    const nextQuestions = generatedSpec.questions.filter((_, i) => i !== index);
    setGeneratedSpec({
      ...generatedSpec,
      questions: nextQuestions,
      settings: {
        ...generatedSpec.settings,
        questionCount: nextQuestions.length,
      },
    });
    const maxPagesAfterDelete = Math.max(1, Math.ceil(nextQuestions.length / QUESTIONS_PER_PAGE));
    if (questionPage > maxPagesAfterDelete) {
      setQuestionPage(maxPagesAfterDelete);
    }
    setSavedForLater(false);
    setSaveStatus('dirty');
    if (editingQuestionIdx === index) {
      setEditingQuestionIdx(null);
      setEditingQuestionDraft(null);
      setEditingQuestionError(null);
    } else if (editingQuestionIdx !== null && editingQuestionIdx > index) {
      setEditingQuestionIdx(editingQuestionIdx - 1);
    }
  };

  const handleMoveQuestion = (index: number, direction: -1 | 1) => {
    if (!generatedSpec) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= generatedSpec.questions.length) return;

    const nextQuestions = [...generatedSpec.questions];
    const temp = nextQuestions[index];
    nextQuestions[index] = nextQuestions[targetIndex];
    nextQuestions[targetIndex] = temp;

    setGeneratedSpec({
      ...generatedSpec,
      questions: nextQuestions,
    });
    setSavedForLater(false);
    setSaveStatus('dirty');

    if (editingQuestionIdx === index) {
      setEditingQuestionIdx(targetIndex);
      setQuestionPage(Math.floor(targetIndex / QUESTIONS_PER_PAGE) + 1);
    } else if (editingQuestionIdx === targetIndex) {
      setEditingQuestionIdx(index);
      setQuestionPage(Math.floor(index / QUESTIONS_PER_PAGE) + 1);
    }
  };

  const handleDuplicateQuestion = (index: number) => {
    if (!generatedSpec) return;
    if (generatedSpec.questions.length >= 100) {
      toast.warning('Bộ câu hỏi hỗ trợ tối đa 100 câu hỏi.', 'Đã đạt giới hạn');
      return;
    }

    const sourceQ = generatedSpec.questions[index];
    const copyId = `q_copy_${Date.now()}_${index + 1}`;
    const duplicated: GameQuestion = {
      ...sourceQ,
      id: copyId,
      question: `${sourceQ.question} (Bản sao)`,
      choices: sourceQ.choices ? [...sourceQ.choices] : undefined,
      sliderConfig: sourceQ.sliderConfig ? { ...sourceQ.sliderConfig } : undefined,
      acceptedAlternatives: sourceQ.acceptedAlternatives ? [...sourceQ.acceptedAlternatives] : undefined,
      sourceReference: { ...sourceQ.sourceReference },
    };

    const nextQuestions = [
      ...generatedSpec.questions.slice(0, index + 1),
      duplicated,
      ...generatedSpec.questions.slice(index + 1),
    ];

    setGeneratedSpec({
      ...generatedSpec,
      questions: nextQuestions,
      settings: {
        ...generatedSpec.settings,
        questionCount: nextQuestions.length,
      },
    });
    const newIdx = index + 1;
    setEditingQuestionIdx(newIdx);
    setEditingQuestionDraft(cloneQuestionDraft(duplicated));
    setEditingQuestionError(null);
    setQuestionPage(Math.floor(newIdx / QUESTIONS_PER_PAGE) + 1);
    setSavedForLater(false);
    setSaveStatus('dirty');
  };

  const handleAddQuestion = () => {
    if (!generatedSpec) return;
    if (generatedSpec.questions.length >= 100) {
      toast.warning('Bộ câu hỏi hỗ trợ tối đa 100 câu hỏi.', 'Đã đạt giới hạn');
      return;
    }

    const fallbackSource = ingestedSources[0] || {
      sourceId: generatedSpec.sourceSummary?.sources?.[0]?.sourceId || 'src_manual',
      sourceType: generatedSpec.sourceSummary?.sources?.[0]?.sourceType || 'WEBSITE',
      sourceLocation: generatedSpec.sourceSummary?.sources?.[0]?.sourceLocation || 'Biên tập thủ công',
    };

    const configuredAdvType =
      generatedSpec.settings?.adventureConfig?.questionTypes?.[0] ||
      adventureQuestionTypes?.[0];
    const gType: QuestionType =
      generatedSpec.gameType === 'ADVENTURE'
        ? (configuredAdvType as QuestionType) || 'MULTIPLE_CHOICE'
        : generatedSpec.gameType === 'MIXED'
          ? 'MULTIPLE_CHOICE'
          : generatedSpec.gameType;
    const newIndex = generatedSpec.questions.length + 1;
    const newQuestion: GameQuestion = {
      id: `q_custom_${Date.now()}_${newIndex}`,
      type: gType,
      question:
        gType === 'FILL_IN_THE_BLANK' || gType === 'TYPE_ANSWER'
          ? `Câu hỏi tự nhập đáp án mới số ${newIndex}: Hãy nhập câu trả lời cho ___?`
          : gType === 'PUZZLE'
            ? `Sắp xếp các bước sau theo đúng trình tự (câu số ${newIndex}):`
            : gType === 'SLIDER'
              ? `Câu hỏi định lượng số ${newIndex}: Chọn giá trị đúng trên thanh trượt?`
              : `Câu hỏi mới số ${newIndex}?`,
      choices:
        gType === 'MULTIPLE_CHOICE' || gType === 'QUIZ'
          ? ['A. Phương án 1', 'B. Phương án 2', 'C. Phương án 3', 'D. Phương án 4']
          : gType === 'QUICK_BUTTON' || gType === 'TRUE_FALSE'
            ? ['Đúng', 'Sai']
            : gType === 'PUZZLE'
              ? ['Bước 1: Khởi tạo', 'Bước 2: Thực hiện', 'Bước 3: Hoàn tất']
              : undefined,
      sliderConfig:
        gType === 'SLIDER'
          ? { min: 0, max: 100, step: 1, correctValue: 50, tolerance: 2, unit: '%' }
          : undefined,
      correctAnswer:
        gType === 'MULTIPLE_CHOICE' || gType === 'QUIZ'
          ? 'A. Phương án 1'
          : gType === 'QUICK_BUTTON' || gType === 'TRUE_FALSE'
            ? 'Đúng'
            : gType === 'PUZZLE'
              ? 'Bước 1: Khởi tạo | Bước 2: Thực hiện | Bước 3: Hoàn tất'
              : gType === 'SLIDER'
                ? '50'
                : gType === 'CROSSWORD'
                  ? 'TUKHOA'
                  : 'Đáp án',
      explanation: 'Giải thích căn cứ theo nội dung tài liệu nguồn.',
      difficulty,
      crosswordClue: gType === 'CROSSWORD' ? `Gợi ý ô chữ câu số ${newIndex}` : undefined,
      crosswordAnswer: gType === 'CROSSWORD' ? 'TUKHOA' : undefined,
      sourceReference: {
        sourceId: fallbackSource.sourceId,
        sourceType: fallbackSource.sourceType as any,
        sourceLocation: fallbackSource.sourceLocation,
        section: 'Biên tập câu hỏi',
      },
    };

    const nextQuestions = [...generatedSpec.questions, newQuestion];
    setGeneratedSpec({
      ...generatedSpec,
      questions: nextQuestions,
      settings: {
        ...generatedSpec.settings,
        questionCount: nextQuestions.length,
      },
    });
    const addedIdx = nextQuestions.length - 1;
    setIsQuestionListCollapsed(false);
    setEditingQuestionIdx(addedIdx);
    setEditingQuestionDraft(cloneQuestionDraft(newQuestion));
    setEditingQuestionError(null);
    setQuestionPage(Math.floor(addedIdx / QUESTIONS_PER_PAGE) + 1);
    setSavedForLater(false);
    setSaveStatus('dirty');
  };

  const resolveActiveSpecWithPendingDraft = (): GameSpecification | null => {
    if (!generatedSpec) return null;
    const effectiveTitle = customGameTitle.trim() || generatedSpec.title;
    if (editingQuestionIdx !== null && editingQuestionDraft !== null) {
      const committed = handleCommitQuestionEdit(editingQuestionIdx, { silent: true });
      if (!committed) return null;
      return {
        ...committed,
        title: effectiveTitle,
      };
    }
    return {
      ...generatedSpec,
      title: effectiveTitle,
    };
  };

  const handleSaveSpecEdits = async (publishFlag?: boolean): Promise<GameSpecification | null> => {
    if (isSavingSpec) return null;
    const specToSave = resolveActiveSpecWithPendingDraft();
    if (!specToSave || !validateSpecBeforeLaunch(specToSave)) {
      return null;
    }

    const validRosterItemsToSave = parsedRosterDraft.validItems.map((it) => ({
      participantId: it.participantId,
      fullName: it.fullName,
      departmentUnit: it.departmentUnit,
      employeeCode: it.employeeCode,
      email: it.contactInfo,
      contactInfo: it.contactInfo,
    }));

    if (sessionMode === 'EXAM' && validRosterItemsToSave.length === 0) {
      setShowExamRosterError(true);
      toast.error(
        'Chế độ Thi nghiêm túc bắt buộc phải có danh sách thí sinh (ít nhất 1 người hợp lệ).',
        'Thiếu danh sách thí sinh'
      );
      return null;
    }

    const effectiveRosterModeForSave: RosterMode =
      sessionMode === 'EXAM'
        ? 'PRECONFIGURED'
        : validRosterItemsToSave.length > 0
        ? rosterMode === 'HYBRID'
          ? 'HYBRID'
          : 'PRECONFIGURED'
        : 'FREE_TEXT';
    setRosterMode(effectiveRosterModeForSave);

    const nextIsPublic =
      publishFlag !== undefined ? publishFlag : (specToSave.isPublic ?? true);
    const syncedAdvCfg =
      specToSave.gameType === 'ADVENTURE'
        ? syncAdventureStagesWithQuestions(
            specToSave.settings?.adventureConfig || adventureConfig,
            specToSave.questions
          )
        : undefined;

    setIsSavingSpec(true);
    setSaveStatus('saving');
    setSaveErrorMessage(null);
    try {
      const saved = await saveEditedQuestions(specToSave.gameId, {
        title: specToSave.title,
        description: specToSave.description,
        questions: specToSave.questions,
        settings: {
          timePerQuestion,
          ...(syncedAdvCfg ? { adventureConfig: syncedAdvCfg } : {}),
          scoringMode,
          sessionMode,
          passThresholdPercent,
          officialAttemptPolicy,
          rosterMode: effectiveRosterModeForSave,
          audioConfig,
        },
        participants: validRosterItemsToSave,
        requireRoster: sessionMode === 'EXAM',
        isPublic: nextIsPublic,
        ...(publishFlag === true && !specToSave.coverImageUrl ? { generateCover: true } : {}),
      });
      const finalSaved: GameSpecification =
        saved.gameType === 'ADVENTURE' && syncedAdvCfg && !saved.settings?.adventureConfig
          ? {
              ...saved,
              settings: {
                ...saved.settings,
                adventureConfig: syncedAdvCfg,
              },
            }
          : saved;
      syncedGameIdRef.current = finalSaved.gameId;
      loadedRosterGameIdRef.current = finalSaved.gameId;
      setGeneratedSpec(finalSaved);
      if (validRosterItemsToSave.length > 0 || btcParticipants.length > 0) {
        fetchGameParticipantsApi(finalSaved.gameId, { mode: 'admin' })
          .then((res) => {
            if (Array.isArray(res.participants)) {
              setBtcParticipants(res.participants);
            }
          })
          .catch(() => {});
      }
      if (finalSaved.settings?.adventureConfig) {
        setAdventureConfig(
          syncAdventureStagesWithQuestions(
            finalSaved.settings.adventureConfig,
            finalSaved.questions
          )
        );
      }
      setCustomGameTitle(finalSaved.title || specToSave.title);
      setEditingQuestionIdx(null);
      setEditingQuestionDraft(null);
      setEditingQuestionError(null);
      setSavedForLater(true);
      setSaveStatus('saved');
      setSaveErrorMessage(null);
      writeCreatorSessionSnapshot({
        spec: finalSaved,
        saveStatus: 'saved',
        savedForLater: true,
        customGameTitle: finalSaved.title || specToSave.title,
      });
      onCurrentSpecChange?.(finalSaved);
      if (publishFlag === true) {
        toast.success(
          'Đã lưu và xuất bản game công khai thành công! Bạn có thể chia sẻ Link/QR hoặc mở phòng chơi ngay.',
          'Xuất bản thành công'
        );
      } else if (publishFlag === false) {
        toast.success(
          'Đã lưu game ở trạng thái Bản nháp (chưa xuất bản công khai).',
          'Đã lưu bản nháp'
        );
      } else {
        toast.success('Đã lưu bộ câu hỏi vào cơ sở dữ liệu thành công!', 'Đã lưu');
      }
      return finalSaved;
    } catch (err: any) {
      const errMsg = err.message || 'Không thể lưu chỉnh sửa câu hỏi.';
      setSaveStatus('error');
      setSaveErrorMessage(errMsg);
      toast.error(errMsg, 'Lỗi lưu');
      return null;
    } finally {
      setIsSavingSpec(false);
    }
  };

  const handleStartPlaytest = () => {
    if (!generatedSpec) {
      toast.error('Vui lòng tạo bộ câu hỏi trước.', 'Chưa có bộ câu hỏi');
      return;
    }
    const effectiveTitle = customGameTitle.trim() || generatedSpec.title;
    let questionsForPlaytest = generatedSpec.questions.map(cloneQuestionDraft);
    if (editingQuestionIdx !== null && editingQuestionDraft !== null) {
      const candidate = normalizeDraftQuestionCandidate(editingQuestionDraft);
      const validationErr = validateQuestionItem(candidate);
      if (validationErr) {
        setEditingQuestionError(validationErr);
        toast.error(`Câu hỏi #${editingQuestionIdx + 1}: ${validationErr}`, 'Câu hỏi chưa hợp lệ');
        return;
      }
      questionsForPlaytest = questionsForPlaytest.map((q, idx) =>
        idx === editingQuestionIdx ? cloneQuestionDraft(candidate) : q
      );
    }
    const specForPlaytest: GameSpecification = {
      ...generatedSpec,
      title: effectiveTitle,
      questions: questionsForPlaytest,
    };
    if (!validateSpecBeforeLaunch(specForPlaytest)) {
      return;
    }
    const snapshot: GameSpecification = {
      ...specForPlaytest,
      questions: specForPlaytest.questions.map(cloneQuestionDraft),
      settings: {
        ...specForPlaytest.settings,
        questionCount: specForPlaytest.questions.length,
        scoringMode,
        timePerQuestion,
        sessionMode,
        passThresholdPercent,
        officialAttemptPolicy,
        rosterMode,
        audioConfig,
        ...(specForPlaytest.gameType === 'ADVENTURE'
          ? {
              adventureConfig: syncAdventureStagesWithQuestions(
                specForPlaytest.settings?.adventureConfig || adventureConfig,
                specForPlaytest.questions
              ),
            }
          : {}),
      },
    };
    soundManager.stopPreview();
    setIsAudioPreviewPlaying(false);
    setPlaytestSpec(snapshot);
    setIsPlaytestOpen(true);
  };

  const handleExitPlaytest = () => {
    setIsPlaytestOpen(false);
    setPlaytestSpec(null);
  };

  const [isRetryingAdventureAssets, setIsRetryingAdventureAssets] = useState(false);

  const handleRetryAdventureAssets = async () => {
    if (!generatedSpec || isRetryingAdventureAssets) return;
    setIsRetryingAdventureAssets(true);
    try {
      const currentAdv = generatedSpec.settings?.adventureConfig || adventureConfig;
      const updated = await retryAdventureAssetsApi(generatedSpec.gameId, {
        industryId: currentAdv.industryId,
        industryLabel: currentAdv.industryLabel,
        subEnvironment: currentAdv.subEnvironment,
        title: customGameTitle.trim() || generatedSpec.title,
        description: generatedSpec.description,
        questions: generatedSpec.questions,
        forceRegenerate: false,
      });
      setGeneratedSpec(updated);
      if (updated.settings?.adventureConfig) {
        setAdventureConfig(updated.settings.adventureConfig);
      }
      toast.success(
        'Đã tạo và xác thực thành công bộ 3 tài nguyên hình ảnh Adventure 2D (Background, Character, Obstacle)!',
        'Tài nguyên ảnh sẵn sàng'
      );
    } catch (err: any) {
      toast.error(
        err.message ||
          'Không thể tạo bộ tài nguyên hình ảnh Adventure. Bộ câu hỏi hiện tại vẫn được giữ nguyên.',
        'Lỗi tạo tài nguyên ảnh'
      );
    } finally {
      setIsRetryingAdventureAssets(false);
    }
  };

  const handleStartImmediately = async () => {
    if (!generatedSpec) {
      toast.error('Vui lòng tạo bộ câu hỏi trước.', 'Chưa có bộ câu hỏi');
      return;
    }
    if (!validateSpecBeforeLaunch(generatedSpec)) {
      return;
    }
    const saved = await handleSaveSpecEdits(generatedSpec.isPublic);
    if (!saved) {
      return;
    }
    setModeModalSpec(saved);
    setIsModeModalOpen(true);
  };

  const handlePublishAndUseNow = async () => {
    if (!generatedSpec) return;
    const saved = await handleSaveSpecEdits(true);
    if (!saved) {
      return;
    }
    setModeModalSpec(saved);
    setIsModeModalOpen(true);
  };

  const handleSaveForLater = async () => {
    if (!generatedSpec) return;
    const saved = await handleSaveSpecEdits(generatedSpec.isPublic);
    if (saved) {
      setSavedForLater(true);
    }
  };

  const handleExportCurrentGame = async (format: 'csv' | 'json') => {
    if (!generatedSpec) return;
    try {
      await downloadGameExport(generatedSpec.gameId, format);
      toast.success(`Đã xuất bộ câu hỏi định dạng ${format.toUpperCase()}`, 'Xuất thành công');
    } catch (err: any) {
      toast.error(err.message || 'Không thể xuất bộ câu hỏi.', 'Lỗi xuất dữ liệu');
    }
  };

  const handleStartSoloPlay = (specOverride?: GameSpecification) => {
    const target = specOverride || generatedSpec;
    if (!target || !validateSpecBeforeLaunch(target)) return;

    if (onNavigateToSoloPlay) {
      onNavigateToSoloPlay(target);
    } else if (onNavigateToPlay) {
      onNavigateToPlay(target.gameId);
    } else {
      window.location.search = `?play=${target.gameId}`;
    }
  };

  const handleProceedToStep5 = () => {
    if (validateSpecBeforeLaunch(generatedSpec)) {
      setCurrentStep(5);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleCopyLink = () => {
    if (!joinUrl) return;
    navigator.clipboard.writeText(joinUrl);
    toast.success('Đã sao chép liên kết tham gia vào bộ nhớ tạm!', 'Đã sao chép');
  };

  const renderMixedDistributionControl = () => {
    const total =
      (mixedDistribution.MULTIPLE_CHOICE || 0) +
      (mixedDistribution.QUICK_BUTTON || 0) +
      (mixedDistribution.FILL_IN_THE_BLANK || 0) +
      (mixedDistribution.CROSSWORD || 0);
    const isValid = total === 100;
    const counts = calculateMixedTypeCounts(questionCount, mixedDistribution);

    const typesConfig = [
      {
        key: 'MULTIPLE_CHOICE' as const,
        label: 'Trắc nghiệm',
        color: 'var(--game-mc)',
        icon: '▲',
      },
      {
        key: 'QUICK_BUTTON' as const,
        label: 'Đúng / Sai',
        color: 'var(--game-qb)',
        icon: '◆',
      },
      {
        key: 'FILL_IN_THE_BLANK' as const,
        label: 'Điền từ',
        color: 'var(--game-fill)',
        icon: '●',
      },
      {
        key: 'CROSSWORD' as const,
        label: 'Ô chữ',
        color: 'var(--game-cross)',
        icon: '■',
      },
    ];

    return (
      <div
        data-testid="mixed-distribution-panel"
        style={{
          marginTop: '0.65rem',
          backgroundColor: 'var(--bg-input)',
          border: `1.5px solid ${isValid ? 'rgba(16, 185, 129, 0.45)' : total > 100 ? 'rgba(239, 68, 68, 0.5)' : 'rgba(245, 158, 11, 0.5)'}`,
          borderRadius: '12px',
          padding: '0.85rem 0.95rem',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.65rem',
          transition: 'border-color 0.2s ease',
        }}
      >
        {/* Header với Tiêu đề và Status Pill */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <SparklesIcon size={15} style={{ color: 'var(--accent-sky)' }} />
            <span style={{ fontSize: '0.84rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
              Tỉ Lệ Bộ Đề Hỗn Hợp (4 loại cơ sở)
            </span>
          </div>

          <div
            data-testid="mixed-total-badge"
            style={{
              padding: '0.2rem 0.55rem',
              borderRadius: '20px',
              fontSize: '0.74rem',
              fontWeight: 800,
              backgroundColor: isValid ? 'rgba(16, 185, 129, 0.15)' : total > 100 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
              color: isValid ? 'var(--accent-emerald)' : total > 100 ? 'var(--accent-rose)' : 'var(--accent-amber)',
              border: `1px solid ${isValid ? 'var(--accent-emerald)' : total > 100 ? 'var(--accent-rose)' : 'var(--accent-amber)'}`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
          >
            {isValid ? (
              <>
                <CheckIcon size={12} />
                <span>Tổng: 100% Hợp lệ</span>
              </>
            ) : total > 100 ? (
              <>
                <AlertTriangleIcon size={12} />
                <span>Tổng: {total}% (Vượt {total - 100}%)</span>
              </>
            ) : (
              <>
                <AlertTriangleIcon size={12} />
                <span>Tổng: {total}% (Còn thiếu {100 - total}%)</span>
              </>
            )}
          </div>
        </div>

        {/* Visual Stacked Progress Bar */}
        <div
          style={{
            height: '8px',
            borderRadius: '4px',
            backgroundColor: 'var(--bg-card)',
            display: 'flex',
            overflow: 'hidden',
            border: '1px solid var(--border-subtle)',
          }}
        >
          {typesConfig.map(tc => {
            const pct = Math.max(0, Math.min(100, mixedDistribution[tc.key] || 0));
            const visualPct = total > 100 ? (pct / total) * 100 : pct;
            return (
              <div
                key={tc.key}
                style={{
                  width: `${visualPct}%`,
                  backgroundColor: tc.color,
                  transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                title={`${tc.label}: ${pct}% (${counts[tc.key] || 0} câu)`}
              />
            );
          })}
        </div>

        {!isValid && (
          <div
            role="alert"
            data-testid="mixed-ratio-warning"
            style={{
              padding: '0.45rem 0.65rem',
              borderRadius: '8px',
              backgroundColor: total > 100 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)',
              border: `1px solid ${total > 100 ? 'var(--accent-rose)' : 'var(--accent-amber)'}`,
              color: total > 100 ? 'var(--accent-rose)' : 'var(--accent-amber)',
              fontSize: '0.75rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
              flexWrap: 'wrap',
            }}
          >
            <span>
              {total < 100
                ? `Cảnh báo: Tổng tỷ lệ hiện tại là ${total}% (< 100%). Còn thiếu ${100 - total}% để tạo game.`
                : `Cảnh báo: Tổng tỷ lệ hiện tại là ${total}% (> 100%). Vui lòng giảm ${total - 100}% để tạo game.`}
            </span>
          </div>
        )}

        {/* 4 Cards Grid (2 cột x 2 hàng) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '0.45rem',
          }}
        >
          {typesConfig.map(tc => {
            const currentVal = mixedDistribution[tc.key] || 0;
            const countForType = counts[tc.key] || 0;
            const otherSum = total - currentVal;
            const maxAllowed = Math.max(0, 100 - otherSum);

            return (
              <div
                key={tc.key}
                data-testid={`mixed-card-${tc.key}`}
                style={{
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                  borderLeft: `3px solid ${tc.color}`,
                  borderRadius: '8px',
                  padding: '0.45rem 0.6rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                  opacity: currentVal === 0 ? 0.8 : 1,
                  transition: 'opacity 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, fontSize: '0.78rem', color: tc.color, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    <span>{tc.icon}</span> {tc.label}
                  </span>
                  <span
                    data-testid={`mixed-count-${tc.key}`}
                    style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-primary)' }}
                  >
                    {countForType} câu
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    type="range"
                    data-testid={`mixed-slider-${tc.key}`}
                    min="0"
                    max="100"
                    step="5"
                    value={currentVal}
                    onChange={e => {
                      const raw = Number.parseInt(e.target.value, 10);
                      setMixedDistribution(prev => {
                        const cur = prev[tc.key] || 0;
                        const sumOthers =
                          (prev.MULTIPLE_CHOICE || 0) +
                          (prev.QUICK_BUTTON || 0) +
                          (prev.FILL_IN_THE_BLANK || 0) +
                          (prev.CROSSWORD || 0) -
                          cur;
                        const allowed = Math.max(0, 100 - sumOthers);
                        const clamped = Number.isNaN(raw) ? 0 : Math.max(0, Math.min(allowed, Math.trunc(raw)));
                        return { ...prev, [tc.key]: clamped };
                      });
                    }}
                    style={{
                      flex: 1,
                      accentColor: tc.color,
                      cursor: 'pointer',
                      height: '4px',
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                    <input
                      type="number"
                      data-testid={`mixed-input-${tc.key}`}
                      min={0}
                      max={maxAllowed}
                      step={1}
                      value={currentVal}
                      onChange={e => {
                        const raw = Number.parseInt(e.target.value, 10);
                        setMixedDistribution(prev => {
                          const cur = prev[tc.key] || 0;
                          const sumOthers =
                            (prev.MULTIPLE_CHOICE || 0) +
                            (prev.QUICK_BUTTON || 0) +
                            (prev.FILL_IN_THE_BLANK || 0) +
                            (prev.CROSSWORD || 0) -
                            cur;
                          const allowed = Math.max(0, 100 - sumOthers);
                          const clamped = Number.isNaN(raw) ? 0 : Math.max(0, Math.min(allowed, Math.trunc(raw)));
                          return { ...prev, [tc.key]: clamped };
                        });
                      }}
                      style={{
                        width: '44px',
                        padding: '0.18rem 0.25rem',
                        borderRadius: '5px',
                        border: '1px solid var(--border-strong)',
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        textAlign: 'center',
                        boxSizing: 'border-box',
                      }}
                    />
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick Presets (Mẫu nhanh chuẩn 100%) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap', paddingTop: '0.4rem', borderTop: '1px dashed var(--border-subtle)' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>
            Mẫu nhanh:
          </span>
          {[
            { label: '25% đều', dist: { MULTIPLE_CHOICE: 25, QUICK_BUTTON: 25, FILL_IN_THE_BLANK: 25, CROSSWORD: 25 } },
            { label: 'Ưu tiên Trắc nghiệm', dist: { MULTIPLE_CHOICE: 50, QUICK_BUTTON: 20, FILL_IN_THE_BLANK: 15, CROSSWORD: 15 } },
            { label: 'Nhanh (TN + Đ/S)', dist: { MULTIPLE_CHOICE: 50, QUICK_BUTTON: 50, FILL_IN_THE_BLANK: 0, CROSSWORD: 0 } },
            { label: 'Từ vựng (Điền + Ô chữ)', dist: { MULTIPLE_CHOICE: 20, QUICK_BUTTON: 10, FILL_IN_THE_BLANK: 35, CROSSWORD: 35 } },
          ].map((preset, pIdx) => (
            <button
              key={pIdx}
              type="button"
              onClick={() => setMixedDistribution(preset.dist)}
              style={{
                padding: '0.18rem 0.5rem',
                borderRadius: '6px',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-secondary)',
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bg-elevated)';
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.borderColor = 'var(--primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                e.currentTarget.style.color = 'var(--text-secondary)';
                e.currentTarget.style.borderColor = 'var(--border-strong)';
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div
      className="creator-studio-page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        padding: '0.85rem 1.25rem',
      }}
    >
      {/* Header khu vực bảng điều khiển */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginBottom: '0.65rem',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <h1
            style={{
              margin: 0,
              color: 'var(--text-primary)',
              fontSize: '1.25rem',
              fontWeight: 900,
              letterSpacing: '-0.02em',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
            }}
          >
            <SparklesIcon size={20} style={{ color: 'var(--primary)' }} />
            <span>{generatedSpec ? generatedSpec.title : 'Tạo Trò Chơi Mới'}</span>
          </h1>
          {generatedSpec && (
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 800,
                padding: '0.15rem 0.5rem',
                borderRadius: '6px',
                backgroundColor: generatedSpec.isPublic
                  ? 'rgba(16, 185, 129, 0.15)'
                  : 'rgba(245, 158, 11, 0.15)',
                color: generatedSpec.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
              }}
            >
              {generatedSpec.isPublic ? 'Đã xuất bản' : 'Bản nháp'}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {onBackToHome && (
            <button
              type="button"
              onClick={onBackToHome}
              style={{
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-strong)',
                borderRadius: '8px',
                padding: '0 0.75rem',
                height: '34px',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <ArrowLeftIcon size={14} />
              <span>Trang Chủ</span>
            </button>
          )}
          {onNavigateToLibrary && (
            <button
              type="button"
              onClick={onNavigateToLibrary}
              style={{
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-strong)',
                borderRadius: '8px',
                padding: '0 0.75rem',
                height: '34px',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <BookOpenIcon size={14} />
              <span>Kho Game</span>
            </button>
          )}
        </div>
      </header>

      {/* 2-COLUMN COCKPIT WORKSPACE */}
      <div className="creator-studio-grid">
        {/* ============================================================ */}
        {/* CỘT TRÁI: NGUỒN NỘI DUNG & TẠO GAME AI                       */}
        {/* ============================================================ */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderRadius: '14px',
            border: '1px solid var(--border-subtle)',
            padding: '1.15rem 1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem',
            overflowY: 'auto',
            boxSizing: 'border-box',
          }}
        >
          {/* Header nhóm 1 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontSize: '0.86rem',
                fontWeight: 900,
                color: 'var(--text-primary)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <span>1. Thông Tin & Nguồn</span>
            </span>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Tên • Nguồn • Thể loại
            </span>
          </div>

          {/* 1. Tên trò chơi (Định danh đầu vào) */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
              <label
                htmlFor="studio-game-title"
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  color: 'var(--text-primary)',
                }}
              >
                Tên Trò Chơi
              </label>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                (Tùy chọn)
              </span>
            </div>
            <input
              id="studio-game-title"
              type="text"
              value={customGameTitle}
              onChange={(e) => {
                const nextTitle = e.target.value;
                setCustomGameTitle(nextTitle);
                if (generatedSpec) {
                  setGeneratedSpec((prev) => (prev ? { ...prev, title: nextTitle } : prev));
                  setSavedForLater(false);
                  setSaveStatus('dirty');
                }
              }}
              placeholder="Ví dụ: Đấu trường Lịch sử Thế giới 2026..."
              style={{
                width: '100%',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-strong)',
                borderRadius: '8px',
                padding: '0.5rem 0.75rem',
                color: 'var(--text-primary)',
                fontSize: '0.86rem',
                fontWeight: 700,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* 2. Nguồn nội dung */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                Nguồn Nội Dung
              </label>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                URL • File • Chủ đề
              </span>
            </div>

          {/* Segmented Control Tabs */}
          <div
            style={{
              display: 'flex',
              gap: '0.25rem',
              backgroundColor: 'var(--bg-input)',
              padding: '0.25rem',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <button
              type="button"
              onClick={() => setSourceTab('URL')}
              style={{
                flex: 1,
                backgroundColor: sourceTab === 'URL' ? 'var(--bg-surface)' : 'transparent',
                color: sourceTab === 'URL' ? 'var(--primary)' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: '6px',
                padding: '0.45rem',
                fontSize: '0.82rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.3rem',
                boxShadow: sourceTab === 'URL' ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
              }}
            >
              <GlobeIcon size={14} />
              <span>URL Web</span>
            </button>
            <button
              type="button"
              onClick={() => setSourceTab('FILE')}
              style={{
                flex: 1,
                backgroundColor: sourceTab === 'FILE' ? 'var(--bg-surface)' : 'transparent',
                color: sourceTab === 'FILE' ? 'var(--primary)' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: '6px',
                padding: '0.45rem',
                fontSize: '0.82rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.3rem',
                boxShadow: sourceTab === 'FILE' ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
              }}
            >
              <UploadIcon size={14} />
              <span>Tài Liệu</span>
            </button>
            <button
              type="button"
              onClick={() => setSourceTab('TOPIC')}
              style={{
                flex: 1,
                backgroundColor: sourceTab === 'TOPIC' ? 'var(--bg-surface)' : 'transparent',
                color: sourceTab === 'TOPIC' ? 'var(--primary)' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: '6px',
                padding: '0.45rem',
                fontSize: '0.82rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.3rem',
                boxShadow: sourceTab === 'TOPIC' ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
              }}
            >
              <SparklesIcon size={14} />
              <span>Chủ Đề</span>
            </button>
          </div>

          {/* Source Input Area (Card) */}
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              borderRadius: '10px',
              padding: '0.85rem',
              border: '1px solid var(--border-subtle)',
              minHeight: '110px',
            }}
          >
            {/* Tab URL */}
            {sourceTab === 'URL' && (
              <div>
                {urls.map((url, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => handleUrlChange(idx, e.target.value)}
                      placeholder="https://vi.wikipedia.org/wiki/..."
                      style={{
                        flex: 1,
                        backgroundColor: 'var(--bg-input)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '6px',
                        padding: '0.5rem 0.75rem',
                        color: 'var(--text-primary)',
                        fontSize: '0.85rem',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    {urls.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveUrlField(idx)}
                        style={{
                          backgroundColor: 'transparent',
                          color: 'var(--accent-rose)',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '0.35rem',
                        }}
                      >
                        <XMarkIcon size={14} />
                      </button>
                    )}
                  </div>
                ))}
                {urls.length < MAX_URLS && (
                  <button
                    type="button"
                    onClick={handleAddUrlField}
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--primary)',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      padding: '0.2rem 0',
                    }}
                  >
                    <PlusIcon size={13} />
                    <span>Thêm URL</span>
                  </button>
                )}
              </div>
            )}

            {/* Tab FILE */}
            {sourceTab === 'FILE' && (
              <div>
                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                    padding: '1rem 0.5rem',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-input)',
                    border: '1px dashed var(--border-strong)',
                    cursor: files.length >= MAX_FILES ? 'not-allowed' : 'pointer',
                    opacity: files.length >= MAX_FILES ? 0.7 : 1,
                    marginBottom: '0.5rem',
                    textAlign: 'center',
                  }}
                >
                  <UploadIcon size={20} style={{ color: 'var(--primary)' }} />
                  <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {files.length >= MAX_FILES ? 'Đã đạt giới hạn tối đa 5 tệp' : 'Chọn tệp tài liệu từ thiết bị'}
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    Hỗ trợ PDF, DOCX, XLSX, TXT, MD, CSV • Tối đa 5 tệp (10MB/tệp, tổng 25MB)
                  </span>
                  <input
                    type="file"
                    multiple
                    disabled={files.length >= MAX_FILES}
                    accept=".pdf,.docx,.xlsx,.txt,.md,.markdown,.csv"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                </label>

                {files.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 0.15rem' }}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                        Đã chọn {files.length}/{MAX_FILES} tệp
                      </span>
                      <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                        Tổng: {formatFileSize(files.reduce((sum, f) => sum + f.size, 0))} / 25MB
                      </span>
                    </div>

                    {files.map((file, idx) => (
                      <div
                        key={`${file.name}-${idx}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.45rem 0.65rem',
                          borderRadius: '6px',
                          backgroundColor: 'var(--bg-card)',
                          border: '1px solid var(--border-subtle)',
                          fontSize: '0.78rem',
                          gap: '0.5rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0, flex: 1 }}>
                          <span
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              textTransform: 'uppercase',
                              padding: '0.1rem 0.35rem',
                              borderRadius: '4px',
                              backgroundColor: 'var(--primary-subtle)',
                              color: 'var(--primary)',
                              flexShrink: 0,
                            }}
                          >
                            {file.name.split('.').pop() || 'FILE'}
                          </span>
                          <span
                            style={{
                              color: 'var(--text-primary)',
                              fontWeight: 600,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={file.name}
                          >
                            {file.name}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                            {formatFileSize(file.size)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(idx)}
                            aria-label={`Xóa tệp ${file.name}`}
                            title="Xóa tệp này"
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--accent-rose)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              padding: '0.15rem',
                            }}
                          >
                            <XMarkIcon size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab TOPIC */}
            {sourceTab === 'TOPIC' && (
              <div>
                <textarea
                  value={topicFocus}
                  onChange={(e) => setTopicFocus(e.target.value)}
                  placeholder="Nhập chủ đề kiến thức tự do để AI tổng hợp câu hỏi..."
                  rows={3}
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '6px',
                    padding: '0.55rem 0.75rem',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    outline: 'none',
                    resize: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* 3. Chọn thể loại game (Chống giật layout) */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '0.82rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              marginBottom: '0.35rem',
            }}
          >
            Thể Loại Trò Chơi
          </label>
          <GameTypeSelector variant="chips" selectedType={gameType} onSelectType={(t) => setGameType(t)} />

          {/* Dưới thể loại trò chơi: Khi chọn Bộ đề hỗn hợp (MIXED) thì hiện ra bảng chọn tỉ lệ */}
          {gameType === 'MIXED' && renderMixedDistributionControl()}
          {gameType === 'ADVENTURE' && (
            <div
              style={{
                marginTop: '0.65rem',
                backgroundColor: 'var(--bg-input)',
                border: '1.5px solid rgba(245, 158, 11, 0.5)',
                borderRadius: '12px',
                padding: '0.85rem 0.95rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.55rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 900, color: 'var(--accent-amber)' }}>
                  🏍️ Ngành Nghề & Bối Cảnh Đi Cảnh
                </span>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  AI Tự Nhận Diện hoặc Chọn Sẵn
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.35rem' }}>
                <button
                  type="button"
                  onClick={() => setAdventureIndustryMode('AI_DETECT')}
                  style={{
                    textAlign: 'left',
                    padding: '0.4rem 0.6rem',
                    borderRadius: '6px',
                    backgroundColor: adventureIndustryMode === 'AI_DETECT' ? 'var(--primary)' : 'var(--bg-card)',
                    color: adventureIndustryMode === 'AI_DETECT' ? 'var(--primary-ink, #090d16)' : 'var(--text-primary)',
                    border: '1px solid var(--border-strong)',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  AI Tự Nhận Diện
                </button>
                {INDUSTRY_CATALOG.map(ind => {
                  const isSel = adventureIndustryMode === ind.industryId;
                  return (
                    <button
                      key={`chip_${ind.industryId}`}
                      type="button"
                      onClick={() => { setAdventureIndustryMode(ind.industryId); setAdventureConfig(prev => applyPresetToAdventureConfig({ ...prev, industryId: ind.industryId, industryLabel: ind.label, aiDetectedIndustry: false }, ind.defaultPresetId, generatedSpec?.questions || [])); }}
                      style={{
                        textAlign: 'left',
                        padding: '0.4rem 0.6rem',
                        borderRadius: '6px',
                        backgroundColor: isSel ? 'var(--primary)' : 'var(--bg-card)',
                        color: isSel ? 'var(--primary-ink, #090d16)' : 'var(--text-primary)',
                        border: '1px solid var(--border-strong)',
                        fontSize: '0.75rem',
                        fontWeight: isSel ? 800 : 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={ind.label}
                    >
                      {ind.label}
                    </button>
                  );
                })}
              </div>
              <div>
                <span style={{ display: 'none' }}>
                </span>
              </div>
              <select
                value={adventureIndustryMode}
                onChange={e => { const val = e.target.value as 'AI_DETECT' | IndustryId; setAdventureIndustryMode(val); if (val !== 'AI_DETECT') { const cat = INDUSTRY_CATALOG.find(item => item.industryId === val); if (cat) setAdventureConfig(prev => applyPresetToAdventureConfig({ ...prev, industryId: cat.industryId, industryLabel: cat.label, aiDetectedIndustry: false }, cat.defaultPresetId, generatedSpec?.questions || [])); } }}
                style={{
                  width: '100%',
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0.5rem 0.65rem',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                }}
              >
                <option value="AI_DETECT">🤖 Để AI tự nhận diện ngành nghề & bối cảnh từ nội dung nguồn</option>
                {INDUSTRY_CATALOG.map(ind => (
                  <option key={ind.industryId} value={ind.industryId}>
                    {ind.icon} {ind.label}
                  </option>
                ))}
              </select>
              {adventureIndustryMode === 'CUSTOM' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  <input
                    type="text"
                    value={customIndustryName}
                    onChange={e => setCustomIndustryName(e.target.value)}
                    placeholder="Nhập tên ngành nghề tùy chỉnh của bạn (VD: Kỹ thuật hàng không vũ trụ)..."
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '8px',
                      padding: '0.45rem 0.65rem',
                      color: 'var(--text-primary)',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                    }}
                  />
                  <input
                    type="text"
                    value={customSubEnvironment}
                    onChange={e => setCustomSubEnvironment(e.target.value)}
                    placeholder="Bối cảnh mong muốn (VD: Trung tâm nghiên cứu và lắp ráp tàu vũ trụ)..."
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '8px',
                      padding: '0.45rem 0.65rem',
                      color: 'var(--text-primary)',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                    }}
                  />
                </div>
              )}
              {/* Bước chọn loại câu hỏi và cấu hình tỷ lệ trong hành trình đi cảnh */}
              {(() => {
                const advTotal =
                  (adventureQuestionDistribution.MULTIPLE_CHOICE || 0) +
                  (adventureQuestionDistribution.QUICK_BUTTON || 0) +
                  (adventureQuestionDistribution.FILL_IN_THE_BLANK || 0) +
                  (adventureQuestionDistribution.CROSSWORD || 0);
                const advValid = adventureQuestionTypes.length > 0 && advTotal === 100;
                const advCounts = calculateMixedTypeCounts(questionCount, adventureQuestionDistribution);
                const advTypeOptions = [
                  {
                    type: 'MULTIPLE_CHOICE' as const,
                    label: 'Trắc nghiệm 4 lựa chọn',
                    shortLabel: 'Trắc nghiệm',
                    desc: '4 phương án A, B, C, D',
                    color: 'var(--game-mc)',
                    icon: '▲',
                  },
                  {
                    type: 'QUICK_BUTTON' as const,
                    label: 'Đúng hoặc Sai',
                    shortLabel: 'Đúng / Sai',
                    desc: 'Nhận định nhanh Đúng hoặc Sai',
                    color: 'var(--game-qb)',
                    icon: '◆',
                  },
                  {
                    type: 'FILL_IN_THE_BLANK' as const,
                    label: 'Điền vào chỗ trống',
                    shortLabel: 'Điền từ',
                    desc: 'Điền từ khóa còn thiếu vào câu',
                    color: 'var(--game-fill)',
                    icon: '●',
                  },
                  {
                    type: 'CROSSWORD' as const,
                    label: 'Ô chữ từ khóa',
                    shortLabel: 'Ô chữ',
                    desc: 'Giải từ khóa theo gợi ý định nghĩa',
                    color: 'var(--game-cross)',
                    icon: '■',
                  },
                ];

                return (
                  <div
                    data-testid="adventure-question-config-panel"
                    style={{
                      marginTop: '0.35rem',
                      paddingTop: '0.65rem',
                      borderTop: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem',
                    }}
                  >
                    <style>{`
                      [data-testid="adventure-question-config-panel"] {
                        container-type: inline-size;
                      }
                      [data-testid="adventure-question-config-panel"] .adv-qtype-grid {
                        display: grid;
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                        grid-auto-rows: 1fr;
                        gap: 0.45rem;
                        align-items: stretch;
                      }
                      @container (max-width: 445px) {
                        [data-testid="adventure-question-config-panel"] .adv-qtype-header-title {
                          font-size: 0.74rem !important;
                        }
                        [data-testid="adventure-question-config-panel"] [data-testid="adventure-selected-types-badge"],
                        [data-testid="adventure-question-config-panel"] [data-testid="adventure-total-badge"] {
                          font-size: 0.64rem !important;
                          padding: 0.1rem 0.36rem !important;
                        }
                        [data-testid="adventure-question-config-panel"] [data-testid^="adventure-type-card-"] {
                          padding: 0.44rem 0.42rem !important;
                        }
                        [data-testid="adventure-question-config-panel"] [data-testid^="adventure-label-"] {
                          font-size: 0.68rem !important;
                          letter-spacing: -0.02em !important;
                        }
                        [data-testid="adventure-question-config-panel"] [data-testid^="adventure-count-"] {
                          font-size: 0.63rem !important;
                          padding: 0.04rem 0.22rem !important;
                        }
                        [data-testid="adventure-question-config-panel"] .adv-qtype-footer-note {
                          font-size: 0.66rem !important;
                        }
                        [data-testid="adventure-question-config-panel"] [data-testid="adventure-rebalance-btn"] {
                          font-size: 0.66rem !important;
                          padding: 0.14rem 0.42rem !important;
                        }
                      }
                      @container (max-width: 390px) {
                        [data-testid="adventure-question-config-panel"] .adv-qtype-grid {
                          grid-template-columns: 1fr;
                          grid-auto-rows: auto;
                        }
                      }
                      @media (max-width: 520px) {
                        [data-testid="adventure-question-config-panel"] .adv-qtype-grid {
                          grid-template-columns: 1fr;
                          grid-auto-rows: auto;
                        }
                      }
                      [data-testid="adventure-question-config-panel"] .adv-pct-input::-webkit-inner-spin-button,
                      [data-testid="adventure-question-config-panel"] .adv-pct-input::-webkit-outer-spin-button {
                        -webkit-appearance: none;
                        margin: 0;
                      }
                      [data-testid="adventure-question-config-panel"] .adv-pct-input {
                        -moz-appearance: textfield;
                        appearance: textfield;
                      }
                      [data-testid="adventure-question-config-panel"] .adv-range-slider {
                        margin: 0;
                        padding: 0;
                      }
                    `}</style>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '0.3rem 0.4rem',
                      }}
                    >
                      <span
                        className="adv-qtype-header-title"
                        style={{
                          fontSize: '0.79rem',
                          fontWeight: 800,
                          letterSpacing: '-0.01em',
                          color: 'var(--text-primary)',
                          lineHeight: 1.3,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Loại câu hỏi trong game đi cảnh
                      </span>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span
                          data-testid="adventure-selected-types-badge"
                          style={{
                            padding: '0.12rem 0.42rem',
                            borderRadius: '999px',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                            lineHeight: 1.3,
                            backgroundColor:
                              adventureQuestionTypes.length > 0
                                ? 'rgba(16, 185, 129, 0.12)'
                                : 'rgba(239, 68, 68, 0.12)',
                            color:
                              adventureQuestionTypes.length > 0
                                ? 'var(--accent-emerald)'
                                : 'var(--accent-rose)',
                            border: `1px solid ${
                              adventureQuestionTypes.length > 0
                                ? 'rgba(16, 185, 129, 0.35)'
                                : 'rgba(239, 68, 68, 0.35)'
                            }`,
                          }}
                        >
                          {adventureQuestionTypes.length > 0
                            ? `Đã chọn ${adventureQuestionTypes.length}/4 loại`
                            : 'Chưa chọn loại nào'}
                        </span>
                        <span
                          data-testid="adventure-total-badge"
                          style={{
                            padding: '0.12rem 0.46rem',
                            borderRadius: '999px',
                            fontSize: '0.68rem',
                            fontWeight: 800,
                            whiteSpace: 'nowrap',
                            lineHeight: 1.3,
                            backgroundColor: advValid
                              ? 'rgba(16, 185, 129, 0.15)'
                              : advTotal > 100 || adventureQuestionTypes.length === 0
                                ? 'rgba(239, 68, 68, 0.15)'
                                : 'rgba(245, 158, 11, 0.15)',
                            color: advValid
                              ? 'var(--accent-emerald)'
                              : advTotal > 100 || adventureQuestionTypes.length === 0
                                ? 'var(--accent-rose)'
                                : 'var(--accent-amber)',
                            border: `1px solid ${
                              advValid
                                ? 'var(--accent-emerald)'
                                : advTotal > 100 || adventureQuestionTypes.length === 0
                                  ? 'var(--accent-rose)'
                                  : 'var(--accent-amber)'
                            }`,
                          }}
                        >
                          {advValid
                            ? 'Tổng: 100% — Hợp lệ'
                            : advTotal > 100
                              ? `Tổng: ${advTotal}% (Vượt ${advTotal - 100}%)`
                              : `Tổng: ${advTotal}% (Còn thiếu ${100 - advTotal}%)`}
                        </span>
                      </div>
                    </div>

                    <div className="adv-qtype-grid">
                      {advTypeOptions.map(opt => {
                        const checked = adventureQuestionTypes.includes(opt.type);
                        const pct = checked ? adventureQuestionDistribution[opt.type] || 0 : 0;
                        const countForType = checked ? advCounts[opt.type] || 0 : 0;
                        const otherSum = advTotal - pct;
                        const maxAllowed = checked ? Math.max(0, 100 - otherSum) : 0;
                        return (
                          <div
                            key={opt.type}
                            data-testid={`adventure-type-card-${opt.type}`}
                            style={{
                              padding: '0.48rem 0.54rem',
                              borderRadius: '8px',
                              backgroundColor: checked ? 'var(--bg-elevated)' : 'var(--bg-card)',
                              border: checked
                                ? '1.5px solid var(--primary)'
                                : '1px solid var(--border-strong)',
                              borderLeft: `3px solid ${checked ? opt.color : 'var(--border-strong)'}`,
                              color: 'var(--text-primary)',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between',
                              gap: '0.36rem',
                              height: '100%',
                              minWidth: 0,
                              boxSizing: 'border-box',
                              opacity: checked ? 1 : 0.68,
                              transition: 'border-color 0.15s ease, background-color 0.15s ease, opacity 0.15s ease',
                            }}
                          >
                            <button
                              type="button"
                              role="checkbox"
                              data-testid={`adventure-type-toggle-${opt.type}`}
                              aria-checked={checked}
                              onClick={() => toggleAdventureQuestionType(opt.type)}
                              style={{
                                textAlign: 'left',
                                padding: 0,
                                border: 'none',
                                background: 'transparent',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.2rem',
                                width: '100%',
                                minWidth: 0,
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: '0.3rem',
                                  width: '100%',
                                  minWidth: 0,
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.34rem',
                                    minWidth: 0,
                                    flex: 1,
                                  }}
                                >
                                  <span
                                    style={{
                                      width: '14px',
                                      height: '14px',
                                      borderRadius: '3.5px',
                                      flexShrink: 0,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      backgroundColor: checked ? 'var(--primary)' : 'var(--bg-input)',
                                      border: checked ? '1px solid var(--primary)' : '1px solid var(--border-strong)',
                                      color: 'var(--primary-ink, #090d16)',
                                      fontSize: '0.62rem',
                                      fontWeight: 900,
                                      lineHeight: 1,
                                    }}
                                  >
                                    {checked ? '✓' : ''}
                                  </span>
                                  <span
                                    data-testid={`adventure-label-${opt.type}`}
                                    title={opt.label}
                                    style={{
                                      fontSize: '0.73rem',
                                      fontWeight: 800,
                                      letterSpacing: '-0.015em',
                                      color: checked ? opt.color : 'var(--text-primary)',
                                      lineHeight: 1.25,
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      minWidth: 0,
                                    }}
                                  >
                                    {opt.label}
                                  </span>
                                </div>
                                <span
                                  data-testid={`adventure-count-${opt.type}`}
                                  style={{
                                    fontSize: '0.67rem',
                                    fontWeight: 800,
                                    color: checked ? 'var(--text-primary)' : 'var(--text-muted)',
                                    backgroundColor: checked ? 'var(--bg-input)' : 'transparent',
                                    border: checked
                                      ? '1px solid var(--border-subtle)'
                                      : '1px solid transparent',
                                    borderRadius: '4px',
                                    padding: '0.05rem 0.28rem',
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0,
                                    lineHeight: 1.25,
                                    fontVariantNumeric: 'tabular-nums',
                                  }}
                                >
                                  {countForType} câu
                                </span>
                              </div>
                              <div
                                data-testid={`adventure-desc-${opt.type}`}
                                title={opt.desc}
                                style={{
                                  fontSize: '0.67rem',
                                  color: 'var(--text-secondary)',
                                  lineHeight: 1.3,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  width: '100%',
                                  boxSizing: 'border-box',
                                }}
                              >
                                {opt.desc}
                              </div>
                            </button>

                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.45rem',
                                marginTop: 'auto',
                                paddingTop: '0.1rem',
                                height: '24px',
                                width: '100%',
                                boxSizing: 'border-box',
                              }}
                            >
                              <input
                                type="range"
                                className="adv-range-slider"
                                data-testid={`adventure-slider-${opt.type}`}
                                min="0"
                                max="100"
                                step="5"
                                value={pct}
                                disabled={!checked}
                                onChange={e => {
                                  if (!checked) return;
                                  const raw = Number.parseInt(e.target.value, 10);
                                  setAdventureQuestionDistribution(prev => {
                                    const cur = prev[opt.type] || 0;
                                    const sumOthers =
                                      (prev.MULTIPLE_CHOICE || 0) +
                                      (prev.QUICK_BUTTON || 0) +
                                      (prev.FILL_IN_THE_BLANK || 0) +
                                      (prev.CROSSWORD || 0) -
                                      cur;
                                    const allowed = Math.max(0, 100 - sumOthers);
                                    const clamped = Number.isNaN(raw) ? 0 : Math.max(0, Math.min(allowed, Math.trunc(raw)));
                                    return {
                                      ...prev,
                                      [opt.type]: clamped,
                                    };
                                  });
                                }}
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  width: '100%',
                                  accentColor: opt.color,
                                  cursor: checked ? 'pointer' : 'not-allowed',
                                  height: '4px',
                                  opacity: checked ? 1 : 0.45,
                                }}
                              />
                              <div
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'flex-end',
                                  gap: '1px',
                                  height: '24px',
                                  minWidth: '50px',
                                  padding: '0 0.3rem',
                                  borderRadius: '5px',
                                  border: '1px solid var(--border-strong)',
                                  backgroundColor: checked ? 'var(--bg-input)' : 'var(--bg-card)',
                                  opacity: checked ? 1 : 0.65,
                                  flexShrink: 0,
                                  boxSizing: 'border-box',
                                }}
                              >
                                <input
                                  type="number"
                                  className="adv-pct-input"
                                  data-testid={`adventure-input-${opt.type}`}
                                  min={0}
                                  max={maxAllowed}
                                  step={1}
                                  value={pct}
                                  disabled={!checked}
                                  onChange={e => {
                                    if (!checked) return;
                                    const raw = Number.parseInt(e.target.value, 10);
                                    setAdventureQuestionDistribution(prev => {
                                      const cur = prev[opt.type] || 0;
                                      const sumOthers =
                                        (prev.MULTIPLE_CHOICE || 0) +
                                        (prev.QUICK_BUTTON || 0) +
                                        (prev.FILL_IN_THE_BLANK || 0) +
                                        (prev.CROSSWORD || 0) -
                                        cur;
                                      const allowed = Math.max(0, 100 - sumOthers);
                                      const clamped = Number.isNaN(raw) ? 0 : Math.max(0, Math.min(allowed, Math.trunc(raw)));
                                      return {
                                        ...prev,
                                        [opt.type]: clamped,
                                      };
                                    });
                                  }}
                                  style={{
                                    width: '28px',
                                    height: '20px',
                                    padding: 0,
                                    margin: 0,
                                    border: 'none',
                                    backgroundColor: 'transparent',
                                    color: checked ? 'var(--text-primary)' : 'var(--text-muted)',
                                    fontSize: '0.74rem',
                                    fontWeight: 800,
                                    textAlign: 'right',
                                    outline: 'none',
                                    boxSizing: 'border-box',
                                    fontVariantNumeric: 'tabular-nums',
                                    lineHeight: 1,
                                    cursor: checked ? 'text' : 'not-allowed',
                                  }}
                                />
                                <span
                                  style={{
                                    fontSize: '0.69rem',
                                    fontWeight: 700,
                                    color: checked ? 'var(--text-secondary)' : 'var(--text-muted)',
                                    lineHeight: 1,
                                    flexShrink: 0,
                                    userSelect: 'none',
                                  }}
                                >
                                  %
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {adventureQuestionTypes.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.4rem',
                          flexWrap: 'wrap',
                          paddingTop: '0.3rem',
                          borderTop: '1px dashed var(--border-subtle)',
                        }}
                      >
                        <span
                          className="adv-qtype-footer-note"
                          style={{
                            fontSize: '0.71rem',
                            color: 'var(--text-muted)',
                            fontWeight: 600,
                            lineHeight: 1.3,
                          }}
                        >
                          Loại không chọn cố định ở 0% và không sinh câu hỏi.
                        </span>
                        <button
                          type="button"
                          data-testid="adventure-rebalance-btn"
                          onClick={() =>
                            setAdventureQuestionDistribution(
                              buildDefaultQuestionDistributionForTypes(adventureQuestionTypes)
                            )
                          }
                          style={{
                            padding: '0.18rem 0.55rem',
                            height: '25px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '6px',
                            backgroundColor: 'var(--bg-card)',
                            border: '1px solid var(--border-strong)',
                            color: 'var(--text-secondary)',
                            fontSize: '0.71rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                          }}
                        >
                          Chia đều 100% ({adventureQuestionTypes.length} loại)
                        </button>
                      </div>
                    )}

                    {adventureQuestionTypes.length === 0 && (
                      <div
                        role="alert"
                        data-testid="adventure-empty-types-warning"
                        style={{
                          padding: '0.45rem 0.65rem',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(239, 68, 68, 0.12)',
                          border: '1px solid var(--accent-rose)',
                          color: 'var(--accent-rose)',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                        }}
                      >
                        Vui lòng chọn ít nhất một loại câu hỏi cho game Đi cảnh.
                      </div>
                    )}

                    {adventureQuestionTypes.length > 0 && advTotal !== 100 && (
                      <div
                        role="alert"
                        data-testid="adventure-ratio-warning"
                        style={{
                          padding: '0.45rem 0.65rem',
                          borderRadius: '6px',
                          backgroundColor: advTotal > 100 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                          border: `1px solid ${advTotal > 100 ? 'var(--accent-rose)' : 'var(--accent-amber)'}`,
                          color: advTotal > 100 ? 'var(--accent-rose)' : 'var(--accent-amber)',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                        }}
                      >
                        {advTotal < 100
                          ? `Cảnh báo: Tổng tỷ lệ câu hỏi Adventure hiện tại là ${advTotal}% (< 100%). Còn thiếu ${100 - advTotal}% để tạo game.`
                          : `Cảnh báo: Tổng tỷ lệ câu hỏi Adventure hiện tại là ${advTotal}% (> 100%). Vui lòng giảm ${advTotal - 100}% để tạo game.`}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* CỘT PHẢI: CẤU HÌNH TẠO CÂU HỎI & WORKBENCH SOẠN THẢO         */}
      {/* ============================================================ */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderRadius: '14px',
          border: '1px solid var(--border-subtle)',
          padding: '1.15rem 1.25rem',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
      >
          {/* ======================================================== */}
          {/* SETTINGS / CONFIGURATION & ACTION MODE                   */}
          {/* ======================================================== */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {/* Header nhóm 2 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: '0.86rem',
                    fontWeight: 900,
                    color: 'var(--text-primary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <span>2. Cấu Hình Tạo Câu Hỏi</span>
                </span>
                <span style={{ fontSize: '0.74rem', color: 'var(--accent-sky)', fontWeight: 700 }}>
                  {formatGameTypeLabel(gameType)}
                </span>
              </div>

              {/* Thiết lập thông số câu hỏi */}
              <div
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderRadius: '12px',
                  padding: '0.85rem 1rem',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                {/* 1. Độ Khó */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.3rem' }}>
                    1. Độ Khó
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.35rem' }}>
                    {(['EASY', 'MEDIUM', 'HARD'] as Difficulty[]).map((lvl) => {
                      const isSel = difficulty === lvl;
                      const label = lvl === 'EASY' ? 'Dễ' : lvl === 'MEDIUM' ? 'Vừa' : 'Khó';
                      return (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => setDifficulty(lvl)}
                          style={{
                            backgroundColor: isSel ? 'var(--primary)' : 'var(--bg-input)',
                            color: isSel ? 'var(--primary-ink)' : 'var(--text-secondary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '6px',
                            padding: '0.4rem',
                            fontSize: '0.8rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Số Lượng Câu Hỏi */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <label style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      2. Số Lượng Câu Hỏi: {questionCount} câu
                    </label>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      (1 - 100)
                    </span>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={questionCount}
                    onChange={(e) => setQuestionCount(Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 5)))}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '6px',
                      padding: '0.45rem 0.65rem',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* 3. Chế Độ Tính Điểm */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
                    3. Chế Độ Tính Điểm
                  </label>
                  <select
                    value={scoringMode}
                    onChange={(e) => setScoringMode(e.target.value as ScoringMode)}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '6px',
                      padding: '0.45rem 0.65rem',
                      color: 'var(--text-primary)',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="STANDARD">Điểm chuẩn (100đ / câu)</option>
                    <option value="SPEED_BONUS">Thưởng tốc độ (+50đ tối đa)</option>
                    <option value="STREAK">Chuỗi liên tiếp (Streak Bonus)</option>
                  </select>
                </div>

                {/* 4. Cấu hình khác: Thời Gian Mỗi Câu Hỏi */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <label style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      4. Thời Gian Mỗi Câu Hỏi: {timePerQuestion}s
                    </label>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      (5s - 120s)
                    </span>
                  </div>
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={timePerQuestion}
                    onChange={(e) => setTimePerQuestion(Math.min(120, Math.max(5, parseInt(e.target.value, 10) || 20)))}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '6px',
                      padding: '0.45rem 0.65rem',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* 5. Chế Độ Vận Hành (Chơi vs Thi Nghiêm Túc) */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
                    5. Chế Độ Vận Hành (Chơi / Thi Nghiêm Túc)
                  </label>
                  <select
                    data-testid="session-mode-select"
                    value={sessionMode}
                    onChange={(e) => {
                      const nextMode = e.target.value as SessionMode;
                      setSessionMode(nextMode);
                      if (nextMode === 'PLAY') {
                        setShowExamRosterError(false);
                      }
                      const nextPolicy: OfficialAttemptPolicy =
                        nextMode === 'EXAM' ? 'LATEST_ATTEMPT' : 'HIGHEST_SCORE';
                      setOfficialAttemptPolicy(nextPolicy);
                      const nextRosterMode: RosterMode =
                        nextMode === 'EXAM'
                          ? 'PRECONFIGURED'
                          : parsedRosterDraft.validItems.length > 0
                          ? rosterMode === 'HYBRID'
                            ? 'HYBRID'
                            : 'PRECONFIGURED'
                          : 'FREE_TEXT';
                      setRosterMode(nextRosterMode);
                      if (generatedSpec) {
                        setGeneratedSpec((prev) =>
                          prev
                            ? {
                                ...prev,
                                settings: {
                                  ...prev.settings,
                                  sessionMode: nextMode,
                                  officialAttemptPolicy: nextPolicy,
                                  rosterMode: nextRosterMode,
                                },
                              }
                            : prev
                        );
                        setSavedForLater(false);
                        setSaveStatus('dirty');
                      }
                    }}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '6px',
                      padding: '0.45rem 0.65rem',
                      color: 'var(--text-primary)',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="PLAY">Chơi / Luyện tập (Hiện đáp án ngay, tính điểm cao nhất)</option>
                    <option value="EXAM">Thi nghiêm túc (Ẩn đáp án cho đến khi kết thúc, tính lượt hợp lệ cuối)</option>
                  </select>

                  {sessionMode === 'EXAM' && (
                    <div
                      style={{
                        marginTop: '0.45rem',
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '0.45rem',
                        padding: '0.5rem 0.65rem',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(245, 158, 11, 0.08)',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                      }}
                    >
                      <div>
                        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
                          Ngưỡng Đạt (%):
                        </label>
                        <input
                          type="number"
                          data-testid="pass-threshold-input"
                          min={0}
                          max={100}
                          value={passThresholdPercent}
                          onChange={(e) => {
                            const nextVal = Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 50));
                            setPassThresholdPercent(nextVal);
                            if (generatedSpec) {
                              setGeneratedSpec((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      settings: { ...prev.settings, passThresholdPercent: nextVal },
                                    }
                                  : prev
                              );
                              setSavedForLater(false);
                              setSaveStatus('dirty');
                            }
                          }}
                          style={{
                            width: '100%',
                            backgroundColor: 'var(--bg-input)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '6px',
                            padding: '0.35rem 0.5rem',
                            color: 'var(--text-primary)',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
                          Chính sách điểm:
                        </label>
                        <select
                          data-testid="official-attempt-policy-select"
                          value={officialAttemptPolicy}
                          onChange={(e) => {
                            const nextPol = e.target.value as OfficialAttemptPolicy;
                            setOfficialAttemptPolicy(nextPol);
                            if (generatedSpec) {
                              setGeneratedSpec((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      settings: { ...prev.settings, officialAttemptPolicy: nextPol },
                                    }
                                  : prev
                              );
                              setSavedForLater(false);
                              setSaveStatus('dirty');
                            }
                          }}
                          style={{
                            width: '100%',
                            backgroundColor: 'var(--bg-input)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '6px',
                            padding: '0.35rem 0.45rem',
                            color: 'var(--text-primary)',
                            fontSize: '0.76rem',
                            fontWeight: 600,
                            boxSizing: 'border-box',
                          }}
                        >
                          <option value="LATEST_ATTEMPT">Lượt hợp lệ cuối</option>
                          <option value="HIGHEST_SCORE">Điểm cao nhất</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* 6. Danh sách người tham gia (Roster trực tiếp tại cột phải) */}
                <div
                  data-testid="creator-roster-section"
                  style={{
                    padding: '0.65rem 0.75rem',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-surface)',
                    border:
                      sessionMode === 'EXAM' && parsedRosterDraft.validItems.length === 0
                        ? '1.5px solid rgba(239, 68, 68, 0.55)'
                        : '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                  }}
                >
                  {/* Header: Tên mục + Phụ đề theo chế độ + Tổng số người hợp lệ */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                        6. Danh sách người tham gia
                      </div>
                      <div
                        data-testid="creator-roster-mode-desc"
                        style={{
                          fontSize: '0.71rem',
                          fontWeight: 700,
                          color:
                            sessionMode === 'EXAM'
                              ? 'var(--accent-amber)'
                              : 'var(--text-secondary)',
                          marginTop: '0.1rem',
                        }}
                      >
                        {sessionMode === 'EXAM'
                          ? 'Bắt buộc — cần có danh sách thí sinh'
                          : 'Tùy chọn — có thể để trống'}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <span
                        data-testid="roster-valid-count-badge"
                        style={{
                          padding: '0.2rem 0.55rem',
                          borderRadius: '999px',
                          fontSize: '0.71rem',
                          fontWeight: 800,
                          backgroundColor:
                            parsedRosterDraft.validItems.length > 0
                              ? 'rgba(16, 185, 129, 0.14)'
                              : 'var(--bg-input)',
                          color:
                            parsedRosterDraft.validItems.length > 0
                              ? 'var(--accent-emerald)'
                              : 'var(--text-secondary)',
                          border:
                            parsedRosterDraft.validItems.length > 0
                              ? '1px solid rgba(16, 185, 129, 0.4)'
                              : '1px solid var(--border-subtle)',
                        }}
                      >
                        Hợp lệ: {parsedRosterDraft.validItems.length} người
                      </span>
                    </div>
                  </div>

                  {/* Tabs: Nhập thủ công vs Import Excel / CSV */}
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      type="button"
                      data-testid="roster-tab-manual"
                      onClick={() => setCreatorRosterTab('MANUAL')}
                      style={{
                        flex: 1,
                        padding: '0.34rem 0.55rem',
                        borderRadius: '6px',
                        border:
                          creatorRosterTab === 'MANUAL'
                            ? '1.5px solid var(--primary)'
                            : '1px solid var(--border-subtle)',
                        backgroundColor:
                          creatorRosterTab === 'MANUAL'
                            ? 'rgba(56, 189, 248, 0.14)'
                            : 'var(--bg-input)',
                        color:
                          creatorRosterTab === 'MANUAL'
                            ? 'var(--accent-sky)'
                            : 'var(--text-secondary)',
                        fontSize: '0.73rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      ✍ Nhập thủ công
                    </button>
                    <button
                      type="button"
                      data-testid="roster-tab-import"
                      onClick={() => setCreatorRosterTab('IMPORT')}
                      style={{
                        flex: 1,
                        padding: '0.34rem 0.55rem',
                        borderRadius: '6px',
                        border:
                          creatorRosterTab === 'IMPORT'
                            ? '1.5px solid var(--primary)'
                            : '1px solid var(--border-subtle)',
                        backgroundColor:
                          creatorRosterTab === 'IMPORT'
                            ? 'rgba(56, 189, 248, 0.14)'
                            : 'var(--bg-input)',
                        color:
                          creatorRosterTab === 'IMPORT'
                            ? 'var(--accent-sky)'
                            : 'var(--text-secondary)',
                        fontSize: '0.73rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      📂 Import Excel / CSV
                    </button>
                  </div>

                  {/* Nội dung Tab 1: Nhập thủ công */}
                  {creatorRosterTab === 'MANUAL' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {/* Nhập từng người nhanh */}
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <input
                          type="text"
                          data-testid="roster-single-name-input"
                          placeholder="Họ và tên người tham gia..."
                          value={creatorRosterSingleName}
                          onChange={(e) => {
                            setCreatorRosterSingleName(e.target.value);
                            if (creatorRosterSingleError) setCreatorRosterSingleError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddSingleRosterPerson();
                            }
                          }}
                          style={{
                            flex: '1 1 130px',
                            backgroundColor: 'var(--bg-input)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '6px',
                            padding: '0.35rem 0.55rem',
                            color: 'var(--text-primary)',
                            fontSize: '0.75rem',
                            boxSizing: 'border-box',
                          }}
                        />
                        <input
                          type="text"
                          data-testid="roster-single-dept-input"
                          placeholder="Đơn vị / Phòng ban (tùy chọn)"
                          value={creatorRosterSingleDept}
                          onChange={(e) => setCreatorRosterSingleDept(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddSingleRosterPerson();
                            }
                          }}
                          style={{
                            flex: '1 1 110px',
                            backgroundColor: 'var(--bg-input)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '6px',
                            padding: '0.35rem 0.55rem',
                            color: 'var(--text-primary)',
                            fontSize: '0.75rem',
                            boxSizing: 'border-box',
                          }}
                        />
                        <button
                          type="button"
                          data-testid="roster-add-single-btn"
                          onClick={handleAddSingleRosterPerson}
                          style={{
                            padding: '0.35rem 0.65rem',
                            borderRadius: '6px',
                            border: '1px solid var(--primary)',
                            backgroundColor: 'var(--primary)',
                            color: 'var(--primary-ink)',
                            fontSize: '0.74rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          + Thêm
                        </button>
                      </div>
                      {creatorRosterSingleError && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--accent-rose)', fontWeight: 700 }}>
                          {creatorRosterSingleError}
                        </div>
                      )}

                      {/* Dán nhiều dòng */}
                      <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                          Hoặc dán danh sách nhiều dòng (mỗi dòng 1 người: Họ tên | Đơn vị | Mã NV):
                        </label>
                        <textarea
                          data-testid="creator-roster-manual-textarea"
                          rows={3}
                          placeholder={'Nguyễn Văn An | Phòng Kỹ Thuật | NV001\nTrần Thị Bình | Phòng Kinh Doanh | NV002'}
                          value={btcRosterPasteText}
                          onChange={(e) => applyUpdatedRosterPasteText(e.target.value)}
                          style={{
                            width: '100%',
                            backgroundColor: 'var(--bg-input)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '6px',
                            padding: '0.45rem 0.6rem',
                            color: 'var(--text-primary)',
                            fontSize: '0.76rem',
                            fontFamily: 'inherit',
                            boxSizing: 'border-box',
                            resize: 'vertical',
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Nội dung Tab 2: Import Excel / CSV */}
                  {creatorRosterTab === 'IMPORT' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.45rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                          Hỗ trợ tệp <strong>.xlsx</strong>, <strong>.csv</strong> (Cột 1: Họ tên, Cột 2: Đơn vị, Cột 3: Mã NV)
                        </span>
                        <label
                          style={{
                            padding: '0.38rem 0.7rem',
                            borderRadius: '6px',
                            border: '1px solid var(--accent-sky)',
                            backgroundColor: 'rgba(56, 189, 248, 0.12)',
                            color: 'var(--accent-sky)',
                            fontSize: '0.74rem',
                            fontWeight: 800,
                            cursor: isParsingRosterFile ? 'wait' : 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                          }}
                        >
                          <UploadIcon size={12} />
                          <span>{isParsingRosterFile ? 'Đang đọc tệp...' : 'Chọn tệp Excel / CSV (.xlsx, .csv)'}</span>
                          <input
                            type="file"
                            data-testid="creator-roster-file-input"
                            accept=".xlsx,.xls,.csv,.txt"
                            onChange={handlePreviewCreatorRosterFile}
                            disabled={isParsingRosterFile}
                            style={{ display: 'none' }}
                          />
                        </label>
                      </div>

                      {/* Khung xem trước kết quả parse file trước khi xác nhận nhập */}
                      {creatorRosterImportPreview && (
                        <div
                          data-testid="roster-import-preview-box"
                          style={{
                            padding: '0.55rem 0.65rem',
                            borderRadius: '6px',
                            backgroundColor: 'var(--bg-input)',
                            border: '1px solid var(--accent-sky)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.4rem',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem' }}>
                            <span style={{ fontSize: '0.73rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                              📄 {creatorRosterImportPreview.fileName}
                            </span>
                            <span
                              data-testid="roster-import-preview-count"
                              style={{
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                color: 'var(--accent-emerald)',
                              }}
                            >
                              Xem trước: {creatorRosterImportPreview.participants.length} người hợp lệ
                            </span>
                          </div>

                          {creatorRosterImportPreview.duplicateCount > 0 && (
                            <div
                              data-testid="roster-import-preview-duplicates"
                              style={{
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                color: 'var(--accent-amber)',
                                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                                padding: '0.28rem 0.45rem',
                                borderRadius: '4px',
                              }}
                            >
                              ⚠ Phát hiện {creatorRosterImportPreview.duplicateCount} dòng trùng tên (
                              {creatorRosterImportPreview.duplicateNames.join(', ')}) — giữ nguyên từng người riêng biệt.
                            </div>
                          )}

                          {creatorRosterImportPreview.invalidRows.length > 0 && (
                            <div
                              data-testid="roster-import-preview-errors"
                              style={{
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                color: 'var(--accent-rose)',
                                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                padding: '0.28rem 0.45rem',
                                borderRadius: '4px',
                              }}
                            >
                              ⚠ Có {creatorRosterImportPreview.invalidRows.length} dòng lỗi bị bỏ qua:{' '}
                              {creatorRosterImportPreview.invalidRows
                                .slice(0, 3)
                                .map((r) => `Dòng ${r.rowNumber} ("${r.rawText}"): ${r.reason}`)
                                .join('; ')}
                            </div>
                          )}

                          {creatorRosterImportPreview.participants.length > 0 && (
                            <div
                              style={{
                                maxHeight: '110px',
                                overflowY: 'auto',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '4px',
                                padding: '0.3rem 0.45rem',
                                fontSize: '0.72rem',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.2rem',
                              }}
                            >
                              {creatorRosterImportPreview.participants.map((item, pIdx) => (
                                <div
                                  key={`${item.fullName}_${pIdx}`}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    gap: '0.35rem',
                                  }}
                                >
                                  <span>
                                    <strong>{pIdx + 1}. {item.fullName}</strong>
                                    {item.departmentUnit ? ` — ${item.departmentUnit}` : ''}
                                    {item.employeeCode ? ` (${item.employeeCode})` : ''}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCreatorRosterImportPreview((prev) => {
                                        if (!prev) return null;
                                        const nextList = prev.participants.filter((_, i) => i !== pIdx);
                                        return {
                                          ...prev,
                                          validCount: nextList.length,
                                          participants: nextList,
                                        };
                                      });
                                    }}
                                    style={{
                                      border: 'none',
                                      background: 'transparent',
                                      color: 'var(--accent-rose)',
                                      fontSize: '0.68rem',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    Bỏ
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              data-testid="roster-cancel-import-btn"
                              onClick={() => setCreatorRosterImportPreview(null)}
                              style={{
                                padding: '0.3rem 0.6rem',
                                borderRadius: '5px',
                                border: '1px solid var(--border-subtle)',
                                backgroundColor: 'transparent',
                                color: 'var(--text-secondary)',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              Hủy
                            </button>
                            {btcRosterPasteText.trim().length > 0 && (
                              <button
                                type="button"
                                data-testid="roster-replace-import-btn"
                                disabled={creatorRosterImportPreview.participants.length === 0}
                                onClick={() => handleConfirmCreatorRosterImport('REPLACE')}
                                style={{
                                  padding: '0.3rem 0.65rem',
                                  borderRadius: '5px',
                                  border: '1px solid var(--accent-amber)',
                                  backgroundColor: 'rgba(245, 158, 11, 0.14)',
                                  color: 'var(--accent-amber)',
                                  fontSize: '0.72rem',
                                  fontWeight: 800,
                                  cursor:
                                    creatorRosterImportPreview.participants.length === 0
                                      ? 'not-allowed'
                                      : 'pointer',
                                }}
                              >
                                Thay thế danh sách
                              </button>
                            )}
                            <button
                              type="button"
                              data-testid="roster-confirm-import-btn"
                              disabled={creatorRosterImportPreview.participants.length === 0}
                              onClick={() => handleConfirmCreatorRosterImport('APPEND')}
                              style={{
                                padding: '0.3rem 0.7rem',
                                borderRadius: '5px',
                                border: 'none',
                                backgroundColor: 'var(--accent-emerald)',
                                color: '#022c22',
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                cursor:
                                  creatorRosterImportPreview.participants.length === 0
                                    ? 'not-allowed'
                                    : 'pointer',
                              }}
                            >
                              ✓ {btcRosterPasteText.trim().length > 0 ? 'Gộp vào danh sách' : 'Xác nhận nhập'} ({creatorRosterImportPreview.participants.length})
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Cảnh báo trùng tên (giữ nguyên từng người riêng biệt, không tự gộp) */}
                  {parsedRosterDraft.duplicateCount > 0 && (
                    <div
                      data-testid="roster-duplicate-warning"
                      style={{
                        padding: '0.32rem 0.5rem',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        border: '1px solid rgba(245, 158, 11, 0.35)',
                        color: 'var(--accent-amber)',
                        fontSize: '0.71rem',
                        fontWeight: 700,
                      }}
                    >
                      ⚠ Có {parsedRosterDraft.duplicateCount} người trùng tên (
                      {parsedRosterDraft.duplicateNames.join(', ')}) — hệ thống giữ nguyên từng người riêng biệt, không tự gộp.
                    </div>
                  )}

                  {/* Báo dòng không hợp lệ */}
                  {parsedRosterDraft.invalidLines.length > 0 && (
                    <div
                      data-testid="roster-invalid-lines-error"
                      style={{
                        padding: '0.32rem 0.5rem',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.35)',
                        color: 'var(--accent-rose)',
                        fontSize: '0.71rem',
                        fontWeight: 700,
                      }}
                    >
                      ⚠ Phát hiện {parsedRosterDraft.invalidLines.length} dòng không hợp lệ:{' '}
                      {parsedRosterDraft.invalidLines
                        .map((l) => `Dòng ${l.lineNumber} ("${l.rawLine}"): ${l.reason}`)
                        .join('; ')}
                    </div>
                  )}

                  {/* Cảnh báo bắt buộc danh sách khi ở chế độ EXAM */}
                  {sessionMode === 'EXAM' && parsedRosterDraft.validItems.length === 0 && (
                    <div
                      data-testid="creator-roster-exam-required-error"
                      style={{
                        padding: '0.38rem 0.55rem',
                        borderRadius: '6px',
                        backgroundColor: showExamRosterError
                          ? 'rgba(239, 68, 68, 0.18)'
                          : 'rgba(245, 158, 11, 0.12)',
                        border: showExamRosterError
                          ? '1.5px solid var(--accent-rose)'
                          : '1px solid rgba(245, 158, 11, 0.4)',
                        color: showExamRosterError ? 'var(--accent-rose)' : 'var(--accent-amber)',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                      }}
                    >
                      ⚠ Chế độ Thi nghiêm túc bắt buộc phải có danh sách thí sinh (ít nhất 1 người hợp lệ) trước khi tạo hoặc lưu đề thi.
                    </div>
                  )}

                  {/* Danh sách người tham gia hiện tại (hỗ trợ sửa/xóa trực tiếp từng dòng) */}
                  {parsedRosterDraft.validItems.length > 0 && (
                    <div
                      data-testid="creator-roster-list"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.25rem',
                        maxHeight: '140px',
                        overflowY: 'auto',
                        padding: '0.35rem 0.45rem',
                        borderRadius: '6px',
                        backgroundColor: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      {parsedRosterDraft.validItems.map((item, idx) => {
                        const isEditingRow = editingRosterRowIdx === item.lineIndex;
                        return (
                          <div
                            key={`${item.participantId || 'draft'}_${idx}`}
                            data-testid={`creator-roster-row-${idx}`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '0.35rem',
                              padding: '0.22rem 0.3rem',
                              borderBottom:
                                idx < parsedRosterDraft.validItems.length - 1
                                  ? '1px solid var(--border-subtle)'
                                  : 'none',
                              fontSize: '0.73rem',
                            }}
                          >
                            {isEditingRow ? (
                              <div style={{ display: 'flex', gap: '0.25rem', flex: 1, alignItems: 'center' }}>
                                <input
                                  type="text"
                                  data-testid={`roster-edit-name-input-${idx}`}
                                  value={editingRosterRowName}
                                  onChange={(e) => setEditingRosterRowName(e.target.value)}
                                  style={{
                                    flex: 1,
                                    padding: '0.2rem 0.35rem',
                                    fontSize: '0.72rem',
                                    borderRadius: '4px',
                                    border: '1px solid var(--primary)',
                                    backgroundColor: 'var(--bg-surface)',
                                    color: 'var(--text-primary)',
                                  }}
                                />
                                <input
                                  type="text"
                                  data-testid={`roster-edit-dept-input-${idx}`}
                                  value={editingRosterRowDept}
                                  placeholder="Đơn vị"
                                  onChange={(e) => setEditingRosterRowDept(e.target.value)}
                                  style={{
                                    width: '90px',
                                    padding: '0.2rem 0.35rem',
                                    fontSize: '0.72rem',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border-strong)',
                                    backgroundColor: 'var(--bg-surface)',
                                    color: 'var(--text-primary)',
                                  }}
                                />
                                <button
                                  type="button"
                                  data-testid={`roster-save-row-btn-${idx}`}
                                  onClick={() => handleSaveEditedRosterDraftRow(item.lineIndex)}
                                  style={{
                                    border: 'none',
                                    borderRadius: '4px',
                                    backgroundColor: 'var(--accent-emerald)',
                                    color: '#022c22',
                                    padding: '0.2rem 0.45rem',
                                    fontSize: '0.68rem',
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Lưu
                                </button>
                              </div>
                            ) : (
                              <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0, flex: 1 }}>
                                  <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>{idx + 1}.</span>
                                  <span style={{ fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {item.fullName}
                                  </span>
                                  {item.departmentUnit && (
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.69rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      • {item.departmentUnit}
                                    </span>
                                  )}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
                                  <button
                                    type="button"
                                    data-testid={`roster-edit-row-btn-${idx}`}
                                    onClick={() => {
                                      setEditingRosterRowIdx(item.lineIndex);
                                      setEditingRosterRowName(item.fullName);
                                      setEditingRosterRowDept(item.departmentUnit || '');
                                    }}
                                    style={{
                                      border: 'none',
                                      background: 'transparent',
                                      color: 'var(--accent-sky)',
                                      fontSize: '0.69rem',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                      padding: '0.1rem 0.25rem',
                                    }}
                                  >
                                    Sửa
                                  </button>
                                  <button
                                    type="button"
                                    data-testid={`roster-delete-row-btn-${idx}`}
                                    onClick={() => handleDeleteRosterDraftRow(item.lineIndex)}
                                    style={{
                                      border: 'none',
                                      background: 'transparent',
                                      color: 'var(--accent-rose)',
                                      fontSize: '0.69rem',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                      padding: '0.1rem 0.25rem',
                                    }}
                                  >
                                    Xóa
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Thanh thao tác nhanh cho danh sách người tham gia */}
                  {(parsedRosterDraft.validItems.length > 0 || generatedSpec) && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {parsedRosterDraft.validItems.length > 0 ? (
                        <button
                          type="button"
                          data-testid="creator-roster-clear-btn"
                          onClick={() => applyUpdatedRosterPasteText('')}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--accent-rose)',
                            fontSize: '0.71rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          Xóa toàn bộ danh sách ({parsedRosterDraft.validItems.length})
                        </button>
                      ) : (
                        <span />
                      )}

                      {generatedSpec && (
                        <button
                          type="button"
                          data-testid="creator-roster-save-btn"
                          onClick={handleSaveBtcRoster}
                          disabled={isSavingRoster}
                          style={{
                            padding: '0.28rem 0.65rem',
                            borderRadius: '6px',
                            border: '1px solid var(--primary)',
                            backgroundColor: 'rgba(56, 189, 248, 0.14)',
                            color: 'var(--accent-sky)',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            cursor: isSavingRoster ? 'wait' : 'pointer',
                          }}
                        >
                          {isSavingRoster ? 'Đang lưu...' : '💾 Lưu danh sách'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* 7. Âm thanh trò chơi (Một checkbox duy nhất) */}
                <div
                  data-testid="creator-game-audio-section"
                  style={{
                    padding: '0.65rem 0.75rem',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.35rem',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      color: 'var(--text-primary)',
                    }}
                  >
                    7. Âm thanh trò chơi
                  </div>

                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      userSelect: 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      data-testid="creator-game-audio-enabled"
                      checked={audioConfig.enabled !== false}
                      onChange={(e) => {
                        const isChecked = e.target.checked;
                        const nextCfg: GameAudioConfig = normalizeGameAudioConfig({
                          ...audioConfig,
                          enabled: isChecked,
                          bgmEnabled: isChecked,
                          sfxEnabled: isChecked,
                          countdownSoundEnabled: isChecked,
                        });
                        setAudioConfig(nextCfg);
                        soundManager.configure(nextCfg);
                        if (!isChecked) {
                          soundManager.stopAll();
                          setIsAudioPreviewPlaying(false);
                        }
                        if (generatedSpec) {
                          setGeneratedSpec((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  settings: { ...prev.settings, audioConfig: nextCfg },
                                }
                              : prev
                          );
                          setSavedForLater(false);
                          setSaveStatus('dirty');
                        }
                      }}
                      style={{
                        width: '16px',
                        height: '16px',
                        accentColor: 'var(--primary)',
                        cursor: 'pointer',
                      }}
                    />
                    <span>Sử dụng bộ âm thanh trò chơi</span>
                  </label>

                  <div
                    data-testid="creator-game-audio-description"
                    style={{
                      fontSize: '0.72rem',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.4,
                    }}
                  >
                    Khi bật, hệ thống tự động phát nhạc nền và hiệu ứng âm thanh phù hợp với từng tình huống trong trò chơi.
                  </div>
                </div>
              </div>

              {/* Nút hành động chính: Tạo Game Bằng AI */}
              {(() => {
                const mixedTotalNow =
                  (mixedDistribution.MULTIPLE_CHOICE || 0) +
                  (mixedDistribution.QUICK_BUTTON || 0) +
                  (mixedDistribution.FILL_IN_THE_BLANK || 0) +
                  (mixedDistribution.CROSSWORD || 0);
                const advTotalNow =
                  (adventureQuestionDistribution.MULTIPLE_CHOICE || 0) +
                  (adventureQuestionDistribution.QUICK_BUTTON || 0) +
                  (adventureQuestionDistribution.FILL_IN_THE_BLANK || 0) +
                  (adventureQuestionDistribution.CROSSWORD || 0);
                const isRatioInvalid =
                  (gameType === 'MIXED' && mixedTotalNow !== 100) ||
                  (gameType === 'ADVENTURE' && (adventureQuestionTypes.length === 0 || advTotalNow !== 100));
                const isSourceMissing =
                  !urls.some(u => u.trim()) && files.length === 0 && !topicFocus.trim() && ingestedSources.length === 0;
                const isBtnDisabled = isGenerating || isIngesting || isSourceMissing || isRatioInvalid;

                return (
                  <button
                    type="button"
                    data-testid="create-game-submit-btn"
                    onClick={handleCreateGameUnified}
                    disabled={isBtnDisabled}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--primary)',
                      color: 'var(--primary-ink)',
                      border: 'none',
                      borderRadius: '10px',
                      padding: '0.75rem 1.25rem',
                      fontSize: '0.92rem',
                      fontWeight: 900,
                      cursor: isBtnDisabled ? 'not-allowed' : 'pointer',
                      opacity: isBtnDisabled ? 0.6 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.45rem',
                      minHeight: '44px',
                      boxShadow: 'var(--btn-shadow)',
                    }}
                  >
                    {isGenerating || isIngesting ? (
                      <>
                        <SpinnerIcon size={16} />
                        <span>{isIngesting ? 'Đang Nạp Nguồn...' : 'AI Đang Biên Soạn...'}</span>
                      </>
                    ) : (
                      <>
                        <SparklesIcon size={16} />
                        <span>{generatedSpec ? 'Tái Tạo Bộ Câu Hỏi AI' : 'Tạo Game Bằng AI'}</span>
                      </>
                    )}
                  </button>
                );
              })()}

              {/* Loading Telemetry State (khi đang xử lý) */}
              {(isGenerating || isIngesting) && (
                <div
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    borderRadius: '10px',
                    padding: '1.25rem',
                    textAlign: 'center',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ color: 'var(--primary)', marginBottom: '0.5rem', display: 'flex', justifyContent: 'center' }}>
                    <SpinnerIcon size={28} />
                  </div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
                    {isIngesting ? 'Đang nạp và trích xuất nội dung nguồn...' : 'AI đang phân tích và sinh bộ câu hỏi...'}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    Cấu trúc hóa tài liệu thành các câu hỏi tương tác đạt chuẩn.
                  </div>
                </div>
              )}

              {/* KẾT QUẢ TẠO GAME (Sau khi tạo thành công - Hiển thị rõ ràng, không tự ý vào chơi) */}
              {generatedSpec && !isGenerating && !isIngesting && (
                <div
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    borderRadius: '12px',
                    border: '1.5px solid var(--accent-emerald)',
                    padding: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.85rem',
                    boxShadow: '0 4px 16px rgba(16, 185, 129, 0.08)',
                  }}
                >
                  {/* Status Banner */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                      padding: '0.55rem 0.85rem',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(16, 185, 129, 0.12)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--accent-emerald)', fontWeight: 800, fontSize: '0.86rem' }}>
                      <CheckIcon size={16} />
                      <span>Tạo Game Thành Công! Bộ câu hỏi đã sẵn sàng.</span>
                    </div>
                    <span
                      data-testid="game-save-status-badge"
                      style={{
                        fontSize: '0.74rem',
                        fontWeight: 800,
                        padding: '0.2rem 0.6rem',
                        borderRadius: '999px',
                        backgroundColor:
                          saveStatus === 'saved'
                            ? 'rgba(16, 185, 129, 0.18)'
                            : saveStatus === 'saving'
                              ? 'rgba(56, 189, 248, 0.18)'
                              : saveStatus === 'error'
                                ? 'rgba(239, 68, 68, 0.18)'
                                : 'rgba(245, 158, 11, 0.18)',
                        color:
                          saveStatus === 'saved'
                            ? 'var(--accent-emerald)'
                            : saveStatus === 'saving'
                              ? 'var(--accent-sky)'
                              : saveStatus === 'error'
                                ? 'var(--accent-rose)'
                                : '#f59e0b',
                        border:
                          saveStatus === 'saved'
                            ? '1px solid rgba(16, 185, 129, 0.4)'
                            : saveStatus === 'saving'
                              ? '1px solid rgba(56, 189, 248, 0.4)'
                              : saveStatus === 'error'
                                ? '1px solid rgba(239, 68, 68, 0.4)'
                                : '1px solid rgba(245, 158, 11, 0.4)',
                      }}
                    >
                      {saveStatus === 'saving'
                        ? 'Đang lưu...'
                        : saveStatus === 'saved'
                          ? 'Đã lưu'
                          : saveStatus === 'dirty'
                            ? 'Có thay đổi chưa lưu'
                            : saveStatus === 'error'
                              ? 'Lưu thất bại'
                              : 'Chưa lưu'}
                    </span>
                  </div>

                  {saveStatus === 'error' && saveErrorMessage && (
                    <div
                      role="alert"
                      data-testid="game-save-error-alert"
                      style={{
                        padding: '0.55rem 0.8rem',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid var(--accent-rose)',
                        color: 'var(--accent-rose)',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                      }}
                    >
                      Lưu thất bại: {saveErrorMessage} (Dữ liệu câu hỏi đã chỉnh sửa vẫn được giữ nguyên trên màn hình).
                    </div>
                  )}

                  {/* Thông tin game chi tiết */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          padding: '0.2rem 0.55rem',
                          borderRadius: '6px',
                          backgroundColor: 'var(--primary-subtle)',
                          color: 'var(--primary)',
                        }}
                      >
                        {formatGameTypeLabel(generatedSpec.gameType)}
                      </span>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          padding: '0.2rem 0.55rem',
                          borderRadius: '6px',
                          backgroundColor: 'var(--bg-input)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        {generatedSpec.questions.length} câu hỏi thực tế
                      </span>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '0.2rem 0.55rem',
                          borderRadius: '6px',
                          backgroundColor: 'var(--bg-input)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        {generatedSpec.settings.timePerQuestion}s / câu
                      </span>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '0.2rem 0.55rem',
                          borderRadius: '6px',
                          backgroundColor: 'var(--bg-input)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        {generatedSpec.settings.scoringMode === 'SPEED_BONUS'
                          ? 'Thưởng tốc độ'
                          : generatedSpec.settings.scoringMode === 'STREAK'
                          ? 'Chuỗi liên tiếp'
                          : 'Điểm chuẩn'}
                      </span>
                    </div>

                    <h3 style={{ margin: '0.2rem 0 0.4rem', fontSize: '1.05rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                      {generatedSpec.title}
                    </h3>
                  </div>

                  {(generatedSpec.description || (generatedSpec.gameType === 'ADVENTURE' && adventureConfig.learningObjective)) && (
                    <p style={{ margin: '-0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {generatedSpec.description || adventureConfig.learningObjective}
                    </p>
                  )}

                  {generatedSpec.gameType === 'ADVENTURE' && (
                    <div
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        borderRadius: '8px',
                        padding: '0.7rem 0.85rem',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.45rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                        <span style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                          Ngành nghề & Bối cảnh AI thiết kế:
                        </span>
                        <span
                          style={{
                            fontSize: '0.74rem',
                            fontWeight: 800,
                            padding: '0.18rem 0.55rem',
                            borderRadius: '6px',
                            backgroundColor: 'rgba(245, 158, 11, 0.14)',
                            color: '#F59E0B',
                            border: '1px solid rgba(245, 158, 11, 0.3)',
                          }}
                        >
                          {adventureConfig.industryLabel} • {adventureConfig.subEnvironment}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: '0.4rem', fontSize: '0.76rem' }}>
                        <div>
                          <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>Phương tiện: </span>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>{adventureConfig.avatarLabel}</span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>Cơ chế Gameplay: </span>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>
                            {adventureConfig.gameplayArchetype === 'TRAFFIC_RUNNER_SIM'
                              ? 'Runner Lộ trình & Giao thông'
                              : adventureConfig.gameplayArchetype === 'DIAGNOSTIC_WORKBENCH_SIM'
                                ? 'Bàn Chẩn đoán Kỹ thuật & QA'
                                : adventureConfig.gameplayArchetype === 'CYBER_DEFENSE_CONSOLE_SIM'
                                  ? 'Trung tâm Điều hành SOC'
                                  : 'Mô phỏng Hồ sơ Tình huống'}
                          </span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--game-mc)', fontWeight: 800 }}>▲ Trắc nghiệm: </span>
                          <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                            {generatedSpec.questions.filter(q => q.type === 'MULTIPLE_CHOICE').length} câu
                          </span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--game-qb)', fontWeight: 800 }}>◆ Đúng / Sai: </span>
                          <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                            {generatedSpec.questions.filter(q => q.type === 'QUICK_BUTTON').length} câu
                          </span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--game-fill)', fontWeight: 800 }}>● Điền từ: </span>
                          <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                            {generatedSpec.questions.filter(q => q.type === 'FILL_IN_THE_BLANK').length} câu
                          </span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--game-cross)', fontWeight: 800 }}>■ Ô chữ: </span>
                          <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                            {generatedSpec.questions.filter(q => q.type === 'CROSSWORD').length} câu
                          </span>
                        </div>
                      </div>
                      {/* Trạng thái xác thực tài nguyên hình ảnh Adventure 2D */}
                      {(() => {
                        const activeAdv = generatedSpec.settings?.adventureConfig || adventureConfig;
                        const status = activeAdv?.assetStatus;
                        const hasVerifiedAssets =
                          status === 'READY' &&
                          Boolean(
                            activeAdv?.assets?.background?.verified &&
                              activeAdv?.assets?.character?.verified &&
                              activeAdv?.assets?.obstacle?.verified
                          );
                        if (hasVerifiedAssets) {
                          return (
                            <div
                              style={{
                                marginTop: '0.25rem',
                                padding: '0.45rem 0.65rem',
                                borderRadius: '6px',
                                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                flexWrap: 'wrap',
                                gap: '0.4rem',
                                fontSize: '0.75rem',
                              }}
                            >
                              <span style={{ color: 'var(--accent-emerald)', fontWeight: 800 }}>
                                ✓ Đã xác thực đủ 3/3 tài nguyên ảnh 2D (Background • Character • Obstacle)
                              </span>
                              <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>
                                {activeAdv.assetPackSource === 'GEMINI_BANANA_RUNTIME'
                                  ? 'Banana Runtime'
                                  : 'Banana Asset Pack'}
                              </span>
                            </div>
                          );
                        }
                        if (status === 'ASSET_GENERATION_FAILED' || status === 'ASSET_GENERATION_PENDING') {
                          return (
                            <div
                              role="alert"
                              style={{
                                marginTop: '0.25rem',
                                padding: '0.6rem 0.75rem',
                                borderRadius: '8px',
                                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                border: '1px solid var(--accent-rose)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.4rem',
                                fontSize: '0.76rem',
                              }}
                            >
                              <div style={{ color: 'var(--accent-rose)', fontWeight: 800 }}>
                                ⚠ Chưa thể hoàn tất lưu/xuất bản vì thiếu bộ 3 tài nguyên ảnh 2D hợp lệ (Background, Character, Obstacle).
                              </div>
                              <div style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                                {activeAdv.assetError ||
                                  'Không thể tạo ảnh từ Banana API. Bộ câu hỏi đã tạo vẫn được giữ nguyên trong bản nháp.'}
                              </div>
                              <div>
                                <button
                                  type="button"
                                  onClick={handleRetryAdventureAssets}
                                  disabled={isRetryingAdventureAssets}
                                  style={{
                                    backgroundColor: 'var(--primary)',
                                    color: 'var(--primary-ink)',
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '0.35rem 0.7rem',
                                    fontSize: '0.75rem',
                                    fontWeight: 800,
                                    cursor: isRetryingAdventureAssets ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  {isRetryingAdventureAssets
                                    ? 'Đang thử tạo lại ảnh...'
                                    : 'Thử Tạo Lại Tài Nguyên Ảnh (Giữ Nguyên Câu Hỏi)'}
                                </button>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  )}
                  {generatedSpec.gameType === 'ADVENTURE' && (
                    <LegacyConfiguratorNoop
                      config={syncAdventureStagesWithQuestions(
                        generatedSpec.settings?.adventureConfig || adventureConfig,
                        generatedSpec.questions
                      )}
                      questions={generatedSpec.questions}
                      gameTitle={generatedSpec.title}
                      gameDescription={generatedSpec.description}
                      timePerQuestion={timePerQuestion}
                      isPreviewOpen={showAdventureFullscreenPreview}
                      onTogglePreview={setShowAdventureFullscreenPreview}
                      onChange={nextCfg => {
                        setAdventureConfig(nextCfg);
                        setGeneratedSpec(prev =>
                          prev
                            ? {
                                ...prev,
                                settings: {
                                  ...prev.settings,
                                  adventureConfig: nextCfg,
                                },
                              }
                            : prev
                        );
                      }}
                      reanalyzing={isReanalyzingAdventure}
                      onReanalyze={async () => {
                        try {
                          setIsReanalyzingAdventure(true);
                          const proposal = await analyzeAdventureContextApi({
                            sourceIds: ingestedSources.map(s => s.sourceId),
                            sources: ingestedSources,

                            topicFocus: topicFocus.trim() || undefined,
                            questionCount: generatedSpec.questions.length,
                          });
                          const synced = syncAdventureStagesWithQuestions(
                            proposal,
                            generatedSpec.questions
                          );
                          setAdventureConfig(synced);
                          setGeneratedSpec(prev =>
                            prev
                              ? {
                                  ...prev,
                                  settings: {
                                    ...prev.settings,
                                    adventureConfig: synced,
                                  },
                                }
                              : prev
                          );
                          toast.success(
                            `Đã cập nhật bối cảnh "${synced.subEnvironment}" (${synced.industryLabel}).`,
                            'AI Đề xuất bối cảnh'
                          );
                        } catch (err: any) {
                          toast.error(err.message || 'Không thể phân tích lại bối cảnh.');
                        } finally {
                          setIsReanalyzingAdventure(false);
                        }
                      }}
                    />
                  )}
                  {generatedSpec.gameType === 'MIXED' && (
                    <div
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        borderRadius: '8px',
                        padding: '0.65rem 0.8rem',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                        Phân bổ câu hỏi thực tế được sinh ({generatedSpec.questions.length} câu):
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.4rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem' }}>
                          <span style={{ color: 'var(--game-mc)', fontWeight: 800 }}>▲ Trắc nghiệm:</span>
                          <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                            {generatedSpec.questions.filter(q => q.type === 'MULTIPLE_CHOICE').length} câu
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem' }}>
                          <span style={{ color: 'var(--game-qb)', fontWeight: 800 }}>◆ Đúng / Sai:</span>
                          <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                            {generatedSpec.questions.filter(q => q.type === 'QUICK_BUTTON').length} câu
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem' }}>
                          <span style={{ color: 'var(--game-fill)', fontWeight: 800 }}>● Điền từ:</span>
                          <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                            {generatedSpec.questions.filter(q => q.type === 'FILL_IN_THE_BLANK').length} câu
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem' }}>
                          <span style={{ color: 'var(--game-cross)', fontWeight: 800 }}>■ Ô chữ:</span>
                          <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                            {generatedSpec.questions.filter(q => q.type === 'CROSSWORD').length} câu
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Nhóm nút hành động: [Bắt đầu] [Lưu Game] [Chơi thử] */}
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.2rem' }}>
                    <button
                      type="button"
                      data-testid="start-or-host-game-btn"
                      onClick={handlePublishAndUseNow}
                      disabled={isSavingSpec}
                      style={{
                        flex: '1 1 auto',
                        backgroundColor: 'var(--primary)',
                        color: 'var(--primary-ink)',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '0.6rem 1rem',
                        fontSize: '0.85rem',
                        fontWeight: 900,
                        cursor: isSavingSpec ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.45rem',
                        minHeight: '38px',
                        boxShadow: 'var(--btn-shadow)',
                      }}
                    >
                      <PlayIcon size={16} />
                      <span>Bắt Đầu Chơi / Tạo Phòng</span>
                    </button>

                    <button
                      type="button"
                      data-testid="save-game-btn"
                      onClick={handleSaveForLater}
                      disabled={isSavingSpec}
                      style={{
                        backgroundColor:
                          saveStatus === 'dirty' || saveStatus === 'error'
                            ? 'rgba(16, 185, 129, 0.14)'
                            : 'var(--bg-input)',
                        color:
                          saveStatus === 'dirty' || saveStatus === 'error'
                            ? 'var(--accent-emerald)'
                            : 'var(--text-primary)',
                        border:
                          saveStatus === 'dirty' || saveStatus === 'error'
                            ? '1.5px solid var(--accent-emerald)'
                            : '1px solid var(--border-strong)',
                        borderRadius: '8px',
                        padding: '0.55rem 0.9rem',
                        fontSize: '0.82rem',
                        fontWeight: 800,
                        cursor: isSavingSpec ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        minHeight: '38px',
                      }}
                      title="Lưu bộ câu hỏi vào cùng game hiện tại"
                    >
                      <CheckIcon size={14} />
                      <span>
                        {isSavingSpec || saveStatus === 'saving'
                          ? 'Đang lưu...'
                          : saveStatus === 'dirty'
                            ? 'Lưu cập nhật'
                            : saveStatus === 'error'
                              ? 'Lưu lại'
                              : 'Lưu Game'}
                      </span>
                    </button>

                    <button
                      type="button"
                      data-testid="playtest-game-btn"
                      onClick={handleStartPlaytest}
                      disabled={isSavingSpec}
                      style={{
                        backgroundColor: 'rgba(245, 158, 11, 0.14)',
                        color: '#f59e0b',
                        border: '1.5px solid rgba(245, 158, 11, 0.45)',
                        borderRadius: '8px',
                        padding: '0.55rem 0.9rem',
                        fontSize: '0.82rem',
                        fontWeight: 800,
                        cursor: isSavingSpec ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        minHeight: '38px',
                      }}
                      title="Chơi thử toàn bộ game mà không ghi điểm hay thống kê thật"
                    >
                      <GamepadIcon size={14} />
                      <span>Chơi thử</span>
                    </button>

                    {onNavigateToLibrary && (
                      <button
                        type="button"
                        onClick={onNavigateToLibrary}
                        style={{
                          backgroundColor: 'var(--bg-input)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-strong)',
                          borderRadius: '8px',
                          padding: '0.55rem 0.85rem',
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          minHeight: '38px',
                        }}
                        title="Xem card game trong Kho Game"
                      >
                        <span>Xem Trong Kho Game</span>
                      </button>
                    )}

                    <button
                      type="button"
                      data-testid="open-btc-manager-btn"
                      onClick={handleOpenBtcManager}
                      style={{
                        backgroundColor: 'rgba(56, 189, 248, 0.14)',
                        color: 'var(--accent-sky)',
                        border: '1.5px solid rgba(56, 189, 248, 0.45)',
                        borderRadius: '8px',
                        padding: '0.55rem 0.9rem',
                        fontSize: '0.82rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        minHeight: '38px',
                      }}
                      title="Quản lý danh sách thí sinh, cấp lượt thi lại, công bố đáp án và xuất bảng điểm CSV/Excel"
                    >
                      <UsersIcon size={14} />
                      <span>Danh sách & Bảng điểm BTC</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExportCurrentGame('json')}
                      style={{
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--text-muted)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '8px',
                        padding: '0.55rem 0.75rem',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        minHeight: '38px',
                      }}
                      title="Xuất định dạng JSON"
                    >
                      Xuất JSON
                    </button>
                  </div>

                  {/* ======================================================== */}
                  {/* DANH SÁCH CÂU HỎI ĐÃ TẠO (NGAY DƯỚI CÁC NÚT CHỨC NĂNG)   */}
                  {/* ======================================================== */}
                  {(() => {
                    const totalQuestionsCount = generatedSpec.questions.length;
                    const totalPages = Math.max(1, Math.ceil(totalQuestionsCount / QUESTIONS_PER_PAGE));
                    const safePage = Math.min(Math.max(1, questionPage), totalPages);
                    const pageStartIdx = (safePage - 1) * QUESTIONS_PER_PAGE;
                    const visibleQuestions = generatedSpec.questions.slice(
                      pageStartIdx,
                      pageStartIdx + QUESTIONS_PER_PAGE
                    );

                    return (
                      <div
                        data-testid="generated-questions-section"
                        style={{
                          marginTop: '0.25rem',
                          paddingTop: '0.85rem',
                          borderTop: '1px solid var(--border-subtle)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.65rem',
                        }}
                      >
                        {/* Header Danh sách câu hỏi */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '0.5rem',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                              Danh sách câu hỏi ({totalQuestionsCount} câu)
                            </span>
                            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                              ID: {generatedSpec.gameId}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <button
                              type="button"
                              data-testid="add-question-btn"
                              onClick={handleAddQuestion}
                              style={{
                                backgroundColor: 'var(--bg-input)',
                                color: 'var(--accent-sky)',
                                border: '1px solid var(--border-strong)',
                                borderRadius: '6px',
                                padding: '0.35rem 0.65rem',
                                fontSize: '0.76rem',
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                              }}
                            >
                              <PlusIcon size={13} />
                              <span>Thêm câu hỏi</span>
                            </button>
                            <button
                              type="button"
                              data-testid="toggle-question-list-btn"
                              onClick={() => setIsQuestionListCollapsed((prev) => !prev)}
                              style={{
                                backgroundColor: 'var(--bg-input)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '6px',
                                padding: '0.35rem 0.65rem',
                                fontSize: '0.76rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {isQuestionListCollapsed ? 'Mở rộng danh sách' : 'Thu gọn'}
                            </button>
                          </div>
                        </div>

                        {!isQuestionListCollapsed && (
                          <>
                            <div
                              data-testid="generated-questions-list"
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.65rem',
                              }}
                            >
                              {visibleQuestions.map((q, localIdx) => {
                                const idx = pageStartIdx + localIdx;
                                const isEditing = editingQuestionIdx === idx && editingQuestionDraft !== null;
                                const activeQ = isEditing && editingQuestionDraft ? editingQuestionDraft : q;
                                const effectiveQType = activeQ.type || generatedSpec.gameType;

                                return (
                                  <div
                                    key={q.id || idx}
                                    data-testid={`question-item-${idx}`}
                                    style={{
                                      backgroundColor: 'var(--bg-surface)',
                                      borderRadius: '10px',
                                      padding: '0.85rem',
                                      border: isEditing
                                        ? '1.5px solid var(--primary)'
                                        : '1px solid var(--border-subtle)',
                                      borderLeft: isEditing
                                        ? '4px solid var(--primary)'
                                        : '3px solid var(--accent-emerald)',
                                    }}
                                  >
                                    {/* Header từng câu hỏi */}
                                    <div
                                      style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        marginBottom: '0.45rem',
                                        flexWrap: 'wrap',
                                      }}
                                    >
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                        <span
                                          style={{
                                            fontSize: '0.78rem',
                                            fontWeight: 900,
                                            color: 'var(--accent-sky)',
                                          }}
                                        >
                                          Câu {idx + 1} (#{idx + 1})
                                        </span>
                                        <span
                                          data-testid={`question-type-badge-${idx}`}
                                          style={{
                                            fontSize: '0.7rem',
                                            fontWeight: 800,
                                            padding: '0.12rem 0.45rem',
                                            borderRadius: '4px',
                                            backgroundColor: 'var(--bg-input)',
                                            color: 'var(--text-secondary)',
                                            border: '1px solid var(--border-subtle)',
                                          }}
                                        >
                                          {formatGameTypeLabel(effectiveQType)}
                                        </span>
                                        <span
                                          data-testid={`question-points-badge-${idx}`}
                                          style={{
                                            fontSize: '0.7rem',
                                            fontWeight: 800,
                                            padding: '0.12rem 0.45rem',
                                            borderRadius: '4px',
                                            backgroundColor: 'rgba(16, 185, 129, 0.12)',
                                            color: 'var(--accent-emerald)',
                                            border: '1px solid rgba(16, 185, 129, 0.35)',
                                          }}
                                        >
                                          {activeQ.points || 100} điểm · {activeQ.timeLimitSeconds || timePerQuestion}s
                                        </span>
                                      </div>

                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                        <button
                                          type="button"
                                          onClick={() => handleMoveQuestion(idx, -1)}
                                          disabled={idx === 0 || isEditing}
                                          style={{
                                            padding: '0.2rem 0.4rem',
                                            borderRadius: '4px',
                                            border: '1px solid var(--border-subtle)',
                                            backgroundColor: 'transparent',
                                            color: idx === 0 || isEditing ? 'var(--text-muted)' : 'var(--text-secondary)',
                                            fontSize: '0.72rem',
                                            cursor: idx === 0 || isEditing ? 'not-allowed' : 'pointer',
                                          }}
                                          title="Di chuyển lên"
                                        >
                                          ↑
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleMoveQuestion(idx, 1)}
                                          disabled={idx === totalQuestionsCount - 1 || isEditing}
                                          style={{
                                            padding: '0.2rem 0.4rem',
                                            borderRadius: '4px',
                                            border: '1px solid var(--border-subtle)',
                                            backgroundColor: 'transparent',
                                            color:
                                              idx === totalQuestionsCount - 1 || isEditing
                                                ? 'var(--text-muted)'
                                                : 'var(--text-secondary)',
                                            fontSize: '0.72rem',
                                            cursor:
                                              idx === totalQuestionsCount - 1 || isEditing
                                                ? 'not-allowed'
                                                : 'pointer',
                                          }}
                                          title="Di chuyển xuống"
                                        >
                                          ↓
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDuplicateQuestion(idx)}
                                          disabled={isEditing}
                                          style={{
                                            padding: '0.2rem 0.45rem',
                                            borderRadius: '4px',
                                            border: '1px solid var(--border-subtle)',
                                            backgroundColor: 'transparent',
                                            color: isEditing ? 'var(--text-muted)' : 'var(--accent-sky)',
                                            fontSize: '0.72rem',
                                            cursor: isEditing ? 'not-allowed' : 'pointer',
                                          }}
                                          title="Nhân bản câu hỏi"
                                        >
                                          <CopyIcon size={12} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteQuestion(idx)}
                                          disabled={totalQuestionsCount <= 1 || isEditing}
                                          style={{
                                            padding: '0.2rem 0.45rem',
                                            borderRadius: '4px',
                                            border: '1px solid var(--border-subtle)',
                                            backgroundColor: 'transparent',
                                            color:
                                              totalQuestionsCount <= 1 || isEditing
                                                ? 'var(--text-muted)'
                                                : 'var(--accent-rose)',
                                            fontSize: '0.72rem',
                                            cursor:
                                              totalQuestionsCount <= 1 || isEditing
                                                ? 'not-allowed'
                                                : 'pointer',
                                          }}
                                          title="Xóa câu hỏi"
                                        >
                                          <TrashIcon size={12} />
                                        </button>
                                        {!isEditing && (
                                          <button
                                            type="button"
                                            data-testid={`edit-question-btn-${idx}`}
                                            onClick={() => handleStartEditQuestion(idx)}
                                            style={{
                                              padding: '0.22rem 0.55rem',
                                              borderRadius: '5px',
                                              border: '1px solid var(--border-strong)',
                                              backgroundColor: 'var(--bg-input)',
                                              color: 'var(--text-primary)',
                                              fontSize: '0.74rem',
                                              fontWeight: 800,
                                              cursor: 'pointer',
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '0.25rem',
                                            }}
                                          >
                                            <PencilIcon size={12} />
                                            <span>Chỉnh sửa</span>
                                          </button>
                                        )}
                                      </div>
                                    </div>

                                    {/* CHẾ ĐỘ XEM CÂU HỎI (PREVIEW) */}
                                    {!isEditing && (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                        <div
                                          data-testid={`question-text-${idx}`}
                                          style={{
                                            fontSize: '0.86rem',
                                            fontWeight: 800,
                                            color: 'var(--text-primary)',
                                            lineHeight: 1.45,
                                          }}
                                        >
                                          {q.question}
                                        </div>

                                        {effectiveQType === 'CROSSWORD' && q.crosswordClue && (
                                          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                            Gợi ý ô chữ: <strong style={{ color: 'var(--text-primary)' }}>{q.crosswordClue}</strong>
                                          </div>
                                        )}

                                        {(effectiveQType === 'MULTIPLE_CHOICE' ||
                                          effectiveQType === 'QUIZ' ||
                                          effectiveQType === 'QUICK_BUTTON' ||
                                          effectiveQType === 'TRUE_FALSE' ||
                                          effectiveQType === 'PUZZLE') &&
                                          Array.isArray(q.choices) &&
                                          q.choices.length > 0 && (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.1rem' }}>
                                              {q.choices.map((c, cIdx) => {
                                                const isCorrect =
                                                  effectiveQType === 'PUZZLE'
                                                    ? false
                                                    : stripOptionLetterPrefix(c) ===
                                                        stripOptionLetterPrefix(q.correctAnswer) ||
                                                      normalizeChoiceCompare(c) ===
                                                        normalizeChoiceCompare(q.correctAnswer);
                                                return (
                                                  <span
                                                    key={cIdx}
                                                    style={{
                                                      fontSize: '0.75rem',
                                                      padding: '0.18rem 0.55rem',
                                                      borderRadius: '5px',
                                                      border: isCorrect
                                                        ? '1px solid var(--accent-emerald)'
                                                        : '1px solid var(--border-subtle)',
                                                      backgroundColor: isCorrect
                                                        ? 'rgba(16, 185, 129, 0.12)'
                                                        : 'var(--bg-input)',
                                                      color: isCorrect
                                                        ? 'var(--accent-emerald)'
                                                        : 'var(--text-secondary)',
                                                      fontWeight: isCorrect ? 800 : 600,
                                                    }}
                                                  >
                                                    {effectiveQType === 'PUZZLE' ? `#${cIdx + 1} ${c}` : c}
                                                  </span>
                                                );
                                              })}
                                            </div>
                                          )}

                                        {effectiveQType === 'SLIDER' && q.sliderConfig && (
                                          <div
                                            style={{
                                              display: 'flex',
                                              flexWrap: 'wrap',
                                              gap: '0.4rem',
                                              fontSize: '0.75rem',
                                              color: 'var(--text-secondary)',
                                            }}
                                          >
                                            <span style={{ padding: '0.15rem 0.5rem', borderRadius: '4px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-subtle)', fontWeight: 700 }}>
                                              Khoảng: {q.sliderConfig.min} → {q.sliderConfig.max} {q.sliderConfig.unit || ''}
                                            </span>
                                            <span style={{ padding: '0.15rem 0.5rem', borderRadius: '4px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-subtle)', fontWeight: 700 }}>
                                              Bước nhảy: {q.sliderConfig.step}
                                            </span>
                                            <span style={{ padding: '0.15rem 0.5rem', borderRadius: '4px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-subtle)', fontWeight: 700 }}>
                                              Sai số: ±{q.sliderConfig.tolerance ?? 0} {q.sliderConfig.unit || ''}
                                            </span>
                                          </div>
                                        )}

                                        <div
                                          data-testid={`question-answer-${idx}`}
                                          style={{
                                            fontSize: '0.76rem',
                                            color: 'var(--accent-emerald)',
                                            fontWeight: 800,
                                          }}
                                        >
                                          {effectiveQType === 'CROSSWORD'
                                            ? `Từ khóa đáp án: ${q.crosswordAnswer || q.correctAnswer} (${(q.crosswordAnswer || q.correctAnswer || '').replace(/\s+/g, '').length} chữ cái)`
                                            : effectiveQType === 'FILL_IN_THE_BLANK' || effectiveQType === 'TYPE_ANSWER'
                                              ? `Từ/cụm từ cần điền: ${q.correctAnswer}`
                                              : `Đáp án đúng: ${q.correctAnswer}${effectiveQType === 'SLIDER' && q.sliderConfig?.unit ? ` ${q.sliderConfig.unit}` : ''}`}
                                        </div>

                                        {q.explanation && (
                                          <div
                                            data-testid={`question-explanation-${idx}`}
                                            style={{
                                              fontSize: '0.74rem',
                                              color: 'var(--text-secondary)',
                                              lineHeight: 1.4,
                                            }}
                                          >
                                            Giải thích: {q.explanation}
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* CHẾ ĐỘ CHỈNH SỬA INLINE (INLINE EDITOR) */}
                                    {isEditing && editingQuestionDraft && (
                                      <div
                                        data-testid={`question-inline-editor-${idx}`}
                                        style={{
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: '0.55rem',
                                          marginTop: '0.45rem',
                                        }}
                                      >
                                        {editingQuestionError && (
                                          <div
                                            role="alert"
                                            data-testid="question-edit-error"
                                            style={{
                                              padding: '0.45rem 0.65rem',
                                              borderRadius: '6px',
                                              backgroundColor: 'rgba(239, 68, 68, 0.12)',
                                              border: '1px solid var(--accent-rose)',
                                              color: 'var(--accent-rose)',
                                              fontSize: '0.76rem',
                                              fontWeight: 700,
                                            }}
                                          >
                                            {editingQuestionError}
                                          </div>
                                        )}

                                        <div>
                                          <label
                                            style={{
                                              display: 'block',
                                              fontSize: '0.75rem',
                                              fontWeight: 700,
                                              color: 'var(--text-secondary)',
                                              marginBottom: '0.2rem',
                                            }}
                                          >
                                            Nội dung câu hỏi:
                                          </label>
                                          <input
                                            type="text"
                                            data-testid={`edit-question-text-${idx}`}
                                            value={editingQuestionDraft.question}
                                            onChange={(e) =>
                                              handleUpdateQuestionDraft((prev) => ({
                                                ...prev,
                                                question: e.target.value,
                                              }))
                                            }
                                            style={{
                                              width: '100%',
                                              backgroundColor: 'var(--bg-input)',
                                              border: '1px solid var(--border-strong)',
                                              borderRadius: '6px',
                                              padding: '0.4rem 0.6rem',
                                              color: 'var(--text-primary)',
                                              fontSize: '0.84rem',
                                              boxSizing: 'border-box',
                                            }}
                                          />
                                        </div>

                                        {(effectiveQType === 'MULTIPLE_CHOICE' || effectiveQType === 'QUIZ') &&
                                          editingQuestionDraft.choices && (
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
                                              {editingQuestionDraft.choices.map((c, cIdx) => {
                                                const isThisCorrect =
                                                  stripOptionLetterPrefix(c) ===
                                                    stripOptionLetterPrefix(editingQuestionDraft.correctAnswer) ||
                                                  normalizeChoiceCompare(c) ===
                                                    normalizeChoiceCompare(editingQuestionDraft.correctAnswer);
                                                return (
                                                  <div key={cIdx} style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                                                    <input
                                                      type="radio"
                                                      name={`correct_q_${idx}`}
                                                      data-testid={`edit-question-correct-radio-${idx}-${cIdx}`}
                                                      checked={isThisCorrect}
                                                      onChange={() =>
                                                        handleUpdateQuestionDraft((prev) => ({
                                                          ...prev,
                                                          correctAnswer: c,
                                                        }))
                                                      }
                                                      style={{ cursor: 'pointer' }}
                                                    />
                                                    <input
                                                      type="text"
                                                      data-testid={`edit-question-choice-${idx}-${cIdx}`}
                                                      value={c}
                                                      onChange={(e) => {
                                                        const nextVal = e.target.value;
                                                        handleUpdateQuestionDraft((prev) => {
                                                          const newChoices = [...(prev.choices || [])];
                                                          const oldChoice = newChoices[cIdx];
                                                          newChoices[cIdx] = nextVal;
                                                          const wasSelected =
                                                            stripOptionLetterPrefix(oldChoice) ===
                                                              stripOptionLetterPrefix(prev.correctAnswer) ||
                                                            normalizeChoiceCompare(oldChoice) ===
                                                              normalizeChoiceCompare(prev.correctAnswer);
                                                          return {
                                                            ...prev,
                                                            choices: newChoices,
                                                            correctAnswer: wasSelected ? nextVal : prev.correctAnswer,
                                                          };
                                                        });
                                                      }}
                                                      style={{
                                                        flex: 1,
                                                        backgroundColor: 'var(--bg-input)',
                                                        border: '1px solid var(--border-strong)',
                                                        borderRadius: '6px',
                                                        padding: '0.35rem 0.5rem',
                                                        color: 'var(--text-primary)',
                                                        fontSize: '0.8rem',
                                                        boxSizing: 'border-box',
                                                      }}
                                                    />
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}

                                        {(effectiveQType === 'QUICK_BUTTON' || effectiveQType === 'TRUE_FALSE') && (
                                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                            {(['Đúng', 'Sai'] as const).map((tfVal) => {
                                              const isSel =
                                                normalizeChoiceCompare(editingQuestionDraft.correctAnswer) ===
                                                normalizeChoiceCompare(tfVal);
                                              return (
                                                <button
                                                  key={tfVal}
                                                  type="button"
                                                  data-testid={`edit-question-tf-${idx}-${tfVal}`}
                                                  onClick={() =>
                                                    handleUpdateQuestionDraft((prev) => ({
                                                      ...prev,
                                                      choices: ['Đúng', 'Sai'],
                                                      correctAnswer: tfVal,
                                                    }))
                                                  }
                                                  style={{
                                                    flex: 1,
                                                    padding: '0.4rem 0.65rem',
                                                    borderRadius: '6px',
                                                    border: isSel
                                                      ? '2px solid var(--accent-emerald)'
                                                      : '1px solid var(--border-strong)',
                                                    backgroundColor: isSel
                                                      ? 'rgba(16, 185, 129, 0.14)'
                                                      : 'var(--bg-input)',
                                                    color: isSel ? 'var(--accent-emerald)' : 'var(--text-primary)',
                                                    fontWeight: 800,
                                                    fontSize: '0.82rem',
                                                    cursor: 'pointer',
                                                  }}
                                                >
                                                  {tfVal}
                                                </button>
                                              );
                                            })}
                                          </div>
                                        )}

                                        {effectiveQType === 'PUZZLE' && (
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                              Thứ tự chuẩn của các mục (3 - 6 mục):
                                            </label>
                                            {(editingQuestionDraft.choices || []).map((item, itemIdx) => (
                                              <div key={itemIdx} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--accent-sky)', minWidth: '22px' }}>
                                                  #{itemIdx + 1}
                                                </span>
                                                <input
                                                  type="text"
                                                  value={item}
                                                  onChange={(e) => {
                                                    const nextVal = e.target.value;
                                                    handleUpdateQuestionDraft((prev) => {
                                                      const nextItems = [...(prev.choices || [])];
                                                      nextItems[itemIdx] = nextVal;
                                                      return {
                                                        ...prev,
                                                        choices: nextItems,
                                                        correctAnswer: nextItems
                                                          .map((s) => s.trim())
                                                          .filter(Boolean)
                                                          .join(' | '),
                                                      };
                                                    });
                                                  }}
                                                  style={{
                                                    flex: 1,
                                                    backgroundColor: 'var(--bg-input)',
                                                    border: '1px solid var(--border-strong)',
                                                    borderRadius: '6px',
                                                    padding: '0.35rem 0.5rem',
                                                    color: 'var(--text-primary)',
                                                    fontSize: '0.8rem',
                                                    boxSizing: 'border-box',
                                                  }}
                                                />
                                              </div>
                                            ))}
                                          </div>
                                        )}

                                        {effectiveQType === 'SLIDER' && (
                                          <div
                                            style={{
                                              display: 'grid',
                                              gridTemplateColumns: 'repeat(auto-fit, minmax(115px, 1fr))',
                                              gap: '0.45rem',
                                              padding: '0.55rem',
                                              borderRadius: '8px',
                                              backgroundColor: 'var(--bg-card)',
                                              border: '1px solid var(--border-subtle)',
                                            }}
                                          >
                                            <div>
                                              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                                                Min:
                                              </label>
                                              <input
                                                type="number"
                                                step="any"
                                                value={editingQuestionDraft.sliderConfig?.min ?? 0}
                                                onChange={(e) => {
                                                  const minVal = Number(e.target.value);
                                                  handleUpdateQuestionDraft((prev) => {
                                                    const cfg = prev.sliderConfig || { min: 0, max: 100, step: 1, correctValue: 50, tolerance: 0 };
                                                    return {
                                                      ...prev,
                                                      sliderConfig: { ...cfg, min: Number.isFinite(minVal) ? minVal : 0 },
                                                    };
                                                  });
                                                }}
                                                style={{ width: '100%', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-strong)', borderRadius: '6px', padding: '0.35rem 0.5rem', color: 'var(--text-primary)', fontSize: '0.8rem', boxSizing: 'border-box' }}
                                              />
                                            </div>
                                            <div>
                                              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                                                Max:
                                              </label>
                                              <input
                                                type="number"
                                                step="any"
                                                value={editingQuestionDraft.sliderConfig?.max ?? 100}
                                                onChange={(e) => {
                                                  const maxVal = Number(e.target.value);
                                                  handleUpdateQuestionDraft((prev) => {
                                                    const cfg = prev.sliderConfig || { min: 0, max: 100, step: 1, correctValue: 50, tolerance: 0 };
                                                    return {
                                                      ...prev,
                                                      sliderConfig: { ...cfg, max: Number.isFinite(maxVal) ? maxVal : 100 },
                                                    };
                                                  });
                                                }}
                                                style={{ width: '100%', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-strong)', borderRadius: '6px', padding: '0.35rem 0.5rem', color: 'var(--text-primary)', fontSize: '0.8rem', boxSizing: 'border-box' }}
                                              />
                                            </div>
                                            <div>
                                              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                                                Bước nhảy (Step):
                                              </label>
                                              <input
                                                type="number"
                                                step="any"
                                                min={0.0001}
                                                value={editingQuestionDraft.sliderConfig?.step ?? 1}
                                                onChange={(e) => {
                                                  const stepVal = Number(e.target.value);
                                                  handleUpdateQuestionDraft((prev) => {
                                                    const cfg = prev.sliderConfig || { min: 0, max: 100, step: 1, correctValue: 50, tolerance: 0 };
                                                    return {
                                                      ...prev,
                                                      sliderConfig: { ...cfg, step: Number.isFinite(stepVal) && stepVal > 0 ? stepVal : 1 },
                                                    };
                                                  });
                                                }}
                                                style={{ width: '100%', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-strong)', borderRadius: '6px', padding: '0.35rem 0.5rem', color: 'var(--text-primary)', fontSize: '0.8rem', boxSizing: 'border-box' }}
                                              />
                                            </div>
                                            <div>
                                              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 800, color: 'var(--accent-emerald)', marginBottom: '0.2rem' }}>
                                                Giá trị đúng:
                                              </label>
                                              <input
                                                type="number"
                                                step="any"
                                                value={editingQuestionDraft.sliderConfig?.correctValue ?? Number(editingQuestionDraft.correctAnswer || 0)}
                                                onChange={(e) => {
                                                  const cv = Number(e.target.value);
                                                  const safeCv = Number.isFinite(cv) ? cv : 0;
                                                  handleUpdateQuestionDraft((prev) => {
                                                    const cfg = prev.sliderConfig || { min: 0, max: 100, step: 1, correctValue: 50, tolerance: 0 };
                                                    return {
                                                      ...prev,
                                                      sliderConfig: { ...cfg, correctValue: safeCv },
                                                      correctAnswer: String(safeCv),
                                                    };
                                                  });
                                                }}
                                                style={{ width: '100%', backgroundColor: 'var(--bg-input)', border: '1px solid var(--accent-emerald)', borderRadius: '6px', padding: '0.35rem 0.5rem', color: 'var(--text-primary)', fontWeight: 800, fontSize: '0.8rem', boxSizing: 'border-box' }}
                                              />
                                            </div>
                                            <div>
                                              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                                                Sai số (±):
                                              </label>
                                              <input
                                                type="number"
                                                step="any"
                                                min={0}
                                                value={editingQuestionDraft.sliderConfig?.tolerance ?? 0}
                                                onChange={(e) => {
                                                  const tolVal = Number(e.target.value);
                                                  handleUpdateQuestionDraft((prev) => {
                                                    const cfg = prev.sliderConfig || { min: 0, max: 100, step: 1, correctValue: 50, tolerance: 0 };
                                                    return {
                                                      ...prev,
                                                      sliderConfig: { ...cfg, tolerance: Number.isFinite(tolVal) && tolVal >= 0 ? tolVal : 0 },
                                                    };
                                                  });
                                                }}
                                                style={{ width: '100%', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-strong)', borderRadius: '6px', padding: '0.35rem 0.5rem', color: 'var(--text-primary)', fontSize: '0.8rem', boxSizing: 'border-box' }}
                                              />
                                            </div>
                                            <div>
                                              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                                                Đơn vị (Unit):
                                              </label>
                                              <input
                                                type="text"
                                                placeholder="%, năm, °C..."
                                                value={editingQuestionDraft.sliderConfig?.unit || ''}
                                                onChange={(e) => {
                                                  const unitVal = e.target.value;
                                                  handleUpdateQuestionDraft((prev) => {
                                                    const cfg = prev.sliderConfig || { min: 0, max: 100, step: 1, correctValue: 50, tolerance: 0 };
                                                    return {
                                                      ...prev,
                                                      sliderConfig: { ...cfg, unit: unitVal },
                                                    };
                                                  });
                                                }}
                                                style={{ width: '100%', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-strong)', borderRadius: '6px', padding: '0.35rem 0.5rem', color: 'var(--text-primary)', fontSize: '0.8rem', boxSizing: 'border-box' }}
                                              />
                                            </div>
                                          </div>
                                        )}

                                        {effectiveQType === 'CROSSWORD' && (
                                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
                                            <div>
                                              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                                                Gợi ý ô chữ (Clue):
                                              </label>
                                              <input
                                                type="text"
                                                data-testid={`edit-crossword-clue-${idx}`}
                                                value={editingQuestionDraft.crosswordClue ?? editingQuestionDraft.question}
                                                onChange={(e) =>
                                                  handleUpdateQuestionDraft((prev) => ({
                                                    ...prev,
                                                    crosswordClue: e.target.value,
                                                  }))
                                                }
                                                style={{
                                                  width: '100%',
                                                  backgroundColor: 'var(--bg-input)',
                                                  border: '1px solid var(--border-strong)',
                                                  borderRadius: '6px',
                                                  padding: '0.4rem 0.6rem',
                                                  color: 'var(--text-primary)',
                                                  fontSize: '0.82rem',
                                                  boxSizing: 'border-box',
                                                }}
                                              />
                                            </div>
                                            <div>
                                              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                                                Từ khóa đáp án:
                                              </label>
                                              <input
                                                type="text"
                                                data-testid={`edit-question-answer-${idx}`}
                                                value={editingQuestionDraft.crosswordAnswer ?? editingQuestionDraft.correctAnswer}
                                                onChange={(e) =>
                                                  handleUpdateQuestionDraft((prev) => ({
                                                    ...prev,
                                                    crosswordAnswer: e.target.value,
                                                    correctAnswer: e.target.value,
                                                  }))
                                                }
                                                style={{
                                                  width: '100%',
                                                  backgroundColor: 'var(--bg-input)',
                                                  border: '1px solid var(--border-strong)',
                                                  borderRadius: '6px',
                                                  padding: '0.4rem 0.6rem',
                                                  color: 'var(--text-primary)',
                                                  fontSize: '0.82rem',
                                                  boxSizing: 'border-box',
                                                }}
                                              />
                                            </div>
                                          </div>
                                        )}

                                        {(effectiveQType === 'FILL_IN_THE_BLANK' || effectiveQType === 'TYPE_ANSWER') && (
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                                              Từ/cụm từ cần điền (Đáp án đúng):
                                            </label>
                                            <input
                                              type="text"
                                              data-testid={`edit-question-answer-${idx}`}
                                              value={editingQuestionDraft.correctAnswer}
                                              onChange={(e) =>
                                                handleUpdateQuestionDraft((prev) => ({
                                                  ...prev,
                                                  correctAnswer: e.target.value,
                                                }))
                                              }
                                              style={{
                                                width: '100%',
                                                backgroundColor: 'var(--bg-input)',
                                                border: '1px solid var(--border-strong)',
                                                borderRadius: '6px',
                                                padding: '0.4rem 0.6rem',
                                                color: 'var(--text-primary)',
                                                fontSize: '0.84rem',
                                                boxSizing: 'border-box',
                                              }}
                                            />
                                          </div>
                                        )}

                                        <div>
                                          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                                            Giải thích đáp án:
                                          </label>
                                          <input
                                            type="text"
                                            data-testid={`edit-question-explanation-${idx}`}
                                            value={editingQuestionDraft.explanation || ''}
                                            onChange={(e) =>
                                              handleUpdateQuestionDraft((prev) => ({
                                                ...prev,
                                                explanation: e.target.value,
                                              }))
                                            }
                                            style={{
                                              width: '100%',
                                              backgroundColor: 'var(--bg-input)',
                                              border: '1px solid var(--border-strong)',
                                              borderRadius: '6px',
                                              padding: '0.4rem 0.6rem',
                                              color: 'var(--text-primary)',
                                              fontSize: '0.84rem',
                                              boxSizing: 'border-box',
                                            }}
                                          />
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                              Thời gian riêng câu này (giây, để trống dùng mặc định {timePerQuestion}s):
                                            </label>
                                            <input
                                              type="number"
                                              data-testid={`edit-question-time-${idx}`}
                                              min={5}
                                              max={300}
                                              placeholder={`${timePerQuestion}`}
                                              value={editingQuestionDraft.timeLimitSeconds ?? ''}
                                              onChange={(e) => {
                                                const rawVal = e.target.value.trim();
                                                const numVal = rawVal
                                                  ? Math.min(300, Math.max(5, parseInt(rawVal, 10) || timePerQuestion))
                                                  : undefined;
                                                handleUpdateQuestionDraft((prev) => ({
                                                  ...prev,
                                                  timeLimitSeconds: numVal,
                                                }));
                                              }}
                                              style={{
                                                width: '90px',
                                                backgroundColor: 'var(--bg-input)',
                                                border: '1px solid var(--border-strong)',
                                                borderRadius: '6px',
                                                padding: '0.35rem 0.5rem',
                                                color: 'var(--text-primary)',
                                                fontSize: '0.82rem',
                                                fontWeight: 700,
                                                boxSizing: 'border-box',
                                              }}
                                            />
                                          </div>

                                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                              Điểm câu hỏi (10–1000, mặc định 100):
                                            </label>
                                            <input
                                              type="number"
                                              data-testid={`edit-question-points-${idx}`}
                                              min={10}
                                              max={1000}
                                              step={10}
                                              placeholder="100"
                                              value={editingQuestionDraft.points ?? ''}
                                              onChange={(e) => {
                                                const rawVal = e.target.value.trim();
                                                const numVal = rawVal
                                                  ? Math.min(1000, Math.max(10, parseInt(rawVal, 10) || 100))
                                                  : undefined;
                                                handleUpdateQuestionDraft((prev) => ({
                                                  ...prev,
                                                  points: numVal,
                                                }));
                                              }}
                                              style={{
                                                width: '90px',
                                                backgroundColor: 'var(--bg-input)',
                                                border: '1px solid var(--border-strong)',
                                                borderRadius: '6px',
                                                padding: '0.35rem 0.5rem',
                                                color: 'var(--text-primary)',
                                                fontSize: '0.82rem',
                                                fontWeight: 700,
                                                boxSizing: 'border-box',
                                              }}
                                            />
                                          </div>
                                        </div>

                                        <div
                                          style={{
                                            display: 'flex',
                                            justifyContent: 'flex-end',
                                            gap: '0.45rem',
                                            marginTop: '0.2rem',
                                          }}
                                        >
                                          <button
                                            type="button"
                                            data-testid={`cancel-question-edit-btn-${idx}`}
                                            onClick={handleCancelEditQuestion}
                                            style={{
                                              backgroundColor: 'var(--bg-input)',
                                              color: 'var(--text-secondary)',
                                              border: '1px solid var(--border-strong)',
                                              borderRadius: '6px',
                                              padding: '0.35rem 0.75rem',
                                              fontWeight: 700,
                                              fontSize: '0.8rem',
                                              cursor: 'pointer',
                                            }}
                                          >
                                            Hủy
                                          </button>
                                          <button
                                            type="button"
                                            data-testid={`save-question-edit-btn-${idx}`}
                                            onClick={() => handleCommitQuestionEdit(idx)}
                                            style={{
                                              backgroundColor: 'var(--primary)',
                                              color: 'var(--primary-ink)',
                                              border: 'none',
                                              borderRadius: '6px',
                                              padding: '0.35rem 0.85rem',
                                              fontWeight: 800,
                                              fontSize: '0.8rem',
                                              cursor: 'pointer',
                                            }}
                                          >
                                            Lưu thay đổi
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {/* Thanh phân trang danh sách câu hỏi */}
                            {totalQuestionsCount > 0 && (
                              <div
                                data-testid="question-pagination-bar"
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                  gap: '0.5rem',
                                  paddingTop: '0.45rem',
                                  borderTop: '1px solid var(--border-subtle)',
                                }}
                              >
                                <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                                  Hiển thị câu {pageStartIdx + 1}–{Math.min(pageStartIdx + QUESTIONS_PER_PAGE, totalQuestionsCount)} / {totalQuestionsCount}
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  <button
                                    type="button"
                                    data-testid="question-page-prev-btn"
                                    disabled={safePage <= 1}
                                    onClick={() => setQuestionPage(Math.max(1, safePage - 1))}
                                    style={{
                                      padding: '0.3rem 0.65rem',
                                      borderRadius: '6px',
                                      border: '1px solid var(--border-strong)',
                                      backgroundColor: 'var(--bg-input)',
                                      color: safePage <= 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                                      fontSize: '0.76rem',
                                      fontWeight: 800,
                                      cursor: safePage <= 1 ? 'not-allowed' : 'pointer',
                                    }}
                                  >
                                    Trước
                                  </button>
                                  <span
                                    data-testid="question-page-indicator"
                                    style={{
                                      fontSize: '0.78rem',
                                      fontWeight: 800,
                                      color: 'var(--text-primary)',
                                      padding: '0 0.35rem',
                                    }}
                                  >
                                    Trang {safePage} / {totalPages}
                                  </span>
                                  <button
                                    type="button"
                                    data-testid="question-page-next-btn"
                                    disabled={safePage >= totalPages}
                                    onClick={() => setQuestionPage(Math.min(totalPages, safePage + 1))}
                                    style={{
                                      padding: '0.3rem 0.65rem',
                                      borderRadius: '6px',
                                      border: '1px solid var(--border-strong)',
                                      backgroundColor: 'var(--bg-input)',
                                      color: safePage >= totalPages ? 'var(--text-muted)' : 'var(--text-primary)',
                                      fontSize: '0.76rem',
                                      fontWeight: 800,
                                      cursor: safePage >= totalPages ? 'not-allowed' : 'pointer',
                                    }}
                                  >
                                    Tiếp
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
          </div>
        </div>
      </div>

      {/* CHẾ ĐỘ CHƠI THỬ (PLAYTEST OVERLAY — 100% TÁCH BIỆT DỮ LIỆU THẬT) */}
      {isPlaytestOpen && playtestSpec && (
        <div
          data-testid="playtest-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1300,
            backgroundColor: 'var(--bg-body, #0f172a)',
            color: 'var(--text-primary)',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            padding: '1rem',
            boxSizing: 'border-box',
          }}
        >
          <SoloPlayer
            key={`playtest_${playtestSpec.gameId}`}
            initialSpec={playtestSpec}
            playtestMode={true}
            onLeave={handleExitPlaytest}
            onSpecUpdated={(updatedSpec) => {
              syncedGameIdRef.current = updatedSpec.gameId;
              setGeneratedSpec(updatedSpec);
              setPlaytestSpec(updatedSpec);
              setSavedForLater(true);
              setSaveStatus('saved');
              writeCreatorSessionSnapshot({
                spec: updatedSpec,
                saveStatus: 'saved',
                savedForLater: true,
                customGameTitle: updatedSpec.title || customGameTitle,
              });
              onCurrentSpecChange?.(updatedSpec);
            }}
          />
        </div>
      )}

      {/* MODAL QUẢN LÝ DANH SÁCH THÍ SINH & BẢNG ĐIỂM BTC (PHASE 2 & 5) */}
      {isBtcModalOpen && generatedSpec && (
        <div
          data-testid="btc-roster-scoreboard-modal"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1400,
            backgroundColor: 'rgba(2, 6, 23, 0.85)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '940px',
              maxHeight: '90vh',
              overflowY: 'auto',
              backgroundColor: 'var(--bg-card)',
              border: '1.5px solid var(--border-strong)',
              borderRadius: '16px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              boxShadow: '0 24px 56px rgba(0, 0, 0, 0.65)',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                  Quản Lý Danh Sách Thí Sinh & Bảng Điểm BTC — {generatedSpec.title}
                </h3>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  Mã Game: <strong>{generatedSpec.gameId}</strong> • Chế độ: <strong>{sessionMode === 'EXAM' ? 'Thi nghiêm túc (EXAM)' : 'Chơi / Luyện tập (PLAY)'}</strong>
                </div>
              </div>
              <button
                type="button"
                data-testid="close-btc-modal-btn"
                onClick={() => setIsBtcModalOpen(false)}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Đóng
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
              <button
                type="button"
                data-testid="btc-tab-roster"
                onClick={() => setBtcActiveTab('ROSTER')}
                style={{
                  padding: '0.45rem 0.9rem',
                  borderRadius: '8px',
                  border: btcActiveTab === 'ROSTER' ? '1.5px solid var(--primary)' : '1px solid var(--border-subtle)',
                  backgroundColor: btcActiveTab === 'ROSTER' ? 'var(--primary)' : 'var(--bg-input)',
                  color: btcActiveTab === 'ROSTER' ? 'var(--primary-ink)' : 'var(--text-primary)',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Danh sách Thí sinh ({btcParticipants.length})
              </button>
              <button
                type="button"
                data-testid="btc-tab-scoreboard"
                onClick={() => {
                  setBtcActiveTab('SCOREBOARD');
                  loadBtcRosterAndScoreboard(generatedSpec.gameId);
                }}
                style={{
                  padding: '0.45rem 0.9rem',
                  borderRadius: '8px',
                  border: btcActiveTab === 'SCOREBOARD' ? '1.5px solid var(--primary)' : '1px solid var(--border-subtle)',
                  backgroundColor: btcActiveTab === 'SCOREBOARD' ? 'var(--primary)' : 'var(--bg-input)',
                  color: btcActiveTab === 'SCOREBOARD' ? 'var(--primary-ink)' : 'var(--text-primary)',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Bảng điểm & Lượt thi ({btcScoreboard?.totals?.totalParticipants ?? btcParticipants.length})
              </button>
            </div>

            {btcActiveTab === 'ROSTER' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    Chế độ xác thực người tham gia:
                  </label>
                  <select
                    data-testid="btc-roster-mode-select"
                    value={rosterMode}
                    onChange={(e) => {
                      const nextMode = e.target.value as RosterMode;
                      setRosterMode(nextMode);
                      setGeneratedSpec((prev) =>
                        prev
                          ? {
                              ...prev,
                              settings: { ...prev.settings, rosterMode: nextMode },
                            }
                          : prev
                      );
                    }}
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '6px',
                      padding: '0.4rem 0.65rem',
                      color: 'var(--text-primary)',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                    }}
                  >
                    <option value="FREE_TEXT">Tự do nhập tên (FREE_TEXT)</option>
                    <option value="PRECONFIGURED">Bắt buộc chọn từ danh sách BTC cấu hình sẵn (PRECONFIGURED)</option>
                    <option value="HYBRID">Kết hợp: Chọn danh sách BTC hoặc tự nhập (HYBRID)</option>
                  </select>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                      Thêm nhanh danh sách thí sinh (mỗi dòng: Họ tên | Đơn vị/Phòng ban | Mã NV):
                    </label>
                    <label
                      style={{
                        padding: '0.3rem 0.65rem',
                        borderRadius: '6px',
                        border: '1px solid var(--border-strong)',
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--accent-sky)',
                        fontSize: '0.75rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      Nhập từ tệp (.xlsx / .csv / .txt)
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv,.txt"
                        onChange={handleImportRosterFile}
                        style={{ display: 'none' }}
                      />
                    </label>
                  </div>
                  <textarea
                    data-testid="btc-roster-paste-input"
                    rows={4}
                    placeholder={'Nguyễn Văn A | Phòng Kỹ Thuật | NV001\nTrần Thị B | Phòng Kinh Doanh | NV002'}
                    value={btcRosterPasteText}
                    onChange={(e) => applyUpdatedRosterPasteText(e.target.value)}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '8px',
                      padding: '0.55rem 0.7rem',
                      color: 'var(--text-primary)',
                      fontSize: '0.82rem',
                      fontFamily: 'inherit',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    data-testid="btc-roster-clear-btn"
                    onClick={async () => {
                      await clearGameParticipantsApi(generatedSpec.gameId);
                      await loadBtcRosterAndScoreboard(generatedSpec.gameId);
                      toast.info('Đã xóa toàn bộ danh sách thí sinh.');
                    }}
                    disabled={btcParticipants.length === 0}
                    style={{
                      padding: '0.45rem 0.8rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-strong)',
                      backgroundColor: 'var(--bg-input)',
                      color: btcParticipants.length === 0 ? 'var(--text-muted)' : 'var(--accent-rose)',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: btcParticipants.length === 0 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Xóa toàn bộ danh sách
                  </button>

                  <button
                    type="button"
                    data-testid="btc-roster-save-btn"
                    onClick={handleSaveBtcRoster}
                    disabled={isSavingRoster}
                    style={{
                      padding: '0.5rem 1.1rem',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: 'var(--primary)',
                      color: 'var(--primary-ink)',
                      fontSize: '0.84rem',
                      fontWeight: 900,
                      cursor: isSavingRoster ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isSavingRoster ? 'Đang lưu...' : 'Lưu danh sách thí sinh'}
                  </button>
                </div>

                {/* Bảng danh sách thí sinh hiện tại */}
                <div
                  data-testid="btc-roster-table"
                  style={{
                    maxHeight: '280px',
                    overflowY: 'auto',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-surface)',
                  }}
                >
                  {btcParticipants.length === 0 ? (
                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      Chưa có thí sinh nào trong danh sách. Hãy dán danh sách ở trên và nhấn "Lưu danh sách thí sinh".
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                          <th style={{ padding: '0.5rem 0.65rem' }}>#</th>
                          <th style={{ padding: '0.5rem 0.65rem' }}>Họ và tên</th>
                          <th style={{ padding: '0.5rem 0.65rem' }}>Đơn vị / Phòng ban</th>
                          <th style={{ padding: '0.5rem 0.65rem' }}>Mã NV</th>
                          <th style={{ padding: '0.5rem 0.65rem' }}>Trạng thái</th>
                          <th style={{ padding: '0.5rem 0.65rem' }}>Lượt dùng / Tối đa</th>
                          <th style={{ padding: '0.5rem 0.65rem' }}>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {btcParticipants.map((p, idx) => (
                          <tr key={p.participantId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '0.45rem 0.65rem', fontWeight: 700 }}>{idx + 1}</td>
                            <td style={{ padding: '0.45rem 0.65rem', fontWeight: 800, color: 'var(--text-primary)' }}>{p.fullName}</td>
                            <td style={{ padding: '0.45rem 0.65rem', color: 'var(--text-secondary)' }}>{p.departmentUnit || '—'}</td>
                            <td style={{ padding: '0.45rem 0.65rem', color: 'var(--text-muted)' }}>{p.employeeCode || '—'}</td>
                            <td style={{ padding: '0.45rem 0.65rem', fontWeight: 700 }}>
                              {p.status === 'COMPLETED' ? 'Đã hoàn thành' : p.status === 'IN_PROGRESS' ? 'Đang thi' : 'Chưa thi'}
                            </td>
                            <td style={{ padding: '0.45rem 0.65rem', fontWeight: 700 }}>
                              {p.usedAttempts ?? p.attemptsUsed ?? 0} / {p.allowedAttempts ?? 1}
                            </td>
                            <td style={{ padding: '0.45rem 0.65rem', display: 'flex', gap: '0.35rem' }}>
                              <button
                                type="button"
                                data-testid={`grant-retake-btn-${p.participantId}`}
                                onClick={() => handleGrantRetake(p.participantId, p.fullName)}
                                style={{
                                  padding: '0.22rem 0.5rem',
                                  borderRadius: '5px',
                                  border: '1px solid var(--accent-emerald)',
                                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                                  color: 'var(--accent-emerald)',
                                  fontSize: '0.72rem',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                +1 Thi lại
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  await deleteGameParticipantApi(generatedSpec.gameId, p.participantId);
                                  await loadBtcRosterAndScoreboard(generatedSpec.gameId);
                                }}
                                style={{
                                  padding: '0.22rem 0.5rem',
                                  borderRadius: '5px',
                                  border: '1px solid var(--border-subtle)',
                                  backgroundColor: 'transparent',
                                  color: 'var(--accent-rose)',
                                  fontSize: '0.72rem',
                                  cursor: 'pointer',
                                }}
                              >
                                Xóa
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {btcActiveTab === 'SCOREBOARD' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {/* Thanh công cụ BTC: Công bố đáp án + Xuất CSV / XLSX */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <span style={{ padding: '0.3rem 0.65rem', borderRadius: '999px', backgroundColor: 'var(--bg-input)', fontSize: '0.76rem', fontWeight: 800 }}>
                      Tổng thí sinh: {btcScoreboard?.totals?.totalParticipants ?? btcScoreboard?.totalParticipants ?? 0}
                    </span>
                    <span style={{ padding: '0.3rem 0.65rem', borderRadius: '999px', backgroundColor: 'rgba(16, 185, 129, 0.14)', color: 'var(--accent-emerald)', fontSize: '0.76rem', fontWeight: 800 }}>
                      Đạt: {btcScoreboard?.totals?.passedCount ?? btcScoreboard?.passedCount ?? 0}
                    </span>
                    <span style={{ padding: '0.3rem 0.65rem', borderRadius: '999px', backgroundColor: 'rgba(239, 68, 68, 0.14)', color: 'var(--accent-rose)', fontSize: '0.76rem', fontWeight: 800 }}>
                      Chưa đạt: {btcScoreboard?.totals?.failedCount ?? btcScoreboard?.failedCount ?? 0}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                    {sessionMode === 'EXAM' && (
                      <>
                        {generatedSpec.settings?.examStatus === 'CLOSED' ? (
                          <button
                            type="button"
                            data-testid="btc-reopen-exam-btn"
                            onClick={handleReopenExam}
                            disabled={isClosingExam}
                            style={{
                              padding: '0.42rem 0.8rem',
                              borderRadius: '8px',
                              border: '1px solid var(--accent-sky)',
                              backgroundColor: 'rgba(56, 189, 248, 0.14)',
                              color: 'var(--accent-sky)',
                              fontSize: '0.78rem',
                              fontWeight: 800,
                              cursor: isClosingExam ? 'wait' : 'pointer',
                            }}
                          >
                            ↺ Mở lại đợt thi
                          </button>
                        ) : (
                          <button
                            type="button"
                            data-testid="btc-close-exam-btn"
                            onClick={() => setConfirmCloseExamOpen(true)}
                            disabled={isClosingExam}
                            style={{
                              padding: '0.42rem 0.8rem',
                              borderRadius: '8px',
                              border: '1px solid rgba(239, 68, 68, 0.55)',
                              backgroundColor: 'rgba(239, 68, 68, 0.16)',
                              color: 'var(--accent-rose)',
                              fontSize: '0.78rem',
                              fontWeight: 800,
                              cursor: isClosingExam ? 'wait' : 'pointer',
                            }}
                          >
                            ⏹ Kết thúc đợt thi & Thu bài
                          </button>
                        )}

                        <button
                          type="button"
                          data-testid="publish-exam-answers-btn"
                          onClick={handlePublishExamAnswers}
                          disabled={isPublishingAnswers || Boolean(btcScoreboard?.answersPublished)}
                          style={{
                            padding: '0.42rem 0.8rem',
                            borderRadius: '8px',
                            border: '1px solid rgba(245, 158, 11, 0.5)',
                            backgroundColor: btcScoreboard?.answersPublished
                              ? 'rgba(16, 185, 129, 0.14)'
                              : 'rgba(245, 158, 11, 0.16)',
                            color: btcScoreboard?.answersPublished ? 'var(--accent-emerald)' : '#f59e0b',
                            fontSize: '0.78rem',
                            fontWeight: 800,
                            cursor: isPublishingAnswers || btcScoreboard?.answersPublished ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {btcScoreboard?.answersPublished ? '✓ Đã công bố đáp án' : 'Công bố đáp án chính thức'}
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      data-testid="export-scoreboard-csv-btn"
                      onClick={() => downloadGameScoreboardExport(generatedSpec.gameId, 'csv')}
                      style={{
                        padding: '0.42rem 0.75rem',
                        borderRadius: '8px',
                        border: '1px solid var(--border-strong)',
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      Xuất CSV
                    </button>

                    <button
                      type="button"
                      data-testid="export-scoreboard-xlsx-btn"
                      onClick={() => downloadGameScoreboardExport(generatedSpec.gameId, 'xlsx')}
                      style={{
                        padding: '0.42rem 0.75rem',
                        borderRadius: '8px',
                        border: '1px solid var(--accent-emerald)',
                        backgroundColor: 'rgba(16, 185, 129, 0.14)',
                        color: 'var(--accent-emerald)',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      Xuất Excel (.xlsx)
                    </button>
                  </div>
                </div>

                {/* Hộp thoại xác nhận Kết thúc đợt thi & Tự động nộp bài */}
                {confirmCloseExamOpen && (
                  <div
                    data-testid="btc-close-exam-confirm-box"
                    style={{
                      padding: '0.85rem 1rem',
                      borderRadius: '10px',
                      backgroundColor: 'rgba(239, 68, 68, 0.12)',
                      border: '1.5px solid rgba(239, 68, 68, 0.45)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.75rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 700 }}>
                      <strong>Xác nhận kết thúc đợt thi?</strong> Hệ thống sẽ khóa mở lượt thi mới và tự động thu bài, chấm điểm ngay lập tức tất cả thí sinh đang làm bài (không tự công bố đáp án).
                    </div>
                    <div style={{ display: 'flex', gap: '0.45rem' }}>
                      <button
                        type="button"
                        onClick={() => setConfirmCloseExamOpen(false)}
                        style={{
                          padding: '0.4rem 0.75rem',
                          borderRadius: '6px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-input)',
                          color: 'var(--text-secondary)',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Hủy
                      </button>
                      <button
                        type="button"
                        data-testid="btc-confirm-close-exam-btn"
                        disabled={isClosingExam}
                        onClick={handleCloseExam}
                        style={{
                          padding: '0.4rem 0.9rem',
                          borderRadius: '6px',
                          border: 'none',
                          backgroundColor: '#ef4444',
                          color: '#ffffff',
                          fontSize: '0.78rem',
                          fontWeight: 900,
                          cursor: isClosingExam ? 'wait' : 'pointer',
                        }}
                      >
                        {isClosingExam ? 'Đang thu bài...' : 'Xác nhận Kết thúc & Thu bài'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Top 3 Podium */}
                {btcScoreboard && btcScoreboard.top3.length > 0 && (
                  <div
                    data-testid="btc-scoreboard-top3"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: '0.6rem',
                      padding: '0.75rem',
                      borderRadius: '10px',
                      backgroundColor: 'rgba(245, 158, 11, 0.08)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                    }}
                  >
                    {btcScoreboard.top3.map((top, idx) => (
                      <div
                        key={top.participantId}
                        style={{
                          padding: '0.6rem 0.75rem',
                          borderRadius: '8px',
                          backgroundColor: 'var(--bg-card)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{ fontSize: '0.74rem', fontWeight: 900, color: '#f59e0b' }}>
                          Hạng #{idx + 1}
                        </div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                          {top.fullName}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {top.departmentUnit || 'Thí sinh tự do'}
                        </div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--accent-emerald)', marginTop: '0.2rem' }}>
                          {top.score ?? top.officialAttempt?.totalScore ?? 0} điểm • {top.accuracyPercent ?? top.officialAttempt?.accuracyPercent ?? 0}%
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Bảng điểm toàn bộ người tham gia */}
                <div
                  data-testid="btc-scoreboard-table"
                  style={{
                    maxHeight: '300px',
                    overflowY: 'auto',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-surface)',
                  }}
                >
                  {!btcScoreboard || (btcScoreboard.entries || btcScoreboard.participants || []).length === 0 ? (
                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      Chưa có lượt thi hoàn tất nào được ghi nhận.
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                          <th style={{ padding: '0.45rem 0.6rem' }}>Hạng</th>
                          <th style={{ padding: '0.45rem 0.6rem' }}>Họ và tên</th>
                          <th style={{ padding: '0.45rem 0.6rem' }}>Đơn vị</th>
                          <th style={{ padding: '0.45rem 0.6rem' }}>Điểm chính thức</th>
                          <th style={{ padding: '0.45rem 0.6rem' }}>Đúng / Tổng</th>
                          <th style={{ padding: '0.45rem 0.6rem' }}>Xếp loại</th>
                          <th style={{ padding: '0.45rem 0.6rem' }}>Số lượt</th>
                          <th style={{ padding: '0.45rem 0.6rem' }}>Thi lại</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(btcScoreboard.entries || btcScoreboard.participants || []).map((row, rIdx) => {
                          const hasAttempt = row.status === 'COMPLETED' || Boolean(row.officialAttemptId) || Boolean(row.officialAttempt);
                          const scoreVal = row.officialAttempt?.totalScore ?? row.score ?? 0;
                          const correctVal = row.officialAttempt?.correctAnswers ?? row.correctAnswers ?? 0;
                          const totalVal = row.officialAttempt?.totalQuestions ?? row.totalQuestions ?? 5;
                          const accVal = row.officialAttempt?.accuracyPercent ?? row.accuracyPercent ?? 0;
                          const passedVal = row.officialAttempt !== undefined ? row.officialAttempt?.isPassed : row.isPassed;

                          return (
                          <tr key={row.participantId || rIdx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '0.45rem 0.6rem', fontWeight: 800 }}>
                              {row.rank ? `#${row.rank}` : '—'}
                            </td>
                            <td style={{ padding: '0.45rem 0.6rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                              {row.fullName}
                            </td>
                            <td style={{ padding: '0.45rem 0.6rem', color: 'var(--text-secondary)' }}>
                              {row.departmentUnit || '—'}
                            </td>
                            <td style={{ padding: '0.45rem 0.6rem', fontWeight: 900, color: 'var(--accent-sky)' }}>
                              {hasAttempt ? `${scoreVal} đ` : '—'}
                            </td>
                            <td style={{ padding: '0.45rem 0.6rem' }}>
                              {hasAttempt ? `${correctVal}/${totalVal} (${accVal}%)` : '—'}
                            </td>
                            <td style={{ padding: '0.45rem 0.6rem', fontWeight: 800 }}>
                              {hasAttempt ? (
                                <span>
                                  {accVal >= 90
                                    ? 'Xuất sắc'
                                    : accVal >= 70
                                      ? 'Làm tốt'
                                      : accVal >= 50
                                        ? 'Đã nắm được một phần kiến thức'
                                        : 'Cần cố gắng thêm'}
                                  {passedVal !== null && passedVal !== undefined && (
                                    <span
                                      style={{
                                        marginLeft: '0.35rem',
                                        color: passedVal ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                                      }}
                                    >
                                      ({passedVal ? 'ĐẠT' : 'CHƯA ĐẠT'})
                                    </span>
                                  )}
                                </span>
                              ) : (
                                'Chưa thi'
                              )}
                            </td>
                            <td style={{ padding: '0.45rem 0.6rem' }}>
                              {row.usedAttempts ?? row.attemptsUsed ?? 0}/{row.allowedAttempts ?? 1}
                            </td>
                            <td style={{ padding: '0.45rem 0.6rem' }}>
                              {row.participantId ? (
                                <button
                                  type="button"
                                  data-testid={`scoreboard-grant-retake-btn-${row.participantId}`}
                                  onClick={() => handleGrantRetake(row.participantId!, row.fullName)}
                                  style={{
                                    padding: '0.2rem 0.45rem',
                                    borderRadius: '5px',
                                    border: '1px solid var(--accent-emerald)',
                                    backgroundColor: 'rgba(16, 185, 129, 0.12)',
                                    color: 'var(--accent-emerald)',
                                    fontSize: '0.72rem',
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                  }}
                                >
                                  +1 Thi lại
                                </button>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* MODAL CHỌN CHẾ ĐỘ CHƠI (CHƠI ĐƠN VS MULTIPLAYER) */}
      <GameModeSelectionModal
        isOpen={isModeModalOpen}
        onClose={() => setIsModeModalOpen(false)}
        gameSpec={modeModalSpec || generatedSpec}
        onStartSoloPresentation={(spec) => {
          setIsModeModalOpen(false);
          if (onNavigateToSoloPresentation) {
            onNavigateToSoloPresentation(spec);
          } else {
            handleStartSoloPlay(spec);
          }
        }}
        onStartPlaytest={(spec) => {
          setIsModeModalOpen(false);
          setPlaytestSpec(spec);
          setIsPlaytestOpen(true);
        }}
        onCreateMultiplayerRoom={async (spec) => {
          const room = await handleCreateRoom(spec);
          if (room) {
            return {
              roomCode: room,
              hostToken: hostToken,
              joinUrl: joinUrl,
            };
          }
          return null;
        }}
        onPublishGame={async () => {
          const saved = await handleSaveSpecEdits(true);
          return Boolean(saved?.isPublic);
        }}
        onNavigateToHost={onNavigateToHost}
        isOwner={true}
      />
    </div>
  );
};
