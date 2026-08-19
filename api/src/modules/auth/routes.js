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
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Đệm thời lượng cố định tối thiểu cho /register (đặc tả dòng 815). GIỚI HẠN
// ĐÃ BIẾT, giữ nguyên lời thừa nhận của đặc tả: đệm ở tầng HTTP chỉ là XẤP XỈ.
// Nó không che được chênh lệch dùng CPU, không che được tải đồng thời, và một
// kẻ đo đủ nhiều mẫu vẫn thấy đuôi phân bố. Nó CỘNG với rate limit 60 lần/phút
// là đủ ở quy mô ~52 người — đây không phải chống rò rỉ tuyệt đối, và không
// nên bị gọi tên như vậy trong bất kỳ tài liệu nào về sau.
const REGISTER_MIN_MS = 300;

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
      referrerId: req.body.referrer_id,
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
    const result = await authService.refresh({ refreshToken: req.body.refreshToken });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ actor: req.actor });
});
