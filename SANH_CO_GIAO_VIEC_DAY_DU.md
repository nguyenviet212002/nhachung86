# SẢNH CỜ NHACCON6789 — BẢN GIAO VIỆC ĐẦY ĐỦ

**Cho:** đội code đưa lên web
**Chủ:** Dương (Lê Mạnh Linh) — tên trên mọi mặt trận: **TingTingVác**
**Chốt:** 04/09/2026
**Nguồn:** đo từ máy ROSA đang chạy, không ước lượng

---

# PHẦN I · ĐỌC TRƯỚC KHI VIẾT DÒNG MÃ NÀO

## I.1 Bốn nguyên tắc không được đổi

**1. Kernel là nguồn sự thật duy nhất về luật.**
Trang web **không tự phán luật**. Mọi nước, mọi thế cờ đều hỏi Kernel.
Ngày 07/08/2026 đã gỡ một bản luật JavaScript song song vì nó gây lệch.
**Đừng dựng lại bản thứ hai.**

**2. Một tên duy nhất: `nhaccon6789`.**
Không `Máy`, không `engine`, không `Hội đồng`, không `Quân Sư`, không `AI`.
Kể cả trong lời chú thích mã. Người đọc mã thấy hai tên sẽ tưởng hai thứ.

**3. Ba động từ, ba việc.**

| | |
|---|---|
| `nhaccon6789 nói` | câu ngắn, kết luận |
| `nhaccon6789 phân tích` | chấm bằng số — có điểm, có độ sâu |
| `nhaccon6789 diễn giải` | giảng bằng lời, giải thích vì sao |

**4. Fail-closed.** Thiếu điều kiện thì **chặn**, không cho đi tiếp.
Thế cờ thiếu Tướng thì không cho vào trận. Công cụ không có trong sổ thì
chặn. Đóng mặc định, mở có ý thức.

## I.2 Hai màn hình, hai vai

```
MÀN CHỦ CÔNG   cần ĐĂNG NHẬP   thấy hết
MÀN KHÁCH      vào bằng đường mời   chỉ thấy bàn cờ
```

> ⚠️ **"Khách không xem được" phải dựa vào ĐĂNG NHẬP, không dựa vào
> việc dùng địa chỉ khác.** Ai biết địa chỉ là vào được.

---

# PHẦN II · HIỆN TRẠNG ĐO ĐƯỢC

## II.1 Ba dịch vụ

| Cổng | Tên | Vai trò |
|---|---|---|
| **8899** | Kernel | luật · sổ ván · hồ sơ · **version 32** |
| **8898** | Engine | Pikafish · Threads=8 · Hash=512MB |
| **8890** | UI | `python -m http.server` — **chỉ để thử, không dùng cho thật** |

## II.2 Bốn tệp trang

```
xq_sanh.html            11.263 byte   cửa vào, hai lối
xq_phong_dau_v4.html    ~74.000       Cờ Tướng
xq_co_the.html         101.535        Cờ Thế
xq_ban_doi.html         14.873        màn khách — CHƯA nghiệm thu
```

Bốn đời cũ **mồ côi**, không trang nào gọi tới, **đừng mang lên web**:
`xq_phong_dau_mau` (bản gốc, giữ để đối chiếu) · `that` · `v2` · `v3`

## II.3 Sổ ván

```
xq_core.db    games 1.215 · moves 33.258 · ho_so 0
```

> **`ho_so` = 0 sau 1.215 ván.** Tính năng dựng 12/08, chưa từng chạy —
> vì nó **chờ một cú bấm chưa ai bấm**. Bản web **phải tự ghi**, không hỏi.

---

# PHẦN III · HỢP ĐỒNG API

## III.1 Kernel 8899

```
POST /new    {red, black}                  -> {game_id}
POST /state  {game_id}                     -> {grid, turn, ply, result,
                                              in_check, hash, fen, no_legal,
                                              rep, no_cap, ly_do}
POST /move   {game_id, mv}                 -> {mv, checkmate, result, ly_do}
       HOẶC  {game_id, fy, fx, ty, tx}
POST /legal  {game_id, y, x}               -> danh sách ô đi được
POST /set    {game_id, grid, turn}         -> đặt thế cờ
POST /kiem   {grid}                        -> {loi: [...]}  soát thế hợp lệ
POST /fen · /history
POST /hoso/luu · /hoso/doc · /hoso/ds · /hoso/xoa
GET  /health -> {ok, kernel, version, port, games, luat}
```

> 🔴 **`/move` TUYỆT ĐỐI không nhận `from`/`to`.**
> Gửi sai gây `KeyError` → đứt kết nối. Đã trả giá ngày 05/08/2026.

**Toạ độ:** `grid[y][x]`, y 0..9 (0 là hàng Đen), x 0..8.
**UCI:** cột = `'a'+x`, hàng = `9-y`. Ví dụ `b2e2`.

## III.2 Bốn luật Kernel — **đã chứng minh bằng số**

```json
"luat": ["chiếu bí", "hoà lặp thế 3 lần",
         "60 nước không ăn quân", "trường chiếu"]
```

`GIOI_HAN_60 = 120` bán nước.

> **Trường chiếu:** thế lặp mà một bên chiếu suốt thì **bên đó THUA**.
> Nhiều engine cờ tướng làm sai chỗ này. Kernel làm đúng — **giữ nguyên**.

> ⚠️ Ngày 04/09/2026 đã thêm dấu tiếng Việt cho các chuỗi này.
> **Trang nào so chuỗi với `ly_do` phải dùng chữ CÓ DẤU.**
> Đã sửa 2 chỗ: `xq_co_the:1091` và `xq_phong_dau_v4:918`.

## III.3 Engine 8898

```
POST /bestmove {fen, movetime}  -> {bestmove, score_cp, mate, depth, pv}
GET  /health                    -> {ok, engine: "pikafish", port}
```

> 💡 **`score_cp` và `mate` LUÔN có trong câu trả lời.**
> Cờ Thế từng gọi 21 lần mà **không đọc điểm lần nào**. Đọc nó **không tốn
> thêm một lần gọi engine nào**.

---

# PHẦN IV · CỜ TƯỚNG

## IV.1 Màn Chủ Công — ba cột

```
┌──────────────────────────────────────────────────────────┐
│ 帥 TingTingVác · chủ phòng     [🔒 màn riêng] [G-4a91]  │
├────────────┬──────────────────────────┬──────────────────┤
│ RIÊNG TƯ   │      BÀN CỜ 8:9          │  ĐIỀU KHIỂN      │
│ 164px      │                          │  172px           │
│            │ ┌──────────────────────┐ │                  │
│ Thế cờ ①   │ │ 將 Anh Linh    08:42 │ │ Ván              │
│ Quân đã bắt│ ├──────────────────────┤ │ Đối thủ          │
│ Nhật ký    │ │      bàn cờ          │ │ Máy đi hộ ta ②   │
│ Mổ ván     │ ├──────────────────────┤ │ Màn của khách    │
│ Hồ sơ ĐT   │ │ 帥 TingTingVác 10:00 │ │                  │
└────────────┴─┴──────────────────────┴─┴──────────────────┘

① Thế cờ: CHỈ HIỆN SAU KHI VÁN KẾT THÚC — không hiện lúc đang đánh
② Nút trượt: thu một dòng, bấm mở, chọn xong TỰ THU
```

**Cột trái — khách không bao giờ thấy:**

| Khối | Nội dung | Khi nào |
|---|---|---|
| Thế cờ | thanh đo + "Đỏ hơn 1,2 quân" | **chỉ sau trận** |
| Quân đã bắt | quân hai bên đã ăn | trong ván |
| Nhật ký | nước đi, cuộn được | trong ván |
| Mổ ván | ACPL + nước hỏng nhất | sau trận, **TỰ CHẠY** |
| Hồ sơ đối thủ | số ván · thắng · ACPL trung bình | luôn |

## IV.2 Màn khách — hai cột

```
┌──────────────────────────────────────────────────────────┐
│ 將 Anh Linh · khách                          [G-4a91]   │
├────────────────────────────────┬─────────────────────────┤
│ ┌────────────────────────────┐ │ Ván                     │
│ │ 帥 TingTingVác       10:00 │ │ nước 25 · lượt bạn      │
│ ├────────────────────────────┤ │                         │
│ │  bàn cờ XOAY 180°          │ │ Nước đã đi              │
│ │  quân Đen ở gần khách      │ │                         │
│ ├────────────────────────────┤ │ [ Cầu hoà ]             │
│ │ 將 Anh Linh · lượt bạn     │ │ [ Xin thua ]            │
│ │                      09:42 │ │                         │
│ └────────────────────────────┘ │ ⎋ Rời phòng             │
└────────────────────────────────┴─────────────────────────┘
```

**Khách KHÔNG thấy:** thế cờ · mổ ván · hồ sơ · thiết lập · quân đã bắt.

**Nhãn dưới tên TingTingVác:**

```
Chủ Công tự đánh   →  KHÔNG có chữ nào (sạch hoàn toàn)
Bật máy đi hộ      →  "nhaccon6789 đang chơi"
```

> Nhãn này **chỉ hiện khi máy đi hộ đang bật**. Phần lớn thời gian màn
> khách sạch. Khi bật thì khách biết bên kia không phải người đang ngồi.

## IV.3 Luồng vào trận — bốn trạng thái

```
① CHỜ ĐỐI THỦ      chủ phòng đã vào · có đường mời để chép
                    ↓ người thứ hai vào phòng
② ĐỦ NGƯỜI          đồng hồ 30 GIÂY chạy · cả hai chưa bấm
                    ↓ một bên bấm
③ CHỜ BÊN KIA       bên đã bấm thấy rõ bên kia chưa bấm
                    ↓ người cuối bấm
④ ĐANG ĐẤU          đồng hồ ván 10:00 bắt đầu chạy
```

### Luật 30 giây

| Điều | Luật |
|---|---|
| Đếm từ lúc nào | **từ khi người thứ hai vào phòng** |
| Ai phải bấm | **cả hai**, kể cả chủ phòng |
| Khách không bấm | **bị đưa ra khỏi phòng** |
| Chủ phòng không bấm | **ở lại** — chủ phòng tuyệt đối |
| Người đã bấm | **Ở LẠI**, phòng quay về ① hoặc ② |
| Trận chính thức | khi **người cuối cùng** bấm |

> Người đã làm đúng phần mình thì không chịu hậu quả.

### Bên cầm quân

**Chủ phòng luôn cầm ĐỎ** (TingTingVác, đi trước). Khách luôn Đen.

## IV.4 Đồng hồ

```
Mỗi bên              10:00
Cách chạy            TRỪ NGƯỢC DẦN
Cộng giây mỗi nước   KHÔNG
Về 00:00             bên đó THUA
Bắt đầu chạy         khi người cuối bấm Bắt đầu
Tạm dừng             khi đối thủ mất kết nối
```

## IV.5 Ba tình huống giữa ván

### Mất kết nối

```
⚡ Anh Linh mất mạng
   Chờ nối lại trong  0:47
   hết giờ · ta thắng
   ĐỒNG HỒ VÁN TẠM DỪNG
```

**Chờ 1 phút.** Nối lại kịp thì chơi tiếp, đồng hồ chạy từ chỗ dừng.
Không kịp thì **bên còn lại thắng**.

### Cầu hoà

Bên kia hiện `[Đồng ý] [Từ chối]`. Từ chối thì ván chạy tiếp, đồng hồ
không dừng.

### Rời phòng

```
chưa vào trận  →  rời tự do, không hỏi
đang đấu       →  hỏi lại một lần, rời = THUA
```

```
⚠ Rời phòng?
  Ván đang chạy — rời bây giờ tính là THUA.
  [ Rời ]  [ Ở lại ]
```

> Bỏ bàn giữa ván mà không tính thua thì ai sắp thua cũng bỏ chạy.

## IV.6 Máy đi hộ — ba cấp, **CÙNG 8 GIÂY**

```
MultiPV = 3 · movetime = 8000ms
```

| Cấp | Chọn trong | Ngưỡng chênh |
|---|---|---|
| **Siêu thông minh** | nước hay nhất | 0 |
| **Thông minh** | nước 1 hoặc 2 | ≤ 40 điểm |
| **Xuất sắc** | nước 1, 2 hoặc 3 | ≤ 120 điểm |

**Cả ba đều thấy hết đòn chiến thuật** — không bao giờ mất quân vô cớ.

> ⚠️ **Đừng dùng lối "đi bừa N%"** như bản cũ. Nó tạo nước mà **không
> người chơi nào ở trình độ ấy đi**. MultiPV tạo nước *kém nhưng hợp lý*.

> ⚠️ **MultiPV ở thời gian ngắn gây hại.** Chia sức cho 3 nhánh làm giảm
> 3–5 tầng độ sâu. Ở 0,4 giây máy sẽ **mù đòn ăn quân một nhịp**.
> Đó là lý do phải giữ **8 giây cho mọi cấp**.

### Nhịp theo đối thủ

```
Engine LUÔN nghĩ đủ 8 giây.
Nhịp CHỈ hoãn lúc HIỆN nước ra:

  đo thời gian đối thủ nghĩ (trung bình trượt 2 nước)
  engine xong sớm hơn nhịp  →  ĐỢI cho hợp nhịp
  engine xong muộn hơn      →  hiện ngay
  sàn 0,3 giây · trần 15 giây
```

> 🔴 **TUYỆT ĐỐI KHÔNG cắt thời gian nghĩ theo nhịp.**
> Ngày 17/08/2026 đã làm vậy — người đi 0,3s thì máy cũng chỉ được 0,3s,
> đủ để đi nước ngớ ngẩn. Đã sửa 27/08.

## IV.7 Nút trượt

```
thu:   Máy đi hộ ta                    [bật] ⌄
       Siêu thông minh

mở:    ┌ Xuất sắc          ┐
       │ Thông minh        │  chọn xong TỰ THU
       │ Siêu thông minh ✓ ┘
       Máy đi hộ        [bật/tắt]
       🕐 8 giây · nhịp theo đối thủ
```

Tắt → dòng tóm tắt thành *"tắt · ta tự đi"*, chữ xám.

**Áp cùng lối cho khối "Đối thủ"** và bốn nút ván (`⋯` mở thêm).

## IV.8 Mổ ván ACPL — **PHẢI SỬA THANG**

Ván xong → **tự mổ, tự ghi hồ sơ, không chờ bấm**.

> 🔴 **Thang cũ `20/45/80/140` chưa có căn cứ và PHÁN NGƯỢC:**
>
> ```
> +1500 → +1000   mất 500   VẪN THẮNG 100%   thang cũ phán "Còn yếu"
>     0 →  -100   mất 100   MẤT CỜ           thang cũ phán "Khá"
> ```
>
> **Phải quy điểm sang tỉ lệ thắng rồi mới đo mất mát:**
> `mất mát = TỉLệThắng(điểm trước) − TỉLệThắng(điểm sau)`

Cờ tướng **chưa có thang chuẩn toàn cầu** như Lichess của cờ vua.
Phải tự dựng đường cong quy đổi từ chính sổ 1.215 ván.

**Muốn so được qua thời gian phải khoá và ghi:**

```
phiên bản Pikafish · tệp NNUE · Threads · Hash · depth/nodes
góc nhìn điểm (Đỏ/Đen) · cách quy chiếu bí sang điểm
cách chia khai/trung/tàn cuộc
```

---

# PHẦN V · CỜ THẾ

## V.1 Hai chiều

```
CHIỀU A   nhaccon6789 bày  →  ta giải          luyện tập
CHIỀU B   ta bày  →  nhaccon6789 giải          ← CHỖ ĐẮT NHẤT
```

**Chiều B** là thứ ngoài kia không có: nhặt thế cờ vỉa hè về, bày lên,
máy nói thẳng **thắng thật hay thế bịp**. Thế cờ vỉa hè phần nhiều là bịp.

## V.2 Mười khối — đo từ tệp thật

| Dòng | Khối | Khách thấy? |
|---|---|---|
| 395 | Trạng thái | ✓ |
| 401 | Bày quân | ✓ (chỉ chủ) |
| 417 | Chốt thế · vào trận | ✓ (chỉ chủ) |
| 466 | **⚖ nhaccon6789 phân tích** | 🔒 **KHÔNG** |
| 481 | Đối thủ | 🔒 KHÔNG |
| 494 | nhaccon6789 · trình độ | 🔒 KHÔNG |
| 568 | ⚔ Tìm cách phá | 🔒 KHÔNG |
| 592 | Đang đấu | ✓ |
| 605 | Đường giải ⏮◀▶⏭ | 🔒 KHÔNG |
| 616 | 🏛 nhaccon6789 diễn giải | 🔒 KHÔNG |

**Ba mươi sáu nút.** Cộng **Vùng nhaccon6789 · mã che** và **Màn hình gọn**.

**Cách che hiện tại:** `document.body.classList.add('kin')` →
CSS `body.kin .vk{display:none !important}`.
**Khối nào riêng tư phải có class `vk`.** Thêm khối mới mà quên class
này là khách nhìn thấy.

## V.3 Ô Phân tích — cách đọc điểm

```
mate ≠ 0            → CHẮC · chiếu bí sau N nước · ĐÃ CHỨNG MINH
|score_cp| > 1800   → THẮNG GẦN CHẮC · hơn X quân · chưa chứng minh
|score_cp| < 80     → KHÔNG CÓ ĐƯỜNG THẮNG · rất có thể là THẾ BỊP
|score_cp| < 300    → NHỈNH HƠN · chưa đủ để thắng
còn lại             → HƠN RÕ · chưa chứng minh
```

**Luôn nói rõ nguồn:**

```
✓ nhaccon6789 · CHỨNG MINH   · độ sâu 34
◐ nhaccon6789 · ƯỚC LƯỢNG    · độ sâu 31
```

Riêng thế bịp có lời nhắc:

```
⚑ Thế cờ vỉa hè phần nhiều là bịp — bày ra trông như thắng,
   thật ra bên kia hoà được.
```

## V.4 Luyện Thế — giữ, nhưng **đặt đúng vai**

```
CŨ:  "Đãi từ 200 ván"
MỚI: "Tỉ lệ thành công trước 200 lượt kháng cự — KHÔNG PHẢI
      đáp án lý thuyết. Đáp án đúng sai xem ô nhaccon6789 phân tích."
```

> 🔴 **Tàn cuộc không có 82%.** Nó **hoặc thắng, hoặc hoà, hoặc thua**.
> Phần trăm chỉ đo **engine chống kém đến đâu**, không đo sự thật thế cờ.
>
> Ví dụ chết người: một thế có **đúng một** nước thắng trong hai mươi
> nước. Mô phỏng ra 0,5% rồi phán *"đường yếu"* — trong khi đó là
> **đáp án duy nhất đúng**.

### Ba công cụ, ba câu hỏi

```
nhaccon6789 phân tích  →  THẮNG/HOÀ/THUA về lý thuyết? Đáp án TUYỆT ĐỐI
⚔ Tìm cách phá         →  mấy đường thắng, mỗi đường mấy nước?
Luyện Thế              →  đường nào DỄ ĐI cho người? KHÔNG phải đáp án
```

**Ba cấp Luyện Thế:**

| | |
|---|---|
| HẠ CẤP | ngắn nhất, dễ nhớ — chỉ ăn người chống hớ |
| TRUNG CẤP | cân giữa ngắn và chắc. Đáng học thuộc |
| CAO CẤP | chắc nhất — thắng cả khi đối phương chống hay nhất |

**Phải ghi kèm:** phiên bản Pikafish · NNUE · thời gian mỗi nước ·
độ sâu · số cách chống · seed. Không ghi thì lần sau không so được.

## V.5 Năm loại thế cờ — **KHÔNG phải đều là tàn cuộc**

| Loại | Cách giải đúng |
|---|---|
| ít quân, trong phạm vi bảng | tra bảng tàn cuộc — tuyệt đối |
| sát cuộc nhiều quân | **cây chứng minh riêng** cho thế ấy |
| nghệ thuật, có đường chủ định | engine + đối chiếu ý tác giả |
| nhiều nghiệm | phải nói rõ **CÓ NHIỀU** đáp án |
| thế lỗi, không nghiệm | phải **NHẬN RA và BÁO** |

## V.6 Bảng tàn cuộc — **CHƯA DỰNG, ĐỪNG DỰNG**

> 🔴 Bản thiết kế cũ từng ghi *"8,88 GB · 145 thế · 3 ngày 15 giờ"*.
> **Đó là số của tàn cuộc 5 quân CỜ VUA, không phải cờ tướng.**
> Gán nhầm này làm sai toàn bộ dự toán. Đã xoá.

Bên cờ tướng, dự án Felicity EGTB **đang phát triển**, hỗ trợ hẹp, và
**chính tác giả khuyến cáo chưa nên dựng nghiêm túc**.

**Quyết định:** **KHÔNG tự dựng** cho tới khi thống kê kho thế cho thấy
thật cần. Thế ngoài phạm vi thì dựng **cây chứng minh riêng** rồi cache.

Bảng tàn cuộc chỉ cho biết **thắng/hoà/thua và số nước** — **không giải
thích tại sao**. Phần ấy vẫn cần `nhaccon6789 diễn giải`.

---

# PHẦN VI · KERNEL CÒN THIẾU — **CHẶN VIỆC LÊN WEB**

## VI.1 Phòng

```
POST /phong/mo       {chu_phong}        -> {phong_id, duong_moi}
POST /phong/vao      {phong_id, ten}    -> {vai_tro, trang_thai}
POST /phong/sansang  {phong_id, nguoi}  -> ai đã bấm
POST /phong/roi      {phong_id, nguoi}
GET  /phong/trang_thai {phong_id}
```

## VI.2 Phiên — **KIỂM NGAY, TRƯỚC MỌI VIỆC KHÁC**

> 🔴 **Kernel hiện có giữ MỘT BÀN CỜ TOÀN CỤC không?**
> Nếu có thì **hai người chơi cùng lúc là hỏng ngay**, chưa cần nhiều người.
> Phải tách phiên theo `game_id` trước khi làm bất cứ gì khác.

## VI.3 Đồng bộ hai bên

`python -m http.server` **không làm được**. Phải có **WebSocket hoặc SSE**
để nước đi bên này hiện bên kia tức thì.

## VI.4 Nền tảng phải đổi

| Hiện tại | Vấn đề | Cần |
|---|---|---|
| `python -m http.server` | **tài liệu Python cảnh báo không dùng cho thật** | máy chủ thật |
| SQLite | kể cả WAL cũng **một người ghi một lúc** | xem lại khi nhiều người |
| Không có `user_id` | không phân biệt được ai | thêm |

## VI.5 Danh sách thiếu cho nhiều người

```
user_id · game_id · phiên độc lập
xác thực và phân quyền
engine pool + hàng đợi
huỷ tác vụ · hết giờ · giới hạn CPU
hàng đợi mổ ván nền
chống ghi trùng
sao lưu · nâng cấp lược đồ · nhật ký kiểm toán
cách tránh /set và /move của người này ĐÈ lên người khác
```

---

# PHẦN VII · THỨ TỰ DỰNG

| # | Việc | Chặn gì |
|---|---|---|
| **1** | **Kiểm Kernel có tách phiên chưa** | chặn mọi thứ |
| **2** | Khoá bộ luật — thứ tự ưu tiên khi nhiều luật cùng xảy ra | |
| **3** | Chữa hồ sơ 0 bản ghi · **mổ ván tự chạy** | tính năng riêng có đang chết |
| **4** | Bố cục hai màn | |
| **5** | Nút trượt · thu gọn cột phải | |
| **6** | Đồng hồ 10 phút trừ ngược | |
| **7** | `MultiPV=3` ba cấp | |
| **8** | **Sửa thang ACPL sang tỉ lệ thắng** | |
| **9** | Mổ ván cho Cờ Thế | |
| **10** | **Phòng · phiên · đồng bộ** | **chặn lên web** |
| **11** | **Đăng nhập màn Chủ Công** | **chặn lên web** |
| **12** | **Đổi nền tảng máy chủ** | **chặn lên web** |
| 13 | Kho thế có phân loại · lặp lại có nhịp | |
| 14 | ~~Tự dựng bảng tàn cuộc~~ | **chưa làm** |

**Việc 4–9 làm được ngay**, không cần host.
**Việc 10–12 phải có host.**

---

# PHẦN VIII · VÒNG HỌC KHÉP KÍN

Đây là **khác biệt thật** của hệ này — không phải ACPL, không phải kho thế:

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

Các nền cờ lớn phục vụ hàng triệu người nên khó biết **một người cụ thể**
hỏng chỗ nào. Hệ này chỉ vài người, nên **có thể biết**.

> **Nhưng hồ sơ đang 0 bản ghi** — đây là **tiềm năng, chưa phải năng lực
> đã chứng minh**. Đó là lý do việc 3 quan trọng đến vậy.

---

# PHẦN IX · MƯỜI BỐN CHỖ ĐÃ TRẢ GIÁ

| Chuyện | Rút ra |
|---|---|
| `/move` gửi `from/to` → đứt Kernel | **đọc mã, đừng đoán hợp đồng** |
| Vá mò 7 lượt tìm lỗi 404 | gốc chỉ là **một dòng trỏ tệp không tồn tại** |
| Gỡ Quân Sư → bàn cờ trắng **17 ngày** | **gỡ một khối phải dò HẾT chỗ gọi tới nó** |
| Lớp bọc an toàn đặt cuối `</body>` | **bọc phải đặt TRƯỚC chỗ cần bọc** |
| 14 phép kiểm đạt mà trang vẫn chết | **kiểm văn bản ≠ kiểm mã chạy** |
| Nhịp cắt luôn thời gian nghĩ | **hoãn lúc hiện, đừng cắt lúc nghĩ** |
| `canhLuat` khai `let` trong `ve()`, dùng ở `veTT()` | **kiểm phạm vi biến** |
| Đổi chuỗi Kernel, quên chỗ so sánh | **nguồn dùng chung càng phải soát rộng** |
| Hai bản luật cờ song song | **một nguồn sự thật duy nhất** |
| Thêm dịch vụ mà quên 3 danh sách | **danh sách viết cứng luôn lạc hậu — quét, đừng liệt kê** |
| Watchdog dựng sai thư mục → 19 tiến trình | **tự dựng lại + cấu hình sai = sinh sôi vô hạn** |
| Rút gọn lệnh, bỏ cửa an toàn → Kernel chết | **rút gọn cho tiện thì mất phần bảo vệ** |
| Đường dẫn có khoảng trắng không bọc nháy | `-ArgumentList ('"'+$path+'"')` |
| Gán số cờ vua sang cờ tướng | **đọc kỹ nguồn, đừng suy từ cái tương tự** |

---

# PHẦN X · CÒN CHƯA ĐỊNH

- Ván nhanh hơn (3, 5 phút) có làm không?
- Nhiều phòng cùng lúc hay chỉ một?
- Khách xem lại ván cũ được không?
- Bảng xếp hạng giữa bạn bè?
- Cờ Thế lên web chung hay riêng?
- `xq_ban_doi.html` **chưa nghiệm thu lần nào** — dùng lại hay dựng mới?

---

# PHẦN XI · CÁCH LÀM VIỆC — XIN GIỮ

Mọi bản vá trong dự án này đều theo **tám bước**:

```
1. ĐO thực tế, không đoán          (đọc mã, không nhớ)
2. Sửa ra TỆP TẠM
3. Kiểm cú pháp
4. ĐẾM số chỗ thay — nhìn số rồi mới quyết
5. Sao lưu bản thật
6. DỪNG dịch vụ trước khi thay tệp
7. Thay · dựng lại · nghiệm thu
8. Không lên được thì TỰ LUI VỀ
```

Bỏ bước nào cũng từng phải trả giá. Xem Phần IX.

**Mỗi bản vá phải có:**
- lệnh `--go` lui về
- mười phép kiểm trở lên
- **hỏng một phép là KHÔNG GHI**

---

*Bản này chốt toàn bộ Sảnh Cờ ngày 04/09/2026.
Mọi số đo từ máy ROSA đang chạy. Phần còn thiếu cũng đo bằng số.*
