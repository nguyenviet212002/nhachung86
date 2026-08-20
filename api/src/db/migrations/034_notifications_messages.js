// Thông báo và tin nhắn trực tiếp. Append-only cho nội dung; chỉ người nhận
// được cập nhật read_at. Realtime vẫn có thể chạy nhiều instance sau này khi
// thay EventEmitter bằng pub/sub, còn hợp đồng HTTP không đổi.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      recipient_id uuid NOT NULL,
      actor_id uuid,
      kind text NOT NULL CHECK (kind IN ('message','content','activity','system','role')),
      title text NOT NULL CHECK (length(title) BETWEEN 2 AND 160),
      body text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
      target_type text CHECK (target_type IS NULL OR target_type IN ('member','post','activity','message','notification')),
      target_id uuid,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT notifications_id_cid UNIQUE (id, community_id),
      FOREIGN KEY (recipient_id, community_id) REFERENCES members(id, community_id),
      FOREIGN KEY (actor_id, community_id) REFERENCES members(id, community_id)
    );
    CREATE INDEX idx_notifications_recipient_unread
      ON notifications (recipient_id, created_at DESC) WHERE read_at IS NULL;
    CREATE INDEX idx_notifications_recipient_time
      ON notifications (recipient_id, created_at DESC);

    CREATE TABLE direct_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      sender_id uuid NOT NULL,
      recipient_id uuid NOT NULL,
      body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
      created_at timestamptz NOT NULL DEFAULT now(),
      read_at timestamptz,
      CONSTRAINT direct_messages_id_cid UNIQUE (id, community_id),
      CONSTRAINT direct_messages_not_self CHECK (sender_id <> recipient_id),
      FOREIGN KEY (sender_id, community_id) REFERENCES members(id, community_id),
      FOREIGN KEY (recipient_id, community_id) REFERENCES members(id, community_id)
    );
    CREATE INDEX idx_direct_messages_pair
      ON direct_messages (community_id, sender_id, recipient_id, created_at DESC);
    CREATE INDEX idx_direct_messages_recipient_unread
      ON direct_messages (community_id, recipient_id, created_at DESC) WHERE read_at IS NULL;
  `);

  await knex.raw(`REVOKE ALL ON notifications, direct_messages FROM ??`, [user]);
  await knex.raw(`GRANT SELECT, INSERT, UPDATE ON notifications, direct_messages TO ??`, [user]);
}

export async function down(knex) {
  await knex.raw('DROP TABLE IF EXISTS direct_messages; DROP TABLE IF EXISTS notifications;');
}
