import { AppError } from '../core/errors.js';

// requireAuth (auth.js) phải chạy trước middleware này để gắn req.actor.roles.
export function requireRole(...keys) {
  return (req, _res, next) =>
    req.actor?.roles?.some((r) => keys.includes(r))
      ? next()
      : next(new AppError('FORBIDDEN', 'Bạn không có quyền làm việc này.', { status: 403 }));
}
