#!/bin/bash
# Xuất bản sao nhật ký hằng tuần (Chủ nhật 04:00) — kế hoạch Task 18, bước 1.
#
# VÌ SAO NHẬT KÝ ĐI ĐƯỜNG RIÊNG, TỚI ĐÍCH RIÊNG, BẰNG THÔNG TIN ĐĂNG NHẬP
# RIÊNG. `audit_log` là bản đối chiếu để trả lời câu "có ai sửa dữ liệu không".
# Nếu bản đối chiếu nằm cùng chỗ, cùng quyền với thứ nó đối chiếu, thì nó không
# đối chiếu được gì: người sửa được nhật ký cũng sửa được bản sao của nhật ký.
#
# Vì vậy container này dùng `BACKUP_S3_*`, và chính sách của khoá đó chỉ có
# `s3:PutObject` — KHÔNG có `s3:DeleteObject`, KHÔNG có `s3:PutObjectRetention`.
# Đẩy lên được, ghi đè không được, xoá không được. Xem `backup/policy/`.
#
# Bản xuất mang theo CẢ `audit_chain_head`: không có nó thì không ai biết dòng
# cuối cùng của chuỗi lẽ ra phải là dòng nào, và một bản xuất bị cắt cụt trông
# y hệt một bản xuất đầy đủ.

set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OUT="$BACKUP_DIR/audit/audit-$STAMP.dump"
NOTE=""
SIZE=0
OK=false

finish() {
  local rc=$?
  record_backup 'audit' "$OK" "$STARTED" "$SIZE" "$OUT" "$NOTE"
  exit "$rc"
}
trap finish EXIT

mkdir -p "$(dirname "$OUT")"

# Kiểm chuỗi TRƯỚC khi xuất. Xuất một chuỗi đã gãy rồi mới phát hiện là đã
# nhân bản một bằng chứng hỏng; và bản xuất ấy sẽ nằm ở một nơi không xoá được.
BROKEN=0
for cid in $(communities); do
  res="$(psql_q "SELECT (fn_audit_verify_chain('$cid')).ok")"
  if [ "$res" != "t" ]; then
    BROKEN=1
    NOTE="${NOTE:+$NOTE; }chuoi bam cua cong dong $cid da gay"
  fi
done

log "xuat audit_log -> $OUT"
if ! pg_dump "$DATABASE_URL" -Fc -Z 6 \
      -t audit_log -t 'audit_log_*' -t audit_chain_head -f "$OUT"; then
  NOTE="${NOTE:+$NOTE; }pg_dump audit_log that bai"
  exit 1
fi
SIZE="$(stat -c %s "$OUT")"

CONF="$(write_rclone_conf)"
if grep -q '^\[s3\]' "$CONF"; then
  log "day ban xuat len kho chi-ghi"
  # `copy` (không phải `sync`, không phải `move`): rclone `sync` sẽ cố XOÁ ở
  # đích, và khoá này không có quyền xoá — lệnh sẽ hỏng, và hỏng vì đúng lý do.
  # Nhưng đừng để nó hỏng: `copy` là thứ ta thật sự muốn.
  if ! rclone --config "$CONF" copy "$OUT" "s3:${BACKUP_S3_BUCKET:-nhachung-audit}/" --s3-no-check-bucket; then
    NOTE="${NOTE:+$NOTE; }day ban xuat len MinIO that bai"
    exit 1
  fi
else
  # `ok=false`. Bản xuất nhật ký tồn tại để trả lời "có ai sửa nhật ký không".
  # Nằm cùng máy chủ, cùng quyền với thứ nó đối chiếu thì nó không trả lời được
  # câu ấy — người sửa được nhật ký cũng sửa được nó. Một bản đối chiếu không
  # đối chiếu được gì mà lại được ghi là "xong" thì tệ hơn không có, vì nó làm
  # người ta yên tâm.
  NOTE="${NOTE:+$NOTE; }CHUA CAU HINH MinIO: ban xuat nhat ky con nam tren cung may chu"
  exit 1
fi

if [ "$BROKEN" -eq 1 ]; then
  # Vẫn ghi `ok=false` dù việc xuất chạy trót lọt: cái được hỏi ở đây là "bản
  # đối chiếu tuần này có dùng được không", và một chuỗi đã gãy thì không.
  exit 1
fi

OK=true
log "xong: $OUT ($SIZE bytes)"
