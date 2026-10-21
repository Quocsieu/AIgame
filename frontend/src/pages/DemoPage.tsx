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
  initialSpec?: GameSpecification | null;
  autoStartSoloPlay?: boolean;
  onExitSoloPlay?: () => void;
  onNavigateToLibrary?: () => void;
  initialGameType?: GameType;
  onBackToHome?: () => void;
}

const MAX_URLS = 5;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

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

  // Tên game bắt buộc
  const [customGameTitle, setCustomGameTitle] = useState('');

  // Password protection state
  const [isPasswordProtected, setIsPasswordProtected] = useState(false);
  const [gamePassword, setGamePassword] = useState('');

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

  useEffect(() => {
    if (initialSpec) {
      setGeneratedSpec(initialSpec);
      setCustomGameTitle(initialSpec.title || '');
      setIsPasswordProtected(Boolean(initialSpec.passwordProtected));
      setGamePassword('');
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

    const combined = [...files];
    for (const f of selectedList) {
      if (combined.length >= MAX_FILES) {
        toast.warning(`Chỉ hỗ trợ tối đa ${MAX_FILES} tệp trong một lần tải lên.`, 'Vượt số lượng tệp');
        break;
      }
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`Tệp "${f.name}" vượt quá giới hạn 10MB.`, 'Tệp quá lớn');
        continue;
      }
      if (!combined.some(existing => existing.name === f.name && existing.size === f.size)) {
        combined.push(f);
      }
    }
    setFiles(combined);
    e.target.value = '';
  };

  const handleRemoveFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleIngest = async (): Promise<string | null> => {
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
        passwordProtected: isPasswordProtected,
        password: isPasswordProtected && gamePassword.trim() ? gamePassword.trim() : undefined,
        mixedDistribution: gameType === 'MIXED' ? mixedDistribution : undefined,
      });

      toast.removeToast(toastId);
      setGeneratedSpec(spec);
      setCustomGameTitle(spec.title);
      setEditingQuestionIdx(null);
      setRoomCode('');
      toast.success(
        `Đã tạo thành công bộ câu hỏi "${spec.title}" (${spec.questions.length} câu). Vui lòng xem trước và chỉnh sửa ở Bước 4.`,
        'Tạo trò chơi thành công'
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
        passwordProtected: isPasswordProtected,
        password: isPasswordProtected && gamePassword.trim() ? gamePassword.trim() : undefined,
        removePassword: !isPasswordProtected,
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
        label: 'Trắc nghiệm ABCD',
        sub: '4 lựa chọn, 1 đáp án',
        color: '#ef4444',
        icon: '▲',
        badge: 'ABCD',
      },
      {
        key: 'QUICK_BUTTON' as const,
        label: 'Đúng / Sai',
        sub: 'Nhận định 2 nút bấm',
        color: '#3b82f6',
        icon: '◆',
        badge: 'Đ/S',
      },
      {
        key: 'FILL_IN_THE_BLANK' as const,
        label: 'Điền vào chỗ trống',
        sub: 'Điền từ khuyết ___',
        color: '#f59e0b',
        icon: '●',
        badge: '___',
      },
      {
        key: 'CROSSWORD' as const,
        label: 'Ô chữ tiếng Việt',
        sub: 'Gợi ý & từ khóa không dấu',
        color: '#8b5cf6',
        icon: '■',
        badge: 'Ô CHỮ',
      },
    ];

    return (
      <div
        style={{
          marginTop: '1.25rem',
          marginBottom: '1.5rem',
          backgroundColor: 'var(--bg-card)',
          border: `2px solid ${isValid ? 'var(--border-subtle)' : 'var(--accent-amber)'}`,
          borderRadius: '16px',
          padding: '1.25rem',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <SparklesIcon size={18} style={{ color: 'var(--accent-sky)' }} />
              Cấu hình phân bổ tỷ lệ câu hỏi (Chế độ MIXED)
            </h4>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Điều chỉnh tỷ lệ % cho 4 dạng câu hỏi. Tổng tỷ lệ bắt buộc phải bằng chính xác 100%.
            </p>
          </div>
          <div
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: '20px',
              fontSize: '0.82rem',
              fontWeight: 800,
              backgroundColor: isValid ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: isValid ? 'var(--accent-emerald)' : 'var(--accent-rose)',
              border: `1px solid ${isValid ? 'var(--accent-emerald)' : 'var(--accent-rose)'}`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            {isValid ? (
              <>
                <CheckIcon size={14} /> Tổng: 100% (Hợp lệ)
              </>
            ) : (
              <>
                <AlertTriangleIcon size={14} /> Tổng: {total}% (Cần {100 - total > 0 ? `+${100 - total}%` : `${100 - total}%`})
              </>
            )}
          </div>
        </div>

        {/* Visual Stacked Progress Bar */}
        <div
          style={{
            height: '10px',
            borderRadius: '6px',
            backgroundColor: 'var(--bg-input)',
            display: 'flex',
            overflow: 'hidden',
            marginBottom: '1rem',
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
                  transition: 'width 0.2s ease',
                }}
                title={`${tc.label}: ${pct}%`}
              />
            );
          })}
        </div>

        {/* 4 Cards Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '0.85rem',
            marginBottom: '1rem',
          }}
        >
          {typesConfig.map(tc => {
            const currentVal = mixedDistribution[tc.key] || 0;
            const countForType = counts[tc.key] || 0;
            return (
              <div
                key={tc.key}
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: `1.5px solid ${tc.color}40`,
                  borderTop: `4px solid ${tc.color}`,
                  borderRadius: '12px',
                  padding: '0.85rem 1rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <span style={{ fontWeight: 800, fontSize: '0.88rem', color: tc.color, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span>{tc.icon}</span> {tc.label}
                  </span>
                  <span
                    style={{
                      backgroundColor: `${tc.color}15`,
                      color: tc.color,
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      padding: '0.15rem 0.45rem',
                      borderRadius: '6px',
                    }}
                  >
                    {tc.badge}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.65rem' }}>
                  {tc.sub}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.45rem' }}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={currentVal}
                    onChange={e => {
                      const val = parseInt(e.target.value, 10) || 0;
                      setMixedDistribution(prev => ({ ...prev, [tc.key]: val }));
                    }}
                    style={{
                      flex: 1,
                      accentColor: tc.color,
                      cursor: 'pointer',
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={currentVal}
                      onChange={e => {
                        const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                        setMixedDistribution(prev => ({ ...prev, [tc.key]: val }));
                      }}
                      style={{
                        width: '52px',
                        padding: '0.35rem 0.45rem',
                        borderRadius: '6px',
                        border: '1px solid var(--border-strong)',
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        fontSize: '0.85rem',
                        fontWeight: 800,
                        textAlign: 'center',
                      }}
                    />
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>%</span>
                  </div>
                </div>

                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Dự kiến: <strong style={{ color: 'var(--text-primary)' }}>{countForType} câu</strong> (trong tổng {questionCount} câu)
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick Presets */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px dashed var(--border-subtle)' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>
            Mẫu tỷ lệ nhanh:
          </span>
          <button
            type="button"
            onClick={() => setMixedDistribution({ MULTIPLE_CHOICE: 25, QUICK_BUTTON: 25, FILL_IN_THE_BLANK: 25, CROSSWORD: 25 })}
            style={{
              padding: '0.3rem 0.65rem',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-secondary)',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Đều 4 loại (25 / 25 / 25 / 25)
          </button>
          <button
            type="button"
            onClick={() => setMixedDistribution({ MULTIPLE_CHOICE: 40, QUICK_BUTTON: 20, FILL_IN_THE_BLANK: 20, CROSSWORD: 20 })}
            style={{
              padding: '0.3rem 0.65rem',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-secondary)',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Ưu tiên trắc nghiệm (40 / 20 / 20 / 20)
          </button>
          <button
            type="button"
            onClick={() => setMixedDistribution({ MULTIPLE_CHOICE: 50, QUICK_BUTTON: 50, FILL_IN_THE_BLANK: 0, CROSSWORD: 0 })}
            style={{
              padding: '0.3rem 0.65rem',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-secondary)',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Trắc nghiệm + Đúng/Sai (50 / 50 / 0 / 0)
          </button>
          <button
            type="button"
            onClick={() => setMixedDistribution({ MULTIPLE_CHOICE: 20, QUICK_BUTTON: 20, FILL_IN_THE_BLANK: 30, CROSSWORD: 30 })}
            style={{
              padding: '0.3rem 0.65rem',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-secondary)',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Ngôn ngữ & Ô chữ (20 / 20 / 30 / 30)
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto', padding: '0.5rem 0 2rem 0' }}>
      {/* Header khu vực bảng điều khiển */}
      <header style={{ marginBottom: '1.75rem', textAlign: 'center' }}>
            <h1
              style={{
                margin: 0,
                color: 'var(--text-primary)',
                fontSize: '2.25rem',
                fontWeight: 900,
                letterSpacing: '-0.03em',
              }}
            >
              Biến Nội Dung Thành Trò Chơi Tương Tác
            </h1>
          </header>

          {/* THANH TIẾN TRÌNH STEPPER 5 BƯỚC */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
              gap: '0.65rem',
              marginBottom: '2rem',
            }}
          >
        {[
          {
            step: 1 as const,
            title: 'Thể Loại Game',
            sub: formatGameTypeLabel(gameType),
            done: currentStep > 1 || ingestedSources.length > 0 || Boolean(generatedSpec),
          },
          {
            step: 2 as const,
            title: 'Nguồn Nội Dung',
            sub:
              ingestedSources.length > 0
                ? `Đã nạp ${ingestedSources.length} nguồn`
                : 'Nhập URL / Tải tệp',
            done: ingestedSources.length > 0,
          },
          {
            step: 3 as const,
            title: 'AI Tạo Câu Hỏi',
            sub: generatedSpec
              ? `Đã tạo ${generatedSpec.questions.length} câu`
              : `${questionCount} câu • ${timePerQuestion}s`,
            done: Boolean(generatedSpec),
          },
          {
            step: 4 as const,
            title: 'Xem Trước & Sửa',
            sub: generatedSpec
              ? `${generatedSpec.questions.length} câu hỏi sẵn sàng`
              : 'Chưa có câu hỏi',
            done: Boolean(generatedSpec) && currentStep > 4,
          },
          {
            step: 5 as const,
            title: 'Lưu & Xuất Bản',
            sub: generatedSpec?.isPublic
              ? 'Đã xuất bản công khai'
              : generatedSpec
                ? 'Bản nháp (Chưa xuất bản)'
                : 'Lưu nháp / Xuất bản',
            done: Boolean(generatedSpec?.isPublic),
          },
        ].map(item => (
          <button
            key={item.step}
            type="button"
            onClick={() => setCurrentStep(item.step)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.7rem',
              padding: '0.75rem 0.9rem',
              borderRadius: '12px',
              border:
                currentStep === item.step
                  ? '2px solid var(--primary)'
                  : '1px solid var(--border-subtle)',
              backgroundColor:
                currentStep === item.step ? 'var(--bg-card-hover)' : 'var(--bg-surface)',
              boxShadow: currentStep === item.step ? 'var(--card-shadow)' : 'none',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s ease',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '9px',
                backgroundColor: item.done
                  ? 'var(--accent-emerald)'
                  : currentStep === item.step
                    ? 'var(--primary)'
                    : 'var(--border-strong)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.9rem',
                fontWeight: 900,
                flexShrink: 0,
              }}
            >
              {item.done ? <CheckIcon size={16} /> : item.step}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {item.title}
              </div>
              <div
                style={{
                  fontSize: '0.72rem',
                  color: item.done ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {item.sub}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* NỘI DUNG TỪNG BƯỚC (5 BƯỚC WIZARD) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* ===================== BƯỚC 1: CHỌN THỂ LOẠI GAME & THÔNG SỐ CƠ BẢN ===================== */}
        {currentStep === 1 && (
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '16px',
              padding: '2rem',
              boxShadow: 'var(--card-shadow)',
              animation: 'popIn 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--primary)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1rem',
                  fontWeight: 800,
                }}
              >
                1
              </div>
              <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.35rem', fontWeight: 800 }}>
                Bước 1: Chọn thể loại game & thông số cơ bản
              </h2>
            </div>

            {/* Ô nhập tên game (Bắt buộc theo yêu cầu tinh gọn) */}
            <div style={{ marginTop: '1.25rem', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                <label htmlFor="demo-game-title" style={{ color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <GamepadIcon size={18} /> Tên Game (Bắt buộc) <span style={{ color: 'var(--accent-rose)' }}>*</span>
                </label>
                <span style={{ fontSize: '0.8rem', color: customGameTitle.trim().length > 100 ? 'var(--accent-rose)' : 'var(--text-muted)' }}>
                  {customGameTitle.trim().length}/100 ký tự
                </span>
              </div>
              <input
                id="demo-game-title"
                type="text"
                required
                maxLength={100}
                value={customGameTitle}
                onChange={e => setCustomGameTitle(e.target.value)}
                placeholder="VD: Kiểm tra Lịch sử 12, Đố vui An toàn Thông tin, Thử thách Khoa học..."
                style={{
                  width: '100%',
                  padding: '0.85rem 1rem',
                  backgroundColor: 'var(--bg-input)',
                  border: !customGameTitle.trim() ? '1px solid var(--accent-rose)' : '1px solid var(--border-strong)',
                  borderRadius: '10px',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  boxSizing: 'border-box',
                  minHeight: '44px',
                }}
              />
              {!customGameTitle.trim() && (
                <div style={{ fontSize: '0.78rem', color: 'var(--accent-rose)', marginTop: '0.35rem' }}>
                  * Vui lòng đặt tên game để định danh khi lưu vào kho và chia sẻ cho người chơi.
                </div>
              )}
            </div>

            {/* Tùy chọn đặt mật khẩu bảo vệ bộ câu hỏi */}
            <div
              style={{
                marginTop: '1.25rem',
                marginBottom: '1.25rem',
                padding: '1.1rem 1.25rem',
                backgroundColor: 'var(--bg-input)',
                borderRadius: '12px',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <label
                htmlFor="demo-password-protected"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: '0.92rem',
                  color: 'var(--text-primary)',
                }}
              >
                <input
                  id="demo-password-protected"
                  type="checkbox"
                  checked={isPasswordProtected}
                  onChange={(e) => setIsPasswordProtected(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <LockIcon size={16} /> Bảo vệ bộ câu hỏi bằng mật khẩu riêng (Tùy chọn)
                </span>
              </label>
              <div style={{ marginTop: '0.35rem', marginLeft: '1.85rem', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                Mặc định bộ câu hỏi không có mật khẩu (người chơi truy cập là chơi được ngay). Khi bật tùy chọn này, người chơi bắt buộc phải nhập đúng mật khẩu mới được mở xem nội dung câu hỏi và tham gia.
              </div>

              {isPasswordProtected && (
                <div style={{ marginTop: '0.85rem', marginLeft: '1.85rem' }}>
                  <label htmlFor="demo-game-password" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                    <LockIcon size={14} /> Mật khẩu riêng cho bộ câu hỏi:
                  </label>
                  <input
                    id="demo-game-password"
                    type="password"
                    value={gamePassword}
                    onChange={(e) => setGamePassword(e.target.value)}
                    placeholder="Nhập mật khẩu cho bộ câu hỏi này..."
                    style={{
                      width: '100%',
                      maxWidth: '360px',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-strong)',
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                      fontSize: '0.9rem',
                      outline: 'none',
                      minHeight: '44px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              )}
            </div>

            {/* Bộ chọn định dạng nhỏ gọn dạng Chip Segmented Kahoot-style */}
            <div style={{ marginTop: '1.25rem', marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.92rem', fontWeight: 800, marginBottom: '0.65rem' }}>
                Định dạng bộ câu hỏi (Game Type):
              </label>
              <GameTypeSelector
                selectedType={gameType}
                onSelectType={(t) => setGameType(t)}
                compact
                variant="chips"
              />
            </div>

            {gameType === 'MIXED' && renderMixedDistributionControl()}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '1rem',
                marginTop: '1.25rem',
                marginBottom: '1.25rem',
              }}
            >

              <div>
                <label htmlFor="demo-scoring-mode" style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                  Chế độ tính điểm (Scoring Mode):
                </label>
                <select
                  id="demo-scoring-mode"
                  value={scoringMode}
                  onChange={e => setScoringMode(e.target.value as ScoringMode)}
                  style={{
                    width: '100%',
                    padding: '0.85rem 1rem',
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '10px',
                    color: 'var(--text-primary)',
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    boxSizing: 'border-box',
                    minHeight: '44px',
                  }}
                >
                  <option value="STANDARD">STANDARD — Điểm chuẩn (100đ cố định/câu)</option>
                  <option value="SPEED_BONUS">SPEED_BONUS — Thưởng tốc độ trả lời (+50đ tối đa)</option>
                  <option value="STREAK">STREAK — Thưởng chuỗi trả lời đúng liên tiếp</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                Độ khó câu hỏi:
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                {(['EASY', 'MEDIUM', 'HARD'] as Difficulty[]).map(lvl => {
                  const label = lvl === 'EASY' ? 'Dễ' : lvl === 'MEDIUM' ? 'Trung bình' : 'Khó';
                  const isSelected = difficulty === lvl;
                  const activeColor =
                    lvl === 'EASY'
                      ? 'var(--accent-emerald)'
                      : lvl === 'MEDIUM'
                        ? 'var(--accent-amber)'
                        : 'var(--accent-rose)';
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setDifficulty(lvl)}
                      style={{
                        padding: '0.75rem 0.5rem',
                        borderRadius: '10px',
                        border: isSelected ? `2px solid ${activeColor}` : '1px solid var(--border-strong)',
                        backgroundColor: isSelected ? activeColor : 'var(--bg-input)',
                        color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                        fontWeight: 800,
                        fontSize: '0.95rem',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        minHeight: '44px',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <label htmlFor="demo-question-count" style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                  Số lượng câu hỏi (1 - 20):
                </label>
                <input
                  id="demo-question-count"
                  type="number"
                  min={1}
                  max={20}
                  value={questionCount}
                  onChange={e => setQuestionCount(Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 5)))}
                  style={{
                    width: '100%',
                    padding: '0.8rem 1rem',
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '10px',
                    color: 'var(--text-primary)',
                    fontSize: '1rem',
                    fontWeight: 700,
                    boxSizing: 'border-box',
                    minHeight: '44px',
                  }}
                />
              </div>
              <div>
                <label htmlFor="demo-time-per-question" style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                  Thời gian mỗi câu (5 - 120 giây):
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="demo-time-per-question"
                    type="number"
                    min={5}
                    max={120}
                    value={timePerQuestion}
                    onChange={e => setTimePerQuestion(Math.min(120, Math.max(5, parseInt(e.target.value, 10) || 20)))}
                    style={{
                      width: '100%',
                      padding: '0.8rem 2.5rem 0.8rem 1rem',
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '10px',
                      color: 'var(--text-primary)',
                      fontSize: '1rem',
                      fontWeight: 700,
                      boxSizing: 'border-box',
                      minHeight: '44px',
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      right: '0.85rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      pointerEvents: 'none',
                    }}
                  >
                    giây
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.85rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  const trimmed = customGameTitle.trim();
                  if (!trimmed) {
                    toast.error('Vui lòng nhập tên game trước khi tiếp tục.', 'Thiếu tên game');
                    return;
                  }
                  if (trimmed.length > 100) {
                    toast.error('Tên game không được vượt quá 100 ký tự.', 'Tên game quá dài');
                    return;
                  }
                  setCurrentStep(2);
                }}
                disabled={!customGameTitle.trim()}
                style={{
                  backgroundColor: !customGameTitle.trim() ? 'var(--border-subtle)' : 'var(--primary)',
                  color: !customGameTitle.trim() ? 'var(--text-muted)' : '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.85rem 1.6rem',
                  fontWeight: 800,
                  fontSize: '1rem',
                  cursor: !customGameTitle.trim() ? 'not-allowed' : 'pointer',
                  boxShadow: !customGameTitle.trim() ? 'none' : 'var(--btn-shadow)',
                  minHeight: '44px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <span>Tiếp tục: Nhập Nguồn Nội Dung (Bước 2)</span>
                <ArrowRightIcon size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ===================== BƯỚC 2: NHẬP NGUỒN NỘI DUNG (MULTI-URL & MULTI-FILE) ===================== */}
        {currentStep === 2 && (
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '16px',
              padding: '2rem',
              boxShadow: 'var(--card-shadow)',
              animation: 'popIn 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--primary)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1rem',
                  fontWeight: 800,
                }}
              >
                2
              </div>
              <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.35rem', fontWeight: 800 }}>
                Bước 2: Nhập nguồn nội dung (Hỗ trợ tối đa {MAX_URLS} URL & {MAX_FILES} tệp)
              </h2>
            </div>

            {/* Danh sách nhiều URL */}
            <div style={{ marginBottom: '1.25rem', marginTop: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                <label htmlFor="demo-url-0" style={{ color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <GlobeIcon size={18} /> Địa chỉ Website ({urls.filter(u => u.trim()).length}/{MAX_URLS}):
                </label>
                {urls.length < MAX_URLS && (
                  <button
                    type="button"
                    onClick={handleAddUrlField}
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--accent-sky)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '8px',
                      padding: '0.35rem 0.75rem',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      minHeight: '36px',
                    }}
                  >
                    <PlusIcon size={14} /> Thêm URL
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                {urls.map((u, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      id={`demo-url-${idx}`}
                      type="text"
                      value={u}
                      onChange={e => handleUrlChange(idx, e.target.value)}
                      placeholder={`https://example.com/tai-lieu-${idx + 1}`}
                      style={{
                        flex: 1,
                        padding: '0.8rem 1rem',
                        backgroundColor: 'var(--bg-input)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        fontSize: '0.95rem',
                        boxSizing: 'border-box',
                        minHeight: '44px',
                      }}
                    />
                    {urls.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveUrlField(idx)}
                        style={{
                          backgroundColor: 'var(--bg-input)',
                          color: 'var(--accent-rose)',
                          border: '1px solid var(--border-strong)',
                          borderRadius: '10px',
                          padding: '0 0.9rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          minWidth: '44px',
                          minHeight: '44px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Xóa URL này"
                        aria-label="Xóa URL này"
                      >
                        <XMarkIcon size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Tải lên nhiều tệp tài liệu (DOCX, XLSX, PDF, TXT, MD, CSV) */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label htmlFor="demo-file-input" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                <UploadIcon size={18} /> Hoặc tải lên tệp tài liệu (DOCX, XLSX, PDF, TXT, MD, CSV — tối đa {MAX_FILES} tệp, mỗi tệp ≤ 10MB):
              </label>
              <input
                id="demo-file-input"
                type="file"
                multiple
                accept=".docx,.xlsx,.pdf,.txt,.md,.markdown,.csv"
                onChange={handleFileSelect}
                style={{
                  width: '100%',
                  padding: '0.8rem 1rem',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px dashed var(--border-strong)',
                  borderRadius: '10px',
                  color: 'var(--text-secondary)',
                  fontSize: '0.9rem',
                  boxSizing: 'border-box',
                  minHeight: '44px',
                }}
              />

              {files.length > 0 && (
                <div style={{ marginTop: '0.65rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {files.map((f, idx) => (
                    <div
                      key={`${f.name}_${idx}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.35rem 0.75rem',
                        borderRadius: '8px',
                        backgroundColor: 'var(--bg-input)',
                        border: '1px solid var(--border-strong)',
                        fontSize: '0.82rem',
                        color: 'var(--text-primary)',
                        fontWeight: 600,
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <FileTextIcon size={16} /> {f.name}
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>({(f.size / 1024).toFixed(1)} KB)</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveFile(idx)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--accent-rose)',
                          fontWeight: 800,
                          cursor: 'pointer',
                          padding: '0.2rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minWidth: '32px',
                          minHeight: '32px',
                        }}
                        aria-label={`Xóa tệp ${f.name}`}
                        title={`Xóa tệp ${f.name}`}
                      >
                        <XMarkIcon size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                style={{
                  padding: '0.85rem 1.3rem',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '10px',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  minHeight: '44px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                <ArrowLeftIcon size={16} /> Quay lại Bước 1
              </button>

              <button
                type="button"
                onClick={() => handleIngest()}
                disabled={isIngesting}
                style={{
                  flex: '1 1 220px',
                  backgroundColor: isIngesting ? 'var(--border-strong)' : 'var(--primary)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.85rem 1.5rem',
                  fontWeight: 800,
                  fontSize: '1rem',
                  cursor: isIngesting ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: isIngesting ? 'none' : 'var(--btn-shadow)',
                  minHeight: '44px',
                }}
              >
                {isIngesting ? (
                  <>
                    <SpinnerIcon size={18} /> Đang trích xuất nội dung...
                  </>
                ) : (
                  <>
                    <SparklesIcon size={18} /> Trích xuất nội dung
                  </>
                )}
              </button>

              {ingestedSources.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  style={{
                    padding: '0.85rem 1.5rem',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '10px',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    minHeight: '44px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  Tiếp tục (Bước 3) <ArrowRightIcon size={16} />
                </button>
              )}
            </div>

            {ingestedSources.length > 0 && (
              <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                {ingestedSources.map(src => (
                  <div
                    key={src.sourceId}
                    style={{
                      padding: '0.85rem 1.1rem',
                      backgroundColor: 'rgba(16, 185, 129, 0.1)',
                      borderRadius: '10px',
                      border: '1px solid rgba(16, 185, 129, 0.35)',
                      color: 'var(--accent-emerald)',
                      fontSize: '0.88rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <CheckIcon size={16} />
                      <strong>{src.sourceName}</strong>{' '}
                      <span style={{ color: 'var(--text-secondary)' }}>
                        ({src.sourceType} • {(src.metadata?.characterCount || 0).toLocaleString('vi-VN')} ký tự
                        {src.sections?.length ? ` • ${src.sections.length} phân đoạn` : ''})
                      </span>
                    </div>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Mã: {src.sourceId}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===================== BƯỚC 3: AI TẠO VÀ PHÂN BỔ CÂU HỎI ===================== */}
        {currentStep === 3 && (
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '16px',
              padding: '2rem',
              boxShadow: 'var(--card-shadow)',
              animation: 'popIn 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--primary)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1rem',
                  fontWeight: 800,
                }}
              >
                3
              </div>
              <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.35rem', fontWeight: 800 }}>
                Bước 3: AI tạo và phân bổ câu hỏi từ nội dung nguồn
              </h2>
            </div>

            <div
              style={{
                marginTop: '1rem',
                marginBottom: '1.25rem',
                padding: '1rem 1.25rem',
                backgroundColor: 'var(--bg-input)',
                borderRadius: '12px',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.85rem',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--accent-sky)', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <GamepadIcon size={16} /> {formatGameTypeLabel(gameType)}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>•</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Số câu: {questionCount} câu
                </span>
                <span style={{ color: 'var(--text-muted)' }}>•</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Thời gian: {timePerQuestion}s/câu
                </span>
                <span style={{ color: 'var(--text-muted)' }}>•</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-amber)' }}>
                  {formatScoringModeLabel(scoringMode)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--accent-sky)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0.45rem 0.85rem',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  minHeight: '36px',
                }}
              >
                <PencilIcon size={14} /> Đổi thể loại / cấu hình (Bước 1)
              </button>
            </div>

            {gameType === 'MIXED' && renderMixedDistributionControl()}

            {/* Trọng tâm nội dung / Phạm vi phân đoạn (Batch 5) */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label htmlFor="demo-topic-focus" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                <SparklesIcon size={16} /> Chủ đề hoặc phạm vi nội dung trọng tâm cho AI (Tùy chọn):
              </label>
              <input
                id="demo-topic-focus"
                type="text"
                value={topicFocus}
                onChange={e => setTopicFocus(e.target.value)}
                placeholder="VD: Chu kỳ thay dầu nhớt, chính sách bảo hành, thông số kỹ thuật..."
                style={{
                  width: '100%',
                  padding: '0.8rem 1rem',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '10px',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                  boxSizing: 'border-box',
                  minHeight: '44px',
                }}
              />

              {availableSections.length > 1 && (
                <div style={{ marginTop: '0.75rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: '0.4rem' }}>
                    Lọc theo phân đoạn / trang trong tài liệu ({selectedSections.length > 0 ? `Đã chọn ${selectedSections.length}` : 'Tất cả phân đoạn'}):
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', maxHeight: '110px', overflowY: 'auto' }}>
                    {availableSections.map(sec => {
                      const active = selectedSections.includes(sec);
                      return (
                        <button
                          key={sec}
                          type="button"
                          onClick={() =>
                            setSelectedSections(prev =>
                              prev.includes(sec) ? prev.filter(s => s !== sec) : [...prev, sec]
                            )
                          }
                          style={{
                            padding: '0.3rem 0.65rem',
                            borderRadius: '999px',
                            border: active ? '1px solid var(--accent-sky)' : '1px solid var(--border-strong)',
                            backgroundColor: active ? 'rgba(56, 189, 248, 0.18)' : 'var(--bg-input)',
                            color: active ? 'var(--accent-sky)' : 'var(--text-secondary)',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {active ? '✓ ' : ''}{sec}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                style={{
                  padding: '0.9rem 1.3rem',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '10px',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  minHeight: '44px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                <ArrowLeftIcon size={16} /> Quay lại Bước 2
              </button>

              <button
                type="button"
                onClick={() => handleGenerate()}
                disabled={isGenerating || ingestedSources.length === 0}
                style={{
                  flex: '1 1 240px',
                  backgroundColor:
                    isGenerating || ingestedSources.length === 0 ? 'var(--border-strong)' : 'var(--primary)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.9rem 1.5rem',
                  fontWeight: 800,
                  fontSize: '1.05rem',
                  cursor: isGenerating || ingestedSources.length === 0 ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: isGenerating || ingestedSources.length === 0 ? 'none' : 'var(--btn-shadow)',
                  minHeight: '44px',
                }}
              >
                {isGenerating ? (
                  <>
                    <SpinnerIcon size={20} /> Đang tổng hợp câu hỏi AI...
                  </>
                ) : (
                  <>
                    <SparklesIcon size={20} /> AI Tạo & Phân Bổ Câu Hỏi
                  </>
                )}
              </button>

              {generatedSpec && (
                <button
                  type="button"
                  onClick={() => setCurrentStep(4)}
                  style={{
                    padding: '0.9rem 1.5rem',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '10px',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    minHeight: '44px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  Xem Trước & Chỉnh Sửa (Bước 4) <ArrowRightIcon size={16} />
                </button>
              )}
            </div>

            {ingestedSources.length === 0 && (
              <div style={{ marginTop: '1rem', color: 'var(--accent-amber)', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <AlertTriangleIcon size={16} /> Vui lòng hoàn thành Bước 2 (Trích xuất nội dung nguồn) trước khi yêu cầu AI tạo câu hỏi.
              </div>
            )}
          </div>
        )}

        {/* ===================== BƯỚC 4: XEM TRƯỚC VÀ CHỈNH SỬA CÂU HỎI ===================== */}
        {currentStep === 4 && (
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '16px',
              padding: '1.75rem',
              boxShadow: 'var(--card-shadow)',
              animation: 'popIn 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--primary)',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1rem',
                    fontWeight: 800,
                  }}
                >
                  4
                </div>
                <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 800 }}>
                  Bước 4: Xem trước & chỉnh sửa nội dung câu hỏi
                </h2>
              </div>

              {generatedSpec && (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--accent-sky)',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      border: '1px solid var(--border-strong)',
                    }}
                  >
                    {formatGameTypeLabel(generatedSpec.gameType)}
                  </span>
                  <span
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      color: generatedSpec.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: 800,
                      border: '1px solid var(--border-strong)',
                    }}
                  >
                    {generatedSpec.isPublic ? 'Đã xuất bản' : 'Bản nháp'}
                  </span>
                  <button
                    type="button"
                    onClick={handleAddQuestion}
                    style={{
                      backgroundColor: 'var(--primary)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '0.4rem 0.85rem',
                      fontSize: '0.82rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      minHeight: '36px',
                    }}
                  >
                    <PlusIcon size={14} /> Thêm câu hỏi
                  </button>
                  <button
                    type="button"
                    disabled={isSavingSpec}
                    onClick={() => handleSaveSpecEdits()}
                    style={{
                      backgroundColor: 'var(--accent-emerald)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '0.4rem 0.85rem',
                      fontSize: '0.82rem',
                      fontWeight: 800,
                      cursor: isSavingSpec ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      minHeight: '36px',
                    }}
                  >
                    {isSavingSpec ? (
                      <>
                        <SpinnerIcon size={14} /> Đang lưu...
                      </>
                    ) : (
                      <>
                        <CheckIcon size={14} /> Lưu nhanh
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleProceedToStep5}
                    style={{
                      backgroundColor: 'var(--primary)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '0.45rem 1.15rem',
                      fontSize: '0.85rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      minHeight: '44px',
                      boxShadow: 'var(--btn-shadow)',
                      transition: 'transform 0.12s ease, opacity 0.12s ease',
                    }}
                  >
                    <span>Tiếp tục sang Bước 5: Lưu & Xuất Bản</span>
                    <ArrowRightIcon size={16} />
                  </button>
                </div>
              )}
            </div>

            {!generatedSpec ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <p style={{ marginBottom: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                  <AlertTriangleIcon size={18} style={{ color: 'var(--accent-amber)' }} /> Chưa có bộ câu hỏi nào được tạo. Vui lòng hoàn thành Bước 2 và Bước 3 trước.
                </p>
                <button
                  type="button"
                  onClick={() => setCurrentStep(ingestedSources.length > 0 ? 3 : 2)}
                  style={{
                    backgroundColor: 'var(--primary)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '0.75rem 1.4rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    minHeight: '44px',
                  }}
                >
                  Quay lại bước tạo câu hỏi
                </button>
              </div>
            ) : (
              <>
                {generatedSpec.diagnostics && generatedSpec.diagnostics.length > 0 && (
                  <div
                    style={{
                      marginBottom: '1rem',
                      padding: '0.75rem 1rem',
                      backgroundColor: 'rgba(245, 158, 11, 0.1)',
                      border: '1px solid rgba(245, 158, 11, 0.35)',
                      borderRadius: '10px',
                      color: 'var(--accent-amber)',
                      fontSize: '0.84rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 800 }}>
                      <InfoIcon size={16} /> Thông tin xử lý nội dung & kiểm duyệt chất lượng:
                    </div>
                    <ul style={{ margin: '0.35rem 0 0 1.2rem', padding: 0 }}>
                      {generatedSpec.diagnostics.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Chỉnh sửa tiêu đề, mô tả & cài đặt */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '0.75rem',
                    marginBottom: '1rem',
                  }}
                >
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.25rem' }}>
                      Tên trò chơi / bộ câu hỏi:
                    </label>
                    <input
                      type="text"
                      value={generatedSpec.title}
                      onChange={e => {
                        setGeneratedSpec({ ...generatedSpec, title: e.target.value });
                        setCustomGameTitle(e.target.value);
                      }}
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.85rem',
                        backgroundColor: 'var(--bg-input)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '8px',
                        color: 'var(--accent-sky)',
                        fontSize: '1.05rem',
                        fontWeight: 800,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.25rem' }}>
                      Mô tả ngắn:
                    </label>
                    <input
                      type="text"
                      value={generatedSpec.description}
                      onChange={e => setGeneratedSpec({ ...generatedSpec, description: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '0.55rem 0.85rem',
                        backgroundColor: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '8px',
                        color: 'var(--text-primary)',
                        fontSize: '0.9rem',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.25rem' }}>
                      Thời gian mỗi câu (giây):
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={120}
                      value={timePerQuestion}
                      onChange={e => {
                        const val = Math.min(120, Math.max(5, parseInt(e.target.value, 10) || 20));
                        setTimePerQuestion(val);
                        setGeneratedSpec({
                          ...generatedSpec,
                          settings: { ...generatedSpec.settings, timePerQuestion: val },
                        });
                      }}
                      style={{
                        width: '100%',
                        padding: '0.55rem 0.85rem',
                        backgroundColor: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '8px',
                        color: 'var(--text-primary)',
                        fontSize: '0.9rem',
                        fontWeight: 700,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.25rem' }}>
                      Chế độ tính điểm:
                    </label>
                    <select
                      value={scoringMode}
                      onChange={e => {
                        const mode = e.target.value as ScoringMode;
                        setScoringMode(mode);
                        setGeneratedSpec({
                          ...generatedSpec,
                          settings: { ...generatedSpec.settings, scoringMode: mode },
                        });
                      }}
                      style={{
                        width: '100%',
                        padding: '0.55rem 0.85rem',
                        backgroundColor: 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '8px',
                        color: 'var(--text-primary)',
                        fontSize: '0.9rem',
                        fontWeight: 700,
                        boxSizing: 'border-box',
                      }}
                    >
                      <option value="STANDARD">STANDARD (100đ/câu)</option>
                      <option value="SPEED_BONUS">SPEED_BONUS (+Thưởng tốc độ)</option>
                      <option value="STREAK">STREAK (+Thưởng chuỗi đúng)</option>
                    </select>
                  </div>
                </div>

                {/* Danh sách câu hỏi (thêm, xóa, nhân bản, đổi thứ tự, sửa trực tiếp) */}
                <div style={{ maxHeight: '560px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.85rem', paddingRight: '0.25rem' }}>
                  {generatedSpec.questions.map((q, idx) => {
                    const isEditing = editingQuestionIdx === idx;
                    const validationErr = validateQuestionItem(q);

                    return (
                      <div
                        key={q.id || idx}
                        style={{
                          padding: '1rem 1.15rem',
                          backgroundColor: 'var(--bg-input)',
                          borderRadius: '12px',
                          border: validationErr
                            ? '1px solid var(--accent-rose)'
                            : isEditing
                              ? '1px solid var(--accent-sky)'
                              : '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
                          <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary)', display: 'flex', gap: '0.5rem', flex: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ color: 'var(--accent-sky)' }}>{idx + 1}.</span>
                            {generatedSpec.gameType === 'MIXED' && (
                              <span
                                style={{
                                  fontSize: '0.72rem',
                                  padding: '0.15rem 0.5rem',
                                  borderRadius: '6px',
                                  backgroundColor: 'var(--bg-surface)',
                                  color: 'var(--accent-amber)',
                                  border: '1px solid var(--border-strong)',
                                  fontWeight: 800,
                                }}
                              >
                                {formatGameTypeLabel(q.type)}
                              </span>
                            )}
                            <span>{q.question}</span>
                          </div>
                          <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveQuestion(idx, -1)}
                              title="Chuyển câu hỏi lên trên"
                              aria-label="Chuyển câu hỏi lên trên"
                              style={{
                                backgroundColor: 'var(--bg-surface)',
                                color: idx === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
                                border: '1px solid var(--border-strong)',
                                borderRadius: '6px',
                                padding: '0.35rem 0.6rem',
                                fontSize: '0.76rem',
                                fontWeight: 800,
                                cursor: idx === 0 ? 'not-allowed' : 'pointer',
                                opacity: idx === 0 ? 0.5 : 1,
                                minHeight: '32px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              ↑ Lên
                            </button>
                            <button
                              type="button"
                              disabled={idx === generatedSpec.questions.length - 1}
                              onClick={() => handleMoveQuestion(idx, 1)}
                              title="Chuyển câu hỏi xuống dưới"
                              aria-label="Chuyển câu hỏi xuống dưới"
                              style={{
                                backgroundColor: 'var(--bg-surface)',
                                color:
                                  idx === generatedSpec.questions.length - 1
                                    ? 'var(--text-muted)'
                                    : 'var(--text-primary)',
                                border: '1px solid var(--border-strong)',
                                borderRadius: '6px',
                                padding: '0.35rem 0.6rem',
                                fontSize: '0.76rem',
                                fontWeight: 800,
                                cursor:
                                  idx === generatedSpec.questions.length - 1 ? 'not-allowed' : 'pointer',
                                opacity: idx === generatedSpec.questions.length - 1 ? 0.5 : 1,
                                minHeight: '32px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              ↓ Xuống
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicateQuestion(idx)}
                              title="Nhân bản câu hỏi này"
                              aria-label="Nhân bản câu hỏi này"
                              style={{
                                backgroundColor: 'var(--bg-surface)',
                                color: 'var(--accent-amber)',
                                border: '1px solid var(--border-strong)',
                                borderRadius: '6px',
                                padding: '0.35rem 0.65rem',
                                fontSize: '0.76rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                minHeight: '32px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.3rem',
                              }}
                            >
                              <CopyIcon size={14} /> Nhân bản
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingQuestionIdx(isEditing ? null : idx)}
                              aria-label={isEditing ? 'Lưu chỉnh sửa câu hỏi' : 'Chỉnh sửa câu hỏi'}
                              style={{
                                backgroundColor: 'var(--bg-surface)',
                                color: 'var(--accent-sky)',
                                border: '1px solid var(--border-strong)',
                                borderRadius: '6px',
                                padding: '0.35rem 0.65rem',
                                fontSize: '0.78rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                minHeight: '32px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.3rem',
                              }}
                            >
                              {isEditing ? (
                                <>
                                  <CheckIcon size={14} /> Xong
                                </>
                              ) : (
                                <>
                                  <PencilIcon size={14} /> Sửa
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteQuestion(idx)}
                              title="Xóa câu hỏi này"
                              aria-label="Xóa câu hỏi này"
                              style={{
                                backgroundColor: 'var(--bg-surface)',
                                color: 'var(--accent-rose)',
                                border: '1px solid var(--border-strong)',
                                borderRadius: '6px',
                                padding: '0.35rem 0.65rem',
                                fontSize: '0.78rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                minHeight: '32px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.3rem',
                              }}
                            >
                              <TrashIcon size={14} /> Xóa
                            </button>
                          </div>
                        </div>

                        {validationErr && (
                          <div style={{ marginTop: '0.45rem', color: 'var(--accent-rose)', fontSize: '0.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <AlertTriangleIcon size={14} /> {validationErr}
                          </div>
                        )}

                        {isEditing ? (
                          <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                            {generatedSpec.gameType === 'MIXED' && (
                              <div>
                                <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.25rem' }}>
                                  Loại câu hỏi (chế độ Hỗn hợp):
                                </label>
                                <select
                                  value={q.type}
                                  onChange={e => {
                                    const nextType = e.target.value as QuestionType;
                                    handleUpdateQuestion(idx, prev => ({
                                      ...prev,
                                      type: nextType,
                                      choices:
                                        nextType === 'MULTIPLE_CHOICE'
                                          ? prev.choices && prev.choices.length === 4
                                            ? prev.choices
                                            : ['A. Phương án 1', 'B. Phương án 2', 'C. Phương án 3', 'D. Phương án 4']
                                          : nextType === 'QUICK_BUTTON'
                                            ? prev.choices && prev.choices.length >= 2 && prev.choices.length <= 4
                                              ? prev.choices
                                              : ['Đúng', 'Sai']
                                            : undefined,
                                      correctAnswer:
                                        nextType === 'QUICK_BUTTON'
                                          ? 'Đúng'
                                          : nextType === 'CROSSWORD'
                                            ? normalizeCrosswordAscii(prev.correctAnswer || 'TUKHOA')
                                              : prev.correctAnswer,
                                      crosswordClue: nextType === 'CROSSWORD' ? prev.crosswordClue || prev.question : undefined,
                                      crosswordAnswer:
                                        nextType === 'CROSSWORD'
                                          ? normalizeCrosswordAscii(prev.correctAnswer || 'TUKHOA')
                                          : undefined,
                                    }));
                                  }}
                                  style={{
                                    width: '100%',
                                    padding: '0.5rem 0.7rem',
                                    backgroundColor: 'var(--bg-surface)',
                                    border: '1px solid var(--border-strong)',
                                    borderRadius: '8px',
                                    color: 'var(--accent-sky)',
                                    fontWeight: 700,
                                  }}
                                >
                                  <option value="MULTIPLE_CHOICE">Trắc nghiệm ABCD</option>
                                  <option value="FILL_IN_THE_BLANK">Điền từ vào chỗ trống</option>
                                  <option value="QUICK_BUTTON">Nút bấm nhanh</option>
                                  <option value="CROSSWORD">Ô chữ</option>
                                </select>
                              </div>
                            )}
                            <div>
                              <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.25rem' }}>
                                Nội dung câu hỏi:
                              </label>
                              <input
                                type="text"
                                value={q.question}
                                onChange={e =>
                                  handleUpdateQuestion(idx, prev => ({
                                    ...prev,
                                    question: e.target.value,
                                    crosswordClue: prev.type === 'CROSSWORD' ? e.target.value : prev.crosswordClue,
                                  }))
                                }
                                style={{
                                  width: '100%',
                                  padding: '0.55rem 0.75rem',
                                  backgroundColor: 'var(--bg-surface)',
                                  border: '1px solid var(--border-strong)',
                                  borderRadius: '8px',
                                  color: 'var(--text-primary)',
                                  fontSize: '0.9rem',
                                  boxSizing: 'border-box',
                                  minHeight: '40px',
                                }}
                              />
                            </div>

                            {(q.type === 'MULTIPLE_CHOICE' || q.type === 'QUICK_BUTTON') && q.choices && (
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                  <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                                    Các lựa chọn ({q.choices.length}):
                                  </label>
                                  {q.type === 'QUICK_BUTTON' && q.choices.length < 4 && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleUpdateQuestion(idx, prev => ({
                                          ...prev,
                                          choices: [...(prev.choices || ['Đúng', 'Sai']), `Lựa chọn ${(prev.choices?.length || 2) + 1}`],
                                        }))
                                      }
                                      style={{
                                        backgroundColor: 'var(--bg-surface)',
                                        color: 'var(--accent-sky)',
                                        border: '1px solid var(--border-strong)',
                                        borderRadius: '6px',
                                        padding: '0.25rem 0.6rem',
                                        fontSize: '0.74rem',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.25rem',
                                      }}
                                    >
                                      <PlusIcon size={12} /> Thêm nút lựa chọn
                                    </button>
                                  )}
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.65rem' }}>
                                  {q.choices.map((choice, cIdx) => {
                                    const kahootStyles = [
                                      { bg: '#ef4444', label: 'A', icon: <TriangleIcon size={11} /> },
                                      { bg: '#2563eb', label: 'B', icon: <DiamondIcon size={11} /> },
                                      { bg: '#f59e0b', label: 'C', icon: <CircleShapeIcon size={11} /> },
                                      { bg: '#10b981', label: 'D', icon: <SquareShapeIcon size={11} /> },
                                    ];
                                    const badge = kahootStyles[cIdx % kahootStyles.length];
                                    return (
                                      <div key={cIdx} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                                        {q.type === 'MULTIPLE_CHOICE' && (
                                          <span
                                            style={{
                                              width: '28px',
                                              height: '28px',
                                              borderRadius: '6px',
                                              backgroundColor: badge.bg,
                                              color: '#ffffff',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              fontWeight: 800,
                                              fontSize: '0.78rem',
                                              flexShrink: 0,
                                            }}
                                            title={`Đáp án ${badge.label}`}
                                          >
                                            {badge.icon}
                                          </span>
                                        )}
                                        <input
                                          type="text"
                                          value={choice}
                                          onChange={e =>
                                            handleUpdateQuestion(idx, prev => {
                                              const nextChoices = [...(prev.choices || [])];
                                              nextChoices[cIdx] = e.target.value;
                                              return { ...prev, choices: nextChoices };
                                            })
                                          }
                                          style={{
                                            flex: 1,
                                            padding: '0.5rem 0.7rem',
                                            backgroundColor: 'var(--bg-surface)',
                                            border: '1px solid var(--border-strong)',
                                            borderRadius: '8px',
                                            color: 'var(--text-primary)',
                                            fontSize: '0.85rem',
                                            minHeight: '38px',
                                          }}
                                        />
                                        {q.type === 'QUICK_BUTTON' && q.choices && q.choices.length > 2 && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleUpdateQuestion(idx, prev => {
                                                const nextChoices = (prev.choices || []).filter((_, i) => i !== cIdx);
                                                return {
                                                  ...prev,
                                                  choices: nextChoices,
                                                  correctAnswer: nextChoices.includes(prev.correctAnswer)
                                                    ? prev.correctAnswer
                                                    : nextChoices[0] || '',
                                                };
                                              })
                                            }
                                            style={{
                                              backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                              color: 'var(--accent-rose)',
                                              border: '1px solid var(--accent-rose)',
                                              borderRadius: '6px',
                                              padding: '0.4rem 0.5rem',
                                              fontSize: '0.75rem',
                                              cursor: 'pointer',
                                            }}
                                            title="Xóa lựa chọn này"
                                          >
                                            <TrashIcon size={14} />
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem' }}>
                              <div>
                                <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.25rem' }}>
                                  Đáp án đúng:
                                </label>
                                {q.type === 'QUICK_BUTTON' ? (
                                  <select
                                    value={q.correctAnswer}
                                    onChange={e =>
                                      handleUpdateQuestion(idx, prev => ({ ...prev, correctAnswer: e.target.value }))
                                    }
                                    style={{
                                      width: '100%',
                                      padding: '0.5rem 0.7rem',
                                      backgroundColor: 'var(--bg-surface)',
                                      border: '1px solid var(--border-strong)',
                                      borderRadius: '8px',
                                      color: 'var(--accent-emerald)',
                                      fontWeight: 700,
                                      minHeight: '40px',
                                    }}
                                  >
                                    {(q.choices && q.choices.length >= 2 ? q.choices : ['Đúng', 'Sai']).map(
                                      (opt, optIdx) => (
                                        <option key={optIdx} value={opt}>
                                          {opt}
                                        </option>
                                      )
                                    )}
                                  </select>
                                ) : (
                                  <input
                                    type="text"
                                    value={q.correctAnswer}
                                    onChange={e => {
                                      const val = e.target.value;
                                      handleUpdateQuestion(idx, prev => ({
                                        ...prev,
                                        correctAnswer: val,
                                        crosswordAnswer:
                                          prev.type === 'CROSSWORD' ? normalizeCrosswordAscii(val) : prev.crosswordAnswer,
                                      }));
                                    }}
                                    onBlur={e => {
                                      if (q.type === 'CROSSWORD') {
                                        const val = normalizeCrosswordAscii(e.target.value);
                                        handleUpdateQuestion(idx, prev => ({
                                          ...prev,
                                          correctAnswer: val,
                                          crosswordAnswer: val,
                                        }));
                                      }
                                    }}
                                    style={{
                                      width: '100%',
                                      padding: '0.5rem 0.7rem',
                                      backgroundColor: 'var(--bg-surface)',
                                      border: '1px solid var(--border-strong)',
                                      borderRadius: '8px',
                                      color: 'var(--accent-emerald)',
                                      fontWeight: 700,
                                      boxSizing: 'border-box',
                                      minHeight: '40px',
                                    }}
                                  />
                                )}
                              </div>

                              <div>
                                <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.25rem' }}>
                                  Giải thích đáp án:
                                </label>
                                <input
                                  type="text"
                                  value={q.explanation || ''}
                                  onChange={e =>
                                    handleUpdateQuestion(idx, prev => ({ ...prev, explanation: e.target.value }))
                                  }
                                  style={{
                                    width: '100%',
                                    padding: '0.5rem 0.7rem',
                                    backgroundColor: 'var(--bg-surface)',
                                    border: '1px solid var(--border-strong)',
                                    borderRadius: '8px',
                                    color: 'var(--text-secondary)',
                                    fontSize: '0.85rem',
                                    boxSizing: 'border-box',
                                    minHeight: '40px',
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            {q.choices && (
                              <div style={{ marginTop: '0.6rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem' }}>
                                {q.choices.map((c, cIdx) => {
                                  const isCorrectChoice =
                                    normalizeChoiceCompare(c) === normalizeChoiceCompare(q.correctAnswer) ||
                                    stripOptionLetterPrefix(c) === stripOptionLetterPrefix(q.correctAnswer);
                                  return (
                                    <div
                                      key={cIdx}
                                      style={{
                                        padding: '0.45rem 0.75rem',
                                        backgroundColor: isCorrectChoice
                                          ? 'rgba(16, 185, 129, 0.14)'
                                          : 'var(--bg-surface)',
                                        borderRadius: '8px',
                                        border: isCorrectChoice
                                          ? '1px solid var(--accent-emerald)'
                                          : '1px solid var(--border-subtle)',
                                        color: isCorrectChoice ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                                        fontSize: '0.85rem',
                                        fontWeight: isCorrectChoice ? 800 : 600,
                                      }}
                                    >
                                      {c}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            <div style={{ marginTop: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem' }}>
                              <div style={{ color: 'var(--accent-emerald)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <CheckIcon size={16} /> Đáp án đúng: {q.correctAnswer}
                              </div>
                              {q.explanation && (
                                <div style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'flex-start', gap: '0.35rem' }}>
                                  <InfoIcon size={14} style={{ marginTop: '0.15rem' }} />
                                  <span><strong>Giải thích:</strong> {q.explanation}</span>
                                </div>
                              )}
                              {q.sourceReference && (
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem', fontWeight: 600 }}>
                                  Nguồn: {formatProvenanceBadge(q.sourceReference)}
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.35rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(3)}
                    style={{
                      padding: '0.8rem 1.25rem',
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '10px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      minHeight: '44px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                    }}
                  >
                    <ArrowLeftIcon size={16} /> Quay lại Bước 3
                  </button>

                  <button
                    type="button"
                    onClick={handleProceedToStep5}
                    style={{
                      padding: '0.9rem 1.85rem',
                      backgroundColor: 'var(--primary)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '12px',
                      fontWeight: 900,
                      fontSize: '1rem',
                      cursor: 'pointer',
                      boxShadow: 'var(--btn-shadow)',
                      minHeight: '48px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      transition: 'transform 0.12s ease, opacity 0.12s ease',
                    }}
                  >
                    <span>Tiếp tục: Xác Nhận Lưu & Xuất Bản (Bước 5)</span>
                    <ArrowRightIcon size={18} />
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ===================== BƯỚC 5: XÁC NHẬN LƯU, XUẤT BẢN & TỔ CHỨC CHƠI ===================== */}
        {currentStep === 5 && (
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '16px',
              padding: '2rem',
              boxShadow: 'var(--card-shadow)',
              animation: 'popIn 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--primary)',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1rem',
                    fontWeight: 800,
                  }}
                >
                  5
                </div>
                <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.35rem', fontWeight: 800 }}>
                  Bước 5: Xác nhận lưu, xuất bản & tổ chức chơi
                </h2>
              </div>

              {generatedSpec && (
                <span
                  style={{
                    padding: '0.4rem 0.9rem',
                    borderRadius: '999px',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                    backgroundColor: generatedSpec.isPublic
                      ? 'rgba(16, 185, 129, 0.15)'
                      : 'rgba(245, 158, 11, 0.15)',
                    color: generatedSpec.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                    border: `1px solid ${generatedSpec.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)'}`,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  {generatedSpec.isPublic ? <CheckIcon size={14} /> : <PencilIcon size={14} />}
                  {generatedSpec.isPublic ? 'ĐÃ XUẤT BẢN CÔNG KHAI' : 'BẢN NHÁP (CHƯA XUẤT BẢN)'}
                </span>
              )}
            </div>

            {!generatedSpec ? (
              <div style={{ padding: '1rem 0', color: 'var(--accent-amber)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <AlertTriangleIcon size={16} /> Chưa có bộ câu hỏi nào để lưu hoặc xuất bản. Vui lòng hoàn thành các bước trước.
              </div>
            ) : (
              <>
                <div
                  style={{
                    padding: '1.25rem',
                    backgroundColor: 'var(--bg-input)',
                    borderRadius: '12px',
                    border: '1px solid var(--border-subtle)',
                    marginBottom: '1.35rem',
                  }}
                >
                  <div style={{ fontSize: '1.15rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                    {generatedSpec.title}
                  </div>
                  <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '0.85rem' }}>
                    {generatedSpec.description}
                  </div>
                  <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, padding: '0.3rem 0.7rem', borderRadius: '8px', backgroundColor: 'var(--bg-surface)', color: 'var(--accent-sky)', border: '1px solid var(--border-strong)' }}>
                      Thể loại: {formatGameTypeLabel(generatedSpec.gameType)}
                    </span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, padding: '0.3rem 0.7rem', borderRadius: '8px', backgroundColor: 'var(--bg-surface)', color: 'var(--accent-emerald)', border: '1px solid var(--border-strong)' }}>
                      Số câu hỏi: {generatedSpec.questions.length} câu
                    </span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, padding: '0.3rem 0.7rem', borderRadius: '8px', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}>
                      Thời gian: {timePerQuestion}s / câu
                    </span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, padding: '0.3rem 0.7rem', borderRadius: '8px', backgroundColor: 'var(--bg-surface)', color: 'var(--accent-amber)', border: '1px solid var(--border-strong)' }}>
                      {formatScoringModeLabel(scoringMode)}
                    </span>
                  </div>
                </div>

                {/* ===================== LỰA CHỌN A: BẮT ĐẦU NGAY ===================== */}
                <div
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    border: '2px solid var(--primary)',
                    borderRadius: '16px',
                    padding: '1.4rem',
                    marginBottom: '1.35rem',
                    boxShadow: 'var(--card-shadow)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                    <div style={{ flex: '1 1 300px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                        <PlayIcon size={22} style={{ color: 'var(--primary)' }} />
                        <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                          Lựa chọn A: Bắt đầu ngay
                        </h3>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        Lưu trữ dữ liệu game an toàn vào hệ thống và chuyển ngay sang bước <strong>Chọn chế độ chơi</strong> (Chơi đơn hoặc Chơi nhóm Multiplayer).
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={isSavingSpec}
                      onClick={handleStartImmediately}
                      style={{
                        backgroundColor: 'var(--primary)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '12px',
                        padding: '0.9rem 1.6rem',
                        fontWeight: 900,
                        fontSize: '1rem',
                        cursor: isSavingSpec ? 'not-allowed' : 'pointer',
                        boxShadow: 'var(--btn-shadow)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.55rem',
                        minHeight: '48px',
                      }}
                    >
                      {isSavingSpec ? (
                        <>
                          <SpinnerIcon size={18} /> Đang lưu trữ...
                        </>
                      ) : (
                        <>
                          <PlayIcon size={18} /> Bắt đầu ngay & Chọn chế độ
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* ===================== LỰA CHỌN B: LƯU VÀO KHO GAME ===================== */}
                <div
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '16px',
                    padding: '1.4rem',
                    marginBottom: '1.35rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                    <BookOpenIcon size={22} style={{ color: 'var(--accent-sky)' }} />
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                      Lựa chọn B: Lưu vào kho game
                    </h3>
                  </div>
                  <p style={{ margin: '0 0 1.1rem 0', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                    Lưu bộ câu hỏi vào kho dùng chung để lưu trữ, quản lý hoặc mở lại tổ chức chơi sau này.
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.85rem', marginBottom: '1.1rem' }}>
                    <button
                      type="button"
                      disabled={isSavingSpec}
                      onClick={() => handleSaveSpecEdits(false)}
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '12px',
                        padding: '0.9rem 1.25rem',
                        fontWeight: 800,
                        fontSize: '0.94rem',
                        cursor: isSavingSpec ? 'not-allowed' : 'pointer',
                        opacity: isSavingSpec ? 0.65 : 1,
                        minHeight: '44px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.45rem',
                      }}
                    >
                      {isSavingSpec ? (
                        <>
                          <SpinnerIcon size={16} /> Đang lưu...
                        </>
                      ) : (
                        <>
                          <PencilIcon size={16} /> Lưu Bản Nháp (DRAFT)
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={isSavingSpec}
                      onClick={() => handleSaveSpecEdits(true)}
                      style={{
                        backgroundColor: 'var(--accent-emerald)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '12px',
                        padding: '0.9rem 1.25rem',
                        fontWeight: 900,
                        fontSize: '0.96rem',
                        cursor: isSavingSpec ? 'not-allowed' : 'pointer',
                        opacity: isSavingSpec ? 0.65 : 1,
                        boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
                        minHeight: '44px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.45rem',
                      }}
                    >
                      {isSavingSpec ? (
                        <>
                          <SpinnerIcon size={16} /> Đang xuất bản...
                        </>
                      ) : (
                        <>
                          <CheckIcon size={16} /> Lưu & Xuất Bản (PUBLISHED)
                        </>
                      )}
                    </button>
                  </div>

                  {/* Hành động tiếp nối sau khi lưu */}
                  <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
                    {onNavigateToLibrary && (
                      <button
                        type="button"
                        onClick={onNavigateToLibrary}
                        style={{
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--accent-sky)',
                          border: '1px solid var(--accent-sky)',
                          borderRadius: '10px',
                          padding: '0.6rem 1.15rem',
                          fontWeight: 800,
                          fontSize: '0.88rem',
                          cursor: 'pointer',
                          minHeight: '44px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                        }}
                      >
                        <BookOpenIcon size={16} /> Đi tới Kho Game
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setModeModalSpec(generatedSpec);
                        setIsModeModalOpen(true);
                      }}
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        color: 'var(--accent-emerald)',
                        border: '1px solid var(--accent-emerald)',
                        borderRadius: '10px',
                        padding: '0.6rem 1.15rem',
                        fontWeight: 800,
                        fontSize: '0.88rem',
                        cursor: 'pointer',
                        minHeight: '44px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                      }}
                    >
                      <PlayIcon size={16} /> Mở Game Chọn Chế Độ
                    </button>

                    <button
                      type="button"
                      onClick={() => setCurrentStep(4)}
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '10px',
                        padding: '0.6rem 1.15rem',
                        fontWeight: 700,
                        fontSize: '0.88rem',
                        cursor: 'pointer',
                        minHeight: '44px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                      }}
                    >
                      <PencilIcon size={16} /> Quay lại sửa câu hỏi (Bước 4)
                    </button>
                  </div>
                </div>

                {roomCode && (
                  <div
                    style={{
                      marginTop: '1.75rem',
                      padding: '1.5rem',
                      backgroundColor: 'var(--bg-input)',
                      borderRadius: '14px',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
                      <div style={{ flex: '1 1 220px' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.08em', marginBottom: '0.35rem' }}>
                          MÃ PHÒNG THI ĐẤU
                        </div>
                        <div
                          style={{
                            fontSize: '2.5rem',
                            fontWeight: 900,
                            letterSpacing: '0.15em',
                            color: 'var(--accent-sky)',
                            padding: '0.4rem 1.25rem',
                            borderRadius: '10px',
                            display: 'inline-block',
                            border: '2px dashed var(--accent-sky)',
                            backgroundColor: 'var(--bg-surface)',
                          }}
                        >
                          {roomCode}
                        </div>
                        <div style={{ margin: '1rem 0 0.5rem 0', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                          Đường dẫn tham gia:<br />
                          <span style={{ color: 'var(--accent-sky)', wordBreak: 'break-all', fontWeight: 700, fontSize: '0.95rem' }}>{joinUrl}</span>
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyLink}
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '8px',
                            padding: '0.5rem 1rem',
                            fontSize: '0.85rem',
                            cursor: 'pointer',
                            marginTop: '0.4rem',
                            fontWeight: 700,
                            minHeight: '44px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                          }}
                        >
                          <CopyIcon size={16} /> Sao chép liên kết
                        </button>
                      </div>

                      {qrDataUrl && (
                        <div style={{ textAlign: 'center' }}>
                          <div
                            style={{
                              padding: '10px',
                              backgroundColor: '#ffffff',
                              borderRadius: '12px',
                              display: 'inline-block',
                              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
                            }}
                          >
                            <img src={qrDataUrl} alt="QR Tham Gia Phòng" style={{ width: '140px', height: '140px', display: 'block' }} />
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem', fontWeight: 700 }}>
                            Quét mã QR để vào phòng
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '0.85rem', marginTop: '1.75rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (onNavigateToHost) {
                            onNavigateToHost(roomCode, hostToken);
                          } else {
                            window.open(`/?room=${roomCode}&token=${hostToken}`, '_blank');
                          }
                        }}
                        style={{
                          flex: '1 1 200px',
                          backgroundColor: 'var(--accent-emerald)',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '10px',
                          padding: '0.85rem 1.25rem',
                          fontWeight: 800,
                          fontSize: '1rem',
                          cursor: 'pointer',
                          boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)',
                          textAlign: 'center',
                          minHeight: '44px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.4rem',
                        }}
                      >
                        <span>Màn hình Host</span>
                        <ArrowRightIcon size={16} />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (onNavigateToPlay) {
                            onNavigateToPlay(roomCode);
                          } else {
                            window.open(`/?room=${roomCode}`, '_blank');
                          }
                        }}
                        style={{
                          flex: '1 1 180px',
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-strong)',
                          borderRadius: '10px',
                          padding: '0.85rem 1.25rem',
                          fontWeight: 700,
                          fontSize: '1rem',
                          cursor: 'pointer',
                          textAlign: 'center',
                          minHeight: '44px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.4rem',
                        }}
                      >
                        <span>Màn hình Player</span>
                        <ArrowRightIcon size={16} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* MODAL CHỌN CHẾ ĐỘ CHƠI (CHƠI ĐƠN VS MULTIPLAYER) */}
      <GameModeSelectionModal
        isOpen={isModeModalOpen}
        onClose={() => setIsModeModalOpen(false)}
        gameSpec={modeModalSpec || generatedSpec}
        onStartSoloPlay={(spec) => {
          setIsModeModalOpen(false);
          handleStartSoloPlay(spec);
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
