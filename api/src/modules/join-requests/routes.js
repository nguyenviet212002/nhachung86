import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as schema from './schema.js';
import * as joinService from './service.js';

export const router = Router();

const normalLimit = rateLimit({ windowMs: 60_000, max: 60 });

router.use(normalLimit, requireAuth);

// Đặc tả dòng 844: approver + content_ops đọc được danh sách đơn.
router.get('/', requireRole('approver', 'content_ops'), validate(schema.listQuerySchema, 'query'), async (req, res, next) => {
  try {
    res.json(
      await joinService.list({
        actor: req.actor,
        status: req.query.status,
        page: req.query.page,
        limit: req.query.limit,
      })
    );
  } catch (err) {
    next(err);
  }
});

// Đặc tả dòng 845: approver HOẶC người bảo lãnh của chính đơn đó. Vế thứ hai
// phụ thuộc dữ liệu của đơn nên không kiểm được ở middleware — service kiểm.
router.get('/:id', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try {
    res.json(await joinService.getById({ actor: req.actor, id: req.params.id }));
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/confirm-met',
  validate(schema.idParamSchema, 'params'),
  validate(schema.confirmMetSchema),
  async (req, res, next) => {
    try {
      res.json(
        await joinService.confirmMet({
          actor: req.actor,
          id: req.params.id,
          metOn: req.body.met_on,
          note: req.body.note,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/approve',
  requireRole('approver'),
  validate(schema.idParamSchema, 'params'),
  async (_req, _res, next) => {
    // Task 9 — xem chú thích dài ở joinService.approve().
    try {
      await joinService.approve();
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/reject',
  requireRole('approver'),
  validate(schema.idParamSchema, 'params'),
  validate(schema.rejectSchema),
  async (req, res, next) => {
    try {
      res.json(
        await joinService.reject({
          actor: req.actor,
          id: req.params.id,
          reasonCode: req.body.reason_code,
          note: req.body.note,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);
