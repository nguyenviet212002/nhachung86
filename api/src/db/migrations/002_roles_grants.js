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
  // parameter ở mệnh đề PASSWORD (đây là lệnh DDL, không phải DML — đã tự kiểm
  // chứng: `CREATE ROLE ?? LOGIN PASSWORD ?` bị Postgres từ chối với "syntax
  // error at or near $1"). Vì vậy: dùng knex.raw tham số hóa cho bước kiểm tra
  // tồn tại, rồi dùng quote_ident()/quote_literal() của chính Postgres (qua
  // một truy vấn tham số hóa khác) để lấy về các chuỗi đã được Postgres tự
  // thoát ký tự an toàn.
  const { rows: existing } = await knex.raw(`SELECT 1 FROM pg_roles WHERE rolname = ?`, [user]);
  if (existing.length === 0) {
    const { rows: quoted } = await knex.raw(
      `SELECT quote_ident(?) AS ident, quote_literal(?) AS lit`,
      [user, pass]
    );
    const { ident, lit } = quoted[0];
    const createRoleSql = `CREATE ROLE ${ident} LOGIN PASSWORD ${lit}`;

    // CẨN THẬN — LỖI NGHIÊM TRỌNG ĐÃ TỪNG MẮC, ĐÃ KIỂM CHỨNG THẬT BẰNG KẾT NỐI
    // TCP THẬT (không suy đoán): dialect Postgres của knex chạy positionBindings()
    // TRÊN MỌI câu lệnh đi qua knex.raw()/query builder — kể cả khi gọi
    // knex.raw(sql) KHÔNG kèm mảng bindings — và hàm này thay MỌI dấu "?" chưa
    // escape trong TOÀN VĂN chuỗi SQL bằng $1, $2, ... KỂ CẢ khi "?" nằm bên
    // trong một chuỗi literal có nháy đơn (positionBindings không biết gì về
    // ngữ cảnh chuỗi SQL). quote_literal() không thoát ký tự "?" vì nó không
    // phải ký tự đặc biệt trong cú pháp chuỗi — nên nếu câu CREATE ROLE ở trên
    // được thực thi qua knex.raw(), "?" trong mật khẩu sẽ bị âm thầm đổi thành
    // "$1" ngay trong chuỗi literal, và Postgres lưu mật khẩu SAI (vd.
    // "pass$1word" thay vì "pass?word") — KHÔNG ném lỗi nào cả. Đây là hỏng
    // ÂM THẦM, nguy hiểm hơn nhiều so với một lỗi ồn ào: role "tạo thành công"
    // nhưng không ai đăng nhập được bằng mật khẩu thật cho tới khi ứng dụng
    // chạy thật và app_role không kết nối được.
    //
    // Đã tái hiện: tạo role qua knex.raw() với mật khẩu 'pass?word' rồi thử
    // đăng nhập TCP thật — đăng nhập bằng "pass?word" (mật khẩu thật) THẤT BẠI,
    // còn đăng nhập bằng "pass$1word" (mật khẩu đã bị positionBindings làm hỏng)
    // lại THÀNH CÔNG. Việc bỏ mảng bindings ở lời gọi cuối (cách sửa lần trước)
    // chỉ ngăn được lỗi "Expected N bindings" — KHÔNG ngăn được việc SQL text
    // bị viết lại, vì positionBindings chạy vô điều kiện trên obj.sql, không
    // phụ thuộc bindings có phải mảng hay không.
    //
    // Cách sửa đúng: câu CREATE ROLE cuối cùng PHẢI đi thẳng qua connection gốc
    // của driver `pg` (bỏ qua toàn bộ tầng biên dịch SQL của knex, tức bỏ qua
    // positionBindings) bằng knex.client.acquireConnection()/connection.query().
    // Văn bản SQL đã được ráp an toàn ở trên (identifier qua quote_ident,
    // literal mật khẩu qua quote_literal — cả hai lấy về bằng truy vấn THAM SỐ
    // HÓA thật), driver gốc chỉ gửi nguyên văn, không dò/thay thế "?" nào cả.
    const connection = await knex.client.acquireConnection();
    try {
      await connection.query(createRoleSql);
    } finally {
      knex.client.releaseConnection(connection);
    }
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
