# Container sao lưu — Task 18 thay toàn bộ ruột của khung tạm ở Ruling C13.
#
# Phiên bản postgresql16-client phải KHỚP máy chủ (`postgres:16-alpine` trong
# docker-compose.yml): `pg_dump` mới hơn máy chủ thì chạy được, `pg_dump` cũ hơn
# thì từ chối. Đổi phiên bản máy chủ mà quên dòng này là sao lưu chết im lặng
# vào đúng đêm hôm sau.
#
# `rclone` lo CẢ HAI đích — MinIO (giao thức S3) và Google Drive — thay vì hai
# công cụ, vì hai công cụ là hai chỗ cấu hình sai.
FROM alpine:3.20

RUN apk add --no-cache postgresql16-client dcron bash rclone coreutils tzdata ca-certificates

ENV TZ=Asia/Ho_Chi_Minh
ENV BACKUP_DIR=/backups
ENV RCLONE_CONFIG=/tmp/rclone.conf

WORKDIR /app
COPY lib.sh backup.sh export-audit.sh verify-chain.sh verify.sh run-job.sh entrypoint.sh crontab /app/
RUN chmod +x /app/*.sh && mkdir -p /backups

# Không `HEALTHCHECK` ở đây: container này đúng nghĩa là ngủ giữa các lần chạy,
# "còn sống" không nói lên điều gì. Thứ đáng theo dõi là bảng `backups` — nó
# ghi kết quả DÙ THÀNH CÔNG HAY LỖI, và bảng điều khiển vận hành đọc từ đó.
ENTRYPOINT ["/app/entrypoint.sh"]
