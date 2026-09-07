import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as schema from './schema.js';
import * as service from './service.js';

export const router = Router();
router.use(rateLimit({ windowMs: 60_000, max: 120 }));

router.post('/positions', requireAuth, validate(schema.createPositionSchema), async (req, res, next) => {
  try { res.status(201).json(await service.createPosition({ actor: req.actor, board: req.body.board, sideToMove: req.body.side_to_move })); }
  catch (e) { next(e); }
});
router.post('/positions/:id/luu-kho', requireAuth, validate(schema.idParamSchema, 'params'), validate(schema.saveToLibrarySchema), async (req, res, next) => {
  try { res.json(await service.saveToLibrary({ actor: req.actor, id: req.params.id, label: req.body.label, category: req.body.category })); }
  catch (e) { next(e); }
});
router.get('/positions', requireAuth, validate(schema.listPositionsQuerySchema, 'query'), async (req, res, next) => {
  try { res.json(await service.listPositions({ actor: req.actor, ...req.query })); } catch (e) { next(e); }
});
router.get('/positions/:id', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.getPosition({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
