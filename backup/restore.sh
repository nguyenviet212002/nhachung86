#!/bin/bash
# Khôi phục từ một bản sao lưu — CHẠY BẰNG TAY, không có trong crontab.
#
# Dùng:  restore.sh <pending_action_id> <duong-dan-tep-dump>
#
# ============================================================================
# BỐN ĐIỀU PHẢI ĐỌC TRƯỚC KHI CHẠY
# ============================================================================
#
# 1. KHÔNG `--disable-triggers`, KHÔNG `--data-only`, KHÔNG
#    `session_replication_role = replica`. Chuỗi băm của `audit_log` do trigger
#    dựng; khôi phục mà tắt trigger thì dựng lại được dữ liệu nhưng mọi ràng
#    buộc của dự án biến mất trong lúc khôi phục, và không ai biết. Không cần
#    tắt: `pg_dump -Fc` xếp `CREATE TRIGGER` vào phần post-data, nên dữ liệu
#    nạp xong trước khi trigger ra đời. Đã kiểm bằng chạy thật, xem `verify.sh`.
#
# 2. NÓ KHÔNG GHI ĐÈ CƠ SỞ DỮ LIỆU ĐANG CHẠY. Nó khôi phục vào một cơ sở dữ
#    liệu MỚI và dừng lại ở đó. Việc chuyển sang dùng bản mới là quyết định của
#    con người, có mặt tại chỗ, sau khi đã nhìn vào bản vừa khôi phục. Một
#    script tự động ghi đè dữ liệu thật là một script chỉ cần chạy nhầm một lần.
#
# 3. NÓ TIÊU `consumed_at` CỦA HÀNH ĐỘNG HAI NGƯỜI KÝ, đúng như migration 033
#    làm cho `community.config_change`. Không có bước ấy thì một quyết định
#    khôi phục đã được hai người ký MỘT lần sẽ chạy lại được bao nhiêu lần tuỳ
#    ý, bởi một người, vào bất kỳ lúc nào sau đó — và với `backup.restore` thì
#    hậu quả nặng hơn hẳn đổi cấu hình.
#
# 4. GIỚI HẠN THẬT, nói ra chứ không giấu: với `community.config_change`, việc
#    tiêu vé nằm trong TRIGGER CỦA BẢNG BỊ GHI (`communities`), nên không cửa
#    nào đi vòng được — đó là Ruling T10-a. Ở đây KHÔNG có bảng bị ghi: thứ bị
#    ghi là cả cụm cơ sở dữ liệu, và không trigger nào bám vào đó được. Nên câu
#    `UPDATE … WHERE consumed_at IS NULL` cộng kiểm số hàng ở dưới là một lời
#    hứa CỦA SCRIPT NÀY, không phải một ràng buộc của CSDL — yếu hơn một bậc.
#    Ai chạy `pg_restore` thẳng bằng tay thì không có gì ngăn cả.
#    Và nặng hơn: BẢN VỪA KHÔI PHỤC MANG THEO SỔ VÉ CỦA NGÀY SAO LƯU. Chuyển
#    sang dùng nó nghĩa là `consumed_at` quay về giá trị của hôm ấy. Chống phát
#    lại không sống sót qua chính thao tác mà nó canh. Bản đối chiếu duy nhất
#    sống sót là bản xuất `audit_log` nằm ở kho chỉ-ghi (`export-audit.sh`) —
#    hãy so nó với nhật ký của bản vừa khôi phục TRƯỚC KHI chuyển sang dùng.
# ============================================================================

set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

ACTION_ID="${1:-}"
DUMP="${2:-}"
TARGET="${RESTORE_TARGET_DB:-nhachung_restored_$(date -u +%Y%m%d_%H%M%S)}"

if [ -z "$ACTION_ID" ] || [ -z "$DUMP" ]; then
  echo "dung: restore.sh <pending_action_id> <duong-dan-tep-dump>" >&2
  exit 64
fi
[ -f "$DUMP" ] || { echo "khong thay tep $DUMP" >&2; exit 66; }

# Hai giá trị này đi vào câu SQL quản trị (một giá trị uuid và một identifier
# database). Kiểm tra hình dạng trước, sau đó vẫn truyền qua biến psql để không
# bao giờ nối input người vận hành trực tiếp vào SQL.
if [[ ! "$ACTION_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  echo "pending_action_id khong phai UUID hop le" >&2
  exit 65
fi
if [[ ! "$TARGET" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]]; then
  echo "RESTORE_TARGET_DB chi duoc la ten database PostgreSQL hop le" >&2
  exit 65
fi
LIVE_DB="$(psql_q "SELECT current_database()")"
[ "$TARGET" != "$LIVE_DB" ] || {
  echo "khong duoc khoi phuc de len database dang chay ($LIVE_DB)" >&2
  exit 65
}

# --- Cổng hai người ký -------------------------------------------------------
# Đọc rồi kiểm, RỒI mới tiêu. Câu kiểm ở đây cố ý lặp lại điều mà
# `fn_pending_signature_valid` và `fn_pending_two_signatures` đã cưỡng chế: ở
# tầng CSDL chúng canh lúc GHI chữ ký, còn ở đây ta cần biết tình trạng lúc
# THI HÀNH — hai thời điểm khác nhau.
STATE="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -v action_id="$ACTION_ID" -c "
  SELECT a.action_key || '|' || a.status || '|' ||
         (a.expires_at > now())::text || '|' ||
         fn_pending_action_signatures(a.id) || '|' ||
         (a.consumed_at IS NULL)::text
    FROM pending_actions a WHERE a.id = :'action_id'::uuid")"

[ -n "$STATE" ] || { echo "khong co hanh dong cho nao mang ma $ACTION_ID" >&2; exit 65; }

IFS='|' read -r KEY STATUS NOT_EXPIRED SIGS UNCONSUMED <<< "$STATE"
[ "$KEY" = "backup.restore" ] || { echo "hanh dong nay khong phai backup.restore ($KEY)" >&2; exit 65; }
[ "$UNCONSUMED" = "true" ]    || { echo "quyet dinh nay DA THI HANH roi. Muon khoi phuc nua thi tao mot viec moi va ky lai tu dau." >&2; exit 65; }
[ "$NOT_EXPIRED" = "true" ]   || { echo "quyet dinh nay da qua han. Ky lai tu dau." >&2; exit 65; }
[ "$SIGS" -ge 2 ]             || { echo "moi co $SIGS chu ky, can hai nguoi ky khac nhau" >&2; exit 65; }
[ "$STATUS" = "pending" ]     || { echo "hanh dong o trang thai $STATUS, khong phai pending" >&2; exit 65; }

# TIÊU VÉ TRƯỚC KHI KHÔI PHỤC. `WHERE consumed_at IS NULL` cộng `ROW_COUNT` là
# vế chạy đua: hai lần chạy đồng thời thì lần thứ hai chạm 0 hàng và dừng ở đây,
# không phải sau khi đã ghi đè xong. Đúng khuôn migration 033.
CONSUMED="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At \
  -v action_id="$ACTION_ID" -v target="$TARGET" -c "
  WITH taken AS (
    UPDATE pending_actions
       SET consumed_at = now(), status = 'executed', executed_at = now(),
           result = jsonb_build_object('restored_into', :'target')
     WHERE id = :'action_id'::uuid AND consumed_at IS NULL
       RETURNING 1)
  SELECT count(*) FROM taken")"
[ "$CONSUMED" = "1" ] || { echo "khong tieu duoc quyet dinh nay (co the mot lan chay khac vua tieu no)" >&2; exit 65; }

NOTE="khoi phuc $(basename "$DUMP") vao $TARGET theo quyet dinh $ACTION_ID"
OK=false
finish() {
  local rc=$?
  record_restore_test "$OK" "$NOTE"
  exit "$rc"
}
trap finish EXIT

log "khoi phuc $DUMP -> $TARGET"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -v target="$TARGET" -c 'CREATE DATABASE :"target"'
TARGET_URL="$(printf '%s' "$DATABASE_URL" | sed -E "s#/[^/?]+(\\?|$)#/$TARGET\\1#")"

if ! pg_restore --dbname "$TARGET_URL" --no-owner --exit-on-error "$DUMP"; then
  NOTE="$NOTE — pg_restore that bai"
  exit 1
fi

for cid in $(psql "$TARGET_URL" -At -c "SELECT id FROM communities ORDER BY created_at"); do
  ok="$(psql "$TARGET_URL" -At -c "SELECT (fn_audit_verify_chain('$cid')).ok")"
  if [ "$ok" != "t" ]; then
    NOTE="$NOTE — chuoi bam cua $cid GAY tren ban vua khoi phuc"
    exit 1
  fi
done

OK=true
cat <<EOF

Da khoi phuc vao co so du lieu: $TARGET
Chuoi bam tren ban vua khoi phuc: LANH.

CHUA CHUYEN SANG DUNG. Ba viec con lai la cua con nguoi:
  1. So ban xuat nhat ky o kho chi-ghi (nhachung-audit) voi audit_log cua
     $TARGET. Do la ban doi chieu DUY NHAT khong nam trong ban sao luu nay.
  2. Nhin vao du lieu: so nguoi, but toan quy gan nhat, don gia nhap dang cho.
  3. Doi ten co so du lieu hoac tro DATABASE_URL sang $TARGET, roi khoi dong
     lai api. Sau buoc do, so ve hai nguoi ky (pending_actions.consumed_at)
     quay ve gia tri cua ngay sao luu — xem diem 4 o dau tep nay.
EOF
