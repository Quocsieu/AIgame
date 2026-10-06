import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { LIMITS } from '../config/limits.js';
import { ingestionService, UploadedFilePayload } from '../services/ingestion.service.js';
import { createSuccessResponse } from '../utils/errors.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LIMITS.MAX_FILE_BYTES,
    files: LIMITS.MAX_FILES_PER_REQUEST,
  },
});

export const contentRouter = Router();

contentRouter.post(
  '/ingest',
  upload.array('files', LIMITS.MAX_FILES_PER_REQUEST),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
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
      const files: UploadedFilePayload[] = expressFiles.map(f => ({
        originalname: f.originalname,
        mimetype: f.mimetype,
        buffer: f.buffer,
        size: f.size,
      }));

      const result = await ingestionService.ingest({ urls, files });

      res.status(200).json(createSuccessResponse(result));
    } catch (err) {
      next(err);
    }
  }
);
