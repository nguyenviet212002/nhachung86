#!/bin/bash
# Kiểm bản sao lưu hằng tháng (ngày 1, 05:00) — kế hoạch Task 18, bước 2.
#
# Một bản sao lưu chưa từng được khôi phục thử thì chưa phải một bản sao lưu;
# nó là một tệp mà ta HY VỌNG là bản sao lưu. Tác vụ này khôi phục bản mới nhất
# vào một cơ sở dữ liệu tạm rồi hỏi ba câu, và ghi kết quả vào `restore_tests`.
#
# ============================================================================
# TUYỆT ĐỐI KHÔNG `--disable-triggers`. ĐỌC ĐOẠN NÀY TRƯỚC KHI SỬA TỆP NÀY.
# ============================================================================
# Chuỗi băm của `audit_log` do `trg_audit_chain` dựng. Khôi phục mà tắt trigger
# thì dựng lại được dữ liệu nhưng MỌI ràng buộc trong dự án biến mất trong lúc
# khôi phục — và không ai biết, vì kết quả trông y hệt. Nghĩa là khôi phục xong
# thì mọi luật của dự án này không còn được bảo đảm nữa.
#
# May mắn là KHÔNG CẦN. Đã kiểm bằng chạy thật (`pg_restore -l`): `pg_dump -Fc`
# xếp `CREATE TRIGGER` vào phần POST-DATA, tức TOÀN BỘ dữ liệu được nạp TRƯỚC
# khi trigger nào ra đời. `--disable-triggers` chỉ cần cho `--data-only`, và
# đường khôi phục ở đây không dùng `--data-only`. Bằng chứng ghi trong
# task-17-18-report.md: khôi phục đầy đủ, 61 trigger có mặt sau khi xong, và
# `fn_audit_verify_chain` trên bản khôi phục trả `ok=true` với đúng số dòng như
# bản gốc.
#
# Nếu một ngày `pg_restore` không chạy nổi nếu không tắt trigger: DỪNG LẠI VÀ
# BÁO. Đó là quyết định của người dùng, không phải của người viết script.
# ============================================================================

set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

NOTE=""
OK=false
SCRATCH="${RESTORE_TEST_DB:-nhachung_restore_check}"

finish() {
  local rc=$?
  # Dọn cơ sở dữ liệu tạm. `DROP DATABASE` — KHÔNG BAO GIỜ `DROP ROLE`: vai là
  # đối tượng cấp cụm, dùng chung với cơ sở dữ liệu thật; xoá nó là làm hỏng
  # đúng hệ thống mà tác vụ này đang đi kiểm.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -q -c "DROP DATABASE IF EXISTS \"$SCRATCH\"" >/dev/null 2>&1 || true
  record_restore_test "$OK" "$NOTE"
  exit "$rc"
}
trap finish EXIT

LATEST="$(ls -1t "$BACKUP_DIR"/db-*.dump 2>/dev/null | head -1 || true)"
if [ -z "$LATEST" ]; then
  NOTE="khong tim thay ban sao luu nao trong $BACKUP_DIR"
  exit 1
fi
log "kiem ban sao luu $LATEST"

# Chuỗi kết nối tới CSDL tạm: thay tên CSDL ở cuối DATABASE_URL, giữ nguyên
# phần còn lại (không dựng lại chuỗi từ các biến rời — đó là cách hai chuỗi kết
# nối trôi khỏi nhau).
SCRATCH_URL="$(printf '%s' "$DATABASE_URL" | sed -E "s#/[^/?]+(\\?|$)#/$SCRATCH\\1#")"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$SCRATCH\""
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"$SCRATCH\""

# Không `--disable-triggers`, không `--data-only`, không `session_replication_role`.
# `--exit-on-error` để một lỗi giữa chừng không bị nuốt thành "khôi phục xong".
if ! pg_restore --dbname "$SCRATCH_URL" --no-owner --exit-on-error "$LATEST"; then
  NOTE="pg_restore that bai tren $LATEST"
  exit 1
fi

# Câu hỏi 1 — có dữ liệu không.
N_MEMBERS="$(psql "$SCRATCH_URL" -At -c "SELECT count(*) FROM members")"
# Câu hỏi 2 — ràng buộc có sống lại không. Đây là câu mà `--disable-triggers`
# sẽ trả lời "có" một cách sai: trigger vẫn được TẠO, chỉ là chúng không chạy
# lúc nạp dữ liệu. Nên đếm trigger là điều kiện CẦN, không phải điều kiện đủ —
# điều kiện đủ là câu hỏi 3.
N_TRIGGERS="$(psql "$SCRATCH_URL" -At -c "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal")"
# Câu hỏi 3 — chuỗi băm trên BẢN KHÔI PHỤC có còn liên mạch không. Nếu dữ liệu
# được nạp qua một con đường bỏ qua trigger thì hoặc băm bị tính lại (chuỗi
# khác bản gốc), hoặc bị bỏ trống — cả hai đều lộ ra ở đây.
CHAIN_BAD=0
for cid in $(psql "$SCRATCH_URL" -At -c "SELECT id FROM communities ORDER BY created_at"); do
  ok="$(psql "$SCRATCH_URL" -At -c "SELECT (fn_audit_verify_chain('$cid')).ok")"
  [ "$ok" = "t" ] || CHAIN_BAD=1
done

NOTE="$(basename "$LATEST"): $N_MEMBERS nguoi, $N_TRIGGERS trigger, chuoi bam $([ "$CHAIN_BAD" -eq 0 ] && echo lanh || echo GAY)"

if [ "$N_MEMBERS" -lt 1 ] || [ "$N_TRIGGERS" -lt 1 ] || [ "$CHAIN_BAD" -eq 1 ]; then
  exit 1
fi

OK=true
log "ban sao luu dung duoc: $NOTE"
