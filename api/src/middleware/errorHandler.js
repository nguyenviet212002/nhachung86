import { AppError, mapPgError } from '../core/errors.js';
import { isProd } from '../config/index.js';

// Phát hiện soát xét (Important, vòng sửa 1): `req.log?.x(...)` nuốt lỗi im
// lặng nếu vì lý do gì đó `req.log` không tồn tại (vd. middleware pino-http bị
// gỡ nhầm ở một lần sửa sau). Một cảnh báo 42501 không được phép biến mất chỉ
// vì thiếu một middleware — luôn có nơi ghi lại, kể cả khi phải rơi về console.
function logFatal(req, err, msg) {
  if (req?.log?.fatal) req.log.fatal({ err }, msg);
  else console.error(msg, err);
}

function logError(req, err, msg) {
  if (req?.log?.error) req.log.error({ err }, msg);
  else console.error(msg, err);
}

export function errorHandler(err, req, res, _next) {
  const mapped = err instanceof AppError ? err : (mapPgError(err) ?? null);

  if (!mapped) {
    logError(req, err, 'lỗi không lường trước');
    return res.status(500).json({
      error: { code: 'INTERNAL', message: 'Lỗi hệ thống.',
               ...(isProd ? {} : { debug: err?.message }) },
    });
  }

  if (mapped.operationalAlert) {
    logFatal(req, err, 'app_role bị từ chối quyền — route đang cố làm việc thiết kế cấm');
  }

  // Task 4 nối logDenied vào đây cho mọi lỗi 4xx.
  res.status(mapped.status).json({
    error: { code: mapped.code, message: mapped.message, ...(mapped.fields ? { fields: mapped.fields } : {}) },
  });
}
