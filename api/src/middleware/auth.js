import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { AppError } from '../core/errors.js';
import { knex } from '../db/knex.js';

// Xác thực access token (JWT ngắn hạn, xem modules/auth/service.js). Không
// tra lại trạng thái `members.status` mỗi request — access token chỉ sống
// 15 phút, đó là biên độ chấp nhận được giữa "bị khóa/đổi vai" và "hết hạn
// tự nhiên" ở quy mô ~52 người. member_roles/roles chỉ có SELECT cho
// app_role (migration 008) — vừa đủ cho câu truy vấn dưới đây.
export async function requireAuth(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError('UNAUTHENTICATED', 'Cần đăng nhập.', { status: 401 }));
  try {
    const p = jwt.verify(token, config.JWT_SECRET);
    if (p.typ !== 'access') throw new Error('sai loại token');
    const { rows } = await knex.raw(
      `SELECT r.key FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.member_id = ?`,
      [p.sub]
    );
    req.actor = { id: p.sub, communityId: p.cid, roles: rows.map((r) => r.key) };
    next();
  } catch {
    next(new AppError('UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ.', { status: 401 }));
  }
}

// Cổng theo VAI (roles ở req.actor do requireAuth nạp). Chỉ dùng được cho các
// quyền quyết định xong bằng vai — "chỉ người bảo lãnh CỦA ĐƠN NÀY" thì không,
// vì nó phụ thuộc dữ liệu của chính đơn, phải kiểm trong service.
//
// 403 (không phải 404) là có chủ đích ở đây: middleware chưa đọc hàng nào nên
// không biết đối tượng có tồn tại hay không, và đường dẫn /join-requests tự nó
// không phải bí mật. errorHandler ghi dòng "từ chối" cho mọi lỗi 4xx có actor.
export function requireRole(...keys) {
  return (req, _res, next) => {
    if (!req.actor) return next(new AppError('UNAUTHENTICATED', 'Cần đăng nhập.', { status: 401 }));
    if (!req.actor.roles.some((r) => keys.includes(r))) {
      return next(new AppError('FORBIDDEN', 'Bạn không có quyền thực hiện việc này.', { status: 403 }));
    }
    next();
  };
}
