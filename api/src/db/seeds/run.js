import crypto from 'node:crypto';
import argon2 from 'argon2';
import { seedKnex } from './db.js';
import { id } from './ids.js';
import { upsert, insertOnce, actAs } from './helpers.js';
import { COMMUNITY_ID, COMMUNITY_CODE, CONFIG, AREAS } from './data/community.js';
import { MEMBERS, JOIN_REQUESTS, EXTRA_REQUESTS, ROLE_GRANTS, byCode } from './data/tree.js';
import { ALL_WORKS, CAPABILITIES } from './data/works.js';
import { SIGNALS, JOB_NEEDS, AID_REQUESTS, ACTIVITIES, FUND_ENTRIES, LOANS } from './data/life.js';

// ---------------------------------------------------------------------------
// Dữ liệu mẫu — đặc tả mục 12, kế hoạch Task 17.
//
// BA LUẬT CỦA TỆP NÀY, viết ra vì cả ba đều dễ bị "sửa cho tiện" về sau:
//
//  1. KHÔNG MỘT ID NGẪU NHIÊN NÀO. Mọi id đi qua `ids.js` (UUIDv5 tất định).
//     Đó là toàn bộ lý do `npm run seed` chạy lại được nhiều lần.
//
//  2. `audit_log` SINH BẰNG `INSERT` THƯỜNG. Chuỗi băm do `fn_audit_chain` tự
//     dựng. Không có một giá trị `hash`/`prev_hash` nào trong thư mục này —
//     một chuỗi băm chép tay là chuỗi băm không kiểm được gì, và bài test T22
//     khẳng định chuỗi của dữ liệu mẫu liên mạch bằng chính `verifyChain()`.
//
//  3. MỌI LỆNH GHI ĐI ĐÚNG CON ĐƯỜNG NGƯỜI THẬT ĐI. Không `DISABLE TRIGGER`,
//     không `session_replication_role`, không `COPY` bỏ qua trigger, không
//     `INSERT` thẳng vào `member_contacts`. Số điện thoại đi qua
//     `contact_upsert`; hộp liên hệ, tám mức riêng tư và cạnh bảo lãnh do
//     `trg_member_bootstrap` sinh; đổi chính sách đi qua khung hai người ký.
//     Cái giá phải trả là seed phải đóng dấu `app.actor_id` đúng người trước
//     mỗi lệnh ghi — `fn_self_only` đòi thế. Cái được là: nếu một ràng buộc
//     nào đó bị gỡ mất, seed sẽ vẫn chạy nhưng bộ kiểm thử đỏ; còn nếu seed đi
//     đường vòng thì cả hai đều xanh và không ai biết gì.
//
// TOÀN BỘ SEED CHẠY TRONG MỘT GIAO DỊCH. Không phải để nhanh: `trg_member_
// status_gate` và `trg_fund_two_approvers` là constraint trigger hoãn tới
// COMMIT, nên "thành viên" và "đơn gia nhập của người ấy", "bút toán lớn" và
// "hai chữ ký của nó" phải cùng có mặt lúc COMMIT. Một giao dịch cũng có nghĩa
// là seed hỏng giữa chừng thì không để lại nửa cộng đồng.
// ---------------------------------------------------------------------------

const MEMBER_COLS = [
  'id', 'community_id', 'full_name', 'birth_year', 'email', 'job', 'area_id',
  'status', 'work_status', 'joined_at', 'referrer_id', 'created_at',
];

/** Băm mật khẩu dùng chung của mọi tài khoản mẫu. Đọc từ môi trường, không viết cứng. */
function seedPassword() {
  const p = process.env.SEED_PASSWORD;
  if (!p || p.length < 12) {
    throw new Error(
      'Thiếu SEED_PASSWORD (tối thiểu 12 ký tự). Dữ liệu mẫu tạo 52 tài khoản đăng nhập được, ' +
      'nên mật khẩu của chúng là một bí mật của lần triển khai này — đặt trong .env, không viết cứng trong mã.'
    );
  }
  return p;
}

/** JSON chuẩn hoá theo khoá, để cùng một cấu hình luôn ra cùng một băm. */
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v ?? null);
}
const payloadHash = (p) => crypto.createHash('sha256').update(canonical(p)).digest('hex');

// ---------------------------------------------------------------------------

async function seedCommunity(trx, stat) {
  // Cộng đồng và khu vực: hai thứ có trước mọi con người, nên không có ai để
  // đóng dấu. `fn_acting_member` mở sẵn đúng nhánh này cho chủ sở hữu.
  await actAs(trx, null);
  stat.communities += await insertOnce(
    trx, 'communities', ['id', 'code', 'name', 'config'],
    [{ id: COMMUNITY_ID, code: COMMUNITY_CODE, name: 'Nhà Chung Bính Dần 1986', config: JSON.stringify(CONFIG) }]
  );
  stat.areas += await upsert(
    trx, 'areas', ['id', 'community_id', 'name', 'lat', 'lng', 'is_active'], AREAS,
    { update: ['name', 'lat', 'lng', 'is_active'] }
  );
}

async function seedMembers(trx, stat) {
  await actAs(trx, null);

  // Băm argon2 chỉ tính cho những người CHƯA có hàng — nó cố ý chậm, và tính
  // lại 52 lần ở mỗi lần chạy seed là ba giây vứt đi. Băm cũ giữ nguyên, nên
  // mật khẩu của một cộng đồng đang chạy không bị seed đổi sau lưng.
  const { rows: existing } = await trx.raw(
    `SELECT id FROM members WHERE community_id = ?`, [COMMUNITY_ID]
  );
  const have = new Set(existing.map((r) => r.id));
  const password = have.size >= MEMBERS.length ? null : seedPassword();

  for (const m of MEMBERS) {
    // Thứ tự trong MEMBERS là cha trước con, nên `referrer_id` luôn trỏ tới
    // một hàng đã có mặt.
    const row = {
      ...m, status: 'member', work_status: 'available', created_at: m.joined_at,
    };
    if (have.has(m.id)) {
      stat.members += await upsert(trx, 'members', MEMBER_COLS, [row], {
        // `password_hash` KHÔNG nằm trong danh sách cập nhật: xem trên.
        update: ['full_name', 'birth_year', 'email', 'job', 'area_id', 'work_status', 'joined_at'],
      });
    } else {
      const hash = await argon2.hash(password);
      await trx.raw(
        `INSERT INTO members (${MEMBER_COLS.join(', ')}, password_hash)
         VALUES (${MEMBER_COLS.map(() => '?').join(', ')}, ?)`,
        [...MEMBER_COLS.map((c) => row[c] ?? null), hash]
      );
      stat.members += 1;
    }
  }
}

/**
 * Vai — một câu riêng vì `role_id` phải tra từ bảng `roles` (hằng số của nền
 * tảng, do migration gieo).
 *
 * `fn_member_role_guard` (migration 029) cấm mọi người tự gán vai cho chính
 * mình, kể cả vai `tech` — nên KHÔNG có con đường nào để một thành viên gán
 * vai `tech` ĐẦU TIÊN của cộng đồng. Đó là nghịch lý khởi tạo, không phải lỗ
 * hổng: hàm ấy mở đúng một nhánh cho chủ sở hữu (`v_actor IS NULL`), và đây là
 * chỗ dùng nhánh đó. Từ hàng vai đầu tiên trở đi, mọi thay đổi vai phải do một
 * người mang vai `tech` thực hiện, qua đúng cửa mà migration 029 canh.
 */
async function seedRoles(trx, stat) {
  await actAs(trx, null);
  for (const [c, key] of ROLE_GRANTS) {
    const res = await trx.raw(
      `INSERT INTO member_roles (member_id, role_id, community_id)
       SELECT ?, r.id, ? FROM roles r
        WHERE r.key = ?
          AND NOT EXISTS (SELECT 1 FROM member_roles mr
                           WHERE mr.member_id = ? AND mr.role_id = r.id)`,
      [byCode[c].id, COMMUNITY_ID, key, byCode[c].id]
    );
    stat.member_roles += res.rowCount ?? 0;
  }
}

const JR_COLS = [
  'id', 'community_id', 'applicant_data', 'referrer_id', 'member_id', 'step', 'status',
  'met_on', 'met_confirmed_at', 'met_confirmed_by', 'approved_by', 'reject_reason_code', 'created_at',
];

async function seedJoinRequests(trx, stat) {
  // Người bảo lãnh là người khai "tôi đã gặp người này", nên dấu người thực
  // hiện của mỗi đơn là chính người bảo lãnh — không phải một tài khoản chung.
  const rows = [...JOIN_REQUESTS, ...EXTRA_REQUESTS];
  for (const r of rows) {
    await actAs(trx, r.referrer_id);
    stat.join_requests += await upsert(trx, 'join_requests', JR_COLS, [{
      id: r.id,
      community_id: r.community_id,
      applicant_data: JSON.stringify(r.applicant),
      referrer_id: r.referrer_id,
      member_id: r.member_id ?? null,
      step: r.step,
      status: r.status,
      met_on: r.met_at ? r.met_at.slice(0, 10) : null,
      met_confirmed_at: r.met_at,
      met_confirmed_by: r.met_at ? r.referrer_id : null,
      approved_by: r.approved_by ?? null,
      reject_reason_code: r.reject ?? null,
      created_at: r.created_at,
    }], {
      // `community_id`, `referrer_id`, `created_at` KHÔNG cập nhật lại:
      // `fn_join_request_frozen` đóng băng đúng ba cột đó vì hạn mức bảo lãnh
      // đọc chúng. Ghi lại cùng giá trị vẫn hợp lệ, nhưng không ghi thì không
      // phải tin vào chuyện "cùng giá trị".
      update: ['applicant_data', 'member_id', 'step', 'status', 'met_on',
               'met_confirmed_at', 'met_confirmed_by', 'approved_by'],
    });
  }

  // Bí mật đăng ký của những đơn CHƯA duyệt. Đơn đã duyệt không có hàng ở đây:
  // `join_secret_consume()` xoá nó ngay trong giao dịch duyệt, và giữ lại một
  // bản sao thô sau đó là giữ đúng thứ cả kiến trúc đang tránh (mục 10).
  //
  // Hai đơn BỊ TỪ CHỐI thì cố ý CÓ hàng: đó là dữ liệu cho tác vụ dọn dẹp ở
  // Task 18 — món nợ Task 9 để lại ("dọn join_request_secrets của đơn bị từ
  // chối cần khung tác vụ định kỳ").
  await actAs(trx, null);
  const alive = EXTRA_REQUESTS;
  stat.join_request_secrets += await insertOnce(
    trx, 'join_request_secrets',
    ['join_request_id', 'community_id', 'phone', 'password_hash'],
    alive.map((r, i) => ({
      join_request_id: r.id,
      community_id: COMMUNITY_ID,
      phone: '0901' + String(100000 + i).slice(1),
      // Băm giả, KHÔNG phải băm của một mật khẩu thật: hàng này chỉ tồn tại để
      // tác vụ dọn dẹp có việc mà làm, không ai đăng nhập bằng nó được.
      password_hash: '$argon2id$v=19$m=65536,t=3,p=4$' + 'seed'.repeat(4) + '$' + 'x'.repeat(43),
    })),
    'join_request_id'
  );
}

async function seedContacts(trx, stat) {
  // Số điện thoại KHÔNG đi thẳng vào `member_contacts` — bảng đó bị REVOKE ALL
  // và cửa duy nhất là `contact_upsert`, hàm tự kiểm quyền và tự ghi nhật ký.
  // Hàm ấy chỉ cho `approver` điền ô CÒN TRỐNG, đúng một lần; nên seed phải
  // hỏi trước xem ô đã có gì chưa, thay vì gọi rồi nuốt lỗi.
  const { rows: filled } = await trx.raw(
    `SELECT member_id FROM member_contacts WHERE community_id = ? AND phone IS NOT NULL`,
    [COMMUNITY_ID]
  );
  const have = new Set(filled.map((r) => r.member_id));
  const approver = byCode.M01.id;
  await actAs(trx, approver);
  for (const m of MEMBERS) {
    if (have.has(m.id)) continue;
    await trx.raw(`SELECT contact_upsert(?, 'phone', ?)`, [m.id, m.phone]);
    stat.contacts += 1;
  }
}

const CAP_COLS = [
  'id', 'community_id', 'member_id', 'title', 'description', 'category',
  'price', 'years_experience', 'status',
];

async function seedCapabilities(trx, stat) {
  for (const c of CAPABILITIES) {
    // Năng lực là lời tự khai của chính chủ.
    await actAs(trx, c.member_id);
    stat.capabilities += await upsert(trx, 'capabilities', CAP_COLS, [c], {
      update: ['title', 'description', 'category', 'price', 'years_experience', 'status'],
    });
  }
}

const WR_COLS = ['id', 'community_id', 'source_type', 'source_id', 'title', 'done_on', 'created_by', 'created_at'];

async function seedWorks(trx, stat) {
  for (const w of ALL_WORKS) {
    await actAs(trx, w.created_by);
    stat.work_records += await upsert(
      trx, 'work_records', WR_COLS,
      [{ ...w, created_at: w.done_on + 'T03:00:00Z' }],
      // `reviewed_by`/`reviewed_at` KHÔNG nằm ở đây: `fn_work_review_gate` từ
      // chối một bản ghi `manual` sinh ra đã duyệt sẵn. Việc phải xảy ra trước
      // khi có người duyệt nó — bước duyệt là câu UPDATE riêng bên dưới.
      { update: ['title', 'done_on'] }
    );

    stat.work_participants += await insertOnce(
      trx, 'work_participants', ['id', 'community_id', 'work_record_id', 'member_id', 'role'],
      w.participants.map(([memberId, role]) => ({
        id: id('work_participant:' + w.id + ':' + memberId),
        community_id: w.community_id,
        work_record_id: w.id,
        member_id: memberId,
        role,
      }))
    );

    for (const memberId of w.confirmers) {
      // `fn_self_only`: không ai xác nhận hộ người khác. Dấu người thực hiện
      // phải là chính người ký, từng người một.
      await actAs(trx, memberId);
      stat.work_confirmations += await insertOnce(
        trx, 'work_confirmations', ['id', 'community_id', 'work_record_id', 'member_id', 'confirmed_at'],
        [{
          id: id('work_confirmation:' + w.id + ':' + memberId),
          community_id: w.community_id,
          work_record_id: w.id,
          member_id: memberId,
          confirmed_at: w.done_on + 'T10:00:00Z',
        }]
      );
    }

    if (w.review) {
      await actAs(trx, w.review.by);
      const res = await trx.raw(
        `UPDATE work_records SET reviewed_by = ?, reviewed_at = ?
          WHERE id = ? AND community_id = ? AND reviewed_at IS DISTINCT FROM ?::timestamptz`,
        [w.review.by, w.review.at, w.id, w.community_id, w.review.at]
      );
      stat.work_reviews += res.rowCount ?? 0;
    }
  }
}

const SIG_COLS = [
  'id', 'community_id', 'code', 'created_by', 'type', 'title', 'body',
  'area_id', 'urgent', 'ask', 'respond_by', 'status',
];

async function seedSignals(trx, stat) {
  for (const s of SIGNALS) {
    await actAs(trx, s.created_by);
    stat.signals += await upsert(trx, 'signals', SIG_COLS, [s], {
      update: ['title', 'body', 'area_id', 'urgent', 'ask', 'respond_by', 'status'],
    });
    // Người nhận: ba người cùng khu vực với tín hiệu, đủ để màn tín hiệu có
    // dữ liệu thật mà không phải bắn cho cả 52 người.
    stat.signal_recipients += await insertOnce(
      trx, 'signal_recipients', ['id', 'community_id', 'signal_id', 'member_id', 'reason'],
      MEMBERS.filter((m) => m.area_id === s.area_id && m.id !== s.created_by).slice(0, 3).map((m) => ({
        id: id('signal_recipient:' + s.id + ':' + m.id),
        community_id: s.community_id,
        signal_id: s.id,
        member_id: m.id,
        reason: 'cùng khu vực với tín hiệu',
      }))
    );
  }
}

const JN_COLS = [
  'id', 'community_id', 'poster_id', 'title', 'description', 'terms',
  'area_id', 'job_type', 'status',
];

async function seedJobsAndAid(trx, stat) {
  for (const j of JOB_NEEDS) {
    await actAs(trx, j.poster_id);
    stat.job_needs += await upsert(trx, 'job_needs', JN_COLS, [j], {
      update: ['title', 'description', 'terms', 'area_id', 'job_type', 'status'],
    });
  }

  for (const a of AID_REQUESTS) {
    await actAs(trx, a.requester_id);
    stat.aid_requests += await upsert(
      trx, 'aid_requests',
      ['id', 'community_id', 'requester_id', 'title', 'description', 'area_id', 'urgency', 'status'],
      [a], { update: ['title', 'description', 'area_id', 'urgency', 'status'] }
    );
    for (const s of a.slots) {
      stat.aid_slots += await upsert(
        trx, 'aid_slots', ['id', 'community_id', 'aid_request_id', 'title', 'needed'],
        [s], { update: ['title', 'needed'] }
      );
      for (const taker of s.takers) {
        // `trg_ast_1_self_only`: người nhận suất phải là chính người đang đăng
        // nhập, không phải người đăng yêu cầu.
        await actAs(trx, taker);
        stat.aid_slot_takers += await insertOnce(
          trx, 'aid_slot_takers', ['id', 'community_id', 'slot_id', 'member_id'],
          [{ id: id('aid_slot_taker:' + s.id + ':' + taker), community_id: s.community_id, slot_id: s.id, member_id: taker }]
        );
      }
    }
  }
}

const ACT_COLS = [
  'id', 'community_id', 'title', 'description', 'area_id', 'category',
  'starts_at', 'ends_at', 'uses_fund', 'status', 'created_by',
];

async function seedActivities(trx, stat) {
  for (const a of ACTIVITIES) {
    await actAs(trx, a.created_by);
    stat.activities += await upsert(trx, 'activities', ACT_COLS, [a], {
      update: ['title', 'description', 'area_id', 'category', 'starts_at', 'ends_at', 'status'],
    });
    // Bản tổng kết ghi NGAY sau hoạt động của nó, trước khi hoạt động dùng quỹ
    // tiếp theo ra đời — xem chú thích ở `data/life.js`.
    if (a.summary) {
      stat.activity_summaries += await insertOnce(
        trx, 'activity_summaries',
        ['id', 'community_id', 'activity_id', 'body', 'total_spent', 'submitted_by', 'submitted_at'],
        [{
          id: a.summary_id, community_id: a.community_id, activity_id: a.id,
          body: a.summary.body, total_spent: a.summary.total_spent,
          submitted_by: a.created_by, submitted_at: a.ends_at,
        }]
      );
    }
  }
}

async function seedFund(trx, stat) {
  for (const e of FUND_ENTRIES) {
    await actAs(trx, e.created_by);
    // Bút toán ra đời CHƯA khoá, kể cả hai cái sẽ khoá: `fn_fund_sig_guard`
    // từ chối thêm chữ ký vào một bút toán đã khoá ("sổ đã chốt thì không ký
    // thêm"), nên thứ tự bắt buộc là ghi → ký → khoá. Ghi thẳng `locked=true`
    // rồi mới ký là seed đỏ ở lệnh COMMIT, và đỏ đúng lý do.
    stat.fund_entries += await insertOnce(
      trx, 'fund_entries',
      ['id', 'community_id', 'amount', 'purpose', 'occurred_on', 'activity_id', 'locked', 'created_by'],
      [{ ...e, locked: false }]
    );
    for (const signer of e.signers) {
      // Chữ ký là bút toán (mục 4.8): ghi được, không sửa được, không gỡ được.
      // `role_at_sign` KHÔNG truyền lên — `fn_fund_sig_role_snapshot` gán đè,
      // vì một ô vai do người ghi tự khai thì không chứng minh được gì.
      await actAs(trx, signer);
      stat.fund_entry_approvals += await insertOnce(
        trx, 'fund_entry_approvals', ['entry_id', 'approver_id', 'community_id'],
        [{ entry_id: e.id, approver_id: signer, community_id: e.community_id }],
        ['entry_id', 'approver_id']
      );
    }
  }

  for (const l of LOANS) {
    await actAs(trx, l.borrower_id);
    stat.loans += await insertOnce(
      trx, 'loans',
      ['id', 'community_id', 'borrower_id', 'amount', 'purpose', 'status', 'due_on', 'disbursed_on'],
      [l]
    );
    // `bank_account_enc` / `id_number_enc` để TRỐNG, cố ý: giai đoạn 1 chưa có
    // mô-đun mã hoá theo chủ thể (mục 10, tầng 2 — `subject_keys` có bảng
    // nhưng chưa có ai bọc/mở khoá). Gieo một chuỗi bytea giả vào hai cột ấy
    // sẽ trông như đã mã hoá trong khi không có khoá nào tồn tại, tức là dựng
    // sẵn một lời hứa sai cho người đọc dữ liệu sau này.
    for (const g of l.guarantor_ids) {
      await actAs(trx, g);
      stat.loan_guarantors += await insertOnce(
        trx, 'loan_guarantors', ['id', 'community_id', 'loan_id', 'member_id'],
        [{ id: id('loan_guarantor:' + l.id + ':' + g), community_id: l.community_id, loan_id: l.id, member_id: g }]
      );
    }
  }
}

/**
 * Khoá sổ hai bút toán lớn — GIAO DỊCH RIÊNG, SAU giao dịch chính.
 *
 * Đây là một tính chất của lược đồ mà tôi tìm ra bằng cách chạy thật, và nó
 * đáng ghi lại: `trg_fund_sig_guard` là constraint trigger HOÃN TỚI COMMIT,
 * nhưng câu kiểm "không thêm chữ ký vào bút toán đã khoá" của nó đọc trạng
 * thái `locked` tại thời điểm COMMIT chứ không phải tại thời điểm ghi chữ ký.
 * Hệ quả: ký rồi khoá TRONG CÙNG MỘT giao dịch bị từ chối (`FUND_ENTRY_LOCKED`
 * ở lệnh COMMIT), dù thứ tự ấy hoàn toàn hợp lệ về nghiệp vụ — sổ chỉ chốt
 * được sau khi đã đủ chữ ký.
 *
 * Không "sửa cho tiện" bằng cách bỏ khoá sổ hay bỏ chữ ký. Cách đúng là làm
 * đúng hai bước như đời thật: ký xong, đóng sổ ở một lần sau.
 */
async function lockFundEntries(knex, stat) {
  const toLock = FUND_ENTRIES.filter((e) => e.locked);
  if (!toLock.length) return;
  await knex.transaction(async (trx) => {
    for (const e of toLock) {
      // `AND locked = false` chứ không chỉ `id = ?`: lần chạy thứ hai gặp một
      // bút toán ĐÃ khoá, và `trg_fund_entry_locked` chặn mọi UPDATE lên nó —
      // kể cả câu UPDATE đặt lại đúng giá trị đang có.
      await actAs(trx, e.created_by);
      const res = await trx.raw(
        `UPDATE fund_entries SET locked = true WHERE id = ? AND community_id = ? AND locked = false`,
        [e.id, e.community_id]
      );
      stat.fund_locks += res.rowCount ?? 0;
    }
  });
}

/**
 * Chính sách của cộng đồng chỉ đổi được qua KHUNG HAI NGƯỜI KÝ (migration 028).
 *
 * Lần chạy đầu, `communities.config` sinh ra cùng lúc với hàng `communities`
 * nên không có gì để đổi. Hàm này lo trường hợp về sau: ai đó sửa `CONFIG`
 * trong mã nguồn rồi chạy lại seed. Câu `UPDATE communities SET config = …`
 * trần sẽ bị `trg_community_config_guard` ném `CONFIG_CHANGE_UNSIGNED`, và
 * đúng như vậy — nên seed đi con đường mà một người thật phải đi: một hành
 * động `community.config_change`, hai chữ ký của hai `approver` khác nhau, rồi
 * `fn_community_config_apply` do CHÍNH một trong hai người ký ấy gọi.
 */
async function ensureConfig(trx, stat) {
  const { rows: [cur] } = await trx.raw(`SELECT config FROM communities WHERE id = ?`, [COMMUNITY_ID]);
  if (canonical(cur.config) === canonical(CONFIG)) return;

  const hash = payloadHash({ config: CONFIG });
  const actionId = id('pending_action:config:' + hash);
  const first = byCode.M01.id;
  const second = byCode.M02.id;

  await actAs(trx, first);
  await insertOnce(
    trx, 'pending_actions',
    ['id', 'community_id', 'action_key', 'target_type', 'target_id', 'payload', 'payload_hash', 'created_by'],
    [{
      id: actionId, community_id: COMMUNITY_ID, action_key: 'community.config_change',
      target_type: 'community', target_id: COMMUNITY_ID,
      payload: JSON.stringify({ config: CONFIG }), payload_hash: hash, created_by: first,
    }]
  );
  for (const signer of [first, second]) {
    await actAs(trx, signer);
    await insertOnce(
      trx, 'pending_action_signatures',
      ['pending_action_id', 'signer_id', 'community_id', 'payload_hash_at_sign'],
      [{ pending_action_id: actionId, signer_id: signer, community_id: COMMUNITY_ID, payload_hash_at_sign: hash }],
      ['pending_action_id', 'signer_id']
    );
  }
  // Người THI HÀNH phải là một trong những người đã ký (`EXECUTOR_NOT_SIGNER`).
  await actAs(trx, first);
  await trx.raw(`SELECT fn_community_config_apply(?)`, [actionId]);
  await trx.raw(
    `UPDATE pending_actions SET status = 'executed', executed_at = now(), result = ?::jsonb WHERE id = ?`,
    [JSON.stringify({ applied: true }), actionId]
  );
  stat.config_changes += 1;
}

// ---------------------------------------------------------------------------

const EMPTY_STAT = () => ({
  communities: 0, areas: 0, members: 0, member_roles: 0, join_requests: 0,
  join_request_secrets: 0, contacts: 0, capabilities: 0, work_records: 0,
  work_participants: 0, work_confirmations: 0, work_reviews: 0, signals: 0,
  signal_recipients: 0, job_needs: 0, aid_requests: 0, aid_slots: 0,
  aid_slot_takers: 0, activities: 0, activity_summaries: 0, fund_entries: 0,
  fund_entry_approvals: 0, fund_locks: 0, loans: 0, loan_guarantors: 0, config_changes: 0,
});

/**
 * Gieo dữ liệu mẫu. Trả về số hàng THẬT SỰ được ghi ở lần chạy này — lần chạy
 * thứ hai trên cùng một cơ sở dữ liệu phải trả về toàn số 0.
 */
export async function runSeed(db) {
  const own = !db;
  const knex = db ?? seedKnex();
  const stat = EMPTY_STAT();
  try {
    await knex.transaction(async (trx) => {
      await seedCommunity(trx, stat);
      await seedMembers(trx, stat);
      await seedRoles(trx, stat);
      await seedJoinRequests(trx, stat);
      await seedContacts(trx, stat);
      await seedCapabilities(trx, stat);
      await seedWorks(trx, stat);
      await seedSignals(trx, stat);
      await seedJobsAndAid(trx, stat);
      await seedActivities(trx, stat);
      await seedFund(trx, stat);
      await ensureConfig(trx, stat);

      const changed = Object.values(stat).reduce((a, b) => a + b, 0);
      if (changed > 0) {
        // MỘT dòng nhật ký cho cả lần gieo, và chỉ khi có gì đó thật sự đổi —
        // nếu ghi vô điều kiện thì `audit_log` là bảng duy nhất lớn lên sau
        // mỗi lần chạy, tức seed không còn chạy lại được nhiều lần.
        //
        // `detail` chỉ có SỐ ĐẾM: đúng luật mục 10 (nhật ký không bao giờ chứa
        // giá trị cá nhân), và chuỗi băm do `fn_audit_chain` tự dựng — dòng này
        // không mang theo một giá trị `hash` nào.
        await actAs(trx, byCode.M01.id);
        await trx.raw(
          `INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
           VALUES (?, ?, 'seed.applied', 'community', ?, ?::jsonb)`,
          [COMMUNITY_ID, byCode.M01.id, COMMUNITY_ID, JSON.stringify({
            members: stat.members, work_records: stat.work_records, capabilities: stat.capabilities,
          })]
        );
        stat.audit = 1;
      }
    });
    await lockFundEntries(knex, stat);
    return stat;
  } finally {
    if (own) await knex.destroy();
  }
}

// `node src/db/seeds/run.js` — cùng đường mà `npm run seed` đi.
const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/db/seeds/run.js');
if (invokedDirectly) {
  runSeed()
    .then((stat) => {
      const changed = Object.entries(stat).filter(([, n]) => n > 0);
      if (!changed.length) console.log('Dữ liệu mẫu đã đầy đủ, không có gì để ghi thêm.');
      else console.log('Đã gieo dữ liệu mẫu:', Object.fromEntries(changed));
      process.exit(0);
    })
    .catch((err) => {
      console.error('Gieo dữ liệu mẫu thất bại:', err.message);
      process.exit(1);
    });
}
