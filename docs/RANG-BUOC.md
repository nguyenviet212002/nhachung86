# Bất biến liên bảng — bảng đối chiếu có hệ thống

> Tài liệu này là kết quả của một vòng rà **toàn bộ 71 bảng và 39 trigger** trong
> `api/src/db/migrations/`. Nó không phải bản tóm tắt đặc tả; nó là danh sách những
> **lời hứa** mà hệ thống đang giữ, kèm câu trả lời thật cho câu hỏi *"ai đang giữ lời hứa
> đó, và giữ được ở mấy đầu?"*
>
> Nguồn thẩm quyền vẫn là `docs/superpowers/specs/2026-08-18-nha-chung-giai-doan-1-design.md`
> (mục 4 và bảng đối chiếu mục 4.5/4.8). Chỗ nào tài liệu này vênh với đặc tả, đã ghi rõ.

---

## 1. Khuôn hình này là gì, và vì sao nó nguy hiểm

Một câu:

> **Ràng buộc đặt trên bảng A không chạy khi người ta động vào bảng B.**

Trigger là một cái bẫy gắn vào **một bảng**. Nó nổ khi có ai bước lên đúng bảng đó. Nhưng
luật mà nó cưỡng chế thường **đọc dữ liệu từ nhiều bảng** — và mọi bảng còn lại là những
cánh cửa không có bẫy. Người đi qua cửa nào cũng đổi được kết quả của luật; chỉ có một cửa
kêu lên.

Điều làm khuôn hình này nguy hiểm hơn một lỗi thường:

1. **Nó trông đã xong.** Đọc migration thấy có trigger, có `RAISE EXCEPTION`, có bài test
   xanh. Thứ thiếu không phải một dòng mã sai mà là một dòng mã *không tồn tại ở một tệp
   khác*.
2. **Nó im lặng.** Không có lỗi, không có cảnh báo. Dữ liệu chỉ đơn giản rơi vào một trạng
   thái mà luật cấm, và mọi câu truy vấn sau đó đọc trạng thái ấy như thể nó hợp lệ.
3. **Nó ngủ.** Lỗ hổng nằm im chừng nào chưa có endpoint chạm tới bảng B, rồi thức dậy
   đúng vào ngày ai đó viết endpoint ấy — thường là một người khác, nhiều tháng sau, không
   biết bảng B có liên quan gì tới luật của bảng A. (Ruling T10-a của dự án này chính là
   một ca như vậy: lỗ rò ngủ qua nhiều vòng soát xét rồi thức dậy đúng lúc Task 10 mở cửa.)

Dự án đã gặp khuôn hình này **năm lần trước vòng rà này**:

| # | Luật | Bảng giữ luật | Cửa không có bẫy |
|---|---|---|---|
| 1 | Bút toán ≥ 1 triệu cần 2 chữ ký | `fund_entries` | `DELETE FROM fund_entry_approvals` |
| 2 | Cạnh `worked_together` cần đủ mọi người xác nhận | `work_confirmations` | `INSERT`/`DELETE` trên `work_participants` |
| 3 | Ảnh ký ức chỉ `approved` khi tất cả đồng ý | `memory_photos` | đổi ý / gỡ hàng ở `memory_photo_people` |
| 4 | Hành động chờ cần đủ chữ ký | `pending_actions` | `DELETE FROM pending_action_signatures` |
| 5 | Chuyển tiếp phải do chính người đó | `signal_forwards.from_member_id NOT NULL` | điền **tên người khác** vào ô đó |

Ca số 5 là một biến thể đáng gọi tên riêng: **ràng buộc đúng về hình thức, rỗng về mục
đích.** `NOT NULL` bắt được ô **trống**; nó không bắt được ô **điền sai người**. Cùng họ
với nó là mọi cột `*_by`, `*_id`, mọi cờ `consent_*` — chúng ghi lại *một cái tên*, không
ghi lại *một hành động của người mang tên đó*.

Năm lần thì không còn là trùng hợp. Vòng rà này tìm thêm **bảy chỗ nữa** (mục 5).

---

## 2. Bốn câu hỏi phải đặt cho từng bất biến

Câu hỏi **không phải** "đã có trigger chưa". Bốn câu này mới là câu hỏi:

1. **Luật này đọc dữ liệu từ những bảng nào?** Liệt kê hết, kể cả bảng tra vai
   (`member_roles`), bảng cấu hình (`communities.config`), và chính bảng nó ngồi lên.
2. **Với mỗi bảng đó: có `INSERT`/`UPDATE`/`DELETE` nào lên nó mà trigger giữ luật không
   thấy không?** Chú ý cả `UPDATE` trên **chính bảng có trigger** khi trigger chỉ khai
   `BEFORE INSERT` — đó vẫn là cùng một lỗ hổng, chỉ ngắn hơn một bước.
3. **Luật kiểm ở thời điểm nào — lúc ghi hay lúc `COMMIT`?** Nếu chỉ kiểm lúc ghi thì thao
   tác **sau đó** có phá được không? (Ca "ảnh ký ức đổi ý sau khi duyệt".)
4. **Với ràng buộc dạng cột (`NOT NULL`, `CHECK`, khóa ngoại): nó bắt được ô trống — nó có
   bắt được ô điền giá trị của người khác không?** Nếu không, luật đang được giữ bởi thiện
   chí của người viết route.

Một luật chỉ được ghi **"đã phủ cả hai đầu"** khi mọi bảng ở câu 1 đều có câu trả lời
"không" ở câu 2 và câu 3, và mọi ràng buộc cột đều qua được câu 4.

---

## 3. Cách đọc bảng dưới đây

- **Bảng giữ luật** — đối tượng SQL có tên thật đang cưỡng chế. `REVOKE` cũng tính, nhưng
  nó chỉ chặn `app_role`, không chặn `psql` của người vận hành và **không chặn hàm
  `SECURITY DEFINER`** (Ruling T10-a). Ghi rõ khi lớp bảo vệ duy nhất là `REVOKE`.
- **Phá được bằng gì** — thao tác cụ thể trên bảng khác. "—" nghĩa là đã rà và không tìm
  được đường nào.
- **Hai đầu** — ✅ đủ, ⚠️ đủ *có điều kiện* (nêu điều kiện), ❌ hở.
- **Bằng chứng** — tên bài test đang canh. **"chưa có bài test"** là một giá trị hợp lệ và
  phải được ghi ra; ô trống thì không.

---

## 4. Bảng đối chiếu

> Cột **Hai đầu** ghi trạng thái **trước** migration `027`. Mười ba chỗ đánh ❌ ở đây đã
> được vá trong chính vòng rà này — mục 6 nói rõ chỗ nào và bằng đối tượng SQL nào; mục 7
> ghi những chỗ **cố ý chưa vá** kèm lý do. Giữ nguyên trạng thái cũ trong bảng thay vì
> sửa thành ✅ vì bảng này còn dùng để trả lời câu hỏi *"vì sao chỗ ấy hở"*, và câu trả lời
> đó là thứ giúp tìm ra chỗ tiếp theo.

### 4.1 Nhóm `001`–`008` — gốc, hồ sơ, riêng tư, nhật ký, xác thực

13 bảng: `communities`, `areas`, `members`, `member_contacts`, `privacy_settings`,
`contact_requests`, `profile_views`, `audit_log` (+ phân mảnh), `audit_chain_head`,
`refresh_tokens`, `otp_challenges`, `roles`, `member_roles`.
2 trigger: `trg_audit_chain`, `trg_audit_head`.

| Bất biến | Bảng giữ luật | Phá được bằng gì mà không chạm bảng giữ luật | Hai đầu | Bằng chứng |
|---|---|---|---|---|
| Số điện thoại / địa chỉ chỉ ra theo **mức chủ hồ sơ đặt** | `contact_read` (006 → 012a → 015), `REVOKE ALL ON member_contacts` (005) | **`UPDATE privacy_settings` của người khác** (mục 5.1); **`UPDATE contact_requests SET status='approved'` do chính người xin** (mục 5.2); **tự bật cả ba cờ `consent_*` của `introductions`** (mục 5.3) | ❌ | `t04`, `t05-contact-read-branches`, `t13-privacy-eight-fields`, `t13-contact-read-survives` canh **đầu đọc**; đầu **"ai được đặt mức / ai được đồng ý"** — **chưa có bài test** |
| `members` không chứa cột liên hệ nào | lược đồ 004 (cố ý không có cột) | thêm cột `phone` vào `members` ở migration sau | ✅ (một đầu duy nhất, và có bài quét) | `t03-no-phone-in-members` quét `information_schema.columns` |
| `app_role` không đọc/ghi thẳng `member_contacts` | `REVOKE ALL` (005), khẳng định lại ở `GRANTS` (024) | **một hàm `SECURITY DEFINER` mới quên kiểm cộng đồng** — `REVOKE` không đỡ được hàm chạy bằng quyền chủ bảng (Ruling T10-a, đã xảy ra thật) | ⚠️ đủ *với các hàm hôm nay*; mỗi hàm `SECURITY DEFINER` mới là một đầu mới không ai đếm | `t10-grants`, `t13-contact-read-survives` (đột biến: gỡ hai câu kiểm cộng đồng khỏi 015 ⇒ đỏ) |
| Mức riêng tư mặc định của người mới là mức **an toàn** | `fn_member_bootstrap` (012) với mảng dự phòng (Ruling C6) | `communities.config->'privacy_defaults'` khai một mảng mở toang — **`communities` có đủ bốn quyền** | ❌ (cấu hình cộng đồng không có ai canh) | `t16-join-flow` kiểm 8 hàng mặc định; đầu "config sai" — **chưa có bài test** |
| Nhật ký chỉ-thêm | `REVOKE UPDATE, DELETE ON audit_log` (007) + `fn_audit_new_partition` tự `REVOKE` cho từng phân mảnh | tạo phân mảnh bằng `CREATE TABLE … PARTITION OF` **bằng tay** ⇒ `ALTER DEFAULT PRIVILEGES` (002) cấp lại đủ bốn quyền | ✅ (chỉ khi mọi phân mảnh đi qua `fn_audit_new_partition`) | `t10-grants` có bài quét **phân mảnh** riêng |
| Chuỗi băm nhật ký không giả mạo được | `trg_audit_chain` (`BEFORE INSERT`, tính băm trong CSDL) | `audit_chain_head` có `SELECT, INSERT, UPDATE` cho `app_role` ⇒ sửa được **đầu chuỗi** | ⚠️ phá hoại được, **giả mạo vô hình thì không**: `verifyChain` duyệt lại toàn bộ `audit_log` theo `seq` chứ không tin bảng head | `t07-audit-chain` |
| `detail` của nhật ký không bao giờ chứa dữ liệu cá nhân | `assertSafeDetail` trong `core/audit.js` (**tầng ứng dụng**) | `INSERT INTO audit_log` bằng SQL trần — `app_role` có `INSERT` | ❌ ở tầng CSDL; được giữ bằng **Ruling C4** (luật quy trình: cấm `INSERT` trần ngoài hàm `SECURITY DEFINER`) | `t11-audit-detail` (bảng thử + đột biến từng luật) |
| Vai trò là dữ liệu **chỉ-đọc** với ứng dụng | `GRANT SELECT ON member_roles` (008, 024) | — hôm nay. **Ngày mai:** khi có hàm gán vai, **gỡ vai của một người đã ký** làm bút toán quỹ / hành động vận hành đã `COMMIT` mất hiệu lực chữ ký mà **không trigger nào chạy** (xem mục 5.7) | ⚠️ đủ *chỉ vì chưa ai gán vai được*; hết hiệu lực ngay khi có hàm gán vai | `t10-grants`; đường "gỡ vai" — **chưa có bài test** |
| Người xem không xoá được dấu vết mình đã xem | `REVOKE UPDATE, DELETE ON profile_views` (006) | — | ✅ | `t10-grants` |
| Đơn xin quyền đã nộp không biến mất | `REVOKE DELETE ON contact_requests` (006) | — (nhưng `UPDATE` mở toang, xem mục 5.2) | ✅ cho vế "không biến mất" | `t10-grants` |
| Mã OTP: mỗi vé một lần, 3 lần sai thì cháy | `otp_challenges.attempts`/`status`/`consumed_at` + **tầng service** | `app_role` có `UPDATE` trên `otp_challenges` ⇒ một route viết sau đặt lại `attempts = 0` là gỡ cả cơ chế | ❌ ở tầng CSDL (cố ý: đây là luồng, không phải bất biến dữ liệu) | `t17-otp` (12 bài, có đột biến) |
| Mỗi cộng đồng một email duy nhất | `idx_members_email` (unique, partial) | — | ✅ | **chưa có bài test** |
| **Mọi** bảng dữ liệu có `community_id NOT NULL REFERENCES communities(id)` | quy ước viết tay ở từng migration | thêm bảng mới quên cột — không có gì kêu lên (`024` tự kiểm **quyền**, không kiểm **cột**) | ❌ | **chưa có bài test** (đặc tả mục 4.5 hứa "T10 quét `information_schema`"; bài quét đó **không tồn tại**) |

**Ghi chú về nhóm này.** Ba trong bảy chỗ mới của mục 5 nằm ở đây, và cả ba đổ vào **cùng
một tài sản**: số điện thoại trong `member_contacts`. Đó không phải trùng hợp — đây là
luật duy nhất trong hệ thống mà **đường đọc được canh cực gắt còn đường ghi *điều kiện
đọc* thì không ai canh**. `contact_read` kiểm quyền rất cẩn thận, rồi đi hỏi
`privacy_settings` và `contact_requests` — hai bảng mà bất kỳ câu SQL nào của `app_role`
cũng viết được.

---

### 4.2 Nhóm `009`–`016` — gia nhập, việc, quan hệ, năng lực, tín hiệu, việc làm, giúp nhau

30 bảng + 1 view: `join_requests`, `guarantee_quota_overrides`, `join_request_secrets`,
`work_records`, `work_participants`, `work_confirmations`, `member_relations`,
`member_trust_stats` (023), `capabilities`, `capability_photos`, `capability_evidence`,
`signals`, `signal_recipients`, `signal_responses`, `signal_forwards`, `signal_options`,
`v_signal_recipients`, `job_needs`, `ready_profiles`, `introductions`, `connections`,
`connection_events`, `aid_requests`, `aid_offers`, `aid_slots`, `aid_slot_takers`,
`aid_events`.
Trigger: `trg_guarantee_quota`, `trg_member_status_gate`, `trg_referrer_frozen`,
`trg_member_bootstrap`, `trg_capability_evidence_valid`, `trg_signal_forward_recipient`,
`trg_aid_slot_capacity` (+ ba trigger `fn_self_only` của `026` áp lên bảng của nhóm này).

| Bất biến | Bảng giữ luật | Phá được bằng gì mà không chạm bảng giữ luật | Hai đầu | Bằng chứng |
|---|---|---|---|---|
| Hạn mức bảo lãnh 3 người / 12 tháng trượt | `trg_guarantee_quota` trên `join_requests` (`BEFORE INSERT OR UPDATE OF status`) | ① **`UPDATE join_requests SET reject_reason_code`** — đổi `referrer_misrepresented` sang `not_ready` trả lại một suất **đốt vĩnh viễn**; trigger chỉ khai `OF status` nên không chạy (mục 5.4, đã tái hiện) · ② **`UPDATE … SET created_at`** kéo lùi ngày, cửa sổ 12 tháng tự rỗng (đã tái hiện) · ③ **`INSERT INTO guarantee_quota_overrides`** — `app_role` có `INSERT`, và **không đối tượng SQL nào** buộc hàng nới hạn mức phải đến từ một `pending_action` đã thi hành (mục 5.7, đã tái hiện: Alice tự cấp 3 suất cho Alice, `granted_by = Alice`) | ❌ | `t08-guarantee-quota` canh **đường đếm**; ba đường trên — **chưa có bài test** trước vòng này |
| Không có bảo lãnh ẩn danh | `fn_guarantee_quota` ném `REFERRER_REQUIRED` | **`UPDATE join_requests SET referrer_id = NULL`** — không phải `UPDATE OF status` nên trigger không chạy; đơn `pending` sống tiếp mà không còn người bảo lãnh (đã tái hiện) | ❌ | `t08-guarantee-quota` (chỉ đường `INSERT`) |
| Đơn của cộng đồng B không tiêu suất của người thuộc cộng đồng A | khóa ngoại **ghép** `jr_referrer_same_community` (009) | — (khóa ngoại chặn từ lúc ghi, không phải lúc đếm) | ✅ | `t08-guarantee-quota` (Ruling T8-d, có đột biến) |
| `status='member'` chỉ sau khi đơn gia nhập được ban duyệt phê duyệt | `trg_member_status_gate` (constraint trigger hoãn tới `COMMIT`, trên `members`, thay bởi migration 036) | Luật đòi đúng `join_requests.member_id`, cùng cộng đồng, cùng `referrer_id` và `status='approved'`. `app_role` vẫn có quyền `UPDATE` trên `join_requests`, nên thẩm quyền phê duyệt thực tế còn dựa vào `requireRole('approver')` và `join_secret_consume` | ⚠️ CSDL giữ **thứ tự và tính liên kết**; tầng ứng dụng giữ **thẩm quyền người duyệt** | `t16-join-flow`, `t08-guarantee-quota` |
| `met_confirmed_by` / `approved_by` là người có thật, đúng vai | khóa ngoại đơn cột sang `members` | **câu hỏi 4**: khóa ngoại bắt được ô trống và ô trỏ bậy; nó **không** bắt được ô điền tên một thành viên khác. Không có `fn_self_only`, không có kiểm vai ở tầng CSDL | ❌ | **chưa có bài test** |
| Sợi bảo lãnh là sự thật lịch sử, không sửa lại được | `trg_referrer_frozen` (`BEFORE UPDATE OF referrer_id ON members`) | Điều kiện là `OLD.status = 'member'`. **`status` có ba giá trị.** Hai câu `UPDATE` trong một giao dịch — đặt `status='left'` rồi đổi `referrer_id` — đi qua trót lọt (đã tái hiện). Đúng lúc đặc tả mục 10 nói hồ sơ người rời phải thành **bia mộ** | ❌ | **chưa có bài test** (không tệp nào nhắc `referrer_frozen`) |
| `member_relations(kind='guarantee')` là **bản dẫn xuất** của `members.referrer_id` | `fn_member_bootstrap` (`AFTER INSERT ON members`) + `REVOKE INSERT/UPDATE/DELETE` | Chỉ có đường **sinh**, không có đường **đồng bộ lại**: đổi `referrer_id` (hợp lệ khi còn `guest`, hoặc qua đường `left` ở trên) làm hai nguồn lệch nhau vĩnh viễn — đã tái hiện: `members.referrer_id = Bob` trong khi cạnh vẫn ghi `Alice` | ❌ | **chưa có bài test** |
| `app_role` ghi được nhưng **không đọc lại được** dữ liệu đăng ký | `REVOKE ALL` + `GRANT INSERT ON join_request_secrets` (009a); đường đọc `join_secret_consume` | Migration 036 cho phép xử lý đơn `pending` hoặc `met_confirmed`, nhưng hàm vẫn bắt buộc **vai `approver` đúng cộng đồng** và có `actor`; bí mật bị xoá ngay khi duyệt | ⚠️ đủ nhờ **kiểm vai** và đường API duyệt | `t16-join-flow` |
| Cạnh `worked_together` chỉ do trigger sinh, và chỉ khi **đủ mọi người** xác nhận | `fn_work_edge` (`AFTER INSERT ON work_confirmations`, `SECURITY DEFINER`) + `REVOKE INSERT/UPDATE/DELETE ON member_relations` | `work_participants` — đã vá ở `025` bằng `fn_work_participants_frozen` (Ruling T12-b) | ✅ | `t12-work-edge`, `t12-trust` (đột biến xác nhận cả hai đường thêm/xoá người) |
| Xác nhận việc là **bút toán**: ghi rồi không sửa, không gỡ | `REVOKE UPDATE, DELETE ON work_confirmations` (011) + khóa ngoại `work_confirmations_wr_member_fkey` + `trg_wc_1_self_only` (025) | — với `app_role`. `psql` của người vận hành vẫn `UPDATE` được (không có trigger `BEFORE UPDATE` trên bảng này) | ⚠️ | `t12-work-edge`, `t13-signature-removal` |
| Bằng chứng năng lực phải là việc **chính chủ tham gia và đã tự ký** | `trg_capability_evidence_valid` (`BEFORE INSERT OR UPDATE ON capability_evidence`) | **`UPDATE capabilities SET member_id = <người khác>`** — trigger ngồi trên bảng bằng chứng, không ngồi trên bảng năng lực; đổi chủ năng lực là đổi luôn câu trả lời của luật (mục 5.5, đã tái hiện) | ❌ | **chưa có bài test** (không tệp test nào nhắc `capability_evidence`) |
| Chuyển tiếp tín hiệu là **nhận trách nhiệm**, do chính người đó, và chỉ người đã nhận | `signal_forwards.from_member_id NOT NULL` + `CHECK (from <> to)` + khóa ngoại ghép sang `signal_recipients` + `trg_sig_fwd_self_only` (026) + `REVOKE UPDATE, DELETE` | trigger chỉ khai `BEFORE INSERT`; `UPDATE`/`DELETE` đã bị `REVOKE` nên đường `app_role` kín, đường `psql` thì không | ⚠️ | `t13-no-anonymous` (đột biến: gỡ trigger ⇒ 4/12 đỏ) |
| Không ai trả lời tín hiệu thay ai | `trg_sig_resp_self_only` (026, `BEFORE INSERT`) + khóa ngoại ghép sang `signal_recipients` | **`UPDATE signal_responses SET responder_id = …`** — `app_role` có đủ bốn quyền và trigger không khai `UPDATE` (mục 5.6) | ❌ | `t13-no-anonymous` canh đường `INSERT` |
| Tự nhận suất giúp, không điền hộ | `trg_slot_self_only` (026, `BEFORE INSERT`) | **`UPDATE aid_slot_takers SET member_id = <người khác>`** — đã tái hiện: Carol sang tên suất của mình cho Bob (mục 5.6) | ❌ | `t13-no-anonymous` canh đường `INSERT` |
| Một suất `needed` chỗ thì không quá `needed` người | `fn_aid_slot_capacity` (`BEFORE INSERT ON aid_slot_takers`, khóa tư vấn theo suất) | ① **`UPDATE aid_slot_takers SET slot_id = <suất khác>`** — đã tái hiện: suất cần 1 người có 2 người · ② **`UPDATE aid_slots SET needed = <nhỏ hơn>`** — luật đọc `needed` ở bảng khác, không ai canh việc thu nhỏ nó | ❌ | `t13-no-anonymous` canh đường `INSERT` |
| Ba chữ ký mở kênh việc làm (giới thiệu → số điện thoại) | `CHECK intro_three_consents` (015) | **câu hỏi 4 ở dạng thuần khiết nhất**: `CHECK` bảo đảm *ba ô cùng bật*, không bảo đảm *ai bật ô nào*. Một người vừa là `introducer` vừa là `poster` tự bật cả ba rồi mở kênh và đọc được số của ứng viên (mục 5.3, đã tái hiện) | ❌ | `t13-three-consents` canh **vế `CHECK`** rất kỹ (kể cả rút lại chữ ký sau khi mở kênh); vế "ai bật cờ" — **chưa có bài test** |
| Lời giới thiệu không ghép người của hai cộng đồng | bốn khóa ngoại **ghép** trên `introductions` | — | ✅ | `t13-three-consents` |
| Nhiều nhất **một** phương án được chọn cho mỗi tín hiệu | `idx_sig_one_chosen` (unique một phần) | — (chỉ mục một phần được đánh giá lại ở mọi `UPDATE`) | ✅ | **chưa có bài test** |
| Bản vá rò chéo cộng đồng của `012a` sống sót qua `CREATE OR REPLACE` ở `015` | chính hai câu kiểm trong thân `contact_read` của `015` | — bản vá bị **ghi đè trong im lặng** nếu ai đó `CREATE OR REPLACE` lại lần nữa mà quên | ⚠️ được canh bằng **bài test**, không bằng đối tượng SQL | `t13-contact-read-survives` (đột biến: xoá hai câu ⇒ 2/4 đỏ) |
| Sổ sự kiện (`aid_events`, `connection_events`) chỉ thêm | `GRANT SELECT, INSERT` (016, 015, 024) | — | ✅ | `t10-grants` |
| `v_signal_recipients` là VIEW chỉ đọc | `GRANT SELECT` (014, 024) | `ALTER DEFAULT PRIVILEGES` cấp cả bốn quyền cho VIEW y như cho bảng — view mới quên khai là một cửa chưa ai đếm | ✅ (024 tự kiểm phủ cả `relkind='v'`) | `t10-grants` |

**Ghi chú về nhóm này.** Đây là nhóm có nhiều lỗ nhất, và chúng có một điểm chung đáng ghi
lại: **năm trong sáu chỗ hở là trigger chỉ khai `BEFORE INSERT`.** Người viết nghĩ về hành
động ("nhận suất", "trả lời", "chuyển tiếp") và gắn bẫy vào lúc hành động xảy ra — nhưng
`UPDATE` biến một hàng cũ thành một hành động mới mà không đi qua `INSERT` lần nào.
Nguyên tắc rút ra: **trigger canh danh tính hoặc canh hạn mức phải khai
`BEFORE INSERT OR UPDATE`, trừ khi cột liên quan đã bị `REVOKE UPDATE`.**

---

### 4.3 Nhóm `017`–`026` — hoạt động, bảo chứng, ký ức, quỹ, vay, vận hành

28 bảng: `activities`, `activity_participants`, `activity_needs`, `activity_summaries`,
`activity_photos`, `verifications`, `endorsements`, `endorsement_signatures`, `complaints`,
`complaint_events`, `memories`, `memory_versions`, `memory_photos`, `memory_photo_people`,
`memory_consents`, `fund_entries`, `fund_entry_approvals`, `transparency_reports`,
`report_versions`, `subject_keys`, `loans`, `loan_guarantors`, `loan_repayments`,
`permissions`, `role_permissions`, `pending_actions`, `pending_action_signatures`,
`backups`, `restore_tests`, `moderation_queue`, `member_trust_stats`.

| Bất biến | Bảng giữ luật | Phá được bằng gì mà không chạm bảng giữ luật | Hai đầu | Bằng chứng |
|---|---|---|---|---|
| Không mở hoạt động dùng quỹ mới khi còn món cũ đã xong chưa tổng kết | `trg_activity_summary_required` (`BEFORE INSERT OR UPDATE ON activities`) | ① `activity_summaries`: `DELETE` đã bị `REVOKE`; dời `activity_id` sang hoạt động khác **bảo toàn** tổng số món thiếu tổng kết nên vô hại · ② **`UPDATE activities SET ends_at = <tương lai>`** trên chính món đang kẹt: trigger có chạy nhưng thoát sớm ở `TG_OP='UPDATE' AND OLD.uses_fund` ⇒ cổng mở, không ai tổng kết gì (mục 5.6, đã tái hiện) | ❌ | `t13-fund` canh vế "còn món chưa tổng kết ⇒ chặn"; đường gỡ kẹt — **chưa có bài test** |
| Bảo chứng cần **đúng 2** người khác nhau, và người ký không phải người được bảo chứng | `trg_endorsement_two_signatures` (trên `endorsements`) **+** `trg_endorsement_sig_guard` (trên `endorsement_signatures`) + `trg_endorsement_signer_valid` + `REVOKE UPDATE, DELETE` | Đã thử **đổi `endorsements.member_id` thành một trong hai người ký** — **bị chặn**: trigger hoãn trên `endorsements` chạy cả ở `UPDATE` và đếm lại theo `NEW.member_id` | ✅ | `t13-signature-removal` (khẳng định đúng tên ràng buộc, SQLSTATE 23503), `t13-guards-ab` |
| Ảnh ký ức chỉ `approved` khi **tất cả** người trong ảnh đồng ý | `trg_memory_photo_consent` (trên `memory_photos`) **+** `trg_memory_photo_ppl_guard` (hoãn, trên `memory_photo_people`) | **`UPDATE memory_photo_people SET photo_id = <ảnh khác>`** — hàm canh chỉ đọc `OLD` ở nhánh `DELETE`; ở nhánh `UPDATE` nó chỉ nhìn `NEW.photo_id`, nên **dời** một tiếng "không" ra khỏi ảnh đã duyệt đi lọt (mục 5.5, đã tái hiện). `DELETE` bị `REVOKE` đúng để chặn việc "xoá tiếng không" — nhưng **dời** cũng là xoá, chỉ khác động từ | ❌ | `t13-guards-ab` (đột biến: gỡ trigger ⇒ 3/14 đỏ) canh đường **đổi ý** và **thêm người**; đường **dời hàng** — **chưa có bài test** |
| Bút toán ≥ ngưỡng cần ≥ 2 chữ ký approver hợp lệ, khác người tạo, đúng cộng đồng | `trg_fund_two_approvers` (trên `fund_entries`) **+** `trg_fund_sig_guard` (trên `fund_entry_approvals`), cả hai gọi **một** hàm đếm `fn_fund_valid_signatures` | ① **`UPDATE communities SET config->fund_two_approver_threshold`** — ngưỡng đọc từ `communities`, mà `communities` có **đủ bốn quyền** và không trigger nào canh. Đã tái hiện: nâng ngưỡng bằng một câu `UPDATE` rồi ghi bút toán **chi 50 triệu không một chữ ký nào** (mục 5.7) · ② `member_roles` — xem mục 5.7 | ❌ | `t13-fund` (có đột biến gỡ trigger); đường `config` và đường `member_roles` — **chưa có bài test** |
| Bút toán đã `locked` là bất động | `trg_fund_entry_locked` (`BEFORE UPDATE OR DELETE`) + `REVOKE DELETE` | — | ✅ | `t13-fund` |
| Chữ ký quỹ không gỡ được | `REVOKE UPDATE, DELETE ON fund_entry_approvals` + `trg_fund_sig_guard` (hoãn, chặn cả đường owner) | — | ✅ | `t13-signature-removal` |
| Hành động vận hành cần **hai người ký**, người ký không phải đối tượng, đúng vai | `trg_pending_two_signatures` (trên `pending_actions`) **+** `trg_pending_sig_guard` (trên `pending_action_signatures`) **+** `fn_pending_signature_valid` | ① **`UPDATE pending_actions SET payload, payload_hash`** sau khi đã đủ chữ ký rồi mới `status='executed'`: hai trigger chỉ **ĐẾM** chữ ký, chưa bao giờ so `payload_hash_at_sign` với `payload_hash` — cột đó tồn tại từ đặc tả mục 7.1 và **không ai đọc nó** (mục 5.5, đã tái hiện) · ② **`UPDATE pending_actions SET target_id = <chính người vừa ký>`**: `fn_pending_signature_valid` kiểm "người ký không phải đối tượng" ở **bảng chữ ký**, nên đổi đối tượng ở **bảng hành động** không ai kiểm lại (đã tái hiện) | ❌ | `t13-guards-ab` canh vế **gỡ chữ ký** (đột biến ⇒ 1/14 đỏ); hai đường trên — **chưa có bài test** |
| Người vay không tự bảo lãnh cho khoản vay của mình | `trg_loan_guarantor_valid` (`BEFORE INSERT OR UPDATE ON loan_guarantors`) | **`UPDATE loans SET borrower_id = <chính người bảo lãnh>`** — trigger ngồi trên bảng người bảo lãnh, không ngồi trên bảng khoản vay (mục 5.5, đã tái hiện) | ❌ | **chưa có bài test** (không tệp nào nhắc `loan_guarantors`) |
| Khóa chủ thể đã hủy thì không hồi sinh; "hủy" nghĩa là bản khóa **thật sự không còn** | `trg_subject_key_destroy` (`BEFORE UPDATE OR DELETE`) + `CHECK subject_key_destroy_means_gone` + `REVOKE DELETE` | — (cả hai vế nằm trên cùng một hàng, `CHECK` được đánh giá lại ở mọi `UPDATE`) | ✅ | **chưa có bài test** |
| Sổ nợ và sổ sự kiện chỉ thêm (`loan_repayments`, `complaint_events`, `backups`, `restore_tests`, `memory_versions`, `report_versions`) | `GRANT SELECT, INSERT` (024) | — với `app_role`; `psql` vẫn sửa được (không trigger) | ⚠️ | `t10-grants` |
| `member_trust_stats` là **cache dẫn xuất**, ứng dụng không ghi được | `REVOKE INSERT, UPDATE, DELETE` (023) + `fn_trust_recount` (`SECURITY DEFINER`, tự kiểm cộng đồng) | Luật "manual phải qua approver" nằm gọn trong `fn_trust_recount`; nó đọc `work_records.reviewed_at`, mà cột đó được canh bởi `fn_work_review_gate` (025). Hai đầu khớp nhau | ✅ | `t12-trust` (đột biến trên cả bốn chỉ số) |
| Bản ghi `manual` chỉ được tính khi có approver **thật** duyệt | `fn_work_review_gate` (025) + `fn_trust_recount` (023) | `member_roles` — xem mục 5.7. Ngoài ra ✅: `fn_work_record_frozen` đóng băng cả `created_by`, nên cửa mục 4.4 không mở lại được | ⚠️ (chỉ hở ở `member_roles`) | `t12-manual-quota` (đột biến: comment trigger ⇒ 4/14 đỏ) |
| `permissions` / `role_permissions` là hằng số nền tảng | `GRANT SELECT` (022, 024) | — | ✅ | `t10-grants` |
| Bảng mới thêm về sau không âm thầm mang đủ bốn quyền | câu **tự kiểm** cuối `024`: liệt kê mọi bảng/view `public` và ném lỗi nếu thiếu trong `GRANTS` | — (đây là một trong hai chỗ hiếm hoi trong dự án mà lưới nằm ở **nguồn** chứ không ở bản sao) | ✅ | `t10-grants`, và chính migration `024` |
| Mọi mã `RAISE EXCEPTION` của CSDL đều dịch được ra câu tiếng Việt | `t23-error-map` đọc thẳng `src/db/migrations/` | — | ✅ | `t23-error-map` (Ruling T13-c) |

**Ghi chú về nhóm này.** Xuất hiện một họ lỗi thứ hai, khác với họ "`BEFORE INSERT`" của
nhóm trước:

> **Trigger ngồi trên bảng CON và đọc một cột định danh ở bảng CHA. Đổi cột đó ở bảng cha
> thì không ai canh.**

`capabilities.member_id` (bằng chứng năng lực), `loans.borrower_id` (người bảo lãnh khoản
vay), `pending_actions.target_id` (người ký không được là đối tượng) đều dính. `endorsements.member_id`
**không** dính — và lý do đáng học: bảng đó có **trigger hoãn trên chính bảng cha**, nên
mọi `UPDATE` lên nó đều đếm lại. Đó chính là hình dạng đúng, và nó đã có sẵn ở ba chỗ
(`fund_entries`, `endorsements`, `pending_actions`) — chỉ là hai chỗ còn lại đếm **thiếu
một điều kiện**.

---

## 5. Chỗ thứ sáu trở đi — những gì vòng rà này tìm ra

Tất cả những chỗ dưới đây đã được **tái hiện bằng chạy thật** trên chính CSDL của dự án
(migration đầy đủ từ schema trắng, kết nối `app_role` thật, giao dịch có đóng dấu người
thực hiện). Không có mục nào là suy đoán từ việc đọc mã.

Chúng rơi vào **bốn họ**. Đọc theo họ chứ đừng đọc theo danh sách — họ mới là thứ giúp
tìm ra chỗ thứ hai mươi.

### 5.1 Họ A — luật đọc một bảng mà **không ai canh ai được ghi vào bảng đó**

Đây là họ nặng nhất, vì cả ba chỗ đổ vào **cùng một tài sản**: số điện thoại trong
`member_contacts` — thứ mà `REVOKE ALL`, `contact_read`, `contact_upsert`, `auth_lookup`,
`fn_privacy_state` và ba vòng soát xét đã dựng lên để bảo vệ.

`contact_read` không quyết định gì cả. Nó **đi hỏi**: hỏi `privacy_settings` mức riêng tư,
hỏi `contact_requests` đã có ai đồng ý chưa, hỏi `introductions` kênh đã mở chưa. Cả ba
bảng ấy `app_role` viết được bằng một câu `UPDATE`, và **không bảng nào có một trigger
nào**.

| # | Cửa | Tái hiện được |
|---|---|---|
| **6** | `UPDATE privacy_settings SET level='public' WHERE member_id = <người khác>` | Alice đặt mức của Bob thành `public`, rồi `contact_read(bob,'phone')` trả về `{"allowed":true,"value":"0912345678"}` |
| **7** | Người **xin** tự duyệt đơn xin quyền của chính mình: `INSERT contact_requests(status='pending')` rồi `UPDATE … SET status='approved'` | Carol tự duyệt, `contact_read` trả số thật của Bob |
| **8** | Một người vừa là `introducer` vừa là `poster` tự bật cả ba cờ `consent_*` rồi đặt `channel_opened_at` | Alice mở kênh một mình với Bob làm "ứng viên", `contact_read` trả số thật của Bob |

Chỗ **8** là ca **câu hỏi 4** ở dạng thuần khiết nhất. `CHECK intro_three_consents` đúng
tuyệt đối về hình thức: nó bảo đảm không tồn tại trạng thái "kênh mở mà thiếu chữ ký", và
`t13-three-consents` chứng minh điều đó rất kỹ, kể cả chiều ngược lại (rút chữ ký sau khi
mở kênh cũng hỏng). Nhưng `CHECK` chỉ biết **ba ô cùng bật**; nó không biết **ai bật ô
nào**. Ba cái tick do một người bấm vẫn là ba cái tick.

Đây cũng đúng khuôn "lỗ hổng ngủ" của Ruling T10-a: chưa endpoint nào chạm ba bảng này
(`GET /members/me/*` và contact-requests còn nằm ngoài phạm vi, màn "Quyền riêng tư" chưa
có route ghi). Ngày có endpoint là ngày lỗ hổng thức dậy, và người viết endpoint đó sẽ
không biết `contact_read` có liên quan gì.

### 5.2 Họ B — trigger chỉ khai `BEFORE INSERT`

`UPDATE` biến một hàng cũ thành một hành động mới mà không đi qua `INSERT` lần nào.

| # | Cửa | Tái hiện được |
|---|---|---|
| **9** | `UPDATE aid_slot_takers SET member_id = <người khác>` — lách `trg_slot_self_only` | Carol sang tên suất giúp của mình cho Bob, Bob không hề bấm gì |
| **10** | `UPDATE aid_slot_takers SET slot_id = <suất khác>` — lách `fn_aid_slot_capacity` | Suất khai `needed = 1` kết thúc với **2** người |
| **11** | `UPDATE signal_responses SET responder_id = <người khác>` — lách `trg_sig_resp_self_only` | Cùng khuôn; khóa ngoại ghép sang `signal_recipients` chỉ đòi người mới cũng là người nhận |

`signal_forwards` **không** dính vì `UPDATE`/`DELETE` đã bị `REVOKE` — tức chỗ này được
cứu bởi bảng quyền chứ không bởi trigger, và điều đó nên được nói ra thay vì để người sau
tưởng trigger đang làm việc.

### 5.3 Họ C — trigger ngồi trên bảng **con**, đọc cột định danh ở bảng **cha**

| # | Cửa | Tái hiện được |
|---|---|---|
| **12** | `UPDATE capabilities SET member_id = <người khác>` sau khi đã gắn `capability_evidence` | Năng lực chuyển sang tên Carol, bằng chứng là một việc Carol không tham gia và chưa từng ký |
| **13** | `UPDATE loans SET borrower_id = <chính người bảo lãnh>` | Người vay chính là người bảo lãnh duy nhất của khoản vay |
| **14** | `UPDATE pending_actions SET target_id = <chính người vừa ký>` rồi `status='executed'` | Hành động `member.terminate` thi hành nhắm vào B, mà B là một trong hai người ký — đúng điều mục 7.2 cấm |
| **15** | `UPDATE pending_actions SET payload, payload_hash` **sau** khi đã có đủ hai chữ ký, rồi mới `status='executed'` | Hai người ký nội dung X, hệ thống thi hành nội dung Y. `pending_action_signatures.payload_hash_at_sign` có mặt từ đặc tả mục 7.1 và **chưa có một câu SQL nào đọc nó** |
| **16** | `UPDATE memory_photo_people SET photo_id = <ảnh khác>` | Tiếng "không" của một người bị **dời** ra khỏi tấm ảnh đã duyệt. `fn_memory_photo_people_guard` đọc `OLD` ở nhánh `DELETE` nhưng ở nhánh `UPDATE` chỉ nhìn `NEW.photo_id` |

Chỗ **16** đáng dừng lại: nó nằm **bên trong chính bản vá** mà Ruling T13-b dựng ra để bịt
đúng họ lỗi này. `DELETE` bị `REVOKE` với lý do ghi rõ trong `019`: *"gỡ hàng của một người
là cách xoá tiếng 'không' của họ"*. Nhận định ấy đúng — nhưng **dời cũng là xoá**, chỉ khác
động từ, và cái động từ thứ hai không ai nghĩ tới. Đây là minh hoạ đắt giá cho một điều
sổ phán quyết đã ghi hai lần: **một bản vá có thể để hở đúng chỗ nó vừa vá.**

### 5.4 Họ D — luật đọc **trạng thái đổi được**, và không ai đóng băng trạng thái đó

Ràng buộc không sai; nó chỉ tính trên một con số mà người bị ràng buộc tự sửa được.

| # | Cửa | Tái hiện được |
|---|---|---|
| **17** | `UPDATE join_requests SET reject_reason_code='not_ready'` trên một đơn đã bị từ chối vì `referrer_misrepresented` | Suất "đốt vĩnh viễn" quay lại: 1 → 0. `trg_guarantee_quota` khai `UPDATE OF status` nên không chạy |
| **18** | `UPDATE join_requests SET created_at = now() - interval '18 months'` | Cửa sổ 12 tháng trượt tự rỗng |
| **19** | `UPDATE join_requests SET referrer_id = NULL` | Đơn `pending` sống tiếp mà không còn người bảo lãnh — `REFERRER_REQUIRED` chỉ chạy ở `INSERT`/`UPDATE OF status` |
| **20** | `INSERT INTO guarantee_quota_overrides` thẳng | Alice tự cấp 3 suất cho Alice, `granted_by = Alice`. Đặc tả mục 4.3 nói nới hạn mức phải qua **khung hai người ký**; không đối tượng SQL nào buộc điều đó |
| **21** | `UPDATE members SET status='left'` rồi `UPDATE members SET referrer_id = <người khác>` | `trg_referrer_frozen` chỉ chặn khi `OLD.status = 'member'`, mà `status` có **ba** giá trị. Sợi bảo lãnh — "sự thật lịch sử" — viết lại được trong hai câu. Kèm hệ quả: `member_relations` (bản dẫn xuất) **không** đi theo, hai nguồn lệch nhau vĩnh viễn |
| **22** | `UPDATE communities SET config->'fund_two_approver_threshold'` | Bút toán **chi 50 triệu, không một chữ ký nào**. `communities` có đủ bốn quyền và không trigger nào canh. Cùng cần lối canh này: `guarantee_quota_per_year`, `manual_pair_quota`, `privacy_defaults` |
| **23** | `UPDATE activities SET ends_at = now() + interval '1 year'` trên hoạt động đang kẹt | `SUMMARY_REQUIRED` mở ra, không ai tổng kết gì |
| **24** | Gỡ vai `approver` khỏi một người **đã ký** | Bút toán quỹ / hành động vận hành đã `COMMIT` mất hiệu lực chữ ký mà không trigger nào chạy — `fn_fund_valid_signatures` và `fn_pending_signature_valid` đều đếm theo **vai hôm nay**, không theo vai **lúc ký**. Hôm nay chưa khai thác được vì `member_roles` chỉ có `SELECT`; hết hiệu lực ngay khi có hàm gán vai (migration `008` đã hẹn trước là sẽ có) |

Chỗ **24** là loại nguy hiểm nhất trong bảng này vì nó **chưa** là lỗ hổng: nó là một quả
mìn đặt sẵn cho task viết luồng gán vai. Chữ ký là một sự việc đã xảy ra ở một thời điểm;
đếm nó bằng trạng thái hiện tại là trộn hai trục thời gian.

### 5.5 Chỗ nào được vá trong vòng này, chỗ nào không

Xem mục 6 (bản vá) và mục 7 (việc còn để lại, kèm lý do). Nguyên tắc chọn: vá những chỗ
**vá được ở tầng CSDL mà không phải sửa một tệp test có sẵn** — `api/tests/` đang có người
khác soát xét song song, và sửa bài test của người khác giữa chừng là cách chắc chắn nhất
để cả hai bên cùng mất việc.

---

## 6. Bản vá — migration `027_cross_table_guards.js`

Mười ba cửa được đóng. Bài test canh chúng: `api/tests/t24-rang-buoc-lien-bang.test.js`
(25 bài, chạy **bằng `app_role` với dấu người thực hiện** — đúng hình dạng một request
HTTP thật, không phải bằng kết nối owner).

| Cửa (mục 5) | Đối tượng SQL mới | Mã lỗi |
|---|---|---|
| 6 — mức riêng tư của người khác | `trg_privacy_self_only` (`BEFORE UPDATE OR DELETE ON privacy_settings`) | `SELF_ONLY` |
| 7 — người xin tự duyệt | `trg_contact_request_self_only` (`BEFORE INSERT OR UPDATE ON contact_requests`) | `SELF_ONLY` |
| 8 — một người bật cả ba ô đồng ý | `trg_intro_consent_self_only` (`BEFORE INSERT OR UPDATE ON introductions`) | `SELF_ONLY` |
| 9, 11 — `fn_self_only` chỉ ở `INSERT` | `fn_self_only` nay đọc được `OLD`; `trg_ast_1_self_only`, `trg_sig_resp_self_only`, `trg_sig_fwd_self_only` khai `INSERT OR UPDATE OR DELETE` | `SELF_ONLY` |
| 10 — sức chứa suất chỉ canh ở `INSERT` | `trg_ast_2_capacity` khai `INSERT OR UPDATE` | `AID_SLOT_FULL` |
| 12 — đổi chủ năng lực đã có bằng chứng | `trg_capability_owner_frozen` (`BEFORE UPDATE ON capabilities`) | `CAPABILITY_OWNER_FROZEN` |
| 13 — người vay thành người bảo lãnh của chính mình | `trg_loan_borrower_valid` (`BEFORE UPDATE ON loans`) | `LOAN_GUARANTOR_IS_BORROWER` (**dùng lại**) |
| 14 — đổi đối tượng hành động sau khi ký | `trg_pending_action_frozen` (`BEFORE UPDATE ON pending_actions`) | `PENDING_ACTION_FROZEN` |
| 15 — ký nội dung X, thi hành nội dung Y | `fn_pending_action_signatures` nay so `payload_hash_at_sign = payload_hash` | `TWO_SIGNATURES_REQUIRED` (**dùng lại**) |
| 16 — dời lời khai có mặt sang ảnh khác | `trg_memory_photo_ppl_frozen` (`BEFORE UPDATE ON memory_photo_people`) | `PHOTO_PEOPLE_FROZEN` |
| 17, 18, 19 — dữ kiện hạn mức bảo lãnh | `trg_join_request_frozen` (`BEFORE UPDATE ON join_requests`) | `JOIN_REQUEST_FROZEN` |
| 21 — viết lại sợi bảo lãnh qua trạng thái `left` | `fn_referrer_frozen`: điều kiện `OLD.status = 'member'` → `OLD.status <> 'guest'` | `REFERRER_FROZEN` (**dùng lại**) |

Bốn trong mười ba chỗ **dùng lại mã lỗi đã có** thay vì đẻ mã mới, vì chúng cưỡng chế đúng
cùng một luật — chỉ từ đầu bên kia. Bốn mã mới (`CAPABILITY_OWNER_FROZEN`,
`PENDING_ACTION_FROZEN`, `JOIN_REQUEST_FROZEN`, `PHOTO_PEOPLE_FROZEN`) đã khai ở
`api/src/core/errors.js` **và** `web/js/api.js` ngay khi trigger ra đời; `t23-error-map`
canh việc đó bằng cách đọc thẳng `RAISE EXCEPTION` trong thư mục migration.

### 6.1 `fn_acting_member()` — và vì sao nó KHÁC `fn_self_only()`

Ba trigger của họ A cần biết *ai đang thao tác*, nhưng không dùng được `fn_self_only` (vốn
ném `NO_ACTOR` khi giao dịch không đóng dấu), vì `fn_member_bootstrap` — hàm
`SECURITY DEFINER` của luồng duyệt gia nhập — ghi tám hàng `privacy_settings` cho **người
mới** trong giao dịch đóng dấu **người duyệt**. Ở đó luật "chính chủ" **sai về nghiệp vụ**
chứ không chỉ bất tiện.

`fn_acting_member(TG_RELID)` trả về:

- `uuid` người thực hiện, nếu giao dịch có đóng dấu ⇒ luật chính chủ **ép**;
- `NULL`, nếu không đóng dấu **nhưng** câu lệnh chạy bằng quyền **chủ bảng** — migration,
  `psql` của người vận hành, hoặc một hàm `SECURITY DEFINER` của chính hệ thống (trong hàm
  `SECURITY DEFINER`, `current_user` là chủ hàm) ⇒ đường của hệ thống, bỏ qua;
- ném `NO_ACTOR`, nếu không đóng dấu và **không** phải chủ bảng — tức `app_role` ghi ngoài
  `withActor()`, đúng loại lỗi `fn_self_only` vẫn bắt.

**Giới hạn, nói thẳng:** khác `fn_work_participants_frozen` hay `fn_fund_sig_guard` (chặn
cả đường owner/`psql`), ba trigger này **không** chặn đường owner. Đổi lại chúng chặn đúng
mặt tấn công thật — mọi request HTTP đi qua `withActor()` bằng vai `app_role`. README vận
hành phải ghi: sửa `privacy_settings` bằng `psql` là sửa quyền riêng tư của người khác mà
không có dấu vết.

### 6.2 Phép thử đột biến

Gỡ hẳn `027_cross_table_guards.js` khỏi thư mục migration rồi chạy lại `t24`:
**21/25 bài đỏ**, và **19 bài đỏ vì đúng một lý do**: *"promise resolved instead of
rejecting"* — tức câu ghi lẽ ra phải bị cấm đã **thành công**. Không bài nào đỏ vì lỗi cú
pháp hay hết giờ. **Mỗi trong mười ba cửa đều có ít nhất một bài đỏ trực tiếp.**

Hai bài còn lại đỏ **dây chuyền** (phép thử gỡ *toàn bộ* trigger cùng lúc nên trạng thái
dữ liệu của bài trước rò sang bài sau): *"CHỦ HỒ SƠ duyệt thì đơn có hiệu lực"* đỏ vì bài
trước đó đã xoá được hàng `privacy_settings` của Bob; *"chính chủ vẫn nhả suất của mình
được"* đỏ vì bài trước đã dời được hàng sang suất khác. Ghi ra để không ai tính nhầm chúng
là bằng chứng độc lập.

Khôi phục bản vá ⇒ **315/315 xanh**, chạy hai lần. `migrate:latest` → `down` ba bước →
`up` → `latest` phục hồi đủ mười trigger của `027`.

### 6.3 Một vòng sửa bị vứt, và lý do đáng ghi lại

Bản vá đầu cho cửa **16** mở rộng `fn_memory_photo_people_guard` để kiểm **cả**
`OLD.photo_id` lẫn `NEW.photo_id`. Nghe đúng, và nó **không hoạt động**: hàm đếm
`fn_photo_consent_missing` đếm số người **chưa đồng ý**, nên dời một hàng `consent='yes'`
ra khỏi ảnh đã duyệt vẫn cho ra con số 0.

Thiệt hại thật không phải *"ảnh thiếu đồng ý"* mà là *"một người biến mất khỏi danh sách
người có mặt"* — **một đại lượng khác hẳn**. Đây đúng bài học Ruling T13-c ở dạng khác:
một cái lưới dựng để chống loại lỗi X vẫn mù trước X nếu nó **đo sai đại lượng**. Bản vá
đúng không đếm gì cả — nó nói `(photo_id, member_id)` *là* danh tính của một lời khai có
mặt, và danh tính thì không sửa.

---

## 7. Cố ý CHƯA vá — và vì sao

Bảy chỗ dưới đây đã tái hiện được nhưng không nằm trong `027`. Mỗi chỗ kèm hình dạng bản vá
đề nghị, để người nhận việc không phải rà lại từ đầu.

| # | Chỗ hở | Vì sao chưa vá | Hình dạng bản vá đề nghị |
|---|---|---|---|
| **20** | Tự cấp `guarantee_quota_overrides` cho chính mình | Đặc tả mục 4.3 nói nới hạn mức phải qua **khung hai người ký** (mục 7), mà khung ấy chưa có endpoint — Task 14. Dựng ràng buộc trỏ tới một luồng chưa tồn tại là dựng cửa trước khi có người canh (cùng lập luận Ruling T8-f) | Thêm cột `pending_action_id NOT NULL` (khoá ngoại ghép sang `pending_actions`) + trigger đòi hành động ấy `status='executed'` và `action_key='guarantee.quota_override'` |
| **22** | `communities.config` là đòn bẩy không ai canh: `fund_two_approver_threshold`, `guarantee_quota_per_year`, `manual_pair_quota`, `privacy_defaults` | Nặng nhất trong nhóm này (**đã tái hiện: chi 50 triệu, không một chữ ký nào**) nhưng bản vá đúng là đưa `communities.config` vào khung hai người ký — cùng phụ thuộc Task 14. Bản vá tạm ở tầng CSDL sẽ phải gỡ ra ngay sau đó | `action_key` mới `community.config_change`; trong lúc chờ, tối thiểu một trigger `AFTER UPDATE ON communities` ghi `audit_log` khi khoá ngưỡng đổi |
| **23** | Đẩy `activities.ends_at` ra tương lai để gỡ kẹt `SUMMARY_REQUIRED` | Không phân biệt được **"hoãn thật"** với **"gỡ kẹt"** nếu chỉ nhìn dữ liệu; một hoạt động dời lịch là chuyện bình thường. Vá ẩu sẽ chặn nhầm đúng loại việc mà mục 4.5 dặn "chặn nhầm là chặn hỏng" | Chỉ cấm đẩy `ends_at` **ra sau** khi hoạt động đã `status='done'` và chưa có `activity_summaries` — hẹp đúng một hình dạng |
| **24** | Gỡ vai `approver` khỏi người **đã ký** làm chữ ký cũ mất hiệu lực | Chưa khai thác được (`member_roles` chỉ có `SELECT`), nhưng migration `008` đã hẹn sẽ có hàm gán vai. Đây là **quả mìn đặt sẵn cho task đó**, không phải lỗ hổng hôm nay | Ghi ảnh chụp vai vào **chính hàng chữ ký** (`fund_entry_approvals`, `pending_action_signatures`) và đếm theo đó. Chữ ký là sự việc ở một thời điểm; đếm nó bằng trạng thái hiện tại là trộn hai trục thời gian |
| — | `approved_by` là khóa ngoại nhưng CSDL chưa tự chứng minh người ghi có vai `approver` | Thẩm quyền đang nằm ở `requireRole('approver')`, `withActor()` và `join_secret_consume`; migration 036 bỏ hẳn sự phụ thuộc vào lời khai gặp mặt | Trigger trên `join_requests`: khi chuyển sang `approved`, đòi `approved_by = fn_acting_member(TG_RELID)` và actor có vai `approver` đúng cộng đồng |
| — | `member_relations(kind='guarantee')` không đi theo khi `members.referrer_id` đổi lúc còn `guest` | `t08-guarantee-quota` **khẳng định** khách đổi được người bảo lãnh (`resolves.toBeTruthy()`), nên đóng băng hẳn sẽ phá một bài test có sẵn — và `api/tests/` đang có người khác soát xét | Trigger `AFTER UPDATE OF referrer_id ON members` sinh lại cạnh; hoặc bỏ hẳn bản dẫn xuất và tính bằng view (cùng lập luận `v_signal_recipients` ở migration `014`) |
| — | Ba trigger họ A không chặn đường owner/`psql` | Xem mục 6.1 | Nếu về sau muốn chặn cả đường owner: đổi `fn_acting_member` thành ném `NO_ACTOR` vô điều kiện, và sửa phần **dựng dữ liệu** của bộ kiểm thử sang `withActor()`. Việc này phải làm **cùng** người đang soát xét `api/tests/` |

---

## 9. Ràng buộc vận hành của giai đoạn 1

Phần này bổ sung cách đọc cho các thành phần vận hành được thêm ở Task 17–20.
Mỗi dòng ghi rõ nơi cầm luật, migration hoặc file cấu hình liên quan, nguyên
tắc được bảo vệ và hư hỏng nếu bỏ nó.

| Ràng buộc | Cưỡng chế bằng gì | Migration/file | Nguyên tắc | Nếu gỡ |
|---|---|---|---|---|
| Seed không tạo bản ghi trùng khi chạy lại | UUIDv5 ổn định, `insertOnce`/upsert, transaction và actor | `api/src/db/seeds/`, Task 17 | Dữ liệu mẫu tái lập được, không che lỗi bằng dữ liệu ngẫu nhiên | Chạy seed lần hai phình dữ liệu và làm sai mọi số kiểm đếm |
| Job dùng đúng giờ UTC+7 | `TZ=Asia/Ho_Chi_Minh` ở API/backup và crontab bốn dòng | `api/Dockerfile`, `docker-compose.yml`, `backup/crontab` | Lịch nghiệp vụ có nghĩa theo giờ cộng đồng | Backup/job chạy lệch giờ, khó đối chiếu incident |
| Backup luôn có kết quả | `backup.sh` ghi `backups` trong nhánh thành công và thất bại | migration `032`, `backup/backup.sh` | Dashboard phải phân biệt “đã thử” với “đã thành công” | Lỗi `pg_dump` biến mất, vận hành tưởng hệ thống đã sao lưu |
| Bản sao audit không bị container backup xóa | MinIO object-lock và policy chỉ `PutObject`/đọc kho ảnh | `backup/storage-init.sh`, `backup/policy/backup.json` | Kẻ ghi backup không được tự xóa bằng chứng | Có thể xóa dấu vết sau khi ghi |
| Restore không tắt trigger | Script không nhận cờ tắt trigger và dùng `pg_restore` mặc định | `backup/restore.sh`, `backup/verify.sh` | Restore phải kiểm tra lại invariant/audit như dữ liệu sống | Bản restore xanh giả dù trigger đã bị vô hiệu |
| Restore không ghi đè DB đang chạy | `ACTION_ID` là UUID, tên DB là identifier hợp lệ, chặn tên DB live | `backup/restore.sh` | Khôi phục thử phải có database tạm và phê duyệt hai người | Một lệnh sai có thể phá database phục vụ |
| Tài liệu API cùng nguồn với validation | `/api/v1/docs` gọi builder từ schema Zod của module | `api/src/openapi/build.js`, `api/src/app.js` | Client đọc đúng contract mà middleware thực sự kiểm tra | Tài liệu nhận input mà API từ chối hoặc ngược lại |
| Cảnh báo khóa gốc và dữ liệu demo phải được nhìn thấy | README và tài liệu này ghi rõ, không ẩn trong comment code | `README.md`, `.env.example` | Người vận hành hiểu giới hạn an toàn trước khi deploy | Mất khóa hoặc hiểu nhầm seed demo thành số liệu thật |

## 8. Cách rà lại lần sau

Không có mẹo nào thay được việc đi hết bảng, nhưng có bốn câu hỏi rút gọn được công:

1. **Grep `RAISE EXCEPTION` trong `src/db/migrations/`.** Với mỗi hàm chứa nó, liệt kê mọi
   bảng mà thân hàm `SELECT`/`EXISTS` tới. Đó là danh sách cửa.
2. **Với mỗi cửa, hỏi ma trận quyền `024`:** `app_role` có `UPDATE`/`DELETE` trên bảng ấy
   không? Có mà không có trigger nào trên bảng ấy ⇒ nghi ngờ ngay.
3. **Với mỗi `CREATE TRIGGER`, đọc danh sách sự kiện.** Chỉ `BEFORE INSERT` mà bảng có
   `UPDATE` trong ma trận quyền ⇒ nghi ngờ ngay. Đây là họ B, và nó chiếm năm trong mười
   chín chỗ của vòng này.
4. **Với mỗi khóa ngoại trỏ tới bảng cha, hỏi:** trigger nào đọc một cột **khác khóa
   chính** của bảng cha (`member_id`, `borrower_id`, `target_id`, `created_by`)? Cột đó có
   đóng băng không? Đây là họ C.

Và một luật viết cho người sửa lần sau, rút từ chính vòng này (mục 6.3):

> **Trước khi tin một bản vá, hỏi nó ĐANG ĐO CÁI GÌ.** Một cái lưới đo sai đại lượng vẫn
> xanh, vẫn trông như đang canh, và sẽ dập tắt đúng câu hỏi cần được hỏi lại.
