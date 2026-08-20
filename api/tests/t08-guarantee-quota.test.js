import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb, ownerKnex } from './helpers/db.js';
import { patchConfig, grantQuotaOverride } from './helpers/twoPerson.js';
import { mkInvite } from './helpers/invites.js';
import { hashInviteToken } from '../src/modules/invites/token.js';
import { config } from '../src/config/index.js';
import { requestOtp, verifyOtp } from '../src/modules/auth/service.js';
import { consoleAdapter } from '../src/core/otp/console.js';
import { buildApp } from '../src/app.js';
import { REGISTER_MIN_MS } from '../src/modules/auth/routes.js';

let db, cid, areaId;

// Đúng MỘT cộng đồng trong tệp này: resolveCommunityId() lấy cộng đồng cũ
// nhất, nên tạo thêm cộng đồng thứ hai sẽ làm các bài đi qua HTTP nhắm nhầm.
beforeAll(async () => {
  db = await resetDb();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-join','Hoi dong nien 1986') RETURNING id`
  ));
  ({ rows: [{ id: areaId }] } = await db.raw(
    `INSERT INTO areas (community_id, name) VALUES (?, 'Xa Khoai Chau') RETURNING id`,
    [cid]
  ));
});
afterAll(async () => {
  await db.destroy();
});

let seq = 0;
async function newMember(status = 'member') {
  seq += 1;
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, ?, ?) RETURNING id`,
    [cid, `Nguoi thu ${seq}`, status]
  );
  return m.id;
}

function insertJr(referrerId, status = 'pending', createdAtSql = 'now()') {
  return db.raw(
    `INSERT INTO join_requests (community_id, applicant_data, referrer_id, status, created_at)
     VALUES (?, '{}'::jsonb, ?, ?, ${createdAtSql}) RETURNING id`,
    [cid, referrerId, status]
  );
}

async function grantRole(memberId, key) {
  await db.raw(
    `INSERT INTO member_roles (member_id, role_id, community_id)
     SELECT ?, r.id, ? FROM roles r WHERE r.key = ?`,
    [memberId, cid, key]
  );
}

function accessTokenFor(memberId) {
  return jwt.sign({ sub: memberId, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
}

// Dòng nhật ký "từ chối" do errorHandler ghi trong một giao dịch RIÊNG, không
// được await trước khi phản hồi HTTP trả về (cố ý: phản hồi không chờ nhật ký).
// Nên bài test phải chờ nó xuất hiện thay vì đọc một lần rồi kết luận — đọc
// một lần là một bài test chập chờn, đúng thứ dự án này đã cấm ở Task 7.
async function waitForRow(query, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const { rows } = await query();
    if (rows.length > 0) return rows;
    if (Date.now() - start > timeoutMs) return [];
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function freshOtpToken(phone) {
  let code;
  const spy = vi.spyOn(consoleAdapter, 'send').mockImplementation(async (a) => {
    code = a.code;
  });
  try {
    await requestOtp({ communityId: cid, phone, purpose: 'register' });
  } finally {
    spy.mockRestore();
  }
  const { otpToken } = await verifyOtp({ communityId: cid, phone, code, purpose: 'register' });
  return otpToken;
}

// ---------------------------------------------------------------------------
describe('T8 hạn mức bảo lãnh — cưỡng chế ở CSDL, không phải lời hứa ở tầng app', () => {
  it('đơn thứ tư trong 12 tháng bị chặn', async () => {
    const referrer = await newMember();
    for (let i = 0; i < 3; i++) await insertJr(referrer);
    await expect(insertJr(referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
  });

  it('cửa sổ là 12 THÁNG TRƯỢT: ba đơn của 11 tháng trước vẫn chặn đơn hôm nay', async () => {
    // 11 tháng trước rơi vào NĂM DƯƠNG LỊCH TRƯỚC (hôm nay là tháng 8). Luật
    // "3 đơn mỗi năm dương lịch" sẽ cho đơn này qua; luật 12 tháng trượt thì
    // không. Đây là chỗ duy nhất phân biệt được hai luật bằng dữ liệu.
    const referrer = await newMember();
    for (let i = 0; i < 3; i++) await insertJr(referrer, 'pending', `now() - interval '11 months'`);
    await expect(insertJr(referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
  });

  it('đơn cũ hơn 12 tháng thì rơi ra khỏi cửa sổ, suất được trả lại', async () => {
    const referrer = await newMember();
    for (let i = 0; i < 3; i++) await insertJr(referrer, 'pending', `now() - interval '13 months'`);
    await expect(insertJr(referrer)).resolves.toBeTruthy();
  });

  it('hai giao dịch ĐỒNG THỜI cùng tranh suất cuối thì đúng MỘT cái qua', async () => {
    const referrer = await newMember();
    for (let i = 0; i < 2; i++) await insertJr(referrer); // 2/3 đã dùng

    const a = ownerKnex();
    const b = ownerKnex();
    try {
      const ta = await a.transaction();
      const tb = await b.transaction();
      const ins = (t) =>
        t.raw(
          `INSERT INTO join_requests (community_id, applicant_data, referrer_id, status)
           VALUES (?, '{}'::jsonb, ?, 'pending')`,
          [cid, referrer]
        );

      // ta chèn trước và GIỮ khóa tư vấn tới lúc commit. tb chèn ngay sau đó,
      // trong khi ta CHƯA commit: không có khóa thì tb đếm ra 2 (không thấy
      // hàng chưa commit của ta) và lọt — đây chính là bài toán bóng ma mà
      // FOR UPDATE không giải được. Có khóa thì tb xếp hàng, và khi ta commit
      // xong, câu đếm của tb chạy trên ảnh chụp MỚI (READ COMMITTED, mỗi câu
      // lệnh một ảnh chụp) nên thấy đủ 3.
      const r1 = await ins(ta).then(() => 'ok').catch(() => 'fail');
      const p2 = ins(tb).then(() => 'ok').catch(() => 'fail');

      // BÀI HỌC ĐẮT (khung ở kế hoạch dòng 2053–2067 KHÔNG có đoạn này, và
      // thiếu nó thì bài test là bài test giả — đã tự kiểm bằng phép thử đột
      // biến: gỡ pg_advisory_xact_lock, bài vẫn XANH). Lý do: `ins(tb)` chỉ
      // TẠO promise, còn câu lệnh có tới máy chủ trước hay sau `ta.commit()`
      // là do bộ lập lịch của Node quyết định. Thực tế nó thường tới SAU, tb
      // đếm ra 3 và hỏng — đúng kết quả mong đợi, nhưng vì lý do sai hoàn
      // toàn, và bài test không phân biệt được hai lý do đó.
      //
      // Chờ tới khi tb THẬT SỰ đang xếp hàng sau một khóa tư vấn (đọc pg_locks
      // bằng kết nối thứ ba) mới commit ta. Có khóa: điều kiện này đạt được,
      // và tb chắc chắn còn đang chờ khi ta commit. Không có khóa: không bao
      // giờ đạt, hết giờ, và assertion ngay dưới đỏ — đỏ vì đúng lý do.
      let blocked = false;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const { rows } = await db.raw(
          `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`
        );
        if (rows[0].n > 0) {
          blocked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(blocked, 'giao dịch thứ hai không hề bị chặn — khóa tư vấn không có tác dụng').toBe(true);

      await ta.commit();
      const r2 = await p2;
      await tb.rollback().catch(() => {});

      expect([r1, r2].filter((x) => x === 'ok')).toHaveLength(1);
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });

  it('lách bằng draft rồi đẩy lên pending cũng bị chặn (vế UPDATE OF status)', async () => {
    const referrer = await newMember();
    for (let i = 0; i < 3; i++) await insertJr(referrer);
    // draft chưa tiêu suất nên chèn được — đúng thiết kế.
    const { rows: [draft] } = await insertJr(referrer, 'draft');
    await expect(
      db.raw(`UPDATE join_requests SET status = 'pending' WHERE id = ?`, [draft.id])
    ).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
  });

  it('rejected thường TRẢ LẠI suất', async () => {
    const referrer = await newMember();
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const { rows: [r] } = await insertJr(referrer);
      ids.push(r.id);
    }
    await db.raw(`UPDATE join_requests SET status='rejected', reject_reason_code='not_ready' WHERE id = ?`, [ids[0]]);
    await expect(insertJr(referrer)).resolves.toBeTruthy();
  });

  it('rejected vì referrer_misrepresented thì KHÔNG trả lại suất', async () => {
    const referrer = await newMember();
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const { rows: [r] } = await insertJr(referrer);
      ids.push(r.id);
    }
    await db.raw(
      `UPDATE join_requests SET status='rejected', reject_reason_code='referrer_misrepresented' WHERE id = ?`,
      [ids[0]]
    );
    await expect(insertJr(referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
  });

  it('referrer_id IS NULL ⇒ REFERRER_REQUIRED (không có bảo lãnh ẩn danh)', async () => {
    await expect(
      db.raw(`INSERT INTO join_requests (community_id, applicant_data, status) VALUES (?, '{}'::jsonb, 'draft')`, [cid])
    ).rejects.toThrow(/REFERRER_REQUIRED/);
  });

  it('guarantee_quota_overrides nới đúng số suất đã cấp, và hết hiệu lực theo valid_until', async () => {
    const referrer = await newMember();
    for (let i = 0; i < 3; i++) await insertJr(referrer);
    await expect(insertJr(referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);

    // Từ migration 028 (chỗ hở #20 của docs/RANG-BUOC.md), hàng nới hạn mức
    // PHẢI gắn với một hành động `guarantee.quota_override` đã thi hành — nên
    // bài này dựng dữ liệu qua khung hai người ký thay vì INSERT trần.
    const { overrideId } = await grantQuotaOverride(db, cid, { referrerId: referrer });
    await expect(insertJr(referrer)).resolves.toBeTruthy(); // suất thứ 4 nhờ nới lỏng
    await expect(insertJr(referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/); // suất thứ 5 thì không

    // Nới lỏng TỰ hết hạn: đẩy valid_until về quá khứ (chỉ owner làm được —
    // app_role bị REVOKE UPDATE, xem expected-grants.json).
    await db.raw(`UPDATE guarantee_quota_overrides SET valid_until = now() - interval '1 second' WHERE id = ?`, [overrideId]);
    await expect(insertJr(referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
  });

  it('INSERT trần vào guarantee_quota_overrides không còn nới được suất nào (#20)', async () => {
    const referrer = await newMember();
    const keAn = await newMember();
    for (let i = 0; i < 3; i++) await insertJr(referrer);

    // Đúng câu đã tái hiện được ở docs/RANG-BUOC.md mục 5.4: tự cấp suất cho
    // chính mình, `granted_by` là chính mình. Nay NOT NULL chặn ngay ở cột.
    await expect(
      db.raw(
        `INSERT INTO guarantee_quota_overrides (community_id, referrer_id, extra_slots, reason, granted_by, valid_until)
         VALUES (?, ?, 3, 'tu cap', ?, now() + interval '1 year')`,
        [cid, referrer, referrer]
      )
    ).rejects.toThrow(/pending_action_id|null value/i);

    // Và ngay cả khi trỏ tới một hành động CÓ THẬT nhưng chưa đủ chữ ký /
    // chưa thi hành, COMMIT vẫn hỏng — kiểm ở tầng CSDL, không ở service.
    const { rows: [pa] } = await db.raw(
      `INSERT INTO pending_actions (community_id, action_key, target_type, target_id, payload, payload_hash, created_by)
       VALUES (?, 'guarantee.quota_override', 'member', ?, '{}'::jsonb, 'x', ?) RETURNING id`,
      [cid, referrer, keAn]
    );
    await expect(
      db.transaction(async (trx) => {
        await trx.raw(
          `INSERT INTO guarantee_quota_overrides
             (community_id, referrer_id, extra_slots, reason, granted_by, valid_until, pending_action_id)
           VALUES (?, ?, 3, 'tu cap', ?, now() + interval '1 year', ?)`,
          [cid, referrer, keAn, pa.id]
        );
      })
    ).rejects.toThrow(/QUOTA_OVERRIDE_UNSIGNED/);
  });

  it('đơn của cộng đồng này không trỏ được người bảo lãnh sang cộng đồng khác', async () => {
    // Cộng đồng thứ hai được tạo SAU cộng đồng chính, nên resolveCommunityId()
    // (lấy cộng đồng cũ nhất) vẫn trả về cộng đồng chính — các bài đi qua HTTP
    // không bị bài này làm nhiễu.
    const { rows: [{ id: otherCid }] } = await db.raw(
      `INSERT INTO communities (code,name) VALUES ('community-khac','Cong dong khac') RETURNING id`
    );
    const { rows: [outsider] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Nguoi cong dong khac', 'member') RETURNING id`,
      [otherCid]
    );

    // Nếu chỉ có khóa ngoại đơn cột REFERENCES members(id) như kế hoạch viết,
    // câu này QUA — và fn_guarantee_quota sẽ đọc cap từ config của cộng đồng
    // này trong khi tiêu suất của một người thuộc cộng đồng kia.
    await expect(
      db.raw(
        `INSERT INTO join_requests (community_id, applicant_data, referrer_id, status)
         VALUES (?, '{}'::jsonb, ?, 'pending')`,
        [cid, outsider.id]
      )
    ).rejects.toThrow(/jr_referrer_same_community|violates foreign key/i);
  });

  it('hạn mức đọc từ communities.config, không phải hằng số trong mã', async () => {
    const referrer = await newMember();
    // Từ migration 028, `communities.config` chỉ đổi được qua khung hai người
    // ký (chỗ hở #22 — "chi 50 triệu không một chữ ký nào"). Bài này dựng dữ
    // liệu qua đúng con đường đó; bài kiểm chính con đường ấy nằm ở t25.
    await patchConfig(db, cid, { guarantee_quota_per_year: 1 });
    try {
      await expect(insertJr(referrer)).resolves.toBeTruthy();
      await expect(insertJr(referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
    } finally {
      await patchConfig(db, cid, { guarantee_quota_per_year: undefined });
    }
  });

  it('UPDATE trần vào communities.config bị chặn — kể cả bằng kết nối owner (#22)', async () => {
    await expect(
      db.raw(`UPDATE communities SET config = config || '{"guarantee_quota_per_year":99}'::jsonb WHERE id = ?`, [cid])
    ).rejects.toThrow(/CONFIG_CHANGE_UNSIGNED/);
    const { rows: [c] } = await db.raw(`SELECT config FROM communities WHERE id = ?`, [cid]);
    expect(c.config.guarantee_quota_per_year).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('T8 cổng met_confirmed và sợi bảo lãnh đóng băng', () => {
  // CẢNH BÁO cho người viết bài test sau (tự vấp, mất một vòng): dạng giao
  // dịch THỦ CÔNG của knex (`const trx = await db.transaction()` rồi
  // `trx.commit()`) NUỐT lỗi của lệnh COMMIT — `trx.commit()` resolve bình
  // thường, bản thân đối tượng trx (thenable) cũng resolve, trong khi dữ liệu
  // KHÔNG hề được ghi. Đã kiểm bằng chạy thật: sau `commit()` "thành công",
  // `SELECT` không thấy hàng nào. Ràng buộc hoãn tới COMMIT là loại lỗi DUY
  // NHẤT chỉ xuất hiện ở lệnh COMMIT, nên bài test dùng dạng thủ công sẽ báo
  // xanh cả khi trigger bị gỡ. Dạng callback (`db.transaction(async trx =>
  // ...)`) reject đúng như mong đợi — và đó cũng là dạng core/tx.js dùng, nên
  // mã production không dính bẫy này.
  it('members.status=member khi chưa có xác nhận gặp mặt ⇒ hỏng lúc COMMIT, không phải lúc ghi', async () => {
    const referrer = await newMember();
    let insertResolved = false;
    await expect(
      db.transaction(async (trx) => {
        // Câu INSERT tự nó PHẢI thành công: ràng buộc được hoãn tới commit, đó
        // là toàn bộ lý do dùng CONSTRAINT TRIGGER thay vì BEFORE INSERT.
        await trx.raw(
          `INSERT INTO members (community_id, full_name, status, referrer_id) VALUES (?, 'Nguoi moi', 'member', ?)`,
          [cid, referrer]
        );
        insertResolved = true;
      })
    ).rejects.toThrow(/MEMBER_NEEDS_MET_CONFIRMATION/);
    expect(insertResolved, 'câu ghi phải qua được, chỉ COMMIT mới hỏng').toBe(true);

    const { rows } = await db.raw(`SELECT id FROM members WHERE full_name = 'Nguoi moi'`);
    expect(rows).toHaveLength(0);
  });

  it('đặt join_requests.member_id trong CÙNG giao dịch thì COMMIT qua được', async () => {
    const referrer = await newMember();
    const { rows: [jr] } = await insertJr(referrer, 'met_confirmed');
    await db.raw(`UPDATE join_requests SET met_confirmed_at = now(), met_confirmed_by = ? WHERE id = ?`, [
      referrer,
      jr.id,
    ]);

    await expect(
      db.transaction(async (trx) => {
        const { rows: [m] } = await trx.raw(
          `INSERT INTO members (community_id, full_name, status, referrer_id) VALUES (?, 'Nguoi moi hop le', 'member', ?) RETURNING id`,
          [cid, referrer]
        );
        await trx.raw(`UPDATE join_requests SET member_id = ?, status = 'approved' WHERE id = ?`, [m.id, jr.id]);
      })
    ).resolves.not.toThrow();

    const { rows } = await db.raw(`SELECT id FROM members WHERE full_name = 'Nguoi moi hop le'`);
    expect(rows).toHaveLength(1);
  });

  it('đổi referrer_id của một hàng status=member ⇒ REFERRER_FROZEN', async () => {
    const oldReferrer = await newMember();
    const newReferrer = await newMember();
    const { rows: [m] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status, referrer_id) VALUES (?, 'Da la thanh vien', 'member', NULL) RETURNING id`,
      [cid]
    );
    // Đặt lần đầu khi còn NULL vẫn được (chưa có sợi nào để đóng băng)... nhưng
    // hàng này đã là 'member', nên theo đúng luật thì KHÔNG được.
    await expect(
      db.raw(`UPDATE members SET referrer_id = ? WHERE id = ?`, [oldReferrer, m.id])
    ).rejects.toThrow(/REFERRER_FROZEN/);

    // Và với một hàng chưa phải member thì đặt được, rồi vẫn đổi được khi còn guest.
    const { rows: [g] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Con la khach', 'guest') RETURNING id`,
      [cid]
    );
    await expect(db.raw(`UPDATE members SET referrer_id = ? WHERE id = ?`, [oldReferrer, g.id])).resolves.toBeTruthy();
    await expect(db.raw(`UPDATE members SET referrer_id = ? WHERE id = ?`, [newReferrer, g.id])).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('T8 POST /auth/register — ba nhánh hỏng không phân biệt được', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  function body(extra) {
    return {
      full_name: 'Nguoi Nop Don',
      birth_year: 1986,
      area_id: areaId,
      password: 'mat-khau-du-manh-12',
      terms: true,
      ...extra,
    };
  }

  it('nộp đơn hợp lệ: trả join_request_id + step, ghi join_request.created', async () => {
    const referrer = await newMember();
    const { token } = await mkInvite(db, cid, referrer);
    const phone = '0921000001';
    const res = await supertest(app)
      .post('/api/v1/auth/register')
      .send(body({ otp_token: await freshOtpToken(phone), phone, invite_token: token }));

    expect(res.status).toBe(201);
    expect(res.body.join_request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.step).toBe(2);

    const { rows } = await db.raw(`SELECT detail FROM audit_log WHERE action = 'join_request.created' AND target_id = ?`, [
      res.body.join_request_id,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].detail.referrer_id).toBe(referrer);
    // Nhật ký không bao giờ mang số điện thoại thô.
    expect(JSON.stringify(rows[0].detail)).not.toContain(phone);
  });

  it('otp_token không dùng lại được cho đơn thứ hai', async () => {
    const referrer = await newMember();
    const phone = '0921000002';
    const token = await freshOtpToken(phone);
    // HAI link khác nhau, vì mỗi link cũng chỉ dùng được một lần: nếu dùng lại
    // cùng một link thì lần nộp thứ hai hỏng vì INVITE_ALREADY_USED và bài này
    // không còn chứng minh được điều nó định chứng minh (vé OTP là thứ bị tiêu).
    const first = await supertest(app)
      .post('/api/v1/auth/register')
      .send(body({ otp_token: token, phone, invite_token: (await mkInvite(db, cid, referrer)).token }));
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    const second = await supertest(app)
      .post('/api/v1/auth/register')
      .send(body({ otp_token: token, phone, invite_token: (await mkInvite(db, cid, referrer)).token }));
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('OTP_INVALID');
  });

  // VIẾT LẠI THEO QĐ-1, và lý do phải nói rõ vì bài cũ canh một luật đã hết
  // đối tượng. Bài cũ khẳng định ba nhánh hỏng (referrer không tồn tại /
  // không phải member / hết hạn mức) trả CÙNG một mã, CÙNG một câu — luật ấy
  // sinh ra để bịt một MÁY DÒ: ô nhập `referrer_id` cho phép gõ thử uuid rồi
  // đọc thông báo lỗi để biết ai là thành viên.
  //
  // QĐ-1 gỡ chính cái ô nhập đó. Đầu vào nay là token của một đường link do
  // người bảo lãnh phát — 256 bit ngẫu nhiên, không dò được — nên hai nhánh
  // "không tồn tại" và "không phải member" KHÔNG CÒN TỒN TẠI, và việc nói thật
  // lý do với người đang cầm link không rò ra điều gì. Giữ nguyên bài cũ thì
  // nó sẽ đỏ vì một luật đã bị chính người dùng thay, chứ không phải vì mã sai.
  //
  // Cái PHẢI giữ lại từ bài cũ, và bài này giữ: (a) lý do THẬT vẫn vào nhật ký
  // dù người nộp đơn chỉ thấy một câu; (b) mọi nhánh đều bị đệm tới cùng sàn
  // thời gian; (c) nhánh hỏng vẫn TIÊU vé OTP — nếu SAVEPOINT bị gỡ thì
  // rollback trả lại vé và nhánh đó phân biệt được qua trạng thái.
  it('bốn nhánh link hỏng: đúng mã lỗi, có dấu trong nhật ký, đều bị đệm tới sàn', async () => {
    const referrer = await newMember();
    const nguoiKhac = await newMember();

    const { token: linkDaDung } = await mkInvite(db, cid, referrer);
    await supertest(app)
      .post('/api/v1/auth/register')
      .send(body({ otp_token: await freshOtpToken('0922000009'), phone: '0922000009', invite_token: linkDaDung }));

    const { token: linkThuHoi, id: idThuHoi } = await mkInvite(db, cid, referrer);
    await db.raw(`UPDATE guarantee_invites SET revoked_at = now(), revoked_reason = 'phat nham' WHERE id = ?`, [
      idThuHoi,
    ]);

    // Link hết hạn: mốc hết hạn phải tính bằng đồng hồ CỦA MÁY CHỦ, và không
    // sửa lại được sau khi phát (trg_guarantee_invite_frozen), nên cách duy
    // nhất là phát một link sống rất ngắn rồi đợi nó chết.
    const { token: linkHetHan } = await mkInvite(db, cid, nguoiKhac, {
      expiresSql: `now() + interval '10 milliseconds'`,
    });
    await new Promise((r) => setTimeout(r, 60));

    const linkBia = 'khong-he-ton-tai-mot-token-nao-nhu-the-nay-ca';

    const mong = [
      [linkBia, 404, 'INVITE_NOT_FOUND', 'invite_not_found'],
      [linkHetHan, 422, 'INVITE_EXPIRED', 'invite_expired'],
      [linkThuHoi, 422, 'INVITE_REVOKED', 'invite_revoked'],
      [linkDaDung, 409, 'INVITE_ALREADY_USED', 'invite_already_used'],
    ];

    expect(REGISTER_MIN_MS, 'đặc tả dòng 815 đòi tối thiểu 300ms').toBeGreaterThanOrEqual(300);

    let i = 0;
    for (const [token, status, code] of mong) {
      i += 1;
      const phone = `092200000${i}`;
      const startedAt = Date.now();
      const res = await supertest(app)
        .post('/api/v1/auth/register')
        .send(body({ otp_token: await freshOtpToken(phone), phone, invite_token: token }));
      expect(res.status, JSON.stringify(res.body)).toBe(status);
      expect(res.body.error.code).toBe(code);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(REGISTER_MIN_MS);
      // Token KHÔNG BAO GIỜ có mặt trong câu trả lời.
      expect(JSON.stringify(res.body)).not.toContain(token);
    }

    // Lý do THẬT vẫn được ghi lại phía máy chủ, và không dòng nào mang token
    // hay băm của token.
    const { rows } = await db.raw(
      `SELECT detail FROM audit_log WHERE action = 'join_request.denied' ORDER BY seq DESC LIMIT 4`
    );
    expect(rows.map((r) => r.detail.reason).sort()).toEqual(
      mong.map(([, , , reason]) => reason).sort()
    );
    for (const [token] of mong) {
      expect(JSON.stringify(rows), 'token không bao giờ vào nhật ký').not.toContain(token);
      expect(JSON.stringify(rows), 'băm của token cũng không').not.toContain(hashInviteToken(token));
    }

    // Bốn nhánh hỏng đều TIÊU vé OTP — nếu SAVEPOINT bị gỡ thì rollback trả
    // lại vé, và nhánh đó phân biệt được qua trạng thái thay vì qua câu chữ.
    const { rows: consumed } = await db.raw(
      `SELECT count(*)::int AS n FROM otp_challenges WHERE consumed_at IS NOT NULL AND purpose = 'register'`
    );
    expect(consumed[0].n).toBeGreaterThanOrEqual(5);
  });

  it('hết hạn mức thì chặn NGAY LÚC PHÁT LINK, không phải lúc người ta đăng ký xong', async () => {
    // Đây là điểm 2 của QĐ-1 nhìn từ tầng HTTP: người bảo lãnh phát tới cái
    // link thứ tư mới bị chặn, và bị chặn TRƯỚC khi có ai kịp nhận lời hứa.
    const referrer = await newMember();
    for (let i = 0; i < 3; i++) await mkInvite(db, cid, referrer);
    await expect(mkInvite(db, cid, referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
  });

  it('sai năm sinh thì báo đúng lỗi đó, KHÔNG tiêu vé OTP và KHÔNG đốt link', async () => {
    const referrer = await newMember();
    const { token: invite, id: inviteId } = await mkInvite(db, cid, referrer);
    const phone = '0923000001';
    const token = await freshOtpToken(phone);
    const bad = await supertest(app)
      .post('/api/v1/auth/register')
      .send(body({ otp_token: token, phone, invite_token: invite, birth_year: 1987 }));
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('BIRTH_YEAR_MISMATCH');

    // Lỗi gõ nhầm của người dùng không phải nhánh từ chối — vé phải còn, và
    // ĐƯỜNG LINK cũng phải còn. Đốt link vì người ta gõ nhầm năm sinh là lấy
    // mất một suất của người bảo lãnh vì lỗi của người khác.
    const { rows: [inv] } = await db.raw(`SELECT used_at FROM guarantee_invites WHERE id = ?`, [inviteId]);
    expect(inv.used_at, 'gõ nhầm năm sinh không được đốt link mời').toBeNull();

    const ok = await supertest(app)
      .post('/api/v1/auth/register')
      .send(body({ otp_token: token, phone, invite_token: invite }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });
});

// ---------------------------------------------------------------------------
describe('T8 /join-requests — cổng met_confirmed ở tầng HTTP', () => {
  let app, referrer, stranger, approver, jrId;

  beforeAll(async () => {
    app = buildApp();
    referrer = await newMember();
    stranger = await newMember();
    approver = await newMember();
    await grantRole(referrer, 'member');
    await grantRole(stranger, 'member');
    await grantRole(approver, 'approver');

    const phone = '0924000001';
    const res = await supertest(app)
      .post('/api/v1/auth/register')
      .send({
        otp_token: await freshOtpToken(phone),
        phone,
        full_name: 'Nguoi Duoc Bao Lanh',
        birth_year: 1986,
        area_id: areaId,
        invite_token: (await mkInvite(db, cid, referrer)).token,
        password: 'mat-khau-du-manh-12',
        terms: true,
      });
    expect(res.status).toBe(201);
    jrId = res.body.join_request_id;
  });

  it('danh sách: approver xem được, member thường thì không', async () => {
    const ok = await supertest(app)
      .get('/api/v1/join-requests?status=pending')
      .set('Authorization', `Bearer ${accessTokenFor(approver)}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.length).toBeGreaterThan(0);
    expect(ok.body.meta.total).toBeGreaterThan(0);

    const denied = await supertest(app)
      .get('/api/v1/join-requests')
      .set('Authorization', `Bearer ${accessTokenFor(stranger)}`);
    expect(denied.status).toBe(403);

    // MỘT dòng nhật ký cho cả trang, không phải một dòng mỗi đơn.
    const { rows } = await db.raw(`SELECT detail FROM audit_log WHERE action='join_request.list' AND actor_id = ?`, [
      approver,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('applicant_data không bao giờ rời máy chủ nguyên vẹn (số điện thoại, băm mật khẩu)', async () => {
    const res = await supertest(app)
      .get(`/api/v1/join-requests/${jrId}`)
      .set('Authorization', `Bearer ${accessTokenFor(approver)}`);
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('0924000001');
    expect(raw).not.toContain('$argon2');
    expect(raw).not.toContain('password');
    // ...nhưng phần công khai thì vẫn phải có, nếu không đơn thành vô dụng.
    expect(res.body.applicant.full_name).toBe('Nguoi Duoc Bao Lanh');

    // Bằng chứng đối chứng: dữ liệu thô ĐANG nằm trong CSDL, tức bài trên kiểm
    // lớp lọc chứ không phải kiểm một cột rỗng. Từ migration 009a (Ruling
    // T8-f) nó nằm ở join_request_secrets chứ không còn ở applicant_data —
    // tức lớp lọc ở tầng service nay là lớp THỨ HAI, còn lớp thứ nhất là
    // REVOKE của CSDL (bài kiểm ở t16).
    const { rows } = await db.raw(`SELECT applicant_data FROM join_requests WHERE id = ?`, [jrId]);
    expect(rows[0].applicant_data.phone, 'applicant_data không được chứa số điện thoại nữa').toBeUndefined();
    expect(rows[0].applicant_data.password_hash, 'applicant_data không được chứa băm mật khẩu nữa').toBeUndefined();

    const { rows: sec } = await db.raw(
      `SELECT phone, password_hash FROM join_request_secrets WHERE join_request_id = ?`, [jrId]);
    expect(sec[0].phone).toBe('0924000001');
    expect(sec[0].password_hash.startsWith('$argon2')).toBe(true);
  });

  it('người lạ không xem được đơn của người khác', async () => {
    const res = await supertest(app)
      .get(`/api/v1/join-requests/${jrId}`)
      .set('Authorization', `Bearer ${accessTokenFor(stranger)}`);
    expect(res.status).toBe(403);
  });

  it('confirm-met bởi người KHÔNG phải người bảo lãnh ⇒ từ chối, và có dòng nhật ký từ chối', async () => {
    const res = await supertest(app)
      .post(`/api/v1/join-requests/${jrId}/confirm-met`)
      .set('Authorization', `Bearer ${accessTokenFor(stranger)}`)
      .send({ met_on: '2026-08-01', note: 'Toi khang dinh da gap mat nguoi nay o nha van hoa xa.' });
    expect(res.status).toBe(403);

    // Truy vấn phải nhắm ĐÚNG dòng của lượt từ chối này. Lọc rộng
    // (`action LIKE '%denied'`) sẽ trúng dòng từ chối của bài trước và trả về
    // ngay lập tức, biến waitForRow thành vô dụng — đúng loại bài test xanh giả.
    const rows = await waitForRow(() =>
      db.raw(`SELECT action, detail FROM audit_log WHERE actor_id = ? AND action LIKE '%confirm-met.denied'`, [stranger])
    );
    expect(rows.length, 'không tìm thấy dòng nhật ký từ chối cho confirm-met').toBeGreaterThan(0);
    expect(rows[0].detail.code).toBe('FORBIDDEN');

    // Và đơn KHÔNG đổi trạng thái.
    const { rows: jr } = await db.raw(`SELECT status FROM join_requests WHERE id = ?`, [jrId]);
    expect(jr[0].status).toBe('pending');
  });

  it('confirm-met bởi đúng người bảo lãnh ⇒ met_confirmed + nhật ký', async () => {
    const res = await supertest(app)
      .post(`/api/v1/join-requests/${jrId}/confirm-met`)
      .set('Authorization', `Bearer ${accessTokenFor(referrer)}`)
      .send({ met_on: '2026-08-01', note: 'Toi da gap mat nguoi nay tai nha van hoa xa hom mung 1.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('met_confirmed');

    const { rows } = await db.raw(
      `SELECT met_on, met_confirmed_by, met_note FROM join_requests WHERE id = ?`,
      [jrId]
    );
    expect(rows[0].met_confirmed_by).toBe(referrer);
    expect(rows[0].met_note).toContain('nha van hoa xa');

    const { rows: log } = await db.raw(
      `SELECT detail FROM audit_log WHERE action='join_request.met_confirmed' AND target_id = ?`,
      [jrId]
    );
    expect(log).toHaveLength(1);
    // Nội dung ghi chú là văn bản tự do — không được lọt vào nhật ký.
    expect(JSON.stringify(log[0].detail)).not.toContain('nha van hoa');
  });

  it('ghi chú ngắn hơn 20 ký tự bị chặn ngay ở zod', async () => {
    const res = await supertest(app)
      .post(`/api/v1/join-requests/${jrId}/confirm-met`)
      .set('Authorization', `Bearer ${accessTokenFor(referrer)}`)
      .send({ met_on: '2026-08-01', note: 'da gap' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('reject: approver ghi reason_code vào nhật ký; member thường bị chặn', async () => {
    const denied = await supertest(app)
      .post(`/api/v1/join-requests/${jrId}/reject`)
      .set('Authorization', `Bearer ${accessTokenFor(referrer)}`)
      .send({ reason_code: 'not_ready', note: 'Chua du dieu kien theo danh gia cua toi.' });
    expect(denied.status).toBe(403);

    const res = await supertest(app)
      .post(`/api/v1/join-requests/${jrId}/reject`)
      .set('Authorization', `Bearer ${accessTokenFor(approver)}`)
      .send({ reason_code: 'referrer_misrepresented', note: 'Nguoi bao lanh khai khong dung su that.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');

    const { rows } = await db.raw(
      `SELECT detail FROM audit_log WHERE action='join_request.rejected' AND target_id = ?`,
      [jrId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].detail.reason_code).toBe('referrer_misrepresented');
  });

  // Bài này ĐÃ TỪNG khẳng định approve() ném NOT_IMPLEMENTED 501 — ranh giới cố
  // ý giữa Task 8 và Task 9. Task 9 đã làm approve() thật, nên bài được SỬA chứ
  // không xoá: đơn ở đây vừa bị reject ở bài trước, và cổng của approve() phải
  // chặn nó. Nếu ai đó gỡ cổng ấy, một đơn ĐÃ BỊ TỪ CHỐI vẫn thành thành viên
  // được — đó mới là điều đáng canh ở chỗ này.
  it('approve đơn đã bị từ chối ⇒ 422, không tạo thành viên', async () => {
    const { rows: before } = await db.raw(`SELECT count(*)::int AS n FROM members WHERE community_id = ?`, [cid]);

    const res = await supertest(app)
      .post(`/api/v1/join-requests/${jrId}/approve`)
      .set('Authorization', `Bearer ${accessTokenFor(approver)}`)
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('MET_CONFIRMATION_REQUIRED');

    const { rows: after } = await db.raw(`SELECT count(*)::int AS n FROM members WHERE community_id = ?`, [cid]);
    expect(after[0].n).toBe(before[0].n);
  });
});
