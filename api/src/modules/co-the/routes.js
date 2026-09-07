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
router.post('/positions/:id/phan-tich', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.analyzePosition({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/positions/:id/tim-cach-pha', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.findRefutationPaths({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});

router.post('/sessions', requireAuth, validate(schema.createSessionSchema), async (req, res, next) => {
  try {
    res.status(201).json(await service.createSession({
      actor: req.actor, positionId: req.body.position_id, mode: req.body.mode,
      opponentLevel: req.body.opponent_level, luyenTheCap: req.body.luyen_the_cap,
    }));
  } catch (e) { next(e); }
});
router.get('/sessions/:id', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.getSession({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/sessions/:id/moves', requireAuth, validate(schema.idParamSchema, 'params'), validate(schema.moveSchema), async (req, res, next) => {
  try { res.json(await service.move({ actor: req.actor, id: req.params.id, from: req.body.from, to: req.body.to })); }
  catch (e) { next(e); }
});
router.post('/sessions/:id/mach-1-nuoc', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.hint({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/sessions/:id/roi', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.giveUp({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
