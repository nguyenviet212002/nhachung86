FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
# KHÔNG `apk add wget`. Gói đó trên image này cài ra một /usr/bin/wget RỖNG
# (0 byte) và còn che mất applet wget có sẵn của BusyBox, nên HEALTHCHECK
# chạy `wget` sẽ luôn hỏng với `exec /usr/bin/wget: exec format error` —
# container báo `unhealthy` vĩnh viễn dù /api/v1/health trả 200. Phát hiện khi
# chạy MỐC 1: `docker inspect` cho FailingStreak = 138 trong khi
# `curl localhost/api/v1/health` vẫn ra {"ok":true,...}.
#
# Dùng chính node cho việc kiểm tra: nó là runtime bắt buộc phải chạy được rồi,
# nên không thêm phụ thuộc nào, và không có gói ngoài nào để hỏng.
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN chmod +x ./docker-entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
