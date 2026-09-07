# Trang quản trị — Thêm / Xoá thành viên

- **Ngày:** 2026-09-07
- **Phạm vi:** Một màn quản trị mới "Thành viên" cho phép admin (vai `approver`) (1) tạo thẳng một hồ sơ thành viên mới — chủ yếu để nhập liệu người đã là thành viên thật ngoài đời nhưng chưa có tài khoản, bỏ qua toàn bộ luồng mời/bảo lãnh/nộp đơn; (2) xoá (chấm dứt tư cách) một thành viên đang có, một bước, một admin, không cần người thứ hai xác nhận.
- **Ngoài phạm vi:**
  - **Sửa hồ sơ thành viên khác** — quyết định của người dùng: hồ sơ là của chính chủ, admin không sửa hộ.
  - Đặt/đổi mật khẩu cho thành viên mới tạo — họ chưa đăng nhập được cho tới khi có một luồng "admin cấp mật khẩu"/"quên mật khẩu" riêng, luồng đó chưa tồn tại và không dựng ở đây.
  - Đổi khung "hai người ký" (`core/twoPerson.js`, hành động `member.terminate`) để chỉ cần một chữ ký — khung đó dùng chung cho 5-6 loại hành động khác và luật hai chữ ký khoá ở trigger CSDL cho toàn bảng `pending_actions`, không tách riêng theo từng loại được. Xoá thành viên ở đây đi một đường HOÀN TOÀN RIÊNG, không đụng khung đó.
  - Ảnh đại diện lúc tạo mới — `files/service.js` gắn quyền sở hữu file theo `owner_id = actor.id`, admin tải hộ ảnh cho người khác sẽ sai chủ sở hữu. Thành viên tự thêm ảnh sau khi có tài khoản (ngoài phạm vi mục "mật khẩu" ở trên).
  - Danh sách/khôi phục thành viên đã `left` — màn mới chỉ hiện thành viên `status='member'`, giống `GET /members` mặc định hiện tại.

---

## 0. Quyết định nền

| Quyết định | Chọn | Lý do |
|---|---|---|
| Ai được thêm/xoá | Vai `approver` (không phải `content_ops`/`tech`) | Khớp đúng vai đang giữ hành động tương đương gần nhất trong code: duyệt đơn gia nhập (`join-requests/routes.js` `requireRole('approver')`) và `member.terminate` (`fn_pending_action_role` → `approver`) |
| Xoá đi qua đường nào | Đường mới, riêng, một bước — KHÔNG qua `pending_actions`/hai chữ ký | Giữ khung hai người ký nguyên vẹn cho các việc khác đang dùng nó; không làm yếu luật CSDL dùng chung |
| Xoá = gì trong CSDL | `UPDATE members SET status='left'` — giống hệt kết quả cuối của `member.terminate`, dữ liệu giữ nguyên làm "bia mộ" (đặc tả mục 10) | Đây là bất biến đã có từ trước (`GET /members` mặc định chỉ trả `status='member'`), không phải quyết định mới — chỉ đổi CÁCH đi tới trạng thái đó |
| Khoá đăng nhập sau khi xoá | Không cần làm gì thêm | `requireAuth` (`middleware/auth.js:66`) đã tự chặn mọi actor có `status !== 'member'` ngay từ lần gọi API kế tiếp |
| Thêm mới tạo hàng qua đường nào | `INSERT INTO members (...) VALUES (..., 'member', now())` thẳng trong service — CÙNG khuôn `join-requests/service.js#approve()` đang dùng | Bắt buộc: chỉ có đi qua `INSERT` ứng dụng thật thì trigger `trg_member_bootstrap` mới tự tạo `member_contacts`/`privacy_settings` — lặp lại đúng lỗi vừa vá hôm qua (migration 056) nếu làm khác |
| Mức riêng tư của liên hệ nhập lúc tạo | GIỮ NGUYÊN mặc định của `fn_member_bootstrap` (phone/zalo `on_consent`, address `closed`, ...) — KHÔNG gọi `contact_publish_on_join()` | Khác với `approve()`: người nộp đơn tự đồng ý "công khai liên hệ" trên form đăng ký của chính họ; thành viên nhập liệu kiểu này KHÔNG có bước đồng ý đó, admin không được tự ý công khai hộ |
| Vị trí trên menu quản trị | Mục mới **"Thành viên"** trong `NAV_ADMIN`, ngay sau "Duyệt & xác minh" | Cùng nhóm vòng đời thành viên; không thêm vào `TABBAR_ADMIN` (đã cố định 5 mục cho di động, giống cách "Điều phối"/"Hoạt động & ký ức" cũng chỉ ở sidebar) |

---

## 1. Backend

### 1.1 `POST /members` — tạo thành viên (admin)

File: `api/src/modules/members/routes.js` + `service.js`, `schema.js`.

```js
router.post('/', requireRole('approver'), idempotent(),
  validate(schema.createMemberSchema), async (req, res, next) => {
  try { res.status(201).json(await memberService.create({ actor: req.actor, input: req.body })); }
  catch (err) { next(err); }
});
```

Khác method với `router.get('/', ...)` đã có (POST vs GET) nên thứ tự khai báo không ảnh hưởng khớp route — đặt ngay sau khối `/me*` và trước `/:id/contacts/:field` chỉ để dễ đọc, gom mọi route gốc `/members` (không tham số `:id`) lại một chỗ.

`createMemberSchema` (mirror một phần `updateMeSchema`, cộng `full_name` bắt buộc và `joined_at`):

```js
export const createMemberSchema = z.object({
  full_name: z.string().trim().min(2).max(160),
  birth_year: z.coerce.number().int().min(1900).max(new Date().getFullYear()).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  job: z.string().trim().max(160).nullable().optional(),
  area_id: z.string().uuid().nullable().optional(),
  bio: z.string().trim().max(3000).nullable().optional(),
  work_status: z.enum(['available', 'by_appointment', 'paused']).default('available'),
  // Input HTML type="date" gửi "YYYY-MM-DD" (không có giờ) — KHÔNG dùng
  // z.string().datetime() (đòi ISO-8601 đủ giờ, sẽ ném lỗi với chuỗi này).
  // Postgres tự cast "YYYY-MM-DD" sang timestamptz được, không cần đổi ở JS.
  joined_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), // thiếu thì dùng now()
  phone: z.string().regex(/^0\d{9}$/).nullable().optional(),
  zalo: z.string().trim().max(160).nullable().optional(),
  messenger: z.string().trim().max(300).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
});
```

`memberService.create({ actor, input })` (mirror khuôn `updateMe`/`approve()` đã có):

1. Nếu có `area_id`: kiểm tồn tại + đúng cộng đồng (copy nguyên đoạn kiểm đã có ở `updateMe`).
2. `INSERT INTO members (community_id, full_name, birth_year, email, job, area_id, bio, work_status, status, joined_at) VALUES (..., 'member', coalesce(?, now())) RETURNING id, full_name, email, job, area_id, bio, work_status, joined_at`.
3. Với từng trường trong `phone/zalo/messenger/address` có mặt trong `input`: `SELECT contact_upsert(?, '<field>', ?)`. KHÔNG gọi `contact_publish_on_join`.
4. `auditLog(trx, { action: 'member.admin_created', targetType: 'member', targetId: m.id, detail: { fields: [...] } })`.
5. Trả về hàng ở bước 2.

Không cần cột mới, không cần migration — toàn bộ dùng cột đã có.

### 1.2 `DELETE /members/:id` — xoá (chấm dứt tư cách) thành viên (admin)

```js
router.delete('/:id', requireRole('approver'), validate(schema.idParamSchema, 'params'),
  async (req, res, next) => {
  try { res.json(await memberService.remove({ actor: req.actor, id: req.params.id })); }
  catch (err) { next(err); }
});
```

Đặt sau `router.get('/:id', ...)`.

`memberService.remove({ actor, id })`:

1. Chặn tự xoá chính mình: `if (id === actor.id) throw new AppError('VALIDATION_FAILED', 'Không tự xoá chính mình.', { status: 422 })` — cùng tinh thần với `ROLE_SELF_GRANT` (không ai tự gán/gỡ vai của chính mình) đã áp cho `/ops/members/:id/roles/:role`.
2. `UPDATE members SET status = 'left', updated_at = now() WHERE id = ? AND community_id = ? AND status = 'member' RETURNING id, full_name` — không khớp hàng nào (đã `left` từ trước, hoặc không tồn tại/khác cộng đồng) thì `NOT_FOUND`.
3. `auditLog(trx, { action: 'member.admin_removed', targetType: 'member', targetId: id, detail: {} })`.
4. Trả `{ id, full_name }`.

Không cần rate limit riêng (đã có `normalLimit` áp cho cả router ở dòng 17), không cần `idempotent()` (UPDATE có điều kiện `status = 'member'` đã tự vô hại khi gọi lại — lần hai không khớp hàng nào, trả `NOT_FOUND` thay vì làm lại, chấp nhận được vì đây không phải luồng tạo tài nguyên tiền/của cải cần khoá idempotency).

### 1.3 Test

Thêm `api/tests/tXX-admin-member-manage.test.js` (số thứ tự lấy sau file cuối cùng hiện có), phủ:
- `approver` tạo được thành viên mới, `member_contacts`/`privacy_settings` được backfill đúng (đọc lại qua `GET /members/:id` thấy state đúng theo mức mặc định — không phải `visible`/`public` cho phone).
- `member` thường (không có vai `approver`) bị `403 FORBIDDEN` ở cả hai endpoint.
- Thiếu `full_name` hoặc `full_name` rỗng → `422 VALIDATION_FAILED`.
- `approver` xoá được một thành viên → `GET /members` (mặc định) không còn thấy người đó; người bị xoá gọi API bằng token cũ → `401` (qua `requireAuth`).
- Tự xoá chính mình → `422`.
- Xoá người đã `left` từ trước / id không tồn tại → `404 NOT_FOUND`.

---

## 2. Frontend (`web/index.html`)

### 2.1 Menu

Thêm vào `NAV_ADMIN` (dòng ~2042), ngay sau `admin-duyet`:

```js
{id:'admin-thanhvien', label:'Thành viên', icon:'users'},
```

### 2.2 Màn `ADM.thanhvien`

Cùng khuôn các màn `ADM.*` khác (hàm thuần trả về chuỗi HTML, đọc `DATA.members` đã nạp sẵn lúc boot — xem cách `ADM.phanquyen` dùng `DATA.members`).

```
<page-head> "Thành viên" — nút "+ Thêm thành viên" (mở modal WIZ.themThanhVien)
<section> bảng: Họ tên | Nghề/khu vực | Ngày gia nhập | [Xoá]
```

Mỗi hàng nút "Xoá" gọi `adminXoaThanhVien(id, full_name)`:

```js
async function adminXoaThanhVien(id, name){
  if(!confirm(`Xoá tư cách thành viên của ${name}? Không hoàn tác được qua giao diện.`)) return;
  try{
    await api.del('/members/'+id);
    DATA.members = DATA.members.filter(m=>m.id!==id);
    toast('Đã xoá thành viên', 'check');
    render();
  }catch(e){ toast(e.message||'Có lỗi, thử lại.', 'flag'); }
}
```

(Cùng khuôn `goRevokeRole` — `confirm()` rồi gọi API rồi tự cập nhật `DATA.members` cục bộ thay vì gọi lại `GET /members`.)

### 2.3 Modal "Thêm thành viên" — `WIZ.themThanhVien`

Cùng bố cục `renderSuaHoSoForm` (field/label/input, `g2` hai cột, `suggestFieldArea` cho khu vực, chip `WORK_STATUS_OPTS`), bớt đi: không có ảnh đại diện, không có Messenger tách dòng riêng (gộp vào `g2` với Zalo cho gọn), thêm một ô "Ngày gia nhập":

```
Họ tên * | (bắt buộc, min 2 ký tự)
Nghề nghiệp | Khu vực (suggestFieldArea)
Giới thiệu ngắn (textarea)
Tình trạng nhận việc (chip, mặc định "Sẵn sàng nhận việc")
Ngày gia nhập (input date, mặc định hôm nay — admin có thể lùi ngày cho đúng lịch sử)
Điện thoại | Zalo
Messenger | Email
Địa chỉ cụ thể
```

`themThanhVienSubmit()` validate `full_name` không rỗng ở client trước khi gọi (giống `suaHoSoSubmit` không validate client cho `full_name`, nhưng ở đây nên validate vì server sẽ 422 nếu rỗng và trải nghiệm rõ ràng hơn khi báo ngay), gọi:

```js
await api.post('/members', payload, api.newIdemKey());
```

Thành công: đóng modal, `toast('Đã thêm thành viên','check')`, thêm vào đầu `DATA.members` (dựng object rút gọn từ response — cùng field `DATA.members` đang có: `id, name, field, ward, avatar`), `render()`.

### 2.4 Test hợp đồng web↔API

Bổ sung vào `api/tests/t36-web-api-wiring.test.js` theo đúng khuôn các `it()` khác trong file (dù file này đang đỏ toàn bộ vì lý do KHÁC — xem ghi chú ở cuối; việc thêm case mới ở đây độc lập với việc file có xanh hay không):
- `expect(html).toContain("api.post('/members'")`
- `expect(html).toContain("api.del('/members/")`

---

## 3. Việc không làm nhưng đáng ghi lại

Bộ test API hiện có ~40 bài đỏ từ trước (không liên quan việc này) vì `POST /auth/register` bắt buộc `zalo`/`messenger` (migration 054) nhưng nhiều test cũ chưa cập nhật. File test mới của mục 1.3 không đụng `/auth/register` nên không bị ảnh hưởng, nhưng `npm test` tổng thể vẫn sẽ báo đỏ các file khác — đã xác nhận từ trước, không phải hồi quy do việc này.
