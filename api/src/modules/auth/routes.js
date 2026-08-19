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
