// Task 11 (Sảnh Cờ Kernel — rời phòng): leaveRoom() xoá thẳng game_moves rồi
// games khi phòng bị rời TRƯỚC lúc vào trận (status='pending') — đây là thao
// tác DELETE ĐẦU TIÊN trên hai bảng này kể từ khi tạo. 048_chess_games.js chỉ
// cấp SELECT, INSERT, UPDATE cho app_role (đúng triết lý ghi ngay đầu file đó:
// "CSDL chỉ canh chuyển trạng thái (status/turn) bằng UPDATE có điều kiện
// WHERE, giống các module khác trong dự án") — không có DELETE vì tới lúc đó
// chưa module nào trong games/ cần xoá hàng, chỉ chuyển trạng thái.
//
// Phát hiện lúc chạy Step 5 của task-11-brief.md: chạy đúng mã leaveRoom()
// nguyên văn theo brief cho lỗi 500 "permission denied for table game_moves"
// — brief không đề cập thay đổi migration nào, chỉ liệt service.js/routes.js.
// Không REVOKE ALL rồi GRANT lại từ đầu (không cần — chỉ CỘNG THÊM đúng một
// quyền còn thiếu, giữ nguyên SELECT/INSERT/UPDATE đã cấp ở 048).
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`GRANT DELETE ON games, game_moves TO ??`, [user]);
}

export async function down(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`REVOKE DELETE ON games, game_moves FROM ??`, [user]);
}
