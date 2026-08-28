import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { idempotent } from '../../middleware/idempotency.js';
import * as schema from './schema.js';
import * as service from './service.js';

export const router = Router();
router.use(rateLimit({ windowMs: 60_000, max: 60 }), requireAuth);

// Ai cũng nộp được yêu cầu xác minh cho CHÍNH MÌNH — không requireRole ở đây.
// Vai chỉ cần cho XỬ LÝ (GET danh sách, PATCH quyết định), cùng khuôn
// complaints/routes.js.
router.post('/', idempotent(), validate(schema.createSchema), async (req, res, next) => {
  try { res.status(201).json(await service.create({ actor: req.actor, input: req.body })); } catch (err) { next(err); }
});

router.get('/me', async (req, res, next) => {
  try { res.json(await service.listMine({ actor: req.actor })); } catch (err) { next(err); }
});

router.get('/', requireRole('approver', 'content_ops'), validate(schema.listQuerySchema, 'query'), async (req, res, next) => {
  try {
    res.json(await service.list({ actor: req.actor, status: req.query.status ?? null, page: req.query.page, limit: req.query.limit }));
  } catch (err) { next(err); }
});

router.patch('/:id', requireRole('approver', 'content_ops'), validate(schema.idParamSchema, 'params'), validate(schema.decideSchema), async (req, res, next) => {
  try {
    res.json(await service.decide({ actor: req.actor, id: req.params.id, status: req.body.status, note: req.body.note }));
  } catch (err) { next(err); }
});
