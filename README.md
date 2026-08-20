# Nhà Chung — giai đoạn 1

Nhà Chung là nền tảng cộng đồng với PostgreSQL, API Express, MinIO và một
container sao lưu riêng. Giai đoạn 1 ưu tiên dữ liệu có thể kiểm chứng: luật
quan trọng nằm ở migration/trigger, request được kiểm tra bằng Zod, và mọi
thay đổi nhạy cảm đi qua actor cùng audit.

## Cảnh báo bắt buộc

> **MẤT ROOT KEY LÀ MẤT TOÀN BỘ DỮ LIỆU NHẠY CẢM**, không chỉ mất một người.
> Kho sao lưu khóa gốc phải ở đường dẫn và đích riêng, ngoài máy chủ ứng dụng;
> không để khóa đi cùng bản dump hay commit.

> `f_unaccent` được gắn nhãn `IMMUTABLE` là **lời hứa vận hành của dự án**,
> không phải sự thật tuyệt đối của từ điển. Nếu từ điển `unaccent` thay đổi,
> phải chạy `REINDEX` cho các index phụ thuộc trước khi coi tìm kiếm là đúng.

> **Hai người ký chỉ là hai `member_id` khác nhau.** Phần mềm không biết một
> con người dùng hai tài khoản. Việc bảo đảm họ là hai người thật nằm ngoài
> phần mềm: cộng đồng phải biết mặt hai người ký.

> **148 năng lực và 7 nhóm ngành trong seed là số minh họa cho giao diện demo,
> không phải số liệu thật của cộng đồng.**

## Chạy local

Yêu cầu Docker Compose và Node.js 20+ nếu chạy test ngoài container.

```bash
cp .env.example .env
# sửa toàn bộ secret, mật khẩu DB, domain và CORS trong .env
docker compose up -d --build
docker compose ps
docker compose exec api npm run seed
```

API nằm sau proxy ở `/api/v1`; health check là `/api/v1/health`, tài liệu JSON
OpenAPI là `/api/v1/docs`. Đừng đưa `.env`, `secrets/` hoặc mật khẩu seed vào
git. `SEED_PASSWORD` chỉ dùng cho dữ liệu mẫu và phải đổi trước khi cho người
thật sử dụng.

## Biến môi trường quan trọng

`DATABASE_URL` và `MIGRATION_DATABASE_URL` được compose tạo từ thông tin DB.
Các secret ứng dụng gồm `JWT_SECRET`, `ENCRYPTION_KEY`, `OTP_PEPPER` và các
khóa MinIO. `S3_BUCKET` là kho ảnh; `BACKUP_S3_BUCKET` là kho audit riêng,
object-lock và policy chỉ-ghi của backup được khởi tạo bởi `storage-init`.

`GDRIVE_SERVICE_ACCOUNT_FILE` là đường dẫn **bên trong container backup**,
thường là `/secrets/google-service-account.json`; file host tương ứng nằm ở
`./secrets/` và được mount read-only. Tài khoản dịch vụ chỉ có quyền cần cho
đích sao lưu. Khi Google Drive chưa cấu hình, job vẫn ghi `ok=false` vào bảng
`backups` để trạng thái không bị báo xanh giả.

## Migration và nâng phiên bản

API chỉ mở cổng sau khi migration thành công. Migration đã chạy không được
sửa lại; thêm file mới, build image rồi chạy:

```bash
docker compose up -d --build api
docker compose exec api npm run migrate
```

Không dùng `docker compose down -v` trên môi trường có dữ liệu. `down` không
kèm `-v` rồi `up` lại sẽ giữ volume PostgreSQL/MinIO. Trước thay đổi lớn, tạo
backup và kiểm tra chain; một bản restore thử phải đi vào database tạm, không
ghi đè database đang phục vụ.

## Seed và kiểm thử

Seed dùng UUIDv5 ổn định, `withActor`, `insertOnce`/upsert và có thể chạy lại:

```bash
docker compose exec api npm run seed
docker compose exec api npm test
```

Lần chạy thứ hai không được nhân đôi dữ liệu. Bộ test `t30-seed.test.js`,
`t30-jobs.test.js` và `t31-task17-18-contract.test.js` kiểm tra dữ liệu mẫu,
job, backup, compose wiring và policy; `t32-openapi.test.js` kiểm tra tài liệu
không lệch route/schema.

## Sao lưu, kiểm tra và khôi phục

Container backup chạy theo giờ `Asia/Ho_Chi_Minh`:

```text
03:00 hằng ngày          backup.sh
03:15 hằng ngày          verify-chain.sh
04:00 Chủ nhật           export-audit.sh
05:00 ngày 1 hằng tháng  verify.sh
```

Có thể chạy thủ công trong container:

```bash
docker compose exec backup /app/backup.sh
docker compose exec backup /app/verify-chain.sh
docker compose exec backup /app/export-audit.sh
docker compose exec backup /app/verify.sh
```

Mỗi lần backup, kể cả lỗi `pg_dump` hay chưa cấu hình Drive, phải có một dòng
trong `backups`. `verify-chain.sh` kiểm tra hash chain audit và `verify.sh`
restore dump vào database tạm, có trigger và audit chain; đường restore không
dùng `--disable-triggers`. Khôi phục nghiệp vụ là hành động hai người ký:
kiểm tra `pending_action_id`, rồi chạy restore vào database tạm để đối chiếu
trước khi chuyển sang quy trình vận hành được phê duyệt.

## Nguyên tắc dữ liệu nhạy cảm

API không trả contact nếu chưa có quan hệ/quyền phù hợp. Audit log chỉ thêm,
không có route sửa/xóa. Hành động nhạy cảm dùng `pending_actions` và hai chữ
ký hợp lệ; hai signer phải khác nhau và không phải target. Nhắc xác minh hiện
được diễn giải an toàn là bản ghi `pending` quá 15 ngày; không tự thêm
`expires_at` hay migration mới khi schema chưa quy định điều đó. Kết nối im
lặng quá 30 ngày chỉ tạo nhắc cập nhật trạng thái nhận việc.

Chi tiết từng bất biến, migration cầm luật, nguyên tắc và hậu quả khi gỡ luật
nằm trong [`docs/RANG-BUOC.md`](docs/RANG-BUOC.md). Danh sách endpoint được
sinh từ schema Zod và có thể lấy bằng `GET /api/v1/docs`.
