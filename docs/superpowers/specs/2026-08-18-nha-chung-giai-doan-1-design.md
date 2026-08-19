# Nhà Chung — Thiết kế Backend, Giai đoạn 1

- **Ngày:** 2026-08-18
- **Phạm vi:** Giai đoạn 1 — hạ tầng Docker, lược đồ dữ liệu đầy đủ, cưỡng chế năm nguyên tắc ở tầng CSDL, xác thực, con người, quyền riêng tư, gia nhập, nhật ký kiểm toán.
- **Ngoài phạm vi lần này:** năng lực, tín hiệu, việc làm, giúp nhau, hoạt động, ký ức, sổ quỹ, khiếu nại, Quỹ TingTingVác. **Lược đồ của chúng vẫn được tạo đầy đủ ở giai đoạn 1** (vì `community_id`, chuỗi băm và bộ lọc riêng tư là ràng buộc xuyên suốt, vá sau phải đập đi), nhưng API thì để các giai đoạn sau.

---

## 0. Bốn quyết định nền

| Quyết định | Chọn | Lý do |
|---|---|---|
| Chia nhỏ công việc | Giai đoạn 1 trọn vẹn, các giai đoạn sau mỗi cái một chu kỳ spec → kế hoạch → thi công | Hơn 40 bảng và ~90 endpoint làm một lượt thì những chỗ khó nhất sẽ bị làm ẩu nhất |
| Xác thực | Mật khẩu là chính, OTP là phụ (xác minh số điện thoại lúc gia nhập, và đặt lại mật khẩu) | Khớp đúng giao diện đã vẽ; khi chưa có nhà cung cấp SMS/Zalo hệ thống vẫn đăng nhập được |
| Nối frontend | Giao `api.js`, nối thật ba màn: đăng ký, đăng nhập, danh bạ | Chứng minh dây nối chạy đầu-cuối và đặt khuôn mẫu cho các giai đoạn sau |
| Lớp truy cập dữ liệu | Knex + migration SQL thuần | Phương án duy nhất đặt được trigger, `REVOKE`, extension mà năm nguyên tắc đòi hỏi |

**Nguyên tắc phân xử:** khi tiện lợi kỹ thuật mâu thuẫn với năm nguyên tắc ở mục 2 của bản đặc tả gốc, **luôn chọn nguyên tắc**. Ràng buộc nào làm chậm thì nêu ra bàn (xem mục 9), không tự bỏ.

---

## 1. Kiến trúc và ranh giới

### 1.1 Năm container

| Dịch vụ | Image | Vai trò |
|---|---|---|
| `db` | `postgres:16-alpine` | Cơ sở dữ liệu |
| `api` | build từ `./api` | REST API |
| `storage` | `minio/minio` | Ảnh và tài liệu |
| `proxy` | `caddy:2-alpine` | HTTPS, định tuyến, **và phục vụ file tĩnh của frontend** |
| `backup` | build từ `./backup` | Sao lưu định kỳ, cron |

Không có container `web`. Caddy phục vụ tĩnh bằng `file_server`, frontend gắn vào bằng volume chỉ-đọc — bớt một tầng vô ích.

### 1.2 Luồng mạng

```
Internet ──443──> proxy (Caddy)
                    ├── /*        file_server  (frontend tĩnh)
                    └── /api/v1/* reverse_proxy api:3000

              mạng nội bộ nhachung_net (không lộ ra ngoài)
                 api ──> db (5432)      api ──> storage (9000)
              backup ──> db (5432)   backup ──> storage (9000)
```

**`Caddyfile` không có route nào tới `storage`.** Mọi ảnh đi qua `GET /api/v1/files/:id`, `api` kiểm quyền rồi **stream lại byte**. Không presigned URL, không bucket công khai.

Lý do bỏ presign: URL ký sẵn phát ra là ghi log tại **thời điểm phát**, không phải thời điểm đọc; và trong 5 phút hiệu lực nó chuyển tay được. Với 52 thành viên, băng thông qua `api` không đáng bàn. Ảnh CCCD của Quỹ TingTingVác nằm ở bucket riêng, giải mã và stream trong bộ nhớ, chỉ cho vai chủ quỹ và approver, mỗi lượt ghi log.

### 1.3 Quy tắc Docker

1. **`db` không khai báo khóa `ports`** trong `docker-compose.yml` — không phải "để đấy rồi comment". Việc mở cổng 5432 nằm riêng trong `docker-compose.dev.yml`, file đó không bao giờ dùng ở máy chủ thật.
2. Dữ liệu nằm trong named volume (`db_data`, `storage_data`, `caddy_data`). Xóa container không mất dữ liệu.
3. Không hard-code mật khẩu. Mọi thứ đọc từ `.env`; `.env` nằm trong `.gitignore`.
4. `api/Dockerfile` multi-stage, chạy bằng user `node`, có `HEALTHCHECK`.
5. **Migration chạy xong mới mở cổng phục vụ.** `docker-entrypoint.sh` chạy `knex migrate:latest`, thất bại thì thoát khác 0 — container không bao giờ nhận request với lược đồ cũ.
6. `docker compose --profile dev up` bật seed và mở cổng DB; production không.
7. **Container `backup` dùng thông tin đăng nhập riêng, khác vai `tech`** — chính sách MinIO chỉ cho `s3:PutObject`, **không** `s3:DeleteObject`, trên bucket sao lưu. Bucket bật versioning và object lock. Người sửa được nhật ký không xóa được bản sao đối chiếu.

### 1.4 Cây thư mục

```
docker-compose.yml            nền, dùng chung mọi môi trường
docker-compose.dev.yml        mở cổng 5432 + 9001, bật seed, log chi tiết
docker-compose.test.yml       stack rời để khôi phục thử và chạy test
.env.example                  đủ biến, không giá trị thật
.gitignore                    .env, backups/, node_modules

api/
  Dockerfile                  multi-stage, user node, HEALTHCHECK
  docker-entrypoint.sh        migrate rồi mới listen
  src/
    server.js                 lắng nghe
    app.js                    ráp middleware + router
    config/index.js           đọc & kiểm tra biến môi trường lúc khởi động
    db/
      knex.js
      migrations/             001 … 024
      seeds/
    core/                     ← tầng dùng chung, modules/ KHÔNG được import ngược
      tx.js                   withActor() — đường duy nhất mở giao dịch
      privacy.js              vỏ mỏng quanh contact_read + dựng bao bì trạng thái
      audit.js                log(trx, …) và logDenied(…)
      trust.js                hàm DUY NHẤT ánh xạ số việc → bậc
      twoPerson.js            khung pending_actions
      crypto.js               AES-256-GCM, khóa theo chủ thể
      errors.js               AppError + bảng ánh xạ mã lỗi PostgreSQL
      otp/                    adapter: console (dev) | zalo-zns | sms
    middleware/               auth, rbac, rateLimit, validate, errorHandler
    modules/
      auth/       routes.js  service.js  schema.js
      areas/
      members/
      join-requests/
      files/
      ops/
    openapi/                  sinh từ schema zod
  tests/
web/
  index.html                  chính là index_2.html
  js/api.js                   lớp gọi API tập trung
backup/
  Dockerfile                  cron + pg_dump + mc
  backup.sh  verify.sh
proxy/
  Caddyfile
db/init/
  01-extensions.sql           chỉ những gì phải có trước migration
docs/
```

### 1.5 Ba ranh giới cố ý

**`core/` là nơi duy nhất chứa luật.** Đặc tả đòi *một* hàm `applyPrivacy` và *một* hàm tính bậc uy tín. Nếu mỗi route tự lọc, sang giai đoạn 3 sẽ có bảy bản sao lệch nhau. Quan hệ một chiều: `modules/` gọi `core/`, không bao giờ ngược lại. Có bài kiểm thử quét import khẳng định điều này.

**`modules/<tên>/` gồm đúng ba file.** `routes.js` chỉ biết HTTP; `service.js` chỉ biết nghiệp vụ và giao dịch; `schema.js` chỉ có zod. Route không chạm knex; service không biết `req`/`res`. Nhờ vậy mọi quy tắc nghiệp vụ kiểm thử được mà không cần dựng máy chủ HTTP.

**Vai `api` trong PostgreSQL không phải chủ sở hữu bảng.** Migration chạy bằng `nhachung_owner`; ứng dụng chạy bằng `app_role`. Nếu ứng dụng chạy bằng chính owner thì `REVOKE` trên `audit_log` vô nghĩa — owner tự cấp lại được. Đây là toàn bộ ý nghĩa của mục 5 bản đặc tả gốc.

### 1.6 Cấp quyền cho bảng mới

Migration `002` đặt:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE nhachung_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role;
```

Mọi bảng owner tạo ra tự động có quyền — không ai phải nhớ viết `GRANT` trong từng migration. Rồi các bảng đặc biệt bị `REVOKE` riêng, rõ ràng, có chủ đích.

> **Bẫy phải nhớ:** cơ chế tiện lợi này sẽ **tự động cấp `UPDATE, DELETE` cho mọi phân mảnh mới của `audit_log`** mà owner tạo ra — đục thủng đúng chỗ quan trọng nhất, mỗi tháng một lần, không ai thấy. Vì vậy phân mảnh chỉ được tạo qua hàm `fn_audit_new_partition()` tự `REVOKE` ngay sau khi tạo, và bài kiểm thử ma trận quyền (T10) phải quét **cả phân mảnh**, không chỉ bảng cha.

---

## 2. Lỗ hổng trong bản đặc tả gốc và cách bịt

| # | Vấn đề trong mục 4 bản gốc | Xử lý |
|---|---|---|
| 1 | `capability_evidence.work_record_id` trỏ tới bảng **chưa từng được định nghĩa** | Định nghĩa `work_records` — nó là gốc của bậc uy tín |
| 2 | Nguyên tắc 2 nói "bảng quan hệ" nhưng mục 4 không có bảng nào tên vậy | Định nghĩa `member_relations` |
| 3 | `join_requests` không có đường nối tới member được tạo khi duyệt | Thêm `join_requests.member_id` |
| 4 | `members.phone/email` nằm cùng bảng dữ liệu công khai → `SELECT *` là rò rỉ | Tách `member_contacts`, `REVOKE ALL` |
| 5 | `memory_consents` ở mức ký ức, `memory_photos.excluded_reason` ở mức ảnh | Thêm `memory_photo_people` |
| 6 | `signal_recipients.response` và `signal_responses` lưu trùng một sự việc | Bỏ cột, thay bằng view `v_signal_recipients` |
| 7 | Không có gì chặn cặp bảo lãnh hai chiều hoặc vòng bảo lãnh | Chỉ mục cặp chuẩn tắc + trigger chống chu trình |
| 8 | `source_type='manual'` là cửa đúc bậc uy tín | Bắt buộc approver duyệt + hạn mức theo cặp |

Về #6: `GENERATED ALWAYS AS` chỉ tính được trên các cột **cùng hàng**; đọc sang bảng khác bị từ chối ngay lúc `CREATE TABLE`. Chọn view chứ không phải cột-do-trigger vì cột do trigger vẫn trôi được (xóa một hàng `signal_responses` mà quên trigger `AFTER DELETE` là lệch âm thầm); view không có bản sao nào để lệch.

---

## 3. Cơ chế nền: mỗi giao dịch đóng dấu người thực hiện

Nhiều ràng buộc cần CSDL biết "ai đang thao tác". Không có nó thì `aid_slot_takers` không tự bảo vệ được và `contact_read` không ghi log được.

```js
// core/tx.js — đường DUY NHẤT để mở giao dịch
export async function withActor(actorId, fn) {
  return knex.transaction(async (trx) => {
    await trx.raw('SELECT set_config(?, ?, true)', ['app.actor_id', actorId ?? '']);
    return fn(trx);
  });
}
```

Tham số thứ ba `true` của `set_config` chính là ngữ nghĩa `SET LOCAL`: hết hiệu lực khi giao dịch đóng, nên không rò sang kết nối khác trong pool. Trong CSDL đọc bằng `current_setting('app.actor_id', true)`.

> **Vì sao không viết thẳng `SET LOCAL app.actor_id = ?`** — bản nháp đầu của spec này viết như vậy và **nó không chạy**. `SET`/`SET LOCAL` là lệnh tiện ích, không nhận tham số liên kết; PostgreSQL trả `42601: syntax error at or near "$1"`. Đường vòng duy nhất còn lại là nối chuỗi — mà nối chuỗi ở đúng chỗ nhận định danh người dùng là chỗ tệ nhất để nối chuỗi. `set_config()` là một lời gọi hàm bình thường nên tham số hóa được, và cho đúng ngữ nghĩa ấy. Đã kiểm chứng bằng `psql` thật lúc thi công Task 3.

### 3.1 Nhật ký: thành công ghi cùng giao dịch, từ chối ghi giao dịch riêng

`core/audit.js` có đúng hai lối vào:

```js
export async function log(trx, entry) { … }   // trx BẮT BUỘC; gọi ngoài giao dịch thì ném lỗi
export async function logDenied(entry) {       // mở giao dịch RIÊNG, sau khi giao dịch chính đã rollback
  return withActor(entry.actorId, (trx) => log(trx, { ...entry, action: entry.action + '.denied' }));
}
```

Ghi log **sau khi commit** thì một lỗi mạng giữa chừng tạo ra hành động không dấu vết. Ghi log **rồi mới ném lỗi trong cùng giao dịch** thì ngoại lệ hủy luôn dòng nhật ký vừa ghi — hành vi cần nhìn thấy nhất lại là hành vi không lưu được. Nên:

- Từ chối do **trigger** phát hiện: trigger cứ ném lỗi; `middleware/errorHandler.js` bắt mã lỗi PostgreSQL và gọi `logDenied` bằng giao dịch mới. Đây là nơi **duy nhất** gọi `logDenied`, nên không route nào phải nhớ.
- Từ chối bên trong **hàm đọc `SECURITY DEFINER`**: hàm không được ném lỗi, phải trả về kiểu có trạng thái (xem `contact_read`, mục 5.2).

Hệ quả phải nhớ: các endpoint chỉ-đọc chạy trong giao dịch riêng và **commit trước khi dựng phản hồi**. Nếu gộp chúng vào một giao dịch ghi cho "tiện", một lỗi ở cuối sẽ xóa cả dấu vết lượt đọc.

---

## 4. Cưỡng chế ở tầng CSDL — ba chỗ khó

### 4.1 `worked_together`: cạnh quan hệ mà ứng dụng *không được phép* tự tạo

Không dùng một hàng với hai cột `confirmed_a`/`confirmed_b` — hai cột đó cho phép tồn tại trạng thái "mới một bên xác nhận", đúng cái nguyên tắc 2 cấm. Tách ba tầng, và cạnh **chỉ do trigger sinh ra**.

```sql
CREATE TABLE work_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id),
  source_type text NOT NULL CHECK (source_type IN ('signal','connection','aid','activity','manual')),
  source_id uuid, title text NOT NULL, done_on date NOT NULL,
  created_by uuid NOT NULL REFERENCES members(id),
  reviewed_by uuid REFERENCES members(id), reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wr_id_cid UNIQUE (id, community_id),
  CONSTRAINT wr_manual_review CHECK (
    source_type <> 'manual' OR (reviewed_by IS NULL) = (reviewed_at IS NULL))
);

CREATE TABLE work_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL,
  work_record_id uuid NOT NULL,
  member_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('doer','receiver')),
  UNIQUE (work_record_id, member_id),
  FOREIGN KEY (work_record_id, community_id) REFERENCES work_records (id, community_id),
  FOREIGN KEY (member_id, community_id)      REFERENCES members      (id, community_id)
);

CREATE TABLE work_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id),
  work_record_id uuid NOT NULL,
  member_id uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  note text,
  UNIQUE (work_record_id, member_id),
  CONSTRAINT work_confirmations_wr_member_fkey
    FOREIGN KEY (work_record_id, member_id)
      REFERENCES work_participants (work_record_id, member_id)
);

CREATE TABLE member_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id),
  kind text NOT NULL CHECK (kind IN ('guarantee','worked_together')),
  member_a uuid NOT NULL REFERENCES members(id),
  member_b uuid NOT NULL REFERENCES members(id),
  first_work_record_id uuid REFERENCES work_records(id),
  established_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rel_not_self  CHECK (member_a <> member_b),
  CONSTRAINT rel_canonical CHECK (kind <> 'worked_together' OR member_a < member_b),
  CONSTRAINT rel_unique    UNIQUE (community_id, kind, member_a, member_b)
);

-- guarantee là cạnh CÓ HƯỚNG, nhưng không thể tồn tại cả (A→B) lẫn (B→A)
CREATE UNIQUE INDEX rel_guarantee_one_direction ON member_relations
  (community_id, LEAST(member_a, member_b), GREATEST(member_a, member_b))
  WHERE kind = 'guarantee';
```

Cạnh sinh ra khi bản ghi xác nhận **cuối cùng** được ghi, không sớm hơn một mili-giây:

```sql
CREATE FUNCTION fn_work_edge() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; v_cid uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM work_participants p
     WHERE p.work_record_id = NEW.work_record_id
       AND NOT EXISTS (SELECT 1 FROM work_confirmations c
                        WHERE c.work_record_id = p.work_record_id
                          AND c.member_id = p.member_id)
  ) THEN RETURN NEW; END IF;      -- còn thiếu người: chưa có cạnh nào

  SELECT community_id INTO v_cid FROM work_records WHERE id = NEW.work_record_id;

  FOR r IN SELECT a.member_id AS lo, b.member_id AS hi
             FROM work_participants a
             JOIN work_participants b ON b.work_record_id = a.work_record_id
                                     AND a.member_id < b.member_id
            WHERE a.work_record_id = NEW.work_record_id
  LOOP
    INSERT INTO member_relations
      (community_id, kind, member_a, member_b, first_work_record_id)
    VALUES (v_cid, 'worked_together', r.lo, r.hi, NEW.work_record_id)
    ON CONFLICT (community_id, kind, member_a, member_b) DO NOTHING;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_work_edge AFTER INSERT ON work_confirmations
  FOR EACH ROW EXECUTE FUNCTION fn_work_edge();
```

Luật "chỉ chính chủ xác nhận" xuất hiện ở hai bảng, nên viết một hàm dùng chung:

```sql
CREATE FUNCTION fn_self_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_row   uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NO_ACTOR' USING DETAIL = 'giao dịch không đóng dấu người thực hiện';
  END IF;
  IF v_row IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'SELF_ONLY'
      USING DETAIL = format('%s.%s phải là chính người đang đăng nhập', TG_TABLE_NAME, TG_ARGV[0]);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_wc_self_only   BEFORE INSERT ON work_confirmations
  FOR EACH ROW EXECUTE FUNCTION fn_self_only('member_id');
CREATE TRIGGER trg_slot_self_only BEFORE INSERT ON aid_slot_takers
  FOR EACH ROW EXECUTE FUNCTION fn_self_only('member_id');
```

Bất động sau xác nhận đầu tiên, và không xóa được:

```sql
CREATE FUNCTION fn_work_record_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM work_confirmations WHERE work_record_id = OLD.id)
     AND (NEW.done_on, NEW.title, NEW.source_type, NEW.source_id)
      IS DISTINCT FROM (OLD.done_on, OLD.title, OLD.source_type, OLD.source_id) THEN
    RAISE EXCEPTION 'WORK_RECORD_FROZEN'
      USING DETAIL = 'đã có xác nhận, chỉ còn sửa được reviewed_by/reviewed_at';
  END IF;
  RETURN NEW;
END $$;

REVOKE INSERT, UPDATE, DELETE ON member_relations   FROM app_role;
GRANT  SELECT                  ON member_relations   TO   app_role;
REVOKE UPDATE, DELETE          ON work_confirmations FROM app_role;
REVOKE DELETE                  ON work_records       FROM app_role;
```

**Ứng dụng cố ghi sai thì gặp gì** — mỗi dòng dưới đây trỏ tới một đối tượng SQL có tên thật ở trên:

| Ứng dụng làm gì | CSDL trả lời |
|---|---|
| A xác nhận thay B | `ERROR: SELF_ONLY — work_confirmations.member_id phải là chính người đang đăng nhập` |
| Xác nhận ngoài giao dịch có dấu | `ERROR: NO_ACTOR` |
| Xác nhận người không tham gia việc | `ERROR: violates foreign key constraint "work_confirmations_wr_member_fkey"` |
| Xác nhận hai lần để ăn gian số việc | `ERROR: duplicate key value violates unique constraint` |
| `INSERT INTO member_relations` bằng tay | `ERROR: permission denied for table member_relations` |
| Ghi cạnh (B,A) khi đã có (A,B) | `ERROR: violates check constraint "rel_canonical"` |
| A bảo lãnh B khi B đã bảo lãnh A | `ERROR: duplicate key value violates unique index "rel_guarantee_one_direction"` |
| Sửa ngày/tên việc đã có xác nhận | `ERROR: WORK_RECORD_FROZEN` |
| Xóa bản ghi việc để nắn số liệu | `ERROR: permission denied for table work_records` |

### 4.2 Ba chữ ký mở kênh: số điện thoại không nằm ở chỗ API lỡ tay đọc được

Ràng buộc `CHECK` là phần dễ:

```sql
ALTER TABLE introductions ADD CONSTRAINT intro_three_consents CHECK (
  channel_opened_at IS NULL
  OR (consent_introducer AND consent_candidate AND consent_poster));
```

Phần khó là bảo đảm "API không trả số điện thoại của bên nào", chứ không phải hứa "route sẽ lọc". Câu trả lời: **bỏ khả năng route đọc được**.

```sql
CREATE TABLE member_contacts (
  member_id uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES communities(id),
  phone text, zalo text, messenger text, address text
);
REVOKE ALL ON member_contacts FROM app_role;   -- kể cả SELECT
```

Một route viết ẩu `SELECT * FROM members` **không thể** làm lộ số điện thoại, vì trong bảng đó không có số điện thoại. Đường duy nhất còn lại là `contact_read` (mục 5.2) — nó tự kiểm quyền, tự ghi log, không bỏ qua được.

**Người CHƯA phải thành viên cũng phải được che như vậy** (bổ sung ở Task 9 theo Ruling T8-f). Giữa lúc nộp đơn và lúc duyệt, số điện thoại thô và băm mật khẩu của người nộp đơn không có chỗ nào để ở: hàng `members` chưa ra đời. Bản nháp đầu để chúng trong `join_requests.applicant_data` — một cột `jsonb` mà `app_role` **có `SELECT`**, tức đúng đường rò mà `member_contacts` vừa bịt, chỉ khác là lộ qua *đơn* thay vì qua *hồ sơ*.

```sql
CREATE TABLE join_request_secrets (
  join_request_id uuid PRIMARY KEY,
  community_id uuid NOT NULL REFERENCES communities(id),
  phone text NOT NULL, password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (join_request_id, community_id)
    REFERENCES join_requests (id, community_id) ON DELETE CASCADE
);
REVOKE ALL   ON join_request_secrets FROM app_role;
GRANT  INSERT ON join_request_secrets TO   app_role;
```

Đường **ghi** là `GRANT INSERT` trần chứ không phải hàm `SECURITY DEFINER`, và đó là lựa chọn có lý do: `/auth/register` là đường công khai chạy `withActor(null)`, nên một hàm ghi `SECURITY DEFINER` phục vụ nó sẽ là hàm chạy bằng quyền **owner** mà mọi câu SQL của `app_role` đều gọi được và không kiểm được gì — quyền *lớn hơn* `INSERT` trần chứ không nhỏ hơn. Tính chất cần có là "`app_role` không **đọc** được", và `REVOKE ALL` + `GRANT INSERT` giữ đúng tính chất đó; `PRIMARY KEY` làm mỗi đơn chỉ ghi được một lần.

Đường **đọc** là `join_secret_consume(uuid)` — `SECURITY DEFINER`, đòi actor, đòi actor có vai `approver` **của chính cộng đồng đó**, đòi đơn đang ở `met_confirmed`, ghi `audit_log`, rồi **xoá hàng** và trả về. Xoá vì người gọi hợp lệ duy nhất là `approve()`, và ngay trong cùng giao dịch đó số điện thoại đi vào `member_contacts` (nơi có ba mức riêng tư canh) còn băm mật khẩu đi vào `members.password_hash`; giữ thêm một bản sao thô sau đó là giữ đúng thứ cả kiến trúc đang tránh. Khác `contact_read`, ở đây **mọi nhánh hỏng đều `RAISE`** — không nhánh nào là hành vi người dùng bình thường cần audit, vì người không phải approver không bao giờ tới được hàm này qua API.

### 4.3 Hạn mức bảo lãnh

**Cửa sổ: 12 tháng trượt.** Năm dương lịch cho phép bảo lãnh 3 người tháng 12 rồi 3 người nữa tháng 1 — sáu người trong tám tuần, đúng thứ hạn mức sinh ra để chặn.

**Đơn nào tiêu suất:** `pending`, `met_confirmed`, `approved`. Đơn `draft` chưa tính. Đơn `rejected` **trả lại suất**, trừ khi lý do từ chối là `referrer_misrepresented` — người bảo lãnh ngay tình không bị phạt vì quyết định của ban duyệt, người khai gian thì mất suất vĩnh viễn.

**Chống chạy đua: khóa tư vấn theo giao dịch.** `FOR UPDATE` vô dụng vì đây là bài toán bóng ma — đếm hàng chưa tồn tại thì không có gì để khóa. `SERIALIZABLE` giải được nhưng buộc mọi giao dịch trong hệ thống phải có vòng thử lại. Khóa tư vấn khóa đúng một người giới thiệu, rẻ, tự nhả khi commit.

```sql
CREATE FUNCTION fn_guarantee_quota() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_used int; v_extra int; v_cap int;
BEGIN
  IF NEW.referrer_id IS NULL THEN
    RAISE EXCEPTION 'REFERRER_REQUIRED';         -- nguyên tắc 1
  END IF;
  IF NEW.status NOT IN ('pending','met_confirmed','approved') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.referrer_id::text, 42));

  SELECT count(*) INTO v_used FROM join_requests
   WHERE referrer_id = NEW.referrer_id
     AND id <> NEW.id
     AND created_at > now() - interval '12 months'
     AND (status IN ('pending','met_confirmed','approved')
       OR (status = 'rejected' AND reject_reason_code = 'referrer_misrepresented'));

  SELECT coalesce(sum(extra_slots), 0) INTO v_extra
    FROM guarantee_quota_overrides
   WHERE referrer_id = NEW.referrer_id AND valid_until > now();

  -- hạn mức là chính sách của cộng đồng, không phải hằng số của nền tảng
  v_cap := coalesce((SELECT (config->>'guarantee_quota_per_year')::int
                       FROM communities WHERE id = NEW.community_id), 3) + v_extra;
  IF v_used >= v_cap THEN
    RAISE EXCEPTION 'GUARANTEE_QUOTA_EXCEEDED'
      USING DETAIL = format('%s/%s trong 12 tháng gần nhất', v_used, v_cap);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_guarantee_quota
  BEFORE INSERT OR UPDATE OF status ON join_requests
  FOR EACH ROW EXECUTE FUNCTION fn_guarantee_quota();
```

Trigger bắt cả `UPDATE OF status`, nếu không thì lách bằng cách tạo mười đơn `draft` rồi đẩy lên `pending` một lượt.

**`referrer_id` phải là khóa ngoại GHÉP `(referrer_id, community_id)`, không phải `REFERENCES members(id)`.** Với khóa ngoại đơn cột, `community_id` và `referrer_id` là hai ràng buộc độc lập, nên **một đơn của cộng đồng B trỏ được người bảo lãnh sang thành viên của cộng đồng A** — và khi đó hàm trên đọc `cap` từ `config` của B trong khi tiêu suất của một người thuộc A. Hạn mức của A bị chi tiêu bằng luật của B. Migration 004 đã cố ý để sẵn `UNIQUE members_id_cid (id, community_id)` cho đúng việc này. Áp dụng cho `join_requests.referrer_id`, `join_requests.member_id` và `guarantee_quota_overrides.referrer_id`; `met_confirmed_by`/`approved_by` giữ khóa đơn cột vì chúng do ứng dụng đặt sau khi đã kiểm cộng đồng và không nuôi hàm hạn mức nào.

Vị từ của chỉ mục hạn mức phải phủ **cả** vế `rejected AND reject_reason_code = 'referrer_misrepresented'`. Bản nháp đầu chỉ liệt kê ba trạng thái đang hoạt động, tức đúng những hàng đốt suất vĩnh viễn thì rơi ra ngoài chỉ mục của chính câu đếm chúng.

**Ai được vượt:** `guarantee_quota_overrides (referrer_id, extra_slots, reason, granted_by, valid_until)`. Cấp qua **khung hai người ký** (mục 7) — đây là quyết định về thành phần cộng đồng, cùng loại với "chấm dứt tư cách". Có thời hạn, nên nới lỏng tự hết hạn thay vì nằm lại vĩnh viễn.

### 4.4 `manual` là cửa đúc bậc uy tín

Nguyên tắc 5 nói *trao đổi thật diễn ra ngoài nền tảng* — phần lớn việc thật giữa những người này xảy ra qua điện thoại và gặp mặt. **Bỏ hẳn `manual` sẽ đếm sai theo hướng nghiêm trọng hơn:** nó ép người ta dựng tín hiệu giả cho việc có thật, làm bẩn dữ liệu ở chỗ khó phát hiện hơn nhiều. Nên giữ `manual`, siết hai lớp:

**Lớp 1 — approver mở khóa.** `member_trust_stats` là nơi duy nhất đếm, nên luật nằm gọn một chỗ: việc được tính khi đủ xác nhận của mọi người tham gia **và** (`source_type <> 'manual'` **hoặc** `reviewed_at IS NOT NULL`).

**Lớp 2 — hạn mức 6 bản ghi `manual` mỗi cặp / 12 tháng**, khóa tư vấn theo cặp chuẩn tắc:

```sql
CREATE FUNCTION fn_manual_pair_quota() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_lo uuid; v_hi uuid; v_n int;
BEGIN
  IF (SELECT source_type FROM work_records WHERE id = NEW.work_record_id) <> 'manual'
    THEN RETURN NEW; END IF;
  SELECT min(member_id), max(member_id) INTO v_lo, v_hi
    FROM work_participants WHERE work_record_id = NEW.work_record_id;
  IF v_lo IS NULL OR v_lo = v_hi THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_lo::text || v_hi::text, 99));

  SELECT count(DISTINCT w.id) INTO v_n
    FROM work_records w
    JOIN work_participants a ON a.work_record_id = w.id AND a.member_id = v_lo
    JOIN work_participants b ON b.work_record_id = w.id AND b.member_id = v_hi
   WHERE w.source_type = 'manual' AND w.created_at > now() - interval '12 months';

  IF v_n > coalesce((SELECT (config->>'manual_pair_quota')::int
                       FROM communities WHERE id = NEW.community_id), 6) THEN
    RAISE EXCEPTION 'MANUAL_PAIR_QUOTA_EXCEEDED'
      USING DETAIL = format('%s bản ghi thủ công giữa hai người trong 12 tháng', v_n);
  END IF;
  RETURN NEW;
END $$;
```

Thêm: `created_by` của bản ghi `manual` bắt buộc là một trong những người tham gia; bảng điều khiển vận hành hiện tỷ lệ `manual / tổng việc tính bậc` của từng người. Kịch bản "hai người lên Kim Cương trong một buổi tối" giờ cần 100 bản ghi, chặn ở bản ghi thứ bảy mỗi cặp, mỗi bản ghi qua approver.

### 4.5 Các ràng buộc còn lại

| Quy tắc | Thực hiện bằng | Ứng dụng ghi sai thì gặp |
|---|---|---|
| `status='member'` chỉ sau `met_confirmed_at` | Trigger `BEFORE INSERT OR UPDATE OF status ON members`, tra `join_requests` qua `member_id` | `ERROR: MEMBER_NEEDS_MET_CONFIRMATION` |
| Tự nhận suất, không điền hộ | `fn_self_only('member_id')` trên `aid_slot_takers` | `ERROR: SELF_ONLY` |
| Quỹ ≥ 1 triệu cần 2 approver | Bảng nối + trigger ràng buộc hoãn (dưới) | `ERROR: FUND_TWO_APPROVERS_REQUIRED` |
| `fund_entries.locked` bất động | Trigger `BEFORE UPDATE OR DELETE` + `REVOKE DELETE` | `ERROR: FUND_ENTRY_LOCKED` |
| Hoạt động dùng quỹ khi còn món chưa tổng kết | Trigger `BEFORE INSERT ON activities` | `ERROR: SUMMARY_REQUIRED` → 422 |
| Bảo chứng đúng 2 người khác nhau | `endorsement_signatures` + trigger hoãn `= 2`, `signer_id <> member_id` | `ERROR: ENDORSEMENT_NEEDS_TWO_DISTINCT` |
| Ảnh ký ức chỉ `approved` khi tất cả đồng ý | Trigger dò `memory_photo_people`; `no_reply` và thiếu hàng đều là chưa đồng ý | `ERROR: PHOTO_CONSENT_INCOMPLETE` |
| Không chuyển tiếp tự động | `signal_forwards.from_member_id NOT NULL` + FK + `CHECK (from <> to)` | `ERROR: null value … violates not-null` |
| Vòng bảo lãnh A→B→C→A | Trigger đi ngược tổ tiên khi đặt `referrer_id` | `ERROR: GUARANTEE_CYCLE` |
| `audit_log` chỉ INSERT | `REVOKE UPDATE, DELETE` + `fn_audit_chain` | `ERROR: permission denied for table audit_log` |
| Mọi bảng có `community_id` | `NOT NULL REFERENCES communities(id)` từ migration đầu; T10 quét `information_schema` | CI đỏ |

**"Phải có ≥2 chữ ký" là ràng buộc liên hàng** — `CHECK` không làm được, `BEFORE INSERT` sai vì lúc ghi bút toán chưa có chữ ký nào. Công cụ đúng là trigger ràng buộc hoãn tới lúc commit:

```sql
CREATE TABLE fund_entry_approvals (
  entry_id    uuid NOT NULL REFERENCES fund_entries(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES members(id),
  signed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, approver_id)
);

CREATE FUNCTION fn_fund_two_approvers() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_n int;
BEGIN
  IF abs(NEW.amount) < 1000000 THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_n
    FROM fund_entry_approvals a
    JOIN member_roles mr ON mr.member_id = a.approver_id
    JOIN roles r ON r.id = mr.role_id AND r.key = 'approver'
   WHERE a.entry_id = NEW.id AND a.approver_id <> NEW.created_by;
  IF v_n < 2 THEN
    RAISE EXCEPTION 'FUND_TWO_APPROVERS_REQUIRED'
      USING DETAIL = format('mới có %s chữ ký approver hợp lệ', v_n);
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_fund_two_approvers
  AFTER INSERT OR UPDATE ON fund_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_fund_two_approvers();
```

Bút toán và hai chữ ký ghi trong cùng giao dịch; kiểm tra chạy lúc `COMMIT`, khi cả ba đã có mặt. `PRIMARY KEY` chặn ký hai lần, `<> NEW.created_by` chặn tự ký cho bút toán mình tạo, join sang `roles` chặn người không phải approver. `jsonb` làm không nổi việc này vì nó chỉ đếm được số phần tử, không kiểm được người ký **có thật, đúng vai, khác người tạo**.

### 4.6 Chuỗi băm

Tính **trong CSDL**, ứng dụng không có cơ hội tính sai:

```sql
CREATE TABLE audit_chain_head (community_id uuid PRIMARY KEY, seq bigint, hash text);

CREATE FUNCTION fn_audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || NEW.community_id::text, 7));
  SELECT hash INTO v_prev FROM audit_chain_head WHERE community_id = NEW.community_id;
  NEW.prev_hash := coalesce(v_prev, repeat('0', 64));
  NEW.at        := coalesce(NEW.at, clock_timestamp());
  NEW.hash := encode(digest(
      NEW.prev_hash || '|' || coalesce(NEW.actor_id::text, '-') || '|' || NEW.action || '|' ||
      coalesce(NEW.target_type, '-') || '|' || coalesce(NEW.target_id::text, '-') || '|' ||
      to_char(NEW.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'sha256'), 'hex');
  INSERT INTO audit_chain_head VALUES (NEW.community_id, NEW.seq, NEW.hash)
    ON CONFLICT (community_id) DO UPDATE SET seq = EXCLUDED.seq, hash = EXCLUDED.hash;
  RETURN NEW;
END $$;
```

Bảng đầu chuỗi tồn tại vì `audit_log` phân mảnh theo tháng — `ORDER BY seq DESC LIMIT 1` sẽ phải dò mọi mảnh, còn tra một hàng thì không.

**Về liều lượng, nói thẳng:** ở 52 người, lưu lượng ước chừng 200–400 dòng/ngày ≈ 100 nghìn dòng/năm. Phân mảnh **không cần** cho tốc độ, kể cả sau mười năm. Nó đáng làm vì lý do khác: tách một tháng cũ ra để đẩy sang kho chỉ-ghi hằng tuần là một lệnh `DETACH`, thay vì quét theo khoảng ngày. Ngưỡng cảnh báo trên bảng điều khiển: bảng > 5 GB, hoặc số dòng/ngày vượt 5 lần trung bình 30 ngày (dấu hiệu có người đang dò hàng loạt).

### 4.7 Cạnh bảo lãnh và khởi tạo hồ sơ — cũng do trigger, service không chạm

`member_relations` và `member_contacts` đều nằm ngoài tầm với của `app_role`. Vì vậy **luồng duyệt gia nhập không được tự ghi vào hai bảng đó** — nó chỉ tạo hàng `members`, phần còn lại là việc của trigger `SECURITY DEFINER`.

**Nguồn sự thật của quan hệ bảo lãnh là `members.referrer_id`.** `member_relations(kind='guarantee')` là **bản dẫn xuất**, sinh tự động, ứng dụng chỉ đọc. Hai chỗ ghi được thì sẽ có ngày lệch, và lúc đó không ai biết chỗ nào đúng.

```sql
CREATE FUNCTION fn_member_bootstrap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- 1. Hộp liên hệ rỗng (app_role không tạo nổi vì bị REVOKE ALL)
  INSERT INTO member_contacts (member_id, community_id) VALUES (NEW.id, NEW.community_id)
    ON CONFLICT (member_id) DO NOTHING;

  -- 2. Tám mức riêng tư mặc định, đọc từ communities.config
  INSERT INTO privacy_settings (member_id, community_id, field_key, level)
  SELECT NEW.id, NEW.community_id, k.field_key, k.level
    FROM jsonb_to_recordset(
           (SELECT config->'privacy_defaults' FROM communities WHERE id = NEW.community_id)
         ) AS k(field_key text, level text)
    ON CONFLICT (member_id, field_key) DO NOTHING;

  -- 3. Cạnh bảo lãnh — dẫn xuất từ referrer_id, không phải do service ghi
  IF NEW.referrer_id IS NOT NULL THEN
    INSERT INTO member_relations (community_id, kind, member_a, member_b)
    VALUES (NEW.community_id, 'guarantee', NEW.referrer_id, NEW.id)
      ON CONFLICT (community_id, kind, member_a, member_b) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_member_bootstrap AFTER INSERT ON members
  FOR EACH ROW EXECUTE FUNCTION fn_member_bootstrap();
```

Sợi bảo lãnh là sự thật lịch sử, không sửa lại được sau khi đã thành:

```sql
CREATE FUNCTION fn_referrer_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.referrer_id IS DISTINCT FROM NEW.referrer_id AND OLD.status = 'member' THEN
    RAISE EXCEPTION 'REFERRER_FROZEN'
      USING DETAIL = 'sợi bảo lãnh đã thành sự thật lịch sử, không sửa được';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_referrer_frozen BEFORE UPDATE OF referrer_id ON members
  FOR EACH ROW EXECUTE FUNCTION fn_referrer_frozen();
```

Số điện thoại của người mới đến từ `join_requests.applicant_data`, mà service không ghi thẳng vào `member_contacts` được. Một hàm hẹp, hai lối vào hợp lệ:

```sql
CREATE FUNCTION contact_upsert(p_target uuid, p_field text, p_value text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_cur text; v_is_approver boolean; v_cid uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NO_ACTOR'; END IF;
  IF p_field NOT IN ('phone','zalo','messenger','address') THEN
    RAISE EXCEPTION 'BAD_FIELD'; END IF;

  SELECT community_id INTO v_cid FROM members WHERE id = p_target;
  IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_TARGET'; END IF;

  EXECUTE format('SELECT %I FROM member_contacts WHERE member_id = $1', p_field)
    INTO v_cur USING p_target;
  -- v_cid lấy từ hàng members của p_target. Vế `mr.community_id = v_cid` KHÔNG được
  -- bỏ: thiếu nó thì một approver của cộng đồng khác cũng thoả điều kiện, và ô liên
  -- hệ được canh gắt nhất trở thành ô người ngoài cộng đồng điền hộ. Bản nháp đầu
  -- của đặc tả này thiếu đúng vế đó — cùng họ với Ruling T7-a và T8-d.
  SELECT EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
                  WHERE mr.member_id = v_actor AND mr.community_id = v_cid
                    AND r.key = 'approver') INTO v_is_approver;

  -- chính chủ sửa bất cứ lúc nào; approver CHỈ được điền lần đầu, khi ô còn trống
  IF NOT (v_actor = p_target OR (v_is_approver AND v_cur IS NULL)) THEN
    RAISE EXCEPTION 'CONTACT_WRITE_DENIED';
  END IF;

  EXECUTE format('UPDATE member_contacts SET %I = $1 WHERE member_id = $2', p_field)
    USING p_value, p_target;

  INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
  SELECT community_id, v_actor, 'contact.written', 'member', p_target,
         jsonb_build_object('field', p_field, 'first_fill', v_cur IS NULL)
    FROM members WHERE id = p_target;
END $$;
GRANT EXECUTE ON FUNCTION contact_upsert(uuid, text, text) TO app_role;
```

Approver **không** sửa được số điện thoại đã có — chỉ điền được ô còn trống, đúng một lần, và lần đó có dấu vết.

*Ghi chú trung thực về hai ràng buộc chống vòng:* vì `referrer_id` chỉ đặt được lúc tạo, và người bảo lãnh bắt buộc phải là member đã tồn tại, cạnh luôn đi từ cũ sang mới — **đồ thị không có chu trình do cách dựng**. `GUARANTEE_CYCLE` và `rel_guarantee_one_direction` vì thế là lưới an toàn cho migration/backfill sai, không phải rào chặn cho luồng chạy hằng ngày. Giữ lại, nhưng đừng ai tưởng chúng đang đỡ một mối nguy sống.

### 4.8 Chữ ký là bút toán — rà soát toàn bộ bảng chỉ-thêm

`trg_fund_two_approvers` là constraint trigger **trên `fund_entries`**, nên nó không chạy khi ai đó động vào `fund_entry_approvals`. Kịch bản lọt: giao dịch 1 ghi bút toán 2 triệu kèm 2 chữ ký (qua kiểm tra); giao dịch 2 xóa một chữ ký — không trigger nào trên bảng đó, mà `ALTER DEFAULT PRIVILEGES` ở migration 002 **đã cấp sẵn `DELETE`**. Ràng buộc bảo vệ tiền của Hội bị gỡ trong im lặng.

Hai lớp chặn:

```sql
REVOKE UPDATE, DELETE ON fund_entry_approvals       FROM app_role;
REVOKE UPDATE, DELETE ON endorsement_signatures     FROM app_role;
REVOKE UPDATE, DELETE ON pending_action_signatures  FROM app_role;

-- và trigger trên CHÍNH bảng chữ ký, để chặn cả đường owner/psql
CREATE FUNCTION fn_fund_sig_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_entry uuid := coalesce(NEW.entry_id, OLD.entry_id); v_amount numeric; v_n int; v_locked boolean;
BEGIN
  SELECT amount, locked INTO v_amount, v_locked FROM fund_entries WHERE id = v_entry;
  IF v_amount IS NULL THEN RETURN NULL; END IF;                    -- bút toán đã biến mất
  IF TG_OP = 'INSERT' AND v_locked THEN
    RAISE EXCEPTION 'FUND_ENTRY_LOCKED' USING DETAIL = 'không thêm chữ ký vào bút toán đã khóa';
  END IF;
  IF abs(v_amount) < 1000000 THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_n
    FROM fund_entry_approvals a
    JOIN member_roles mr ON mr.member_id = a.approver_id
    JOIN roles r ON r.id = mr.role_id AND r.key = 'approver'
   WHERE a.entry_id = v_entry
     AND a.approver_id <> (SELECT created_by FROM fund_entries WHERE id = v_entry);
  IF v_n < 2 THEN
    RAISE EXCEPTION 'FUND_TWO_APPROVERS_REQUIRED'
      USING DETAIL = format('bút toán còn %s chữ ký approver hợp lệ', v_n);
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_fund_sig_guard
  AFTER INSERT OR UPDATE OR DELETE ON fund_entry_approvals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_fund_sig_guard();
```

`endorsement_signatures` dùng cùng khuôn, khác ở `= 2` thay vì `>= 2`.

**Rà soát chung — mọi bảng lẽ ra chỉ-thêm mà `ALTER DEFAULT PRIVILEGES` đã lỡ cấp `UPDATE`/`DELETE`.** Đây là cùng loại bẫy mà mục 1.6 đã cảnh báo với phân mảnh `audit_log`. Bảng dưới là nguồn sự thật, được chép sang `tests/expected-grants.json` và T10 đối chiếu:

| Bảng | Quyền của `app_role` | Vì sao |
|---|---|---|
| `audit_log` (+ mọi phân mảnh) | `SELECT, INSERT` | Nhật ký không tẩy được |
| `member_relations` | `SELECT` | Cạnh chỉ do trigger sinh |
| `member_contacts` | *không có gì* | Chỉ vào được qua `contact_read` / `contact_upsert` |
| `join_request_secrets` | `INSERT` | **Mới (Task 9)** — ghi được lúc nộp đơn, không đọc lại được; đường đọc là `join_secret_consume` |
| `work_participants` | đủ bốn quyền | Danh sách người tham gia còn sửa được tới khi có xác nhận đầu tiên |
| `work_confirmations` | `SELECT, INSERT` | Xác nhận là bút toán |
| `work_records` | `SELECT, INSERT, UPDATE` | Không xóa được; sửa bị `WORK_RECORD_FROZEN` chặn |
| `fund_entry_approvals` | `SELECT, INSERT` | **Mới** — chữ ký không gỡ được |
| `endorsement_signatures` | `SELECT, INSERT` | **Mới** — cùng lý do |
| `pending_action_signatures` | `SELECT, INSERT` | **Mới** — cùng lý do |
| `profile_views` | `SELECT, INSERT` | **Mới** — người xem không được xóa dấu vết mình đã xem |
| `signal_forwards` | `SELECT, INSERT` | **Mới** — chuyển tiếp là nhận trách nhiệm, không rút lại |
| `connection_events`, `complaint_events` | `SELECT, INSERT` | **Mới** — sổ sự kiện |
| `memory_versions`, `report_versions` | `SELECT, INSERT` | **Mới** — lịch sử phiên bản |
| `memory_consents` | `SELECT, INSERT, UPDATE` | **Mới** — đổi ý được, xóa thì không |
| `guarantee_quota_overrides` | `SELECT, INSERT` | **Mới** — nới lỏng tự hết hạn bằng `valid_until`, không sửa lại |
| `backups`, `restore_tests` | `SELECT, INSERT` | **Mới** — ghi nhận việc đã xảy ra |
| `fund_entries` | `SELECT, INSERT, UPDATE` | Không xóa; `locked` chặn sửa |
| `join_requests`, `contact_requests` | `SELECT, INSERT, UPDATE` | **Mới (bỏ DELETE)** — đơn đã nộp không biến mất |
| Còn lại | đủ bốn quyền | |

---

## 5. API giai đoạn 1

### 5.1 Quy ước

- Tiền tố `/api/v1`, JSON, đúng mã HTTP.
- Lỗi: `{ "error": { "code": "SNAKE_CASE", "message": "câu tiếng Việt", "fields": {…} } }`
- Phân trang: `?page=1&limit=20` → `{ data: [], meta: { page, limit, total } }`
- Mọi thân request đi qua zod trước khi chạm service. Không tin frontend.
- Rate limit: 5 lần/phút cho OTP, 60 lần/phút cho API thường, 10 lần/phút cho các endpoint đọc liên hệ.
- CORS chỉ cho `binhdan1986.com`. HSTS bật. Production không trả stack trace.

**Ánh xạ lỗi CSDL → HTTP** (`core/errors.js`, dùng bởi `middleware/errorHandler.js`):

| Lỗi PostgreSQL | HTTP | `code` |
|---|---|---|
| `GUARANTEE_QUOTA_EXCEEDED` | 422 | `GUARANTEE_QUOTA_EXCEEDED` |
| `MANUAL_PAIR_QUOTA_EXCEEDED` | 422 | `MANUAL_PAIR_QUOTA_EXCEEDED` |
| `SELF_ONLY` | 403 | `SELF_ONLY` |
| `MEMBER_NEEDS_MET_CONFIRMATION` | 422 | `MET_CONFIRMATION_REQUIRED` |
| `SUMMARY_REQUIRED` | 422 | `SUMMARY_REQUIRED` |
| `FUND_ENTRY_LOCKED` | 409 | `FUND_ENTRY_LOCKED` |
| `FUND_TWO_APPROVERS_REQUIRED` | 422 | `TWO_APPROVERS_REQUIRED` |
| `GUARANTEE_CYCLE` | 422 | `GUARANTEE_CYCLE` |
| `WORK_RECORD_FROZEN` | 409 | `WORK_RECORD_FROZEN` |
| `REFERRER_FROZEN` | 409 | `REFERRER_FROZEN` |
| `CONTACT_WRITE_DENIED` | 403 | `CONTACT_WRITE_DENIED` |
| `ENDORSEMENT_NEEDS_TWO_DISTINCT` | 422 | `TWO_SIGNERS_REQUIRED` |
| `NO_ACTOR` | 500 | `INTERNAL` (lỗi lập trình, không phải lỗi người dùng) |
| `permission denied for table …` | 500 | `INTERNAL` + cảnh báo vận hành mức cao |
| `23505` trùng khóa | 409 | `DUPLICATE` |
| `23503` khóa ngoại | 422 | `INVALID_REFERENCE` |

Mỗi lỗi ở nhóm 4xx kéo theo một lời gọi `logDenied`. Hai dòng cuối là **lỗi của chúng ta**, không phải của người dùng: chúng nghĩa là một route đã cố làm việc mà thiết kế cấm.

### 5.2 Hình dạng phản hồi khi bị chặn bởi quyền riêng tư

**Trường không bao giờ biến mất khỏi JSON.** Một khóa vắng mặt không phân biệt được với một lỗi lập trình. Mỗi trường liên hệ là một bao bì có trạng thái:

```json
{
  "id": "…",
  "full_name": "Nguyễn Văn Hùng",
  "area": { "id": "…", "name": "Xã Khoái Châu" },
  "job": "Thợ điện nước",
  "contacts": {
    "phone":     { "value": null,     "level": "on_consent", "state": "can_request", "request_id": null },
    "zalo":      { "value": null,     "level": "on_consent", "state": "requested",   "request_id": "…" },
    "messenger": { "value": "fb.me/…","level": "public",     "state": "visible",     "request_id": null },
    "address":   { "value": null,     "level": "closed",     "state": "closed",      "request_id": null }
  }
}
```

| `state` | Nghĩa | Frontend hiện gì |
|---|---|---|
| `self` | Đang xem hồ sơ của chính mình | Giá trị đầy đủ, nút sửa |
| `visible` | Được phép xem | Giá trị đầy đủ |
| `can_request` | Mức `on_consent`, chưa xin | Nút **"Xin xem số liên hệ"** |
| `requested` | Đã xin, đang chờ | "Đang chờ chủ hồ sơ trả lời" |
| `denied` | Đã xin, bị từ chối | Trạng thái mờ, không hiện nút xin lại trong 30 ngày |
| `closed` | Mức `closed` | Không hiện nút gì |

**Quan trọng:** trong danh sách, `value` **luôn** là `null` kể cả khi `state = "visible"`. Giá trị thật chỉ trả bởi `GET /members/:id/contacts/:field` — đây là điều làm cho bộ đếm "ai đã xem gì" trung thực, và là lý do không có bài toán N+1 (mục 6).

Màn 0004 của frontend đã hiện `09•• ••• 638` kèm dòng *"hiện đầy đủ khi chủ hồ sơ đồng ý kết nối"*, màn 0003 chỉ có nút *"Xem hồ sơ →"*. Hai bên khớp nhau sẵn, frontend không phải đổi cấu trúc.

### 5.3 Bảng endpoint

Cột "Log" là `action` ghi vào `audit_log`; dấu `—` nghĩa là không ghi.

#### Xác thực

| Method | Đường dẫn | Vai | Vào (zod) | Ra | Log |
|---|---|---|---|---|---|
| POST | `/auth/otp/request` | công khai | `{ phone: vnPhone, purpose: 'register'\|'reset' }` | `204` | `otp.requested` |
| POST | `/auth/otp/verify` | công khai | `{ phone, code: /^\d{6}$/, purpose }` | `{ otp_token }` (5 phút) | `otp.verified` / `otp.failed` |
| POST | `/auth/register` | công khai | `{ otp_token, phone: vnPhone, full_name, birth_year: 1986, area_id, referrer_id, password: min(8), terms: true }` | `{ join_request_id, step }` | `join_request.created` |
| POST | `/auth/login` | công khai | `{ identifier, password }` | `{ access, refresh, member }` | `auth.login` / `auth.login.denied` |
| POST | `/auth/refresh` | công khai | `{ refresh_token }` | `{ access, refresh }` | — |
| POST | `/auth/logout-all` | member | — | `204` | `auth.logout_all` |
| POST | `/auth/password/reset` | công khai | `{ otp_token, new_password }` | `204` | `auth.password_reset` |

`birth_year` cố định 1986 nằm trong `communities.config`, **không nằm trong mã nguồn** — cộng đồng sau có thể là năm khác.

> **`phone` được thêm vào `/auth/register` sau khi thi công Task 8 phát hiện bản nháp này tự mâu thuẫn.** Bảng trên không nhận số điện thoại, nhưng mục "Gia nhập" bên dưới lại đòi `approve` chạy `contact_upsert(<member_id>, 'phone', <số từ applicant_data>)`. Số đó **không suy ra được** từ `otp_token`: hệ thống cố ý chỉ lưu HMAC `phone_hash`, và HMAC không đảo ngược. Để nguyên thì luồng duyệt không có gì để điền vào hộp liên hệ.
>
> Số gửi lên **phải được đối chiếu với claim `ph` trong `otp_token`**. Không đối chiếu thì bất kỳ ai có một vé hợp lệ của số mình đều khai được số người khác vào `applicant_data`, và bước duyệt sẽ đem số đó gắn vào hồ sơ người mới — biến ô liên hệ được canh gắt nhất thành ô người lạ điền hộ.
>
> `otp_token` cũng **chỉ dùng được một lần**: claim `ch` mang id challenge, và `otp_challenges.consumed_at` đảm bảo nộp lần hai không tìm thấy hàng nào để cập nhật. Không mượn `status='expired'` cho việc này — "hết hạn theo thời gian" khác hẳn "đã dùng để lập đơn".

Access token 15 phút, refresh 30 ngày. `refresh_tokens (id, member_id, token_hash, family_id, issued_at, expires_at, revoked_at, replaced_by)` — lưu **băm**, không lưu token; xoay vòng khi dùng; phát hiện dùng lại token cũ thì thu hồi cả `family_id`.

#### Chặn dò mã OTP

Rate limit 5 lần/phút **không đủ**. OTP ở đây là đường đặt lại mật khẩu — dò trúng là chiếm tài khoản. Với 20 phiên song song từ 20 IP, xác suất trúng trong vòng đời 5 phút của một mã không còn nhỏ.

```sql
CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id),
  phone_hash text NOT NULL,     -- HMAC-SHA256(phone, OTP_PEPPER); KHÔNG lưu số thô
  code_hash  text NOT NULL,     -- argon2id của mã 6 số; KHÔNG lưu mã
  purpose text NOT NULL CHECK (purpose IN ('register','reset')),
  attempts int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','used','burned','expired')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON otp_challenges (phone_hash, created_at DESC);
```

| Luật | Giá trị |
|---|---|
| Sinh mã | `crypto.randomInt(0, 1000000)` đệm 6 chữ số — **không phải `Math.random`** |
| So sánh | Argon2 verify (đã hằng thời gian); không so chuỗi thô |
| Sai tối đa mỗi challenge | **5** → `status='burned'`, mã chết, phải xin mã mới |
| Ba challenge hỏng liên tiếp cùng `phone_hash` trong 1 giờ | **Khóa số đó 15 phút** |
| Mỗi lần sai | Ghi `otp.failed` với `{phone_hash, attempts}` — **không ghi số, không ghi mã** |
| Vòng đời | 5 phút; dùng xong `status='used'`, không dùng lại được |

Ngân sách của kẻ dò sau khi siết: tối đa ~15 lần đoán mỗi 15 phút cho một số ⇒ ~1.400 lần/ngày trên không gian 10⁶ ⇒ kỳ vọng gần một năm. Trong vòng đời **một mã cụ thể**, kẻ dò được nhiều nhất 5 lần trên 10⁶.

`phone_hash` dùng HMAC với pepper phía máy chủ nên nó là **định danh giả**, không phải dữ liệu cá nhân — đây là lý do nó được phép nằm trong `audit_log.detail` mà không phá luật ở mục 10.

#### Không để thông báo lỗi thành công cụ dò danh sách

- **`/auth/register`:** `referrer_id` không tồn tại, `referrer_id` không phải member, và `referrer_id` đúng nhưng hết hạn mức — cả ba trả **cùng một lỗi** `REFERRAL_UNAVAILABLE` với cùng câu tiếng Việt. Ba nhánh chạy trong cùng một giao dịch và phản hồi được đệm tới **thời lượng cố định** để không lộ qua thời gian. Đệm thời gian ở tầng HTTP chỉ là xấp xỉ — nó cộng với rate limit là đủ ở quy mô này, và tôi nói rõ giới hạn đó thay vì gọi nó là chống rò rỉ tuyệt đối.

  **Sàn đệm: 700ms, không phải 300ms.** Bản nháp đầu viết 300ms và con số đó **không che được gì**. Đo thật ba nhánh khi tắt đệm cho thấy nhánh "hết hạn mức" luôn chậm hơn hai nhánh kia một cách **cấu trúc** — nó còn chèn hàng, chạy trigger hạn mức và lấy khóa tư vấn, trong khi hai nhánh kia hỏng ngay ở câu tra cứu. Hai lần đo độc lập trên hai máy khác nhau: 250/262/**342**ms và 86/86/**133**ms. Con số tuyệt đối không tái lập được (phụ thuộc phần cứng), nhưng nhánh chậm nhất **vượt sàn 300ms trên máy chậm**, và khi đã vượt sàn thì nó không được đệm chút nào — vẫn lộ nguyên chênh lệch. Luật thay cho số cứng: **sàn phải ≥ 2× nhánh chậm nhất đo được trên phần cứng triển khai thật**, và bài test phải khẳng định theo hằng số xuất ra từ mã nguồn chứ không chép lại con số. Đăng ký là việc một người làm đúng một lần trong đời, nên 700ms không đổi lấy gì đáng kể.

  **Che câu chữ thôi là che một nửa — ba nhánh còn phải để lại cùng một *trạng thái*.** Nhánh hết hạn mức hỏng bằng `RAISE EXCEPTION` từ trigger, và một ngoại lệ chưa bắt **hủy cả giao dịch**, kéo theo cả việc tiêu vé `otp_token` lẫn dòng nhật ký từ chối. Khi đó kẻ dò chỉ cần nộp lại vé cũ: còn dùng được nghĩa là vừa trúng nhánh hạn mức. Câu `INSERT` phải được bọc bằng **SAVEPOINT** để cuộn lại đúng câu hỏng, giao dịch ngoài sống tiếp và vẫn commit được cả hai việc kia. Không bọc thì còn hỏng nặng hơn: giao dịch bị nhiễm độc làm câu `auditLog` kế tiếp cũng lỗi (`current transaction is aborted`), và người dùng nhận HTTP 500 thay vì 422.

  **Đăng ký là đường công khai nên không có `req.actor`**, mà `errorHandler` chỉ gọi `logDenied` khi có actor. Không ghi nhật ký ngay trong giao dịch thì một người dò hàng trăm uuid không để lại dấu vết nào. Dòng `join_request.denied` được ghi bằng `audit.log(trx, …)` trực tiếp — luật "`errorHandler` là nơi duy nhất gọi `logDenied`" vẫn nguyên vẹn.
- **`/auth/login`:** sai `identifier` và sai `password` trả **cùng** `INVALID_CREDENTIALS`. Khi `identifier` không tồn tại, vẫn chạy so khớp mật khẩu với một **băm giả cố định** — nếu bỏ qua bước này, thời gian phản hồi tự nó tiết lộ số nào đã là thành viên.

#### Khu vực và con người

| Method | Đường dẫn | Vai | Vào | Ra | Log |
|---|---|---|---|---|---|
| GET | `/areas` | member | — | cây khu vực | — |
| GET | `/members` | member | `?q&job&area_id&status&work_status&page&limit` | danh sách, `contacts.*.value = null` | `member.list` (một dòng cho cả trang) |
| GET | `/members/:id` | member | — | hồ sơ + bao bì `contacts` | `profile.view` |
| PATCH | `/members/me` | member | `{ bio?, job?, area_id?, work_status?, avatar_file_id?, cover_file_id? }` | hồ sơ | `member.updated` |
| GET | `/members/:id/contacts/:field` | member | — | `{ value }` hoặc `403` | `contact.read` / `contact.denied` |
| POST | `/members/:id/contact-requests` | member | `{ field_key, message?: max(300) }` | `{ id, status }` | `contact_request.created` |
| GET | `/members/me/contact-requests` | member | `?direction=in\|out` | danh sách | — |
| POST | `/contact-requests/:id/decide` | chủ hồ sơ | `{ decision: 'approved'\|'denied' }` | `{ status }` | `contact_request.decided` |
| GET | `/members/me/privacy` | member | — | 8 `field_key` + mức | — |
| PUT | `/members/me/privacy/:field` | member | `{ level: 'public'\|'on_consent'\|'closed' }` | `{ field, level }` | `privacy.changed` |
| GET | `/members/me/profile-views` | member | `?page&limit` | ai xem gì, khi nào | — |
| POST | `/members/me/export` | member | — | `202` + file khi xong | `subject.export` |
| GET | `/members/me/relations` | member | — | sợi bảo lãnh + việc chung | — |

Mặc định khi tạo member: `phone`/`zalo` = `on_consent`; `address`/`family` = `closed`; còn lại `public`.

`GET /members` ghi **một** dòng log cho cả trang, không phải 20 dòng — xem danh bạ là hành vi bình thường, chỉ cần đếm được ai duyệt danh bạ bao nhiêu lần.

> **Hình dạng `detail` phải PHẲNG, không phải `{"count":20,"filters":{…}}` như bản nháp đầu viết.** `assertSafeDetail` (`core/audit.js`, luật mục 10) là `z.record(scalar | scalar[])` — một object lồng bên trong `detail` bị từ chối thẳng, nên hình dạng có khoá `filters` **không chạy được**. Phát hiện ở Task 10.
>
> Và **`q`/`job` không bao giờ được ghi nguyên văn**: cả hai là văn bản tự do người dùng gõ, mà người ta tìm danh bạ bằng số điện thoại là chuyện thường — đúng thứ luật mục 10 cấm. Chỉ ghi `has_q`/`has_job` dạng boolean. Các bộ lọc còn lại (`status`, `work_status`, `area_id`) là enum/uuid nên ghi thẳng được.

#### Gia nhập

| Method | Đường dẫn | Vai | Vào | Ra | Log |
|---|---|---|---|---|---|
| GET | `/join-requests` | approver, content_ops | `?status&page&limit` | danh sách | `join_request.list` |
| GET | `/join-requests/:id` | approver, người bảo lãnh | — | chi tiết | `join_request.view` |
| POST | `/join-requests/:id/confirm-met` | **chỉ người bảo lãnh** | `{ met_on, note: min(20) }` | `{ status }` | `join_request.met_confirmed` |
| POST | `/join-requests/:id/approve` | approver | `{ note? }` | `{ member_id }` | `join_request.approved` |
| POST | `/join-requests/:id/reject` | approver | `{ reason_code, note: min(20) }` | `{ status }` | `join_request.rejected` |

`reason_code ∈ { not_ready, no_meeting, referrer_misrepresented, other }`. Chỉ `referrer_misrepresented` mới đốt suất bảo lãnh vĩnh viễn, và `reason_code` được ghi vào `detail` của dòng nhật ký.

`approve` chạy trong **một giao dịch**, và service chỉ làm đúng năm việc:

1. `SELECT join_secret_consume(<request_id>)` — lấy số điện thoại và băm mật khẩu, **và đốt hàng đó luôn**
2. `INSERT INTO members (…, referrer_id, password_hash, status='member')`
3. `SELECT contact_upsert(<member_id>, 'phone', <số vừa lấy ở bước 1>)`
4. `UPDATE join_requests SET member_id = …, status='approved'`
5. `audit.log(trx, { action: 'join_request.approved' })`

> **Số điện thoại và băm mật khẩu KHÔNG nằm trong `applicant_data`.** Bản nháp đầu để chúng ở đó, và `applicant_data` là cột `jsonb` mà `app_role` có `SELECT` — nghĩa là cả công sức tách `member_contacts` rồi `REVOKE ALL` bị vô hiệu bằng một route mới trả thẳng cột đơn. Chúng nằm ở bảng riêng `join_request_secrets` bị `REVOKE ALL` (mục 4.2), lối vào duy nhất là `join_secret_consume()` — hàm này **đốt hàng sau khi đọc**, nên bí mật của người nộp đơn không nằm lại trong CSDL sau khi đơn được duyệt.
>
> Vì cả năm việc nằm trong **cùng một giao dịch**, `approve()` hỏng ở bước sau bước 1 sẽ rollback và **bí mật được phục hồi nguyên vẹn** — đơn duyệt lại được, không mất gì. Đã kiểm chứng bằng thực nghiệm.
>
> Việc dọn `join_request_secrets` của đơn bị **từ chối** thì chưa có ai làm: nó cần khung tác vụ định kỳ. Đây là nợ đã ghi, không phải chỗ bỏ sót.

**Service không chạm `member_contacts` và không chạm `member_relations`** — hai bảng đó nằm ngoài quyền của `app_role`. Hàng liên hệ rỗng, 8 mức riêng tư mặc định, và cạnh `guarantee` do `trg_member_bootstrap` (mục 4.7) sinh ra ngay sau bước 1.

Trigger `MEMBER_NEEDS_MET_CONFIRMATION` chặn nếu thiếu `met_confirmed_at`, nên thứ tự sai trong service sẽ hỏng ngay lúc chạy, không lọt.

#### Tệp

| Method | Đường dẫn | Vai | Vào | Ra | Log |
|---|---|---|---|---|---|
| POST | `/files` | member | multipart, ≤ 10 MB, `image/jpeg\|png\|webp` | `{ id }` | `file.uploaded` |
| GET | `/files/:id` | theo quyền của đối tượng gắn kèm | — | **stream byte** | `file.read` / `file.denied` |

`sharp`: xoay theo EXIF, **xóa toàn bộ metadata EXIF** (ảnh điện thoại chứa tọa độ GPS — chỗ rò rỉ vị trí nhà mà không ai để ý), cạnh dài nhất 1600px, JPEG chất lượng 80.

#### Vận hành

| Method | Đường dẫn | Vai | Vào | Ra | Log |
|---|---|---|---|---|---|
| GET | `/ops/audit-log` | approver, tech | `?actor_id&action&from&to&page&limit` | dòng nhật ký | `audit.read` |
| GET | `/ops/audit-log/verify` | approver, tech | `?from&to` | `{ ok, checked, broken_at? }` | `audit.verified` |
| GET | `/ops/pending-actions` | approver, tech | `?status` | danh sách | — |
| POST | `/ops/pending-actions` | theo `action_key` | `{ action_key, target_type, target_id, payload }` | `{ id, expires_at, signatures: 1 }` | `pending_action.created` |
| POST | `/ops/pending-actions/:id/sign` | theo `action_key` | `{ password }` (xác thực lại) | `{ status, result? }` | `pending_action.signed` / `.executed` |
| DELETE | `/ops/pending-actions/:id` | người tạo | — | `204` | `pending_action.cancelled` |
| GET | `/ops/permissions` | mọi vai | — | ma trận quyền của chính mình | — |
| GET | `/health` | công khai | — | `{ ok, db, storage, migration }` | — |

---

## 6. `core/privacy.js`

**Nói thẳng: sau khi `member_contacts` bị `REVOKE ALL`, file này là một vỏ mỏng — và nó nên mỏng.** Không dựng thêm tầng cho có. Nó còn đúng hai việc:

```js
// 1. Đọc một trường liên hệ. Chỉ là chuyển tiếp — kiểm quyền và ghi log nằm trong CSDL.
export async function readContact(trx, targetId, field) {
  const { rows: [r] } = await trx.raw('SELECT * FROM contact_read(?, ?)', [targetId, field]);
  return r;   // { allowed, value, reason }
}

// 2. Dựng bao bì trạng thái cho một danh sách người — MỘT truy vấn cho cả trang.
//    communityId là tham số BẮT BUỘC, xem ghi chú bên dưới.
export async function contactStates(trx, viewerId, targetIds, communityId) { … }
```

> **`communityId` được thêm vào chữ ký ở Task 10 và nó bắt buộc, không tuỳ chọn.** Bản đầu chỉ lọc theo `targetIds` rồi dựa vào lời hứa "người gọi đã lọc cộng đồng rồi" — đúng hình dạng lỗi đã lặp năm lần trong dự án (Ruling T7-a, T8-d, hai chỗ ở Task 9, mã mẫu `contact_upsert` mục 4.7). Tham số bắt buộc biến chỗ quên thành lỗi thấy được ngay thay vì một đường rò im lặng. Cùng lỗ hổng ở phía CSDL được bịt bằng migration `012a`.

### Bài toán N+1: không tồn tại, và đó là do thiết kế chứ không do may

Hiện 20 người trong danh bạ **không** thành 60 lời gọi hàm, vì danh sách không bao giờ gọi `contact_read`. Danh sách chỉ cần **mức và trạng thái**, mà hai thứ đó nằm trong `privacy_settings` và `contact_requests` — hai bảng bình thường, `app_role` đọc trực tiếp được. Một truy vấn duy nhất cho cả trang:

```sql
SELECT ps.member_id, ps.field_key, ps.level,
       cr.id AS request_id, cr.status AS request_status
  FROM privacy_settings ps
  LEFT JOIN contact_requests cr
    ON cr.target_id = ps.member_id AND cr.field_key = ps.field_key
   AND cr.requester_id = :viewer
 WHERE ps.member_id = ANY(:target_ids);
```

`contact_read` chỉ được gọi ở đúng **một** endpoint: `GET /members/:id/contacts/:field` — mỗi lần một trường, một người, một dòng nhật ký. Đó chính là hành vi ta muốn đếm.

Có một chỗ **thật sự** cần đọc hàng loạt: xuất toàn bộ danh bạ (mục 6 bản gốc, hai người ký). Chỗ đó dùng `contact_read_many(uuid[], text[])` — cùng luật kiểm quyền, ghi **một** dòng tổng `contact.bulk_read` kèm số lượng, cộng với dòng `pending_action.executed`. Không có đường nào khác vào hàm đó.

---

## 7. Khung hai người ký

### 7.1 Bảng

```sql
CREATE TABLE pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id),
  action_key text NOT NULL CHECK (action_key IN (
    'data.delete', 'contacts.export', 'backup.restore',
    'member.terminate', 'guarantee.quota_override')),
  target_type text, target_id uuid,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,          -- sha256(payload + ảnh chụp updated_at của các hàng liên quan)
  created_by uuid NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','executed','expired','cancelled','stale')),
  executed_at timestamptz, result jsonb
);

CREATE TABLE pending_action_signatures (
  pending_action_id uuid NOT NULL REFERENCES pending_actions(id) ON DELETE CASCADE,
  signer_id uuid NOT NULL REFERENCES members(id),
  signed_at timestamptz NOT NULL DEFAULT now(),
  payload_hash_at_sign text NOT NULL,
  ip inet,
  PRIMARY KEY (pending_action_id, signer_id)     -- một người không ký được hai lần
);
```

### 7.2 Vòng đời

1. **Tạo.** Người thứ nhất gọi `POST /ops/pending-actions`. Chữ ký của họ được ghi ngay thành hàng đầu tiên — người tạo *là* người ký thứ nhất, không phải một bước riêng. `expires_at = now() + 24h`.
2. **Ký.** Người thứ hai gọi `POST /ops/pending-actions/:id/sign`. Kiểm tra, theo thứ tự:
   - `status = 'pending'` **và** `expires_at > now()` — kiểm ngay lúc ký, không trông vào tác vụ dọn dẹp chạy đúng giờ.
   - `signer_id <> created_by` — thật ra `PRIMARY KEY` đã chặn, nhưng kiểm sớm để có câu lỗi tử tế.
   - Người ký có vai mà `action_key` đòi hỏi.
   - Người ký **không phải đối tượng** của hành động (không ai đồng ý chấm dứt tư cách của chính mình, cũng không ai tự ký nới hạn mức cho mình).
   - `payload_hash` tính lại **bằng** `payload_hash_at_sign` của chữ ký đầu.
3. **Thi hành.** Đủ hai chữ ký thì hành động chạy **trong cùng giao dịch với chữ ký thứ hai**. Thành công thì `status='executed'`, ghi `result`, ghi `audit_log`. Thất bại thì rollback cả hai — không có trạng thái "đã ký nhưng chưa chạy".
4. **Hết hạn.** Tác vụ hằng giờ đặt `status='expired'` cho các hàng quá `expires_at`. Chỉ để dọn dẹp và hiển thị; việc chặn đã làm ở bước 2.

### 7.3 Dữ liệu đổi giữa hai chữ ký

`payload_hash` không chỉ băm `payload` — nó băm thêm **ảnh chụp `updated_at` của mọi hàng mà hành động sẽ đụng tới**. Ví dụ với `member.terminate`, nó gồm `members.updated_at` của người bị chấm dứt.

Người thứ hai ký, hệ thống tính lại. Khác nhau nghĩa là có gì đó đã đổi kể từ chữ ký đầu — người thứ nhất có thể đang đồng ý với một sự việc không còn tồn tại. Hành động chuyển `status='stale'`, **không thi hành**, và phải tạo lại từ đầu. Ghi `audit_log` với `action='pending_action.stale'` kèm danh sách thứ đã đổi.

### 7.4 Người thứ nhất tự ký lần hai bằng tài khoản khác — nói thật về giới hạn

`PRIMARY KEY (pending_action_id, signer_id)` chặn cùng một `member_id` ký hai lần. Nhưng **cùng một con người dùng hai tài khoản thì CSDL không thể biết**, và tôi không muốn giả vờ là có thể. Bốn lớp giảm thiểu, xếp theo hiệu quả thật:

1. **Ký phải nhập lại mật khẩu** (trường `password` trong thân request). Một phiên bị bỏ quên trên máy chung không ký được. Đây là lớp hiệu quả nhất và là lý do nó nằm trong schema.
2. **Cả hai người ký phải có vai được cấp riêng**, và cấp vai lại là việc của `tech` — có ghi log.
3. `ip` lưu theo từng chữ ký; bảng điều khiển vận hành nêu cờ khi hai chữ ký đến từ cùng IP trong vòng vài phút. Đây là **tín hiệu để người xem xét**, không phải rào chặn tự động — một cặp vợ chồng cùng nhà cũng chung IP.
4. Báo cáo hằng tháng liệt kê những cặp luôn cùng ký với nhau. Nếu hai chữ ký lúc nào cũng là một cặp thì "hai người" đang là một người về mặt thực chất, dù là hai tài khoản thật.

Cách chặn thật sự là quy trình ngoài phần mềm: hai người ký phải là hai người mà cộng đồng biết mặt. Ghi rõ điều này trong README để người sau không tưởng phần mềm đã lo xong.

### 7.5 Năm hành động

| `action_key` | Vai được ký | Ghi chú |
|---|---|---|
| `data.delete` | approver | Xóa hồ sơ/dữ liệu — thực chất là bia mộ hóa, xem mục 10 |
| `contacts.export` | tech | Lối vào duy nhất của `contact_read_many` |
| `backup.restore` | tech | Chỉ chạy được trên `docker-compose.test.yml` |
| `member.terminate` | approver | Người ký không được là đối tượng |
| `guarantee.quota_override` | approver | Bổ sung so với mục 6 bản gốc — nới hạn mức là quyết định về thành phần cộng đồng, cùng loại với chấm dứt tư cách |

---

## 8. Chỉ mục, tìm kiếm, bậc uy tín

### 8.1 Tìm kiếm tiếng Việt

`unaccent()` mặc định **không** `IMMUTABLE` nên không đánh chỉ mục trực tiếp được — chỗ ai cũng vấp:

```sql
CREATE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

ALTER TABLE capabilities ADD COLUMN search_vec tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', f_unaccent(coalesce(title,''))),       'A') ||
    setweight(to_tsvector('simple', f_unaccent(coalesce(description,''))), 'B')
  ) STORED;
CREATE INDEX idx_cap_search ON capabilities USING GIN (search_vec);
```

> Nhãn `IMMUTABLE` ở đây là **lời hứa của ta, không phải sự thật tuyệt đối**. Nếu từ điển `unaccent` đổi thì phải `REINDEX`. Đây là cách chuẩn mà mọi người dùng, nhưng README phải ghi để người sau biết.

### 8.2 Bảng chỉ mục

| Truy vấn | Chỉ mục |
|---|---|
| Tìm kiếm năng lực / người / việc / hoạt động | GIN trên `search_vec` |
| Gõ sai chính tả, gõ tắt | `GIN (f_unaccent(full_name) gin_trgm_ops)` |
| Khoảng cách địa lý | `GiST (ll_to_earth(lat, lng))` |
| Danh bạ lọc nghề/khu vực | `btree (community_id, status, area_id, job)` |
| Hàng chờ giúp nhau | `(community_id, urgency, created_at) WHERE status='queued'` |
| Hộp tín hiệu chưa đọc | `(member_id) WHERE read_at IS NULL` |
| Hạn mức bảo lãnh | `(referrer_id, created_at) WHERE status IN ('pending','met_confirmed','approved')` |
| Trạng thái liên hệ cho cả trang danh bạ | `(member_id, field_key)` trên `privacy_settings`; `(requester_id, target_id, field_key)` trên `contact_requests` |

### 8.3 `core/trust.js`

**Một nguồn sự thật, chia hai tầng.** CSDL giữ **con số thô**, JavaScript giữ **ngưỡng bậc**. Không nơi nào lặp lại logic của nơi kia.

```js
const TIERS = [
  { key: 'mam',       label: 'Mầm',       min: 0   },
  { key: 'dong',      label: 'Đồng',      min: 5   },
  { key: 'bac',       label: 'Bạc',       min: 20  },
  { key: 'vang',      label: 'Vàng',      min: 50  },
  { key: 'kim_cuong', label: 'Kim Cương', min: 100 },
];
export function tierOf(confirmedWorks) { … }   // không có đường vào nào khác
```

`member_trust_stats (member_id, confirmed_works, manual_works, distinct_requesters, repeat_requesters, computed_at)` cập nhật **tăng dần bằng trigger** ngay khi `fn_work_edge` xác định việc đã đủ xác nhận. Không dùng materialized view — view phải làm mới toàn bộ, còn đây chỉ đổi vài dòng.

- **Có cache không:** có, chính bảng đó là cache.
- **Làm mới khi nào:** (a) tức thì theo trigger; (b) tác vụ 03:15 hằng đêm tính lại toàn bộ, so với giá trị đang lưu, lệch thì ghi `audit_log` và sửa. Ở 52 người phép tính lại mất dưới một giây — rẻ hơn nhiều so với rủi ro trigger trôi số.
- `distinct_requesters` đếm số người khác nhau đã nhờ; `repeat_requesters` đếm người xuất hiện từ hai việc trở lên.
- `manual_works` đếm riêng và **hiện tách bạch** trên hồ sơ.

**Bậc uy tín không được dùng để xếp thứ tự.** Bài kiểm thử T9 quét mã nguồn tầng tìm kiếm; ai lỡ thêm `ORDER BY confirmed_works` hay `ORDER BY tier`, CI đỏ.

---

## 9. Ràng buộc đánh đổi tốc độ — nêu ra để bàn, không tự bỏ

1. **Chuỗi băm nối tiếp hóa mọi lượt ghi nhật ký.** `pg_advisory_xact_lock` theo cộng đồng nghĩa là hai hành động đồng thời phải xếp hàng ở bước ghi log. Ở 52 người, dưới một lượt ghi mỗi giây — không thành vấn đề. Nhưng đây **là** nút cổ chai toàn cục, và nói ra bây giờ tốt hơn để ai đó phát hiện lúc mở cộng đồng thứ hai mươi. Khóa tách theo `community_id` nên nhiều cộng đồng không chặn nhau.
2. **`contact_read` là một lời gọi cho mỗi trường, mỗi lời gọi một dòng nhật ký.** Cố ý. Hệ quả: `audit_log` là bảng lớn nhất hệ thống, và danh bạ **không** hiện sẵn số điện thoại — phải bấm để mở. Frontend đã thiết kế đúng như vậy sẵn, nên không phải sửa.
3. **Ghi nhật ký cho lượt bị từ chối cho phép người dò tạo ra vô số dòng log.** Đây là cái giá của A2. Giảm thiểu: rate limit 10 lần/phút cho endpoint đọc liên hệ, và chính đống log đó là tín hiệu phát hiện — bảng điều khiển nêu cờ khi `contact.denied` của một người vượt ngưỡng.
4. **Trigger ràng buộc hoãn báo lỗi lúc `COMMIT`**, nên thông báo khó gắn vào một trường cụ thể. Tầng service vẫn kiểm trước để có câu tiếng Việt tử tế, nhưng **CSDL mới là chỗ bảo đảm** — kiểm ở service chỉ để nói cho hay.
5. **Trigger `SUMMARY_REQUIRED` quét mỗi lần tạo hoạt động dùng quỹ.** Không đáng kể, có chỉ mục riêng phần đỡ.

---

## 10. Xóa theo yêu cầu chủ thể (Nghị định 13/2023/NĐ-CP)

Không thể xóa cứng: `audit_log` không xóa được, và xóa cứng `members` sẽ gãy khóa ngoại của mọi việc đã xác nhận — tức xóa luôn bằng chứng của người khác. Ba tầng:

**Tầng 1 — dữ liệu cá nhân thường: bia mộ.** `member_contacts` xóa hàng thật; `members` giữ `id`, `community_id`, `status='left'`, `erased_at`, `full_name` thay bằng `'Thành viên đã rời'`. Quan hệ và số việc của người khác vẫn nguyên vẹn.

**Tầng 2 — dữ liệu nhạy cảm (CCCD, tài khoản ngân hàng): hủy khóa, không hủy dữ liệu.** Mỗi chủ thể có một khóa dữ liệu riêng, khóa đó lại được bọc bằng khóa gốc trong biến môi trường. Xóa = hủy khóa riêng. Bản mã còn nằm trong các bản sao lưu cũ nhưng vĩnh viễn không ai đọc được — kể cả khi khôi phục từ bản sao lưu ba tháng trước. Xóa cứng không làm được điều này.

Ba điều bắt buộc kèm theo:
- Kho khóa sao lưu **đường riêng, đích riêng, khóa riêng** — không bao giờ nằm cùng bản sao dữ liệu. **Mất khóa gốc là mất toàn bộ, không phải mất một người.** README phải nói to điều này.
- Hủy khóa ghi `audit_log` (`action='key.destroyed'`, chỉ ghi định danh chủ thể).
- Tác vụ hằng quý lấy ngẫu nhiên vài bản mã của chủ thể đã yêu cầu xóa, thử giải mã, **khẳng định thất bại**, ghi kết quả.

**Tầng 3 — `audit_log`: không đụng tới, và không cần đụng tới.** Có một luật thiết kế: `detail jsonb` **chỉ chứa mã định danh và tên trường, không bao giờ chứa giá trị cá nhân**. Xem `contact_read` — nó ghi `{"field":"phone"}`, không ghi số. Sau khi bia mộ hóa, `actor_id` trong nhật ký chỉ còn trỏ tới một bản ghi rỗng.

Luật này được cưỡng chế lúc chạy: `audit.log()` kiểm `detail` bằng một schema zod chỉ cho phép uuid, enum, `field_key`, số đếm — gặp chuỗi tự do thì ném lỗi. Có kiểm thử T11 đi kèm.

> Tôi không phải luật sư. Trước khi vận hành thật, phần này nên có người am hiểu Nghị định 13 đọc lại.

---

## 11. Thứ tự migration

| File | Nội dung |
|---|---|
| `001_extensions` | `pgcrypto`, `unaccent`, `pg_trgm`, `cube`, `earthdistance`, `f_unaccent` |
| `002_roles_grants` | `app_role`, `ALTER DEFAULT PRIVILEGES` |
| `003_communities_areas` | Gốc của `community_id` |
| `004_members` | `members` (không có cột liên hệ) + `members_id_cid` |
| `005_member_contacts` | Bảng riêng + `REVOKE ALL` |
| `006_privacy` | `privacy_settings`, `contact_requests`, `profile_views`, `contact_result`, `contact_read`, `contact_read_many` |
| `007_audit_log` | Bảng phân mảnh + `audit_chain_head` + `fn_audit_chain` + `fn_audit_new_partition` + `REVOKE` |
| `008_auth` | `refresh_tokens`, `otp_challenges` (có `attempts`, `phone_hash`, `code_hash`) |
| `009_join_requests` | + `guarantee_quota_overrides` + `fn_guarantee_quota` + trigger chống chu trình |
| `009a_join_request_secrets` | **Thêm ở Task 9** — `join_request_secrets` (số điện thoại thô + băm mật khẩu của người nộp đơn, `REVOKE ALL` rồi `GRANT INSERT`) + `join_secret_consume()`. Đánh số `009a` vì nó bổ sung cho chính `009` và không phụ thuộc gì ở `010`–`012`; nhờ vậy mọi số đã hẹn bên dưới giữ nguyên. Xem mục 4.2 và Ruling T8-f. |
| `010_member_status_gate` | Trigger `MEMBER_NEEDS_MET_CONFIRMATION` + `fn_referrer_frozen` |
| `011_work_records` | 3 bảng việc **và chỉ 3 bảng** — ba hàm `fn_self_only`, `fn_work_record_frozen`, `fn_manual_pair_quota` đã dời sang `025_work_triggers` (Task 12), vì gắn trigger uy tín trước khi có bảng đếm uy tín là dựng một cửa không ai canh |
| `012_member_relations` | Bảng + `fn_work_edge` + `fn_member_bootstrap` + `contact_upsert` + thu quyền ghi + chỉ mục một chiều |
| `012a_contact_read_community` | **Thêm ở Task 10** — `CREATE OR REPLACE contact_read` để nó tự kiểm **người xem và người bị xem cùng một cộng đồng**. Bản ở `006` chỉ đọc `community_id` của người bị xem mà không bao giờ so với người xem, nên một người ở cộng đồng A đọc được số điện thoại thật của người ở cộng đồng B (đã tái hiện: `{allowed: true, value: '09…'}`). Trước Task 10 lỗ này không có đường vào vì chưa route nào gọi `contact_read`. Đánh số `012a` vì `013` đã hẹn cho `013_capabilities`; điều kiện an toàn của Ruling T9-d thỏa hiển nhiên (nó được **nối vào đuôi**, không chèn giữa). **Migration `015` khi `CREATE OR REPLACE` hàm này lần nữa phải giữ nguyên hai câu kiểm cộng đồng đó.** |
| `013_capabilities` | + ảnh + chứng cứ |
| `014_signals` | 5 bảng + `v_signal_recipients` |
| `015_jobs` | + `intro_three_consents` |
| `016_aid` | + `trg_slot_self_only` |
| `017_activities` | + trigger `SUMMARY_REQUIRED` |
| `018_verify_endorse_complaints` | + `endorsement_signatures` + trigger hoãn |
| `019_memories` | + `memory_photo_people` + trigger đồng ý |
| `020_fund` | + `fund_entry_approvals` + trigger hoãn + khóa bút toán |
| `021_loans` | Cột `_enc`, bảng khóa theo chủ thể |
| `022_ops` | `roles`, `permissions`, `pending_actions`, `backups`, `restore_tests`, `moderation_queue` |
| `023_trust_stats` | `member_trust_stats` + trigger |
| `024_indexes_and_revokes` | `search_vec`, GIN, GiST, và **chốt lại toàn bộ ma trận quyền theo bảng ở mục 4.8** — nơi duy nhất `REVOKE` được tập trung, để đọc một file là thấy hết |

---

## 12. Dữ liệu mẫu

### 12.1 Chạy lại được nhiều lần

**Không dùng id ngẫu nhiên.** Mọi id sinh bằng UUIDv5 tất định từ một namespace cố định và một khóa ổn định:

```js
const NS = '6f2a...';                       // hằng số trong seeds/ids.js
const id = uuidv5(`member:hung-nguyen`, NS);
```

Nhờ vậy mỗi lệnh ghi là `INSERT … ON CONFLICT (id) DO UPDATE` — chạy `npm run seed` mười lần vẫn ra đúng một bộ dữ liệu. Seed chạy trong `withActor()` vì các trigger `fn_self_only` đòi dấu người thực hiện.

### 12.2 Cây bảo lãnh 52 người

Một gốc, bốn tầng, không ai vượt 3 lượt trong bất kỳ cửa sổ 12 tháng nào — `created_at` lùi ngày trải từ 2019 tới 2026 để lịch sử tự nó hợp lệ:

```
M01 (gốc, referrer_id NULL, gia nhập 2019-03)
├── M02 (2019-06) ├── M05 M06 M07        (2020-2021)
├── M03 (2019-09) ├── M08 M09 M10        (2020-2021)
└── M04 (2020-01) └── M11 M12 M13        (2021)
    tầng 3: M14…M40  (mỗi người tầng 2 bảo lãnh ≤3, rải 2022-2025)
    tầng 4: M41…M52  (rải 2025-2026)
```

**Một trường hợp chạm hạn mức cố ý:** `M07` có đúng 3 `join_requests` với `created_at` trong 12 tháng gần nhất (`pending`, `met_confirmed`, `approved`). Đơn thứ tư phải ném `GUARANTEE_QUOTA_EXCEEDED` — đây là dữ liệu cho T6.

Thêm `M09` có một đơn `rejected` với `reason_code='referrer_misrepresented'` để kiểm tra nhánh không trả lại suất, và `M10` có một đơn `rejected` với `reason_code='not_ready'` để kiểm tra nhánh trả lại suất.

### 12.3 Còn lại

- **12 khu vực Hưng Yên** đúng danh sách `AREAS` trong frontend (`index_2.html:965`), có `lat`/`lng` để thử `earthdistance`.
- **148 năng lực** rải theo 7 nhóm ngành của frontend, phần lớn `published`, vài cái `pending_review`.
- **`work_records`:** ~60 bản ghi đủ xác nhận (đủ để có người ở bậc Mầm, Đồng, Bạc); **3 bản ghi mới một bên xác nhận** — cạnh chưa được hình thành, dữ liệu cho T1; **1 bản ghi `manual` chưa duyệt** — không được cộng vào bậc, dữ liệu cho T12.
- **7 tín hiệu, mỗi chặng một cái** (`created` → `archived`).
- 5 nhu cầu việc làm, 5 yêu cầu giúp nhau, 4 hoạt động (2 đã có tổng kết), 12 bút toán quỹ (2 cái ≥ 1 triệu, có đủ chữ ký), 2 khoản vay TingTingVác.
- **`audit_log`:** sinh bằng `INSERT` bình thường để `fn_audit_chain` tự dựng chuỗi. **Tuyệt đối không seed hash cứng** — một chuỗi băm chép tay là chuỗi băm không kiểm được gì.

---

## 13. Bộ kiểm thử

Chạy trên `docker-compose.test.yml` — CSDL dùng một lần, chạy migration rồi khẳng định. Không đụng dữ liệu thật.

| # | Kiểm thử | Cách làm |
|---|---|---|
| T1 | Cạnh `worked_together` **không** xuất hiện khi mới một bên xác nhận | Tạo việc 2 người, ghi 1 xác nhận, khẳng định `member_relations` rỗng; ghi nốt cái thứ 2, khẳng định cạnh xuất hiện |
| T2 | Xác nhận hộ người khác bị từ chối | `withActor(A)` rồi ghi `work_confirmations.member_id = B` → `SELF_ONLY` |
| T3 | `SELECT * FROM members` không chứa số điện thoại ở bất kỳ vai nào | Duyệt cả 5 vai, khẳng định không cột nào tên `phone/zalo/messenger/address`; và `app_role` `SELECT` `member_contacts` → `permission denied` |
| T4 | Lượt đọc **bị từ chối** vẫn để lại dòng nhật ký | Đọc trường mức `closed`, khẳng định `allowed=false` **và** có dòng `contact.denied` sau khi commit |
| T5 | Số điện thoại không lộ khi 2/3 chữ ký, lộ đúng khi đủ 3 | Bật lần lượt từng cột consent, khẳng định `allowed=false, false, true` |
| T6 | Yêu cầu bảo lãnh thứ tư bị chặn; hai yêu cầu **đồng thời** cũng chỉ một cái qua | (a) đơn thứ 4 của M07 → lỗi. (b) hai kết nối, cả hai `BEGIN`, cùng ghi, khẳng định đúng một cái commit được |
| T7 | Sửa một dòng `audit_log` giữa chuỗi bị phát hiện | Dùng vai **owner** sửa một dòng (app_role không sửa nổi), chạy `/ops/audit-log/verify`, khẳng định `ok=false` và `broken_at` đúng dòng đó |
| T8 | `fund_entries.locked` không sửa được bằng bất kỳ đường nào | Thử `UPDATE`, thử `DELETE`, thử qua service → cả ba đều lỗi |
| T9 | Không truy vấn xếp hạng nào `ORDER BY` theo `confirmed_works` hoặc bậc | Quét mã nguồn `modules/**/service.js` tìm mẫu cấm |
| T10 | Ma trận quyền khớp mong đợi | Duyệt `information_schema.table_privileges` **kể cả phân mảnh `audit_log`**, so với bảng khai báo trong `tests/expected-grants.json` |
| T11 | `audit.log()` không có giá trị cá nhân trong `detail` | Schema zod lúc chạy chỉ cho uuid/enum/field_key/số; test đưa chuỗi tự do vào → phải ném lỗi |
| T12 | Bản ghi `manual` không tự đẩy được bậc uy tín | Tạo `manual` đủ 2 xác nhận, khẳng định `confirmed_works` không đổi và `manual_works` tăng; approver duyệt xong mới đổi. Thêm: bản ghi thứ 7 cùng cặp → `MANUAL_PAIR_QUOTA_EXCEEDED` |
| T13 | `core/` không import ngược `modules/` | Quét import |
| T14 | `api` không mở cổng khi migration lỗi | Chạy container với migration hỏng, khẳng định `/health` không trả lời |
| T15 | **Gỡ chữ ký không làm bút toán lớn thành một chữ ký** | Ghi bút toán 2 triệu + 2 chữ ký; rồi `DELETE` một chữ ký bằng cả `app_role` (→ `permission denied`) **và** bằng owner (→ `FUND_TWO_APPROVERS_REQUIRED` lúc commit) |
| T16 | **Luồng duyệt gia nhập chạy được** | Gọi `approve` thật, khẳng định: có hàng `member_contacts`, có 8 hàng `privacy_settings`, có cạnh `guarantee` — và service **không** hề `INSERT` vào hai bảng đó (chặn `app_role`, nếu service lỡ chạm sẽ `permission denied`) |
| T17 | **OTP hết đường dò** | Sai 5 lần → `burned`; 3 challenge hỏng → khóa 15 phút; khẳng định `audit_log` có `otp.failed` mà `detail` **không** chứa số điện thoại hay mã |

T16 là bài quan trọng nhất trong nhóm mới: nó là bài test đã bắt ra lỗi A — spec nói service ghi vào bảng mà `app_role` không có quyền. Nếu nó có từ đầu, mâu thuẫn đó không sống được tới bước duyệt spec.

---

## 14. Bàn giao giai đoạn 1

1. `cp .env.example .env && docker compose up -d` — toàn bộ hệ thống lên, migration tự chạy.
2. `docker compose exec api npm run seed` — nạp dữ liệu mẫu, chạy lại nhiều lần không nhân đôi.
3. `docker compose exec api npm test` — 17 bài kiểm thử xanh.
4. Tài liệu OpenAPI sinh từ schema zod, phục vụ ở `/api/v1/docs`.
5. `web/js/api.js` với `api.get/post/put/del`, xử lý token và lỗi tập trung; ba màn đăng ký / đăng nhập / danh bạ nối dữ liệu thật.
6. README nêu: cách chạy, biến môi trường, migration, seed, sao lưu, khôi phục, lên phiên bản mới không mất dữ liệu.
7. `docs/RANG-BUOC.md` — danh sách mọi chỗ đã cưỡng chế năm nguyên tắc ở tầng dữ liệu, **kèm lý do**, để người sau không vô tình gỡ bỏ khi thấy một ràng buộc "làm phiền".

---

## 15. Những chỗ chờ bên ngoài — đã có trả lời

| Vấn đề | Trạng thái |
|---|---|
| Nhà cung cấp OTP (Zalo ZNS / SMS) | Chưa có tài khoản. Giai đoạn 1 dùng adapter `console`, cổng cắm sẵn để đổi sau. **Không chặn tiến độ.** |
| Tên miền `binhdan1986.com` | Đã sở hữu. Thông tin DNS cung cấp ở bước triển khai thật. |
| Google Drive cho bản sao lưu | Tài khoản dịch vụ riêng, quyền chỉ-thêm, không dùng chung tài khoản cá nhân. |
| Rà soát pháp lý Nghị định 13 | Chủ dự án lo. Trong lúc chờ, cứ theo mục 10, không đợi. |
| Số 6 trong hạn mức `manual` | Là con số phỏng đoán. **Chuyển vào `communities.config`, không hard-code.** Xem lại sau 6 tháng. |

### 15.1 Những gì nằm trong `communities.config`

Không có số nào ở đây được viết cứng trong mã nguồn — chúng là chính sách của **một** cộng đồng, và cộng đồng thứ hai có thể khác:

```json
{
  "birth_year": 1986,
  "guarantee_quota_per_year": 3,
  "guarantee_window_months": 12,
  "manual_pair_quota": 6,
  "manual_pair_window_months": 12,
  "two_person_expiry_hours": 24,
  "privacy_defaults": [
    { "field_key": "phone",     "level": "on_consent" },
    { "field_key": "zalo",      "level": "on_consent" },
    { "field_key": "messenger", "level": "public" },
    { "field_key": "address",   "level": "closed" },
    { "field_key": "family",    "level": "closed" },
    { "field_key": "job",       "level": "public" },
    { "field_key": "area",      "level": "public" },
    { "field_key": "price",     "level": "public" }
  ]
}
```

Các trigger `fn_guarantee_quota` và `fn_manual_pair_quota` đọc từ đây, có giá trị dự phòng nếu khóa vắng mặt. **Ngưỡng bậc uy tín thì không** nằm ở đây — chúng ở `core/trust.js`, vì mục 9 bản đặc tả gốc đặt chúng là luật chung của nền tảng, không phải chính sách riêng từng cộng đồng.

### 15.2 Số liệu minh họa trong seed

`148 năng lực` và `7 nhóm ngành` lấy từ giao diện demo, **không phải dữ liệu thật của Hội**. Seed giữ chúng để thử tải và thử tìm kiếm. README phải ghi rõ điều này, để sau này không ai trích dẫn chúng như số liệu thật.
