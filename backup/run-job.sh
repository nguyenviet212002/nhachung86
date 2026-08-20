#!/bin/bash
# Vo boc cua moi tac vu trong crontab.
#
# Ba viec: nap bien moi truong (dcron chay voi moi truong tran, khong co gi
# ngoai PATH), ghi log ra stdout de `docker compose logs backup` thay duoc, va
# KHONG BAO GIO de ma loi cua mot tac vu lam dung dcron — mot lan sao luu that
# bai khong duoc lam nhung lan sau khong chay nua.
set -uo pipefail
[ -f /app/job.env ] && . /app/job.env
job="$1"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) bat dau $job" >> /proc/1/fd/1
"/app/$job" >> /proc/1/fd/1 2>&1
rc=$?
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) xong $job rc=$rc" >> /proc/1/fd/1
exit 0
