import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import * as XLSX from 'xlsx';
import {
  ADVENTURE_THEME_PRESETS,
  analyzeSourceContentForAdventure,
  INDUSTRY_CATALOG,
  IndustryIdEnum,
  sanitizeAdventureConfig,
} from '../contracts/adventure.contract.js';
import {
  GameSpecification,
  GameSpecificationSchema,
  GenerateGameRequestSchema,
  RosterModeEnum,
  UpdateGameQuestionsRequestSchema,
} from '../contracts/game.contract.js';
import { gameStore, sessionStore } from '../game/game.store.js';
import { gameDeleteRateLimiter, generateRateLimiter } from '../middleware/rateLimiter.js';
import { rejectGuestOrPlayerWrite } from '../middleware/auth.middleware.js';
import { roomStore } from '../multiplayer/room.store.js';
import { multiplayerWsServer } from '../multiplayer/room.websocket.js';
import {
  cleanupOrphanedAdventureGameAssets,
  ensurePlayableAdventureAssetsWithFallback,
  listVerifiedAdventureAssetPacks,
  provisionAdventureAssetsForGame,
  resolveAdventureAssetPack,
  verifyAdventureGameAssets,
} from '../services/adventure-asset-pack.service.js';
import { aiImageService } from '../services/ai.image.service.js';
import { aiQuestionService } from '../services/ai.question.service.js';
import { authService } from '../services/auth.service.js';
import {
  exportService,
  ExportFormat,
  ScoreboardExportFormat,
} from '../services/export.service.js';
import { quotaService } from '../services/quota.service.js';
import { persistenceRepo } from '../storage/persistence.repository.js';
import { runInTransaction } from '../storage/sqlite.db.js';
import { sourceStore } from '../storage/source.store.js';
import { AppError, createSuccessResponse } from '../utils/errors.js';
import { sessionRouter } from './game.session.routes.js';

export const gameRouter = Router();

// Mount Day 3 Game Session Router
gameRouter.use('/sessions', sessionRouter);

const MAX_AUDIO_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_AUDIO_FILE_BYTES,
    files: 1,
  },
});

const rosterFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
  },
});

/**
 * Verifies real audio file signature (magic bytes) to prevent disguised scripts/executables.
 */
export function verifyAudioMagicBytes(
  buffer: Buffer,
  ext: string
): { valid: boolean; mimeType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg'; reason?: string } {
  if (!buffer || buffer.length < 12) {
    return { valid: false, mimeType: 'audio/mpeg', reason: 'Tệp âm thanh rỗng hoặc quá nhỏ.' };
  }

  // Reject executable or script headers disguised as audio
  const headAscii = buffer.subarray(0, Math.min(256, buffer.length)).toString('utf-8').toLowerCase();
  if (
    (buffer[0] === 0x4d && buffer[1] === 0x5a) || // MZ PE executable
    (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) || // ELF
    headAscii.includes('<script') ||
    headAscii.includes('<?php') ||
    headAscii.startsWith('#!/') ||
    headAscii.startsWith('<!doctype html') ||
    headAscii.startsWith('<html')
  ) {
    return {
      valid: false,
      mimeType: 'audio/mpeg',
      reason: 'Phát hiện nội dung thực thi hoặc mã kịch bản không hợp lệ trong tệp tải lên.',
    };
  }

  const normalizedExt = ext.toLowerCase();

  if (normalizedExt === '.mp3') {
    const isId3 = buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33; // "ID3"
    const isMpegSync = buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
    if (!isId3 && !isMpegSync) {
      return {
        valid: false,
        mimeType: 'audio/mpeg',
        reason: 'Chữ ký byte của tệp không khớp định dạng âm thanh MP3 hợp lệ.',
      };
    }
    return { valid: true, mimeType: 'audio/mpeg' };
  }

  if (normalizedExt === '.wav') {
    const isRiff =
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46; // "RIFF"
    const isWave =
      buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45; // "WAVE"
    if (!isRiff || !isWave) {
      return {
        valid: false,
        mimeType: 'audio/wav',
        reason: 'Chữ ký byte của tệp không khớp định dạng âm thanh WAV (RIFF/WAVE) hợp lệ.',
      };
    }
    return { valid: true, mimeType: 'audio/wav' };
  }

  if (normalizedExt === '.ogg') {
    const isOggS =
      buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53; // "OggS"
    if (!isOggS) {
      return {
        valid: false,
        mimeType: 'audio/ogg',
        reason: 'Chữ ký byte của tệp không khớp định dạng âm thanh OGG (OggS) hợp lệ.',
      };
    }
    return { valid: true, mimeType: 'audio/ogg' };
  }

  return {
    valid: false,
    mimeType: 'audio/mpeg',
    reason: `Định dạng tệp "${ext}" không được hỗ trợ. Chỉ chấp nhận .mp3, .wav, .ogg.`,
  };
}

/**
 * Helper to check if the request caller is the Game Owner, an ADMIN, or holds a valid Host Token for a room of this game.
 */
function hasCreatorOrHostManagementAccess(
  req: Request,
  gameId: string,
  ownerUserId: string | null
): boolean {
  if (req.user?.role === 'ADMIN') return true;
  if (req.user?.userId && ownerUserId && req.user.userId === ownerUserId) return true;

  const providedHostToken =
    (req.headers['x-host-token'] as string | undefined) ||
    (req.body?.hostToken as string | undefined) ||
    '';
  if (providedHostToken) {
    const allRooms = roomStore.getAll();
    for (const room of allRooms) {
      if (room.gameId === gameId && room.hostToken === providedHostToken) {
        return true;
      }
    }
  }
  return false;
}

export interface ParsedParticipantDraft {
  participantId?: string;
  fullName: string;
  departmentUnit: string | null;
  employeeCode?: string;
  contactInfo?: string;
}

export interface InvalidParticipantRow {
  rowNumber: number;
  rawText: string;
  reason: string;
}

export interface RosterParseDiagnosticsResult {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  duplicateNameCount: number;
  duplicateCodeCount: number;
  duplicateNames: string[];
  invalidRows: InvalidParticipantRow[];
  participants: ParsedParticipantDraft[];
}

function normalizeNameForDupCheck(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ');
}

function isHeaderRowLabel(cell0: string): boolean {
  const firstLower = cell0.trim().toLowerCase();
  return (
    firstLower === 'stt' ||
    firstLower === 'họ và tên' ||
    firstLower === 'họ tên' ||
    firstLower === 'ho va ten' ||
    firstLower === 'ho ten' ||
    firstLower === 'full name' ||
    firstLower === 'fullname' ||
    firstLower === 'tên thí sinh' ||
    firstLower === 'tên người chơi' ||
    firstLower === 'name'
  );
}

function validateAndClassifyParticipantCells(
  cells: string[],
  rowNumber: number,
  rawText: string,
  hasSttColumn: boolean | null = null
): { valid?: ParsedParticipantDraft; invalid?: InvalidParticipantRow } {
  const trimmedCells = cells.map(c => String(c ?? '').trim().replace(/^["']|["']$/g, '').trim());
  const nonEmptyCells = trimmedCells.filter(Boolean);
  if (nonEmptyCells.length === 0) {
    return {};
  }

  let fullName = '';
  let departmentUnit: string | null = null;
  let employeeCode: string | undefined;
  let contactInfo: string | undefined;

  const shouldShiftStt =
    hasSttColumn === true ||
    (hasSttColumn === null && /^\d+$/.test(trimmedCells[0]) && trimmedCells.length >= 2);

  if (shouldShiftStt && trimmedCells.length >= 2) {
    fullName = trimmedCells[1] || '';
    departmentUnit = trimmedCells[2] || null;
    employeeCode = trimmedCells[3] || undefined;
    contactInfo = trimmedCells[4] || undefined;
  } else {
    fullName = trimmedCells[0] || '';
    departmentUnit = trimmedCells[1] || null;
    employeeCode = trimmedCells[2] || undefined;
    contactInfo = trimmedCells[3] || undefined;
  }

  const cleanName = fullName.replace(/\s+/g, ' ').trim();
  if (!cleanName) {
    return {
      invalid: {
        rowNumber,
        rawText: rawText.slice(0, 160),
        reason: 'Thiếu họ và tên người tham gia ở cột đầu tiên.',
      },
    };
  }
  if (cleanName.length < 2) {
    return {
      invalid: {
        rowNumber,
        rawText: rawText.slice(0, 160),
        reason: `Họ và tên "${cleanName}" quá ngắn (cần tối thiểu 2 ký tự).`,
      },
    };
  }
  if (!/\p{L}/u.test(cleanName)) {
    return {
      invalid: {
        rowNumber,
        rawText: rawText.slice(0, 160),
        reason: `Họ và tên "${cleanName}" không hợp lệ (phải chứa ký tự chữ cái).`,
      },
    };
  }

  return {
    valid: {
      fullName: cleanName.slice(0, 120),
      departmentUnit: departmentUnit ? departmentUnit.slice(0, 120) : null,
      ...(employeeCode ? { employeeCode: employeeCode.slice(0, 80) } : {}),
      ...(contactInfo ? { contactInfo: contactInfo.slice(0, 160) } : {}),
    },
  };
}

/**
 * Parses roster participants from multiline text, CSV, or XLSX buffer with full validation & duplicate diagnostics.
 */
export function parseParticipantsWithDiagnostics(options: {
  rawText?: string;
  fileBuffer?: Buffer;
  fileName?: string;
}): RosterParseDiagnosticsResult {
  const participants: ParsedParticipantDraft[] = [];
  const invalidRows: InvalidParticipantRow[] = [];
  let totalRows = 0;

  if (options.fileBuffer && options.fileBuffer.length > 0) {
    const ext = path.extname(options.fileName || '').toLowerCase();
    const allowedExts = new Set(['.xlsx', '.xls', '.csv', '.txt', '']);
    if (!allowedExts.has(ext)) {
      throw new AppError(
        'UNSUPPORTED_ROSTER_FILE',
        `Định dạng tệp "${ext}" không được hỗ trợ cho danh sách thí sinh. Vui lòng chọn tệp .xlsx, .xls, .csv hoặc .txt.`,
        400
      );
    }
    if (ext === '.xlsx' || ext === '.xls') {
      // Verify file is a valid ZIP (PK\x03\x04) or OLE2 (\xD0\xCF\x11\xE0) workbook, not a corrupted/disguised binary
      const b0 = options.fileBuffer[0];
      const b1 = options.fileBuffer[1];
      const b2 = options.fileBuffer[2];
      const b3 = options.fileBuffer[3];
      const isZip = b0 === 0x50 && b1 === 0x4b && (b2 === 0x03 || b2 === 0x05 || b2 === 0x07);
      const isOle2 = b0 === 0xd0 && b1 === 0xcf && b2 === 0x11 && b3 === 0xe0;
      if (!isZip && !isOle2) {
        throw new AppError(
          'CORRUPTED_ROSTER_FILE',
          `Tệp Excel "${options.fileName || 'roster.xlsx'}" bị hỏng hoặc không đúng định dạng .xlsx/.xls hợp lệ.`,
          400
        );
      }
      let workbook: XLSX.WorkBook;
      try {
        const xlsxLib: typeof XLSX = (XLSX as any).default ?? XLSX;
        workbook = xlsxLib.read(options.fileBuffer, { type: 'buffer', codepage: 65001 });
      } catch {
        throw new AppError(
          'CORRUPTED_ROSTER_FILE',
          `Không thể đọc cấu trúc bảng tính từ tệp "${options.fileName || 'roster.xlsx'}".`,
          400
        );
      }
      const xlsxLib: typeof XLSX = (XLSX as any).default ?? XLSX;
      const firstSheetName = workbook.SheetNames[0];
      if (firstSheetName) {
        const sheet = workbook.Sheets[firstSheetName];
        const rows = xlsxLib.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
        let hasSttColumn: boolean | null = null;
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!Array.isArray(row) || row.length === 0) continue;
          const rawCells = row.map(c => String(c ?? '').trim());
          if (rawCells.every(c => !c)) continue;

          const firstNonEmpty = rawCells.find(Boolean) || '';
          if (i === 0 && isHeaderRowLabel(firstNonEmpty)) {
            hasSttColumn = firstNonEmpty.trim().toLowerCase() === 'stt';
            continue;
          }

          totalRows++;
          const rawLine = rawCells.filter(Boolean).join(' | ');
          const classified = validateAndClassifyParticipantCells(
            rawCells,
            i + 1,
            rawLine,
            hasSttColumn
          );
          if (classified.valid) {
            participants.push(classified.valid);
          } else if (classified.invalid) {
            invalidRows.push(classified.invalid);
          }
        }
      }
    } else {
      const text = options.fileBuffer.toString('utf-8');
      return parseParticipantsWithDiagnostics({ rawText: text, fileName: options.fileName });
    }
  }

  if (typeof options.rawText === 'string' && options.rawText.trim().length > 0) {
    const rawLines = options.rawText.replace(/^\uFEFF/, '').split(/\r?\n/);
    let seenNonEmptyLine = false;
    let hasSttColumn: boolean | null = null;

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i].trim();
      if (!line) continue;

      const parts = line
        .split(/[|\t;,]/)
        .map(p => p.trim().replace(/^["']|["']$/g, '').trim());
      if (parts.every(p => !p)) continue;

      const firstNonEmpty = parts.find(Boolean) || '';
      if (!seenNonEmptyLine && isHeaderRowLabel(firstNonEmpty)) {
        seenNonEmptyLine = true;
        hasSttColumn = firstNonEmpty.trim().toLowerCase() === 'stt';
        continue;
      }
      seenNonEmptyLine = true;

      totalRows++;
      const classified = validateAndClassifyParticipantCells(parts, i + 1, line, hasSttColumn);
      if (classified.valid) {
        participants.push(classified.valid);
      } else if (classified.invalid) {
        invalidRows.push(classified.invalid);
      }
    }
  }

  const nameCounts = new Map<string, number>();
  const duplicateNameDisplayMap = new Map<string, string>();
  for (const p of participants) {
    const norm = normalizeNameForDupCheck(p.fullName);
    if (!norm) continue;
    nameCounts.set(norm, (nameCounts.get(norm) || 0) + 1);
    if (!duplicateNameDisplayMap.has(norm)) {
      duplicateNameDisplayMap.set(norm, p.fullName);
    }
  }

  let duplicateCount = 0;
  const duplicateNames: string[] = [];
  for (const [norm, count] of nameCounts.entries()) {
    if (count > 1) {
      duplicateCount += count - 1;
      duplicateNames.push(duplicateNameDisplayMap.get(norm) || norm);
    }
  }

  const codeCounts = new Map<string, number>();
  for (const p of participants) {
    const code = (p.employeeCode || '').trim().toLowerCase();
    if (!code) continue;
    codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
  }
  let duplicateCodeCount = 0;
  for (const [, count] of codeCounts.entries()) {
    if (count > 1) {
      duplicateCodeCount += count - 1;
    }
  }

  return {
    totalRows,
    validCount: participants.length,
    invalidCount: invalidRows.length,
    duplicateCount,
    duplicateNameCount: duplicateCount,
    duplicateCodeCount,
    duplicateNames,
    invalidRows,
    participants,
  };
}

function parseParticipantsFromBufferOrText(options: {
  rawText?: string;
  fileBuffer?: Buffer;
  fileName?: string;
}): ParsedParticipantDraft[] {
  return parseParticipantsWithDiagnostics(options).participants;
}

export interface GameActiveStatus {
  gameId: string;
  hasActiveSession: boolean;
  activeSessionCount: number;
  activeSessions: Array<{
    sessionId: string;
    state: string;
    startedAt: string | null;
  }>;
  hasActiveRoom: boolean;
  activeRoomCount: number;
  activeRooms: Array<{
    roomId: string;
    roomCode: string;
    state: string;
    playerCount: number;
    createdAt: number;
  }>;
  isDeletable: boolean;
}

export function computeGameActiveStatus(gameId: string): GameActiveStatus {
  const activeSessions = sessionStore.getActiveSessionsForGame(gameId);
  const activeRooms = roomStore.getActiveRoomsForGame(gameId);

  const hasActiveSession = activeSessions.length > 0;
  const hasActiveRoom = activeRooms.length > 0;

  return {
    gameId,
    hasActiveSession,
    activeSessionCount: activeSessions.length,
    activeSessions: activeSessions.map((s) => ({
      sessionId: s.sessionId,
      state: s.state,
      startedAt: s.startedAt,
    })),
    hasActiveRoom,
    activeRoomCount: activeRooms.length,
    activeRooms: activeRooms.map((r) => ({
      roomId: r.roomId,
      roomCode: r.roomCode,
      state: r.state,
      playerCount: r.players.size,
      createdAt: r.createdAt,
    })),
    isDeletable: !hasActiveSession && !hasActiveRoom,
  };
}

function buildSoloPlayUrl(req: Request, gameId: string): string {
  const frontendUrl = (process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
  if (frontendUrl) {
    return `${frontendUrl}/?play=${encodeURIComponent(gameId)}`;
  }
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol || 'http';
  return `${protocol}://${host}/?play=${encodeURIComponent(gameId)}`;
}

/**
 * POST /api/games/audio/upload
 * Uploads a custom background audio file (.mp3, .wav, .ogg, max 10MB) with strict magic-byte validation.
 */
gameRouter.post(
  '/audio/upload',
  (req: Request, res: Response, next: NextFunction) => {
    audioUpload.single('file')(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(
            new AppError(
              'AUDIO_FILE_TOO_LARGE',
              'Tệp âm thanh vượt quá dung lượng tối đa 10 MB.',
              413
            )
          );
        }
        return next(new AppError('AUDIO_UPLOAD_ERROR', err.message || 'Lỗi tải tệp âm thanh.', 400));
      }
      next();
    });
  },
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'tải lên nhạc nền tùy chỉnh');

      let buffer: Buffer | null = null;
      let originalName = 'custom-audio.mp3';

      if (req.file && req.file.buffer) {
        buffer = req.file.buffer;
        originalName = req.file.originalname || originalName;
      } else if (typeof req.body?.fileBase64 === 'string' && req.body.fileBase64.trim()) {
        const rawB64 = req.body.fileBase64.replace(/^data:[^;]+;base64,/, '');
        buffer = Buffer.from(rawB64, 'base64');
        originalName = typeof req.body.fileName === 'string' ? req.body.fileName : originalName;
      }

      if (!buffer || buffer.length === 0) {
        throw new AppError('INVALID_REQUEST', 'Vui lòng chọn một tệp âm thanh (.mp3, .wav, .ogg) để tải lên.', 400);
      }

      if (buffer.length > MAX_AUDIO_FILE_BYTES) {
        throw new AppError('AUDIO_FILE_TOO_LARGE', 'Tệp âm thanh vượt quá dung lượng tối đa 10 MB.', 413);
      }

      const ext = path.extname(originalName).toLowerCase();
      if (!['.mp3', '.wav', '.ogg'].includes(ext)) {
        throw new AppError(
          'UNSUPPORTED_AUDIO_FORMAT',
          `Định dạng tệp "${ext || 'không xác định'}" không được hỗ trợ. Chỉ chấp nhận .mp3, .wav, .ogg.`,
          415
        );
      }

      const magicCheck = verifyAudioMagicBytes(buffer, ext);
      if (!magicCheck.valid) {
        throw new AppError(
          'INVALID_AUDIO_SIGNATURE',
          magicCheck.reason || 'Tệp tải lên không phải là tệp âm thanh hợp lệ.',
          415
        );
      }

      const safeUuid = crypto.randomUUID();
      const storedFileName = `bgm_${safeUuid}${ext}`;
      const uploadDir = path.resolve(process.cwd(), 'public', 'uploads', 'audio');
      fs.mkdirSync(uploadDir, { recursive: true });

      const targetPath = path.join(uploadDir, storedFileName);
      fs.writeFileSync(targetPath, buffer);

      const safeDisplayFileName = path
        .basename(originalName)
        .replace(/[^a-zA-Z0-9._\-\u00C0-\u1EF9 ]/g, '_')
        .slice(0, 120);

      res.status(200).json(
        createSuccessResponse({
          audioUrl: `/uploads/audio/${storedFileName}`,
          fileName: safeDisplayFileName,
          mimeType: magicCheck.mimeType,
          sizeBytes: buffer.length,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/games
 * List saved game specifications scoped to the authenticated user (or guest/demo/public scope).
 */
gameRouter.get(
  '/',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const gameType =
        typeof req.query.gameType === 'string' && req.query.gameType.trim()
          ? req.query.gameType.trim()
          : undefined;
      const search =
        typeof req.query.search === 'string' && req.query.search.trim()
          ? req.query.search.trim()
          : undefined;
      const rawStatus =
        typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : undefined;
      const status =
        rawStatus === 'PUBLISHED' || rawStatus === 'DRAFT' || rawStatus === 'ALL'
          ? rawStatus
          : undefined;
      const rawScope =
        typeof req.query.scope === 'string' ? req.query.scope.trim().toLowerCase() : undefined;
      const scope = rawScope === 'public' ? 'public' : rawScope === 'mine' ? 'mine' : 'manage';

      const result = persistenceRepo.listGames({
        userId: req.user?.userId ?? null,
        isAdmin: req.user?.role === 'ADMIN',
        scope,
        status,
        gameType,
        search,
        limit,
        offset,
      });

      const enrichedGames = result.games.map((game) => ({
        ...game,
        activeStatus: computeGameActiveStatus(game.gameId),
      }));

      const activeCount = (result.scopeGameIds || []).filter(
        (gid) =>
          sessionStore.hasActiveSessionForGame(gid) || roomStore.hasActiveRoomForGame(gid)
      ).length;

      res.status(200).json(
        createSuccessResponse({
          games: enrichedGames,
          total: result.total,
          limit: result.limit,
          offset: result.offset,
          hasMore: result.hasMore,
          counts: {
            ...result.counts,
            activeCount,
          },
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/games/participants/parse
 * Parses and validates a roster file (.xlsx, .xls, .csv) or multiline text for preview in the Creator UI
 * before or after generating a game.
 */
gameRouter.post(
  '/participants/parse',
  rosterFileUpload.single('file'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'phân tích danh sách người tham gia');

      let fileBuffer: Buffer | undefined = req.file?.buffer;
      let fileName: string = req.file?.originalname || req.body?.fileName || 'roster.csv';
      if (!fileBuffer && typeof req.body?.fileBase64 === 'string' && req.body.fileBase64.trim()) {
        const rawB64 = req.body.fileBase64.replace(/^data:[^;]+;base64,/, '');
        fileBuffer = Buffer.from(rawB64, 'base64');
      }

      const rawText = typeof req.body?.rawText === 'string' ? req.body.rawText : undefined;
      if ((!fileBuffer || fileBuffer.length === 0) && (!rawText || !rawText.trim())) {
        throw new AppError(
          'INVALID_REQUEST',
          'Vui lòng chọn tệp danh sách (.xlsx, .csv) hoặc nhập dữ liệu văn bản cần phân tích.',
          400
        );
      }

      const diagnostics = parseParticipantsWithDiagnostics({
        rawText,
        fileBuffer,
        fileName,
      });

      res.status(200).json(
        createSuccessResponse({
          fileName,
          ...diagnostics,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

gameRouter.post(
  '/generate',
  generateRateLimiter.middleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'tạo game bằng AI');

      // 1. Validate request body against Zod schema
      const parseResult = GenerateGameRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
        throw new AppError('INVALID_REQUEST', `Request validation failed: ${issues}`, 400);
      }

      const requestData = parseResult.data;

      // V3 Task B: If requireRoster is set for EXAM mode, block generation when roster is empty
      if (
        requestData.sessionMode === 'EXAM' &&
        requestData.requireRoster === true &&
        (!Array.isArray(requestData.participants) || requestData.participants.length === 0)
      ) {
        throw new AppError(
          'EXAM_ROSTER_REQUIRED',
          'Chế độ Thi nghiêm túc bắt buộc phải có danh sách thí sinh hợp lệ trước khi tạo đợt thi.',
          400
        );
      }

      // 2. Retrieve normalized source content from sources passback or store fallback
      const sourceIds: string[] = Array.from(
        new Set(
          [
            ...(Array.isArray(requestData.sourceIds) ? requestData.sourceIds : []),
            ...(typeof requestData.sourceId === 'string' ? [requestData.sourceId] : []),
            ...(Array.isArray(requestData.sources)
              ? requestData.sources.map(s => s?.sourceId)
              : []),
          ]
            .map(id => (typeof id === 'string' ? id.trim() : ''))
            .filter(id => id.length > 0)
        )
      );

      // Verify ownership access on stored sources if any
      for (const sid of sourceIds) {
        const sourceOwnerId = sourceStore.getOwnerUserId(sid);
        if (sourceOwnerId) {
          authService.assertResourceAccess({
            resourceType: 'tài liệu nguồn',
            ownerUserId: sourceOwnerId,
            currentUser: req.user,
            mode: 'read',
          });
        }
      }

      const validInlineSources = Array.isArray(requestData.sources)
        ? requestData.sources.filter(
            doc => doc && typeof doc.sourceId === 'string' && doc.sourceId.trim().length > 0
          )
        : [];
      const storedDocuments = sourceStore.getMany(sourceIds);
      const documents =
        validInlineSources.length > 0 ? validInlineSources : storedDocuments;

      if (documents.length === 0) {
        if (sourceIds.length === 0) {
          throw new AppError(
            'INVALID_REQUEST',
            'Request validation failed: sourceId: Either "sourceId", "sourceIds", or "sources" must be provided.',
            400
          );
        }
        throw new AppError(
          'SOURCE_NOT_FOUND',
          `None of the requested source IDs (${sourceIds.join(', ')}) were found in the system. Please ingest source content first.`,
          404
        );
      }

      // Enforce per-user / per-guest daily quotas when identified
      if (req.user) {
        quotaService.consumeUserQuota(req.user.userId, 'DAILY_GAME_GENERATIONS', 1);
        quotaService.consumeUserQuota(req.user.userId, 'DAILY_AI_CALLS', 1);
      }

      // 3 & 4 & 5. Build bounded AI input, generate, validate structured output
      const rawGameSpecification = await aiQuestionService.generateGame(documents, requestData, {
        userId: req.user?.userId ?? null,
      });

      let gameSpecification: GameSpecification = {
        ...rawGameSpecification,
        settings: {
          ...rawGameSpecification.settings,
          ...(requestData.sessionMode ? { sessionMode: requestData.sessionMode } : {}),
          ...(requestData.examAnswerRevealPolicy
            ? { examAnswerRevealPolicy: requestData.examAnswerRevealPolicy }
            : requestData.sessionMode === 'EXAM' && !rawGameSpecification.settings?.examAnswerRevealPolicy
              ? { examAnswerRevealPolicy: 'AFTER_PUBLISH' as const }
              : {}),
          ...(requestData.timerMode ? { timerMode: requestData.timerMode } : {}),
          ...(requestData.totalExamDurationSeconds
            ? { totalExamDurationSeconds: requestData.totalExamDurationSeconds }
            : {}),
          ...(requestData.passThresholdPercent !== undefined
            ? { passThresholdPercent: requestData.passThresholdPercent }
            : {}),
          ...(requestData.officialAttemptPolicy
            ? { officialAttemptPolicy: requestData.officialAttemptPolicy }
            : {}),
          ...(requestData.rosterMode ? { rosterMode: requestData.rosterMode } : {}),
          ...(requestData.audioConfig ? { audioConfig: requestData.audioConfig } : {}),
        },
      };
      let adventureAssetsReady = true;
      if (gameSpecification.gameType === 'ADVENTURE') {
        const assetProvision = await provisionAdventureAssetsForGame(gameSpecification, {
          userId: req.user?.userId ?? null,
        });
        gameSpecification = assetProvision.specification;
        adventureAssetsReady = assetProvision.verified;
      }

      const resolvedIsPublic =
        gameSpecification.gameType === 'ADVENTURE' && !adventureAssetsReady
          ? false
          : requestData.isPublic !== undefined
            ? Boolean(requestData.isPublic)
            : false;

      // Save generated specification in store and SQLite persistence (draft by default until explicitly published)
      const incomingParticipants = Array.isArray(requestData.participants)
        ? requestData.participants.filter(p => p && typeof p.fullName === 'string' && p.fullName.trim().length > 0)
        : [];
      if (incomingParticipants.length > 0 && (!gameSpecification.settings.rosterMode || gameSpecification.settings.rosterMode === 'FREE_TEXT')) {
        gameSpecification = {
          ...gameSpecification,
          settings: {
            ...gameSpecification.settings,
            rosterMode: 'PRECONFIGURED',
          },
        };
      }

      gameStore.save(
        { ...gameSpecification, isPublic: resolvedIsPublic },
        Date.now(),
        req.user?.userId ?? null,
        resolvedIsPublic
      );

      if (incomingParticipants.length > 0) {
        persistenceRepo.upsertParticipants(
          gameSpecification.gameId,
          incomingParticipants.map(item => ({
            participantId: item.participantId,
            fullName: item.fullName,
            departmentUnit: item.departmentUnit || undefined,
            employeeCode: item.employeeCode || undefined,
            contactInfo: item.contactInfo || item.email || undefined,
          })),
          true
        );
      }

      // 6. Return validated GameSpecification
      const savedSpec = gameStore.get(gameSpecification.gameId) || {
        ...gameSpecification,
        ownerUserId: req.user?.userId ?? null,
        isPublic: resolvedIsPublic,
      };
      res.status(200).json(
        createSuccessResponse(savedSpec)
      );
    } catch (err) {
      next(err);
    }
  }
);

gameRouter.get(
  '/adventure/catalog',
  (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json(
        createSuccessResponse({
          industries: INDUSTRY_CATALOG,
          themePresets: ADVENTURE_THEME_PRESETS,
          verifiedAssetPacks: listVerifiedAdventureAssetPacks(),
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

gameRouter.post(
  '/adventure/analyze',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body || {};
      const sourceIds: string[] = Array.from(
        new Set(
          [
            ...(Array.isArray(body.sourceIds) ? body.sourceIds : []),
            ...(typeof body.sourceId === 'string' ? [body.sourceId] : []),
            ...(Array.isArray(body.sources) ? body.sources.map((s: any) => s?.sourceId) : []),
          ]
            .map(id => (typeof id === 'string' ? id.trim() : ''))
            .filter(id => id.length > 0)
        )
      );
      const documents =
        Array.isArray(body.sources) && body.sources.length > 0
          ? body.sources
          : sourceStore.getMany(sourceIds);

      const parsedIndustry = IndustryIdEnum.safeParse(body.preferredIndustryId);
      const preferredIndustryId = parsedIndustry.success ? parsedIndustry.data : undefined;

      const proposal = analyzeSourceContentForAdventure(documents, {
        preferredIndustryId,
        customIndustryLabel:
          typeof body.customIndustryLabel === 'string' ? body.customIndustryLabel : undefined,
        topicFocus: typeof body.topicFocus === 'string' ? body.topicFocus : undefined,
        questionCount: typeof body.questionCount === 'number' ? body.questionCount : 5,
      });

      res.status(200).json(createSuccessResponse(proposal));
    } catch (err) {
      next(err);
    }
  }
);

gameRouter.get(
  '/:gameId',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = String(req.params.gameId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }
      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
      const isPublic = spec.isPublic ?? ownerInfo?.isPublic ?? false;
      const coverMeta = persistenceRepo.getGameCoverMetadata(gameId);
      const coverImageUrl = spec.coverImageUrl ?? coverMeta?.coverImageUrl ?? null;

      const isPublicQuery = String(req.query.mode || '').toLowerCase() === 'public';
      if (isPublicQuery && !isPublic) {
        throw new AppError(
          'GAME_NOT_PUBLISHED',
          'Game này chưa được xuất bản nên không thể mở ở chế độ chơi công khai.',
          403
        );
      }

      authService.assertResourceAccess({
        resourceType: 'bộ câu hỏi',
        ownerUserId,
        currentUser: req.user,
        mode: 'read',
        isPublic,
      });

      const isOwnerOrAdmin = hasCreatorOrHostManagementAccess(req, gameId, ownerUserId);
      const shouldRedactExamAnswers =
        spec.settings?.sessionMode === 'EXAM' &&
        !spec.settings?.answersPublished &&
        (isPublicQuery || !isOwnerOrAdmin);

      const returnedQuestions = shouldRedactExamAnswers
        ? spec.questions.map((q) => ({
            ...q,
            correctAnswer: '',
            acceptedAlternatives: [],
            crosswordAnswer: undefined,
            explanation: '',
            sliderConfig: q.sliderConfig
              ? {
                  ...q.sliderConfig,
                  correctValue: q.sliderConfig.min,
                }
              : undefined,
          }))
        : spec.questions;

      const playableSpec =
        spec.gameType === 'ADVENTURE'
          ? ensurePlayableAdventureAssetsWithFallback(spec).specification
          : spec;

      res.status(200).json(
        createSuccessResponse({
          ...playableSpec,
          questions: returnedQuestions,
          ownerUserId,
          isPublic,
          ...(coverImageUrl ? { coverImageUrl } : {}),
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

async function handleUpdateGameSpecification(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    rejectGuestOrPlayerWrite(req, 'chỉnh sửa hoặc xuất bản game');

    const gameId = String(req.params.gameId || '');
    const existing = gameStore.get(gameId);
    if (!existing) {
      throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
    }

    const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
    const ownerUserId = existing.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
    const existingIsPublic = existing.isPublic ?? ownerInfo?.isPublic ?? false;

    authService.assertResourceAccess({
      resourceType: 'bộ câu hỏi',
      ownerUserId,
      currentUser: req.user,
      mode: 'write',
    });

    const parseResult = UpdateGameQuestionsRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new AppError('INVALID_REQUEST', `Question validation failed: ${issues}`, 400);
    }

    const {
      title,
      description,
      questions,
      settings: rawSettings,
      sessionMode: topLevelSessionMode,
      examAnswerRevealPolicy: topLevelExamAnswerRevealPolicy,
      isPublic,
      coverImageUrl,
      generateCover,
      participants,
      requireRoster,
    } = parseResult.data;
    const settings = {
      ...rawSettings,
      ...(topLevelSessionMode !== undefined && rawSettings?.sessionMode === undefined
        ? { sessionMode: topLevelSessionMode }
        : {}),
      ...(topLevelExamAnswerRevealPolicy !== undefined &&
      rawSettings?.examAnswerRevealPolicy === undefined
        ? { examAnswerRevealPolicy: topLevelExamAnswerRevealPolicy }
        : {}),
    };

    const effectiveSessionMode = settings?.sessionMode ?? existing.settings?.sessionMode ?? 'PLAY';
    if (effectiveSessionMode === 'EXAM' && requireRoster === true) {
      const incomingCount = Array.isArray(participants)
        ? participants.filter(p => p && typeof p.fullName === 'string' && p.fullName.trim().length > 0).length
        : persistenceRepo.listParticipants(gameId, { limit: 1 }).total;
      if (incomingCount === 0) {
        throw new AppError(
          'EXAM_ROSTER_REQUIRED',
          'Chế độ Thi nghiêm túc bắt buộc phải có danh sách thí sinh hợp lệ trước khi lưu hoặc mở đợt thi.',
          400
        );
      }
    }

    // Ensure all edited questions match the game's type (including canonical/legacy aliases) unless gameType is MIXED or ADVENTURE
    if (existing.gameType !== 'MIXED' && existing.gameType !== 'ADVENTURE') {
      const isEquivalentType = (gType: string, qType: string): boolean => {
        if (gType === qType) return true;
        if ((gType === 'QUIZ' || gType === 'MULTIPLE_CHOICE') && (qType === 'QUIZ' || qType === 'MULTIPLE_CHOICE')) return true;
        if ((gType === 'TRUE_FALSE' || gType === 'QUICK_BUTTON') && (qType === 'TRUE_FALSE' || qType === 'QUICK_BUTTON')) return true;
        if ((gType === 'TYPE_ANSWER' || gType === 'FILL_IN_THE_BLANK') && (qType === 'TYPE_ANSWER' || qType === 'FILL_IN_THE_BLANK')) return true;
        return false;
      };
      for (let i = 0; i < questions.length; i++) {
        if (!isEquivalentType(existing.gameType, questions[i].type)) {
          throw new AppError(
            'INVALID_REQUEST',
            `Question #${i + 1} type "${questions[i].type}" does not match gameType "${existing.gameType}".`,
            400
          );
        }
      }
    }

    const resolvedIsPublic = isPublic !== undefined ? isPublic : existingIsPublic;
    const coverMeta = persistenceRepo.getGameCoverMetadata(gameId);
    const resolvedCoverUrl =
      coverImageUrl !== undefined
        ? coverImageUrl
        : existing.coverImageUrl ?? coverMeta?.coverImageUrl ?? null;

    const updatedSpec = GameSpecificationSchema.parse({
      ...existing,
      ownerUserId,
      isPublic: resolvedIsPublic,
      ...(resolvedCoverUrl ? { coverImageUrl: resolvedCoverUrl } : {}),
      title: title !== undefined ? title : existing.title,
      description:
        description !== undefined
          ? description.length > 0
            ? description
            : existing.description
          : existing.description,
      questions,
      settings: {
        ...existing.settings,
        ...(settings?.timePerQuestion !== undefined ? { timePerQuestion: settings.timePerQuestion } : {}),
        ...(settings?.scoringMode !== undefined ? { scoringMode: settings.scoringMode } : {}),
        ...(settings?.sessionMode !== undefined ? { sessionMode: settings.sessionMode } : {}),
        ...(settings?.examAnswerRevealPolicy !== undefined
          ? { examAnswerRevealPolicy: settings.examAnswerRevealPolicy }
          : (settings?.sessionMode ?? existing.settings?.sessionMode) === 'EXAM' &&
              !existing.settings?.examAnswerRevealPolicy
            ? { examAnswerRevealPolicy: 'AFTER_PUBLISH' as const }
            : {}),
        ...(settings?.timerMode !== undefined ? { timerMode: settings.timerMode } : {}),
        ...(settings?.totalExamDurationSeconds !== undefined
          ? { totalExamDurationSeconds: settings.totalExamDurationSeconds }
          : {}),
        ...(settings?.autoAdvanceDelayMs !== undefined
          ? { autoAdvanceDelayMs: settings.autoAdvanceDelayMs }
          : {}),
        ...(settings?.passThresholdPercent !== undefined
          ? { passThresholdPercent: settings.passThresholdPercent }
          : {}),
        ...(settings?.officialAttemptPolicy !== undefined
          ? { officialAttemptPolicy: settings.officialAttemptPolicy }
          : {}),
        ...(settings?.rosterMode !== undefined ? { rosterMode: settings.rosterMode } : {}),
        ...(settings?.answersPublished !== undefined
          ? { answersPublished: settings.answersPublished }
          : {}),
        ...(settings?.answersPublishedAt !== undefined
          ? { answersPublishedAt: settings.answersPublishedAt }
          : {}),
        ...(settings?.showExamLeaderboardToPlayers !== undefined
          ? { showExamLeaderboardToPlayers: settings.showExamLeaderboardToPlayers }
          : {}),
        ...(settings?.audioConfig !== undefined ? { audioConfig: settings.audioConfig } : {}),
        ...(settings?.mixedDistribution !== undefined ? { mixedDistribution: settings.mixedDistribution } : {}),
        ...(settings?.adventureConfig !== undefined
          ? {
              adventureConfig: sanitizeAdventureConfig(
                settings.adventureConfig,
                existing.settings.adventureConfig ||
                  analyzeSourceContentForAdventure([], {
                    questionCount: questions.length,
                    questions,
                  }),
                questions
              ),
            }
          : existing.settings.adventureConfig
            ? {
                adventureConfig: sanitizeAdventureConfig(
                  existing.settings.adventureConfig,
                  existing.settings.adventureConfig,
                  questions
                ),
              }
            : {}),
        questionCount: questions.length,
      },
    });

    if (updatedSpec.gameType === 'ADVENTURE' && updatedSpec.settings.adventureConfig) {
      const existingAdv = existing.settings?.adventureConfig;
      const incomingAdv = settings?.adventureConfig;
      const currentAdv = updatedSpec.settings.adventureConfig;
      const isLegacyAdventure =
        existingAdv?.assetStatus === undefined &&
        (existingAdv?.version ?? 1) < 2 &&
        incomingAdv?.assetStatus === undefined &&
        currentAdv.industryId !== 'CUSTOM';

      if (!isLegacyAdventure) {
        const nowIso = new Date().toISOString();

        // Never trust client-supplied asset metadata alone; prefer existing server-verified assets for the same industryId
        if (
          existingAdv?.assets &&
          existingAdv.assets.background.industryId === currentAdv.industryId &&
          existingAdv.assets.character.industryId === currentAdv.industryId &&
          existingAdv.assets.obstacle.industryId === currentAdv.industryId
        ) {
          currentAdv.assets = existingAdv.assets;
          currentAdv.assetPackSource = existingAdv.assetPackSource ?? existingAdv.assets.background.source;
        }

        let checkResult = verifyAdventureGameAssets(updatedSpec);

        // If industry is one of the 8 pre-defined industries and not yet verified (e.g. user changed industryId), resolve from pack
        if (!checkResult.verified && currentAdv.industryId !== 'CUSTOM') {
          const packRes = resolveAdventureAssetPack(currentAdv.industryId);
          if (packRes.verified && packRes.pack) {
            currentAdv.version = Math.max(currentAdv.version || 1, 2);
            currentAdv.assets = packRes.pack.assets;
            currentAdv.assetPackSource = 'ANTIGRAVITY_BANANA_PACK';
            currentAdv.assetStatus = 'READY';
            currentAdv.assetError = null;
            currentAdv.assetErrorCode = null;
            currentAdv.assetUpdatedAt = nowIso;
            checkResult = verifyAdventureGameAssets(updatedSpec);
          } else {
            checkResult = {
              verified: false,
              industryId: currentAdv.industryId,
              assetStatus: 'ASSET_GENERATION_FAILED',
              assets: null,
              missingAssets: packRes.missingAssets,
              errors: packRes.errors,
              errorCode: 'ASSET_PACK_INTEGRITY_ERROR',
            };
          }
        }

        if (checkResult.verified && checkResult.assets) {
          currentAdv.version = Math.max(currentAdv.version || 1, 2);
          currentAdv.assets = checkResult.assets;
          currentAdv.assetPackSource = checkResult.assets.background.source;
          currentAdv.assetStatus = 'READY';
          currentAdv.assetError = null;
          currentAdv.assetErrorCode = null;
          currentAdv.assetUpdatedAt = currentAdv.assetUpdatedAt || nowIso;
        } else {
          // Mandatory per-slot safe fallback: preserve any valid slots and replace only missing/corrupted slots from verified default pack
          const fallbackSpecRes = ensurePlayableAdventureAssetsWithFallback(updatedSpec);
          const repairedAdv = fallbackSpecRes.specification.settings?.adventureConfig;
          if (repairedAdv && repairedAdv.assets) {
            currentAdv.version = Math.max(currentAdv.version || 1, 2);
            currentAdv.assets = repairedAdv.assets;
            currentAdv.assetPackSource = repairedAdv.assetPackSource ?? repairedAdv.assets.background.source;
            currentAdv.assetStatus = 'READY';
            currentAdv.assetError = null;
            currentAdv.assetErrorCode = null;
            currentAdv.assetUpdatedAt = nowIso;
          }
        }
      }
    }

    if (Array.isArray(participants)) {
      const validParticipants = participants.filter(
        p => p && typeof p.fullName === 'string' && p.fullName.trim().length > 0
      );
      if (
        validParticipants.length > 0 &&
        (!updatedSpec.settings.rosterMode || updatedSpec.settings.rosterMode === 'FREE_TEXT')
      ) {
        updatedSpec.settings.rosterMode = 'PRECONFIGURED';
      } else if (validParticipants.length === 0 && updatedSpec.settings.sessionMode !== 'EXAM') {
        updatedSpec.settings.rosterMode = 'FREE_TEXT';
      }
    }

    gameStore.save(updatedSpec, Date.now(), ownerUserId, resolvedIsPublic);

    if (Array.isArray(participants) && participants.length > 0) {
      persistenceRepo.upsertParticipants(
        gameId,
        participants.map(item => ({
          participantId: item.participantId,
          fullName: item.fullName,
          departmentUnit: item.departmentUnit || undefined,
          employeeCode: item.employeeCode || undefined,
          contactInfo: item.contactInfo || item.email || undefined,
        })),
        true
      );
    }

    // If generateCover is requested, attempt cover generation gracefully without ever failing the save/publish flow
    if (generateCover) {
      try {
        const coverResult = await aiImageService.generateCoverForGame(updatedSpec, {
          userId: req.user?.userId ?? null,
          forceRegenerate: false,
          throwOnError: false,
        });
        if (coverResult.coverImageUrl) {
          updatedSpec.coverImageUrl = coverResult.coverImageUrl;
        }
      } catch {
        // Never block game save/publish if cover generation fails or hits quota
      }
    }

    res.status(200).json(
      createSuccessResponse(updatedSpec)
    );
  } catch (err) {
    next(err);
  }
}

gameRouter.patch('/:gameId/questions', handleUpdateGameSpecification);
gameRouter.patch('/:gameId', handleUpdateGameSpecification);
gameRouter.put('/:gameId', handleUpdateGameSpecification);

async function handleRetryAdventureAssets(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    rejectGuestOrPlayerWrite(req, 'tạo lại tài nguyên hình ảnh Adventure');

    const gameId = String(req.params.gameId || '');
    const existing = gameStore.get(gameId);
    if (!existing) {
      throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
    }

    const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
    const ownerUserId = existing.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
    const existingIsPublic = existing.isPublic ?? ownerInfo?.isPublic ?? false;

    authService.assertResourceAccess({
      resourceType: 'bộ câu hỏi',
      ownerUserId,
      currentUser: req.user,
      mode: 'write',
    });

    if (existing.gameType !== 'ADVENTURE') {
      throw new AppError(
        'INVALID_REQUEST',
        'Chỉ hỗ trợ tạo tài nguyên hình ảnh Adventure cho game thuộc thể loại ADVENTURE.',
        400
      );
    }

    const body = req.body || {};

    let updatedQuestions = existing.questions;
    let updatedTitle = existing.title;
    let updatedDescription = existing.description;

    if (Array.isArray(body.questions) && body.questions.length > 0) {
      const parseResult = UpdateGameQuestionsRequestSchema.safeParse({
        title: typeof body.title === 'string' ? body.title : existing.title,
        description: typeof body.description === 'string' ? body.description : existing.description,
        questions: body.questions,
      });
      if (parseResult.success) {
        updatedQuestions = parseResult.data.questions;
        if (parseResult.data.title) updatedTitle = parseResult.data.title;
        if (parseResult.data.description && parseResult.data.description.length > 0) {
          updatedDescription = parseResult.data.description;
        }
      }
    } else {
      if (typeof body.title === 'string' && body.title.trim().length > 0) {
        updatedTitle = body.title.trim().slice(0, 200);
      }
      if (typeof body.description === 'string' && body.description.trim().length > 0) {
        updatedDescription = body.description.trim().slice(0, 1000);
      }
    }

    const baseAdv =
      existing.settings?.adventureConfig ||
      analyzeSourceContentForAdventure([], {
        questionCount: updatedQuestions.length,
        questions: updatedQuestions,
      });

    const nextAdvInput = {
      ...baseAdv,
      ...(typeof body.industryId === 'string' ? { industryId: body.industryId } : {}),
      ...(typeof body.industryLabel === 'string' && body.industryLabel.trim()
        ? { industryLabel: body.industryLabel.trim() }
        : {}),
      ...(typeof body.subEnvironment === 'string' && body.subEnvironment.trim()
        ? { subEnvironment: body.subEnvironment.trim() }
        : {}),
    };

    const sanitizedAdv = sanitizeAdventureConfig(nextAdvInput, baseAdv, updatedQuestions);
    const candidateSpec = GameSpecificationSchema.parse({
      ...existing,
      ownerUserId,
      title: updatedTitle,
      description: updatedDescription,
      questions: updatedQuestions,
      settings: {
        ...existing.settings,
        questionCount: updatedQuestions.length,
        adventureConfig: sanitizedAdv,
      },
    });

    const forceRegenerate =
      body.forceRegenerate !== undefined ? Boolean(body.forceRegenerate) : false;

    const provisionResult = await provisionAdventureAssetsForGame(candidateSpec, {
      userId: req.user?.userId ?? null,
      forceRegenerate,
    });

    // Always persist updated specification (keeping all existing questions intact)
    const nextIsPublic = provisionResult.verified ? existingIsPublic : false;
    const savedSpec = {
      ...provisionResult.specification,
      ownerUserId,
      isPublic: nextIsPublic,
    };
    gameStore.save(savedSpec, Date.now(), ownerUserId, nextIsPublic);

    if (!provisionResult.verified) {
      const statusCode = provisionResult.errorCode === 'AI_QUOTA_EXCEEDED' ? 429 : 422;
      throw new AppError(
        provisionResult.errorCode || 'ADVENTURE_ASSETS_INCOMPLETE',
        provisionResult.errors.join('; ') ||
          'Không thể tạo bộ tài nguyên hình ảnh Adventure. Bộ câu hỏi hiện tại vẫn được giữ nguyên.',
        statusCode
      );
    }

    res.status(200).json(createSuccessResponse(savedSpec));
  } catch (err) {
    next(err);
  }
}

gameRouter.post(
  '/:gameId/adventure-assets/retry',
  generateRateLimiter.middleware,
  handleRetryAdventureAssets
);
gameRouter.post(
  '/:gameId/adventure-assets',
  generateRateLimiter.middleware,
  handleRetryAdventureAssets
);

/**
 * POST /api/games/:gameId/cover
 * Generate or regenerate a Gemini cover image for a specific game.
 * Gracefully falls back to SVG illustration if Gemini image service is unavailable.
 */
gameRouter.post(
  '/:gameId/cover',
  generateRateLimiter.middleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'tạo ảnh bìa game bằng AI');

      const gameId = String(req.params.gameId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;

      authService.assertResourceAccess({
        resourceType: 'bộ câu hỏi',
        ownerUserId,
        currentUser: req.user,
        mode: 'write',
      });

      const forceRegenerate = Boolean(req.body?.forceRegenerate);
      const result = await aiImageService.generateCoverForGame(spec, {
        userId: req.user?.userId ?? null,
        forceRegenerate,
        throwOnError: false,
      });

      res.status(200).json(createSuccessResponse(result));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/games/:gameId/duplicate
 * Duplicate an existing game into the current user's library as a Draft.
 */
gameRouter.post(
  '/:gameId/duplicate',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'sao chép bộ câu hỏi');

      const gameId = String(req.params.gameId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
      const isPublic = spec.isPublic ?? ownerInfo?.isPublic ?? false;

      authService.assertResourceAccess({
        resourceType: 'bộ câu hỏi',
        ownerUserId,
        currentUser: req.user,
        mode: 'read',
        isPublic,
      });

      const isManager = hasCreatorOrHostManagementAccess(req, gameId, ownerUserId);
      if (
        spec.settings?.sessionMode === 'EXAM' &&
        !spec.settings?.answersPublished &&
        !isManager
      ) {
        throw new AppError(
          'EXAM_ANSWERS_LOCKED',
          'Không thể sao chép bộ đề thi đang bảo mật đáp án khi người tạo chưa công bố đáp án.',
          403
        );
      }

      const customTitle =
        typeof req.body?.title === 'string' && req.body.title.trim().length > 0
          ? req.body.title.trim()
          : undefined;

      const duplicated = persistenceRepo.duplicateGame(
        gameId,
        req.user?.userId ?? null,
        customTitle
      );

      if (!duplicated) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      gameStore.save(duplicated, Date.now(), req.user?.userId ?? null, false);
      res.status(201).json(createSuccessResponse(duplicated));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/games/:gameId/participants
 * Lists participants for a game.
 * - Creator/Admin/Host receives full participant records.
 * - Public/Player receives safe roster entries (participantId, fullName, departmentUnit, status, isLocked, canJoin).
 */
gameRouter.get(
  '/:gameId/participants',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = String(req.params.gameId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
      const isPublic = spec.isPublic ?? ownerInfo?.isPublic ?? false;
      const hasActiveRoom = roomStore.hasActiveRoomForGame(gameId);

      const isManager = hasCreatorOrHostManagementAccess(req, gameId, ownerUserId);
      const requestedMode = String(req.query.mode || '').toLowerCase();
      if ((requestedMode === 'admin' || requestedMode === 'manage') && !isManager) {
        authService.assertResourceAccess({
          resourceType: 'danh sách thí sinh',
          ownerUserId,
          currentUser: req.user,
          mode: 'write',
        });
      }
      if (!isManager && !isPublic && !hasActiveRoom) {
        authService.assertResourceAccess({
          resourceType: 'danh sách thí sinh',
          ownerUserId,
          currentUser: req.user,
          mode: 'read',
          isPublic,
        });
      }

      const search =
        typeof req.query.search === 'string' && req.query.search.trim()
          ? req.query.search.trim()
          : undefined;
      const status =
        typeof req.query.status === 'string' && req.query.status.trim()
          ? req.query.status.trim()
          : undefined;

      const result = persistenceRepo.listParticipants(gameId, {
        search,
        status,
        limit: 1000,
        offset: 0,
      });
      const list = result.participants;
      const rosterMode = spec.settings?.rosterMode || 'FREE_TEXT';
      const sessionMode = spec.settings?.sessionMode === 'EXAM' ? 'EXAM' : 'PLAY';
      const examStatus = spec.settings?.examStatus || 'OPEN';

      if (isManager && String(req.query.mode || '').toLowerCase() !== 'public') {
        res.status(200).json(
          createSuccessResponse({
            gameId,
            rosterMode,
            sessionMode,
            examStatus,
            total: result.total,
            departments: result.departments,
            participants: list,
          })
        );
        return;
      }

      // Safe public roster view for participant selection dropdown
      const safeParticipants = list.map((p) => {
        const isLocked = Boolean(p.activeSessionId || p.activeRoomCode);
        const canJoin = p.usedAttempts < p.allowedAttempts || isLocked;
        return {
          id: p.participantId,
          participantId: p.participantId,
          fullName: p.fullName,
          departmentUnit: p.departmentUnit,
          employeeCode: p.employeeCode,
          status: p.status,
          lockStatus: isLocked ? 'LOCKED' : 'AVAILABLE',
          isLocked,
          canJoin,
          canStartAttempt: canJoin,
          usedAttempts: p.usedAttempts,
          allowedAttempts: p.allowedAttempts,
          retakeGrantedCount: p.retakeGrantedCount,
        };
      });

      res.status(200).json(
        createSuccessResponse({
          gameId,
          rosterMode,
          sessionMode,
          examStatus,
          total: safeParticipants.length,
          departments: result.departments,
          participants: safeParticipants,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/games/:gameId/participants
 * Adds or imports participants into the game's roster (manual array, pasted multiline text, or CSV/XLSX upload).
 */
gameRouter.post(
  '/:gameId/participants',
  rosterFileUpload.single('file'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'quản lý danh sách thí sinh');

      const gameId = String(req.params.gameId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
      const isPublic = spec.isPublic ?? ownerInfo?.isPublic ?? false;

      if (!hasCreatorOrHostManagementAccess(req, gameId, ownerUserId)) {
        authService.assertResourceAccess({
          resourceType: 'danh sách thí sinh',
          ownerUserId,
          currentUser: req.user,
          mode: 'write',
        });
      }

      const incomingItems: ParsedParticipantDraft[] = [];

      if (Array.isArray(req.body?.participants)) {
        for (const item of req.body.participants) {
          if (item && typeof item.fullName === 'string' && item.fullName.trim()) {
            incomingItems.push({
              participantId: typeof item.participantId === 'string' ? item.participantId.trim() : undefined,
              fullName: item.fullName.trim(),
              departmentUnit:
                typeof item.departmentUnit === 'string' ? item.departmentUnit.trim() : null,
              employeeCode:
                typeof item.employeeCode === 'string' ? item.employeeCode.trim() : undefined,
              contactInfo:
                typeof item.contactInfo === 'string'
                  ? item.contactInfo.trim()
                  : typeof item.email === 'string'
                    ? item.email.trim()
                    : undefined,
            });
          }
        }
      }

      if (typeof req.body?.fullName === 'string' && req.body.fullName.trim()) {
        incomingItems.push({
          fullName: req.body.fullName.trim(),
          departmentUnit:
            typeof req.body?.departmentUnit === 'string' ? req.body.departmentUnit.trim() : null,
          employeeCode:
            typeof req.body?.employeeCode === 'string' ? req.body.employeeCode.trim() : undefined,
          contactInfo:
            typeof req.body?.contactInfo === 'string' ? req.body.contactInfo.trim() : undefined,
        });
      }

      let fileBuffer: Buffer | undefined = req.file?.buffer;
      let fileName: string | undefined = req.file?.originalname;
      if (!fileBuffer && typeof req.body?.fileBase64 === 'string' && req.body.fileBase64.trim()) {
        const rawB64 = req.body.fileBase64.replace(/^data:[^;]+;base64,/, '');
        fileBuffer = Buffer.from(rawB64, 'base64');
        fileName = typeof req.body.fileName === 'string' ? req.body.fileName : 'roster.xlsx';
      }

      const parsedFromTextOrFile = parseParticipantsFromBufferOrText({
        rawText: typeof req.body?.rawText === 'string' ? req.body.rawText : undefined,
        fileBuffer,
        fileName,
      });
      incomingItems.push(...parsedFromTextOrFile);

      const replaceAll = Boolean(req.body?.replaceAll);
      const savedParticipants = persistenceRepo.upsertParticipants(
        gameId,
        incomingItems.map((item) => ({
          participantId: item.participantId,
          fullName: item.fullName,
          departmentUnit: item.departmentUnit || undefined,
          employeeCode: item.employeeCode || undefined,
          contactInfo: item.contactInfo || undefined,
        })),
        replaceAll
      );

      // Optionally update rosterMode on game settings
      const parsedRosterMode = RosterModeEnum.safeParse(req.body?.rosterMode);
      const currentRosterMode = spec.settings?.rosterMode || 'FREE_TEXT';
      const nextRosterMode = parsedRosterMode.success
        ? parsedRosterMode.data
        : currentRosterMode === 'FREE_TEXT' && savedParticipants.length > 0
          ? 'PRECONFIGURED'
          : currentRosterMode;

      if (nextRosterMode !== currentRosterMode) {
        const updatedSpec: GameSpecification = {
          ...spec,
          settings: {
            ...spec.settings,
            rosterMode: nextRosterMode,
          },
        };
        gameStore.save(updatedSpec, Date.now(), ownerUserId, isPublic);
      }

      res.status(200).json(
        createSuccessResponse({
          gameId,
          rosterMode: nextRosterMode,
          addedOrUpdatedCount: incomingItems.length,
          total: savedParticipants.length,
          participants: savedParticipants,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/games/:gameId/participants/:participantId
 * Updates a participant's fullName or departmentUnit.
 */
gameRouter.patch(
  '/:gameId/participants/:participantId',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'cập nhật thông tin thí sinh');

      const gameId = String(req.params.gameId || '');
      const participantId = String(req.params.participantId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;

      if (!hasCreatorOrHostManagementAccess(req, gameId, ownerUserId)) {
        authService.assertResourceAccess({
          resourceType: 'thí sinh',
          ownerUserId,
          currentUser: req.user,
          mode: 'write',
        });
      }

      const updated = persistenceRepo.updateParticipant(gameId, participantId, {
        fullName: typeof req.body?.fullName === 'string' ? req.body.fullName : undefined,
        departmentUnit:
          req.body?.departmentUnit !== undefined ? req.body.departmentUnit : undefined,
      });

      if (!updated) {
        throw new AppError('PARTICIPANT_NOT_FOUND', 'Không tìm thấy thí sinh trong danh sách.', 404);
      }

      res.status(200).json(createSuccessResponse(updated));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/games/:gameId/participants/:participantId
 * Removes a single participant from the game's roster.
 */
gameRouter.delete(
  '/:gameId/participants/:participantId',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'xóa thí sinh khỏi danh sách');

      const gameId = String(req.params.gameId || '');
      const participantId = String(req.params.participantId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;

      if (!hasCreatorOrHostManagementAccess(req, gameId, ownerUserId)) {
        authService.assertResourceAccess({
          resourceType: 'thí sinh',
          ownerUserId,
          currentUser: req.user,
          mode: 'write',
        });
      }

      const deleted = persistenceRepo.deleteParticipant(gameId, participantId);
      if (!deleted) {
        throw new AppError('PARTICIPANT_NOT_FOUND', 'Không tìm thấy thí sinh cần xóa.', 404);
      }

      res.status(200).json(createSuccessResponse({ deleted: true, participantId }));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/games/:gameId/participants
 * Clears all participants from the game's roster.
 */
gameRouter.delete(
  '/:gameId/participants',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'xóa toàn bộ danh sách thí sinh');

      const gameId = String(req.params.gameId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;

      if (!hasCreatorOrHostManagementAccess(req, gameId, ownerUserId)) {
        authService.assertResourceAccess({
          resourceType: 'danh sách thí sinh',
          ownerUserId,
          currentUser: req.user,
          mode: 'write',
        });
      }

      const deletedCount = persistenceRepo.clearParticipants(gameId);
      res.status(200).json(createSuccessResponse({ cleared: true, deletedCount }));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/games/:gameId/participants/:participantId/grant-retake
 * Allows Creator, Admin, or Room Host to grant 1 additional retake attempt to a specific participant.
 * Preserves all historical attempts while unlocking the participant for a new attempt.
 */
gameRouter.post(
  '/:gameId/participants/:participantId/grant-retake',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = String(req.params.gameId || '');
      const participantId = String(req.params.participantId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;

      if (!hasCreatorOrHostManagementAccess(req, gameId, ownerUserId)) {
        rejectGuestOrPlayerWrite(req, 'cấp quyền thi lại');
        authService.assertResourceAccess({
          resourceType: 'quyền thi lại của thí sinh',
          ownerUserId,
          currentUser: req.user,
          mode: 'write',
        });
      }

      const existingParticipant = persistenceRepo.getParticipantById(gameId, participantId);
      if (!existingParticipant) {
        throw new AppError('PARTICIPANT_NOT_FOUND', 'Không tìm thấy thí sinh trong danh sách.', 404);
      }

      // If the participant had an in-memory stuck active session, remove it from sessionStore
      if (existingParticipant.activeSessionId) {
        sessionStore.delete(existingParticipant.activeSessionId);
      }

      const grantedBy = req.user?.userId || 'host';
      const updated = persistenceRepo.grantParticipantRetake({
        gameId,
        participantId,
        grantedByUserId: grantedBy,
      });

      res.status(200).json(
        createSuccessResponse({
          granted: true,
          participant: updated,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/games/:gameId/publish-answers
 * Explicitly publishes correct answers & explanations for an EXAM game after the exam has ended.
 * Rejects with 409 EXAM_STILL_ACTIVE if any solo session or multiplayer room is still in progress.
 */
gameRouter.post(
  '/:gameId/publish-answers',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = String(req.params.gameId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
      const isPublic = spec.isPublic ?? ownerInfo?.isPublic ?? false;

      if (!hasCreatorOrHostManagementAccess(req, gameId, ownerUserId)) {
        rejectGuestOrPlayerWrite(req, 'công bố đáp án bài thi');
        authService.assertResourceAccess({
          resourceType: 'bộ câu hỏi bài thi',
          ownerUserId,
          currentUser: req.user,
          mode: 'write',
        });
      }

      const activeSessions = sessionStore.getActiveSessionsForGame(gameId);
      const activeRooms = roomStore.getActiveRoomsForGame(gameId);
      if (activeSessions.length > 0 || activeRooms.length > 0) {
        throw new AppError(
          'EXAM_STILL_ACTIVE',
          'Không thể công bố đáp án khi vẫn còn phiên thi cá nhân hoặc phòng thi trực tiếp đang diễn ra. Vui lòng chờ hoặc kết thúc kỳ thi trước.',
          409
        );
      }

      const publishedAt = new Date().toISOString();
      const updatedSpec: GameSpecification = {
        ...spec,
        settings: {
          ...spec.settings,
          answersPublished: true,
          answersPublishedAt: publishedAt,
        },
      };

      gameStore.save(updatedSpec, Date.now(), ownerUserId, isPublic);

      // Sync any finished rooms for this game in roomStore
      for (const room of roomStore.getAll()) {
        if (room.gameId === gameId) {
          room.answersPublished = true;
        }
      }

      res.status(200).json(
        createSuccessResponse({
          gameId,
          answersPublished: true,
          answersPublishedAt: publishedAt,
          questions: updatedSpec.questions.map((q) => ({
            id: q.id,
            question: q.question,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation,
          })),
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/games/:gameId/close-exam
 * V3 Stage 5: BTC explicitly closes an active exam and immediately auto-submits all in-progress Solo sessions & Multiplayer rooms.
 * - Blocks new attempts and new answers immediately.
 * - Auto-grades all completed questions and marks unanswered questions as timedOut / 0 points.
 * - Does NOT automatically publish correct answers (answersPublished remains unchanged until BTC clicks publish-answers).
 * - Idempotent when called repeatedly on an already closed exam.
 */
gameRouter.post(
  '/:gameId/close-exam',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = String(req.params.gameId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
      const isPublic = spec.isPublic ?? ownerInfo?.isPublic ?? false;

      if (!hasCreatorOrHostManagementAccess(req, gameId, ownerUserId)) {
        rejectGuestOrPlayerWrite(req, 'kết thúc đợt thi');
        authService.assertResourceAccess({
          resourceType: 'đợt thi',
          ownerUserId,
          currentUser: req.user,
          mode: 'write',
        });
      }

      const activeSessions = sessionStore.getActiveSessionsForGame(gameId);
      const activeRooms = roomStore.getActiveRoomsForGame(gameId);

      // Idempotent fast-path if already CLOSED and no straggling sessions/rooms exist
      if (
        spec.settings?.examStatus === 'CLOSED' &&
        activeSessions.length === 0 &&
        activeRooms.length === 0
      ) {
        res.status(200).json(
          createSuccessResponse({
            gameId,
            alreadyClosed: true,
            examStatus: 'CLOSED',
            examClosedAt: spec.settings?.examClosedAt || new Date().toISOString(),
            answersPublished: Boolean(spec.settings?.answersPublished),
            autoSubmittedSoloCount: 0,
            autoSubmittedRoomPlayersCount: 0,
            dbFinalizedCount: 0,
            totalAutoSubmitted: 0,
            closedRoomCodes: [],
          })
        );
        return;
      }

      const closedAtIso = new Date().toISOString();

      // Step 1: Transition examStatus -> CLOSING immediately to block new sessions and late answers
      const closingSpec: GameSpecification = {
        ...spec,
        settings: {
          ...spec.settings,
          examStatus: 'CLOSING',
        },
      };
      gameStore.save(closingSpec, Date.now(), ownerUserId, isPublic);

      let autoSubmittedSoloCount = 0;
      let autoSubmittedRoomPlayersCount = 0;
      let dbFinalizedCount = 0;
      const closedRoomCodes: string[] = [];

      try {
        // Step 2: Auto-submit all active Solo sessions in memory inside a single SQLite transaction
        if (activeSessions.length > 0) {
          runInTransaction(() => {
            for (const s of activeSessions) {
              try {
                s.autoSubmitOnExamClose(closedAtIso);
                autoSubmittedSoloCount++;
              } catch (err) {
                console.error(`[CloseExam] Failed to auto-submit solo session ${s.sessionId}:`, err);
              }
            }
          });
        }

        // Step 3: Force-finish all active Multiplayer rooms and notify connected WebSocket clients
        for (const room of activeRooms) {
          try {
            const leaderboard = room.forceFinishOnExamClose(closedAtIso);
            autoSubmittedRoomPlayersCount += leaderboard.length;
            closedRoomCodes.push(room.roomCode);
            multiplayerWsServer.broadcastExamClosedForRoom(room, leaderboard, closedAtIso);
          } catch (err) {
            console.error(`[CloseExam] Failed to force-finish room ${room.roomCode}:`, err);
          }
        }

        // Step 4: Finalize any remaining IN_PROGRESS rows in SQLite (e.g. orphaned sessions)
        const passThresholdPercent =
          typeof spec.settings?.passThresholdPercent === 'number'
            ? spec.settings.passThresholdPercent
            : 50;
        const totalQuestions = Math.max(1, spec.questions.length);
        const maxPossibleScore = spec.questions.reduce(
          (sum, q) => sum + ((q as any).points ?? 100) + (spec.settings?.scoringMode === 'SPEED_BONUS' ? 50 : 0),
          0
        );
        dbFinalizedCount = persistenceRepo.finalizeRemainingInProgressAttemptsOnExamClose({
          gameId,
          closedAtIso,
          passThresholdPercent,
          totalQuestions,
          maxPossibleScore,
        });
      } finally {
        // Step 5: Always transition examStatus -> CLOSED while preserving answersPublished
        const closedSpec: GameSpecification = {
          ...spec,
          settings: {
            ...spec.settings,
            examStatus: 'CLOSED',
            examClosedAt: closedAtIso,
          },
        };
        gameStore.save(closedSpec, Date.now(), ownerUserId, isPublic);
      }

      res.status(200).json(
        createSuccessResponse({
          gameId,
          alreadyClosed: false,
          examStatus: 'CLOSED',
          examClosedAt: closedAtIso,
          answersPublished: Boolean(spec.settings?.answersPublished),
          autoSubmittedSoloCount,
          autoSubmittedRoomPlayersCount,
          dbFinalizedCount,
          totalAutoSubmitted:
            autoSubmittedSoloCount + autoSubmittedRoomPlayersCount + dbFinalizedCount,
          closedRoomCodes,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/games/:gameId/reopen-exam
 * Allows BTC / Admin to reopen a previously closed exam window.
 */
gameRouter.post(
  '/:gameId/reopen-exam',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = String(req.params.gameId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
      const isPublic = spec.isPublic ?? ownerInfo?.isPublic ?? false;

      if (!hasCreatorOrHostManagementAccess(req, gameId, ownerUserId)) {
        rejectGuestOrPlayerWrite(req, 'mở lại đợt thi');
        authService.assertResourceAccess({
          resourceType: 'đợt thi',
          ownerUserId,
          currentUser: req.user,
          mode: 'write',
        });
      }

      if (spec.settings?.sessionMode === 'EXAM') {
        const rosterCheck = persistenceRepo.listParticipants(gameId, { limit: 1 });
        if (rosterCheck.total === 0) {
          throw new AppError(
            'EXAM_ROSTER_REQUIRED',
            'Chế độ Thi bắt buộc phải có danh sách thí sinh hợp lệ trước khi mở kỳ thi.',
            400
          );
        }
      }

      const reopenedSpec: GameSpecification = {
        ...spec,
        settings: {
          ...spec.settings,
          examStatus: 'OPEN',
          examClosedAt: null,
        },
      };
      gameStore.save(reopenedSpec, Date.now(), ownerUserId, isPublic);

      res.status(200).json(
        createSuccessResponse({
          gameId,
          examStatus: 'OPEN',
          examClosedAt: null,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/games/:gameId/scoreboard
 * Returns full Scoreboard, Top 3 Podium, Pass/Fail statistics, and Attempt History for Creator/Admin/Host.
 */
gameRouter.get(
  '/:gameId/scoreboard',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = String(req.params.gameId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;

      if (!hasCreatorOrHostManagementAccess(req, gameId, ownerUserId)) {
        authService.assertResourceAccess({
          resourceType: 'bảng điểm bài thi',
          ownerUserId,
          currentUser: req.user,
          mode: 'write',
        });
      }

      const search =
        typeof req.query.search === 'string' && req.query.search.trim()
          ? req.query.search.trim()
          : undefined;
      const status =
        typeof req.query.status === 'string' && req.query.status.trim()
          ? req.query.status.trim()
          : undefined;
      const departmentUnit =
        typeof req.query.departmentUnit === 'string' && req.query.departmentUnit.trim()
          ? req.query.departmentUnit.trim()
          : undefined;
      const rawSort = String(req.query.sortBy || 'rank').toLowerCase();
      const sortBy =
        rawSort === 'score' ||
        rawSort === 'accuracy' ||
        rawSort === 'duration' ||
        rawSort === 'name' ||
        rawSort === 'attempts'
          ? rawSort
          : 'rank';
      const sortDir = String(req.query.sortDir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
      const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const scoreboard = persistenceRepo.getGameScoreboard(gameId, {
        search,
        departmentUnit,
        statusFilter: status,
        sortBy,
        sortDir,
        limit,
        offset,
      });

      res.status(200).json(createSuccessResponse(scoreboard));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/games/:gameId/scoreboard/export?format=csv|xlsx|json
 * Exports the full Scoreboard & Attempt History for Creator/Admin/Host in CSV, XLSX, or JSON format.
 */
gameRouter.get(
  '/:gameId/scoreboard/export',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = String(req.params.gameId || '');
      const rawFormat = String(req.query.format || 'csv').toLowerCase();
      if (rawFormat !== 'csv' && rawFormat !== 'xlsx' && rawFormat !== 'json') {
        throw new AppError(
          'INVALID_EXPORT_FORMAT',
          `Định dạng xuất "${rawFormat}" không được hỗ trợ. Chỉ hỗ trợ: csv, xlsx, json.`,
          400
        );
      }
      const format: ScoreboardExportFormat = rawFormat;

      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;

      if (!hasCreatorOrHostManagementAccess(req, gameId, ownerUserId)) {
        authService.assertResourceAccess({
          resourceType: 'xuất bảng điểm',
          ownerUserId,
          currentUser: req.user,
          mode: 'write',
        });
      }

      const scoreboard = persistenceRepo.getGameScoreboard(gameId, {
        limit: 5000,
        offset: 0,
      });

      const payload = exportService.exportGameScoreboard(scoreboard, format);
      res.setHeader('Content-Type', payload.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
      res.status(200).send(payload.body);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/games
 * Safely deletes saved game specifications scoped strictly by authorization:
 * - Rejects Player and Guest tokens (403 ACCESS_DENIED).
 * - Requires an authenticated user session (401 UNAUTZZZ).
 * - Regular authenticated users (USER) can only delete games they own (ownerUserId === req.user.userId).
 * - Administrators (ADMIN) can delete across the repository per admin policy.
 * - Skips and reports any game currently locked by an active practice session or multiplayer room.
 */
gameRouter.delete(
  '/',
  gameDeleteRateLimiter.middleware,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'xóa hàng loạt bộ câu hỏi');

      if (!req.user || !req.user.userId) {
        throw new AppError(
          'UNAUTHORIZED',
          'Yêu cầu đăng nhập để thực hiện thao tác xóa hàng loạt bộ câu hỏi.',
          401
        );
      }

      const isAdmin = req.user.role === 'ADMIN';
      const currentUserId = req.user.userId;

      // Collect game IDs strictly scoped to the caller's permission (owner-only for USER, all for ADMIN)
      const dbGameIds = persistenceRepo.getGameIdsForUser({
        userId: currentUserId,
        isAdmin,
      });
      const memGameIds = gameStore.getAllKeys().filter((id) => {
        if (isAdmin) return true;
        const spec = gameStore.get(id);
        const ownerInfo = persistenceRepo.getGameOwnerInfo(id);
        const ownerUserId = spec?.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
        return ownerUserId !== null && ownerUserId === currentUserId;
      });
      const targetGameIds = Array.from(new Set([...dbGameIds, ...memGameIds]));

      let deletedCount = 0;
      let skippedActiveCount = 0;
      const skippedGames: Array<{ gameId: string; title?: string; reason: string }> = [];

      for (const gameId of targetGameIds) {
        const spec = gameStore.get(gameId);
        const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
        const ownerUserId = spec?.ownerUserId ?? ownerInfo?.ownerUserId ?? null;

        // Defense-in-depth: regular users can never delete another user's game or unowned system games in bulk
        if (!isAdmin && ownerUserId !== currentUserId) {
          continue;
        }

        const hasSession = sessionStore.hasActiveSessionForGame(gameId);
        const hasRoom = roomStore.hasActiveRoomForGame(gameId);

        if (hasSession || hasRoom) {
          skippedActiveCount++;
          skippedGames.push({
            gameId,
            title: spec?.title || gameId,
            reason: hasRoom
              ? 'Phòng chơi trực tiếp đang diễn ra'
              : 'Phiên luyện tập đang hoạt động',
          });
          continue;
        }

        try {
          const coverUrl =
            spec?.coverImageUrl ?? persistenceRepo.getGameCoverMetadata(gameId)?.coverImageUrl ?? null;
          gameStore.delete(gameId);
          if (coverUrl) {
            aiImageService.cleanupOrphanedCoverImage(coverUrl);
          }
          cleanupOrphanedAdventureGameAssets(gameId, process.cwd(), (urlPrefix) =>
            persistenceRepo.countGamesByAdventureAssetPrefix(urlPrefix) > 0
          );
          deletedCount++;
        } catch (err: any) {
          // Continue deleting other games if a single game deletion encounters an unexpected error
          console.error(`[DeleteAllGames] Failed to delete game "${gameId}":`, err);
        }
      }

      res.status(200).json(
        createSuccessResponse({
          deleted: true,
          deletedCount,
          skippedActiveCount,
          totalTargeted: targetGameIds.length,
          skippedGames,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/games/:gameId
 * Safely deletes a saved game specification from the game repository.
 * Enforces strict write authorization:
 * - Rejects Guest and Player tokens (403 ACCESS_DENIED).
 * - Verifies ownership via authService.assertResourceAccess(..., mode: 'write') so only the owner or ADMIN can delete an owned game.
 * - Prevents deletion of games currently in use by an active session or multiplayer room (409 GAME_IN_USE).
 */
gameRouter.delete(
  '/:gameId',
  gameDeleteRateLimiter.middleware,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'xóa game');

      const gameId = String(req.params.gameId || '');
      const existing = gameStore.get(gameId);
      if (!existing) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = existing.ownerUserId ?? ownerInfo?.ownerUserId ?? null;

      authService.assertResourceAccess({
        resourceType: 'bộ câu hỏi',
        ownerUserId,
        currentUser: req.user,
        mode: 'write',
      });

      if (sessionStore.hasActiveSessionForGame(gameId) || roomStore.hasActiveRoomForGame(gameId)) {
        throw new AppError(
          'GAME_IN_USE',
          'Không thể xóa bộ câu hỏi đang có phiên luyện tập hoặc phòng chơi trực tiếp đang diễn ra.',
          409
        );
      }

      const coverUrl =
        existing.coverImageUrl ?? persistenceRepo.getGameCoverMetadata(gameId)?.coverImageUrl ?? null;
      gameStore.delete(gameId);
      if (coverUrl) {
        aiImageService.cleanupOrphanedCoverImage(coverUrl);
      }
      cleanupOrphanedAdventureGameAssets(gameId, process.cwd(), (urlPrefix) =>
        persistenceRepo.countGamesByAdventureAssetPrefix(urlPrefix) > 0
      );
      res.status(200).json(
        createSuccessResponse({
          deleted: true,
          gameId,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/games/:gameId/status
 * Returns active sessions and rooms for a specific game, along with deletable status.
 */
gameRouter.get('/:gameId/status', (req: Request, res: Response, next: NextFunction) => {
  try {
    const gameId = String(req.params.gameId || '');
    const spec = gameStore.get(gameId);
    const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
    if (!spec && !ownerInfo) {
      throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
    }

    const ownerUserId = spec?.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
    const isPublic = spec?.isPublic ?? ownerInfo?.isPublic ?? false;

    authService.assertResourceAccess({
      resourceType: 'bộ câu hỏi',
      ownerUserId,
      currentUser: req.user,
      mode: 'read',
      isPublic,
    });

    const activeStatus = computeGameActiveStatus(gameId);
    res.status(200).json(createSuccessResponse(activeStatus));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/games/:gameId/qr
 * Generate a real QR code and public solo-play link for a published game.
 */
gameRouter.get(
  '/:gameId/qr',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = String(req.params.gameId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const isPublic = spec.isPublic ?? ownerInfo?.isPublic ?? false;

      if (!isPublic) {
        throw new AppError(
          'GAME_NOT_PUBLISHED',
          'Game này chưa được xuất bản nên không thể tạo liên kết và mã QR chơi công khai.',
          403
        );
      }

      if (spec.settings?.sessionMode === 'EXAM') {
        const rosterCheck = persistenceRepo.listParticipants(gameId, { limit: 1 });
        if (rosterCheck.total === 0) {
          throw new AppError(
            'EXAM_ROSTER_REQUIRED',
            'Chế độ Thi bắt buộc phải có danh sách thí sinh hợp lệ trước khi mở mã QR hoặc liên kết kỳ thi.',
            400
          );
        }
      }

      const playUrl = buildSoloPlayUrl(req, gameId);
      const qrDataUrl = await QRCode.toDataURL(playUrl, {
        margin: 1,
        width: 256,
        errorCorrectionLevel: 'M',
      });

      res.status(200).json(
        createSuccessResponse({
          gameId,
          title: spec.title,
          playUrl,
          qrDataUrl,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/games/:gameId/export?format=csv|json
 * Export question set in CSV or JSON format.
 * When sessionMode === 'EXAM' and answersPublished !== true, only the Owner or Admin can export questions (which contain answers).
 */
gameRouter.get(
  '/:gameId/export',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = String(req.params.gameId || '');
      const rawFormat = String(req.query.format || 'json').toLowerCase();
      if (rawFormat !== 'csv' && rawFormat !== 'json') {
        throw new AppError('INVALID_EXPORT_FORMAT', `Unsupported export format "${rawFormat}". Supported formats: csv, json.`, 400);
      }
      const format: ExportFormat = rawFormat;

      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;
      const isPublic = spec.isPublic ?? ownerInfo?.isPublic ?? false;

      const isUnpublishedExam =
        spec.settings?.sessionMode === 'EXAM' && !spec.settings?.answersPublished;

      if (isUnpublishedExam) {
        if (!hasCreatorOrHostManagementAccess(req, gameId, ownerUserId)) {
          authService.assertResourceAccess({
            resourceType: 'đáp án bài thi',
            ownerUserId,
            currentUser: req.user,
            mode: 'write',
          });
        }
      } else {
        authService.assertResourceAccess({
          resourceType: 'bộ câu hỏi',
          ownerUserId,
          currentUser: req.user,
          mode: 'read',
          isPublic,
        });
      }

      const payload = exportService.exportGameQuestions(spec, format);
      res.setHeader('Content-Type', payload.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
      res.status(200).send(payload.body);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/games/:gameId/history
 * Retrieve practice sessions and multiplayer room history for a specific game.
 * Restricted to game owner, active room hostToken, or Admin (prevents IDOR and exam answer leakage).
 */
gameRouter.get(
  '/:gameId/history',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'xem lịch sử bộ câu hỏi');
      const gameId = String(req.params.gameId || '');
      const spec = gameStore.get(gameId);
      if (!spec) {
        throw new AppError('GAME_NOT_FOUND', `Game specification "${gameId}" not found.`, 404);
      }

      const ownerInfo = persistenceRepo.getGameOwnerInfo(gameId);
      const ownerUserId = spec.ownerUserId ?? ownerInfo?.ownerUserId ?? null;

      if (!hasCreatorOrHostManagementAccess(req, gameId, ownerUserId)) {
        if (!req.user || !req.user.userId) {
          throw new AppError(
            'UNAUTHORIZED',
            'Yêu cầu đăng nhập để xem lịch sử của bộ câu hỏi.',
            401
          );
        }
        if (!ownerUserId || ownerUserId === 'legacy_local') {
          throw new AppError(
            'ACCESS_DENIED',
            'Bạn không có quyền xem lịch sử của bộ câu hỏi chưa định danh chủ sở hữu này.',
            403
          );
        }
        authService.assertResourceAccess({
          resourceType: 'lịch sử bộ câu hỏi',
          ownerUserId,
          currentUser: req.user,
          mode: 'write',
        });
      }

      const practiceSessions = persistenceRepo.listPracticeSessions({
        gameId,
        userId: ownerUserId ?? null,
        isAdmin: true,
        limit: 50,
      });

      const roomHistory = persistenceRepo.listRoomHistory({
        gameId,
        userId: ownerUserId ?? null,
        isAdmin: true,
        limit: 50,
      });

      res.status(200).json(
        createSuccessResponse({
          gameId,
          title: spec.title,
          gameType: spec.gameType,
          practiceSessions,
          roomHistory,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);
