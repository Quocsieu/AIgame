import type { CreateRoomResponse, GameSpecification, IngestedSource, QrResponse } from '../types/index.js';

export async function ingestSources(params: {
  url?: string;
  file?: File;
  sampleText?: string;
}): Promise<IngestedSource[]> {
  const formData = new FormData();
  if (params.url) {
    formData.append('urls', params.url);
  }
  if (params.file) {
    formData.append('files', params.file);
  } else if (params.sampleText) {
    const blob = new Blob([params.sampleText], { type: 'text/plain' });
    formData.append('files', blob, 'sample_reference.txt');
  }

  const res = await fetch('/api/content/ingest', {
    method: 'POST',
    body: formData,
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Lỗi khi nhập nội dung nguồn.');
  }
  return data.data.sources;
}

export async function generateGame(params: {
  sourceId: string;
  gameType: string;
  questionCount: number;
  timePerQuestion: number;
}): Promise<GameSpecification> {
  const res = await fetch('/api/games/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

export async function createRoom(params: {
  gameId: string;
  gameSpecification?: GameSpecification;
  capacity?: number;
}): Promise<CreateRoomResponse> {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Lỗi khi tạo phòng chơi.');
  }
  return data.data;
}

export async function fetchRoomQr(roomCode: string): Promise<QrResponse> {
  const res = await fetch(`/api/rooms/${roomCode}/qr`);
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'Lỗi khi tải mã QR phòng.');
  }
  return data.data;
}

