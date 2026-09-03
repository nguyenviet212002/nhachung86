import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { idempotent } from '../../middleware/idempotency.js';
import * as schema from './schema.js';
import * as service from './service.js';

export const router = Router();
router.use(rateLimit({ windowMs: 60_000, max: 60 }), requireAuth);

// Lịch sử vay của chính người gọi — mọi thành viên đọc được của riêng mình.
router.get('/me', async (req, res, next) => {
  try { res.json(await service.listMine({ actor: req.actor })); }
  catch (err) { next(err); }
});

// Hàng đợi cho Ban điều hành — cùng hai vai được ghi sổ quỹ (fund/routes.js).
router.get('/', requireRole('approver', 'tech'), validate(schema.listQuerySchema, 'query'), async (req, res, next) => {
  try {
    res.json(await service.list({ actor: req.actor, status: req.query.status, page: req.query.page, limit: req.query.limit }));
  } catch (err) { next(err); }
});

router.post('/', idempotent(), validate(schema.createLoanSchema), async (req, res, next) => {
  try { res.status(201).json(await service.create({ actor: req.actor, input: req.body })); }
  catch (err) { next(err); }
});

router.post(
  '/:id/approve',
  requireRole('approver', 'tech'),
  validate(schema.idParamSchema, 'params'),
  validate(schema.decisionSchema),
  async (req, res, next) => {
    try { res.json(await service.approve({ actor: req.actor, id: req.params.id, note: req.body.note })); }
    catch (err) { next(err); }
  }
);

router.post(
  '/:id/reject',
  requireRole('approver', 'tech'),
  validate(schema.idParamSchema, 'params'),
  validate(schema.decisionSchema),
  async (req, res, next) => {
    try { res.json(await service.reject({ actor: req.actor, id: req.params.id, note: req.body.note })); }
    catch (err) { next(err); }
  }
);
