import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import supertest from 'supertest';
import { resetDb, appKnex } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { twoSignedAction } from './helpers/twoPerson.js';

// ===========================================================================
// T27 — DANH SÁCH TẤN CÔNG của người dùng, mười mục, mỗi mục ít nhất một bài.
//
// Vì sao tệp này tồn tại và vì sao nó là tệp nặng nhất của lượt Task 16:
//
//   *"Lỗi ở ma trận quyền là loại tệ nhất trong dự án này: nó không làm hỏng
//    gì trông thấy, chỉ lặng lẽ cho một vai xem thứ nó không được xem. Cả hệ
//    thống đang dựa vào giả định `app_role` không làm được X — nếu chỗ đó sai
//    thì mọi trigger phía sau thành trang trí."*
//
// MỘT ĐIỀU PHẢI NÓI THẲNG NGAY ĐẦU TỆP, vì nó quyết định hình dạng của mục 1:
// **năm "vai" của nền tảng KHÔNG phải năm vai CSDL.** `guest`, `member`,
// `content_ops`, `approver`, `tech` là dữ liệu trong bảng `member_roles`; mọi
// request HTTP, bất kể vai nào, đều chạy bằng ĐÚNG MỘT vai CSDL là `app_role`.
// Nên "thử SELECT/INSERT/UPDATE/DELETE lên từng bảng với từng vai trong năm
// vai" tách làm hai câu hỏi khác nhau, và tệp này trả lời cả hai:
//
//   (a) TẦNG CSDL — `app_role` làm được gì trên từng bảng? Bài "quét thật"
//       dưới đây CHẠY cả bốn câu lệnh trên TỪNG bảng và phân loại theo
//       SQLSTATE 42501, không hỏi một bảng hệ thống. `t10-grants` hỏi bằng
//       `has_table_privilege` (gồm cả quyền qua PUBLIC) và phủ cả phân mảnh,
//       matview, quyền theo cột.
//   (b) TẦNG ỨNG DỤNG — vai nào mở được cửa nào? Bài "quét năm vai qua HTTP"
//       đăng nhập thật bằng từng vai và gọi thật từng route `/ops`.
//
// Nếu chỉ làm (a) thì mọi cổng vai là lời hứa; nếu chỉ làm (b) thì một route
// viết ngày mai đi vòng qua cổng vẫn đọc được mọi thứ. Cần cả hai.
// ===========================================================================

const expectedGrants = JSON.parse(readFileSync(new URL('./expected-grants.json', import.meta.url)));
const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const PASSWORD = 'mat-khau-du-manh-t27';

let db, app, api, cid, cid2;
const M = {};          // vai -> member id  (cộng đồng chính)
const TOKEN = {};      // vai -> access token
let khongVai, nguoiCD2, techB;

const asActor = (actorId, fn) =>
  app.transaction(async (trx) => {
    await trx.raw(`SELECT set_config('app.actor_id', ?, true)`, [actorId ?? '']);
    return fn(trx);
  });

async function mk(name, roleKey, { community, withPassword = true, email = null } = {}) {
  const community_id = community ?? cid;
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, password_hash, email)
     VALUES (?, ?, 'member', ?, ?) RETURNING id`,
    [community_id, name, withPassword ? await argon2.hash(PASSWORD) : null, email]
  );
  if (roleKey) {
    await db.raw(
      `INSERT INTO member_roles (member_id, role_id, community_id) SELECT ?, r.id, ? FROM roles r WHERE r.key = ?`,
      [m.id, community_id, roleKey]
    );
  }
  return m.id;
}

async function login(email) {
  const res = await supertest(api).post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.access;
}

beforeAll(async () => {
  db = await resetDb();
  app = appKnex();
  api = buildApp();

  // Cộng đồng CHÍNH phải tạo TRƯỚC: `authService.resolveCommunityId()` lấy
  // cộng đồng cũ nhất theo `created_at`.
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name,config) VALUES ('t27','Hoi T27','{}'::jsonb) RETURNING id`));
  ({ rows: [{ id: cid2 }] } = await db.raw(
    `INSERT INTO communities (code,name,config) VALUES ('t27b','Hoi Khac','{}'::jsonb) RETURNING id`));

  for (const role of ['guest', 'member', 'content_ops', 'approver', 'tech']) {
    M[role] = await mk(`Vai ${role} T27`, role, { email: `${role}@t27.test` });
  }
  // Vai THẤP NHẤT theo nghĩa thật: KHÔNG có hàng `member_roles` nào. Đây mới
  // là hình dạng của một thành viên bình thường — vai `member` không được gán
  // cho ai trong hệ thống này, nó là mặc định của việc đăng nhập được.
  khongVai = await mk('Nguoi Khong Vai T27', null, { email: 'khongvai@t27.test' });
  techB = await mk('Tech Thu Hai T27', 'tech', { email: 'tech2@t27.test' });
  nguoiCD2 = await mk('Nguoi Hoi Khac T27', 'approver', { community: cid2, email: 'khac@t27.test' });

  for (const [role, id] of Object.entries(M)) {
    void id;
    TOKEN[role] = await login(`${role}@t27.test`);
  }
  TOKEN.khong_vai = await login('khongvai@t27.test');
});

afterAll(async () => {
  await app.destroy();
  await db.destroy();
});

// ===========================================================================
// MỤC 1 — từng vai, từng bảng, bốn câu lệnh
// ===========================================================================
describe('T27-1 ma trận quyền: từng bảng, bốn câu lệnh, CHẠY THẬT', () => {
  it('năm vai của nền tảng dùng CHUNG đúng một vai CSDL — nói ra thay vì để nó là giả định ngầm', async () => {
    const { rows: [r] } = await app.raw(`SELECT current_user AS u, session_user AS s`);
    expect(r.u).toBe('app_role');
    expect(r.s).toBe('app_role');
    // Hệ quả: mọi câu kiểm quyền theo VAI NỀN TẢNG nằm ở tầng ứng dụng
    // (`requireRole`/`requirePermission`) hoặc bên trong một hàm CSDL đọc
    // `app.actor_id`. Không có RLS, không có vai CSDL cho từng vai nền tảng.
    const { rows } = await db.raw(
      `SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%' ORDER BY rolname`);
    expect(rows.map((x) => x.rolname).includes('approver'), 'không có vai CSDL tên approver').toBe(false);
  });

  it('CHẠY THẬT bốn câu lệnh trên TỪNG bảng và phân loại theo SQLSTATE 42501', async () => {
    // Vì sao chạy thật thay vì đọc `information_schema`: bảng hệ thống là một
    // BẢN SAO của sự thật, và cả bộ tài liệu soát xét của dự án nói rằng so
    // hai bản sao là chỗ lỗi trốn được. Câu lệnh chạy thật thì không.
    //
    // Chỉ quét `relkind='r'` và `'p'` (bảng thường + bảng phân mảnh). VIEW bị
    // loại CÓ CHỦ ĐÍCH: `INSERT`/`UPDATE`/`DELETE` lên một view không tự cập
    // nhật được ném lỗi 55000 ("cannot insert into view") chứ không phải 42501,
    // nên bài này không phân biệt được "bị từ chối vì quyền" với "bị từ chối vì
    // hình dạng" — đúng loại bằng chứng không chứng minh được gì mà đề bài cấm.
    // View đã có `has_table_privilege` ở `t10-grants` canh.
    const { rows: tables } = await db.raw(`
      SELECT c.relname AS t,
             (SELECT a.attname FROM pg_attribute a
               WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                 AND a.attidentity = '' AND a.attgenerated = ''
               ORDER BY a.attnum LIMIT 1) AS col
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition
         AND c.relname NOT LIKE 'knex_migrations%'
       ORDER BY c.relname
    `);
    expect(tables.length, 'không đọc được bảng nào — bài test hỏng chứ không phải mã hỏng')
      .toBeGreaterThan(60);

    const lech = [];
    // `daQuet` KHÔNG phải một biến cho vui. Giao dịch dưới đây kết thúc bằng
    // `trx.rollback()` CỐ Ý, và `rollback()` làm promise của knex bị từ chối —
    // nên phải có một `.catch()` ở cuối. Nhưng cái `.catch()` ấy nuốt LUÔN mọi
    // ngoại lệ khác trong thân vòng lặp: một lỗi ở bảng thứ tư làm 68 bảng còn
    // lại KHÔNG BAO GIỜ được quét, `lech` rỗng, và bài test XANH sau khi kiểm
    // được ba bảng. Đã tái hiện: chèn một `throw` sau bảng thứ ba rồi khai sai
    // quyền của `profile_views` ⇒ 38/38 xanh; bỏ `throw` ra ⇒ đúng bài này đỏ.
    // Hai khẳng định sau vòng lặp đóng cả hai đầu: ngoại lệ được ném lại, và
    // số bảng đã chạm phải bằng đủ danh sách.
    let daQuet = 0;
    let loiTrongVongLap = null;
    await app.transaction(async (trx) => {
      try {
        for (const { t, col } of tables) {
          const want = expectedGrants[t];
          expect(want, `bảng ${t} không có trong expected-grants.json`).toBeDefined();
          const stmts = {
            SELECT: `SELECT "${col}" FROM "${t}" LIMIT 0`,
            INSERT: `INSERT INTO "${t}" DEFAULT VALUES`,
            UPDATE: `UPDATE "${t}" SET "${col}" = "${col}" WHERE false`,
            DELETE: `DELETE FROM "${t}" WHERE false`,
          };
          for (const p of PRIVS) {
            await trx.raw(`SAVEPOINT sp`);
            let denied = false;
            try {
              await trx.raw(stmts[p]);
            } catch (e) {
              // 42501 = insufficient_privilege. MỌI lỗi khác (ràng buộc NOT NULL,
              // khoá ngoại, trigger) nghĩa là câu lệnh ĐÃ QUA cửa quyền.
              denied = e?.code === '42501';
            }
            await trx.raw(`ROLLBACK TO SAVEPOINT sp`);
            const nenCo = want.includes(p);
            if (denied === nenCo) lech.push(`${t}.${p}: khai ${nenCo ? 'CÓ' : 'KHÔNG'} nhưng thực tế ${denied ? 'BỊ TỪ CHỐI' : 'CHẠY ĐƯỢC'}`);
          }
          daQuet += 1;
        }
      } catch (e) { loiTrongVongLap = e; }
      await trx.rollback().catch(() => {});
    }).catch(() => {});

    if (loiTrongVongLap) throw loiTrongVongLap;
    expect(daQuet, 'vòng quét dừng giữa chừng — những bảng còn lại KHÔNG được kiểm')
      .toBe(tables.length);
    expect(lech, 'quyền thực thi THẬT lệch với expected-grants.json').toEqual([]);
  });

  it('mọi phân mảnh audit_log cũng bị quét, và chỉ cho SELECT + INSERT', async () => {
    const { rows: parts } = await db.raw(`
      SELECT c.relname AS t FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid
       WHERE i.inhparent = 'audit_log'::regclass ORDER BY c.relname`);
    expect(parts.length, 'không có phân mảnh nào — bài test hỏng').toBeGreaterThan(0);

    for (const { t } of parts) {
      for (const p of ['UPDATE', 'DELETE']) {
        const sql = p === 'UPDATE' ? `UPDATE "${t}" SET action = action WHERE false` : `DELETE FROM "${t}" WHERE false`;
        await expect(app.raw(sql), `phân mảnh ${t} phải từ chối ${p}`).rejects.toMatchObject({ code: '42501' });
      }
      await expect(app.raw(`SELECT action FROM "${t}" LIMIT 0`)).resolves.toBeTruthy();
    }
  });

  it('QUÉT NĂM VAI QUA HTTP: mỗi route /ops mở đúng cho vai nào, và bảng role_permissions nói đúng điều đó', async () => {
    // Hai phép đo độc lập cho cùng một sự thật. Nếu chúng lệch nhau thì một
    // trong hai đang nói dối, và bài này đỏ — đó là toàn bộ mục đích: bảng
    // `role_permissions` không được phép trở thành một TÀI LIỆU MÔ TẢ.
    const routes = [
      ['get', '/api/v1/ops/audit-log', 'ops.audit.read'],
      ['get', '/api/v1/ops/audit-log/verify', 'ops.audit.read'],
      ['get', '/api/v1/ops/dashboard', 'ops.dashboard'],
      ['get', '/api/v1/ops/pending-actions', 'ops.pending_action.list'],
      ['get', '/api/v1/ops/roles', 'ops.role.manage'],
    ];
    const vai = ['guest', 'member', 'content_ops', 'approver', 'tech', 'khong_vai'];

    const { rows: rp } = await db.raw(
      `SELECT r.key AS role, p.key AS perm FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id`);
    const coQuyen = new Set(rp.map((x) => `${x.role}|${x.perm}`));

    const lech = [];
    for (const [method, path, perm] of routes) {
      for (const v of vai) {
        const res = await supertest(api)[method](path).set('authorization', `Bearer ${TOKEN[v]}`);
        const duocVao = res.status !== 403;
        const bangNoiCo = coQuyen.has(`${v}|${perm}`);
        if (duocVao !== bangNoiCo) {
          lech.push(`${method.toUpperCase()} ${path} vai=${v}: HTTP ${res.status} nhưng role_permissions nói ${bangNoiCo ? 'CÓ' : 'KHÔNG'}`);
        }
        if (duocVao) expect(res.status, `${path} vai=${v}: ${JSON.stringify(res.body)}`).toBe(200);
      }
    }
    expect(lech, 'cổng HTTP và bảng role_permissions nói hai điều khác nhau').toEqual([]);

    // Đối chứng bắt buộc: nếu MỌI vai đều bị chặn thì bốn khẳng định trên xanh
    // mà chẳng chứng minh gì. Phải có ít nhất một vai đi qua được mỗi route.
    for (const [method, path] of routes) {
      const ok = await supertest(api)[method](path).set('authorization', `Bearer ${TOKEN.tech}`);
      expect(ok.status, `${path} bằng vai tech phải MỞ: ${JSON.stringify(ok.body)}`).toBe(200);
    }
  });

  it('bảng permissions và mã nguồn khớp nhau HAI CHIỀU — không hàng nào là trang trí', async () => {
    const src = readAllSource();
    const dungTrongMa = new Set([...src.matchAll(/requirePermission\(\s*'([a-z0-9_.]+)'/g)].map((m) => m[1]));
    const { rows } = await db.raw(`SELECT key FROM permissions ORDER BY key`);
    const trongBang = new Set(rows.map((r) => r.key));

    expect([...trongBang].filter((k) => !dungTrongMa.has(k)),
      'hàng quyền không route nào dùng — một lời hứa không ai giữ').toEqual([]);
    expect([...dungTrongMa].filter((k) => !trongBang.has(k)),
      'requirePermission() gọi một khoá không có trong bảng ⇒ MỌI người bị chặn, im lặng').toEqual([]);
    expect(trongBang.size).toBeGreaterThan(0);
  });
});

// ===========================================================================
// MỤC 2 — member_contacts bằng cả năm vai
// ===========================================================================
describe('T27-2 member_contacts: cả năm vai phải hỏng', () => {
  it('app_role không SELECT/INSERT/UPDATE/DELETE được — vai CSDL duy nhất của cả năm vai', async () => {
    for (const sql of [
      `SELECT phone FROM member_contacts LIMIT 1`,
      `INSERT INTO member_contacts (member_id) VALUES (gen_random_uuid())`,
      `UPDATE member_contacts SET phone = '0912000000' WHERE false`,
      `DELETE FROM member_contacts WHERE false`,
    ]) {
      await expect(app.raw(sql), sql).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('qua HTTP, cả năm vai xem hồ sơ người khác đều KHÔNG thấy số điện thoại', async () => {
    const phone = '0977000027';
    await db.raw(`UPDATE member_contacts SET phone = ? WHERE member_id = ?`, [phone, M.approver]);
    // Đối chứng: số THẬT SỰ đang nằm trong CSDL. Không có câu này thì
    // `not.toContain` xanh y hệt khi cột rỗng vì một lý do khác (khuôn mẫu 5
    // của docs/SOAT-KIEM-THU.md mục 4).
    const { rows: [c] } = await db.raw(`SELECT phone FROM member_contacts WHERE member_id = ?`, [M.approver]);
    expect(c.phone).toBe(phone);

    for (const v of ['guest', 'member', 'content_ops', 'tech', 'khong_vai']) {
      const res = await supertest(api)
        .get(`/api/v1/members/${M.approver}`)
        .set('authorization', `Bearer ${TOKEN[v]}`);
      expect(res.status, `vai ${v}: ${JSON.stringify(res.body)}`).toBe(200);
      for (const f of Object.values(res.body.contacts)) expect(f.value, `vai ${v}`).toBeNull();
      expect(JSON.stringify(res.body), `vai ${v} không được thấy số`).not.toContain(phone);
    }
  });
});

// ===========================================================================
// MỤC 3 — MỌI hàm SECURITY DEFINER, gọi bằng vai thấp nhất
// ===========================================================================
describe('T27-3 mọi hàm SECURITY DEFINER phải TỰ KIỂM, không dựa vào việc chưa route nào gọi', () => {
  // Bảng công thức tấn công. Nó KHÔNG phải danh sách hàm — danh sách hàm lấy
  // từ `pg_proc` lúc chạy, nên một hàm SECURITY DEFINER thêm ở migration sau
  // sẽ TỰ ĐỘNG vào bài này và làm nó ĐỎ cho tới khi có người viết công thức.
  // Đó là điểm khác biệt giữa bài này và một danh sách chép tay.
  const CONG_THUC = {
    contact_read: {
      // Người không vai gì, đọc số của người ở CỘNG ĐỒNG KHÁC. Ném `NO_TARGET`
      // — DÙNG LẠI đúng mã của "không tồn tại", theo Ruling T10-a: hai câu trả
      // lời khác nhau thì chính thông điệp lỗi rò danh sách thành viên Hội kia.
      // Đối chứng "đúng cộng đồng thì đọc được" nằm ở `t05` và
      // `t13-contact-read-survives`, nên bài này không lặp lại nó.
      chay: (trx) => trx.raw(`SELECT * FROM contact_read(?, 'phone')`, [nguoiCD2]),
      nem: /NO_TARGET/,
    },
    contact_upsert: {
      chay: (trx) => trx.raw(`SELECT contact_upsert(?, 'phone', '0912000999')`, [M.approver]),
      nem: /CONTACT_WRITE_DENIED/,
    },
    join_secret_consume: {
      chay: (trx) => trx.raw(`SELECT * FROM join_secret_consume(?)`, ['00000000-0000-0000-0000-000000000000']),
      nem: /NO_TARGET|JOIN_SECRET_DENIED/,
    },
    fn_trust_recount: {
      chay: (trx) => trx.raw(`SELECT fn_trust_recount(?)`, [nguoiCD2]),
      nem: /TRUST_RECOUNT_DENIED/,
    },
    fn_community_config_apply: {
      chay: async (trx) => {
        const { rows: [pa] } = await db.raw(`SELECT id FROM pending_actions WHERE action_key = 'community.config_change' ORDER BY created_at DESC LIMIT 1`);
        return trx.raw(`SELECT fn_community_config_apply(?)`, [pa.id]);
      },
      nem: /EXECUTOR_NOT_SIGNER/,
    },
    fn_role_grant: {
      chay: (trx) => trx.raw(`SELECT fn_role_grant(?, 'tech')`, [M.approver]),
      nem: /ROLE_MANAGE_DENIED/,
    },
    fn_role_revoke: {
      chay: (trx) => trx.raw(`SELECT fn_role_revoke(?, 'approver')`, [M.approver]),
      nem: /ROLE_MANAGE_DENIED/,
    },
    fn_member_bootstrap: { trigger: true },
    fn_work_edge: { trigger: true },
    // NGOẠI LỆ ĐÃ TUYÊN, và nó có bài riêng ngay dưới describe này.
    auth_lookup: { ngoaiLe: 'chạy TRƯỚC khi có ai để kiểm — xem bài "auth_lookup" ngay dưới' },
  };

  it('liệt kê từ pg_proc và tấn công từng hàm bằng vai thấp nhất', async () => {
    // Dựng sẵn một hành động config_change đủ hai chữ ký để công thức của
    // `fn_community_config_apply` có cái để gọi.
    await twoSignedAction(db, cid, {
      actionKey: 'community.config_change', targetType: 'community', targetId: cid,
      payload: { config: { fund_two_approver_threshold: 3000000 } },
      creator: M.approver, second: M.tech ? undefined : undefined,
    });

    const { rows: hams } = await db.raw(`
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
             (t.typname = 'trigger') AS la_trigger
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_type t ON t.oid = p.prorettype
       WHERE n.nspname = 'public' AND p.prosecdef
       ORDER BY p.proname`);
    expect(hams.length, 'không đọc được hàm nào — bài test hỏng').toBeGreaterThan(5);

    const chuaCoCongThuc = hams.map((h) => h.proname).filter((n) => !(n in CONG_THUC));
    expect(
      chuaCoCongThuc,
      'HÀM SECURITY DEFINER MỚI KHÔNG CÓ CÔNG THỨC TẤN CÔNG. Nó chạy bằng quyền chủ bảng nên ' +
        'REVOKE ALL không đỡ được (Ruling T10-a). Viết công thức vào CONG_THUC và chứng minh nó tự kiểm.'
    ).toEqual([]);

    const lot = [];
    for (const h of hams) {
      const ct = CONG_THUC[h.proname];
      if (ct.ngoaiLe) continue;
      if (ct.trigger) {
        // HAI lớp, và bài này khẳng định cả hai chạy thật:
        //  (a) `EXECUTE` đã thu về khỏi PUBLIC ở migration 029 và KHÔNG cấp
        //      cho `app_role` ⇒ `permission denied for function`;
        //  (b) kể cả có quyền thì PostgreSQL vẫn từ chối gọi thẳng một hàm
        //      `RETURNS trigger`.
        // Chấp nhận cả hai thông điệp: nếu một ngày ai đó `GRANT EXECUTE` lại
        // thì lớp (b) vẫn phải đứng, và bài này vẫn xanh — nhưng nếu hàm đổi
        // kiểu trả về thì khẳng định `la_trigger` ngay dưới sẽ đỏ.
        expect(h.la_trigger, `${h.proname} không còn RETURNS trigger`).toBe(true);
        await expect(asActor(khongVai, (trx) => trx.raw(`SELECT ${h.proname}()`)))
          .rejects.toThrow(/trigger function|can only be called as triggers|permission denied for function/i);
        continue;
      }
      try {
        const r = await asActor(khongVai, (trx) => ct.chay(trx));
        if (ct.nem) lot.push(`${h.proname}(${h.args}) KHÔNG ném gì cả`);
        else ct.kyVong(r);
      } catch (e) {
        if (!ct.nem) lot.push(`${h.proname}: ném ${e.message} trong khi bài chờ một giá trị trả về`);
        else expect(e.message, `${h.proname}`).toMatch(ct.nem);
      }
    }
    expect(lot, 'hàm SECURITY DEFINER không tự kiểm người gọi').toEqual([]);
  });

  it('auth_lookup — ngoại lệ đã tuyên: nó KHÔNG kiểm người gọi được, nên hai lưới khác canh nó', async () => {
    // Lưới 1 — DANH SÁCH CỘT TRẢ VỀ bị khoá. Đây là hình dạng hỏng thật sự
    // nguy hiểm: một `CREATE OR REPLACE` ở migration sau thêm `c.phone` vào
    // `RETURNS TABLE` sẽ biến hàm đăng nhập thành cửa đọc số điện thoại, và
    // `REVOKE ALL ON member_contacts` không đỡ được vì hàm là SECURITY DEFINER.
    const { rows: [sig] } = await db.raw(
      `SELECT pg_get_function_result(p.oid) AS res
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'auth_lookup'`);
    expect(sig.res).toBe('TABLE(id uuid, community_id uuid, password_hash text, status text, full_name text)');

    // Lưới 2 — nó LỌC `p_community` thật. Người của cộng đồng khác không tra ra
    // được bằng cộng đồng này, kèm ĐỐI CHỨNG rằng tra đúng cộng đồng thì ra.
    const { rows: sai } = await app.raw(`SELECT * FROM auth_lookup(?, ?)`, [cid, 'khac@t27.test']);
    expect(sai.length, 'auth_lookup phải lọc cộng đồng').toBe(0);
    const { rows: dung } = await app.raw(`SELECT * FROM auth_lookup(?, ?)`, [cid2, 'khac@t27.test']);
    expect(dung.length, 'đối chứng: đúng cộng đồng thì tra ra').toBe(1);
    expect(dung[0].id).toBe(nguoiCD2);
  });
});

// ===========================================================================
// MỤC 4 — tự nâng quyền
// ===========================================================================
describe('T27-4 tự nâng quyền, ở CẢ tầng CSDL lẫn tầng route', () => {
  it('approver không đổi được vai của bất kỳ ai — kể cả của chính mình', async () => {
    await expect(asActor(M.approver, (trx) => trx.raw(`SELECT fn_role_grant(?, 'tech')`, [M.approver])))
      .rejects.toThrow(/ROLE_SELF_GRANT/);
    await expect(asActor(M.approver, (trx) => trx.raw(`SELECT fn_role_grant(?, 'tech')`, [khongVai])))
      .rejects.toThrow(/ROLE_MANAGE_DENIED/);
  });

  it('TECH tự gán tech cho CHÍNH MÌNH bị chặn — và bị chặn bởi một câu RIÊNG, không phải bởi câu kiểm vai', async () => {
    // Đây là chỗ dễ hụt nhất của cả luồng: `tech` THOẢ câu kiểm vai, nên nếu
    // luật duy nhất là "phải là tech" thì tự nâng quyền của tech ĐI QUA.
    await expect(asActor(M.tech, (trx) => trx.raw(`SELECT fn_role_grant(?, 'tech')`, [M.tech])))
      .rejects.toThrow(/ROLE_SELF_GRANT/);
    await expect(asActor(M.tech, (trx) => trx.raw(`SELECT fn_role_revoke(?, 'tech')`, [M.tech])))
      .rejects.toThrow(/ROLE_SELF_GRANT/);
    // Đối chứng: cùng người đó gán cho NGƯỜI KHÁC thì được — cổng không chặn tất cả.
    const { rows: [r] } = await asActor(M.tech, (trx) =>
      trx.raw(`SELECT fn_role_grant(?, 'content_ops') AS changed`, [khongVai]));
    expect(r.changed).toBe(true);
    await asActor(M.tech, (trx) => trx.raw(`SELECT fn_role_revoke(?, 'content_ops')`, [khongVai]));
  });

  it('CHẶN Ở TẦNG CSDL, không chỉ ở route: trigger trên member_roles vẫn nổ khi đi vòng qua hàm', async () => {
    // Đi thẳng vào bảng, bỏ qua cả route lẫn `fn_role_grant` — đây là đường mà
    // một hàm SECURITY DEFINER thứ hai viết ở task sau sẽ đi. `app_role` không
    // có quyền ghi `member_roles` nên câu này chết ở quyền; bài dưới đây dùng
    // KẾT NỐI OWNER có đóng dấu, tức mô phỏng đúng "một hàm SECURITY DEFINER
    // viết ẩu" (trong hàm đó, current_user là chủ bảng).
    await expect(
      db.transaction(async (trx) => {
        await trx.raw(`SELECT set_config('app.actor_id', ?, true)`, [M.tech]);
        await trx.raw(
          `INSERT INTO member_roles (member_id, role_id, community_id) SELECT ?, r.id, ? FROM roles r WHERE r.key='tech'`,
          [M.tech, cid]);
      })
    ).rejects.toThrow(/ROLE_SELF_GRANT/);

    await expect(
      db.transaction(async (trx) => {
        await trx.raw(`SELECT set_config('app.actor_id', ?, true)`, [M.approver]);
        await trx.raw(
          `INSERT INTO member_roles (member_id, role_id, community_id) SELECT ?, r.id, ? FROM roles r WHERE r.key='tech'`,
          [khongVai, cid]);
      })
    ).rejects.toThrow(/ROLE_MANAGE_DENIED/);
  });

  it('qua HTTP: chỉ tech mở được cửa gán vai, và tech vẫn không tự gán cho mình', async () => {
    const cam = await supertest(api)
      .put(`/api/v1/ops/members/${khongVai}/roles/approver`)
      .set('authorization', `Bearer ${TOKEN.approver}`);
    expect(cam.status, JSON.stringify(cam.body)).toBe(403);
    expect(cam.body.error.code).toBe('FORBIDDEN');

    const tuNang = await supertest(api)
      .put(`/api/v1/ops/members/${M.tech}/roles/tech`)
      .set('authorization', `Bearer ${TOKEN.tech}`);
    expect(tuNang.status, JSON.stringify(tuNang.body)).toBe(403);
    expect(tuNang.body.error.code).toBe('ROLE_SELF_GRANT');

    const ok = await supertest(api)
      .put(`/api/v1/ops/members/${khongVai}/roles/approver`)
      .set('authorization', `Bearer ${TOKEN.tech}`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual({ member_id: khongVai, role: 'approver', granted: true });

    const go = await supertest(api)
      .delete(`/api/v1/ops/members/${khongVai}/roles/approver`)
      .set('authorization', `Bearer ${TOKEN.tech}`);
    expect(go.status, JSON.stringify(go.body)).toBe(200);
    expect(go.body.revoked).toBe(true);
  });

  it('gán và gỡ vai để lại dấu trong nhật ký, và dấu đó do CSDL ghi chứ không do service', async () => {
    const { rows: [truoc] } = await db.raw(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'role.granted'`);
    // Gọi THẲNG hàm CSDL, bỏ qua cả service lẫn route: nếu nhật ký do service
    // ghi thì con số dưới đây không nhúc nhích.
    await asActor(M.tech, (trx) => trx.raw(`SELECT fn_role_grant(?, 'content_ops')`, [khongVai]));
    const { rows } = await db.raw(
      `SELECT actor_id, target_id, detail FROM audit_log WHERE action = 'role.granted' ORDER BY seq DESC LIMIT 1`);
    const { rows: [sau] } = await db.raw(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'role.granted'`);
    expect(sau.n).toBe(truoc.n + 1);
    expect(rows[0].actor_id).toBe(M.tech);
    expect(rows[0].target_id).toBe(khongVai);
    expect(rows[0].detail).toEqual({ role: 'content_ops' });
    await asActor(M.tech, (trx) => trx.raw(`SELECT fn_role_revoke(?, 'content_ops')`, [khongVai]));
  });
});

// ===========================================================================
// MỤC 5 — giả mạo actor_id, và nhật ký chỉ-đọc
// ===========================================================================
describe('T27-5 audit_log: không giả mạo được người, không sửa được, không xoá được', () => {
  it('ghi audit_log với actor_id là NGƯỜI KHÁC bị chặn ở tầng CSDL', async () => {
    await expect(
      asActor(khongVai, (trx) => trx.raw(
        `INSERT INTO audit_log (community_id, actor_id, action, detail) VALUES (?, ?, 'gia.mao', '{}'::jsonb)`,
        [cid, M.approver]))
    ).rejects.toThrow(/AUDIT_ACTOR_MISMATCH/);
  });

  it('không đóng dấu người thực hiện thì không nêu đích danh ai được', async () => {
    await expect(
      asActor(null, (trx) => trx.raw(
        `INSERT INTO audit_log (community_id, actor_id, action, detail) VALUES (?, ?, 'gia.mao', '{}'::jsonb)`,
        [cid, M.approver]))
    ).rejects.toThrow(/AUDIT_ACTOR_MISMATCH/);

    // Đối chứng bắt buộc ×2, nếu không thì trigger có thể đang chặn TẤT CẢ và
    // ba bài trên vẫn xanh: (a) ghi tên CHÍNH MÌNH thì được;
    await expect(asActor(khongVai, (trx) => trx.raw(
      `INSERT INTO audit_log (community_id, actor_id, action, detail) VALUES (?, ?, 'that.that', '{}'::jsonb)`,
      [cid, khongVai]))).resolves.toBeTruthy();
    // (b) sự kiện KHÔNG có người thực hiện (otp.requested, auth.login.denied)
    //     vẫn ghi được khi không đóng dấu.
    await expect(asActor(null, (trx) => trx.raw(
      `INSERT INTO audit_log (community_id, action, detail) VALUES (?, 'otp.requested', '{}'::jsonb)`,
      [cid]))).resolves.toBeTruthy();
  });

  it('vì sao chỗ này đáng một trigger: actor_id NẰM TRONG chuỗi băm', async () => {
    // Một dòng giả mạo không phải một dòng xấu — nó là lịch sử HỢP LỆ VĨNH
    // VIỄN, vì `verifyChain` sẽ xác nhận nó lành. Bài này khoá lại lập luận đó
    // bằng cách đọc chính công thức băm đang chạy trong CSDL.
    const { rows: [f] } = await db.raw(`SELECT prosrc FROM pg_proc WHERE proname = 'fn_audit_chain'`);
    expect(f.prosrc).toMatch(/NEW\.actor_id/);
  });

  it('không endpoint nào SỬA hay XOÁ audit_log, và app_role cũng không', async () => {
    for (const sql of [
      `UPDATE audit_log SET action = 'da-sua' WHERE false`,
      `DELETE FROM audit_log WHERE false`,
    ]) {
      await expect(app.raw(sql), sql).rejects.toMatchObject({ code: '42501' });
    }
    // Và ở tầng route: không tệp nào trong `api/src/modules` viết UPDATE/DELETE
    // lên audit_log. Lưới quét mã là lưới THỨ HAI ở đây — lưới chính là hai câu
    // trên, chạy thật.
    const src = readAllSource();
    expect(src).not.toMatch(/(update|delete\s+from)\s+audit_log/i);
  });
});

// ===========================================================================
// MỤC 6 — khung hai người ký
// ===========================================================================
describe('T27-6 khung hai người ký: một chữ ký, và người thứ hai sai vai', () => {
  it('MỘT chữ ký thì hành động không thi hành được', async () => {
    const { rows: [pa] } = await db.raw(
      `INSERT INTO pending_actions (community_id, action_key, target_type, target_id, payload, payload_hash, created_by)
       VALUES (?, 'member.terminate', 'member', ?, '{}'::jsonb, 'h27-1', ?) RETURNING id`,
      [cid, khongVai, M.approver]);
    await db.raw(
      `INSERT INTO pending_action_signatures (pending_action_id, signer_id, community_id, payload_hash_at_sign)
       VALUES (?, ?, ?, 'h27-1')`, [pa.id, M.approver, cid]);

    await expect(
      db.raw(`UPDATE pending_actions SET status='executed', executed_at=now() WHERE id = ?`, [pa.id])
    ).rejects.toThrow(/TWO_SIGNATURES_REQUIRED/);
  });

  it('người thứ hai SAI VAI: chữ ký bị từ chối ngay lúc ghi', async () => {
    const { rows: [pa] } = await db.raw(
      `INSERT INTO pending_actions (community_id, action_key, target_type, target_id, payload, payload_hash, created_by)
       VALUES (?, 'member.terminate', 'member', ?, '{}'::jsonb, 'h27-2', ?) RETURNING id`,
      [cid, khongVai, M.approver]);
    await db.raw(
      `INSERT INTO pending_action_signatures (pending_action_id, signer_id, community_id, payload_hash_at_sign)
       VALUES (?, ?, ?, 'h27-2')`, [pa.id, M.approver, cid]);

    // `member.terminate` đòi vai `approver` (bảng mục 7.5). `tech` là vai CAO
    // hơn về mặt kỹ thuật nhưng KHÔNG phải vai được ký việc này — đúng điểm
    // mà "vai cao thì làm được mọi thứ" là một giả định sai.
    await expect(
      db.raw(`INSERT INTO pending_action_signatures (pending_action_id, signer_id, community_id, payload_hash_at_sign)
              VALUES (?, ?, ?, 'h27-2')`, [pa.id, M.tech, cid])
    ).rejects.toThrow(/SIGNER_ROLE_REQUIRED/);

    // Đối chứng: người thứ hai ĐÚNG vai thì ký được và hành động thi hành được.
    const approverHai = await mk('Approver Hai T27', 'approver');
    await db.raw(
      `INSERT INTO pending_action_signatures (pending_action_id, signer_id, community_id, payload_hash_at_sign)
       VALUES (?, ?, ?, 'h27-2')`, [pa.id, approverHai, cid]);
    await expect(
      db.raw(`UPDATE pending_actions SET status='executed', executed_at=now() WHERE id = ?`, [pa.id])
    ).resolves.toBeTruthy();
  });
});

// ===========================================================================
// MỤC 7 — token cũ sau khi bị chuyển sang 'left'
// ===========================================================================
describe('T27-7 token cũ của người đã rời', () => {
  it('access token cũ CHẾT NGAY, không sống nốt 15 phút', async () => {
    const email = 'sero@t27.test';
    const ai = await mk('Nguoi Sap Roi T27', null, { email });
    const token = await login(email);

    // Còn là member thì token dùng được — đối chứng, nếu không thì bài dưới
    // xanh cả khi token vốn đã hỏng vì một lý do khác.
    const truoc = await supertest(api).get('/api/v1/auth/me').set('authorization', `Bearer ${token}`);
    expect(truoc.status, JSON.stringify(truoc.body)).toBe(200);

    await db.raw(`UPDATE members SET status = 'left' WHERE id = ?`, [ai]);

    const sau = await supertest(api).get('/api/v1/auth/me').set('authorization', `Bearer ${token}`);
    expect(sau.status, 'token cũ của người đã rời phải chết ngay').toBe(401);
    const dsach = await supertest(api).get('/api/v1/members').set('authorization', `Bearer ${token}`);
    expect(dsach.status).toBe(401);
  });

  it('refresh token cũ cũng không đổi được token mới', async () => {
    const email = 'sero2@t27.test';
    const ai = await mk('Nguoi Sap Roi Hai T27', null, { email });
    const dn = await supertest(api).post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD });
    expect(dn.status).toBe(200);

    await db.raw(`UPDATE members SET status = 'left' WHERE id = ?`, [ai]);

    const lam = await supertest(api).post('/api/v1/auth/refresh').send({ refresh_token: dn.body.refresh });
    expect(lam.status, JSON.stringify(lam.body)).toBe(401);
    expect(lam.body.error.code).toBe('INVALID_REFRESH');
  });
});

// ===========================================================================
// MỤC 8 — fn_community_config_apply bằng một thành viên thường
// ===========================================================================
describe('T27-8 ai bấm nút thi hành', () => {
  it('thành viên thường KHÔNG thi hành được một quyết định của hai người khác', async () => {
    const { rows: [truoc] } = await db.raw(`SELECT config FROM communities WHERE id = ?`, [cid]);
    const moi = { ...truoc.config, fund_two_approver_threshold: 987654321 };
    const { id, creator } = await twoSignedAction(db, cid, {
      actionKey: 'community.config_change', targetType: 'community', targetId: cid,
      payload: { config: moi },
    });

    await expect(asActor(khongVai, (trx) => trx.raw(`SELECT fn_community_config_apply(?)`, [id])))
      .rejects.toThrow(/EXECUTOR_NOT_SIGNER/);
    const { rows: [giua] } = await db.raw(`SELECT config FROM communities WHERE id = ?`, [cid]);
    expect(giua.config.fund_two_approver_threshold, 'cấu hình KHÔNG được đổi').not.toBe(987654321);

    // Đối chứng: MỘT TRONG NHỮNG NGƯỜI ĐÃ KÝ thì thi hành được — cánh cổng
    // chặn tất cả cũng là một cánh cổng hỏng.
    await asActor(creator, (trx) => trx.raw(`SELECT fn_community_config_apply(?)`, [id]));
    const { rows: [sau] } = await db.raw(`SELECT config FROM communities WHERE id = ?`, [cid]);
    expect(sau.config.fund_two_approver_threshold).toBe(987654321);
    await db.raw(`UPDATE pending_actions SET status='executed', executed_at=now(), result='{}'::jsonb WHERE id = ?`, [id]);
  });

  it('một approver KHÔNG ký việc đó cũng không bấm nút được', async () => {
    // Vì sao điều kiện là "đã ký" chứ không phải "có vai approver": mục 7.2
    // bước 3 nói thi hành chạy trong cùng giao dịch với chữ ký thứ hai, nên
    // người gọi hợp lệ duy nhất trong thiết kế ĐÃ là một người ký.
    const { rows: [truoc] } = await db.raw(`SELECT config FROM communities WHERE id = ?`, [cid]);
    const { id } = await twoSignedAction(db, cid, {
      actionKey: 'community.config_change', targetType: 'community', targetId: cid,
      payload: { config: { ...truoc.config, manual_pair_quota: 99 } },
    });
    await expect(asActor(M.approver, (trx) => trx.raw(`SELECT fn_community_config_apply(?)`, [id])))
      .rejects.toThrow(/EXECUTOR_NOT_SIGNER/);
  });
});

// ===========================================================================
// MỤC 9 — gán vai cho người ở cộng đồng khác
// ===========================================================================
describe('T27-9 lọc community_id ở luồng gán vai (lỗi đã lặp bảy lần)', () => {
  it('tech của Hội này KHÔNG gán được vai cho người của Hội khác', async () => {
    await expect(asActor(M.tech, (trx) => trx.raw(`SELECT fn_role_grant(?, 'approver')`, [nguoiCD2])))
      .rejects.toThrow(/NO_TARGET/);
    await expect(asActor(M.tech, (trx) => trx.raw(`SELECT fn_role_revoke(?, 'approver')`, [nguoiCD2])))
      .rejects.toThrow(/NO_TARGET/);
  });

  it('thông điệp lỗi KHÔNG phân biệt "ở Hội khác" với "không tồn tại"', async () => {
    // Nếu hai câu khác nhau thì chính thông điệp lỗi trở thành máy dò danh
    // sách thành viên của Hội bên kia — đúng lập luận Ruling T10-a.
    let a, b;
    try { await asActor(M.tech, (trx) => trx.raw(`SELECT fn_role_grant(?, 'approver')`, [nguoiCD2])); }
    catch (e) { a = e.message; }
    try { await asActor(M.tech, (trx) => trx.raw(`SELECT fn_role_grant(?, 'approver')`, ['00000000-0000-0000-0000-000000000000'])); }
    catch (e) { b = e.message; }
    expect(a).toBe(b);
  });

  it('qua HTTP cũng vậy, và trả 404 chứ không phải 403', async () => {
    const res = await supertest(api)
      .put(`/api/v1/ops/members/${nguoiCD2}/roles/approver`)
      .set('authorization', `Bearer ${TOKEN.tech}`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const { rows } = await db.raw(`SELECT count(*)::int AS n FROM member_roles WHERE member_id = ? AND community_id = ?`,
      [nguoiCD2, cid]);
    expect(rows[0].n, 'không hàng vai nào rơi vào cộng đồng sai').toBe(0);
  });

  it('kể cả đường OWNER, khoá ngoại GHÉP của 008 vẫn chặn', async () => {
    // Người của Hội khác CHƯA mang vai nào — nếu dùng `nguoiCD2` (đã có
    // `approver` ở Hội của họ) thì câu này chết vì `member_roles_pkey`
    // (`PRIMARY KEY (member_id, role_id)`, không có `community_id`), và bài
    // test sẽ xanh vì một lý do KHÁC với lý do nó muốn kiểm — đúng thứ đề bài
    // cấm. Đây là hình dạng đột biến sai mà tôi đã vấp và vứt đi một lần.
    const sach = await mk('Nguoi Hoi Khac Chua Vai T27', null, { community: cid2, withPassword: false });
    await expect(db.raw(
      `INSERT INTO member_roles (member_id, role_id, community_id) SELECT ?, r.id, ? FROM roles r WHERE r.key='approver'`,
      [sach, cid])).rejects.toThrow(/member_roles_member_id_community_id_fkey/);
  });
});

// ===========================================================================
// MỤC 10 — chỗ hở #24, hai chiều
// ===========================================================================
describe('T27-10 gỡ vai không làm chữ ký cũ mất hiệu lực NGƯỢC (chỗ hở #24)', () => {
  // Đặt lại ngưỡng quỹ về một triệu TRƯỚC nhóm bài này. Các bài ở mục 8 đã đẩy
  // `fund_two_approver_threshold` lên 987.654.321 để chứng minh cửa cấu hình
  // hoạt động, và nếu không đặt lại thì bài "một chữ ký vẫn là một chữ ký" ở
  // dưới sẽ XANH vì bút toán nằm dưới ngưỡng — tức xanh vì một lý do khác với
  // lý do nó kiểm, đúng thứ đề bài cấm. Đi qua khung hai người ký như người thật.
  beforeAll(async () => {
    const { rows: [c] } = await db.raw(`SELECT config FROM communities WHERE id = ?`, [cid]);
    const { id, creator } = await twoSignedAction(db, cid, {
      actionKey: 'community.config_change', targetType: 'community', targetId: cid,
      payload: { config: { ...c.config, fund_two_approver_threshold: 1000000 } },
    });
    await asActor(creator, (trx) => trx.raw(`SELECT fn_community_config_apply(?)`, [id]));
    await db.raw(`UPDATE pending_actions SET status='executed', executed_at=now(), result='{}'::jsonb WHERE id = ?`, [id]);
  });

  it('bút toán quỹ: gỡ vai approver khỏi một người ĐÃ KÝ, bút toán vẫn đứng', async () => {
    const a = await mk('Ky Quy A T27', 'approver');
    const b = await mk('Ky Quy B T27', 'approver');
    // Bút toán VÀ hai chữ ký trong CÙNG một giao dịch: `trg_fund_two_approvers`
    // là constraint trigger hoãn tới COMMIT (mục 4.8), nên ghi bút toán bằng
    // một câu tự-commit riêng sẽ hỏng ngay lúc chưa có chữ ký nào — hỏng đúng,
    // nhưng không phải điều bài này muốn kiểm.
    const e = await db.transaction(async (trx) => {
      const { rows: [row] } = await trx.raw(
        `INSERT INTO fund_entries (community_id, amount, purpose, created_by) VALUES (?, ?, 'Chi lon T27', ?) RETURNING id`,
        [cid, -50000000, khongVai]);
      for (const s of [a, b]) {
        await trx.raw(`INSERT INTO fund_entry_approvals (entry_id, approver_id, community_id) VALUES (?,?,?)`,
          [row.id, s, cid]);
      }
      return row;
    });
    const { rows: [n1] } = await db.raw(`SELECT fn_fund_valid_signatures(?) AS n`, [e.id]);
    expect(n1.n).toBe(2);

    // Gỡ vai qua ĐÚNG cửa hợp lệ, không phải bằng một câu DELETE trần.
    await asActor(M.tech, (trx) => trx.raw(`SELECT fn_role_revoke(?, 'approver')`, [a]));
    const { rows: [con] } = await db.raw(
      `SELECT count(*)::int AS n FROM member_roles mr JOIN roles r ON r.id = mr.role_id
        WHERE mr.member_id = ? AND r.key = 'approver'`, [a]);
    expect(con.n, 'vai đã bị gỡ thật').toBe(0);

    const { rows: [n2] } = await db.raw(`SELECT fn_fund_valid_signatures(?) AS n`, [e.id]);
    expect(n2.n, 'chữ ký là SỰ VIỆC Ở MỘT THỜI ĐIỂM — gỡ vai hôm nay không xoá nó').toBe(2);

    // Và bút toán vẫn khoá lại được: hai chữ ký còn nguyên hiệu lực.
    await expect(db.raw(`UPDATE fund_entries SET locked = true WHERE id = ?`, [e.id])).resolves.toBeTruthy();
  });

  it('bảo chứng: gỡ vai khỏi một người đã ký cũng không làm bảo chứng sụp', async () => {
    const a = await mk('Ky BC A T27', 'approver');
    const b = await mk('Ky BC B T27', 'approver');
    const chu = await mk('Duoc Bao Chung T27', null);
    const { rows: [en] } = await db.raw(
      `INSERT INTO endorsements (community_id, member_id, body, status)
       VALUES (?, ?, 'Bao chung tay nghe tho dien', 'draft') RETURNING id`,
      [cid, chu]);
    for (const s of [a, b]) {
      await db.raw(`INSERT INTO endorsement_signatures (endorsement_id, signer_id, community_id) VALUES (?,?,?)`,
        [en.id, s, cid]);
    }
    await db.raw(`UPDATE endorsements SET status = 'active' WHERE id = ?`, [en.id]);

    await asActor(M.tech, (trx) => trx.raw(`SELECT fn_role_revoke(?, 'approver')`, [a]));

    // Chạm vào hàng bảo chứng để trigger hoãn ĐẾM LẠI: nếu hàm đếm còn hỏi
    // `member_roles` thì câu này sẽ ném ENDORSEMENT_NEEDS_TWO_DISTINCT.
    await expect(db.raw(`UPDATE endorsements SET body = 'Bao chung tay nghe tho dien nuoc' WHERE id = ?`, [en.id]))
      .resolves.toBeTruthy();
    const { rows } = await db.raw(
      `SELECT role_at_sign FROM endorsement_signatures WHERE endorsement_id = ? ORDER BY signer_id`, [en.id]);
    expect(rows.map((r) => r.role_at_sign)).toEqual(['approver', 'approver']);
  });

  it('CHIỀU NGƯỢC LẠI: gán vai cho người CHƯA TỪNG KÝ không biến họ thành người đã ký', async () => {
    // Chiều này quan trọng ngang chiều kia: một bản vá "đếm theo ảnh chụp vai"
    // viết ẩu có thể làm hàm đếm nhìn vào một cột luôn bằng 'approver', và khi
    // ấy MỌI hàng chữ ký đều hợp lệ — kể cả hàng KHÔNG TỒN TẠI. Dùng
    // `pending_actions` chứ không dùng quỹ: ở đây ghi được một hành động MỚI
    // CÓ MỘT chữ ký (trigger hai-chữ-ký chỉ nổ khi `status='executed'`), nên
    // dựng được đúng hình dạng "một chữ ký" mà bài này cần.
    const a = await mk('Ky Mot Minh T27', 'approver');
    const c = await mk('Chua Tung Ky T27', null);
    const { rows: [pa] } = await db.raw(
      `INSERT INTO pending_actions (community_id, action_key, target_type, target_id, payload, payload_hash, created_by)
       VALUES (?, 'member.terminate', 'member', ?, '{}'::jsonb, 'h27-24', ?) RETURNING id`,
      [cid, khongVai, a]);
    await db.raw(
      `INSERT INTO pending_action_signatures (pending_action_id, signer_id, community_id, payload_hash_at_sign)
       VALUES (?, ?, ?, 'h27-24')`, [pa.id, a, cid]);

    const { rows: [n1] } = await db.raw(`SELECT fn_pending_action_signatures(?) AS n`, [pa.id]);
    expect(n1.n).toBe(1);

    await asActor(M.tech, (trx) => trx.raw(`SELECT fn_role_grant(?, 'approver')`, [c]));
    const { rows: [n2] } = await db.raw(`SELECT fn_pending_action_signatures(?) AS n`, [pa.id]);
    expect(n2.n, 'gán vai không đẻ ra chữ ký').toBe(1);
    await expect(db.raw(`UPDATE pending_actions SET status='executed', executed_at=now() WHERE id = ?`, [pa.id]))
      .rejects.toThrow(/TWO_SIGNATURES_REQUIRED/);

    // Đối chứng, và nó là nửa còn lại của cùng một sự thật: người vừa được gán
    // vai ký ĐƯỢC từ lúc này trở đi. Vai lúc ký mới là thứ được đếm — không
    // phải vai hôm qua, cũng không phải vai hôm nay.
    await db.raw(
      `INSERT INTO pending_action_signatures (pending_action_id, signer_id, community_id, payload_hash_at_sign)
       VALUES (?, ?, ?, 'h27-24')`, [pa.id, c, cid]);
    const { rows: [n3] } = await db.raw(`SELECT fn_pending_action_signatures(?) AS n`, [pa.id]);
    expect(n3.n).toBe(2);
    await expect(db.raw(`UPDATE pending_actions SET status='executed', executed_at=now() WHERE id = ?`, [pa.id]))
      .resolves.toBeTruthy();
  });
});

// ===========================================================================
// Bảng điều khiển và nhật ký — phần "việc" của task, ngoài danh sách tấn công
// ===========================================================================
describe('T27 nhật ký và bảng điều khiển', () => {
  it('GET /ops/audit-log lọc theo actor_id và ghi lại chính lượt đọc đó', async () => {
    const res = await supertest(api)
      .get(`/api/v1/ops/audit-log?actor_id=${M.tech}&page=1&limit=5`)
      .set('authorization', `Bearer ${TOKEN.approver}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 5 });
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const r of res.body.data) expect(r.actor_id).toBe(M.tech);
    // `ip` KHÔNG ra tới client — đây là cửa đọc HÀNG LOẠT.
    for (const r of res.body.data) expect(r.ip).toBeUndefined();

    const { rows } = await db.raw(
      `SELECT actor_id, detail FROM audit_log WHERE action = 'audit.read' ORDER BY seq DESC LIMIT 1`);
    expect(rows[0].actor_id).toBe(M.approver);
    expect(rows[0].detail.filter_actor_id).toBe(M.tech);
  });

  it('phân trang: hai trang rời nhau, tổng đúng — cửa sổ phải ĐÓNG BĂNG bằng ?to', async () => {
    // ĐÂY LÀ MỘT PHÁT HIỆN, không phải một chỗ chỉnh cho bài test xanh: đọc
    // nhật ký GHI một dòng `audit.read` vào chính nhật ký đó, nên hai lời gọi
    // liên tiếp KHÔNG nhìn cùng một tập dữ liệu — trang 2 bị đẩy đi một dòng
    // và trùng một dòng với trang 1. Bản đầu của bài test này đỏ đúng vì lý do
    // ấy. Cách đúng cho người dùng thật là truyền `?to` để đóng băng cửa sổ,
    // và bài test phải làm đúng như người dùng phải làm.
    const moc = new Date().toISOString();
    const q = `to=${encodeURIComponent(moc)}&limit=3`;
    const p1 = await supertest(api).get(`/api/v1/ops/audit-log?page=1&${q}`)
      .set('authorization', `Bearer ${TOKEN.tech}`);
    const p2 = await supertest(api).get(`/api/v1/ops/audit-log?page=2&${q}`)
      .set('authorization', `Bearer ${TOKEN.tech}`);
    expect(p1.status, JSON.stringify(p1.body)).toBe(200);
    expect(p2.status, JSON.stringify(p2.body)).toBe(200);
    const s1 = p1.body.data.map((r) => r.seq);
    const s2 = p2.body.data.map((r) => r.seq);
    expect(s1.length).toBe(3);
    expect(s2.length).toBe(3);
    expect(s1.filter((x) => s2.includes(x)), 'hai trang không được trùng dòng nào').toEqual([]);
    expect(p1.body.meta.total).toBe(p2.body.meta.total);
    expect(p1.body.meta.total).toBeGreaterThan(6);

    // Đối chứng cho chính phát hiện trên: KHÔNG đóng băng thì hai trang trùng
    // nhau — nếu ngày nào đó `audit.read` thôi được ghi, câu này đỏ và người
    // sửa sẽ biết ngay vì sao bài trên phải truyền `?to`.
    const k1 = await supertest(api).get('/api/v1/ops/audit-log?page=1&limit=3')
      .set('authorization', `Bearer ${TOKEN.tech}`);
    const k2 = await supertest(api).get('/api/v1/ops/audit-log?page=2&limit=3')
      .set('authorization', `Bearer ${TOKEN.tech}`);
    const trung = k1.body.data.map((r) => r.seq).filter((x) => k2.body.data.map((y) => y.seq).includes(x));
    expect(trung.length, 'mỗi lượt đọc nhật ký tự thêm một dòng vào nhật ký').toBeGreaterThan(0);
  });

  it('GET /ops/audit-log/verify chạy verifyChain THẬT và ghi audit.verified', async () => {
    const res = await supertest(api).get('/api/v1/ops/audit-log/verify')
      .set('authorization', `Bearer ${TOKEN.tech}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.checked).toBeGreaterThan(0);
    expect(res.body.broken_at).toBeNull();
    expect(res.body.brokenAt, 'không rò camelCase').toBeUndefined();

    const { rows } = await db.raw(
      `SELECT actor_id, detail FROM audit_log WHERE action = 'audit.verified' ORDER BY seq DESC LIMIT 1`);
    expect(rows[0].actor_id).toBe(M.tech);
    expect(rows[0].detail.ok).toBe(true);
  });

  it('verify PHÁT HIỆN THẬT khi chuỗi bị bẻ — không chỉ luôn trả ok', async () => {
    // Đối chứng cho bài trên: không có bài này thì `ok: true` có thể là hằng số.
    // Sửa bằng kết nối OWNER (app_role không có UPDATE trên audit_log).
    const { rows: [r] } = await db.raw(
      `SELECT seq FROM audit_log WHERE community_id = ? ORDER BY seq LIMIT 1 OFFSET 2`, [cid]);
    await db.raw(`UPDATE audit_log SET action = 'da-bi-sua-t27' WHERE seq = ?`, [r.seq]);
    const res = await supertest(api).get('/api/v1/ops/audit-log/verify')
      .set('authorization', `Bearer ${TOKEN.tech}`);
    expect(res.body.ok).toBe(false);
    expect(res.body.broken_at).toBe(String(r.seq));
    // Trả lại để các bài sau không đỏ dây chuyền.
    await db.raw(`UPDATE audit_log SET action = 'contact.denied' WHERE seq = ?`, [r.seq]);
  });

  it('GET /ops/dashboard trả bốn cảnh báo, và ngưỡng đọc từ communities.config', async () => {
    const res = await supertest(api).get('/api/v1/ops/dashboard')
      .set('authorization', `Bearer ${TOKEN.approver}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['audit_log', 'contact_denied', 'manual_ratio', 'two_person_same_ip']);
    expect(typeof res.body.audit_log.rows_today).toBe('number');
    expect(res.body.audit_log.spike_alert).toBe(false);
    expect(Array.isArray(res.body.contact_denied.flagged)).toBe(true);

    // Ngưỡng đọc từ cấu hình, không phải hằng số trong mã — cùng khuôn bài
    // "hạn mức đọc từ communities.config" của t08.
    const truoc = res.body.contact_denied.threshold;
    const { rows: [c] } = await db.raw(`SELECT config FROM communities WHERE id = ?`, [cid]);
    const { id, creator } = await twoSignedAction(db, cid, {
      actionKey: 'community.config_change', targetType: 'community', targetId: cid,
      payload: { config: { ...c.config, contact_denied_alert_per_30d: 1 } },
    });
    await asActor(creator, (trx) => trx.raw(`SELECT fn_community_config_apply(?)`, [id]));
    await db.raw(`UPDATE pending_actions SET status='executed', executed_at=now(), result='{}'::jsonb WHERE id = ?`, [id]);

    const sau = await supertest(api).get('/api/v1/ops/dashboard')
      .set('authorization', `Bearer ${TOKEN.approver}`);
    expect(sau.body.contact_denied.threshold).toBe(1);
    expect(sau.body.contact_denied.threshold).not.toBe(truoc);
  });

  it('bảng điều khiển KHÔNG xếp hạng con người: danh sách bị nêu cờ sắp theo TÊN', async () => {
    // Nguyên tắc 5. Lưới quét mã của `t12-trust` chỉ bắt `ORDER BY <cột uy tín>`;
    // bài này canh hành vi ở đúng cửa mới mở.
    const src = readFileSync(fileURLToPath(new URL('../src/modules/ops/service.js', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/order\s+by[\s\S]{0,120}?\b(denied_count|ratio|manual_works|confirmed_works)\b/i);
    expect(src).toMatch(/ORDER BY m\.full_name/);
  });

  it('GET /ops/permissions mở cho MỌI vai, kể cả người không vai gì', async () => {
    const khong = await supertest(api).get('/api/v1/ops/permissions')
      .set('authorization', `Bearer ${TOKEN.khong_vai}`);
    expect(khong.status, JSON.stringify(khong.body)).toBe(200);
    expect(khong.body).toEqual({ roles: [], permissions: [] });

    const tech = await supertest(api).get('/api/v1/ops/permissions')
      .set('authorization', `Bearer ${TOKEN.tech}`);
    expect(tech.status).toBe(200);
    expect(tech.body.roles).toEqual(['tech']);
    expect(tech.body.permissions.map((p) => p.key).sort())
      .toEqual(['ops.audit.read', 'ops.dashboard', 'ops.pending_action.list', 'ops.role.manage']);
  });
});

// Đọc toàn bộ mã nguồn máy chủ thành một chuỗi — cùng khuôn `t23-error-map`.
function readAllSource() {
  const base = fileURLToPath(new URL('../src', import.meta.url));
  const out = [];
  const stack = [base];
  while (stack.length) {
    const p = stack.pop();
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) for (const f of readdirSync(p)) stack.push(join(p, f));
    else if (p.endsWith('.js')) out.push(readFileSync(p, 'utf8'));
  }
  return out.join('\n');
}
