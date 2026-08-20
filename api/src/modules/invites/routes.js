import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import * as schema from './schema.js';
import * as inviteService from './service.js';

export const router = Router();

const normalLimit = rateLimit({ windowMs: 60_000, max: 60 });

// Mọi đường ở đây đòi đăng nhập. Đường CÔNG KHAI duy nhất chạm tới link mời là
// POST /auth/register — nơi người được mời nộp token, và ở đó token là thứ duy
// nhất họ có.
router.use(normalLimit, requireAuth);

// Phát link. KHÔNG có requireRole ở đây: phát link cho chính mình là việc của
// mọi thành viên. Đường dự phòng (phát hộ người khác) đòi vai `approver`,
// nhưng vế đó phụ thuộc THÂN yêu cầu chứ không phải đường dẫn, và nó được
// cưỡng chế ở CSDL — xem trg_guarantee_invite_creator (migration 031). Đặt
// requireRole ở đây sẽ khoá luôn đường thường.
router.post('/', validate(schema.createSchema), async (req, res, next) => {
  try {
    const result = await inviteService.create({
      actor: req.actor,
      referrerId: req.body.referrer_id,
      onBehalfReasonCode: req.body.on_behalf_reason_code,
      onBehalfReason: req.body.on_behalf_reason,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/', validate(schema.listQuerySchema, 'query'), async (req, res, next) => {
  try {
    res.json(
      await inviteService.list({
        actor: req.actor,
        referrerId: req.query.referrer_id,
        page: req.query.page,
        limit: req.query.limit,
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/revoke',
  validate(schema.idParamSchema, 'params'),
  validate(schema.revokeSchema),
  async (req, res, next) => {
    try {
      res.json(await inviteService.revoke({ actor: req.actor, id: req.params.id, reason: req.body.reason }));
    } catch (err) {
      next(err);
    }
  }
);
