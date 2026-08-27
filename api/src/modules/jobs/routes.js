import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { idempotent } from '../../middleware/idempotency.js';
import { subscribeJob } from '../../core/realtime.js';
import * as schema from './schema.js';
import * as service from './service.js';

export const router = Router();

// EventSource không gắn được header Authorization — cho phép truyền token
// qua query string ?access_token=... cho riêng route /:id/stream (giống hệt
// games/routes.js và notifications/routes.js).
function streamToken(req, _res, next) {
  if (!req.headers.authorization && req.query.access_token) {
    req.headers.authorization = `Bearer ${req.query.access_token}`;
  }
  next();
}
router.use(rateLimit({ windowMs: 60_000, max: 120 }), streamToken, requireAuth);

router.get('/ready', validate(schema.readyQuerySchema, 'query'), async (req, res, next) => {
  try { res.json(await service.listReady({ actor: req.actor, status: req.query.status, page: req.query.page, limit: req.query.limit })); } catch (e) { next(e); }
});
router.get('/ready/me', async (req, res, next) => { try { res.json(await service.getMyReady({ actor: req.actor })); } catch (e) { next(e); } });
router.put('/ready/me', validate(schema.readySchema), async (req, res, next) => {
  try { res.json(await service.upsertReady({ actor: req.actor, input: req.body })); } catch (e) { next(e); }
});
router.delete('/ready/me', async (req, res, next) => {
  try { await service.removeReady({ actor: req.actor }); res.status(204).end(); } catch (e) { next(e); }
});
router.get('/connections', validate(schema.readyQuerySchema, 'query'), async (req, res, next) => {
  try { res.json(await service.listConnections({ actor: req.actor, page: req.query.page, limit: req.query.limit })); } catch (e) { next(e); }
});
router.get('/', validate(schema.listQuerySchema, 'query'), async (req, res, next) => {
  try { res.json(await service.list({ actor: req.actor, filters: { q: req.query.q, jobType: req.query.job_type, status: req.query.status, mine: req.query.mine === 'true' }, page: req.query.page, limit: req.query.limit })); } catch (e) { next(e); }
});
router.post('/', idempotent(), validate(schema.createSchema), async (req, res, next) => {
  try { res.status(201).json(await service.create({ actor: req.actor, input: req.body })); } catch (e) { next(e); }
});
router.post('/:id/images', idempotent(), validate(schema.idParamSchema, 'params'), validate(schema.imageSchema), async (req, res, next) => {
  try { res.status(201).json(await service.attachImage({ actor: req.actor, id: req.params.id, input: req.body })); } catch (e) { next(e); }
});
router.delete('/:id/images/:fileId', validate(schema.imageParamSchema, 'params'), async (req, res, next) => {
  try { await service.removeImage({ actor: req.actor, id: req.params.id, fileId: req.params.fileId }); res.status(204).end(); } catch (e) { next(e); }
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
  res.write(`event: ready\ndata: ${JSON.stringify({ job_id: req.params.id })}\n\n`);
  const unsubscribe = subscribeJob(req.params.id, res);
  const keepalive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 25_000);
  req.on('close', () => { clearInterval(keepalive); unsubscribe(); });
});
router.patch('/:id', validate(schema.idParamSchema, 'params'), validate(schema.updateSchema), async (req, res, next) => {
  try { res.json(await service.update({ actor: req.actor, id: req.params.id, input: req.body })); } catch (e) { next(e); }
});
router.delete('/:id', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { await service.remove({ actor: req.actor, id: req.params.id }); res.status(204).end(); } catch (e) { next(e); }
});
router.post('/:id/applications', idempotent(), validate(schema.idParamSchema, 'params'), validate(schema.applySchema), async (req, res, next) => {
  try { res.status(201).json(await service.apply({ actor: req.actor, id: req.params.id, note: req.body.note })); } catch (e) { next(e); }
});
router.get('/:id/introductions', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.listIntroductions({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/:id/introductions', idempotent(), validate(schema.idParamSchema, 'params'), validate(schema.introductionCreateSchema), async (req, res, next) => {
  try {
    res.status(201).json(await service.createIntroduction({ actor: req.actor, id: req.params.id, candidateId: req.body.candidate_id, note: req.body.note }));
  } catch (e) { next(e); }
});
router.patch('/:id/introductions/:introductionId', validate(schema.introductionParamSchema, 'params'), validate(schema.introductionConsentSchema), async (req, res, next) => {
  try {
    res.json(await service.updateIntroductionConsent({ actor: req.actor, id: req.params.id, introductionId: req.params.introductionId, consent: req.body.consent }));
  } catch (e) { next(e); }
});
router.patch('/:id/applications/:connectionId', validate(schema.applicationParamSchema, 'params'), validate(schema.applicationUpdateSchema), async (req, res, next) => {
  try { res.json(await service.updateApplication({ actor: req.actor, id: req.params.id, connectionId: req.params.connectionId, status: req.body.status, note: req.body.note })); } catch (e) { next(e); }
});
router.delete('/:id/applications/me', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { await service.withdraw({ actor: req.actor, id: req.params.id }); res.status(204).end(); } catch (e) { next(e); }
});
