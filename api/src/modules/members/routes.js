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

router.get('/me', async (req, res, next) => {
  try { res.json(await memberService.getMe({ actor: req.actor })); } catch (err) { next(err); }
});
router.patch('/me', validate(schema.updateMeSchema), async (req, res, next) => {
  try { res.json(await memberService.updateMe({ actor: req.actor, input: req.body })); } catch (err) { next(err); }
});
router.get('/me/contact-requests', validate(schema.contactRequestQuerySchema, 'query'), async (req, res, next) => {
  try { res.json(await memberService.listContactRequests({ actor: req.actor, direction: req.query.direction,
    status: req.query.status, page: req.query.page, limit: req.query.limit })); } catch (err) { next(err); }
});
router.patch('/me/contact-requests/:id', validate(schema.contactRequestParamSchema, 'params'), validate(schema.contactDecisionSchema), async (req, res, next) => {
  try { res.json(await memberService.decideContactRequest({ actor: req.actor, id: req.params.id, status: req.body.status })); } catch (err) { next(err); }
});
router.get('/me/privacy', async (req, res, next) => {
  try { res.json(await memberService.getPrivacy({ actor: req.actor })); } catch (err) { next(err); }
});
router.patch('/me/privacy/:field', validate(schema.privacyParamSchema, 'params'), validate(schema.privacyUpdateSchema), async (req, res, next) => {
  try { res.json(await memberService.updatePrivacy({ actor: req.actor, field: req.params.field, level: req.body.level })); } catch (err) { next(err); }
});
router.get('/me/profile-views', validate(schema.profileViewsQuerySchema, 'query'), async (req, res, next) => {
  try { res.json(await memberService.listProfileViews({ actor: req.actor, page: req.query.page, limit: req.query.limit })); } catch (err) { next(err); }
});
router.post('/:id/contact-requests', validate(schema.idParamSchema, 'params'), validate(schema.contactRequestSchema), async (req, res, next) => {
  try { res.status(201).json(await memberService.requestContact({ actor: req.actor, targetId: req.params.id,
    fieldKey: req.body.field_key, message: req.body.message })); } catch (err) { next(err); }
});

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
