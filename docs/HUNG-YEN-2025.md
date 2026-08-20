# Danh mục khu vực Hưng Yên sau sắp xếp 2025

Ứng dụng dùng danh mục 104 đơn vị hành chính cấp xã hiện hành của tỉnh Hưng Yên: 93 xã và 11 phường, theo Nghị quyết 1666/NQ-UBTVQH15.

- API nguồn cho màn hình đăng ký: `GET /api/v1/areas`
- Dữ liệu chuẩn duy nhất: `api/src/db/seeds/data/community.js`
- Tất cả UUID khu vực là UUIDv5 ổn định từ tên khu vực.
- 12 khu vực cũ không bị xoá khỏi cơ sở dữ liệu. Migration 035 đánh dấu chúng không hoạt động để giữ liên kết lịch sử; API và đăng ký chỉ nhận khu vực mới.

## Tạo tài khoản thật

Luồng đăng ký hiện tại vẫn cần OTP và link mời hợp lệ từ một thành viên bảo lãnh. Người đăng ký chỉ cần nhập họ tên, năm sinh theo chính sách cộng đồng, số điện thoại, mật khẩu và chọn một khu vực trong danh sách mới. Không cần nhập mã xã/phường hay địa chỉ chi tiết.

Tài khoản mẫu dành cho kiểm thử được tạo bằng seed và dùng mật khẩu trong biến môi trường `SEED_PASSWORD`; mật khẩu không ghi trong repository:

```powershell
docker compose exec api npx knex migrate:latest
docker compose exec api npm run seed
```

Nếu database đã có cộng đồng vận hành từ phiên bản cũ và `npm run seed` báo trùng `communities.code`, dùng lệnh cập nhật danh mục riêng sau migration:

```powershell
docker compose exec api npm run seed:areas
```

Lệnh này tìm cộng đồng theo mã `binhdan1986`, giữ nguyên UUID và dữ liệu thành viên, chỉ upsert 104 khu vực hiện hành.

Sau đó chọn khu vực mới trong form đăng ký hoặc dùng các email mẫu trong `docs/TEST-ROLES.md`. Không dùng tài khoản mẫu cho dữ liệu sản xuất.

Nguồn danh mục: [Báo điện tử Chính phủ — Danh sách 104 xã, phường của tỉnh Hưng Yên mới](https://xaydungchinhsach.chinhphu.vn/sap-xep-dvhc-danh-sach-104-xa-phuong-cua-tinh-hung-yen-moi-119250622210849858.htm).
