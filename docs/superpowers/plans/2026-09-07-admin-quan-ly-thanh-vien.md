# Admin — Thêm/Xoá thành viên Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho admin (vai `approver`) hai khả năng còn thiếu ở trang quản trị: tạo thẳng một hồ sơ thành viên (nhập liệu người cũ/ngoại tuyến, bỏ qua luồng mời/bảo lãnh) và xoá (chấm dứt tư cách) một thành viên đang có, một bước, một admin.

**Architecture:** Hai endpoint REST mới trong module `members` đã có sẵn (`POST /members`, `DELETE /members/:id`), theo đúng khuôn `updateMe()`/`approve()` đang dùng (INSERT/UPDATE thẳng qua `withActor()`, audit log, `contact_upsert()` cho liên hệ). Không có migration mới — dùng cột/hàm CSDL đã tồn tại. Frontend: một màn quản trị mới `ADM.thanhvien` (danh sách + nút Xoá từng hàng) và một modal `WIZ.themThanhVien` (form tạo mới), cùng khuôn `ADM.duyet`/`WIZ.suaHoSo` đang có trong `web/index.html`.

**Tech Stack:** Node.js/Express/Knex/PostgreSQL (backend, `api/`), HTML/vanilla JS một file (`web/index.html`), Vitest + Supertest (test).

**Spec:** [docs/superpowers/specs/2026-09-07-admin-quan-ly-thanh-vien-design.md](../specs/2026-09-07-admin-quan-ly-thanh-vien-design.md)

## Global Constraints

- Chỉ vai `approver` được gọi hai endpoint mới — không mở cho `content_ops`/`tech`/`member`.
- Xoá thành viên KHÔNG đi qua khung "hai người ký" (`core/twoPerson.js`) — một đường riêng, một bước.
- Tạo thành viên mới KHÔNG gọi `contact_publish_on_join()` — giữ nguyên mức riêng tư mặc định của `fn_member_bootstrap()`.
- Không thêm migration, không đổi cột/bảng nào.
- Không dựng tính năng "Sửa hồ sơ thành viên khác" — ngoài phạm vi theo quyết định của người dùng.
- Bảng danh sách thành viên ở admin KHÔNG có cột "Ngày gia nhập" — dữ liệu đó không có trong `GET /members` (danh sách rút gọn, `LIST_COLUMNS`), và việc mở rộng `LIST_COLUMNS`/`listRow()` cho cả màn "Con người" chung chỉ để phục vụ một cột hiển thị ở đây là lấn phạm vi (xem chú thích Task 3).

---

## Task 1: Backend — `POST /members` (admin tạo thành viên)

**Files:**
- Modify: `api/src/modules/members/schema.js:42` (thêm `createMemberSchema` sau `updateMeSchema`)
- Modify: `api/src/modules/members/service.js:645` (thêm hàm `create()` sau `updateMe()`, trước `requestContact()`)
- Modify: `api/src/modules/members/routes.js:1-7` (thêm `requireRole` vào import) và dòng 40-41 (thêm route `POST /`)
- Create: `api/tests/t43-admin-member-manage.test.js`

**Interfaces:**
- Produces: `memberService.create({ actor, input })` → `Promise<{ id, full_name, email, job, area_id, bio, work_status, joined_at }>`. `actor` có dạng `{ id, communityId, roles, permissions }` (từ `req.actor`, xem `middleware/auth.js`). Ném `AppError('VALIDATION_FAILED', ..., { status: 422 })` nếu `area_id` không thuộc cộng đồng.
- Produces: `schema.createMemberSchema` (Zod) — validate `req.body` cho route mới.
- Consumes: `withActor` (`core/tx.js`), `AppError` (`core/errors.js`), `auditLog` (`core/audit.js`) — đã import sẵn ở đầu `service.js`, không cần thêm import.

- [ ] **Step 1: Đảm bảo test DB đang chạy**

Chạy:
```bash
cd /d/hoinha86 && docker compose -f docker-compose.test.yml up -d
```
Đợi vài giây rồi kiểm tra:
```bash
docker compose -f docker-compose.test.yml exec db pg_isready -U nhachung_owner -d nhachung_test
```
Kỳ vọng: `accepting connections`.

- [ ] **Step 2: Viết file test (sẽ FAIL vì chưa có endpoint)**

Tạo `api/tests/t43-admin-member-manage.test.js`:

```js
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

let db, app, cid, approverId, memberId, approverToken, memberToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });

async function grantRole(memberId_, key, communityId) {
  await db.raw(
    `INSERT INTO member_roles (member_id, role_id, community_id)
     SELECT ?, r.id, ? FROM roles r WHERE r.key = ?`, [memberId_, communityId, key]);
}

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(
    `INSERT INTO communities (code, name) VALUES ('t43-admin-member', 'T43 Admin Member') RETURNING id`
  );
  cid = community.id;
  const { rows: [approver] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, joined_at)
     VALUES (?, 'Người duyệt T43', 'member', now()) RETURNING id`, [cid]
  );
  approverId = approver.id;
  await grantRole(approverId, 'approver', cid);
  const { rows: [member] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, joined_at)
     VALUES (?, 'Thành viên thường T43', 'member', now()) RETURNING id`, [cid]
  );
  memberId = member.id;

  const token = (id) => jwt.sign({ sub: id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
  approverToken = token(approverId);
  memberToken = token(memberId);
});

afterAll(async () => { await db.destroy(); });

describe('T43 admin tạo thành viên (POST /members)', () => {
  it('approver tạo được thành viên mới; hộp liên hệ/mức riêng tư mặc định đúng', async () => {
    const res = await supertest(app)
      .post('/api/v1/members')
      .set(auth(approverToken))
      .send({ full_name: 'Người mới T43', job: 'Thợ mộc', phone: '0987000111' })
      .expect(201);
    expect(res.body.full_name).toBe('Người mới T43');
    expect(res.body.job).toBe('Thợ mộc');

    const detail = await supertest(app)
      .get(`/api/v1/members/${res.body.id}`)
      .set(auth(approverToken))
      .expect(200);
    // approver không phải chính chủ, chưa "xin xem" — mặc định phone là
    // on_consent (fn_member_bootstrap), nên state phải là can_request chứ
    // không phải visible dù chính admin vừa ghi giá trị này vào.
    expect(detail.body.contacts.phone.state).toBe('can_request');
  });

  it('member thường (không có vai approver) bị chặn 403', async () => {
    const res = await supertest(app)
      .post('/api/v1/members')
      .set(auth(memberToken))
      .send({ full_name: 'Không được tạo' })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('thiếu họ tên thì bị từ chối 400', async () => {
    const res = await supertest(app)
      .post('/api/v1/members')
      .set(auth(approverToken))
      .send({ job: 'Không có tên' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận FAIL**

```bash
cd /d/hoinha86/api && npx vitest run tests/t43-admin-member-manage.test.js
```
Kỳ vọng: FAIL — route `POST /members` chưa tồn tại (404 thay vì 201/403/400 như test đòi).

- [ ] **Step 4: Thêm `createMemberSchema` vào `schema.js`**

Trong `api/src/modules/members/schema.js`, chèn ngay sau khối `updateMeSchema` (sau dòng có `}).refine(...)` kết thúc `updateMeSchema`, trước `export const contactRequestSchema`):

```js
// Admin (approver) tạo thẳng một hồ sơ thành viên — bỏ qua luồng mời/bảo
// lãnh/nộp đơn, dùng cho nhập liệu người đã là thành viên thật ngoài đời
// nhưng chưa có tài khoản. Khác updateMeSchema: full_name BẮT BUỘC (không có
// hồ sơ cũ để giữ nguyên), và thêm joined_at cho phép ghi đúng ngày gia nhập
// lịch sử thay vì luôn là "hôm nay".
export const createMemberSchema = z.object({
  full_name: z.string().trim().min(2).max(160),
  birth_year: z.coerce.number().int().min(1900).max(new Date().getFullYear()).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  job: z.string().trim().max(160).nullable().optional(),
  area_id: z.string().uuid().nullable().optional(),
  bio: z.string().trim().max(3000).nullable().optional(),
  work_status: z.enum(['available', 'by_appointment', 'paused']).default('available'),
  // Input HTML type="date" gửi "YYYY-MM-DD" (không giờ) — KHÔNG dùng
  // z.string().datetime() (đòi ISO-8601 đủ giờ). Postgres tự cast chuỗi này
  // sang timestamptz được, không cần đổi ở JS.
  joined_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  phone: z.string().regex(/^0\d{9}$/).nullable().optional(),
  zalo: z.string().trim().max(160).nullable().optional(),
  messenger: z.string().trim().max(300).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
});
```

- [ ] **Step 5: Thêm `create()` vào `service.js`**

Trong `api/src/modules/members/service.js`, chèn ngay sau dấu `}` đóng hàm `updateMe()` (dòng 645), trước `export async function requestContact(...)`:

```js
// Admin (approver) tạo thẳng một hồ sơ thành viên, bỏ qua toàn bộ luồng
// mời/bảo lãnh/nộp đơn. Dùng cho nhập liệu thành viên đã có ngoài đời nhưng
// chưa có tài khoản (xem docs/superpowers/specs/2026-09-07-admin-quan-ly-thanh-vien-design.md).
//
// INSERT INTO members THẲNG (không qua join-requests) vẫn nổ trigger
// trg_member_bootstrap như mọi INSERT khác — hộp liên hệ rỗng + 8 mức riêng
// tư mặc định được CSDL tự tạo trong CÙNG giao dịch (migration 012, và
// migration 056 vá cho hàng thiếu từ trước migration đó).
//
// KHÔNG gọi contact_publish_on_join() (khác approve() ở join-requests/
// service.js): người được nhập liệu ở đây không tự đồng ý "công khai liên
// hệ" trên form nào cả — giữ nguyên mức mặc định (on_consent/closed/public
// tuỳ trường, xem fn_member_bootstrap).
export async function create({ actor, input }) {
  return withActor(actor.id, async (trx) => {
    if (input.area_id) {
      const { rows: [area] } = await trx.raw(
        `SELECT id FROM areas WHERE id = ? AND community_id = ? AND is_active = true`,
        [input.area_id, actor.communityId]
      );
      if (!area) throw new AppError('VALIDATION_FAILED', 'Khu vực không thuộc cộng đồng hiện tại.', { status: 422 });
    }

    const { rows: [m] } = await trx.raw(
      `INSERT INTO members
         (community_id, full_name, birth_year, email, job, area_id, bio, work_status, status, joined_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'member', coalesce(?::timestamptz, now()))
       RETURNING id, full_name, email, job, area_id, bio, work_status, joined_at`,
      [
        actor.communityId, input.full_name, input.birth_year ?? null, input.email ?? null,
        input.job ?? null, input.area_id ?? null, input.bio ?? null, input.work_status,
        input.joined_at ?? null,
      ]
    );

    const contactKeys = ['phone', 'zalo', 'messenger', 'address'].filter((key) => input[key]);
    for (const key of contactKeys) {
      await trx.raw(`SELECT contact_upsert(?, ?, ?)`, [m.id, key, input[key]]);
    }

    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'member.admin_created', targetType: 'member', targetId: m.id,
      detail: { fields: ['full_name', ...contactKeys] } });

    return m;
  });
}
```

- [ ] **Step 6: Thêm route `POST /` và import `requireRole`**

Trong `api/src/modules/members/routes.js`, đổi dòng import (dòng 4):

```js
import { requireAuth, requireRole } from '../../middleware/auth.js';
```

Rồi chèn route mới ngay sau khối đóng của `router.get('/', ...)` (sau dòng `});` kết thúc handler đó, dòng 40), trước `router.get('/me', ...)`:

```js
router.post('/', requireRole('approver'), idempotent(), validate(schema.createMemberSchema), async (req, res, next) => {
  try {
    res.status(201).json(await memberService.create({ actor: req.actor, input: req.body }));
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 7: Chạy lại test, xác nhận PASS**

```bash
cd /d/hoinha86/api && npx vitest run tests/t43-admin-member-manage.test.js
```
Kỳ vọng: 3/3 PASS.

- [ ] **Step 8: Commit**

```bash
git add api/src/modules/members/schema.js api/src/modules/members/service.js api/src/modules/members/routes.js api/tests/t43-admin-member-manage.test.js
git commit -m "feat(api): admin tạo thẳng thành viên mới (POST /members)"
```

---

## Task 2: Backend — `DELETE /members/:id` (admin xoá thành viên)

**Files:**
- Modify: `api/src/modules/members/service.js` (thêm hàm `remove()` ngay sau `create()` vừa thêm ở Task 1)
- Modify: `api/src/modules/members/routes.js` (thêm route `DELETE /:id`)
- Modify: `api/tests/t43-admin-member-manage.test.js` (thêm `describe` block mới)

**Interfaces:**
- Produces: `memberService.remove({ actor, id })` → `Promise<{ id, full_name }>`. Ném `AppError('VALIDATION_FAILED', 'Không tự xoá chính mình.', { status: 422 })` nếu `id === actor.id`; ném `NOT_FOUND()` (helper đã có ở đầu `service.js`, dòng 9) nếu không khớp hàng nào (`status <> 'member'` hoặc không tồn tại/khác cộng đồng).
- Consumes: `NOT_FOUND` (đã định nghĩa ở đầu `service.js`), `schema.idParamSchema` (đã có sẵn, dòng 23 `schema.js`).

- [ ] **Step 1: Thêm test cases (sẽ FAIL vì chưa có route)**

Thêm vào cuối `api/tests/t43-admin-member-manage.test.js`, sau `describe` khối Task 1 (cùng file, `describe` thứ hai):

```js
describe('T43 admin xoá thành viên (DELETE /members/:id)', () => {
  it('approver xoá được một thành viên; người bị xoá mất quyền truy cập ngay', async () => {
    const { rows: [target] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status, joined_at)
       VALUES (?, 'Sắp bị xoá T43', 'member', now()) RETURNING id`, [cid]
    );
    const targetToken = jwt.sign({ sub: target.id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });

    await supertest(app).get('/api/v1/members/me').set(auth(targetToken)).expect(200);

    const res = await supertest(app)
      .delete(`/api/v1/members/${target.id}`)
      .set(auth(approverToken))
      .expect(200);
    expect(res.body.id).toBe(target.id);

    const { rows: [row] } = await db.raw(`SELECT status FROM members WHERE id = ?`, [target.id]);
    expect(row.status).toBe('left');

    await supertest(app).get('/api/v1/members/me').set(auth(targetToken)).expect(401);
  });

  it('member thường (không có vai approver) bị chặn 403', async () => {
    const res = await supertest(app)
      .delete(`/api/v1/members/${memberId}`)
      .set(auth(memberToken))
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('không tự xoá được chính mình', async () => {
    const res = await supertest(app)
      .delete(`/api/v1/members/${approverId}`)
      .set(auth(approverToken))
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('xoá người đã left từ trước hoặc id không tồn tại thì báo 404', async () => {
    const { rows: [already] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status, joined_at)
       VALUES (?, 'Đã rời từ trước T43', 'left', now()) RETURNING id`, [cid]
    );
    const res = await supertest(app)
      .delete(`/api/v1/members/${already.id}`)
      .set(auth(approverToken))
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    await supertest(app)
      .delete(`/api/v1/members/00000000-0000-4000-8000-000000000000`)
      .set(auth(approverToken))
      .expect(404);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

```bash
cd /d/hoinha86/api && npx vitest run tests/t43-admin-member-manage.test.js
```
Kỳ vọng: khối "T43 admin tạo thành viên" vẫn PASS (3/3), khối "T43 admin xoá thành viên" FAIL cả 4 (route `DELETE /:id` chưa tồn tại).

- [ ] **Step 3: Thêm `remove()` vào `service.js`**

Ngay sau hàm `create()` vừa viết ở Task 1:

```js
// Admin (approver) chấm dứt tư cách thành viên NGAY, một bước, một người ký
// — khác `member.terminate` ở core/twoPerson.js (đòi HAI approver khác nhau
// ký; xem lý do không tái dùng khung đó trong spec, mục "Quyết định nền").
// Kết quả CSDL giống hệt: status → 'left', dữ liệu giữ nguyên làm "bia mộ"
// (đặc tả mục 10). requireAuth (middleware/auth.js:66) đã tự khoá người có
// status khác 'member' ngay từ lượt gọi API kế tiếp — không cần thu hồi
// token/phiên riêng ở đây.
export async function remove({ actor, id }) {
  if (id === actor.id) {
    throw new AppError('VALIDATION_FAILED', 'Không tự xoá chính mình.', { status: 422 });
  }
  return withActor(actor.id, async (trx) => {
    const { rows: [m] } = await trx.raw(
      `UPDATE members SET status = 'left', updated_at = now()
        WHERE id = ? AND community_id = ? AND status = 'member'
        RETURNING id, full_name`,
      [id, actor.communityId]
    );
    if (!m) throw NOT_FOUND();

    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'member.admin_removed', targetType: 'member', targetId: id, detail: {} });

    return m;
  });
}
```

- [ ] **Step 4: Thêm route `DELETE /:id`**

Trong `api/src/modules/members/routes.js`, chèn ngay sau khối đóng của `router.get('/:id', ...)` (sau dòng `});` kết thúc handler đó), trước `router.get('/:id/contacts/:field', ...)`:

```js
router.delete('/:id', requireRole('approver'), validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try {
    res.json(await memberService.remove({ actor: req.actor, id: req.params.id }));
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Chạy lại toàn bộ file test, xác nhận PASS**

```bash
cd /d/hoinha86/api && npx vitest run tests/t43-admin-member-manage.test.js
```
Kỳ vọng: 7/7 PASS.

- [ ] **Step 6: Chạy lại toàn bộ bộ test API, xác nhận không hồi quy**

```bash
cd /d/hoinha86/api && npx vitest run 2>&1 | tail -15
```
Kỳ vọng: đúng `541 passed`/`40 failed` như trước khi bắt đầu Task 1 (cộng thêm 7 test mới ở `t43` → `548 passed`), KHÔNG có thêm file nào đỏ mới ngoài 8 file đã biết là đỏ từ trước (xem "Global Constraints" — không đụng gì tới nguyên nhân của 40 lỗi đó).

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/members/service.js api/src/modules/members/routes.js api/tests/t43-admin-member-manage.test.js
git commit -m "feat(api): admin xoá thành viên một bước (DELETE /members/:id)"
```

---

## Task 3: Frontend — màn quản trị "Thành viên" (danh sách + nút Xoá)

**Files:**
- Modify: `web/index.html:2044` (thêm mục nav)
- Modify: `web/index.html:5217` (thêm `ADM.thanhvien` và `adminXoaThanhVien()` ngay sau khối `ADM.duyet`)

**Interfaces:**
- Consumes: `DATA.members` (mảng đã nạp lúc boot qua `mapMember()`, mỗi phần tử `{id, name, ward, field, status, role, avatar}` — xem `web/index.html:1460`), `api.del(path)` (`web/js/api.js`), `esc()`, `ic()`, `toast()`, `render()`, `qsa()` (đã có sẵn, toàn cục).
- Produces: `adminXoaThanhVien(id, name)` — gọi từ `onclick` sinh trong Task này; `ADM.thanhvien` — hàm màn hình, gọi tự động qua router khi hash là `#admin-thanhvien` (xem `web/index.html:2154`, `body = (ADM[sub]||ADM.tongquan)()` với `sub = screen.replace('admin-','')`).
- Lưu ý: nút "+ Thêm thành viên" ở Task này dùng `data-open="themThanhVien"` — `WIZ.themThanhVien` CHƯA tồn tại cho tới Task 4; bấm nút trong lúc chỉ mới xong Task 3 sẽ không làm gì (delegated handler ở `web/index.html:2368` tự bỏ qua khi `WIZ[key]` là `undefined`) — không phải lỗi, chỉ là trạng thái trung gian giữa hai task.

Đây là thay đổi HTML/JS thuần, không có build step — Caddy phục vụ `web/` trực tiếp qua bind mount (`docker-compose.yml`, `./web:/srv:ro`), sửa file là thấy ngay sau khi tải lại trang, không cần rebuild container nào.

- [ ] **Step 1: Thêm mục nav**

Trong `web/index.html`, tìm mảng `NAV_ADMIN` (dòng 2042), thêm dòng mới ngay sau `admin-duyet`:

```js
const NAV_ADMIN = [
  {id:'admin-tongquan', label:'Tổng quan', icon:'grid'},
  {id:'admin-duyet', label:'Duyệt & xác minh', icon:'shield'},
  {id:'admin-thanhvien', label:'Thành viên', icon:'users'},
  {id:'admin-dieuphoi', label:'Điều phối', icon:'handshake'},
  {id:'admin-quy', label:'Quỹ hội', icon:'fund', badge:()=>(DATA.loanRequests||[]).filter(l=>l.status==='requested').length},
  {id:'admin-hoatdong', label:'Hoạt động & ký ức', icon:'archive'},
  {id:'admin-nhatky', label:'Nhật ký', icon:'server'},
  {id:'admin-phanquyen', label:'Phân quyền', icon:'lock'},
  {id:'cotuong-online', label:'Cờ tướng', icon:'star'},
];
```

- [ ] **Step 2: Thêm `ADM.thanhvien` và `adminXoaThanhVien()`**

Chèn ngay sau dòng kết thúc `ADM.duyet` (dòng 5217, kết thúc bằng `</tbody></table></div>\`;`), trước dòng `const VERIFICATION_KIND_LABEL = ...`:

```js
ADM.thanhvien = ()=> `
  <div class="page-head"><div><h1>Thành viên</h1><p>${DATA.members.length} thành viên đang hoạt động.</p></div>
    <button class="btn btn-blue" data-open="themThanhVien">${ic('plus',15)} Thêm thành viên</button></div>
  <div class="section"><table><thead><tr><th>Họ tên</th><th>Nghề / khu vực</th><th style="text-align:right">Thao tác</th></tr></thead>
    <tbody>${DATA.members.length?DATA.members.map(m=>`<tr><td class="t-strong">${esc(m.name)}</td>
      <td class="t-time">${[m.field,m.ward].filter(Boolean).map(esc).join(' · ')||'—'}</td>
      <td style="text-align:right"><button class="btn btn-out btn-sm" style="color:var(--red)" onclick="adminXoaThanhVien('${m.id}','${esc(m.name).replace(/'/g,"\\'")}')">${ic('x',12)} Xoá</button></td></tr>`).join(''):'<tr><td colspan="3" class="t-muted">Chưa có thành viên nào.</td></tr>'}</tbody>
  </table></div>`;
async function adminXoaThanhVien(id, name){
  if(!confirm(`Xoá tư cách thành viên của ${name}? Không hoàn tác được qua giao diện.`)) return;
  try{
    await api.del('/members/'+id);
    DATA.members = DATA.members.filter(m=>m.id!==id);
    toast('Đã xoá thành viên','check');
    render();
  }catch(e){ toast(e.message||'Có lỗi, thử lại.','flag'); }
}
```

- [ ] **Step 3: Kiểm tra cú pháp nhanh bằng Node (không có bài test backend nào đọc `web/index.html`, nên lỗi cú pháp JS ở đây không bị bài test API nào bắt được — chỉ trình duyệt thật ở Task 5 mới lộ ra)**

```bash
cd /d/hoinha86 && node -e "
const fs = require('fs');
const html = fs.readFileSync('web/index.html', 'utf8');
const script = html.slice(html.indexOf('<script>')+8, html.lastIndexOf('</script>'));
new Function(script);
console.log('OK: cú pháp hợp lệ');
"
```
Kỳ vọng: in ra `OK: cú pháp hợp lệ`, không ném `SyntaxError`. (Chỉ kiểm cú pháp — không CHẠY script, vì nó cần DOM. Lỗi hành vi thật sự xác nhận ở Task 5.)

- [ ] **Step 4: Commit**

```bash
git add web/index.html
git commit -m "feat(web): màn quản trị Thành viên — danh sách + xoá thành viên"
```

---

## Task 4: Frontend — modal "Thêm thành viên"

**Files:**
- Modify: `web/index.html:3271` (thêm `WIZ.themThanhVien` và `themThanhVienSubmit()` ngay sau `suaHoSoSubmit()`, trước `WIZ.vietBaoChung`)

**Interfaces:**
- Consumes: `SUGGEST_VALUES`, `suggestFieldArea()`, `getSuggestValue()`, `areaIdByName()`, `getVal()`, `WORK_STATUS_OPTS` (dòng 3200), `openModal()`, `closeModal()`, `api.post()`, `api.newIdemKey()`, `DATA.areasFlat`, `DATA.members` — tất cả đã có sẵn, toàn cục (xem cách `WIZ.suaHoSo`/`suaHoSoSubmit`, dòng 3188-3271, dùng y hệt các hàm này).
- Produces: `WIZ.themThanhVien` — gọi tự động qua `data-open="themThanhVien"` đã gắn ở Task 3 (delegated handler `web/index.html:2368`). `themThanhVienSubmit()` — gọi từ nút "Thêm" trong modal.

- [ ] **Step 1: Thêm modal + hàm submit**

Chèn ngay sau dòng cuối của `suaHoSoSubmit()` (dòng 3271, `}` đóng hàm đó), trước `WIZ.vietBaoChung = ()=> openModal(...)`:

```js
/* Thêm thành viên thật: POST /members. Admin (approver) nhập liệu người đã
   là thành viên ngoài đời nhưng chưa có tài khoản — bỏ qua luồng mời/bảo
   lãnh/nộp đơn. Cùng bố cục renderSuaHoSoForm ở trên, bớt ảnh đại diện (chưa
   có member_id để gắn quyền sở hữu file) và thêm "Ngày gia nhập". */
WIZ.themThanhVien = ()=>{
  SUGGEST_VALUES['ttvkhuvuc'] = '';
  openModal(`<div class="modal-head"><b>Thêm thành viên</b><button class="modal-x" onclick="closeModal()">${ic('x',15)}</button></div>
    <div class="modal-body">
      <div class="field"><label class="label">Họ tên <span class="req" style="color:var(--red)">*</span></label><input class="input" id="tv-name" placeholder="Nguyễn Văn A"></div>
      <div class="g2">
        <div class="field"><label class="label">Nghề nghiệp</label><input class="input" id="tv-job"></div>
        ${suggestFieldArea('Khu vực','ttvkhuvuc')}
      </div>
      <div class="field"><label class="label">Giới thiệu ngắn</label><textarea class="input" id="tv-bio" style="height:70px;padding-top:10px"></textarea></div>
      <div class="field"><label class="label">Tình trạng nhận việc</label><div style="display:flex;gap:8px;flex-wrap:wrap">${WORK_STATUS_OPTS.map(([v,l])=>`<button type="button" class="fchip ${v==='available'?'on':''}" data-wsval="${v}" onclick="qsa('[data-wsval]').forEach(b=>b.classList.remove('on'));this.classList.add('on')">${l}</button>`).join('')}</div></div>
      <div class="field"><label class="label">Ngày gia nhập</label><input class="input" id="tv-joined" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="g2">
        <div class="field"><label class="label">Điện thoại</label><input class="input" id="tv-phone" placeholder="0912345678"></div>
        <div class="field"><label class="label">Zalo</label><input class="input" id="tv-zalo"></div>
      </div>
      <div class="g2">
        <div class="field"><label class="label">Messenger</label><input class="input" id="tv-messenger"></div>
        <div class="field"><label class="label">Email (không bắt buộc)</label><input class="input" id="tv-email" type="email"></div>
      </div>
      <div class="field"><label class="label">Địa chỉ cụ thể (không bắt buộc)</label><input class="input" id="tv-address" placeholder="Số nhà, đường, thôn/xóm…"></div>
      <div id="tv-err" class="notice wait" style="display:none">${ic('flag',16)}<span id="tv-err-txt"></span></div>
    </div>
    <div class="modal-foot"><button class="btn btn-out" style="flex:1" onclick="closeModal()">Huỷ</button>
      <button class="btn btn-blue" id="tv-submit" style="flex:2" onclick="themThanhVienSubmit()">Thêm</button></div>`, {wide:true});
};
async function themThanhVienSubmit(){
  const box=qs('#tv-err'), txt=qs('#tv-err-txt');
  if(box) box.style.display='none';
  const fullName = getVal('tv-name');
  if(fullName.length<2){
    if(box){ txt.textContent='Nhập họ tên ít nhất 2 ký tự.'; box.style.display='flex'; }
    return;
  }
  const btn=qs('#tv-submit'); if(btn){btn.disabled=true;btn.textContent='Đang thêm…';}
  try{
    const work_status = document.querySelector('[data-wsval].on')?.dataset.wsval || 'available';
    const payload = { full_name:fullName, job:getVal('tv-job')||null, bio:getVal('tv-bio')||null,
      area_id:areaIdByName(getSuggestValue('ttvkhuvuc')), work_status, joined_at:getVal('tv-joined')||null,
      email:getVal('tv-email')||null, phone:getVal('tv-phone')||null, zalo:getVal('tv-zalo')||null,
      messenger:getVal('tv-messenger')||null, address:getVal('tv-address')||null };
    const created = await api.post('/members', payload, api.newIdemKey());
    const areaName = created.area_id ? (DATA.areasFlat.find(a=>a.id===created.area_id)||{}).name : '';
    DATA.members.unshift({ id:created.id, name:created.full_name, ward:areaName||'', field:created.job||'',
      status:created.work_status, role:'member', avatar:null });
    closeModal(); toast('Đã thêm thành viên','check'); render();
  }catch(e){
    if(btn){btn.disabled=false;btn.textContent='Thêm';}
    if(box&&txt){ txt.textContent=e.message||'Có lỗi, thử lại.'; box.style.display='flex'; }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/index.html
git commit -m "feat(web): modal Thêm thành viên (POST /members)"
```

---

## Task 5: Xác nhận toàn trình qua trình duyệt thật

Dùng stack Docker đang chạy sẵn trên máy (đã bật từ phiên trước — kiểm bằng `docker ps` nếu không chắc). Chỉ container `api` cần build lại (Task 1/2 sửa code backend); `web/index.html` được Caddy phục vụ trực tiếp qua bind mount, không cần build lại `proxy`.

- [ ] **Step 1: Build lại và khởi động lại container `api`**

```bash
cd /d/hoinha86 && docker compose up -d --build api
```
Kỳ vọng log không có lỗi:
```bash
docker compose logs api --tail=20
```
Cần thấy `==> chạy migration` rồi `migration xong, mở cổng phục vụ` (migration 056 đã áp dụng từ trước, batch lần này có thể là `Batch N run: 0 migrations` nếu không có migration mới — đúng, Task 1/2 không thêm migration nào).

- [ ] **Step 2: Đăng nhập bằng tài khoản admin đã bootstrap từ trước và kiểm tra màn mới**

Dùng `node <browser-automation-skill-dir>/browser.mjs` (skill `browser-automation`) với một script `--script`:
1. Vào `http://localhost/#dangnhap`, đăng nhập `admin@test.local` / `Test-Password-123!` (tài khoản đã tạo ở phiên vá lỗi trước — nếu không còn, chạy lại `docker compose exec -e ADMIN_EMAIL='admin@test.local' -e ADMIN_PASSWORD='Test-Password-123!' api npm run admin:bootstrap` trước).
2. Điều hướng `http://localhost/#admin-thanhvien`, `--snapshot` — xác nhận thấy tiêu đề "Thành viên", nút "+ Thêm thành viên", và bảng liệt kê thành viên hiện có (ít nhất chính tài khoản admin).
3. Bấm "+ Thêm thành viên", điền Họ tên = "Người test E2E", Điện thoại = "0977123456", bấm "Thêm". Snapshot lại — xác nhận modal đóng, toast "Đã thêm thành viên" xuất hiện (hoặc hàng mới có trong bảng ngay sau khi đóng modal).
4. Tải lại trang (`page.reload()`), vào lại `#admin-thanhvien` — xác nhận "Người test E2E" vẫn còn trong danh sách (dữ liệu thật từ server, không phải chỉ optimistic update).
5. Bấm nút "Xoá" ở đúng hàng "Người test E2E" — script cần tự accept dialog `confirm()` (Playwright: đăng ký `page.on('dialog', d => d.accept())` TRƯỚC khi bấm). Snapshot lại — xác nhận hàng đó biến mất khỏi bảng.
6. Tải lại trang lần nữa, vào lại `#admin-thanhvien` — xác nhận "Người test E2E" KHÔNG còn trong danh sách (xoá thật ở server, không phải chỉ optimistic update).

Nếu bất kỳ bước nào lệch kỳ vọng (lỗi console, toast báo lỗi thay vì thành công, hàng không biến mất sau tải lại) — dừng lại, đọc lỗi cụ thể (console errors/network trong report của `browser.mjs`), quay lại Task tương ứng để sửa trước khi tiếp tục.

- [ ] **Step 3: Báo cáo kết quả**

Không cần commit gì thêm ở bước này (không có thay đổi code) — chỉ xác nhận bằng lời với người dùng rằng đã tự kiểm qua giao diện thật và kết quả khớp kỳ vọng.

---

## Self-Review (đã chạy trước khi giao kế hoạch)

- **Bao phủ spec:** Cả bốn mục "Quyết định nền" của spec đều có task tương ứng (vai `approver` → Global Constraints + mọi route; đường xoá riêng không qua hai-người-ký → Task 2; `INSERT` thẳng qua service để nổ trigger → Task 1; không `contact_publish_on_join` → Task 1; vị trí menu → Task 3). Mục "Ngoài phạm vi" của spec không có task nào tương ứng — đúng ý, vì đó là những thứ CHỦ ĐỘNG không làm.
- **Không còn chỗ nào ghi "TBD"/"tương tự Task N"** — mọi step đều có code đầy đủ, kể cả hai khối test dài.
- **Khớp kiểu dữ liệu xuyên Task:** `memberService.create()` trả `{id, full_name, email, job, area_id, bio, work_status, joined_at}` (Task 1) — Task 4 (`themThanhVienSubmit`) chỉ đọc `created.id`, `created.full_name`, `created.area_id`, `created.job`, `created.work_status`, đều khớp. `memberService.remove()` trả `{id, full_name}` (Task 2) — Task 3 (`adminXoaThanhVien`) không đọc response body, chỉ cần status 200, khớp.
