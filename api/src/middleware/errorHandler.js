import { AppError, mapPgError } from '../core/errors.js';
import { isProd } from '../config/index.js';

export function errorHandler(err, req, res, _next) {
  const mapped = err instanceof AppError ? err : (mapPgError(err) ?? null);

  if (!mapped) {
    req.log?.error({ err }, 'lỗi không lường trước');
    return res.status(500).json({
      error: { code: 'INTERNAL', message: 'Lỗi hệ thống.',
               ...(isProd ? {} : { debug: err?.message }) },
    });
  }

  if (mapped.operationalAlert) {
    req.log?.fatal({ err }, 'app_role bị từ chối quyền — route đang cố làm việc thiết kế cấm');
  }

  // Task 4 nối logDenied vào đây cho mọi lỗi 4xx.
  res.status(mapped.status).json({
    error: { code: mapped.code, message: mapped.message, ...(mapped.fields ? { fields: mapped.fields } : {}) },
  });
}
