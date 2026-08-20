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
