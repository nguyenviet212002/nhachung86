export async function up(knex) {
  await knex.raw(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE EXTENSION IF NOT EXISTS unaccent;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE EXTENSION IF NOT EXISTS cube;
    CREATE EXTENSION IF NOT EXISTS earthdistance;

    -- unaccent() KHÔNG immutable nên không đánh chỉ mục trực tiếp được.
    -- Bọc lại bằng hàm STABLE/IMMUTABLE là cách chuẩn để dùng trong index/generated column.
    -- LƯU Ý: nhãn IMMUTABLE ở đây là lời hứa của ta, không phải sự thật tuyệt đối —
    -- nếu từ điển unaccent (unaccent.rules) thay đổi thì các chỉ mục dựa trên hàm này
    -- sẽ lệch dữ liệu cũ và phải REINDEX lại toàn bộ.
    CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
      AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
  `);
}

export async function down(knex) {
  await knex.raw(`DROP FUNCTION IF EXISTS f_unaccent(text);`);
}
