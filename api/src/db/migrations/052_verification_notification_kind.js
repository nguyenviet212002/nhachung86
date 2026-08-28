// Xác minh hồ sơ: bảng `verifications` đã có sẵn từ
// 018_verify_endorse_complaints.js (chưa từng có endpoint dùng tới) —
// migration này KHÔNG tạo bảng mới, chỉ mở rộng CHECK constraint của
// `notifications` để báo được cho người nộp khi yêu cầu xác minh được xử lý,
// cùng khuôn 048/050/051.
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN ('message','content','activity','system','role','game_challenge','game_turn','contact_request','complaint','verification'));
    ALTER TABLE notifications DROP CONSTRAINT notifications_target_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_target_type_check
      CHECK (target_type IS NULL OR target_type IN ('member','post','activity','message','notification','game','contact_request','complaint','verification'));
  `);
}

export async function down(knex) {
  await knex.raw(`
    UPDATE notifications SET kind = 'system' WHERE kind = 'verification';
    UPDATE notifications SET target_type = 'notification' WHERE target_type = 'verification';
    ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN ('message','content','activity','system','role','game_challenge','game_turn','contact_request','complaint'));
    ALTER TABLE notifications DROP CONSTRAINT notifications_target_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_target_type_check
      CHECK (target_type IS NULL OR target_type IN ('member','post','activity','message','notification','game','contact_request','complaint'));
  `);
}
