import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import * as schema from './schema.js';
import * as authService from './service.js';

export const router = Router();

// OTP là đường có thể chiếm tài khoản (dùng để đặt lại mật khẩu) — rate limit
// chặt hơn hẳn phần còn lại: 5 lần/phút theo IP.
const otpLimit = rateLimit({ windowMs: 60_000, max: 5 });
const normalLimit = rateLimit({ windowMs: 60_000, max: 60 });

router.post('/otp/request', otpLimit, validate(schema.otpRequestSchema), async (req, res, next) => {
  try {
    const communityId = await authService.resolveCommunityId();
    await authService.requestOtp({ communityId, phone: req.body.phone, purpose: req.body.purpose });
    res.status(202).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/otp/verify', otpLimit, validate(schema.otpVerifySchema), async (req, res, next) => {
  try {
    const communityId = await authService.resolveCommunityId();
    const result = await authService.verifyOtp({
      communityId,
      phone: req.body.phone,
      code: req.body.code,
      purpose: req.body.purpose,
    });
    // snake_case ở LỚP VỎ HTTP, camelCase ở trong JS. Đặc tả dòng 773 nói đầu
    // ra là `{ otp_token }`, và chính `/auth/register` (dòng 774) nhận lại khóa
    // `otp_token` — trả `{ otpToken }` là bắt client tự dịch giữa hai quy ước
    // trong cùng một luồng ba bước. Phát hiện khi chạy MỐC 1 bằng curl thật:
    // mọi bài test trước đều gọi thẳng service nên không bài nào đi qua vỏ này.
    res.json({ otp_token: result.otpToken });
  } catch (err) {
    next(err);
  }
});

// Đệm thời lượng cố định cho /register (đặc tả dòng 815).
//
// GIỚI HẠN ĐÃ BIẾT, giữ nguyên lời thừa nhận của đặc tả: đệm ở tầng HTTP chỉ
// là XẤP XỈ. Nó không che được chênh lệch dùng CPU, không che được tải đồng
// thời, và một kẻ đo đủ nhiều mẫu vẫn thấy đuôi phân bố. Nó CỘNG với rate
// limit 60 lần/phút là đủ ở quy mô ~52 người — đây không phải chống rò rỉ
// tuyệt đối, và không nên bị gọi tên như vậy trong bất kỳ tài liệu nào về sau.
//
// 700ms chứ không phải 300ms, và con số này đến từ ĐO ĐẠC chứ không từ cảm
// tính. Tắt đệm rồi đo ba nhánh hỏng trên máy phát triển: 250ms (referrer
// không tồn tại) / 262ms (không phải member) / 342ms (hết hạn mức — nhánh này
// còn chèn hàng, chạy trigger và lấy khóa tư vấn). Với sàn 300ms, nhánh chậm
// nhất VƯỢT sàn, nên nó không được đệm chút nào và vẫn lộ ra chênh lệch ~90ms
// so với hai nhánh kia — tức con số 300 trong đặc tả KHÔNG làm được việc mà nó
// được viết ra để làm. Đặc tả nói "tối thiểu 300ms", nên nâng lên là vẫn đúng
// đặc tả. Đăng ký là việc một người làm đúng một lần trong đời; 700ms không
// phải cái giá đáng cân nhắc.
//
// Xuất ra để bài test khẳng định đúng bất biến này thay vì chép lại con số.
export const REGISTER_MIN_MS = 700;

async function padTo(startedAt, minMs) {
  const remaining = minMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
}

router.post('/register', normalLimit, validate(schema.registerSchema), async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const communityId = await authService.resolveCommunityId();
    const result = await authService.register({
      communityId,
      otpToken: req.body.otp_token,
      phone: req.body.phone,
      fullName: req.body.full_name,
      birthYear: req.body.birth_year,
      areaId: req.body.area_id,
      inviteToken: req.body.invite_token,
      password: req.body.password,
    });
    await padTo(startedAt, REGISTER_MIN_MS);
    res.status(201).json(result);
  } catch (err) {
    // Đệm cả nhánh hỏng — đệm chỉ nhánh thành công thì chính việc trả lời
    // NHANH đã là câu trả lời "người bảo lãnh này không dùng được".
    await padTo(startedAt, REGISTER_MIN_MS);
    next(err);
  }
});

router.post('/login', normalLimit, validate(schema.loginSchema), async (req, res, next) => {
  try {
    const communityId = await authService.resolveCommunityId();
    const result = await authService.login({
      communityId,
      identifier: req.body.identifier,
      password: req.body.password,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', normalLimit, validate(schema.refreshSchema), async (req, res, next) => {
  try {
    // Cùng lỗi quy ước với /otp/verify, chỉ khác chiều: đặc tả dòng 775 nói
    // đầu vào là `{ refresh_token }`. Tầng JS giữ camelCase, vỏ HTTP giữ
    // snake_case — biên dịch nằm ở đúng một chỗ, là dòng này.
    const result = await authService.refresh({ refreshToken: req.body.refresh_token });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  // KHÔNG đổ thẳng req.actor ra dây. Đó là đối tượng nội bộ của ứng dụng, đặt tên
  // theo quy ước JavaScript (camelCase); vỏ HTTP theo đặc tả mục 5 là snake_case.
  // Đổ thẳng vừa rò `communityId` (lỗi thứ tư cùng họ với otpToken/refreshToken/
  // fullName), vừa có nghĩa là bất cứ trường nào ai đó thêm vào req.actor về sau
  // sẽ tự động ra tới client mà không ai quyết định — cùng loại với bẫy pino tự
  // sao chép mọi thuộc tính của đối tượng lỗi ở Task 3. Liệt kê tường minh.
  res.json({
    actor: {
      id: req.actor.id,
      community_id: req.actor.communityId,
      roles: req.actor.roles,
    },
  });
});
