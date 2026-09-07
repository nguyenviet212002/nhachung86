# BẢN CHUẨN CỜ THẾ — SẢNH CỜ NHACCON6789

**Trạng thái:** `OBSERVED` — đã chạy thật, đo từ máy ngày 04/09/2026
**Tệp:** `Desktop\NHACCON6789\xq_co_the.html` · **101.535 byte** · 2.020 dòng
**Phạm vi:** chỉ Cờ Thế. Cờ Tướng có bản chuẩn riêng.

> **Cho người dựng:** mọi số trong tài liệu này **đo từ tệp thật**,
> không ước lượng. Phần "còn thiếu" cũng đo bằng số, không phải cảm nhận.

---

## 0 · ĐỊNH DANH — MỘT TÊN DUY NHẤT

Toàn hệ chỉ dùng **`nhaccon6789`**. Đã soát sạch ngày 04/09:

```
Máy · máy · MÁY · engine · Engine · Hội đồng · Quân Sư   →  0 lần
```

Cả trong **lời chú thích mã** cũng đổi. Lý do: người mở mã ra mà thấy
chỗ ghi `MÁY`, chỗ ghi `nhaccon6789` thì tưởng **hai thứ khác nhau**.

**Ba động từ, ba việc:**

| | |
|---|---|
| `nhaccon6789 nói` | câu ngắn, kết luận |
| `nhaccon6789 phân tích` | chấm thế bằng số — có điểm, có độ sâu |
| `nhaccon6789 diễn giải` | giảng bằng lời, giải thích vì sao |

---

## 1 · HAI CHIỀU CỦA CỜ THẾ

Đây là chỗ Cờ Thế **khác hẳn** Cờ Tướng:

```
CHIỀU A   nhaccon6789 bày  →  ta giải        luyện tập
CHIỀU B   ta bày           →  nhaccon6789 giải   ← chỗ đắt nhất
```

**Chiều B** là thứ ngoài kia không có: nhặt thế cờ vỉa hè về, bày lên,
máy nói thẳng **thắng thật hay thế bịp**.

Thế cờ vỉa hè phần nhiều là bịp — bày ra trông như thắng, thật ra bên
kia hoà được. Đây là chỗ hệ này đáng giá nhất.

---

## 2 · MƯỜI KHỐI — ĐO TỪ TỆP THẬT

| Dòng | Khối | Vai trò |
|---|---|---|
| 395 | Trạng thái | lượt ai · lỗi luật · kết cục |
| 401 | Bày quân | Bàn trống · Thế khai cuộc · Xoay bàn · Chép thế cờ |
| 417 | Chốt thế · vào trận | ta cầm bên nào · đi trước · BẮT ĐẦU · màn đối thủ |
| **466** | **⚖ nhaccon6789 phân tích** | **MỚI 04/09** — thắng thật hay thế bịp |
| 481 | Đối thủ | trình độ bên chống |
| 494 | nhaccon6789 · trình độ | 🔒 **chỉ ta thấy** — trình độ · nhịp xem · số lần thử |
| 568 | ⚔ Tìm cách phá | thử mọi nước, đối phương chống hết sức |
| 592 | Đang đấu | Tạm dừng · Mách một nước · Đấu lại · Dừng hẳn |
| 605 | Đường giải | ⏮ ◀ ▶ ⏭ đi lại từng nước |
| 616 | 🏛 nhaccon6789 diễn giải | giảng bằng tiếng Việt |

Cộng **Vùng nhaccon6789 · mã che** và **Màn hình gọn**.

**Ba mươi sáu nút.** Không cái nào mất sau bản vá 04/09.

### 2.1 Khối nào KHÁCH KHÔNG ĐƯỢC THẤY

Khi mở **màn hình cho đối thủ**, khách chỉ thấy **bàn cờ và đồng hồ**.
Mọi khối dưới đây nằm trong **vùng riêng của Chủ Công**:

```
🔒 ⚖ nhaccon6789 phân tích      thắng thật hay thế bịp
🔒 nhaccon6789 · trình độ        trình độ · nhịp xem · số lần thử
🔒 ⚔ Tìm cách phá                mấy đường thắng, mỗi đường mấy nước
🔒 Đường giải                    ⏮ ◀ ▶ ⏭ đi lại từng nước
🔒 🏛 nhaccon6789 diễn giải       giảng bằng lời
🔒 Luyện Thế · NƯỚC PHÁ          ba cấp Hạ · Trung · Cao
🔒 Mách một nước
```

Khách thấy: **bàn cờ · hai tên · đồng hồ · nhật ký nước đi**.

> Đã có sẵn hai lớp che: **Vùng nhaccon6789 · mã che** (khoá bằng mã)
> và **Màn hình gọn**. Người dựng phải giữ cả hai.

---

## 3 · Ô PHÂN TÍCH — THÊM 04/09/2026

### 3.1 Vì sao thêm

Đo được trước khi vá:

```
bestmove    21 lần    ← gọi engine 21 chỗ
score_cp     0 lần    ← NHƯNG KHÔNG ĐỌC ĐIỂM LẦN NÀO
```

Engine trả về **cả nước lẫn điểm**. Cờ Thế lấy nước, **vứt điểm đi**.

Có điểm ấy thì biết ngay thế cờ là **thắng thật** hay **thế bịp** —
mà **không tốn thêm một lần gọi engine nào**.

Sau khi vá: `score_cp` **4 lần** · `chamThe` **3 lần**.

### 3.2 Cách đọc điểm

```
mate ≠ 0            → CHẮC · chiếu bí sau N nước · ĐÃ CHỨNG MINH
|score_cp| > 1800   → THẮNG GẦN CHẮC · hơn X quân · chưa chứng minh
|score_cp| < 80     → KHÔNG CÓ ĐƯỜNG THẮNG · rất có thể là THẾ BỊP
|score_cp| < 300    → NHỈNH HƠN · chưa đủ để thắng
còn lại             → HƠN RÕ · chưa chứng minh
```

### 3.3 Luôn nói rõ NGUỒN

```
✓ nhaccon6789 · CHỨNG MINH    · độ sâu 34
◐ nhaccon6789 · ƯỚC LƯỢNG     · độ sâu 31
```

Đây là chỗ hệ cũ đang lẫn. **Chứng minh** khác **ước lượng** — người
học phải biết mình đang tin cái nào.

### 3.4 Riêng thế bịp có lời nhắc

```
KHÔNG CÓ ĐƯỜNG THẮNG
thế cân · rất có thể là THẾ BỊP
⚑ Thế cờ vỉa hè phần nhiều là bịp — bày ra trông như thắng,
   thật ra bên kia hoà được.
```

---

## 4 · LUYỆN THẾ — GIỮ, NHƯNG ĐẶT ĐÚNG VAI

### 4.1 Nó làm gì

`nhaccon6789` tự đấu với chính nó nhiều lần. Mỗi lần **đối phương chống
đỡ một kiểu khác**. Rồi đãi ra ba cấp:

| Cấp | Nghĩa |
|---|---|
| **HẠ CẤP** | ngắn nhất, dễ nhớ — chỉ ăn được người chống hớ |
| **TRUNG CẤP** | cân giữa ngắn và chắc. Đáng học thuộc |
| **CAO CẤP** | chắc nhất — thắng cả khi đối phương chống hay nhất |

### 4.2 Vì sao phải đổi cách trình bày

```
CŨ:  "Đãi từ 200 ván · bấm từng cấp để xem chuỗi liên hoàn"
MỚI: "Tỉ lệ thành công trước 200 lượt kháng cự — KHÔNG PHẢI
      đáp án lý thuyết. Đáp án đúng sai xem ô nhaccon6789 phân tích."
```

**Tàn cuộc không có 82%.** Nó **hoặc thắng, hoặc hoà, hoặc thua** —
dứt khoát. Con số phần trăm chỉ đo **engine chống kém đến đâu**,
không đo sự thật của thế cờ.

Ví dụ chết người: một thế có **đúng một** nước thắng trong hai mươi
nước. Mô phỏng ra 0,5% rồi phán *"đường yếu"* — trong khi đó là
**đáp án duy nhất đúng**.

### 4.3 Ba công cụ, ba câu hỏi khác nhau

```
┌────────────────────────────────────────────────────────────┐
│ nhaccon6789 phân tích                                      │
│   → Thế này THẮNG, HOÀ hay THUA về lý thuyết?              │
│     Đáp án TUYỆT ĐỐI. Không có phần trăm.                  │
├────────────────────────────────────────────────────────────┤
│ ⚔ Tìm cách phá                                             │
│   → Có mấy đường thắng? Mỗi đường mấy nước?                │
├────────────────────────────────────────────────────────────┤
│ Luyện Thế                                                  │
│   → Đường nào DỄ ĐI, khó chống, hợp với con người?         │
│     KHÔNG BAO GIỜ dùng làm đáp án.                         │
└────────────────────────────────────────────────────────────┘
```

### 4.4 Phải ghi kèm để lần sau so được

```
phiên bản Pikafish · tệp NNUE · thời gian mỗi nước
độ sâu · số cách chống · seed sinh biến
```

Không ghi thì lần chạy sau **không so được** với lần này.

---

## 5 · KIỂM LUẬT — LÀM ĐÚNG, GIỮ NGUYÊN

```
/kiem  3 lần   ·  /set  4 lần   ·  cổng 8899  4 lần
```

**Cờ Thế KHÔNG tự phán luật.** Mọi thế cờ hỏi Kernel qua `/kiem`.
Ngày 07/08/2026 đã gỡ bản luật JavaScript song song vì nó gây lệch.

Chốt thế mà thiếu quân thì chặn ngay:

```
Chưa bày xong:
· Thiếu Tướng bên Đỏ
· Thiếu Tướng bên Đen
```

**Đây là lối fail-closed, làm chuẩn.** Không cho vào trận với thế sai.

> ⚠️ **Lỗi cần sửa:** thông báo này **mất dấu tiếng Việt** —
> hiện ra là `Thieu Tuong ben Do`. Chỗ khác trong trang có dấu đầy đủ.
> Phải sửa thành **`Thiếu Tướng bên Đỏ`**.

---

## 6 · CÒN THIẾU — ĐO BẰNG SỐ

| Đo được | Nghĩa | Việc phải làm |
|---|---|---|
| `ACPL` **0 lần** | **không có mổ ván** dù Cờ Tướng có | dùng `score_cp` vừa mở đường |
| `/hoso/` **0 lần** | **không ghi ai giải được thế nào** | nối Kernel `/hoso/luu` |
| `localStorage` **2 lần** | còn lưu trình duyệt — **xoá là mất** | chuyển sang CSDL như Cờ Tướng |
| — | **không có kho thế** | bày xong chỉ chép ra, không gọi lại được |
| — | **không có lặp lại có nhịp** | thế đã giải đúng phải hiện lại sau vài ngày |

### 6.1 Mổ ván — rẻ nhất, làm trước

`score_cp` đã đọc được. Chấm từng nước người giải đi:

```
1. đúng   2. đúng   3. MẤT THẾ THẮNG
```

Với thế có **chứng minh**, chấm theo **giữ hay mất trạng thái
thắng–hoà–thua** — chính xác hơn ACPL nhiều.

### 6.2 Hồ sơ — chữa chỗ chết

Cờ Tướng cũng từng **0 bản ghi sau 1.215 ván** vì chờ một cú bấm
chưa ai bấm. Cờ Thế đừng lặp lại: **giải xong tự ghi**, không hỏi.

### 6.3 Kho thế — việc lớn nhất

Cờ thế cổ Việt Nam và Trung Hoa có kho tàng lớn. Cần **phân loại**:

```
ít quân, trong phạm vi bảng tàn cuộc  →  tra bảng, đáp án tuyệt đối
sát cuộc nhiều quân                    →  cây chứng minh riêng
nghệ thuật, có đường giải chủ định     →  engine + đối chiếu ý tác giả
nhiều nghiệm                           →  phải nói rõ CÓ NHIỀU đáp án
thế lỗi, không nghiệm                  →  phải NHẬN RA và báo
```

> V1 từng viết *"Cờ Thế về bản chất là tàn cuộc"* — **sai**.
> Chỉ loại đầu mới là tàn cuộc thuần.

---

## 7 · BẢNG TÀN CUỘC — CHƯA DỰNG

Có mã nguồn mở dựng bảng tàn cuộc cờ tướng (Felicity EGTB, MIT).
Nhưng **đang phát triển**, chỉ hỗ trợ vài nhóm hẹp, và **chính tác giả
khuyến cáo chưa nên dựng nghiêm túc**.

> ⚠️ Bản thiết kế V1 từng ghi *"8,88 GB · 145 thế · 3 ngày 15 giờ"*.
> **Đó là số của tàn cuộc 5 quân CỜ VUA, không phải cờ tướng.**
> Gán nhầm này làm sai toàn bộ dự toán. Đã xoá.

**Quyết định:** **KHÔNG tự dựng** cho tới khi thống kê kho thế cho thấy
thật cần. Thế nào không nằm trong phạm vi hỗ trợ thì dựng **cây chứng
minh riêng cho thế ấy** rồi cache lời giải — rẻ hơn nhiều.

Bảng tàn cuộc chỉ cho biết **thắng/hoà/thua và số nước**. Nó **không
giải thích tại sao** — phần ấy vẫn cần `nhaccon6789 diễn giải`.

---

## 8 · THỨ TỰ LÀM

| # | Việc | Công | Lợi |
|---|---|---|---|
| 1 | Sửa `Thieu Tuong ben Do` → có dấu | rất thấp | vừa |
| 2 | **Mổ ván ACPL** dùng `score_cp` | thấp | **cao** |
| 3 | **Hồ sơ tự ghi**, bỏ `localStorage` | thấp | **cao** |
| 4 | Ghi kèm cấu hình Luyện Thế | thấp | vừa |
| 5 | Kho thế có phân loại | cao | cao |
| 6 | Lặp lại có nhịp | vừa | cao |
| 7 | Nối thế luyện ↔ lỗi từ ván Cờ Tướng | vừa | **cao** |
| 8 | Cây chứng minh cho thế ngoài phạm vi | cao | vừa |
| 9 | ~~Tự dựng bảng tàn cuộc~~ | — | **chưa làm** |

**Ba việc đầu làm được ngay**, mỗi việc một buổi.

---

## 9 · VÒNG HỌC KHÉP KÍN

Đây là **khác biệt thật** của hệ này:

```
lỗi lặp lại trong ván Cờ Tướng thật
        ↓
sinh bài luyện đúng lỗi ấy  →  Cờ Thế
        ↓
kiểm lại sau vài ngày
        ↓
đo xem lỗi có GIẢM không
        ↓ (chưa giảm thì lặp lại)
```

Các nền cờ lớn phục vụ hàng triệu người nên khó biết **một người cụ
thể** hỏng chỗ nào. Hệ này chỉ vài người, nên **có thể biết**.

**Nhưng hồ sơ đang trống** — nên đây là **tiềm năng, chưa phải năng
lực đã chứng minh**. Đó là lý do việc 3 và 7 quan trọng đến vậy.

---

## 10 · NHỮNG CHỖ ĐÃ TRẢ GIÁ

| Chuyện | Rút ra |
|---|---|
| Gọi engine 21 lần mà bỏ `score_cp` | **có sẵn dữ liệu mà không dùng** |
| Hiện "thắng 82%" như chân lý | **thống kê không phải chứng minh** |
| Gán số cờ vua sang cờ tướng | **đọc kỹ nguồn, đừng suy từ cái tương tự** |
| Hai bản luật cờ song song (07/08) | **một nguồn sự thật duy nhất** |
| Đổi nhãn mà sót chỗ có dấu `…` `·` | **khớp chữ, đừng khớp dấu** |
| Tìm `QUÂN SƯ` hoa, tệp ghi `Quân Sư` | **tìm theo cái trong tệp, không theo cái mắt thấy** |
| Kiểm một chuỗi rồi kết luận cho cả tệp | **quét mọi cách viết** |
| Claude vẽ giao diện tưởng tượng rồi chê bản thật | **đọc mã trước, đừng đoán** |

---

## 11 · CÒN CHƯA ĐỊNH

- Cờ Thế có lên Internet như Cờ Tướng không?
- Kho thế lấy từ đâu — sách cổ, tự nhặt, hay cả hai?
- Có bảng xếp hạng ai giải nhanh hơn không?

---

## 12 · SAO LƯU ĐÃ CÓ

```
xq_co_the.html.bak_20260904_054701   trước khi thêm ô Phân tích
xq_co_the.html.bak_2026090x_xxxxxx   trước mỗi lần đổi nhãn
```

Lui về: `python co_the_cham_the.py --go`

---

*Bản chuẩn này chốt hiện trạng Cờ Thế ngày 04/09/2026.
Mọi số đo từ tệp thật. Phần còn thiếu cũng đo bằng số.*
