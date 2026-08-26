// Cờ tướng online — thách đấu, chơi thật giữa 2 tài khoản, xem trực tiếp.
// Xem docs/superpowers/specs/2026-08-26-co-tuong-online-design.md.
// Luật cờ (mã cản chân, tượng qua sông, chiếu tướng...) KHÔNG nằm ở CSDL —
// bàn cờ chỉ là jsonb, luật nằm ở api/src/modules/games/rules.js (mục 4 của
// spec). CSDL chỉ canh chuyển trạng thái (status/turn) bằng UPDATE có điều
// kiện WHERE, giống các module khác trong dự án.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE games (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      red_member_id uuid NOT NULL,
      black_member_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','finished')),
      board jsonb,
      turn text NOT NULL DEFAULT 'r' CHECK (turn IN ('r','b')),
      winner_member_id uuid,
      end_reason text CHECK (end_reason IS NULL OR end_reason IN ('chieu-bi','het-nuoc-di','resign','declined')),
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      finished_at timestamptz,
      CONSTRAINT games_id_cid UNIQUE (id, community_id),
      CONSTRAINT games_players_distinct CHECK (red_member_id <> black_member_id),
      FOREIGN KEY (red_member_id, community_id) REFERENCES members(id, community_id),
      FOREIGN KEY (black_member_id, community_id) REFERENCES members(id, community_id),
      FOREIGN KEY (winner_member_id, community_id) REFERENCES members(id, community_id)
    );
    CREATE INDEX idx_games_community_status ON games (community_id, status, created_at DESC);
    CREATE INDEX idx_games_red ON games (red_member_id, status);
    CREATE INDEX idx_games_black ON games (black_member_id, status);

    CREATE TABLE game_moves (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      game_id uuid NOT NULL,
      seq int NOT NULL,
      side text NOT NULL CHECK (side IN ('r','b')),
      from_r int NOT NULL,
      from_c int NOT NULL,
      to_r int NOT NULL,
      to_c int NOT NULL,
      captured_type text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT game_moves_game_seq UNIQUE (game_id, seq),
      FOREIGN KEY (game_id, community_id) REFERENCES games(id, community_id)
    );
    CREATE INDEX idx_game_moves_game ON game_moves (game_id, seq);
  `);

  await knex.raw(`REVOKE ALL ON games, game_moves FROM ??`, [user]);
  await knex.raw(`GRANT SELECT, INSERT, UPDATE ON games, game_moves TO ??`, [user]);

  // Lời thách đấu (game_challenge) và "tới lượt bạn"/"ván đã xong" (game_turn)
  // dùng lại đúng bảng notifications đang có — chỉ mở rộng 2 CHECK constraint,
  // không tạo bảng riêng. target_type='game' trỏ tới games.id.
  await knex.raw(`
    ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN ('message','content','activity','system','role','game_challenge','game_turn'));
    ALTER TABLE notifications DROP CONSTRAINT notifications_target_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_target_type_check
      CHECK (target_type IS NULL OR target_type IN ('member','post','activity','message','notification','game'));
  `);
}

export async function down(knex) {
  await knex.raw(`
    ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN ('message','content','activity','system','role'));
    ALTER TABLE notifications DROP CONSTRAINT notifications_target_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_target_type_check
      CHECK (target_type IS NULL OR target_type IN ('member','post','activity','message','notification'));
    DROP TABLE IF EXISTS game_moves;
    DROP TABLE IF EXISTS games;
  `);
}
