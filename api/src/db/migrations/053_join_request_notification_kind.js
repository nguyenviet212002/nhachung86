// Thông báo "đơn gia nhập đã được duyệt/từ chối" (join-requests/service.js
// #notifyJoinRequestDecision) dùng kind='system' tạm thời — không phân biệt
// được với thông báo hệ thống chung, giao diện không biết đưa người dùng đi
// đâu khi bấm vào. Cùng khuôn mẫu 048/050/052: mở rộng CHECK constraint,
// không tạo bảng riêng. target_type='join_request' trỏ tới join_requests.id
// (đơn đã bị xoá thì không còn gì để trỏ tới nữa, cũng như contact_request).
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN ('message','content','activity','system','role','game_challenge','game_turn','contact_request','complaint','verification','join_request'));
    ALTER TABLE notifications DROP CONSTRAINT notifications_target_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_target_type_check
      CHECK (target_type IS NULL OR target_type IN ('member','post','activity','message','notification','game','contact_request','complaint','verification','join_request'));
  `);
}

export async function down(knex) {
  await knex.raw(`
    UPDATE notifications SET kind = 'system' WHERE kind = 'join_request';
    UPDATE notifications SET target_type = 'notification' WHERE target_type = 'join_request';
    ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN ('message','content','activity','system','role','game_challenge','game_turn','contact_request','complaint','verification'));
    ALTER TABLE notifications DROP CONSTRAINT notifications_target_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_target_type_check
      CHECK (target_type IS NULL OR target_type IN ('member','post','activity','message','notification','game','contact_request','complaint','verification'));
  `);
}
