import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireAuthOrGuestToken } from '../../middleware/gameAuth.js';
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
router.use(rateLimit({ windowMs: 60_000, max: 120 }), streamToken);

router.post('/challenges', requireAuth, validate(schema.challengeSchema), async (req, res, next) => {
  try { res.status(201).json(await service.challenge({ actor: req.actor, opponentMemberId: req.body.opponent_member_id })); }
  catch (e) { next(e); }
});
router.post('/challenges/:id/accept', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.acceptChallenge({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/challenges/:id/decline', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.declineChallenge({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/quick-match', requireAuth, async (req, res, next) => {
  try { res.json(await service.quickMatch({ actor: req.actor })); } catch (e) { next(e); }
});
router.delete('/quick-match', requireAuth, async (req, res, next) => {
  try { res.json(await service.leaveQuickMatch({ actor: req.actor })); } catch (e) { next(e); }
});
router.get('/', requireAuth, validate(schema.listQuerySchema, 'query'), async (req, res, next) => {
  try {
    res.json(await service.list({ actor: req.actor, status: req.query.status,
      mine: req.query.mine === 'true', page: req.query.page, limit: req.query.limit }));
  } catch (e) { next(e); }
});

router.get('/:id', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.get({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.get('/:id/stream', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  let visible;
  try {
    visible = await service.assertVisible({ actor: req.actor, id: req.params.id });
  } catch (e) { return next(e); }
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ game_id: req.params.id })}\n\n`);
  const unsubscribe = subscribeGame(req.params.id, req.actor.id, res);
  const { side } = visible;
  const { communityId } = req.actor;
  if (side) service.clearDisconnected({ communityId, gameId: req.params.id, side }).catch(() => {});
  const keepalive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 25_000);
  req.on('close', () => {
    clearInterval(keepalive); unsubscribe();
    if (side) service.markDisconnected({ communityId, gameId: req.params.id, side }).catch(() => {});
  });
});
router.post('/:id/moves', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, validate(schema.moveSchema), async (req, res, next) => {
  try { res.json(await service.move({ actor: req.actor, id: req.params.id, from: req.body.from, to: req.body.to })); }
  catch (e) { next(e); }
});
router.post('/:id/resign', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.resign({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/:id/leave', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.leaveRoom({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});

router.post('/rooms', requireAuth, async (req, res, next) => {
  try { res.status(201).json(await service.createRoom({ actor: req.actor })); } catch (e) { next(e); }
});
router.post('/rooms/:token/join', validate(schema.joinRoomSchema), async (req, res, next) => {
  try { res.status(201).json(await service.joinRoom({ rawToken: req.params.token, guestName: req.body.guest_name })); }
  catch (e) { next(e); }
});

router.post('/:id/ready', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.ready({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/:id/timeout', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.claimTimeout({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/:id/draw/offer', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.offerDraw({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/:id/draw/accept', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.acceptDraw({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/:id/draw/decline', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.declineDraw({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/:id/disconnect-timeout', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.claimDisconnectTimeout({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
