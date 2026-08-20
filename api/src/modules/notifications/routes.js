import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import { subscribeMember } from '../../core/realtime.js';
import * as schema from './schema.js';
import * as service from './service.js';

export const notificationRouter = Router();
export const messageRouter = Router();
const normalLimit = rateLimit({ windowMs: 60_000, max: 120 });

// EventSource không cho gắn Authorization header. Chỉ stream same-origin này
// nhận access_token, không dùng query token cho các API khác.
function streamToken(req, _res, next) {
  if (!req.headers.authorization && req.query.access_token) {
    req.headers.authorization = `Bearer ${req.query.access_token}`;
  }
  next();
}

notificationRouter.use(normalLimit, streamToken, requireAuth);
notificationRouter.get('/stream', (req, res) => {
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ member_id: req.actor.id })}\n\n`);
  const unsubscribe = subscribeMember(req.actor.id, res);
  const keepalive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 25_000);
  req.on('close', () => { clearInterval(keepalive); unsubscribe(); });
});
notificationRouter.get('/', validate(schema.listQuerySchema, 'query'), async (req, res, next) => {
  try { res.json(await service.list({ actor: req.actor, page: req.query.page, limit: req.query.limit, unreadOnly: req.query.unread_only === 'true' })); }
  catch (err) { next(err); }
});
notificationRouter.get('/unread-count', async (req, res, next) => {
  try { res.json(await service.unreadCount({ actor: req.actor })); } catch (err) { next(err); }
});
notificationRouter.post('/', validate(schema.createSchema), async (req, res, next) => {
  try {
    res.status(201).json(await service.createNotification({ actor: req.actor, input: {
      recipientId: req.body.recipient_id, kind: req.body.kind, title: req.body.title,
      body: req.body.body, targetType: req.body.target_type, targetId: req.body.target_id,
    } }));
  } catch (err) { next(err); }
});
notificationRouter.post('/:id/read', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.markRead({ actor: req.actor, id: req.params.id })); } catch (err) { next(err); }
});

messageRouter.use(normalLimit, requireAuth);
messageRouter.get('/', validate(schema.listQuerySchema, 'query'), async (req, res, next) => {
  try { res.json(await service.listMessages({ actor: req.actor, withMemberId: req.query.with_member_id, page: req.query.page, limit: req.query.limit })); }
  catch (err) { next(err); }
});
messageRouter.post('/', validate(schema.messageSchema), async (req, res, next) => {
  try { res.status(201).json(await service.sendMessage({ actor: req.actor, recipientId: req.body.recipient_id, body: req.body.body })); }
  catch (err) { next(err); }
});
