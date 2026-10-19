import React, { useEffect, useRef, useState } from 'react';
import { useToast } from '../components/ToastContext.js';
import {
  advancePracticeSession,
  createPracticeSession,
  createRoom,
  downloadGameExport,
  downloadSessionExport,
  fetchRoomQr,
  generateGame,
  ingestSources,
  saveEditedQuestions,
  startPracticeSession,
  submitPracticeAnswer,
} from '../services/api.js';
import type {
  Difficulty,
  GameQuestion,
  GameSpecification,
  GameType,
  IngestedSource,
  PracticeFinalResult,
  PracticeQuestionResult,
  ProvenanceReference,
  QuestionType,
  SanitizedQuestion,
  ScoringMode,
} from '../types/index.js';

interface DemoPageProps {
  onNavigateToHost?: (roomCode: string, hostToken: string) => void;
  onNavigateToPlay?: (roomCode: string) => void;
  initialSpec?: GameSpecification | null;
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
    const normalizedTexts = q.choices.map(c =>
      c.replace(/^[A-Da-d0-9][\.\)]\s*/, '').trim().toLowerCase()
    );
    if (new Set(normalizedTexts).size !== 4) {
      return '4 lựa chọn A, B, C, D phải khác nhau (không được trùng lặp).';
    }
    const cleanAns = q.correctAnswer.trim().toLowerCase();
    const matchesChoice = q.choices.some(c => {
      const lower = c.trim().toLowerCase();
      return (
        lower === cleanAns ||
        lower.startsWith(`${cleanAns}.`) ||
        lower.startsWith(`${cleanAns})`) ||
        cleanAns.startsWith(lower)
      );
    });
    if (!matchesChoice) {
      return `Đáp án đúng "${q.correctAnswer}" phải khớp với một trong 4 lựa chọn A, B, C, D.`;
    }
  }

  if (q.type === 'QUICK_BUTTON') {
    if (!q.choices || q.choices.length !== 2 || q.choices[0] !== 'Đúng' || q.choices[1] !== 'Sai') {
      return 'Câu hỏi Đúng/Sai phải có đúng 2 lựa chọn ["Đúng", "Sai"].';
    }
    if (q.correctAnswer !== 'Đúng' && q.correctAnswer !== 'Sai') {
      return 'Đáp án câu Đúng/Sai phải là "Đúng" hoặc "Sai".';
    }
  }

  if (q.type === 'CROSSWORD') {
    const word = normalizeCrosswordAscii(q.crosswordAnswer || q.correctAnswer);
    if (!/^[A-Z0-9]+$/.test(word)) {
      return 'Từ khóa Ô chữ phải chỉ gồm chữ cái và chữ số (không chứa ký tự đặc biệt).';
    }
  }

  return null;
};

export const DemoPage: React.FC<DemoPageProps> = ({
  onNavigateToHost,
  onNavigateToPlay,
  initialSpec,
}) => {
  const toast = useToast();

  // Multi-source state (Batch 4 & Batch 8)
  const [urls, setUrls] = useState<string[]>(['']);
  const [files, setFiles] = useState<File[]>([]);

  // AI configuration state (Batch 4 & Batch 5)
  const [gameType, setGameType] = useState<GameType>('MULTIPLE_CHOICE');
  const [difficulty, setDifficulty] = useState<Difficulty>('MEDIUM');
  const [scoringMode, setScoringMode] = useState<ScoringMode>('STANDARD');
  const [questionCount, setQuestionCount] = useState(5);
  const [timePerQuestion, setTimePerQuestion] = useState(20);
  const [topicFocus, setTopicFocus] = useState('');
  const [selectedSections, setSelectedSections] = useState<string[]>([]);

  const [ingestedSources, setIngestedSources] = useState<IngestedSource[]>([]);
  const [generatedSpec, setGeneratedSpec] = useState<GameSpecification | null>(null);
  const [editingQuestionIdx, setEditingQuestionIdx] = useState<number | null>(null);

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  const [roomCode, setRoomCode] = useState('');
  const [hostToken, setHostToken] = useState('');
  const [joinUrl, setJoinUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');

  const [isIngesting, setIsIngesting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  // Single-Player Practice Mode state (Batch 7)
  const [isPracticeOpen, setIsPracticeOpen] = useState(false);
  const [practiceSessionId, setPracticeSessionId] = useState<string | null>(null);
  const [practiceQuestion, setPracticeQuestion] = useState<SanitizedQuestion | null>(null);
  const [practiceAnswerInput, setPracticeAnswerInput] = useState('');
  const [practiceFeedback, setPracticeFeedback] = useState<PracticeQuestionResult | null>(null);
  const [practiceFinalResult, setPracticeFinalResult] = useState<PracticeFinalResult | null>(null);
  const [practiceScore, setPracticeScore] = useState(0);
  const [practiceStreak, setPracticeStreak] = useState(0);
  const [practiceTimeLeft, setPracticeTimeLeft] = useState(0);
  const [isSubmittingPractice, setIsSubmittingPractice] = useState(false);
  const practiceTimerRef = useRef<number | null>(null);

  const stopPracticeTimer = () => {
    if (practiceTimerRef.current) {
      window.clearInterval(practiceTimerRef.current);
      practiceTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopPracticeTimer();
    };
  }, []);

  useEffect(() => {
    if (initialSpec) {
      setGeneratedSpec(initialSpec);
      setGameType(initialSpec.gameType);
      setScoringMode(initialSpec.settings.scoringMode);
      setTimePerQuestion(initialSpec.settings.timePerQuestion);
      setQuestionCount(initialSpec.questions.length);
      setEditingQuestionIdx(null);
      setRoomCode('');
      setCurrentStep(3);
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
      setCurrentStep(2);
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
      toast.error('Vui lòng hoàn thành bước 1 (Nhập nội dung nguồn) trước.', 'Chưa có nội dung');
      return null;
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
      });

      toast.removeToast(toastId);
      setGeneratedSpec(spec);
      setEditingQuestionIdx(null);
      setRoomCode('');
      toast.success(
        `Đã tạo thành công bộ câu hỏi "${spec.title}" (${spec.questions.length} câu).`,
        'Tạo trò chơi thành công'
      );
      setCurrentStep(3);
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
    }
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

  const handleSaveSpecEdits = async () => {
    if (!generatedSpec || !validateSpecBeforeLaunch(generatedSpec)) {
      return;
    }
    try {
      const saved = await saveEditedQuestions(generatedSpec.gameId, {
        title: generatedSpec.title,
        description: generatedSpec.description,
        questions: generatedSpec.questions,
      });
      setGeneratedSpec(saved);
      setEditingQuestionIdx(null);
      toast.success('Đã lưu bộ câu hỏi vào cơ sở dữ liệu thành công!', 'Đã lưu');
    } catch (err: any) {
      toast.error(err.message || 'Không thể lưu chỉnh sửa câu hỏi.', 'Lỗi lưu');
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

  const handleExportCurrentSession = async (format: 'csv' | 'json') => {
    const sid = practiceFinalResult?.sessionId || practiceSessionId;
    if (!sid) return;
    try {
      await downloadSessionExport(sid, format);
      toast.success(`Đã xuất kết quả luyện tập định dạng ${format.toUpperCase()}`, 'Xuất thành công');
    } catch (err: any) {
      toast.error(err.message || 'Không thể xuất kết quả luyện tập.', 'Lỗi xuất dữ liệu');
    }
  };

  // ==========================================
  // Single-Player Practice Mode Handlers (Batch 7)
  // ==========================================

  const startPracticeCountdown = (seconds: number, sessionId: string) => {
    stopPracticeTimer();
    setPracticeTimeLeft(seconds);
    practiceTimerRef.current = window.setInterval(() => {
      setPracticeTimeLeft(prev => {
        if (prev <= 1) {
          stopPracticeTimer();
          // Trigger timeout state on active question
          setPracticeFeedback({
            questionId: 'timeout',
            answer: '(Hết thời gian)',
            isCorrect: false,
            pointsEarned: 0,
            responseTimeMs: seconds * 1000,
            answeredAt: new Date().toISOString(),
            correctAnswer: 'Đã hết thời gian trả lời câu hỏi này',
            explanation: 'Hãy bấm "Câu tiếp theo" để tiếp tục bài luyện tập.',
          });
          setPracticeStreak(0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleStartPractice = async () => {
    if (!generatedSpec || !validateSpecBeforeLaunch(generatedSpec)) {
      return;
    }

    const specToPlay: GameSpecification = {
      ...generatedSpec,
      settings: {
        ...generatedSpec.settings,
        questionCount: generatedSpec.questions.length,
        scoringMode,
        timePerQuestion,
      },
    };

    try {
      const created = await createPracticeSession({
        gameId: specToPlay.gameId,
        gameSpecification: specToPlay,
      });
      const started = await startPracticeSession(created.sessionId);

      setPracticeSessionId(created.sessionId);
      setPracticeQuestion(started.question);
      setPracticeAnswerInput('');
      setPracticeFeedback(null);
      setPracticeFinalResult(null);
      setPracticeScore(0);
      setPracticeStreak(0);
      setIsPracticeOpen(true);
      startPracticeCountdown(started.question.timePerQuestion || timePerQuestion, created.sessionId);
    } catch (err: any) {
      toast.error(err.message || 'Không thể khởi tạo chế độ luyện tập cá nhân.', 'Lỗi luyện tập');
    }
  };

  const handleSubmitPracticeAnswer = async (chosenAnswer: string) => {
    if (!practiceSessionId || !practiceQuestion || practiceFeedback || isSubmittingPractice) {
      return;
    }
    const clean = chosenAnswer.trim();
    if (!clean) {
      toast.warning('Vui lòng nhập hoặc chọn câu trả lời.', 'Chưa có câu trả lời');
      return;
    }

    setIsSubmittingPractice(true);
    stopPracticeTimer();

    try {
      const result = await submitPracticeAnswer(practiceSessionId, {
        questionId: practiceQuestion.id,
        answer: clean,
      });

      setPracticeFeedback(result);
      setPracticeScore(prev => prev + result.pointsEarned);
      setPracticeStreak(prev => (result.isCorrect ? prev + 1 : 0));
    } catch (err: any) {
      if (err.code === 'ANSWER_TIMEOUT') {
        setPracticeFeedback({
          questionId: practiceQuestion.id,
          answer: clean,
          isCorrect: false,
          pointsEarned: 0,
          responseTimeMs: practiceQuestion.timePerQuestion * 1000,
          answeredAt: new Date().toISOString(),
          correctAnswer: 'Hết giờ',
          explanation: 'Câu trả lời được gửi sau khi hết thời gian quy định.',
        });
        setPracticeStreak(0);
      } else {
        toast.error(err.message || 'Không thể gửi câu trả lời.', 'Lỗi');
      }
    } finally {
      setIsSubmittingPractice(false);
    }
  };

  const handleAdvancePractice = async () => {
    if (!practiceSessionId) return;

    try {
      const adv = await advancePracticeSession(practiceSessionId);
      if (adv.nextQuestionAvailable && adv.question) {
        setPracticeQuestion(adv.question);
        setPracticeAnswerInput('');
        setPracticeFeedback(null);
        startPracticeCountdown(adv.question.timePerQuestion || timePerQuestion, practiceSessionId);
      } else if (adv.finished && adv.result) {
        stopPracticeTimer();
        setPracticeQuestion(null);
        setPracticeFeedback(null);
        setPracticeFinalResult(adv.result);
      }
    } catch (err: any) {
      toast.error(err.message || 'Không thể chuyển sang câu tiếp theo.', 'Lỗi');
    }
  };

  const handleClosePractice = () => {
    stopPracticeTimer();
    setIsPracticeOpen(false);
    setPracticeSessionId(null);
    setPracticeQuestion(null);
    setPracticeFeedback(null);
    setPracticeFinalResult(null);
  };

  const handleCopyLink = () => {
    if (!joinUrl) return;
    navigator.clipboard.writeText(joinUrl);
    toast.success('Đã sao chép liên kết tham gia vào bộ nhớ tạm!', 'Đã sao chép');
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

      {/* THANH TIẾN TRÌNH STEPPER 3 BƯỚC */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '0.85rem',
          marginBottom: '2rem',
        }}
      >
        {/* Bước 1 Stepper Button */}
        <button
          type="button"
          onClick={() => setCurrentStep(1)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.85rem',
            padding: '0.9rem 1.1rem',
            borderRadius: '12px',
            border: currentStep === 1 ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
            backgroundColor: currentStep === 1 ? 'var(--bg-card-hover)' : 'var(--bg-surface)',
            boxShadow: currentStep === 1 ? 'var(--card-shadow)' : 'none',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.15s ease',
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor:
                ingestedSources.length > 0
                  ? 'var(--accent-emerald)'
                  : currentStep === 1
                    ? 'var(--primary)'
                    : 'var(--border-strong)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1rem',
              fontWeight: 900,
              flexShrink: 0,
            }}
          >
            {ingestedSources.length > 0 ? '✓' : '1'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Nguồn Nội Dung
            </div>
            <div
              style={{
                fontSize: '0.75rem',
                color: ingestedSources.length > 0 ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                fontWeight: 600,
              }}
            >
              {ingestedSources.length > 0 ? `Đã nạp ${ingestedSources.length} nguồn` : 'Chưa có dữ liệu'}
            </div>
          </div>
        </button>

        {/* Bước 2 Stepper Button */}
        <button
          type="button"
          onClick={() => setCurrentStep(2)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.85rem',
            padding: '0.9rem 1.1rem',
            borderRadius: '12px',
            border: currentStep === 2 ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
            backgroundColor: currentStep === 2 ? 'var(--bg-card-hover)' : 'var(--bg-surface)',
            boxShadow: currentStep === 2 ? 'var(--card-shadow)' : 'none',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.15s ease',
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: generatedSpec
                ? 'var(--accent-emerald)'
                : currentStep === 2
                  ? 'var(--primary)'
                  : 'var(--border-strong)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1rem',
              fontWeight: 900,
              flexShrink: 0,
            }}
          >
            {generatedSpec ? '✓' : '2'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Cấu Hình AI
            </div>
            <div
              style={{
                fontSize: '0.75rem',
                color: generatedSpec ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                fontWeight: 600,
              }}
            >
              {generatedSpec ? `${generatedSpec.questions.length} câu hỏi sẵn sàng` : 'Chưa tạo câu hỏi'}
            </div>
          </div>
        </button>

        {/* Bước 3 Stepper Button */}
        <button
          type="button"
          onClick={() => setCurrentStep(3)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.85rem',
            padding: '0.9rem 1.1rem',
            borderRadius: '12px',
            border: currentStep === 3 ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
            backgroundColor: currentStep === 3 ? 'var(--bg-card-hover)' : 'var(--bg-surface)',
            boxShadow: currentStep === 3 ? 'var(--card-shadow)' : 'none',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.15s ease',
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: roomCode
                ? 'var(--accent-emerald)'
                : currentStep === 3
                  ? 'var(--primary)'
                  : 'var(--border-strong)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1rem',
              fontWeight: 900,
              flexShrink: 0,
            }}
          >
            {roomCode ? '✓' : '3'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Thi Đấu & Luyện Tập
            </div>
            <div
              style={{
                fontSize: '0.75rem',
                color: roomCode ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                fontWeight: 600,
              }}
            >
              {roomCode ? `Phòng [${roomCode}]` : 'Tạo phòng QR hoặc Chơi thử'}
            </div>
          </div>
        </button>
      </div>

      {/* ===================== CHẾ ĐỘ LUYỆN TẬP CÁ NHÂN (BATCH 7) ===================== */}
      {isPracticeOpen && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '2px solid var(--accent-sky)',
            borderRadius: '18px',
            padding: '1.75rem',
            marginBottom: '2rem',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid var(--border-subtle)',
              paddingBottom: '1rem',
              marginBottom: '1.25rem',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}
          >
            <div>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  color: 'var(--accent-sky)',
                  letterSpacing: '0.06em',
                }}
              >
                🎮 Chế Độ Luyện Tập Cá Nhân • {formatScoringModeLabel(scoringMode)}
              </span>
              <h2 style={{ margin: '0.2rem 0 0 0', color: 'var(--text-primary)', fontSize: '1.35rem', fontWeight: 900 }}>
                {generatedSpec?.title}
              </h2>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div
                style={{
                  backgroundColor: 'var(--bg-input)',
                  padding: '0.45rem 0.85rem',
                  borderRadius: '10px',
                  border: '1px solid var(--border-strong)',
                  fontWeight: 800,
                  color: 'var(--accent-emerald)',
                  fontSize: '0.9rem',
                }}
              >
                Điểm: {practiceScore} {practiceStreak > 1 ? `🔥 x${practiceStreak}` : ''}
              </div>
              <button
                type="button"
                onClick={handleClosePractice}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0.45rem 0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✕ Đóng luyện tập
              </button>
            </div>
          </div>

          {/* Đang làm câu hỏi */}
          {practiceQuestion && (
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1rem',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                <span style={{ fontWeight: 800, color: 'var(--accent-sky)', fontSize: '0.95rem' }}>
                  Câu hỏi {practiceQuestion.questionIndex + 1} / {practiceQuestion.totalQuestions}
                </span>
                <span
                  style={{
                    fontWeight: 900,
                    fontSize: '1rem',
                    color: practiceTimeLeft <= 5 ? 'var(--accent-rose)' : 'var(--accent-amber)',
                    backgroundColor: 'var(--bg-input)',
                    padding: '0.35rem 0.85rem',
                    borderRadius: '999px',
                    border: '1px solid var(--border-strong)',
                  }}
                >
                  ⏱️ {practiceTimeLeft}s
                </span>
              </div>

              <div
                style={{
                  padding: '1.25rem',
                  backgroundColor: 'var(--bg-input)',
                  borderRadius: '12px',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '1.15rem',
                  fontWeight: 800,
                  color: 'var(--text-primary)',
                  marginBottom: '1.25rem',
                }}
              >
                {practiceQuestion.question}
                {practiceQuestion.crosswordClue && (
                  <div style={{ marginTop: '0.6rem', fontSize: '0.95rem', color: 'var(--accent-sky)', fontWeight: 600 }}>
                    💡 Gợi ý ô chữ: {practiceQuestion.crosswordClue}
                  </div>
                )}
              </div>

              {/* Lựa chọn cho MULTIPLE_CHOICE hoặc QUICK_BUTTON */}
              {(practiceQuestion.type === 'MULTIPLE_CHOICE' || practiceQuestion.type === 'QUICK_BUTTON') &&
                practiceQuestion.choices && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                      gap: '0.75rem',
                      marginBottom: '1.25rem',
                    }}
                  >
                    {practiceQuestion.choices.map((choice, idx) => (
                      <button
                        key={idx}
                        type="button"
                        disabled={Boolean(practiceFeedback) || isSubmittingPractice}
                        onClick={() => handleSubmitPracticeAnswer(choice)}
                        style={{
                          padding: '0.95rem 1.15rem',
                          borderRadius: '12px',
                          border:
                            practiceFeedback?.answer === choice
                              ? `2px solid ${practiceFeedback.isCorrect ? 'var(--accent-emerald)' : 'var(--accent-rose)'}`
                              : '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-card)',
                          color: 'var(--text-primary)',
                          fontWeight: 700,
                          fontSize: '0.95rem',
                          textAlign: 'left',
                          cursor: practiceFeedback ? 'default' : 'pointer',
                        }}
                      >
                        {choice}
                      </button>
                    ))}
                  </div>
                )}

              {/* Ô nhập cho FILL_IN_THE_BLANK hoặc CROSSWORD */}
              {(practiceQuestion.type === 'FILL_IN_THE_BLANK' || practiceQuestion.type === 'CROSSWORD') &&
                !practiceFeedback && (
                  <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      value={practiceAnswerInput}
                      onChange={e =>
                        setPracticeAnswerInput(
                          practiceQuestion.type === 'CROSSWORD'
                            ? normalizeCrosswordAscii(e.target.value)
                            : e.target.value
                        )
                      }
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          handleSubmitPracticeAnswer(practiceAnswerInput);
                        }
                      }}
                      placeholder={
                        practiceQuestion.type === 'CROSSWORD'
                          ? 'Nhập từ khóa IN HOA KHÔNG DẤU (VD: DONGCO)...'
                          : 'Nhập câu trả lời của bạn...'
                      }
                      style={{
                        flex: '1 1 260px',
                        padding: '0.85rem 1rem',
                        backgroundColor: 'var(--bg-input)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        fontSize: '1rem',
                        fontWeight: 700,
                      }}
                    />
                    <button
                      type="button"
                      disabled={isSubmittingPractice}
                      onClick={() => handleSubmitPracticeAnswer(practiceAnswerInput)}
                      style={{
                        backgroundColor: 'var(--primary)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '10px',
                        padding: '0.85rem 1.5rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      Gửi đáp án
                    </button>
                  </div>
                )}

              {/* Phản hồi kết quả sau mỗi câu */}
              {practiceFeedback && (
                <div
                  style={{
                    padding: '1.15rem',
                    borderRadius: '12px',
                    backgroundColor: practiceFeedback.isCorrect
                      ? 'rgba(16, 185, 129, 0.12)'
                      : 'rgba(244, 63, 94, 0.12)',
                    border: `1px solid ${
                      practiceFeedback.isCorrect ? 'var(--accent-emerald)' : 'var(--accent-rose)'
                    }`,
                    marginTop: '0.75rem',
                  }}
                >
                  <div
                    style={{
                      fontWeight: 900,
                      fontSize: '1.05rem',
                      color: practiceFeedback.isCorrect ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                      marginBottom: '0.4rem',
                    }}
                  >
                    {practiceFeedback.isCorrect
                      ? `✓ Chính xác! (+${practiceFeedback.pointsEarned} điểm)`
                      : `✗ Chưa chính xác • Đáp án đúng: ${practiceFeedback.correctAnswer}`}
                  </div>

                  {practiceFeedback.explanation && (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.45rem' }}>
                      💡 <strong>Giải thích:</strong> {practiceFeedback.explanation}
                    </div>
                  )}

                  {practiceFeedback.sourceReference && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>
                      📌 Nguồn trích dẫn: {formatProvenanceBadge(practiceFeedback.sourceReference)}
                    </div>
                  )}

                  <div style={{ marginTop: '1rem' }}>
                    <button
                      type="button"
                      onClick={handleAdvancePractice}
                      style={{
                        backgroundColor: 'var(--primary)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '10px',
                        padding: '0.75rem 1.5rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {practiceQuestion.questionIndex + 1 < practiceQuestion.totalQuestions
                        ? 'Câu hỏi tiếp theo →'
                        : 'Xem kết quả tổng kết 🏆'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Màn hình Tổng kết Luyện tập */}
          {practiceFinalResult && (
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.4rem' }}>🎉</div>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.6rem', color: 'var(--text-primary)', fontWeight: 900 }}>
                Hoàn Thành Phiên Luyện Tập!
              </h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: '0.85rem',
                  margin: '1.25rem 0',
                }}
              >
                <div style={{ backgroundColor: 'var(--bg-input)', padding: '1rem', borderRadius: '12px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700 }}>TỔNG ĐIỂM</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--accent-emerald)' }}>
                    {practiceFinalResult.totalScore ?? practiceFinalResult.score ?? 0} / {practiceFinalResult.maxPossibleScore}
                  </div>
                </div>
                <div style={{ backgroundColor: 'var(--bg-input)', padding: '1rem', borderRadius: '12px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700 }}>ĐỘ CHÍNH XÁC</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--accent-sky)' }}>
                    {practiceFinalResult.accuracy ??
                      (practiceFinalResult.totalQuestions > 0
                        ? Math.round(
                            ((practiceFinalResult.correctAnswers ?? practiceFinalResult.correctCount ?? 0) /
                              practiceFinalResult.totalQuestions) *
                              100
                          )
                        : 0)}
                    % ({practiceFinalResult.correctAnswers ?? practiceFinalResult.correctCount ?? 0}/
                    {practiceFinalResult.totalQuestions})
                  </div>
                </div>
                <div style={{ backgroundColor: 'var(--bg-input)', padding: '1rem', borderRadius: '12px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700 }}>CHUỖI ĐÚNG TỐI ĐA</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--accent-amber)' }}>
                    🔥 {practiceFinalResult.maxStreak ?? practiceFinalResult.streak ?? 0}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleStartPractice}
                  style={{
                    backgroundColor: 'var(--primary)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '0.8rem 1.4rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  🔄 Luyện tập lại
                </button>
                <button
                  type="button"
                  onClick={() => handleExportCurrentSession('csv')}
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--accent-emerald)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '10px',
                    padding: '0.8rem 1.2rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  ⬇ Xuất kết quả CSV
                </button>
                <button
                  type="button"
                  onClick={() => handleExportCurrentSession('json')}
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--accent-sky)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '10px',
                    padding: '0.8rem 1.2rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  ⬇ Xuất kết quả JSON
                </button>
                <button
                  type="button"
                  onClick={handleClosePractice}
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '10px',
                    padding: '0.8rem 1.4rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Quay lại bảng điều khiển
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* NỘI DUNG TỪNG BƯỚC */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* ===================== BƯỚC 1: NGUỒN NỘI DUNG (MULTI-URL & MULTI-FILE) ===================== */}
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
                Nguồn nội dung (Hỗ trợ tối đa {MAX_URLS} URL & {MAX_FILES} tệp)
              </h2>
            </div>

            {/* Danh sách nhiều URL */}
            <div style={{ marginBottom: '1.25rem', marginTop: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                <label style={{ color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700 }}>
                  🌐 Địa chỉ Website ({urls.filter(u => u.trim()).length}/{MAX_URLS}):
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
                      padding: '0.3rem 0.75rem',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    + Thêm URL
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                {urls.map((u, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
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
                        }}
                        title="Xóa URL này"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Tải lên nhiều tệp tài liệu (DOCX, XLSX, PDF, TXT, MD, CSV) */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                📁 Hoặc tải lên tệp tài liệu (DOCX, XLSX, PDF, TXT, MD, CSV — tối đa {MAX_FILES} tệp, mỗi tệp ≤ 10MB):
              </label>
              <input
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
                      <span>📄 {f.name}</span>
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
                          padding: 0,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
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
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: isIngesting ? 'none' : 'var(--btn-shadow)',
                  transition: 'all 0.15s ease',
                }}
              >
                {isIngesting ? '⏳ Đang trích xuất nội dung...' : 'Trích xuất nội dung ⚡'}
              </button>

              {ingestedSources.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  style={{
                    padding: '0.85rem 1.5rem',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '10px',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                  }}
                >
                  Tiếp tục (Bước 2) &rarr;
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
                    <div>
                      <strong>✓ {src.sourceName}</strong>{' '}
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

        {/* ===================== BƯỚC 2: CẤU HÌNH & TẠO GAME AI ===================== */}
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
                Cấu hình câu hỏi & chế độ tính điểm AI
              </h2>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginTop: '1.25rem', marginBottom: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                  Hình thức thi đấu:
                </label>
                <select
                  value={gameType}
                  onChange={e => setGameType(e.target.value as GameType)}
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
                  }}
                >
                  <option value="MULTIPLE_CHOICE">🎯 Trắc nghiệm ABCD</option>
                  <option value="FILL_IN_THE_BLANK">✍️ Điền từ vào chỗ trống</option>
                  <option value="QUICK_BUTTON">⚡ Nút bấm nhanh Đúng / Sai</option>
                  <option value="CROSSWORD">🧩 Ô chữ giải đố</option>
                  <option value="MIXED">🎲 Hỗn hợp (Trắc nghiệm + Điền từ + Đúng/Sai + Ô chữ)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                  Chế độ tính điểm (Scoring Mode):
                </label>
                <select
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
                  }}
                >
                  <option value="STANDARD">🏅 STANDARD — Điểm chuẩn (100đ cố định/câu)</option>
                  <option value="SPEED_BONUS">⚡ SPEED_BONUS — Thưởng tốc độ trả lời (+50đ tối đa)</option>
                  <option value="STREAK">🔥 STREAK — Thưởng chuỗi trả lời đúng liên tiếp</option>
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
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                  Số lượng câu hỏi (1 - 20):
                </label>
                <input
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
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                  Thời gian mỗi câu (5 - 120 giây):
                </label>
                <div style={{ position: 'relative' }}>
                  <input
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

            {/* Trọng tâm nội dung / Phạm vi phân đoạn (Batch 5) */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.45rem' }}>
                🎯 Chủ đề hoặc phạm vi nội dung trọng tâm (Tùy chọn):
              </label>
              <input
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
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: isGenerating || ingestedSources.length === 0 ? 'none' : 'var(--btn-shadow)',
                  transition: 'all 0.15s ease',
                }}
              >
                {isGenerating ? '🤖 Đang tổng hợp câu hỏi AI...' : 'Tạo trò chơi AI ⚡'}
              </button>

              {generatedSpec && (
                <button
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  style={{
                    padding: '0.9rem 1.5rem',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '10px',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                  }}
                >
                  Tiếp tục (Bước 3) &rarr;
                </button>
              )}
            </div>

            {ingestedSources.length === 0 && (
              <div style={{ marginTop: '1rem', color: 'var(--accent-amber)', fontSize: '0.85rem', fontWeight: 600 }}>
                ⚠️ Vui lòng hoàn thành Bước 1 (Trích xuất nội dung nguồn) trước khi tạo câu hỏi.
              </div>
            )}
          </div>
        )}

        {/* ===================== BƯỚC 3: PHÒNG ĐẤU QR & LUYỆN TẬP CÁ NHÂN ===================== */}
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
                Tổ Chức Phòng Đấu Hoặc Luyện Tập Cá Nhân
              </h2>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.85rem', marginTop: '1.25rem' }}>
              <button
                type="button"
                onClick={() => handleCreateRoom()}
                disabled={isCreatingRoom || !generatedSpec}
                style={{
                  backgroundColor: isCreatingRoom || !generatedSpec ? 'var(--border-strong)' : 'var(--primary)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '0.95rem 1.5rem',
                  fontWeight: 900,
                  fontSize: '1rem',
                  cursor: isCreatingRoom || !generatedSpec ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: isCreatingRoom || !generatedSpec ? 'none' : 'var(--btn-shadow)',
                }}
              >
                {isCreatingRoom ? '⏳ Đang khởi tạo phòng chơi...' : 'Tạo phòng đấu nhiều người (QR) 🚀'}
              </button>

              <button
                type="button"
                onClick={handleStartPractice}
                disabled={!generatedSpec}
                style={{
                  backgroundColor: !generatedSpec ? 'var(--border-strong)' : 'var(--accent-emerald)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '0.95rem 1.5rem',
                  fontWeight: 900,
                  fontSize: '1rem',
                  cursor: !generatedSpec ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                }}
              >
                🎮 Luyện tập cá nhân (Chơi thử ngay)
              </button>
            </div>

            {!generatedSpec && (
              <div style={{ marginTop: '1rem', color: 'var(--accent-amber)', fontSize: '0.85rem', fontWeight: 600 }}>
                ⚠️ Vui lòng hoàn thành Bước 2 (Tạo trò chơi bằng AI) trước khi khởi tạo phòng.
              </div>
            )}

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
                      }}
                    >
                      📋 Sao chép liên kết
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
                    }}
                  >
                    Màn hình Host &rarr;
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
                    }}
                  >
                    Màn hình Player &rarr;
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================== TRÌNH BIÊN TẬP & CHI TIẾT BỘ CÂU HỎI (BATCH 5 & BATCH 6) ===================== */}
        {generatedSpec && (
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '16px',
              padding: '1.75rem',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 800 }}>
                📋 Bộ Câu Hỏi & Trình Biên Tập Trước Khi Chơi
              </h2>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <span
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--accent-sky)',
                    padding: '0.3rem 0.75rem',
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
                    color: 'var(--accent-amber)',
                    padding: '0.3rem 0.75rem',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    border: '1px solid var(--border-strong)',
                  }}
                >
                  {formatScoringModeLabel(scoringMode)}
                </span>
                <span
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--accent-emerald)',
                    padding: '0.3rem 0.75rem',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    border: '1px solid var(--border-strong)',
                  }}
                >
                  {generatedSpec.questions.length} câu hỏi
                </span>
                <button
                  type="button"
                  onClick={handleAddQuestion}
                  style={{
                    backgroundColor: 'var(--primary)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0.35rem 0.85rem',
                    fontSize: '0.8rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  + Thêm câu hỏi
                </button>
                <button
                  type="button"
                  onClick={handleSaveSpecEdits}
                  style={{
                    backgroundColor: 'var(--accent-emerald)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0.35rem 0.85rem',
                    fontSize: '0.8rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  💾 Lưu chỉnh sửa
                </button>
                <button
                  type="button"
                  onClick={() => handleExportCurrentGame('csv')}
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--accent-emerald)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '8px',
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  ⬇ CSV
                </button>
                <button
                  type="button"
                  onClick={() => handleExportCurrentGame('json')}
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--accent-sky)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '8px',
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  ⬇ JSON
                </button>
              </div>
            </div>

            {/* Thông báo lấy mẫu tài liệu dài hoặc lọc câu hỏi trùng/lỗi (Batch 5) */}
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
                <strong>ℹ️ Thông tin xử lý nội dung & kiểm duyệt chất lượng:</strong>
                <ul style={{ margin: '0.35rem 0 0 1.2rem', padding: 0 }}>
                  {generatedSpec.diagnostics.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Chỉnh sửa tiêu đề bộ câu hỏi */}
            <div style={{ marginBottom: '1rem' }}>
              <input
                type="text"
                value={generatedSpec.title}
                onChange={e => setGeneratedSpec({ ...generatedSpec, title: e.target.value })}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.85rem',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  color: 'var(--accent-sky)',
                  fontSize: '1.05rem',
                  fontWeight: 800,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ maxHeight: '540px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.85rem', paddingRight: '0.25rem' }}>
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
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
                      <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => setEditingQuestionIdx(isEditing ? null : idx)}
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            color: 'var(--accent-sky)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '6px',
                            padding: '0.25rem 0.6rem',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {isEditing ? '✓ Xong' : '✏️ Sửa'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteQuestion(idx)}
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            color: 'var(--accent-rose)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '6px',
                            padding: '0.25rem 0.6rem',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          🗑️ Xóa
                        </button>
                      </div>
                    </div>

                    {validationErr && (
                      <div style={{ marginTop: '0.45rem', color: 'var(--accent-rose)', fontSize: '0.8rem', fontWeight: 700 }}>
                        ⚠️ {validationErr}
                      </div>
                    )}

                    {/* Form biên tập trực tiếp (Batch 6) */}
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
                                        ? ['Đúng', 'Sai']
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
                              <option value="MULTIPLE_CHOICE">🎯 Trắc nghiệm ABCD</option>
                              <option value="FILL_IN_THE_BLANK">✍️ Điền từ vào chỗ trống</option>
                              <option value="QUICK_BUTTON">⚡ Đúng / Sai</option>
                              <option value="CROSSWORD">🧩 Ô chữ</option>
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
                            }}
                          />
                        </div>

                        {q.type === 'MULTIPLE_CHOICE' && q.choices && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem' }}>
                            {q.choices.map((choice, cIdx) => (
                              <input
                                key={cIdx}
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
                                  padding: '0.5rem 0.7rem',
                                  backgroundColor: 'var(--bg-surface)',
                                  border: '1px solid var(--border-strong)',
                                  borderRadius: '8px',
                                  color: 'var(--text-primary)',
                                  fontSize: '0.85rem',
                                }}
                              />
                            ))}
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
                                }}
                              >
                                <option value="Đúng">Đúng</option>
                                <option value="Sai">Sai</option>
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={q.correctAnswer}
                                onChange={e => {
                                  const val =
                                    q.type === 'CROSSWORD' ? normalizeCrosswordAscii(e.target.value) : e.target.value;
                                  handleUpdateQuestion(idx, prev => ({
                                    ...prev,
                                    correctAnswer: val,
                                    crosswordAnswer: prev.type === 'CROSSWORD' ? val : prev.crosswordAnswer,
                                  }));
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
                                c.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase() ||
                                c.trim().toLowerCase().startsWith(`${q.correctAnswer.trim().toLowerCase()}.`);
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
                          <div style={{ color: 'var(--accent-emerald)', fontWeight: 700 }}>
                            ✓ Đáp án đúng: {q.correctAnswer}
                          </div>
                          {q.explanation && (
                            <div style={{ color: 'var(--text-secondary)' }}>
                              💡 Giải thích: {q.explanation}
                            </div>
                          )}
                          {q.sourceReference && (
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem', fontWeight: 600 }}>
                              📌 Nguồn: {formatProvenanceBadge(q.sourceReference)}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
