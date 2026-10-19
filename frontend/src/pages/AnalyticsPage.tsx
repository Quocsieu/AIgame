import React, { useEffect, useState } from 'react';
import { useToast } from '../components/ToastContext.js';
import {
  deleteSavedGame,
  downloadGameExport,
  fetchGameById,
  fetchSavedGames,
  saveEditedQuestions,
} from '../services/api.js';
import type {
  GameQuestion,
  GameSpecification,
  PersistedGameSummary,
  QuestionType,
} from '../types/index.js';

interface AnalyticsPageProps {
  onSelectSavedGame?: (spec: GameSpecification) => void;
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

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({
  onSelectSavedGame,
}) => {
  const toast = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [savedGames, setSavedGames] = useState<PersistedGameSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  // Bộ lọc & tìm kiếm
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('ALL');

  // Chi tiết & chỉnh sửa bộ câu hỏi đang mở
  const [activeGameSpec, setActiveGameSpec] = useState<GameSpecification | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editQuestions, setEditQuestions] = useState<GameQuestion[]>([]);
  const [isSavingEdits, setIsSavingEdits] = useState(false);

  // Xác nhận xóa bộ câu hỏi
  const [confirmDeleteGame, setConfirmDeleteGame] = useState<PersistedGameSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadSavedGames = async (search = searchQuery, gameType = selectedTypeFilter) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchSavedGames({
        limit: 50,
        gameType: gameType !== 'ALL' ? gameType : undefined,
        search: search.trim() || undefined,
      });
      setSavedGames(data.games || []);
      setTotalCount(data.total ?? (data.games ? data.games.length : 0));
    } catch (err: any) {
      setErrorMessage(err.message || 'Không thể tải danh sách bộ câu hỏi đã tạo.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSavedGames(searchQuery, selectedTypeFilter);
  }, [selectedTypeFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadSavedGames(searchQuery, selectedTypeFilter);
  };

  const handleViewOrEditGame = async (gameId: string, startInEditMode: boolean = false) => {
    setIsDetailLoading(true);
    try {
      const spec = await fetchGameById(gameId);
      setActiveGameSpec(spec);
      setEditTitle(spec.title);
      setEditDescription(spec.description);
      setEditQuestions(spec.questions.map((q) => ({ ...q, choices: q.choices ? [...q.choices] : undefined })));
      setIsEditMode(startInEditMode);
    } catch (err: any) {
      toast.error(err.message || 'Không thể tải chi tiết bộ câu hỏi.', 'Lỗi');
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handlePlaySavedGame = async (gameId: string) => {
    try {
      const spec = activeGameSpec?.gameId === gameId ? activeGameSpec : await fetchGameById(gameId);
      if (onSelectSavedGame) {
        onSelectSavedGame(spec);
      }
      toast.success(`Đã nạp bộ câu hỏi "${spec.title}" để luyện tập hoặc mở phòng chơi.`, 'Sẵn sàng chơi');
    } catch (err: any) {
      toast.error(err.message || 'Không thể mở lại bộ câu hỏi.', 'Lỗi');
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
      await loadSavedGames(searchQuery, selectedTypeFilter);
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
          } else if (patch.type === 'QUICK_BUTTON') {
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
      });
      setActiveGameSpec(updated);
      setIsEditMode(false);
      toast.success('Đã lưu cập nhật bộ câu hỏi thành công.', 'Đã lưu');
      await loadSavedGames(searchQuery, selectedTypeFilter);
    } catch (err: any) {
      toast.error(err.message || 'Không thể lưu chỉnh sửa câu hỏi.', 'Lỗi lưu');
    } finally {
      setIsSavingEdits(false);
    }
  };

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
            📚 Bộ Câu Hỏi Đã Tạo
          </h1>
          <p style={{ margin: '0.35rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
            Xem lại, tìm kiếm, chỉnh sửa nội dung, xuất tệp CSV/JSON hoặc chơi lại các bộ câu hỏi đã tạo.
          </p>
        </div>

        <button
          type="button"
          onClick={() => loadSavedGames(searchQuery, selectedTypeFilter)}
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
          {isLoading ? '⏳ Đang tải...' : '🔄 Làm mới danh sách'}
        </button>
      </div>

      {/* Thanh tìm kiếm & lọc theo loại trò chơi */}
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
                loadSavedGames('', selectedTypeFilter);
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Loại câu hỏi:
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
              fontSize: '0.86rem',
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
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
                        padding: '0.65rem 0.85rem',
                        borderRadius: '8px',
                        border: '1px solid var(--border-strong)',
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        fontWeight: 800,
                        fontSize: '1rem',
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
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      • {activeGameSpec.questions.length} câu hỏi • Chế độ điểm: {formatScoringModeName(activeGameSpec.settings.scoringMode)}
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
                      setEditTitle(activeGameSpec.title);
                      setEditDescription(activeGameSpec.description);
                      setEditQuestions(activeGameSpec.questions.map((q) => ({ ...q, choices: q.choices ? [...q.choices] : undefined })));
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
                    onClick={() => handlePlaySavedGame(activeGameSpec.gameId)}
                    style={{
                      backgroundColor: 'var(--primary)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '0.55rem 1rem',
                      fontWeight: 800,
                      fontSize: '0.84rem',
                      cursor: 'pointer',
                    }}
                  >
                    🎮 Chơi / Mở Phòng
                  </button>
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
                    ✏️ Chỉnh sửa câu hỏi
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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

                    {q.type === 'MULTIPLE_CHOICE' && q.choices && (
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
                        {q.type === 'QUICK_BUTTON' ? (
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
                            <option value="Đúng">Đúng</option>
                            <option value="Sai">Sai</option>
                          </select>
                        ) : q.type === 'MULTIPLE_CHOICE' && q.choices ? (
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
            🗂️ Danh Sách Bộ Câu Hỏi Đã Lưu ({savedGames.length})
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
                    <div style={{ fontWeight: 900, color: 'var(--text-primary)', fontSize: '1.02rem' }}>
                      {g.title}
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
                      <span>• {new Date(g.createdAt).toLocaleString('vi-VN')}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => handlePlaySavedGame(g.gameId)}
                      style={{
                        backgroundColor: 'var(--primary)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '0.48rem 0.85rem',
                        fontWeight: 800,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                      }}
                    >
                      🎮 Chơi lại
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
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

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
    </div>
  );
};
export default AnalyticsPage;
