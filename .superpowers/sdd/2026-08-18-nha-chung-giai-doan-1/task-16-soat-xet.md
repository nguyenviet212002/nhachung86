# Soát xét độc lập — Task 16 (vai / quyền / nhật ký)

Người soát: một agent độc lập, không phải người thi công Task 16.
Phạm vi: ba commit `7b202e8`, `8ef9071`, `951bdcb` trên nhánh `giai-doan-1`.
Viết **tăng dần**. Mỗi mục được commit ngay khi xong, không dồn tới cuối.

Môi trường thăm dò: một CSDL **riêng** `nhachung_probe` trên chính container
`nhachung-test-db-1`, migrate đầy đủ 32 migration từ schema trắng. `nhachung_test` không bị
đụng tới trong lúc thăm dò.

---

## Giai đoạn A — ma trận quyền dựng lại độc lập

Bảng dựng lại nằm ở `ma-tran-quyen-doc-lap.md`, **đã commit ở `4b16728` trước khi mở**
`api/tests/expected-grants.json`, `t10-grants.test.js`, `t27-ops-vai-quyen.test.js` hay hằng
`GRANTS` trong `024_indexes_and_revokes.js`. Nguồn dựng: đặc tả mục 1.5, 1.6, 3, 4.2, 4.8, 6, 7
và `docs/RANG-BUOC.md`; danh sách quan hệ lấy từ `pg_class` của CSDL thật, không lấy từ migration.

### A.1 So ba bản: ma trận độc lập ↔ `expected-grants.json` ↔ quyền thật trong CSDL

Trước hết, hai bản của **người thi công** khớp nhau tuyệt đối:

```
quan he thuc te: 72 | khoa trong expected: 70
--- co trong DB, THIEU trong expected-grants.json ---
   audit_log_2026_08 => SELECT,INSERT
   audit_log_2026_09 => SELECT,INSERT
--- co trong expected, KHONG co trong DB ---   (rong)
--- LECH expected vs DB ---                    (rong)
so o lech: 0
```

Hai phân mảnh vắng mặt là **cố ý và đúng**: tên phân mảnh sinh theo tháng nên không khai tĩnh
được; `t10` và `t27` đều có bài riêng quét chúng qua `pg_inherits`. Đây chính là điều tôi đã ghi
ở ghi chú F của bảng độc lập trước khi nhìn, nên hai bên gặp nhau ở cùng một kết luận.

Bây giờ là phần có sức nặng: **ma trận tôi dựng độc lập so với `expected-grants.json`.**
Sáu ô lệch, không ô nào theo hướng "người thi công nới lỏng".

| Quan hệ | Tôi dựng từ đặc tả | `expected-grants.json` + CSDL | Phán xử |
|---|---|---|---|
| `communities` | `SELECT, INSERT, UPDATE` (đặc tả 4.8 xếp vào "còn lại: đủ bốn quyền"; tôi đã bỏ `DELETE` và ghi sẵn nghi ngờ ở ghi chú C) | **`SELECT`** | **Người thi công đúng, và đúng hơn cả đặc tả.** Đây là bản vá cho chỗ hở #22 (`RANG-BUOC` mục 5.4 — "chi 50 triệu, không một chữ ký nào"). Thu `UPDATE` khỏi `communities` là cách duy nhất khiến `communities.config` chỉ vào được qua khung hai người ký |
| `otp_challenges` | đủ bốn | `SELECT, INSERT, UPDATE` | Người thi công chặt hơn. `DELETE` một vé OTP không có nghiệp vụ nào cần; vé cháy bằng `status`. Đúng |
| `refresh_tokens` | đủ bốn (tôi cho là thu hồi phiên cần `DELETE`) | `SELECT, INSERT, UPDATE` | Người thi công chặt hơn, và **tôi sai**: thu hồi bằng `UPDATE revoked_at` giữ lại dấu vết vé đã tồn tại; `DELETE` xoá luôn bằng chứng ai từng có phiên |
| `pending_actions` | đủ bốn | `SELECT, INSERT, UPDATE` | Người thi công chặt hơn. `DELETE /ops/pending-actions/:id` của đặc tả mục 5.7 là **huỷ**, tức `status='cancelled'`, không phải xoá hàng. Đúng |
| `capability_evidence` | đủ bốn theo đặc tả, nhưng tôi ghi sẵn nghi ngờ (ghi chú D) rằng nên là `SELECT, INSERT` | đủ bốn | **Hoà — và cả ba bên cùng lỏng.** Xem mục A.2 |
| `activities` | đủ bốn theo đặc tả, nhưng tôi ghi sẵn nghi ngờ (ghi chú E) | đủ bốn | **Hoà — và cả ba bên cùng lỏng.** Xem mục A.2 |

**Sáu mươi sáu ô còn lại trùng khít**, kể cả những ô tôi coi là quan trọng nhất và đã ghi ra
trước khi nhìn:

- `member_contacts` = **rỗng** (không một quyền nào) — nguyên tắc 4;
- `join_request_secrets` = **`INSERT` và chỉ `INSERT`**;
- `member_roles` = **`SELECT`** — ô tôi gọi là "ô quan trọng nhất của Task 16" ở ghi chú B.
  Task 16 mở luồng gán vai mà **không** nới quyền bảng: đường ghi là hàm `SECURITY DEFINER`
  tự kiểm. Đây là quyết định thiết kế đúng, và nó là lý do mục 4 của danh sách tấn công có
  chỗ để đứng;
- toàn bộ mười ba bảng chữ ký / sổ sự kiện = `SELECT, INSERT`;
- `audit_log` và cả hai phân mảnh = `SELECT, INSERT`.

### A.2 Hai chỗ cả ba bên cùng lỏng — không phải lỗi của Task 16

Hai ô này **khớp đặc tả**, nên chúng không phải lỗi của người thi công. Nhưng chúng là chỗ ma
trận quyền lỏng hơn nguyên tắc, và một vòng soát xét độc lập có nghĩa vụ nói ra:

**`capability_evidence` — đủ bốn quyền.** Một hàng bằng chứng buộc một *năng lực* vào một *việc
đã có chữ ký*. `DELETE` nó là rút lại một lời khẳng định đã đưa ra, cùng họ với
`work_confirmations` (đã là `SELECT, INSERT`). `trg_capability_evidence_valid` canh đường ghi
rất kỹ; đường **gỡ** thì không ai canh. Đề nghị: `SELECT, INSERT, UPDATE`.

**`activities` — đủ bốn quyền.** Cổng `SUMMARY_REQUIRED` đếm "hoạt động đã xong, dùng quỹ, chưa
có tổng kết". `RANG-BUOC` chỗ hở #23 đã tái hiện đường gỡ kẹt bằng `ends_at`; **`DELETE` hẳn
hoạt động đang kẹt** cũng đưa con số về 0, nhanh hơn và sạch hơn. `activity_summaries` đã bị thu
`DELETE` đúng vì lý do này — nhưng bảng cha thì không.

Cả hai đều là *đề nghị cho vòng sau*, không phải lỗi phải sửa trong vòng này: sửa chúng là sửa
đặc tả mục 4.8 và hằng `GRANTS` của `024`, tức đụng vào phạm vi ngoài Task 16.

### A.3 Kết luận Giai đoạn A

`expected-grants.json` **không** phải một tờ giấy tự chứng nhận. Nó khớp từng ô với quyền thật
trong CSDL, và khớp với một ma trận dựng lại độc lập từ đặc tả — chặt hơn ở bốn ô, không lỏng
hơn ở ô nào. Nỗi lo ban đầu ("một bảng lẽ ra chỉ-thêm mà file khai là được `UPDATE`") **không
xảy ra**.

Nhưng nó vẫn là **một** bản khai được **hai** bài test cùng đối chiếu, và cả hai bài đều lấy sự
thật từ cùng một tệp. Điều cứu nó không phải bản thân tệp mà là:

1. `024_indexes_and_revokes.js` **tự kiểm** — mọi quan hệ trong `public` phải có mặt trong hằng
   `GRANTS`, nếu không migration ném lỗi. Đây là lưới ở **nguồn**, không phải ở bản sao.
2. `t10` đo bằng `has_table_privilege` (quyền **hiệu lực**, tính cả PUBLIC và vai kế thừa),
   `t27` đo bằng **chạy thật bốn câu lệnh** và phân loại theo `SQLSTATE 42501`. Hai phép đo
   khác nhau về bản chất cùng đối chiếu một khai báo.
3. Một số ô còn có lưới **hành vi** riêng (`t13-signature-removal` cho các bảng chữ ký,
   `t07-audit-chain` cho nhật ký), tức là nếu ai đó vừa nới quyền vừa sửa `expected-grants.json`
   thì vẫn còn một bài đỏ.

Chỗ **không** có lưới thứ ba là mọi bảng chỉ được canh bằng ma trận quyền và không có bài hành
vi nào (`profile_views`, `signal_forwards`, `connection_events`, `complaint_events`,
`memory_versions`, `report_versions`, `backups`, `restore_tests`, `loan_repayments`,
`aid_events`). Với nhóm này, sửa đồng thời `024` + `expected-grants.json` là xanh tuyệt đối.
Đó là giới hạn thật của cấu trúc hiện tại, và nó được ghi ra đây thay vì để ngầm.

---

## Giai đoạn B1 — `EXECUTE` cho `PUBLIC`, toàn bộ danh sách hàm

Đo trên `nhachung_probe` bằng câu của đề bài, mở rộng thêm cột `app_role`:

```sql
SELECT p.proname, p.prosecdef, t.typname='trigger' AS is_trg,
       has_function_privilege('public',   p.oid,'EXECUTE') AS pub_exec,
       has_function_privilege('app_role', p.oid,'EXECUTE') AS app_exec,
       coalesce(p.proacl::text,'(default)')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_type t ON t.oid=p.prorettype WHERE n.nspname='public';
```

### B1.1 Mười hàm `SECURITY DEFINER` — không hàm nào còn `EXECUTE` cho `PUBLIC`

| Hàm | `PUBLIC EXECUTE` | `app_role EXECUTE` | Tự kiểm người gọi | Bằng chứng chạy thật (gọi bằng người **không vai nào**) |
|---|---|---|---|---|
| `auth_lookup(uuid,text)` | không | có | **không — ngoại lệ đã tuyên** | chạy được; nhưng danh sách cột trả về bị khoá và nó lọc `p_community`. Xem B1.3 |
| `contact_read(uuid,text)` | không | có | có | cùng hội: trả bao bì trạng thái, không ném (đúng đặc tả 3.1); hội khác: `NO_TARGET` |
| `contact_upsert(uuid,text,text)` | không | có | có | `CONTACT_WRITE_DENIED` |
| `join_secret_consume(uuid)` | không | có | có | `NO_TARGET` |
| `fn_trust_recount(uuid)` | không | có | có | `TRUST_RECOUNT_DENIED` |
| `fn_community_config_apply(uuid)` | không | có | **có, mới từ 029** | `EXECUTOR_NOT_SIGNER` / `NO_ACTOR` |
| `fn_role_grant(uuid,text)` | không | có | có | `ROLE_MANAGE_DENIED` |
| `fn_role_revoke(uuid,text)` | không | có | có | `ROLE_MANAGE_DENIED` |
| `fn_member_bootstrap()` | không | **không** | miễn trừ: `RETURNS trigger` | `42501 permission denied for function` — chặn ở **quyền**, trước cả lớp "không gọi thẳng hàm trigger được" |
| `fn_work_edge()` | không | **không** | miễn trừ: `RETURNS trigger` | `42501 permission denied for function` |

Hai hàm trigger được ghi **miễn trừ có lý do**, không bỏ qua im lặng: PostgreSQL từ chối gọi
thẳng một hàm `RETURNS trigger`, **và** 029 đã thu `EXECUTE` khỏi PUBLIC nên `app_role` chết ở
lớp quyền trước. Hai lớp, không phải một.

**Đây là phần việc mạnh nhất của Task 16.** Bốn migration cũ (006/008/009a/012) viết
`GRANT EXECUTE … TO app_role` mà quên `REVOKE … FROM PUBLIC` trước, để nguyên quyền mặc định của
PostgreSQL trên đúng bốn hàm dẫn tới số điện thoại và băm mật khẩu. 029 thu về cả bốn, cộng ba
hàm nữa (`fn_member_bootstrap`, `fn_work_edge`, `fn_audit_new_partition`) và hai hàm
`SECURITY INVOKER` nhạy cảm (`fn_privacy_state`, `fn_acting_member`). Không phải dọn dẹp cho gọn:
thêm một vai CSDL thứ ba (bản sao chỉ-đọc, công cụ giám sát) là việc bình thường ở giai đoạn sau,
và ngày thêm nó là ngày cả bốn cửa mở cùng lúc.

### B1.2 Hàm **không** `SECURITY DEFINER` mà còn `EXECUTE` cho `PUBLIC`

Còn **51 hàm của dự án** ở nhóm này, cộng khoảng 120 hàm của bốn extension
(`pgcrypto`, `cube`/`earthdistance`, `pg_trgm`, `unaccent`). Phán xử từng nhóm:

| Nhóm | Số hàm | `PUBLIC EXECUTE` | Vì sao chấp nhận được |
|---|---|---|---|
| Hàm trigger của dự án (`fn_self_only`, `fn_audit_chain`, `fn_fund_sig_guard`, …) | 45 | còn | `RETURNS trigger` ⇒ PostgreSQL từ chối gọi thẳng, **và** `SECURITY INVOKER` ⇒ kể cả gọi được cũng chạy bằng quyền của chính người gọi. Hai lý do độc lập |
| Hàm đọc phụ trợ: `fn_fund_threshold`, `fn_fund_valid_signatures`, `fn_pending_action_signatures`, `fn_pending_action_role`, `fn_photo_consent_missing` | 5 | còn | `SECURITY INVOKER`; chúng chỉ `SELECT` các bảng mà `app_role` **đã** có `SELECT`. Gọi chúng không cho thêm quyền nào |
| `fn_audit_new_partition(date)` | 1 | **đã thu**, và cũng không cấp cho `app_role` | Hàm này **tạo bảng**. Nếu để hở, một phân mảnh `audit_log` mới sẽ ra đời với **đủ bốn quyền** từ `ALTER DEFAULT PRIVILEGES` — đúng cái bẫy mục 1.6 đặc tả cảnh báo. Đo thật: `42501 permission denied for function` |
| `fn_privacy_state`, `fn_acting_member` | 2 | **đã thu**, cấp riêng cho `app_role` | Không phải `SECURITY DEFINER` nhưng đều đọc dữ liệu quyết định quyền riêng tư |
| Hàm của extension | ~120 | còn | Mặc định của PostgreSQL khi `CREATE EXTENSION`. Không hàm nào `SECURITY DEFINER`. Đáng ghi nhưng không đáng chặn: thu `EXECUTE` khỏi `pgcrypto` sẽ phá `gen_random_uuid()` mà chính lược đồ đang dùng làm `DEFAULT` |

**Kết luận B1: không tìm được lỗ thủng nào.** Không hàm nào vừa `SECURITY DEFINER`, vừa
`PUBLIC EXECUTE`, vừa không tự kiểm. Câu "đó không phải bảo vệ, đó là may mắn" đã được người thi
công tự đặt ra và tự bịt trước khi tôi tới.

### B1.3 Một chỗ đáng nêu: `auth_lookup` là ngoại lệ, và nó chỉ được canh bằng **bài test**

`auth_lookup` trả về `password_hash` và không kiểm được người gọi (nó chạy trước khi có ai để
kiểm). Hai lớp thay thế đều nằm ngoài CSDL:

1. **Danh sách cột trả về** bị `t27` khoá bằng một khẳng định chuỗi trên `pg_get_function_result`.
2. Nó **lọc `p_community`** — có đối chứng hai chiều.

Lớp 1 mới là lớp quan trọng: một `CREATE OR REPLACE` ở migration sau thêm `c.phone` vào
`RETURNS TABLE` sẽ biến hàm đăng nhập thành cửa đọc số điện thoại, và `REVOKE ALL ON
member_contacts` không đỡ được vì hàm là `SECURITY DEFINER`. Lớp đó **không có đối tượng SQL nào**
giữ — chỉ có một dòng `expect(...).toBe(...)` trong `t27`. Đó là lựa chọn hợp lý (không có cách
nào khoá chữ ký hàm ở tầng PostgreSQL), nhưng phải ghi ra thay vì để ngầm: **xoá bài test ấy là
gỡ toàn bộ lớp canh của `auth_lookup`.**

---

## Giai đoạn B2 — 72 bảng và cột `community_id`

**Con số 72 đúng, nhưng nó là một con số DI ĐỘNG.** Đếm chính xác trong schema `public`
(bỏ `knex_migrations`, `knex_migrations_lock`):

| Loại | Số |
|---|---|
| bảng thường (`relkind='r'`), không kể phân mảnh | 68 |
| bảng phân mảnh mẹ (`relkind='p'`) — `audit_log` | 1 |
| **phân mảnh** của `audit_log` (`2026_08`, `2026_09`) | 2 |
| view (`relkind='v'`) — `v_signal_recipients` | 1 |
| **tổng** | **72** |

Hai trong 72 là phân mảnh theo tháng. Sang tháng sau `fn_audit_new_partition` đẻ thêm một cái và
con số thành 73. Bất kỳ bài test nào khẳng định "đúng 72" sẽ đỏ vào một ngày không ai đoán trước.
Đã kiểm: `t10` và `t27` đều dùng `toBeGreaterThan(60)` — **cả hai tránh đúng cái bẫy này** — và cả
hai quét phân mảnh bằng `pg_inherits` chứ không bằng danh sách tên.

Danh sách đầy đủ 72 quan hệ kèm một dòng vai trò mỗi quan hệ nằm ở
`ma-tran-quyen-doc-lap.md` mục 2 (viết trước khi mở bất kỳ tệp kỳ vọng nào), nên không chép lại ở
đây.

### Không quan hệ nào thiếu `community_id`, và bốn ngoại lệ đều chứng minh được

Đo bằng ba câu trên chính CSDL, không đọc migration:

1. quan hệ nào có `community_id` mà **NULLABLE** ⇒ **0 hàng**;
2. quan hệ nào có `community_id` mà **không có khóa ngoại** tới `communities(id)` ⇒ **0 hàng**;
3. quan hệ nào **không có** cột `community_id` ⇒ đúng **bốn**.

| Quan hệ | Cột thật | Vì sao không cần `community_id` |
|---|---|---|
| `communities` | `id, code, name, config, created_at, updated_at` | **Nó chính là gốc.** Thêm `community_id` vào đây là tự trỏ vào mình |
| `roles` | `id, key, name` | Năm vai của **nền tảng**, giống nhau ở mọi hội. Không cột nào chứa dữ liệu của hội nào |
| `permissions` | `id, key, name, description` | Bốn khoá quyền của nền tảng. Cùng lý do |
| `role_permissions` | `role_id, permission_id` | Chỉ hai khoá ngoại tới hai bảng hằng số trên. Không có ô nào để dữ liệu của một hội lọt vào |

Ba bảng hằng số này là **quyết định thiết kế cần nói ra**: nếu một ngày hai hội muốn ma trận
vai→quyền khác nhau, `role_permissions` sẽ phải mọc `community_id`, và tới lúc đó mọi câu đọc nó
(`requirePermission`, `GET /ops/permissions`, bài test hai chiều của `t27`) đều thành chỗ quên lọc.
Hôm nay nó đúng; ngày mai nó là cửa thứ tám của cùng một lỗi đã lặp bảy lần.

**Sáu mươi tám quan hệ còn lại đều có `community_id NOT NULL` kèm khóa ngoại tới `communities(id)`**
— kể cả cả hai phân mảnh `audit_log` và view `v_signal_recipients`. Không quan hệ phụ trợ nào sinh
ra trong lúc thi công mà lọt lưới.

Một chỗ hở còn để lại và **không phải lỗi của Task 16**: `RANG-BUOC.md` mục 4.1 ghi rằng lời hứa
"mọi bảng dữ liệu có `community_id`" được giữ bằng **quy ước viết tay ở từng migration**, và
`024` tự kiểm **quyền** chứ không kiểm **cột**. Ba câu SQL tôi vừa chạy chính là hình dạng của bài
quét còn thiếu, và đặc tả mục 4.5 đã hứa "T10 quét `information_schema`" cho nó. Hôm nay bài đó
vẫn chưa tồn tại — trạng thái không đổi so với trước Task 16.

---

## Giai đoạn B3 — trigger có bị vô hiệu hoá ở đâu không

Đã quét toàn kho (trừ `node_modules`) với mẫu
`disable[[:space:]]+trigger | session_replication_role | ALTER TABLE .* DISABLE | --disable-triggers | TRIGGER ALL`
trên `*.js`, `*.sql`, `*.sh`, `*.yml`, `*.yaml`, `Dockerfile*`, `*.md`. **Không một chỗ nào.**

Bốn đường đáng ngờ nhất đã đọc tận nơi:

| Đường | Trạng thái |
|---|---|
| `resetDb()` (`api/tests/helpers/db.js`) | `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` rồi `migrate.latest()`. Dựng lại **bằng chính migration**, nên mọi trigger ra đời đúng như trong sản xuất. Không có đường tắt |
| `api/docker-entrypoint.sh` | `npx knex migrate:latest` rồi `node src/server.js`. Không có gì khác |
| `db/init/01-extensions.sql` | đúng một dòng `CREATE EXTENSION IF NOT EXISTS pgcrypto` |
| container `backup` | **RỖNG** — `ENTRYPOINT ["tail","-f","/dev/null"]`; Dockerfile ghi rõ "Chưa có logic sao lưu thật, Task 18 sẽ thay toàn bộ ruột" |

**Cảnh báo chuyển tiếp cho Task 18, và đây là chỗ đáng lo nhất của mục B3.** Đường khôi phục chưa
tồn tại nên hôm nay không có lỗ. Nhưng khi nó được viết, `pg_restore` sẽ đâm thẳng vào một mâu
thuẫn chưa ai giải: khôi phục dữ liệu bằng `COPY` **chạy trigger**, và `trg_audit_chain`
(`BEFORE INSERT`, tự tính băm) sẽ **tính lại băm cho từng dòng nhật ký được khôi phục** — chuỗi
băm của bản khôi phục không còn là chuỗi băm của bản gốc. Cách sửa hiển nhiên và **sai** là
`pg_restore --disable-triggers`, đúng dòng lệnh mà mục B3 đi tìm: nó dựng lại CSDL mà không chạy
bất kỳ ràng buộc nào. Ghi ra đây để Task 18 gặp câu hỏi này lúc thiết kế chứ không lúc sự cố.

---

## Giai đoạn B4 — cửa hợp lệ của migration 028, và **một phát hiện**

Đây là mục đề bài gọi là quan trọng nhất, và nó có kết quả hỗn hợp: cửa được dựng đúng hình
dạng, nhưng **tính "dùng một lần" của nó không nằm trong CSDL**.

### B4.1 Cửa đi bằng gì — không phải cờ phiên

Câu hỏi đầu tiên của đề bài: *"nếu bằng cờ phiên (`set_config`/`SET LOCAL`) thì đặt cờ đó từ một
route bất kỳ rồi `UPDATE communities` thẳng."* **Không phải cờ phiên.** Cửa gồm hai lớp:

| Lớp | Đối tượng SQL | Chạy thật, bằng `app_role` có đóng dấu `alice` (approver) |
|---|---|---|
| 1 | `REVOKE INSERT, UPDATE, DELETE ON communities FROM app_role` | `UPDATE communities SET config=…` ⇒ `42501 permission denied for table communities` |
| 2 | `trg_community_config_guard` — trigger **vô điều kiện** `BEFORE UPDATE ON communities` | chặn cả đường chủ bảng và cả đường một hàm `SECURITY DEFINER` thứ hai |

Lớp 2 là chỗ thiết kế đúng và đáng ghi nhận: nó **không** dùng `fn_acting_member()` (hàm đó cố ý
trả `NULL` cho đường chủ bảng — đúng đường mà một hàm `SECURITY DEFINER` viết ẩu sẽ đi), nên nó
chặn cả `psql` của người vận hành lẫn chính `fn_community_config_apply`. Không có cờ phiên nào để
đặt từ ngoài.

### B4.2 `fn_community_config_apply` có tự kiểm người gọi không — có, và 029 mới bịt

028 tự khai chỗ này còn lỏng; 029 mục 5 vá. Đo lại độc lập, từng nhánh:

| Người gọi | Trạng thái hành động | Kết quả thật |
|---|---|---|
| người **không vai nào** | 2 chữ ký | `EXECUTOR_NOT_SIGNER` |
| `tech` (**có vai**, không ký việc này) | 2 chữ ký | `EXECUTOR_NOT_SIGNER` |
| người **đã ký** | **1** chữ ký | `CONFIG_CHANGE_UNSIGNED` (trigger lớp 2 nổ, không phải hàm) |
| giao dịch **không đóng dấu** | 2 chữ ký | `NO_ACTOR` |
| **đối chứng** — người đã ký | 2 chữ ký | chạy được, `config` đổi thật |

Điều kiện là "người gọi phải là **một trong những người đã ký**", không phải "người gọi có vai
approver". Đó là điều kiện **hẹp hơn và đúng hơn**: đặc tả mục 7.2 bước 3 nói thi hành chạy trong
cùng giao dịch với chữ ký thứ hai, nên người gọi hợp lệ duy nhất trong thiết kế đã là một người ký.

### B4.3 PHÁT LẠI — chỗ hở còn lại, đã tái hiện bằng chạy thật

Câu hỏi thứ ba của đề bài: *"gọi hàm hai lần với cùng một hành động đã ký, có ghi đè lần thứ hai
không."* **Có.** `fn_community_config_apply` **không đọc `pending_actions.status`** và **không tự
đánh dấu hành động đã thi hành**. Bước đánh dấu nằm ở đúng một chỗ: `api/src/core/twoPerson.js`
dòng 357–361, tức **tầng ứng dụng**.

Tái hiện đầy đủ, bằng `app_role` trên `nhachung_probe`:

```
Hanh dong A: config = {fund_two_approver_threshold: 99000000}, DU HAI chu ky (alice, bob)
   alice goi apply(A)                       -> config = 99.000.000
   (KHONG ai danh dau A la executed - A van 'pending')

Hanh dong B: config = {fund_two_approver_threshold: 1000000}, DU HAI chu ky
   alice goi apply(B), roi danh dau B executed   (dung quy trinh cua service)
                                            -> config = 1.000.000

   alice - MOT MINH, khong chu ky moi nao - goi lai apply(A)
                                            -> config = 99.000.000   <-- QUAY NGUOC
```

Sau khi A được đánh dấu `executed` thì phát lại bị chặn (`CONFIG_CHANGE_UNSIGNED`), vì trigger đòi
`status='pending'`. Nên **toàn bộ tính "một quyết định, một lần thi hành" đang được giữ bởi một
câu `UPDATE` trong một tệp JavaScript.**

**Vì sao đây là phát hiện chứ không phải một mối lo lý thuyết.** Đối chiếu với cửa còn lại của
chính migration 028 — `guarantee.quota_override`:

| | `community.config_change` | `guarantee.quota_override` |
|---|---|---|
| trạng thái hành động mà cửa đòi | `status='pending'` | `status='executed'` |
| ràng buộc "một hành động, một lần dùng" | **không có** | `gqo_one_row_per_action UNIQUE (pending_action_id)` |
| ai giữ tính dùng-một-lần | `twoPerson.js` dòng 357 | CSDL |

Cùng một migration, cùng một loại quyết định, hai câu trả lời khác nhau. Cửa thứ hai được dựng
đúng; cửa thứ nhất để lại đúng khuôn *"lỗ hổng ngủ"* mà `RANG-BUOC.md` mô tả và mà chính 029 viết
ra thành lời: *"Route là thứ người ta viết thêm mỗi task."* Người viết `fn_community_config_apply`
lần thứ hai — một tác vụ định kỳ, một lệnh CLI vận hành, một luồng khôi phục của Task 18 — không
có gì nhắc họ phải kèm câu `UPDATE … status='executed'`.

Cửa sổ khai thác: 24 giờ (`expires_at`), người khai thác phải là một trong hai người đã ký. Không
lớn, nhưng nó cho **một người** quyền quay ngược một quyết định của **hai người**, và
`communities.config` là đòn bẩy mà `RANG-BUOC` mục 5.4 gọi là dài nhất trong hệ thống.

**Không tự sửa**, theo đúng ràng buộc của đề bài ("lỗi lớn thì báo cáo, đừng tự ý thiết kế lại"):
bản vá đụng vào thứ tự trigger (`fn_community_config_apply` phải ghi `config` lúc hành động còn
`pending`, rồi mới đánh dấu `executed` — mà `trg_pending_action_frozen` của 027 canh `UPDATE` trên
`pending_actions`), và đụng vào câu `UPDATE` mà `twoPerson.js` chạy ngay sau đó. Hình dạng đề nghị:

> Cho `fn_community_config_apply` tự đặt `status='executed', executed_at=now()` ngay sau câu
> `UPDATE communities`, trong cùng giao dịch. Kèm một bài test canh: *gọi hàm lần thứ hai với
> cùng một hành động phải hỏng.* Nếu thứ tự trigger không cho, cách thứ hai là thêm vào
> `pending_actions` một ràng buộc "đã tiêu" độc lập với `status`, cùng hình dạng
> `gqo_one_row_per_action`.

---

## Giai đoạn C — mười mục tấn công, chạy độc lập

Mọi kết quả dưới đây đo trên `nhachung_probe` (CSDL riêng, migrate đầy đủ từ schema trắng), bằng
kết nối `app_role` thật, có đóng dấu `app.actor_id`. Không mục nào là suy đoán từ việc đọc mã.

### 1. Bốn câu lệnh × từng bảng × năm vai

**Năm vai của nền tảng dùng chung đúng một vai CSDL** (`app_role`) — đã kiểm bằng
`SELECT current_user, session_user`. Nên ở tầng SQL, "năm vai" cho **một** kết quả, và tôi ghi
điều đó ra thay vì chạy năm lần giống hệt nhau.

Quét **284 ô** (71 bảng kể cả cả hai phân mảnh × 4 câu lệnh), chạy thật, ghi lại SQLSTATE:

| Kết quả | Số ô |
|---|---|
| `42501` — thật sự **không có quyền** | **80** |
| chạy được, không lỗi | 141 |
| **hỏng vì lý do KHÁC** (`23502` NOT NULL, `P0001` trigger, `0A000`) | **63** |

Đối chiếu hai chiều với `has_table_privilege` ngay trong cùng câu quét:

- ô nào chạy được (hoặc hỏng vì lý do khác 42501) mà `has_table_privilege` nói **không có quyền**: **0**
- ô nào bị `42501` mà `has_table_privilege` nói **có quyền**: **0**

Ma trận đo bằng chạy thật **trùng khít** ma trận đo bằng bảng hệ thống, và cả hai trùng khít
`expected-grants.json`. Cả hai phân mảnh `audit_log` cũng bị quét (tôi **không** loại
`relispartition`) và cả hai cho đúng `SELECT, INSERT`.

### 2. `member_contacts` bằng cả năm vai — cả năm phải hỏng

```
member_contacts | SELECT | 42501 | permission denied for table member_contacts
member_contacts | INSERT | 42501 | permission denied for table member_contacts
member_contacts | UPDATE | 42501 | permission denied for table member_contacts
member_contacts | DELETE | 42501 | permission denied for table member_contacts
```

Chạy lại bằng bốn actor khác nhau (`dan` không vai, `alice` approver, `bob` approver, `tam` tech):
**cả bốn cùng `42501`**, đúng như dự đoán — vì vai nền tảng không đổi vai CSDL.

Đối chứng bắt buộc (thiếu nó thì bốn dòng trên xanh y hệt khi cột rỗng): số điện thoại
`0911111111` **thật sự nằm trong CSDL**, đọc được bằng kết nối chủ bảng. Và đường hợp lệ trả
đúng bao bì trạng thái thay vì giá trị:

```
contact_read(nan,'phone') boi nguoi la cung hoi
  -> allowed=f | value=NULL | reason=NEEDS_CONSENT
```

### 3. Mọi hàm `SECURITY DEFINER` gọi bằng vai thấp nhất

Xem bảng đầy đủ ở B1.1. Người gọi là **`dan` — không có hàng `member_roles` nào**, tức thấp hơn cả
`member`. Tám hàm gọi được đều ném đúng mã tự kiểm; hai hàm trigger chết ở `42501`.

### 4. Tự nâng quyền

| Phép thử | Kết quả thật |
|---|---|
| `approver` tự gán `tech` cho **chính mình** | `ROLE_SELF_GRANT` |
| `approver` gán `tech` cho người khác | `ROLE_MANAGE_DENIED` |
| **`tech` tự gán `tech` cho CHÍNH `tech`** | `ROLE_SELF_GRANT` |
| `tech` tự **gỡ** vai của chính mình | `ROLE_SELF_GRANT` |
| `tech` `INSERT` thẳng vào `member_roles` | `42501 permission denied for table member_roles` |
| `tech` `DELETE` thẳng khỏi `member_roles` | `42501 permission denied for table member_roles` |
| **đối chứng** — `tech` gán `content_ops` cho người khác | chạy được |

Chỗ đáng ghi nhận: `tech` **thoả** câu kiểm vai, nên nếu luật duy nhất là "phải là tech" thì tự
nâng quyền của `tech` đi qua. Nó bị chặn bởi một câu **riêng** đứng **trước** câu kiểm vai, ở
**trigger trên chính bảng `member_roles`** chứ không chỉ trong hàm. Đó là bài học Ruling T10-a
được áp dụng ngay lúc dựng cửa thay vì sau khi mất một vòng soát xét.

### 5. Ghi `audit_log` với `actor_id` là người khác

| Phép thử | Kết quả thật |
|---|---|
| đóng dấu `dan`, ghi `actor_id = alice` | `AUDIT_ACTOR_MISMATCH` |
| **không** đóng dấu, ghi `actor_id = alice` | `AUDIT_ACTOR_MISMATCH` |
| **đối chứng** — đóng dấu `dan`, ghi `actor_id = dan` | chạy được |
| **đối chứng** — không đóng dấu, ghi sự kiện **không có người** | chạy được |
| `UPDATE` / `DELETE` trên `audit_log` | `42501` cả hai |
| `UPDATE` / `DELETE` trên phân mảnh `audit_log_2026_08` | `42501` cả hai |

Hai đối chứng là bắt buộc: thiếu chúng thì một trigger chặn **tất cả** cũng làm bốn dòng đầu xanh.

### 6. Khung hai người ký

Chạy trong **giao dịch thật có `COMMIT`**, vì các constraint trigger là `DEFERRABLE INITIALLY
DEFERRED` — chúng chỉ nổ ở cuối giao dịch. (Lần chạy đầu tôi bọc trong khối `EXCEPTION` của
plpgsql và **kết quả sai**: câu `UPDATE` "chạy được", lỗi chỉ hiện lúc `COMMIT`. Ghi lại vì đó là
một cách đo sai dễ mắc.)

| Phép thử | Kết quả thật |
|---|---|
| **một** chữ ký rồi `status='executed'` | `TWO_SIGNATURES_REQUIRED` — *"hành động đã thi hành còn 1 chữ ký"* |
| người thứ hai **sai vai** (`tech` ký việc đòi `approver`) | `SIGNER_ROLE_REQUIRED`, **ngay lúc ghi chữ ký** |
| người thứ hai **là đối tượng** của hành động | `SIGNER_IS_TARGET` |
| chữ ký thứ hai mang `payload_hash_at_sign` **sai** | ghi được, nhưng **không được đếm** ⇒ `TWO_SIGNATURES_REQUIRED` |
| **đối chứng** — hai chữ ký đúng vai, đúng băm | thi hành được, `role_at_sign = approver,approver` |

Mục "người thứ hai sai vai **tại thời điểm ký**" được canh ở đúng chỗ: `fn_pending_signature_valid`
kiểm vai rồi **đóng dấu `role_at_sign` ngay tại đó**, và hàm đếm không hỏi `member_roles` nữa.

### 7. Token cũ của người đã chuyển `status='left'`

Không đo lại bằng SQL vì đây là luật tầng ứng dụng. Đã đọc `api/src/middleware/auth.js`: nó
**tra lại `members.status` MỖI request** (dòng 48–62) và từ chối `401` khi `status <> 'member'` —
không tin vào nội dung JWT. `t27` mục 7 kiểm cả access token lẫn refresh token, có đối chứng
"trước khi rời thì token dùng được". Hình dạng đúng; không có gì để thêm.

### 8. `fn_community_config_apply` bằng một thành viên thường

`EXECUTOR_NOT_SIGNER`. Cấu hình **không đổi** — đã kiểm lại giá trị `config` sau phép thử. Bảng
đầy đủ năm nhánh ở B4.2.

### 9. Gán vai `approver` cho người ở cộng đồng khác

| Phép thử | Kết quả thật |
|---|---|
| `tech` của Hội A gán vai cho người Hội B | `NO_TARGET` |
| `tech` của Hội A gỡ vai của người Hội B | `NO_TARGET` |
| `tech` gán vai cho một UUID **không tồn tại** | `NO_TARGET` — **cùng một câu** |

Ba kết quả giống hệt nhau là **có chủ đích** và là điều đúng: nếu "ở Hội khác" và "không tồn tại"
nói hai câu khác nhau thì chính thông điệp lỗi thành máy dò danh sách thành viên của Hội bên kia.

### 10. Chỗ hở #24 — `role_at_sign`, cả hai chiều

```
but toan chi 50.000.000, hai chu ky cua alice va bob (deu approver)
  truoc khi go vai : 2 chu ky hop le, role_at_sign = approver,approver
  go vai approver khoi alice qua fn_role_revoke (cua hop le, khong phai DELETE tran)
  vai da bi go THAT: con 0 hang member_roles
  sau khi go vai   : 2 chu ky hop le      <-- KHONG mat hieu luc nguoc
  khoa but toan    : chay duoc

chieu nguoc lai:
  gan vai approver cho mot nguoi CHUA TUNG KY
  sau khi gan      : 2 chu ky (khong phai 3) <-- gan vai khong de ra chu ky
```

Cả hai chiều đúng. Quả mìn mà `RANG-BUOC.md` mục 7 đặt sẵn cho task viết luồng gán vai đã được
tháo ngòi ở 028 (`role_at_sign` ghi vào **chính hàng chữ ký**, do trigger ghi đè — ứng dụng gửi gì
cũng bị bỏ) và 029 không cắm lại.

---

## Câu hỏi chốt — cách phá luật mà bài test vẫn xanh

### PHÁT HIỆN: bài "chạy thật 4 câu lệnh trên 72 bảng" có thể XANH sau khi kiểm được **ba** bảng

Vòng lặp nằm trong `app.transaction(...)` kết thúc bằng `.catch(() => {})`. Cái `.catch()` đó có
mặt vì giao dịch **cố ý** kết thúc bằng `trx.rollback()`, mà `rollback()` làm promise của knex bị
từ chối. Nhưng nó nuốt **luôn** mọi ngoại lệ khác trong thân vòng lặp — kể cả
`expect(want).toBeDefined()`, câu bảo hiểm "bảng này chưa có trong `expected-grants.json`" (câu đó
là mã chết: nó không bao giờ làm bài test đỏ được).

Đã tái hiện **hai chiều**, bằng chạy thật:

| Đột biến | Kết quả |
|---|---|
| khai sai quyền `profile_views` (thêm `UPDATE`, `DELETE`) | `t27` **ĐỎ** — đúng như phải thế |
| khai sai **cùng thứ đó** + chèn một `throw` sau bảng thứ ba | `t27` **38/38 XANH** |

Ba bảng đầu theo thứ tự chữ cái là `activities`, `activity_needs`, `activity_participants`. Sáu
mươi tám bảng còn lại — gồm `member_contacts`, `member_roles`, `audit_log`, cả ba bảng chữ ký —
**không được kiểm một câu nào**, và bài test vẫn báo xanh.

Đây đúng khuôn hình mà đề bài đi tìm: *một cái lưới xanh vì lý do sai*. Nó không đòi ai cố ý phá
hoại — chỉ cần một lỗi bất kỳ ở giữa vòng lặp (một bảng mới có kiểu cột lạ, một trigger ném ngoài
`SAVEPOINT`, một lần mất kết nối) là bài test âm thầm thu hẹp phạm vi và không nói gì.

**Đã sửa** (lỗi rõ ràng và nhỏ, đúng loại đề bài cho phép sửa kèm bài canh):

```js
let daQuet = 0;
let loiTrongVongLap = null;
await app.transaction(async (trx) => {
  try { for (...) { …; daQuet += 1; } }
  catch (e) { loiTrongVongLap = e; }
  await trx.rollback().catch(() => {});
}).catch(() => {});

if (loiTrongVongLap) throw loiTrongVongLap;          // ngoại lệ không bị nuốt nữa
expect(daQuet, 'vòng quét dừng giữa chừng — những bảng còn lại KHÔNG được kiểm')
  .toBe(tables.length);                              // và phạm vi phải đủ
expect(lech, 'quyền thực thi THẬT lệch với expected-grants.json').toEqual([]);
```

Kiểm chứng bản vá, cùng một đột biến, cùng một lệnh chạy:

- không đột biến ⇒ `t27` **38/38 xanh**;
- chèn lại `throw` sau bảng thứ ba ⇒ `t27` **ĐỎ**, và đỏ **đúng vì lý do thật**
  (`Error: DOT BIEN: loi giua vong lap`), không phải vì một khẳng định phụ.

### Cách phân loại theo SQLSTATE **không** nhầm — có bằng chứng số

Đề bài hỏi thẳng: *"một `INSERT` bị trigger chặn không phải là 'không có quyền' — nếu bài test coi
mọi lỗi là 'bị chặn' thì nó đang xanh vì lý do sai."*

`t27` viết `denied = e?.code === '42501'` và **chỉ** `42501`. Mọi mã khác được tính là **đã qua cửa
quyền** — hướng bảo thủ đúng. Con số cho thấy đây không phải chuyện nhỏ: trong 284 ô,
**63 ô hỏng vì lý do khác `42501`**:

| SQLSTATE | Số ô | Nghĩa |
|---|---|---|
| `23502` | 51 | vi phạm `NOT NULL` — câu `INSERT … DEFAULT VALUES` **đã qua** cửa quyền |
| `P0001` | 11 | trigger ném (`NO_ACTOR`, `REFERRER_REQUIRED`, `NO_CAPABILITY`, `NO_LOAN`, …) |
| `0A000` | 1 | `audit_log_2026_09`: *"moving row to another partition during a BEFORE FOR EACH ROW trigger"* |

Nếu bài test coi "có lỗi = bị chặn" thì **63 trong 284 ô (22%) bị phân loại sai**, và mọi bảng bị
nới quyền `INSERT` sẽ lọt qua trong im lặng. Cách phân loại hiện tại đúng.

Hai chi tiết nữa của cách đo, cả hai đúng:

- `UPDATE … WHERE false` / `DELETE … WHERE false` vẫn trả `42501` khi thiếu quyền, vì PostgreSQL
  kiểm quyền **trước** khi tìm hàng — nên câu lệnh không đụng dữ liệu mà vẫn trả lời được câu hỏi
  về quyền. Đã xác nhận trên cả 71 bảng.
- VIEW bị loại khỏi phép quét chạy-thật **có chủ đích**, vì `INSERT` lên view không tự cập nhật
  được ném `55000` chứ không phải `42501` — không phân biệt được "từ chối vì quyền" với "từ chối
  vì hình dạng". `t10` phủ view bằng `has_table_privilege`. Lựa chọn đúng, và nó được ghi ra ngay
  trong bài test.

### Ba cách phá luật khác mà lưới hiện tại **không** bắt

Ba chỗ dưới đây tôi **không** sửa: chúng đòi thay đổi thiết kế hoặc nằm ngoài phạm vi Task 16.

**(a) Phân mảnh của một bảng KHÁC `audit_log`.** `t10` loại `NOT c.relispartition` khỏi bài quét
chính, còn bài quét phân mảnh chỉ hỏi `pg_inherits WHERE inhparent = 'audit_log'::regclass`. Nếu
một bảng khác được phân mảnh ở giai đoạn sau, các phân mảnh của nó vô hình với **cả hai** bài — và
`ALTER DEFAULT PRIVILEGES` của 002 cấp cho chúng **đủ bốn quyền**. Cùng lý do với phân mảnh nhiều
tầng của chính `audit_log` (`inhparent` chỉ bắt con trực tiếp). Sửa: đổi câu quét thành "mọi quan
hệ có `relispartition`, quy về bảng gốc bằng `pg_partition_root`".

**(b) `GRANT nhachung_owner TO app_role WITH INHERIT FALSE`.** `t10` đo bằng
`has_table_privilege('app_role', …)`, và hàm đó **tôn trọng** `INHERIT`: với `INHERIT FALSE` nó
trả `false` cho mọi bảng của chủ sở hữu, nên bài "quyền hiệu lực khớp khai báo" vẫn xanh. Bài
"không grantee nào ngoài `app_role` và chủ sở hữu" cũng không thấy, vì tư cách thành viên vai
**không nằm trong** `information_schema.table_privileges`. Nhưng `app_role` khi ấy
`SET ROLE nhachung_owner` được và đọc mọi số điện thoại. Sửa: thêm một bài khẳng định
`pg_auth_members` không có hàng nào cấp vai cho `app_role`.

**(c) Sửa đồng thời `024` và `expected-grants.json`.** Với mười bảng chỉ được canh bằng ma trận
quyền và không có bài hành vi nào (`profile_views`, `signal_forwards`, `connection_events`,
`complaint_events`, `memory_versions`, `report_versions`, `backups`, `restore_tests`,
`loan_repayments`, `aid_events`), nới một quyền rồi sửa cả hai tệp là **xanh tuyệt đối**. Đây là
giới hạn cấu trúc, không phải lỗi của Task 16: mọi ma trận khai báo đều có nó, và giá của việc
đóng nó là một bài hành vi cho từng bảng.

---

## Chạy lại bộ kiểm thử

```
32 tep / 403 bai - XANH   (moi tep tru t02-role-password)
t02-role-password         - DO, vi MOI TRUONG, khong vi ma
```

`t02` chạy `DROP ROLE IF EXISTS app_role` — một lệnh **cấp cụm**, không cấp CSDL. Trong lúc tôi
làm việc, ba CSDL khác xuất hiện trong cùng cụm (`nhachung_l15`, `nhachung_l17`, `nhachung_qd1`;
không có ở lần tôi liệt kê đầu phiên, và không có kết nối nào đang mở tới chúng). Cả ba chứa đối
tượng cấp quyền cho `app_role`, nên PostgreSQL từ chối `DROP ROLE`:

```
role "app_role" cannot be dropped because some objects depend on it
```

Tôi đã **xoá `nhachung_probe`** của mình; ba CSDL kia là của vòng soát xét khác nên tôi **không
đụng vào**. Sau khi xoá `nhachung_probe`, chạy 32 tệp còn lại cho **403/403 xanh**, gồm cả bản vá
`t27` ở trên.

> **Một cảnh báo về chính bộ kiểm thử, và nó cũng là lời đính chính cho hướng dẫn của đề bài.**
> Đề bài viết: *"nếu bạn cần một CSDL riêng để thăm dò, tạo `nhachung_probe` riêng."* Làm đúng như
> vậy **cũng phá `t02`**, vì `DROP ROLE` là lệnh cấp cụm còn `app_role` là vai dùng chung cho mọi
> CSDL trong cụm. Cách an toàn: thăm dò xong thì `DROP DATABASE` **trước** khi chạy bộ kiểm thử,
> và xoá cả ba CSDL bỏ quên ở trên trước lần chạy tới. Sâu hơn, `t02` đang cưỡng chế một tính chất
> cấp cụm bằng một bài test cấp CSDL — nó sẽ đỏ vì lý do sai mỗi lần có ai để lại một CSDL trong
> cùng Postgres. Đáng cân nhắc cho `t02` một cụm riêng, hoặc một tên vai riêng theo từng lần chạy.

---

## Việc cố ý CHƯA làm, và vì sao

| Việc | Vì sao chưa làm |
|---|---|
| Vá chỗ phát lại `fn_community_config_apply` (B4.3) | Bản vá đụng thứ tự trigger `trg_pending_action_frozen` (027) và câu `UPDATE` ngay sau đó trong `twoPerson.js`. Đề bài: *"lỗi lớn thì báo cáo, đừng tự ý thiết kế lại"* |
| Siết `capability_evidence` và `activities` bớt `DELETE` (A.2) | Đúng ra phải sửa **đặc tả mục 4.8** trước, rồi mới sửa hằng `GRANTS` của `024`. Sửa một đầu là tạo ra vênh giữa đặc tả và mã |
| Thêm bài quét `pg_auth_members` cho lỗ (b) | Là bài test **mới** cho một loại tấn công chưa ai đặt vấn đề. Đề nghị chứ không tự thêm giữa một vòng soát xét |
| Đổi cách quét phân mảnh sang `pg_partition_root` cho lỗ (a) | Hôm nay chỉ `audit_log` được phân mảnh nên chưa có gì hở. Sửa bây giờ là sửa cho một tình huống chưa tồn tại; ghi lại để người phân mảnh bảng tiếp theo đọc được |
| Xoá `nhachung_l15`, `nhachung_l17`, `nhachung_qd1` | Không phải của tôi. Chúng làm `t02` đỏ; người chủ trì quyết |
| Thêm bài quét `community_id` mà đặc tả mục 4.5 đã hứa | Đúng phạm vi của T10, không phải Task 16. Ba câu SQL ở B2 là hình dạng sẵn sàng dùng |

---

## Kết luận

**Ma trận quyền này ĐÁNG TIN.**

Ba lý do, xếp theo sức nặng:

1. **Nó đứng vững trước một phép dựng lại độc lập.** Bảng tôi dựng từ đặc tả trước khi mở bất kỳ
   tệp kỳ vọng nào (commit `4b16728`) lệch với `expected-grants.json` ở đúng sáu ô — **bốn ô người
   thi công chặt hơn tôi, hai ô cả ba bên cùng lỏng theo đúng một dòng đặc tả**. Không ô nào người
   thi công nới lỏng. Nỗi lo mở đầu vòng soát này — *"một bảng lẽ ra chỉ-thêm mà file khai là được
   `UPDATE`"* — không xảy ra.
2. **Khai báo được đo bằng hai phép đo khác bản chất, và cả hai khớp thực tế.** Tôi chạy lại cả
   hai một cách độc lập trên CSDL riêng: `has_table_privilege` và 284 câu lệnh thật. Không một ô
   nào lệch. Cách phân loại `42501` được xác minh là **không** nhầm 63 lỗi khác thành "bị chặn".
3. **Lớp bảo vệ không dừng ở bảng.** Mười hàm `SECURITY DEFINER` đều đã thu `EXECUTE` khỏi
   `PUBLIC`, và tám hàm gọi được đều tự kiểm người gọi — kiểm bằng cách gọi thật bằng một người
   **không có vai nào**. Đây là phần việc mạnh nhất của Task 16, và nó bịt bốn cửa dẫn thẳng tới
   số điện thoại và băm mật khẩu mà bốn migration cũ để hở.

Ba điều kiện kèm theo, và chúng không phải chú thích lịch sự:

- **Cửa `communities.config` đúng hình dạng nhưng tính "dùng một lần" của nó nằm trong JavaScript,
  không nằm trong CSDL** (B4.3, đã tái hiện: một người quay ngược quyết định của hai người). Trong
  cùng migration, cửa `guarantee.quota_override` làm đúng bằng một `UNIQUE`. Đây là việc phải làm
  tiếp, không phải việc để ghi nhận rồi quên.
- **Cái lưới đo ma trận ấy đã từng có thể xanh sau khi kiểm ba bảng** (đã tái hiện hai chiều, đã
  vá trong vòng này). Ma trận đáng tin; cái lưới canh nó thì vừa mới đáng tin.
- **`auth_lookup` chỉ được canh bằng một dòng `expect`**, không bằng đối tượng SQL nào. Xoá bài
  test ấy là gỡ lớp canh duy nhất của một hàm trả về `password_hash`.

---

## Đính chính về môi trường — nhánh đã đổi TRONG lúc soát xét

Phải ghi rõ vì nó ảnh hưởng tới cách đọc mọi con số ở trên.

Đề bài viết: *"Chỉ MỘT tiến trình được chạy `vitest` — không có agent nào khác đang chạy."*
**Điều đó không đúng trong thực tế.** Trong lúc tôi làm việc, một tiến trình khác đã:

| Lúc | Việc |
|---|---|
| ~18:35 → | tạo ba CSDL `nhachung_l15`, `nhachung_l17`, `nhachung_qd1` trong cùng cụm Postgres |
| 19:07 | commit `8945ac3` — migration **030** (`files`) + tệp test `t28-files.test.js` |
| 19:18 | commit `6391fcd` — migration **031** (`guarantee_invites`) |
| 19:25 (lúc tôi kiểm) | còn một phiên `idle in transaction` trên `nhachung_l15`, đang chạy `CREATE FUNCTION fn_guarantee_slots_used(...)` |

Hệ quả, và cách đọc đúng từng con số:

- **Mọi phép đo của Giai đoạn A, B, C đo trên `nhachung_probe`** — một CSDL migrate đúng **32
  migration**, tức đúng trạng thái của ba commit đang được soát (`7b202e8`, `8ef9071`, `951bdcb`).
  Đó là phạm vi đúng, và nó **không** bị 030/031 làm nhiễu. Con số "72 quan hệ" là con số của
  phạm vi ấy; ở `HEAD` hôm nay nó đã lớn hơn vì 030 và 031 thêm bảng.
- **Bản vá `t27` đã kiểm chứng trên `HEAD` hiện tại**: `t10-grants` + `t27-ops-vai-quyen` =
  **44/44 xanh**, chạy sau khi 030 và 031 đã vào nhánh.
- **Bộ kiểm thử đầy đủ ở `HEAD` hiện tại: 34 tệp, 403 bài xanh, 2 tệp đỏ**, và **cả hai đều
  không phải phạm vi của tôi**:
  - `t02-role-password` — đỏ vì `DROP ROLE app_role` là lệnh cấp cụm, và ba CSDL kia giữ đối
    tượng cấp quyền cho vai đó (xem cảnh báo ở mục trước);
  - `t28-files` — tệp test **mới của tiến trình kia**, đang dở: `Error: read ECONNRESET` ở bài
    *"tệp quá 10 MB ⇒ 413"*.

Tôi **không** đụng vào 030, 031, `t28-files`, hay ba CSDL kia. Đề nghị cho người chủ trì: cho
hai vòng làm việc chạy nối tiếp thay vì chồng lên nhau, hoặc cho mỗi vòng một cụm Postgres riêng —
`t02` sẽ còn đỏ vì lý do sai chừng nào hai vòng còn dùng chung một cụm.
