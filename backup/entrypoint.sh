#!/bin/bash
# dcron chay moi tac vu voi mot moi truong tran. Chup lai moi truong that cua
# container vao /app/job.env de run-job.sh nap lai — neu khong, `backup.sh` se
# khong thay DATABASE_URL va se chet moi dem mot cach kho hieu.
set -euo pipefail
: > /app/job.env
chmod 600 /app/job.env
for v in DATABASE_URL BACKUP_DIR S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET \
         BACKUP_S3_BUCKET GDRIVE_SERVICE_ACCOUNT_FILE GDRIVE_FOLDER_ID GDRIVE_PATH \
         RESTORE_TEST_DB; do
  if [ -n "${!v:-}" ]; then printf 'export %s=%q\n' "$v" "${!v}" >> /app/job.env; fi
done
mkdir -p "${BACKUP_DIR:-/backups}"
crontab /app/crontab
echo "container sao luu san sang; lich:" && crontab -l
exec crond -f -l 8
