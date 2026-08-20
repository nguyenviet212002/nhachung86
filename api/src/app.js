import express from 'express';
import { knex } from './db/knex.js';
import { httpLogger } from './middleware/httpLogger.js';
import { cors } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { router as authRouter } from './modules/auth/routes.js';
import { router as joinRequestsRouter } from './modules/join-requests/routes.js';
import { router as membersRouter } from './modules/members/routes.js';
import { router as areasRouter } from './modules/areas/routes.js';
import { router as opsRouter } from './modules/ops/routes.js';
import { router as filesRouter } from './modules/files/routes.js';
import { router as invitesRouter } from './modules/invites/routes.js';
import { notificationRouter, messageRouter } from './modules/notifications/routes.js';
import { health as storageHealth } from './core/storage.js';
import { buildOpenApi } from './openapi/build.js';

export function buildApp() {
  const app = express();

  // Phát hiện soát xét (Important, vòng sửa 1): trước đây không middleware nào
  // gắn `req.log`, nên mọi lời gọi req.log?.fatal/error trong errorHandler là
  // no-op im lặng — kể cả cảnh báo 42501 (permission denied), đúng sự kiện mà
  // toàn bộ kiến trúc này dựng ra để phát hiện. Gắn pino-http thật ở đây.
  // Cấu hình (level, redact, serializer lỗi an toàn) nằm ở middleware/httpLogger.js
  // — xem comment ở đó về vì sao serializer lỗi phải là DANH SÁCH CHO PHÉP
  // (vòng sửa 2: default serializer của pino-http từng làm lộ err.detail —
  // đúng chỗ PostgreSQL in giá trị cột thật, vd. số điện thoại — ra log).
  app.use(httpLogger());

  // CORS đứng TRƯỚC express.json và trước mọi route: preflight OPTIONS không
  // có thân, và một Origin lạ phải bị từ chối trước khi chạm tới bất cứ thứ
  // gì đọc dữ liệu. Sau httpLogger để lượt bị từ chối vẫn có mặt trong log.
  app.use(cors);

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/v1/health', async (req, res) => {
    let db = false;
    try { await knex.raw('select 1'); db = true; } catch { db = false; }

    // Ruling T1-a: KHÔNG được đoán hay mặc định lạc quan cho trạng thái migration.
    // Đọc thật từ bảng knex_migrations; nếu không đọc được (bảng chưa tồn tại,
    // thiếu quyền, DB chết, ...) thì trả null — im lặng còn hơn nói dối.
    let migration = null;
    if (db) {
      try {
        const { rows: countRows } = await knex.raw(
          'SELECT count(*)::int AS applied FROM knex_migrations'
        );
        const { rows: latestRows } = await knex.raw(
          'SELECT name FROM knex_migrations ORDER BY id DESC LIMIT 1'
        );
        migration = {
          applied: countRows[0].applied,
          latest: latestRows[0]?.name ?? null,
        };
      } catch {
        migration = null;
      }
    }

    // Đặc tả mục 5.3 đòi `/health` trả `{ ok, db, storage, migration }`. Cột
    // `storage` vắng mặt từ Task 1 tới Task 15 — không phải vì ai quyết định
    // bỏ nó mà vì chưa có kho để hỏi. Nay có: một máy chủ mà CSDL sống nhưng
    // kho ảnh chết vẫn nhận được ảnh vào bước nén rồi hỏng ở bước cuối, và
    // `/health` nói "ok" suốt thời gian đó.
    //
    // `ok` KHÔNG gộp `storage` vào: kho chết là hỏng MỘT tính năng, CSDL chết
    // là hỏng cả hệ thống. Gộp lại thì một sự cố MinIO sẽ khiến bộ điều phối
    // khởi động lại container `api` đang phục vụ tốt mọi thứ khác.
    //
    // Trả BOOLEAN, cùng hình dạng với `db`, và KHÔNG kèm tên trình điều khiển:
    // `/health` là đường công khai, và "kho này là MinIO hay là thư mục trên
    // đĩa" là thông tin về hạ tầng, không phải thông tin về sức khoẻ.
    const storage = await storageHealth();

    res.status(db ? 200 : 503).json({ ok: db, db, storage, migration });
  });

  // Tài liệu là JSON công khai để client, người vận hành và kiểm thử có cùng
  // một nguồn mô tả request. Các schema trong build.js chính là schema Zod
  // middleware đang dùng, không phải một bản chép tay khác.
  app.get('/api/v1/docs', (req, res) => {
    res.json(buildOpenApi());
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/join-requests', joinRequestsRouter);
  app.use('/api/v1/areas', areasRouter);
  app.use('/api/v1/members', membersRouter);
  app.use('/api/v1/ops', opsRouter);
  app.use('/api/v1/files', filesRouter);
  app.use('/api/v1/guarantee-invites', invitesRouter);
  app.use('/api/v1/notifications', notificationRouter);
  app.use('/api/v1/messages', messageRouter);

  app.use(errorHandler);

  return app;
}
