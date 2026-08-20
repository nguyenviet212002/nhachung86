#!/bin/bash
# Phần chung của bốn tác vụ trong container sao lưu.
#
# LUẬT SỐ MỘT CỦA TỆP NÀY: mọi tác vụ ghi kết quả vào bảng `backups`
# (hoặc `restore_tests`) DÙ THÀNH CÔNG HAY LỖI. Sao lưu thất bại im lặng là
# loại hỏng tệ nhất trong họ này: nó không làm gì hỏng hôm nay, nó chỉ lộ ra
# vào đúng ngày cần khôi phục. Vì vậy mỗi script đặt một `trap ... EXIT` ngay
# sau khi nạp tệp này, và dòng kết quả được ghi từ trong bẫy đó — kể cả khi
# script chết giữa chừng vì `set -e`.
#
# LUẬT SỐ HAI: `backups` là bảng CHỈ-THÊM cho mọi người, kể cả kết nối chủ sở
# hữu mà container này dùng (migration 032, `trg_backups_frozen`). Nên ở đây
# KHÔNG có chuyện "mở một hàng lúc bắt đầu rồi cập nhật lúc kết thúc": mỗi lần
# chạy ghi ĐÚNG MỘT hàng, mang cả `started_at` lẫn `finished_at`. Ai sửa được
# nhật ký cũng không xoá được dòng "sao lưu thất bại" ở đây.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"

: "${DATABASE_URL:?thiếu DATABASE_URL}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

psql_q() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "$1"; }

# Danh sách cộng đồng. Bảng `backups` khoá theo `community_id` vì mọi bảng
# trong dự án này đều thế; một lần sao lưu của máy chủ để lại một dòng cho MỖI
# cộng đồng có mặt trên đó, chứ không phải một dòng chung không thuộc về ai.
communities() { psql_q "SELECT id FROM communities ORDER BY created_at"; }

# Chuỗi cho `note` phải an toàn với SQL. Không nối chuỗi tay: đẩy qua biến của
# psql, và psql tự trích dẫn bằng :'name'.
record_backup() {
  local kind="$1" ok="$2" started="$3" size="$4" location="$5" note="$6"
  local cid
  for cid in $(communities); do
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
      -v cid="$cid" -v kind="$kind" -v ok="$ok" -v started="$started" \
      -v size="${size:-0}" -v loc="$location" -v note="$note" <<'SQL'
INSERT INTO backups (community_id, kind, started_at, finished_at, size_bytes, ok, location, note)
VALUES (:'cid', :'kind', :'started'::timestamptz, now(), nullif(:'size','')::bigint,
        :'ok'::boolean, nullif(:'loc',''), nullif(:'note',''));
SQL
  done
}

record_restore_test() {
  local ok="$1" note="$2"
  local cid
  for cid in $(communities); do
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
      -v cid="$cid" -v ok="$ok" -v note="$note" <<'SQL'
INSERT INTO restore_tests (community_id, backup_id, ok, note)
-- Trỏ tới bản sao lưu MỚI NHẤT, không phải bản mới nhất ĐANG XANH: phép kiểm
-- này chạy trên đúng tệp có trên đĩa, và nếu tệp ấy thuộc một lần chạy bị đánh
-- dấu hỏng thì đó lại càng là thứ cần ghi lại, không phải thứ cần bỏ qua.
SELECT :'cid', (SELECT id FROM backups
                 WHERE community_id = :'cid' AND kind = 'full'
                 ORDER BY started_at DESC LIMIT 1),
       :'ok'::boolean, nullif(:'note','');
SQL
  done
}

# rclone dùng cho CẢ HAI đích: MinIO (giao thức S3, đọc kho ảnh) và Google
# Drive (đẩy bản sao ra ngoài máy chủ). Một công cụ thay vì hai, vì hai công cụ
# là hai cách cấu hình sai.
#
# THÔNG TIN ĐĂNG NHẬP CỦA CONTAINER NÀY KHÔNG CÓ `s3:DeleteObject`. Đó là ràng
# buộc nguyên tắc, không phải chi tiết cấu hình: người sửa được nhật ký không
# được xoá bản sao đối chiếu. Chính sách đặt ở `backup/policy/` và gắn vào
# MinIO bởi dịch vụ `storage-init` trong docker-compose.yml.
write_rclone_conf() {
  local conf="${RCLONE_CONFIG:-/tmp/rclone.conf}"
  : > "$conf"
  chmod 600 "$conf"
  if [ -n "${S3_ENDPOINT:-}" ] && [ -n "${S3_ACCESS_KEY:-}" ]; then
    cat >> "$conf" <<EOF
[s3]
type = s3
provider = Minio
env_auth = false
access_key_id = ${S3_ACCESS_KEY}
secret_access_key = ${S3_SECRET_KEY}
endpoint = ${S3_ENDPOINT}
force_path_style = true
EOF
  fi
  # Google Drive: tài khoản dịch vụ riêng, quyền chỉ-thêm (đặc tả mục 15).
  # Tệp khoá được gắn vào container, KHÔNG nằm trong kho mã nguồn.
  if [ -n "${GDRIVE_SERVICE_ACCOUNT_FILE:-}" ] && [ -f "${GDRIVE_SERVICE_ACCOUNT_FILE}" ]; then
    cat >> "$conf" <<EOF
[gdrive]
type = drive
scope = drive.file
service_account_file = ${GDRIVE_SERVICE_ACCOUNT_FILE}
root_folder_id = ${GDRIVE_FOLDER_ID:-}
EOF
  fi
  echo "$conf"
}

# Đẩy một tệp ra Google Drive. Trả 0 nếu đẩy được, 2 nếu CHƯA CẤU HÌNH, khác 0
# nếu đẩy hỏng. Ba kết quả chứ không phải hai: "chưa có tài khoản Google Drive"
# và "có tài khoản nhưng đẩy hỏng" là hai tình trạng khác hẳn nhau, và gộp
# chúng lại là cách một bản sao lưu không rời khỏi máy chủ suốt nửa năm mà
# không ai biết.
push_offsite() {
  local file="$1" conf
  conf="$(write_rclone_conf)"
  if ! grep -q '^\[gdrive\]' "$conf"; then
    return 2
  fi
  rclone --config "$conf" copy "$file" "gdrive:${GDRIVE_PATH:-nhachung}" --s3-no-check-bucket
}
