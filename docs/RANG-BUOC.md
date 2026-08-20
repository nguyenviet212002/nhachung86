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
