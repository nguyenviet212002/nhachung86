# Cả hai stage dùng CHUNG một base (node:20-bookworm-slim, Debian/glibc) —
# KHÔNG đổi sang Alpine ở stage runtime. Pikafish build bằng glibc; đem chạy
# trên Alpine (musl libc) là lệch libc giữa lúc build và lúc chạy, binary sẽ
# không tương thích. Xem Global Constraints của plan này.

FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      git build-essential curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 https://github.com/official-pikafish/Pikafish.git .
WORKDIR /src/src
# ARCH=native: build tối ưu đúng CPU của MÁY ĐANG BUILD image này — vì
# `docker compose up -d --build` chạy build NGAY TRÊN máy sẽ chạy container
# (dev hoặc VPS thật), đây chính là máy sẽ chạy binary, nên "native" ở đây
# đúng nghĩa "đúng máy đích", không phải giả định sai như build sẵn rồi tải về.
RUN make -j"$(nproc)" build ARCH=native COMP=gcc
RUN make net
# Xác nhận thật tên tệp nhị phân sinh ra (kỳ vọng "pikafish") — đọc log bước
# này khi build lần đầu, đừng tin tên biến EXE trong Makefile mà không soi lại.
RUN ls -la .

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js pool.js uci.js ./
COPY --from=build /src/src/pikafish ./engine-bin/pikafish
COPY --from=build /src/src/pikafish.nnue ./engine-bin/pikafish.nnue
RUN chmod +x ./engine-bin/pikafish
ENV PIKAFISH_BIN=/app/engine-bin/pikafish
ENV PIKAFISH_NNUE=/app/engine-bin/pikafish.nnue
EXPOSE 8898
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD node -e "fetch('http://localhost:8898/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
