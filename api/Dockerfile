FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
# Các mốc trong `src/jobs/` là giờ vận hành của cộng đồng, không phải UTC.
# Backup container dùng cùng múi giờ; đặt ngay trên image để chạy standalone
# cũng không âm thầm lệch bảy tiếng so với cron.
ENV TZ=Asia/Ho_Chi_Minh
# KHÔNG `apk add wget`. Gói đó trên image này cài ra một /usr/bin/wget RỖNG
# (0 byte) và còn che mất applet wget có sẵn của BusyBox, nên một HEALTHCHECK
# chạy `wget` sẽ luôn hỏng với `exec /usr/bin/wget: exec format error` —
# container báo `unhealthy` vĩnh viễn dù /api/v1/health trả 200. Phát hiện khi
# chạy MỐC 1: `docker inspect` cho FailingStreak = 138 trong khi
# `curl localhost/api/v1/health` vẫn ra {"ok":true,...}.
#
# Dùng chính node cho việc kiểm tra: nó là runtime bắt buộc phải chạy được rồi,
# nên không thêm phụ thuộc nào, và không có gói ngoài nào để hỏng.
#
# SOÁT XÉT ĐỘC LẬP TASK 9 (Important) — chú thích bản trước ở đây NÓI SAI vì
# sao đợt sửa "chuyển sang node" phía trên có vẻ hoạt động: `docker-compose.yml`
# (không nằm trong diff sửa Dockerfile) khai RIÊNG một khối `healthcheck:` cho
# service `api` với `test: ["CMD", "wget", ...]`, và compose GHI ĐÈ HOÀN TOÀN
# chỉ thị HEALTHCHECK của image — không hợp nhất, không có cái nào "thắng vì
# đúng hơn". Dưới compose, dòng `HEALTHCHECK CMD node ...` ở trên chưa từng
# chạy lấy một lần; `docker inspect --format '{{json .Config.Healthcheck}}'`
# từng ra `wget`, không phải `node`. Container báo "healthy" không phải vì đổi
# sang node, mà vì bỏ `apk add wget` (đoạn trên) trả lại đúng symlink
# `wget → busybox` nguyên bản của image — thứ mà compose vẫn đang âm thầm gọi.
# Đã xoá khối `healthcheck:` đó khỏi docker-compose.yml để dòng HEALTHCHECK
# này thật sự là nguồn sự thật duy nhất, kiểm bằng `docker inspect` thật (xem
# task-9-fix-report.md) chứ không chỉ suy diễn từ việc container không đỏ.
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN chmod +x ./docker-entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
