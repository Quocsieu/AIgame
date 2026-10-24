import React, { useEffect, useState } from 'react';
import { GameModeSelectionModal } from '../components/GameModeSelectionModal.js';
import { useToast } from '../components/ToastContext.js';
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  GamepadIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  QrCodeIcon,
  RefreshIcon,
  SearchIcon,
  SpinnerIcon,
  TrashIcon,
  UsersIcon,
  XMarkIcon,
} from '../components/Icons.js';
import {
  closeMultiplayerRoom,
  createRoom,
  deleteAllSavedGames,
  deleteSavedGame,
  downloadGameExport,
  endPracticeSession,
  fetchCurrentUser,
  fetchGameActiveStatus,
  fetchGameById,
  fetchGameQr,
  fetchRoomQr,
  fetchSavedGames,
  publishGame,
  saveEditedQuestions,
} from '../services/api.js';
import type {
  AuthenticatedUser,
  GameQuestion,
  GameSpecification,
  PersistedGameSummary,
  QuestionType,
  ScoringMode,
} from '../types/index.js';

interface AnalyticsPageProps {
  onSelectSavedGame?: (spec: GameSpecification, autoStartSolo?: boolean) => void;
  onNavigateToHost?: (roomCode: string, hostToken: string) => void;
  onNavigateToSoloPresentation?: (spec: GameSpecification) => void;
}

const formatGameTypeName = (type: string): string => {
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
    case 'ADVENTURE':
      return 'Đi cảnh theo ngành nghề';
    default:
      return type;
  }
};

const formatScoringModeName = (mode: string): string => {
  switch (mode) {
    case 'STANDARD':
      return 'Tiêu chuẩn (Standard)';
    case 'SPEED_BONUS':
      return 'Thưởng tốc độ (Speed Bonus)';
    case 'STREAK':
      return 'Chuỗi trả lời đúng (Streak)';
    default:
      return mode;
  }
};

const PAGE_SIZE = 12;

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({
  onSelectSavedGame,
  onNavigateToHost,
  onNavigateToSoloPresentation,
}) => {
  const toast = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [savedGames, setSavedGames] = useState<PersistedGameSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // Bộ lọc & tìm kiếm
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PUBLISHED' | 'DRAFT'>('ALL');
  const [viewLayout, setViewLayout] = useState<'grid' | 'list'>('grid');

  // Chi tiết & chỉnh sửa bộ câu hỏi đang mở
  const [activeGameSpec, setActiveGameSpec] = useState<GameSpecification | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTimePerQuestion, setEditTimePerQuestion] = useState<number>(15);
  const [editScoringMode, setEditScoringMode] = useState<ScoringMode>('SPEED_BONUS');
  const [editIsPublic, setEditIsPublic] = useState<boolean>(true);
  const [editQuestions, setEditQuestions] = useState<GameQuestion[]>([]);
  const [isSavingEdits, setIsSavingEdits] = useState(false);

  // Xác nhận xóa bộ câu hỏi
  const [confirmDeleteGame, setConfirmDeleteGame] = useState<PersistedGameSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Xác nhận xóa toàn bộ game
  const [isConfirmDeleteAllOpen, setIsConfirmDeleteAllOpen] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  const handleDeleteAllGames = async () => {
    setIsDeletingAll(true);
    try {
      const res = await deleteAllSavedGames();
      if (res.skippedActiveCount > 0) {
        toast.warning(
          `Đã xóa thành công ${res.deletedCount} bộ câu hỏi. Còn ${res.skippedActiveCount} game đang có phòng chơi hoặc phiên luyện tập hoạt động nên được giữ lại an toàn.`,
          'Hoàn tất xóa một phần'
        );
      } else {
        toast.success(
          `Đã xóa thành công toàn bộ ${res.deletedCount} bộ câu hỏi khỏi kho game.`,
          'Đã xóa tất cả'
        );
      }
      setIsConfirmDeleteAllOpen(false);
      setActiveGameSpec(null);
      setPage(1);
      await loadSavedGames(1, searchQuery, selectedTypeFilter, statusFilter);
    } catch (err: any) {
      toast.error(err.message || 'Không thể xóa danh sách bộ câu hỏi.', 'Lỗi xóa tất cả');
    } finally {
      setIsDeletingAll(false);
    }
  };

  // Modal Chia sẻ Chơi Đơn (Link + QR)
  const [soloShareData, setSoloShareData] = useState<{
    gameId: string;
    title: string;
    playUrl: string;
    qrDataUrl: string;
  } | null>(null);
  const [isLoadingSoloShare, setIsLoadingSoloShare] = useState(false);

  // Modal Mở phòng Multiplayer (Link + QR + Vào Host)
  const [multiplayerShareData, setMultiplayerShareData] = useState<{
    gameId: string;
    title: string;
    roomCode: string;
    hostToken: string;
    joinUrl: string;
    qrDataUrl: string;
  } | null>(null);
  const [isOpeningRoomGameId, setIsOpeningRoomGameId] = useState<string | null>(null);

  // Người dùng hiện tại & Modal chọn chế độ chơi (Luồng 2 & Luồng 3)
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [isModeModalOpen, setIsModeModalOpen] = useState(false);
  const [modeModalSpec, setModeModalSpec] = useState<GameSpecification | null>(null);

  // Modal Kết thúc phiên chơi đơn
  const [confirmEndSessionModal, setConfirmEndSessionModal] = useState<{
    game: PersistedGameSummary;
    sessionId: string;
  } | null>(null);
  const [isEndingSession, setIsEndingSession] = useState(false);

  // Modal Đóng phòng chơi trực tiếp
  const [confirmCloseRoomModal, setConfirmCloseRoomModal] = useState<{
    game: PersistedGameSummary;
    roomCode: string;
  } | null>(null);
  const [isClosingRoom, setIsClosingRoom] = useState(false);

  useEffect(() => {
    fetchCurrentUser()
      .then((res) => setCurrentUser(res?.user || null))
      .catch(() => setCurrentUser(null));
  }, []);

  const handleOpenModeModal = async (gameId: string) => {
    setIsDetailLoading(true);
    try {
      const spec = await fetchGameById(gameId);
      setModeModalSpec(spec);
      setIsModeModalOpen(true);
    } catch (err: any) {
      toast.error(err.message || 'Không thể mở bộ câu hỏi.', 'Lỗi tải game');
    } finally {
      setIsDetailLoading(false);
    }
  };

  const loadSavedGames = async (
    targetPage = page,
    search = searchQuery,
    gameType = selectedTypeFilter,
    status = statusFilter
  ) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const offset = (targetPage - 1) * PAGE_SIZE;
      const data = await fetchSavedGames({
        limit: PAGE_SIZE,
        offset,
        gameType: gameType !== 'ALL' ? gameType : undefined,
        search: search.trim() || undefined,
        status,
        scope: 'manage',
      });
      setSavedGames(data.games || []);
      const total = data.total ?? (data.games ? data.games.length : 0);
      setTotalCount(total);
      setHasMore(Boolean(data.hasMore ?? offset + (data.games?.length || 0) < total));
    } catch (err: any) {
      setErrorMessage(err.message || 'Không thể tải danh sách bộ câu hỏi đã tạo.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
    loadSavedGames(1, searchQuery, selectedTypeFilter, statusFilter);
  }, [selectedTypeFilter, statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadSavedGames(1, searchQuery, selectedTypeFilter, statusFilter);
  };

  const handlePageChange = (nextPage: number) => {
    if (nextPage < 1) return;
    setPage(nextPage);
    loadSavedGames(nextPage, searchQuery, selectedTypeFilter, statusFilter);
  };

  const syncEditorFromSpec = (spec: GameSpecification) => {
    setEditTitle(spec.title);
    setEditDescription(spec.description);
    setEditTimePerQuestion(spec.settings.timePerQuestion || 15);
    setEditScoringMode(spec.settings.scoringMode || 'SPEED_BONUS');
    setEditIsPublic(spec.isPublic ?? false);
    setEditQuestions(
      spec.questions.map((q) => ({
        ...q,
        choices: q.choices ? [...q.choices] : undefined,
      }))
    );
  };

  const handleViewOrEditGame = async (gameId: string, startInEditMode: boolean = false) => {
    setIsDetailLoading(true);
    try {
      const spec = await fetchGameById(gameId, { mode: 'manage' });
      setActiveGameSpec(spec);
      syncEditorFromSpec(spec);
      setIsEditMode(startInEditMode);
    } catch (err: any) {
      toast.error(err.message || 'Không thể tải chi tiết bộ câu hỏi.', 'Lỗi');
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handlePlaySavedGame = async (gameId: string, autoStartSolo: boolean = false) => {
    try {
      const spec =
        activeGameSpec?.gameId === gameId
          ? activeGameSpec
          : await fetchGameById(gameId, { mode: 'manage' });
      if (onSelectSavedGame) {
        onSelectSavedGame(spec, autoStartSolo);
      }
      toast.success(
        autoStartSolo
          ? `Đang bắt đầu chế độ chơi đơn cho "${spec.title}".`
          : `Đã nạp bộ câu hỏi "${spec.title}" để luyện tập hoặc mở phòng chơi.`,
        'Sẵn sàng chơi'
      );
    } catch (err: any) {
      toast.error(err.message || 'Không thể mở lại bộ câu hỏi.', 'Lỗi');
    }
  };

  const handleOpenSoloShareModal = async (game: { gameId: string; title: string; isPublic?: boolean }) => {
    if (game.isPublic === false) {
      toast.warning(
        'Game này đang ở trạng thái Bản nháp. Vui lòng Xuất bản game trước khi lấy Link / QR chơi đơn.',
        'Chưa xuất bản'
      );
      return;
    }
    setIsLoadingSoloShare(true);
    try {
      const qrData = await fetchGameQr(game.gameId);
      setSoloShareData({
        gameId: qrData.gameId,
        title: qrData.title,
        playUrl: qrData.playUrl,
        qrDataUrl: qrData.qrDataUrl,
      });
    } catch (err: any) {
      toast.error(err.message || 'Không thể tạo Link / QR chơi đơn.', 'Lỗi chia sẻ');
    } finally {
      setIsLoadingSoloShare(false);
    }
  };

  const handleOpenMultiplayerRoom = async (game: { gameId: string; title: string; isPublic?: boolean }) => {
    if (game.isPublic === false) {
      toast.warning(
        'Game này đang ở trạng thái Bản nháp. Vui lòng Xuất bản game trước khi mở phòng Multiplayer.',
        'Chưa xuất bản'
      );
      return;
    }
    setIsOpeningRoomGameId(game.gameId);
    try {
      const created = await createRoom({
        gameId: game.gameId,
        requirePublished: true,
      });
      const qr = await fetchRoomQr(created.roomCode);
      setMultiplayerShareData({
        gameId: game.gameId,
        title: game.title,
        roomCode: created.roomCode,
        hostToken: created.hostToken,
        joinUrl: qr.joinUrl,
        qrDataUrl: qr.qrDataUrl,
      });
      toast.success(`Đã mở phòng Multiplayer #${created.roomCode}!`, 'Mở phòng thành công');
    } catch (err: any) {
      toast.error(err.message || 'Không thể mở phòng Multiplayer.', 'Lỗi mở phòng');
    } finally {
      setIsOpeningRoomGameId(null);
    }
  };

  const handleExportGame = async (gameId: string, format: 'csv' | 'json') => {
    try {
      await downloadGameExport(gameId, format);
      toast.success(`Đã xuất bộ câu hỏi sang định dạng ${format.toUpperCase()}`, 'Xuất tệp thành công');
    } catch (err: any) {
      toast.error(err.message || 'Không thể xuất bộ câu hỏi.', 'Lỗi xuất tệp');
    }
  };

  const handleOpenDeleteModal = (game: PersistedGameSummary) => {
    setConfirmDeleteGame(game);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteGame) return;
    const targetGame = confirmDeleteGame;
    setIsDeleting(true);

    try {
      await deleteSavedGame(targetGame.gameId);
      setSavedGames(prev => prev.filter(g => g.gameId !== targetGame.gameId));
      setTotalCount(prev => Math.max(0, prev - 1));
      if (activeGameSpec?.gameId === targetGame.gameId) {
        setActiveGameSpec(null);
      }
      setConfirmDeleteGame(null);
      toast.success(`Đã xóa bộ câu hỏi "${targetGame.title}" thành công.`, 'Xóa thành công');
      const remainingOnPage = savedGames.length - 1;
      const nextPage = page > 1 && remainingOnPage === 0 ? page - 1 : page;
      setPage(nextPage);
      loadSavedGames(nextPage, searchQuery, selectedTypeFilter, statusFilter).catch(() => {});
    } catch (err: any) {
      toast.error(
        err.message || 'Không thể xóa bộ câu hỏi. Vui lòng đảm bảo bạn có quyền xóa và bộ câu hỏi không có phòng chơi đang hoạt động.',
        'Lỗi xóa bộ câu hỏi'
      );
      await loadSavedGames(page, searchQuery, selectedTypeFilter, statusFilter);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExecuteEndSession = async () => {
    if (!confirmEndSessionModal) return;
    const { game, sessionId } = confirmEndSessionModal;
    setIsEndingSession(true);
    try {
      await endPracticeSession(sessionId);
      toast.success(
        `Đã kết thúc phiên luyện tập chơi đơn cho "${game.title}". Bạn có thể tiếp tục quản lý hoặc xóa game.`,
        'Kết thúc phiên thành công'
      );
      setConfirmEndSessionModal(null);
      await loadSavedGames(page, searchQuery, selectedTypeFilter, statusFilter);
    } catch (err: any) {
      toast.error(err.message || 'Không thể kết thúc phiên luyện tập.', 'Lỗi kết thúc phiên');
    } finally {
      setIsEndingSession(false);
    }
  };

  const handleExecuteCloseRoom = async () => {
    if (!confirmCloseRoomModal) return;
    const { game, roomCode } = confirmCloseRoomModal;
    setIsClosingRoom(true);
    try {
      await closeMultiplayerRoom(roomCode);
      toast.success(
        `Đã đóng phòng chơi trực tiếp (PIN: ${roomCode}) cho "${game.title}".`,
        'Đóng phòng thành công'
      );
      setConfirmCloseRoomModal(null);
      await loadSavedGames(page, searchQuery, selectedTypeFilter, statusFilter);
    } catch (err: any) {
      toast.error(err.message || 'Không thể đóng phòng chơi trực tiếp.', 'Lỗi đóng phòng');
    } finally {
      setIsClosingRoom(false);
    }
  };

  const handleUpdateEditQuestion = (index: number, patch: Partial<GameQuestion>) => {
    setEditQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== index) return q;
        const updated = { ...q, ...patch };
        if (patch.type) {
          if (patch.type === 'MULTIPLE_CHOICE' && (!updated.choices || updated.choices.length !== 4)) {
            updated.choices = ['Lựa chọn A', 'Lựa chọn B', 'Lựa chọn C', 'Lựa chọn D'];
            updated.correctAnswer = 'Lựa chọn A';
          } else if (patch.type === 'QUICK_BUTTON' && (!updated.choices || updated.choices.length < 2)) {
            updated.choices = ['Đúng', 'Sai'];
            updated.correctAnswer = 'Đúng';
          } else if (patch.type === 'FILL_IN_THE_BLANK' || patch.type === 'CROSSWORD') {
            updated.choices = undefined;
          }
        }
        return updated;
      })
    );
  };

  const handleMoveEditQuestion = (index: number, direction: 'UP' | 'DOWN') => {
    setEditQuestions((prev) => {
      const targetIndex = direction === 'UP' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  };

  const handleDuplicateEditQuestion = (index: number) => {
    const target = editQuestions[index];
    if (!target) return;
    const cloned: GameQuestion = {
      ...target,
      id: `q_dup_${Date.now()}_${editQuestions.length + 1}`,
      choices: target.choices ? [...target.choices] : undefined,
    };
    setEditQuestions((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, cloned);
      return next;
    });
    toast.info(`Đã nhân bản Câu #${index + 1}`, 'Đã nhân bản');
  };

  const handleAddEditQuestion = () => {
    if (!activeGameSpec) return;
    const defaultType: QuestionType =
      activeGameSpec.gameType === 'MIXED' || activeGameSpec.gameType === 'ADVENTURE'
        ? 'MULTIPLE_CHOICE'
        : activeGameSpec.gameType;
    const fallbackRef = activeGameSpec.questions[0]?.sourceReference || {
      sourceId: activeGameSpec.sourceSummary?.sources?.[0]?.sourceId || 'src_manual',
      sourceType: activeGameSpec.sourceSummary?.sources?.[0]?.sourceType || 'FILE',
      sourceLocation: activeGameSpec.sourceSummary?.sources?.[0]?.sourceLocation || 'Manual',
    };

    const newQuestion: GameQuestion = {
      id: `q_custom_${Date.now()}_${editQuestions.length + 1}`,
      type: defaultType,
      question:
        defaultType === 'FILL_IN_THE_BLANK'
          ? 'Nhập nội dung câu hỏi có chỗ trống ___ tại đây?'
          : 'Nhập nội dung câu hỏi mới tại đây?',
      choices:
        defaultType === 'MULTIPLE_CHOICE'
          ? ['Lựa chọn A', 'Lựa chọn B', 'Lựa chọn C', 'Lựa chọn D']
          : defaultType === 'QUICK_BUTTON'
            ? ['Đúng', 'Sai']
            : undefined,
      correctAnswer:
        defaultType === 'MULTIPLE_CHOICE'
          ? 'Lựa chọn A'
          : defaultType === 'QUICK_BUTTON'
            ? 'Đúng'
            : 'ĐÁP ÁN',
      explanation: 'Giải thích đáp án dựa trên tài liệu nguồn.',
      difficulty: 'MEDIUM',
      sourceReference: fallbackRef,
    };

    setEditQuestions((prev) => [...prev, newQuestion]);
  };

  const handleDeleteEditQuestion = (index: number) => {
    if (editQuestions.length <= 1) {
      toast.warning('Bộ câu hỏi phải có tối thiểu 1 câu hỏi.', 'Không thể xóa');
      return;
    }
    setEditQuestions((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSaveEdits = async () => {
    if (!activeGameSpec) return;
    setIsSavingEdits(true);
    try {
      const updated = await saveEditedQuestions(activeGameSpec.gameId, {
        title: editTitle.trim() || activeGameSpec.title,
        description: editDescription.trim() || activeGameSpec.description,
        questions: editQuestions,
        settings: {
          timePerQuestion: editTimePerQuestion,
          scoringMode: editScoringMode,
        },
        isPublic: editIsPublic,
      });
      setActiveGameSpec(updated);
      syncEditorFromSpec(updated);
      setIsEditMode(false);
      toast.success('Đã lưu cập nhật bộ câu hỏi thành công.', 'Đã lưu');
      await loadSavedGames(page, searchQuery, selectedTypeFilter, statusFilter);
    } catch (err: any) {
      toast.error(err.message || 'Không thể lưu chỉnh sửa câu hỏi.', 'Lỗi lưu');
    } finally {
      setIsSavingEdits(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div
      style={{
        height: '100vh',
        maxHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        padding: '0.85rem 1.25rem',
        overflow: 'hidden',
      }}
    >
      {/* 1. Header Toolbar */}
      {activeGameSpec ? (
        /* Top Header when in Detail/Edit mode */
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
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <button
              type="button"
              onClick={() => {
                setActiveGameSpec(null);
                setIsEditMode(false);
              }}
              style={{
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-strong)',
                borderRadius: '8px',
                padding: '0 0.75rem',
                height: '34px',
                fontWeight: 800,
                fontSize: '0.82rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <ArrowLeftIcon size={14} />
              <span>Kho Game</span>
            </button>

            <span
              style={{
                backgroundColor: 'rgba(56, 189, 248, 0.12)',
                color: 'var(--accent-sky)',
                padding: '0.15rem 0.5rem',
                borderRadius: '6px',
                fontSize: '0.74rem',
                fontWeight: 800,
              }}
            >
              {formatGameTypeName(activeGameSpec.gameType)}
            </span>

            <h2
              style={{
                margin: 0,
                fontSize: '1rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
                maxWidth: '450px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={editTitle || activeGameSpec.title}
            >
              {isEditMode ? 'Chỉnh sửa: ' : 'Chi tiết: '}
              {editTitle || activeGameSpec.title}
            </h2>
          </div>
        </div>
      ) : (
        /* Top Header Toolbar when in Kho Game library mode (Unified single line) */
        <div
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <BookOpenIcon size={22} />
              <span>Kho Game</span>
            </h1>
            <span
              style={{
                fontSize: '0.74rem',
                fontWeight: 700,
                padding: '0.15rem 0.45rem',
                borderRadius: '10px',
                backgroundColor: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {totalCount} bộ
            </span>
            {isDetailLoading && (
              <span style={{ fontSize: '0.76rem', color: 'var(--accent-sky)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <SpinnerIcon size={14} />
              </span>
            )}
          </div>

          {/* Controls: Search, Filters, View toggle, Refresh */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', flex: '1 1 auto', justifyContent: 'flex-end' }}>
            {/* Search Input */}
            <form
              onSubmit={handleSearchSubmit}
              style={{ display: 'flex', alignItems: 'center', minWidth: '180px', maxWidth: '280px', flex: '1 1 180px' }}
            >
              <div style={{ position: 'relative', width: '100%' }}>
                <input
                  id="analytics-search-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm theo tên..."
                  style={{
                    width: '100%',
                    padding: '0.35rem 1.85rem 0.35rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontSize: '0.82rem',
                    height: '34px',
                    boxSizing: 'border-box',
                  }}
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setPage(1);
                      loadSavedGames(1, '', selectedTypeFilter, statusFilter);
                    }}
                    style={{
                      position: 'absolute',
                      right: '6px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '2px',
                      display: 'flex',
                    }}
                  >
                    <XMarkIcon size={14} />
                  </button>
                ) : (
                  <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none', display: 'flex' }}>
                    <SearchIcon size={13} />
                  </span>
                )}
              </div>
            </form>

            {/* Type Filter */}
            <select
              id="analytics-type-filter"
              value={selectedTypeFilter}
              onChange={(e) => setSelectedTypeFilter(e.target.value)}
              style={{
                padding: '0.35rem 0.65rem',
                borderRadius: '8px',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                height: '34px',
              }}
            >
              <option value="ALL">Tất cả thể loại</option>
              <option value="MULTIPLE_CHOICE">Trắc nghiệm ABCD</option>
              <option value="FILL_IN_THE_BLANK">Điền từ</option>
              <option value="QUICK_BUTTON">Đúng / Sai</option>
              <option value="CROSSWORD">Ô chữ</option>
              <option value="MIXED">Hỗn hợp</option>
              <option value="ADVENTURE">Đi cảnh theo ngành nghề</option>
            </select>

            {/* Status Filter */}
            <select
              id="analytics-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'PUBLISHED' | 'DRAFT')}
              style={{
                padding: '0.35rem 0.65rem',
                borderRadius: '8px',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                height: '34px',
              }}
            >
              <option value="ALL">Tất cả trạng thái</option>
              <option value="PUBLISHED">Đã xuất bản</option>
              <option value="DRAFT">Bản nháp</option>
            </select>

            {/* View Layout Toggle */}
            <div
              style={{
                display: 'inline-flex',
                backgroundColor: 'var(--bg-input)',
                padding: '2px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                height: '34px',
                boxSizing: 'border-box',
              }}
            >
              <button
                type="button"
                onClick={() => setViewLayout('grid')}
                style={{
                  padding: '0 0.55rem',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: viewLayout === 'grid' ? 'var(--primary)' : 'transparent',
                  color: viewLayout === 'grid' ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: 700,
                  fontSize: '0.76rem',
                  cursor: 'pointer',
                  height: '100%',
                }}
              >
                Lưới
              </button>
              <button
                type="button"
                onClick={() => setViewLayout('list')}
                style={{
                  padding: '0 0.55rem',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: viewLayout === 'list' ? 'var(--primary)' : 'transparent',
                  color: viewLayout === 'list' ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: 700,
                  fontSize: '0.76rem',
                  cursor: 'pointer',
                  height: '100%',
                }}
              >
                Bảng
              </button>
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={() => loadSavedGames(page, searchQuery, selectedTypeFilter, statusFilter)}
              disabled={isLoading}
              title="Làm mới"
              style={{
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-strong)',
                borderRadius: '8px',
                padding: '0 0.65rem',
                height: '34px',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              {isLoading ? <SpinnerIcon size={14} /> : <RefreshIcon size={14} />}
            </button>

            {/* Nút Xóa Tất Cả Game */}
            <button
              type="button"
              onClick={() => setIsConfirmDeleteAllOpen(true)}
              disabled={isLoading || totalCount === 0}
              title="Xóa toàn bộ game trong kho"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                color: 'var(--accent-rose)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '8px',
                padding: '0 0.75rem',
                height: '34px',
                fontWeight: 700,
                fontSize: '0.78rem',
                cursor: isLoading || totalCount === 0 ? 'not-allowed' : 'pointer',
                opacity: isLoading || totalCount === 0 ? 0.5 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <TrashIcon size={13} />
              <span>Xóa tất cả</span>
            </button>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div
          role="alert"
          style={{
            padding: '0.5rem 0.85rem',
            borderRadius: '8px',
            backgroundColor: 'rgba(244, 63, 94, 0.12)',
            border: '1px solid var(--accent-rose)',
            color: 'var(--accent-rose)',
            marginBottom: '0.65rem',
            fontWeight: 700,
            fontSize: '0.82rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
            flexShrink: 0,
          }}
        >
          <AlertTriangleIcon size={15} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* KHỐI XEM CHI TIẾT & CHỈNH SỬA BỘ CÂU HỎI ĐANG CHỌN */}
      {activeGameSpec && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            paddingRight: '0.4rem',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              padding: '1rem',
              marginBottom: '1rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: '1rem',
                marginBottom: '1.2rem',
              paddingBottom: '1rem',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ flex: '1 1 380px' }}>
              {isEditMode ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' }}>
                    <div>
                      <label htmlFor="edit-spec-title" style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                        Tiêu đề bộ câu hỏi:
                      </label>
                      <input
                        id="edit-spec-title"
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.6rem 0.85rem',
                          borderRadius: '8px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-input)',
                          color: 'var(--text-primary)',
                          fontWeight: 800,
                          fontSize: '0.95rem',
                          boxSizing: 'border-box',
                          minHeight: '40px',
                        }}
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-spec-desc" style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                        Mô tả:
                      </label>
                      <input
                        id="edit-spec-desc"
                        type="text"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.6rem 0.85rem',
                          borderRadius: '8px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-input)',
                          color: 'var(--text-primary)',
                          fontSize: '0.88rem',
                          boxSizing: 'border-box',
                          minHeight: '40px',
                        }}
                      />
                    </div>
                  </div>

                  {/* Cấu hình thời gian, điểm số & trạng thái xuất bản */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                    <div>
                      <label htmlFor="edit-spec-time" style={{ display: 'block', fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                        Thời gian mỗi câu (5-60 giây):
                      </label>
                      <input
                        id="edit-spec-time"
                        type="number"
                        min={5}
                        max={60}
                        value={editTimePerQuestion}
                        onChange={(e) => setEditTimePerQuestion(Math.max(5, Math.min(60, Number(e.target.value) || 15)))}
                        style={{
                          width: '100%',
                          padding: '0.55rem 0.75rem',
                          borderRadius: '8px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-input)',
                          color: 'var(--text-primary)',
                          fontWeight: 700,
                          boxSizing: 'border-box',
                          minHeight: '40px',
                        }}
                      />
                    </div>

                    <div>
                      <label htmlFor="edit-spec-score" style={{ display: 'block', fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                        Chế độ tính điểm:
                      </label>
                      <select
                        id="edit-spec-score"
                        value={editScoringMode}
                        onChange={(e) => setEditScoringMode(e.target.value as ScoringMode)}
                        style={{
                          width: '100%',
                          padding: '0.55rem 0.75rem',
                          borderRadius: '8px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-input)',
                          color: 'var(--text-primary)',
                          fontWeight: 700,
                          minHeight: '40px',
                        }}
                      >
                        <option value="SPEED_BONUS">Thưởng tốc độ (Speed Bonus)</option>
                        <option value="STANDARD">Tiêu chuẩn (Standard)</option>
                        <option value="STREAK">Chuỗi đúng (Streak)</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="edit-spec-status" style={{ display: 'block', fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                        Trạng thái xuất bản:
                      </label>
                      <select
                        id="edit-spec-status"
                        value={editIsPublic ? 'PUBLISHED' : 'DRAFT'}
                        onChange={(e) => setEditIsPublic(e.target.value === 'PUBLISHED')}
                        style={{
                          width: '100%',
                          padding: '0.55rem 0.75rem',
                          borderRadius: '8px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-input)',
                          color: editIsPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                          fontWeight: 800,
                          minHeight: '40px',
                        }}
                      >
                        <option value="PUBLISHED">Đã xuất bản (Cho phép chơi & mở phòng)</option>
                        <option value="DRAFT">Bản nháp (Ẩn khỏi người chơi)</option>
                      </select>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <span
                      style={{
                        backgroundColor: 'rgba(56, 189, 248, 0.14)',
                        color: 'var(--accent-sky)',
                        padding: '0.2rem 0.65rem',
                        borderRadius: '6px',
                        fontSize: '0.76rem',
                        fontWeight: 800,
                      }}
                    >
                      {formatGameTypeName(activeGameSpec.gameType)}
                    </span>
                    <span
                      style={{
                        backgroundColor: activeGameSpec.isPublic
                          ? 'rgba(16, 185, 129, 0.14)'
                          : 'rgba(245, 158, 11, 0.15)',
                        color: activeGameSpec.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                        padding: '0.2rem 0.65rem',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        fontWeight: 800,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                      }}
                    >
                      {activeGameSpec.isPublic ? <CheckIcon size={12} /> : <PencilIcon size={12} />}
                      <span>{activeGameSpec.isPublic ? 'Đã xuất bản' : 'Bản nháp'}</span>
                    </span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      • {activeGameSpec.questions.length} câu hỏi • {activeGameSpec.settings.timePerQuestion}s/câu • Điểm: {formatScoringModeName(activeGameSpec.settings.scoringMode)}
                    </span>
                  </div>
                  <h2 style={{ margin: '0.45rem 0 0.25rem 0', fontSize: '1.35rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                    {activeGameSpec.title}
                  </h2>
                  <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                    {activeGameSpec.description}
                  </p>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {isEditMode ? (
                <>
                  <button
                    type="button"
                    onClick={handleSaveEdits}
                    disabled={isSavingEdits}
                    style={{
                      backgroundColor: 'var(--accent-emerald)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '0.55rem 1rem',
                      minHeight: '40px',
                      fontWeight: 800,
                      fontSize: '0.84rem',
                      cursor: isSavingEdits ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                    }}
                  >
                    {isSavingEdits ? (
                      <>
                        <SpinnerIcon size={16} />
                        <span>Đang lưu...</span>
                      </>
                    ) : (
                      <>
                        <CheckIcon size={16} />
                        <span>Lưu Thay Đổi</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddEditQuestion}
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--accent-sky)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '8px',
                      padding: '0.55rem 0.9rem',
                      minHeight: '40px',
                      fontWeight: 800,
                      fontSize: '0.84rem',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <PlusIcon size={15} />
                    <span>Thêm câu hỏi</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      syncEditorFromSpec(activeGameSpec);
                      setIsEditMode(false);
                    }}
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '8px',
                      padding: '0.55rem 0.9rem',
                      minHeight: '40px',
                      fontWeight: 700,
                      fontSize: '0.84rem',
                      cursor: 'pointer',
                    }}
                  >
                    Hủy sửa
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handlePlaySavedGame(activeGameSpec.gameId, true)}
                    style={{
                      backgroundColor: 'var(--primary)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '0.55rem 0.95rem',
                      minHeight: '40px',
                      fontWeight: 800,
                      fontSize: '0.83rem',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                    }}
                  >
                    <GamepadIcon size={16} />
                    <span>Chơi đơn</span>
                  </button>
                  {activeGameSpec.isPublic && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          handleOpenSoloShareModal({
                            gameId: activeGameSpec.gameId,
                            title: activeGameSpec.title,
                            isPublic: activeGameSpec.isPublic,
                          })
                        }
                        disabled={isLoadingSoloShare}
                        style={{
                          backgroundColor: 'var(--bg-input)',
                          color: 'var(--accent-sky)',
                          border: '1px solid var(--accent-sky)',
                          borderRadius: '8px',
                          padding: '0.55rem 0.9rem',
                          minHeight: '40px',
                          fontWeight: 800,
                          fontSize: '0.83rem',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                        }}
                      >
                        <QrCodeIcon size={16} />
                        <span>Link / QR Chơi đơn</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleOpenMultiplayerRoom({
                            gameId: activeGameSpec.gameId,
                            title: activeGameSpec.title,
                            isPublic: activeGameSpec.isPublic,
                          })
                        }
                        disabled={isOpeningRoomGameId === activeGameSpec.gameId}
                        style={{
                          backgroundColor: 'var(--accent-emerald)',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '0.55rem 0.95rem',
                          minHeight: '40px',
                          fontWeight: 800,
                          fontSize: '0.83rem',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                        }}
                      >
                        {isOpeningRoomGameId === activeGameSpec.gameId ? (
                          <>
                            <SpinnerIcon size={16} />
                            <span>Đang mở phòng...</span>
                          </>
                        ) : (
                          <>
                            <UsersIcon size={16} />
                            <span>Mở phòng Multiplayer</span>
                          </>
                        )}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsEditMode(true)}
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--accent-amber)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '8px',
                      padding: '0.55rem 0.9rem',
                      minHeight: '40px',
                      fontWeight: 800,
                      fontSize: '0.84rem',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <PencilIcon size={15} />
                    <span>Sửa game</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportGame(activeGameSpec.gameId, 'csv')}
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--accent-emerald)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '8px',
                      padding: '0.55rem 0.85rem',
                      minHeight: '40px',
                      fontWeight: 800,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    Xuất CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportGame(activeGameSpec.gameId, 'json')}
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      color: 'var(--accent-sky)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: '8px',
                      padding: '0.55rem 0.85rem',
                      minHeight: '40px',
                      fontWeight: 800,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    Xuất JSON
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setActiveGameSpec(null)}
                style={{
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '0.55rem 0.8rem',
                  minHeight: '40px',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
              >
                <XMarkIcon size={14} />
                <span>Đóng</span>
              </button>
            </div>
          </div>

          {/* Danh sách câu hỏi trong bộ */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', maxHeight: '580px', overflowY: 'auto', paddingRight: '0.25rem' }}>
            {(isEditMode ? editQuestions : activeGameSpec.questions).map((q, idx) => (
              <div
                key={q.id || idx}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '12px',
                  padding: '1rem 1.15rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.55rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontWeight: 900, color: 'var(--accent-sky)', fontSize: '0.88rem' }}>
                      Câu #{idx + 1}
                    </span>
                    <span
                      style={{
                        fontSize: '0.74rem',
                        fontWeight: 800,
                        padding: '0.15rem 0.5rem',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(148, 163, 184, 0.15)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {formatGameTypeName(q.type)}
                    </span>
                  </div>

                  {isEditMode && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMoveEditQuestion(idx, 'UP')}
                        style={{
                          padding: '0.25rem 0.55rem',
                          borderRadius: '6px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                          color: idx === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          cursor: idx === 0 ? 'not-allowed' : 'pointer',
                        }}
                      >
                        ↑ Lên
                      </button>
                      <button
                        type="button"
                        disabled={idx === editQuestions.length - 1}
                        onClick={() => handleMoveEditQuestion(idx, 'DOWN')}
                        style={{
                          padding: '0.25rem 0.55rem',
                          borderRadius: '6px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                          color: idx === editQuestions.length - 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          cursor: idx === editQuestions.length - 1 ? 'not-allowed' : 'pointer',
                        }}
                      >
                        ↓ Xuống
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplicateEditQuestion(idx)}
                        style={{
                          padding: '0.35rem 0.65rem',
                          borderRadius: '6px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--accent-sky)',
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                        }}
                      >
                        <CopyIcon size={14} />
                        <span>Nhân bản</span>
                      </button>
                      {activeGameSpec.gameType === 'MIXED' && (
                        <select
                          value={q.type}
                          onChange={(e) =>
                            handleUpdateEditQuestion(idx, { type: e.target.value as QuestionType })
                          }
                          style={{
                            padding: '0.3rem 0.6rem',
                            borderRadius: '6px',
                            border: '1px solid var(--border-strong)',
                            backgroundColor: 'var(--bg-surface)',
                            color: 'var(--text-primary)',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                          }}
                        >
                          <option value="MULTIPLE_CHOICE">Trắc nghiệm ABCD</option>
                          <option value="FILL_IN_THE_BLANK">Điền từ</option>
                          <option value="QUICK_BUTTON">Đúng / Sai</option>
                          <option value="CROSSWORD">Ô chữ</option>
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteEditQuestion(idx)}
                        style={{
                          backgroundColor: 'rgba(244, 63, 94, 0.14)',
                          color: 'var(--accent-rose)',
                          border: '1px solid var(--accent-rose)',
                          borderRadius: '6px',
                          padding: '0.35rem 0.65rem',
                          fontSize: '0.76rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                        }}
                      >
                        <TrashIcon size={14} />
                        <span>Xóa câu</span>
                      </button>
                    </div>
                  )}
                </div>

                {isEditMode ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                        Nội dung câu hỏi:
                      </label>
                      <input
                        type="text"
                        value={q.question}
                        onChange={(e) => handleUpdateEditQuestion(idx, { question: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '0.55rem 0.75rem',
                          borderRadius: '8px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                          fontSize: '0.88rem',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>

                    {(q.type === 'MULTIPLE_CHOICE' || q.type === 'QUICK_BUTTON') && q.choices && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem' }}>
                        {q.choices.map((ch, cIdx) => (
                          <div key={cIdx}>
                            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
                              Lựa chọn {cIdx + 1}:
                            </label>
                            <input
                              type="text"
                              value={ch}
                              onChange={(e) => {
                                const nextChoices = [...(q.choices || [])];
                                const oldVal = nextChoices[cIdx];
                                nextChoices[cIdx] = e.target.value;
                                const nextPatch: Partial<GameQuestion> = { choices: nextChoices };
                                if (q.correctAnswer === oldVal) {
                                  nextPatch.correctAnswer = e.target.value;
                                }
                                handleUpdateEditQuestion(idx, nextPatch);
                              }}
                              style={{
                                width: '100%',
                                padding: '0.45rem 0.65rem',
                                borderRadius: '6px',
                                border: '1px solid var(--border-strong)',
                                backgroundColor: 'var(--bg-surface)',
                                color: 'var(--text-primary)',
                                fontSize: '0.84rem',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-emerald)', marginBottom: '0.2rem' }}>
                          Đáp án đúng:
                        </label>
                        {(q.type === 'QUICK_BUTTON' || q.type === 'MULTIPLE_CHOICE') && q.choices ? (
                          <select
                            value={q.correctAnswer}
                            onChange={(e) => handleUpdateEditQuestion(idx, { correctAnswer: e.target.value })}
                            style={{
                              width: '100%',
                              padding: '0.5rem 0.7rem',
                              borderRadius: '6px',
                              border: '1px solid var(--border-strong)',
                              backgroundColor: 'var(--bg-surface)',
                              color: 'var(--text-primary)',
                              fontWeight: 700,
                            }}
                          >
                            {q.choices.map((ch, cIdx) => (
                              <option key={cIdx} value={ch}>
                                {ch}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={q.correctAnswer}
                            onChange={(e) =>
                              handleUpdateEditQuestion(idx, {
                                correctAnswer: e.target.value,
                                ...(q.type === 'CROSSWORD' ? { crosswordAnswer: e.target.value } : {}),
                              })
                            }
                            style={{
                              width: '100%',
                              padding: '0.5rem 0.7rem',
                              borderRadius: '6px',
                              border: '1px solid var(--border-strong)',
                              backgroundColor: 'var(--bg-surface)',
                              color: 'var(--text-primary)',
                              fontSize: '0.84rem',
                              boxSizing: 'border-box',
                            }}
                          />
                        )}
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                          Giải thích (Explanation):
                        </label>
                        <input
                          type="text"
                          value={q.explanation || ''}
                          onChange={(e) => handleUpdateEditQuestion(idx, { explanation: e.target.value })}
                          style={{
                            width: '100%',
                            padding: '0.5rem 0.7rem',
                            borderRadius: '6px',
                            border: '1px solid var(--border-strong)',
                            backgroundColor: 'var(--bg-surface)',
                            color: 'var(--text-primary)',
                            fontSize: '0.84rem',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.95rem', marginBottom: '0.45rem' }}>
                      {q.question}
                    </div>
                    {q.choices && q.choices.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.5rem' }}>
                        {q.choices.map((ch, cIdx) => {
                          const isCorrect = ch === q.correctAnswer;
                          return (
                            <span
                              key={cIdx}
                              style={{
                                fontSize: '0.8rem',
                                padding: '0.25rem 0.65rem',
                                borderRadius: '6px',
                                border: isCorrect ? '1px solid var(--accent-emerald)' : '1px solid var(--border-subtle)',
                                backgroundColor: isCorrect ? 'rgba(16, 185, 129, 0.14)' : 'var(--bg-surface)',
                                color: isCorrect ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                                fontWeight: isCorrect ? 800 : 600,
                              }}
                            >
                              {ch}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <div style={{ fontSize: '0.82rem', color: 'var(--accent-emerald)', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <CheckIcon size={14} />
                      <span>Đáp án đúng: {q.correctAnswer}</span>
                    </div>
                    {q.explanation && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                        Giải thích: {q.explanation}
                      </div>
                    )}
                    {q.sourceReference && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        Nguồn: {q.sourceReference.sourceLocation}
                        {q.sourceReference.section ? ` — ${q.sourceReference.section}` : ''}
                        {q.sourceReference.page ? ` (Trang ${q.sourceReference.page})` : ''}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    )}

      {/* DANH SÁCH CÁC BỘ CÂU HỎI ĐÃ TẠO (VỪA KHÍT MÀN HÌNH KHÔNG CẦN SCROLL NGOÀI) */}
      {!activeGameSpec && (
        <>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              paddingRight: '2px',
            }}
          >
            {savedGames.length === 0 ? (
              <div
                style={{
                  padding: '2.5rem 1.25rem',
                  borderRadius: '12px',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px dashed var(--border-strong)',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  marginTop: '1rem',
                }}
              >
                <div style={{ color: 'var(--text-muted)', marginBottom: '0.5rem', display: 'flex', justifyContent: 'center' }}>
                  <BookOpenIcon size={32} />
                </div>
                <div style={{ fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.25rem', fontSize: '0.95rem' }}>
                  Chưa có bộ câu hỏi nào
                </div>
                <div style={{ fontSize: '0.82rem' }}>
                  Chuyển sang <strong>Tạo Game</strong> để tạo bộ câu hỏi tự động từ tài liệu bằng AI.
                </div>
              </div>
            ) : viewLayout === 'grid' ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(265px, 1fr))',
                  gap: '0.85rem',
                  alignContent: 'start',
                }}
              >
                {savedGames.map((g) => {
                  const typeColorMap: Record<string, string> = {
                    MULTIPLE_CHOICE: 'var(--game-mc)',
                    QUICK_BUTTON: 'var(--game-qb)',
                    FILL_IN_THE_BLANK: 'var(--game-fill)',
                    CROSSWORD: 'var(--game-cross)',
                    MIXED: 'var(--game-mixed)',
                  };
                  const accentColor = typeColorMap[g.gameType] || 'var(--primary)';

                  return (
                    <div
                      key={g.gameId}
                      style={{
                        borderRadius: '14px',
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        borderLeft: `4px solid ${accentColor}`,
                        padding: '0.9rem 1.05rem',
                        display: 'flex',
                        flexDirection: 'column',
                        boxSizing: 'border-box',
                        minHeight: '146px',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                        transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.borderColor = 'var(--border-strong)';
                        e.currentTarget.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.25)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.borderColor = 'var(--border-subtle)';
                        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem', gap: '0.35rem' }}>
                        <span
                          style={{
                            backgroundColor: `${accentColor}18`,
                            color: accentColor,
                            padding: '0.18rem 0.55rem',
                            borderRadius: '6px',
                            fontWeight: 800,
                            fontSize: '0.72rem',
                            letterSpacing: '0.02em',
                          }}
                        >
                          {formatGameTypeName(g.gameType)}
                        </span>

                        <span
                          style={{
                            backgroundColor: g.isPublic ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                            color: g.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                            padding: '0.15rem 0.45rem',
                            borderRadius: '6px',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.2rem',
                          }}
                        >
                          {g.isPublic ? <CheckIcon size={11} /> : <PencilIcon size={11} />}
                          <span>{g.isPublic ? 'Đã xuất bản' : 'Bản nháp'}</span>
                        </span>
                      </div>

                      <h3
                        style={{
                          margin: '0 0 0.35rem 0',
                          fontSize: '0.96rem',
                          fontWeight: 800,
                          color: 'var(--text-primary)',
                          lineHeight: 1.35,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                        title={g.title}
                      >
                        {g.title}
                      </h3>

                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.65rem' }}>
                        {g.questionCount ? `${g.questionCount} câu hỏi • ` : ''}Cập nhật: {new Date(g.updatedAt || g.createdAt).toLocaleDateString('vi-VN')}
                      </div>

                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: 'auto', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() => handleOpenModeModal(g.gameId)}
                          style={{
                            flex: 1,
                            backgroundColor: 'var(--primary)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '0.4rem 0.75rem',
                            height: '32px',
                            fontWeight: 800,
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.35rem',
                            transition: 'background-color 0.15s ease',
                          }}
                        >
                          <GamepadIcon size={14} />
                          <span>Mở Game</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleViewOrEditGame(g.gameId, false)}
                          style={{
                            backgroundColor: 'var(--bg-input)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '8px',
                            padding: '0 0.6rem',
                            height: '32px',
                            fontWeight: 700,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                          }}
                          title="Xem chi tiết & Chỉnh sửa câu hỏi"
                        >
                          <PencilIcon size={13} />
                          <span>Sửa</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleOpenDeleteModal(g)}
                          style={{
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            color: 'var(--accent-rose)',
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                            borderRadius: '8px',
                            padding: '0 0.6rem',
                            height: '32px',
                            fontWeight: 700,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                          }}
                          title="Xóa bộ câu hỏi"
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {savedGames.map((g) => {
                  return (
                    <div
                      key={g.gameId}
                      style={{
                        padding: '0.6rem 0.85rem',
                        borderRadius: '8px',
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '0.5rem',
                      }}
                    >
                      <div style={{ flex: '1 1 260px', display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            backgroundColor: 'rgba(56, 189, 248, 0.12)',
                            color: 'var(--accent-sky)',
                            padding: '0.12rem 0.45rem',
                            borderRadius: '6px',
                            fontWeight: 800,
                            fontSize: '0.72rem',
                          }}
                        >
                          {formatGameTypeName(g.gameType)}
                        </span>
                        <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                          {g.title}
                        </div>
                        <span
                          style={{
                            backgroundColor: g.isPublic ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                            color: g.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                            padding: '0.12rem 0.45rem',
                            borderRadius: '6px',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                          }}
                        >
                          {g.isPublic ? 'Đã xuất bản' : 'Bản nháp'}
                        </span>
                        {g.questionCount ? (
                          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                            {g.questionCount} câu
                          </span>
                        ) : null}

                        {/* Active Solo Session Indicator */}
                        {g.activeStatus?.hasActiveSession && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span
                              style={{
                                backgroundColor: 'rgba(249, 115, 22, 0.15)',
                                color: 'var(--accent-orange, #f97316)',
                                border: '1px solid rgba(249, 115, 22, 0.35)',
                                padding: '0.12rem 0.45rem',
                                borderRadius: '6px',
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                              }}
                              title="Bộ câu hỏi đang có phiên luyện tập chơi đơn hoạt động"
                            >
                              <span>🟠 Chơi đơn</span>
                              <span style={{ opacity: 0.85 }}>({g.activeStatus.activeSessionCount})</span>
                            </span>
                            {g.activeStatus.activeSessions?.[0] && (
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmEndSessionModal({
                                    game: g,
                                    sessionId: g.activeStatus!.activeSessions[0].sessionId,
                                  })
                                }
                                style={{
                                  backgroundColor: 'rgba(249, 115, 22, 0.12)',
                                  color: 'var(--accent-orange, #f97316)',
                                  border: '1px solid rgba(249, 115, 22, 0.4)',
                                  borderRadius: '5px',
                                  padding: '0.1rem 0.4rem',
                                  fontSize: '0.68rem',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                                title="Kết thúc phiên chơi đơn để giải phóng khóa xóa game"
                              >
                                Kết thúc
                              </button>
                            )}
                          </div>
                        )}

                        {/* Active Multiplayer Room Indicator */}
                        {g.activeStatus?.hasActiveRoom && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span
                              style={{
                                backgroundColor: 'rgba(168, 85, 247, 0.15)',
                                color: 'var(--accent-purple, #a855f7)',
                                border: '1px solid rgba(168, 85, 247, 0.35)',
                                padding: '0.12rem 0.45rem',
                                borderRadius: '6px',
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                              }}
                              title={`Phòng đang mở. Mã PIN: ${g.activeStatus.activeRooms?.map((r) => r.roomCode).join(', ')}`}
                            >
                              <span>🟣 Chơi nhóm</span>
                              {g.activeStatus.activeRooms?.[0] && (
                                <span style={{ opacity: 0.9 }}>
                                  (PIN: {g.activeStatus.activeRooms[0].roomCode} •{' '}
                                  {g.activeStatus.activeRooms[0].state === 'WAITING'
                                    ? 'Đang chờ'
                                    : 'Đang đấu'}
                                  )
                                </span>
                              )}
                            </span>
                            {g.activeStatus.activeRooms?.[0] && (
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmCloseRoomModal({
                                    game: g,
                                    roomCode: g.activeStatus!.activeRooms[0].roomCode,
                                  })
                                }
                                style={{
                                  backgroundColor: 'rgba(168, 85, 247, 0.12)',
                                  color: 'var(--accent-purple, #a855f7)',
                                  border: '1px solid rgba(168, 85, 247, 0.4)',
                                  borderRadius: '5px',
                                  padding: '0.1rem 0.4rem',
                                  fontSize: '0.68rem',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                                title="Đóng phòng chơi trực tiếp để giải phóng khóa xóa game"
                              >
                                Đóng phòng
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => handleOpenModeModal(g.gameId)}
                          style={{
                            backgroundColor: 'var(--primary)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '0 0.75rem',
                            height: '32px',
                            fontWeight: 800,
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                          }}
                        >
                          <GamepadIcon size={14} />
                          <span>Mở Game</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleViewOrEditGame(g.gameId, false)}
                          style={{
                            backgroundColor: 'var(--bg-input)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '6px',
                            padding: '0 0.55rem',
                            height: '32px',
                            fontWeight: 700,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                          }}
                        >
                          Chi tiết
                        </button>
                        <button
                          type="button"
                          onClick={() => handleViewOrEditGame(g.gameId, true)}
                          style={{
                            backgroundColor: 'var(--bg-input)',
                            color: 'var(--accent-amber)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '6px',
                            padding: '0 0.55rem',
                            height: '32px',
                            fontWeight: 700,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                          }}
                        >
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenDeleteModal(g)}
                          title={
                            !g.activeStatus?.isDeletable && (g.activeStatus?.hasActiveSession || g.activeStatus?.hasActiveRoom)
                              ? 'Bộ câu hỏi đang có phiên/phòng hoạt động. Hãy kết thúc trước khi xóa.'
                              : 'Xóa bộ câu hỏi'
                          }
                          style={{
                            backgroundColor: !g.activeStatus?.isDeletable && (g.activeStatus?.hasActiveSession || g.activeStatus?.hasActiveRoom)
                              ? 'rgba(100, 116, 139, 0.12)'
                              : 'rgba(244, 63, 94, 0.12)',
                            color: !g.activeStatus?.isDeletable && (g.activeStatus?.hasActiveSession || g.activeStatus?.hasActiveRoom)
                              ? 'var(--text-muted)'
                              : 'var(--accent-rose)',
                            border: `1px solid ${!g.activeStatus?.isDeletable && (g.activeStatus?.hasActiveSession || g.activeStatus?.hasActiveRoom) ? 'var(--border-subtle)' : 'var(--accent-rose)'}`,
                            borderRadius: '6px',
                            padding: '0 0.55rem',
                            height: '32px',
                            fontWeight: 700,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                          }}
                        >
                          {!g.activeStatus?.isDeletable && (g.activeStatus?.hasActiveSession || g.activeStatus?.hasActiveRoom) ? (
                            <LockIcon size={12} />
                          ) : null}
                          <span>Xóa</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExportGame(g.gameId, 'csv')}
                          style={{
                            backgroundColor: 'var(--bg-input)',
                            color: 'var(--accent-emerald)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '6px',
                            padding: '0 0.5rem',
                            height: '32px',
                            fontWeight: 700,
                            fontSize: '0.74rem',
                            cursor: 'pointer',
                          }}
                        >
                          CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExportGame(g.gameId, 'json')}
                          style={{
                            backgroundColor: 'var(--bg-input)',
                            color: 'var(--accent-sky)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '6px',
                            padding: '0 0.5rem',
                            height: '32px',
                            fontWeight: 700,
                            fontSize: '0.74rem',
                            cursor: 'pointer',
                          }}
                        >
                          JSON
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Thanh phân trang cố định đáy */}
          {totalPages > 1 && (
            <div
              style={{
                flexShrink: 0,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: '0.45rem',
                marginTop: '0.4rem',
                borderTop: '1px solid var(--border-subtle)',
                flexWrap: 'wrap',
                gap: '0.4rem',
              }}
            >
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                Trang {page} / {totalPages} • Tổng {totalCount} bộ câu hỏi
              </span>
              <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                <button
                  type="button"
                  disabled={page <= 1 || isLoading}
                  onClick={() => handlePageChange(page - 1)}
                  style={{
                    padding: '0 0.65rem',
                    height: '30px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-input)',
                    color: page <= 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                    fontWeight: 700,
                    fontSize: '0.76rem',
                    cursor: page <= 1 ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                >
                  <ArrowLeftIcon size={12} />
                  <span>Trước</span>
                </button>

                {/* Các nút số trang 1, 2, 3... */}
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((pNum) => pNum === 1 || pNum === totalPages || Math.abs(pNum - page) <= 2)
                  .map((pNum, idx, arr) => {
                    const prev = arr[idx - 1];
                    const hasGap = prev && pNum - prev > 1;
                    const isCurrent = pNum === page;

                    return (
                      <React.Fragment key={pNum}>
                        {hasGap && (
                          <span style={{ padding: '0 0.2rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>...</span>
                        )}
                        <button
                          type="button"
                          onClick={() => handlePageChange(pNum)}
                          disabled={isLoading}
                          style={{
                            minWidth: '30px',
                            height: '30px',
                            padding: '0 0.45rem',
                            borderRadius: '6px',
                            border: isCurrent ? '1.5px solid var(--primary)' : '1px solid var(--border-subtle)',
                            backgroundColor: isCurrent ? 'var(--primary)' : 'var(--bg-input)',
                            color: isCurrent ? 'var(--primary-ink)' : 'var(--text-primary)',
                            fontWeight: isCurrent ? 900 : 700,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {pNum}
                        </button>
                      </React.Fragment>
                    );
                  })}

                <button
                  type="button"
                  disabled={page >= totalPages || isLoading}
                  onClick={() => handlePageChange(page + 1)}
                  style={{
                    padding: '0 0.65rem',
                    height: '30px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-input)',
                    color: page >= totalPages ? 'var(--text-muted)' : 'var(--text-primary)',
                    fontWeight: 700,
                    fontSize: '0.76rem',
                    cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                >
                  <span>Sau</span>
                  <ArrowRightIcon size={12} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal Chia Sẻ Link / QR Chơi Đơn */}
      {soloShareData && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="solo-share-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 300,
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSoloShareData(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSoloShareData(null);
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: '16px',
              padding: '1.5rem',
              width: '100%',
              maxWidth: '460px',
              boxShadow: 'var(--card-shadow)',
              textAlign: 'center',
            }}
          >
            <h3 id="solo-share-title" style={{ margin: '0 0 0.4rem 0', fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem' }}>
              <QrCodeIcon size={20} />
              <span>Chia Sẻ Chơi Đơn (Link & QR)</span>
            </h3>
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              Người chơi có thể quét mã QR hoặc mở đường dẫn dưới đây để tự chơi độc lập game{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{soloShareData.title}"</strong>.
            </p>

            <div
              style={{
                backgroundColor: '#ffffff',
                padding: '0.85rem',
                borderRadius: '12px',
                display: 'inline-block',
                marginBottom: '1rem',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <img
                src={soloShareData.qrDataUrl}
                alt={`QR chơi đơn ${soloShareData.title}`}
                style={{ width: '210px', height: '210px', display: 'block' }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                marginBottom: '1.1rem',
              }}
            >
              <input
                type="text"
                readOnly
                aria-label="Đường dẫn chơi đơn"
                value={soloShareData.playUrl}
                style={{
                  flex: 1,
                  padding: '0.55rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                  minHeight: '40px',
                }}
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(soloShareData.playUrl);
                  toast.success('Đã sao chép đường dẫn chơi đơn!', 'Đã sao chép');
                }}
                style={{
                  backgroundColor: 'var(--primary)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.55rem 0.9rem',
                  minHeight: '40px',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                <CopyIcon size={14} />
                <span>Copy Link</span>
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button
                type="button"
                onClick={() => {
                  const gameId = soloShareData.gameId;
                  setSoloShareData(null);
                  handlePlaySavedGame(gameId, true);
                }}
                style={{
                  backgroundColor: 'var(--accent-emerald)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.55rem 1rem',
                  minHeight: '44px',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                <GamepadIcon size={16} />
                <span>Chơi đơn ngay</span>
              </button>
              <button
                type="button"
                onClick={() => setSoloShareData(null)}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0.55rem 1rem',
                  minHeight: '44px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Mở Phòng Multiplayer */}
      {multiplayerShareData && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="multi-share-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 300,
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setMultiplayerShareData(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMultiplayerShareData(null);
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: '16px',
              padding: '1.5rem',
              width: '100%',
              maxWidth: '480px',
              boxShadow: 'var(--card-shadow)',
              textAlign: 'center',
            }}
          >
            <h3 id="multi-share-title" style={{ margin: '0 0 0.4rem 0', fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem' }}>
              <UsersIcon size={20} />
              <span>Phòng Chơi Multiplayer Đã Mở!</span>
            </h3>
            <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              Game: <strong style={{ color: 'var(--text-primary)' }}>"{multiplayerShareData.title}"</strong>
            </p>

            <div
              style={{
                backgroundColor: 'rgba(16, 185, 129, 0.14)',
                border: '1px solid var(--accent-emerald)',
                borderRadius: '10px',
                padding: '0.6rem 1rem',
                marginBottom: '1rem',
                display: 'inline-block',
              }}
            >
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                MÃ PHÒNG:{' '}
              </span>
              <strong style={{ fontSize: '1.35rem', color: 'var(--accent-emerald)', letterSpacing: '0.1em' }}>
                {multiplayerShareData.roomCode}
              </strong>
            </div>

            <div>
              <div
                style={{
                  backgroundColor: '#ffffff',
                  padding: '0.85rem',
                  borderRadius: '12px',
                  display: 'inline-block',
                  marginBottom: '1rem',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <img
                  src={multiplayerShareData.qrDataUrl}
                  alt={`QR phòng ${multiplayerShareData.roomCode}`}
                  style={{ width: '200px', height: '200px', display: 'block' }}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                marginBottom: '1.15rem',
              }}
            >
              <input
                type="text"
                readOnly
                aria-label="Đường dẫn tham gia phòng"
                value={multiplayerShareData.joinUrl}
                style={{
                  flex: 1,
                  padding: '0.55rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                  minHeight: '40px',
                }}
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(multiplayerShareData.joinUrl);
                  toast.success('Đã sao chép đường dẫn tham gia phòng!', 'Đã sao chép');
                }}
                style={{
                  backgroundColor: 'var(--primary)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.55rem 0.9rem',
                  minHeight: '40px',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                <CopyIcon size={14} />
                <span>Copy Link</span>
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', flexWrap: 'wrap' }}>
              {onNavigateToHost && (
                <button
                  type="button"
                  onClick={() => {
                    const { roomCode, hostToken } = multiplayerShareData;
                    setMultiplayerShareData(null);
                    onNavigateToHost(roomCode, hostToken);
                  }}
                  style={{
                    backgroundColor: 'var(--accent-emerald)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0.55rem 1.05rem',
                    minHeight: '44px',
                    fontWeight: 800,
                    fontSize: '0.86rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <GamepadIcon size={16} />
                  <span>Vào Màn Hình Điều Khiển (Host)</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setMultiplayerShareData(null)}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0.55rem 1rem',
                  minHeight: '44px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal xác nhận xóa bộ câu hỏi */}
      {confirmDeleteGame && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 300,
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeleting) {
              setConfirmDeleteGame(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !isDeleting) {
              setConfirmDeleteGame(null);
            }
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '2px solid var(--accent-rose)',
              borderRadius: '20px',
              padding: '1.75rem',
              width: '100%',
              maxWidth: '460px',
              boxShadow: 'var(--shadow-modal)',
              animation: 'popIn 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.85rem' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--accent-rose)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <TrashIcon size={20} />
              </div>
              <div>
                <h3 id="delete-confirm-title" style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                  Xác Nhận Xóa Bộ Câu Hỏi
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--accent-rose)', fontWeight: 700 }}>
                  Hành động này không thể hoàn tác
                </span>
              </div>
            </div>

            <div
              style={{
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                padding: '0.9rem 1rem',
                marginBottom: '1.25rem',
              }}
            >
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                "{confirmDeleteGame.title}"
              </div>
              <div style={{ display: 'flex', gap: '0.85rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                <span>Định dạng: <strong>{confirmDeleteGame.gameType}</strong></span>
                <span>•</span>
                <span>Số lượng: <strong>{confirmDeleteGame.questionCount} câu hỏi</strong></span>
              </div>
            </div>

            <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Toàn bộ nội dung câu hỏi, phương án trả lời và cài đặt của bộ câu hỏi này sẽ bị xóa hoàn toàn khỏi cơ sở dữ liệu.
            </p>

            {/* Cảnh báo chi tiết nếu game đang có phiên hoạt động */}
            {(!confirmDeleteGame.activeStatus?.isDeletable &&
              (confirmDeleteGame.activeStatus?.hasActiveSession ||
                confirmDeleteGame.activeStatus?.hasActiveRoom)) && (
              <div
                style={{
                  backgroundColor: 'rgba(245, 158, 11, 0.12)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  borderRadius: '12px',
                  padding: '0.85rem 1rem',
                  marginBottom: '1.25rem',
                  fontSize: '0.84rem',
                  color: 'var(--accent-amber)',
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span>⚠️</span>
                  <span>Bộ câu hỏi đang được sử dụng và tạm khóa xóa:</span>
                </div>
                {confirmDeleteGame.activeStatus?.hasActiveSession && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                      marginBottom: confirmDeleteGame.activeStatus.hasActiveRoom ? '0.35rem' : 0,
                    }}
                  >
                    <span>
                      • Đang có <strong>{confirmDeleteGame.activeStatus.activeSessionCount}</strong> phiên luyện tập chơi đơn
                    </span>
                    {confirmDeleteGame.activeStatus.activeSessions?.[0] && (
                      <button
                        type="button"
                        onClick={() => {
                          const sessId = confirmDeleteGame.activeStatus!.activeSessions[0].sessionId;
                          const g = confirmDeleteGame;
                          setConfirmDeleteGame(null);
                          setConfirmEndSessionModal({ game: g, sessionId: sessId });
                        }}
                        style={{
                          backgroundColor: 'rgba(249, 115, 22, 0.18)',
                          color: 'var(--accent-orange, #f97316)',
                          border: '1px solid rgba(249, 115, 22, 0.4)',
                          borderRadius: '6px',
                          padding: '0.2rem 0.55rem',
                          fontSize: '0.74rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        Kết thúc phiên đơn
                      </button>
                    )}
                  </div>
                )}
                {confirmDeleteGame.activeStatus?.hasActiveRoom && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span>
                      • Đang có phòng chơi trực tiếp (PIN: <strong>{confirmDeleteGame.activeStatus.activeRooms?.[0]?.roomCode}</strong>)
                    </span>
                    {confirmDeleteGame.activeStatus.activeRooms?.[0] && (
                      <button
                        type="button"
                        onClick={() => {
                          const rCode = confirmDeleteGame.activeStatus!.activeRooms[0].roomCode;
                          const g = confirmDeleteGame;
                          setConfirmDeleteGame(null);
                          setConfirmCloseRoomModal({ game: g, roomCode: rCode });
                        }}
                        style={{
                          backgroundColor: 'rgba(168, 85, 247, 0.18)',
                          color: 'var(--accent-purple, #a855f7)',
                          border: '1px solid rgba(168, 85, 247, 0.4)',
                          borderRadius: '6px',
                          padding: '0.2rem 0.55rem',
                          fontSize: '0.74rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        Đóng phòng chơi
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  setConfirmDeleteGame(null);
                }}
                style={{
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '10px',
                  padding: '0.65rem 1.25rem',
                  minHeight: '44px',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                }}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                style={{
                  backgroundColor: 'var(--accent-rose)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.65rem 1.35rem',
                  minHeight: '44px',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                }}
              >
                {isDeleting ? (
                  <>
                    <SpinnerIcon size={16} />
                    <span>Đang xóa...</span>
                  </>
                ) : (
                  <>
                    <TrashIcon size={16} />
                    <span>Xác nhận xóa vĩnh viễn</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Xác Nhận Kết Thúc Phiên Chơi Đơn */}
      {confirmEndSessionModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '2px solid rgba(249, 115, 22, 0.5)',
              borderRadius: '20px',
              padding: '1.75rem',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 25px 50px -12px rgba(249, 115, 22, 0.25)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '1.25rem' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(249, 115, 22, 0.15)',
                  color: 'var(--accent-orange, #f97316)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: '1.25rem',
                }}
              >
                🟠
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                  Kết Thúc Phiên Chơi Đơn
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Giải phóng khóa hoạt động cho bộ câu hỏi
                </span>
              </div>
            </div>

            <p style={{ margin: '0 0 1rem 0', fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
              Bạn có chắc chắn muốn kết thúc phiên luyện tập chơi đơn cho <strong>"{confirmEndSessionModal.game.title}"</strong> không?
            </p>

            <div
              style={{
                backgroundColor: 'var(--bg-input)',
                borderRadius: '10px',
                padding: '0.75rem 0.9rem',
                fontSize: '0.82rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.45,
                marginBottom: '1.25rem',
              }}
            >
              ℹ️ Phiên chơi đơn sẽ được chuyển sang trạng thái kết thúc an toàn. Điểm số và lịch sử đã hoàn thành vẫn được lưu trữ trong cơ sở dữ liệu. Khóa ngăn xóa bộ câu hỏi sẽ được mở khi không còn phiên hoặc phòng nào khác hoạt động.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                disabled={isEndingSession}
                onClick={() => setConfirmEndSessionModal(null)}
                style={{
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '10px',
                  padding: '0.6rem 1.15rem',
                  minHeight: '42px',
                  fontWeight: 700,
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                }}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isEndingSession}
                onClick={handleExecuteEndSession}
                style={{
                  backgroundColor: 'var(--accent-orange, #f97316)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.6rem 1.25rem',
                  minHeight: '42px',
                  fontWeight: 800,
                  fontSize: '0.88rem',
                  cursor: isEndingSession ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                {isEndingSession ? (
                  <>
                    <SpinnerIcon size={16} />
                    <span>Đang kết thúc...</span>
                  </>
                ) : (
                  <span>Xác nhận kết thúc phiên</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Xác Nhận Đóng Phòng Chơi Trực Tiếp */}
      {confirmCloseRoomModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '2px solid rgba(168, 85, 247, 0.5)',
              borderRadius: '20px',
              padding: '1.75rem',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 25px 50px -12px rgba(168, 85, 247, 0.25)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '1.25rem' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(168, 85, 247, 0.15)',
                  color: 'var(--accent-purple, #a855f7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: '1.25rem',
                }}
              >
                🟣
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                  Đóng Phòng Chơi Trực Tiếp
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Mã PIN phòng: <strong>{confirmCloseRoomModal.roomCode}</strong>
                </span>
              </div>
            </div>

            <p style={{ margin: '0 0 1rem 0', fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
              Bạn có chắc chắn muốn đóng phòng chơi trực tiếp (PIN: <strong>{confirmCloseRoomModal.roomCode}</strong>) của <strong>"{confirmCloseRoomModal.game.title}"</strong> không?
            </p>

            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '10px',
                padding: '0.75rem 0.9rem',
                fontSize: '0.82rem',
                color: 'var(--accent-rose)',
                lineHeight: 1.45,
                marginBottom: '1.25rem',
              }}
            >
              ⚠️ Phòng chơi sẽ được đóng ngay lập tức. Người chơi trong phòng sẽ nhận thông báo phòng đã kết thúc và được đưa về màn hình nhập PIN.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                disabled={isClosingRoom}
                onClick={() => setConfirmCloseRoomModal(null)}
                style={{
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '10px',
                  padding: '0.6rem 1.15rem',
                  minHeight: '42px',
                  fontWeight: 700,
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                }}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isClosingRoom}
                onClick={handleExecuteCloseRoom}
                style={{
                  backgroundColor: 'var(--accent-purple, #a855f7)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.6rem 1.25rem',
                  minHeight: '42px',
                  fontWeight: 800,
                  fontSize: '0.88rem',
                  cursor: isClosingRoom ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                {isClosingRoom ? (
                  <>
                    <SpinnerIcon size={16} />
                    <span>Đang đóng phòng...</span>
                  </>
                ) : (
                  <span>Xác nhận đóng phòng</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Xác Nhận Xóa Toàn Bộ Game */}
      {isConfirmDeleteAllOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-all-confirm-title"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '2px solid var(--accent-rose)',
              borderRadius: '20px',
              padding: '2rem',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 25px 50px -12px rgba(244, 63, 94, 0.35)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '1.25rem' }}>
              <div
                style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--accent-rose)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <TrashIcon size={24} />
              </div>
              <div>
                <h3 id="delete-all-confirm-title" style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                  Xác Nhận Xóa Tất Cả Game
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--accent-rose)', fontWeight: 700 }}>
                  Hành động nguy hiểm • Không thể hoàn tác
                </span>
              </div>
            </div>

            <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
              Bạn đang yêu cầu <strong>xóa vĩnh viễn toàn bộ {totalCount} bộ câu hỏi</strong> trong kho game chung.
            </p>

            <div
              style={{
                padding: '0.75rem 0.9rem',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                borderRadius: '10px',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                color: 'var(--accent-rose)',
                fontSize: '0.82rem',
                lineHeight: 1.45,
                marginBottom: '1.5rem',
              }}
            >
              ⚠️ <strong>Cảnh báo:</strong> Toàn bộ dữ liệu câu hỏi, đáp án và kết quả liên quan sẽ bị xóa vĩnh viễn khỏi hệ thống database. Các game đang có phòng thi đấu hoặc phiên chơi trực tiếp đang diễn ra sẽ được tự động bỏ qua để tránh gián đoạn người chơi.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                disabled={isDeletingAll}
                onClick={() => setIsConfirmDeleteAllOpen(false)}
                style={{
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '10px',
                  padding: '0.65rem 1.25rem',
                  minHeight: '44px',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                }}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isDeletingAll}
                onClick={handleDeleteAllGames}
                style={{
                  backgroundColor: 'var(--accent-rose)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.65rem 1.35rem',
                  minHeight: '44px',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  cursor: isDeletingAll ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  boxShadow: '0 4px 14px rgba(239, 68, 68, 0.4)',
                }}
              >
                {isDeletingAll ? (
                  <>
                    <SpinnerIcon size={16} />
                    <span>Đang xóa toàn bộ...</span>
                  </>
                ) : (
                  <>
                    <TrashIcon size={16} />
                    <span>Xác nhận xóa tất cả</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CHỌN CHẾ ĐỘ CHƠI (CHƠI ĐƠN VS MULTIPLAYER) - LUỒNG 2 */}
      <GameModeSelectionModal
        isOpen={isModeModalOpen}
        onClose={() => setIsModeModalOpen(false)}
        gameSpec={modeModalSpec}
        onStartSoloPresentation={(spec) => {
          setIsModeModalOpen(false);
          if (onNavigateToSoloPresentation) {
            onNavigateToSoloPresentation(spec);
          } else {
            handlePlaySavedGame(spec.gameId, true);
          }
        }}
        onCreateMultiplayerRoom={async (spec) => {
          try {
            const roomData = await createRoom({
              gameId: spec.gameId,
              capacity: 300,
              requirePublished: true,
            });
            return {
              roomCode: roomData.roomCode,
              hostToken: roomData.hostToken,
              joinUrl: roomData.joinUrl,
            };
          } catch (err: any) {
            toast.error(err.message || 'Không thể tạo phòng chơi.', 'Lỗi tạo phòng');
            return null;
          }
        }}
        onPublishGame={async (gameId) => {
          try {
            await publishGame(gameId);
            toast.success('Đã xuất bản game công khai thành công!', 'Xuất bản thành công');
            loadSavedGames();
            return true;
          } catch (err: any) {
            toast.error(err.message || 'Không thể xuất bản game.', 'Lỗi xuất bản');
            return false;
          }
        }}
        onNavigateToHost={onNavigateToHost}
        isOwner={true}
      />
    </div>
  );
};
export default AnalyticsPage;
