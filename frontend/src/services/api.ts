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
  GameQuestion,
  GameSpecification,
  IndustryId,
  IngestedSource,
  LearningAnalyticsSummary,
  MixedQuestionDistribution,
  GameActiveStatus,
  PersistedGameSummary,
  PersistedPracticeSessionRecord,
  PracticeFinalResult,
  PracticeQuestionResult,
  QrResponse,
  SanitizedQuestion,
  ScoringMode,
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
  const headers = buildAuthHeaders();
  if (hostToken) {
    headers['x-host-token'] = hostToken;
  }
  const res = await fetch(`${API_BASE_URL}/rooms/${encodeURIComponent(roomCode)}/close`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ hostToken }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể đóng phòng chơi trực tiếp.');
  }
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
  params: {
    title?: string;
    description?: string;
    questions: GameQuestion[];
    settings?: {
      timePerQuestion?: number;
      scoringMode?: ScoringMode;
      mixedDistribution?: MixedQuestionDistribution;
      adventureConfig?: Partial<AdventureConfig>;
    };
    isPublic?: boolean;
  }
): Promise<GameSpecification> {
  const res = await fetch(`${API_BASE_URL}/games/${encodeURIComponent(gameId)}/questions`, {
    method: 'PATCH',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể lưu chỉnh sửa bộ câu hỏi.');
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
  state: 'WAITING' | 'QUESTION_ACTIVE' | 'QUESTION_REVEAL' | 'FINISHED' | 'CLOSED';
  playerCount: number;
  capacity: number;
  title: string;
  gameType: string;
  totalQuestions: number;
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
// Single-Player Practice Mode APIs
// ==========================================

export async function createPracticeSession(params: {
  gameId: string;
  gameSpecification?: GameSpecification;
  publicPlay?: boolean;
}): Promise<{
  sessionId: string;
  gameId: string;
  state: string;
  totalQuestions: number;
}> {
  const res = await fetch(`${API_BASE_URL}/games/sessions`, {
    method: 'POST',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể khởi tạo phiên luyện tập cá nhân.');
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
    headers: buildAuthHeaders(),
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
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
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
    headers: buildAuthHeaders(),
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
  currentQuestionIndex: number;
  totalQuestions: number;
  score: number;
  correctCount: number;
  wrongCount: number;
  currentStreak: number;
}> {
  const res = await fetch(`${API_BASE_URL}/games/sessions/${encodeURIComponent(sessionId)}`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể tải thông tin phiên chơi.');
  }
  return data.data;
}

export async function fetchPracticeSessionQuestion(sessionId: string): Promise<SanitizedQuestion> {
  const res = await fetch(`${API_BASE_URL}/games/sessions/${encodeURIComponent(sessionId)}/question`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể tải câu hỏi hiện tại.');
  }
  return data.data;
}

export async function fetchPracticeResult(sessionId: string): Promise<PracticeFinalResult> {
  const res = await fetch(`${API_BASE_URL}/games/sessions/${sessionId}/result`, {
    headers: buildAuthHeaders(),
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

export async function fetchLearningAnalytics(): Promise<LearningAnalyticsSummary> {
  const tzOffsetMinutes = -new Date().getTimezoneOffset();
  const res = await fetch(`${API_BASE_URL}/analytics/learning?tzOffsetMinutes=${tzOffsetMinutes}`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Không thể tải thống kê học tập.');
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
