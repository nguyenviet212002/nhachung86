// Cờ Thế — module mới ngang hàng games, tái dùng games/rules.js (luật cờ)
// và games/engineClient.js (gọi Pikafish). Xem
// docs/superpowers/specs/2026-09-07-co-the-design.md.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE co_the_positions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      created_by_member_id uuid,
      board jsonb NOT NULL,
      side_to_move text NOT NULL CHECK (side_to_move IN ('r','b')),
      origin text NOT NULL DEFAULT 'tu-soan' CHECK (origin IN ('tu-soan','kho-co-dien')),
      category text CHECK (category IS NULL OR category IN ('tan-cuoc-it-quan','sat-cuoc','nghe-thuat','nhieu-nghiem','loi')),
      label text,
      saved_to_library boolean NOT NULL DEFAULT false,
      verdict text CHECK (verdict IS NULL OR verdict IN ('thang','hoa','thua')),
      verdict_certainty text CHECK (verdict_certainty IS NULL OR verdict_certainty IN ('chung-minh','uoc-luong')),
      verdict_score_cp int,
      verdict_mate int,
      verdict_depth int,
      engine_version text,
      engine_movetime_ms int,
      analyzed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT co_the_positions_id_cid UNIQUE (id, community_id),
      FOREIGN KEY (created_by_member_id, community_id) REFERENCES members(id, community_id)
    );
    CREATE INDEX idx_co_the_positions_community ON co_the_positions (community_id, saved_to_library, created_at DESC);

    CREATE TABLE co_the_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      position_id uuid NOT NULL,
      solver_member_id uuid NOT NULL,
      solver_side text NOT NULL CHECK (solver_side IN ('r','b')),
      mode text NOT NULL CHECK (mode IN ('giai','luyen-the')),
      opponent_level text CHECK (opponent_level IS NULL OR opponent_level IN ('yeu','vua','manh')),
      luyen_the_cap text CHECK (luyen_the_cap IS NULL OR luyen_the_cap IN ('ha','trung','cao')),
      status text NOT NULL DEFAULT 'dang-choi' CHECK (status IN ('dang-choi','ket-thuc')),
      board jsonb NOT NULL,
      turn text NOT NULL CHECK (turn IN ('r','b')),
      result text CHECK (result IS NULL OR result IN ('thang','hoa','thua')),
      end_reason text CHECK (end_reason IS NULL OR end_reason IN
        ('giai-dung','mat-the-thang','chieu-bi','het-nuoc-di','hoa-3-lan','hoa-60-nuoc','truong-chieu','bo-cuoc','luyen-the-xong')),
      invite_token text UNIQUE,
      guest_token uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      ended_at timestamptz,
      CONSTRAINT co_the_sessions_id_cid UNIQUE (id, community_id),
      FOREIGN KEY (position_id, community_id) REFERENCES co_the_positions(id, community_id),
      FOREIGN KEY (solver_member_id, community_id) REFERENCES members(id, community_id)
    );
    CREATE INDEX idx_co_the_sessions_solver ON co_the_sessions (solver_member_id, status, created_at DESC);
    CREATE INDEX idx_co_the_sessions_position ON co_the_sessions (position_id);

    CREATE TABLE co_the_moves (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      session_id uuid NOT NULL,
      seq int NOT NULL,
      side text NOT NULL CHECK (side IN ('r','b')),
      from_r int NOT NULL,
      from_c int NOT NULL,
      to_r int NOT NULL,
      to_c int NOT NULL,
      captured_type text,
      is_check boolean NOT NULL DEFAULT false,
      board_hash text NOT NULL,
      score_cp int,
      mate int,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT co_the_moves_session_seq UNIQUE (session_id, seq),
      FOREIGN KEY (session_id, community_id) REFERENCES co_the_sessions(id, community_id)
    );
    CREATE INDEX idx_co_the_moves_session ON co_the_moves (session_id, seq);
  `);

  await knex.raw(`REVOKE ALL ON co_the_positions, co_the_sessions, co_the_moves FROM ??`, [user]);
  await knex.raw(`GRANT SELECT, INSERT, UPDATE ON co_the_positions, co_the_sessions, co_the_moves TO ??`, [user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS co_the_moves;
    DROP TABLE IF EXISTS co_the_sessions;
    DROP TABLE IF EXISTS co_the_positions;
  `);
}
