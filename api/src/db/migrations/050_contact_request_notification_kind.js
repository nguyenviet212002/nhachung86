// Thông báo "xin xem thông tin liên hệ" (members/service.js#requestContact) từ
// trước tới nay dùng kind='system', target_type='notification' — không có
// cách nào để giao diện phân biệt "đây là một yêu cầu cần duyệt" với thông
// báo thường, nên nút bấm không dẫn đi đâu cả. Cùng khuôn mẫu migration 048
// đã làm cho game_challenge/game_turn: mở rộng 2 CHECK constraint, không tạo
// bảng riêng. target_type='contact_request' trỏ tới contact_requests.id.
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN ('message','content','activity','system','role','game_challenge','game_turn','contact_request'));
    ALTER TABLE notifications DROP CONSTRAINT notifications_target_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_target_type_check
      CHECK (target_type IS NULL OR target_type IN ('member','post','activity','message','notification','game','contact_request'));
  `);
}

export async function down(knex) {
  await knex.raw(`
    UPDATE notifications SET kind = 'system' WHERE kind = 'contact_request';
    UPDATE notifications SET target_type = 'notification' WHERE target_type = 'contact_request';
    ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN ('message','content','activity','system','role','game_challenge','game_turn'));
    ALTER TABLE notifications DROP CONSTRAINT notifications_target_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_target_type_check
      CHECK (target_type IS NULL OR target_type IN ('member','post','activity','message','notification','game'));
  `);
}
