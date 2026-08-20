#!/bin/bash
# Kiểm chuỗi băm hằng ngày (03:15) — kế hoạch Task 18, bước 2.
#
# Phép kiểm KHÔNG viết ở đây. Nó là `fn_audit_verify_chain` trong CSDL
# (migration 032), và `core/audit.js verifyChain()` gọi đúng hàm ấy. Một phép
# kiểm chép làm hai bản là hai phép kiểm sẽ khác nhau, và cái khác nhau ấy chỉ
# lộ ra vào ngày một bên bảo "lành" còn bên kia bảo "gãy".
#
# Container này không có Node, nên nếu không đưa phép kiểm xuống CSDL thì buộc
# phải chép — đó là lý do thật của migration 032, không phải sự gọn gàng.

set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
NOTE=""
OK=false

finish() {
  local rc=$?
  # Ghi vào `restore_tests` chứ không phải `backups`: đây là một phép KIỂM, và
  # `restore_tests` là bảng dành cho "đã kiểm, kết quả thế này".
  record_restore_test "$OK" "chain: $NOTE"
  exit "$rc"
}
trap finish EXIT

FAILED=0
for cid in $(communities); do
  row="$(psql_q "SELECT (fn_audit_verify_chain('$cid'))::text")"
  ok="$(psql_q "SELECT (fn_audit_verify_chain('$cid')).ok")"
  checked="$(psql_q "SELECT (fn_audit_verify_chain('$cid')).checked")"
  if [ "$ok" = "t" ]; then
    NOTE="${NOTE:+$NOTE; }$cid lanh $checked dong"
  else
    FAILED=1
    broken="$(psql_q "SELECT coalesce((fn_audit_verify_chain('$cid')).broken_at::text,'?')")"
    NOTE="${NOTE:+$NOTE; }$cid GAY tai seq $broken"
    log "CHUOI BAM GAY: $cid tai seq $broken ($row)"
  fi
done

if [ "$FAILED" -eq 1 ]; then
  exit 1
fi

OK=true
log "chuoi bam lanh: $NOTE"
