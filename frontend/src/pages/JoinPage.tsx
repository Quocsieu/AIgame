import React, { useState, useEffect } from 'react';
import { useToast } from '../components/ToastContext.js';
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  GamepadIcon,
  LinkIcon,
  QrCodeIcon,
  SpinnerIcon,
  UsersIcon,
} from '../components/Icons.js';
import { fetchRoomLobby, fetchGameParticipantsApi, type RoomLobbyInfo } from '../services/api.js';
import type { PublicParticipantItem, RosterMode } from '../types/index.js';

interface JoinPageProps {
  initialRoomCode?: string;
  onJoin: (roomCode: string, displayName: string) => void;
}

function normalizeVietnameseSearch(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export const JoinPage: React.FC<JoinPageProps> = ({ initialRoomCode = '', onJoin }) => {
  const toast = useToast();

  const [roomCode, setRoomCode] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifiedLobby, setVerifiedLobby] = useState<RoomLobbyInfo | null>(null);

  const [displayName, setDisplayName] = useState(() => {
    try {
      return sessionStorage.getItem('active_player_name') || '';
    } catch {
      return '';
    }
  });

  const [pasteInput, setPasteInput] = useState('');
  const [showPasteSection, setShowPasteSection] = useState(false);

  // V2/V3 Roster Gate State
  const [rosterMode, setRosterMode] = useState<RosterMode>('FREE_TEXT');
  const [rosterParticipants, setRosterParticipants] = useState<PublicParticipantItem[]>([]);
  const [rosterSearch, setRosterSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);
  const [selectedParticipant, setSelectedParticipant] = useState<PublicParticipantItem | null>(null);
  const [departmentInput, setDepartmentInput] = useState(() => {
    try {
      return sessionStorage.getItem('active_player_department') || '';
    } catch {
      return '';
    }
  });
  const [confirmedIdentity, setConfirmedIdentity] = useState(false);

  // Tải danh sách thí sinh công khai khi phòng có cấu hình Roster
  useEffect(() => {
    if (!verifiedLobby?.gameId) {
      setRosterParticipants([]);
      setSelectedParticipant(null);
      setConfirmedIdentity(false);
      return;
    }
    const mode = (verifiedLobby.rosterMode as RosterMode) || 'FREE_TEXT';
    setRosterMode(mode);
    if (mode !== 'FREE_TEXT' || verifiedLobby.hasRoster) {
      fetchGameParticipantsApi(verifiedLobby.gameId, { mode: 'public' })
        .then((res) => {
          setRosterParticipants(res.participants || []);
          if (res.rosterMode) setRosterMode(res.rosterMode);
        })
        .catch(() => {
          setRosterParticipants([]);
        });
    } else {
      setRosterParticipants([]);
    }
  }, [verifiedLobby]);

  // Verify room code when passed as prop (e.g. from QR / URL)
  useEffect(() => {
    const raw = (initialRoomCode || '').trim().toUpperCase();
    if (raw && raw.length >= 4) {
      setIsVerifyingPin(true);
      setPinError(null);
      fetchRoomLobby(raw)
        .then((lobby) => {
          if (lobby.state === 'CLOSED') {
            setPinError('Phòng chơi này đã kết thúc hoặc bị đóng bởi Host.');
            setRoomCode('');
            setVerifiedLobby(null);
          } else {
            setRoomCode(lobby.roomCode);
            setVerifiedLobby(lobby);
            setPinInput(lobby.roomCode);
          }
        })
        .catch((err: any) => {
          setPinError(err.message || 'Mã phòng không tồn tại hoặc đã hết hạn.');
          setRoomCode('');
          setVerifiedLobby(null);
        })
        .finally(() => {
          setIsVerifyingPin(false);
        });
    } else {
      setRoomCode('');
      setVerifiedLobby(null);
      setPinError(null);
    }
  }, [initialRoomCode]);

  // Handle direct PIN input submit
  const handleVerifyPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = pinInput.trim().toUpperCase();

    if (!cleanCode) {
      setPinError('Vui lòng nhập mã PIN phòng chơi.');
      toast.warning('Vui lòng nhập mã PIN phòng chơi.', 'Thiếu mã PIN');
      return;
    }

    if (cleanCode.length < 4) {
      setPinError('Mã PIN phòng chơi hợp lệ phải có từ 4 đến 6 ký tự.');
      toast.warning('Mã PIN phòng chơi hợp lệ phải có từ 4 đến 6 ký tự.', 'Mã PIN không hợp lệ');
      return;
    }

    setIsVerifyingPin(true);
    setPinError(null);

    try {
      const lobby = await fetchRoomLobby(cleanCode);
      if (lobby.state === 'CLOSED') {
        setPinError('Phòng thi đấu này đã kết thúc hoặc đã bị đóng.');
        toast.error('Phòng thi đấu này đã kết thúc hoặc đã bị đóng.', 'Phòng đã đóng');
        setRoomCode('');
        setVerifiedLobby(null);
        return;
      }

      setRoomCode(lobby.roomCode);
      setVerifiedLobby(lobby);
      setPinInput(lobby.roomCode);
      try {
        window.history.replaceState({}, '', `/?room=${lobby.roomCode}`);
      } catch {}
      toast.success(`Đã kết nối phòng #${lobby.roomCode} - ${lobby.title}`, 'Kết nối thành công');
    } catch (err: any) {
      setPinError(err.message || 'Mã PIN không tồn tại hoặc phòng chơi đã hết hạn. Vui lòng kiểm tra lại.');
      toast.error('Không tìm thấy phòng chơi tương ứng với mã PIN này.', 'Mã PIN không đúng');
      setRoomCode('');
      setVerifiedLobby(null);
    } finally {
      setIsVerifyingPin(false);
    }
  };

  // Fallback: Extract from pasted URL or text
  const handleExtractFromPaste = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = pasteInput.trim();
    if (!raw) {
      toast.error('Vui lòng dán liên kết hoặc mã phòng chơi.', 'Thiếu liên kết');
      return;
    }

    let extracted = '';
    try {
      if (raw.includes('room=')) {
        const url = new URL(raw.startsWith('http') ? raw : `http://${raw}`);
        extracted = url.searchParams.get('room') || '';
      }
    } catch {}

    if (!extracted) {
      const match = raw.match(/[A-Za-z0-9]{4,6}/);
      if (match) {
        extracted = match[0];
      } else {
        extracted = raw.replace(/[^A-Za-z0-9]/g, '').slice(0, 6);
      }
    }

    if (extracted && extracted.length >= 4) {
      setPinInput(extracted.toUpperCase());
      setPasteInput('');
      setShowPasteSection(false);
      // Trigger verification
      setIsVerifyingPin(true);
      setPinError(null);
      fetchRoomLobby(extracted.toUpperCase())
        .then((lobby) => {
          if (lobby.state === 'CLOSED') {
            setPinError('Phòng chơi này đã kết thúc hoặc bị đóng bởi Host.');
          } else {
            setRoomCode(lobby.roomCode);
            setVerifiedLobby(lobby);
            toast.success(`Đã nhận diện phòng chơi: ${lobby.roomCode}`, 'Kết nối thành công');
          }
        })
        .catch((err: any) => {
          setPinError(err.message || 'Không tìm thấy phòng chơi hợp lệ.');
        })
        .finally(() => {
          setIsVerifyingPin(false);
        });
    } else {
      toast.error('Không tìm thấy mã phòng hợp lệ trong nội dung vừa dán.', 'Liên kết không hợp lệ');
    }
  };

  // Handle final join with nickname or BTC roster identity
  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = roomCode.trim().toUpperCase();
    const isExamRoom = verifiedLobby?.sessionMode === 'EXAM';
    const hasRosterList = rosterParticipants.length > 0;
    const isPreconfigured =
      (isExamRoom || rosterMode === 'PRECONFIGURED' || (rosterMode === 'HYBRID' && selectedParticipant)) &&
      hasRosterList;

    if (!cleanCode) {
      toast.error('Chưa có mã phòng chơi. Vui lòng nhập mã PIN trước.', 'Thiếu mã PIN');
      return;
    }

    if (isExamRoom && !hasRosterList) {
      toast.error('Phòng thi ở chế độ THI bắt buộc phải có danh sách thí sinh từ Ban Tổ Chức.', 'Chưa có danh sách thí sinh');
      return;
    }

    if ((isExamRoom || rosterMode === 'PRECONFIGURED' || hasRosterList) && rosterMode !== 'FREE_TEXT' && !selectedParticipant) {
      toast.error('Vui lòng chọn tên của bạn từ danh sách người tham gia.', 'Chưa chọn tên');
      return;
    }

    if ((isPreconfigured || selectedParticipant) && !confirmedIdentity) {
      toast.warning('Vui lòng tích chọn xác nhận "Đây là tôi" trước khi vào phòng.', 'Xác nhận danh tính');
      return;
    }

    const cleanName = selectedParticipant ? selectedParticipant.fullName : displayName.trim();
    const cleanDept = selectedParticipant
      ? selectedParticipant.departmentUnit || ''
      : departmentInput.trim();

    if (!cleanName) {
      toast.error('Vui lòng nhập tên hoặc biệt danh của bạn.', 'Thiếu tên người chơi');
      return;
    }

    try {
      sessionStorage.setItem('active_player_name', cleanName);
      sessionStorage.setItem('active_player_department', cleanDept);
      if (selectedParticipant) {
        sessionStorage.setItem('active_player_participant_id', selectedParticipant.participantId);
      } else {
        sessionStorage.removeItem('active_player_participant_id');
      }
      let lockTok = sessionStorage.getItem('active_player_lock_token');
      if (!lockTok) {
        lockTok = `lock_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        sessionStorage.setItem('active_player_lock_token', lockTok);
      }
    } catch {}

    toast.info(`Đang kết nối vào phòng ${cleanCode}...`, 'Tham gia phòng');
    onJoin(cleanCode, cleanName);
  };

  const handleResetRoom = () => {
    setRoomCode('');
    setVerifiedLobby(null);
    setPinInput('');
    setPinError(null);
    try {
      window.history.replaceState({}, '', '/?tab=join');
    } catch {}
  };

  const isRoomReady = Boolean(roomCode && roomCode.length >= 4 && verifiedLobby);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '78vh', padding: '1rem' }}>
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '2px solid var(--border-subtle)',
          borderRadius: '24px',
          padding: '2.5rem 2rem',
          width: '100%',
          maxWidth: '440px',
          boxShadow: 'var(--shadow-lg)',
          animation: 'popIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header Icon & Title */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              backgroundColor: 'var(--bg-elevated)',
              border: '1.5px solid var(--primary)',
              boxShadow: '0 0 16px var(--primary-subtle)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1rem',
              color: 'var(--primary)',
            }}
          >
            {isRoomReady ? <GamepadIcon size={28} /> : <UsersIcon size={28} />}
          </div>
          <h1 style={{ margin: 0, fontSize: '1.85rem', color: 'var(--text-primary)', fontWeight: 900, letterSpacing: '-0.03em' }}>
            {isRoomReady ? 'Sẵn Sàng Tranh Tài' : 'Tham Gia Phòng Đấu'}
          </h1>
          <p style={{ margin: '0.4rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
            {isRoomReady
              ? 'Phòng đã sẵn sàng! Nhập tên hoặc biệt danh để vào trận đấu.'
              : 'Nhập mã PIN hiển thị trên màn hình của Host để vào phòng'}
          </p>
        </div>

        {isRoomReady ? (
          /* GIAI ĐOẠN 2: Phòng đã xác minh hợp lệ -> Nhập tên để vào chơi */
          <form onSubmit={handleJoinSubmit}>
            {/* Huy hiệu phòng đã liên kết */}
            <div
              style={{
                backgroundColor: 'var(--bg-input)',
                border: '1.5px solid var(--border-strong)',
                borderRadius: '16px',
                padding: '0.9rem 1.15rem',
                marginBottom: '1.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
                  {verifiedLobby?.title || 'Phòng thi đấu đã kết nối'}
                </div>
                <div style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--accent-sky)', letterSpacing: '0.12em', fontVariantNumeric: 'tabular-nums' }}>
                  #{roomCode}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                <span
                  style={{
                    backgroundColor: 'rgba(34, 197, 94, 0.15)',
                    color: '#16a34a',
                    padding: '0.25rem 0.6rem',
                    borderRadius: '8px',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                  }}
                >
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#16a34a' }} />
                  {verifiedLobby?.playerCount !== undefined ? `${verifiedLobby.playerCount} người` : 'Sẵn sàng'}
                </span>
                <button
                  type="button"
                  onClick={handleResetRoom}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    fontSize: '0.75rem',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  Đổi mã PIN khác
                </button>
              </div>
            </div>

            {/* Cảnh báo nếu phòng THI chưa có danh sách thí sinh */}
            {verifiedLobby?.sessionMode === 'EXAM' && rosterParticipants.length === 0 && (
              <div
                data-testid="join-exam-no-roster-error"
                style={{
                  marginBottom: '1.25rem',
                  padding: '0.9rem 1rem',
                  borderRadius: '14px',
                  backgroundColor: 'rgba(244, 63, 94, 0.12)',
                  border: '1.5px solid rgba(244, 63, 94, 0.4)',
                  color: 'var(--accent-rose)',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                }}
              >
                Phòng này ở chế độ THI nhưng Ban Tổ Chức chưa cấu hình danh sách thí sinh. Vui lòng liên hệ BTC để bổ sung danh sách trước khi vào thi.
              </div>
            )}

            {/* Chọn thí sinh từ danh sách BTC hoặc nhập tên */}
            {(rosterMode === 'PRECONFIGURED' || rosterMode === 'HYBRID' || verifiedLobby?.sessionMode === 'EXAM') && rosterParticipants.length > 0 && (() => {
              const savedMyPid = (() => {
                try {
                  return sessionStorage.getItem('active_player_participant_id') || '';
                } catch {
                  return '';
                }
              })();
              const duplicateNameCounts = new Map<string, number>();
              for (const item of rosterParticipants) {
                const key = normalizeVietnameseSearch(item.fullName);
                duplicateNameCounts.set(key, (duplicateNameCounts.get(key) || 0) + 1);
              }
              const normQuery = normalizeVietnameseSearch(rosterSearch);
              const filteredParticipants = rosterParticipants.filter((p) => {
                if (!normQuery) return true;
                const haystack = normalizeVietnameseSearch(
                  `${p.fullName} ${p.departmentUnit || ''} ${p.employeeCode || ''}`
                );
                return haystack.includes(normQuery);
              });
              const safeHighlight = Math.max(
                0,
                Math.min(highlightedIndex, Math.max(0, filteredParticipants.length - 1))
              );

              return (
                <div
                  data-testid="join-roster-gate"
                  style={{
                    marginBottom: '1.25rem',
                    padding: '0.9rem',
                    borderRadius: '14px',
                    backgroundColor: 'var(--bg-input)',
                    border: '1.5px solid var(--border-strong)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.6rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.84rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      Chọn tên của bạn trong danh sách ({filteredParticipants.length}/{rosterParticipants.length}):
                    </label>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      ↑↓ Chọn • Enter Xác nhận
                    </span>
                  </div>
                  <input
                    type="text"
                    data-testid="join-roster-search-input"
                    value={rosterSearch}
                    onChange={(e) => {
                      setRosterSearch(e.target.value);
                      setHighlightedIndex(0);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setHighlightedIndex((prev) =>
                          filteredParticipants.length > 0
                            ? (prev + 1) % filteredParticipants.length
                            : 0
                        );
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setHighlightedIndex((prev) =>
                          filteredParticipants.length > 0
                            ? (prev - 1 + filteredParticipants.length) % filteredParticipants.length
                            : 0
                        );
                      } else if (e.key === 'Enter') {
                        const target = filteredParticipants[safeHighlight];
                        if (target) {
                          e.preventDefault();
                          const isOwnSlot = Boolean(savedMyPid && savedMyPid === target.participantId);
                          const isSelectable =
                            Boolean(target.canStartAttempt ?? target.canJoin ?? true) &&
                            (!target.isLocked || isOwnSlot);
                          if (isSelectable) {
                            setSelectedParticipant(target);
                            setDisplayName(target.fullName);
                            setDepartmentInput(target.departmentUnit || '');
                            setConfirmedIdentity(false);
                          }
                        }
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        if (rosterSearch) {
                          setRosterSearch('');
                          setHighlightedIndex(0);
                        } else {
                          setSelectedParticipant(null);
                          setConfirmedIdentity(false);
                        }
                      }
                    }}
                    placeholder="Gõ tên không dấu/có dấu, phòng ban hoặc mã NV..."
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-subtle)',
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                      fontSize: '0.84rem',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div
                    role="listbox"
                    aria-label="Danh sách người tham gia"
                    data-testid="join-roster-dropdown-list"
                    style={{
                      maxHeight: '190px',
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.35rem',
                    }}
                  >
                    {filteredParticipants.length === 0 ? (
                      <div
                        data-testid="join-roster-empty-search"
                        style={{
                          padding: '0.85rem',
                          textAlign: 'center',
                          fontSize: '0.8rem',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        Không tìm thấy người chơi phù hợp với từ khóa "{rosterSearch}".
                      </div>
                    ) : (
                      filteredParticipants.map((p, idx) => {
                        const isSel = selectedParticipant?.participantId === p.participantId;
                        const isHighlighted = idx === safeHighlight;
                        const isOwnSlot = Boolean(savedMyPid && savedMyPid === p.participantId);
                        const isLockedByOther = Boolean(p.isLocked && !isOwnSlot);
                        const hasRemainingAttempts = Boolean(p.canStartAttempt ?? p.canJoin ?? true);
                        const isSelectable = hasRemainingAttempts && !isLockedByOther;
                        const isDuplicateName =
                          (duplicateNameCounts.get(normalizeVietnameseSearch(p.fullName)) || 0) > 1;

                        let statusBadgeText = 'Sẵn sàng';
                        let statusBadgeColor = 'var(--accent-emerald)';
                        if (isLockedByOther) {
                          statusBadgeText = 'Đang tham gia';
                          statusBadgeColor = '#f59e0b';
                        } else if (!hasRemainingAttempts) {
                          statusBadgeText = 'Đã hoàn thành';
                          statusBadgeColor = 'var(--accent-rose)';
                        }

                        return (
                          <button
                            key={p.participantId}
                            type="button"
                            role="option"
                            aria-selected={isSel}
                            data-testid={`join-roster-item-${p.participantId}`}
                            disabled={!isSelectable}
                            onMouseEnter={() => setHighlightedIndex(idx)}
                            onClick={() => {
                              if (!isSelectable) return;
                              setSelectedParticipant(p);
                              setDisplayName(p.fullName);
                              setDepartmentInput(p.departmentUnit || '');
                              setConfirmedIdentity(false);
                            }}
                            style={{
                              textAlign: 'left',
                              padding: '0.5rem 0.65rem',
                              borderRadius: '8px',
                              border: isSel
                                ? '2px solid var(--accent-emerald)'
                                : isHighlighted
                                  ? '1.5px solid var(--accent-sky)'
                                  : '1px solid var(--border-subtle)',
                              backgroundColor: isSel
                                ? 'rgba(16, 185, 129, 0.14)'
                                : isHighlighted
                                  ? 'rgba(56, 189, 248, 0.1)'
                                  : 'var(--bg-surface)',
                              color: 'var(--text-primary)',
                              cursor: isSelectable ? 'pointer' : 'not-allowed',
                              opacity: isSelectable ? 1 : 0.55,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '0.4rem',
                            }}
                          >
                            <div>
                              <div style={{ fontSize: '0.84rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                                <span>{p.fullName}</span>
                                {isDuplicateName && (
                                  <span
                                    data-testid={`join-duplicate-badge-${p.participantId}`}
                                    style={{
                                      fontSize: '0.68rem',
                                      padding: '0.1rem 0.4rem',
                                      borderRadius: '6px',
                                      backgroundColor: 'rgba(56, 189, 248, 0.16)',
                                      color: 'var(--accent-sky)',
                                      fontWeight: 800,
                                    }}
                                  >
                                    {p.departmentUnit || p.employeeCode || `ID: ${p.participantId.slice(-4)}`}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                                {p.departmentUnit || 'Thí sinh'} {p.employeeCode ? `• ${p.employeeCode}` : ''}
                              </div>
                            </div>
                            <span style={{ fontSize: '0.72rem', fontWeight: 800, color: statusBadgeColor, whiteSpace: 'nowrap' }}>
                              {statusBadgeText}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>

                  {selectedParticipant && (
                    <label
                      data-testid="join-confirm-identity-label"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.5rem 0.65rem',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(16, 185, 129, 0.12)',
                        border: '1px solid rgba(16, 185, 129, 0.35)',
                        fontSize: '0.8rem',
                        fontWeight: 800,
                        color: 'var(--accent-emerald)',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        data-testid="join-confirm-identity-checkbox"
                        checked={confirmedIdentity}
                        onChange={(e) => setConfirmedIdentity(e.target.checked)}
                      />
                      <span>
                        Đây là tôi: {selectedParticipant.fullName}
                        {selectedParticipant.departmentUnit ? ` (${selectedParticipant.departmentUnit})` : ''}
                      </span>
                    </label>
                  )}
                </div>
              );
            })()}

            {/* Ô nhập Nickname (ẩn khi bắt buộc chọn từ danh sách PRECONFIGURED hoặc ở chế độ EXAM) */}
            {verifiedLobby?.sessionMode !== 'EXAM' && (rosterMode !== 'PRECONFIGURED' || rosterParticipants.length === 0) && (
              <div style={{ marginBottom: '1.25rem' }}>
                <label
                  htmlFor="join-player-name"
                  style={{
                    display: 'block',
                    marginBottom: '0.45rem',
                    color: 'var(--text-primary)',
                    fontWeight: 800,
                    fontSize: '0.9rem',
                  }}
                >
                  Tên hoặc biệt danh của bạn <span style={{ color: 'var(--accent-rose)' }}>*</span>
                </label>
                <input
                  id="join-player-name"
                  type="text"
                  maxLength={50}
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    setSelectedParticipant(null);
                  }}
                  placeholder="VD: Nguyễn Văn A, Tuấn Kiệt"
                  required={!selectedParticipant}
                  autoFocus
                  autoComplete="nickname"
                  style={{
                    width: '100%',
                    padding: '0.85rem 1rem',
                    borderRadius: '14px',
                    border: '2px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontSize: '1.05rem',
                    fontWeight: 800,
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
                <input
                  type="text"
                  data-testid="join-department-input"
                  maxLength={80}
                  value={departmentInput}
                  onChange={(e) => setDepartmentInput(e.target.value)}
                  placeholder="Đơn vị / Phòng ban (tùy chọn)"
                  style={{
                    width: '100%',
                    marginTop: '0.5rem',
                    padding: '0.65rem 0.9rem',
                    borderRadius: '12px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontSize: '0.88rem',
                    fontWeight: 600,
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>
            )}

            <button
              type="submit"
              className="k-btn k-btn-green"
              style={{
                width: '100%',
                minHeight: '52px',
                padding: '0.95rem 1.25rem',
                borderRadius: '14px',
                fontSize: '1.1rem',
                fontWeight: 900,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: '0 4px 0 var(--k-green-dark)',
              }}
            >
              <span>Vào phòng thi đấu</span>
              <ArrowRightIcon size={20} />
            </button>
          </form>
        ) : (
          /* GIAI ĐOẠN 1: Chưa có phòng -> Nhập mã PIN độc lập trực tiếp */
          <div>
            <form onSubmit={handleVerifyPinSubmit}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label
                  htmlFor="join-room-pin"
                  style={{
                    display: 'block',
                    marginBottom: '0.5rem',
                    color: 'var(--text-primary)',
                    fontWeight: 800,
                    fontSize: '0.92rem',
                    textAlign: 'center',
                  }}
                >
                  Nhập mã PIN phòng chơi
                </label>
                <input
                  id="join-room-pin"
                  type="text"
                  maxLength={6}
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value.toUpperCase());
                    if (pinError) setPinError(null);
                  }}
                  placeholder="MÃ PIN (VD: BCDF23)"
                  autoComplete="off"
                  spellCheck="false"
                  autoFocus
                  disabled={isVerifyingPin}
                  style={{
                    width: '100%',
                    padding: '0.95rem 1rem',
                    borderRadius: '14px',
                    border: pinError ? '2px solid var(--accent-rose)' : '2px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--accent-sky)',
                    fontSize: '1.5rem',
                    fontWeight: 900,
                    textAlign: 'center',
                    letterSpacing: '0.2em',
                    boxSizing: 'border-box',
                    outline: 'none',
                    textTransform: 'uppercase',
                  }}
                />

                {/* Thông báo lỗi PIN */}
                {pinError && (
                  <div
                    style={{
                      marginTop: '0.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      color: 'var(--accent-rose)',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      justifyContent: 'center',
                    }}
                  >
                    <AlertTriangleIcon size={14} />
                    <span>{pinError}</span>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={isVerifyingPin || pinInput.trim().length < 4}
                className="k-btn k-btn-blue"
                style={{
                  width: '100%',
                  minHeight: '52px',
                  padding: '0.95rem 1.25rem',
                  borderRadius: '14px',
                  fontSize: '1.1rem',
                  fontWeight: 900,
                  cursor: isVerifyingPin || pinInput.trim().length < 4 ? 'not-allowed' : 'pointer',
                  opacity: isVerifyingPin || pinInput.trim().length < 4 ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  marginBottom: '1.5rem',
                }}
              >
                {isVerifyingPin ? (
                  <>
                    <SpinnerIcon size={18} />
                    <span>Đang kiểm tra mã PIN...</span>
                  </>
                ) : (
                  <>
                    <span>Vào phòng</span>
                    <ArrowRightIcon size={20} />
                  </>
                )}
              </button>
            </form>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-subtle)' }} />
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                HOẶC
              </span>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-subtle)' }} />
            </div>

            {/* Hướng dẫn quét QR */}
            <div
              style={{
                backgroundColor: 'var(--bg-input)',
                border: '1px dashed var(--border-subtle)',
                borderRadius: '14px',
                padding: '1rem',
                textAlign: 'center',
                marginBottom: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.35rem', color: 'var(--text-primary)', fontWeight: 800, fontSize: '0.88rem' }}>
                <QrCodeIcon size={18} style={{ color: 'var(--brand-purple)' }} />
                <span>Quét mã QR từ màn hình Host</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Dùng camera quét mã QR của Host để tự động điền mã PIN và kết nối phòng.
              </p>
            </div>

            {/* Accordion Toggle: Dán liên kết phòng */}
            <div style={{ textAlign: 'center' }}>
              {!showPasteSection ? (
                <button
                  type="button"
                  onClick={() => setShowPasteSection(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--primary)',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.25rem',
                  }}
                >
                  <LinkIcon size={14} />
                  <span>Dán liên kết phòng chơi (nếu có link)</span>
                </button>
              ) : (
                <form onSubmit={handleExtractFromPaste} style={{ marginTop: '0.75rem', textAlign: 'left' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="text"
                      value={pasteInput}
                      onChange={(e) => setPasteInput(e.target.value)}
                      placeholder="Dán link (VD: http://.../?room=ABC123)"
                      autoComplete="off"
                      spellCheck="false"
                      style={{
                        flex: 1,
                        padding: '0.65rem 0.85rem',
                        borderRadius: '10px',
                        border: '1.5px solid var(--border-strong)',
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        fontSize: '0.85rem',
                        boxSizing: 'border-box',
                        outline: 'none',
                      }}
                    />
                    <button
                      type="submit"
                      disabled={isVerifyingPin}
                      style={{
                        backgroundColor: 'var(--primary)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '10px',
                        padding: '0.65rem 0.95rem',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Nhận diện
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
