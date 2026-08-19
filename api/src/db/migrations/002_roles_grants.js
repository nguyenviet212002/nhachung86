export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  const pass = process.env.APP_DB_PASSWORD ?? 'test_app';

  // CREATE ROLE là lệnh cấp cụm (cluster-level) — role sống sót qua
  // DROP SCHEMA public CASCADE (dùng trong resetDb() khi test). Vì vậy phải
  // kiểm tra tồn tại trước khi tạo, để migration chạy lại nhiều lần không lỗi.
  //
  // Lưu ý kỹ thuật: KHÔNG thể truyền tham số ? vào bên trong khối DO $$ ... $$
  // như bản nháp ban đầu — $1 nằm trong chuỗi dollar-quote là văn bản của khối
  // PL/pgSQL, không phải tham số của câu lệnh ngoài, nên Postgres báo "prepared
  // statement requires 0" khi bind 3 giá trị. CREATE ROLE cũng không nhận bind
  // parameter ở mệnh đề PASSWORD (đây là lệnh DDL, không phải DML). Vì vậy: dùng
  // knex.raw tham số hóa cho bước kiểm tra tồn tại, rồi dùng quote_literal() của
  // chính Postgres (qua một truy vấn tham số hóa khác) để lấy về một chuỗi literal
  // đã được Postgres tự thoát ký tự an toàn — không phải nối chuỗi tay từ input.
  const { rows: existing } = await knex.raw(`SELECT 1 FROM pg_roles WHERE rolname = ?`, [user]);
  if (existing.length === 0) {
    const { rows: quoted } = await knex.raw(`SELECT quote_literal(?) AS lit`, [pass]);
    const passwordLiteral = quoted[0].lit;
    await knex.raw(`CREATE ROLE ?? LOGIN PASSWORD ${passwordLiteral}`, [user]);
  }

  // GRANT USAGE ON SCHEMA và ALTER DEFAULT PRIVILEGES gắn với schema public,
  // nên sẽ bị DROP SCHEMA CASCADE xóa sạch — phải cấp lại mỗi lần migrate chạy
  // (idempotent tự nhiên vì GRANT/ALTER DEFAULT PRIVILEGES không lỗi khi lặp lại).
  await knex.raw(`GRANT USAGE ON SCHEMA public TO ??`, [user]);

  // Mọi bảng owner (nhachung_owner) tạo ra từ đây về sau tự động có quyền cho
  // app_role — không ai phải nhớ viết GRANT trong từng migration tạo bảng.
  //
  // BẪY: cơ chế ALTER DEFAULT PRIVILEGES này áp dụng cho MỌI bảng mới, kể cả
  // các phân mảnh (partition) của audit_log sẽ được tạo ở migration sau. Điều
  // đó tự động cấp UPDATE/DELETE cho app_role trên audit_log — đục thủng đúng
  // chỗ quan trọng nhất (nhật ký kiểm toán phải chỉ-thêm, không được sửa/xóa).
  // ĐỪNG gỡ khối ALTER DEFAULT PRIVILEGES này để "vá" lỗ hổng đó — Task 4 sẽ
  // bịt bằng một hàm tạo phân mảnh (fn_audit_new_partition) tự REVOKE UPDATE,
  // DELETE ngay sau khi tạo phân mảnh mới. T10 (bài kiểm quyền) sẽ quét cả
  // các phân mảnh để đảm bảo lỗ hổng này không lọt qua.
  await knex.raw(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ??;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO ??;
  `, [user, user]);

  // /health cần đọc knex_migrations để báo cáo trạng thái migration thật —
  // không đoán, không mặc định lạc quan (Ruling T1-a). Bảng này do owner tạo
  // TRƯỚC khi ALTER DEFAULT PRIVILEGES ở trên có hiệu lực (nó đã tồn tại khi
  // migration đầu tiên chạy), nên cần GRANT SELECT tường minh ở đây.
  await knex.raw(`GRANT SELECT ON knex_migrations, knex_migrations_lock TO ??`, [user]);
}

export async function down(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ??`, [user]);
}
