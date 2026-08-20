#!/bin/sh
# Gắn chính sách của container sao lưu vào MinIO — chạy MỘT LẦN lúc dựng stack
# (dịch vụ `storage-init` trong docker-compose.yml), rồi thoát.
#
# VÌ SAO VIỆC NÀY KHÔNG NẰM TRONG CONTAINER SAO LƯU: gắn chính sách đòi thông
# tin đăng nhập QUẢN TRỊ của MinIO. Nếu container sao lưu có nó thì nó tự nới
# được chính sách của chính mình, và toàn bộ ý nghĩa của "khoá này không xoá
# được" biến mất — người chiếm được container sao lưu chỉ cần một lệnh
# `mc admin policy attach` là xoá sạch bản đối chiếu. Đặc quyền quản trị ở lại
# với một container sống vài giây rồi chết.
#
# Chính sách nằm ở `backup/policy/backup.json`: đọc, sửa được, và nằm trong kho
# mã nguồn để mọi thay đổi của nó có lịch sử. Ba câu của nó:
#   * ĐỌC kho ảnh (`nhachung`) — để sao lưu ảnh xuống;
#   * GHI THÊM vào kho nhật ký (`nhachung-audit`) — chỉ `s3:PutObject`;
#   * CẤM TUYỆT ĐỐI mọi lệnh xoá, ở mọi kho. Câu `Deny` này thắng mọi câu
#     `Allow` khác trong IAM, kể cả `Allow` do ai đó thêm về sau — đó là lý do
#     nó được viết ra dù hai câu trên vốn đã không cấp quyền xoá.
set -eu

: "${S3_ENDPOINT:?thiếu S3_ENDPOINT}"
: "${S3_ACCESS_KEY:?thiếu S3_ACCESS_KEY}"
: "${S3_SECRET_KEY:?thiếu S3_SECRET_KEY}"
: "${BACKUP_S3_ACCESS_KEY:?thiếu BACKUP_S3_ACCESS_KEY}"
: "${BACKUP_S3_SECRET_KEY:?thiếu BACKUP_S3_SECRET_KEY}"

# MinIO có thể chưa nghe cổng ngay lúc container này khởi động.
i=0
until mc alias set root "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "khong noi duoc toi MinIO tai $S3_ENDPOINT sau 60 lan thu" >&2
    exit 1
  fi
  sleep 2
done

mc mb --ignore-existing root/nhachung
# Object-lock phải được bật ngay lúc tạo bucket; MinIO không cho bật lại sau
# khi bucket đã tồn tại. Chính sách Deny bên dưới vẫn là lớp không-xoá chính,
# còn object-lock giữ cho bucket đối chiếu không mất lớp bảo vệ nếu policy bị
# cấu hình rộng hơn ở một môi trường khác.
mc mb --ignore-existing --with-lock root/nhachung-audit

# Kho nhật ký bật VERSIONING và khoá giữ theo hạn: ngay cả khi một ngày nào đó
# có ai gắn nhầm một chính sách rộng hơn, bản cũ vẫn còn. Đây là lớp thứ hai,
# không thay cho lớp thứ nhất.
mc version enable root/nhachung-audit || echo "canh bao: khong bat duoc versioning cho nhachung-audit" >&2

mc admin user add root "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY" || true
# `storage-init` có thể được tạo lại sau `docker compose down/up`. Policy đã
# tồn tại không phải lỗi khởi tạo; user vẫn được attach lại ở lệnh kế tiếp.
mc admin policy info root nhachung-backup >/dev/null 2>&1 || \
  mc admin policy create root nhachung-backup /policy/backup.json
mc admin policy attach root nhachung-backup --user "$BACKUP_S3_ACCESS_KEY" || true

echo "da gan chinh sach nhachung-backup cho nguoi dung sao luu"

# Kiểm bằng chạy thật, không bằng lời hứa: khoá sao lưu phải GHI được và phải
# KHÔNG XOÁ được. Nếu vế thứ hai không đúng thì dừng stack ở đây chứ đừng để
# nó chạy với một lời hứa sai.
mc alias set bk "$S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY" >/dev/null
echo "kiem tra chinh sach" > /tmp/probe.txt
mc cp /tmp/probe.txt bk/nhachung-audit/probe.txt >/dev/null
if mc rm bk/nhachung-audit/probe.txt >/dev/null 2>&1; then
  echo "LOI NGUYEN TAC: khoa sao luu XOA DUOC vat trong kho nhat ky." >&2
  echo "Nguoi sua duoc nhat ky khong duoc xoa ban doi chieu. Dung stack." >&2
  exit 1
fi
echo "xac nhan: khoa sao luu ghi duoc, khong xoa duoc"
