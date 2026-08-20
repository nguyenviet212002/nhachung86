// Cửa `community.config_change` — chặn PHÁT LẠI một quyết định đã thi hành.
//
// Soát xét độc lập Task 16, mục B4.3
// (`.superpowers/sdd/2026-08-18-nha-chung-giai-doan-1/task-16-soat-xet.md`).
//
// ===========================================================================
// KỊCH BẢN ĐÃ TÁI HIỆN BẰNG CHẠY THẬT, TRƯỚC BẢN VÁ NÀY
//
//   Hành động A — đổi `config`, ĐỦ HAI chữ ký thật, và vẫn `pending`:
//     alice gọi fn_community_config_apply(A)          ⇒ config = A
//     (không ai đánh dấu A đã thi hành, nên A vẫn `pending`)
//
//   Hành động B — đổi `config`, đủ hai chữ ký, đi ĐÚNG quy trình của service:
//     alice gọi apply(B) rồi `UPDATE … status='executed'`   ⇒ config = B
//
//   alice, MỘT MÌNH, không một chữ ký mới nào, gọi lại apply(A)
//                                                     ⇒ config = A  ← QUAY NGƯỢC
//
// Hai chữ ký của A là thật. Cái không ai kiểm là THỜI ĐIỂM: 028 hỏi "hành động
// này có đủ hai chữ ký không", không hỏi "hành động này đã tiêu chưa". Tính
// "một quyết định, một lần thi hành" nằm ở đúng một câu `UPDATE` trong
// `api/src/core/twoPerson.js` — tức ở TẦNG ỨNG DỤNG, đúng khuôn "lỗ hổng ngủ"
// mà `docs/RANG-BUOC.md` mô tả: người viết `fn_community_config_apply` lần thứ
// hai (một tác vụ định kỳ, một lệnh CLI vận hành, luồng khôi phục của Task 18)
// không có gì nhắc họ phải kèm câu `UPDATE` ấy.
//
// Cửa sổ khai thác hẹp — 24 giờ, và người khai thác phải là một trong hai
// người đã ký — nhưng nó cho MỘT người quyền quay ngược quyết định của HAI
// người, trên đúng cột mà `RANG-BUOC.md` mục 5.4 gọi là đòn bẩy dài nhất
// trong hệ thống.
//
// ===========================================================================
// VÌ SAO KHÔNG CHÉP NGUYÊN KHUÔN `gqo_one_row_per_action`
//
// Cửa kia của 028 — `guarantee.quota_override` — giải đúng bài này bằng một
// ràng buộc dữ liệu: `UNIQUE (pending_action_id)` trên
// `guarantee_quota_overrides`. Khuôn ấy chạy được vì mỗi quyết định nới hạn
// mức ĐỂ LẠI MỘT HÀNG. Quyết định đổi cấu hình thì không: kết quả của nó là
// một cột bị GHI ĐÈ (`communities.config`), nên không có hàng nào để đặt
// `UNIQUE` lên. Dựng một bảng sổ riêng chỉ để giữ tính dùng-một-lần là dựng
// một nguồn sự thật THỨ HAI cho cùng một việc mà `pending_actions` đã ghi.
//
// Nên bản vá đi lối thứ hai mà chính bản soát xét đề nghị: một dấu "ĐÃ TIÊU"
// trên chính hàng hành động, ĐỘC LẬP với `status`, và ghi-một-lần ở tầng dữ
// liệu. Độc lập với `status` là điều kiện bắt buộc — `status` do tầng ứng dụng
// đặt, và cái hỏng ở đây chính là "tầng ứng dụng quên đặt".
//
// ===========================================================================
// VÌ SAO DẤU ẤY ĐƯỢC ĐÓNG TRONG TRIGGER, KHÔNG PHẢI TRONG HÀM
//
// Ruling T10-a: `REVOKE` không đỡ được một hàm `SECURITY DEFINER` THỨ HAI —
// và 028 đã áp bài học đó khi dựng `trg_community_config_guard` (trigger vô
// điều kiện trên chính `communities`, chặn cả owner, cả `psql`, cả chính
// `fn_community_config_apply`). Chỗ hở B4.3 là đúng bài học đó bị bỏ dở: luật
// "đủ hai chữ ký" nằm ở trigger, còn luật "chỉ một lần" nằm ở tầng trên.
//
// Nên trigger vừa KIỂM vừa TIÊU vé, trong cùng một lần chạy:
//
//     trg_community_config_guard  ─┬─ tìm một hành động đủ chữ ký và CHƯA TIÊU
//                                  └─ ĐÓNG DẤU nó ngay, rồi mới cho ghi `config`
//
// Hệ quả: bất kỳ ai đổi `communities.config` — hàm hôm nay, hàm ai đó viết
// tháng sau, một câu `UPDATE` của người vận hành — đều tiêu đúng một hành
// động, vì không có đường nào vào cột ấy mà không qua trigger này. Không còn
// một câu lệnh nào ở tầng ứng dụng phải nhớ.
//
// Và `fn_pending_action_consumed_once` giữ vế còn lại: dấu đã đóng thì không
// gỡ được. Không có nó thì phát lại chỉ tốn thêm một câu
// `UPDATE pending_actions SET consumed_at = NULL` — mà `app_role` có sẵn quyền
// `UPDATE` trên bảng ấy.
//
// MÃ LỖI DÙNG CHUNG cho cả hai chỗ: `CONFIG_CHANGE_ALREADY_APPLIED`. Cùng một
// luật nhìn từ hai đầu (thi hành lần hai / gỡ dấu để thi hành lần hai), đúng
// tiền lệ mà 027 đã đặt khi ba trigger của nó cố ý dùng lại mã đã có.
// ===========================================================================

export async function up(knex) {
  // -------------------------------------------------------------------------
  // 1. Dấu "đã tiêu", độc lập với `status`.
  //
  // KHÔNG dùng lại `executed_at`: cột đó bị ràng bởi `pa_executed_pair`
  // (`(status='executed') = (executed_at IS NOT NULL)`), tức nó LÀ `status`
  // viết cách khác — mà `status` chính là thứ tầng ứng dụng quên đặt.
  // -------------------------------------------------------------------------
  await knex.raw(`ALTER TABLE pending_actions ADD COLUMN consumed_at timestamptz`);
  await knex.raw(`
    COMMENT ON COLUMN pending_actions.consumed_at IS
      'Thời điểm hành động này bị TIÊU bởi cửa thi hành của nó. Ghi một lần, do trigger đóng, không do tầng ứng dụng đặt. Độc lập với status.';
  `);

  // Hành động đổi cấu hình nào đã thi hành trước migration này thì coi như đã
  // tiêu — nếu không, mỗi hàng ấy là một vé phát lại còn hạn sử dụng.
  // Trên CSDL trắng (bộ kiểm thử) câu này chạm 0 hàng.
  await knex.raw(`
    UPDATE pending_actions
       SET consumed_at = coalesce(executed_at, now())
     WHERE action_key = 'community.config_change'
       AND status = 'executed'
       AND consumed_at IS NULL
  `);

  // -------------------------------------------------------------------------
  // 2. Dấu đã đóng thì không gỡ.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_pending_action_consumed_once() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
        RAISE EXCEPTION 'CONFIG_CHANGE_ALREADY_APPLIED'
          USING DETAIL = 'dấu "đã thi hành" của một việc chờ ký không gỡ được: gỡ được nó là phát lại được quyết định';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_pending_action_consumed_once BEFORE UPDATE ON pending_actions
      FOR EACH ROW EXECUTE FUNCTION fn_pending_action_consumed_once();
  `);

  // -------------------------------------------------------------------------
  // 3. Cửa duy nhất vào `communities.config` nay TIÊU vé chứ không chỉ soi vé.
  //
  // Ba khác biệt so với thân hàm của 028:
  //   (a) thêm `a.consumed_at IS NULL` vào điều kiện tìm hành động;
  //   (b) phân biệt "chưa từng có ai ký" (`CONFIG_CHANGE_UNSIGNED`, giữ
  //       nguyên) với "đã ký, đã thi hành rồi" (`CONFIG_CHANGE_ALREADY_APPLIED`)
  //       — hai câu trả lời khác nhau cho hai câu hỏi khác nhau;
  //   (c) đóng dấu trước khi cho ghi.
  //
  // Câu `UPDATE … WHERE consumed_at IS NULL` cộng `ROW_COUNT` là vế CHẠY ĐUA:
  // hai giao dịch cùng thi hành một hành động thì ở READ COMMITTED, câu UPDATE
  // của giao dịch sau chờ khoá hàng, rồi ĐỌC LẠI hàng đã đổi và không còn khớp
  // `consumed_at IS NULL` ⇒ chạm 0 hàng ⇒ nổ. Một phép `SELECT` rồi `UPDATE`
  // không có vế `WHERE` ấy sẽ để lọt đúng ca này.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_community_config_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_action uuid; v_n int;
    BEGIN
      IF NEW.config IS NOT DISTINCT FROM OLD.config THEN RETURN NEW; END IF;

      SELECT a.id INTO v_action
        FROM pending_actions a
       WHERE a.community_id = OLD.id
         AND a.action_key = 'community.config_change'
         AND a.status = 'pending'
         AND a.expires_at > now()
         AND a.consumed_at IS NULL
         AND a.payload -> 'config' = NEW.config      -- ĐÚNG nội dung đã ký
         AND fn_pending_action_signatures(a.id) >= 2
       LIMIT 1;

      IF v_action IS NULL THEN
        IF EXISTS (
          SELECT 1 FROM pending_actions a
           WHERE a.community_id = OLD.id
             AND a.action_key = 'community.config_change'
             AND a.consumed_at IS NOT NULL
             AND a.payload -> 'config' = NEW.config
        ) THEN
          RAISE EXCEPTION 'CONFIG_CHANGE_ALREADY_APPLIED'
            USING DETAIL = 'quyết định này đã thi hành rồi: một hành động đã ký thi hành đúng một lần, muốn đặt lại thì ký một việc mới';
        END IF;
        RAISE EXCEPTION 'CONFIG_CHANGE_UNSIGNED'
          USING DETAIL = 'communities.config là chính sách của cộng đồng: đổi nó phải qua một hành động community.config_change đủ hai chữ ký';
      END IF;

      UPDATE pending_actions SET consumed_at = now()
       WHERE id = v_action AND consumed_at IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n = 0 THEN
        RAISE EXCEPTION 'CONFIG_CHANGE_ALREADY_APPLIED'
          USING DETAIL = 'một giao dịch khác vừa thi hành đúng hành động này';
      END IF;
      RETURN NEW;
    END $fn$;
  `);

  // -------------------------------------------------------------------------
  // 4. Và hàm cũng tự hỏi — không phải vì trigger chưa đủ, mà vì có một ca
  //    trigger KHÔNG THẤY: gọi apply(A) hai lần liên tiếp, không có gì xen
  //    giữa. Lần thứ hai ghi ĐÚNG giá trị đang có, nên
  //    `NEW.config IS NOT DISTINCT FROM OLD.config` và trigger trả về ngay ở
  //    dòng đầu — không nổ, mà cũng không có gì đổi. Câu trả lời "chạy rồi"
  //    cho một lần gọi thứ hai là một lời nói dối nhỏ, và nó dạy người viết
  //    tầng trên rằng phát lại là chuyện bình thường.
  //
  //    THỨ TỰ KIỂM CÓ CHỦ Ý: `EXECUTOR_NOT_SIGNER` (029) đứng TRƯỚC. Người
  //    không ký hỏi một hành động đã tiêu thì câu trả lời đúng vẫn là "anh
  //    không phải người ký", không phải một tin tức về trạng thái của hành
  //    động ấy.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_community_config_apply(p_action uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE v_cid uuid; v_key text; v_new jsonb; v_consumed timestamptz;
            v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
    BEGIN
      SELECT community_id, action_key, payload -> 'config', consumed_at
        INTO v_cid, v_key, v_new, v_consumed
        FROM pending_actions WHERE id = p_action;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_PENDING_ACTION'; END IF;
      IF v_key <> 'community.config_change' OR v_new IS NULL OR jsonb_typeof(v_new) <> 'object' THEN
        RAISE EXCEPTION 'CONFIG_CHANGE_UNSIGNED'
          USING DETAIL = 'hành động này không phải một thay đổi cấu hình hợp lệ';
      END IF;

      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'NO_ACTOR' USING DETAIL = 'giao dịch không đóng dấu người thực hiện';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pending_action_signatures s
         WHERE s.pending_action_id = p_action
           AND s.signer_id = v_actor
           AND s.community_id = v_cid
      ) THEN
        RAISE EXCEPTION 'EXECUTOR_NOT_SIGNER'
          USING DETAIL = 'chỉ một trong những người đã ký mới thi hành được việc này';
      END IF;

      IF v_consumed IS NOT NULL THEN
        RAISE EXCEPTION 'CONFIG_CHANGE_ALREADY_APPLIED'
          USING DETAIL = 'quyết định này đã thi hành rồi: một hành động đã ký thi hành đúng một lần, muốn đặt lại thì ký một việc mới';
      END IF;

      UPDATE communities SET config = v_new, updated_at = now() WHERE id = v_cid;
      RETURN v_new;
    END $fn$;
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_pending_action_consumed_once ON pending_actions;
    DROP FUNCTION IF EXISTS fn_pending_action_consumed_once();
  `);

  // Nguyên văn thân hàm của 028 (guard) và 029 (apply).
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_community_config_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.config IS NOT DISTINCT FROM OLD.config THEN RETURN NEW; END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pending_actions a
         WHERE a.community_id = OLD.id
           AND a.action_key = 'community.config_change'
           AND a.status = 'pending'
           AND a.expires_at > now()
           AND a.payload -> 'config' = NEW.config
           AND fn_pending_action_signatures(a.id) >= 2
      ) THEN
        RAISE EXCEPTION 'CONFIG_CHANGE_UNSIGNED'
          USING DETAIL = 'communities.config là chính sách của cộng đồng: đổi nó phải qua một hành động community.config_change đủ hai chữ ký';
      END IF;
      RETURN NEW;
    END $fn$;
  `);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_community_config_apply(p_action uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE v_cid uuid; v_key text; v_new jsonb;
            v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
    BEGIN
      SELECT community_id, action_key, payload -> 'config'
        INTO v_cid, v_key, v_new
        FROM pending_actions WHERE id = p_action;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_PENDING_ACTION'; END IF;
      IF v_key <> 'community.config_change' OR v_new IS NULL OR jsonb_typeof(v_new) <> 'object' THEN
        RAISE EXCEPTION 'CONFIG_CHANGE_UNSIGNED'
          USING DETAIL = 'hành động này không phải một thay đổi cấu hình hợp lệ';
      END IF;

      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'NO_ACTOR' USING DETAIL = 'giao dịch không đóng dấu người thực hiện';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pending_action_signatures s
         WHERE s.pending_action_id = p_action
           AND s.signer_id = v_actor
           AND s.community_id = v_cid
      ) THEN
        RAISE EXCEPTION 'EXECUTOR_NOT_SIGNER'
          USING DETAIL = 'chỉ một trong những người đã ký mới thi hành được việc này';
      END IF;

      UPDATE communities SET config = v_new, updated_at = now() WHERE id = v_cid;
      RETURN v_new;
    END $fn$;
  `);

  await knex.raw(`ALTER TABLE pending_actions DROP COLUMN IF EXISTS consumed_at`);
}
