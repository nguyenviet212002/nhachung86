// Thông báo "có đơn xin vay mới" (báo approver/tech) và "đơn vay đã được
// duyệt/từ chối" (báo người vay) — cùng khuôn 048/050/052/053: mở rộng CHECK
// constraint, không tạo bảng riêng. target_type='loan' trỏ tới loans.id.
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN ('message','content','activity','system','role','game_challenge','game_turn','contact_request','complaint','verification','join_request','loan'));
    ALTER TABLE notifications DROP CONSTRAINT notifications_target_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_target_type_check
      CHECK (target_type IS NULL OR target_type IN ('member','post','activity','message','notification','game','contact_request','complaint','verification','join_request','loan'));
  `);
}

export async function down(knex) {
  await knex.raw(`
    UPDATE notifications SET kind = 'system' WHERE kind = 'loan';
    UPDATE notifications SET target_type = 'notification' WHERE target_type = 'loan';
    ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN ('message','content','activity','system','role','game_challenge','game_turn','contact_request','complaint','verification','join_request'));
    ALTER TABLE notifications DROP CONSTRAINT notifications_target_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_target_type_check
      CHECK (target_type IS NULL OR target_type IN ('member','post','activity','message','notification','game','contact_request','complaint','verification','join_request'));
  `);
}
