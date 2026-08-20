import { communities, logJob } from './lib.js';

/**
 * 03:15 hằng đêm — tính lại `member_trust_stats` và GHI LỆCH.
 *
 * Món nợ Task 12 ("tác vụ 03:15 hằng đêm … cùng nhóm nợ khung tác vụ định kỳ").
 *
 * Vì sao vẫn cần tác vụ này khi đã có `trg_trust_touch` và `trg_trust_review`
 * cập nhật ngay lúc có xác nhận: hai trigger ấy chạy trên ĐƯỜNG GHI. Con số
 * lệch đi được bằng những đường KHÔNG đi qua chúng — một câu `psql` của người
 * vận hành, một lần khôi phục từ bản sao lưu, hay đơn giản là một trigger bị gỡ
 * mất trong một migration nào đó. Tác vụ này tính lại từ dữ liệu gốc rồi so.
 *
 * ĐIỀU QUAN TRỌNG NHẤT: nó ghi lại SỐ NGƯỜI CÓ CON SỐ LỆCH. Nếu con số ấy khác
 * 0 vào một đêm bình thường thì có ai đó, hoặc cái gì đó, đang sửa uy tín
 * ngoài đường ghi — và đó là thứ đáng nhìn hơn cả bản thân việc tính lại.
 * `fn_trust_recount` là nguồn sự thật duy nhất; tệp này KHÔNG có một câu đếm
 * việc nào của riêng nó.
 */
export const key = 'trust.recount';
export const schedule = { hour: 3, minute: 15 };

export async function run(trx) {
  const out = { members: 0, drifted: 0 };

  for (const cid of await communities(trx)) {
    await trx.raw(
      `CREATE TEMP TABLE trust_before ON COMMIT DROP AS
         SELECT member_id, confirmed_works, manual_works, distinct_requesters, repeat_requesters
           FROM member_trust_stats WHERE community_id = ?`,
      [cid]
    );

    const { rows: members } = await trx.raw(
      `SELECT id FROM members WHERE community_id = ? AND status <> 'left' ORDER BY id`, [cid]
    );
    for (const m of members) await trx.raw(`SELECT fn_trust_recount(?)`, [m.id]);

    const { rows: [d] } = await trx.raw(
      `SELECT count(*)::int AS n FROM member_trust_stats s
         LEFT JOIN trust_before b ON b.member_id = s.member_id
        WHERE s.community_id = ?
          AND (b.member_id IS NULL
            OR (s.confirmed_works, s.manual_works, s.distinct_requesters, s.repeat_requesters)
               IS DISTINCT FROM
               (b.confirmed_works, b.manual_works, b.distinct_requesters, b.repeat_requesters))`,
      [cid]
    );

    // `DROP` tường minh: `ON COMMIT DROP` chỉ chạy lúc COMMIT, mà vòng lặp này
    // có thể qua nhiều cộng đồng trong CÙNG một giao dịch — cộng đồng thứ hai
    // sẽ gặp một bảng tạm đã tồn tại.
    await trx.raw(`DROP TABLE trust_before`);

    out.members += members.length;
    out.drifted += d.n;

    await logJob(trx, {
      communityId: cid,
      action: 'job.trust_recount',
      detail: { members: members.length, drifted: d.n },
    });
  }
  return out;
}
