// Dữ liệu kèm GUARANTEE_QUOTA_EXCEEDED — audit API mục 6.
//
// `fn_guarantee_quota`/`fn_guarantee_invite_quota` (migration 031) đã tính
// `v_used`/`v_cap` và nhét vào DETAIL dạng "3/3 trong 12 tháng gần nhất", đủ
// cho câu tiếng Việt chung chung. Còn thiếu THỜI ĐIỂM suất tiếp theo mở ra —
// không tính sẵn ở đâu, vì hai nhánh của fn_guarantee_slots_used tính "khi nào
// một suất nhả ra" theo hai cách khác nhau (join_requests: 12 tháng kể từ
// created_at; guarantee_invites: expires_at). fn_guarantee_next_slot_at dưới
// đây MIRROR đúng vế WHERE của fn_guarantee_slots_used — sai một điều kiện là
// đếm và "khi nào nhả suất" lệch nhau, nên hai hàm này phải luôn sửa cùng lúc.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE FUNCTION fn_guarantee_next_slot_at(
      p_referrer uuid, p_community uuid, p_exclude_jr uuid, p_exclude_invite uuid
    ) RETURNS timestamptz LANGUAGE sql STABLE AS $fn$
      SELECT min(t) FROM (
        SELECT jr.created_at + interval '12 months' AS t FROM join_requests jr
          WHERE jr.referrer_id = p_referrer
            AND jr.community_id = p_community
            AND jr.id IS DISTINCT FROM p_exclude_jr
            AND jr.created_at > now() - interval '12 months'
            AND (jr.status IN ('pending','met_confirmed','approved')
              OR (jr.status = 'rejected' AND jr.reject_reason_code = 'referrer_misrepresented'))
        UNION ALL
        SELECT gi.expires_at AS t FROM guarantee_invites gi
          WHERE gi.referrer_id = p_referrer
            AND gi.community_id = p_community
            AND gi.id IS DISTINCT FROM p_exclude_invite
            AND gi.used_at IS NULL
            AND gi.revoked_at IS NULL
            AND gi.expires_at > now()
      ) s;
    $fn$;
  `);
  await knex.raw(`REVOKE EXECUTE ON FUNCTION fn_guarantee_next_slot_at(uuid,uuid,uuid,uuid) FROM PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION fn_guarantee_next_slot_at(uuid,uuid,uuid,uuid) TO ??`, [user]);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_guarantee_quota() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_used int; v_cap int; v_next timestamptz;
    BEGIN
      IF NEW.referrer_id IS NULL THEN
        RAISE EXCEPTION 'REFERRER_REQUIRED';         -- nguyên tắc 1: không bảo lãnh ẩn danh
      END IF;
      IF NEW.status NOT IN ('pending','met_confirmed','approved') THEN
        RETURN NEW;
      END IF;

      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.referrer_id::text, 42));

      v_used := fn_guarantee_slots_used(NEW.referrer_id, NEW.community_id, NEW.id, NULL);
      v_cap  := fn_guarantee_cap(NEW.referrer_id, NEW.community_id);

      IF v_used >= v_cap THEN
        v_next := fn_guarantee_next_slot_at(NEW.referrer_id, NEW.community_id, NEW.id, NULL);
        RAISE EXCEPTION 'GUARANTEE_QUOTA_EXCEEDED'
          USING DETAIL = format('%s/%s trong 12 tháng gần nhất;next_slot_at=%s',
            v_used, v_cap, to_char(v_next AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
      END IF;
      RETURN NEW;
    END $fn$;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_guarantee_invite_quota() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_used int; v_cap int; v_next timestamptz;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.referrer_id::text, 42));

      v_used := fn_guarantee_slots_used(NEW.referrer_id, NEW.community_id, NULL, NEW.id);
      v_cap  := fn_guarantee_cap(NEW.referrer_id, NEW.community_id);

      IF v_used >= v_cap THEN
        v_next := fn_guarantee_next_slot_at(NEW.referrer_id, NEW.community_id, NULL, NEW.id);
        RAISE EXCEPTION 'GUARANTEE_QUOTA_EXCEEDED'
          USING DETAIL = format('%s/%s trong 12 tháng gần nhất;next_slot_at=%s',
            v_used, v_cap, to_char(v_next AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
      END IF;
      RETURN NEW;
    END $fn$;
  `);
}

export async function down(knex) {
  // Trả hai hàm về đúng thân của migration 031 (không có v_next/DETAIL mở
  // rộng) trước khi bỏ fn_guarantee_next_slot_at, cùng thứ tự-ngược quy ước
  // của 031: hàm phụ thuộc phải mất SAU khi không còn ai gọi.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_guarantee_quota() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_used int; v_cap int;
    BEGIN
      IF NEW.referrer_id IS NULL THEN
        RAISE EXCEPTION 'REFERRER_REQUIRED';
      END IF;
      IF NEW.status NOT IN ('pending','met_confirmed','approved') THEN
        RETURN NEW;
      END IF;

      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.referrer_id::text, 42));

      v_used := fn_guarantee_slots_used(NEW.referrer_id, NEW.community_id, NEW.id, NULL);
      v_cap  := fn_guarantee_cap(NEW.referrer_id, NEW.community_id);

      IF v_used >= v_cap THEN
        RAISE EXCEPTION 'GUARANTEE_QUOTA_EXCEEDED'
          USING DETAIL = format('%s/%s trong 12 tháng gần nhất', v_used, v_cap);
      END IF;
      RETURN NEW;
    END $fn$;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_guarantee_invite_quota() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_used int; v_cap int;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.referrer_id::text, 42));

      v_used := fn_guarantee_slots_used(NEW.referrer_id, NEW.community_id, NULL, NEW.id);
      v_cap  := fn_guarantee_cap(NEW.referrer_id, NEW.community_id);

      IF v_used >= v_cap THEN
        RAISE EXCEPTION 'GUARANTEE_QUOTA_EXCEEDED'
          USING DETAIL = format('%s/%s trong 12 tháng gần nhất', v_used, v_cap);
      END IF;
      RETURN NEW;
    END $fn$;
  `);

  await knex.raw(`DROP FUNCTION IF EXISTS fn_guarantee_next_slot_at(uuid,uuid,uuid,uuid);`);
}
