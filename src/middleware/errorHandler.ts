import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, createErrorResponse } from '../utils/errors.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
    return;
  }

  if (err instanceof ZodError) {
    const issueMessages = (err as any).issues?.map((i: any) => `${i.path?.join('.')}: ${i.message}`).join(', ') || err.message;
    res.status(400).json(
      createErrorResponse('VALIDATION_ERROR', `Schema validation failed: ${issueMessages}`)
    );
    return;
  }

  // Multer errors (e.g. file size limit exceeded)
  if (err && typeof err === 'object' && 'name' in err && (err as any).name === 'MulterError') {
    const multerErr = err as any;
    if (multerErr.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json(
        createErrorResponse('FILE_TOO_LARGE', 'Uploaded file exceeds the maximum allowed file size.')
      );
      return;
    }
    res.status(400).json(createErrorResponse('UPLOAD_ERROR', multerErr.message));
    return;
  }

  // Generic fallback: never expose raw stack traces or internal secrets
  const message = process.env.NODE_ENV === 'test' && err instanceof Error
    ? err.message
    : 'An unexpected internal error occurred.';

  res.status(500).json(createErrorResponse('INTERNAL_SERVER_ERROR', message));
}

