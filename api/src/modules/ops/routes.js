import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as schema from './schema.js';
import * as twoPerson from '../../core/twoPerson.js';

export const router = Router();

router.use(rateLimit({ windowMs: 60_000, max: 60 }), requireAuth);

// Bảng mục 5.3: `GET /ops/pending-actions` — approver, tech.
router.get(
  '/pending-actions',
  requireRole('approver', 'tech'),
  validate(schema.listActionsSchema, 'query'),
  async (req, res, next) => {
    try {
      res.json(
        await twoPerson.list({
          actor: req.actor,
          status: req.query.status ?? null,
          page: req.query.page,
          limit: req.query.limit,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

// Vai ở đây là "theo `action_key`" (bảng mục 5.3), nên KHÔNG có requireRole ở
// tầng middleware: vai cần thiết chỉ biết được sau khi đọc `action_key` của
// thân request. `core/twoPerson.create()` hỏi `fn_pending_action_role()` —
// cùng một bản đồ với trigger — rồi mới quyết định.
router.post('/pending-actions', validate(schema.createActionSchema), async (req, res, next) => {
  try {
    const out = await twoPerson.create({
      actor: req.actor,
      actionKey: req.body.action_key,
      targetType: req.body.target_type ?? null,
      targetId: req.body.target_id ?? null,
      payload: req.body.payload,
      ip: req.ip ?? null,
    });
    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/pending-actions/:id/sign',
  validate(schema.idParamSchema, 'params'),
  validate(schema.signActionSchema),
  async (req, res, next) => {
    try {
      res.json(
        await twoPerson.sign({
          actor: req.actor,
          id: req.params.id,
          password: req.body.password,
          ip: req.ip ?? null,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/pending-actions/:id', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try {
    await twoPerson.cancel({ actor: req.actor, id: req.params.id });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
