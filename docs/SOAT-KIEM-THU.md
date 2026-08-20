# Soát cả bộ kiểm thử — bài nào canh NGUỒN, bài nào canh TRIỆU CHỨNG

- **Ngày:** 2026-08-19/20 · **Nhánh:** `giai-doan-1` · **Phạm vi:** toàn bộ `api/tests/` (29 tệp, 290 bài, đang xanh hết)
- **Loại việc:** phân tích. Không sửa bài test nào trừ bài **xanh giả** (xem mục cuối).

---

## 1. Nguồn và triệu chứng — đọc mục này trước

Một bài test bao giờ cũng đo **một đại lượng** rồi so với **một kỳ vọng**. Câu hỏi
không phải "nó có xanh không" mà là:

> **Đại lượng nó đo có phải là thứ ta thật sự quan tâm, hay chỉ là một cái bóng của
> thứ đó?**

- **Canh NGUỒN** = đo chính thứ sinh ra hành vi. Chạy mã thật, trên dữ liệu thật, đọc
  kết quả thật. Muốn phá luật mà vẫn xanh thì phải phá luôn cái nguồn — tức là không
  phá được.
- **Canh TRIỆU CHỨNG** = đo một thứ *thường đi kèm* hành vi đúng. Khi hành vi hỏng theo
  đúng cách bài test hình dung thì nó đỏ; hỏng theo cách khác thì nó vẫn xanh.

### Ca `t23` — vì sao có tài liệu này

Ở Task 12 (Ruling T12-g) `t23-error-map.test.js` ra đời để chống đúng một loại lỗi: một
mã lỗi CSDL ném ra mà không có câu tiếng Việt nào dịch, khiến người dùng thấy "Lỗi hệ
thống" thay vì lý do thật.

Ở Task 13, **19 mã mới rơi đúng vào loại lỗi đó — và `t23` vẫn xanh.**

Lý do: nó so `core/errors.js` (bảng JS) với `web/js/api.js` (bảng JS). **Cả hai cùng
thiếu thì nó không thấy gì.** Nó canh *triệu chứng* (hai bảng lệch nhau) chứ không canh
*nguồn* (`RAISE EXCEPTION` trong SQL thật sự ném ra mã nào). Một cái lưới căng giữa hai
cái cột, mà cá bơi phía trên cả hai.

Đã sửa ở Ruling T13-c: giờ `t23` đọc thẳng `RAISE EXCEPTION '<MÃ>'` trong
`src/db/migrations/`. **Bài học: một bài test dựng để chống loại lỗi X vẫn có thể mù
trước chính X nếu nó đo sai đại lượng.**

### Ba dạng lỗ mù, dùng để nhận diện

| Dạng | Mô tả | Ca thật trong dự án |
|---|---|---|
| **Đo bản sao thay vì đo nguồn** | So hai bản sao của cùng một sự thật; cả hai cùng sai thì xanh | `t23` bản đầu (Ruling T13-c) |
| **Canh một CÁCH VIẾT thay vì canh HÀNH VI** | Quét mã nguồn tìm một chuỗi; ai làm cùng việc bằng cách viết khác thì lọt | Lưới "không xếp hạng" (Ruling T12-f) |
| **Canh HÌNH THỨC thay vì canh MỤC ĐÍCH** | Ràng buộc đúng hình dạng nhưng sai ý định | `NOT NULL` bắt ô trống, không bắt ô điền tên người khác (Ruling T13-b) |

Thêm hai dạng tài liệu này tìm ra và đặt tên:

| Dạng | Mô tả |
|---|---|
| **Miền lặp lấy từ chính mã đang kiểm** | `for (const f of FIELDS_IMPORT_TỪ_MÃ)` — ai xoá một phần tử khỏi `FIELDS` thì vòng lặp tự co lại và bài test vẫn xanh |
| **Khẳng định không thể đỏ** | Điều kiện tiền đề của bài test làm cho khẳng định luôn đúng bất kể mã ra sao (xem `t06`, mục 3) |

### Cách kiểm nhanh, dùng cho từng bài

*Cố nghĩ ra một cách phá luật mà bài test vẫn xanh.* Nghĩ ra được ⇒ canh triệu chứng.
Không nghĩ ra được sau khi đã thật sự cố ⇒ ghi **"chưa nghĩ ra đường lách"**, **đừng
ghi "canh nguồn" chỉ vì bí**.

### Năm nguyên tắc (để nói lỗ mù nào che nguyên tắc nào)

| # | Nguyên tắc | Cưỡng chế ở đâu |
|---|---|---|
| 1 | Không ai vào cộng đồng mà không có người bảo lãnh; hạn mức bảo lãnh có thật | `trg_member_status_gate`, `fn_guarantee_quota`, `REFERRER_REQUIRED` |
| 2 | Quan hệ chỉ tồn tại khi **cả hai bên** xác nhận; cạnh do trigger sinh, không do ứng dụng ghi | `member_relations` + `trg_work_confirm`, `trg_work_participants_frozen` |
| 3 | Việc lớn cần **hai chữ ký**, và gỡ chữ ký không làm nó thành một chữ ký | `trg_fund_two_approvers`, `fund_entries.locked`, khung `pending_actions` |
| 4 | Dữ liệu cá nhân chỉ lộ đúng người, đúng lúc, có nhật ký; nhật ký bất biến và **không** chứa dữ liệu cá nhân | `member_contacts` + `REVOKE ALL`, `contact_read`, `fn_privacy_state`, chuỗi băm `audit_log`, `assertSafeDetail` |
| 5 | Nền tảng **không** xếp hạng con người; trao đổi thật diễn ra ngoài nền tảng | Không có `ORDER BY confirmed_works/tier`; `manual` phải có approver + hạn mức cặp |

---

## 2. Bảng đầy đủ

Ký hiệu cột "canh gì": **N** = nguồn · **T** = triệu chứng · **N/T** = canh nguồn cho
tuyên bố chính nhưng có một khẳng định phụ canh triệu chứng.

### `t00-health.test.js` (3 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `trả 200 và ok=true khi DB sống` | `/health` gọi `knex.raw('select 1')` thật, trả 200 | **N** | Chưa nghĩ ra đường lách cho tuyên bố hẹp này. Nó **không** canh nhánh 503 — gỡ `res.status(db ? 200 : 503)` thành `res.status(200)` cứng vẫn xanh, vì không bài nào dựng kịch bản DB chết. |
| `migration phản ánh đúng số lượng và tên migration đã áp dụng thật` | So `/health` với **danh sách file thật trên đĩa** (`readdirSync`) | **N** | Hai bản sao vẫn có thể cùng lệch khỏi *thực tế đã chạy*: nếu `/health` đổi sang cũng đọc `readdirSync` thay vì `knex_migrations`, bài này xanh y hệt trong khi `/health` lại nói dối đúng kiểu Ruling T1-a. Nó so **đĩa ↔ endpoint**, không so **đĩa ↔ bảng `knex_migrations`**. |
| `migration = null khi app_role không đọc được knex_migrations` | `REVOKE SELECT` thật rồi gọi endpoint thật | **N** | Chưa nghĩ ra đường lách. Đây là mẫu tốt: nó **ép nhánh `catch` chạy thật** thay vì tin rằng nó tồn tại. |

### `t02-role-password.test.js` (1 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `migration 002 tạo role thành công, không ném "Expected N bindings"` | Đặt mật khẩu chứa `?`/`??`, chạy migration thật, rồi **mở kết nối TCP thật bằng chính mật khẩu đó** | **N** | Chưa nghĩ ra đường lách. Mẫu tốt nhất trong nhóm này: nó không kiểm "lệnh SQL trông đúng chưa" mà kiểm **kết quả cuối cùng ai đó thật sự dùng** (đăng nhập được). Ghi chú: URL kết nối cứng `localhost:55432/nhachung_test` thay vì suy từ `OWNER_URL` — sẽ hỏng lặng lẽ nếu đổi cổng CSDL test. |

### `t03-no-phone-in-members.test.js` (3 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `bảng members không có cột liên hệ nào` | `information_schema.columns` không chứa 4 **tên** cột: `phone/zalo/messenger/address` | **T** | **Danh sách CẤM bốn tên.** Thêm `members.so_dien_thoai`, `members.phone_number`, `members.contact_phone`, `members.mobile`, `members.lien_he jsonb` ⇒ **vẫn xanh**. Đây đúng dạng "canh HÌNH THỨC thay vì canh MỤC ĐÍCH". Đặc tả mục 13 (T3) còn đòi *"duyệt cả 5 vai"* — bài này chạy bằng **một** vai (owner) và không lặp vai nào. |
| `app_role không SELECT được member_contacts` | Chạy `SELECT` thật bằng kết nối `app_role` thật | **N** | Chưa nghĩ ra đường lách cho câu này. Nhưng nó chỉ chứng minh **một** cửa đã khoá: một `VIEW`/hàm `SECURITY DEFINER` mới đọc hộ `member_contacts` sẽ không đụng bài này. (Bài "mọi bảng **và view** phải khai trong `expected-grants.json`" ở `t10-grants` bịt một phần lỗ đó.) |
| `app_role không INSERT được member_contacts` | `INSERT` thật bằng `app_role` | **N** | Như trên. Không canh `UPDATE`/`DELETE` — nhưng `t10-grants` so **toàn bộ** ma trận quyền nên chỗ đó có lưới khác. |

### `t04-denied-still-logged.test.js` (1 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `trả allowed=false và ghi contact.denied` | Gọi `contact_read` thật qua `withActor`, **sau khi commit** đọc lại `audit_log` | **N/T** | Phần "vẫn để lại dấu" canh nguồn chắc chắn (đọc lại sau commit — đúng bẫy mục 3). Phần "không ghi giá trị" canh triệu chứng: `expect(rows[0].detail.phone).toBeUndefined()` chỉ soi **đúng một khoá tên `phone`, trên đúng hàng đầu tiên**. Nếu `contact_read` ghi `detail = {"field":"phone","value":"0912000000"}` thì **vẫn xanh** — và `assertSafeDetail` **không** chắn được vì hàm SQL `SECURITY DEFINER` dựng `detail` thẳng trong SQL, không đi qua `core/audit.js`. |

### `t05-contact-read-branches.test.js` (8 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `chủ hồ sơ tự xem trường của chính mình` | Gọi hàm CSDL thật, `toEqual` chính xác cả `{allowed,value,reason}` lẫn `detail` | **N** | Chưa nghĩ ra đường lách trong phạm vi nhánh này. |
| `mức public: người khác đọc được ngay` | Như trên | **N** | Chưa nghĩ ra đường lách. |
| `mức on_consent với contact_requests đã approved: đọc được` | Như trên | **N** | Đơn `approved` được chèn **không kèm `expires_at`/`revoked_at`** — nếu về sau thêm cơ chế hết hạn đồng ý, bài này không canh. Nhỏ. |
| `mức on_consent, chưa từng xin: NEEDS_CONSENT` | Như trên | **N** | Chưa nghĩ ra đường lách. |
| `mức on_consent, đơn đã bị denied: vẫn NEEDS_CONSENT` | Như trên, và cố ý khoá lại quyết định "không rò việc từng bị từ chối" | **N** | Chưa nghĩ ra đường lách. Mẫu tốt: nó khoá một **quyết định thiết kế** kèm lý do trong comment, để người sau không "sửa" ngược. |
| `NO_ACTOR: gọi contact_read ngoài withActor()` | Pool `app_role` mới toanh, chưa từng `set_config` | **N** | Phụ thuộc ngầm: nếu pool này lỡ tái dùng một kết nối đã chạy `set_config` ở bài khác thì đỏ giả (không phải xanh giả). An toàn theo hướng đúng. |
| `BAD_FIELD: tên trường ngoài danh sách trắng` | Gọi thật với `'job'` | **N** | Nó chứng minh `'job'` bị chặn, **không** chứng minh danh sách trắng được kiểm **trước** `format('%I')` — tức không canh được đường tiêm SQL qua `field`. Một `field` = `'phone"; DROP...'` sẽ ném `BAD_FIELD` hay ném lỗi cú pháp thì bài này không phân biệt. |
| `NO_TARGET: member không tồn tại` | Gọi thật với uuid rỗng | **N** | Không canh nhánh "khác cộng đồng cũng phải ra `NO_TARGET`" (Ruling T10-a) — chỗ đó do `t13-contact-read-survives` canh. |

### `t06-envelope.test.js` (3 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `trả đúng bao bì cho nhiều người trong một lần gọi` | Gọi `contactStates()` thật qua CSDL, khẳng định `level`/`requestStatus`/`state` cho 6 tổ hợp | **N** | `toMatchObject` là so **tập con** — thêm một khoá rò rỉ vào bao bì (vd. `phone_raw`) thì vẫn xanh. |
| `không sinh lời gọi contact_read nào` | **Gián tiếp**: đếm số dòng `audit_log` trước/sau | **T** | Đã ghi là "minor deferred" từ Task 6, nhưng đường lách cụ thể là: `contactStates()` đọc thẳng `member_contacts` bằng một hàm `SECURITY DEFINER` **không ghi log** ⇒ số dòng `audit_log` không đổi ⇒ **vẫn xanh**, trong khi bài toán N+1 và lỗ rò đều quay lại. Nó đếm *triệu chứng* (dòng nhật ký) chứ không đếm *nguồn* (số câu SQL / bảng bị chạm). |
| `duyệt đủ sáu trạng thái: value === null ở mọi trạng thái` | Sáu `state` + vòng lặp cuối khẳng định `value === null` cho `CONTACT_FIELDS` | **T** — **xem mục 3, hạng 1** | **Khẳng định không thể đỏ.** `envelope(stateForMember, values = {})` được gọi **không truyền `values`**, mà thân hàm là `value: allowed ? (values[field] ?? null) : null`. Với `values = {}` thì **cả hai nhánh đều ra `null`** — nên vòng lặp cuối xanh **bất kể `FIELD_SPEC` nói gì**. Đường lách: đổi `phone: { inline: false }` thành `{ inline: true }` (đúng cái cổng duy nhất chặn rò 20 số điện thoại một trang) ⇒ **cả ba bài t06 vẫn xanh**. Vòng lặp còn lấy miền từ `CONTACT_FIELDS` **import từ chính mã đang kiểm** — chuyển `phone` sang `PROFILE_FIELDS` thì vòng lặp tự co lại và cũng không đỏ. |

### `t07-audit-chain.test.js` (4 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `chuỗi liên mạch khi chưa ai đụng vào` | `verifyChain` thật trên 5 hàng thật | **N** | Chưa nghĩ ra đường lách cho câu "chuỗi lành thì báo lành". |
| `sửa một dòng giữa chuỗi thì phát hiện được` | Vai **owner** sửa thật cột `action` rồi `verifyChain` | **N/T** | Canh nguồn cho **một** cột. Digest (migration 007) gồm `prev_hash, actor_id, action, target_type, target_id, at` — **`detail`, `community_id`, `ip` KHÔNG nằm trong băm**. `UPDATE audit_log SET detail = '{}'` là **vô hình** với `verifyChain`, và **không bài nào phát hiện**. Thêm nữa: công thức digest tồn tại **hai bản sao** — trigger trong `007` và câu SQL trong `core/audit.js::verifyChain`. Sửa **cùng lúc cả hai** (vd. bỏ `target_id`) ⇒ chuỗi vẫn "lành", bài này vẫn xanh, mà giả mạo `target_id` thành vô hình. Đúng khuôn `t23` bản đầu. |
| `logDenied ghi được dòng dù giao dịch chính vừa rollback` | Rollback thật rồi gọi `logDenied` thật | **T** | Đã ghi "minor deferred" ở Task 4; đường lách cụ thể: bài này gọi `logDenied` **sau khi** giao dịch kia đã kết thúc, tức nó không tái hiện hình dạng nguy hiểm (ghi-log-**rồi**-raise trong **cùng** giao dịch). Sửa `logDenied` thành nhận `trx` của người gọi và ghi trong đó ⇒ **vẫn xanh**, trong khi mọi lượt từ chối thật lại bị rollback xoá sạch. |
| `errorHandler ghi được dòng từ chối thật với mã UPPER_SNAKE_CASE` | Gọi `errorHandler` thật, không mock `audit.js`, chờ dòng thật xuất hiện trong CSDL | **N** | Chưa nghĩ ra đường lách. Mẫu tốt: nó bắt được đúng loại lỗi "lời gọi bị `.catch()` nuốt im lặng" mà đọc mã không thấy. |
</content>
</invoke>
