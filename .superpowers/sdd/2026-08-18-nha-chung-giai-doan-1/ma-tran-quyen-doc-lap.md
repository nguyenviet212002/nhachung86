# Ma trận quyền dựng lại độc lập — Giai đoạn A của vòng soát xét Task 16

> Tệp này được viết **trước khi** người soát xét mở `api/tests/expected-grants.json`,
> `api/tests/t10-grants.test.js` hoặc `api/tests/t27-ops-vai-quyen.test.js`, và trước khi đọc
> hằng `GRANTS` trong `024_indexes_and_revokes.js`. Nó là bảng dựng lại từ **đặc tả** cộng với
> **danh sách quan hệ có thật trong CSDL**, để đối chiếu về sau là đối chiếu hai bản độc lập chứ
> không phải soi chính tả một bản.
>
> Nguồn dùng để dựng: `docs/superpowers/specs/2026-08-18-nha-chung-giai-doan-1-design.md`
> (mục 1.5, 1.6, 3, 4.2, 4.8, 6, 7) và `docs/RANG-BUOC.md` (mục 4.1–4.3, 5, 7).
> Nguồn dùng để liệt kê quan hệ: chính CSDL, không phải tệp migration —
> `pg_class` trên một bản `nhachung_probe` migrate đầy đủ từ schema trắng.

---

## 0. Một điều phải nói trước mọi thứ khác

**Ma trận quyền PostgreSQL không phân biệt năm vai ứng dụng.** Cả năm vai (`guest`, `member`,
`content_ops`, `approver`, `tech`) đều đi vào CSDL bằng **đúng một** vai PostgreSQL: `app_role`.
Vai ứng dụng nằm trong bảng `member_roles`, và nó chỉ có hiệu lực ở hai chỗ:

1. `requireRole(...)` ở tầng route (tầng ứng dụng, gỡ được bằng một câu SQL trần), và
2. bên trong các hàm `SECURITY DEFINER` **tự kiểm người gọi**.

Vì vậy câu "thử bốn câu lệnh bằng từng vai trong năm vai" ở tầng SQL cho **một** kết quả duy nhất
cho cả năm vai. Chỗ năm vai thật sự khác nhau là (2). Đây là lý do mục B1 (EXECUTE cho PUBLIC) và
mục 4.7/6.1 của `RANG-BUOC.md` mới là chỗ có sức nặng, chứ không phải bảng `GRANT` trên bảng.

---

## 1. Nguyên tắc dùng để quyết định từng ô

| Ký hiệu | Nguyên tắc | Xuất xứ |
|---|---|---|
| **P1** | Bút toán / chữ ký / sổ sự kiện: ghi rồi **không sửa, không gỡ** ⇒ `SELECT, INSERT` | đặc tả 4.8 |
| **P2** | Nhật ký chỉ-thêm, kể cả **mọi phân mảnh** ⇒ `SELECT, INSERT`; `UPDATE`/`DELETE` phải bị thu hồi ở cấp PostgreSQL, kể cả với user ứng dụng | đặc tả 1.6 + 4.8 |
| **P3** | Bí mật đã che (`member_contacts`, `join_request_secrets`): `app_role` **không đọc được**; đường vào là hàm `SECURITY DEFINER` tự kiểm | đặc tả 4.2 |
| **P4** | Đơn / hồ sơ đã mở **không biến mất** ⇒ bỏ `DELETE`, giữ `SELECT, INSERT, UPDATE` | đặc tả 4.8 |
| **P5** | Bản dẫn xuất (cạnh quan hệ, cache uy tín): ứng dụng **không ghi**, chỉ trigger/hàm sinh ⇒ `SELECT` | đặc tả 4.1, 8.3 |
| **P6** | Hằng số nền tảng (`roles`, `permissions`, `role_permissions`) ⇒ `SELECT` | đặc tả 4.8 |
| **P7** | Vai trò là dữ liệu **chỉ-đọc với ứng dụng**; gán/gỡ vai đi qua hàm tự kiểm, không qua `INSERT` trần | đặc tả 7.4 §2, RANG-BUOC 4.1 |
| **P8** | Còn lại: đủ bốn quyền | đặc tả 4.8 dòng cuối |

---

## 2. Bảng — 72 quan hệ trong schema `public` (không kể `knex_migrations*`)

Cột **CID** = có cột `community_id`. Đã kiểm bằng `pg_attribute`: **mọi** quan hệ có `community_id`
đều `NOT NULL` **và** có khóa ngoại tới `communities(id)` (không quan hệ nào lệch).

| # | Quan hệ | Vai trò một dòng | CID | Quyền tôi cho là **đúng** | Lý do |
|---|---|---|---|---|---|
| 1 | `audit_log` (partitioned) | nhật ký gốc | ✔ | `SELECT, INSERT` | P2 |
| 2 | `audit_log_2026_08` | phân mảnh tháng 8 | ✔ | `SELECT, INSERT` | P2 — phân mảnh là bảng thật, `ALTER DEFAULT PRIVILEGES` cấp lại đủ bốn quyền nếu không `REVOKE` |
| 3 | `audit_log_2026_09` | phân mảnh tháng 9 | ✔ | `SELECT, INSERT` | P2 |
| 4 | `audit_chain_head` | đầu chuỗi băm nhật ký | ✔ | `SELECT, INSERT, UPDATE` | trigger phải cập nhật đầu chuỗi mỗi lần ghi; `DELETE` xoá mốc neo ⇒ bỏ |
| 5 | `member_contacts` | số điện thoại / địa chỉ | ✔ | **không quyền nào** | P3 |
| 6 | `join_request_secrets` | số + băm mật khẩu của người nộp đơn | ✔ | `INSERT` **và chỉ** `INSERT` | P3 — đặc tả 4.2 nói rõ `REVOKE ALL` rồi `GRANT INSERT` |
| 7 | `member_relations` | cạnh quan hệ, **bản dẫn xuất** | ✔ | `SELECT` | P5 |
| 8 | `member_trust_stats` | cache bậc uy tín | ✔ | `SELECT` | P5 |
| 9 | `roles` | hằng số vai | — | `SELECT` | P6 |
| 10 | `permissions` | hằng số quyền | — | `SELECT` | P6 |
| 11 | `role_permissions` | ánh xạ vai→quyền | — | `SELECT` | P6 |
| 12 | `member_roles` | ai mang vai nào | ✔ | `SELECT` | **P7 — ô quan trọng nhất của Task 16.** Luồng gán vai mới phải đi qua hàm `SECURITY DEFINER` tự kiểm `tech`; nếu Task 16 cấp `INSERT`/`DELETE` trần thì tự-nâng-quyền chỉ còn cách một câu SQL |
| 13 | `fund_entry_approvals` | chữ ký duyệt bút toán | ✔ | `SELECT, INSERT` | P1 |
| 14 | `endorsement_signatures` | chữ ký bảo chứng | ✔ | `SELECT, INSERT` | P1 |
| 15 | `pending_action_signatures` | chữ ký hành động chờ | ✔ | `SELECT, INSERT` | P1 |
| 16 | `work_confirmations` | xác nhận đã làm cùng | ✔ | `SELECT, INSERT` | P1 |
| 17 | `profile_views` | dấu vết đã xem hồ sơ | ✔ | `SELECT, INSERT` | P1 — người xem không xoá dấu vết |
| 18 | `signal_forwards` | chuyển tiếp tín hiệu | ✔ | `SELECT, INSERT` | P1 — chuyển tiếp là nhận trách nhiệm |
| 19 | `connection_events` | sổ sự kiện kết nối | ✔ | `SELECT, INSERT` | P1 |
| 20 | `complaint_events` | sổ sự kiện khiếu nại | ✔ | `SELECT, INSERT` | P1 |
| 21 | `aid_events` | sổ sự kiện giúp nhau | ✔ | `SELECT, INSERT` | P1 |
| 22 | `loan_repayments` | sổ trả nợ | ✔ | `SELECT, INSERT` | P1 |
| 23 | `memory_versions` | lịch sử phiên bản ký ức | ✔ | `SELECT, INSERT` | P1 |
| 24 | `report_versions` | lịch sử phiên bản báo cáo | ✔ | `SELECT, INSERT` | P1 |
| 25 | `backups` | ghi nhận đã sao lưu | ✔ | `SELECT, INSERT` | P1 |
| 26 | `restore_tests` | ghi nhận đã thử khôi phục | ✔ | `SELECT, INSERT` | P1 |
| 27 | `guarantee_quota_overrides` | nới hạn mức bảo lãnh | ✔ | `SELECT, INSERT` | P1 — nới lỏng tự hết hạn bằng `valid_until`. **Sau 028 phải kèm một cửa buộc hàng này đến từ `pending_action` đã thi hành** (chỗ hở #20) |
| 28 | `fund_entries` | bút toán quỹ | ✔ | `SELECT, INSERT, UPDATE` | không xoá; `locked` chặn sửa |
| 29 | `work_records` | bản ghi việc | ✔ | `SELECT, INSERT, UPDATE` | không xoá; `WORK_RECORD_FROZEN` chặn sửa |
| 30 | `join_requests` | đơn gia nhập | ✔ | `SELECT, INSERT, UPDATE` | P4 |
| 31 | `contact_requests` | đơn xin quyền đọc liên hệ | ✔ | `SELECT, INSERT, UPDATE` | P4 |
| 32 | `complaints` | khiếu nại | ✔ | `SELECT, INSERT, UPDATE` | P4 |
| 33 | `moderation_queue` | hàng đợi kiểm duyệt | ✔ | `SELECT, INSERT, UPDATE` | P4 |
| 34 | `transparency_reports` | báo cáo minh bạch | ✔ | `SELECT, INSERT, UPDATE` | P4 |
| 35 | `loans` | khoản vay | ✔ | `SELECT, INSERT, UPDATE` | P4 |
| 36 | `subject_keys` | khóa mã hoá theo chủ thể | ✔ | `SELECT, INSERT, UPDATE` | "hủy" là `UPDATE destroyed_at`, không phải `DELETE` |
| 37 | `memory_consents` | đồng ý ở mức ký ức | ✔ | `SELECT, INSERT, UPDATE` | đổi ý được, xoá thì không |
| 38 | `memory_photo_people` | lời khai có mặt trong ảnh | ✔ | `SELECT, INSERT, UPDATE` | gỡ hàng = xoá tiếng "không" |
| 39 | `activity_summaries` | bản tổng kết hoạt động | ✔ | `SELECT, INSERT, UPDATE` | xoá là mở lại cổng `SUMMARY_REQUIRED` |
| 40 | `v_signal_recipients` (VIEW) | hợp nhất người nhận + trả lời | ✔ | `SELECT` | view chỉ đọc; `ALTER DEFAULT PRIVILEGES` cấp cả bốn quyền cho view y như bảng |
| 41 | `communities` | cộng đồng + `config` | — | `SELECT, INSERT, UPDATE` (**xem ghi chú C dưới**) | không xoá cộng đồng; `config` là đòn bẩy nặng nhất trong hệ thống |
| 42 | `areas` | khu vực | ✔ | đủ bốn | P8 |
| 43 | `members` | hồ sơ người | ✔ | đủ bốn | P8 (xoá thật sự bị chặn bằng bia mộ ở tầng khác) |
| 44 | `privacy_settings` | mức riêng tư tám trường | ✔ | đủ bốn | P8 — `trg_privacy_self_only` (027) canh danh tính |
| 45 | `refresh_tokens` | vé làm mới phiên | ✔ | đủ bốn | P8 — thu hồi phiên phải xoá được |
| 46 | `otp_challenges` | vé OTP | ✔ | đủ bốn | P8 — luồng, không phải bất biến dữ liệu |
| 47 | `capabilities` | năng lực | ✔ | đủ bốn | P8 |
| 48 | `capability_photos` | ảnh năng lực | ✔ | đủ bốn | P8 |
| 49 | `capability_evidence` | bằng chứng năng lực | ✔ | đủ bốn | P8 — **tôi ngờ ô này**, xem ghi chú D |
| 50 | `work_participants` | người tham gia việc | ✔ | đủ bốn | đặc tả 4.8 nói rõ đủ bốn; đóng băng bằng `fn_work_participants_frozen` sau xác nhận đầu tiên |
| 51 | `signals` | tín hiệu | ✔ | đủ bốn | P8 |
| 52 | `signal_recipients` | người nhận tín hiệu | ✔ | đủ bốn | P8 |
| 53 | `signal_responses` | trả lời tín hiệu | ✔ | đủ bốn | P8 — `trg_sig_resp_self_only` (027) canh danh tính |
| 54 | `signal_options` | phương án của tín hiệu | ✔ | đủ bốn | P8 |
| 55 | `job_needs` | nhu cầu việc làm | ✔ | đủ bốn | P8 |
| 56 | `ready_profiles` | hồ sơ sẵn sàng | ✔ | đủ bốn | P8 |
| 57 | `introductions` | lời giới thiệu (ba chữ ký) | ✔ | đủ bốn | P8 — `trg_intro_consent_self_only` (027) canh |
| 58 | `connections` | kết nối việc làm | ✔ | đủ bốn | P8 |
| 59 | `aid_requests` | lời nhờ giúp | ✔ | đủ bốn | P8 |
| 60 | `aid_offers` | lời đề nghị giúp | ✔ | đủ bốn | P8 |
| 61 | `aid_slots` | suất giúp | ✔ | đủ bốn | P8 |
| 62 | `aid_slot_takers` | người nhận suất | ✔ | đủ bốn | P8 — `trg_ast_1/2` (027) canh |
| 63 | `activities` | hoạt động | ✔ | đủ bốn | P8 — **tôi ngờ ô này**, xem ghi chú E |
| 64 | `activity_participants` | người dự hoạt động | ✔ | đủ bốn | P8 |
| 65 | `activity_needs` | thứ cần cho hoạt động | ✔ | đủ bốn | P8 |
| 66 | `activity_photos` | ảnh hoạt động | ✔ | đủ bốn | P8 |
| 67 | `verifications` | xác minh | ✔ | đủ bốn | P8 |
| 68 | `endorsements` | bảo chứng | ✔ | đủ bốn | P8 — trigger hoãn trên chính bảng cha đếm lại ở mọi `UPDATE` |
| 69 | `memories` | ký ức | ✔ | đủ bốn | P8 |
| 70 | `memory_photos` | ảnh ký ức | ✔ | đủ bốn | P8 |
| 71 | `loan_guarantors` | người bảo lãnh khoản vay | ✔ | đủ bốn | P8 |
| 72 | `pending_actions` | hành động chờ hai chữ ký | ✔ | đủ bốn | P8 — `trg_pending_action_frozen` (027) đóng băng sau chữ ký đầu |

**Không có `community_id`:** `communities` (chính nó là gốc), `roles`, `permissions`,
`role_permissions` (ba bảng hằng số toàn cục, không chứa dữ liệu của hội nào — chứng minh ở
Giai đoạn B2 bằng cách liệt kê cột và nội dung). `knex_migrations`, `knex_migrations_lock` là
bảng hạ tầng của knex, không tính vào 72.

---

## 3. Ghi chú các ô tôi không chắc, ghi ra trước khi so

**A. `audit_chain_head` có `UPDATE`.** Tôi giữ `UPDATE` vì đầu chuỗi *phải* tiến. Nhưng nó là
một ngoại lệ có mùi: đây là bảng duy nhất trong hệ "nhật ký" mà ứng dụng ghi đè được. Bảo vệ thật
nằm ở chỗ `verifyChain` duyệt lại toàn bộ `audit_log` theo `seq` chứ không tin bảng head — nếu
`verifyChain` có lúc nào đó tin bảng head thì ô này thành lỗ.

**B. `member_roles` — `SELECT` hay hơn thế.** Đây là ô mà Task 16 có động cơ mạnh nhất để nới.
Phán quyết của tôi trước khi nhìn: **`SELECT` và chỉ `SELECT`**. Đường gán/gỡ vai phải là hàm
`SECURITY DEFINER` tự kiểm người gọi có vai `tech` **của đúng cộng đồng đó**, tự ghi `audit_log`.
Nếu cấp `INSERT` trần thì mục 4 danh sách tấn công ("`tech` gán vai `tech` cho chính `tech`",
"`approver` tự đổi vai của mình") không còn chỗ nào chặn ở tầng CSDL, và cả hệ hai-người-ký sụp
theo vì `fn_pending_signature_valid` đếm vai bằng `member_roles`.

**C. `communities` — `UPDATE` là chỗ hở #22 đã tái hiện.** Đặc tả không liệt kê `communities`
nên theo P8 nó "đủ bốn quyền". Tôi vẫn cho là **sai** và ghi ra ở đây: `DELETE` trên `communities`
không có nghiệp vụ nào cần, còn `UPDATE` trên cột `config` là đường "chi 50 triệu không một chữ ký"
mà `RANG-BUOC.md` mục 5.4 #22 đã tái hiện thật. Migration 028 nhận việc bịt chỗ này. Câu hỏi tôi
sẽ trả lời ở Giai đoạn B4: **028 bịt bằng cửa nào, và cửa ấy có mở từ ngoài được không.**

**D. `capability_evidence` — đủ bốn quyền là quá rộng.** Bằng chứng gắn một năng lực vào một
việc đã ký. `DELETE` một hàng bằng chứng là rút lại một lời khẳng định đã đưa ra, và
`RANG-BUOC.md` xếp nó cùng họ với `work_confirmations` (đã là `SELECT, INSERT`). Tôi cho rằng
đúng ra nó nên là `SELECT, INSERT` — nhưng đặc tả không nói, nên tôi ghi là **chênh có chủ đích**
chứ không phải lỗi của người thi công.

**E. `activities` — `DELETE` mở cổng `SUMMARY_REQUIRED`.** Cổng đó đếm "hoạt động đã xong dùng
quỹ mà chưa có tổng kết". Xoá hẳn hoạt động đang kẹt cũng làm con số về 0, y như đẩy `ends_at`
(chỗ hở #23). Đặc tả không liệt kê nên P8 cho đủ bốn quyền; tôi ghi ra là một cửa chưa ai đếm.

**F. Phân mảnh `audit_log` là mục tiêu di động.** Danh sách hôm nay có đúng hai phân mảnh
(`2026_08`, `2026_09`). Con số "72 bảng" vì vậy **không phải hằng số** — nó tăng một mỗi tháng.
Bất kỳ bài test nào khẳng định "đúng 72" sẽ đỏ vào một ngày không ai đoán trước, và bất kỳ ma
trận nào liệt kê phân mảnh **theo tên** sẽ thiếu phân mảnh của tháng sau. Phép kiểm đúng phải là
**quét theo mẫu / theo quan hệ cha**, không phải theo danh sách tên.

---

## 4. Cách tôi sẽ chứng minh (Giai đoạn C)

Không đọc `information_schema` để hỏi "có quyền không". Chạy **bốn câu lệnh thật** bằng kết nối
`app_role` trong một `SAVEPOINT`, rồi phân loại theo `SQLSTATE`:

- `42501` (`insufficient_privilege`) ⇒ **không có quyền** — đây là kết quả duy nhất được tính là "bị chặn bởi ma trận quyền".
- `23503` / `23502` / `23505` / `P0001` / bất kỳ mã nào khác ⇒ **CÓ quyền**, câu lệnh chỉ hỏng vì
  khoá ngoại, `NOT NULL`, trùng khoá hay trigger. Gộp chúng vào "bị chặn" là làm bài test xanh vì lý do sai.
- Không lỗi ⇒ **có quyền**.

Câu `UPDATE`/`DELETE` dùng `WHERE false` để không đụng dữ liệu và để trigger `FOR EACH ROW`
không có cơ hội che mất câu trả lời về quyền — PostgreSQL kiểm quyền **trước** khi tìm hàng, nên
`UPDATE t SET c=c WHERE false` vẫn trả `42501` khi thiếu quyền và trả "0 hàng" khi có quyền.
