# Tài khoản mẫu và vai trò kiểm thử

Sau khi `migrate` và `seed`, 52 tài khoản mẫu dùng chung `SEED_PASSWORD` của lần triển khai. Không ghi mật khẩu thật vào repository.

| Mã | Đăng nhập mẫu | Vai trò thật | Dùng để kiểm tra |
|---|---|---|---|
| M01 | `m01@nhachung.invalid` | `member`, `approver`, `tech` | toàn quyền vận hành mẫu, ký duyệt |
| M02 | `m02@nhachung.invalid` | `member`, `approver` | người duyệt thứ hai |
| M03 | `m03@nhachung.invalid` | `member`, `approver` | kiểm tra hai người ký |
| M04 | `m04@nhachung.invalid` | `member`, `tech` | nội dung/kỹ thuật |
| M05 | `m05@nhachung.invalid` | `member`, `content_ops` | đăng và điều phối nội dung |
| M06 trở đi | `m06@nhachung.invalid` … | `member` | hội viên thường, nhắn tin/upload |

Sau khi đăng nhập, giao diện hiển thị vai thật lấy từ `GET /api/v1/auth/me`. Ba nút Thành viên / Nhà tuyển dụng / Quản trị trên thanh đầu là các luồng UI demo cũ; chúng không cấp quyền backend. Tin nhắn nên kiểm tra bằng hai cửa sổ đăng nhập M01 và M06: chọn **Nhắn tin**, gửi ở cửa sổ thứ nhất, cửa sổ thứ hai nhận ngay qua SSE và phát tiếng “ting ting” sau khi người dùng đã tương tác với trang.

API kiểm thử trực tiếp:

```text
GET  /api/v1/notifications
GET  /api/v1/notifications/stream?access_token=<access-token>  # EventSource same-origin
GET  /api/v1/messages?with_member_id=<member-uuid>
POST /api/v1/messages {"recipient_id":"<member-uuid>","body":"..."}
POST /api/v1/notifications {"recipient_id":"<member-uuid>","kind":"activity","title":"...","body":"..."}
```
