// member_trust_stats — NƠI DUY NHẤT ĐẾM (spec mục 8.3, và "lớp 1" của mục 4.4).
//
// Chia hai tầng, một nguồn sự thật cho mỗi tầng:
//   * CSDL giữ CON SỐ THÔ (confirmed_works, manual_works, ...).
//   * JavaScript (api/src/core/trust.js) giữ NGƯỠNG BẬC.
// Không nơi nào lặp lại logic của nơi kia — nên trong tệp này không có một tên
// bậc hay một ngưỡng nào, và trong core/trust.js không có một câu SQL nào.
// (t12-trust có một bài quét đúng điều đó trên toàn bộ thư mục migrations.)
//
// Luật "manual phải qua approver" (mục 4.4 lớp 1) nằm GỌN ở fn_trust_recount:
// việc được tính khi đủ xác nhận của MỌI người tham gia VÀ
// (source_type <> 'manual' HOẶC reviewed_at IS NOT NULL). Nếu luật này còn nằm
// ở một chỗ thứ hai (vd. tầng service lọc lại) thì hai chỗ sẽ có ngày lệch.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE member_trust_stats (
      member_id uuid PRIMARY KEY,
      community_id uuid NOT NULL REFERENCES communities(id),
      confirmed_works int NOT NULL DEFAULT 0,
      manual_works int NOT NULL DEFAULT 0,
      distinct_requesters int NOT NULL DEFAULT 0,
      repeat_requesters int NOT NULL DEFAULT 0,
      computed_at timestamptz NOT NULL DEFAULT now(),
      -- Khóa ngoại GHÉP, không phải REFERENCES members(id) đơn cột như kế
      -- hoạch viết: với khóa đơn cột, hàng thống kê của một người thuộc cộng
      -- đồng A ghi được community_id của cộng đồng B — và bảng này chính là
      -- thứ hồ sơ đọc để hiện bậc uy tín. Cùng họ lỗi Ruling T7-a/T8-d/T10-a.
      CONSTRAINT mts_member_same_community
        FOREIGN KEY (member_id, community_id) REFERENCES members (id, community_id)
        ON DELETE CASCADE
    );
  `);

  // Bảng này là CACHE DẪN XUẤT, không phải dữ liệu do ứng dụng khai. Nếu
  // app_role ghi được thì "số việc đã xác nhận" trở thành con số ai cũng đặt
  // được, và cả mục 4.4 (manual phải qua approver) thành trang trí — đi vòng
  // chỉ cần một câu UPDATE. Cùng lập luận với member_relations ở migration 012.
  await knex.raw(`REVOKE INSERT, UPDATE, DELETE ON member_trust_stats FROM ??`, [user]);
  await knex.raw(`GRANT SELECT ON member_trust_stats TO ??`, [user]);

  // ---------------------------------------------------------------------------
  // fn_trust_recount — Ruling C9: viết bằng CTE nhiều tầng, KHÔNG dùng
  // `count(*) OVER (PARTITION BY ...)` bên trong LATERAL như kế hoạch viết.
  // Trong LATERAL đã lọc còn đúng một work_record thì cửa sổ đó luôn bằng 1,
  // nên repeat_requesters sẽ VĨNH VIỄN bằng 0 — một chỉ số của mục 8.3 im lặng
  // sai mà không có gì báo.
  //
  // SECURITY DEFINER vì nó ghi member_trust_stats (app_role vừa bị thu quyền
  // ghi ở trên). Theo luật của dự án, mọi hàm SECURITY DEFINER phải TỰ KIỂM
  // CỘNG ĐỒNG bên trong (Ruling T10-a: REVOKE không đỡ được hàm chạy bằng
  // quyền chủ bảng): v_cid lấy từ chính p_member, rồi MỌI mặt cắt bên dưới
  // (work_records, work_participants của người khác) đều lọc theo v_cid.
  // ---------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_trust_recount(p_member uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE v_cid uuid;
    BEGIN
      SELECT community_id INTO v_cid FROM members WHERE id = p_member;
      IF v_cid IS NULL THEN RETURN; END IF;   -- không có người thì không có gì để đếm

      INSERT INTO member_trust_stats (member_id, community_id, confirmed_works, manual_works,
                                      distinct_requesters, repeat_requesters, computed_at)
      WITH done AS (
        -- Việc mà p_member tham gia VÀ đã đủ xác nhận của MỌI người tham gia.
        -- Thiếu một người thì hàng này không tồn tại — cùng điều kiện với
        -- fn_work_edge, để "có cạnh" và "được tính việc" không bao giờ lệch nhau.
        SELECT w.id, w.source_type, w.reviewed_at, me.role AS my_role
          FROM work_records w
          JOIN work_participants me ON me.work_record_id = w.id
                                   AND me.member_id = p_member
                                   AND me.community_id = v_cid
         WHERE w.community_id = v_cid
           AND NOT EXISTS (
                 SELECT 1 FROM work_participants p
                  WHERE p.work_record_id = w.id
                    AND NOT EXISTS (SELECT 1 FROM work_confirmations c
                                     WHERE c.work_record_id = p.work_record_id
                                       AND c.member_id = p.member_id))
      ),
      counted AS (
        -- LỚP 1 của mục 4.4, và đây là chỗ DUY NHẤT nó được viết ra.
        SELECT * FROM done WHERE source_type <> 'manual' OR reviewed_at IS NOT NULL
      ),
      reqs AS (
        -- "Người đã NHỜ" = người mang vai 'receiver' trên việc mà p_member mang
        -- vai 'doer'. Kế hoạch đếm mọi người tham gia khác bất kể vai, tức người
        -- đã GIÚP mình cũng bị đếm là người đã NHỜ mình — hai chiều ngược nhau
        -- gộp làm một thì chỉ số mất hết ý nghĩa. Xem task-12-report.
        --
        -- Đếm trên CTE counted chứ không trên done: một bản ghi manual chưa qua
        -- approver là đúng thứ mục 4.4 sinh ra để không tin, nên nó cũng không
        -- được đẻ ra tín hiệu uy tín ở cửa bên cạnh.
        SELECT o.member_id, count(DISTINCT c.id) AS n
          FROM counted c
          JOIN work_participants o ON o.work_record_id = c.id
                                  AND o.member_id <> p_member
                                  AND o.role = 'receiver'
                                  AND o.community_id = v_cid
         WHERE c.my_role = 'doer'
         GROUP BY o.member_id
      )
      SELECT p_member, v_cid,
             (SELECT count(*) FROM counted),
             (SELECT count(*) FROM done WHERE source_type = 'manual'),
             (SELECT count(*) FROM reqs),
             (SELECT count(*) FROM reqs WHERE n >= 2),
             now()
      ON CONFLICT (member_id) DO UPDATE SET
        community_id        = EXCLUDED.community_id,
        confirmed_works     = EXCLUDED.confirmed_works,
        manual_works        = EXCLUDED.manual_works,
        distinct_requesters = EXCLUDED.distinct_requesters,
        repeat_requesters   = EXCLUDED.repeat_requesters,
        computed_at         = now();
    END $fn$;
  `);

  // EXECUTE mặc định cấp cho PUBLIC — với hàm SECURITY DEFINER đó là mặc định
  // sai hướng. Thu về rồi cấp đúng cho app_role (tác vụ 03:15 hằng đêm ở mục
  // 8.3 chạy bằng vai ứng dụng).
  await knex.raw(`REVOKE EXECUTE ON FUNCTION fn_trust_recount(uuid) FROM PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION fn_trust_recount(uuid) TO ??`, [user]);

  // ---------------------------------------------------------------------------
  // Hai đường làm mới TỨC THÌ (mục 8.3 điểm (a)). Đường thứ ba — tác vụ 03:15
  // tính lại toàn bộ và ghi audit_log khi lệch — thuộc task vận hành.
  // ---------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_trust_touch() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE r RECORD;
    BEGIN
      FOR r IN SELECT member_id FROM work_participants
                WHERE work_record_id = NEW.work_record_id
      LOOP PERFORM fn_trust_recount(r.member_id); END LOOP;
      RETURN NULL;
    END $fn$;

    CREATE TRIGGER trg_trust_touch AFTER INSERT ON work_confirmations
      FOR EACH ROW EXECUTE FUNCTION fn_trust_touch();

    -- Bổ sung so với kế hoạch: khi approver duyệt một bản ghi 'manual', số việc
    -- của mọi người tham gia đổi NGAY. Không có trigger này thì bảng thống kê
    -- đứng yên tới 03:15 sáng hôm sau, tức người dùng thấy bậc uy tín cũ trong
    -- khi CSDL đã có dữ liệu mới — và kế hoạch phải gọi tay fn_trust_recount()
    -- trong chính bài test của nó, dấu hiệu rõ nhất là thiếu một cửa.
    CREATE FUNCTION fn_trust_touch_record() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE r RECORD;
    BEGIN
      FOR r IN SELECT member_id FROM work_participants WHERE work_record_id = NEW.id
      LOOP PERFORM fn_trust_recount(r.member_id); END LOOP;
      RETURN NULL;
    END $fn$;

    CREATE TRIGGER trg_trust_review AFTER UPDATE OF reviewed_at ON work_records
      FOR EACH ROW WHEN (NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at)
      EXECUTE FUNCTION fn_trust_touch_record();
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_trust_review ON work_records;
    DROP TRIGGER IF EXISTS trg_trust_touch ON work_confirmations;
    DROP FUNCTION IF EXISTS fn_trust_touch_record();
    DROP FUNCTION IF EXISTS fn_trust_touch();
    DROP FUNCTION IF EXISTS fn_trust_recount(uuid);
    DROP TABLE IF EXISTS member_trust_stats;
  `);
}
