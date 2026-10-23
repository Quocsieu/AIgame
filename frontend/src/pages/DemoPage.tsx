import React, { useEffect, useRef, useState } from 'react';
import { GameModeSelectionModal } from '../components/GameModeSelectionModal.js';
import { GameTypeSelector } from '../components/GameTypeSelector.js';
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
  saveEditedQuestions,
} from '../services/api.js';
import {
  calculateMixedTypeCounts,
  type AuthenticatedUser,
  type Difficulty,
  type GameQuestion,
  type GameSpecification,
  type GameType,
  type IngestedSource,
  type MixedQuestionDistribution,
  type ProvenanceReference,
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
    case 'MULTIPLE_CHOICE':
      return 'Trắc nghiệm ABCD';
    case 'FILL_IN_THE_BLANK':
      return 'Điền từ';
    case 'QUICK_BUTTON':
      return 'Đúng / Sai';
    case 'CROSSWORD':
      return 'Ô chữ';
    case 'MIXED':
      return 'Hỗn hợp (Mixed)';
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

  if (q.type === 'MULTIPLE_CHOICE') {
    if (!q.choices || q.choices.length !== 4) {
      return 'Câu hỏi Trắc nghiệm ABCD phải có đúng 4 lựa chọn.';
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

  if (q.type === 'QUICK_BUTTON') {
    if (!q.choices || q.choices.length < 2 || q.choices.length > 4) {
      return 'Câu hỏi Nút bấm nhanh phải có từ 2 đến 4 lựa chọn.';
    }
    const normButtons = q.choices.map(c => normalizeChoiceCompare(c));
    if (normButtons.some(c => c.length === 0)) {
      return 'Các lựa chọn Nút bấm nhanh không được để trống.';
    }
    if (new Set(normButtons).size !== q.choices.length) {
      return 'Các lựa chọn Nút bấm nhanh phải khác nhau.';
    }
    const normAns = normalizeChoiceCompare(q.correctAnswer);
    if (!normButtons.includes(normAns)) {
      return `Đáp án đúng "${q.correctAnswer}" phải khớp với một trong các nút lựa chọn.`;
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
  onBackToHome,
}) => {
  const toast = useToast();

  // Multi-source state (Batch 4 & Batch 8)
  const [urls, setUrls] = useState<string[]>(['']);
  const [files, setFiles] = useState<File[]>([]);
  const [sourceTab, setSourceTab] = useState<'URL' | 'FILE' | 'TOPIC'>('URL');

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

  // Modal Chọn chế độ chơi (Luồng 1 & Luồng 2)
  const [isModeModalOpen, setIsModeModalOpen] = useState(false);
  const [modeModalSpec, setModeModalSpec] = useState<GameSpecification | null>(null);

  // the9bit Creator Studio UX enhancements (Gate 3.2 & 3.3)
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false);
  const [showQuestionEditor, setShowQuestionEditor] = useState(false);
  const [savedForLater, setSavedForLater] = useState(false);

  useEffect(() => {
    if (initialSpec) {
      setGeneratedSpec(initialSpec);
      setCustomGameTitle(initialSpec.title || '');
      setGameType(initialSpec.gameType);
      setScoringMode(initialSpec.settings.scoringMode);
      setTimePerQuestion(initialSpec.settings.timePerQuestion);
      setQuestionCount(initialSpec.questions.length);
      setEditingQuestionIdx(null);
      setRoomCode('');
      setCurrentStep(4);
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

  const handleIngest = async (): Promise<string | null> => {
    if (isIngesting) return null;

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

    setIsIngesting(true);
    const toastId = toast.loading('Đang xử lý và trích xuất nội dung nguồn...');

    try {
      const sources = await ingestSources({
        urls: cleanUrls,
        files,
      });

      toast.removeToast(toastId);
      setIngestedSources(sources);
      setSelectedSections([]);
      const firstSource = sources[0];
      const totalChars = sources.reduce((acc, s) => acc + (s.metadata?.characterCount || 0), 0);

      toast.success(
        `Đã nạp thành công ${sources.length} nguồn tài liệu (${totalChars.toLocaleString('vi-VN')} ký tự).`,
        'Trích xuất thành công'
      );
      setCurrentStep(3);
      return firstSource.sourceId;
    } catch (err: any) {
      toast.removeToast(toastId);
      toast.error(err.message || 'Không thể trích xuất nội dung nguồn.', 'Lỗi nhập dữ liệu');
      return null;
    } finally {
      setIsIngesting(false);
    }
  };

  const handleGenerate = async (targetSourceId?: string): Promise<GameSpecification | null> => {
    if (isGenerating) return null;

    const sIds = ingestedSources.map(s => s.sourceId);
    const primaryId = targetSourceId || sIds[0] || null;
    if (!primaryId) {
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

    setIsGenerating(true);
    const toastId = toast.loading('Đang yêu cầu AI tổng hợp câu hỏi và phương án trả lời...');

    try {
      const spec = await generateGame({
        sourceId: primaryId,
        sourceIds: sIds,
        sources: ingestedSources,
        gameType,
        difficulty,
        scoringMode,
        questionCount,
        timePerQuestion,
        topicFocus: topicFocus.trim() || undefined,
        sectionFilter: selectedSections.length > 0 ? selectedSections : undefined,
        title: customGameTitle.trim() || undefined,
        mixedDistribution: gameType === 'MIXED' ? mixedDistribution : undefined,
      });

      toast.removeToast(toastId);
      setGeneratedSpec(spec);
      setCustomGameTitle(spec.title);
      setEditingQuestionIdx(null);
      setRoomCode('');
      setIsModeModalOpen(false);
      toast.success(
        `Đã tạo thành công bộ câu hỏi "${spec.title}" (${spec.questions.length} câu)! Bạn có thể xem trước nội dung hoặc bắt đầu chơi khi sẵn sàng.`,
        'Tạo game thành công'
      );
      setCurrentStep(4);
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
      setIsGenerating(false);
    }
  };

  const handleCreateGameUnified = async () => {
    // Chống submit trùng lặp
    if (isGenerating || isIngesting) {
      return;
    }

    let trimmedTitle = customGameTitle.trim();
    const cleanUrls = urls.map(u => u.trim()).filter(Boolean);
    const hasFiles = files.length > 0;
    const hasTopic = topicFocus.trim().length > 0;

    if (!cleanUrls.length && !hasFiles && !hasTopic && ingestedSources.length === 0) {
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

    let primarySourceId: string | undefined = ingestedSources[0]?.sourceId;

    if (!primarySourceId && (cleanUrls.length > 0 || hasFiles)) {
      const newSourceId = await handleIngest();
      if (!newSourceId) return;
      primarySourceId = newSourceId;
    }

    setSavedForLater(false);
    setShowQuestionEditor(false);
    setIsModeModalOpen(false);
    await handleGenerate(primarySourceId);
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
    if (generatedSpec.questions.length >= 20) {
      toast.warning('Bộ câu hỏi hỗ trợ tối đa 20 câu hỏi.', 'Đã đạt giới hạn');
      return;
    }

    const sourceQ = generatedSpec.questions[index];
    const copyId = `q_copy_${Date.now()}_${index + 1}`;
    const duplicated: GameQuestion = {
      ...sourceQ,
      id: copyId,
      question: `${sourceQ.question} (Bản sao)`,
      choices: sourceQ.choices ? [...sourceQ.choices] : undefined,
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
    if (generatedSpec.questions.length >= 20) {
      toast.warning('Bộ câu hỏi hỗ trợ tối đa 20 câu hỏi.', 'Đã đạt giới hạn');
      return;
    }

    const fallbackSource = ingestedSources[0] || {
      sourceId: generatedSpec.sourceSummary?.sources?.[0]?.sourceId || 'src_manual',
      sourceType: generatedSpec.sourceSummary?.sources?.[0]?.sourceType || 'WEBSITE',
      sourceLocation: generatedSpec.sourceSummary?.sources?.[0]?.sourceLocation || 'Biên tập thủ công',
    };

    const gType: QuestionType =
      generatedSpec.gameType === 'MIXED' ? 'MULTIPLE_CHOICE' : generatedSpec.gameType;
    const newIndex = generatedSpec.questions.length + 1;
    const newQuestion: GameQuestion = {
      id: `q_custom_${Date.now()}_${newIndex}`,
      type: gType,
      question:
        gType === 'FILL_IN_THE_BLANK'
          ? `Câu hỏi điền từ mới số ${newIndex}: Hãy điền từ thích hợp vào chỗ trống ___?`
          : `Câu hỏi mới số ${newIndex}?`,
      choices:
        gType === 'MULTIPLE_CHOICE'
          ? ['A. Phương án 1', 'B. Phương án 2', 'C. Phương án 3', 'D. Phương án 4']
          : gType === 'QUICK_BUTTON'
            ? ['Đúng', 'Sai']
            : undefined,
      correctAnswer:
        gType === 'MULTIPLE_CHOICE'
          ? 'A. Phương án 1'
          : gType === 'QUICK_BUTTON'
            ? 'Đúng'
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
      publishFlag !== undefined ? publishFlag : Boolean(generatedSpec.isPublic);

    setIsSavingSpec(true);
    try {
      const saved = await saveEditedQuestions(generatedSpec.gameId, {
        title: generatedSpec.title,
        description: generatedSpec.description,
        questions: generatedSpec.questions,
        settings: {
          timePerQuestion,
          scoringMode,
        },
        isPublic: nextIsPublic,
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

  const handleStartImmediately = async () => {
    if (!generatedSpec) {
      toast.error('Vui lòng tạo bộ câu hỏi trước.', 'Chưa có bộ câu hỏi');
      return;
    }
    if (!validateSpecBeforeLaunch(generatedSpec)) {
      return;
    }
    const saved = await handleSaveSpecEdits(generatedSpec.isPublic);
    const target = saved || generatedSpec;
    setModeModalSpec(target);
    setIsModeModalOpen(true);
  };

  const handlePublishAndUseNow = async () => {
    if (!generatedSpec) return;
    if (!validateSpecBeforeLaunch(generatedSpec)) return;
    const saved = await handleSaveSpecEdits(true);
    const target = saved || generatedSpec;
    setModeModalSpec(target);
    setIsModeModalOpen(true);
  };

  const handleSaveForLater = async () => {
    if (!generatedSpec) return;
    if (!validateSpecBeforeLaunch(generatedSpec)) return;
    const saved = await handleSaveSpecEdits(false);
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
    const remaining = Math.max(0, 100 - total);
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
              Tỉ Lệ Bộ Đề Hỗn Hợp
            </span>
          </div>

          <div
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
                <span>100% Đầy đủ (Đã khóa tăng)</span>
              </>
            ) : total > 100 ? (
              <>
                <AlertTriangleIcon size={12} />
                <span>{total}% (Vượt {total - 100}%)</span>
              </>
            ) : (
              <>
                <AlertTriangleIcon size={12} />
                <span>{total}% (Còn lại {100 - total}%)</span>
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
            return (
              <div
                key={tc.key}
                style={{
                  width: `${pct}%`,
                  backgroundColor: tc.color,
                  transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                title={`${tc.label}: ${pct}% (${counts[tc.key] || 0} câu)`}
              />
            );
          })}
        </div>

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
            // KHI ĐỦ 100% THÌ KHÔNG CHO TĂNG TỈ LỆ 4 THẰNG NỮA:
            // maxAllowed = currentVal + remaining (với remaining = max(0, 100 - total))
            // Khi total === 100, remaining === 0 => maxAllowed === currentVal (chỉ có thể giảm hoặc giữ nguyên)
            const maxAllowed = Math.min(100, currentVal + remaining);
            const isLockedFromIncreasing = total >= 100;

            return (
              <div
                key={tc.key}
                style={{
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                  borderLeft: `3px solid ${tc.color}`,
                  borderRadius: '8px',
                  padding: '0.45rem 0.6rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                  opacity: isLockedFromIncreasing && currentVal === 0 ? 0.65 : 1,
                  transition: 'opacity 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, fontSize: '0.78rem', color: tc.color, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    <span>{tc.icon}</span> {tc.label}
                  </span>
                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {countForType} câu
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    type="range"
                    min="0"
                    max={maxAllowed}
                    step="5"
                    value={currentVal}
                    disabled={maxAllowed === 0}
                    onChange={e => {
                      const inputVal = parseInt(e.target.value, 10) || 0;
                      const clamped = Math.max(0, Math.min(maxAllowed, inputVal));
                      setMixedDistribution(prev => ({ ...prev, [tc.key]: clamped }));
                    }}
                    title={isLockedFromIncreasing ? (currentVal === 0 ? 'Tổng đã đạt 100%. Hãy giảm loại khác để tăng loại này.' : 'Tổng đã đạt 100%. Chỉ có thể giảm tỉ lệ.') : undefined}
                    style={{
                      flex: 1,
                      accentColor: tc.color,
                      cursor: maxAllowed > currentVal ? 'pointer' : currentVal > 0 ? 'pointer' : 'not-allowed',
                      height: '4px',
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                    <input
                      type="number"
                      min={0}
                      max={maxAllowed}
                      value={currentVal}
                      disabled={maxAllowed === 0 && currentVal === 0}
                      onChange={e => {
                        const inputVal = parseInt(e.target.value, 10) || 0;
                        const clamped = Math.max(0, Math.min(maxAllowed, inputVal));
                        setMixedDistribution(prev => ({ ...prev, [tc.key]: clamped }));
                      }}
                      style={{
                        width: '42px',
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
                          <div style={{ fontSize: '0.76rem', color: 'var(--accent-emerald)', fontWeight: 700 }}>
                            Đáp án: {q.correctAnswer}
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

                          {q.type === 'MULTIPLE_CHOICE' && q.choices && (
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

                          {(q.type === 'FILL_IN_THE_BLANK' || q.type === 'CROSSWORD') && (
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
                      (1 - 20)
                    </span>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={questionCount}
                    onChange={(e) => setQuestionCount(Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 5)))}
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
              <button
                type="button"
                onClick={handleCreateGameUnified}
                disabled={
                  isGenerating ||
                  isIngesting ||
                  (!urls.some(u => u.trim()) && files.length === 0 && !topicFocus.trim() && ingestedSources.length === 0)
                }
                style={{
                  width: '100%',
                  backgroundColor: 'var(--primary)',
                  color: 'var(--primary-ink)',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.75rem 1.25rem',
                  fontSize: '0.92rem',
                  fontWeight: 900,
                  cursor:
                    isGenerating ||
                    isIngesting ||
                    (!urls.some(u => u.trim()) && files.length === 0 && !topicFocus.trim() && ingestedSources.length === 0)
                      ? 'not-allowed'
                      : 'pointer',
                  opacity:
                    isGenerating ||
                    isIngesting ||
                    (!urls.some(u => u.trim()) && files.length === 0 && !topicFocus.trim() && ingestedSources.length === 0)
                      ? 0.6
                      : 1,
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

                  {/* Phân bổ loại câu hỏi nếu là MIXED */}
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
                      title="Lưu vào Kho Game ở trạng thái Bản nháp"
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
