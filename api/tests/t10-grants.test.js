import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resetDb } from './helpers/db.js';

// ---------------------------------------------------------------------------
// T10 — MA TRẬN QUYỀN. Ba bài của tệp này là **cửa duy nhất** canh toàn bộ nền
// móng mà nguyên tắc 4 đứng lên, nên `docs/SOAT-KIEM-THU.md` xếp nó số 5 trong
// top 5 đáng sửa. Hai lỗ mù nó nêu, và cả hai đều được vá ở lượt Task 16:
//
//   (a) Cả ba bài lọc `grantee = 'app_role'`. `GRANT SELECT ON member_contacts
//       TO PUBLIC` ⇒ `app_role` đọc được (mọi vai đều hưởng quyền của PUBLIC),
//       mà `information_schema.table_privileges` với `grantee='app_role'`
//       KHÔNG THẤY GÌ ⇒ cả ba bài vẫn xanh trong khi số điện thoại đã ra ngoài.
//
//   (b) Quyền cấp theo CỘT (`GRANT SELECT (phone) ON member_contacts`) nằm ở
//       chỗ khác hẳn và cũng vô hình.
//
// VÀ MỘT ĐÍNH CHÍNH CHO BẢN SỬA MÀ TÀI LIỆU ĐỀ NGHỊ. Nguyên văn đề nghị:
// *"Thêm một bài duyệt `information_schema.column_privileges` khẳng định
// rỗng."* Đã đo thật trên chính CSDL này: `column_privileges` KHÔNG chỉ chứa
// quyền cấp theo cột — nó KHAI TRIỂN mọi quyền cấp ở mức BẢNG ra từng cột, và
// trả về **hơn 1.450 hàng** cho `app_role` khi chưa hề có một `GRANT (cột)`
// nào. Một bài `toEqual([])` trên đó đỏ ngay lập tức vì một lý do hoàn toàn
// không liên quan. Nguồn đúng là `pg_attribute.attacl IS NOT NULL` — chỗ
// PostgreSQL lưu ACL RIÊNG của một cột, và nó `NULL` khi cột chỉ thừa hưởng
// quyền của bảng. Bài dưới đây dùng nguồn đó.
//
// Cách vá lỗ (a): dùng `has_table_privilege('app_role', oid, priv)` thay cho
// một câu lọc theo `grantee`. Hàm này trả lời câu hỏi THẬT SỰ quan trọng —
// *"app_role có làm được việc này không"* — và nó tính cả quyền thừa hưởng qua
// PUBLIC và qua các vai được cấp. Bài "khai báo khớp thực tế" vì vậy đo QUYỀN
// HIỆU LỰC, không đo một hàng trong một bảng hệ thống. Cộng thêm một bài riêng
// khẳng định không grantee nào ngoài `app_role` và chủ sở hữu có mặt, để một
// `GRANT … TO PUBLIC` bị bắt ở cả hai đầu.
// ---------------------------------------------------------------------------

const expected = JSON.parse(readFileSync(new URL('./expected-grants.json', import.meta.url)));
const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
// Phân mảnh `audit_log` sinh theo tháng nên không khai báo tĩnh được. Bảng mục
// 4.1 của docs/RANG-BUOC.md: nhật ký chỉ-thêm, và mỗi phân mảnh phải đi qua
// `fn_audit_new_partition` (hàm tự REVOKE rồi GRANT lại đúng hai quyền).
const PARTITION_GRANTS = ['INSERT', 'SELECT'];

let db, owner;
beforeAll(async () => {
  db = await resetDb();
  // KHÔNG cứng tên chủ sở hữu: `t02` đã dạy rằng một hằng số cứng trong bài
  // test sẽ hỏng lặng lẽ khi cấu hình đổi.
  const { rows: [r] } = await db.raw(
    `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'members'::regclass`
  );
  owner = r.owner;
});
afterAll(async () => { await db.destroy(); });

// Mọi quan hệ có thể mang quyền trong schema `public`.
//
// `relkind` gồm cả `m` (materialized view) và `f` (foreign table) — hai loại
// mà bản trước bỏ sót. Một matview đọc `member_contacts` là một bản SAO của số
// điện thoại nằm trong một bảng mà `ALTER DEFAULT PRIVILEGES` (002) cấp đủ bốn
// quyền, và không bài nào từng đếm nó.
const RELKINDS = `'r','p','v','m','f'`;

describe('T10 ma trận quyền — mọi quan hệ, mọi grantee, mọi cột', () => {
  it('mọi bảng/view/matview public đều có mặt trong expected-grants.json', async () => {
    const { rows } = await db.raw(`
      SELECT c.relname AS table_name
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN (${RELKINDS}) AND NOT c.relispartition
         AND c.relname <> 'knex_migrations' AND c.relname <> 'knex_migrations_lock'
    `);
    expect(rows.length, 'không đọc được quan hệ nào — bài test hỏng chứ không phải mã hỏng')
      .toBeGreaterThan(60);
    const missing = rows.map((r) => r.table_name).filter((t) => !(t in expected));
    expect(missing, `bảng chưa khai báo quyền: ${missing.join(', ')}`).toEqual([]);

    // Chiều ngược lại: khai báo cho một bảng ĐÃ BỊ XOÁ là một dòng không ai
    // dám động vào, và nó làm bài "khớp thực tế" bên dưới lặng lẽ bỏ qua.
    const real = new Set(rows.map((r) => r.table_name));
    const thua = Object.keys(expected).filter((t) => !real.has(t));
    expect(thua, `expected-grants.json khai bảng không tồn tại: ${thua.join(', ')}`).toEqual([]);
  });

  it('QUYỀN HIỆU LỰC của app_role khớp khai báo — kể cả quyền thừa hưởng qua PUBLIC', async () => {
    // `has_table_privilege` trả lời "app_role LÀM ĐƯỢC việc này không", tính cả
    // đường vòng qua PUBLIC. Đây là chỗ `GRANT … TO PUBLIC` bị bắt.
    for (const [table, want] of Object.entries(expected)) {
      const { rows: [r] } = await db.raw(
        `SELECT ${PRIVS.map((p) => `has_table_privilege('app_role', ?::regclass, '${p}') AS "${p}"`).join(', ')}`,
        Array(PRIVS.length).fill(table)
      );
      const got = PRIVS.filter((p) => r[p]).sort();
      expect(got, `bảng ${table}: quyền HIỆU LỰC (gồm cả quyền qua PUBLIC)`).toEqual([...want].sort());
    }
  });

  it('không grantee nào ngoài app_role và chủ sở hữu — PUBLIC xuất hiện là ĐỎ', async () => {
    // Lưới thứ hai cho cùng một lỗ, ở đầu bên kia: bài trên hỏi "app_role làm
    // được gì", bài này hỏi "ai được cấp gì". Một `GRANT … TO PUBLIC` làm cả
    // hai đỏ; một vai CSDL thứ ba được cấp quyền chỉ làm bài này đỏ.
    //
    // `information_schema.table_privileges` ghi quyền cấp cho PUBLIC dưới tên
    // grantee `'PUBLIC'`.
    const { rows } = await db.raw(
      `SELECT DISTINCT table_name, grantee, privilege_type
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND grantee NOT IN ('app_role', ?)
        ORDER BY grantee, table_name`,
      [owner]
    );
    expect(
      rows.map((r) => `${r.grantee} → ${r.privilege_type} ON ${r.table_name}`),
      'quyền cấp cho một grantee ngoài app_role/chủ sở hữu. PUBLIC là nguy hiểm nhất: ' +
        'mọi vai CSDL đều hưởng, kể cả app_role, và bộ lọc grantee=app_role không thấy nó'
    ).toEqual([]);
  });

  it('không cột nào có ACL riêng — GRANT SELECT (phone) là ĐỎ', async () => {
    // NGUỒN ĐÚNG, xem đính chính ở đầu tệp: `pg_attribute.attacl` là NULL khi
    // cột chỉ thừa hưởng quyền của bảng, và chỉ khác NULL khi có ai đó cấp
    // quyền THEO CỘT. `information_schema.column_privileges` thì khai triển cả
    // quyền mức bảng nên không dùng được cho câu hỏi này.
    const { rows } = await db.raw(`
      SELECT c.relname AS table_name, a.attname AS column_name, a.attacl::text AS acl
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
         AND a.attacl IS NOT NULL
       ORDER BY c.relname, a.attname
    `);
    expect(
      rows.map((r) => `${r.table_name}.${r.column_name} = ${r.acl}`),
      'quyền cấp theo CỘT nằm ngoài expected-grants.json nên không ai đếm được nó'
    ).toEqual([]);
  });

  it('mọi phân mảnh audit_log: quyền hiệu lực đúng SELECT+INSERT, và không grantee lạ', async () => {
    const { rows } = await db.raw(`
      SELECT c.relname FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid
       WHERE i.inhparent = 'audit_log'::regclass
    `);
    expect(rows.length, 'không có phân mảnh nào — bài test hỏng chứ không phải mã hỏng')
      .toBeGreaterThan(0);

    for (const { relname } of rows) {
      const { rows: [p] } = await db.raw(
        `SELECT ${PRIVS.map((x) => `has_table_privilege('app_role', ?::regclass, '${x}') AS "${x}"`).join(', ')}`,
        Array(PRIVS.length).fill(relname)
      );
      expect(PRIVS.filter((x) => p[x]).sort(), `phân mảnh ${relname}`).toEqual(PARTITION_GRANTS);

      const { rows: others } = await db.raw(
        `SELECT DISTINCT grantee, privilege_type FROM information_schema.table_privileges
          WHERE table_schema = 'public' AND table_name = ? AND grantee NOT IN ('app_role', ?)`,
        [relname, owner]
      );
      expect(others.map((o) => `${o.grantee} → ${o.privilege_type}`), `phân mảnh ${relname}`).toEqual([]);
    }
  });

  it('không hàm SECURITY DEFINER nào còn EXECUTE cho PUBLIC', async () => {
    // Phát hiện của lượt Task 16, mục 3 danh sách tấn công. `REVOKE ALL` trên
    // BẢNG không đỡ được một hàm chạy bằng quyền chủ bảng (Ruling T10-a), nên
    // ai gọi được hàm mới là câu hỏi thật — và bốn migration (006/008/009a/012)
    // viết `GRANT EXECUTE … TO app_role` mà quên `REVOKE … FROM PUBLIC` trước,
    // để nguyên quyền mặc định của PostgreSQL trên đúng bốn hàm dẫn tới số điện
    // thoại và băm mật khẩu.
    const { rows } = await db.raw(`
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prosecdef
         AND has_function_privilege('public', p.oid, 'EXECUTE')
       ORDER BY p.proname
    `);
    expect(
      rows.map((r) => `${r.proname}(${r.args})`),
      'hàm SECURITY DEFINER chạy bằng quyền chủ sở hữu; để EXECUTE cho PUBLIC nghĩa là ' +
        'bất kỳ vai CSDL nào thêm về sau cũng gọi được nó'
    ).toEqual([]);
  });
});
