#!/bin/bash
# Sao lưu hằng ngày (03:00) — kế hoạch Task 18, bước 1.
#
# Bốn việc, theo đúng thứ tự:
#   1. `pg_dump` nén, đặt tên theo ngày giờ;
#   2. đồng bộ ảnh từ MinIO xuống cùng thư mục;
#   3. đẩy bản sao ra Google Drive (đích ngoài máy chủ);
#   4. ghi kết quả vào `backups` — DÙ THÀNH CÔNG HAY LỖI.
#
# Việc thứ tư nằm trong `trap`, không nằm ở cuối script: nếu nó ở cuối thì
# đúng trường hợp cần nó nhất (script chết giữa chừng) lại là trường hợp nó
# không chạy.
#
# `pg_dump -Fc` chứ không phải `-Fp`: định dạng tuỳ chọn cho phép `pg_restore`
# chọn thứ tự, và chính thứ tự ấy là lý do đường khôi phục KHÔNG cần tắt
# trigger — xem `verify.sh`.

set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OUT="$BACKUP_DIR/db-$STAMP.dump"
NOTE=""
SIZE=0
OK=false

finish() {
  local rc=$?
  record_backup 'full' "$OK" "$STARTED" "$SIZE" "$OUT" "$NOTE"
  exit "$rc"
}
trap finish EXIT

mkdir -p "$BACKUP_DIR"

log "pg_dump -> $OUT"
if ! pg_dump "$DATABASE_URL" -Fc -Z 6 -f "$OUT"; then
  NOTE="pg_dump that bai"
  exit 1
fi
SIZE="$(stat -c %s "$OUT")"

# Ảnh: MinIO là nguồn, thư mục sao lưu là đích. `copy` chứ không phải `sync` —
# `sync` XOÁ ở đích những gì đã biến mất ở nguồn, tức một lệnh xoá nhầm trên
# MinIO sẽ lan sang cả bản sao lưu ở lần chạy kế tiếp. Bản sao lưu không được
# phản chiếu một vụ mất dữ liệu.
CONF="$(write_rclone_conf)"
if grep -q '^\[s3\]' "$CONF"; then
  log "dong bo anh tu MinIO"
  if ! rclone --config "$CONF" copy "s3:${S3_BUCKET:-nhachung}" "$BACKUP_DIR/storage" --s3-no-check-bucket; then
    NOTE="pg_dump xong nhung dong bo anh that bai"
    exit 1
  fi
else
  NOTE="khong cau hinh MinIO: bo qua buoc dong bo anh"
fi

# Đích ngoài máy chủ. Một bản sao lưu nằm cùng ổ đĩa với bản gốc không phải là
# một bản sao lưu — nó chỉ là một tệp thứ hai sẽ cháy cùng đám cháy.
set +e
push_offsite "$OUT"
rc=$?
set -e
case "$rc" in
  0) : ;;
  # `ok=false`, KHÔNG phải "ok=true kèm ghi chú". Một bản sao lưu chưa rời khỏi
  # máy chủ thì chưa làm được việc mà nó sinh ra để làm: nó sẽ cháy cùng đám
  # cháy. Ghi nó là thành công đúng là cách một hệ thống chạy nửa năm mà không
  # ai biết bản sao lưu chưa bao giờ đi đâu cả — và ngày phát hiện ra là ngày
  # cần khôi phục. Thà bảng điều khiển đỏ mỗi đêm cho tới khi có thông tin đăng
  # nhập thật, còn hơn xanh nhờ một lời nói giảm.
  2) NOTE="${NOTE:+$NOTE; }CHUA CAU HINH Google Drive: ban sao chua roi khoi may chu"; exit 1 ;;
  *) NOTE="${NOTE:+$NOTE; }day len Google Drive that bai"; exit 1 ;;
esac

if [ -n "$NOTE" ]; then
  # Còn một bước chưa chạy được (thường là đồng bộ ảnh) — cùng lập luận trên.
  exit 1
fi

OK=true
log "xong: $OUT ($SIZE bytes)"
