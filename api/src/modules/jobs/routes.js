import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as schema from './schema.js';
import * as service from './service.js';

export const router = Router();
router.use(rateLimit({ windowMs: 60_000, max: 120 }), requireAuth);

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
router.post('/', validate(schema.createSchema), async (req, res, next) => {
  try { res.status(201).json(await service.create({ actor: req.actor, input: req.body })); } catch (e) { next(e); }
});
router.get('/:id', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.get({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.patch('/:id', validate(schema.idParamSchema, 'params'), validate(schema.updateSchema), async (req, res, next) => {
  try { res.json(await service.update({ actor: req.actor, id: req.params.id, input: req.body })); } catch (e) { next(e); }
});
router.delete('/:id', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { await service.remove({ actor: req.actor, id: req.params.id }); res.status(204).end(); } catch (e) { next(e); }
});
router.post('/:id/applications', validate(schema.idParamSchema, 'params'), validate(schema.applySchema), async (req, res, next) => {
  try { res.status(201).json(await service.apply({ actor: req.actor, id: req.params.id, note: req.body.note })); } catch (e) { next(e); }
});
router.patch('/:id/applications/:connectionId', validate(schema.applicationParamSchema, 'params'), validate(schema.applicationUpdateSchema), async (req, res, next) => {
  try { res.json(await service.updateApplication({ actor: req.actor, id: req.params.id, connectionId: req.params.connectionId, status: req.body.status, note: req.body.note })); } catch (e) { next(e); }
});
router.delete('/:id/applications/me', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { await service.withdraw({ actor: req.actor, id: req.params.id }); res.status(204).end(); } catch (e) { next(e); }
});
