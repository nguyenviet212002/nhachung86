import { knex } from '../db/knex.js';
import { AppError } from '../core/errors.js';

// Chống double-submit ở 9 route tạo tài nguyên nghiệp vụ (đăng việc, nhận
// việc, đăng năng lực, mời vào Hội, tải ảnh, ...). Xem migration 042 và
// web/js/api.js (`api.newIdemKey()`).
//
// KHÔNG BẮT BUỘC header: thiếu `Idempotency-Key` thì cho qua như trước —
// client cũ (hoặc test chưa cập nhật) không vỡ, chỉ là không được chống trùng.
// Đặt SAU requireAuth: cần req.actor.id để khoá theo đúng người gọi, không
// theo IP hay session — hai tab của cùng một người dùng hai khoá khác nhau là
// đúng ý (hai ý định khác nhau), nhưng hai người khác nhau gõ trùng nội dung
// không được đụng vào khoá của nhau.
export function idempotent() {
  return async (req, res, next) => {
    const key = req.headers['idempotency-key'];
    if (!key || typeof key !== 'string') return next();
    if (!req.actor) return next(new AppError('UNAUTHENTICATED', 'Cần đăng nhập.', { status: 401 }));
    if (key.length > 200) {
      return next(new AppError('VALIDATION_FAILED', 'Khoá idempotency quá dài.', { status: 422 }));
    }

    let inserted;
    try {
      const { rows } = await knex.raw(
        `INSERT INTO idempotency_keys (community_id, member_id, key, method, path)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (member_id, key) DO NOTHING
         RETURNING id`,
        [req.actor.communityId, req.actor.id, key, req.method, req.originalUrl]
      );
      inserted = rows.length > 0;
    } catch (err) {
      return next(err);
    }

    if (!inserted) {
      // Hàng đã có — hoặc lần gọi trước đã xong (phát lại đúng kết quả cũ),
      // hoặc đang chạy dở (hai request gần như đồng thời).
      const { rows } = await knex.raw(
        `SELECT status, response_body FROM idempotency_keys WHERE member_id = ? AND key = ?`,
        [req.actor.id, key]
      );
      const row = rows[0];
      if (row && row.status != null) {
        return res.status(row.status).json(row.response_body);
      }
      return next(new AppError(
        'IDEMPOTENCY_IN_PROGRESS',
        'Yêu cầu này đang được xử lý từ một lần gọi trước, đợi kết quả đó thay vì gửi lại.',
        { status: 409 }
      ));
    }

    // Ghi lại kết quả NGAY TRƯỚC KHI trả về, không chặn response cho lỗi ghi.
    //
    // CHỈ khoá vĩnh viễn khi 2xx (tạo thành công). Lỗi (422 dữ liệu sai, 403
    // không có quyền, ...) thì XOÁ hàng thay vì lưu — nếu không, ai sửa lại
    // form sau một lần gửi lỗi (cùng khoá, vì vẫn là cùng một ý định) sẽ bị kẹt
    // nhận lại đúng lỗi cũ mãi mãi, không bao giờ gửi lại được bản đã sửa.
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      const sql = ok
        ? knex.raw(`UPDATE idempotency_keys SET status = ?, response_body = ? WHERE member_id = ? AND key = ?`,
            [res.statusCode, JSON.stringify(body ?? null), req.actor.id, key])
        : knex.raw(`DELETE FROM idempotency_keys WHERE member_id = ? AND key = ?`, [req.actor.id, key]);
      sql.catch((err) => req.app?.get?.('logger')?.error?.(`idempotency: không ghi được kết quả — ${err.message}`));
      return originalJson(body);
    };
    next();
  };
}
