# Tài khoản mẫu và vai trò kiểm thử

## Ba tài khoản E2E trên stack cục bộ hiện tại

Ba tài khoản dưới đây đã được tạo và chạy trọn luồng thật ngày 21-08-2026. Mật khẩu nằm trong `.env` cục bộ qua các biến `E2E_*_PASSWORD`; không chép mật khẩu vào Git.

| Tài khoản | Đăng nhập | Vai trò | Dùng để kiểm tra |
|---|---|---|---|
| Admin E2E | `admin.e2e@nhachung.local` hoặc `0908601000` | `member`, `content_ops`, `approver`, `tech` | duyệt đơn, đăng tin, gửi thông báo |
| Thành viên A | `0908601001` | `member` | đăng năng lực/việc, nhắn B, xử lý ứng viên |
| Thành viên B | `0908601002` | `member` | nhận thông báo, ứng tuyển, nhắn lại A |

Dữ liệu E2E được giữ lại để thử trực tiếp trên trình duyệt: một tin admin đang mở, một tin A đã có ứng viên B và đã đóng, một năng lực của A, hồ sơ sẵn sàng nhận việc của B, tin nhắn hai chiều và các thông báo liên quan.

Sau khi `migrate` và `seed`, 52 tài khoản mẫu dùng chung `SEED_PASSWORD` của lần triển khai. Không ghi mật khẩu thật vào repository.

## Tài khoản quản trị cho database đang chạy

Nếu database không dùng bộ seed 52 người, người vận hành có thể nâng thành viên
`approver` đầu tiên thành tài khoản quản trị gốc bằng lệnh sau. Lệnh gán đủ bốn
vai thật (`member`, `content_ops`, `approver`, `tech`), đổi mật khẩu và ghi sự
kiện `admin.bootstrap` vào nhật ký; mật khẩu không được lưu trong repository.

```text
docker compose exec -T -e ADMIN_EMAIL=admin@nhachung.local -e ADMIN_GENERATE_PASSWORD=true api npm run admin:bootstrap
```

Kết quả JSON in mật khẩu sinh ngẫu nhiên đúng một lần. Hãy cất mật khẩu đó ở
trình quản lý mật khẩu và đổi lại khi bàn giao hệ thống.

| Mã | Đăng nhập mẫu | Vai trò thật | Dùng để kiểm tra |
|---|---|---|---|
| M01 | `m01@nhachung.invalid` | `member`, `approver`, `tech` | toàn quyền vận hành mẫu, ký duyệt |
| M02 | `m02@nhachung.invalid` | `member`, `approver` | người duyệt thứ hai |
| M03 | `m03@nhachung.invalid` | `member`, `approver` | kiểm tra hai người ký |
| M04 | `m04@nhachung.invalid` | `member`, `tech` | nội dung/kỹ thuật |
| M05 | `m05@nhachung.invalid` | `member`, `content_ops` | đăng và điều phối nội dung |
| M06 trở đi | `m06@nhachung.invalid` … | `member` | hội viên thường, nhắn tin/upload |

Sau khi đăng nhập, giao diện hiển thị vai thật lấy từ `GET /api/v1/auth/me`. Không có vai `recruiter`: mọi tài khoản có vai `member` đều vừa là thành viên, vừa có thể đăng nhu cầu tuyển người/hợp tác, khai trạng thái sẵn sàng nhận việc và ứng tuyển tin của thành viên khác. Vai `approver`, `content_ops`, `tech` chỉ mở thêm chức năng vận hành; chúng không tạo một danh tính thứ hai.

Tin nhắn nên kiểm tra bằng hai cửa sổ đăng nhập M01 và M06: chọn **Nhắn tin**, gửi ở cửa sổ thứ nhất, cửa sổ thứ hai nhận ngay qua SSE và phát tiếng “ting ting” sau khi người dùng đã tương tác với trang.

## Luồng thành viên và việc làm cần kiểm tra

1. Đăng nhập M01, sửa hồ sơ và đăng một năng lực.
2. Vẫn bằng M01, vào **Việc chung → Việc làm**, đăng một nhu cầu. Không chuyển vai.
3. Đăng nhập M06 ở cửa sổ khác, tạo hồ sơ sẵn sàng nhận việc và ứng tuyển tin của M01.
4. M01 nhận thông báo tức thì, mở tin và chuyển ứng viên sang `Đã thống nhất`, `Đang làm`, `Đã xong` hoặc `Không thành`.
5. M06 nhận thông báo cập nhật. Tin đã có ứng viên chỉ được đóng/hủy, không xóa để tránh mất lịch sử.
6. M06 xin xem số điện thoại M01; M01 duyệt ở **Quyền riêng tư → Yêu cầu xem liên hệ**, sau đó M06 mới đọc được số.

Các API CRUD chính:

```text
GET/PATCH                 /api/v1/members/me
GET                       /api/v1/members/me/relations
GET                       /api/v1/members/:id
GET/PATCH                 /api/v1/members/me/privacy[/:field]
GET                       /api/v1/members/me/profile-views
POST                      /api/v1/members/:id/contact-requests
GET/PATCH                 /api/v1/members/me/contact-requests[/:id]
GET/POST                  /api/v1/capabilities
GET/PATCH/DELETE          /api/v1/capabilities/:id
GET/POST                  /api/v1/jobs
GET/PATCH/DELETE          /api/v1/jobs/:id
GET/PUT/DELETE            /api/v1/jobs/ready[/me]
POST/DELETE               /api/v1/jobs/:id/applications[/me]
PATCH                     /api/v1/jobs/:id/applications/:connectionId
GET/POST                  /api/v1/projects
GET/PATCH/DELETE          /api/v1/projects/:id
POST                      /api/v1/projects/:id/join
```

Không có API xóa tài khoản thành viên trực tiếp. Việc rời cộng đồng/xóa dữ liệu cá nhân là quy trình quản trị có nhật ký, không phải nút CRUD thông thường.

API kiểm thử trực tiếp:

```text
GET  /api/v1/notifications
GET  /api/v1/notifications/stream?access_token=<access-token>  # EventSource same-origin
GET  /api/v1/messages?with_member_id=<member-uuid>
POST /api/v1/messages {"recipient_id":"<member-uuid>","body":"..."}
POST /api/v1/notifications {"recipient_id":"<member-uuid>","kind":"activity","title":"...","body":"..."}
```

Smoke test đăng nhập thật bằng hai tài khoản E2E, gửi tin hai chiều, đọc lại
hai luồng, kiểm tra chặn tự gửi và hợp đồng quan hệ:

```text
node api/scripts/e2e-messaging-smoke.js
```

Script đọc `E2E_MEMBER_A_*`, `E2E_MEMBER_B_*` và tùy chọn `E2E_BASE_URL` từ
biến môi trường; không chứa hoặc in mật khẩu. Với chứng thư HTTPS tự ký ở máy
local, chỉ tiến trình test local mới được phép tạm đặt
`NODE_TLS_REJECT_UNAUTHORIZED=0`; không dùng thiết lập này ở triển khai thật.
