import React, { useEffect, useRef, useState } from 'react';
import { GameModeSelectionModal } from '../components/GameModeSelectionModal.js';

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
} from '../services/api.js';
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
} from '../types/index.js';

interface DemoPageProps {
  onNavigateToHost?: (roomCode: string, hostToken: string) => void;
  onNavigateToPlay?: (roomCode: string) => void;
  onNavigateToSoloPlay?: (spec: GameSpecification) => void;
  onNavigateToSoloPresentation?: (spec: GameSpecification) => void;
  initialSpec?: GameSpecification | null;
  autoStartSoloPlay?: boolean;
  onExitSoloPlay?: () => void;
  onNavigateToLibrary?: () => void;
  initialGameType?: GameType;
  initialSourceTab?: 'URL' | 'FILE' | 'TOPIC';
  onBackToHome?: () => void;
}

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
  autoStartSoloPlay,
  onExitSoloPlay,
  onNavigateToLibrary,
  initialGameType,
  initialSourceTab,
  onBackToHome,
}) => {
  const toast = useToast();

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
  const [customGameTitle, setCustomGameTitle] = useState('');

  // AI configuration state (Batch 4 & Batch 5)
  const [gameType, setGameType] = useState<GameType>(initialGameType || 'MULTIPLE_CHOICE');

  useEffect(() => {
    if (initialGameType) {
      setGameType(initialGameType);
    }
  }, [initialGameType]);
  const [difficulty, setDifficulty] = useState<Difficulty>('MEDIUM');
  const [scoringMode, setScoringMode] = useState<ScoringMode>('STANDARD');
  const [questionCount, setQuestionCount] = useState(5);
  const [timePerQuestion, setTimePerQuestion] = useState(20);
  const [topicFocus, setTopicFocus] = useState('');
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [mixedDistribution, setMixedDistribution] = useState<MixedQuestionDistribution>({
    MULTIPLE_CHOICE: 40,
    QUICK_BUTTON: 20,
    FILL_IN_THE_BLANK: 20,
    CROSSWORD: 20,
  });

  const [ingestedSources, setIngestedSources] = useState<IngestedSource[]>([]);
  const [generatedSpec, setGeneratedSpec] = useState<GameSpecification | null>(null);
  const [editingQuestionIdx, setEditingQuestionIdx] = useState<number | null>(null);

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);

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
  const [savedForLater, setSavedForLater] = useState(false);
  const [adventureIndustryMode, setAdventureIndustryMode] = useState<'AI_DETECT' | IndustryId>('AI_DETECT');
  const [customIndustryName, setCustomIndustryName] = useState<string>('');
  const [customSubEnvironment, setCustomSubEnvironment] = useState<string>('');
  const [adventureConfig, setAdventureConfig] = useState<AdventureConfig>(() =>
    buildDefaultAdventureConfig('theme_edu_campus', 5)
  );
  const [isReanalyzingAdventure, setIsReanalyzingAdventure] = useState<boolean>(false);
  const [showAdventureFullscreenPreview, setShowAdventureFullscreenPreview] = useState<boolean>(false);
  const [adventureQuestionTypes, setAdventureQuestionTypes] = useState<QuestionType[]>([
    'MULTIPLE_CHOICE',
    'QUICK_BUTTON',
  ]);
  const [adventureQuestionDistribution, setAdventureQuestionDistribution] =
    useState<MixedQuestionDistribution>({
      MULTIPLE_CHOICE: 50,
      QUICK_BUTTON: 50,
      FILL_IN_THE_BLANK: 0,
      CROSSWORD: 0,
    });

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
    if (initialSpec) {
      setGeneratedSpec(initialSpec);
      setCustomGameTitle(initialSpec.title || '');
      setGameType(initialSpec.gameType);
      setScoringMode(initialSpec.settings.scoringMode);
      setTimePerQuestion(initialSpec.settings.timePerQuestion);
      setQuestionCount(initialSpec.questions.length);
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
      setRoomCode('');
      setCurrentStep(4);
      setShowAdventureFullscreenPreview(false);
    }
  }, [initialSpec]);

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

    isGeneratingRef.current = true;
    setIsGenerating(true);
    const toastId = toast.loading('Đang yêu cầu AI tổng hợp câu hỏi và phương án trả lời...');

    try {
      const spec = await generateGame({
        sourceId: primaryId,
        sourceIds: sIds,
        sources: activeSources.length > 0 ? activeSources : undefined,

        gameType,
        difficulty,
        scoringMode,
        questionCount,
        timePerQuestion,
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

      toast.removeToast(toastId);
      setGeneratedSpec(spec);
      if (spec.settings?.adventureConfig) {
        setAdventureConfig(
          syncAdventureStagesWithQuestions(spec.settings.adventureConfig, spec.questions)
        );
      }
      setCustomGameTitle(spec.title);
      setEditingQuestionIdx(null);
      setRoomCode('');
      setIsModeModalOpen(false);
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

    const seenQuestions = new Set<string>();
    for (let i = 0; i < spec.questions.length; i++) {
      const q = spec.questions[i];
      const err = validateQuestionItem(q);
      if (err) {
        setEditingQuestionIdx(i);
        toast.error(`Câu hỏi #${i + 1}: ${err}`, 'Câu hỏi chưa hợp lệ');
        return false;
      }
      const normKey = q.question.trim().toLowerCase().replace(/\s+/g, ' ');
      if (seenQuestions.has(normKey)) {
        setEditingQuestionIdx(i);
        toast.error(`Câu hỏi #${i + 1} bị trùng nội dung với một câu hỏi trước đó.`, 'Trùng lặp câu hỏi');
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

    setIsCreatingRoom(true);
    const toastId = toast.loading('Đang khởi tạo phòng chơi và tạo mã QR tham gia...');

    try {
      const roomData = await createRoom({
        gameId: spec!.gameId,
        gameSpecification: {
          ...spec!,
          settings: {
            ...spec!.settings,
            questionCount: spec!.questions.length,
            scoringMode,
            timePerQuestion,
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
    if (editingQuestionIdx === index) {
      setEditingQuestionIdx(null);
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

    if (editingQuestionIdx === index) {
      setEditingQuestionIdx(targetIndex);
    } else if (editingQuestionIdx === targetIndex) {
      setEditingQuestionIdx(index);
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
    setEditingQuestionIdx(index + 1);
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
    setEditingQuestionIdx(nextQuestions.length - 1);
  };

  const handleSaveSpecEdits = async (publishFlag?: boolean): Promise<GameSpecification | null> => {
    if (isSavingSpec) return null;
    if (!generatedSpec || !validateSpecBeforeLaunch(generatedSpec)) {
      return null;
    }

    const nextIsPublic =
      publishFlag !== undefined ? publishFlag : (generatedSpec.isPublic ?? true);

    setIsSavingSpec(true);
    try {
      const saved = await saveEditedQuestions(generatedSpec.gameId, {
        title: generatedSpec.title,
        description: generatedSpec.description,
        questions: generatedSpec.questions,
        settings: {
          timePerQuestion,
          ...(generatedSpec.gameType === 'ADVENTURE'
            ? {
                adventureConfig: syncAdventureStagesWithQuestions(
                  generatedSpec.settings?.adventureConfig || adventureConfig,
                  generatedSpec.questions
                ),
              }
            : {}),
          scoringMode,
        },
        isPublic: nextIsPublic,
        ...(publishFlag === true && !generatedSpec.coverImageUrl ? { generateCover: true } : {}),
      });
      setGeneratedSpec(saved);
      setEditingQuestionIdx(null);
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
      return saved;
    } catch (err: any) {
      toast.error(err.message || 'Không thể lưu chỉnh sửa câu hỏi.', 'Lỗi lưu');
      return null;
    } finally {
      setIsSavingSpec(false);
    }
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
    if (!saved && generatedSpec.gameType === 'ADVENTURE') {
      return;
    }
    const target = saved || generatedSpec;
    setModeModalSpec(target);
    setIsModeModalOpen(true);
  };

  const handlePublishAndUseNow = async () => {
    if (!generatedSpec) return;
    if (!validateSpecBeforeLaunch(generatedSpec)) return;
    const saved = await handleSaveSpecEdits(true);
    if (!saved && generatedSpec.gameType === 'ADVENTURE') {
      return;
    }
    const target = saved || generatedSpec;
    setModeModalSpec(target);
    setIsModeModalOpen(true);
  };

  const handleSaveForLater = async () => {
    if (!generatedSpec) return;
    if (!validateSpecBeforeLaunch(generatedSpec)) return;
    const saved = await handleSaveSpecEdits(generatedSpec.isPublic ?? true);
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
              onChange={(e) => setCustomGameTitle(e.target.value)}
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
                      gap: '0.55rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                        Loại câu hỏi trong game đi cảnh
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span
                          data-testid="adventure-selected-types-badge"
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            color: adventureQuestionTypes.length > 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                          }}
                        >
                          {adventureQuestionTypes.length > 0
                            ? `Đã chọn ${adventureQuestionTypes.length}/4 loại`
                            : 'Chưa chọn loại nào'}
                        </span>
                        <span
                          data-testid="adventure-total-badge"
                          style={{
                            padding: '0.15rem 0.5rem',
                            borderRadius: '16px',
                            fontSize: '0.72rem',
                            fontWeight: 800,
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
                            ? 'Tổng: 100% Hợp lệ'
                            : advTotal > 100
                              ? `Tổng: ${advTotal}% (Vượt ${advTotal - 100}%)`
                              : `Tổng: ${advTotal}% (Còn thiếu ${100 - advTotal}%)`}
                        </span>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
                        gap: '0.45rem',
                      }}
                    >
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
                              padding: '0.55rem 0.65rem',
                              borderRadius: '8px',
                              backgroundColor: checked ? 'var(--bg-elevated)' : 'var(--bg-card)',
                              border: checked
                                ? '1.5px solid var(--primary)'
                                : '1px solid var(--border-strong)',
                              borderLeft: `3px solid ${checked ? opt.color : 'var(--border-strong)'}`,
                              color: 'var(--text-primary)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.4rem',
                              opacity: checked ? 1 : 0.72,
                              transition: 'border-color 0.15s ease, background-color 0.15s ease, opacity 0.15s ease',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.4rem' }}>
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
                                  alignItems: 'flex-start',
                                  gap: '0.45rem',
                                  flex: 1,
                                  minWidth: 0,
                                }}
                              >
                                <span
                                  style={{
                                    width: '16px',
                                    height: '16px',
                                    borderRadius: '4px',
                                    marginTop: '1px',
                                    flexShrink: 0,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: checked ? 'var(--primary)' : 'var(--bg-input)',
                                    border: checked ? 'none' : '1px solid var(--border-strong)',
                                    color: 'var(--primary-ink, #090d16)',
                                    fontSize: '0.68rem',
                                    fontWeight: 900,
                                  }}
                                >
                                  {checked ? '✓' : ''}
                                </span>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: '0.78rem', fontWeight: 800, color: checked ? opt.color : 'var(--text-primary)' }}>
                                    {opt.icon} {opt.label}
                                  </div>
                                  <div style={{ fontSize: '0.69rem', color: 'var(--text-secondary)', marginTop: '0.08rem' }}>
                                    {opt.desc}
                                  </div>
                                </div>
                              </button>
                              <span
                                data-testid={`adventure-count-${opt.type}`}
                                style={{
                                  fontSize: '0.72rem',
                                  fontWeight: 800,
                                  color: checked ? 'var(--text-primary)' : 'var(--text-muted)',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {countForType} câu
                              </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <input
                                type="range"
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
                                  accentColor: opt.color,
                                  cursor: checked ? 'pointer' : 'not-allowed',
                                  height: '4px',
                                }}
                              />
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                                <input
                                  type="number"
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
                                    width: '44px',
                                    padding: '0.16rem 0.22rem',
                                    borderRadius: '5px',
                                    border: '1px solid var(--border-strong)',
                                    backgroundColor: checked ? 'var(--bg-input)' : 'var(--bg-card)',
                                    color: checked ? 'var(--text-primary)' : 'var(--text-muted)',
                                    fontSize: '0.76rem',
                                    fontWeight: 800,
                                    textAlign: 'center',
                                    boxSizing: 'border-box',
                                  }}
                                />
                                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>%</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {adventureQuestionTypes.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.71rem', color: 'var(--text-muted)', fontWeight: 600 }}>
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
                            borderRadius: '6px',
                            backgroundColor: 'var(--bg-card)',
                            border: '1px solid var(--border-strong)',
                            color: 'var(--text-secondary)',
                            fontSize: '0.71rem',
                            fontWeight: 700,
                            cursor: 'pointer',
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
          {showQuestionEditor && generatedSpec ? (
            /* ======================================================== */
            /* QUESTION WORKBENCH / EDITOR MODE                         */
            /* ======================================================== */
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Toolbar Question Workbench */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingBottom: '0.65rem',
                  marginBottom: '0.65rem',
                  borderBottom: '1px solid var(--border-subtle)',
                  flexShrink: 0,
                  flexWrap: 'wrap',
                  gap: '0.4rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <span style={{ fontSize: '0.88rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                    Soạn Thảo Câu Hỏi ({generatedSpec.questions.length})
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => handleSaveSpecEdits()}
                    disabled={isSavingSpec}
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--accent-emerald)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '6px',
                      padding: '0.35rem 0.65rem',
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
                  >
                    <CheckIcon size={13} />
                    <span>{isSavingSpec ? 'Đang lưu...' : 'Lưu'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleAddQuestion}
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--accent-sky)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '6px',
                      padding: '0.35rem 0.65rem',
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
                  >
                    <PlusIcon size={13} />
                    <span>Thêm</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowQuestionEditor(false)}
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      padding: '0.35rem 0.55rem',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Đóng ✕
                  </button>
                </div>
              </div>

              {/* Scrollable Questions list */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem',
                  flex: 1,
                  overflowY: 'auto',
                  paddingRight: '0.25rem',
                }}
              >
                {generatedSpec.questions.map((q, idx) => {
                  const isEditing = editingQuestionIdx === idx;

                  return (
                    <div
                      key={q.id || idx}
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        borderRadius: '10px',
                        padding: '0.85rem',
                        border: '1px solid var(--border-subtle)',
                        borderLeft: isEditing ? '3px solid var(--primary)' : '3px solid transparent',
                      }}
                    >
                      {/* Header câu hỏi */}
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--accent-sky)' }}>
                            #{idx + 1}
                          </span>
                          <span
                            style={{
                              fontSize: '0.7rem',
                              fontWeight: 800,
                              padding: '0.1rem 0.4rem',
                              borderRadius: '4px',
                              backgroundColor: 'var(--bg-input)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {formatGameTypeLabel(q.type)}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <button
                            type="button"
                            onClick={() => handleMoveQuestion(idx, -1)}
                            disabled={idx === 0}
                            style={{
                              padding: '0.2rem 0.4rem',
                              borderRadius: '4px',
                              border: '1px solid var(--border-subtle)',
                              backgroundColor: 'transparent',
                              color: idx === 0 ? 'var(--text-muted)' : 'var(--text-secondary)',
                              fontSize: '0.72rem',
                              cursor: idx === 0 ? 'not-allowed' : 'pointer',
                            }}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveQuestion(idx, 1)}
                            disabled={idx === generatedSpec.questions.length - 1}
                            style={{
                              padding: '0.2rem 0.4rem',
                              borderRadius: '4px',
                              border: '1px solid var(--border-subtle)',
                              backgroundColor: 'transparent',
                              color: idx === generatedSpec.questions.length - 1 ? 'var(--text-muted)' : 'var(--text-secondary)',
                              fontSize: '0.72rem',
                              cursor: idx === generatedSpec.questions.length - 1 ? 'not-allowed' : 'pointer',
                            }}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicateQuestion(idx)}
                            style={{
                              padding: '0.2rem 0.45rem',
                              borderRadius: '4px',
                              border: '1px solid var(--border-subtle)',
                              backgroundColor: 'transparent',
                              color: 'var(--accent-sky)',
                              fontSize: '0.72rem',
                              cursor: 'pointer',
                            }}
                            title="Nhân bản"
                          >
                            <CopyIcon size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteQuestion(idx)}
                            disabled={generatedSpec.questions.length <= 1}
                            style={{
                              padding: '0.2rem 0.45rem',
                              borderRadius: '4px',
                              border: '1px solid var(--border-subtle)',
                              backgroundColor: 'transparent',
                              color: generatedSpec.questions.length <= 1 ? 'var(--text-muted)' : 'var(--accent-rose)',
                              fontSize: '0.72rem',
                              cursor: generatedSpec.questions.length <= 1 ? 'not-allowed' : 'pointer',
                            }}
                            title="Xóa"
                          >
                            <TrashIcon size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingQuestionIdx(isEditing ? null : idx)}
                            style={{
                              padding: '0.2rem 0.5rem',
                              borderRadius: '4px',
                              border: '1px solid var(--border-strong)',
                              backgroundColor: isEditing ? 'var(--primary)' : 'var(--bg-input)',
                              color: isEditing ? 'var(--primary-ink)' : 'var(--text-primary)',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {isEditing ? 'Đóng' : 'Sửa'}
                          </button>
                        </div>
                      </div>

                      {/* Nội dung câu hỏi (chế độ xem) */}
                      {!isEditing && (
                        <div>
                          <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                            {q.question}
                          </div>
                          {q.choices && q.choices.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.3rem' }}>
                              {q.choices.map((c, cIdx) => {
                                const isCorrect = stripOptionLetterPrefix(c) === stripOptionLetterPrefix(q.correctAnswer);
                                return (
                                  <span
                                    key={cIdx}
                                    style={{
                                      fontSize: '0.75rem',
                                      padding: '0.15rem 0.5rem',
                                      borderRadius: '4px',
                                      border: isCorrect ? '1px solid var(--accent-emerald)' : '1px solid var(--border-subtle)',
                                      backgroundColor: isCorrect ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-input)',
                                      color: isCorrect ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                                      fontWeight: isCorrect ? 800 : 600,
                                    }}
                                  >
                                    {c}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          {q.type === 'SLIDER' && q.sliderConfig && (
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '0.4rem',
                                marginBottom: '0.35rem',
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
                                Sai số: ±{q.sliderConfig.tolerance} {q.sliderConfig.unit || ''}
                              </span>
                            </div>
                          )}
                          <div style={{ fontSize: '0.76rem', color: 'var(--accent-emerald)', fontWeight: 700 }}>
                            Đáp án: {q.correctAnswer}
                            {q.type === 'SLIDER' && q.sliderConfig?.unit ? ` ${q.sliderConfig.unit}` : ''}
                          </div>
                        </div>
                      )}

                      {/* Chế độ sửa câu hỏi */}
                      {isEditing && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.4rem' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                              Nội dung câu hỏi:
                            </label>
                            <input
                              type="text"
                              value={q.question}
                              onChange={(e) => handleUpdateQuestion(idx, (prev) => ({ ...prev, question: e.target.value }))}
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

                          {(q.type === 'MULTIPLE_CHOICE' || q.type === 'QUIZ') && q.choices && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
                              {q.choices.map((c, cIdx) => (
                                <div key={cIdx} style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                                  <input
                                    type="radio"
                                    name={`correct_q_${idx}`}
                                    checked={stripOptionLetterPrefix(c) === stripOptionLetterPrefix(q.correctAnswer)}
                                    onChange={() => handleUpdateQuestion(idx, (prev) => ({ ...prev, correctAnswer: c }))}
                                    style={{ cursor: 'pointer' }}
                                  />
                                  <input
                                    type="text"
                                    value={c}
                                    onChange={(e) => {
                                      const newChoices = [...(q.choices || [])];
                                      newChoices[cIdx] = e.target.value;
                                      handleUpdateQuestion(idx, (prev) => ({ ...prev, choices: newChoices }));
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

                          {(q.type === 'QUICK_BUTTON' || q.type === 'TRUE_FALSE') && (
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              {(['Đúng', 'Sai'] as const).map((tfVal) => {
                                const isSel = normalizeChoiceCompare(q.correctAnswer) === normalizeChoiceCompare(tfVal);
                                return (
                                  <button
                                    key={tfVal}
                                    type="button"
                                    onClick={() =>
                                      handleUpdateQuestion(idx, (prev) => ({
                                        ...prev,
                                        choices: ['Đúng', 'Sai'],
                                        correctAnswer: tfVal,
                                      }))
                                    }
                                    style={{
                                      flex: 1,
                                      padding: '0.4rem 0.65rem',
                                      borderRadius: '6px',
                                      border: isSel ? '2px solid var(--accent-emerald)' : '1px solid var(--border-strong)',
                                      backgroundColor: isSel ? 'rgba(16, 185, 129, 0.14)' : 'var(--bg-input)',
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

                          {q.type === 'PUZZLE' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                Thứ tự chuẩn của các mục (3 - 6 mục):
                              </label>
                              {(q.choices || []).map((item, itemIdx) => (
                                <div key={itemIdx} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                                  <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--accent-sky)', minWidth: '22px' }}>
                                    #{itemIdx + 1}
                                  </span>
                                  <input
                                    type="text"
                                    value={item}
                                    onChange={(e) => {
                                      const nextItems = [...(q.choices || [])];
                                      nextItems[itemIdx] = e.target.value;
                                      handleUpdateQuestion(idx, (prev) => ({
                                        ...prev,
                                        choices: nextItems,
                                        correctAnswer: nextItems.map(s => s.trim()).filter(Boolean).join(' | '),
                                      }));
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

                          {q.type === 'SLIDER' && (
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(115px, 1fr))',
                                gap: '0.45rem',
                                padding: '0.55rem',
                                borderRadius: '8px',
                                backgroundColor: 'var(--bg-surface)',
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
                                  value={q.sliderConfig?.min ?? 0}
                                  onChange={(e) => {
                                    const minVal = Number(e.target.value);
                                    handleUpdateQuestion(idx, (prev) => {
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
                                  value={q.sliderConfig?.max ?? 100}
                                  onChange={(e) => {
                                    const maxVal = Number(e.target.value);
                                    handleUpdateQuestion(idx, (prev) => {
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
                                  value={q.sliderConfig?.step ?? 1}
                                  onChange={(e) => {
                                    const stepVal = Number(e.target.value);
                                    handleUpdateQuestion(idx, (prev) => {
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
                                  value={q.sliderConfig?.correctValue ?? Number(q.correctAnswer || 0)}
                                  onChange={(e) => {
                                    const cv = Number(e.target.value);
                                    const safeCv = Number.isFinite(cv) ? cv : 0;
                                    handleUpdateQuestion(idx, (prev) => {
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
                                  value={q.sliderConfig?.tolerance ?? 0}
                                  onChange={(e) => {
                                    const tolVal = Number(e.target.value);
                                    handleUpdateQuestion(idx, (prev) => {
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
                                  value={q.sliderConfig?.unit || ''}
                                  onChange={(e) => {
                                    const unitVal = e.target.value;
                                    handleUpdateQuestion(idx, (prev) => {
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

                          {(q.type === 'FILL_IN_THE_BLANK' || q.type === 'TYPE_ANSWER' || q.type === 'CROSSWORD') && (
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                                Đáp án đúng:
                              </label>
                              <input
                                type="text"
                                value={q.correctAnswer}
                                onChange={(e) => handleUpdateQuestion(idx, (prev) => ({ ...prev, correctAnswer: e.target.value }))}
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
                              Giải thích:
                            </label>
                            <input
                              type="text"
                              value={q.explanation || ''}
                              onChange={(e) => handleUpdateQuestion(idx, (prev) => ({ ...prev, explanation: e.target.value }))}
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

                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.2rem' }}>
                            <button
                              type="button"
                              onClick={() => setEditingQuestionIdx(null)}
                              style={{
                                backgroundColor: 'var(--primary)',
                                color: 'var(--primary-ink)',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '0.35rem 0.75rem',
                                fontWeight: 800,
                                fontSize: '0.8rem',
                                cursor: 'pointer',
                              }}
                            >
                              Xong
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* ======================================================== */
            /* SETTINGS / CONFIGURATION & ACTION MODE                   */
            /* ======================================================== */
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
                    {savedForLater && (
                      <span style={{ fontSize: '0.74rem', color: 'var(--accent-emerald)', fontWeight: 700 }}>
                        Đã lưu Kho Game
                      </span>
                    )}
                  </div>

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

                  {/* Nhóm nút hành động: Phân biệt rõ giữa Tạo thành công và Bắt đầu chơi */}
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.2rem' }}>
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
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          minHeight: '38px',
                          order: 2,
                        }}
                        title="Xem card game trong Kho Game"
                      >
                        <GamepadIcon size={14} />
                        <span>Xem Trong Kho Game</span>
                      </button>
                    )}
                    <button
                      type="button"
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
                      onClick={() => setShowQuestionEditor(!showQuestionEditor)}
                      style={{
                        backgroundColor: showQuestionEditor ? 'var(--primary-subtle)' : 'var(--bg-input)',
                        color: showQuestionEditor ? 'var(--primary)' : 'var(--text-primary)',
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
                    >
                      <PencilIcon size={14} />
                      <span>{showQuestionEditor ? 'Đóng Trình Soạn Thảo' : 'Xem & Sửa Câu Hỏi'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveForLater}
                      disabled={isSavingSpec}
                      style={{
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '8px',
                        padding: '0.55rem 0.85rem',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        cursor: isSavingSpec ? 'not-allowed' : 'pointer',
                        minHeight: '38px',
                      }}
                      title="Lưu vào Kho Game"
                    >
                      Lưu Vào Kho
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
                </div>
              )}
            </div>
          )}
        </div>
      </div>
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
