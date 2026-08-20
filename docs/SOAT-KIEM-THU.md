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

### `t08-guarantee-quota.test.js` (26 bÃ i)

Tá»‡p máº¡nh nháº¥t cá»§a bá»™ vá» máº·t canh nguá»“n: gáº§n nhÆ° má»i bÃ i Ä‘á»u **cháº¡y SQL tháº­t vÃ  Ä‘á»ƒ CSDL
tá»± tá»« chá»‘i**, chá»© khÃ´ng kiá»ƒm ráº±ng service cÃ³ gá»i Ä‘Ãºng hÃ m.

| TÃªn bÃ i | Canh gÃ¬ | N/T | Lá»— mÃ¹ cá»¥ thá»ƒ |
|---|---|---|---|
| `Ä‘Æ¡n thá»© tÆ° trong 12 thÃ¡ng bá»‹ cháº·n` | `INSERT` tháº­t â‡’ trigger nÃ©m | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `cá»­a sá»• lÃ  12 THÃNG TRÆ¯á»¢T: ba Ä‘Æ¡n cá»§a 11 thÃ¡ng trÆ°á»›c váº«n cháº·n` | Gieo `now() - interval '11 months'` â€” **dá»¯ liá»‡u duy nháº¥t phÃ¢n biá»‡t** "12 thÃ¡ng trÆ°á»£t" vá»›i "má»—i nÄƒm dÆ°Æ¡ng lá»‹ch" | **N** | **Phá»¥ thuá»™c ngÃ y cháº¡y.** Comment tá»± khai láº­p luáº­n Ä‘Ãºng "vÃ¬ hÃ´m nay lÃ  thÃ¡ng 8". Cháº¡y suite vÃ o thÃ¡ng 1â€“2 thÃ¬ `now() - 11 months` rÆ¡i vÃ o **cÃ¹ng** nÄƒm dÆ°Æ¡ng lá»‹ch, vÃ  bÃ i nÃ y khÃ´ng cÃ²n phÃ¢n biá»‡t Ä‘Æ°á»£c hai luáº­t â€” nÃ³ váº«n xanh vá»›i luáº­t sai. Lá»— mÃ¹ cÃ³ **háº¹n giá»**. |
| `Ä‘Æ¡n cÅ© hÆ¡n 12 thÃ¡ng thÃ¬ rÆ¡i ra khá»i cá»­a sá»•` | `13 months` tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `hai giao dá»‹ch Äá»’NG THá»œI cÃ¹ng tranh suáº¥t cuá»‘i` | Äiá»ƒm Ä‘á»“ng bá»™ **quan sÃ¡t Ä‘Æ°á»£c tá»« mÃ¡y chá»§** (`pg_locks â€¦ NOT granted`) | **N** | Máº«u tá»‘t nháº¥t dá»± Ã¡n cho bÃ i Ä‘á»“ng thá»i (Ruling T8-a). Äiá»ƒm yáº¿u cÃ²n láº¡i: `pg_locks` Ä‘Æ°á»£c Ä‘áº¿m **toÃ n cá»¥m**, khÃ´ng lá»c theo khoÃ¡ cá»§a chÃ­nh bÃ i nÃ y â€” má»™t khoÃ¡ tÆ° váº¥n Ä‘ang chá» á»Ÿ tá»‡p khÃ¡c sáº½ lÃ m `blocked = true` sai. Hiá»‡n `fileParallelism: false` nÃªn khÃ´ng xáº£y ra; ai báº­t song song lÃªn thÃ¬ bÃ i nÃ y thÃ nh xanh giáº£ trá»Ÿ láº¡i. |
| `lÃ¡ch báº±ng draft rá»“i Ä‘áº©y lÃªn pending cÅ©ng bá»‹ cháº·n` | `UPDATE â€¦ status` tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `rejected thÆ°á»ng TRáº¢ Láº I suáº¥t` | Tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `rejected vÃ¬ referrer_misrepresented thÃ¬ KHÃ”NG tráº£ láº¡i suáº¥t` | Tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `referrer_id IS NULL â‡’ REFERRER_REQUIRED` | Tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch (nguyÃªn táº¯c 1). |
| `guarantee_quota_overrides ná»›i Ä‘Ãºng sá»‘ suáº¥t, háº¿t hiá»‡u lá»±c theo valid_until` | Tháº­t, ba giai Ä‘oáº¡n | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `Ä‘Æ¡n cá»§a cá»™ng Ä‘á»“ng nÃ y khÃ´ng trá» Ä‘Æ°á»£c ngÆ°á»i báº£o lÃ£nh sang cá»™ng Ä‘á»“ng khÃ¡c` | `INSERT` tháº­t | **N/T** | Kháº³ng Ä‘á»‹nh `toThrow(/jr_referrer_same_community\|violates foreign key/i)` â€” **nhÃ¡nh thá»© hai lÃ  máº«u rá»™ng**. Äá»•i khoÃ¡ ghÃ©p vá» Ä‘Æ¡n cá»™t mÃ  cÃ¢u váº«n há»ng vÃ¬ **má»™t** khoÃ¡ ngoáº¡i khÃ¡c (vd. `community_id`) â‡’ váº«n xanh. ÄÃºng loáº¡i lá»—i Ä‘Ã£ bá»‹ sá»­a á»Ÿ `t13-signature-removal`. |
| `háº¡n má»©c Ä‘á»c tá»« communities.config, khÃ´ng pháº£i háº±ng sá»‘ trong mÃ£` | Äá»•i `config` tháº­t rá»“i thá»­ | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. Máº«u tá»‘t: phÃ¢n biá»‡t Ä‘Æ°á»£c "Ä‘á»c cáº¥u hÃ¬nh" vá»›i "háº±ng sá»‘ tÃ¬nh cá» báº±ng 3". |
| `members.status=member khi chÆ°a cÃ³ xÃ¡c nháº­n gáº·p máº·t â‡’ há»ng lÃºc COMMIT` | Dáº¡ng **callback** `db.transaction(...)`, cÃ²n kháº³ng Ä‘á»‹nh `insertResolved === true` Ä‘á»ƒ chá»©ng minh há»ng Ä‘Ãºng á»Ÿ COMMIT | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. Ruling C11 Ä‘Æ°á»£c thi cÃ´ng Ä‘Ãºng. |
| `Ä‘áº·t join_requests.member_id trong CÃ™NG giao dá»‹ch thÃ¬ COMMIT qua Ä‘Æ°á»£c` | Tháº­t | **N** | Äá»‘i chá»©ng cho bÃ i trÃªn â€” khÃ´ng cÃ³ nÃ³ thÃ¬ bÃ i trÃªn xanh cáº£ khi trigger cháº·n **má»i** lÆ°á»£t. |
| `Ä‘á»•i referrer_id cá»§a má»™t hÃ ng status=member â‡’ REFERRER_FROZEN` | Tháº­t, kÃ¨m Ä‘á»‘i chá»©ng `guest` váº«n Ä‘á»•i Ä‘Æ°á»£c | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `ná»™p Ä‘Æ¡n há»£p lá»‡: tráº£ join_request_id + step, ghi join_request.created` | Qua HTTP tháº­t (supertest), Ä‘á»c `audit_log` tháº­t | **N** | `expect(JSON.stringify(detail)).not.toContain(phone)` lÃ  **danh sÃ¡ch cáº¥m má»™t chuá»—i**: ghi sá»‘ Ä‘Ã£ bÄƒm/Ä‘áº£o/cáº¯t vÃ o `detail` thÃ¬ váº«n xanh. Nhá», vÃ¬ `assertSafeDetail` cháº¯n phÃ­a sau. |
| `otp_token khÃ´ng dÃ¹ng láº¡i Ä‘Æ°á»£c cho Ä‘Æ¡n thá»© hai` | HTTP tháº­t, hai láº§n | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `ba nhÃ¡nh há»ng tráº£ CÃ™NG mÃ£, CÃ™NG cÃ¢u, cÃ¹ng sÃ n thá»i gian` | HTTP tháº­t Ã—3; kháº³ng Ä‘á»‹nh theo háº±ng sá»‘ `REGISTER_MIN_MS` **xuáº¥t tá»« mÃ£**, khÃ´ng chÃ©p sá»‘ | **N/T** | Äo **sÃ n**, khÃ´ng Ä‘o **phÆ°Æ¡ng sai**. Náº¿u má»™t nhÃ¡nh cháº­m hÆ¡n háº³n sÃ n (Ä‘Ãºng thá»© Ruling T8-b lo), cáº£ ba váº«n `>= REGISTER_MIN_MS` â‡’ xanh. ÄÆ°á»ng lÃ¡ch: lÃ m nhÃ¡nh 3 máº¥t 2000ms â‡’ váº«n xanh, mÃ  káº» dÃ² láº¡i phÃ¢n biá»‡t Ä‘Æ°á»£c ba nhÃ¡nh báº±ng Ä‘á»“ng há»“. ChÃªnh lá»‡ch **giá»¯a** cÃ¡c nhÃ¡nh khÃ´ng há» Ä‘Æ°á»£c kháº³ng Ä‘á»‹nh. |
| `sai nÄƒm sinh thÃ¬ bÃ¡o Ä‘Ãºng lá»—i Ä‘Ã³ vÃ  KHÃ”NG tiÃªu vÃ© OTP` | HTTP tháº­t, dÃ¹ng láº¡i vÃ© | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `danh sÃ¡ch: approver xem Ä‘Æ°á»£c, member thÆ°á»ng thÃ¬ khÃ´ng` | HTTP tháº­t Ã—2 vai + Ä‘áº¿m dÃ²ng nháº­t kÃ½ | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `applicant_data khÃ´ng bao giá» rá»i mÃ¡y chá»§ nguyÃªn váº¹n` | Kiá»ƒm lá»›p lá»c **kÃ¨m báº±ng chá»©ng Ä‘á»‘i chá»©ng** ráº±ng dá»¯ liá»‡u thÃ´ Ä‘ang tháº­t sá»± náº±m trong CSDL | **N** | Máº«u ráº¥t tá»‘t: `not.toContain` má»™t mÃ¬nh lÃ  danh sÃ¡ch cáº¥m, nhÆ°ng bÃ i nÃ y **chá»©ng minh cá»™t nguá»“n khÃ´ng rá»—ng** nÃªn `not.toContain` má»›i cÃ³ sá»©c náº·ng. ÄÃºng cÃ¡ch vÃ¡ dáº¡ng "kiá»ƒm má»™t cá»™t rá»—ng rá»“i tÆ°á»Ÿng Ä‘Ã£ kiá»ƒm lá»›p lá»c". |
| `ngÆ°á»i láº¡ khÃ´ng xem Ä‘Æ°á»£c Ä‘Æ¡n cá»§a ngÆ°á»i khÃ¡c` | HTTP tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `confirm-met bá»Ÿi ngÆ°á»i KHÃ”NG pháº£i ngÆ°á»i báº£o lÃ£nh â‡’ tá»« chá»‘i + nháº­t kÃ½` | HTTP tháº­t, `waitForRow` nháº¯m **Ä‘Ãºng** action | **N** | Comment tá»± nÃªu vÃ  tá»± trÃ¡nh báº«y "lá»c rá»™ng lÃ m `waitForRow` vÃ´ dá»¥ng". Máº«u tá»‘t. |
| `confirm-met bá»Ÿi Ä‘Ãºng ngÆ°á»i báº£o lÃ£nh â‡’ met_confirmed + nháº­t kÃ½` | HTTP tháº­t, Ä‘á»c cá»™t tháº­t | **N** | `not.toContain('nha van hoa')` láº¡i lÃ  danh sÃ¡ch cáº¥m má»™t chuá»—i. Nhá». |
| `ghi chÃº ngáº¯n hÆ¡n 20 kÃ½ tá»± bá»‹ cháº·n ngay á»Ÿ zod` | HTTP tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `reject: approver ghi reason_code; member thÆ°á»ng bá»‹ cháº·n` | HTTP tháº­t Ã—2 vai | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `approve Ä‘Æ¡n Ä‘Ã£ bá»‹ tá»« chá»‘i â‡’ 422, khÃ´ng táº¡o thÃ nh viÃªn` | HTTP tháº­t + Ä‘áº¿m `members` trÆ°á»›c/sau | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |

### `t10-grants.test.js` (3 bÃ i)

| TÃªn bÃ i | Canh gÃ¬ | N/T | Lá»— mÃ¹ cá»¥ thá»ƒ |
|---|---|---|---|
| `má»i báº£ng vÃ  view public Ä‘á»u cÃ³ máº·t trong expected-grants.json` | Duyá»‡t `pg_class` tháº­t â‡’ báº£ng/view má»›i **báº¯t buá»™c pháº£i khai** | **N** | Máº«u ráº¥t tá»‘t: biáº¿n "quÃªn khai" thÃ nh Ä‘á». Lá»— mÃ¹ cÃ²n láº¡i: chá»‰ Ä‘áº¿m `relkind IN ('r','p','v')` â€” **`m` (materialized view) vÃ  `f` (foreign table) khÃ´ng náº±m trong danh sÃ¡ch**, nÃªn má»™t matview Ä‘á»c `member_contacts` sáº½ khÃ´ng bá»‹ ai Ä‘áº¿m. |
| `quyá»n thá»±c táº¿ khá»›p khai bÃ¡o â€” ká»ƒ cáº£ phÃ¢n máº£nh` | So `information_schema.table_privileges` **tháº­t** vá»›i JSON khai bÃ¡o | **N/T** | Chá»‰ soi `grantee = 'app_role'`. Quyá»n cáº¥p cho **`PUBLIC`** (mÃ  `app_role` hÆ°á»Ÿng theo) lÃ  **vÃ´ hÃ¬nh**: `GRANT SELECT ON member_contacts TO PUBLIC` â‡’ **váº«n xanh**, trong khi `app_role` Ä‘á»c Ä‘Æ°á»£c sá»‘ Ä‘iá»‡n thoáº¡i. CÅ©ng bá» qua quyá»n cáº¥p theo **cá»™t** (`GRANT SELECT (phone) ON â€¦`) vÃ¬ thá»© Ä‘Ã³ náº±m á»Ÿ `column_privileges`, khÃ´ng á»Ÿ `table_privileges`. Hai Ä‘Æ°á»ng lÃ¡ch nÃ y Ä‘i tháº³ng vÃ o nguyÃªn táº¯c 4. |
| `má»i phÃ¢n máº£nh audit_log cÅ©ng chá»‰ cÃ³ SELECT, INSERT` | Duyá»‡t `pg_inherits` tháº­t, cÃ³ `expect(rows.length).toBeGreaterThan(0)` chá»‘ng vÃ²ng láº·p rá»—ng | **N/T** | CÃ¹ng lá»— `PUBLIC` nhÆ° trÃªn. |

### `t11-audit-detail.test.js` (20 bÃ i: 3 bÃ i Ä‘Æ¡n + 15 ca `it.each` + 2 bÃ i biÃªn)

BÃ i nÃ y bá»‹ nghi sáºµn trong Ä‘á» bÃ i. Káº¿t luáº­n: **nÃ³ canh nguá»“n cho Ä‘Ãºng thá»© nÃ³ Ä‘o (hÃ¬nh
dáº¡ng CHá»® Sá»), nhÆ°ng thá»© nÃ³ Ä‘o chá»‰ lÃ  má»™t gÃ³c cá»§a Ä‘iá»u nÃ³ tuyÃªn bá»‘** ("`detail` khÃ´ng
chá»©a dá»¯ liá»‡u cÃ¡ nhÃ¢n"). Ba Ä‘Æ°á»ng lÃ¡ch dÆ°á»›i Ä‘Ã¢y **Ä‘Ã£ kiá»ƒm báº±ng cháº¡y tháº­t**, khÃ´ng suy Ä‘oÃ¡n.

| TÃªn bÃ i | Canh gÃ¬ | N/T | Lá»— mÃ¹ cá»¥ thá»ƒ |
|---|---|---|---|
| `cháº¥p nháº­n tÃªn trÆ°á»ng, uuid, sá»‘ Ä‘áº¿m, HMAC` | `assertSafeDetail` tháº­t | **N** | â€” |
| `tá»« chá»‘i sá»‘ Ä‘iá»‡n thoáº¡i thÃ´` | tháº­t | **N** | â€” |
| `tá»« chá»‘i cÃ¢u vÄƒn tá»± do` | tháº­t | **N** | CÃ¢u thá»­ cÃ³ **khoáº£ng tráº¯ng vÃ  dáº¥u tiáº¿ng Viá»‡t** â€” nÃ³ khÃ´ng chá»©ng minh Ä‘Æ°á»£c gÃ¬ vá» vÄƒn tá»± do **khÃ´ng dáº¥u, khÃ´ng khoáº£ng tráº¯ng** (hÃ ng cuá»‘i báº£ng). |
| `cho qua: â€¦` (8 ca `it.each`) | tháº­t | **N** | â€” |
| `tá»« chá»‘i: â€¦` (7 ca `it.each`) | tháº­t | **N** | â€” |
| `uuid váº«n Ä‘Æ°á»£c cháº¥p nháº­n dÃ¹ toÃ n chá»¯ sá»‘ + gáº¡ch ngang` | tháº­t, khoÃ¡ **thá»© tá»± nhÃ¡nh** trong `z.union` | **N** | Máº«u tá»‘t: canh thá»© tá»± nhÃ¡nh, khÃ´ng chá»‰ káº¿t quáº£. |
| `bÄƒm HMAC-SHA256 64 hex váº«n Ä‘Æ°á»£c cháº¥p nháº­n` | tháº­t | **N** | â€” |
| **Cáº£ tá»‡p, xÃ©t theo tuyÃªn bá»‘ "detail khÃ´ng chá»©a dá»¯ liá»‡u cÃ¡ nhÃ¢n"** | â€” | **T** | **Ba Ä‘Æ°á»ng lÃ¡ch, Ä‘Ã£ cháº¡y tháº­t, cáº£ ba Ä‘á»u Lá»ŒT:**<br>1. **KhoÃ¡ khÃ´ng bá»‹ kiá»ƒm gÃ¬ cáº£.** `detailSchema = z.record(<value>)` chá»‰ rÃ ng buá»™c *giÃ¡ trá»‹*; `assertSafeDetail({ '0912345678': true })` **qua**.<br>2. **Sá»‘ kiá»ƒu `number` khÃ´ng bá»‹ kiá»ƒm.** NhÃ¡nh `z.number()` nháº­n má»i sá»‘: `{ phone: 912345678 }` vÃ  `{ v: 123456789012 }` **qua** â€” vÃ  `parseInt(phone)` lÃ  Ä‘Ãºng thá»© má»™t láº­p trÃ¬nh viÃªn vÃ´ Ã½ sáº½ viáº¿t.<br>3. **Chuá»—i chá»¯ khÃ´ng cÃ³ chá»¯ sá»‘ váº«n lÃ  vÄƒn tá»± do.** `{ v: 'NguyenVanA' }`, `{ v: 'so-12-ngo-4-Khoai-Chau' }` **qua** â€” há» tÃªn vÃ  Ä‘á»‹a chá»‰ viáº¿t khÃ´ng dáº¥u, khÃ´ng khoáº£ng tráº¯ng Ä‘i tháº³ng vÃ o nháº­t kÃ½. ÄÃºng Ä‘Æ°á»ng lÃ¡ch Ä‘á» bÃ i dá»± Ä‘oÃ¡n: `regex` chá»‰ khoÃ¡ **táº­p kÃ½ tá»±**, vÃ  má»i Ä‘á»‹nh danh cÃ¡ nhÃ¢n **khÃ´ng pháº£i dáº¡ng sá»‘** náº±m gá»n trong táº­p Ä‘Ã³. |

### `t10-directory.test.js` (28 bÃ i)

| TÃªn bÃ i | Canh gÃ¬ | N/T | Lá»— mÃ¹ cá»¥ thá»ƒ |
|---|---|---|---|
| `má»i trÆ°á»ng cá»§a má»i ngÆ°á»i trong trang Ä‘á»u cÃ³ value === null` | `members.list()` tháº­t; cÃ³ Ä‘á»‘i chá»©ng `fieldCount === data.length * 4` | **N/T** | Äá»‘i chá»©ng `Ã—4` lÃ  máº«u tá»‘t (chá»‘ng vÃ²ng láº·p rá»—ng, khoÃ¡ luÃ´n kÃ­ch thÆ°á»›c `CONTACT_FIELDS`). NhÆ°ng **cá»•ng tháº­t â€” cá» `inline` trong `FIELD_SPEC` â€” váº«n khÃ´ng bá»‹ cháº¡m**: `profileValues()` khÃ´ng mang `phone`, nÃªn Ä‘áº·t `phone: { inline: true }` thÃ¬ `values['phone'] ?? null` váº«n ra `null` â‡’ xanh. **ToÃ n dá»± Ã¡n khÃ´ng cÃ³ bÃ i nÃ o Ã©p nhÃ¡nh `allowed === true` cá»§a `envelope()` cháº¡y trÃªn má»™t trÆ°á»ng liÃªn há»‡.** |
| `cÃ³ Ã­t nháº¥t má»™t trÆ°á»ng state="visible" â€” vÃ  nÃ³ váº«n value null` | Tháº­t, cÃ³ Ä‘á»‘i chá»©ng `visible.length > 0` | **N** | CÃ¹ng lá»— `inline`; ngoÃ i ra chÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `há»“ sÆ¡ chi tiáº¿t cÅ©ng khÃ´ng tráº£ value, vÃ  khÃ´ng tráº£ email/lat/lng/password_hash` | Tháº­t, **khoÃ¡ danh sÃ¡ch khoÃ¡ báº±ng `toEqual`**, khÃ´ng pháº£i `toMatchObject` | **N** | Máº«u ráº¥t tá»‘t â€” `toEqual` trÃªn `Object.keys().sort()` biáº¿n "thÃªm má»™t trÆ°á»ng ra vá»" thÃ nh Ä‘á», tá»©c bá»‹t Ä‘Ãºng lá»— Ruling T9-e á»Ÿ táº§ng service. |
| `phone má»©c on_consent chÆ°a xin: CONTACT_NEEDS_CONSENT vÃ  dÃ²ng contact.denied Sá»NG SÃ“T` | Äáº¿m `contact.denied` trÆ°á»›c/sau **quanh má»™t lá»i gá»i nÃ©m lá»—i** | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. ÄÃ¢y lÃ  bÃ i canh báº«y má»¥c 3 (Ruling T10-b) **Ä‘Ãºng hÃ¬nh dáº¡ng nguy hiá»ƒm** â€” khÃ¡c háº³n bÃ i cÃ¹ng tÃªn Ã½ á»Ÿ `t07`. |
| `address má»©c closed: CONTACT_CLOSED vÃ  dÃ²ng contact.denied cÅ©ng sá»‘ng sÃ³t` | NhÆ° trÃªn | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `Ä‘Æ°á»£c phÃ©p Ä‘á»c: tráº£ giÃ¡ trá»‹ tháº­t vÃ  ghi contact.read` | Tháº­t, `toEqual({value:'0912000002'})` | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `tá»± Ä‘á»c liÃªn há»‡ cá»§a chÃ­nh mÃ¬nh luÃ´n Ä‘Æ°á»£c` | Tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `khÃ´ng cÃ³ ngÆ°á»i cá»§a cá»™ng Ä‘á»“ng khÃ¡c trong danh sÃ¡ch, dÃ¹ trÃ¹ng nghá»` | Tháº­t, gieo Eve **trÃ¹ng nghá»** Ä‘á»ƒ bá»™ lá»c khÃ´ng tá»± loáº¡i giÃ¹m | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `lá»c theo area_id chá»‰ tráº£ ngÆ°á»i cá»§a Ä‘Ãºng khu vá»±c Ä‘Ã³` | Tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `area_id cá»§a cá»™ng Ä‘á»“ng khÃ¡c tráº£ 0 ngÆ°á»i, khÃ´ng tráº£ Eve` | Tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `lá»c theo status: guest tÃ¡ch khá»i member` | Tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `KHÃ”NG khai status thÃ¬ máº·c Ä‘á»‹nh chá»‰ tráº£ member` | Tháº­t, kÃ¨m Ä‘á»‘i chá»©ng "khai rÃµ thÃ¬ váº«n xem Ä‘Æ°á»£c" | **N** | KhÃ´ng phá»§ `left` â€” chá»‰ phá»§ `guest`. Ruling T10-d nÃªu cáº£ hai; luá»“ng "rá»i cá»™ng Ä‘á»“ng" chÆ°a tá»“n táº¡i nÃªn Ä‘Ã¢y lÃ  ná»£ chá»© chÆ°a pháº£i lá»—. |
| `lá»c theo work_status` | Tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `q tÃ¬m theo tÃªn, bá» dáº¥u` | Tháº­t | **T** | Dá»¯ liá»‡u thá»­ lÃ  `'carol'` â€” **khÃ´ng cÃ³ dáº¥u tiáº¿ng Viá»‡t nÃ o**. Gá»¡ `unaccent`/`lower` ra thÃ¬ bÃ i váº«n xanh. **BÃ i test sai tÃªn** (cÃ¹ng loáº¡i Ruling T7-b): nÃ³ há»©a canh "bá» dáº¥u" mÃ  khÃ´ng cÃ³ dá»¯ liá»‡u nÃ o cháº¡m tá»›i dáº¥u. |
| `kÃ½ tá»± Ä‘áº¡i diá»‡n cá»§a LIKE do ngÆ°á»i dÃ¹ng gÃµ bá»‹ thoÃ¡t` | Tháº­t, `job: '%'` â‡’ rá»—ng | **N** | KhÃ´ng thá»­ `_` (Ä‘áº¡i diá»‡n má»™t kÃ½ tá»±) dÃ¹ `likeLiteral` thoÃ¡t cáº£ hai â€” ná»­a cÆ¡ cháº¿ khÃ´ng cÃ³ lÆ°á»›i. |
| `phÃ¢n trang: hai trang rá»i nhau, tá»•ng Ä‘Ãºng ká»ƒ cáº£ khi trang vÆ°á»£t cuá»‘i` | Tháº­t, 4 kháº³ng Ä‘á»‹nh Ä‘á»™c láº­p | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `readContactField vá»›i ngÆ°á»i cá»§a cá»™ng Ä‘á»“ng khÃ¡c tráº£ NOT_FOUND` | Tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `contact_read (táº§ng CSDL) tá»± cháº·n, khÃ´ng dá»±a vÃ o service` | Gá»i **tháº³ng hÃ m CSDL**, bá» qua service | **N** | Máº«u tá»‘t nháº¥t cho cÃ¢u "CSDL cháº·n, khÃ´ng pháº£i service cháº·n": nÃ³ cá»‘ Ã½ Ä‘i vÃ²ng qua Ä‘Ãºng lá»›p mÃ  nÃ³ khÃ´ng muá»‘n pháº£i tin. |
| `contactStates() lá»c community_id, khÃ´ng chá»‰ lá»c theo danh sÃ¡ch id` | Tháº­t, **kÃ¨m Ä‘á»‘i chá»©ng** vá»›i Ä‘Ãºng cá»™ng Ä‘á»“ng | **N** | Máº«u tá»‘t: Ä‘á»‘i chá»©ng chá»©ng minh bÃ i trÃªn Ä‘á» vÃ¬ bá»™ lá»c chá»© khÃ´ng vÃ¬ dá»¯ liá»‡u rá»—ng â€” Ä‘Ãºng ká»· luáº­t Ruling T8-a. |
| `contactStates() tá»« chá»‘i cháº¡y khi thiáº¿u communityId` | Tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `GET há»“ sÆ¡ ngÆ°á»i cá»§a cá»™ng Ä‘á»“ng khÃ¡c tráº£ NOT_FOUND` | Tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `má»Ÿ má»™t trang 12 ngÆ°á»i sinh Ä‘Ãºng Má»˜T dÃ²ng member.list` | Äáº¿m tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `má»Ÿ má»™t trang KHÃ”NG sinh dÃ²ng contact.read/contact.denied nÃ o` | Äáº¿m **dÃ²ng nháº­t kÃ½** trÆ°á»›c/sau | **T** | CÃ¹ng lá»— vá»›i `t06`: Ä‘áº¿m *nháº­t kÃ½*, khÃ´ng Ä‘áº¿m *sá»‘ cÃ¢u SQL / báº£ng bá»‹ cháº¡m*. Má»™t Ä‘Æ°á»ng Ä‘á»c `member_contacts` **khÃ´ng ghi log** (hÃ m `SECURITY DEFINER` má»›i) lÃ m cáº£ hai con sá»‘ Ä‘á»©ng im â‡’ xanh, trong khi N+1 vÃ  lá»— rÃ² Ä‘á»u quay láº¡i. |
| `detail cá»§a member.list chá»‰ chá»©a sá»‘ Ä‘áº¿m/bá»™ lá»c, KHÃ”NG chá»©a chuá»—i tÃ¬m kiáº¿m` | Tháº­t, `has_q`/`has_job` + `not.toContain` chuá»—i ngÆ°á»i gÃµ | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch Ä‘Ã¡ng ká»ƒ. |
| `xem há»“ sÆ¡ ngÆ°á»i khÃ¡c ghi má»™t hÃ ng profile_views vÃ  má»™t dÃ²ng profile.view` | Äáº¿m tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `tá»± xem há»“ sÆ¡ mÃ¬nh KHÃ”NG ghi profile_views (nhÆ°ng váº«n ghi nháº­t kÃ½)` | Äáº¿m tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `tráº£ cÃ¢y lá»“ng nhau, khÃ´ng láº«n khu vá»±c cá»§a cá»™ng Ä‘á»“ng khÃ¡c` | Tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `gá»i Ä‘Æ°á»£c khi CHÆ¯A Ä‘Äƒng nháº­p â€” khÃ´ng cÃ³ actor váº«n ra cÃ¢y khu vá»±c` | Tháº­t, `actor: undefined` | **N** | **KhÃ´ng kháº³ng Ä‘á»‹nh `lat`/`lng` váº¯ng máº·t**, dÃ¹ Ruling T11-d chá»‘t rÃµ "`lat`/`lng` váº«n khÃ´ng ra tá»›i client". Chá»— Ä‘Ã³ hiá»‡n **khÃ´ng cÃ³ lÆ°á»›i nÃ o**, vÃ  Ä‘Ã¢y láº¡i lÃ  endpoint **cÃ´ng khai**. |

### `t12-trust.test.js` (15 bÃ i)

| TÃªn bÃ i | Canh gÃ¬ | N/T | Lá»— mÃ¹ cá»¥ thá»ƒ |
|---|---|---|---|
| `má»—i ngÆ°á»¡ng cá»§a má»¥c 8.3 vÃ  mÃ©p ngay dÆ°á»›i nÃ³` | `tierOf()` tháº­t, 10 cáº·p gá»“m cáº£ biÃªn | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. Máº«u tá»‘t: thá»­ **mÃ©p dÆ°á»›i** má»—i báº­c, khÃ´ng chá»‰ giá»¯a khoáº£ng. |
| `Ä‘áº§u vÃ o báº©n rÆ¡i vá» báº­c THáº¤P NHáº¤T chá»© khÃ´ng nÃ©m lá»—i` | Tháº­t, 7 giÃ¡ trá»‹ báº©n | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. HÆ°á»›ng tháº¥t báº¡i chá»n Ä‘Ãºng (an toÃ n = báº­c tháº¥p). |
| `TIERS xáº¿p tÄƒng dáº§n vÃ  cÃ³ nhÃ£n tiáº¿ng Viá»‡t` | Tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `khÃ´ng migration nÃ o chÃ©p láº¡i tÃªn báº­c hay ngÆ°á»¡ng` | **QuÃ©t mÃ£ nguá»“n** migration tÃ¬m 5 chuá»—i | **T** | Canh má»™t **CÃCH VIáº¾T**. Ba Ä‘Æ°á»ng lÃ¡ch: migration viáº¿t `CASE WHEN confirmed_works >= 100 THEN 'Kim CÆ°Æ¡ng'` (nhÃ£n tiáº¿ng Viá»‡t, khÃ´ng pháº£i khoÃ¡); hoáº·c `THEN 4` (báº­c dáº¡ng sá»‘); hoáº·c nhÃ©t ngÆ°á»¡ng vÃ o `communities.config`. **Cáº£ ba Ä‘á»u xanh**, trong khi ngÆ°á»¡ng Ä‘Ã£ cÃ³ hai nÆ¡i quyáº¿t Ä‘á»‹nh â€” Ä‘Ãºng thá»© bÃ i nÃ y nÃ³i nÃ³ chá»‘ng. |
| `thiáº¿u má»™t chá»¯ kÃ½ thÃ¬ viá»‡c KHÃ”NG Ä‘Æ°á»£c tÃ­nh` | CSDL tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `Ä‘á»§ chá»¯ kÃ½ thÃ¬ viá»‡c Ä‘Æ°á»£c tÃ­nh cho Má»ŒI ngÆ°á»i tham gia` | CSDL tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `manual CHÆ¯A qua approver: vÃ o manual_works, KHÃ”NG vÃ o confirmed_works` | CSDL tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch (nguyÃªn táº¯c 5, lá»›p 1). |
| `approver duyá»‡t xong thÃ¬ con sá»‘ Ä‘á»•i NGAY, khÃ´ng pháº£i chá» tÃ¡c vá»¥ 03:15` | CSDL tháº­t, **cá»‘ Ã½ KHÃ”NG gá»i `fn_trust_recount()` báº±ng tay** | **N** | Máº«u tá»‘t: gá»i tay lÃ  tá»± táº¡o ra Ä‘iá»u kiá»‡n mÃ  production khÃ´ng cÃ³. |
| `distinct_requesters / repeat_requesters Ä‘áº¿m ÄÃšNG CHIá»€U` | CSDL tháº­t, kiá»ƒm **cáº£ hai chiá»u** | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. Bá»‹t Ä‘Ãºng Ruling C9 + T12-e. |
| `manual chÆ°a duyá»‡t cÅ©ng khÃ´ng Ä‘áº» ra distinct_requesters` | CSDL tháº­t, kÃ¨m Ä‘á»‘i chá»©ng sau khi duyá»‡t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `app_role khÃ´ng tá»± Ä‘áº·t Ä‘Æ°á»£c con sá»‘ uy tÃ­n cá»§a mÃ¬nh` | `UPDATE` **vÃ ** `INSERT` tháº­t báº±ng `app_role` | **N** | KhÃ´ng thá»­ `DELETE` (xoÃ¡ hÃ ng thá»‘ng kÃª Ä‘á»ƒ reset vá» 0). `t10-grants` phá»§ giÃ¡n tiáº¿p. |
| `khÃ´ng Ä‘áº¿m chÃ©o cá»™ng Ä‘á»“ng` | CSDL tháº­t, kÃ¨m Ä‘á»‘i chá»©ng Ä‘áº¿m báº±ng 0 á»Ÿ cá»™ng Ä‘á»“ng kia | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| **`khÃ´ng truy váº¥n nÃ o trong src/ xáº¿p theo con sá»‘ uy tÃ­n`** (lÆ°á»›i 1) | **QuÃ©t mÃ£ nguá»“n** `api/src/**` báº±ng `order\s+by[^;\n]*\b(confirmed_works\|â€¦\|tier)\b` | **T** | Bá»‘n Ä‘Æ°á»ng lÃ¡ch â€” xem phÃ¢n tÃ­ch ngay dÆ°á»›i báº£ng. |
| **`danh báº¡ xáº¿p theo TÃŠN, vÃ  sá»‘ viá»‡c khÃ´ng lay chuyá»ƒn Ä‘Æ°á»£c thá»© tá»± Ä‘Ã³`** (lÆ°á»›i 2) | Cháº¡y `membersService.list()` **tháº­t**: ngÆ°á»i 3 viá»‡c tÃªn `Zz`, ngÆ°á»i 0 viá»‡c tÃªn `Bb` â€” thá»© tá»± theo tÃªn **ngÆ°á»£c** thá»© tá»± theo sá»‘ viá»‡c | **N** | Chá»‰ phá»§ Ä‘Ãºng má»™t hÃ m. Xem phÃ¢n tÃ­ch ngay dÆ°á»›i. |

#### Hai lÆ°á»›i "khÃ´ng xáº¿p háº¡ng" â€” lÆ°á»›i thá»© hai bá»‹t Ä‘Æ°á»£c gÃ¬, vÃ  chá»— Cáº¢ HAI cÃ¹ng mÃ¹

**LÆ°á»›i 1 (quÃ©t mÃ£) mÃ¹ trÆ°á»›c Ã­t nháº¥t bá»‘n cÃ¡ch xáº¿p háº¡ng:**

1. **`.orderBy('confirmed_works', 'desc')`** â€” knex query builder. Regex Ä‘Ã²i `order\s+by`
   (báº¯t buá»™c cÃ³ khoáº£ng tráº¯ng); `orderBy` viáº¿t liá»n **khÃ´ng khá»›p**. Knex lÃ  query builder
   cá»§a chÃ­nh dá»± Ã¡n nÃ y, nÃªn Ä‘Ã¢y lÃ  cÃ¡ch viáº¿t *tá»± nhiÃªn nháº¥t*, khÃ´ng pháº£i cÃ¡ch viáº¿t lÃ¡ch.
2. **Xuá»‘ng dÃ²ng.** Lá»›p `[^;\n]*` **khÃ´ng vÆ°á»£t qua kÃ½ tá»± xuá»‘ng dÃ²ng**, mÃ  SQL trong kho
   nÃ y gáº§n nhÆ° luÃ´n viáº¿t nhiá»u dÃ²ng: `ORDER BY\n  mts.confirmed_works DESC` â‡’ lá»t.
3. **Sáº¯p trong JavaScript sau khi láº¥y dá»¯ liá»‡u** (`rows.sort((a,b) => b.confirmed_works - a.confirmed_works)`),
   hoáº·c **`ORDER BY` cá»™t phÃ¡i sinh / sá»‘ thá»© tá»±** (`â€¦ AS c â€¦ ORDER BY c`, `ORDER BY 3`).
4. **Sáº¯p á»Ÿ táº§ng frontend.** Gá»‘c quÃ©t lÃ  `api/src` â€” **`web/js/` khÃ´ng há» Ä‘Æ°á»£c quÃ©t.**

**LÆ°á»›i 2 (cháº¡y tháº­t) bá»‹t Ä‘Æ°á»£c Ä‘Æ°á»ng 2 vÃ  3 â€” nhÆ°ng chá»‰ bÃªn trong `membersService.list()`:**
báº¥t ká»³ cÃ¡ch xáº¿p nÃ o lÃ m Ä‘á»•i thá»© tá»± cá»§a Ä‘Ãºng hÃ m Ä‘Ã³ Ä‘á»u lÃ m `toEqual(['Aaâ€¦','Bbâ€¦','Zzâ€¦'])`
Ä‘á», báº¥t ká»ƒ Ä‘Æ°á»£c viáº¿t tháº¿ nÃ o. ÄÃ³ lÃ  giÃ¡ trá»‹ tháº­t cá»§a lÆ°á»›i thá»© hai, vÃ  Ruling T12-f Ä‘Ãºng
khi Ä‘Ã²i nÃ³ â€” **nÃ³ khÃ´ng pháº£i trang trÃ­.**

**Chá»— Cáº¢ HAI LÆ¯á»šI CÃ™NG MÃ™:**

- **Táº§ng frontend.** `web/js/` khÃ´ng bá»‹ quÃ©t, vÃ  lÆ°á»›i 2 dá»«ng á»Ÿ táº§ng service. Sáº¯p láº¡i danh
  báº¡ theo `confirmed_works` trong trÃ¬nh duyá»‡t **lÃ ** ná»n táº£ng Ä‘ang xáº¿p háº¡ng con ngÆ°á»i â€”
  nguyÃªn táº¯c 5 bá»‹ phÃ¡ mÃ  cáº£ hai lÆ°á»›i Ä‘á»u xanh. Thá»© duy nháº¥t Ä‘ang cháº·n tháº­t sá»± lÃ  kháº³ng
  Ä‘á»‹nh `not.toContain('confirmed_works'â€¦)` á»Ÿ cuá»‘i lÆ°á»›i 2 (dá»¯ liá»‡u khÃ´ng ra tá»›i client),
  vÃ  Ä‘Ã³ lÃ  **há»‡ quáº£ phá»¥** cá»§a bÃ i chá»© khÃ´ng pháº£i má»¥c Ä‘Ã­ch nÃ³ tuyÃªn bá»‘.
- **Má»i endpoint chÆ°a tá»“n táº¡i.** LÆ°á»›i 2 theo Ä‘á»‹nh nghÄ©a chá»‰ soi hÃ m nÃ³ gá»i. LÆ°á»›i 1 láº½ ra
  pháº£i bÃ¹ Ä‘Ãºng chá»— nÃ y â€” Ä‘Ã³ lÃ  lÃ½ do Ä‘áº·c táº£ T9 Ä‘Ã²i má»™t lÆ°á»›i quÃ©t mÃ£ â€” nhÆ°ng nÃ³ láº¡i mÃ¹
  trÆ°á»›c `.orderBy(...)` vÃ  trÆ°á»›c xuá»‘ng dÃ²ng, tá»©c **Ä‘Ãºng chá»— nÃ³ Ä‘Æ°á»£c dá»±ng ra Ä‘á»ƒ bÃ¹ thÃ¬ nÃ³
  khÃ´ng bÃ¹ Ä‘Æ°á»£c**. Má»™t `signals.list()` viáº¿t ngÃ y mai báº±ng knex builder lá»t qua **cáº£ hai**.

### `t12-manual-quota.test.js` (14 bÃ i)

| TÃªn bÃ i | Canh gÃ¬ | N/T | Lá»— mÃ¹ cá»¥ thá»ƒ |
|---|---|---|---|
| `sÃ¡u báº£n ghi qua Ä‘Æ°á»£c, báº£n thá»© Báº¢Y bá»‹ cháº·n ngay á»Ÿ chá»¯ kÃ½ Ä‘áº§u tiÃªn` | CSDL tháº­t + Ä‘á»‘i chá»©ng "0 chá»¯ kÃ½ trÃªn báº£n thá»© báº£y" | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `cá»­a sá»• lÃ  12 THÃNG TRÆ¯á»¢T: báº£n ghi cÅ© hÆ¡n 12 thÃ¡ng tráº£ láº¡i suáº¥t` | `13 months` tháº­t | **N/T** | **KhÃ´ng cÃ³ bÃ i Ä‘á»‘i xá»©ng "11 thÃ¡ng váº«n cháº·n"** nhÆ° `t08` cÃ³. CÃ i nháº§m luáº­t "má»—i nÄƒm dÆ°Æ¡ng lá»‹ch" vÃ o Ä‘Ã¢y sáº½ **khÃ´ng bá»‹ báº¯t** â€” bÃ i chá»‰ chá»©ng minh cá»­a sá»• *cÃ³ giá»›i háº¡n*, khÃ´ng chá»©ng minh giá»›i háº¡n Ä‘Ã³ *trÆ°á»£t*. `t08` cho tháº¥y Ä‘Ãºng cÃ¡ch bá»‹t. |
| `háº¡n má»©c Ä‘á»c tá»« communities.config` | Äá»•i `config` tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `háº¡n má»©c tÃ­nh theo Cáº¶P, khÃ´ng theo ngÆ°á»i` | CSDL tháº­t, kÃ¨m Ä‘á»‘i chá»©ng cáº·p (x,z) | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `báº£n ghi BA NGÆ¯á»œI khÃ´ng lÃ¡ch Ä‘Æ°á»£c háº¡n má»©c cá»§a má»™t cáº·p bÃªn trong nÃ³` | CSDL tháº­t, **chá»n id z sao cho cáº·p (min,max) khÃ¡c cáº·p (x,y)** | **N** | Máº«u ráº¥t tá»‘t: dá»±ng Ä‘Ãºng hÃ¬nh dáº¡ng dá»¯ liá»‡u mÃ  lá»—i Ruling T12-d cáº§n Ä‘á»ƒ lá»™ ra, thay vÃ¬ thá»­ má»™t báº£n ghi ba ngÆ°á»i báº¥t ká»³. |
| `hai giao dá»‹ch Äá»’NG THá»œI cÃ¹ng tranh suáº¥t cuá»‘i` | `pg_locks` lÃ m Ä‘iá»ƒm Ä‘á»“ng bá»™ | **N** | CÃ¹ng lá»— "pg_locks Ä‘áº¿m toÃ n cá»¥m" nhÆ° `t08`. |
| `ngÆ°á»i ngoÃ i cuá»™c dá»±ng báº£n ghi manual â‡’ MANUAL_CREATOR_NOT_PARTICIPANT` | CSDL tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `luáº­t Ä‘Ã³ CHá»ˆ Ã¡p cho manual` | CSDL tháº­t (Ä‘á»‘i chá»©ng `signal`) | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `ngÆ°á»i duyá»‡t pháº£i mang vai approver â‡’ REVIEWER_NOT_APPROVER` | CSDL tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `approver cá»§a Cá»˜NG Äá»’NG KHÃC khÃ´ng duyá»‡t Ä‘Æ°á»£c` | CSDL tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `approver KHÃ”NG tá»± duyá»‡t viá»‡c cá»§a chÃ­nh mÃ¬nh` | CSDL tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `báº£n ghi manual khÃ´ng Ä‘Æ°á»£c SINH RA Ä‘Ã£ duyá»‡t sáºµn` | CSDL tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `approver há»£p lá»‡, khÃ´ng tham gia viá»‡c â‡’ duyá»‡t Ä‘Æ°á»£c` | CSDL tháº­t | **N** | Äá»‘i chá»©ng cáº§n thiáº¿t â€” thiáº¿u nÃ³ thÃ¬ bá»‘n bÃ i trÃªn xanh cáº£ khi trigger cháº·n **má»i** lÆ°á»£t duyá»‡t. |
| `reviewed_by vÃ  reviewed_at pháº£i Ä‘i cÃ¹ng nhau (wr_manual_review)` | CSDL tháº­t, nÃªu **Ä‘Ã­ch danh tÃªn rÃ ng buá»™c** | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. Máº«u tá»‘t: kháº³ng Ä‘á»‹nh theo tÃªn rÃ ng buá»™c tháº­t, khÃ´ng theo máº«u rá»™ng. |

### `t12-work-edge.test.js` (20 bÃ i)

Tá»‡p canh nguyÃªn táº¯c 2, vÃ  lÃ  má»™t trong hai tá»‡p **canh nguá»“n sáº¡ch nháº¥t cáº£ bá»™**: má»i bÃ i
Ä‘á»u Ä‘á»ƒ CSDL tá»± tá»« chá»‘i, khÃ´ng bÃ i nÃ o tin lá»i há»©a cá»§a táº§ng service.

| TÃªn bÃ i | Canh gÃ¬ | N/T | Lá»— mÃ¹ cá»¥ thá»ƒ |
|---|---|---|---|
| `má»™t bÃªn xÃ¡c nháº­n thÃ¬ CHÆ¯A cÃ³ cáº¡nh nÃ o` | CSDL tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `bÃªn thá»© hai xÃ¡c nháº­n thÃ¬ cáº¡nh xuáº¥t hiá»‡n, theo thá»© tá»± chuáº©n táº¯c a < b` | CSDL tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `ba ngÆ°á»i: thiáº¿u Má»˜T ngÆ°á»i thÃ¬ KHÃ”NG cÃ³ cáº¡nh nÃ o, ká»ƒ cáº£ cáº¡nh giá»¯a hai ngÆ°á»i Ä‘Ã£ kÃ½` | CSDL tháº­t | **N** | Máº«u tá»‘t: báº¯t Ä‘Ãºng hÃ¬nh dáº¡ng "quan há»‡ suy diá»…n" mÃ  bÃ i hai-ngÆ°á»i khÃ´ng phÃ¢n biá»‡t Ä‘Æ°á»£c. |
| `má»™t ngÆ°á»i tham gia duy nháº¥t thÃ¬ khÃ´ng sinh cáº¡nh nÃ o` | CSDL tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `cÃ¹ng má»™t cáº·p lÃ m viá»‡c láº§n thá»© hai: KHÃ”NG Ä‘áº» thÃªm cáº¡nh` | CSDL tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `A xÃ¡c nháº­n thay B â‡’ SELF_ONLY` | CSDL tháº­t, qua `withActor` | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `xÃ¡c nháº­n ngoÃ i giao dá»‹ch cÃ³ Ä‘Ã³ng dáº¥u â‡’ NO_ACTOR` | `withActor(null)` â‡’ chuá»—i rá»—ng, Ä‘Ãºng hÃ¬nh dáº¡ng `nullif()` pháº£i báº¯t | **N** | Phá»§ hÃ¬nh dáº¡ng "actor rá»—ng", **khÃ´ng** phá»§ hÃ¬nh dáº¡ng "biáº¿n chÆ°a tá»«ng Ä‘Æ°á»£c Ä‘áº·t" â€” hai nhÃ¡nh khÃ¡c nhau cá»§a `current_setting(â€¦, true)`. `t05` phá»§ nhÃ¡nh cÃ²n láº¡i, nÃªn cáº£ bá»™ váº«n kÃ­n. |
| `xÃ¡c nháº­n má»™t viá»‡c mÃ¬nh KHÃ”NG tham gia â‡’ khÃ³a ngoáº¡i ghÃ©p cháº·n` | CSDL tháº­t | **N/T** | Máº«u rá»™ng `/work_confirmations_wr_member_fkey\|violates foreign key/i` â€” nhÃ¡nh sau khá»›p **báº¥t ká»³** lá»—i khoÃ¡ ngoáº¡i nÃ o. CÃ¹ng loáº¡i lá»—i Ä‘Ã£ bá»‹ sá»­a á»Ÿ `t13-signature-removal`; á»Ÿ Ä‘Ã¢y váº«n cÃ²n. |
| `xÃ¡c nháº­n HAI Láº¦N Ä‘á»ƒ Äƒn gian sá»‘ viá»‡c â‡’ trÃ¹ng khÃ³a` | CSDL tháº­t | **N/T** | Máº«u rá»™ng `/duplicate key\|unique/i`, khÃ´ng nÃªu Ä‘Ã­ch danh rÃ ng buá»™c nÃ o. |
| `sá»­a ngÃ y/tÃªn viá»‡c Ä‘Ã£ cÃ³ xÃ¡c nháº­n â‡’ WORK_RECORD_FROZEN` | CSDL tháº­t, ba cá»™t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `nhÆ°ng reviewed_by/reviewed_at thÃ¬ váº«n Ä‘áº·t Ä‘Æ°á»£c` | CSDL tháº­t | **N** | Äá»‘i chá»©ng cáº§n thiáº¿t cho bÃ i trÃªn. |
| `chÆ°a cÃ³ xÃ¡c nháº­n nÃ o thÃ¬ sá»­a thoáº£i mÃ¡i` | CSDL tháº­t | **N** | Äá»‘i chá»©ng cáº§n thiáº¿t. |
| `app_role khÃ´ng XOÃ Ä‘Æ°á»£c báº£n ghi viá»‡c` | `app_role` tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `THÃŠM ngÆ°á»i tham gia sau khi má»i ngÆ°á»i Ä‘Ã£ kÃ½ â‡’ WORK_PARTICIPANTS_FROZEN` | CSDL tháº­t + **Ä‘áº¿m cáº¡nh cá»§a z báº±ng 0** | **N** | Máº«u tá»‘t: kháº³ng Ä‘á»‹nh cáº£ *lá»‡nh bá»‹ cháº·n* láº«n *háº­u quáº£ khÃ´ng xáº£y ra*. |
| `XOÃ ngÆ°á»i tham gia chÆ°a kÃ½ â‡’ WORK_PARTICIPANTS_FROZEN` | CSDL tháº­t, cáº£ `DELETE` láº«n `UPDATE role` | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `trÆ°á»›c xÃ¡c nháº­n Ä‘áº§u tiÃªn thÃ¬ danh sÃ¡ch ngÆ°á»i tham gia váº«n sá»­a Ä‘Æ°á»£c` | CSDL tháº­t | **N** | Äá»‘i chá»©ng cáº§n thiáº¿t. |
| `app_role INSERT tháº³ng vÃ o member_relations â‡’ permission denied` | `app_role` tháº­t | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `cáº¡nh (B,A) khi Ä‘Ã£ cÃ³ (A,B) â‡’ rel_canonical cháº·n` | CSDL tháº­t, nÃªu **Ä‘Ã­ch danh** tÃªn rÃ ng buá»™c | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |
| `ngÆ°á»i tham gia cá»§a cá»™ng Ä‘á»“ng KHÃC khÃ´ng gáº¯n Ä‘Æ°á»£c vÃ o báº£n ghi viá»‡c` | CSDL tháº­t | **N/T** | Máº«u rá»™ng `/violates foreign key/i` â€” khÃ´ng nÃªu Ä‘Ã­ch danh khoÃ¡ ghÃ©p nÃ o cháº·n. |
| `má»™t viá»‡c cá»§a cá»™ng Ä‘á»“ng KHÃC sinh cáº¡nh trong ÄÃšNG cá»™ng Ä‘á»“ng Ä‘Ã³` | CSDL tháº­t + Ä‘á»‘i chá»©ng Ä‘áº¿m 0 | **N** | ChÆ°a nghÄ© ra Ä‘Æ°á»ng lÃ¡ch. |

