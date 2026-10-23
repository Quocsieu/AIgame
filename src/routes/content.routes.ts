import fs from 'node:fs';
import path from 'node:path';
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { LIMITS } from '../config/limits.js';
import { ingestRateLimiter } from '../middleware/rateLimiter.js';
import { rejectGuestOrPlayerWrite } from '../middleware/auth.middleware.js';
import { ingestionService, UploadedFilePayload } from '../services/ingestion.service.js';
import { quotaService } from '../services/quota.service.js';
import { AppError, createSuccessResponse } from '../utils/errors.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LIMITS.MAX_FILE_BYTES, // 10 MB per file
    files: LIMITS.MAX_FILES_PER_REQUEST, // max 5 files
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.docx', '.xlsx', '.pdf', '.txt', '.md', '.markdown', '.csv'];
    if (!allowed.includes(ext)) {
      return cb(
        new AppError(
          'UNSUPPORTED_FILE_TYPE',
          `Định dạng tệp "${ext}" không được hỗ trợ. Các định dạng cho phép: .pdf, .docx, .xlsx, .txt, .md, .csv.`,
          415
        )
      );
    }
    cb(null, true);
  },
});

export const contentRouter = Router();

contentRouter.post(
  '/ingest',
  ingestRateLimiter.middleware,
  upload.array('files', LIMITS.MAX_FILES_PER_REQUEST),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      rejectGuestOrPlayerWrite(req, 'nạp tài liệu để tạo game');

      if (req.user) {
        quotaService.consumeUserQuota(req.user.userId, 'DAILY_INGESTIONS', 1);
      }

      let urls: string[] = [];

      if (req.body?.urls) {
        if (Array.isArray(req.body.urls)) {
          urls = req.body.urls;
        } else if (typeof req.body.urls === 'string') {
          try {
            const parsed = JSON.parse(req.body.urls);
            if (Array.isArray(parsed)) {
              urls = parsed;
            } else {
              urls = [req.body.urls];
            }
          } catch {
            urls = req.body.urls.split(',').map((u: string) => u.trim());
          }
        }
      } else if (req.body?.url && typeof req.body.url === 'string') {
        urls = [req.body.url];
      }

      const expressFiles = (req.files as Express.Multer.File[]) || [];

      if (expressFiles.length > LIMITS.MAX_FILES_PER_REQUEST) {
        throw new AppError(
          'LIMIT_EXCEEDED',
          `Vượt quá số lượng tệp cho phép (tối đa ${LIMITS.MAX_FILES_PER_REQUEST} tệp mỗi lần nạp).`,
          400
        );
      }

      const totalBytes = expressFiles.reduce((acc, f) => acc + f.size, 0);
      if (totalBytes > LIMITS.MAX_TOTAL_FILE_BYTES) {
        throw new AppError(
          'TOTAL_FILE_SIZE_EXCEEDED',
          `Tổng dung lượng các tệp (${(totalBytes / (1024 * 1024)).toFixed(1)}MB) vượt quá giới hạn 25MB cho phép. Vui lòng giảm bớt tệp hoặc chọn tài liệu nhỏ hơn.`,
          413
        );
      }

      const files: UploadedFilePayload[] = expressFiles.map(f => ({
        originalname: f.originalname,
        mimetype: f.mimetype,
        buffer: f.buffer,
        size: f.size,
      }));

      const result = await ingestionService.ingest({
        urls,
        files,
        ownerUserId: req.user?.userId || null,
      });

      res.status(200).json(createSuccessResponse(result));
    } catch (err) {
      next(err);
    } finally {
      // Safe cleanup: remove any temporary files if saved to disk by multer or custom storage
      const expressFiles = (req.files as Express.Multer.File[]) || [];
      for (const f of expressFiles) {
        if ((f as any).path) {
          try {
            await fs.promises.unlink((f as any).path);
          } catch {
            // ignore if already deleted or memory storage
          }
        }
      }
    }
  }
);

