import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { idempotent } from '../../middleware/idempotency.js';
import * as schema from './schema.js';
import * as service from './service.js';

export const router = Router();
router.use(rateLimit({ windowMs: 60_000, max: 60 }), requireAuth);

// Đọc: mọi thành viên — sổ quỹ công khai minh bạch trong Hội.
router.get('/entries', validate(schema.listQuerySchema, 'query'), async (req, res, next) => {
  try { res.json(await service.list({ actor: req.actor, page: req.query.page, limit: req.query.limit })); }
  catch (err) { next(err); }
});

// Ghi: approver hoặc tech. Backend chưa có khái niệm "Thủ quỹ" riêng (không
// vai/cột nào đánh dấu ai là Thủ quỹ — đó vẫn là một vai trò do Hội tự bầu,
// ngoài phạm vi migration 020), nên gán quyền ghi cho hai vai có thể chịu
// trách nhiệm ký quỹ theo migration 020 (approver) cộng vận hành (tech).
router.post('/entries', requireRole('approver', 'tech'), idempotent(), validate(schema.createEntrySchema), async (req, res, next) => {
  try { res.status(201).json(await service.create({ actor: req.actor, input: req.body })); }
  catch (err) { next(err); }
});

router.post('/entries/:id/lock', requireRole('approver', 'tech'), validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.lock({ actor: req.actor, id: req.params.id })); }
  catch (err) { next(err); }
});
