// Chỉ mục, tìm kiếm, và NƠI DUY NHẤT chốt lại toàn bộ ma trận quyền —
// spec mục 11 dòng `024_indexes_and_revokes`, mục 8.1, 8.2, và bảng mục 4.8.
//
// VỀ MA TRẬN QUYỀN (Ruling C10). Các REVOKE ở migration trước GIỮ NGUYÊN, không
// gỡ: bỏ chúng đi sẽ để lộ một cửa sổ giữa các migration mà bảng nhạy cảm có đủ
// bốn quyền (ALTER DEFAULT PRIVILEGES cấp ngay lúc CREATE TABLE). Tệp này là
// nơi KHẲNG ĐỊNH LẠI toàn bộ, một cách bất biến, để đọc MỘT tệp là thấy hết.
//
// GRANTS ở dưới là một bảng dữ liệu chứ không phải một dãy câu lệnh rời — và
// cuối hàm up() có một câu TỰ KIỂM: liệt kê mọi bảng/view trong schema public
// và ném lỗi nếu có cái nào không nằm trong bảng. Không có câu đó thì "nơi duy
// nhất thấy hết ma trận quyền" là một lời hứa hết hạn ngay lần thêm bảng tiếp
// theo — người ta sẽ thêm bảng ở migration 027 và tệp này im lặng không nhắc.
//
// Phân mảnh của audit_log KHÔNG nằm trong bảng: tên chúng sinh theo tháng nên
// không khai tĩnh được. fn_audit_new_partition (migration 007) tự REVOKE ngay
// khi tạo phân mảnh mới, và t10-grants có bài riêng quét chúng.

const GRANTS = {
  // ---- gốc và hồ sơ -------------------------------------------------------
  communities:               ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  areas:                     ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  members:                   ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  // Chỉ vào được qua contact_read / contact_upsert. KHÔNG có gì, kể cả SELECT.
  member_contacts:           [],
  privacy_settings:          ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  contact_requests:          ['SELECT', 'INSERT', 'UPDATE'],
  profile_views:             ['SELECT', 'INSERT'],

  // ---- nhật ký ------------------------------------------------------------
  audit_log:                 ['SELECT', 'INSERT'],
  audit_chain_head:          ['SELECT', 'INSERT', 'UPDATE'],

  // ---- xác thực và vai ----------------------------------------------------
  refresh_tokens:            ['SELECT', 'INSERT', 'UPDATE'],
  otp_challenges:            ['SELECT', 'INSERT', 'UPDATE'],
  roles:                     ['SELECT'],
  member_roles:              ['SELECT'],
  permissions:               ['SELECT'],
  role_permissions:          ['SELECT'],

  // ---- gia nhập -----------------------------------------------------------
  join_requests:             ['SELECT', 'INSERT', 'UPDATE'],
  join_request_secrets:      ['INSERT'],
  guarantee_quota_overrides: ['SELECT', 'INSERT'],

  // ---- việc và quan hệ ----------------------------------------------------
  work_records:              ['SELECT', 'INSERT', 'UPDATE'],
  work_participants:         ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  work_confirmations:        ['SELECT', 'INSERT'],
  member_relations:          ['SELECT'],
  member_trust_stats:        ['SELECT'],

  // ---- năng lực -----------------------------------------------------------
  capabilities:              ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  capability_photos:         ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  capability_evidence:       ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],

  // ---- tín hiệu -----------------------------------------------------------
  signals:                   ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  signal_recipients:         ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  signal_responses:          ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  signal_options:            ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  signal_forwards:           ['SELECT', 'INSERT'],
  v_signal_recipients:       ['SELECT'],

  // ---- việc làm -----------------------------------------------------------
  job_needs:                 ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  ready_profiles:            ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  introductions:             ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  connections:               ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  connection_events:         ['SELECT', 'INSERT'],

  // ---- giúp nhau ----------------------------------------------------------
  aid_requests:              ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  aid_offers:                ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  aid_slots:                 ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  aid_slot_takers:           ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  aid_events:                ['SELECT', 'INSERT'],

  // ---- hoạt động ----------------------------------------------------------
  activities:                ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  activity_participants:     ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  activity_needs:            ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  activity_photos:           ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  activity_summaries:        ['SELECT', 'INSERT', 'UPDATE'],

  // ---- xác minh, bảo chứng, khiếu nại -------------------------------------
  verifications:             ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  endorsements:              ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  endorsement_signatures:    ['SELECT', 'INSERT'],
  complaints:                ['SELECT', 'INSERT', 'UPDATE'],
  complaint_events:          ['SELECT', 'INSERT'],

  // ---- ký ức --------------------------------------------------------------
  memories:                  ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  memory_versions:           ['SELECT', 'INSERT'],
  memory_photos:             ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  memory_photo_people:       ['SELECT', 'INSERT', 'UPDATE'],
  memory_consents:           ['SELECT', 'INSERT', 'UPDATE'],

  // ---- quỹ ----------------------------------------------------------------
  fund_entries:              ['SELECT', 'INSERT', 'UPDATE'],
  fund_entry_approvals:      ['SELECT', 'INSERT'],
  transparency_reports:      ['SELECT', 'INSERT', 'UPDATE'],
  report_versions:           ['SELECT', 'INSERT'],

  // ---- vay ----------------------------------------------------------------
  subject_keys:              ['SELECT', 'INSERT', 'UPDATE'],
  loans:                     ['SELECT', 'INSERT', 'UPDATE'],
  loan_guarantors:           ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  loan_repayments:           ['SELECT', 'INSERT'],

  // ---- vận hành -----------------------------------------------------------
  pending_actions:           ['SELECT', 'INSERT', 'UPDATE'],
  pending_action_signatures: ['SELECT', 'INSERT'],
  backups:                   ['SELECT', 'INSERT'],
  restore_tests:             ['SELECT', 'INSERT'],
  moderation_queue:          ['SELECT', 'INSERT', 'UPDATE'],
};

export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  // -------------------------------------------------------------------------
  // 8.1 — tìm kiếm tiếng Việt. f_unaccent (IMMUTABLE, migration 001) là điều
  // kiện để đánh chỉ mục được; unaccent() gốc KHÔNG immutable.
  //
  // Nhãn IMMUTABLE là LỜI HỨA CỦA TA, không phải sự thật tuyệt đối: nếu từ điển
  // unaccent đổi thì phải REINDEX. README phải ghi (spec mục 8.1).
  // -------------------------------------------------------------------------
  await knex.raw(`
    ALTER TABLE capabilities ADD COLUMN search_vec tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', f_unaccent(coalesce(title,''))),       'A') ||
        setweight(to_tsvector('simple', f_unaccent(coalesce(description,''))), 'B')
      ) STORED;
    CREATE INDEX idx_cap_search ON capabilities USING GIN (search_vec);

    ALTER TABLE job_needs ADD COLUMN search_vec tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', f_unaccent(coalesce(title,''))),       'A') ||
        setweight(to_tsvector('simple', f_unaccent(coalesce(description,''))), 'B')
      ) STORED;
    CREATE INDEX idx_job_search ON job_needs USING GIN (search_vec);

    ALTER TABLE activities ADD COLUMN search_vec tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', f_unaccent(coalesce(title,''))),       'A') ||
        setweight(to_tsvector('simple', f_unaccent(coalesce(description,''))), 'B')
      ) STORED;
    CREATE INDEX idx_act_search ON activities USING GIN (search_vec);
  `);

  await knex.raw(`
    -- "Gõ sai chính tả, gõ tắt" (mục 8.2). Bộ lọc q của GET /members dùng
    -- ILIKE '%…%' trên f_unaccent(full_name); chỉ mục trigram là thứ duy nhất
    -- đỡ được mẫu có % ở đầu.
    CREATE INDEX idx_members_name_trgm ON members
      USING GIN (f_unaccent(full_name) gin_trgm_ops);

    -- "Khoảng cách địa lý" (mục 8.2). lat/lng KHÔNG ra tới client (Ruling
    -- T9-e); chỉ mục này là để tính khoảng cách phía máy chủ.
    CREATE INDEX idx_members_geo ON members
      USING GiST (ll_to_earth(lat, lng)) WHERE lat IS NOT NULL AND lng IS NOT NULL;
  `);

  // -------------------------------------------------------------------------
  // MA TRẬN QUYỀN. REVOKE ALL rồi GRANT đúng phần — bất biến, chạy lại bao
  // nhiêu lần cũng cho cùng kết quả. Đi qua bảng dữ liệu ở đầu tệp.
  // -------------------------------------------------------------------------
  for (const [table, privs] of Object.entries(GRANTS)) {
    await knex.raw(`REVOKE ALL ON ?? FROM ??`, [table, user]);
    if (privs.length > 0) {
      await knex.raw(`GRANT ${privs.join(', ')} ON ?? TO ??`, [table, user]);
    }
  }

  // -------------------------------------------------------------------------
  // TỰ KIỂM: bảng ở trên phải phủ HẾT schema. Không có câu này thì câu "đọc một
  // tệp là thấy hết ma trận quyền" hết hạn ngay lần thêm bảng tiếp theo, và
  // bảng mới sẽ mang đủ bốn quyền của ALTER DEFAULT PRIVILEGES mà không ai
  // quyết định điều đó.
  //
  // Ném lỗi chứ không cảnh báo: migration hỏng thì người ta sửa, còn cảnh báo
  // trong output của knex thì không ai đọc.
  // -------------------------------------------------------------------------
  const { rows } = await knex.raw(`
    SELECT c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v') AND NOT c.relispartition
       AND c.relname NOT IN ('knex_migrations','knex_migrations_lock')
  `);
  const missing = rows.map((r) => r.name).filter((t) => !(t in GRANTS));
  if (missing.length > 0) {
    throw new Error(
      `migration 024: các bảng/view sau chưa có mặt trong ma trận quyền: ${missing.join(', ')}. `
      + 'Thêm chúng vào GRANTS trong chính tệp này — đây là nơi duy nhất khai quyền theo bảng.'
    );
  }
}

export async function down(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS idx_members_geo;
    DROP INDEX IF EXISTS idx_members_name_trgm;
    DROP INDEX IF EXISTS idx_act_search;
    DROP INDEX IF EXISTS idx_job_search;
    DROP INDEX IF EXISTS idx_cap_search;
    ALTER TABLE activities   DROP COLUMN IF EXISTS search_vec;
    ALTER TABLE job_needs    DROP COLUMN IF EXISTS search_vec;
    ALTER TABLE capabilities DROP COLUMN IF EXISTS search_vec;
  `);
}
