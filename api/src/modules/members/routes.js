import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import * as schema from './schema.js';
import * as memberService from './service.js';

export const router = Router();

const normalLimit = rateLimit({ windowMs: 60_000, max: 60 });
// Đặc tả dòng 735: 10 lần/phút cho các endpoint ĐỌC LIÊN HỆ, chặt hơn hẳn 60
// lần/phút của API thường. Lý do ở mục 9.3: ghi nhật ký cho lượt bị từ chối cho
// phép người dò tạo ra vô số dòng log, và rate limit là phần giảm thiểu.
const contactReadLimit = rateLimit({ windowMs: 60_000, max: 10 });

router.use(normalLimit, requireAuth);

router.get('/', validate(schema.listQuerySchema, 'query'), async (req, res, next) => {
  try {
    res.json(
      await memberService.list({
        actor: req.actor,
        // Vỏ HTTP snake_case → tầng JS camelCase, biên dịch nằm ở đúng chỗ này
        // (cùng khuôn với modules/auth/routes.js).
        filters: {
          q: req.query.q,
          job: req.query.job,
          areaId: req.query.area_id,
          status: req.query.status,
          workStatus: req.query.work_status,
        },
        page: req.query.page,
        limit: req.query.limit,
      })
    );
  } catch (err) {
    next(err);
  }
});

// CHÚ Ý CHO TASK SAU: các route `/members/me/...` của đặc tả (privacy,
// contact-requests, profile-views, export, relations) phải khai TRƯỚC hai route
// `/:id` bên dưới — Express chọn route đầu tiên khớp, và 'me' sẽ bị `/:id` bắt
// mất (rồi rớt ở zod uuid thành 400) nếu khai sau.
router.get('/:id', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try {
    res.json(await memberService.get({ actor: req.actor, id: req.params.id }));
  } catch (err) {
    next(err);
  }
});

router.get(
  '/:id/contacts/:field',
  contactReadLimit,
  validate(schema.contactFieldParamSchema, 'params'),
  async (req, res, next) => {
    try {
      res.json(
        await memberService.readContactField({
          actor: req.actor,
          id: req.params.id,
          field: req.params.field,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);
