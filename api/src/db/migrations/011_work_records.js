// Ba bảng việc — spec mục 4.1. Đây là gốc của bậc uy tín: capability_evidence
// trỏ tới work_records, và member_trust_stats đếm trên chúng.
//
// Vì sao BA bảng chứ không phải một hàng có hai cột confirmed_a/confirmed_b:
// hai cột đó cho phép tồn tại trạng thái "mới một bên xác nhận", đúng cái
// nguyên tắc 2 cấm. Tách ba tầng thì "đã xác nhận" là một HÀNG CÓ THẬT của
// người đó, không phải một ô cờ ai cũng bật được.
//
// CHƯA gắn trigger nào ở đây, có chủ đích:
//   * fn_work_edge (sinh cạnh worked_together), fn_self_only,
//     fn_work_record_frozen, fn_manual_pair_quota — Task 12, tệp
//     025_work_triggers.js (Ruling C8: không sửa migration đã chạy).
//   * Mục 11 đặc tả xếp ba hàm sau vào 011; đó là lệch giữa mục 11 và chính
//     kế hoạch Task 9/Task 12, và Ruling C8 đã chọn Task 12. Giai đoạn 1 không
//     có endpoint nào ghi vào ba bảng này nên khoảng trống đó không mở cửa nào.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE work_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      source_type text NOT NULL CHECK (source_type IN ('signal','connection','aid','activity','manual')),
      source_id uuid,
      title text NOT NULL,
      done_on date NOT NULL,
      created_by uuid NOT NULL,
      reviewed_by uuid REFERENCES members(id),
      reviewed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT wr_id_cid UNIQUE (id, community_id),
      -- Lệch có chủ đích khỏi spec (spec viết created_by REFERENCES members(id)
      -- đơn cột): người TẠO bản ghi việc phải cùng cộng đồng với bản ghi, nếu
      -- không thì hạn mức manual mỗi cặp (mục 4.4) đếm bằng luật của cộng đồng
      -- này trên người của cộng đồng kia — đúng họ lỗi của Ruling T7-a/T8-d.
      CONSTRAINT wr_creator_same_community
        FOREIGN KEY (created_by, community_id) REFERENCES members (id, community_id),
      CONSTRAINT wr_manual_review CHECK (
        source_type <> 'manual' OR (reviewed_by IS NULL) = (reviewed_at IS NULL))
    );
    CREATE INDEX idx_wr_community ON work_records (community_id, done_on DESC);

    CREATE TABLE work_participants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      -- Lệch có chủ đích khỏi spec (spec bỏ REFERENCES ở cột này): luật toàn
      -- cục ở bảng đối chiếu mục 4.5 đòi MỌI cột community_id là
      -- NOT NULL REFERENCES communities(id). Hai khóa ngoại ghép bên dưới đã
      -- ràng đủ, nhưng khóa ngoại tường minh làm luật đó đúng cả khi đọc lược đồ.
      community_id uuid NOT NULL REFERENCES communities(id),
      work_record_id uuid NOT NULL,
      member_id uuid NOT NULL,
      role text NOT NULL CHECK (role IN ('doer','receiver')),
      UNIQUE (work_record_id, member_id),
      FOREIGN KEY (work_record_id, community_id) REFERENCES work_records (id, community_id),
      FOREIGN KEY (member_id, community_id)      REFERENCES members      (id, community_id)
    );
    CREATE INDEX idx_wp_member ON work_participants (member_id);

    CREATE TABLE work_confirmations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      work_record_id uuid NOT NULL,
      member_id uuid NOT NULL,
      confirmed_at timestamptz NOT NULL DEFAULT now(),
      note text,
      UNIQUE (work_record_id, member_id),
      -- Khóa ngoại này là câu trả lời cho "xác nhận việc mình không tham gia":
      -- không có hàng work_participants tương ứng thì không chèn được.
      CONSTRAINT work_confirmations_wr_member_fkey
        FOREIGN KEY (work_record_id, member_id)
          REFERENCES work_participants (work_record_id, member_id),
      -- Bổ sung so với spec: cùng lý do như trên — community_id của xác nhận
      -- phải là community_id của chính bản ghi việc, không phải một giá trị
      -- rời do ứng dụng điền.
      CONSTRAINT wc_record_same_community
        FOREIGN KEY (work_record_id, community_id) REFERENCES work_records (id, community_id)
    );
  `);

  // Xác nhận là BÚT TOÁN: ghi rồi thì không sửa, không gỡ — nếu gỡ được thì
  // "đủ mọi người xác nhận" (điều kiện sinh cạnh worked_together) trở thành
  // trạng thái tạm thời. Bản ghi việc thì không xoá được để không ai nắn số liệu
  // bậc uy tín bằng cách xoá lịch sử; sửa thì còn được nhưng sẽ bị
  // fn_work_record_frozen (Task 12) chặn khi đã có xác nhận.
  await knex.raw(`REVOKE UPDATE, DELETE ON work_confirmations FROM ??`, [user]);
  await knex.raw(`REVOKE DELETE ON work_records FROM ??`, [user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS work_confirmations;
    DROP TABLE IF EXISTS work_participants;
    DROP TABLE IF EXISTS work_records;
  `);
}
