import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permission.js';
import * as schema from './schema.js';
import * as twoPerson from '../../core/twoPerson.js';
import * as ops from './service.js';

export const router = Router();

router.use(rateLimit({ windowMs: 60_000, max: 60 }), requireAuth);

// ---------------------------------------------------------------------------
// Nhật ký — bảng mục 5.3: approver, tech.
//
// `/audit-log/verify` phải khai TRƯỚC `/audit-log`? KHÔNG — hai đường dẫn khác
// nhau hoàn toàn, không có tham số nào nuốt được cái kia. Chỗ cần cẩn thận là
// `/members/me` với `/members/:id` (ghi ở mục 5.3), và ở đây không có hình
// dạng đó. Nêu ra vì người đọc sau sẽ hỏi.
//
// KHÔNG CÓ route nào SỬA hay XOÁ `audit_log`, và đó là toàn bộ danh sách: hai
// cửa dưới đây là `GET`. Đề bài đòi "audit_log chỉ đọc — không endpoint nào
// sửa hay xoá được"; ở tầng CSDL thì `REVOKE UPDATE, DELETE` (007) đã ép, nên
// kể cả một route viết ẩu ở task sau cũng không sửa được.
// ---------------------------------------------------------------------------
router.get(
  '/audit-log',
  requirePermission('ops.audit.read'),
  validate(schema.listAuditLogSchema, 'query'),
  async (req, res, next) => {
    try {
      res.json(
        await ops.listAuditLog({
          actor: req.actor,
          actorId: req.query.actor_id ?? null,
          action: req.query.action ?? null,
          from: req.query.from ?? null,
          to: req.query.to ?? null,
          page: req.query.page,
          limit: req.query.limit,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/audit-log/verify',
  requirePermission('ops.audit.read'),
  validate(schema.verifyChainSchema, 'query'),
  async (req, res, next) => {
    try {
      res.json(
        await ops.verifyAuditChain({
          actor: req.actor,
          from: req.query.from ?? null,
          to: req.query.to ?? null,
        })
      );
    } catch (err) {
      next(err);
    }
  }
);

// Bảng điều khiển — bốn cảnh báo mục 4.6 và mục 9.
router.get('/dashboard', requirePermission('ops.dashboard'), async (req, res, next) => {
  try {
    res.json(await ops.dashboard({ actor: req.actor }));
  } catch (err) {
    next(err);
  }
});

// Bảng mục 5.3: `GET /ops/permissions` — "mọi vai", nên KHÔNG có cổng quyền ở
// đây. Nó trả ma trận của CHÍNH người gọi; một người không vai gì nhận về hai
// mảng rỗng, và đó là câu trả lời đúng chứ không phải một lỗi.
router.get('/permissions', async (req, res, next) => {
  try {
    res.json(await ops.myPermissions({ actor: req.actor }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Vai — mục 7.4 lớp 2: "cấp vai lại là việc của `tech` — có ghi log".
//
// Ba cửa này KHÔNG nằm trong bảng endpoint mục 5.3 của đặc tả; đặc tả hứa
// luồng gán vai ở mục 7.4 và migration 008 hẹn hàm gán vai, nhưng bảng 5.3
// không có hàng nào cho chúng. Đã ghi vào báo cáo là một chỗ đặc tả thiếu.
//
// Luật thì KHÔNG nằm ở đây: `fn_role_grant`/`fn_role_revoke` tự kiểm, và
// `trg_member_role_guard` chặn cả đường vòng. `requirePermission` ở đây chỉ
// để người không đủ quyền nhận 403 tử tế thay vì một ngoại lệ CSDL.
// ---------------------------------------------------------------------------
router.get('/roles', requirePermission('ops.role.manage'), async (req, res, next) => {
  try {
    res.json(await ops.listRoles({ actor: req.actor }));
  } catch (err) {
    next(err);
  }
});

router.put(
  '/members/:id/roles/:role',
  requirePermission('ops.role.manage'),
  validate(schema.roleParamSchema, 'params'),
  async (req, res, next) => {
    try {
      res.json(await ops.grantRole({ actor: req.actor, memberId: req.params.id, role: req.params.role }));
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/members/:id/roles/:role',
  requirePermission('ops.role.manage'),
  validate(schema.roleParamSchema, 'params'),
  async (req, res, next) => {
    try {
      res.json(await ops.revokeRole({ actor: req.actor, memberId: req.params.id, role: req.params.role }));
    } catch (err) {
      next(err);
    }
  }
);

// Bảng mục 5.3: `GET /ops/pending-actions` — approver, tech.
router.get(
  '/pending-actions',
  requirePermission('ops.pending_action.list'),
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
