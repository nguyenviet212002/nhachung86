// Mở rộng games/game_moves cho Kernel Sảnh Cờ: phòng có khách vào bằng link
// (không cần tài khoản), đồng hồ đếm ngược, cầu hoà, mất kết nối, máy đi hộ,
// và 2 cột hỗ trợ 3 luật còn thiếu (lặp thế/trường chiếu/60 nước).
// Xem docs/superpowers/specs/2026-09-07-sanh-co-kernel-engine-design.md.
//
// invite_token_hash lưu SHA-256 của token — không lưu token thô, cùng khuôn
// modules/invites/token.js (link mời bảo lãnh, migration 031) chứ không phải
// mã ngắn kiểu "G-4a91" như bản nháp NHACCON6789: khách vào phòng bằng BẤM
// LINK (không gõ tay), nên không có lý do đánh đổi độ khó đoán lấy độ ngắn.
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE games ALTER COLUMN black_member_id DROP NOT NULL;
    ALTER TABLE games ADD COLUMN black_guest_name text;
    ALTER TABLE games ADD COLUMN black_guest_token uuid;
    ALTER TABLE games ADD COLUMN invite_token_hash text UNIQUE;
    ALTER TABLE games ADD COLUMN red_time_ms int NOT NULL DEFAULT 600000;
    ALTER TABLE games ADD COLUMN black_time_ms int NOT NULL DEFAULT 600000;
    ALTER TABLE games ADD COLUMN turn_started_at timestamptz;
    ALTER TABLE games ADD COLUMN second_joined_at timestamptz;
    ALTER TABLE games ADD COLUMN red_ready_at timestamptz;
    ALTER TABLE games ADD COLUMN black_ready_at timestamptz;
    ALTER TABLE games ADD COLUMN draw_offered_by text CHECK (draw_offered_by IS NULL OR draw_offered_by IN ('r','b'));
    ALTER TABLE games ADD COLUMN disconnected_side text CHECK (disconnected_side IS NULL OR disconnected_side IN ('r','b'));
    ALTER TABLE games ADD COLUMN disconnected_at timestamptz;
    ALTER TABLE games ADD COLUMN red_ai_level text CHECK (red_ai_level IS NULL OR red_ai_level IN ('sieu','thong-minh','xuat-sac'));
    ALTER TABLE games ADD COLUMN black_ai_level text CHECK (black_ai_level IS NULL OR black_ai_level IN ('sieu','thong-minh','xuat-sac'));

    ALTER TABLE games DROP CONSTRAINT games_end_reason_check;
    ALTER TABLE games ADD CONSTRAINT games_end_reason_check
      CHECK (end_reason IS NULL OR end_reason IN (
        'chieu-bi','het-nuoc-di','resign','declined','bat-tuong',
        'hoa-3-lan','hoa-60-nuoc','truong-chieu','het-gio','mat-ket-noi','roi-phong','hoa-thoa-thuan'
      ));

    ALTER TABLE game_moves ADD COLUMN is_check boolean NOT NULL DEFAULT false;
    ALTER TABLE game_moves ADD COLUMN board_hash text;

    DROP INDEX idx_games_active_pair;
    CREATE UNIQUE INDEX idx_games_active_pair
      ON games (community_id, LEAST(red_member_id, black_member_id), GREATEST(red_member_id, black_member_id))
      WHERE status IN ('pending', 'active') AND black_member_id IS NOT NULL;
  `);
}

// Lưu ý: dòng cuối SET NOT NULL sẽ lỗi nếu còn phòng-khách (black_member_id
// NULL) tồn tại lúc lùi migration — chấp nhận được, down() giả định môi
// trường sạch (test/dev reset), giống down() của 048 (DROP TABLE thẳng).
export async function down(knex) {
  await knex.raw(`
    DROP INDEX idx_games_active_pair;
    CREATE UNIQUE INDEX idx_games_active_pair
      ON games (community_id, LEAST(red_member_id, black_member_id), GREATEST(red_member_id, black_member_id))
      WHERE status IN ('pending', 'active');

    ALTER TABLE game_moves DROP COLUMN board_hash;
    ALTER TABLE game_moves DROP COLUMN is_check;

    ALTER TABLE games DROP CONSTRAINT games_end_reason_check;
    ALTER TABLE games ADD CONSTRAINT games_end_reason_check
      CHECK (end_reason IS NULL OR end_reason IN ('chieu-bi','het-nuoc-di','resign','declined','bat-tuong'));

    ALTER TABLE games DROP COLUMN black_ai_level;
    ALTER TABLE games DROP COLUMN red_ai_level;
    ALTER TABLE games DROP COLUMN disconnected_at;
    ALTER TABLE games DROP COLUMN disconnected_side;
    ALTER TABLE games DROP COLUMN draw_offered_by;
    ALTER TABLE games DROP COLUMN black_ready_at;
    ALTER TABLE games DROP COLUMN red_ready_at;
    ALTER TABLE games DROP COLUMN second_joined_at;
    ALTER TABLE games DROP COLUMN turn_started_at;
    ALTER TABLE games DROP COLUMN black_time_ms;
    ALTER TABLE games DROP COLUMN red_time_ms;
    ALTER TABLE games DROP COLUMN invite_token_hash;
    ALTER TABLE games DROP COLUMN black_guest_token;
    ALTER TABLE games DROP COLUMN black_guest_name;
    ALTER TABLE games ALTER COLUMN black_member_id SET NOT NULL;
  `);
}
