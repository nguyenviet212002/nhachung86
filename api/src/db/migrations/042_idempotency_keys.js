// Idempotency-Key — chặn double-submit khi người dùng bấm nút hai lần vì mạng
// chậm (mạng ở quê nhiều nơi rất chậm; đây không phải rủi ro lý thuyết).
//
// Khoá do NƠI GỌI sinh ra (web/js/api.js: `api.newIdemKey()`), giữ nguyên qua
// mọi lần bấm lại của CÙNG một ý định. Middleware (middleware/idempotency.js)
// ghi hàng NGAY LÚC request đầu tiên tới (không đợi service chạy xong), nhờ
// UNIQUE (member_id, key) mà hai request gần như đồng thời chỉ một cái insert
// được — cái thua gặp lỗi 409 CÙNG NGÀY thay vì cả hai cùng tạo tài nguyên.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`
    CREATE TABLE idempotency_keys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      member_id uuid NOT NULL,
      key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 200),
      method text NOT NULL,
      path text NOT NULL,
      status integer,
      response_body jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT idempotency_keys_member_cid FOREIGN KEY (member_id, community_id)
        REFERENCES members (id, community_id) ON DELETE CASCADE,
      CONSTRAINT idempotency_keys_unique UNIQUE (member_id, key)
    );
    -- Dọn theo created_at (job.purge_idempotency_keys, chạy hằng ngày, xem
    -- api/src/jobs/purge-idempotency-keys.js) — hàng chỉ có ích trong vài giờ
    -- đầu, giữ 24h là đủ biên độ cho một người bấm lại nút sau khi mất mạng.
    CREATE INDEX idx_idempotency_keys_created ON idempotency_keys (created_at);
  `);
  await knex.raw(`REVOKE ALL ON idempotency_keys FROM ??; GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO ??;`, [user, user]);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS idempotency_keys;`);
}
