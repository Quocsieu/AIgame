/// <reference types="vite/client" />
import type {
  AiObservabilitySummary,
  AuthenticatedUser,
  CreateRoomResponse,
  Difficulty,
  GameQuestion,
  GameSpecification,
  IngestedSource,
  LearningAnalyticsSummary,
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
const AUTH_TOKEN_KEY = 'ai_game_auth_token';
const GUEST_TOKEN_KEY = 'ai_game_guest_token';

export function getStoredAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

let inMemoryGuestToken: string | null = null;

function generateCsprngGuestToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
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

function buildAuthHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extraHeaders || {}) };
  const token = getStoredAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    headers['X-Guest-Token'] = getOrCreateGuestToken();
  }
  return headers;
}

// ==========================================
// Authentication & Quota APIs (Phase 4)
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
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Đăng ký tài khoản thất bại.');
    (err as any).code = data.error?.code;
    throw err;
  }
  setStoredAuthToken(data.data.token);
  return data.data;
}

export async function loginUser(params: {
  email: string;
  password: string;
}): Promise<{
  user: AuthenticatedUser;
  token: string;
  expiresAt: string;
  quotas: UserQuotaSummary;
}> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Đăng nhập thất bại.');
    (err as any).code = data.error?.code;
    throw err;
  }
  setStoredAuthToken(data.data.token);
  return data.data;
}

export async function logoutUser(): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: buildAuthHeaders(),
    });
  } finally {
    setStoredAuthToken(null);
  }
}

export async function fetchCurrentUser(): Promise<{
  user: AuthenticatedUser;
  quotas: UserQuotaSummary;
} | null> {
  const token = getStoredAuthToken();
  if (!token) return null;

  const res = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: buildAuthHeaders(),
  });
  if (res.status === 401) {
    setStoredAuthToken(null);
    return null;
  }
  const data = await res.json();
  if (!data.success) {
    return null;
  }
  return data.data;
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
  return data.data.sources;
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
}): Promise<GameSpecification> {
  const res = await fetch(`${API_BASE_URL}/games/generate`, {
    method: 'POST',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params),
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
        scope?: 'manage' | 'public';
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

export async function fetchGameById(
  gameId: string,
  options?: { mode?: 'public' | 'manage' }
): Promise<GameSpecification> {
  const query = options?.mode ? `?mode=${encodeURIComponent(options.mode)}` : '';
  const res = await fetch(`${API_BASE_URL}/games/${encodeURIComponent(gameId)}${query}`, {
    headers: buildAuthHeaders(),
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error?.message || 'Không tìm thấy bộ câu hỏi.');
    (err as any).code = data.error?.code;
    throw err;
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
