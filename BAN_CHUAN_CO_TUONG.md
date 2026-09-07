
**Trạng thái:** `CANDIDATE` — đã chốt thiết kế, chờ dựng
**Chốt ngày:** 03/09/2026 · sau các vòng bàn với Chủ Công
**Phạm vi:** chỉ Cờ Tướng. Cờ Thế soạn riêng.

---

## 0 · ĐỊNH DANH

| | |
|---|---|
| Chủ Công | **TingTingVác** — tên trên mọi mặt trận |
| Khách | tên tự đặt khi vào phòng |
| Máy đi hộ Chủ Công | nhãn hiện bên khách: **`nhaccon6789 đang chơi`** |
| Đối thủ | **chỉ người thật**. Không có chế độ đấu máy trong phòng đấu |

---

## 1 · HAI MÀN HÌNH

### 1.1 Màn của Chủ Công — ba cột

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

**Cột trái — khách không bao giờ thấy**

| Khối | Nội dung | Khi nào hiện |
|---|---|---|
| Thế cờ | thanh đo + "Đỏ hơn 1,2 quân" | **chỉ sau khi ván kết thúc** |
| Quân đã bắt | quân hai bên đã ăn | trong ván |
| Nhật ký | 4 nước gần nhất, cuộn được | trong ván |
| Mổ ván | ACPL + nước hỏng nhất | sau trận, **tự chạy** |
| Hồ sơ đối thủ | số ván · thắng · ACPL trung bình | luôn |

**Cột giữa** — thanh tên đối thủ trên, bàn cờ, thanh tên ta dưới.
Bên đang đi có viền sáng, đồng hồ đổi màu.

**Cột phải** — bốn khối, xem mục 3.

### 1.2 Màn của khách — hai cột

```
┌──────────────────────────────────────────────────────────┐
│ 將 Anh Linh · khách                          [G-4a91]   │
├────────────────────────────────┬─────────────────────────┤
│  ┌──────────────────────────┐  │  Ván                    │
│  │ 帥 TingTingVác     10:00 │  │  nước 25 · lượt bạn     │
│  ├──────────────────────────┤  │                         │
│  │                          │  │  Nước đã đi             │
│  │   bàn cờ XOAY 180°       │  │  (nhật ký)              │
│  │   quân Đen ở gần         │  │                         │
│  │                          │  │  [ Cầu hoà ]            │
│  ├──────────────────────────┤  │  [ Xin thua ]           │
│  │ 將 Anh Linh · lượt bạn   │  │                         │
│  │                    09:42 │  │  ⎋ Rời phòng            │
│  └──────────────────────────┘  │                         │
└────────────────────────────────┴─────────────────────────┘
```

**Khách KHÔNG thấy:** thế cờ · mổ ván · hồ sơ · mọi thiết lập · quân đã bắt.

**Bàn cờ xoay 180°** — quân Đen của khách ở gần họ.

**Nhãn dưới tên TingTingVác:**
- Chủ Công tự đánh → *không có chữ nào*
- Bật máy đi hộ → **`nhaccon6789 đang chơi`**

---

## 2 · LUỒNG VÀO TRẬN

### 2.1 Bốn trạng thái

```
① CHỜ ĐỐI THỦ          chủ phòng đã vào · có đường mời để chép
                        ↓ người thứ hai vào phòng
② ĐỦ NGƯỜI              đồng hồ 30 GIÂY chạy · cả hai chưa bấm
                        ↓ một bên bấm
③ CHỜ BÊN KIA           bên đã bấm thấy rõ bên kia chưa bấm
                        ↓ người cuối bấm
④ ĐANG ĐẤU              đồng hồ ván 10:00 bắt đầu chạy
```

### 2.2 Luật 30 giây

| Điều | Luật |
|---|---|
| Đếm từ lúc nào | **từ khi người thứ hai vào phòng** |
| Ai phải bấm | **cả hai**, kể cả chủ phòng |
| Khách không bấm | **bị đưa ra khỏi phòng** |
| Chủ phòng không bấm | **ở lại** — chủ phòng tuyệt đối |
| Người đã bấm | **ở lại**, phòng quay về trạng thái ① hoặc ② |
| Trận chính thức | khi **người cuối cùng** bấm xong |

> Người đã làm đúng phần mình thì không chịu hậu quả.

### 2.3 Bên cầm quân

**Chủ phòng luôn cầm ĐỎ** — TingTingVác đi trước, đúng lệ cờ tướng.
Khách luôn cầm Đen.

---

## 3 · CỘT PHẢI — BỐN KHỐI

### 3.1 Ván

Đổi theo trạng thái:

```
chưa vào ván:   [ Đỏ ] [ Đen ]        <- chủ phòng: khoá ở Đỏ
                [   BẮT ĐẦU   ]
                
đang đấu:       nước 25 · lượt Đỏ
                [Tạm dừng] [Xin thua] [⋯]
```

Nút `⋯` mở ra: **Cầu hoà · Xuất ván · Bắt đầu lại · Rời phòng**.

### 3.2 Đối thủ — **thu gọn một dòng**

```
Đối thủ
Anh Linh                    [đã vào bàn]
```

Không có lựa chọn Máy. **Chỉ người thật.**

### 3.3 Máy đi hộ ta — **nút trượt**

```
thu:   Máy đi hộ ta                          [bật] ⌄
       Siêu thông minh

mở:    Máy đi hộ ta                          [bật] ⌃
       ┌ Xuất sắc          ┐
       │ Thông minh        │  chọn xong TỰ THU
       │ Siêu thông minh ✓ ┘
       Máy đi hộ            [bật/tắt]
       🕐 8 giây · nhịp theo đối thủ
```

**Tắt** thì dòng tóm tắt đổi thành *"tắt · ta tự đi"*, chữ xám.

### 3.4 Màn của khách

```
⧉ màn của khách
/ban/G-4a91
```

Bấm để chép đường mời.

---

## 4 · BA CẤP MÁY — CÙNG 8 GIÂY

Engine tìm **ba nước hay nhất** ở độ sâu đầy đủ (`MultiPV=3`, `movetime=8000`).
Cấp độ khác nhau **ở chọn nước nào**, không ở thời gian.

| Cấp | Chọn trong | Ngưỡng chênh |
|---|---|---|
| **Siêu thông minh** | nước hay nhất | 0 |
| **Thông minh** | nước 1 hoặc 2 | ≤ 40 điểm |
| **Xuất sắc** | nước 1, 2 hoặc 3 | ≤ 120 điểm |

**Cả ba đều thấy hết đòn chiến thuật** — không bao giờ mất quân vô cớ.
Khác lối "đi bừa" cũ: nó tạo nước mà **không người chơi nào ở trình độ ấy đi**.

### Nhịp theo đối thủ

Engine **luôn nghĩ đủ 8 giây**. Nhịp **chỉ hoãn lúc hiện nước ra**:

```
đo thời gian đối thủ nghĩ (trung bình trượt 2 nước)
engine tính xong sớm hơn nhịp  ->  ĐỢI cho hợp nhịp
engine tính lâu hơn nhịp       ->  hiện ngay khi xong
sàn 0,3 giây · trần 15 giây
```

> Ngày 17/08/2026 từng cắt luôn thời gian nghĩ theo nhịp — sai.
> Người đi 0,3s thì máy cũng chỉ được 0,3s, đủ để đi nước ngớ ngẩn.
> Đã sửa 27/08: `msDoi()` trả về thời gian cấp độ nguyên vẹn.

---

## 5 · ĐỒNG HỒ

| | |
|---|---|
| Mỗi bên | **10:00** |
| Cách chạy | **trừ ngược dần** |
| Cộng giây mỗi nước | **KHÔNG** |
| Về `00:00` | **bên đó THUA**, bên còn thời gian thắng |
| Bắt đầu chạy | khi **người cuối bấm Bắt đầu** |
| Tạm dừng | khi đối thủ mất kết nối |

---

## 6 · BA TÌNH HUỐNG GIỮA VÁN

### 6.1 Mất kết nối

```
⚡ Anh Linh mất mạng
   Chờ nối lại trong
        0:47
   hết giờ · ta thắng
   đồng hồ ván tạm dừng
```

**Chờ 1 phút.** Nối lại kịp thì chơi tiếp, đồng hồ chạy lại từ chỗ dừng.
Không kịp thì **bên còn lại thắng**.

### 6.2 Cầu hoà

Bên bấm: nút **Cầu hoà** trong khối Ván (hoặc trong `⋯`).
Bên kia hiện:

```
✋ Anh Linh xin hoà
   Ván đang ở nước 25
   [ Đồng ý ]  [ Từ chối ]
```

Từ chối thì ván chạy tiếp, đồng hồ không dừng.

### 6.3 Rời phòng

**Chưa vào trận** — rời tự do, không hỏi.

**Đang đấu** — hỏi lại một lần:

```
⚠ Rời phòng?
  Ván đang chạy — rời bây giờ tính là THUA.
  [ Rời ]  [ Ở lại ]
```

> Bỏ bàn giữa ván mà không tính thua thì ai sắp thua cũng bỏ chạy.

---

## 7 · KERNEL — HỢP ĐỒNG ĐANG CÓ

Cổng **8899** · phiên bản **32** · bốn luật đã chứng minh.

```
POST /new    {red, black}                    -> game_id
POST /state  {game_id}                       -> grid turn ply result in_check
                                                hash fen no_legal rep no_cap ly_do
POST /move   {game_id, mv}  HOẶC  {game_id, fy,fx,ty,tx}
POST /legal  {game_id, y, x}
POST /fen · /history
POST /hoso/luu · /hoso/doc · /hoso/ds · /hoso/xoa
```

> 🔴 `/move` **tuyệt đối không nhận `from`/`to`** — gây `KeyError`, đứt kết nối.

**Bốn luật:** chiếu bí · hoà lặp thế 3 lần · hoà 60 nước không ăn quân
(`GIOI_HAN_60=120`) · **trường chiếu**.

Engine **8898** · `POST /bestmove {fen, movetime}` -> `{bestmove, score_cp, mate, depth, pv}`

---

## 8 · KERNEL CÒN THIẾU — PHẢI DỰNG

Đây là phần **chặn việc lên Internet**. Chưa có thì hai người không đấu được.

### 8.1 Phòng

```
POST /phong/mo      {chu_phong}         -> phong_id, duong_moi
POST /phong/vao     {phong_id, ten}     -> vai_tro, trang_thai
POST /phong/sansang {phong_id, nguoi}   -> ai đã bấm
POST /phong/roi     {phong_id, nguoi}
GET  /phong/trang_thai {phong_id}
```

### 8.2 Phiên — **điều phải kiểm ngay**

> Kernel hiện có giữ **một bàn cờ toàn cục** không?
> Nếu có thì **hai người chơi cùng lúc là hỏng ngay**, chưa cần nhiều người.
> Phải tách phiên theo `game_id` trước mọi việc khác.

### 8.3 Đồng bộ hai bên

`python -m http.server` **không làm được** việc này.
Phải có **WebSocket hoặc SSE** để nước đi bên này hiện bên kia tức thì.

### 8.4 Đăng nhập

Màn Chủ Công **phải có đăng nhập**. Không có thì *"khách không xem được"*
chỉ là ý định — ai biết địa chỉ là vào được.

Màn khách **không cần đăng nhập**, vào bằng đường mời, đường ấy hết hiệu lực khi ván xong.

### 8.5 Nền tảng phải đổi

| Hiện tại | Vấn đề | Cần |
|---|---|---|
| `python -m http.server` | tài liệu Python cảnh báo **không dùng cho thật** | máy chủ thật |
| SQLite | kể cả WAL cũng **một người ghi một lúc** | xem lại khi nhiều người |
| Không có `user_id` | không phân biệt được ai là ai | thêm |

---

## 9 · MỔ VÁN — TỰ CHẠY

Ván kết thúc → **tự mổ, tự ghi hồ sơ, không chờ ai bấm.**

> `ho_so` hiện **0 bản ghi sau 1.215 ván**. Tính năng dựng từ 12/08
> mà chưa từng chạy — vì nó chờ một cú bấm chưa ai bấm.

**Thang ACPL hiện tại `20/45/80/140` CHƯA có căn cứ.** Phải quy sang tỉ lệ thắng:

```
mất mát = TỉLệThắng(điểm trước) − TỉLệThắng(điểm sau)
```

Cùng mức mất điểm nhưng nghĩa khác hẳn:

```
+1500 -> +1000   mất 500   VẪN THẮNG 100%   thang cũ phán "Còn yếu"
    0 ->  -100   mất 100   MẤT CỜ           thang cũ phán "Khá"
```

Phải **khoá và ghi**: phiên bản Pikafish · tệp NNUE · Threads · Hash ·
depth/nodes · góc nhìn điểm · cách quy chiếu bí. Không khoá thì
số hôm nay không so được với số tháng sau.

---

## 10 · VÒNG HỌC KHÉP KÍN

Đây là **khác biệt thật** của hệ này — không phải ACPL, không phải kho thế cờ:

```
lỗi lặp lại trong ván thật
        ↓
sinh bài luyện đúng lỗi đó (sang Cờ Thế)
        ↓
kiểm lại sau một thời gian
        ↓
đo xem lỗi có GIẢM không
        ↓ (chưa giảm thì lặp lại)
```

Các nền cờ lớn phục vụ hàng triệu người nên khó biết **một người cụ thể**
hỏng chỗ nào. Hệ này chỉ vài người, nên **có thể biết**.

**Nhưng hồ sơ đang 0 bản ghi** — nên đây là tiềm năng, chưa phải năng lực.

---

## 11 · THỨ TỰ DỰNG

| # | Việc | Chặn gì |
|---|---|---|
| 1 | **Kiểm Kernel có tách phiên chưa** | chặn mọi thứ |
| 2 | Chữa hồ sơ 0 bản ghi · mổ ván tự chạy | tính năng riêng có đang chết |
| 3 | Bố cục hai màn (làm được ngay, chưa cần host) | |
| 4 | Nút trượt · thu gọn cột phải | |
| 5 | Đồng hồ 10 phút trừ ngược | |
| 6 | `MultiPV=3` cho ba cấp | |
| 7 | Sửa thang ACPL sang tỉ lệ thắng | |
| 8 | **Phòng · phiên · đồng bộ** | chặn việc lên Internet |
| 9 | **Đăng nhập màn Chủ Công** | chặn việc lên Internet |
| 10 | Đổi nền tảng máy chủ | chặn việc lên Internet |

**Việc 3–7 làm được ngay trên ROSA**, không cần host.
**Việc 8–10 phải có host mới làm được.**

---

## 12 · NHỮNG CHỖ ĐÃ TRẢ GIÁ — ĐỪNG LẶP

| Chuyện | Rút ra |
|---|---|
| `from/to` làm đứt Kernel | **đọc mã, đừng đoán hợp đồng** |
| Vá mò 7 lượt tìm lỗi 404 | gốc chỉ là **một dòng trỏ tệp không tồn tại** |
| Gỡ Quân Sư → bàn cờ trắng 17 ngày | **gỡ một khối phải dò hết chỗ gọi tới nó** |
| Lớp bọc an toàn đặt cuối `</body>` | **bọc phải đặt TRƯỚC chỗ cần bọc** |
| 14 phép kiểm đạt mà trang vẫn chết | **kiểm văn bản không thay được kiểm mã chạy** |
| Nhịp cắt luôn thời gian nghĩ | **hoãn lúc hiện, đừng cắt lúc nghĩ** |
| `canhLuat` khai `let` trong `ve()`, dùng ở `veTT()` | **kiểm phạm vi biến** |
| Thêm dịch vụ mà quên 3 danh sách | **danh sách viết cứng luôn lạc hậu — quét thay vì liệt kê** |
| Watchdog dựng lại sai thư mục → 19 tiến trình | **tự dựng lại + cấu hình sai = sinh sôi vô hạn** |

---

## 13 · CÒN CHƯA ĐỊNH

- Ván nhanh hơn (3 phút, 5 phút) có làm không?
- Nhiều phòng cùng lúc hay chỉ một?
- Khách có xem lại ván cũ được không?
- Có bảng xếp hạng giữa bạn bè không?
- Cờ Thế lên Internet chung hay riêng?

---

*Bản chuẩn này chốt thiết kế Cờ Tướng. Cờ Thế soạn riêng.
Mọi số liệu đo từ máy thật, không ước lượng.*
