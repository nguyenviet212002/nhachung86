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
| `duyệt đủ sáu trạng thái: value === null ở mọi trạng thái` | Sáu `state` + vòng lặp cuối khẳng định `value === null` cho `CONTACT_FIELDS` | **T** | **Khẳng định không thể đỏ.** `envelope(stateForMember, values = {})` được gọi **không truyền `values`**, mà thân hàm là `value: allowed ? (values[field] ?? null) : null`. Với `values = {}` thì **cả hai nhánh đều ra `null`** — nên vòng lặp cuối xanh **bất kể `FIELD_SPEC` nói gì**. Đổi `phone: { inline: false }` thành `{ inline: true }` (đúng cái cổng chặn rò 20 số điện thoại một trang) ⇒ **cả ba bài t06 vẫn xanh**. Vòng lặp còn lấy miền từ `CONTACT_FIELDS` **import từ chính mã đang kiểm** — chuyển `phone` sang `PROFILE_FIELDS` thì vòng lặp tự co lại và cũng không đỏ.<br>**Đính chính khi soát tới Task 13:** cổng `inline` **có** một lưới ở chỗ khác — `t13-privacy-eight-fields` bài *"envelope() không cho giá trị liên hệ đi kèm dù người gọi cố truyền vào"* truyền thẳng `{ phone: '0912000002' }` vào và khẳng định `env.phone.value === null`. Đó là bài **duy nhất** trong cả bộ ép được nhánh `allowed === true` trên một trường liên hệ. Nên lỗ mù thật của t06 hẹp hơn tôi viết ban đầu: **bài t06 không canh được điều nó tuyên bố**, nhưng dự án không mù trước lỗi đó. Vẫn nên sửa, vì một bài mang tên *"value luôn null"* mà không thể đỏ chính là thứ dập tắt câu hỏi. |

### `t07-audit-chain.test.js` (4 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `chuỗi liên mạch khi chưa ai đụng vào` | `verifyChain` thật trên 5 hàng thật | **N** | Chưa nghĩ ra đường lách cho câu "chuỗi lành thì báo lành". |
| `sửa một dòng giữa chuỗi thì phát hiện được` | Vai **owner** sửa thật cột `action` rồi `verifyChain` | **N/T** | Canh nguồn cho **một** cột. Digest (migration 007) gồm `prev_hash, actor_id, action, target_type, target_id, at` — **`detail`, `community_id`, `ip` KHÔNG nằm trong băm**. `UPDATE audit_log SET detail = '{}'` là **vô hình** với `verifyChain`, và **không bài nào phát hiện**. Thêm nữa: công thức digest tồn tại **hai bản sao** — trigger trong `007` và câu SQL trong `core/audit.js::verifyChain`. Sửa **cùng lúc cả hai** (vd. bỏ `target_id`) ⇒ chuỗi vẫn "lành", bài này vẫn xanh, mà giả mạo `target_id` thành vô hình. Đúng khuôn `t23` bản đầu. |
| `logDenied ghi được dòng dù giao dịch chính vừa rollback` | Rollback thật rồi gọi `logDenied` thật | **T** | Đã ghi "minor deferred" ở Task 4; đường lách cụ thể: bài này gọi `logDenied` **sau khi** giao dịch kia đã kết thúc, tức nó không tái hiện hình dạng nguy hiểm (ghi-log-**rồi**-raise trong **cùng** giao dịch). Sửa `logDenied` thành nhận `trx` của người gọi và ghi trong đó ⇒ **vẫn xanh**, trong khi mọi lượt từ chối thật lại bị rollback xoá sạch. |
| `errorHandler ghi được dòng từ chối thật với mã UPPER_SNAKE_CASE` | Gọi `errorHandler` thật, không mock `audit.js`, chờ dòng thật xuất hiện trong CSDL | **N** | Chưa nghĩ ra đường lách. Mẫu tốt: nó bắt được đúng loại lỗi "lời gọi bị `.catch()` nuốt im lặng" mà đọc mã không thấy. |

### `t08-guarantee-quota.test.js` (26 bài)

Tệp mạnh nhất của bộ về mặt canh nguồn: gần như mọi bài đều **chạy SQL thật và để CSDL
tự từ chối**, chứ không kiểm rằng service có gọi đúng hàm.

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `đơn thứ tư trong 12 tháng bị chặn` | `INSERT` thật ⇒ trigger ném | **N** | Chưa nghĩ ra đường lách. |
| `cửa sổ là 12 THÁNG TRƯỢT: ba đơn của 11 tháng trước vẫn chặn` | Gieo `now() - interval '11 months'` — **dữ liệu duy nhất phân biệt** "12 tháng trượt" với "mỗi năm dương lịch" | **N** | **Phụ thuộc ngày chạy.** Comment tự khai lập luận đúng "vì hôm nay là tháng 8". Chạy suite vào tháng 1–2 thì `now() - 11 months` rơi vào **cùng** năm dương lịch, và bài này không còn phân biệt được hai luật — nó vẫn xanh với luật sai. Lỗ mù có **hẹn giờ**. |
| `đơn cũ hơn 12 tháng thì rơi ra khỏi cửa sổ` | `13 months` thật | **N** | Chưa nghĩ ra đường lách. |
| `hai giao dịch ĐỒNG THỜI cùng tranh suất cuối` | Điểm đồng bộ **quan sát được từ máy chủ** (`pg_locks … NOT granted`) | **N** | Mẫu tốt nhất dự án cho bài đồng thời (Ruling T8-a). Điểm yếu còn lại: `pg_locks` được đếm **toàn cụm**, không lọc theo khoá của chính bài này — một khoá tư vấn đang chờ ở tệp khác sẽ làm `blocked = true` sai. Hiện `fileParallelism: false` nên không xảy ra; ai bật song song lên thì bài này thành xanh giả trở lại. |
| `lách bằng draft rồi đẩy lên pending cũng bị chặn` | `UPDATE … status` thật | **N** | Chưa nghĩ ra đường lách. |
| `rejected thường TRẢ LẠI suất` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `rejected vì referrer_misrepresented thì KHÔNG trả lại suất` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `referrer_id IS NULL ⇒ REFERRER_REQUIRED` | Thật | **N** | Chưa nghĩ ra đường lách (nguyên tắc 1). |
| `guarantee_quota_overrides nới đúng số suất, hết hiệu lực theo valid_until` | Thật, ba giai đoạn | **N** | Chưa nghĩ ra đường lách. |
| `đơn của cộng đồng này không trỏ được người bảo lãnh sang cộng đồng khác` | `INSERT` thật | **N/T** | Khẳng định `toThrow(/jr_referrer_same_community\|violates foreign key/i)` — **nhánh thứ hai là mẫu rộng**. Đổi khoá ghép về đơn cột mà câu vẫn hỏng vì **một** khoá ngoại khác (vd. `community_id`) ⇒ vẫn xanh. Đúng loại lỗi đã bị sửa ở `t13-signature-removal`. |
| `hạn mức đọc từ communities.config, không phải hằng số trong mã` | Đổi `config` thật rồi thử | **N** | Chưa nghĩ ra đường lách. Mẫu tốt: phân biệt được "đọc cấu hình" với "hằng số tình cờ bằng 3". |
| `members.status=member khi chưa có xác nhận gặp mặt ⇒ hỏng lúc COMMIT` | Dạng **callback** `db.transaction(...)`, còn khẳng định `insertResolved === true` để chứng minh hỏng đúng ở COMMIT | **N** | Chưa nghĩ ra đường lách. Ruling C11 được thi công đúng. |
| `đặt join_requests.member_id trong CÙNG giao dịch thì COMMIT qua được` | Thật | **N** | Đối chứng cho bài trên — không có nó thì bài trên xanh cả khi trigger chặn **mọi** lượt. |
| `đổi referrer_id của một hàng status=member ⇒ REFERRER_FROZEN` | Thật, kèm đối chứng `guest` vẫn đổi được | **N** | Chưa nghĩ ra đường lách. |
| `nộp đơn hợp lệ: trả join_request_id + step, ghi join_request.created` | Qua HTTP thật (supertest), đọc `audit_log` thật | **N** | `expect(JSON.stringify(detail)).not.toContain(phone)` là **danh sách cấm một chuỗi**: ghi số đã băm/đảo/cắt vào `detail` thì vẫn xanh. Nhỏ, vì `assertSafeDetail` chắn phía sau. |
| `otp_token không dùng lại được cho đơn thứ hai` | HTTP thật, hai lần | **N** | Chưa nghĩ ra đường lách. |
| `ba nhánh hỏng trả CÙNG mã, CÙNG câu, cùng sàn thời gian` | HTTP thật ×3; khẳng định theo hằng số `REGISTER_MIN_MS` **xuất từ mã**, không chép số | **N/T** | Đo **sàn**, không đo **phương sai**. Nếu một nhánh chậm hơn hẳn sàn (đúng thứ Ruling T8-b lo), cả ba vẫn `>= REGISTER_MIN_MS` ⇒ xanh. Đường lách: làm nhánh 3 mất 2000ms ⇒ vẫn xanh, mà kẻ dò lại phân biệt được ba nhánh bằng đồng hồ. Chênh lệch **giữa** các nhánh không hề được khẳng định. |
| `sai năm sinh thì báo đúng lỗi đó và KHÔNG tiêu vé OTP` | HTTP thật, dùng lại vé | **N** | Chưa nghĩ ra đường lách. |
| `danh sách: approver xem được, member thường thì không` | HTTP thật ×2 vai + đếm dòng nhật ký | **N** | Chưa nghĩ ra đường lách. |
| `applicant_data không bao giờ rời máy chủ nguyên vẹn` | Kiểm lớp lọc **kèm bằng chứng đối chứng** rằng dữ liệu thô đang thật sự nằm trong CSDL | **N** | Mẫu rất tốt: `not.toContain` một mình là danh sách cấm, nhưng bài này **chứng minh cột nguồn không rỗng** nên `not.toContain` mới có sức nặng. Đúng cách vá dạng "kiểm một cột rỗng rồi tưởng đã kiểm lớp lọc". |
| `người lạ không xem được đơn của người khác` | HTTP thật | **N** | Chưa nghĩ ra đường lách. |
| `confirm-met bởi người KHÔNG phải người bảo lãnh ⇒ từ chối + nhật ký` | HTTP thật, `waitForRow` nhắm **đúng** action | **N** | Comment tự nêu và tự tránh bẫy "lọc rộng làm `waitForRow` vô dụng". Mẫu tốt. |
| `confirm-met bởi đúng người bảo lãnh ⇒ met_confirmed + nhật ký` | HTTP thật, đọc cột thật | **N** | `not.toContain('nha van hoa')` lại là danh sách cấm một chuỗi. Nhỏ. |
| `ghi chú ngắn hơn 20 ký tự bị chặn ngay ở zod` | HTTP thật | **N** | Chưa nghĩ ra đường lách. |
| `reject: approver ghi reason_code; member thường bị chặn` | HTTP thật ×2 vai | **N** | Chưa nghĩ ra đường lách. |
| `approve đơn đã bị từ chối ⇒ 422, không tạo thành viên` | HTTP thật + đếm `members` trước/sau | **N** | Chưa nghĩ ra đường lách. |

### `t10-grants.test.js` (3 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `mọi bảng và view public đều có mặt trong expected-grants.json` | Duyệt `pg_class` thật ⇒ bảng/view mới **bắt buộc phải khai** | **N** | Mẫu rất tốt: biến "quên khai" thành đỏ. Lỗ mù còn lại: chỉ đếm `relkind IN ('r','p','v')` — **`m` (materialized view) và `f` (foreign table) không nằm trong danh sách**, nên một matview đọc `member_contacts` sẽ không bị ai đếm. |
| `quyền thực tế khớp khai báo — kể cả phân mảnh` | So `information_schema.table_privileges` **thật** với JSON khai báo | **N/T** | Chỉ soi `grantee = 'app_role'`. Quyền cấp cho **`PUBLIC`** (mà `app_role` hưởng theo) là **vô hình**: `GRANT SELECT ON member_contacts TO PUBLIC` ⇒ **vẫn xanh**, trong khi `app_role` đọc được số điện thoại. Cũng bỏ qua quyền cấp theo **cột** (`GRANT SELECT (phone) ON …`) vì thứ đó nằm ở `column_privileges`, không ở `table_privileges`. Hai đường lách này đi thẳng vào nguyên tắc 4. |
| `mọi phân mảnh audit_log cũng chỉ có SELECT, INSERT` | Duyệt `pg_inherits` thật, có `expect(rows.length).toBeGreaterThan(0)` chống vòng lặp rỗng | **N/T** | Cùng lỗ `PUBLIC` như trên. |

### `t11-audit-detail.test.js` (20 bài: 3 bài đơn + 15 ca `it.each` + 2 bài biên)

Bài này bị nghi sẵn trong đề bài. Kết luận: **nó canh nguồn cho đúng thứ nó đo (hình
dạng CHỮ SỐ), nhưng thứ nó đo chỉ là một góc của điều nó tuyên bố** ("`detail` không
chứa dữ liệu cá nhân"). Ba đường lách dưới đây **đã kiểm bằng chạy thật**, không suy đoán.

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `chấp nhận tên trường, uuid, số đếm, HMAC` | `assertSafeDetail` thật | **N** | — |
| `từ chối số điện thoại thô` | thật | **N** | — |
| `từ chối câu văn tự do` | thật | **N** | Câu thử có **khoảng trắng và dấu tiếng Việt** — nó không chứng minh được gì về văn tự do **không dấu, không khoảng trắng** (hàng cuối bảng). |
| `cho qua: …` (8 ca `it.each`) | thật | **N** | — |
| `từ chối: …` (7 ca `it.each`) | thật | **N** | — |
| `uuid vẫn được chấp nhận dù toàn chữ số + gạch ngang` | thật, khoá **thứ tự nhánh** trong `z.union` | **N** | Mẫu tốt: canh thứ tự nhánh, không chỉ kết quả. |
| `băm HMAC-SHA256 64 hex vẫn được chấp nhận` | thật | **N** | — |
| **Cả tệp, xét theo tuyên bố "detail không chứa dữ liệu cá nhân"** | — | **T** | **Ba đường lách, đã chạy thật, cả ba đều LỌT:**<br>1. **Khoá không bị kiểm gì cả.** `detailSchema = z.record(<value>)` chỉ ràng buộc *giá trị*; `assertSafeDetail({ '0912345678': true })` **qua**.<br>2. **Số kiểu `number` không bị kiểm.** Nhánh `z.number()` nhận mọi số: `{ phone: 912345678 }` và `{ v: 123456789012 }` **qua** — và `parseInt(phone)` là đúng thứ một lập trình viên vô ý sẽ viết.<br>3. **Chuỗi chữ không có chữ số vẫn là văn tự do.** `{ v: 'NguyenVanA' }`, `{ v: 'so-12-ngo-4-Khoai-Chau' }` **qua** — họ tên và địa chỉ viết không dấu, không khoảng trắng đi thẳng vào nhật ký. Đúng đường lách đề bài dự đoán: `regex` chỉ khoá **tập ký tự**, và mọi định danh cá nhân **không phải dạng số** nằm gọn trong tập đó. |

### `t10-directory.test.js` (28 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `mọi trường của mọi người trong trang đều có value === null` | `members.list()` thật; có đối chứng `fieldCount === data.length * 4` | **N/T** | Đối chứng `×4` là mẫu tốt (chống vòng lặp rỗng, khoá luôn kích thước `CONTACT_FIELDS`). Nhưng **cổng thật — cờ `inline` trong `FIELD_SPEC` — không bị bài này chạm**: `profileValues()` không mang `phone`, nên đặt `phone: { inline: true }` thì `values['phone'] ?? null` vẫn ra `null` ⇒ xanh. Cổng đó **có** lưới, nhưng ở đúng **một bài duy nhất trong cả bộ**: `t13-privacy-eight-fields` → *"envelope() không cho giá trị liên hệ đi kèm dù người gọi cố truyền vào"*. |
| `có ít nhất một trường state="visible" — và nó vẫn value null` | Thật, có đối chứng `visible.length > 0` | **N** | Cùng lỗ `inline`; ngoài ra chưa nghĩ ra đường lách. |
| `hồ sơ chi tiết cũng không trả value, và không trả email/lat/lng/password_hash` | Thật, **khoá danh sách khoá bằng `toEqual`**, không phải `toMatchObject` | **N** | Mẫu rất tốt — `toEqual` trên `Object.keys().sort()` biến "thêm một trường ra vỏ" thành đỏ, tức bịt đúng lỗ Ruling T9-e ở tầng service. |
| `phone mức on_consent chưa xin: CONTACT_NEEDS_CONSENT và dòng contact.denied SỐNG SÓT` | Đếm `contact.denied` trước/sau **quanh một lời gọi ném lỗi** | **N** | Chưa nghĩ ra đường lách. Đây là bài canh bẫy mục 3 (Ruling T10-b) **đúng hình dạng nguy hiểm** — khác hẳn bài cùng tên ý ở `t07`. |
| `address mức closed: CONTACT_CLOSED và dòng contact.denied cũng sống sót` | Như trên | **N** | Chưa nghĩ ra đường lách. |
| `được phép đọc: trả giá trị thật và ghi contact.read` | Thật, `toEqual({value:'0912000002'})` | **N** | Chưa nghĩ ra đường lách. |
| `tự đọc liên hệ của chính mình luôn được` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `không có người của cộng đồng khác trong danh sách, dù trùng nghề` | Thật, gieo Eve **trùng nghề** để bộ lọc không tự loại giùm | **N** | Chưa nghĩ ra đường lách. |
| `lọc theo area_id chỉ trả người của đúng khu vực đó` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `area_id của cộng đồng khác trả 0 người, không trả Eve` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `lọc theo status: guest tách khỏi member` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `KHÔNG khai status thì mặc định chỉ trả member` | Thật, kèm đối chứng "khai rõ thì vẫn xem được" | **N** | Không phủ `left` — chỉ phủ `guest`. Ruling T10-d nêu cả hai; luồng "rời cộng đồng" chưa tồn tại nên đây là nợ chứ chưa phải lỗ. |
| `lọc theo work_status` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `q tìm theo tên, bỏ dấu` | Thật | **T** | Dữ liệu thử là `'carol'` — **không có dấu tiếng Việt nào**. Gỡ `unaccent`/`lower` ra thì bài vẫn xanh. **Bài test sai tên** (cùng loại Ruling T7-b): nó hứa canh "bỏ dấu" mà không có dữ liệu nào chạm tới dấu. |
| `ký tự đại diện của LIKE do người dùng gõ bị thoát` | Thật, `job: '%'` ⇒ rỗng | **N** | Không thử `_` (đại diện một ký tự) dù `likeLiteral` thoát cả hai — nửa cơ chế không có lưới. |
| `phân trang: hai trang rời nhau, tổng đúng kể cả khi trang vượt cuối` | Thật, 4 khẳng định độc lập | **N** | Chưa nghĩ ra đường lách. |
| `readContactField với người của cộng đồng khác trả NOT_FOUND` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `contact_read (tầng CSDL) tự chặn, không dựa vào service` | Gọi **thẳng hàm CSDL**, bỏ qua service | **N** | Mẫu tốt nhất cho câu "CSDL chặn, không phải service chặn": nó cố ý đi vòng qua đúng lớp mà nó không muốn phải tin. |
| `contactStates() lọc community_id, không chỉ lọc theo danh sách id` | Thật, **kèm đối chứng** với đúng cộng đồng | **N** | Mẫu tốt: đối chứng chứng minh bài trên đỏ vì bộ lọc chứ không vì dữ liệu rỗng — đúng kỷ luật Ruling T8-a. |
| `contactStates() từ chối chạy khi thiếu communityId` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `GET hồ sơ người của cộng đồng khác trả NOT_FOUND` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `mở một trang 12 người sinh đúng MỘT dòng member.list` | Đếm thật | **N** | Chưa nghĩ ra đường lách. |
| `mở một trang KHÔNG sinh dòng contact.read/contact.denied nào` | Đếm **dòng nhật ký** trước/sau | **T** | Cùng lỗ với `t06`: đếm *nhật ký*, không đếm *số câu SQL / bảng bị chạm*. Một đường đọc `member_contacts` **không ghi log** (hàm `SECURITY DEFINER` mới) làm cả hai con số đứng im ⇒ xanh, trong khi N+1 và lỗ rò đều quay lại. |
| `detail của member.list chỉ chứa số đếm/bộ lọc, KHÔNG chứa chuỗi tìm kiếm` | Thật, `has_q`/`has_job` + `not.toContain` chuỗi người gõ | **N** | Chưa nghĩ ra đường lách đáng kể. |
| `xem hồ sơ người khác ghi một hàng profile_views và một dòng profile.view` | Đếm thật | **N** | Chưa nghĩ ra đường lách. |
| `tự xem hồ sơ mình KHÔNG ghi profile_views (nhưng vẫn ghi nhật ký)` | Đếm thật | **N** | Chưa nghĩ ra đường lách. |
| `trả cây lồng nhau, không lẫn khu vực của cộng đồng khác` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `gọi được khi CHƯA đăng nhập — không có actor vẫn ra cây khu vực` | Thật, `actor: undefined` | **N** | **Không khẳng định `lat`/`lng` vắng mặt**, dù Ruling T11-d chốt rõ "`lat`/`lng` vẫn không ra tới client". Chỗ đó hiện **không có lưới nào**, và đây lại là endpoint **công khai**. |

### `t12-trust.test.js` (15 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `mỗi ngưỡng của mục 8.3 và mép ngay dưới nó` | `tierOf()` thật, 10 cặp gồm cả biên | **N** | Chưa nghĩ ra đường lách. Mẫu tốt: thử **mép dưới** mỗi bậc, không chỉ giữa khoảng. |
| `đầu vào bẩn rơi về bậc THẤP NHẤT chứ không ném lỗi` | Thật, 7 giá trị bẩn | **N** | Chưa nghĩ ra đường lách. Hướng thất bại chọn đúng (an toàn = bậc thấp). |
| `TIERS xếp tăng dần và có nhãn tiếng Việt` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `không migration nào chép lại tên bậc hay ngưỡng` | **Quét mã nguồn** migration tìm 5 chuỗi | **T** | Canh một **CÁCH VIẾT**. Ba đường lách: migration viết `CASE WHEN confirmed_works >= 100 THEN 'Kim Cương'` (nhãn tiếng Việt, không phải khoá); hoặc `THEN 4` (bậc dạng số); hoặc nhét ngưỡng vào `communities.config`. **Cả ba đều xanh**, trong khi ngưỡng đã có hai nơi quyết định — đúng thứ bài này nói nó chống. |
| `thiếu một chữ ký thì việc KHÔNG được tính` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `đủ chữ ký thì việc được tính cho MỌI người tham gia` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `manual CHƯA qua approver: vào manual_works, KHÔNG vào confirmed_works` | CSDL thật | **N** | Chưa nghĩ ra đường lách (nguyên tắc 5, lớp 1). |
| `approver duyệt xong thì con số đổi NGAY, không phải chờ tác vụ 03:15` | CSDL thật, **cố ý KHÔNG gọi `fn_trust_recount()` bằng tay** | **N** | Mẫu tốt: gọi tay là tự tạo ra điều kiện mà production không có. |
| `distinct_requesters / repeat_requesters đếm ĐÚNG CHIỀU` | CSDL thật, kiểm **cả hai chiều** | **N** | Chưa nghĩ ra đường lách. Bịt đúng Ruling C9 + T12-e. |
| `manual chưa duyệt cũng không đẻ ra distinct_requesters` | CSDL thật, kèm đối chứng sau khi duyệt | **N** | Chưa nghĩ ra đường lách. |
| `app_role không tự đặt được con số uy tín của mình` | `UPDATE` **và** `INSERT` thật bằng `app_role` | **N** | Không thử `DELETE` (xoá hàng thống kê để reset về 0). `t10-grants` phủ gián tiếp. |
| `không đếm chéo cộng đồng` | CSDL thật, kèm đối chứng đếm bằng 0 ở cộng đồng kia | **N** | Chưa nghĩ ra đường lách. |
| **`không truy vấn nào trong src/ xếp theo con số uy tín`** (lưới 1) | **Quét mã nguồn** `api/src/**` bằng `order\s+by[^;\n]*\b(confirmed_works\|…\|tier)\b` | **T** | Bốn đường lách — xem phân tích ngay dưới bảng. |
| **`danh bạ xếp theo TÊN, và số việc không lay chuyển được thứ tự đó`** (lưới 2) | Chạy `membersService.list()` **thật**: người 3 việc tên `Zz`, người 0 việc tên `Bb` — thứ tự theo tên **ngược** thứ tự theo số việc | **N** | Chỉ phủ đúng một hàm. Xem phân tích ngay dưới. |

#### Hai lưới "không xếp hạng" — lưới thứ hai bịt được gì, và chỗ CẢ HAI cùng mù

**Lưới 1 (quét mã) mù trước ít nhất bốn cách xếp hạng:**

1. **`.orderBy('confirmed_works', 'desc')`** — knex query builder. Regex đòi `order\s+by`
   (bắt buộc có khoảng trắng); `orderBy` viết liền **không khớp**. Knex là query builder
   của chính dự án này, nên đây là cách viết *tự nhiên nhất*, không phải cách viết lách.
2. **Xuống dòng.** Lớp `[^;\n]*` **không vượt qua ký tự xuống dòng**, mà SQL trong kho
   này gần như luôn viết nhiều dòng: `ORDER BY\n  mts.confirmed_works DESC` ⇒ lọt.
3. **Sắp trong JavaScript sau khi lấy dữ liệu** (`rows.sort((a,b) => b.confirmed_works - a.confirmed_works)`),
   hoặc **`ORDER BY` cột phái sinh / số thứ tự** (`… AS c … ORDER BY c`, `ORDER BY 3`).
4. **Sắp ở tầng frontend.** Gốc quét là `api/src` — **`web/js/` không hề được quét.**

**Lưới 2 (chạy thật) bịt được đường 2 và 3 — nhưng chỉ bên trong `membersService.list()`:**
bất kỳ cách xếp nào làm đổi thứ tự của đúng hàm đó đều làm `toEqual(['Aa…','Bb…','Zz…'])`
đỏ, bất kể được viết thế nào. Đó là giá trị thật của lưới thứ hai, và Ruling T12-f đúng
khi đòi nó — **nó không phải trang trí.**

**Chỗ CẢ HAI LƯỚI CÙNG MÙ:**

- **Tầng frontend.** `web/js/` không bị quét, và lưới 2 dừng ở tầng service. Sắp lại danh
  bạ theo `confirmed_works` trong trình duyệt **là** nền tảng đang xếp hạng con người —
  nguyên tắc 5 bị phá mà cả hai lưới đều xanh. Thứ duy nhất đang chặn thật sự là khẳng
  định `not.toContain('confirmed_works'…)` ở cuối lưới 2 (dữ liệu không ra tới client),
  và đó là **hệ quả phụ** của bài chứ không phải mục đích nó tuyên bố.
- **Mọi endpoint chưa tồn tại.** Lưới 2 theo định nghĩa chỉ soi hàm nó gọi. Lưới 1 lẽ ra
  phải bù đúng chỗ này — đó là lý do đặc tả T9 đòi một lưới quét mã — nhưng nó lại mù
  trước `.orderBy(...)` và trước xuống dòng, tức **đúng chỗ nó được dựng ra để bù thì nó
  không bù được**. Một `signals.list()` viết ngày mai bằng knex builder lọt qua **cả hai**.

### `t12-manual-quota.test.js` (14 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `sáu bản ghi qua được, bản thứ BẢY bị chặn ngay ở chữ ký đầu tiên` | CSDL thật + đối chứng "0 chữ ký trên bản thứ bảy" | **N** | Chưa nghĩ ra đường lách. |
| `cửa sổ là 12 THÁNG TRƯỢT: bản ghi cũ hơn 12 tháng trả lại suất` | `13 months` thật | **N/T** | **Không có bài đối xứng "11 tháng vẫn chặn"** như `t08` có. Cài nhầm luật "mỗi năm dương lịch" vào đây sẽ **không bị bắt** — bài chỉ chứng minh cửa sổ *có giới hạn*, không chứng minh giới hạn đó *trượt*. `t08` cho thấy đúng cách bịt. |
| `hạn mức đọc từ communities.config` | Đổi `config` thật | **N** | Chưa nghĩ ra đường lách. |
| `hạn mức tính theo CẶP, không theo người` | CSDL thật, kèm đối chứng cặp (x,z) | **N** | Chưa nghĩ ra đường lách. |
| `bản ghi BA NGƯỜI không lách được hạn mức của một cặp bên trong nó` | CSDL thật, **chọn id z sao cho cặp (min,max) khác cặp (x,y)** | **N** | Mẫu rất tốt: dựng đúng hình dạng dữ liệu mà lỗi Ruling T12-d cần để lộ ra, thay vì thử một bản ghi ba người bất kỳ. |
| `hai giao dịch ĐỒNG THỜI cùng tranh suất cuối` | `pg_locks` làm điểm đồng bộ | **N** | Cùng lỗ "pg_locks đếm toàn cụm" như `t08`. |
| `người ngoài cuộc dựng bản ghi manual ⇒ MANUAL_CREATOR_NOT_PARTICIPANT` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `luật đó CHỈ áp cho manual` | CSDL thật (đối chứng `signal`) | **N** | Chưa nghĩ ra đường lách. |
| `người duyệt phải mang vai approver ⇒ REVIEWER_NOT_APPROVER` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `approver của CỘNG ĐỒNG KHÁC không duyệt được` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `approver KHÔNG tự duyệt việc của chính mình` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `bản ghi manual không được SINH RA đã duyệt sẵn` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `approver hợp lệ, không tham gia việc ⇒ duyệt được` | CSDL thật | **N** | Đối chứng cần thiết — thiếu nó thì bốn bài trên xanh cả khi trigger chặn **mọi** lượt duyệt. |
| `reviewed_by và reviewed_at phải đi cùng nhau (wr_manual_review)` | CSDL thật, nêu **đích danh tên ràng buộc** | **N** | Chưa nghĩ ra đường lách. Mẫu tốt: khẳng định theo tên ràng buộc thật, không theo mẫu rộng. |

### `t12-work-edge.test.js` (20 bài)

Tệp canh nguyên tắc 2, và là một trong hai tệp **canh nguồn sạch nhất cả bộ**: mọi bài
đều để CSDL tự từ chối, không bài nào tin lời hứa của tầng service.

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `một bên xác nhận thì CHƯA có cạnh nào` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `bên thứ hai xác nhận thì cạnh xuất hiện, theo thứ tự chuẩn tắc a < b` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `ba người: thiếu MỘT người thì KHÔNG có cạnh nào, kể cả cạnh giữa hai người đã ký` | CSDL thật | **N** | Mẫu tốt: bắt đúng hình dạng "quan hệ suy diễn" mà bài hai-người không phân biệt được. |
| `một người tham gia duy nhất thì không sinh cạnh nào` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `cùng một cặp làm việc lần thứ hai: KHÔNG đẻ thêm cạnh` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `A xác nhận thay B ⇒ SELF_ONLY` | CSDL thật, qua `withActor` | **N** | Chưa nghĩ ra đường lách. |
| `xác nhận ngoài giao dịch có đóng dấu ⇒ NO_ACTOR` | `withActor(null)` ⇒ chuỗi rỗng, đúng hình dạng `nullif()` phải bắt | **N** | Phủ hình dạng "actor rỗng", **không** phủ hình dạng "biến chưa từng được đặt" — hai nhánh khác nhau của `current_setting(…, true)`. `t05` phủ nhánh còn lại, nên cả bộ vẫn kín. |
| `xác nhận một việc mình KHÔNG tham gia ⇒ khóa ngoại ghép chặn` | CSDL thật | **N/T** | Mẫu rộng `/work_confirmations_wr_member_fkey\|violates foreign key/i` — nhánh sau khớp **bất kỳ** lỗi khoá ngoại nào. Cùng loại lỗi đã bị sửa ở `t13-signature-removal`; ở đây vẫn còn. |
| `xác nhận HAI LẦN để ăn gian số việc ⇒ trùng khóa` | CSDL thật | **N/T** | Mẫu rộng `/duplicate key\|unique/i`, không nêu đích danh ràng buộc nào. |
| `sửa ngày/tên việc đã có xác nhận ⇒ WORK_RECORD_FROZEN` | CSDL thật, ba cột | **N** | Chưa nghĩ ra đường lách. |
| `nhưng reviewed_by/reviewed_at thì vẫn đặt được` | CSDL thật | **N** | Đối chứng cần thiết cho bài trên. |
| `chưa có xác nhận nào thì sửa thoải mái` | CSDL thật | **N** | Đối chứng cần thiết. |
| `app_role không XOÁ được bản ghi việc` | `app_role` thật | **N** | Chưa nghĩ ra đường lách. |
| `THÊM người tham gia sau khi mọi người đã ký ⇒ WORK_PARTICIPANTS_FROZEN` | CSDL thật + **đếm cạnh của z bằng 0** | **N** | Mẫu tốt: khẳng định cả *lệnh bị chặn* lẫn *hậu quả không xảy ra*. |
| `XOÁ người tham gia chưa ký ⇒ WORK_PARTICIPANTS_FROZEN` | CSDL thật, cả `DELETE` lẫn `UPDATE role` | **N** | Chưa nghĩ ra đường lách. |
| `trước xác nhận đầu tiên thì danh sách người tham gia vẫn sửa được` | CSDL thật | **N** | Đối chứng cần thiết. |
| `app_role INSERT thẳng vào member_relations ⇒ permission denied` | `app_role` thật | **N** | Chưa nghĩ ra đường lách. |
| `cạnh (B,A) khi đã có (A,B) ⇒ rel_canonical chặn` | CSDL thật, nêu **đích danh** tên ràng buộc | **N** | Chưa nghĩ ra đường lách. |
| `người tham gia của cộng đồng KHÁC không gắn được vào bản ghi việc` | CSDL thật | **N/T** | Mẫu rộng `/violates foreign key/i` — không nêu đích danh khoá ghép nào chặn. |
| `một việc của cộng đồng KHÁC sinh cạnh trong ĐÚNG cộng đồng đó` | CSDL thật + đối chứng đếm 0 | **N** | Chưa nghĩ ra đường lách. |

### `t13-contact-read-survives.test.js` (4 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `người xem ở cộng đồng A không đọc được BẤT KỲ trường nào của người ở cộng đồng B` | Chạy `contact_read` thật **sau khi áp đủ 29 migration**, duyệt cả bốn trường | **N** | Chưa nghĩ ra đường lách. Mẫu rất tốt: nó canh một **bản vá** chứ không canh một tính năng — `resetDb()` chạy tới tệp migration cuối cùng, nên mọi lần `CREATE OR REPLACE` về sau đều phải đi qua đây. |
| `vẫn dùng chung mã NO_TARGET với "không tồn tại"` | Thật | **N** | Chưa nghĩ ra đường lách. Nó khoá quyết định "không rò danh sách thành viên qua thông điệp lỗi". |
| `đối chứng: cùng lời gọi đó TRONG cùng cộng đồng thì đọc được` | Thật | **N** | Đối chứng bắt buộc, comment nói rõ vì sao. |
| `thân hàm contact_read đang chạy CÓ hai câu kiểm cộng đồng` | Đọc `pg_proc.prosrc` thật, khớp `/v_viewer_cid/` và `/IS DISTINCT FROM v_cid/` | **T** — **và tệp tự khai đúng như vậy** | Canh một **CÁCH VIẾT**. Đường lách: viết lại bằng `WHERE m.community_id = v_viewer_cid` (không có `IS DISTINCT FROM`), hoặc đổi tên biến thành `v_cid_nguoi_xem` ⇒ **đỏ dù mã đúng** (dương tính giả), hoặc giữ nguyên hai chuỗi đó trong một nhánh **không bao giờ chạy tới** ⇒ **xanh dù mã sai**. Comment của tệp đã tự nêu vai trò của nó ("lưới thứ hai, canh sự CÓ MẶT") — đây là cách khai báo trung thực đúng chuẩn, và ba bài trên mới là lưới chính. |

### `t13-no-anonymous.test.js` (12 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `điền tên người khác vào from_member_id ⇒ SELF_ONLY` | CSDL thật | **N** | Chưa nghĩ ra đường lách. Đây là ca **`NOT NULL` bắt ô trống, không bắt ô điền tên người khác** (Ruling T13-b) được vá và canh đúng chỗ. |
| `chuyển tiếp ngoài giao dịch có dấu người thực hiện ⇒ NO_ACTOR` | CSDL thật, kết nối chưa từng `set_config` | **N** | Chưa nghĩ ra đường lách. |
| `người CHƯA NHẬN tín hiệu không chuyển tiếp được nó` | CSDL thật | **N/T** | Mẫu rộng `/foreign key\|sig_fwd_from_recipient/i` — nhánh đầu khớp bất kỳ lỗi khoá ngoại nào. |
| `không chuyển tiếp cho chính mình` | CSDL thật, nêu **đích danh** `sig_fwd_not_self` | **N** | Chưa nghĩ ra đường lách. |
| `chuyển tiếp hợp lệ SINH RA một điểm nhận mới, và view thấy đủ` | CSDL thật + đọc `v_signal_recipients` | **N** | Đối chứng cần thiết cho bốn bài trên. `rows.every(r => r.response === null)` sẽ **xanh trên mảng rỗng** — nhưng `toContain(hoaNgoai)` ngay trên đã chứng minh mảng không rỗng, nên khe hở này đã đóng. |
| `chuyển tiếp không rút lại được — app_role không UPDATE/DELETE` | `app_role` thật | **N** | Chưa nghĩ ra đường lách. |
| `trả lời thay người khác ⇒ SELF_ONLY` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `người không nhận tín hiệu thì không trả lời được` | CSDL thật, **tự tạo người hoàn toàn mới** vì Hoà đã thành điểm nhận ở bài trên | **N/T** | Mẫu rộng `/foreign key\|sig_resp_recipient/i`. Nhưng phần chọn dữ liệu là mẫu tốt: comment nêu rõ vì sao không dùng lại người cũ — đúng thứ làm bài test "đỏ vì lý do khác". |
| `chính chủ trả lời thì được — bài trên không đỏ vì lý do sai` | CSDL thật | **N** | Đối chứng, và **tên bài nói thẳng nó là đối chứng**. Mẫu tốt. |
| `điền hộ người khác ⇒ SELF_ONLY` (aid slot) | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `tự nhận thì được` | CSDL thật | **N** | Đối chứng. |
| `người thứ hai vào suất chỉ cần 1 người ⇒ AID_SLOT_FULL` | CSDL thật | **N** | Không có bài "suất cần 2 thì người thứ hai vào được" — ngưỡng `needed` chỉ được thử ở đúng giá trị 1, nên cài `needed` thành hằng số 1 sẽ **không bị bắt**. Nhỏ vì `needed` là cột thật. |

### `t13-signature-removal.test.js` (11 bài)

Nguyên tắc 3. Comment đầu tệp tự nêu bẫy công cụ Ruling T8-g và **cả 11 bài dùng
dạng callback** — đó là chỗ dễ hỏng nhất và nó không hỏng.

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `DELETE bị từ chối ở tầng quyền` | `app_role` thật | **N** | Chưa nghĩ ra đường lách. |
| `UPDATE cũng bị từ chối — đổi approver_id là gỡ chữ ký bằng cách khác` | `app_role` thật | **N** | Chưa nghĩ ra đường lách. Mẫu tốt: nó nhận ra "gỡ chữ ký" có **hai** hình dạng. |
| `xoá một trong hai chữ ký ⇒ COMMIT hỏng với FUND_TWO_APPROVERS_REQUIRED` | Owner thật, dạng callback, **và đếm lại chữ ký sau rollback** | **N** | Mẫu rất tốt: *"Bắt được ngoại lệ mà dữ liệu vẫn hỏng thì ngoại lệ đó vô nghĩa."* Rất ít bài trong bộ khẳng định cả hai vế đó. |
| `xoá CẢ HAI chữ ký cũng hỏng` | Owner thật | **N** | Chưa nghĩ ra đường lách. |
| `đổi approver thành người KHÔNG có vai approver cũng hỏng` | Owner thật | **N** | Chưa nghĩ ra đường lách. |
| `thay MỘT approver bằng approver khác thì được` | Owner thật, và **tự dọn lại hiện trạng** | **N** | Đối chứng bắt buộc, comment nói đúng lý do. |
| `bút toán lớn với 1 chữ ký không COMMIT được` | Owner thật | **N** | Chưa nghĩ ra đường lách. |
| `người tạo tự ký không được tính` | Owner thật | **N** | Chưa nghĩ ra đường lách. |
| `người không có vai approver không được tính` | Owner thật | **N** | Chưa nghĩ ra đường lách. |
| `approver của CỘNG ĐỒNG KHÁC không ký được` | Owner thật, khẳng định **đích danh** `fund_entry_approvals_approver_id_community_id_fkey` | **N** | Mẫu tốt nhất bộ về "đừng dùng mẫu rộng": bản đầu khớp `/foreign key\|FUND_TWO/i` và đã bị sửa ở Task 13 vì nó xanh với **bất kỳ** lỗi khoá ngoại nào. Bảy chỗ khác trong bộ vẫn còn nguyên lỗi đó (xem xếp hạng). |
| `bút toán NHỎ không cần chữ ký nào — ngưỡng có thật` | Owner thật | **N** | Khẳng định chỉ là `toBeTruthy()` trên id trả về; không đọc lại hàng. Nhẹ nhưng đủ. |

### `t13-fund.test.js` (11 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `owner UPDATE bút toán đã khóa ⇒ FUND_ENTRY_LOCKED` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `owner DELETE bút toán đã khóa ⇒ FUND_ENTRY_LOCKED` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `không mở khóa lại được — locked là một chiều` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `không thêm được chữ ký vào bút toán đã khóa` | CSDL thật | **N** | Chưa nghĩ ra đường lách (chốt bảng A/B đúng chiều). |
| `app_role không xoá được bút toán nào, khóa hay chưa` | `app_role` thật, cả hai hàng | **N** | Chưa nghĩ ra đường lách. |
| `bút toán CHƯA khóa vẫn sửa được, và khóa được đúng một lần` | CSDL thật | **N** | Đối chứng bắt buộc, comment nói đúng lý do (thiếu nó thì năm bài trên xanh cả khi trigger cấm sạch mọi `UPDATE`). |
| `hoạt động dùng quỹ ĐẦU TIÊN mở được` | CSDL thật | **N/T** | Khẳng định chỉ là `toBeTruthy()` trên id; và nó **để lại trạng thái** (`cu`) cho ba bài sau — bài giòn theo thứ tự chạy, cùng loại "minor deferred" đã ghi ở Task 7 cho `t17`. |
| `hoạt động dùng quỹ thứ hai bị chặn khi món cũ chưa tổng kết` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `hoạt động KHÔNG dùng quỹ vẫn mở được` | CSDL thật | **N** | Đối chứng. |
| `nộp bản tổng kết xong thì mở được ngay` | CSDL thật | **N** | Đối chứng, và nó khoá luôn tính "ngay" (không chờ tác vụ nền). |
| `bản tổng kết không xoá được bằng app_role` | `app_role` thật | **N** | Chưa nghĩ ra đường lách. |

### `t13-guards-ab.test.js` (14 bài)

Khuôn "ràng buộc trên bảng A không chạy khi động vào bảng B" ở ba chỗ ngoài quỹ.
Toàn bộ dùng dạng callback và mọi khẳng định đều theo **tên mã lỗi đích danh**.

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `gỡ một chữ ký ⇒ COMMIT hỏng, và chữ ký vẫn còn` | CSDL thật, hai vế | **N** | Chưa nghĩ ra đường lách. |
| `thêm chữ ký thứ BA cũng hỏng — "đúng 2" chứ không phải "ít nhất 2"` | CSDL thật | **N** | Mẫu tốt: nó phân biệt hai luật rất dễ nhầm. |
| `người được bảo chứng không tự ký cho mình` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `bảo chứng mới với 1 chữ ký không thành active được` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `bản nháp thì không cần chữ ký nào — ngưỡng có thật` | CSDL thật | **N** | Đối chứng; khẳng định chỉ `toBeTruthy()` trên id. |
| `người trong ảnh đổi ý sang "no" ⇒ ảnh đã duyệt không đứng nữa` | CSDL thật | **N** | Chưa nghĩ ra đường lách. Đây là chỗ quyền **rút lại sự đồng ý** của Nghị định 13 được ép ở tầng dữ liệu. |
| `gắn thêm một người CHƯA trả lời vào ảnh đã duyệt cũng bị chặn` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `duyệt một ảnh mà có người chưa trả lời ⇒ bị chặn ngay ở bảng ảnh` | CSDL thật | **N** | Chưa nghĩ ra đường lách (chiều A). |
| `im lặng KHÔNG phải đồng ý — "no_reply" chặn y như "no"` | CSDL thật | **N** | Mẫu tốt: khoá đúng một quyết định đạo đức bằng dữ liệu. |
| `đổi ý trên ảnh CHƯA duyệt thì tự do` | CSDL thật | **N** | Đối chứng. |
| `gỡ chữ ký của một hành động đã thi hành ⇒ COMMIT hỏng` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `người ký phải mang đúng vai mà action_key đòi` | CSDL thật | **N** | Chỉ thử **một** `action_key` (`data.delete`); bảng ánh xạ khoá→vai không được duyệt hết. |
| `người ký không được là ĐỐI TƯỢNG của hành động` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `thi hành mà thiếu chữ ký người tạo ⇒ hỏng` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |

### `t13-three-consents.test.js` (9 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `không đặt được channel_opened_at khi chưa đủ ba chữ ký` | CSDL thật, thử **0/3 và 2/3** | **N** | Mẫu tốt: 2/3 là ca "gần đủ trông giống đủ", đúng chỗ dễ lọt nhất. |
| `0/3, 1/3, 2/3 đều không đọc được số; đủ 3 thì đọc được` | Gọi `contact_read` thật, bốn nấc | **N** | Chưa nghĩ ra đường lách. Đây là bài T5 của đặc tả mục 13, thi công đúng. |
| `kênh đi CẢ HAI CHIỀU` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `rút lại một chữ ký sau khi đã mở kênh cũng bị CHECK chặn` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `người thứ tư không hưởng lây` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `người GIỚI THIỆU cũng không tự động đọc được số của ứng viên` | Thật | **N** | Mẫu tốt: canh **ranh giới trên** của một cái cửa vừa mở, không chỉ canh cửa có mở không. |
| `mức closed KHÔNG bị kênh lấn quyền` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `vẫn ghi đúng một dòng nhật ký cho mỗi lượt đọc, kể cả lượt được kênh mở` | Đếm thật | **N** | Chưa nghĩ ra đường lách. |
| `không tạo nổi lời giới thiệu ghép người của hai cộng đồng` | CSDL thật | **N/T** | Mẫu rộng `/foreign key/i` — không nêu đích danh khoá ghép nào chặn. |

### `t13-privacy-eight-fields.test.js` (15 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `mặc định public: danh bạ có nghề và khu vực` | `members.list()` thật | **N** | Đối chứng cho cả tệp. |
| `job=closed ⇒ danh bạ trả job null` | Thật | **N** | Chưa nghĩ ra đường lách. Đây là Ruling T11-f được vá và canh. |
| `area=closed ⇒ danh bạ trả area null` | Thật, kèm khẳng định `job` **không** bị che lây | **N** | Mẫu tốt: canh cả "che đúng cái cần che" lẫn "không che nhầm cái khác". |
| `hồ sơ chi tiết che y như danh sách — không có cửa sau nào` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `chính chủ vẫn thấy hồ sơ mình dù đã đóng hết` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `job public: lọc theo nghề tìm thấy` | Thật | **N** | Đối chứng, tên bài nói thẳng nó là đối chứng. |
| `job closed: lọc theo nghề KHÔNG tìm thấy nữa` | Thật, kèm "vẫn còn trong danh bạ khi không lọc" | **N** | Mẫu rất tốt: bịt đúng lỗ "che giá trị mà để hở bộ lọc" — bộ lọc là **kênh phụ** đọc lại chính trường vừa che, và rất ít bộ test nghĩ tới. |
| `area closed: lọc theo khu vực KHÔNG tìm thấy nữa` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `chính chủ lọc hồ sơ mình thì vẫn ra, dù đã đóng` | Thật | **N** | Đối chứng. |
| `bao bì có đủ tám trường, đúng hai nhóm` | So khoá bao bì với `CONTACT_FIELDS`/`PROFILE_FIELDS` **import từ chính mã đang kiểm** | **T** | **Đo bản sao thay vì đo nguồn**: hai vế của phép so cùng đến từ `core/privacy.js`. Xoá `address` khỏi `CONTACT_FIELDS` ⇒ bao bì cũng mất `address` ⇒ hai vế vẫn khớp ⇒ xanh. Chỉ có `expect(FIELDS).toHaveLength(8)` là một hằng số thật sự độc lập — và nó là thứ duy nhất giữ bài này khỏi rỗng. Nguồn thật đáng so là **8 hàng `privacy_settings` do `fn_member_bootstrap` sinh** (thứ mà `t16` có kiểm). |
| `on_consent + đơn được duyệt mở "job" y hệt như mở "phone"` | Thật, đủ ba nấc + đối chứng bộ lọc | **N** | Mẫu rất tốt: canh **"một luật, không phải hai"** bằng cách chạy cùng kịch bản trên trường thuộc nhóm kia. |
| `fn_privacy_state là nguồn duy nhất: cùng câu trả lời cho cả tám trường` | Gọi CSDL thật, duyệt `FIELDS` | **N/T** | Miền lặp lại lấy từ `FIELDS` (mã đang kiểm) — bỏ một trường khỏi `FIELDS` thì vòng lặp co lại. Nhưng bài trên đã khoá `FIELDS.length === 8`, nên khe hở này đã đóng một nửa. |
| `người xem thuộc cộng đồng khác không nhận được trạng thái nào` | Thật, kèm khẳng định bao bì rỗng ⇒ `closed` | **N** | Mẫu tốt: canh **hướng thất bại** (mặc định phải đóng), không chỉ canh kết quả. |
| `trường liên hệ không mang giá trị kể cả khi mức public` | Thật | **N** | Chưa nghĩ ra đường lách. |
| `envelope() không cho giá trị liên hệ đi kèm dù người gọi cố truyền vào` | **Truyền thẳng `{ phone: '0912000002' }` vào `envelope()`** và khẳng định `value === null`, đồng thời `job` **thì có** giá trị | **N** | **Bài duy nhất trong cả bộ ép được nhánh `allowed === true` chạy trên một trường liên hệ.** Nó là thứ duy nhất giữ cờ `inline` khỏi thành trang trí — đúng cái lỗ mà `t06` và `t10.1` để hở. Nên ghi vào trí nhớ dự án: **cổng riêng tư quan trọng nhất của tầng JS đang treo trên một khẳng định duy nhất.** |

### `t16-join-flow.test.js` (25 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `luồng đầy đủ xin mã → nộp đơn → xác nhận gặp mặt → duyệt` | HTTP thật đầu-cuối, rồi đọc lại `members`/`join_requests` từ CSDL | **N** | Chưa nghĩ ra đường lách. |
| `hộp liên hệ do trg_member_bootstrap sinh, và số điện thoại vào đúng ô` | Đọc CSDL thật, kèm khẳng định **ba ô kia phải trống** | **N** | Mẫu tốt: canh cả "điền đúng ô" lẫn "không đoán hộ ô khác". |
| `đúng TÁM mức riêng tư, đúng mặc định của spec dòng 852` | Đọc CSDL thật, liệt kê **cả tám** giá trị mong đợi tường minh | **N** | Đây là nguồn sự thật độc lập cho "tám trường" — thứ mà `t13-privacy-eight-fields` bài 10 thiếu. |
| `đúng MỘT cạnh guarantee, đi từ người bảo lãnh sang người mới` | Đọc CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `mật khẩu người nộp đơn chọn sống sót qua bảng bí mật và verify được` | `argon2.verify` thật | **N** | Mẫu tốt: nó kiểm **kết quả cuối cùng có dùng được không**, không kiểm "có gọi hàm băm chưa". |
| `bảng bí mật được ĐỐT sau khi duyệt` | Đọc CSDL thật, hai chỗ | **N** | Chưa nghĩ ra đường lách. |
| `nhật ký ghi đủ ba việc, và không dòng nào chứa số điện thoại` | Đọc CSDL thật | **N/T** | `toContain` ba action, **không** khẳng định số lượng dòng — thừa hay lặp dòng thì không thấy. Và `not.toContain(NEW_PHONE)` lại là danh sách cấm một chuỗi. |
| `người mới có mặt trong danh bạ` | Đọc CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `/auth/otp/verify trả otp_token, và chính khoá đó nộp thẳng được cho /auth/register` | HTTP thật, **nộp lại chính thân phản hồi** vào bước sau | **N** | Mẫu rất tốt: nối hai bước bằng chính dữ liệu chạy thật là cách duy nhất bắt được lệch quy ước tên khoá **giữa** hai endpoint. |
| `/auth/login → /auth/refresh nối được bằng đúng tên khoá của đặc tả` | HTTP thật | **N** | Chưa nghĩ ra đường lách. |
| `app_role KHÔNG ghi được vào member_relations` | `app_role` thật, đủ INSERT/UPDATE/DELETE, **kèm đối chứng SELECT vẫn được** | **N** | Mẫu tốt: đối chứng chống "khoá nhầm cả cửa đọc". |
| `app_role KHÔNG đọc được join_request_secrets bằng SELECT thẳng` | `app_role` thật, 4 câu | **N** | Chưa nghĩ ra đường lách. |
| `join_secret_consume: chỉ approver CỦA CHÍNH CỘNG ĐỒNG ĐÓ gọi được` | CSDL thật, ba vai bị từ chối + **khẳng định bí mật còn nguyên** | **N** | Mẫu tốt. |
| `join_secret_consume: cửa chỉ mở đúng khoảnh khắc duyệt, không sớm hơn` | CSDL thật, cả "chưa tới lúc" lẫn "đã qua lúc" | **N** | Chưa nghĩ ra đường lách. |
| `đơn chưa xác nhận gặp mặt: approve trả 422, không tạo thành viên nào` | HTTP thật + đếm `members` | **N** | Comment tự khai bài này **một mình** vẫn xanh khi trigger bị gỡ — và bài kế tiếp là vế bù (Ruling C11). Khai báo trung thực đúng chuẩn. |
| `CSDL tự chặn: hàng members có referrer_id mà không đơn nào nối tới ⇒ COMMIT hỏng` | CSDL thật, dạng callback, + khẳng định rollback sạch | **N** | Chưa nghĩ ra đường lách. |
| `đơn CHỈ có met_confirmed_at mới mở được cổng — nối đơn thôi chưa đủ` | CSDL thật | **N** | Mẫu tốt: phân biệt "có mối nối" với "có bằng chứng gặp mặt". |
| `không sửa lại được referrer_id của một người đã là member` | CSDL thật, cả gán mới lẫn gán `NULL` | **N** | Chưa nghĩ ra đường lách. |
| `cạnh guarantee chỉ tồn tại MỘT hướng` | CSDL thật, **đích danh** `rel_guarantee_one_direction` | **N** | Chưa nghĩ ra đường lách. |
| `cạnh guarantee không nối được hai cộng đồng` | CSDL thật | **N/T** | Mẫu rộng `/rel_a_same_community\|violates foreign key/i`. |
| `approver không ghi đè được số điện thoại đã có` | CSDL thật + đọc lại giá trị | **N** | Chưa nghĩ ra đường lách. |
| `approver điền được ô CÒN TRỐNG, và lần đó có dấu vết` | CSDL thật, ba vế (điền được / có nhật ký / lần hai bị chặn) | **N** | Chưa nghĩ ra đường lách. |
| `chính chủ thì sửa được bất cứ lúc nào` | CSDL thật | **N** | Đối chứng. |
| `người ngoài không sờ được ô liên hệ của người khác` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `tên trường ngoài danh sách trắng bị chặn TRƯỚC khi chạm format(%I)` | CSDL thật, **kèm một chuỗi tiêm SQL thật** (`phone" , address = "hacked`) | **N** | Mẫu rất tốt, và nó là thứ `t05` bài `BAD_FIELD` thiếu: nó phân biệt được "chặn ở danh sách trắng" với "chết vì cú pháp". |

### `t17-otp.test.js` (12 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `sai 5 lần thì challenge bị burned` | Service thật + đọc CSDL | **N** | Chưa nghĩ ra đường lách. Đây là bài chứng minh Ruling T7 (giao dịch phải commit trước khi ném). |
| `nhật ký ghi phone_hash, không ghi số và không ghi mã` | Đọc CSDL thật, có `rows.length > 0` chống vòng lặp rỗng | **N** | `not.toContain(ALICE_PHONE)` là danh sách cấm; **không** khẳng định mã OTP vắng mặt (đặc tả T17 đòi cả hai) — mã không được giữ lại ở đâu để so, nên vế "không ghi mã" thật ra **không có ai canh**. Tên bài hứa nhiều hơn nó kiểm. |
| `mã OTP được băm bằng argon2 trước khi lưu` | Đọc CSDL thật | **N** | Tên bài **đã được sửa cho khớp assertion** ở Ruling T7-b, và comment nói thẳng việc canh `crypto.randomInt` dựa vào soát mã. Đây là mẫu tốt của cách xử lý một thuộc tính không kiểm được bằng test. |
| `mã OTP luôn đủ 6 chữ số, kể cả khi có số 0 đứng đầu` | Gọi `newCode()` **500 lần** + 3 vòng đi thật qua adapter | **N** | Mẫu tốt: tách "tính chất của hàm" (rẻ, 500 mẫu) khỏi "đường đi không cắt gọt" (đắt, 3 mẫu) — thay vì nới timeout khi bài chập chờn (Ruling T7-c). |
| `3 challenge hỏng liên tiếp cùng số ⇒ khóa 15 phút` | Service thật | **N** | Khẳng định `OTP_LOCKED` xảy ra, **không** khẳng định nó **hết** sau 15 phút — nửa sau của luật ("15 phút") không có lưới nào; đặt khoá vĩnh viễn vẫn xanh. |
| `login trả cùng một lỗi cho số lạ và mật khẩu sai` | Service thật, so cả `code` lẫn `message` | **N** | So **câu chữ**, không so **thời gian**. Số lạ không chạy `argon2.verify` nên nhanh hơn hẳn — kênh phụ thời gian còn nguyên, và không bài nào đo. (`/auth/register` có đệm; `/auth/login` thì không.) |
| `login đúng số + mật khẩu thì thành công` | Service thật | **N** | Chưa nghĩ ra đường lách. |
| `refresh xoay vòng: token cũ dùng lại bị thu hồi cả họ` | Service thật, ba nấc + đọc nhật ký | **N** | Mẫu tốt: canh cả "cả họ bị thu hồi", không chỉ "token cũ bị từ chối". |
| `HTTP: POST /auth/login rồi GET /auth/me` | HTTP thật, kèm ca không có token ⇒ 401 | **N** | Chưa nghĩ ra đường lách. |
| `HTTP: OTP request quá 5 lần/phút bị chặn RATE_LIMITED` | HTTP thật, 6 lượt | **N** | Không kiểm cửa sổ **mở lại** sau một phút; và bộ đếm theo IP hay theo số điện thoại thì bài này không phân biệt được. |
| `verifyOtp ở cộng đồng B không tiêu thụ được challenge của A` | Service thật, hai cộng đồng, **kèm đối chứng A vẫn dùng được mã đó** | **N** | Mẫu rất tốt: đối chứng chứng minh bài đỏ vì bộ lọc chứ không vì mã sai (Ruling T7-a). |
| `3 challenge hỏng liên tiếp ở B không khóa số đó ở A` | Service thật, hai cộng đồng | **N** | Chưa nghĩ ra đường lách. |

### `t18-tx.test.js` (2 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `đặt app.actor_id trong giao dịch` | CSDL thật | **N** | Chưa nghĩ ra đường lách. |
| `dấu không rò ra ngoài giao dịch (buộc dùng lại đúng 1 kết nối vật lý)` | Mock `db/knex.js` về pool `{min:1,max:1}`, **và tự xác nhận giả định bằng `pg_backend_pid()`** | **N** | Mẫu tốt nhất cả bộ về *"tự chứng minh tiền đề của mình trước khi tin vào kết quả"*: nếu pool không hoạt động như kỳ vọng thì bài **thất bại rõ ràng** thay vì lặng lẽ xanh. Đây đúng là thứ `t08`/`t12-manual-quota` còn thiếu ở chỗ đếm `pg_locks` toàn cụm. |

### `t19-error-handler.test.js` (2 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `req.log gắn sẵn: trả 500 và gọi log.fatal thật` | `errorHandler` thật, spy đếm **số lần gọi** | **N** | Dùng `req` giả chứ không đi qua Express thật, nên nó không chứng minh `req.log` **có thật** ở production — chỗ đó do `t20` (dùng `pinoHttpOptions` thật) và `t07` (đi qua CSDL thật) bù. |
| `req.log KHÔNG tồn tại: vẫn trả 500 và rơi về console.error, không im lặng` | Thật | **N** | Mẫu tốt: canh đúng chế độ hỏng đã cắn dự án (Ruling I1 Task 3 — `req.log?.fatal()` là no-op im lặng). |

### `t20-log-redaction.test.js` (1 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `số điện thoại trong err.detail không xuất hiện ở bất kỳ đâu trong log đã ghi, nhưng code/message thì có` | Dựng **pino thật** với `pinoHttpOptions` **import từ production**, ghi vào stream trong bộ nhớ, soi **chuỗi JSON thật sự được ghi ra**, và kiểm cả **vế phải còn** (`code`, `message`, `constraint`) | **N** | Mẫu tốt nhất cả bộ cho loại "chống rò": nó **không** mock hàm log rồi kiểm tham số truyền vào (chỉ kiểm cái ta đưa vào), mà kiểm **cái thực sự được ghi**. Lỗ mù còn lại đã ghi từ Task 3: nó dựng `pino({...opts}, stream)` chứ không qua `pinoHttp()` thật, và đường rò qua `err.cause` chưa có lưới. Cũng chỉ có **một** mẫu lỗi (23514) — danh sách cho phép 9 trường được canh gián tiếp chứ không được liệt kê. |

### `t21-http-shape.test.js` (11 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `POST /auth/otp/verify trả otp_token — không rò otpToken` | HTTP thật + `assertSnakeKeys` đệ quy | **N** | — |
| `POST /auth/login trả access, refresh, member{...}` | HTTP thật | **N** | — |
| `POST /auth/refresh NHẬN refresh_token — refreshToken không được server hiểu` | HTTP thật, **cả ca sai lẫn ca đúng** | **N** | Mẫu tốt: canh cả chiều nhận, không chỉ chiều trả; và cố ý bác bỏ "chấp nhận cả hai cho dễ". |
| `POST /auth/register trả join_request_id, step` | HTTP thật | **N** | — |
| `GET /auth/me trả community_id` | HTTP thật | **N** | Ruling T9-e được vá và canh. |
| `GET /areas trả data[] với id, name, parent_id, children` | HTTP thật | **N** | Không khẳng định `lat`/`lng` vắng mặt (xem `t10-directory`). |
| `GET /members trả { data, meta } và contacts.*.value luôn null` | HTTP thật, duyệt mọi hàng + `not.toContain(ALICE_PHONE)` | **N** | Đây là lưới **cuối cùng** ở đúng lớp vỏ cho nguyên tắc 4. |
| `GET /members/:id trả hồ sơ + contacts, không rò email/lat/lng` | HTTP thật | **N** | Danh sách cấm 5 tên (khác `t10` dùng `toEqual` trên toàn bộ khoá) — thêm một khoá mới lọt ra vỏ thì bài này không thấy, nhưng `t10` thì thấy. Hai bài bù nhau. |
| `GET /members/:id/contacts/:field trả { value }` | HTTP thật, `toEqual` chính xác | **N** | Chưa nghĩ ra đường lách. |
| `GET /members/:id/contacts/:field từ chối tên trường lạ (400, không phải 500)` | HTTP thật | **N** | Mẫu tốt: nó phân biệt "chặn ở zod" với "chết ở CSDL rồi thành 500". |
| **Cả tệp, xét theo luật Ruling T9-e** | — | **T** | **Luật "route mới phải được thêm vào t21" ĐANG BỊ VI PHẠM.** Kho có **16** route handler; `t21` gọi tới **9**. Không có lưới hình dạng nào cho: `POST /auth/otp/request`, và **cả năm route `/join-requests`** — `GET /`, `GET /:id`, `POST /:id/confirm-met`, `POST /:id/reject`, `POST /:id/approve`. `t08`/`t16` có gọi chúng qua HTTP thật nhưng **không bài nào chạy `assertSnakeKeys` trên phản hồi của chúng**, tức đúng lớp vỏ mà Ruling T9-c dựng lưới này để canh thì năm route quan trọng nhất của luồng gia nhập vẫn hở. Comment trong tệp đã tự dự báo chính xác chuyện này (*"một cái lưới rộng vẫn không bắt được con cá bơi ở khúc sông không ai thả lưới"*) — dự báo đúng, và đã thành sự thật. |

### `t22-cors.test.js` (9 bài)

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `CORS_ORIGIN của môi trường test là một gốc cụ thể, không phải *` | Đọc `config` thật | **N** | Đối chứng cho cả tệp (nếu `CORS_ORIGIN` là `*` thì mọi bài dưới vô nghĩa). |
| `preflight từ Origin ĐƯỢC PHÉP: 204, vọng lại đúng gốc` | HTTP thật | **N** | Chưa nghĩ ra đường lách. |
| `preflight từ Origin LẠ: 403, và KHÔNG phát access-control-allow-origin` | HTTP thật | **N** | Chưa nghĩ ra đường lách. |
| `gốc chỉ TRÙNG TIỀN TỐ vẫn bị từ chối` | HTTP thật với `ALLOWED + '.ke-gian.example.com'` | **N** | Mẫu rất tốt: nó canh **thuật toán so khớp**, không chỉ canh kết quả với hai đầu vào dễ. |
| `yêu cầu thật từ Origin ĐƯỢC PHÉP: có header đúng gốc` | HTTP thật | **N** | Chưa nghĩ ra đường lách. |
| `yêu cầu thật từ Origin LẠ: KHÔNG có header ⇒ trình duyệt vứt phản hồi` | HTTP thật | **N** | Mẫu tốt: comment giải thích vì sao khẳng định **sự vắng mặt của header** mới đúng cơ chế, chứ không phải mã trạng thái. |
| `không lời gọi nào nhận được ký tự đại diện *` | HTTP thật, ba gốc | **N** | Chưa nghĩ ra đường lách. |
| `luôn có Vary: Origin` | HTTP thật, có và không có `Origin` | **N** | Mẫu tốt: canh một cơ chế mà hậu quả nằm ở **proxy đệm**, thứ không quan sát được trong test. |
| `không có Origin (curl, máy chủ gọi máy chủ) vẫn đi qua bình thường` | HTTP thật | **N** | Chưa nghĩ ra đường lách. |
| **Cả tệp** | — | — | Lỗ mù chung: `ALLOWED` lấy từ `config.CORS_ORIGIN` của môi trường **test**. Không bài nào khẳng định giá trị production là `binhdan1986.com` như đặc tả mục 5.1 đòi — đặt `CORS_ORIGIN=*` trong `.env` production thì bài 1 (`not.toBe('*')`) **không chạm tới**, vì nó đọc `.env.test`. |

### `t23-error-map.test.js` (5 bài)

Đây là bài đã bị sửa từ "so bảng JS với bảng JS" thành "đọc thẳng nguồn" ở Ruling
T13-c. Bản mới **thật sự canh nguồn cho đúng thứ nó đọc** — nhưng nó đọc đúng
một hình dạng nguồn, và **hai hình dạng khác vẫn không ai canh**. Cả hai đã kiểm
bằng chạy thật, không suy đoán.

| Tên bài | Canh gì | N/T | Lỗ mù cụ thể |
|---|---|---|---|
| `mọi RAISE EXCEPTION trong migration đều có mặt trong BY_MESSAGE` | **Đọc nguồn thật**: quét `RAISE EXCEPTION '<MÃ>'` trong `src/db/migrations/`, có `expect(raised.size).toBeGreaterThan(20)` chống bài rỗng | **N** cho hình dạng nó đọc | **Lỗ mù đã kiểm chạy thật: 19 CHECK constraint không đi qua `RAISE EXCEPTION` nên vô hình với bài này** — `intro_three_consents`, `rel_canonical`, `wr_manual_review`, `sig_fwd_not_self`, `cr_not_self`, `members_not_self_referrer`, `act_time_order`, `act_need_not_over`, `complaint_not_self`, `conn_not_self`, `intro_distinct_candidate`, `jr_id_cid`, `modq_decided_pair`, `pa_executed_pair`, `rel_not_self`, `report_published_pair`, `subject_key_destroy_means_gone`, `verif_not_self`, `verif_reviewer_pair`. **Không cái nào có khoá trong `BY_MESSAGE`**, và `mapPgError` chỉ xử lý riêng `23505`/`23503`/`42501` — nên `23514 check_violation` rơi qua `return null` ⇒ người dùng nhận **500 "Lỗi hệ thống"**. Đúng y hệt chế độ hỏng mà tệp này ra đời để chống, chỉ khác một hình dạng cú pháp. Ngoài ra regex đòi mã nằm **trọn trong một cặp nháy đơn**, nên `RAISE EXCEPTION 'MÃ %', x` hay `RAISE ... USING MESSAGE = …` cũng lọt. |
| `không khoá nào là chuỗi con của khoá khác` | Kiểm một **tính chất thật** của thuật toán `raw.includes(key)` | **N/T** | Nó **tự viết lại** luật của `mapPgError` thay vì gọi `mapPgError`. Đổi `mapPgError` sang so khớp chính xác (hoặc chuẩn hoá hoa/thường) thì bài này vẫn xanh và vẫn ép một luật không còn cần — hoặc tệ hơn, bỏ sót luật mới. Vẫn là bài tốt: nó bắt được một sai lệch **thầm lặng** (dịch sai mà vẫn có câu tiếng Việt hiện ra). |
| `mọi mã máy chủ có thể gửi ra đều có câu tiếng Việt ở web/js/api.js` | So `BY_MESSAGE` (JS) với `web/js/api.js` (JS) | **T** | **Đây vẫn là phép so bảng-JS-với-bảng-JS của bản `t23` đầu tiên, chỉ dịch lên một tầng.** `serverCodes()` chỉ đọc phần tử thứ hai của `BY_MESSAGE`; **13 mã ném thẳng bằng `new AppError('…')` trong service/middleware nằm ngoài tầm nhìn của nó.** Đã kiểm chạy thật, và **có một ca đang hỏng ngay lúc này**: `BIRTH_YEAR_MISMATCH` (`api/src/modules/auth/service.js:247`) **không có câu tiếng Việt nào trong `web/js/api.js`** — người nộp đơn gõ nhầm năm sinh sẽ thấy câu chung chung đúng lúc cần biết lý do thật. `t08` có một bài đi qua HTTP khẳng định `error.code === 'BIRTH_YEAR_MISMATCH'`, nên **cả hai lưới đều xanh** trong khi người dùng thật thì không đọc được gì. |
| `không có câu thừa ở trình duyệt cho mã máy chủ không bao giờ gửi` | Quét **toàn bộ `api/src`** tìm `'MÃ'` | **N** | Mẫu tốt cho chiều ngược lại — và đáng chú ý: **chiều này đã đọc nguồn thật (toàn bộ mã nguồn), còn chiều kia thì không.** Sửa chiều thiếu chỉ là dùng lại đúng `readAllSource()` đã có sẵn trong tệp. |
| `AppError giữ nguyên mã được truyền vào` | Gọi thật | **N** | Bài rất hẹp nhưng có giá trị: nó khoá một hành vi mà cả hai bài trên ngầm dựa vào. |

---

## 3. Xếp hạng theo mức nguy hiểm

### Tổng kết con số

| | Số bài | Ghi chú |
|---|---|---|
| **Canh nguồn (N)** | ~247 | Chạy mã thật, dữ liệu thật, để CSDL tự từ chối |
| **Nguồn cho tuyên bố chính, triệu chứng ở một khẳng định phụ (N/T)** | ~19 | Phần lớn là **mẫu regex rộng** (`/violates foreign key/i`) |
| **Canh triệu chứng (T)** | ~12 | Bốn lưới quét mã nguồn, ba phép so bản-sao-với-bản-sao, hai phép đếm gián tiếp, hai miền lặp lấy từ mã đang kiểm, một khẳng định không thể đỏ |
| **Xanh giả (không canh gì)** | **0** | Xem mục 5 |

Nói ngắn gọn: **bộ kiểm thử này khoẻ.** Hơn 85% số bài chạy thật và để tầng dữ liệu tự
từ chối, không bài nào tin lời hứa của tầng service khi nó nói mình đang cưỡng chế một
nguyên tắc. Phần dưới đây nói về **12–19 bài còn lại và những chỗ không ai thả lưới** —
đó là điểm của tài liệu này, không phải một bản đánh giá tổng thể.

### Thang xếp hạng

Một lỗ mù **che một NGUYÊN TẮC (1–5)** nguy hơn một lỗ mù che một chi tiết kỹ thuật, vì:

- nguyên tắc là thứ cả kiến trúc này trả giá để có (`REVOKE ALL`, trigger hoãn, `SECURITY
  DEFINER`, chuỗi băm) — mất nó là mất lý do tồn tại của phần lớn mã;
- chi tiết kỹ thuật hỏng thì có người phàn nàn; nguyên tắc hỏng thì **im lặng**, và
  người bị hại không biết mình bị hại.

Cộng thêm hai hệ số:

- **Đang hỏng thật** (không phải giả định) → nâng một bậc.
- **Lỗ nằm ở đúng chỗ cơ chế được dựng ra để chống** → nâng một bậc. Đây là bài học `t23`:
  một cái lưới mù trước đúng loại cá nó được căng ra để bắt còn tệ hơn không có lưới, vì
  nó **dập tắt câu hỏi**.

---

### TOP 5 ĐÁNG SỬA TRƯỚC

#### 1. `t11-audit-detail` — `assertSafeDetail` chỉ canh hình dạng CHỮ SỐ (nguyên tắc 4)

**Vì sao đứng đầu.** `assertSafeDetail` tồn tại **không phải** để chặn kẻ tấn công — nó
tồn tại để chặn **lập trình viên vô ý ở tương lai** (Ruling T4-a nói đúng câu đó). Ba
đường lách đã kiểm bằng chạy thật đều là **đúng thứ một lập trình viên vô ý sẽ viết**:

| Đường lách | Ví dụ | Kết quả |
|---|---|---|
| Khoá không bị kiểm gì cả (`z.record` chỉ ràng buộc giá trị) | `{ '0912345678': true }` | **LỌT** |
| Số kiểu `number` (nhánh `z.number()` nhận mọi số) | `{ phone: 912345678 }` — tức `parseInt(phone)` | **LỌT** |
| Chuỗi chữ không có chữ số vẫn là văn tự do | `{ v: 'NguyenVanA' }`, `{ v: 'so-12-ngo-4-Khoai-Chau' }` | **LỌT** |

Và hậu quả không dừng ở một dòng nhật ký xấu: **cả lập luận Nghị định 13 ở mục 10 đặc tả
dựa vào việc nhật ký bất biến KHÔNG chứa dữ liệu cá nhân** — ta giữ được nhật ký vĩnh
viễn *vì* nó sạch. Nhiễm nó là làm sụp cái cột chống đó, và vì nhật ký bất biến nên
**không xoá lại được**.

Bài `t11` không sai; nó canh rất kỹ đúng một trục (chữ số) và bỏ trống hai trục kia
(khoá, và chuỗi chữ thuần). Hai vòng soát xét trước (Ruling T4-a, T4-c) đều chỉ đi sâu
thêm vào trục chữ số.

**Sửa thế nào:** thêm `z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), …)` để khoá cũng
phải là tên trường; đổi `z.number()` thành `z.number().int().max(<ngưỡng đếm hợp lý>)`
hoặc bắt số ≥7 chữ số; và với chuỗi, chuyển từ *danh sách cho phép theo tập ký tự* sang
*danh sách cho phép theo TẬP GIÁ TRỊ* — enum thật, tên trường thật, mã lỗi thật — vì tập
ký tự sẽ không bao giờ phân biệt được `SELF_ONLY` với `NguyenVanA`.

#### 2. `t12-trust` — hai lưới "không xếp hạng" cùng mù hai chỗ (nguyên tắc 5)

**Vì sao xếp thứ hai.** Nguyên tắc 5 là nguyên tắc **ít cơ chế cưỡng chế nhất** trong
năm: không có trigger nào, không có `REVOKE` nào: chỉ có hai bài test này. Bốn nguyên
tắc kia có CSDL đỡ; nguyên tắc 5 **chỉ có cái lưới**.

Lưới 1 (quét mã) mù trước `.orderBy('confirmed_works')` — **query builder của chính dự
án** — và trước `ORDER BY` xuống dòng, tức cách viết SQL phổ biến nhất trong kho. Lưới 2
(chạy thật) bịt hai lỗ đó nhưng chỉ trong `membersService.list()`.

**Cả hai cùng mù ở:** (a) `web/js/` — sắp lại danh bạ trong trình duyệt là nền tảng đang
xếp hạng người, và gốc quét là `api/src`; (b) mọi endpoint chưa tồn tại — đúng chỗ lưới 1
được đặc tả yêu cầu để bù cho lưới 2, mà nó lại không bù được.

**Sửa thế nào:** hai chữa nhỏ, không cần bài mới. (i) Đổi regex thành
`/(order\s+by|\.orderBy\s*\()[\s\S]{0,200}?\b(confirmed_works|…)\b/i` — bắt cả knex
builder và cả xuống dòng, giới hạn `{0,200}` thay cho `[^;\n]*` để không dương tính giả.
(ii) Thêm `web/js` vào danh sách thư mục quét, cùng với `\.sort\(` trên các trường uy tín.

#### 3. `t03-no-phone-in-members` bài 1 — danh sách CẤM bốn tên cột (nguyên tắc 4)

**Vì sao xếp thứ ba dù chỉ là một bài.** Đây là **T3 của đặc tả mục 13**, tức lời hứa
gốc: *"`SELECT * FROM members` không chứa số điện thoại ở bất kỳ vai nào."* Bài đang có
kiểm bốn **tên** (`phone/zalo/messenger/address`). Thêm `members.so_dien_thoai`,
`members.contact_phone`, `members.mobile`, hay một cột `lien_he jsonb` ⇒ **xanh**, và
`app_role` có `SELECT` trên `members` nên đọc được ngay.

Nó cũng **không** làm phần đặc tả đòi rõ nhất: *"duyệt cả 5 vai"* — bài chạy bằng đúng
một vai (owner).

**Sửa thế nào:** lật ngược thành **danh sách CHO PHÉP** — liệt kê tường minh mọi cột được
có trong `members`, `toEqual` chính xác. Cột mới nào cũng phải có người quyết định thêm
vào danh sách, đúng khuôn `t10-directory` đã dùng cho `detailRow` (`toEqual` trên
`Object.keys()`). Đây là bản sửa **rẻ nhất** trong top 5 và bịt được nhiều nhất.

#### 4. `t23-error-map` — hai lỗ, và MỘT LỖI ĐANG HỎNG NGAY BÂY GIỜ

**Vì sao có mặt trong top 5 dù chỉ là chuyện thông điệp lỗi.** Đây là **lần thứ ba** cùng
một khuôn hình trong cùng một tệp (Ruling T12-g → T13-c → hôm nay), và lần này có bằng
chứng chạy thật chứ không phải suy đoán:

- **Đang hỏng:** `BIRTH_YEAR_MISMATCH` được ném bằng `new AppError()` ở
  `api/src/modules/auth/service.js:247` và **không có câu tiếng Việt nào** trong
  `web/js/api.js`. Người gõ nhầm năm sinh lúc gia nhập sẽ thấy câu chung chung. `t08` có
  hẳn một bài đi qua HTTP khẳng định `error.code === 'BIRTH_YEAR_MISMATCH'` — **hai lưới
  cùng xanh** trong khi người dùng thật không đọc được gì.
  Nguyên nhân: `serverCodes()` chỉ đọc `BY_MESSAGE`, còn **13 mã ném thẳng bằng
  `new AppError('…')` nằm ngoài tầm nhìn**. Tức bài này **vẫn là phép so bảng-JS-với-
  bảng-JS**, chỉ dịch lên một tầng so với bản đã bị sửa.
- **Chưa hỏng nhưng sẽ hỏng:** **19 CHECK constraint** không đi qua `RAISE EXCEPTION` nên
  vô hình với bài quét nguồn — `intro_three_consents`, `rel_canonical`,
  `wr_manual_review`, `sig_fwd_not_self`, `cr_not_self`, `members_not_self_referrer`, và
  13 cái nữa. Không cái nào có khoá trong `BY_MESSAGE`, và `mapPgError` chỉ xử lý riêng
  `23505`/`23503`/`42501`, nên `23514 check_violation` rơi qua `return null` ⇒ HTTP 500
  "Lỗi hệ thống". Chính xác chế độ hỏng tệp này ra đời để chống, chỉ khác một hình dạng
  cú pháp.

**Sửa thế nào:** cả hai đều dùng lại thứ đã có sẵn trong chính tệp. (i) Cho `serverCodes()`
gộp thêm `[...readAllSource().matchAll(/new AppError\(\s*'([A-Z0-9_]+)'/g)]` — hàm
`readAllSource()` đã nằm ngay dưới, bài "câu thừa" đang dùng nó. (ii) Cho
`raisedInMigrations()` quét thêm `CONSTRAINT <ten> CHECK` và `ADD CONSTRAINT <ten>`.

#### 5. `t10-grants` — `GRANT … TO PUBLIC` và quyền theo CỘT đều vô hình (nguyên tắc 4)

**Vì sao trong top 5.** Ba bài của tệp này là **cửa duy nhất** canh toàn bộ ma trận
quyền — nền móng mà nguyên tắc 4 đứng lên. Cả ba đều lọc `grantee = 'app_role'`:

- `GRANT SELECT ON <bảng nhạy cảm> TO PUBLIC` ⇒ `app_role` đọc được (mọi vai đều hưởng),
  mà `information_schema.table_privileges` với `grantee='app_role'` **không thấy gì** ⇒
  cả ba bài xanh.
- `GRANT SELECT (phone) ON member_contacts TO app_role` ⇒ nằm ở `column_privileges`, không
  ở `table_privileges` ⇒ **xanh**.

Vài bảng nhạy cảm có bài hành vi trực tiếp bù lại (`t03` cho `member_contacts`, `t16` cho
`join_request_secrets`, `t12`/`t13` cho `member_relations`, `member_trust_stats`,
`fund_entry_approvals`) — nên hôm nay lỗ này chưa mở toang. Nhưng những bảng **không ai
nghĩ tới** (`otp_challenges`, `refresh_tokens`, `profile_views`, `join_requests`, và mọi
bảng thêm ở giai đoạn sau) chỉ có đúng ba bài này canh.

**Sửa thế nào:** bỏ bộ lọc `grantee = 'app_role'`, đọc **mọi grantee** rồi khẳng định tập
hợp `{grantee, privilege}` khớp khai báo — `PUBLIC` xuất hiện là đỏ ngay trừ khi có người
cố ý khai. Thêm một bài duyệt `information_schema.column_privileges` khẳng định rỗng.
Đồng thời thêm `'m'` và `'f'` vào `relkind IN (…)`.

---

### Nhóm tiếp theo (đáng sửa, dưới top 5)

| # | Lỗ mù | Che gì | Vì sao không nằm trong top 5 |
|---|---|---|---|
| 6 | **`t07` — `detail` KHÔNG nằm trong chuỗi băm `audit_log`** (cùng `community_id`, `ip`); `UPDATE audit_log SET detail = …` là vô hình với `verifyChain`, và không bài nào phát hiện. Thêm nữa, công thức digest tồn tại **hai bản sao** (trigger `007` ↔ `core/audit.js`) — sửa cùng lúc cả hai thì chuỗi vẫn "lành". | Nguyên tắc 4 (nhật ký bất biến) | Đây là phát hiện về **cơ chế**, không chỉ về bài test; sửa phải đổi công thức băm, tức migration mới — mà migration đang có người khác làm. |
| 7 | **`t21` đang vi phạm chính luật Ruling T9-e**: 16 route, `t21` gọi tới 9. Không lưới hình dạng nào cho `POST /auth/otp/request` và **cả năm route `/join-requests`**. | Lớp vỏ HTTP — chỗ dữ liệu thật sự rời máy chủ | `t08` có kiểm nội dung (không rò số điện thoại) cho `GET /join-requests/:id`, nên phần nguy hiểm nhất đã có lưới; cái thiếu là hình dạng tên khoá. Sửa rất rẻ: thêm `assertSnakeKeys` vào các bài `t08` đã có. |
| 8 | **`t06` bài 3 — khẳng định không thể đỏ.** `envelope()` được gọi không truyền `values`, nên `value === null` đúng ở cả hai nhánh. Bài mang tên *"value luôn null ở mọi trạng thái"* mà không thể đỏ. | Nguyên tắc 4 | Cổng `inline` **có** lưới ở `t13-privacy-eight-fields`, nên dự án không mù. Nhưng nên sửa vì một bài không thể đỏ là bài **dập tắt câu hỏi** — đúng loại tệ nhất trong ba loại đã gặp. Sửa một dòng: truyền `{ phone: '0912…' }` vào `envelope()`. |
| 9 | **Bảy khẳng định dùng mẫu regex RỘNG** (`/violates foreign key/i`, `/duplicate key\|unique/i`) ở `t08`, `t12-work-edge` (×3), `t13-no-anonymous` (×2), `t13-three-consents`, `t16`. Chúng xanh với **bất kỳ** lỗi cùng họ nào, kể cả lỗi chẳng liên quan. | Chi tiết kỹ thuật | Task 13 đã sửa đúng một chỗ như vậy (`t13-signature-removal`) và để lại khuôn mẫu: khẳng định **tên ràng buộc đích danh**. Bảy chỗ còn lại chỉ là việc lặp lại khuôn đó. |
| 10 | **`t08` bài "12 THÁNG TRƯỢT" phụ thuộc THÁNG CHẠY.** Lập luận đúng "vì hôm nay là tháng 8"; chạy vào tháng 1–2 thì `now() - 11 months` cùng năm dương lịch và bài không còn phân biệt hai luật. | Nguyên tắc 1 | Lỗ có **hẹn giờ** chứ chưa hỏng. Sửa: gieo theo mốc tuyệt đối (`date_trunc('year', now()) - interval '1 month'`) thay vì mốc tương đối. Kèm theo: `t12-manual-quota` **thiếu hẳn** bài đối xứng "11 tháng vẫn chặn". |
| 11 | **`t22` chỉ kiểm `CORS_ORIGIN` của môi trường TEST.** Đặt `CORS_ORIGIN=*` trong `.env` production thì bài `not.toBe('*')` không chạm tới. | Chi tiết vận hành | Thuộc về kiểm cấu hình triển khai, không phải bộ test đơn vị. Ghi vào README/checklist vận hành (Task 19) thì đúng chỗ hơn. |
| 12 | **`t17` — kênh phụ THỜI GIAN ở `/auth/login`.** Bài `login trả cùng một lỗi cho số lạ và mật khẩu sai` so **câu chữ**, không so **thời gian**; số lạ không chạy `argon2.verify` nên nhanh hơn hẳn. `/auth/register` có sàn 700ms; `/auth/login` không có gì. | Chống dò danh sách thành viên | Đặc tả chỉ đòi cùng thông điệp cho `login`. Nêu ra để người chủ trì quyết, không tự xếp thành lỗi. |
| 13 | **Phép đếm gián tiếp ở `t06` và `t10.5`** — đếm *dòng nhật ký* để chứng minh *không có lời gọi `contact_read`*. Một đường đọc không ghi log làm cả hai con số đứng im. | Nguyên tắc 4 | Đã ghi "minor deferred" từ Task 6; hôm nay `app_role` không có `SELECT` trên `member_contacts` nên đường đó phải là một `SECURITY DEFINER` mới — tức phải qua migration, tức có người soát. |
| 14 | **Ba miền lặp lấy từ chính mã đang kiểm** (`t06` `CONTACT_FIELDS`, `t13-privacy-eight-fields` ×2 với `FIELDS`). Xoá một phần tử khỏi hằng số thì vòng lặp tự co lại. | Chi tiết | `expect(FIELDS).toHaveLength(8)` và `t16` (8 hàng `privacy_settings` từ CSDL) đã bù phần lớn. |
| 15 | **`pg_locks` được đếm TOÀN CỤM** trong hai bài chạy đua (`t08`, `t12-manual-quota`), không lọc theo khoá của chính bài đó. | Chi tiết | Vô hại khi `fileParallelism: false`. Nhưng ai bật song song lên sẽ **làm hai bài đó thành xanh giả trở lại** — đúng thứ Ruling T8-a tốn một vòng để bịt. Nên thêm comment cảnh báo ngay tại `vitest.config.js`. |

---

## 4. Bài nào canh nguồn TỐT — mười hai khuôn mẫu để bắt chước

Đây là phần đáng đọc nhất cho người viết bài test lần sau. Mỗi mục là **một khuôn hình
có tên**, kèm bài thật để mở ra xem.

| # | Khuôn mẫu | Bài mẫu | Vì sao nó canh nguồn |
|---|---|---|---|
| 1 | **Kiểm KẾT QUẢ CUỐI CÙNG mà người thật sự dùng, không kiểm "đã gọi đúng hàm chưa"** | `t02` — đặt mật khẩu chứa `?`, chạy migration, rồi **mở một kết nối TCP thật bằng chính mật khẩu đó** | Không có cách nào giả vờ: hoặc đăng nhập được, hoặc không. So sánh: kiểm "câu SQL trông đúng chưa" sẽ bỏ lọt việc knex thay `?` thành `$1` **bên trong chuỗi literal**. |
| 2 | **Tự CHỨNG MINH TIỀN ĐỀ của mình trước khi tin vào kết quả** | `t18` bài 2 — ép pool `{min:1,max:1}` rồi **đối chiếu `pg_backend_pid()`**: nếu giả định "cùng một kết nối vật lý" sai thì bài **thất bại rõ ràng**, không lặng lẽ xanh | Bài cũ không phân biệt được "dấu tự hủy đúng ngữ nghĩa" với "trúng một kết nối khác chưa từng đóng dấu". |
| 3 | **Soi CÁI THỰC SỰ ĐƯỢC GHI RA, không mock rồi kiểm tham số truyền vào** | `t20` — dựng `pino` thật với `pinoHttpOptions` **import từ production**, ghi vào stream trong bộ nhớ, đọc chuỗi JSON cuối cùng, rồi `JSON.stringify` lại lần nữa để bắt giá trị lồng sâu | Mock rồi kiểm tham số chỉ kiểm **cái ta đưa vào**, không kiểm cái bộ tuần tự thực sự nhả ra. |
| 4 | **Bài đồng thời phải có ĐIỂM ĐỒNG BỘ QUAN SÁT ĐƯỢC TỪ MÁY CHỦ** | `t08` và `t12-manual-quota` — đọc `pg_locks … NOT granted` bằng kết nối thứ ba, chỉ commit khi giao dịch kia **thật sự đang xếp hàng** | Xếp lịch promise trong Node **không** phải điểm đồng bộ (Ruling T8-a): bài sẽ "đúng kết quả vì lý do sai" và không phân biệt được hai lý do. |
| 5 | **Kèm BẰNG CHỨNG ĐỐI CHỨNG rằng nguồn không rỗng** | `t08` `applicant_data không bao giờ rời máy chủ nguyên vẹn` — `not.toContain(phone)` **cộng với** một câu đọc CSDL chứng minh số điện thoại thật **đang** nằm ở `join_request_secrets` | `not.toContain` một mình xanh y hệt khi cột đã rỗng vì lý do khác. Đối chứng biến nó thành bằng chứng về **lớp lọc**. |
| 6 | **ĐI VÒNG QUA đúng lớp mà mình không muốn phải tin** | `t10` `contact_read (tầng CSDL) tự chặn, không dựa vào service` — gọi thẳng hàm CSDL, bỏ qua service | Nếu chỉ gọi qua service, ta chỉ chứng minh service đang kiểm — mà route thứ hai viết ngày mai sẽ không có câu kiểm đó. |
| 7 | **Khẳng định TÊN RÀNG BUỘC ĐÍCH DANH, không dùng mẫu rộng** | `t13-signature-removal` `approver của CỘNG ĐỒNG KHÁC không ký được` → `fund_entry_approvals_approver_id_community_id_fkey` | Bản đầu khớp `/foreign key\|FUND_TWO/i` và xanh với **bất kỳ** lỗi khoá ngoại nào, kể cả lỗi chẳng liên quan. Đã sửa ở Task 13; bảy chỗ khác trong bộ vẫn chưa. |
| 8 | **Canh cả CHIỀU NGƯỢC — luật có chạm nhầm chỗ không** | `t13-fund` `bút toán CHƯA khóa vẫn sửa được`; `t12-manual-quota` `approver hợp lệ ⇒ duyệt được`; `t13-guards-ab` `đổi ý trên ảnh CHƯA duyệt thì tự do` | Thiếu vế này thì cả nhóm bài "phải bị chặn" vẫn xanh **kể cả khi trigger chặn sạch mọi thao tác** — tức luật chưa từng có cơ hội chạy đúng lần nào. |
| 9 | **Bịt KÊNH PHỤ, không chỉ che giá trị** | `t13-privacy-eight-fields` `job closed: lọc theo nghề KHÔNG tìm thấy nữa` | Che giá trị mà để hở bộ lọc là che một nửa: `?job=Bac si` đọc lại đúng trường vừa che, chỉ khác là đọc bằng phép thử-và-loại. |
| 10 | **Dựng ĐÚNG HÌNH DẠNG DỮ LIỆU mà lỗi cần để lộ ra** | `t12-manual-quota` `bản ghi BA NGƯỜI…` — chọn id `z` sao cho cặp `(min,max)` **khác** cặp `(x,y)`; `t12-work-edge` `ba người: thiếu MỘT người` | Một bản ghi ba người *bất kỳ* sẽ không lộ lỗi "chỉ canh cặp (min,max)". Bài test phải biết hình dạng của lỗi nó đi tìm. |
| 11 | **Canh THUẬT TOÁN, không chỉ canh hai đầu vào dễ** | `t22` `gốc chỉ TRÙNG TIỀN TỐ vẫn bị từ chối`; `t16` `tên trường ngoài danh sách trắng bị chặn TRƯỚC format(%I)` (kèm một chuỗi tiêm SQL thật) | Hai đầu vào "hợp lệ" và "hoàn toàn lạ" xanh với cả `===` lẫn `startsWith`. Chỉ đầu vào **trùng tiền tố** phân biệt được hai thuật toán. |
| 12 | **ÉP NHÁNH HIẾM chạy thật, thay vì tin nó có ở đó** | `t00` bài 3 — tự `REVOKE SELECT` để nhánh `catch()` thật sự chạy; `t19` bài 2 — gỡ `req.log` để kiểm đường rơi về `console.error` | Nhánh xử lý lỗi là nhánh **không bao giờ chạy trong lúc mọi thứ bình thường**, nên nó cũng là nhánh dễ hỏng nhất mà không ai biết. |

Hai khuôn phụ đáng ghi thêm:

- **Canh một BẢN VÁ, không canh một tính năng.** `t13-contact-read-survives` chạy
  `resetDb()` (áp đủ 29 migration) rồi mới hỏi — nên mọi lần `CREATE OR REPLACE` về sau
  đều phải đi qua nó. Bản vá bị ghi đè trong im lặng là chế độ hỏng riêng của
  `CREATE OR REPLACE`, và nó cần một bài riêng.
- **KHAI BÁO TRUNG THỰC khi một lưới chỉ canh cách viết.** `t13-contact-read-survives`
  bài 4 và `t17` bài `mã OTP được băm bằng argon2` đều nói thẳng trong comment rằng chúng
  canh cái gì và **không** canh cái gì. Một cái tên hứa đúng còn quý hơn một cái lưới
  rộng — Ruling T7-b: *một bài test sai tên tệ hơn không có bài test.*

---

## 5. Bài XANH GIẢ: không tìm thấy — và không sửa bài nào

Đề bài cho phép sửa **chỉ** những bài "thật sự không canh gì": khẳng định luôn đúng bất
kể mã ra sao, `expect` nằm trong nhánh không bao giờ chạy, hoặc bắt ngoại lệ rồi nuốt.
Đã soát cả 290 bài theo ba dấu hiệu đó. **Không bài nào rơi vào loại này**, nên **không
tệp test nào bị sửa** trong task này.

Ba ca **sát ranh giới** đã cân nhắc rồi loại, ghi lại để lần sau không phải cân nhắc lại:

1. **`t06` bài 3 — vòng lặp cuối là một khẳng định KHÔNG THỂ ĐỎ** (`envelope()` gọi
   không có `values` ⇒ `value` là `null` ở cả hai nhánh). Đây đúng là hình dạng đề bài
   mô tả — nhưng nó là **một khẳng định rỗng bên trong một bài có canh thật**: sáu
   khẳng định `state` phía trên chạy thật và đỏ được. Bài không phải xanh giả; nó là bài
   **canh triệu chứng có một khẳng định thừa**. Đã xếp hạng 8 và nêu bản sửa một dòng.
2. **`t13-no-anonymous`** `rows.every(r => r.response === null)` — `Array.every` xanh trên
   mảng rỗng. Nhưng `expect(rows.map(…)).toContain(hoaNgoai)` ngay phía trên đã chứng minh
   mảng không rỗng. Khe hở đóng.
3. **`t07`** `logDenied ghi được dòng dù giao dịch chính vừa rollback` — bài này bắt ngoại
   lệ rồi nuốt (`catch { }`), đúng dấu hiệu thứ ba. Nhưng nó nuốt **có chủ đích và đúng**:
   mục đích của khối `try` là *tạo ra* một giao dịch đã rollback, không phải kiểm nó; phần
   khẳng định nằm sau và chạy thật trên CSDL. Không phải xanh giả — chỉ là bài **không tái
   hiện đúng hình dạng nguy hiểm** (đã ghi ở bảng và ở "minor deferred" Task 4).

**Kết luận cho người đọc sáu tháng nữa:** dự án đã gặp bốn loại lỗi kiểm thử —
**test thiếu** (Ruling T6-a), **test sai tên** (T7-b), **test canh đúng thứ cần canh mà
vẫn không canh gì** (T8-a), và **test đo sai đại lượng** (T13-c). Ba loại đầu đã bị săn
gần hết: lần soát này không tìm thêm được ca nào. Loại thứ tư — đo sai đại lượng — thì
**vẫn còn sống**, và top 5 ở trên đều thuộc về nó. Nó khó thấy hơn ba loại kia vì bài
test **trông** đúng: nó chạy, nó đỏ được, nó có tên khớp assertion. Chỉ khi hỏi *"đại
lượng nó đo có phải là thứ ta thật sự quan tâm không"* thì khoảng cách mới hiện ra.
