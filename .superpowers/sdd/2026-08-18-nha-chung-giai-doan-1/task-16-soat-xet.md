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
