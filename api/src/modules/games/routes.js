import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { subscribeGame } from '../../core/realtime.js';
import * as schema from './schema.js';
import * as service from './service.js';

export const router = Router();

// EventSource không gắn được header Authorization — cho phép truyền token
// qua query string ?access_token=... cho riêng route /stream (giống hệt
// notifications/routes.js).
function streamToken(req, _res, next) {
  if (!req.headers.authorization && req.query.access_token) {
    req.headers.authorization = `Bearer ${req.query.access_token}`;
  }
  next();
}
router.use(rateLimit({ windowMs: 60_000, max: 120 }), streamToken, requireAuth);

// Lệch có chủ đích khỏi brief: brief gốc bọc route POST /challenges bằng
// middleware `idempotent()` nhập từ '../../middleware/idempotency.js'. Tệp đó
// không tồn tại ở đâu trong cây làm việc này (không migration, không job dọn
// dẹp, không middleware) — "Interfaces" của Task 4 trong brief cũng nói rõ
// task này KHÔNG tiêu thụ gì từ Task 2/3. Thêm cả một tầng hạ tầng idempotency
// key mới nằm ngoài phạm vi 3 hàm service của task này, nên bỏ middleware đó
// thay vì tự chế ra một hệ idempotency chưa ai yêu cầu — cùng cách mọi route
// POST khác trong repo (jobs, auth, invites) đang làm.
router.post('/challenges', validate(schema.challengeSchema), async (req, res, next) => {
  try { res.status(201).json(await service.challenge({ actor: req.actor, opponentMemberId: req.body.opponent_member_id })); }
  catch (e) { next(e); }
});
router.post('/challenges/:id/accept', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.acceptChallenge({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/challenges/:id/decline', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.declineChallenge({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.get('/', validate(schema.listQuerySchema, 'query'), async (req, res, next) => {
  try {
    res.json(await service.list({ actor: req.actor, status: req.query.status,
      mine: req.query.mine === 'true', page: req.query.page, limit: req.query.limit }));
  } catch (e) { next(e); }
});
router.get('/:id', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.get({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.get('/:id/stream', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try {
    await service.assertVisible({ actor: req.actor, id: req.params.id });
  } catch (e) { return next(e); }
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ game_id: req.params.id })}\n\n`);
  const unsubscribe = subscribeGame(req.params.id, req.actor.id, res);
  const keepalive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 25_000);
  req.on('close', () => { clearInterval(keepalive); unsubscribe(); });
});
router.post('/:id/moves', validate(schema.idParamSchema, 'params'), validate(schema.moveSchema), async (req, res, next) => {
  try { res.json(await service.move({ actor: req.actor, id: req.params.id, from: req.body.from, to: req.body.to })); }
  catch (e) { next(e); }
});
router.post('/:id/resign', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.resign({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
