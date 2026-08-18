#!/bin/sh
set -e
echo "==> chạy migration"
npx knex migrate:latest
echo "==> migration xong, mở cổng phục vụ"
exec node src/server.js
