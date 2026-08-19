// Bộ đếm trong bộ nhớ, khóa theo route + ip (hoặc khóa tùy biến qua `key`).
// Một tiến trình `api` là đủ ở quy mô ~52 người. GHI CHÚ: nếu sau này nhân
// bản tiến trình api (nhiều instance đứng sau load balancer), bộ đếm này
// không còn dùng chung được nữa — phải chuyển sang một kho đếm chung (vd.
// Redis) trước khi scale ngang, nếu không mỗi instance tự đếm riêng và giới
// hạn thực tế sẽ nhân lên theo số instance.
const buckets = new Map();

export function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  return (req, res, next) => {
    const k = `${req.baseUrl}${req.path}:${key(req)}`;
    const now = Date.now();
    const b = buckets.get(k) ?? { count: 0, reset: now + windowMs };
    if (now > b.reset) {
      b.count = 0;
      b.reset = now + windowMs;
    }
    b.count++;
    buckets.set(k, b);
    if (b.count > max) {
      res.set('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Bạn thao tác quá nhanh, thử lại sau ít phút.' },
      });
    }
    next();
  };
}
