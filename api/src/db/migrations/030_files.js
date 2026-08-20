// Tệp — bảng sổ của kho ảnh (đặc tả mục 5.3 "#### Tệp", mục 1.2 dòng 48).
//
// ===========================================================================
// VÌ SAO BẢNG NÀY TỒN TẠI, KHI BYTE KHÔNG NẰM Ở ĐÂY
//
// Ảnh nằm trong MinIO (production) hoặc trên đĩa (dev/test). PostgreSQL không
// giữ một byte nào của chúng. Nhưng cả dự án ép luật ở tầng dữ liệu, và tầng
// đó KHÔNG CÓ ở kho lưu trữ — MinIO không biết `community_id` là gì, không có
// trigger, không có ma trận quyền theo hàng.
//
// Vì vậy bảng này là SỔ. Nó là nơi duy nhất trong hệ thống biết:
//   * một khoá lưu trữ thuộc về ai (`owner_id`) và về Hội nào (`community_id`),
//   * nó là loại gì THẬT SỰ (`mime` — đã kiểm bằng magic bytes, không tin
//     `Content-Type` của client),
//   * nó gắn vào đối tượng nào (`attached_type`/`attached_id`) — thứ quyết
//     định AI ĐỌC ĐƯỢC nó.
//
// Nói thẳng giới hạn: sổ này chỉ canh được đường đi qua API. Ai có thông tin
// đăng nhập MinIO thì đọc thẳng bucket, và không dòng nào ở đây ngăn được.
// Xem `docs/…/task-15-report.md`, câu hỏi 1, và `proxy/Caddyfile` — chỗ khoá
// thật là ở đó: không route nào từ Internet tới `storage`.
//
// ===========================================================================
// KHÔNG CÓ `DELETE` TRẦN — và đây là quyết định, không phải thói quen
//
// Đặc tả mục 4.8 xếp `subject_keys`, `loans` vào nhóm `SELECT, INSERT, UPDATE`
// với lý do "hủy khóa là `UPDATE destroyed_at`, không phải `DELETE`". Tệp rơi
// vào đúng nhóm đó, vì một lý do RIÊNG và mạnh hơn:
//
//   Một hàng ở đây là thứ DUY NHẤT nối một khoá lưu trữ với một con người.
//   Xoá hàng KHÔNG xoá byte trong MinIO — nó chỉ làm byte đó thành vô chủ:
//   vẫn nằm đó, vẫn đọc được bởi ai có khoá kho, và không còn ai biết nó là
//   ảnh của ai để mà dọn. Tức `DELETE` ở đây không phải "xoá dữ liệu cá nhân",
//   nó là "xoá dấu vết của dữ liệu cá nhân còn nguyên".
//
// Nên xoá là hai nhịp, và nhịp nào cũng để lại dấu:
//   `deleted_at`  — người dùng bỏ tấm ảnh: nó biến mất khỏi mọi đường đọc.
//   `purged_at`   — tác vụ dọn đã thật sự xoá byte trong kho, và nói được là
//                   xoá lúc nào. Không có cột này thì "đã xoá chưa" là câu
//                   hỏi không ai trả lời được bằng dữ liệu.
// Tác vụ dọn ấy CHƯA CÓ (nó cần khung tác vụ định kỳ — Task 18). Đây là nợ đã
// ghi, không phải chỗ bỏ sót; xem câu hỏi 2 trong báo cáo lượt 15.
//
// ===========================================================================
// `UPDATE` được cấp, nên phải có người canh nó (họ D, docs/RANG-BUOC.md 5.4)
//
// `UPDATE` mở ra đúng ba đường lách, và `trg_file_immutable` đóng cả ba:
//   1. Đổi `storage_key` sang khoá của tệp người khác ⇒ hàng của tôi, byte của
//      họ, và mọi kiểm quyền đều nhìn vào hàng của tôi.
//   2. Đổi `owner_id` / `community_id` ⇒ chuyển tệp sang Hội khác, hoặc gán
//      cho người khác để mượn quyền đọc của họ.
//   3. Gỡ `deleted_at` về NULL ⇒ hồi sinh tấm ảnh người ta đã bỏ, sau khi tác
//      vụ dọn có thể đã xoá byte.
// Trigger là VÔ ĐIỀU KIỆN (không dùng `fn_acting_member()`) vì nó phải chặn cả
// đường owner và `psql` — cùng lập luận đã viết ở `028_two_person_gates.js`.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE files (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      owner_id uuid NOT NULL,

      -- Khoá trong kho. Sinh ngẫu nhiên phía máy chủ và KHÔNG BAO GIỜ ra tới
      -- client: đường đọc duy nhất là GET /files/:id, và nó kiểm quyền trước
      -- khi chạm byte. UNIQUE để hai hàng không bao giờ trỏ chung một byte —
      -- nếu chung thì xoá hàng này là làm hỏng hàng kia.
      storage_key text NOT NULL UNIQUE,

      -- Loại THẬT của thứ đã lưu, không phải thứ client khai. Sau khi qua
      -- sharp, mọi ảnh đều là JPEG (đặc tả mục 5.3: "JPEG chất lượng 80"), nên
      -- danh sách trắng ở đây đúng một phần tử. Đây là DANH SÁCH TRẮNG: thêm
      -- một loại mới là một quyết định phải viết ra, không phải chuyện xảy ra.
      mime text NOT NULL CHECK (mime IN ('image/jpeg')),

      -- Loại của thứ NGƯỜI TA GỬI LÊN, cũng đã kiểm bằng magic bytes chứ không
      -- lấy từ header. Giữ lại để trả lời được "ảnh này gốc là gì" mà không
      -- phải mở byte ra đọc.
      source_mime text NOT NULL CHECK (source_mime IN ('image/jpeg','image/png','image/webp')),

      byte_size int NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
      width  int NOT NULL CHECK (width  > 0 AND width  <= 1600),
      height int NOT NULL CHECK (height > 0 AND height <= 1600),
      sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),

      -- Đối tượng gắn kèm — thứ quyết định ai đọc được. NULL nghĩa là "vừa tải
      -- lên, chưa gắn vào đâu", và khi đó chỉ chính chủ đọc được.
      --
      -- DANH SÁCH TRẮNG, và nó cố ý HẸP: giai đoạn 1 chỉ có ảnh đại diện và
      -- ảnh bìa. Người thêm loại thứ ba (ảnh năng lực, ảnh ký ức) phải sửa cả
      -- CHECK dưới đây LẪN bảng phân giải quyền trong modules/files/service.js
      -- — hai chỗ, cùng một lúc, không có đường tắt nào cho quên.
      attached_type text CHECK (attached_type IN ('member_avatar','member_cover')),
      attached_id uuid,

      created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      purged_at  timestamptz,

      CONSTRAINT files_id_cid UNIQUE (id, community_id),

      -- Hai cột gắn kèm phải cùng có hoặc cùng không. Một nửa là một trạng
      -- thái không ai định nghĩa, và bảng phân giải quyền sẽ phải đoán.
      CONSTRAINT files_attach_pair CHECK ((attached_type IS NULL) = (attached_id IS NULL)),

      -- Ảnh đại diện/ảnh bìa là của CHÍNH người tải lên. Không có câu này thì
      -- tôi gắn ảnh của tôi vào hồ sơ người khác, hoặc gắn vào một hồ sơ đông
      -- người xem để mượn quyền đọc của hồ sơ ấy.
      CONSTRAINT files_attach_self CHECK (
        attached_type IS NULL OR attached_id = owner_id
      ),

      -- Dọn byte mà không có ai bảo xoá là dọn nhầm.
      CONSTRAINT files_purge_after_delete CHECK (purged_at IS NULL OR deleted_at IS NOT NULL),

      -- Khoá ngoại GHÉP. Lỗi quên lọc community_id đã lặp bảy lần trong dự án;
      -- khoá ghép biến chỗ quên thành lỗi lúc ghi thay vì một đường rò im lặng.
      FOREIGN KEY (owner_id, community_id) REFERENCES members (id, community_id)
    );

    CREATE INDEX idx_files_owner ON files (owner_id, created_at DESC);
    CREATE INDEX idx_files_attached ON files (attached_type, attached_id)
      WHERE attached_type IS NOT NULL AND deleted_at IS NULL;
    -- Danh sách việc của tác vụ dọn (Task 18): đã bỏ nhưng byte còn nằm đó.
    CREATE INDEX idx_files_to_purge ON files (deleted_at)
      WHERE deleted_at IS NOT NULL AND purged_at IS NULL;
  `);

  await knex.raw(`
    CREATE FUNCTION fn_file_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.community_id IS DISTINCT FROM OLD.community_id
         OR NEW.owner_id     IS DISTINCT FROM OLD.owner_id
         OR NEW.storage_key  IS DISTINCT FROM OLD.storage_key
         OR NEW.mime         IS DISTINCT FROM OLD.mime
         OR NEW.source_mime  IS DISTINCT FROM OLD.source_mime
         OR NEW.byte_size    IS DISTINCT FROM OLD.byte_size
         OR NEW.sha256       IS DISTINCT FROM OLD.sha256
         OR NEW.created_at   IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION 'FILE_IMMUTABLE'
          USING DETAIL = 'chủ sở hữu, Hội, khoá lưu trữ và dấu vân của byte không đổi được';
      END IF;

      -- Gắn được MỘT lần. Dời tấm ảnh đã gắn sang đối tượng khác là cùng khuôn
      -- với PHOTO_PEOPLE_FROZEN (027): nó đổi tập người đọc được mà không ai
      -- quyết định lại.
      IF OLD.attached_type IS NOT NULL
         AND (NEW.attached_type IS DISTINCT FROM OLD.attached_type
              OR NEW.attached_id IS DISTINCT FROM OLD.attached_id)
      THEN
        RAISE EXCEPTION 'FILE_IMMUTABLE'
          USING DETAIL = 'tệp đã gắn vào một đối tượng thì không dời sang đối tượng khác';
      END IF;

      IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
        RAISE EXCEPTION 'FILE_IMMUTABLE'
          USING DETAIL = 'tệp đã bỏ thì không hồi sinh — byte có thể đã bị tác vụ dọn xoá';
      END IF;

      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_file_immutable
      BEFORE UPDATE ON files
      FOR EACH ROW EXECUTE FUNCTION fn_file_immutable();
  `);

  // -------------------------------------------------------------------------
  // MA TRẬN QUYỀN. Migration 024 là "nơi duy nhất khai quyền theo bảng", nhưng
  // nó đã chạy rồi nên không sửa được (Ruling C8) — và câu tự kiểm của nó chỉ
  // soi schema tại thời điểm 024 chạy, tức nó KHÔNG thấy bảng này. Vì vậy khai
  // ngay đây, tường minh, kèm lý do; và `tests/expected-grants.json` (T10) là
  // cái lưới thật canh việc khai này khớp thực tế.
  //
  // `SELECT, INSERT, UPDATE` — không `DELETE`. Lý do đầy đủ ở đầu tệp.
  // -------------------------------------------------------------------------
  await knex.raw(
    `REVOKE ALL ON files FROM ??;
     GRANT SELECT, INSERT, UPDATE ON files TO ??;`,
    [user, user]
  );
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_file_immutable ON files;
    DROP FUNCTION IF EXISTS fn_file_immutable();
    DROP TABLE IF EXISTS files;
  `);
}
