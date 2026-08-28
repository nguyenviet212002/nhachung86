import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { idempotent } from '../../middleware/idempotency.js';
import * as schema from './schema.js';
import * as service from './service.js';

export const router = Router();
router.use(rateLimit({ windowMs: 60_000, max: 120 }), requireAuth);

router.get('/', validate(schema.listQuerySchema, 'query'), async (req, res, next) => {
  try { res.json(await service.list({ actor: req.actor, filters: {
    q: req.query.q, category: req.query.category, areaId: req.query.area_id, memberId: req.query.member_id,
    mine: req.query.mine === 'true',
  }, page: req.query.page, limit: req.query.limit })); } catch (err) { next(err); }
});
router.post('/', idempotent(), validate(schema.createSchema), async (req, res, next) => {
  try { res.status(201).json(await service.create({ actor: req.actor, input: req.body })); } catch (err) { next(err); }
});
router.get('/:id', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.get({ actor: req.actor, id: req.params.id })); } catch (err) { next(err); }
});
router.patch('/:id', validate(schema.idParamSchema, 'params'), validate(schema.updateSchema), async (req, res, next) => {
  try { res.json(await service.update({ actor: req.actor, id: req.params.id, input: req.body })); } catch (err) { next(err); }
});
router.delete('/:id', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { await service.remove({ actor: req.actor, id: req.params.id }); res.status(204).end(); } catch (err) { next(err); }
});
router.post('/:id/photos', idempotent(), validate(schema.idParamSchema, 'params'), validate(schema.photoSchema), async (req, res, next) => {
  try { res.status(201).json(await service.addPhoto({ actor: req.actor, id: req.params.id, input: req.body })); } catch (err) { next(err); }
});
router.delete('/:id/photos/:photoId', validate(schema.photoParamSchema, 'params'), async (req, res, next) => {
  try { await service.removePhoto({ actor: req.actor, id: req.params.id, photoId: req.params.photoId }); res.status(204).end(); } catch (err) { next(err); }
});
