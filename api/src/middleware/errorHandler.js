import { AppError, mapPgError } from '../core/errors.js';
import { isProd } from '../config/index.js';
import { logDenied } from '../core/audit.js';

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

  // Từ chối phải để lại dấu (bẫy mục 3, xem core/audit.js): logDenied tự mở
  // giao dịch RIÊNG sau khi giao dịch chính đã rollback, nên không route nào
  // phải tự nhớ ghi — đây là nơi DUY NHẤT gọi logDenied.
  if (mapped.status >= 400 && mapped.status < 500 && req.actor?.communityId) {
    logDenied({
      communityId: req.actor.communityId,
      actorId: req.actor.id,
      action: `${req.method.toLowerCase()}:${req.route?.path ?? req.path}`.slice(0, 64),
      detail: { code: mapped.code },
    }).catch((e) => req.log?.error?.({ e }, 'không ghi được nhật ký từ chối'));
  }

  res.status(mapped.status).json({
    error: { code: mapped.code, message: mapped.message, ...(mapped.fields ? { fields: mapped.fields } : {}) },
  });
}
