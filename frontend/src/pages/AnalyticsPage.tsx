import React, { useEffect, useState } from 'react';
import { GameModeSelectionModal } from '../components/GameModeSelectionModal.js';
import { useToast } from '../components/ToastContext.js';
import {
  createRoom,
  deleteSavedGame,
  downloadGameExport,
  fetchCurrentUser,
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

const PAGE_SIZE = 6;

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({
  onSelectSavedGame,
  onNavigateToHost,
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

  const handleConfirmDelete = async () => {
    if (!confirmDeleteGame) return;
    setIsDeleting(true);
    try {
      await deleteSavedGame(confirmDeleteGame.gameId);
      toast.success(`Đã xóa bộ câu hỏi "${confirmDeleteGame.title}".`, 'Đã xóa');
      if (activeGameSpec?.gameId === confirmDeleteGame.gameId) {
        setActiveGameSpec(null);
      }
      setConfirmDeleteGame(null);
      await loadSavedGames(page, searchQuery, selectedTypeFilter, statusFilter);
    } catch (err: any) {
      toast.error(err.message || 'Không thể xóa bộ câu hỏi.', 'Lỗi xóa');
    } finally {
      setIsDeleting(false);
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
      activeGameSpec.gameType === 'MIXED' ? 'MULTIPLE_CHOICE' : activeGameSpec.gameType;
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
    <div style={{ maxWidth: '1080px', margin: '0 auto', padding: '0.5rem 0 2.5rem 0' }}>
      {/* Tiêu đề trang */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '1.85rem', fontWeight: 900, color: 'var(--text-primary)' }}>
            📚 Kho Game & Bộ Câu Hỏi Dùng Chung
          </h1>
          <p style={{ margin: '0.35rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
            Quản lý, tìm kiếm, lọc theo trạng thái/thể loại, chỉnh sửa câu hỏi, chia sẻ Link/QR chơi đơn và mở phòng Multiplayer.
          </p>
        </div>

        <button
          type="button"
          onClick={() => loadSavedGames(page, searchQuery, selectedTypeFilter, statusFilter)}
          disabled={isLoading}
          style={{
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-strong)',
            borderRadius: '10px',
            padding: '0.6rem 1.1rem',
            fontWeight: 700,
            fontSize: '0.88rem',
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {isLoading ? '⏳ Đang tải...' : '🔄 Làm mới kho game'}
        </button>
      </div>

      {/* Thanh tìm kiếm & lọc theo loại trò chơi / trạng thái */}
      <section
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '14px',
          padding: '1.1rem 1.25rem',
          marginBottom: '1.5rem',
          boxShadow: 'var(--card-shadow)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.85rem',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <form
          onSubmit={handleSearchSubmit}
          style={{ display: 'flex', gap: '0.6rem', flex: '1 1 320px' }}
        >
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="🔍 Tìm kiếm theo tiêu đề hoặc mô tả bộ câu hỏi..."
            style={{
              flex: 1,
              padding: '0.65rem 0.9rem',
              borderRadius: '8px',
              border: '1px solid var(--border-strong)',
              backgroundColor: 'var(--bg-input)',
              color: 'var(--text-primary)',
              fontSize: '0.88rem',
            }}
          />
          <button
            type="submit"
            style={{
              backgroundColor: 'var(--primary)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              padding: '0.65rem 1rem',
              fontWeight: 800,
              fontSize: '0.86rem',
              cursor: 'pointer',
            }}
          >
            Tìm kiếm
          </button>
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setPage(1);
                loadSavedGames(1, '', selectedTypeFilter, statusFilter);
              }}
              style={{
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-strong)',
                borderRadius: '8px',
                padding: '0.65rem 0.85rem',
                fontWeight: 700,
                fontSize: '0.84rem',
                cursor: 'pointer',
              }}
            >
              Xóa lọc
            </button>
          )}
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
              Trạng thái:
            </span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'PUBLISHED' | 'DRAFT')}
              style={{
                padding: '0.6rem 0.8rem',
                borderRadius: '8px',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              <option value="ALL">Tất cả trạng thái</option>
              <option value="PUBLISHED">🚀 Đã xuất bản</option>
              <option value="DRAFT">📝 Bản nháp</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
              Thể loại:
            </span>
            <select
              value={selectedTypeFilter}
              onChange={(e) => setSelectedTypeFilter(e.target.value)}
              style={{
                padding: '0.6rem 0.85rem',
                borderRadius: '8px',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              <option value="ALL">Tất cả ({totalCount})</option>
              <option value="MULTIPLE_CHOICE">Trắc nghiệm ABCD</option>
              <option value="FILL_IN_THE_BLANK">Điền từ</option>
              <option value="QUICK_BUTTON">Đúng / Sai</option>
              <option value="CROSSWORD">Ô chữ</option>
              <option value="MIXED">Hỗn hợp (Mixed)</option>
            </select>
          </div>
        </div>
      </section>

      {errorMessage && (
        <div
          style={{
            padding: '1rem 1.25rem',
            borderRadius: '12px',
            backgroundColor: 'rgba(244, 63, 94, 0.12)',
            border: '1px solid var(--accent-rose)',
            color: 'var(--accent-rose)',
            marginBottom: '1.5rem',
            fontWeight: 700,
          }}
        >
          ⚠️ {errorMessage}
        </div>
      )}

      {/* KHỐI XEM CHI TIẾT & CHỈNH SỬA BỘ CÂU HỎI ĐANG CHỌN */}
      {activeGameSpec && (
        <section
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '2px solid var(--primary)',
            borderRadius: '16px',
            padding: '1.5rem',
            marginBottom: '1.75rem',
            boxShadow: 'var(--card-shadow)',
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
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                        Tiêu đề bộ câu hỏi:
                      </label>
                      <input
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
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                        Mô tả:
                      </label>
                      <input
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
                        }}
                      />
                    </div>
                  </div>

                  {/* Cấu hình thời gian, điểm số & trạng thái xuất bản */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                        Thời gian mỗi câu (5-60 giây):
                      </label>
                      <input
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
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                        Chế độ tính điểm:
                      </label>
                      <select
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
                        }}
                      >
                        <option value="SPEED_BONUS">Thưởng tốc độ (Speed Bonus)</option>
                        <option value="STANDARD">Tiêu chuẩn (Standard)</option>
                        <option value="STREAK">Chuỗi đúng (Streak)</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                        Trạng thái xuất bản:
                      </label>
                      <select
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
                        }}
                      >
                        <option value="PUBLISHED">🚀 Đã xuất bản (Cho phép chơi & mở phòng)</option>
                        <option value="DRAFT">📝 Bản nháp (Ẩn khỏi người chơi)</option>
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
                      }}
                    >
                      {activeGameSpec.isPublic ? '🚀 Đã xuất bản' : '📝 Bản nháp'}
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
                      fontWeight: 800,
                      fontSize: '0.84rem',
                      cursor: isSavingEdits ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isSavingEdits ? '⏳ Đang lưu...' : '💾 Lưu Thay Đổi'}
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
                      fontWeight: 800,
                      fontSize: '0.84rem',
                      cursor: 'pointer',
                    }}
                  >
                    ➕ Thêm câu hỏi
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
                      fontWeight: 800,
                      fontSize: '0.83rem',
                      cursor: 'pointer',
                    }}
                  >
                    🎯 Chơi đơn
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
                          fontWeight: 800,
                          fontSize: '0.83rem',
                          cursor: 'pointer',
                        }}
                      >
                        🔗 Link / QR Chơi đơn
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
                          fontWeight: 800,
                          fontSize: '0.83rem',
                          cursor: 'pointer',
                        }}
                      >
                        {isOpeningRoomGameId === activeGameSpec.gameId
                          ? '⏳ Đang mở phòng...'
                          : '🏟️ Mở phòng Multiplayer'}
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
                      fontWeight: 800,
                      fontSize: '0.84rem',
                      cursor: 'pointer',
                    }}
                  >
                    ✏️ Sửa game
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
                      fontWeight: 800,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    📥 Xuất CSV
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
                      fontWeight: 800,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    📄 Xuất JSON
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
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                ✕ Đóng
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
                          padding: '0.25rem 0.55rem',
                          borderRadius: '6px',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--accent-sky)',
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        📋 Nhân bản
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
                          padding: '0.25rem 0.6rem',
                          fontSize: '0.76rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        🗑️ Xóa câu
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
                    <div style={{ fontSize: '0.82rem', color: 'var(--accent-emerald)', fontWeight: 800 }}>
                      ✓ Đáp án đúng: {q.correctAnswer}
                    </div>
                    {q.explanation && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                        💡 Giải thích: {q.explanation}
                      </div>
                    )}
                    {q.sourceReference && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        📌 Nguồn: {q.sourceReference.sourceLocation}
                        {q.sourceReference.section ? ` — ${q.sourceReference.section}` : ''}
                        {q.sourceReference.page ? ` (Trang ${q.sourceReference.page})` : ''}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* DANH SÁCH CÁC BỘ CÂU HỎI ĐÃ TẠO */}
      <section
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '16px',
          padding: '1.5rem',
          boxShadow: 'var(--card-shadow)',
        }}
      >
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
          <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            🗂️ Kho Game Dùng Chung ({totalCount} bộ câu hỏi)
          </h2>
          {isDetailLoading && (
            <span style={{ fontSize: '0.84rem', color: 'var(--accent-sky)', fontWeight: 700 }}>
              ⏳ Đang tải chi tiết bộ câu hỏi...
            </span>
          )}
        </div>

        {savedGames.length === 0 ? (
          <div
            style={{
              padding: '2rem 1.25rem',
              borderRadius: '12px',
              backgroundColor: 'var(--bg-input)',
              border: '1px dashed var(--border-strong)',
              textAlign: 'center',
              color: 'var(--text-secondary)',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📭</div>
            <div style={{ fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.3rem', fontSize: '1rem' }}>
              Chưa tìm thấy bộ câu hỏi nào
            </div>
            <div style={{ fontSize: '0.88rem' }}>
              Hãy chuyển sang tab <strong>📋 Tạo Game</strong> để trích xuất tài liệu/URL và tạo bộ câu hỏi mới bằng AI.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {savedGames.map((g) => {
              const isSelected = activeGameSpec?.gameId === g.gameId;
              return (
                <div
                  key={g.gameId}
                  style={{
                    padding: '1rem 1.2rem',
                    borderRadius: '12px',
                    backgroundColor: 'var(--bg-input)',
                    border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '0.85rem',
                  }}
                >
                  <div style={{ flex: '1 1 300px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 900, color: 'var(--text-primary)', fontSize: '1.02rem' }}>
                        {g.title}
                      </div>
                      <span
                        style={{
                          backgroundColor: g.isPublic
                            ? 'rgba(16, 185, 129, 0.14)'
                            : 'rgba(245, 158, 11, 0.15)',
                          color: g.isPublic ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                          padding: '0.15rem 0.55rem',
                          borderRadius: '6px',
                          fontSize: '0.73rem',
                          fontWeight: 800,
                        }}
                      >
                        {g.isPublic ? '🚀 Đã xuất bản' : '📝 Bản nháp'}
                      </span>
                    </div>
                    {g.description && (
                      <div style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                        {g.description}
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: '0.78rem',
                        color: 'var(--text-muted)',
                        marginTop: '0.4rem',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.6rem',
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          backgroundColor: 'rgba(56, 189, 248, 0.12)',
                          color: 'var(--accent-sky)',
                          padding: '0.15rem 0.55rem',
                          borderRadius: '6px',
                          fontWeight: 800,
                        }}
                      >
                        {formatGameTypeName(g.gameType)}
                      </span>
                      <span>• {g.questionCount} câu hỏi</span>
                      <span>• {g.timePerQuestion}s/câu</span>
                      <span>• Điểm: {formatScoringModeName(g.scoringMode)}</span>
                      <span>• Cập nhật: {new Date(g.updatedAt || g.createdAt).toLocaleString('vi-VN')}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {/* NÚT CHÍNH: MỞ GAME & CHỌN CHẾ ĐỘ CHƠI (LUỒNG 2) */}
                    <button
                      type="button"
                      onClick={() => handleOpenModeModal(g.gameId)}
                      style={{
                        backgroundColor: 'var(--primary)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '0.48rem 0.95rem',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        boxShadow: 'var(--btn-shadow)',
                      }}
                    >
                      ▶️ Mở Game
                    </button>

                    <button
                      type="button"
                      onClick={() => handleViewOrEditGame(g.gameId, false)}
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '8px',
                        padding: '0.48rem 0.8rem',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                      }}
                    >
                      👁️ Chi tiết
                    </button>

                    {/* CHỈ ADMIN ĐƯỢC PHÉP SỬA & XÓA TRONG KHO GAME */}
                    {currentUser?.role === 'ADMIN' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleViewOrEditGame(g.gameId, true)}
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            color: 'var(--accent-amber)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: '8px',
                            padding: '0.48rem 0.8rem',
                            fontWeight: 800,
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                          }}
                        >
                          ✏️ Sửa
                        </button>

                        <button
                          type="button"
                          onClick={() => setConfirmDeleteGame(g)}
                          style={{
                            backgroundColor: 'rgba(244, 63, 94, 0.12)',
                            color: 'var(--accent-rose)',
                            border: '1px solid var(--accent-rose)',
                            borderRadius: '8px',
                            padding: '0.48rem 0.75rem',
                            fontWeight: 800,
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                          }}
                        >
                          🗑️ Xóa
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => handleExportGame(g.gameId, 'csv')}
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        color: 'var(--accent-emerald)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '8px',
                        padding: '0.48rem 0.75rem',
                        fontWeight: 800,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                      }}
                    >
                      📥 CSV
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExportGame(g.gameId, 'json')}
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        color: 'var(--accent-sky)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '8px',
                        padding: '0.48rem 0.75rem',
                        fontWeight: 800,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                      }}
                    >
                      📄 JSON
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Thanh phân trang */}
        {totalCount > PAGE_SIZE && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '1.25rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border-subtle)',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}
          >
            <span style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
              Trang {page} / {totalPages} • Tổng cộng {totalCount} bộ câu hỏi
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                disabled={page <= 1 || isLoading}
                onClick={() => handlePageChange(page - 1)}
                style={{
                  padding: '0.5rem 0.95rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: page <= 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                  fontWeight: 800,
                  fontSize: '0.84rem',
                  cursor: page <= 1 ? 'not-allowed' : 'pointer',
                }}
              >
                ← Trang trước
              </button>
              <button
                type="button"
                disabled={!hasMore || isLoading}
                onClick={() => handlePageChange(page + 1)}
                style={{
                  padding: '0.5rem 0.95rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: !hasMore ? 'var(--text-muted)' : 'var(--text-primary)',
                  fontWeight: 800,
                  fontSize: '0.84rem',
                  cursor: !hasMore ? 'not-allowed' : 'pointer',
                }}
              >
                Trang tiếp →
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Modal Chia Sẻ Link / QR Chơi Đơn */}
      {soloShareData && (
        <div
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
            <h3 style={{ margin: '0 0 0.4rem 0', fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)' }}>
              🔗 Chia Sẻ Chơi Đơn (Link & QR)
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
                value={soloShareData.playUrl}
                style={{
                  flex: 1,
                  padding: '0.55rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
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
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                📋 Copy Link
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
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                🎯 Chơi đơn ngay
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
            <h3 style={{ margin: '0 0 0.4rem 0', fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)' }}>
              🏟️ Phòng Chơi Multiplayer Đã Mở!
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
                value={multiplayerShareData.joinUrl}
                style={{
                  flex: 1,
                  padding: '0.55rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
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
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                📋 Copy Link
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
                    fontWeight: 800,
                    fontSize: '0.86rem',
                    cursor: 'pointer',
                  }}
                >
                  🚀 Vào Màn Hình Điều Khiển (Host)
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
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: '16px',
              padding: '1.5rem',
              width: '100%',
              maxWidth: '420px',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <h3 style={{ margin: '0 0 0.65rem 0', fontSize: '1.15rem', fontWeight: 900, color: 'var(--text-primary)' }}>
              🗑️ Xác Nhận Xóa Bộ Câu Hỏi
            </h3>
            <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Bạn có chắc chắn muốn xóa vĩnh viễn bộ câu hỏi{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{confirmDeleteGame.title}"</strong> ({confirmDeleteGame.questionCount} câu hỏi)?
              Thao tác này không thể hoàn tác.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setConfirmDeleteGame(null)}
                style={{
                  backgroundColor: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '8px',
                  padding: '0.55rem 1rem',
                  fontWeight: 700,
                  fontSize: '0.86rem',
                  cursor: 'pointer',
                }}
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                style={{
                  backgroundColor: 'var(--accent-rose)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.55rem 1rem',
                  fontWeight: 800,
                  fontSize: '0.86rem',
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                }}
              >
                {isDeleting ? '⏳ Đang xóa...' : 'Xác nhận xóa'}
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
        onStartSoloPlay={(spec) => {
          setIsModeModalOpen(false);
          handlePlaySavedGame(spec.gameId, true);
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
        isOwner={currentUser?.role === 'ADMIN'}
      />
    </div>
  );
};
export default AnalyticsPage;
