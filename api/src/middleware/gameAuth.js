import { AppError } from '../core/errors.js';
import { knex } from '../db/knex.js';
import { authenticateMemberToken } from './auth.js';

// Vào phòng qua link mời (POST /rooms/:token/join) chấp nhận CẢ hai: một
// thành viên đã đăng nhập bấm link (Bearer hợp lệ) HOẶC một khách không tài
// khoản (không gửi Authorization). Khác requireAuthOrGuestToken ở chỗ không
// có gì bắt buộc — thiếu/hỏng token thì cứ coi là khách, service.joinRoom() tự
// rẽ nhánh theo req.actor có hay không, không middleware nào được phép chặn ở
// đây (mục đích route vẫn là điểm vào công khai).
export async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) { req.actor = null; return next(); }
  const { actor } = await authenticateMemberToken(token);
  req.actor = actor ?? null;
  next();
}

// Đăng nhập thành viên (như requireAuth) HOẶC token khách gắn với đúng ván cờ
// trong :id — dùng cho các route trong phòng cờ mà khách-không-tài-khoản
// cũng phải gọi được (mục 4.1 spec Kernel/Engine). Đặt SAU
// validate(idParamSchema,'params') trên mọi route dùng middleware này, để
// :id đã chắc là uuid hợp lệ trước khi đưa vào câu SQL dưới đây.
export async function requireAuthOrGuestToken(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError('UNAUTHENTICATED', 'Cần đăng nhập hoặc mã khách.', { status: 401 }));

  const { actor, error } = await authenticateMemberToken(token);
  if (actor) {
    req.actor = { ...actor, guestToken: null };
    return next();
  }
  // Không phải JWT thành viên hợp lệ — thử nhánh khách. `error` (hết hạn/sai
  // token) bị bỏ qua ở đây có chủ đích: một JWT thành viên hỏng và một token
  // khách đúng hình dạng khác nhau ngay từ nguồn, không phải cùng một lỗi.
  void error;

  const gameId = req.params.id;
  if (!gameId) return next(new AppError('UNAUTHENTICATED', 'Cần đăng nhập hoặc mã khách.', { status: 401 }));
  try {
    const { rows: [game] } = await knex.raw(
      `SELECT community_id, black_guest_token FROM games WHERE id = ?`,
      [gameId]
    );
    if (!game || !game.black_guest_token || game.black_guest_token !== token) {
      return next(new AppError('UNAUTHENTICATED', 'Cần đăng nhập hoặc mã khách.', { status: 401 }));
    }
    req.actor = { id: null, communityId: game.community_id, roles: [], permissions: [], guestToken: token };
    next();
  } catch {
    // Cùng lý do bọc try/catch trong authenticateMemberToken (middleware/auth.js):
    // middleware này cũng gắn thẳng qua router.use(), không có wrapper ở nơi
    // gọi, và Express 4 không tự bắt promise bị reject từ hàm async — để lọt
    // một lỗi CSDL ở đây (vd. :id lọt qua mà chưa qua validate(idParamSchema))
    // sẽ sập cả tiến trình thay vì trả 401.
    next(new AppError('UNAUTHENTICATED', 'Cần đăng nhập hoặc mã khách.', { status: 401 }));
  }
}
