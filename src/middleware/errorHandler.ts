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
    res.status(err.statusCode).json(createErrorResponse(err.code, err.message, err.details));
    return;
  }

  if (err instanceof ZodError) {
    const issues = (err as any).issues || [];
    const formattedIssues = issues
      .map((i: any) => `${i.path?.length ? i.path.join('.') : 'Dữ liệu'}: ${i.message}`)
      .join('; ');
    const viMessage = `Dữ liệu gửi lên chưa hợp lệ. Lý do: ${formattedIssues || 'Thông tin không đúng định dạng yêu cầu'}. Vui lòng kiểm tra và thử lại.`;
    res.status(400).json(
      createErrorResponse('VALIDATION_ERROR', viMessage, issues)
    );
    return;
  }

  // Multer errors (e.g. file size limit exceeded)
  if (err && typeof err === 'object' && 'name' in err && (err as any).name === 'MulterError') {
    const multerErr = err as any;
    if (multerErr.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json(
        createErrorResponse(
          'FILE_TOO_LARGE',
          'Tệp tải lên vượt quá dung lượng cho phép (tối đa 10MB mỗi tệp). Nguyên nhân: Kích thước tệp quá lớn. Vui lòng nén tệp hoặc chọn tài liệu khác.'
        )
      );
      return;
    }
    if (multerErr.code === 'LIMIT_FILE_COUNT') {
      res.status(400).json(
        createErrorResponse(
          'LIMIT_EXCEEDED',
          'Vượt quá số lượng tệp cho phép (tối đa 5 tệp mỗi lần tải lên). Vui lòng kiểm tra lại.'
        )
      );
      return;
    }
    res.status(400).json(
      createErrorResponse('UPLOAD_ERROR', `Không thể tải lên tệp: ${multerErr.message}. Vui lòng thử lại.`)
    );
    return;
  }

  // Generic fallback: never expose raw stack traces or internal secrets
  const rawMsg = err instanceof Error ? err.message : String(err);
  let friendlyMessage = 'Đã xảy ra sự cố nội bộ hệ thống. Nguyên nhân: Xử lý không hoàn tất. Vui lòng thử lại sau giây lát hoặc liên hệ ban quản trị.';
  if (rawMsg.includes('ECONNREFUSED')) {
    friendlyMessage = 'Không thể kết nối đến dịch vụ phụ trợ. Nguyên nhân: Kết nối mạng bị từ chối (ECONNREFUSED). Vui lòng kiểm tra lại dịch vụ đang chạy.';
  } else if (rawMsg.includes('SQLITE_CONSTRAINT') || rawMsg.includes('UNIQUE constraint')) {
    friendlyMessage = 'Không thể lưu bản ghi. Nguyên nhân: Dữ liệu bị trùng lặp hoặc vi phạm ràng buộc dữ liệu. Vui lòng thử lại với tên khác.';
  }

  const message = process.env.NODE_ENV === 'test' && err instanceof Error
    ? (err.message.includes('ECONNREFUSED') || err.message.includes('SQLITE_CONSTRAINT') ? friendlyMessage : err.message)
    : friendlyMessage;

  res.status(500).json(createErrorResponse('INTERNAL_SERVER_ERROR', message));
}

