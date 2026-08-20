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
