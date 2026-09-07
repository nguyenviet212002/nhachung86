import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { AppError } from '../core/errors.js';
import { knex } from '../db/knex.js';

// Xác thực access token (JWT ngắn hạn, xem modules/auth/service.js).
//
// BA THAY ĐỔI Ở TASK 16, và cả ba đều đến từ danh sách tấn công:
//
// (1) TRA LẠI `members.status` MỖI REQUEST. Bản trước cố ý không tra, với lý
//     do "access token chỉ sống 15 phút, đó là biên độ chấp nhận được". Lý do
//     ấy đúng khi viết (Task 7) và HẾT ĐÚNG ở Task 14: khung hai người ký nay
//     có `member.terminate` chạy được thật, nên "biên độ chấp nhận được" trở
//     thành *"hai approver chấm dứt tư cách một người, và người đó vẫn dùng
//     hệ thống bình thường thêm mười lăm phút nữa"* — đúng mười lăm phút mà
//     người ta vừa quyết định là họ không được ở đây. Câu tra không tốn thêm
//     vòng nào: nó gộp vào chính câu đang đọc vai.
//
// (2) LỌC `mr.community_id`. Câu cũ tra vai CHỈ theo `member_id`. Hôm nay
//     không khai thác được (khoá ngoại ghép của 008 buộc mọi hàng
//     `member_roles` của một người nằm trong đúng cộng đồng của họ), nhưng
//     "không khai thác được nhờ một ràng buộc ở tệp khác" là đúng câu mà lỗi
//     quên lọc `community_id` đã nói bảy lần trước khi thành lỗi thật.
//
// (3) NẠP QUYỀN, không chỉ vai. `requirePermission()` đọc `req.actor.permissions`,
//     và bảng `role_permissions` (gieo ở 029) là NGUỒN của ma trận đó — đổi
//     một hàng trong bảng là đổi quyền truy cập thật, không phải đổi một tài
//     liệu mô tả. Xem middleware/permission.js.
//
// Tách khỏi requireAuth (Task 4, Sảnh Cờ Kernel) để requireAuthOrGuestToken
// (middleware/gameAuth.js) dùng lại được — không sao chép câu SQL tra vai lần
// thứ hai (một nguồn tra vai duy nhất). Hợp đồng: KHÔNG BAO GIỜ throw/reject —
// luôn trả {actor} hoặc {error}, để mọi nơi gọi (requireAuth và
// requireAuthOrGuestToken) đều an toàn dùng `await` trực tiếp mà không cần
// try/catch riêng. Xem lý do ở catch cuối hàm.
export async function authenticateMemberToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET);
    if (payload.typ !== 'access') {
      return { error: new AppError('TOKEN_INVALID', 'Phiên đăng nhập không hợp lệ.', { status: 401 }) };
    }
  } catch (err) {
    // TokenExpiredError riêng biệt: client cần biết "hết hạn, làm mới đi"
    // khác với "hỏng, phải đăng nhập lại" để không mất form đang điền dở.
    if (err?.name === 'TokenExpiredError') {
      return { error: new AppError('TOKEN_EXPIRED', 'Phiên đăng nhập đã hết hạn.', { status: 401 }) };
    }
    return { error: new AppError('TOKEN_INVALID', 'Phiên đăng nhập không hợp lệ.', { status: 401 }) };
  }

  try {
    // MỘT câu cho cả ba việc: người còn tư cách không, mang vai gì, và những
    // vai ấy mở ra quyền gì. `LEFT JOIN` vì thành viên thường KHÔNG có hàng
    // `member_roles` nào — vai `member` không được gán cho ai, nó là mặc định
    // của việc đăng nhập được.
    const { rows } = await knex.raw(
      `SELECT m.status, r.key AS role_key, p.key AS permission_key
         FROM members m
         LEFT JOIN member_roles mr ON mr.member_id = m.id AND mr.community_id = m.community_id
         LEFT JOIN roles r ON r.id = mr.role_id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE m.id = ? AND m.community_id = ?`,
      [payload.sub, payload.cid]
    );

    // Không có hàng nào ⇒ người này không còn (hoặc chưa bao giờ) thuộc cộng
    // đồng ghi trong token. Cùng MỘT câu trả lời với "token hỏng": không phân
    // biệt được hai thứ là không rò ra được thứ nào.
    if (!rows.length || rows[0].status !== 'member') {
      return { error: new AppError('UNAUTHENTICATED', 'Phiên đăng nhập không còn hiệu lực.', { status: 401 }) };
    }

    return {
      actor: {
        id: payload.sub,
        communityId: payload.cid,
        roles: [...new Set(rows.map((r) => r.role_key).filter(Boolean))],
        permissions: [...new Set(rows.map((r) => r.permission_key).filter(Boolean))],
      },
    };
  } catch {
    // Bọc riêng bước tra CSDL — giữ đúng hành vi bản trước khi tách hàm. Hàm
    // này chạy trong middleware gắn thẳng qua router.use() (requireAuth,
    // requireAuthOrGuestToken), không có try/catch nào bọc ở nơi gọi; Express
    // 4 KHÔNG tự bắt promise bị reject từ hàm async. Không bắt ở đây thì một
    // trục trặc CSDL thoáng qua sẽ là unhandled rejection và sập cả tiến
    // trình thay vì trả 401 — nên mọi lỗi ở bước này đều thành "phiên đăng
    // nhập không hợp lệ", không rò chi tiết lỗi CSDL ra ngoài.
    return { error: new AppError('UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ.', { status: 401 }) };
  }
}

export async function requireAuth(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError('UNAUTHENTICATED', 'Cần đăng nhập.', { status: 401 }));
  const { actor, error } = await authenticateMemberToken(token);
  if (error) return next(error);
  req.actor = actor;
  next();
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
