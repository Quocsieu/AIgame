/// <reference types="vite/client" />
import type {
  AdminAiLogRecord,
  AdminOverviewStats,
  AdminUserRecord,
  AdventureConfig,
  AiObservabilitySummary,
  AuthenticatedUser,
  CreateRoomResponse,
  Difficulty,
  GameActiveStatus,
  GameAudioConfig,
  GameQuestion,
  GameScoreboardSummary,
  GameSpecification,
  IndustryId,
  IngestedSource,
  LearningAnalyticsSummary,
  MixedQuestionDistribution,
  OfficialAttemptPolicy,
  ParticipantRosterItem,
  PersistedGameSummary,
  PersistedPracticeSessionRecord,
  PracticeFinalResult,
  PracticeQuestionResult,
  QrResponse,
  RosterMode,
  SanitizedQuestion,
  ScoringMode,
  SessionMode,
  TimerMode,
  UserQuotaSummary,
} from '../types/index.js';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');
const SESSION_AUTH_TOKEN_KEY = 'ai_game_admin_session_token';
const GUEST_TOKEN_KEY = 'ai_game_guest_token';

export function getSessionAuthToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionAuthToken(token: string | null): void {
  try {
    // Purge old long-term localStorage token to comply with requirement
    localStorage.removeItem('ai_game_auth_token');

    if (token) {
      sessionStorage.setItem(SESSION_AUTH_TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(SESSION_AUTH_TOKEN_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

// Backward compatibility aliases
export const getStoredAuthToken = getSessionAuthToken;
export const setStoredAuthToken = setSessionAuthToken;

let inMemoryGuestToken: string | null = null;

function generateCsprngGuestToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0')) // taste-skill-ignore: byte hex formatting
    .join('');
  return `gt_${hex}`;
}

export function getOrCreateGuestToken(): string {
  try {
    const existing = localStorage.getItem(GUEST_TOKEN_KEY);
    if (existing && /^gt_[a-f0-9]{24,64}$/i.test(existing)) {
      return existing;
    }
    const newToken = generateCsprngGuestToken();
    localStorage.setItem(GUEST_TOKEN_KEY, newToken);
    return newToken;
  } catch {
    if (!inMemoryGuestToken) {
      inMemoryGuestToken = generateCsprngGuestToken();
    }
    return inMemoryGuestToken;
  }
}

export function buildAuthHeaders(
  extraHeaders?: Record<string, string>,
  options?: { isGuestPlayer?: boolean }
): Record<string, string> {
  const headers: Record<string, string> = { ...(extraHeaders || {}) };
  const token = getSessionAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (options?.isGuestPlayer) {
    headers['X-Guest-Token'] = getOrCreateGuestToken();
  }
  return headers;
}

// ==========================================
// Backward-compatible Auth APIs
// ==========================================

export async function registerUser(params: {
  email: string;
  password: string;
  displayName: string;
}): Promise<{
  user: AuthenticatedUser;
  token: string;
  expiresAt: string;
  quotas: UserQuotaSummary;
}> {
  const res = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Đăng ký tài khoản thất bại.');
    (err as any).code = data.error?.code;
    throw err;
  }
  setSessionAuthToken(data.data.token);
  return data.data;
}

export async function loginUser(_params: {
  email?: string;
  password?: string;
}): Promise<any> {
  throw new Error('Đăng nhập người dùng đã bị gỡ bỏ.');
}

export async function logoutUser(): Promise<void> {
  setSessionAuthToken(null);
}

export async function fetchCurrentUser(): Promise<{
  user: AuthenticatedUser;
  quotas?: UserQuotaSummary;
} | null> {
  return null;
}

export async function fetchWhoAmI(): Promise<{
  user: AuthenticatedUser | null;
  isGuest: boolean;
}> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/whoami`, {
      headers: buildAuthHeaders(),
    });
    const data = await res.json();
    if (data.success) {
      return data.data;
    }
  } catch {}
  return { user: null, isGuest: true };
}

// ==========================================
// Content Ingestion & Game Generation APIs
// ==========================================

export async function ingestSources(params: {
  url?: string;
  urls?: string[];
  file?: File;
  files?: File[];
  sampleText?: string;
}): Promise<IngestedSource[]> {
  const formData = new FormData();

  const urlList: string[] = [];
  if (params.urls && params.urls.length > 0) {
    for (const u of params.urls) {
      if (u && u.trim()) {
        urlList.push(u.trim());
      }
    }
  } else if (params.url && params.url.trim()) {
    urlList.push(params.url.trim());
  }

  for (const u of urlList) {
    formData.append('urls', u);
  }

  if (params.files && params.files.length > 0) {
    for (const f of params.files) {
      formData.append('files', f);
    }
  } else if (params.file) {
    formData.append('files', params.file);
  } else if (params.sampleText) {
    const blob = new Blob([params.sampleText], { type: 'text/plain' });
    formData.append('files', blob, 'sample_reference.txt');
  }

  const res = await fetch(`${API_BASE_URL}/content/ingest`, {
    method: 'POST',
    headers: buildAuthHeaders(),
    body: formData,
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Lỗi khi nhập nội dung nguồn.');
    (err as any).code = data.error?.code;
    throw err;
  }
  const rawSources: IngestedSource[] = Array.isArray(data?.data?.sources) ? data.data.sources : [];
  const validSources = rawSources.filter(
    s => s && typeof s.sourceId === 'string' && s.sourceId.trim().length > 0
  );
  if (validSources.length === 0) {
    const err = new Error(
      'Không tìm thấy nội dung hoặc ID nguồn hợp lệ sau khi trích xuất tài liệu. Vui lòng kiểm tra lại tệp hoặc URL.'
    );
    (err as any).code = 'INGESTION_EMPTY_SOURCE_ID';
    throw err;
  }
  return validSources;
}

export async function generateGame(params: {
  sourceId?: string;
  sourceIds?: string[];
  sources?: IngestedSource[];
  gameType: string;
  questionCount: number;
  timePerQuestion: number;
  difficulty?: Difficulty;
  scoringMode?: ScoringMode;
  sessionMode?: SessionMode;
  timerMode?: TimerMode;
  totalExamDurationSeconds?: number;
  passThresholdPercent?: number;
  officialAttemptPolicy?: OfficialAttemptPolicy;
  rosterMode?: RosterMode;
  audioConfig?: Partial<GameAudioConfig>;
  participants?: Array<{
    participantId?: string;
    fullName: string;
    departmentUnit?: string | null;
    employeeCode?: string;
    contactInfo?: string;
  }>;
  requireRoster?: boolean;
  topicFocus?: string;
  sectionFilter?: string[];
  title?: string;
  mixedDistribution?: MixedQuestionDistribution;
  adventureConfig?: Partial<AdventureConfig>;
}): Promise<GameSpecification> {
  const validSources = Array.isArray(params.sources)
    ? params.sources.filter(
        s => s && typeof s.sourceId === 'string' && s.sourceId.trim().length > 0
      )
    : undefined;
  const cleanSourceIds = Array.from(
    new Set(
      [
        ...(Array.isArray(params.sourceIds) ? params.sourceIds : []),
        ...(typeof params.sourceId === 'string' ? [params.sourceId] : []),
        ...((validSources || []).map(s => s.sourceId)),
      ]
        .map(id => (typeof id === 'string' ? id.trim() : ''))
        .filter(id => id.length > 0)
    )
  );
  const cleanPrimaryId =
    (typeof params.sourceId === 'string' && params.sourceId.trim().length > 0
      ? params.sourceId.trim()
      : undefined) || cleanSourceIds[0];

  if (!cleanPrimaryId && cleanSourceIds.length === 0 && (!validSources || validSources.length === 0)) {
    const err = new Error('Vui lòng nạp nội dung nguồn hợp lệ trước khi tạo trò chơi.');
    (err as any).code = 'SOURCE_ID_MISSING';
    throw err;
  }

  const sanitizedPayload = {
    ...params,
    sourceId: cleanPrimaryId,
    sourceIds: cleanSourceIds,
    sources: validSources && validSources.length > 0 ? validSources : undefined,
  };

  const res = await fetch(`${API_BASE_URL}/games/generate`, {
    method: 'POST',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(sanitizedPayload),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Lỗi khi tạo trò chơi bằng AI.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function retryAdventureAssetsApi(
  gameId: string,
  payload?: {
    industryId?: IndustryId;
    industryLabel?: string;
    subEnvironment?: string;
    title?: string;
    description?: string;
    questions?: GameQuestion[];
    forceRegenerate?: boolean;
  }
): Promise<GameSpecification> {
  const res = await fetch(
    `${API_BASE_URL}/games/${encodeURIComponent(gameId)}/adventure-assets/retry`,
    {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload || {}),
    }
  );
  const data = await res.json();
  if (!data.success) {
    const err = new Error(
      data.error?.message || 'Không thể tạo bộ tài nguyên hình ảnh Adventure.'
    );
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function fetchSavedGames(
  options:
    | number
    | {
        limit?: number;
        offset?: number;
        gameType?: string;
        search?: string;
        status?: 'ALL' | 'PUBLISHED' | 'DRAFT';
        scope?: 'manage' | 'public' | 'mine';
      } = 30
): Promise<{
  games: PersistedGameSummary[];
  total: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
  counts?: {
    totalAll: number;
    publishedCount: number;
    draftCount: number;
    ownedCount: number;
    activeCount?: number;
  };
}> {
  const opts = typeof options === 'number' ? { limit: options } : options;
  const query = new URLSearchParams();
  query.set('limit', String(opts.limit ?? 30));
  if (typeof opts.offset === 'number' && opts.offset > 0) {
    query.set('offset', String(opts.offset));
  }
  if (opts.gameType && opts.gameType !== 'ALL') {
    query.set('gameType', opts.gameType);
  }
  if (opts.search && opts.search.trim()) {
    query.set('search', opts.search.trim());
  }
  if (opts.status && opts.status !== 'ALL') {
    query.set('status', opts.status);
  }
  if (opts.scope) {
    query.set('scope', opts.scope);
  }

  const res = await fetch(`${API_BASE_URL}/games?${query.toString()}`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể tải danh sách bộ câu hỏi đã lưu.');
  }
  return data.data;
}

export async function deleteSavedGame(gameId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/games/${encodeURIComponent(gameId)}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể xóa bộ câu hỏi.');
  }
}

export async function fetchGameActiveStatus(gameId: string): Promise<GameActiveStatus> {
  const res = await fetch(`${API_BASE_URL}/games/${encodeURIComponent(gameId)}/status`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể tải trạng thái hoạt động của game.');
  }
  return data.data;
}

export async function endPracticeSession(sessionId: string): Promise<{ ended: boolean; session: any }> {
  const res = await fetch(`${API_BASE_URL}/games/sessions/${encodeURIComponent(sessionId)}/end`, {
    method: 'POST',
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể kết thúc phiên luyện tập.');
  }
  return data.data;
}

export async function closeMultiplayerRoom(
  roomCode: string,
  hostToken?: string
): Promise<{ closed: boolean; roomCode: string }> {
  let effectiveHostToken = hostToken;
  if (!effectiveHostToken) {
    try {
      const activeRoom = sessionStorage.getItem('active_host_room');
      const activeToken = sessionStorage.getItem('active_host_token');
      if (activeRoom === roomCode && activeToken) {
        effectiveHostToken = activeToken;
      } else {
        effectiveHostToken =
          sessionStorage.getItem(`host_token_${roomCode}`) ||
          localStorage.getItem(`host_token_${roomCode}`) ||
          undefined;
      }
    } catch {}
  }

  const headers = buildAuthHeaders({ 'Content-Type': 'application/json' });
  if (effectiveHostToken) {
    headers['x-host-token'] = effectiveHostToken;
  }

  const res = await fetch(`${API_BASE_URL}/rooms/${encodeURIComponent(roomCode)}/close`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ hostToken: effectiveHostToken }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể đóng phòng chơi trực tiếp.');
  }

  try {
    sessionStorage.removeItem(`host_token_${roomCode}`);
    localStorage.removeItem(`host_token_${roomCode}`);
    if (sessionStorage.getItem('active_host_room') === roomCode) {
      sessionStorage.removeItem('active_host_room');
      sessionStorage.removeItem('active_host_token');
    }
  } catch {}

  return data.data;
}

export async function deleteAllSavedGames(): Promise<{
  deletedCount: number;
  skippedActiveCount: number;
  totalTargeted: number;
  skippedGames?: Array<{ gameId: string; title?: string; reason: string }>;
}> {
  const res = await fetch(`${API_BASE_URL}/games`, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể xóa toàn bộ danh sách bộ câu hỏi.');
  }
  return data.data;
}

export async function fetchGameById(
  gameId: string,
  options?: { mode?: 'public' | 'manage' }
): Promise<GameSpecification> {
  const query = options?.mode ? `?mode=${encodeURIComponent(options.mode)}` : '';
  const headers = buildAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/games/${encodeURIComponent(gameId)}${query}`, {
    headers,
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không tìm thấy bộ câu hỏi.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function analyzeAdventureContextApi(params: {
  sourceIds?: string[];
  sources?: IngestedSource[];
  preferredIndustryId?: IndustryId;
  customIndustryLabel?: string;
  topicFocus?: string;
  questionCount?: number;
}): Promise<AdventureConfig> {
  const res = await fetch(`${API_BASE_URL}/games/adventure/analyze`, {
    method: 'POST',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể phân tích bối cảnh đi cảnh.');
  }
  return data.data;
}

export async function saveEditedQuestions(
  gameId: string,
  params:
    | GameQuestion[]
    | {
        title?: string;
        description?: string;
        questions: GameQuestion[];
        settings?: {
          timePerQuestion?: number;
          scoringMode?: ScoringMode;
          sessionMode?: SessionMode;
          timerMode?: TimerMode;
          totalExamDurationSeconds?: number;
          autoAdvanceDelayMs?: number;
          passThresholdPercent?: number;
          officialAttemptPolicy?: OfficialAttemptPolicy;
          rosterMode?: RosterMode;
          answersPublished?: boolean;
          answersPublishedAt?: string | null;
          showExamLeaderboardToPlayers?: boolean;
          audioConfig?: Partial<GameAudioConfig>;
          mixedDistribution?: MixedQuestionDistribution;
          adventureConfig?: Partial<AdventureConfig>;
        };
        isPublic?: boolean;
        coverImageUrl?: string | null;
        generateCover?: boolean;
        participants?: Array<{
          participantId?: string;
          fullName: string;
          departmentUnit?: string | null;
          employeeCode?: string;
          contactInfo?: string;
        }>;
        requireRoster?: boolean;
      }
): Promise<GameSpecification> {
  const payload = Array.isArray(params) ? { questions: params } : params;
  const res = await fetch(`${API_BASE_URL}/games/${encodeURIComponent(gameId)}/questions`, {
    method: 'PATCH',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể lưu chỉnh sửa bộ câu hỏi.');
  }
  return data.data;
}

export interface GenerateGameCoverApiResult {
  gameId: string;
  coverImageUrl: string | null;
  generated: boolean;
  cached: boolean;
  fallbackUsed: boolean;
  promptHash: string;
  reason?: string;
}

export async function generateGameCoverApi(
  gameId: string,
  forceRegenerate: boolean = false
): Promise<GenerateGameCoverApiResult> {
  const res = await fetch(`${API_BASE_URL}/games/${encodeURIComponent(gameId)}/cover`, {
    method: 'POST',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ forceRegenerate }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể tạo ảnh bìa bằng AI.');
  }
  return data.data;
}

export async function duplicateGameApi(
  gameId: string,
  title?: string
): Promise<GameSpecification> {
  const res = await fetch(`${API_BASE_URL}/games/${encodeURIComponent(gameId)}/duplicate`, {
    method: 'POST',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(title ? { title } : {}),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể sao chép bộ câu hỏi.');
  }
  return data.data;
}

export async function publishGame(gameId: string): Promise<GameSpecification> {
  const current = await fetchGameById(gameId);
  return saveEditedQuestions(gameId, {
    title: current.title,
    description: current.description,
    questions: current.questions,
    settings: current.settings,
    isPublic: true,
  });
}

export async function downloadGameExport(gameId: string, format: 'csv' | 'json'): Promise<void> {
  const res = await fetch(
    `${API_BASE_URL}/games/${encodeURIComponent(gameId)}/export?format=${format}`,
    {
      headers: buildAuthHeaders(),
    }
  );
  if (!res.ok) {
    let message = 'Lỗi khi xuất tệp bộ câu hỏi.';
    try {
      const errJson = await res.json();
      message = errJson.error?.message || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${gameId}_questions.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadSessionExport(sessionId: string, format: 'csv' | 'json'): Promise<void> {
  const res = await fetch(
    `${API_BASE_URL}/games/sessions/${encodeURIComponent(sessionId)}/export?format=${format}`,
    {
      headers: buildAuthHeaders(),
    }
  );
  if (!res.ok) {
    let message = 'Lỗi khi xuất kết quả phiên luyện tập.';
    try {
      const errJson = await res.json();
      message = errJson.error?.message || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sessionId}_result.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function createRoom(params: {
  gameId: string;
  gameSpecification?: GameSpecification;
  capacity?: number;
  requirePublished?: boolean;
}): Promise<CreateRoomResponse> {
  const res = await fetch(`${API_BASE_URL}/rooms`, {
    method: 'POST',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Lỗi khi tạo phòng chơi.');
    (err as any).code = data.error?.code;
    throw err;
  }
  if (data.data?.roomCode && data.data?.hostToken) {
    try {
      sessionStorage.setItem(`host_token_${data.data.roomCode}`, data.data.hostToken);
      sessionStorage.setItem('active_host_room', data.data.roomCode);
      sessionStorage.setItem('active_host_token', data.data.hostToken);
      localStorage.setItem(`host_token_${data.data.roomCode}`, data.data.hostToken);
    } catch {}
  }
  return data.data;
}

export async function fetchGameQr(gameId: string): Promise<{
  gameId: string;
  title: string;
  gameType: string;
  questionCount: number;
  isPublic: boolean;
  playUrl: string;
  qrDataUrl: string;
}> {
  const res = await fetch(`${API_BASE_URL}/games/${encodeURIComponent(gameId)}/qr`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể tải liên kết / mã QR chơi đơn.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function fetchRoomQr(roomCode: string): Promise<QrResponse> {
  const res = await fetch(`${API_BASE_URL}/rooms/${roomCode}/qr`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Lỗi khi tải mã QR phòng.');
  }
  return data.data;
}

export interface RoomLobbyInfo {
  roomCode: string;
  gameId?: string;
  state: 'WAITING' | 'QUESTION_ACTIVE' | 'QUESTION_REVEAL' | 'FINISHED' | 'CLOSED';
  playerCount: number;
  capacity: number;
  title: string;
  gameType: string;
  totalQuestions: number;
  sessionMode?: SessionMode;
  rosterMode?: RosterMode;
  hasRoster?: boolean;
}

export async function fetchRoomLobby(roomCode: string): Promise<RoomLobbyInfo> {
  const cleanCode = roomCode.trim().toUpperCase();
  const res = await fetch(`${API_BASE_URL}/rooms/${encodeURIComponent(cleanCode)}`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    const error: any = new Error(data.error?.message || 'Không tìm thấy phòng chơi này.');
    error.code = data.error?.code;
    throw error;
  }
  return data.data;
}

// ==========================================
// V2 Audio Upload, Roster & Scoreboard APIs
// ==========================================

export async function uploadCustomAudioApi(file: File): Promise<{
  audioUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE_URL}/games/audio/upload`, {
    method: 'POST',
    headers: buildAuthHeaders(),
    body: formData,
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể tải lên tệp âm thanh.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function fetchGameParticipantsApi(
  gameId: string,
  options?: { mode?: 'public' | 'manage' | 'admin'; search?: string; status?: string; hostToken?: string }
): Promise<{
  gameId: string;
  rosterMode: RosterMode;
  sessionMode?: SessionMode;
  examStatus?: 'OPEN' | 'CLOSING' | 'CLOSED';
  total: number;
  departments?: string[];
  participants: ParticipantRosterItem[];
}> {
  const query = new URLSearchParams();
  if (options?.mode) {
    query.set('mode', options.mode === 'admin' ? 'manage' : options.mode);
  }
  if (options?.search) query.set('search', options.search);
  if (options?.status) query.set('status', options.status);
  const qs = query.toString();

  const extraHeaders: Record<string, string> = {};
  if (options?.hostToken) {
    extraHeaders['x-host-token'] = options.hostToken;
  }

  const res = await fetch(
    `${API_BASE_URL}/games/${encodeURIComponent(gameId)}/participants${qs ? `?${qs}` : ''}`,
    {
      headers: buildAuthHeaders(extraHeaders),
    }
  );
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể tải danh sách thí sinh.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export interface RosterParsePreviewResult {
  fileName: string;
  totalRows: number;
  validCount: number;
  duplicateCount: number;
  duplicateNames: string[];
  invalidRows: Array<{
    rowNumber: number;
    rawText: string;
    reason: string;
  }>;
  participants: Array<{
    participantId?: string;
    fullName: string;
    departmentUnit: string | null;
    employeeCode?: string;
    contactInfo?: string;
  }>;
}

export async function parseRosterFileApi(
  paramsOrFile:
    | File
    | {
        file?: File;
        rawText?: string;
        fileName?: string;
      }
): Promise<RosterParsePreviewResult> {
  const params = paramsOrFile instanceof File ? { file: paramsOrFile } : paramsOrFile;
  let res: Response;
  if (params.file) {
    const formData = new FormData();
    formData.append('file', params.file);
    if (params.rawText) formData.append('rawText', params.rawText);
    res = await fetch(`${API_BASE_URL}/games/participants/parse`, {
      method: 'POST',
      headers: buildAuthHeaders(),
      body: formData,
    });
  } else {
    res = await fetch(`${API_BASE_URL}/games/participants/parse`, {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        rawText: params.rawText || '',
        fileName: params.fileName || 'manual.txt',
      }),
    });
  }
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể phân tích danh sách người tham gia.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function upsertGameParticipantsApi(
  gameId: string,
  params: {
    participants?: Array<{
      participantId?: string;
      fullName: string;
      departmentUnit?: string | null;
      employeeCode?: string;
      email?: string;
      contactInfo?: string;
    }>;
    fullName?: string;
    departmentUnit?: string;
    rawText?: string;
    file?: File;
    replaceAll?: boolean;
    rosterMode?: RosterMode;
  }
): Promise<{
  gameId: string;
  rosterMode: RosterMode;
  addedOrUpdatedCount: number;
  upsertedCount?: number;
  total: number;
  participants: ParticipantRosterItem[];
}> {
  let res: Response;
  if (params.file) {
    const formData = new FormData();
    formData.append('file', params.file);
    if (params.rawText) formData.append('rawText', params.rawText);
    if (params.replaceAll !== undefined) formData.append('replaceAll', String(params.replaceAll));
    if (params.rosterMode) formData.append('rosterMode', params.rosterMode);
    res = await fetch(`${API_BASE_URL}/games/${encodeURIComponent(gameId)}/participants`, {
      method: 'POST',
      headers: buildAuthHeaders(),
      body: formData,
    });
  } else {
    res = await fetch(`${API_BASE_URL}/games/${encodeURIComponent(gameId)}/participants`, {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(params),
    });
  }
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể lưu danh sách thí sinh.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return {
    ...data.data,
    upsertedCount: data.data?.addedOrUpdatedCount ?? data.data?.upsertedCount ?? 0,
  };
}

export async function updateGameParticipantApi(
  gameId: string,
  participantId: string,
  params: { fullName?: string; departmentUnit?: string }
): Promise<ParticipantRosterItem> {
  const res = await fetch(
    `${API_BASE_URL}/games/${encodeURIComponent(gameId)}/participants/${encodeURIComponent(participantId)}`,
    {
      method: 'PATCH',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(params),
    }
  );
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể cập nhật thông tin thí sinh.');
  }
  return data.data;
}

export async function deleteGameParticipantApi(
  gameId: string,
  participantId: string
): Promise<{ deleted: boolean; participantId: string }> {
  const res = await fetch(
    `${API_BASE_URL}/games/${encodeURIComponent(gameId)}/participants/${encodeURIComponent(participantId)}`,
    {
      method: 'DELETE',
      headers: buildAuthHeaders(),
    }
  );
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể xóa thí sinh.');
  }
  return data.data;
}

export async function clearGameParticipantsApi(
  gameId: string
): Promise<{ cleared: boolean; deletedCount: number }> {
  const res = await fetch(`${API_BASE_URL}/games/${encodeURIComponent(gameId)}/participants`, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể xóa toàn bộ danh sách thí sinh.');
  }
  return data.data;
}

export async function grantParticipantRetakeApi(
  gameId: string,
  participantId: string,
  incrementOrHostToken?: number | string,
  hostToken?: string
): Promise<{ granted: boolean; participant: ParticipantRosterItem }> {
  const resolvedHostToken =
    typeof incrementOrHostToken === 'string' ? incrementOrHostToken : hostToken;
  const extraHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (resolvedHostToken) {
    extraHeaders['x-host-token'] = resolvedHostToken;
  }
  const res = await fetch(
    `${API_BASE_URL}/games/${encodeURIComponent(gameId)}/participants/${encodeURIComponent(participantId)}/grant-retake`,
    {
      method: 'POST',
      headers: buildAuthHeaders(extraHeaders),
      body: JSON.stringify(resolvedHostToken ? { hostToken: resolvedHostToken } : {}),
    }
  );
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể cấp quyền thi lại cho thí sinh.');
  }
  return data.data;
}

export async function publishExamAnswersApi(
  gameId: string,
  hostToken?: string
): Promise<{
  gameId: string;
  answersPublished: boolean;
  answersPublishedAt: string;
  questions: Array<{ id: string; question: string; correctAnswer: string; explanation?: string }>;
}> {
  const extraHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (hostToken) {
    extraHeaders['x-host-token'] = hostToken;
  }
  const res = await fetch(`${API_BASE_URL}/games/${encodeURIComponent(gameId)}/publish-answers`, {
    method: 'POST',
    headers: buildAuthHeaders(extraHeaders),
    body: JSON.stringify(hostToken ? { hostToken } : {}),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể công bố đáp án bài thi.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function closeGameExamApi(
  gameId: string,
  hostToken?: string
): Promise<{
  gameId: string;
  alreadyClosed: boolean;
  examStatus: 'CLOSED';
  examClosedAt: string;
  answersPublished: boolean;
  autoSubmittedSoloCount: number;
  autoSubmittedRoomPlayersCount: number;
  dbFinalizedCount: number;
  totalAutoSubmitted: number;
  closedRoomCodes: string[];
}> {
  const extraHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (hostToken) {
    extraHeaders['x-host-token'] = hostToken;
  }
  const res = await fetch(`${API_BASE_URL}/games/${encodeURIComponent(gameId)}/close-exam`, {
    method: 'POST',
    headers: buildAuthHeaders(extraHeaders),
    body: JSON.stringify(hostToken ? { hostToken } : {}),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể kết thúc đợt thi.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function reopenGameExamApi(
  gameId: string,
  hostToken?: string
): Promise<{
  gameId: string;
  examStatus: 'OPEN';
  examClosedAt: null;
}> {
  const extraHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (hostToken) {
    extraHeaders['x-host-token'] = hostToken;
  }
  const res = await fetch(`${API_BASE_URL}/games/${encodeURIComponent(gameId)}/reopen-exam`, {
    method: 'POST',
    headers: buildAuthHeaders(extraHeaders),
    body: JSON.stringify(hostToken ? { hostToken } : {}),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể mở lại đợt thi.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function fetchGameScoreboardApi(
  gameId: string,
  options?: {
    search?: string;
    status?: string;
    departmentUnit?: string;
    sortBy?: 'rank' | 'score' | 'accuracy' | 'duration' | 'name' | 'attempts';
    sortDir?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
    hostToken?: string;
  }
): Promise<GameScoreboardSummary> {
  const query = new URLSearchParams();
  if (options?.search) query.set('search', options.search);
  if (options?.status) query.set('status', options.status);
  if (options?.departmentUnit) query.set('departmentUnit', options.departmentUnit);
  if (options?.sortBy) query.set('sortBy', options.sortBy);
  if (options?.sortDir) query.set('sortDir', options.sortDir);
  if (options?.limit) query.set('limit', String(options.limit));
  if (options?.offset) query.set('offset', String(options.offset));
  const qs = query.toString();

  const extraHeaders: Record<string, string> = {};
  if (options?.hostToken) {
    extraHeaders['x-host-token'] = options.hostToken;
  }

  const res = await fetch(
    `${API_BASE_URL}/games/${encodeURIComponent(gameId)}/scoreboard${qs ? `?${qs}` : ''}`,
    {
      headers: buildAuthHeaders(extraHeaders),
    }
  );
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể tải bảng điểm bài thi.');
  }
  return data.data;
}

export async function downloadGameScoreboardExport(
  gameId: string,
  format: 'csv' | 'xlsx' | 'json',
  hostToken?: string
): Promise<void> {
  const extraHeaders: Record<string, string> = {};
  if (hostToken) {
    extraHeaders['x-host-token'] = hostToken;
  }
  const res = await fetch(
    `${API_BASE_URL}/games/${encodeURIComponent(gameId)}/scoreboard/export?format=${format}`,
    {
      headers: buildAuthHeaders(extraHeaders),
    }
  );
  if (!res.ok) {
    let message = 'Lỗi khi xuất bảng điểm.';
    try {
      const errJson = await res.json();
      message = errJson.error?.message || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${gameId}_scoreboard.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ==========================================
// Single-Player Practice Mode APIs
// ==========================================

export async function createPracticeSession(params: {
  gameId: string;
  gameSpecification?: GameSpecification;
  publicPlay?: boolean;
  participantId?: string;
  displayName?: string;
  playerName?: string;
  departmentUnit?: string;
  lockToken?: string;
  sessionMode?: SessionMode;
}): Promise<{
  sessionId: string;
  gameId: string;
  state: string;
  resumed?: boolean;
  sessionMode?: SessionMode;
  timerMode?: TimerMode;
  participantId?: string | null;
  displayName?: string;
  departmentUnit?: string;
  lockToken?: string;
  totalQuestions: number;
  currentQuestionIndex?: number;
  score?: number;
  correctCount?: number;
  wrongCount?: number;
  currentStreak?: number;
  examRemainingSeconds?: number;
}> {
  const payload = {
    ...params,
    displayName: params.displayName || params.playerName,
  };
  const res = await fetch(`${API_BASE_URL}/games/sessions`, {
    method: 'POST',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }, { isGuestPlayer: true }),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể khởi tạo phiên luyện tập cá nhân.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function activatePracticeCheckpoint(sessionId: string): Promise<{
  sessionId: string;
  question: SanitizedQuestion;
}> {
  const res = await fetch(
    `${API_BASE_URL}/games/sessions/${encodeURIComponent(sessionId)}/checkpoint`,
    {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }, { isGuestPlayer: true }),
    }
  );
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể kích hoạt câu hỏi tại checkpoint.');
  }
  return data.data;
}

export async function recordPracticeTimeout(
  sessionId: string,
  questionId?: string
): Promise<PracticeQuestionResult> {
  const res = await fetch(
    `${API_BASE_URL}/games/sessions/${encodeURIComponent(sessionId)}/timeout`,
    {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }, { isGuestPlayer: true }),
      body: JSON.stringify(questionId ? { questionId } : {}),
    }
  );
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể ghi nhận hết giờ câu hỏi.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function startPracticeSession(sessionId: string): Promise<{
  session: {
    sessionId: string;
    score: number;
    correctCount: number;
    wrongCount: number;
    currentStreak: number;
  };
  question: SanitizedQuestion;
}> {
  const res = await fetch(`${API_BASE_URL}/games/sessions/${sessionId}/start`, {
    method: 'POST',
    headers: buildAuthHeaders(undefined, { isGuestPlayer: true }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể bắt đầu phiên luyện tập.');
  }
  return data.data;
}

export async function submitPracticeAnswer(
  sessionId: string,
  params: { questionId: string; answer: string }
): Promise<PracticeQuestionResult> {
  const res = await fetch(`${API_BASE_URL}/games/sessions/${sessionId}/answer`, {
    method: 'POST',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }, { isGuestPlayer: true }),
    body: JSON.stringify({
      ...params,
      clientTimestamp: Date.now(),
    }),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Lỗi khi gửi câu trả lời.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function advancePracticeSession(sessionId: string): Promise<{
  nextQuestionAvailable: boolean;
  finished: boolean;
  question?: SanitizedQuestion;
  result?: PracticeFinalResult;
}> {
  const res = await fetch(`${API_BASE_URL}/games/sessions/${sessionId}/next`, {
    method: 'POST',
    headers: buildAuthHeaders(undefined, { isGuestPlayer: true }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể chuyển sang câu hỏi tiếp theo.');
  }
  return data.data;
}

export async function fetchPracticeSessionSummary(sessionId: string): Promise<{
  sessionId: string;
  gameId: string;
  state: string;
  sessionMode?: SessionMode;
  examStatus?: 'OPEN' | 'CLOSING' | 'CLOSED';
  examClosedAt?: string | null;
  currentQuestionIndex: number;
  totalQuestions: number;
  score: number;
  correctCount: number;
  wrongCount: number;
  currentStreak: number;
}> {
  const res = await fetch(`${API_BASE_URL}/games/sessions/${encodeURIComponent(sessionId)}`, {
    headers: buildAuthHeaders(undefined, { isGuestPlayer: true }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể tải thông tin phiên chơi.');
  }
  return data.data;
}

export async function fetchPracticeSessionQuestion(sessionId: string): Promise<SanitizedQuestion> {
  const res = await fetch(`${API_BASE_URL}/games/sessions/${encodeURIComponent(sessionId)}/question`, {
    headers: buildAuthHeaders(undefined, { isGuestPlayer: true }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể tải câu hỏi hiện tại.');
  }
  return data.data;
}

export async function fetchPracticeResult(sessionId: string): Promise<PracticeFinalResult> {
  const res = await fetch(`${API_BASE_URL}/games/sessions/${sessionId}/result`, {
    headers: buildAuthHeaders(undefined, { isGuestPlayer: true }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể tải kết quả luyện tập.');
  }
  return data.data;
}

// ==========================================
// History, Analytics & AI Observability APIs (Phase 3 & 4)
// ==========================================

export async function fetchPracticeHistory(limit: number = 30): Promise<PersistedPracticeSessionRecord[]> {
  const res = await fetch(`${API_BASE_URL}/history/sessions?limit=${limit}`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể tải lịch sử luyện tập.');
  }
  return data.data;
}

export async function fetchLearningAnalytics(options?: {
  from?: string;
  to?: string;
}): Promise<LearningAnalyticsSummary> {
  const tzOffsetMinutes = -new Date().getTimezoneOffset();
  const query = new URLSearchParams();
  query.set('tzOffsetMinutes', String(tzOffsetMinutes));
  if (options?.from) {
    query.set('from', options.from);
  }
  if (options?.to) {
    query.set('to', options.to);
  }
  const res = await fetch(`${API_BASE_URL}/analytics/learning?${query.toString()}`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể tải dữ liệu thống kê.');
  }
  return data.data;
}

export async function fetchAiObservability(): Promise<AiObservabilitySummary> {
  const res = await fetch(`${API_BASE_URL}/observability/ai`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể tải dữ liệu giám sát AI.');
  }
  return data.data;
}

export async function runAiBenchmark(): Promise<{
  allPassed: boolean;
  totalCases: number;
  passedCases: number;
  results: Array<{
    caseId: string;
    name: string;
    passed: boolean;
    metrics: {
      requestedCount: number;
      validCount: number;
      rejectedCount: number;
      duplicateCount: number;
      hasValidProvenance: boolean;
      vietnameseCompliant: boolean;
    };
  }>;
  executedAt: string;
}> {
  const res = await fetch(`${API_BASE_URL}/observability/ai/benchmark`, {
    method: 'POST',
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể chạy kiểm chuẩn chất lượng AI.');
  }
  return data.data;
}

// ==========================================
// Administrative APIs (/api/admin)
// ==========================================

export async function fetchAdminOverview(): Promise<AdminOverviewStats> {
  const res = await fetch(`${API_BASE_URL}/admin/overview`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể tải thống kê quản trị.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function fetchAdminUsers(): Promise<AdminUserRecord[]> {
  const res = await fetch(`${API_BASE_URL}/admin/users`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể tải danh sách người dùng.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data.users || [];
}

export async function fetchAdminGames(options?: {
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
}): Promise<{
  games: PersistedGameSummary[];
  total: number;
  hasMore?: boolean;
  counts?: {
    totalAll: number;
    publishedCount: number;
    draftCount: number;
    ownedCount: number;
    activeCount?: number;
  };
}> {
  const query = new URLSearchParams();
  if (options?.limit) query.set('limit', String(options.limit));
  if (options?.offset) query.set('offset', String(options.offset));
  if (options?.search) query.set('search', options.search);
  if (options?.status) query.set('status', options.status);

  const res = await fetch(`${API_BASE_URL}/admin/games?${query.toString()}`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể tải danh sách bộ câu hỏi quản trị.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function updateAdminGameStatus(
  gameId: string,
  isPublic: boolean
): Promise<{ gameId: string; isPublic: boolean; message: string }> {
  const res = await fetch(`${API_BASE_URL}/admin/games/${encodeURIComponent(gameId)}/status`, {
    method: 'PATCH',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ isPublic }),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể cập nhật trạng thái game.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function deleteAdminGame(gameId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/admin/games/${encodeURIComponent(gameId)}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể xóa game.');
    (err as any).code = data.error?.code;
    throw err;
  }
}

export async function fetchAdminRooms(): Promise<{
  activeRooms: any[];
  historicalRooms: any[];
}> {
  const res = await fetch(`${API_BASE_URL}/admin/rooms`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể tải danh sách phòng chơi.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function fetchAdminAiLogs(): Promise<AdminAiLogRecord[]> {
  const res = await fetch(`${API_BASE_URL}/admin/ai-logs`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể tải nhật ký AI.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data.logs || [];
}

// ==========================================
// V3 Play / Exam History & Export APIs (/api/history/activities)
// ==========================================

export interface PlayExamHistoryItem {
  historyId: string;
  gameId: string;
  gameTitle: string;
  gameType: string;
  scoringMode: ScoringMode;
  sessionMode: 'PLAY' | 'EXAM';
  deliveryMode: 'SOLO' | 'MULTIPLAYER';
  roomId: string | null;
  roomCode: string | null;
  sessionId: string | null;
  playerName: string | null;
  departmentUnit: string | null;
  participantCount: number;
  completedCount: number;
  passedCount: number;
  failedCount: number;
  averageScore: number;
  highestScore: number;
  maxPossibleScore: number;
  averageAccuracy: number;
  durationMs: number;
  status: 'COMPLETED' | 'AUTO_SUBMITTED' | 'CLOSED';
  submittedReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface PlayExamHistoryParticipantRow {
  rank: number | null;
  participantId: string | null;
  fullName: string;
  departmentUnit: string;
  employeeCode: string;
  score: number;
  maxPossibleScore: number;
  correctAnswers: number;
  wrongAnswers: number;
  totalQuestions: number;
  accuracyPercent: number;
  durationMs: number;
  isPassed: boolean | null;
  attemptNumber: number;
  usedAttempts: number;
  allowedAttempts: number;
  status: 'COMPLETED' | 'AUTO_SUBMITTED' | 'IN_PROGRESS' | 'PENDING';
  submittedReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PlayExamHistoryQuestionRow {
  questionIndex: number;
  questionId: string;
  questionText: string;
  playerAnswer: string;
  isCorrect: boolean;
  pointsEarned: number;
  responseTimeMs: number;
  timedOut: boolean;
  correctAnswer: string | null;
  explanation: string | null;
}

export interface PlayExamHistoryDetail {
  historyId: string;
  gameId: string;
  gameTitle: string;
  gameType: string;
  scoringMode: ScoringMode;
  sessionMode: 'PLAY' | 'EXAM';
  deliveryMode: 'SOLO' | 'MULTIPLAYER';
  status: 'COMPLETED' | 'AUTO_SUBMITTED' | 'CLOSED';
  submittedReason: string | null;
  roomId: string | null;
  roomCode: string | null;
  sessionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  durationMs: number;
  totalQuestions: number;
  maxPossibleScore: number;
  officialAttemptPolicy: 'LATEST_ATTEMPT' | 'HIGHEST_SCORE';
  passThresholdPercent: number;
  answersPublished: boolean;
  participantCount: number;
  completedCount: number;
  passedCount: number;
  failedCount: number;
  averageScore: number;
  highestScore: number;
  averageAccuracy: number;
  participants: PlayExamHistoryParticipantRow[];
  questionBreakdown: PlayExamHistoryQuestionRow[];
}

export interface PlayExamHistoryListResult {
  items: PlayExamHistoryItem[];
  total: number;
  page: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  summary: {
    totalRuns: number;
    playRuns: number;
    examRuns: number;
    soloRuns: number;
    multiplayerRuns: number;
    totalParticipants: number;
  };
}

export async function fetchPlayExamHistoryApi(options?: {
  sessionMode?: 'ALL' | 'PLAY' | 'EXAM';
  deliveryMode?: 'ALL' | 'SOLO' | 'MULTIPLAYER';
  gameId?: string;
  search?: string;
  sortOrder?: 'NEWEST' | 'OLDEST';
  page?: number;
  limit?: number;
}): Promise<PlayExamHistoryListResult> {
  const query = new URLSearchParams();
  if (options?.sessionMode && options.sessionMode !== 'ALL') {
    query.set('sessionMode', options.sessionMode);
  }
  if (options?.deliveryMode && options.deliveryMode !== 'ALL') {
    query.set('deliveryMode', options.deliveryMode);
  }
  if (options?.gameId) query.set('gameId', options.gameId);
  if (options?.search && options.search.trim()) query.set('search', options.search.trim());
  if (options?.sortOrder) query.set('sortOrder', options.sortOrder);
  if (options?.page) query.set('page', String(options.page));
  if (options?.limit) query.set('limit', String(options.limit));
  const qs = query.toString();

  const res = await fetch(`${API_BASE_URL}/history/activities${qs ? `?${qs}` : ''}`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể tải lịch sử Chơi / Thi.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function fetchPlayExamHistoryDetailApi(
  historyId: string
): Promise<PlayExamHistoryDetail> {
  const res = await fetch(
    `${API_BASE_URL}/history/activities/${encodeURIComponent(historyId)}`,
    {
      headers: buildAuthHeaders(),
    }
  );
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không thể tải chi tiết phiên Chơi / Thi.');
    (err as any).code = data.error?.code;
    throw err;
  }
  return data.data;
}

export async function downloadPlayExamHistoryExport(
  historyId: string,
  format: 'csv' | 'xlsx' | 'json'
): Promise<void> {
  const res = await fetch(
    `${API_BASE_URL}/history/activities/${encodeURIComponent(historyId)}/export?format=${format}`,
    {
      headers: buildAuthHeaders(),
    }
  );
  if (!res.ok) {
    let message = 'Lỗi khi xuất tệp kết quả.';
    try {
      const errJson = await res.json();
      message = errJson.error?.message || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeId = historyId.replace(/[^a-zA-Z0-9_-]/g, '_');
  a.download = `${safeId}_history.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
