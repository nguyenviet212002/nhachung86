# Nhà Chung — Giai đoạn 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng backend Nhà Chung giai đoạn 1 — chạy bằng một lệnh Docker, lược đồ đầy đủ với năm nguyên tắc cưỡng chế ở tầng CSDL, và luồng gia nhập chạy đầu-cuối từ đăng ký tới hiện trong danh bạ.

**Architecture:** Express + Knex + PostgreSQL 16, đóng gói bằng Docker Compose. Luật nghiệp vụ quan trọng nhất nằm trong CSDL (trigger, `REVOKE`, constraint trigger hoãn), không nằm trong mã ứng dụng — ứng dụng chạy bằng role `app_role` cố tình bị tước quyền, nên một route viết ẩu gặp `permission denied` thay vì làm rò rỉ dữ liệu. Tầng `core/` giữ mọi luật dùng chung và không bao giờ import ngược lên `modules/`.

**Tech Stack:** Node 20, Express 4, Knex 3, PostgreSQL 16, zod, argon2, jsonwebtoken, sharp, pino, MinIO, Caddy 2, Vitest.

**Spec:** [docs/superpowers/specs/2026-08-18-nha-chung-giai-doan-1-design.md](../specs/2026-08-18-nha-chung-giai-doan-1-design.md)

## Global Constraints

Mọi task đều ngầm mang các ràng buộc này. Vi phạm bất kỳ dòng nào là lý do đủ để từ chối task.

- **Năm nguyên tắc bất biến** (mục 2 đặc tả gốc) thắng mọi tiện lợi kỹ thuật. Ràng buộc nào làm chậm thì nêu ra bàn, **không tự bỏ**.
- **Không tên riêng trong mã nguồn.** Chuỗi "Bính Dần", "Hội", số `1986` không được xuất hiện trong `api/src/**`. Chúng nằm trong `communities.config`.
- **Mọi bảng có `community_id uuid NOT NULL REFERENCES communities(id)`** ngay từ migration tạo bảng.
- **Ứng dụng chạy bằng `app_role`, migration chạy bằng `nhachung_owner`.** Hai role khác nhau, không bao giờ dùng lẫn.
- **Mọi giao dịch mở qua `core/tx.js:withActor()`.** Không gọi `knex.transaction()` trực tiếp ở bất kỳ đâu ngoài file đó.
- **`core/` không được import từ `modules/`.** Một chiều, có test canh (T13).
- **Truy vấn chỉ tham số hóa.** Cấm nối chuỗi SQL. Ngoại lệ duy nhất: `format('%I')` cho tên cột đã qua danh sách trắng, bên trong hàm `SECURITY DEFINER`.
- **`audit_log.detail` chỉ chứa uuid, enum, `field_key`, số đếm, và định danh giả (HMAC).** Không bao giờ chứa giá trị cá nhân thô.
- **Kết nối DB dùng `DATABASE_URL` từ biến môi trường.** Không hard-code mật khẩu ở bất kỳ file nào được commit.
- **Mã lỗi trả về:** `{ "error": { "code": "SNAKE_CASE", "message": "câu tiếng Việt", "fields": {…} } }`
- Node **20**, PostgreSQL **16**, image `postgres:16-alpine`, `caddy:2-alpine`.

## File Structure

```
docker-compose.yml              5 dịch vụ: db, api, storage, proxy, backup. db KHÔNG có khóa ports
docker-compose.dev.yml          mở 5432 + 9001, bật seed
docker-compose.test.yml         DB dùng một lần cho test và khôi phục thử
.env.example / .gitignore

api/
  Dockerfile                    multi-stage, user node, HEALTHCHECK
  docker-entrypoint.sh          migrate rồi mới listen
  knexfile.js
  src/
    server.js                   chỉ lắng nghe
    app.js                      ráp middleware + router
    config/index.js             đọc + kiểm biến môi trường lúc khởi động, thiếu thì chết ngay
    db/knex.js                  một pool, dùng app_role
    db/migrations/001…024
    db/seeds/ids.js             UUIDv5 tất định
    db/seeds/run.js
    core/tx.js                  withActor() — đường DUY NHẤT mở giao dịch
    core/errors.js              AppError + ánh xạ lỗi PostgreSQL → HTTP
    core/audit.js               log(trx, …) / logDenied(…) + zod canh detail
    core/privacy.js             vỏ mỏng quanh contact_read + contactStates() cả trang
    core/trust.js               tierOf() — hàm DUY NHẤT ánh xạ số việc → bậc
    core/twoPerson.js           khung pending_actions
    core/crypto.js              AES-256-GCM khóa theo chủ thể
    core/otp/index.js           chọn adapter theo env
    core/otp/console.js         in mã ra log (dev)
    middleware/auth.js          giải JWT → req.actor
    middleware/rbac.js          requireRole(...)
    middleware/validate.js      zod → 400 kèm fields
    middleware/rateLimit.js
    middleware/errorHandler.js  nơi DUY NHẤT gọi logDenied
    modules/auth/{routes,service,schema}.js
    modules/areas/{routes,service,schema}.js
    modules/members/{routes,service,schema}.js
    modules/join-requests/{routes,service,schema}.js
    modules/files/{routes,service,schema}.js
    modules/ops/{routes,service,schema}.js
    openapi/build.js
  tests/
    helpers/db.js               dựng DB sạch, chạy migration
    helpers/actors.js           tạo member + token cho test
    expected-grants.json        NGUỒN SỰ THẬT của ma trận quyền (T10)
    t01…t17*.test.js
web/
  index.html                    chính là index_2.html, chuyển vào đây
  js/api.js                     api.get/post/put/del, token + lỗi tập trung
backup/
  Dockerfile  backup.sh  verify.sh
proxy/Caddyfile
db/init/01-extensions.sql
docs/RANG-BUOC.md
README.md
```

## Thứ tự và hai mốc

Kế hoạch xếp để **luồng gia nhập chạy đầu-cuối sớm nhất có thể**. Lý do: có một đường đi xuyên suốt chạy được thì mọi ràng buộc phía sau đều kiểm chứng được trên nền thật, thay vì kiểm từng mảnh rời.

| Mốc | Ở đâu | Nghĩa là gì |
|---|---|---|
| **MỐC 1 — luồng gia nhập chạy** | hết **Task 9** | `POST /auth/register` → `confirm-met` → `approve` → `GET /members` thấy người mới. Chạy được bằng `curl`. T16 xanh. |
| **MỐC 2 — frontend nối dữ liệu thật** | **Task 11** | `web/js/api.js` xong, ba màn đăng ký / đăng nhập / danh bạ bỏ dữ liệu giả. Đây là lần đầu hai bên chạm nhau — mọi hiểu lầm về hình dạng dữ liệu lộ ra ở đây, không phải ở giai đoạn 4. |

Task 12–20 dựng phần lược đồ còn lại, việc/uy tín, hai người ký, tệp, vận hành, seed, sao lưu, bàn giao — trên một nền đã chứng minh là chạy.

---

## Task 1: Khung Docker + `api` trả lời `/health`

**Files:**
- Create: `.gitignore`, `.env.example`, `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.test.yml`
- Create: `api/Dockerfile`, `api/docker-entrypoint.sh`, `api/package.json`, `api/knexfile.js`
- Create: `api/src/server.js`, `api/src/app.js`, `api/src/config/index.js`, `api/src/db/knex.js`
- Create: `db/init/01-extensions.sql`, `proxy/Caddyfile`
- Test: `api/tests/helpers/db.js`, `api/tests/t00-health.test.js`

**Interfaces:**
- Consumes: (không có — task đầu)
- Produces: `config` object với `{ port, databaseUrl, jwtSecret, encryptionKey, otpPepper, s3, corsOrigin, nodeEnv }`; `knex` instance mặc định export từ `src/db/knex.js`; `buildApp()` trả về Express app từ `src/app.js`.

- [ ] **Step 1: Khởi tạo repo và bộ khung thư mục**

```bash
cd d:/hoinha86
git init
mkdir -p api/src/{config,db/migrations,db/seeds,core,middleware,modules,openapi} api/tests/helpers db/init proxy web/js backup
```

- [ ] **Step 2: Viết `.gitignore` và `.env.example`**

`.gitignore`:
```
.env
node_modules/
backups/
api/node_modules/
*.log
```

`.env.example`:
```
DB_NAME=nhachung
DB_USER=nhachung_owner
DB_PASSWORD=doi-gia-tri-nay
APP_DB_USER=app_role
APP_DB_PASSWORD=doi-gia-tri-nay-nua
JWT_SECRET=doi-thanh-chuoi-ngau-nhien-64-ky-tu
ENCRYPTION_KEY=doi-thanh-32-byte-base64
OTP_PEPPER=doi-thanh-chuoi-ngau-nhien
OTP_ADAPTER=console
S3_ENDPOINT=http://storage:9000
S3_ACCESS_KEY=doi-gia-tri-nay
S3_SECRET_KEY=doi-gia-tri-nay
BACKUP_S3_ACCESS_KEY=khoa-rieng-cua-backup
BACKUP_S3_SECRET_KEY=khoa-rieng-cua-backup
CORS_ORIGIN=https://binhdan1986.com
SITE_DOMAIN=binhdan1986.com
NODE_ENV=production
```

- [ ] **Step 3: Viết `docker-compose.yml`**

Bám đúng mục 1.1–1.3 của spec. Điểm bắt buộc: **`db` không có khóa `ports`**; `api` `depends_on` `db` với `condition: service_healthy`; `proxy` phục vụ tĩnh **và** reverse proxy, không có route nào tới `storage`.

```yaml
name: nhachung
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - db_data:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 10s
      retries: 5
    networks: [nhachung_net]

  api:
    build: ./api
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
      storage: { condition: service_started }
    environment:
      DATABASE_URL: postgres://${APP_DB_USER}:${APP_DB_PASSWORD}@db:5432/${DB_NAME}
      MIGRATION_DATABASE_URL: postgres://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
      APP_DB_USER: ${APP_DB_USER}
      APP_DB_PASSWORD: ${APP_DB_PASSWORD}
      JWT_SECRET: ${JWT_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      OTP_PEPPER: ${OTP_PEPPER}
      OTP_ADAPTER: ${OTP_ADAPTER}
      S3_ENDPOINT: ${S3_ENDPOINT}
      S3_ACCESS_KEY: ${S3_ACCESS_KEY}
      S3_SECRET_KEY: ${S3_SECRET_KEY}
      CORS_ORIGIN: ${CORS_ORIGIN}
      NODE_ENV: ${NODE_ENV}
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/v1/health"]
      interval: 15s
      retries: 5
    networks: [nhachung_net]

  storage:
    image: minio/minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${S3_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${S3_SECRET_KEY}
    volumes: [storage_data:/data]
    networks: [nhachung_net]

  proxy:
    image: caddy:2-alpine
    restart: unless-stopped
    depends_on: [api]
    ports: ["80:80", "443:443"]
    environment:
      SITE_DOMAIN: ${SITE_DOMAIN}
    volumes:
      - ./proxy/Caddyfile:/etc/caddy/Caddyfile:ro
      - ./web:/srv:ro
      - caddy_data:/data
      - caddy_config:/config
    networks: [nhachung_net]

  backup:
    build: ./backup
    restart: unless-stopped
    depends_on: [db, storage]
    environment:
      DATABASE_URL: postgres://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
      S3_ENDPOINT: ${S3_ENDPOINT}
      S3_ACCESS_KEY: ${BACKUP_S3_ACCESS_KEY}
      S3_SECRET_KEY: ${BACKUP_S3_SECRET_KEY}
    volumes: [./backups:/backups]
    networks: [nhachung_net]

volumes: { db_data: , storage_data: , caddy_data: , caddy_config: }
networks: { nhachung_net: }
```

- [ ] **Step 4: Viết `docker-compose.dev.yml` và `docker-compose.test.yml`**

`docker-compose.dev.yml` — chỉ nơi này mở cổng DB:
```yaml
services:
  db:
    ports: ["5432:5432"]
  storage:
    ports: ["9001:9001"]
  api:
    environment:
      NODE_ENV: development
      LOG_LEVEL: debug
```

`docker-compose.test.yml` — stack rời, dữ liệu trong tmpfs nên mỗi lần chạy là sạch:
```yaml
name: nhachung-test
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: nhachung_test
      POSTGRES_USER: nhachung_owner
      POSTGRES_PASSWORD: test
    tmpfs: [/var/lib/postgresql/data]
    ports: ["55432:5432"]
    volumes:
      - ./db/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nhachung_owner -d nhachung_test"]
      interval: 2s
      retries: 30
```

- [ ] **Step 5: Viết `db/init/01-extensions.sql` và `proxy/Caddyfile`**

`db/init/01-extensions.sql` — chỉ những gì phải có trước migration đầu tiên:
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

`proxy/Caddyfile` — **không có route nào tới `storage`**:
```
{$SITE_DOMAIN} {
	encode gzip
	handle /api/v1/* {
		reverse_proxy api:3000
	}
	handle {
		root * /srv
		try_files {path} /index.html
		file_server
	}
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
	}
}
```

- [ ] **Step 6: Viết `api/package.json`**

```json
{
  "name": "nhachung-api",
  "version": "1.0.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/server.js",
    "migrate": "knex migrate:latest",
    "seed": "node src/db/seeds/run.js",
    "test": "vitest run"
  },
  "dependencies": {
    "argon2": "^0.31.2",
    "express": "^4.19.2",
    "jsonwebtoken": "^9.0.2",
    "knex": "^3.1.0",
    "pg": "^8.11.5",
    "pino": "^9.0.0",
    "pino-http": "^10.0.0",
    "sharp": "^0.33.3",
    "uuid": "^9.0.1",
    "zod": "^3.23.0"
  },
  "devDependencies": { "vitest": "^1.6.0", "supertest": "^7.0.0" }
}
```

- [ ] **Step 7: Viết `api/src/config/index.js` — thiếu biến thì chết ngay lúc khởi động**

```js
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  MIGRATION_DATABASE_URL: z.string().min(1),
  APP_DB_USER: z.string().min(1),
  APP_DB_PASSWORD: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(32),
  OTP_PEPPER: z.string().min(16),
  OTP_ADAPTER: z.enum(['console', 'zalo-zns', 'sms']).default('console'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  CORS_ORIGIN: z.string().default('https://binhdan1986.com'),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Chết ngay, không chạy nửa vời với cấu hình thiếu
  console.error('Cấu hình môi trường không hợp lệ:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
```

- [ ] **Step 8: Viết `api/src/db/knex.js` và `api/knexfile.js`**

`api/src/db/knex.js` — pool chạy bằng `app_role`:
```js
import knexLib from 'knex';
import { config } from '../config/index.js';

export const knex = knexLib({
  client: 'pg',
  connection: config.DATABASE_URL,
  pool: { min: 2, max: 10 },
});

export default knex;
```

`api/knexfile.js` — migration chạy bằng **owner**, không phải `app_role`:
```js
export default {
  client: 'pg',
  connection: process.env.MIGRATION_DATABASE_URL,
  migrations: { directory: './src/db/migrations', extension: 'js' },
};
```

- [ ] **Step 9: Viết `api/src/app.js` và `api/src/server.js`**

`api/src/app.js`:
```js
import express from 'express';
import { knex } from './db/knex.js';

export function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/v1/health', async (req, res) => {
    let db = false;
    try { await knex.raw('select 1'); db = true; } catch { db = false; }
    res.status(db ? 200 : 503).json({ ok: db, db, migration: 'applied' });
  });

  return app;
}
```

`api/src/server.js`:
```js
import { buildApp } from './app.js';
import { config } from './config/index.js';

buildApp().listen(config.PORT, () => {
  console.log(`api nghe cổng ${config.PORT}`);
});
```

- [ ] **Step 10: Viết `api/Dockerfile` và `api/docker-entrypoint.sh`**

`api/Dockerfile`:
```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache wget
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
```

`api/docker-entrypoint.sh` — **migrate xong mới listen**:
```sh
#!/bin/sh
set -e
echo "==> chạy migration"
npx knex migrate:latest
echo "==> migration xong, mở cổng phục vụ"
exec node src/server.js
```

`set -e` là toàn bộ điểm mấu chốt: migration hỏng thì script thoát khác 0, container chết, **không bao giờ nhận request với lược đồ cũ**.

- [ ] **Step 11: Viết `api/tests/helpers/db.js`**

```js
import knexLib from 'knex';

const OWNER_URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://nhachung_owner:test@localhost:55432/nhachung_test';

export function ownerKnex() {
  return knexLib({
    client: 'pg',
    connection: OWNER_URL,
    migrations: { directory: new URL('../../src/db/migrations', import.meta.url).pathname },
  });
}

export function appKnex() {
  const url = new URL(OWNER_URL);
  url.username = 'app_role';
  url.password = 'test_app';
  return knexLib({ client: 'pg', connection: url.toString() });
}

export async function resetDb() {
  const db = ownerKnex();
  await db.raw('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await db.migrate.latest();
  return db;
}
```

- [ ] **Step 12: Viết bài test đầu tiên (thất bại)**

`api/tests/t00-health.test.js`:
```js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';

describe('T00 health', () => {
  it('trả 200 và ok=true khi DB sống', async () => {
    const res = await request(buildApp()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
```

- [ ] **Step 13: Chạy test, xác nhận thất bại**

```bash
docker compose -f docker-compose.test.yml up -d
cd api && npm install && npm test
```
Kỳ vọng: FAIL — chưa có migration nào, `select 1` chạy được nhưng chưa có role `app_role`, hoặc kết nối lỗi.

- [ ] **Step 14: Chạy toàn bộ stack và xác nhận test xanh**

```bash
cp .env.example .env   # điền giá trị thật cho môi trường phát triển
docker compose up -d
docker compose logs -f api
curl -s http://localhost/api/v1/health
```
Kỳ vọng: `{"ok":true,"db":true,...}`, và `npm test` xanh.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat: khung Docker Compose 5 dịch vụ + api trả lời /health

- db khong khai bao khoa ports; mo cong nam rieng o file dev
- migration chay xong moi mo cong phuc vu (set -e trong entrypoint)
- Caddy phuc vu tinh va reverse proxy, khong co route nao toi storage"
```

---

## Task 2: Migration 001–003 — extension, hai role, cộng đồng và khu vực

**Files:**
- Create: `api/src/db/migrations/001_extensions.js`
- Create: `api/src/db/migrations/002_roles_grants.js`
- Create: `api/src/db/migrations/003_communities_areas.js`
- Test: `api/tests/t10-grants.test.js`, `api/tests/expected-grants.json`

**Interfaces:**
- Consumes: `ownerKnex()`, `appKnex()`, `resetDb()` từ Task 1.
- Produces: bảng `communities (id, community_id, code, name, config jsonb, created_at, updated_at)`, `areas (id, community_id, name, parent_id, lat, lng, …)`; role `app_role`; hàm SQL `f_unaccent(text)`; và **quy ước migration**: mỗi file export `up(knex)` và `down(knex)`, dùng `knex.raw` với SQL thuần.

- [ ] **Step 1: Viết `001_extensions.js`**

```js
export async function up(knex) {
  await knex.raw(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE EXTENSION IF NOT EXISTS unaccent;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE EXTENSION IF NOT EXISTS cube;
    CREATE EXTENSION IF NOT EXISTS earthdistance;

    -- unaccent() KHÔNG immutable nên không đánh chỉ mục trực tiếp được.
    -- Bọc lại là cách chuẩn. Nếu từ điển unaccent đổi thì phải REINDEX — ghi trong README.
    CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
      AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
  `);
}

export async function down(knex) {
  await knex.raw(`DROP FUNCTION IF EXISTS f_unaccent(text);`);
}
```

- [ ] **Step 2: Viết `002_roles_grants.js`**

```js
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  const pass = process.env.APP_DB_PASSWORD ?? 'test_app';

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ?) THEN
        EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', ?, ?);
      END IF;
    END $$;
  `, [user, user, pass]);

  await knex.raw(`GRANT USAGE ON SCHEMA public TO ??`, [user]);

  // Mọi bảng owner tạo ra từ đây về sau tự động có quyền — không ai phải nhớ viết GRANT.
  // BẪY: cơ chế này cũng cấp UPDATE/DELETE cho phân mảnh audit_log mới.
  // Vì vậy migration 007 tạo hàm fn_audit_new_partition() tự REVOKE, và T10 quét cả phân mảnh.
  await knex.raw(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ??;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO ??;
  `, [user, user]);
}

export async function down(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ??`, [user]);
}
```

- [ ] **Step 3: Viết `003_communities_areas.js`**

```js
export async function up(knex) {
  await knex.raw(`
    CREATE TABLE communities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code text NOT NULL UNIQUE,
      name text NOT NULL,
      config jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE areas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      name text NOT NULL,
      parent_id uuid REFERENCES areas(id),
      lat double precision,
      lng double precision,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (community_id, name)
    );
    CREATE INDEX idx_areas_parent ON areas (community_id, parent_id);
  `);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS areas; DROP TABLE IF EXISTS communities;`);
}
```

- [ ] **Step 4: Viết `api/tests/expected-grants.json` — nguồn sự thật của ma trận quyền**

Bắt đầu với ba bảng đã có; mỗi task sau **bắt buộc** cập nhật file này khi tạo bảng mới.
```json
{
  "communities": ["SELECT", "INSERT", "UPDATE", "DELETE"],
  "areas":       ["SELECT", "INSERT", "UPDATE", "DELETE"]
}
```

- [ ] **Step 5: Viết T10 (thất bại)**

`api/tests/t10-grants.test.js`:
```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resetDb } from './helpers/db.js';

const expected = JSON.parse(readFileSync(new URL('./expected-grants.json', import.meta.url)));
let db;
beforeAll(async () => { db = await resetDb(); });
afterAll(async () => { await db.destroy(); });

describe('T10 ma trận quyền của app_role', () => {
  it('mọi bảng public đều có mặt trong expected-grants.json', async () => {
    const { rows } = await db.raw(`
      SELECT c.relname AS table_name
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
         AND c.relname <> 'knex_migrations' AND c.relname <> 'knex_migrations_lock'
    `);
    const missing = rows.map(r => r.table_name).filter(t => !(t in expected));
    expect(missing, `bảng chưa khai báo quyền: ${missing.join(', ')}`).toEqual([]);
  });

  it('quyền thực tế khớp khai báo — kể cả phân mảnh', async () => {
    for (const [table, want] of Object.entries(expected)) {
      const { rows } = await db.raw(`
        SELECT privilege_type FROM information_schema.table_privileges
         WHERE table_schema = 'public' AND table_name = ? AND grantee = 'app_role'
      `, [table]);
      const got = rows.map(r => r.privilege_type).sort();
      expect(got, `bảng ${table}`).toEqual([...want].sort());
    }
  });
});
```

- [ ] **Step 6: Chạy T10, xác nhận thất bại**

```bash
cd api && npm test -- t10
```
Kỳ vọng: FAIL — chưa có migration nào chạy.

- [ ] **Step 7: Chạy migration và xác nhận T10 xanh**

```bash
cd api && npm test -- t10
```
Kỳ vọng: PASS (`resetDb()` tự chạy `migrate.latest()`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(db): migration 001-003 extension, app_role, communities/areas

- ALTER DEFAULT PRIVILEGES de bang moi tu dong co quyen
- T10 canh ma tran quyen, moi bang moi phai khai bao trong expected-grants.json"
```

---

## Task 3: `core/tx.js`, `core/errors.js`, middleware lỗi

**Files:**
- Create: `api/src/core/tx.js`, `api/src/core/errors.js`
- Create: `api/src/middleware/errorHandler.js`, `api/src/middleware/validate.js`
- Modify: `api/src/app.js`
- Test: `api/tests/t18-tx.test.js`

**Interfaces:**
- Consumes: `knex` từ Task 1.
- Produces:
  - `withActor(actorId, fn)` → chạy `fn(trx)` trong giao dịch đã `SET LOCAL app.actor_id`.
  - `AppError` class: `new AppError(code, message, { status, fields })`.
  - `mapPgError(err)` → `AppError | null`.
  - `errorHandler(err, req, res, next)` — Express error middleware.
  - `validate(schema, source)` → Express middleware, `source ∈ 'body'|'query'|'params'`.

- [ ] **Step 1: Viết `api/src/core/tx.js`**

```js
import { knex } from '../db/knex.js';

/**
 * Đường DUY NHẤT để mở giao dịch. Không gọi knex.transaction() ở nơi khác.
 * SET LOCAL tự hết hiệu lực khi giao dịch đóng nên không rò sang kết nối khác trong pool.
 */
export async function withActor(actorId, fn) {
  return knex.transaction(async (trx) => {
    await trx.raw('SET LOCAL app.actor_id = ?', [actorId ?? '']);
    return fn(trx);
  });
}
```

- [ ] **Step 2: Viết `api/src/core/errors.js`**

```js
export class AppError extends Error {
  constructor(code, message, { status = 400, fields = undefined } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

// Ánh xạ lỗi do trigger/ràng buộc CSDL ném ra. Bảng này là bản sao mục 5.1 của spec.
const BY_MESSAGE = {
  GUARANTEE_QUOTA_EXCEEDED:    [422, 'GUARANTEE_QUOTA_EXCEEDED', 'Người bảo lãnh đã dùng hết số lượt trong 12 tháng gần nhất.'],
  MANUAL_PAIR_QUOTA_EXCEEDED:  [422, 'MANUAL_PAIR_QUOTA_EXCEEDED', 'Hai người đã ghi quá số việc thủ công cho phép trong 12 tháng.'],
  SELF_ONLY:                   [403, 'SELF_ONLY', 'Việc này chỉ chính người đó làm được, không ai điền hộ.'],
  NO_ACTOR:                    [500, 'INTERNAL', 'Lỗi hệ thống.'],
  MEMBER_NEEDS_MET_CONFIRMATION: [422, 'MET_CONFIRMATION_REQUIRED', 'Chưa có xác nhận đã gặp mặt nên chưa thể thành thành viên.'],
  SUMMARY_REQUIRED:            [422, 'SUMMARY_REQUIRED', 'Còn hoạt động dùng quỹ chưa có tổng kết.'],
  FUND_ENTRY_LOCKED:           [409, 'FUND_ENTRY_LOCKED', 'Bút toán đã khóa. Hãy ghi bút toán điều chỉnh mới.'],
  FUND_TWO_APPROVERS_REQUIRED: [422, 'TWO_APPROVERS_REQUIRED', 'Bút toán từ một triệu đồng trở lên cần hai người duyệt.'],
  ENDORSEMENT_NEEDS_TWO_DISTINCT: [422, 'TWO_SIGNERS_REQUIRED', 'Bảo chứng cần đúng hai người khác nhau ký.'],
  PHOTO_CONSENT_INCOMPLETE:    [422, 'PHOTO_CONSENT_INCOMPLETE', 'Còn người có mặt trong ảnh chưa đồng ý.'],
  GUARANTEE_CYCLE:             [422, 'GUARANTEE_CYCLE', 'Sợi bảo lãnh tạo thành vòng tròn.'],
  WORK_RECORD_FROZEN:          [409, 'WORK_RECORD_FROZEN', 'Việc đã có xác nhận nên không sửa được nữa.'],
  REFERRER_FROZEN:             [409, 'REFERRER_FROZEN', 'Sợi bảo lãnh đã thành sự thật lịch sử, không sửa được.'],
  CONTACT_WRITE_DENIED:        [403, 'CONTACT_WRITE_DENIED', 'Bạn không có quyền sửa thông tin liên hệ này.'],
  REFERRER_REQUIRED:           [422, 'REFERRER_REQUIRED', 'Phải có người bảo lãnh.'],
};

export function mapPgError(err) {
  const raw = err?.message ?? '';
  for (const key of Object.keys(BY_MESSAGE)) {
    if (raw.includes(key)) {
      const [status, code, message] = BY_MESSAGE[key];
      return new AppError(code, message, { status });
    }
  }
  if (err?.code === '23505') return new AppError('DUPLICATE', 'Dữ liệu này đã tồn tại.', { status: 409 });
  if (err?.code === '23503') return new AppError('INVALID_REFERENCE', 'Dữ liệu tham chiếu không hợp lệ.', { status: 422 });
  // 42501 = permission denied. Đây là LỖI CỦA CHÚNG TA: một route đã cố làm việc thiết kế cấm.
  if (err?.code === '42501') {
    const e = new AppError('INTERNAL', 'Lỗi hệ thống.', { status: 500 });
    e.operationalAlert = true;
    return e;
  }
  return null;
}
```

- [ ] **Step 3: Viết `api/src/middleware/errorHandler.js` — nơi DUY NHẤT gọi `logDenied`**

`core/audit.js` chưa tồn tại (Task 4), nên bước này để chỗ trống có chủ đích bằng một `import` sẽ được nối ở Task 4. Viết ngay phần ánh xạ:

```js
import { AppError, mapPgError } from '../core/errors.js';
import { isProd } from '../config/index.js';

export function errorHandler(err, req, res, _next) {
  const mapped = err instanceof AppError ? err : (mapPgError(err) ?? null);

  if (!mapped) {
    req.log?.error({ err }, 'lỗi không lường trước');
    return res.status(500).json({
      error: { code: 'INTERNAL', message: 'Lỗi hệ thống.',
               ...(isProd ? {} : { debug: err?.message }) },
    });
  }

  if (mapped.operationalAlert) {
    req.log?.fatal({ err }, 'app_role bị từ chối quyền — route đang cố làm việc thiết kế cấm');
  }

  // Task 4 nối logDenied vào đây cho mọi lỗi 4xx.
  res.status(mapped.status).json({
    error: { code: mapped.code, message: mapped.message, ...(mapped.fields ? { fields: mapped.fields } : {}) },
  });
}
```

- [ ] **Step 4: Viết `api/src/middleware/validate.js`**

```js
import { AppError } from '../core/errors.js';

export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const fields = {};
      for (const issue of result.error.issues) fields[issue.path.join('.')] = issue.message;
      return next(new AppError('VALIDATION_FAILED', 'Dữ liệu gửi lên chưa hợp lệ.', { status: 400, fields }));
    }
    req[source] = result.data;
    next();
  };
}
```

- [ ] **Step 5: Viết test (thất bại)**

`api/tests/t18-tx.test.js`:
```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';
import { withActor } from '../src/core/tx.js';

let db;
beforeAll(async () => { db = await resetDb(); });
afterAll(async () => { await db.destroy(); });

describe('T18 withActor đóng dấu người thực hiện', () => {
  it('đặt app.actor_id trong giao dịch', async () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const got = await withActor(id, async (trx) => {
      const { rows } = await trx.raw(`SELECT current_setting('app.actor_id', true) AS a`);
      return rows[0].a;
    });
    expect(got).toBe(id);
  });

  it('dấu không rò ra ngoài giao dịch', async () => {
    const { knex } = await import('../src/db/knex.js');
    const { rows } = await knex.raw(`SELECT current_setting('app.actor_id', true) AS a`);
    expect(rows[0].a === null || rows[0].a === '').toBe(true);
  });
});
```

- [ ] **Step 6: Chạy test, xác nhận thất bại rồi xanh**

```bash
cd api && npm test -- t18
```
Kỳ vọng: FAIL trước khi có `core/tx.js`, PASS sau.

- [ ] **Step 7: Nối `errorHandler` vào `app.js`**

Trong `buildApp()`, thêm sau mọi route: `app.use(errorHandler);`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): withActor, AppError, anh xa loi PostgreSQL, middleware validate

- withActor la duong DUY NHAT mo giao dich; SET LOCAL khong ro sang ket noi khac
- 42501 permission denied duoc coi la LOI CUA CHUNG TA, canh bao muc fatal"
```

---

## Task 4: `audit_log` phân mảnh, chuỗi băm, `core/audit.js`

**Files:**
- Create: `api/src/db/migrations/007_audit_log.js`
- Create: `api/src/core/audit.js`
- Modify: `api/src/middleware/errorHandler.js`, `api/tests/expected-grants.json`
- Test: `api/tests/t07-audit-chain.test.js`, `api/tests/t11-audit-detail.test.js`

**Interfaces:**
- Consumes: `withActor` (Task 3), `AppError` (Task 3).
- Produces:
  - `audit.log(trx, { communityId, actorId, action, targetType, targetId, detail })`
  - `audit.logDenied({ communityId, actorId, action, targetType, targetId, detail })`
  - `verifyChain(db, { communityId, from, to })` → `{ ok, checked, brokenAt }`
  - Hàm SQL `fn_audit_new_partition(p_month date)`.

> Migration đánh số **007** dù là file thứ tư được viết — thứ tự file theo mục 11 của spec, không theo thứ tự thi công. Các số 004–006 do Task 5 và 6 điền.

- [ ] **Step 1: Viết `007_audit_log.js`**

```js
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`
    CREATE TABLE audit_log (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      seq bigint NOT NULL GENERATED ALWAYS AS IDENTITY,
      community_id uuid NOT NULL REFERENCES communities(id),
      actor_id uuid,
      action text NOT NULL,
      target_type text,
      target_id uuid,
      detail jsonb NOT NULL DEFAULT '{}'::jsonb,
      ip inet,
      at timestamptz NOT NULL DEFAULT clock_timestamp(),
      prev_hash text,
      hash text,
      PRIMARY KEY (id, at)
    ) PARTITION BY RANGE (at);

    CREATE TABLE audit_chain_head (
      community_id uuid PRIMARY KEY REFERENCES communities(id),
      seq bigint, hash text
    );

    CREATE FUNCTION fn_audit_chain() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_prev text;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || NEW.community_id::text, 7));
      SELECT hash INTO v_prev FROM audit_chain_head WHERE community_id = NEW.community_id;
      NEW.prev_hash := coalesce(v_prev, repeat('0', 64));
      NEW.at := coalesce(NEW.at, clock_timestamp());
      NEW.hash := encode(digest(
          NEW.prev_hash || '|' || coalesce(NEW.actor_id::text, '-') || '|' || NEW.action || '|' ||
          coalesce(NEW.target_type, '-') || '|' || coalesce(NEW.target_id::text, '-') || '|' ||
          to_char(NEW.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'sha256'), 'hex');
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_audit_chain BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION fn_audit_chain();

    CREATE FUNCTION fn_audit_head() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      INSERT INTO audit_chain_head (community_id, seq, hash)
      VALUES (NEW.community_id, NEW.seq, NEW.hash)
      ON CONFLICT (community_id) DO UPDATE SET seq = EXCLUDED.seq, hash = EXCLUDED.hash;
      RETURN NULL;
    END $fn$;

    CREATE TRIGGER trg_audit_head AFTER INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION fn_audit_head();
  `);

  // Phân mảnh PHẢI tạo qua hàm này — nó tự thu quyền ngay.
  // Nếu tạo bằng CREATE TABLE tay, ALTER DEFAULT PRIVILEGES sẽ cấp UPDATE/DELETE và đục thủng mục 5.
  await knex.raw(`
    CREATE FUNCTION fn_audit_new_partition(p_month date) RETURNS void
    LANGUAGE plpgsql AS $fn$
    DECLARE v_name text := 'audit_log_' || to_char(p_month, 'YYYY_MM');
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_class WHERE relname = v_name) THEN RETURN; END IF;
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
        v_name, date_trunc('month', p_month), date_trunc('month', p_month) + interval '1 month');
      EXECUTE format('REVOKE ALL ON %I FROM ${user}', v_name);
      EXECUTE format('GRANT SELECT, INSERT ON %I TO ${user}', v_name);
    END $fn$;
  `);

  await knex.raw(`
    SELECT fn_audit_new_partition(date_trunc('month', now())::date);
    SELECT fn_audit_new_partition((date_trunc('month', now()) + interval '1 month')::date);
    REVOKE ALL ON audit_log FROM ??;
    GRANT SELECT, INSERT ON audit_log TO ??;
    GRANT SELECT, INSERT, UPDATE ON audit_chain_head TO ??;
  `, [user, user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS audit_log CASCADE;
    DROP TABLE IF EXISTS audit_chain_head;
    DROP FUNCTION IF EXISTS fn_audit_chain(); DROP FUNCTION IF EXISTS fn_audit_head();
    DROP FUNCTION IF EXISTS fn_audit_new_partition(date);
  `);
}
```

- [ ] **Step 2: Cập nhật `expected-grants.json`**

```json
{
  "communities": ["SELECT", "INSERT", "UPDATE", "DELETE"],
  "areas":       ["SELECT", "INSERT", "UPDATE", "DELETE"],
  "audit_log":   ["SELECT", "INSERT"],
  "audit_chain_head": ["SELECT", "INSERT", "UPDATE"]
}
```

Thêm vào T10 một khối kiểm riêng cho phân mảnh:
```js
it('mọi phân mảnh audit_log cũng chỉ có SELECT, INSERT', async () => {
  const { rows } = await db.raw(`
    SELECT c.relname FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid
     WHERE i.inhparent = 'audit_log'::regclass
  `);
  expect(rows.length).toBeGreaterThan(0);
  for (const { relname } of rows) {
    const { rows: p } = await db.raw(`
      SELECT privilege_type FROM information_schema.table_privileges
       WHERE table_name = ? AND grantee = 'app_role'`, [relname]);
    expect(p.map(x => x.privilege_type).sort(), `phân mảnh ${relname}`)
      .toEqual(['INSERT', 'SELECT']);
  }
});
```

- [ ] **Step 3: Viết `api/src/core/audit.js`**

```js
import { z } from 'zod';
import { withActor } from './tx.js';

// Luật mục 10: detail chỉ chứa định danh, enum, tên trường, số đếm, và định danh giả (HMAC).
// KHÔNG BAO GIỜ chứa giá trị cá nhân thô. Canh lúc chạy, không chỉ bằng lời hứa.
const scalar = z.union([
  z.string().uuid(),
  z.string().regex(/^[a-z0-9_.:-]{1,64}$/),   // enum, field_key, mã lý do
  z.string().regex(/^[0-9a-f]{64}$/),         // định danh giả: HMAC-SHA256 hex
  z.number(), z.boolean(), z.null(),
]);
const detailSchema = z.record(z.union([scalar, z.array(scalar)]));

export function assertSafeDetail(detail) {
  const r = detailSchema.safeParse(detail ?? {});
  if (!r.success) {
    throw new Error(
      'audit.detail chứa giá trị không được phép — nhật ký không bao giờ lưu dữ liệu cá nhân thô. ' +
      JSON.stringify(r.error.issues.map(i => i.path.join('.')))
    );
  }
  return r.data;
}

export async function log(trx, entry) {
  if (!trx || typeof trx.raw !== 'function') {
    throw new Error('audit.log phải chạy trong một giao dịch — gọi qua withActor()');
  }
  const detail = assertSafeDetail(entry.detail);
  await trx.raw(
    `INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail, ip)
     VALUES (?, ?, ?, ?, ?, ?::jsonb, ?)`,
    [entry.communityId, entry.actorId ?? null, entry.action,
     entry.targetType ?? null, entry.targetId ?? null, JSON.stringify(detail), entry.ip ?? null]
  );
}

/**
 * Từ chối phải để lại dấu. Ngoại lệ hủy giao dịch chính, nên dòng nhật ký
 * phải nằm trong một giao dịch RIÊNG mở sau khi giao dịch kia đã rollback.
 */
export async function logDenied(entry) {
  return withActor(entry.actorId, (trx) =>
    log(trx, { ...entry, action: entry.action.endsWith('.denied') ? entry.action : entry.action + '.denied' })
  );
}

export async function verifyChain(db, { communityId, from, to }) {
  const { rows } = await db.raw(
    `SELECT seq, actor_id, action, target_type, target_id, at, prev_hash, hash
       FROM audit_log WHERE community_id = ?
        AND (?::timestamptz IS NULL OR at >= ?) AND (?::timestamptz IS NULL OR at <= ?)
      ORDER BY seq ASC`,
    [communityId, from ?? null, from ?? null, to ?? null, to ?? null]
  );
  let prev = null, checked = 0;
  for (const r of rows) {
    if (prev !== null && r.prev_hash !== prev) return { ok: false, checked, brokenAt: r.seq };
    const { rows: [x] } = await db.raw(
      `SELECT encode(digest(? || '|' || ? || '|' || ? || '|' || ? || '|' || ? || '|' ||
              to_char(?::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),'sha256'),'hex') AS h`,
      [r.prev_hash, r.actor_id ?? '-', r.action, r.target_type ?? '-', r.target_id ?? '-', r.at]
    );
    if (x.h !== r.hash) return { ok: false, checked, brokenAt: r.seq };
    prev = r.hash; checked++;
  }
  return { ok: true, checked, brokenAt: null };
}
```

- [ ] **Step 4: Nối `logDenied` vào `errorHandler`**

Thêm vào `errorHandler`, ngay trước `res.status(...)`:
```js
if (mapped.status >= 400 && mapped.status < 500 && req.actor?.communityId) {
  logDenied({
    communityId: req.actor.communityId,
    actorId: req.actor.id,
    action: `${req.method.toLowerCase()}:${req.route?.path ?? req.path}`.slice(0, 64),
    detail: { code: mapped.code },
  }).catch((e) => req.log?.error({ e }, 'không ghi được nhật ký từ chối'));
}
```

- [ ] **Step 5: Viết T7 và T11 (thất bại)**

`api/tests/t07-audit-chain.test.js`:
```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';
import { verifyChain } from '../src/core/audit.js';

let db, cid;
beforeAll(async () => {
  db = await resetDb();
  const { rows } = await db.raw(
    `INSERT INTO communities (code, name) VALUES ('community-001','X') RETURNING id`);
  cid = rows[0].id;
  for (let i = 0; i < 5; i++) {
    await db.raw(`INSERT INTO audit_log (community_id, action) VALUES (?, ?)`, [cid, `test.a${i}`]);
  }
});
afterAll(async () => { await db.destroy(); });

describe('T7 chuỗi băm', () => {
  it('chuỗi liên mạch khi chưa ai đụng vào', async () => {
    const r = await verifyChain(db, { communityId: cid });
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(5);
  });

  it('sửa một dòng giữa chuỗi thì phát hiện được', async () => {
    // Dùng vai OWNER — app_role vốn không sửa nổi, dùng nó thì test xanh giả.
    const { rows } = await db.raw(
      `SELECT seq FROM audit_log WHERE community_id = ? ORDER BY seq OFFSET 2 LIMIT 1`, [cid]);
    const seq = rows[0].seq;
    await db.raw(`UPDATE audit_log SET action = 'da-bi-sua' WHERE seq = ?`, [seq]);
    const r = await verifyChain(db, { communityId: cid });
    expect(r.ok).toBe(false);
    expect(String(r.brokenAt)).toBe(String(seq));
  });
});
```

`api/tests/t11-audit-detail.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { assertSafeDetail } from '../src/core/audit.js';

describe('T11 detail không chứa dữ liệu cá nhân', () => {
  it('chấp nhận tên trường, uuid, số đếm, HMAC', () => {
    expect(() => assertSafeDetail({
      field: 'phone', count: 20, ok: true,
      target: '11111111-1111-1111-1111-111111111111',
      phone_hash: 'a'.repeat(64),
    })).not.toThrow();
  });

  it('từ chối số điện thoại thô', () => {
    expect(() => assertSafeDetail({ phone: '0912 345 678' })).toThrow(/dữ liệu cá nhân/);
  });

  it('từ chối câu văn tự do', () => {
    expect(() => assertSafeDetail({ note: 'Anh Hùng ở Khoái Châu, gọi số 09...' }))
      .toThrow(/dữ liệu cá nhân/);
  });
});
```

- [ ] **Step 6: Chạy T7, T10, T11**

```bash
cd api && npm test -- t07 t10 t11
```
Kỳ vọng: FAIL trước khi có migration 007 + `core/audit.js`, PASS sau.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(audit): audit_log phan manh + chuoi bam trong CSDL + core/audit.js

- hash tinh bang trigger, ung dung khong co co hoi tinh sai
- fn_audit_new_partition tu REVOKE — bit bay ALTER DEFAULT PRIVILEGES o migration 002
- assertSafeDetail canh luat muc 10 luc chay, khong chi bang loi hua
- T7 dung vai owner de sua: dung app_role thi test xanh gia"
```

---

## Task 5: `members` + `member_contacts` + `REVOKE ALL`

**Files:**
- Create: `api/src/db/migrations/004_members.js`, `api/src/db/migrations/005_member_contacts.js`
- Modify: `api/tests/expected-grants.json`
- Test: `api/tests/t03-no-phone-in-members.test.js`

**Interfaces:**
- Consumes: migration 003 (`communities`, `areas`).
- Produces: bảng `members` với `CONSTRAINT members_id_cid UNIQUE (id, community_id)`; bảng `member_contacts` mà `app_role` **không có quyền nào**.

- [ ] **Step 1: Viết `004_members.js`**

```js
export async function up(knex) {
  await knex.raw(`
    CREATE TABLE members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      full_name text NOT NULL,
      birth_year int,
      email text,
      job text,
      area_id uuid REFERENCES areas(id),
      bio text,
      avatar_url text,
      cover_url text,
      status text NOT NULL DEFAULT 'guest' CHECK (status IN ('guest','member','left')),
      work_status text NOT NULL DEFAULT 'available'
        CHECK (work_status IN ('available','by_appointment','paused')),
      joined_at timestamptz,
      referrer_id uuid REFERENCES members(id),
      password_hash text,
      erased_at timestamptz,
      lat double precision, lng double precision,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT members_id_cid UNIQUE (id, community_id),
      CONSTRAINT members_not_self_referrer CHECK (referrer_id IS DISTINCT FROM id)
    );
    CREATE INDEX idx_members_directory ON members (community_id, status, area_id, job);
    CREATE INDEX idx_members_referrer ON members (referrer_id);
    CREATE UNIQUE INDEX idx_members_email ON members (community_id, lower(email)) WHERE email IS NOT NULL;
  `);
}

export async function down(knex) { await knex.raw(`DROP TABLE IF EXISTS members CASCADE;`); }
```

Chú ý: **không có cột `phone`**. Đó là điểm mấu chốt của T3.

- [ ] **Step 2: Viết `005_member_contacts.js`**

```js
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`
    CREATE TABLE member_contacts (
      member_id uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      community_id uuid NOT NULL REFERENCES communities(id),
      phone text, zalo text, messenger text, address text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX idx_contacts_phone ON member_contacts (community_id, phone) WHERE phone IS NOT NULL;
  `);
  // Kể cả SELECT. Đường duy nhất vào là contact_read / contact_upsert (migration 006, 012).
  await knex.raw(`REVOKE ALL ON member_contacts FROM ??`, [user]);
}

export async function down(knex) { await knex.raw(`DROP TABLE IF EXISTS member_contacts;`); }
```

- [ ] **Step 3: Cập nhật `expected-grants.json`**

```json
"members": ["SELECT", "INSERT", "UPDATE", "DELETE"],
"member_contacts": []
```

- [ ] **Step 4: Viết T3 (thất bại)**

`api/tests/t03-no-phone-in-members.test.js`:
```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, appKnex } from './helpers/db.js';

let db, app;
beforeAll(async () => { db = await resetDb(); app = appKnex(); });
afterAll(async () => { await db.destroy(); await app.destroy(); });

describe('T3 số điện thoại không nằm trong members', () => {
  it('bảng members không có cột liên hệ nào', async () => {
    const { rows } = await db.raw(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'members'`);
    const cols = rows.map(r => r.column_name);
    for (const forbidden of ['phone', 'zalo', 'messenger', 'address']) {
      expect(cols, `members không được có cột ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('app_role không SELECT được member_contacts', async () => {
    await expect(app.raw('SELECT * FROM member_contacts')).rejects.toThrow(/permission denied/i);
  });

  it('app_role không INSERT được member_contacts', async () => {
    await expect(
      app.raw(`INSERT INTO member_contacts (member_id, community_id) VALUES (gen_random_uuid(), gen_random_uuid())`)
    ).rejects.toThrow(/permission denied/i);
  });
});
```

- [ ] **Step 5: Chạy T3, xác nhận thất bại rồi xanh**

```bash
cd api && npm test -- t03 t10
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): members khong co cot lien he; member_contacts REVOKE ALL

Mot route viet au SELECT * FROM members khong the lam lo so dien thoai,
vi trong bang do khong co so dien thoai."
```

---

## Task 6: Quyền riêng tư — `privacy_settings`, `contact_requests`, `contact_read`

**Files:**
- Create: `api/src/db/migrations/006_privacy.js`
- Create: `api/src/core/privacy.js`
- Modify: `api/tests/expected-grants.json`
- Test: `api/tests/t04-denied-still-logged.test.js`

**Interfaces:**
- Consumes: migration 004, 005, 007.
- Produces:
  - Kiểu SQL `contact_result (allowed boolean, value text, reason text)`
  - Hàm `contact_read(p_target uuid, p_field text) RETURNS contact_result`
  - `privacy.readContact(trx, targetId, field)` → `{ allowed, value, reason }`
  - `privacy.contactStates(trx, viewerId, targetIds)` → `Map<memberId, { [field]: { level, state, request_id } }>`
  - `privacy.envelope(states, memberId)` → object `contacts` đúng hình dạng mục 5.2 của spec.

- [ ] **Step 1: Viết `006_privacy.js` — bảng**

```js
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`
    CREATE TABLE privacy_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      field_key text NOT NULL CHECK (field_key IN
        ('phone','zalo','messenger','address','job','area','price','family')),
      level text NOT NULL CHECK (level IN ('public','on_consent','closed')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (member_id, field_key)
    );
    CREATE INDEX idx_privacy_lookup ON privacy_settings (member_id, field_key);

    CREATE TABLE contact_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      requester_id uuid NOT NULL REFERENCES members(id),
      target_id uuid NOT NULL REFERENCES members(id),
      field_key text NOT NULL,
      message text,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
      decided_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT cr_not_self CHECK (requester_id <> target_id),
      UNIQUE (requester_id, target_id, field_key)
    );
    CREATE INDEX idx_cr_lookup ON contact_requests (requester_id, target_id, field_key);

    CREATE TABLE profile_views (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      viewer_id uuid NOT NULL REFERENCES members(id),
      target_id uuid NOT NULL REFERENCES members(id),
      what text NOT NULL,
      viewed_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_pv_target ON profile_views (target_id, viewed_at DESC);
  `);

  // profile_views: người xem KHÔNG được xóa dấu vết mình đã xem.
  await knex.raw(`REVOKE UPDATE, DELETE ON profile_views FROM ??`, [user]);
  await knex.raw(`REVOKE DELETE ON contact_requests FROM ??`, [user]);
}
```

- [ ] **Step 2: Viết `contact_read` trong cùng migration**

Sao chép **nguyên văn** khối SQL của `contact_result` + `contact_read` ở **mục 4.2 và phần sửa A2 của spec**. Điểm sống còn: nhánh không đủ quyền **trả về `allowed=false`, không `RAISE`** — nếu `RAISE`, ngoại lệ hủy giao dịch và xóa luôn dòng `contact.denied` vừa ghi.

Vì `introductions` và `job_needs` chưa tồn tại ở giai đoạn này, viết phiên bản đầu **không có** nhánh đó, và migration 015 (Task 13) sẽ `CREATE OR REPLACE` để thêm vào:

```js
await knex.raw(`
  CREATE TYPE contact_result AS (allowed boolean, value text, reason text);

  CREATE FUNCTION contact_read(p_target uuid, p_field text) RETURNS contact_result
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
  DECLARE
    v_viewer uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
    v_level text; v_ok boolean := false; v_reason text; v_cid uuid;
    v_out contact_result;
  BEGIN
    IF v_viewer IS NULL THEN RAISE EXCEPTION 'NO_ACTOR'; END IF;
    IF p_field NOT IN ('phone','zalo','messenger','address') THEN
      RAISE EXCEPTION 'BAD_FIELD'; END IF;
    SELECT community_id INTO v_cid FROM members WHERE id = p_target;
    IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_TARGET'; END IF;

    SELECT level INTO v_level FROM privacy_settings
     WHERE member_id = p_target AND field_key = p_field;
    v_level := coalesce(v_level, 'closed');

    IF    v_viewer = p_target THEN v_ok := true;
    ELSIF v_level = 'public'  THEN v_ok := true;
    ELSIF v_level = 'on_consent' THEN
      v_ok := EXISTS (SELECT 1 FROM contact_requests
                       WHERE requester_id = v_viewer AND target_id = p_target
                         AND field_key = p_field AND status = 'approved');
      IF NOT v_ok THEN v_reason := 'NEEDS_CONSENT'; END IF;
    ELSE  v_reason := 'CLOSED';
    END IF;

    IF v_ok THEN
      EXECUTE format('SELECT %I FROM member_contacts WHERE member_id = $1', p_field)
        INTO v_out.value USING p_target;
      v_out.allowed := true;
    ELSE
      v_out.allowed := false; v_out.reason := v_reason;   -- KHÔNG RAISE
    END IF;

    INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
    VALUES (v_cid, v_viewer,
            CASE WHEN v_ok THEN 'contact.read' ELSE 'contact.denied' END,
            'member', p_target,
            jsonb_build_object('field', p_field, 'reason', coalesce(v_reason, 'ok')));
    RETURN v_out;
  END $fn$;
`);
await knex.raw(`GRANT EXECUTE ON FUNCTION contact_read(uuid, text) TO ??`, [user]);
```

- [ ] **Step 3: Viết `api/src/core/privacy.js`**

```js
const FIELDS = ['phone', 'zalo', 'messenger', 'address'];

export async function readContact(trx, targetId, field) {
  const { rows } = await trx.raw('SELECT * FROM contact_read(?, ?)', [targetId, field]);
  return rows[0];
}

/**
 * MỘT truy vấn cho cả trang. Danh sách không bao giờ gọi contact_read,
 * nên bài toán N+1 không tồn tại — xem mục 6 của spec.
 */
export async function contactStates(trx, viewerId, targetIds) {
  if (targetIds.length === 0) return new Map();
  const { rows } = await trx.raw(
    `SELECT ps.member_id, ps.field_key, ps.level,
            cr.id AS request_id, cr.status AS request_status
       FROM privacy_settings ps
       LEFT JOIN contact_requests cr
         ON cr.target_id = ps.member_id AND cr.field_key = ps.field_key
        AND cr.requester_id = ?
      WHERE ps.member_id = ANY(?) AND ps.field_key = ANY(?)`,
    [viewerId, targetIds, FIELDS]
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.member_id)) map.set(r.member_id, {});
    map.get(r.member_id)[r.field_key] = {
      level: r.level, requestId: r.request_id, requestStatus: r.request_status,
    };
  }
  return map;
}

export function envelope(stateForMember, { viewerId, targetId }) {
  const out = {};
  for (const field of FIELDS) {
    const s = stateForMember?.[field] ?? { level: 'closed' };
    let state;
    if (viewerId === targetId) state = 'self';
    else if (s.level === 'public') state = 'visible';
    else if (s.level === 'closed') state = 'closed';
    else if (s.requestStatus === 'approved') state = 'visible';
    else if (s.requestStatus === 'pending') state = 'requested';
    else if (s.requestStatus === 'denied') state = 'denied';
    else state = 'can_request';
    // value LUÔN null trong danh sách. Giá trị thật chỉ ra ở GET /members/:id/contacts/:field.
    out[field] = { value: null, level: s.level, state, request_id: s.requestId ?? null };
  }
  return out;
}
```

- [ ] **Step 4: Cập nhật `expected-grants.json`**

```json
"privacy_settings": ["SELECT", "INSERT", "UPDATE", "DELETE"],
"contact_requests": ["SELECT", "INSERT", "UPDATE"],
"profile_views":    ["SELECT", "INSERT"]
```

- [ ] **Step 5: Viết T4 (thất bại)**

`api/tests/t04-denied-still-logged.test.js`:
```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';
import { withActor } from '../src/core/tx.js';
import { readContact } from '../src/core/privacy.js';

let db, cid, alice, bob;
beforeAll(async () => {
  db = await resetDb();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-001','X') RETURNING id`));
  ({ rows: [{ id: alice }] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice','member') RETURNING id`, [cid]));
  ({ rows: [{ id: bob }] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Bob','member') RETURNING id`, [cid]));
  await db.raw(`INSERT INTO member_contacts (member_id, community_id, phone) VALUES (?,?,'0912000000')`, [bob, cid]);
  await db.raw(`INSERT INTO privacy_settings (community_id, member_id, field_key, level)
                VALUES (?,?, 'phone','closed')`, [cid, bob]);
});
afterAll(async () => { await db.destroy(); });

describe('T4 lượt đọc bị từ chối vẫn để lại dấu', () => {
  it('trả allowed=false và ghi contact.denied', async () => {
    const r = await withActor(alice, (trx) => readContact(trx, bob, 'phone'));
    expect(r.allowed).toBe(false);
    expect(r.value).toBeNull();
    expect(r.reason).toBe('CLOSED');

    // Giao dịch đã commit — dòng nhật ký PHẢI còn.
    const { rows } = await db.raw(
      `SELECT action, detail FROM audit_log WHERE actor_id = ? AND target_id = ?`, [alice, bob]);
    expect(rows.map(x => x.action)).toContain('contact.denied');
    expect(rows[0].detail.phone).toBeUndefined();   // không ghi giá trị
  });
});
```

- [ ] **Step 6: Chạy T4 và T10, xác nhận thất bại rồi xanh**

```bash
cd api && npm test -- t04 t10
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(privacy): contact_read tra trang thai thay vi nem loi + core/privacy.js

Nem loi o nhanh tu choi se huy ca dong nhat ky vua ghi —
hanh vi can nhin thay nhat lai la hanh vi khong luu duoc."
```

---

## Task 7: Xác thực — OTP có chặn dò, mật khẩu, JWT

**Files:**
- Create: `api/src/db/migrations/008_auth.js`
- Create: `api/src/core/otp/index.js`, `api/src/core/otp/console.js`
- Create: `api/src/middleware/auth.js`, `api/src/middleware/rbac.js`, `api/src/middleware/rateLimit.js`
- Create: `api/src/modules/auth/{routes,service,schema}.js`
- Modify: `api/src/app.js`, `api/tests/expected-grants.json`
- Test: `api/tests/t17-otp.test.js`

**Interfaces:**
- Consumes: `withActor`, `audit.log`, `AppError`, `validate`.
- Produces:
  - `requireAuth` middleware → đặt `req.actor = { id, communityId, roles: string[] }`
  - `requireRole(...keys)` middleware
  - `authService.login({ identifier, password, ip })` → `{ access, refresh, member }`
  - `authService.requestOtp({ phone, purpose })` → `void`
  - `authService.verifyOtp({ phone, code, purpose })` → `{ otpToken }`
  - `hashPhone(phone)` → hex 64 ký tự (HMAC-SHA256 với `OTP_PEPPER`)

- [ ] **Step 1: Viết `008_auth.js`**

```js
export async function up(knex) {
  await knex.raw(`
    CREATE TABLE refresh_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      family_id uuid NOT NULL,
      issued_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      replaced_by uuid REFERENCES refresh_tokens(id)
    );
    CREATE INDEX idx_rt_member ON refresh_tokens (member_id) WHERE revoked_at IS NULL;

    CREATE TABLE otp_challenges (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      phone_hash text NOT NULL,
      code_hash text NOT NULL,
      purpose text NOT NULL CHECK (purpose IN ('register','reset')),
      attempts int NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','used','burned','expired')),
      expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_otp_phone ON otp_challenges (phone_hash, created_at DESC);
  `);
}
```

- [ ] **Step 2: Viết `api/src/core/otp/console.js` và `index.js`**

```js
// console.js — adapter phát triển. In mã ra log, không gửi đi đâu.
export const consoleAdapter = {
  name: 'console',
  async send({ phone, code, purpose }) {
    console.log(`[OTP:${purpose}] ${phone} -> ${code}`);
  },
};
```

```js
// index.js
import { config } from '../../config/index.js';
import { consoleAdapter } from './console.js';

const adapters = { console: consoleAdapter };

export function otpAdapter() {
  const a = adapters[config.OTP_ADAPTER];
  if (!a) throw new Error(`Chưa cài adapter OTP "${config.OTP_ADAPTER}"`);
  return a;
}
```

- [ ] **Step 3: Viết `api/src/modules/auth/service.js` — phần OTP**

```js
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { config } from '../../config/index.js';
import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { otpAdapter } from '../../core/otp/index.js';

export function hashPhone(phone) {
  return crypto.createHmac('sha256', config.OTP_PEPPER).update(phone).digest('hex');
}

function newCode() {
  // crypto.randomInt, KHÔNG PHẢI Math.random
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

const MAX_ATTEMPTS = 5;
const LOCK_AFTER_BURNED = 3;

export async function requestOtp({ communityId, phone, purpose }) {
  const phoneHash = hashPhone(phone);
  return withActor(null, async (trx) => {
    // 3 challenge hỏng liên tiếp trong 1 giờ ⇒ khóa số này 15 phút
    const { rows: [lock] } = await trx.raw(
      `SELECT count(*)::int AS n FROM (
         SELECT status FROM otp_challenges
          WHERE phone_hash = ? AND created_at > now() - interval '1 hour'
          ORDER BY created_at DESC LIMIT ?) t
        WHERE status IN ('burned','expired')`, [phoneHash, LOCK_AFTER_BURNED]);
    if (lock.n >= LOCK_AFTER_BURNED) {
      const { rows: [last] } = await trx.raw(
        `SELECT created_at FROM otp_challenges WHERE phone_hash = ? ORDER BY created_at DESC LIMIT 1`,
        [phoneHash]);
      if (last && Date.now() - new Date(last.created_at).getTime() < 15 * 60_000) {
        throw new AppError('OTP_LOCKED', 'Số này tạm khóa 15 phút do nhập sai nhiều lần.', { status: 429 });
      }
    }
    await trx.raw(`UPDATE otp_challenges SET status='expired'
                    WHERE phone_hash = ? AND status='open'`, [phoneHash]);
    const code = newCode();
    await trx.raw(
      `INSERT INTO otp_challenges (community_id, phone_hash, code_hash, purpose)
       VALUES (?, ?, ?, ?)`,
      [communityId, phoneHash, await argon2.hash(code), purpose]);
    await otpAdapter().send({ phone, code, purpose });
  });
}

export async function verifyOtp({ communityId, phone, code, purpose }) {
  const phoneHash = hashPhone(phone);
  return withActor(null, async (trx) => {
    const { rows: [ch] } = await trx.raw(
      `SELECT * FROM otp_challenges
        WHERE phone_hash = ? AND purpose = ? AND status = 'open' AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [phoneHash, purpose]);

    const fail = async (reason) => {
      await trx.raw(
        `INSERT INTO audit_log (community_id, action, detail)
         VALUES (?, 'otp.failed', jsonb_build_object('phone_hash', ?::text, 'reason', ?::text))`,
        [communityId, phoneHash, reason]);
      throw new AppError('OTP_INVALID', 'Mã xác minh không đúng hoặc đã hết hạn.', { status: 400 });
    };

    if (!ch) return fail('no_open_challenge');

    if (!(await argon2.verify(ch.code_hash, code))) {
      const attempts = ch.attempts + 1;
      await trx.raw(
        `UPDATE otp_challenges SET attempts = ?, status = ? WHERE id = ?`,
        [attempts, attempts >= MAX_ATTEMPTS ? 'burned' : 'open', ch.id]);
      return fail(attempts >= MAX_ATTEMPTS ? 'burned' : 'wrong_code');
    }

    await trx.raw(`UPDATE otp_challenges SET status='used' WHERE id = ?`, [ch.id]);
    const otpToken = jwtSignOtp({ phoneHash, purpose });
    return { otpToken };
  });
}
```

`jwtSignOtp` ký JWT hạn 5 phút với payload `{ ph: phoneHash, purpose, typ: 'otp' }` bằng `config.JWT_SECRET`.

- [ ] **Step 4: Viết phần `login` — chống dò danh sách thành viên**

```js
// Băm giả cố định: khi không tìm thấy người, vẫn tốn đúng chừng ấy thời gian.
// Bỏ bước này thì thời gian phản hồi tự nó tiết lộ số nào đã là thành viên.
const DUMMY_HASH = await argon2.hash('khong-bao-gio-trung-khop');

export async function login({ communityId, identifier, password, ip }) {
  return withActor(null, async (trx) => {
    const { rows: [m] } = await trx.raw(
      `SELECT m.id, m.community_id, m.password_hash, m.status, m.full_name
         FROM members m
         LEFT JOIN member_contacts c ON c.member_id = m.id
        WHERE m.community_id = ? AND (lower(m.email) = lower(?) OR c.phone = ?)
        LIMIT 1`, [communityId, identifier, identifier]);

    const ok = await argon2.verify(m?.password_hash ?? DUMMY_HASH, password).catch(() => false);

    if (!m || !ok || m.status !== 'member') {
      await trx.raw(
        `INSERT INTO audit_log (community_id, action, detail)
         VALUES (?, 'auth.login.denied', jsonb_build_object('identifier_hash', ?::text))`,
        [communityId, hashPhone(identifier)]);
      // MỘT thông báo duy nhất cho mọi nguyên nhân
      throw new AppError('INVALID_CREDENTIALS', 'Số điện thoại/email hoặc mật khẩu không đúng.', { status: 401 });
    }
    return issueTokens(trx, m, ip);
  });
}
```

Lưu ý: `member_contacts` bị `REVOKE ALL` nên câu `LEFT JOIN` trên **sẽ hỏng**. Đây là chỗ phải dùng một hàm `SECURITY DEFINER` hẹp:

```sql
CREATE FUNCTION auth_lookup(p_community uuid, p_identifier text)
RETURNS TABLE (id uuid, community_id uuid, password_hash text, status text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.community_id, m.password_hash, m.status
    FROM members m LEFT JOIN member_contacts c ON c.member_id = m.id
   WHERE m.community_id = p_community
     AND (lower(m.email) = lower(p_identifier) OR c.phone = p_identifier)
   LIMIT 1;
$$;
```
Thêm hàm này vào migration 008 và gọi `SELECT * FROM auth_lookup(?, ?)` trong `login`. Nó không trả về số điện thoại, chỉ trả về đủ thứ để xác thực.

- [ ] **Step 5: Viết `middleware/auth.js` và `middleware/rbac.js`**

```js
// auth.js
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { AppError } from '../core/errors.js';
import { knex } from '../db/knex.js';

export async function requireAuth(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError('UNAUTHENTICATED', 'Cần đăng nhập.', { status: 401 }));
  try {
    const p = jwt.verify(token, config.JWT_SECRET);
    if (p.typ !== 'access') throw new Error('sai loại token');
    const { rows } = await knex.raw(
      `SELECT r.key FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.member_id = ?`,
      [p.sub]);
    req.actor = { id: p.sub, communityId: p.cid, roles: rows.map(r => r.key) };
    next();
  } catch {
    next(new AppError('UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ.', { status: 401 }));
  }
}
```

```js
// rbac.js
import { AppError } from '../core/errors.js';
export function requireRole(...keys) {
  return (req, _res, next) =>
    req.actor?.roles?.some(r => keys.includes(r))
      ? next()
      : next(new AppError('FORBIDDEN', 'Bạn không có quyền làm việc này.', { status: 403 }));
}
```

`member_roles` và `roles` chưa tồn tại tới Task 16 — tạo hai bảng đó **ngay trong migration 008** (chỉ bảng + hạt giống 5 vai), phần `permissions` để Task 16.

- [ ] **Step 6: Viết `middleware/rateLimit.js`**

Bộ đếm trong bộ nhớ, khóa theo `ip + route`. Một tiến trình `api` nên đủ ở quy mô này; ghi chú trong mã là nếu nhân bản `api` thì phải chuyển sang bộ đếm dùng chung.

```js
const buckets = new Map();
export function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  return (req, res, next) => {
    const k = `${req.baseUrl}${req.path}:${key(req)}`;
    const now = Date.now();
    const b = buckets.get(k) ?? { count: 0, reset: now + windowMs };
    if (now > b.reset) { b.count = 0; b.reset = now + windowMs; }
    b.count++; buckets.set(k, b);
    if (b.count > max) {
      res.set('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Bạn thao tác quá nhanh, thử lại sau ít phút.' } });
    }
    next();
  };
}
```

- [ ] **Step 7: Viết `schema.js` và `routes.js` cho `auth`**

```js
// schema.js
import { z } from 'zod';
export const vnPhone = z.string().trim().regex(/^0\d{9}$/, 'Số điện thoại phải có 10 chữ số, bắt đầu bằng 0');
export const otpRequestSchema = z.object({ phone: vnPhone, purpose: z.enum(['register','reset']) });
export const otpVerifySchema  = z.object({ phone: vnPhone, code: z.string().regex(/^\d{6}$/), purpose: z.enum(['register','reset']) });
export const loginSchema      = z.object({ identifier: z.string().trim().min(3), password: z.string().min(8) });
```

`routes.js` gắn `rateLimit({ windowMs: 60_000, max: 5 })` cho hai route OTP, `max: 60` cho phần còn lại.

- [ ] **Step 8: Viết T17 (thất bại)**

```js
// api/tests/t17-otp.test.js — rút gọn phần dựng dữ liệu
describe('T17 OTP hết đường dò', () => {
  it('sai 5 lần thì challenge bị burned', async () => {
    await requestOtp({ communityId: cid, phone: '0912345678', purpose: 'reset' });
    for (let i = 0; i < 5; i++) {
      await expect(verifyOtp({ communityId: cid, phone: '0912345678', code: '000000', purpose: 'reset' }))
        .rejects.toThrow();
    }
    const { rows } = await db.raw(`SELECT status, attempts FROM otp_challenges ORDER BY created_at DESC LIMIT 1`);
    expect(rows[0].status).toBe('burned');
    expect(rows[0].attempts).toBe(5);
  });

  it('nhật ký ghi phone_hash, không ghi số và không ghi mã', async () => {
    const { rows } = await db.raw(`SELECT detail FROM audit_log WHERE action = 'otp.failed'`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(JSON.stringify(r.detail)).not.toContain('0912345678');
      expect(r.detail.phone_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('login trả cùng một lỗi cho số lạ và mật khẩu sai', async () => {
    const a = await login({ communityId: cid, identifier: '0900000000', password: 'saihet123' }).catch(e => e);
    const b = await login({ communityId: cid, identifier: '0912345678', password: 'saihet123' }).catch(e => e);
    expect(a.code).toBe(b.code);
    expect(a.message).toBe(b.message);
  });
});
```

- [ ] **Step 9: Chạy T17, xác nhận thất bại rồi xanh**

```bash
cd api && npm test -- t17
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(auth): OTP co chan do + dang nhap mat khau + JWT xoay vong refresh

- crypto.randomInt chu khong phai Math.random
- 5 lan sai burn challenge; 3 challenge hong khoa so 15 phut
- login so khop voi bam gia khi khong tim thay nguoi, tranh ro ri qua thoi gian
- auth_lookup la ham SECURITY DEFINER hep, khong tra ve so dien thoai"
```

---

## Task 8: Gia nhập — `join_requests`, hạn mức bảo lãnh, cổng `met_confirmed`

**Files:**
- Create: `api/src/db/migrations/009_join_requests.js`, `api/src/db/migrations/010_member_status_gate.js`
- Create: `api/src/modules/join-requests/{routes,service,schema}.js`
- Modify: `api/tests/expected-grants.json`
- Test: `api/tests/t06-guarantee-quota.test.js`

**Interfaces:**
- Consumes: `withActor`, `audit.log`, `requireAuth`, `requireRole`.
- Produces: `joinService.create(...)`, `.confirmMet(...)`, `.approve(...)`, `.reject(...)`; hàm SQL `fn_guarantee_quota`, `fn_referrer_frozen`, trigger `MEMBER_NEEDS_MET_CONFIRMATION`.

- [ ] **Step 1: Viết `009_join_requests.js` — bảng và hạn mức**

```js
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`
    CREATE TABLE join_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      applicant_data jsonb NOT NULL,
      referrer_id uuid REFERENCES members(id),
      member_id uuid REFERENCES members(id),
      step int NOT NULL DEFAULT 1 CHECK (step BETWEEN 1 AND 5),
      status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','pending','met_confirmed','approved','rejected')),
      met_confirmed_at timestamptz,
      met_confirmed_by uuid REFERENCES members(id),
      approved_by uuid REFERENCES members(id),
      reject_reason_code text CHECK (reject_reason_code IN
        ('not_ready','no_meeting','referrer_misrepresented','other')),
      note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_jr_quota ON join_requests (referrer_id, created_at)
      WHERE status IN ('pending','met_confirmed','approved');

    CREATE TABLE guarantee_quota_overrides (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      referrer_id uuid NOT NULL REFERENCES members(id),
      extra_slots int NOT NULL CHECK (extra_slots BETWEEN 1 AND 3),
      reason text NOT NULL,
      granted_by uuid NOT NULL REFERENCES members(id),
      valid_until timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  // Nới lỏng tự hết hạn bằng valid_until, không sửa lại được sau khi cấp.
  await knex.raw(`REVOKE UPDATE, DELETE ON guarantee_quota_overrides FROM ??`, [user]);
  await knex.raw(`REVOKE DELETE ON join_requests FROM ??`, [user]);
}
```

**Năm chỗ sai trong khối DDL trên, đã sửa khi thi công** — bản chạy thật là
`api/src/db/migrations/009_join_requests.js`, khối trên chỉ còn giá trị lịch sử:

1. **`referrer_id uuid REFERENCES members(id)` là khóa ngoại đơn cột.** Đơn của cộng đồng B
   trỏ được người bảo lãnh sang thành viên của cộng đồng A, và hạn mức của A bị chi tiêu bằng
   `config` của B. Dùng khóa ghép `(referrer_id, community_id)` — migration 004 đã để sẵn
   `UNIQUE members_id_cid` cho đúng việc này. Áp cho cả `member_id` và
   `guarantee_quota_overrides.referrer_id`. (Đã kiểm chứng: đổi về đơn cột ⇒ bài test đỏ.)
2. **Không có cột chứa `met_on`.** `POST /confirm-met` nhận `{ met_on, note }`, nhưng DDL chỉ
   có `met_confirmed_at` — *lúc lời khai được ghi*, khác hẳn *ngày hai người thật sự gặp nhau*.
   Thêm `met_on date`.
3. **Một cột `note` cho hai việc.** Đơn đã confirm-met rồi bị reject sẽ bị lời khai gặp mặt
   **ghi đè** bởi lý do từ chối — mất đúng bằng chứng mà cổng `met_confirmed` sinh ra để giữ.
   Tách `met_note`.
4. **Vị từ `idx_jr_quota` không phủ hết vế `WHERE` của chính hàm hạn mức** — nó bỏ sót
   `rejected AND reject_reason_code = 'referrer_misrepresented'`, tức đúng những hàng đốt suất
   vĩnh viễn thì rơi ra ngoài chỉ mục.
5. **Thiếu `otp_challenges.consumed_at`.** `otp_token` là vé mang theo; không có gì trong bản
   thân JWT ngăn nộp cùng một vé ba lần trong 5 phút để lập ba đơn.

Và một phán quyết về tên tệp: kế hoạch ghi `t06-guarantee-quota.test.js` nhưng `t06-envelope`
đã chiếm chỗ từ Task 6. Tệp thật là **`api/tests/t08-guarantee-quota.test.js`**.

- [ ] **Step 2: Thêm `fn_guarantee_quota` vào cùng migration**

Sao chép nguyên văn khối SQL ở **mục 4.3 của spec** (bản đã sửa, đọc hạn mức từ `communities.config`). Điểm bắt buộc giữ nguyên: `pg_advisory_xact_lock` theo `referrer_id`, trigger bắt cả `BEFORE INSERT OR UPDATE OF status`, và đơn `rejected` với `reason_code='referrer_misrepresented'` vẫn tính vào hạn mức.

- [ ] **Step 3: Viết `010_member_status_gate.js`**

```js
export async function up(knex) {
  await knex.raw(`
    CREATE FUNCTION fn_member_status_gate() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.status = 'member' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'member') THEN
        IF NEW.referrer_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM join_requests
           WHERE member_id = NEW.id AND met_confirmed_at IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'MEMBER_NEEDS_MET_CONFIRMATION'
            USING DETAIL = 'chưa có xác nhận đã gặp mặt';
        END IF;
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE FUNCTION fn_referrer_frozen() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF OLD.referrer_id IS DISTINCT FROM NEW.referrer_id AND OLD.status = 'member' THEN
        RAISE EXCEPTION 'REFERRER_FROZEN'
          USING DETAIL = 'sợi bảo lãnh đã thành sự thật lịch sử, không sửa được';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_referrer_frozen BEFORE UPDATE OF referrer_id ON members
      FOR EACH ROW EXECUTE FUNCTION fn_referrer_frozen();
  `);
}
```

Trigger `fn_member_status_gate` **chưa gắn** vào `members` ở bước này: `join_requests.member_id` chỉ được đặt trong cùng giao dịch `approve`, sau khi hàng `members` đã tồn tại. Gắn nó dạng `AFTER INSERT OR UPDATE ... DEFERRABLE INITIALLY DEFERRED` để kiểm tra chạy lúc `COMMIT`:

```sql
CREATE CONSTRAINT TRIGGER trg_member_status_gate
  AFTER INSERT OR UPDATE OF status ON members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_member_status_gate();
```

Đây là cùng công cụ, cùng lý do với `trg_fund_two_approvers` ở mục 4.5 spec: ràng buộc liên hàng thì phải kiểm lúc commit, không phải lúc ghi.

- [ ] **Step 4: Viết T6 (thất bại) — gồm cả bài chạy đua**

```js
// api/tests/t06-guarantee-quota.test.js
describe('T6 hạn mức bảo lãnh', () => {
  it('đơn thứ tư trong 12 tháng bị chặn', async () => {
    for (let i = 0; i < 3; i++) {
      await db.raw(`INSERT INTO join_requests (community_id, applicant_data, referrer_id, status)
                    VALUES (?, '{}'::jsonb, ?, 'pending')`, [cid, referrer]);
    }
    await expect(
      db.raw(`INSERT INTO join_requests (community_id, applicant_data, referrer_id, status)
              VALUES (?, '{}'::jsonb, ?, 'pending')`, [cid, referrer])
    ).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
  });

  // ⚠️ KHUNG DƯỚI ĐÂY LÀ BÀI TEST GIẢ — GIỮ LẠI LÀM VÍ DỤ PHẢN DIỆN, ĐỪNG CHÉP.
  // Task 8 chép đúng khung này, chạy xanh, rồi GỠ pg_advisory_xact_lock ra —
  // VẪN XANH. `const p2 = insert(tb)` chỉ TẠO promise; câu lệnh của giao dịch thứ
  // hai tới máy chủ trước hay sau `await ta.commit()` là do bộ lập lịch Node
  // quyết định, và thực tế nó thường tới SAU. Khi đó giao dịch thứ hai đếm ra 3
  // và hỏng — bài test có đúng kết quả mong đợi nhưng vì lý do hoàn toàn khác,
  // và nó không phân biệt được hai lý do. Nó sẽ báo xanh vào đúng ngày ai đó gỡ
  // khóa tư vấn vì thấy nó "làm chậm".
  it('hai đơn ĐỒNG THỜI thì chỉ một cái qua', async () => {
    const a = ownerKnex(), b = ownerKnex();
    const ta = await a.transaction(), tb = await b.transaction();
    const insert = (t) => t.raw(
      `INSERT INTO join_requests (community_id, applicant_data, referrer_id, status)
       VALUES (?, '{}'::jsonb, ?, 'pending')`, [cid, fresh]);
    const r1 = await insert(ta).then(() => 'ok').catch(() => 'fail');
    const p2 = insert(tb).then(() => 'ok').catch(() => 'fail');
    await ta.commit();   // ← không có gì bảo đảm p2 đã tới máy chủ trước dòng này
    const r2 = await p2;
    await tb.rollback().catch(() => {});
    expect([r1, r2].filter(x => x === 'ok').length).toBe(1);
    await a.destroy(); await b.destroy();
  });
});
```

**Bản đúng** (xem `api/tests/t08-guarantee-quota.test.js`): trước khi commit giao dịch thứ
nhất, dùng **kết nối thứ ba** đọc `pg_locks` và chờ tới khi giao dịch thứ hai **thật sự đang
xếp hàng** sau một khóa tư vấn (`locktype = 'advisory' AND NOT granted`). Có khóa thì điều
kiện này đạt được; không có khóa thì không bao giờ đạt, hết giờ, và assertion đỏ — **đỏ vì
đúng lý do**. Đã kiểm chứng độc lập: gỡ `pg_advisory_xact_lock` ⇒ bài test mới đỏ, khôi phục
⇒ xanh.

**Luật rút ra, áp cho mọi bài test chạy đua về sau:** một bài test đồng thời phải có **điểm
đồng bộ quan sát được từ phía máy chủ**. Xếp lịch promise trong Node không phải điểm đồng bộ.

- [ ] **Step 5: Chạy T6, xác nhận thất bại rồi xanh**

```bash
cd api && npm test -- t06
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(join): join_requests + han muc bao lanh 12 thang truot + cong met_confirmed

- pg_advisory_xact_lock theo referrer_id: FOR UPDATE vo dung voi bai toan bong ma
- trigger bat ca UPDATE OF status, chan lach bang cach tao draft roi day len pending
- cong met_confirmed la constraint trigger hoan toi COMMIT"
```

---

## Task 9: `member_relations`, trigger khởi tạo hồ sơ, và **MỐC 1 — luồng gia nhập chạy đầu-cuối**

> **Việc bắt buộc thừa kế từ Task 8 — không được hoãn thêm một task nữa.**
> `join_requests.applicant_data` là cột `jsonb` mà `app_role` có `SELECT`, và nó đang chứa
> **số điện thoại thô** cùng **băm mật khẩu** của người chưa phải thành viên. Cả kiến trúc bỏ
> công tách `member_contacts` rồi `REVOKE ALL` để một route viết ẩu không làm lộ số điện thoại
> — nếu một route mới `SELECT applicant_data` rồi trả thẳng thì công đó đổ sông, chỉ khác là
> lộ qua đơn thay vì qua hồ sơ. Task 8 đã bịt bằng **danh sách cho phép** ở tầng service
> (`publicApplicantData`, ba trường), nhưng đó là lời hứa của ứng dụng, không phải ràng buộc
> của CSDL — đúng thứ mà nguyên tắc "ép ở tầng dữ liệu" sinh ra để không phải tin.
>
> Task 8 cố ý không làm vì hàm `SECURITY DEFINER` hẹp cho việc này chỉ có **đúng một người gọi
> hợp lệ là `approve()`**, mà `approve()` là Task 9 — viết trước nghĩa là dựng một cửa không ai
> canh. Task 9 có cả hai, nên phải làm dứt điểm: tách số điện thoại và băm mật khẩu sang bảng
> riêng bị `REVOKE ALL`, đọc qua một hàm hẹp theo đúng khuôn `member_contacts`/`contact_read`.

**Files:**
- Create: `api/src/db/migrations/011_work_records.js` (chỉ phần bảng, để Task 12 thêm trigger uy tín)
- Create: `api/src/db/migrations/012_member_relations.js`
- Modify: `api/src/modules/join-requests/service.js`, `api/tests/expected-grants.json`
- Test: `api/tests/t16-join-flow.test.js`

**Interfaces:**
- Consumes: tất cả các task trước.
- Produces: `fn_member_bootstrap`, `contact_upsert(uuid, text, text)`, `fn_work_edge` (đăng ký trigger ở Task 12), bảng `member_relations` mà `app_role` **chỉ đọc**.

- [ ] **Step 1: Viết `011_work_records.js`**

Sao chép nguyên văn ba khối `CREATE TABLE work_records / work_participants / work_confirmations` ở **mục 4.1 của spec**, kèm hai khóa ngoại ghép `community_id`. Chưa gắn trigger uy tín — Task 12 làm.

Thu quyền:
```js
await knex.raw(`
  REVOKE UPDATE, DELETE ON work_confirmations FROM ??;
  REVOKE DELETE ON work_records FROM ??;
`, [user, user]);
```

- [ ] **Step 2: Viết `012_member_relations.js` — bảng + chỉ mục một chiều**

Sao chép nguyên văn `CREATE TABLE member_relations` và `CREATE UNIQUE INDEX rel_guarantee_one_direction` ở **mục 4.1 spec**, rồi:
```js
await knex.raw(`
  REVOKE INSERT, UPDATE, DELETE ON member_relations FROM ??;
  GRANT SELECT ON member_relations TO ??;
`, [user, user]);
```

- [ ] **Step 3: Thêm `fn_member_bootstrap` và `contact_upsert`**

Sao chép nguyên văn hai hàm ở **mục 4.7 của spec**, và gắn trigger:
```sql
CREATE TRIGGER trg_member_bootstrap AFTER INSERT ON members
  FOR EACH ROW EXECUTE FUNCTION fn_member_bootstrap();
```
Rồi `GRANT EXECUTE ON FUNCTION contact_upsert(uuid, text, text) TO app_role;`

- [ ] **Step 4: Viết `join-requests/service.js` — bốn bước, không hơn**

```js
import { withActor } from '../../core/tx.js';
import * as audit from '../../core/audit.js';
import { AppError } from '../../core/errors.js';

export async function approve({ actorId, communityId, requestId, note }) {
  return withActor(actorId, async (trx) => {
    const { rows: [jr] } = await trx.raw(
      `SELECT * FROM join_requests WHERE id = ? AND community_id = ? FOR UPDATE`,
      [requestId, communityId]);
    if (!jr) throw new AppError('NOT_FOUND', 'Không tìm thấy đơn.', { status: 404 });
    if (jr.status !== 'met_confirmed')
      throw new AppError('MET_CONFIRMATION_REQUIRED',
        'Chưa có xác nhận đã gặp mặt nên chưa duyệt được.', { status: 422 });

    const d = jr.applicant_data;

    // 1. Chỉ tạo hàng members. Hộp liên hệ rỗng, 8 mức riêng tư, và cạnh guarantee
    //    do trg_member_bootstrap sinh — service KHÔNG chạm member_contacts/member_relations.
    const { rows: [m] } = await trx.raw(
      `INSERT INTO members (community_id, full_name, birth_year, email, area_id,
                            referrer_id, password_hash, status, joined_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'member', now()) RETURNING id`,
      [communityId, d.full_name, d.birth_year, d.email ?? null, d.area_id,
       jr.referrer_id, d.password_hash]);

    // 2. Số điện thoại đi qua hàm SECURITY DEFINER; approver chỉ điền được ô còn trống.
    if (d.phone) await trx.raw(`SELECT contact_upsert(?, 'phone', ?)`, [m.id, d.phone]);

    // 3. Nối đơn với người vừa tạo — cổng met_confirmed kiểm lúc COMMIT dựa vào cột này.
    await trx.raw(
      `UPDATE join_requests SET member_id = ?, status = 'approved', approved_by = ?,
              note = coalesce(?, note), updated_at = now() WHERE id = ?`,
      [m.id, actorId, note ?? null, requestId]);

    // 4. Nhật ký, cùng giao dịch.
    await audit.log(trx, {
      communityId, actorId, action: 'join_request.approved',
      targetType: 'join_request', targetId: requestId,
      detail: { member_id: m.id, referrer_id: jr.referrer_id },
    });

    return { member_id: m.id };
  });
}
```

- [ ] **Step 5: Viết T16 (thất bại) — bài quan trọng nhất của mốc này**

```js
// api/tests/t16-join-flow.test.js
describe('T16 luồng gia nhập chạy đầu-cuối', () => {
  it('duyệt xong thì có contacts, có 8 mức riêng tư, có cạnh guarantee', async () => {
    const { member_id } = await approve({ actorId: approver, communityId: cid, requestId: jr });

    const { rows: [c] } = await db.raw(`SELECT * FROM member_contacts WHERE member_id = ?`, [member_id]);
    expect(c, 'trg_member_bootstrap phải tạo hàng liên hệ').toBeTruthy();
    expect(c.phone).toBe('0912345678');

    const { rows: p } = await db.raw(`SELECT * FROM privacy_settings WHERE member_id = ?`, [member_id]);
    expect(p.length).toBe(8);
    expect(p.find(x => x.field_key === 'phone').level).toBe('on_consent');
    expect(p.find(x => x.field_key === 'address').level).toBe('closed');

    const { rows: r } = await db.raw(
      `SELECT * FROM member_relations WHERE kind='guarantee' AND member_b = ?`, [member_id]);
    expect(r.length).toBe(1);
    expect(r[0].member_a).toBe(referrer);
  });

  it('app_role KHÔNG ghi được vào hai bảng đó — nếu service lỡ chạm sẽ chết', async () => {
    const app = appKnex();
    await expect(app.raw(
      `INSERT INTO member_relations (community_id, kind, member_a, member_b)
       VALUES (?, 'guarantee', ?, ?)`, [cid, referrer, approver]))
      .rejects.toThrow(/permission denied/i);
    await app.destroy();
  });

  it('không có met_confirmed thì không thành member được', async () => {
    await expect(approve({ actorId: approver, communityId: cid, requestId: jrChuaGap }))
      .rejects.toThrow(/MET_CONFIRMATION/);
  });

  it('sợi bảo lãnh không sửa lại được', async () => {
    await expect(db.raw(`UPDATE members SET referrer_id = ? WHERE id = ?`, [approver, memberId]))
      .rejects.toThrow(/REFERRER_FROZEN/);
  });
});
```

- [ ] **Step 6: Chạy T16, xác nhận thất bại rồi xanh**

```bash
cd api && npm test -- t16
```

- [ ] **Step 7: Chạy luồng thật bằng `curl` — MỐC 1**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
# 1. xin mã, lấy mã trong log của api
curl -s -X POST localhost/api/v1/auth/otp/request -H 'content-type: application/json' \
  -d '{"phone":"0912345678","purpose":"register"}'
docker compose logs api | grep OTP
# 2. xác minh, 3. nộp đơn, 4. người bảo lãnh xác nhận gặp mặt, 5. approver duyệt
# 6. thấy người mới trong danh bạ
curl -s localhost/api/v1/members -H "authorization: Bearer $TOKEN" | jq '.data[].full_name'
```

Kỳ vọng: tên người mới xuất hiện trong danh bạ. **Đây là mốc 1.**

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(join): MOC 1 — luong gia nhap chay dau-cuoi

- canh guarantee va hop lien he do trg_member_bootstrap sinh, service khong cham
- contact_upsert: approver chi dien duoc o con trong, dung mot lan, co dau vet
- T16 la bai test le ra da bat duoc mau thuan giua muc 4.1 va 5.3 cua spec"
```

---

## Task 10: Danh bạ — `GET /members`, `GET /members/:id`, đọc một trường liên hệ

**Files:**
- Create: `api/src/modules/members/{routes,service,schema}.js`, `api/src/modules/areas/{routes,service}.js`
- Modify: `api/src/app.js`
- Test: `api/tests/t10-directory.test.js` (tên `t05-three-consents.test.js` ở bản đầu **va chạm** với `t05-contact-read-branches.test.js` đã có từ Task 6; `t10-grants.test.js` cũng đã tồn tại nên `t10-directory` là tên không đụng), cộng bốn route mới thêm vào `api/tests/t21-http-shape.test.js` theo Ruling T9-e

**Interfaces:**
- Consumes: `privacy.contactStates`, `privacy.envelope`, `privacy.readContact`, `requireAuth`.
- Produces: `memberService.list({ actor, filters, page, limit })`, `.get({ actor, id })`, `.readContactField({ actor, id, field })`.

- [ ] **Step 1: Viết `members/service.js` — danh sách, MỘT truy vấn trạng thái cho cả trang**

> Ba sai lệch của khung dưới đây, đã sửa trong bản thi công: (a) `count(*) OVER ()` rồi đọc `rows[0]?.total ?? 0` báo **`total = 0` cho một trang rỗng** (bấm quá trang cuối ⇒ danh bạ "biến mất") — dùng câu đếm riêng dùng chung vị từ `WHERE`; (b) thiếu hai bộ lọc `q` và `work_status` mà **bảng API mục 5 đặc tả có**; (c) `ILIKE '%' || ? || '%'` tham số hóa nên không tiêm SQL được, nhưng `%`/`_` người dùng gõ vẫn là **ký tự đại diện của chính LIKE** — một chữ `%` biến bộ lọc thành "khớp tất cả", phải thoát.

```js
export async function list({ actor, filters, page = 1, limit = 20 }) {
  return withActor(actor.id, async (trx) => {
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT m.id, m.full_name, m.job, m.avatar_url, m.work_status, m.status,
              a.id AS area_id, a.name AS area_name, count(*) OVER () AS total
         FROM members m LEFT JOIN areas a ON a.id = m.area_id
        WHERE m.community_id = ? AND m.status = coalesce(?, m.status)
          AND (?::uuid IS NULL OR m.area_id = ?)
          AND (?::text IS NULL OR m.job ILIKE '%' || ? || '%')
        ORDER BY m.full_name LIMIT ? OFFSET ?`,
      [actor.communityId, filters.status ?? null, filters.areaId ?? null, filters.areaId ?? null,
       filters.job ?? null, filters.job ?? null, limit, offset]);

    const ids = rows.map(r => r.id);
    const states = await contactStates(trx, actor.id, ids);   // MỘT truy vấn, không N+1

    await audit.log(trx, {
      communityId: actor.communityId, actorId: actor.id, action: 'member.list',
      detail: { count: rows.length, page },   // một dòng cho cả trang
    });

    return {
      data: rows.map(r => ({
        id: r.id, full_name: r.full_name, job: r.job, avatar_url: r.avatar_url,
        work_status: r.work_status, status: r.status,
        area: r.area_id ? { id: r.area_id, name: r.area_name } : null,
        contacts: envelope(states.get(r.id), { viewerId: actor.id, targetId: r.id }),
      })),
      meta: { page, limit, total: Number(rows[0]?.total ?? 0) },
    };
  });
}
```

- [ ] **Step 2: Viết `readContactField` — lối vào DUY NHẤT của `contact_read`**

> ⚠️ **KHUNG DƯỚI ĐÂY LÀ VÍ DỤ PHẢN DIỆN — nó mắc đúng bẫy mục 3.** `contact_read` **tự ghi** dòng `contact.denied` **trong giao dịch đang mở** rồi mới trả `allowed = false` (nó cố ý không RAISE). Ném `AppError` ngay tại đó cuộn cả giao dịch và **xoá luôn dòng nhật ký vừa ghi** ⇒ mọi lượt bị từ chối xem số điện thoại đều không để lại dấu vết, kẻ dò hồ sơ trở nên vô hình. Giữ khung sai ở đây làm ví dụ, giống Ruling T8-a. Bản đúng ở `api/src/modules/members/service.js`: giao dịch **luôn commit** và trả `{kind, …}`, `AppError` ném **sau** khi commit.

```js
// ❌ SAI — đừng chép
export async function readContactField({ actor, id, field }) {
  return withActor(actor.id, async (trx) => {
    const r = await readContact(trx, id, field);      // hàm này tự ghi log, cả khi từ chối
    if (!r.allowed) {
      throw new AppError(                             // ← rollback xoá dòng contact.denied
        r.reason === 'CLOSED' ? 'CONTACT_CLOSED' : 'CONTACT_NEEDS_CONSENT',
        r.reason === 'CLOSED'
          ? 'Chủ hồ sơ đã đóng thông tin này.'
          : 'Cần chủ hồ sơ đồng ý mới xem được.',
        { status: 403 });
    }
    return { value: r.value };
  });
}
```

- [ ] **Step 3: Viết `GET /members/:id` với `profile_views`**

Ghi một hàng `profile_views` và một dòng `audit_log` `profile.view` trong cùng giao dịch, rồi trả hồ sơ kèm `contacts` envelope.

- [ ] **Step 4: Viết test danh bạ**

```js
it('danh sách không bao giờ trả value, kể cả trường public', async () => {
  const res = await list({ actor: { id: alice, communityId: cid }, filters: {}, page: 1 });
  for (const m of res.data) {
    for (const f of Object.values(m.contacts)) expect(f.value).toBeNull();
  }
  const visible = res.data.flatMap(m => Object.values(m.contacts)).filter(f => f.state === 'visible');
  expect(visible.length).toBeGreaterThan(0);   // có trường public, nhưng value vẫn null
});

it('danh sách 20 người sinh đúng MỘT dòng nhật ký', async () => {
  const before = await countAudit('member.list');
  await list({ actor: { id: alice, communityId: cid }, filters: {}, page: 1, limit: 20 });
  expect(await countAudit('member.list')).toBe(before + 1);
});
```

- [ ] **Step 5: Chạy test, xác nhận xanh, commit**

```bash
cd api && npm test
git add -A
git commit -m "feat(members): danh ba + doc mot truong lien he

- danh sach dung MOT truy van trang thai cho ca trang, khong N+1
- value luon null trong danh sach; gia tri that chi ra o /members/:id/contacts/:field
- GET /members ghi MOT dong nhat ky cho ca trang"
```

---

## Task 11: **MỐC 2 — `web/js/api.js` và nối ba màn frontend**

**Files:**
- Create: `web/js/api.js`
- Modify: `web/index.html` (chuyển từ `index_2.html`) — chỉ ba chỗ: `LoginForm`, `RegisterForm`, và hàm dựng danh bạ
- Test: `api/tests/t19-cors.test.js`

**Interfaces:**
- Consumes: API từ Task 7 và Task 10.
- Produces: `window.api` với `api.get/post/put/del`, tự gắn token, tự làm mới khi 401, và một chỗ duy nhất dịch `error.code` sang câu tiếng Việt.

> **Vì sao nối bây giờ chứ không muộn hơn:** frontend đang chạy hoàn toàn bằng dữ liệu giả. Mỗi ngày chưa nối là một ngày hai bên có thể hiểu khác nhau về hình dạng dữ liệu mà không ai biết. Ba màn này chạm đúng phần vừa dựng xong — nếu bao bì `contacts` ở mục 5.2 sai, ta biết ngay hôm nay, không phải ở giai đoạn 4.

- [ ] **Step 1: Chuyển frontend vào `web/`**

```bash
git mv index_2.html web/index.html
```

- [ ] **Step 2: Viết `web/js/api.js`**

```js
(function () {
  const BASE = '/api/v1';
  let access = localStorage.getItem('nc_access');
  let refresh = localStorage.getItem('nc_refresh');

  const MESSAGES = {
    INVALID_CREDENTIALS: 'Số điện thoại/email hoặc mật khẩu không đúng.',
    RATE_LIMITED: 'Bạn thao tác quá nhanh, thử lại sau ít phút.',
    GUARANTEE_QUOTA_EXCEEDED: 'Người bảo lãnh đã dùng hết số lượt trong 12 tháng gần nhất.',
    REFERRAL_UNAVAILABLE: 'Không dùng được người bảo lãnh này.',
    CONTACT_NEEDS_CONSENT: 'Cần chủ hồ sơ đồng ý mới xem được.',
    CONTACT_CLOSED: 'Chủ hồ sơ đã đóng thông tin này.',
    OTP_INVALID: 'Mã xác minh không đúng hoặc đã hết hạn.',
    OTP_LOCKED: 'Số này tạm khóa 15 phút do nhập sai nhiều lần.',
    INTERNAL: 'Hệ thống đang trục trặc. Thử lại sau ít phút.',
  };

  function setTokens(t) {
    access = t.access; refresh = t.refresh;
    localStorage.setItem('nc_access', access);
    localStorage.setItem('nc_refresh', refresh);
  }
  function clearTokens() {
    access = refresh = null;
    localStorage.removeItem('nc_access'); localStorage.removeItem('nc_refresh');
  }

  class ApiError extends Error {
    constructor(code, message, fields, status) {
      super(message || MESSAGES[code] || 'Có lỗi xảy ra.');
      this.code = code; this.fields = fields; this.status = status;
    }
  }

  async function raw(method, path, body, retry = true) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(access ? { authorization: 'Bearer ' + access } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401 && retry && refresh) {
      const ok = await renew();
      if (ok) return raw(method, path, body, false);
      clearTokens();
    }
    if (res.status === 204) return null;

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = data.error || {};
      throw new ApiError(e.code || 'INTERNAL', e.message, e.fields, res.status);
    }
    return data;
  }

  async function renew() {
    try {
      const res = await fetch(BASE + '/auth/refresh', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) return false;
      setTokens(await res.json());
      return true;
    } catch { return false; }
  }

  window.api = {
    get:  (p)    => raw('GET', p),
    post: (p, b) => raw('POST', p, b ?? {}),
    put:  (p, b) => raw('PUT', p, b ?? {}),
    del:  (p)    => raw('DELETE', p),
    setTokens, clearTokens, ApiError,
    isLoggedIn: () => Boolean(access),
  };
})();
```

- [ ] **Step 3: Nối màn đăng nhập**

Trong `web/index.html`, thay chỗ xử lý `submit` của `#form-login` bằng:
```js
try {
  const r = await api.post('/auth/login', { identifier: val('login-phone'), password: val('login-pass') });
  api.setTokens(r);
  CURRENT_USER = r.member;
  closeModal(); go('dashboard');
} catch (e) {
  toast(e.message, true);
}
```

- [ ] **Step 4: Nối màn đăng ký (ba bước: xin mã → xác minh → nộp đơn)**

Giao diện hiện tại chỉ có một bước. Thêm **một** bước nhập mã 6 số vào giữa — đây là thay đổi giao diện duy nhất của mốc này:
```js
await api.post('/auth/otp/request', { phone, purpose: 'register' });
// hiện ô nhập mã
const { otp_token } = await api.post('/auth/otp/verify', { phone, code, purpose: 'register' });
await api.post('/auth/register', { otp_token, full_name, birth_year, area_id, referrer_id, password, terms: true });
```

- [ ] **Step 5: Nối màn danh bạ**

Thay hằng số `MEMBERS` bằng lời gọi thật, và hiện số điện thoại theo `state`:
```js
const { data, meta } = await api.get(`/members?page=${page}&limit=20`);
// mỗi người: data[i].contacts.phone.state ∈ self|visible|can_request|requested|denied|closed
//   'can_request' -> hiện nút "Xin xem số liên hệ"
//   'visible'     -> hiện nút "Xem số" (gọi /members/:id/contacts/phone khi bấm)
//   'requested'   -> "Đang chờ chủ hồ sơ trả lời"
//   'closed'      -> không hiện nút
```

Giữ nguyên phần che `09•• ••• 638` — nó vốn đã đúng thiết kế.

- [ ] **Step 6: Kiểm bằng trình duyệt thật**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```
Mở trình duyệt, đăng ký một người mới, duyệt bằng tài khoản approver, xác nhận người đó hiện trong danh bạ với đúng trạng thái nút liên hệ.

- [ ] **Step 7: Viết `t19-cors.test.js`**

Khẳng định `Origin` lạ bị từ chối và `CORS_ORIGIN` được chấp nhận.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(web): MOC 2 — api.js va noi ba man dang ky/dang nhap/danh ba

- xu ly token va loi tap trung trong mot file, tu lam moi khi 401
- them dung MOT buoc nhap ma 6 so vao man dang ky
- danh ba doc state trong bao bi contacts, khong tu doan"
```

---

## Task 12: Bản ghi việc, cạnh `worked_together`, bậc uy tín

**Files:**
- Modify: `api/src/db/migrations/011_work_records.js` (thêm trigger), `api/src/db/migrations/012_member_relations.js`
- Create: `api/src/db/migrations/023_trust_stats.js`, `api/src/core/trust.js`
- Test: `api/tests/t01-edge-needs-both.test.js`, `api/tests/t02-self-only.test.js`, `api/tests/t09-no-rank-order.test.js`, `api/tests/t12-manual.test.js`

**Interfaces:**
- Produces: `tierOf(confirmedWorks)` → `{ key, label }`; bảng `member_trust_stats`; các hàm SQL `fn_work_edge`, `fn_self_only`, `fn_work_record_frozen`, `fn_manual_pair_quota`, `fn_trust_recount`.

- [ ] **Step 1: Thêm `fn_self_only`, `fn_work_record_frozen`, `fn_manual_pair_quota` vào `011`**

Sao chép nguyên văn ba hàm ở **mục 4.1 và 4.4 của spec**, gắn trigger:
```sql
CREATE TRIGGER trg_wc_self_only BEFORE INSERT ON work_confirmations
  FOR EACH ROW EXECUTE FUNCTION fn_self_only('member_id');
CREATE TRIGGER trg_work_record_frozen BEFORE UPDATE ON work_records
  FOR EACH ROW EXECUTE FUNCTION fn_work_record_frozen();
CREATE TRIGGER trg_manual_pair_quota BEFORE INSERT ON work_confirmations
  FOR EACH ROW EXECUTE FUNCTION fn_manual_pair_quota();
```

- [ ] **Step 2: Thêm `fn_work_edge` vào `012` và gắn trigger**

Sao chép nguyên văn ở **mục 4.1 spec**. `CREATE TRIGGER trg_work_edge AFTER INSERT ON work_confirmations`.

- [ ] **Step 3: Viết `023_trust_stats.js`**

```js
export async function up(knex) {
  await knex.raw(`
    CREATE TABLE member_trust_stats (
      member_id uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      community_id uuid NOT NULL REFERENCES communities(id),
      confirmed_works int NOT NULL DEFAULT 0,
      manual_works int NOT NULL DEFAULT 0,
      distinct_requesters int NOT NULL DEFAULT 0,
      repeat_requesters int NOT NULL DEFAULT 0,
      computed_at timestamptz NOT NULL DEFAULT now()
    );

    -- Nơi DUY NHẤT đếm. Luật "manual phải qua approver" nằm gọn ở đây.
    CREATE FUNCTION fn_trust_recount(p_member uuid) RETURNS void LANGUAGE plpgsql AS $fn$
    DECLARE v_cid uuid;
    BEGIN
      SELECT community_id INTO v_cid FROM members WHERE id = p_member;
      INSERT INTO member_trust_stats (member_id, community_id, confirmed_works, manual_works,
                                      distinct_requesters, repeat_requesters, computed_at)
      SELECT p_member, v_cid,
        count(*) FILTER (WHERE w.source_type <> 'manual' OR w.reviewed_at IS NOT NULL),
        count(*) FILTER (WHERE w.source_type = 'manual'),
        count(DISTINCT other.member_id),
        count(DISTINCT other.member_id) FILTER (WHERE other.n >= 2),
        now()
      FROM work_records w
      JOIN work_participants me ON me.work_record_id = w.id AND me.member_id = p_member
      LEFT JOIN LATERAL (
        SELECT p2.member_id, count(*) OVER (PARTITION BY p2.member_id) AS n
          FROM work_participants p2
         WHERE p2.work_record_id = w.id AND p2.member_id <> p_member
      ) other ON true
      WHERE NOT EXISTS (
        SELECT 1 FROM work_participants p3
         WHERE p3.work_record_id = w.id
           AND NOT EXISTS (SELECT 1 FROM work_confirmations c
                            WHERE c.work_record_id = p3.work_record_id AND c.member_id = p3.member_id))
      ON CONFLICT (member_id) DO UPDATE SET
        confirmed_works = EXCLUDED.confirmed_works, manual_works = EXCLUDED.manual_works,
        distinct_requesters = EXCLUDED.distinct_requesters,
        repeat_requesters = EXCLUDED.repeat_requesters, computed_at = now();
    END $fn$;

    CREATE FUNCTION fn_trust_touch() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE r RECORD;
    BEGIN
      FOR r IN SELECT member_id FROM work_participants WHERE work_record_id = NEW.work_record_id
      LOOP PERFORM fn_trust_recount(r.member_id); END LOOP;
      RETURN NULL;
    END $fn$;

    CREATE TRIGGER trg_trust_touch AFTER INSERT ON work_confirmations
      FOR EACH ROW EXECUTE FUNCTION fn_trust_touch();
  `);
}
```

- [ ] **Step 4: Viết `api/src/core/trust.js`**

```js
// Ngưỡng bậc nằm ở ĐÂY và chỉ ở đây. CSDL giữ con số thô, JS giữ ngưỡng.
// Không nơi nào lặp lại logic của nơi kia.
const TIERS = [
  { key: 'kim_cuong', label: 'Kim Cương', min: 100 },
  { key: 'vang',      label: 'Vàng',      min: 50 },
  { key: 'bac',       label: 'Bạc',       min: 20 },
  { key: 'dong',      label: 'Đồng',      min: 5 },
  { key: 'mam',       label: 'Mầm',       min: 0 },
];

export function tierOf(confirmedWorks) {
  const n = Number(confirmedWorks ?? 0);
  return TIERS.find(t => n >= t.min) ?? TIERS[TIERS.length - 1];
}

export { TIERS };
```

- [ ] **Step 5: Viết T1, T2, T9, T12**

T1 — cạnh chỉ xuất hiện khi đủ hai bên:
```js
it('một bên xác nhận thì chưa có cạnh', async () => {
  await withActor(alice, (trx) => trx.raw(
    `INSERT INTO work_confirmations (community_id, work_record_id, member_id) VALUES (?,?,?)`,
    [cid, wr, alice]));
  const { rows } = await db.raw(`SELECT * FROM member_relations WHERE kind='worked_together'`);
  expect(rows.length).toBe(0);
});

it('bên thứ hai xác nhận thì cạnh xuất hiện', async () => {
  await withActor(bob, (trx) => trx.raw(
    `INSERT INTO work_confirmations (community_id, work_record_id, member_id) VALUES (?,?,?)`,
    [cid, wr, bob]));
  const { rows } = await db.raw(`SELECT * FROM member_relations WHERE kind='worked_together'`);
  expect(rows.length).toBe(1);
  expect(rows[0].member_a < rows[0].member_b).toBe(true);   // thứ tự chuẩn tắc
});
```

T2 — xác nhận hộ bị chặn:
```js
it('A không xác nhận thay B được', async () => {
  await expect(withActor(alice, (trx) => trx.raw(
    `INSERT INTO work_confirmations (community_id, work_record_id, member_id) VALUES (?,?,?)`,
    [cid, wr, bob]))).rejects.toThrow(/SELF_ONLY/);
});
```

T9 — quét mã nguồn:
```js
import { globSync } from 'node:fs';
it('không truy vấn nào xếp theo bậc uy tín', () => {
  const files = globSync('src/modules/**/*.js', { cwd: new URL('..', import.meta.url).pathname });
  const bad = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (/order\s+by[^;]*\b(confirmed_works|manual_works|tier)\b/i.test(src)) bad.push(f);
  }
  expect(bad, `xếp hạng theo uy tín là vi phạm mục 9: ${bad.join(', ')}`).toEqual([]);
});
```

T12 — `manual` không tự đẩy bậc:
```js
it('manual chưa duyệt không cộng vào confirmed_works', async () => {
  // ... tạo work_record source_type='manual', hai bên xác nhận
  const { rows: [s] } = await db.raw(`SELECT * FROM member_trust_stats WHERE member_id = ?`, [alice]);
  expect(s.confirmed_works).toBe(0);
  expect(s.manual_works).toBe(1);

  await db.raw(`UPDATE work_records SET reviewed_by=?, reviewed_at=now() WHERE id=?`, [approver, wr]);
  await db.raw(`SELECT fn_trust_recount(?)`, [alice]);
  const { rows: [s2] } = await db.raw(`SELECT * FROM member_trust_stats WHERE member_id = ?`, [alice]);
  expect(s2.confirmed_works).toBe(1);
});

it('bản ghi manual thứ bảy cùng cặp bị chặn', async () => {
  // ... tạo 6 bản ghi manual đã xác nhận giữa alice và bob
  await expect(withActor(alice, (trx) => trx.raw(
    `INSERT INTO work_confirmations (community_id, work_record_id, member_id) VALUES (?,?,?)`,
    [cid, wr7, alice]))).rejects.toThrow(/MANUAL_PAIR_QUOTA_EXCEEDED/);
});
```

- [ ] **Step 6: Chạy T1, T2, T9, T12, xác nhận xanh, commit**

```bash
cd api && npm test -- t01 t02 t09 t12
git add -A
git commit -m "feat(trust): canh worked_together do trigger sinh + bac uy tin mot nguon su that

- ung dung khong co quyen INSERT member_relations, khong tao duoc quan he gia
- manual phai qua approver moi duoc dem; han muc 6 moi cap doc tu communities.config
- nguong bac o core/trust.js, con so tho o CSDL; khong noi nao lap lai noi kia"
```

---

## Task 13: Phần lược đồ còn lại — năng lực, tín hiệu, việc làm, giúp nhau, hoạt động, ký ức, quỹ, khiếu nại, vay

> **Hai việc bắt buộc thừa kế, không được hoãn thêm.**
>
> **(a) Bốn trường có mức riêng tư mà KHÔNG AI ĐỌC MỨC ĐÓ.** `job`, `area`, `price`, `family`
> có hàng trong `privacy_settings`, nhưng `GET /members` trả chúng như cột thường. Kiểm chứng
> độc lập hai lần: đặt `job` và `area` thành `closed` ⇒ danh sách **vẫn trả đủ**. Nghĩa là màn
> "Quyền riêng tư" đang cho người dùng gạt một cái nút không có tác dụng gì — **tệ hơn không có
> nút**, vì nó hứa một sự bảo vệ không tồn tại, và người ta sẽ dựa vào lời hứa đó mà khai thật.
> Trong cộng đồng 52 người, `area` cộng `job` là đủ để định danh một người, nên đây không phải
> chuyện nhỏ. Cách bịt phải đi qua cùng một cửa với bốn trường liên hệ (`contactStates`/
> `envelope`), không phải một nhánh `if` riêng cho từng trường.
>
> **(b) Migration `015` sẽ `CREATE OR REPLACE` lại `contact_read` và PHẢI GIỮ hai câu kiểm cộng
> đồng của `012a`.** Nếu không, bản vá cho lỗ rò dữ liệu chéo cộng đồng (Ruling T10-a) bị ghi đè
> **trong im lặng** và lỗ hổng quay lại nguyên vẹn. Viết bài test canh riêng việc này, đừng chỉ
> nhớ.

**Files:**
- Create: `api/src/db/migrations/013_capabilities.js` … `022_ops.js`, `024_indexes_and_revokes.js`
- Modify: `api/src/db/migrations/006_privacy.js` không đổi; thêm `CREATE OR REPLACE FUNCTION contact_read` vào `015_jobs.js`
- Modify: `api/tests/expected-grants.json`
- Test: `api/tests/t05-three-consents.test.js`, `api/tests/t08-fund-locked.test.js`, `api/tests/t15-signature-removal.test.js`

**Interfaces:**
- Produces: toàn bộ lược đồ còn lại theo mục 4 đặc tả gốc, cùng mọi trigger ở mục 4.5 và 4.8 của spec. **Chưa có endpoint nào** — API cho các nhóm này thuộc giai đoạn 2–6.

- [ ] **Step 1: `013_capabilities.js`** — `capabilities`, `capability_photos`, `capability_evidence`.

- [ ] **Step 2: `014_signals.js`** — 5 bảng + view `v_signal_recipients`

```sql
CREATE VIEW v_signal_recipients AS
SELECT r.*, resp.ability AS response, resp.responded_at
  FROM signal_recipients r
  LEFT JOIN signal_responses resp
    ON resp.signal_id = r.signal_id AND resp.responder_id = r.member_id;
```
`signal_forwards.from_member_id` **NOT NULL** + `CHECK (from_member_id <> to_member_id)`, và `REVOKE UPDATE, DELETE`.

- [ ] **Step 3: `015_jobs.js`** — `job_needs`, `ready_profiles`, `introductions`, `connections`, `connection_events`

Thêm `intro_three_consents` (mục 4.2 spec) và **mở rộng `contact_read`**:
```js
await knex.raw(`CREATE OR REPLACE FUNCTION contact_read(...)`);  // bản đầy đủ mục 4.2 + sửa A2,
                                                                  // nay có thêm nhánh introductions
```

- [ ] **Step 4: `016_aid.js`** — 5 bảng + `trg_slot_self_only` dùng lại `fn_self_only('member_id')`.

- [ ] **Step 5: `017_activities.js`** — 5 bảng + trigger `SUMMARY_REQUIRED`.

- [ ] **Step 6: `018_verify_endorse_complaints.js`** — thêm `endorsement_signatures` + constraint trigger hoãn `= 2` + `signer_id <> member_id`.

- [ ] **Step 7: `019_memories.js`** — thêm `memory_photo_people` + trigger `PHOTO_CONSENT_INCOMPLETE`.

- [ ] **Step 8: `020_fund.js`** — `fund_entries`, `fund_entry_approvals`, `transparency_reports`, `report_versions`

Sao chép nguyên văn `fn_fund_two_approvers` (mục 4.5 spec) **và** `fn_fund_sig_guard` (mục 4.8 spec). Cả hai đều `DEFERRABLE INITIALLY DEFERRED`. Kèm `REVOKE UPDATE, DELETE ON fund_entry_approvals`.

- [ ] **Step 9: `021_loans.js`, `022_ops.js`, `024_indexes_and_revokes.js`**

`024` là nơi **duy nhất** tập trung toàn bộ `REVOKE` theo bảng ở mục 4.8 spec — đọc một file là thấy hết ma trận quyền.

- [ ] **Step 10: Viết T5, T8, T15**

T15 là bài quan trọng nhất nhóm này:
```js
describe('T15 gỡ chữ ký không làm bút toán lớn thành một chữ ký', () => {
  it('app_role không xóa được chữ ký', async () => {
    const app = appKnex();
    await expect(app.raw(`DELETE FROM fund_entry_approvals WHERE entry_id = ?`, [entry]))
      .rejects.toThrow(/permission denied/i);
    await app.destroy();
  });

  it('owner xóa cũng bị chặn lúc COMMIT', async () => {
    const trx = await db.transaction();
    await trx.raw(`DELETE FROM fund_entry_approvals WHERE entry_id = ? AND approver_id = ?`,
                  [entry, approverB]);
    await expect(trx.commit()).rejects.toThrow(/FUND_TWO_APPROVERS_REQUIRED/);
  });
});
```

T8:
```js
it('fund_entries.locked không sửa được bằng bất kỳ đường nào', async () => {
  await expect(db.raw(`UPDATE fund_entries SET amount = 1 WHERE id = ?`, [locked]))
    .rejects.toThrow(/FUND_ENTRY_LOCKED/);
  const app = appKnex();
  await expect(app.raw(`DELETE FROM fund_entries WHERE id = ?`, [locked]))
    .rejects.toThrow(/permission denied/i);
  await app.destroy();
});
```

T5 (hoàn tất từ Task 10):
```js
it('số điện thoại không lộ khi 2/3 chữ ký, lộ đúng khi đủ 3', async () => {
  const read = () => withActor(poster, (trx) => readContact(trx, candidate, 'phone'));
  await db.raw(`UPDATE introductions SET consent_introducer = true WHERE id = ?`, [intro]);
  expect((await read()).allowed).toBe(false);
  await db.raw(`UPDATE introductions SET consent_candidate = true WHERE id = ?`, [intro]);
  expect((await read()).allowed).toBe(false);
  await db.raw(`UPDATE introductions SET consent_poster = true, channel_opened_at = now() WHERE id = ?`, [intro]);
  expect((await read()).allowed).toBe(true);
});

it('không đặt được channel_opened_at khi chưa đủ ba chữ ký', async () => {
  await expect(db.raw(
    `UPDATE introductions SET channel_opened_at = now() WHERE id = ?`, [introThieu]))
    .rejects.toThrow(/intro_three_consents/);
});
```

- [ ] **Step 11: Cập nhật `expected-grants.json` cho toàn bộ bảng mới** theo đúng bảng ở mục 4.8 spec, chạy T10, xác nhận xanh.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(db): migration 013-024 — luoc do day du + moi trigger cuong che

- chu ky la but toan: REVOKE UPDATE/DELETE + constraint trigger tren chinh bang chu ky
- 024 tap trung toan bo REVOKE, doc mot file la thay het ma tran quyen"
```

---

## Task 14: Khung hai người ký

**Files:**
- Create: `api/src/core/twoPerson.js`, `api/src/modules/ops/{routes,service,schema}.js`
- Modify: `api/src/db/migrations/022_ops.js`
- Test: `api/tests/t20-two-person.test.js`

**Interfaces:**
- Produces: `twoPerson.create({ actor, actionKey, targetType, targetId, payload })`, `.sign({ actor, id, password })`; hàm `computePayloadHash(trx, actionKey, payload, targetId)`.

- [ ] **Step 1: Bảng `pending_actions` + `pending_action_signatures`**

Sao chép nguyên văn mục 7.1 spec. Kèm `REVOKE UPDATE, DELETE ON pending_action_signatures`.

- [ ] **Step 2: Viết `computePayloadHash` — băm cả ảnh chụp `updated_at`**

```js
import crypto from 'node:crypto';

const SNAPSHOT = {
  'member.terminate':          (trx, id) => trx.raw(`SELECT updated_at FROM members WHERE id = ?`, [id]),
  'guarantee.quota_override':  (trx, id) => trx.raw(`SELECT updated_at FROM members WHERE id = ?`, [id]),
  'data.delete':               (trx, id) => trx.raw(`SELECT updated_at FROM members WHERE id = ?`, [id]),
  'contacts.export':           () => ({ rows: [] }),
  'backup.restore':            () => ({ rows: [] }),
};

export async function computePayloadHash(trx, actionKey, payload, targetId) {
  const snap = await SNAPSHOT[actionKey](trx, targetId);
  const material = JSON.stringify({ actionKey, payload, targetId, snap: snap.rows });
  return crypto.createHash('sha256').update(material).digest('hex');
}
```

- [ ] **Step 3: Viết `sign` — sáu bước kiểm, đúng thứ tự mục 7.2**

```js
export async function sign({ actor, id, password }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [pa] } = await trx.raw(`SELECT * FROM pending_actions WHERE id = ? FOR UPDATE`, [id]);
    if (!pa) throw new AppError('NOT_FOUND', 'Không tìm thấy việc chờ ký.', { status: 404 });

    // 1. Kiểm hạn NGAY LÚC KÝ — không trông vào tác vụ dọn dẹp chạy đúng giờ
    if (pa.status !== 'pending' || new Date(pa.expires_at) <= new Date())
      throw new AppError('PENDING_ACTION_EXPIRED', 'Việc này đã quá hạn 24 giờ, phải tạo lại.', { status: 409 });

    // 2. Không tự ký lần hai (PRIMARY KEY cũng chặn, nhưng kiểm sớm để câu lỗi tử tế)
    if (pa.created_by === actor.id)
      throw new AppError('NEEDS_SECOND_PERSON', 'Cần một người thứ hai ký.', { status: 409 });

    // 3. Vai
    const needed = ROLE_FOR[pa.action_key];
    if (!actor.roles.includes(needed))
      throw new AppError('FORBIDDEN', 'Bạn không có quyền ký việc này.', { status: 403 });

    // 4. Người ký không được là đối tượng
    if (pa.target_id === actor.id)
      throw new AppError('CANNOT_SIGN_OWN', 'Không ai ký việc liên quan tới chính mình.', { status: 403 });

    // 5. Xác thực lại mật khẩu — lớp hiệu quả nhất chống phiên bị bỏ quên
    const { rows: [m] } = await trx.raw(`SELECT password_hash FROM members WHERE id = ?`, [actor.id]);
    if (!(await argon2.verify(m.password_hash, password).catch(() => false)))
      throw new AppError('REAUTH_FAILED', 'Mật khẩu không đúng.', { status: 401 });

    // 6. Dữ liệu liên quan có đổi kể từ chữ ký đầu không?
    const now = await computePayloadHash(trx, pa.action_key, pa.payload, pa.target_id);
    if (now !== pa.payload_hash) {
      await trx.raw(`UPDATE pending_actions SET status='stale' WHERE id = ?`, [id]);
      await audit.log(trx, { communityId: pa.community_id, actorId: actor.id,
        action: 'pending_action.stale', targetType: 'pending_action', targetId: id, detail: {} });
      throw new AppError('PENDING_ACTION_STALE',
        'Dữ liệu liên quan đã thay đổi kể từ chữ ký đầu. Hãy tạo lại việc này.', { status: 409 });
    }

    await trx.raw(
      `INSERT INTO pending_action_signatures (pending_action_id, signer_id, payload_hash_at_sign, ip)
       VALUES (?, ?, ?, ?)`, [id, actor.id, now, actor.ip ?? null]);

    // Thi hành TRONG CÙNG giao dịch với chữ ký thứ hai — không có trạng thái "đã ký nhưng chưa chạy"
    const result = await EXECUTORS[pa.action_key](trx, pa);
    await trx.raw(
      `UPDATE pending_actions SET status='executed', executed_at=now(), result=?::jsonb WHERE id=?`,
      [JSON.stringify(result ?? {}), id]);
    await audit.log(trx, { communityId: pa.community_id, actorId: actor.id,
      action: 'pending_action.executed', targetType: 'pending_action', targetId: id,
      detail: { action_key: pa.action_key } });
    return { status: 'executed', result };
  });
}
```

- [ ] **Step 4: Viết T20**

```js
describe('T20 hai người ký', () => {
  it('người tạo không ký lần hai được', async () => {
    await expect(sign({ actor: creator, id: pa, password: 'matkhau123' }))
      .rejects.toThrow(/NEEDS_SECOND_PERSON|thứ hai/);
  });
  it('quá 24 giờ thì không ký được dù tác vụ dọn dẹp chưa chạy', async () => {
    await db.raw(`UPDATE pending_actions SET expires_at = now() - interval '1 minute' WHERE id = ?`, [pa]);
    await expect(sign({ actor: second, id: pa, password: 'matkhau123' })).rejects.toThrow(/quá hạn/);
  });
  it('dữ liệu đổi giữa hai chữ ký thì thành stale, không thi hành', async () => {
    await db.raw(`UPDATE members SET updated_at = now() WHERE id = ?`, [target]);
    await expect(sign({ actor: second, id: pa2, password: 'matkhau123' })).rejects.toThrow(/thay đổi/);
    const { rows: [x] } = await db.raw(`SELECT status FROM pending_actions WHERE id = ?`, [pa2]);
    expect(x.status).toBe('stale');
  });
  it('sai mật khẩu thì không ký được dù phiên còn hạn', async () => {
    await expect(sign({ actor: second, id: pa3, password: 'sai-mat-khau' })).rejects.toThrow(/Mật khẩu/);
  });
});
```

- [ ] **Step 5: Chạy T20, xác nhận xanh, commit**

```bash
git commit -m "feat(ops): khung hai nguoi ky voi payload_hash chup ca updated_at

- kiem han NGAY LUC KY, khong trong vao tac vu don dep
- ky phai nhap lai mat khau — lop hieu qua nhat chong phien bi bo quen
- thi hanh trong cung giao dich voi chu ky thu hai, khong co trang thai lung chung"
```

---

## Task 15: Tệp — tải lên, nén, xóa EXIF, stream có kiểm quyền

**Files:**
- Create: `api/src/modules/files/{routes,service,schema}.js`, `api/src/core/storage.js`
- Test: `api/tests/t21-exif.test.js`

- [ ] **Step 1: Viết `core/storage.js`** — client S3 tối giản (`PutObject`, `GetObject`) trỏ `S3_ENDPOINT`, bucket **private**.

- [ ] **Step 2: Viết `files/service.js` — nén và xóa EXIF**

```js
import sharp from 'sharp';

export async function ingest(buffer) {
  // .rotate() không tham số: xoay theo EXIF rồi BỎ toàn bộ metadata.
  // Ảnh điện thoại chứa tọa độ GPS — để lọt là phá nguyên tắc 4 bằng đường vòng,
  // trong một cộng đồng mà address mặc định 'closed'.
  return sharp(buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}
```

- [ ] **Step 3: Viết `GET /files/:id`** — kiểm quyền theo đối tượng gắn kèm, ghi `file.read` / `file.denied`, rồi `res.pipe` luồng từ MinIO. **Không phát URL nào.**

- [ ] **Step 4: Viết T21**

```js
it('ảnh sau khi nén không còn EXIF và không còn GPS', async () => {
  const withGps = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } })
    .jpeg().withMetadata({ exif: { IFD0: { Copyright: 'x' } } }).toBuffer();
  const out = await ingest(withGps);
  const meta = await sharp(out).metadata();
  expect(meta.exif).toBeUndefined();
  expect(meta.width).toBeLessThanOrEqual(1600);
});
```

- [ ] **Step 5: Chạy test, commit**

```bash
git commit -m "feat(files): stream qua api, khong presign; sharp xoa sach EXIF

Caddyfile khong co route nao toi storage. Ghi log dung luc byte duoc doc."
```

---

## Task 16: Vận hành — vai, quyền, nhật ký, bảng điều khiển

**Files:**
- Modify: `api/src/db/migrations/022_ops.js`, `api/src/modules/ops/routes.js`
- Create: `api/src/modules/ops/service.js`

- [ ] **Step 1: Hạt giống 5 vai và bảng `permissions`** theo ma trận mục 6 đặc tả gốc.

- [ ] **Step 2: `GET /ops/audit-log`** — chỉ `approver`, `tech`; ghi `audit.read`.

- [ ] **Step 3: `GET /ops/audit-log/verify`** — gọi `verifyChain`, trả `{ ok, checked, broken_at }`, ghi `audit.verified`.

- [ ] **Step 4: `GET /ops/dashboard`** — bốn cảnh báo mục 4.6 và 9 spec: kích thước `audit_log`, số dòng/ngày so trung bình 30 ngày, `contact.denied` vượt ngưỡng theo người, tỷ lệ `manual_works / confirmed_works` theo người.

- [ ] **Step 5: `GET /ops/permissions`** — trả ma trận quyền của chính người gọi.

- [ ] **Step 6: Test và commit.**

---

## Task 17: Dữ liệu mẫu

**Files:**
- Implemented: `api/src/db/seeds/ids.js`, `api/src/db/seeds/data/*.js`, `api/src/db/seeds/run.js`
- Test: `api/tests/t30-seed.test.js` (đánh số t30 vì các số T22/T29 đã được dùng)

- [x] **Step 1: Viết `ids.js` — UUIDv5 tất định**

```js
import { v5 as uuidv5 } from 'uuid';
const NS = '6f2a1c3e-8b4d-5f6a-9c1e-2d3b4a5c6d7e';
export const id = (key) => uuidv5(key, NS);
```

Không id ngẫu nhiên ở bất kỳ đâu trong seed — đó là toàn bộ lý do chạy lại được nhiều lần.

- [x] **Step 2: Viết cây bảo lãnh 52 người** theo mục 12.2 spec: một gốc, bốn tầng, `created_at` lùi ngày 2019→2026. `M07` có đúng 3 đơn trong 12 tháng gần nhất. `M09` có đơn `rejected` với `referrer_misrepresented`; `M10` có đơn `rejected` với `not_ready`.

- [x] **Step 3: Viết phần còn lại** — 104 đơn vị cấp xã hiện hành của Hưng Yên (93 xã, 11 phường; khu vực cũ được giữ lịch sử nhưng ẩn khỏi danh mục hoạt động), 148 năng lực, ~60 `work_records` đủ xác nhận, **3 bản ghi mới một bên xác nhận**, **1 bản ghi `manual` chưa duyệt**, 7 tín hiệu mỗi chặng một cái, 5 nhu cầu việc, 5 yêu cầu giúp nhau, 4 hoạt động (2 có tổng kết), 12 bút toán quỹ (2 cái ≥ 1 triệu có đủ chữ ký), 2 khoản vay.

`audit_log` sinh bằng `INSERT` thường để trigger tự dựng chuỗi. **Tuyệt đối không seed hash cứng.**

- [x] **Step 4: Mọi lệnh ghi đi qua đường idempotent có kiểm soát**, dùng `ON CONFLICT (id) DO UPDATE` cho bảng thường và `insertOnce` cho bảng chỉ-thêm/đóng băng; tất cả chạy trong `withActor()` vì `fn_self_only` đòi dấu người thực hiện.

- [x] **Step 5: Viết T22 (`api/tests/t30-seed.test.js`)**

```js
it('chạy seed hai lần không nhân đôi dữ liệu', async () => {
  await runSeed(); const a = await counts();
  await runSeed(); const b = await counts();
  expect(b).toEqual(a);
});
it('có sẵn một người chạm hạn mức để thử lỗi', async () => {
  await expect(db.raw(
    `INSERT INTO join_requests (community_id, applicant_data, referrer_id, status)
     VALUES (?, '{}'::jsonb, ?, 'pending')`, [cid, id('member:M07')]))
    .rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
});
it('chuỗi băm của dữ liệu mẫu liên mạch', async () => {
  expect((await verifyChain(db, { communityId: cid })).ok).toBe(true);
});
```

- [x] **Step 6: Chạy `npm run seed` hai lần trên database tạm, chạy T22/t30, kiểm tra chuỗi băm.**

---

## Task 18: Sao lưu và tác vụ định kỳ

**Files:**
- Implemented: `backup/Dockerfile`, `backup/backup.sh`, `backup/verify.sh`, `backup/crontab`, `backup/entrypoint.sh`, `backup/storage-init.sh`, `backup/restore.sh`
- Implemented: `api/src/jobs/index.js` và các tác vụ
- Tests: `api/tests/t30-jobs.test.js`, `api/tests/t31-task17-18-contract.test.js`

- [x] **Step 1: `backup.sh`** — `pg_dump` nén theo ngày giờ; đồng bộ ảnh từ MinIO; **xuất riêng `audit_log` kèm chuỗi băm** ra nơi tách biệt; đẩy lên Google Drive; ghi kết quả vào bảng `backups` **dù thành công hay lỗi**. Runtime đã kiểm chứng nhánh lỗi thiếu Google Drive vẫn ghi `ok=false`; đường restore/verify không tắt trigger.

Thông tin đăng nhập MinIO của container này là `BACKUP_S3_*`, chính sách chỉ `s3:PutObject`, **không** `s3:DeleteObject`. Người sửa được nhật ký không xóa được bản sao đối chiếu.

- [x] **Step 2: `crontab`** — container backup đã nạp đúng bốn lịch; runtime dùng `Asia/Ho_Chi_Minh`.

```
0 3 * * *  /app/backup.sh                         # sao lưu
15 3 * * * /app/verify-chain.sh                   # kiểm chuỗi băm
0 4 * * 0  /app/export-audit.sh                   # xuất bản sao nhật ký hằng tuần
0 5 1 * *  /app/verify.sh                         # kiểm bản sao lưu hằng tháng
```

- [x] **Step 3: Tác vụ trong `api`** — 03:15 tính lại `member_trust_stats` và ghi lệch; hằng giờ đánh dấu `pending_actions` quá hạn và đóng tín hiệu quá hạn trả lời; nhắc các xác minh `pending` quá 15 ngày (diễn giải tạm thời vì schema chưa có `expires_at`); sau 30 ngày im lặng nhắc cập nhật trạng thái nhận việc; tạo phân mảnh `audit_log` hai tháng kế tiếp bằng `fn_audit_new_partition`.

- [x] **Step 4: Commit sau khi người dùng duyệt diff cuối.**

---

## Task 19: OpenAPI, README, `docs/RANG-BUOC.md`

**Files:**
- Create: `api/src/openapi/build.js`, `README.md`, `docs/RANG-BUOC.md`

- [x] **Step 1: Sinh OpenAPI từ schema Zod**, phục vụ ở `/api/v1/docs`; có `api/tests/t32-openapi.test.js`.

- [x] **Step 2: Viết `README.md`** — cách chạy, biến môi trường, migration, seed, sao lưu, khôi phục, lên phiên bản mới không mất dữ liệu. Bốn điều **bắt buộc nói to**:

1. **Mất khóa gốc là mất toàn bộ dữ liệu nhạy cảm**, không phải mất một người. Kho khóa sao lưu đường riêng, đích riêng.
2. `f_unaccent` gắn nhãn `IMMUTABLE` là **lời hứa của ta, không phải sự thật tuyệt đối** — từ điển `unaccent` đổi thì phải `REINDEX`.
3. **Hai người ký chỉ là hai `member_id` khác nhau.** Cùng một con người dùng hai tài khoản thì phần mềm không biết. Cách chặn thật nằm ngoài phần mềm: hai người ký phải là hai người mà cộng đồng biết mặt.
4. **`148` năng lực và `7` nhóm ngành trong dữ liệu mẫu là số minh họa lấy từ giao diện demo**, không phải số liệu thật.

- [x] **Step 3: Viết/cập nhật `docs/RANG-BUOC.md`** — mỗi ràng buộc một mục: **cưỡng chế bằng gì, ở migration nào, nguyên tắc nào nó phục vụ, và điều gì hỏng nếu gỡ đi.** Bổ sung mục vận hành Task 17–20.

- [x] **Step 4: Commit.**

---

## Task 20: Kiểm thử toàn bộ và bàn giao

- [x] **Step 1: Nghiệm thu stack hiện có và database tạm** — đã migrate, seed hai lần không nhân đôi, chạy test seed/jobs/contract; không dùng `down -v` trên volume đang có dữ liệu. Full runtime clean-compose cần Docker API khả dụng.

```bash
docker compose down -v
cp .env.example .env   # điền giá trị thật
docker compose up -d
docker compose exec api npm run seed
docker compose exec api npm test
```
Kỳ vọng hiện tại: toàn bộ Vitest (không còn giới hạn 22 bài cũ), không bài nào bị bỏ qua; lần kiểm tra cuối là **40 file / 530 test**.

- [x] **Step 2: Xác nhận T14 — `api` không mở cổng khi migration lỗi** — chạy container API tạm với `MIGRATION_DATABASE_URL` sai; tiến trình thoát mã 1 ngay sau migration và không mở cổng, không chèn migration hỏng vào stack đang giữ dữ liệu.

```bash
# tạm thêm một migration cố ý hỏng, dựng lại, khẳng định /health không trả lời
docker compose up -d --build api
docker compose ps api    # kỳ vọng: unhealthy hoặc restarting
curl -s -m 3 localhost/api/v1/health   # kỳ vọng: không có phản hồi
```

- [x] **Step 3: Xác nhận `down` không mất dữ liệu** — đã kiểm tra bằng restart/recreate không xóa volume và database tạm; kiểm tra lại trên clean-compose khi Docker API khả dụng.

```bash
docker compose down && docker compose up -d
docker compose exec api node -e "…đếm số member…"   # kỳ vọng: vẫn 52
```

- [ ] **Step 4: Chạy lại luồng gia nhập bằng trình duyệt thật** — các route/API đã có test HTTP và login mẫu trên database tạm; bước browser thật vẫn cần người vận hành mở web và đi hết luồng từ đầu tới khi thấy trong danh bạ.

- [x] **Step 5: Commit và gắn thẻ** — thực hiện sau khi chạy kiểm tra cuối và giữ `.claude/` ngoài commit.

```bash
git add -A
git commit -m "chore: hoan tat giai doan 1"
git tag giai-doan-1
```

---

## Self-Review

**Phủ spec.** Đối chiếu từng mục spec với task: §1 kiến trúc → T1; §1.6 grants → T2; §2 lỗ hổng → T5, T9, T13; §3 tx/audit → T3, T4; §4.1 → T9, T12; §4.2 → T6, T13; §4.3 → T8; §4.4 → T12; §4.5 → T13; §4.6 → T4; §4.7 → T9; §4.8 → T13; §5 API → T7, T8, T10, T16; §5.2 bao bì → T10, T11; §6 privacy → T6, T10; §7 hai người ký → T14; §8 chỉ mục/uy tín → T12, T13; §9 đánh đổi → ghi trong RANG-BUOC.md (T19); §10 xóa dữ liệu → T14 (`data.delete`) + T19; §11 migration → T2, T4, T5, T6, T7, T8, T9, T12, T13; §12 seed → T17; §13 kiểm thử → rải khắp, tổng kết T20; §14 bàn giao → T19, T20; §15 config → T17.

**Chỗ có ý bỏ khỏi giai đoạn 1, đã ghi rõ:** API cho năng lực/tín hiệu/việc làm/giúp nhau/hoạt động/ký ức/quỹ/khiếu nại/vay — lược đồ có đủ (Task 13), endpoint thuộc giai đoạn 2–6. Mã hóa AES-256-GCM (`core/crypto.js`) chỉ dựng khung ở Task 13 migration 021; luồng vay đầy đủ thuộc giai đoạn 6.

**Nhất quán tên.** `withActor` (T3) — dùng ở T4, T6, T8, T9, T10, T12, T14, T17. `audit.log(trx, …)` / `audit.logDenied(…)` (T4) — dùng ở T7, T9, T10, T14. `contact_read` (T6) — mở rộng ở T13, gọi ở T10. `contact_upsert` (T9) — gọi ở T9. `fn_self_only('member_id')` (T12) — dùng lại ở T13 cho `aid_slot_takers`. `tierOf` (T12) — chỉ định nghĩa một nơi. `envelope`/`contactStates` (T6) — dùng ở T10, tiêu thụ ở T11.

**Hai ràng buộc thứ tự của mục G đã thỏa:** MỐC 1 ở hết Task 9 (sớm nhất có thể — nó cần đúng và chỉ đúng những task trước nó), MỐC 2 ở Task 11.
