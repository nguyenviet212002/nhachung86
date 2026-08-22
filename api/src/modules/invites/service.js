import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import { newInviteToken, hashInviteToken } from './token.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy đường link mời này.', { status: 404 });
const FORBIDDEN = (msg) => new AppError('FORBIDDEN', msg, { status: 403 });

function isApprover(actor) {
  return actor.roles.includes('approver');
}

// Trạng thái là thứ SUY RA từ ba cột, không phải một cột riêng. Cột riêng sẽ
// lệch khỏi ba cột kia ngay lần đầu có ai quên cập nhật nó, và khi đó câu đếm
// hạn mức (đọc ba cột) với màn hình (đọc cột trạng thái) nói hai điều khác nhau.
function inviteStatus(r, now = Date.now()) {
  if (r.used_at) return 'used';
  if (r.revoked_at) return 'revoked';
  if (new Date(r.expires_at).getTime() <= now) return 'expired';
  return 'open';
}

// TOKEN KHÔNG BAO GIỜ CÓ MẶT Ở ĐÂY. Hàng trả về cho màn "những link tôi đã
// phát" chỉ mang siêu dữ liệu; `token_hash` cũng không ra dây — nó không giúp
// người dùng việc gì mà lại là một chuỗi trông giống token đủ để lọt vào một
// ảnh chụp màn hình hay một bản sao dán vào tin nhắn.
function toRow(r) {
  return {
    id: r.id,
    referrer_id: r.referrer_id,
    created_by: r.created_by,
    created_on_behalf: r.created_by !== r.referrer_id,
    on_behalf_reason_code: r.on_behalf_reason_code,
    on_behalf_reason: r.on_behalf_reason,
    inviter_note: r.inviter_note,
    status: inviteStatus(r),
    created_at: r.created_at,
    expires_at: r.expires_at,
    used_at: r.used_at,
    used_by_join_request: r.used_by_join_request,
    revoked_at: r.revoked_at,
    revoked_reason: r.revoked_reason,
  };
}

/**
 * Phát một link mời.
 *
 * Token thô sinh ra ở đây và ra khỏi tiến trình đúng MỘT lần, trong thân phản
 * hồi. CSDL chỉ nhận băm. Không có đường nào đọc lại token: mất link thì thu
 * hồi rồi phát cái mới, đó là hành vi đúng chứ không phải một thiếu sót.
 *
 * Thứ tự trong giao dịch: INSERT trước, `audit.log` sau. Đảo lại là rơi thẳng
 * vào bẫy 1 — trigger hạn mức hoặc trigger đường-dự-phòng RAISE, ngoại lệ cuộn
 * cả giao dịch, và dòng nhật ký vừa ghi biến mất cùng nó. Ném ở đây an toàn vì
 * tới lúc đó giao dịch chưa ghi được gì; dòng "từ chối" do errorHandler ghi
 * bằng một giao dịch RIÊNG mở sau khi giao dịch này đã cuộn xong.
 */
export async function create({ actor, inviterNote, referrerId, onBehalfReasonCode, onBehalfReason }) {
  const target = referrerId ?? actor.id;
  const onBehalf = target !== actor.id;
  const token = newInviteToken();

  const row = await withActor(actor.id, async (trx) => {
    const { rows: [inv] } = await trx.raw(
      `INSERT INTO guarantee_invites
         (community_id, referrer_id, token_hash, created_by, on_behalf_reason_code,
          on_behalf_reason, inviter_note)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        actor.communityId,
        target,
        hashInviteToken(token),
        actor.id,
        onBehalf ? (onBehalfReasonCode ?? null) : null,
        onBehalf ? (onBehalfReason ?? null) : null,
        inviterNote,
      ]
    );

    // HAI TÊN HÀNH ĐỘNG KHÁC NHAU, không phải một tên kèm một cờ. Người dùng
    // nói thẳng: nếu hai trường hợp trông giống hệt nhau trong nhật ký thì
    // đường vòng VẪN LÀ cửa sau im lặng, chỉ khác là có ghi chép. Ai lọc nhật
    // ký theo `action` — cách lọc tự nhiên nhất — phải thấy ngay đường vòng.
    //
    // Nội dung lý do KHÔNG vào `detail`: nó là văn bản tự do, đúng loại dữ liệu
    // mà luật mục 10 cấm (và `assertSafeDetail` sẽ từ chối). Lý do đầy đủ nằm
    // trong chính hàng mà `target_id` trỏ tới, còn nhật ký giữ MÃ lý do — một
    // enum, tra được, đếm được, và đủ để trả lời "vì sao" khi soát lại.
    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: onBehalf ? 'guarantee_invite.created_on_behalf' : 'guarantee_invite.created',
      targetType: 'guarantee_invite',
      targetId: inv.id,
      detail: onBehalf
        ? {
            on_behalf_of: target,
            referrer_id: target,
            reason_code: onBehalfReasonCode ?? null,
            reason_length: (onBehalfReason ?? '').length,
            note_length: inviterNote.length,
          }
        : { referrer_id: target, note_length: inviterNote.length },
    });

    return inv;
  });

  return { ...toRow(row), token };
}

/** Những link của một người. Mặc định là của chính người đang hỏi. */
export async function list({ actor, referrerId, page, limit }) {
  const target = referrerId ?? actor.id;
  if (target !== actor.id && !isApprover(actor)) {
    throw FORBIDDEN('Chỉ ban duyệt mới xem được link mời của người khác.');
  }

  return withActor(actor.id, async (trx) => {
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT * FROM guarantee_invites
        WHERE community_id = ? AND referrer_id = ?
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [actor.communityId, target, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(
      `SELECT count(*)::int AS total FROM guarantee_invites WHERE community_id = ? AND referrer_id = ?`,
      [actor.communityId, target]
    );

    // Một dòng cho cả trang, cùng quy ước với join_request.list.
    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'guarantee_invite.list',
      detail: { count: rows.length, referrer_id: target, page },
    });

    return { data: rows.map(toRow), meta: { page, limit, total } };
  });
}

/**
 * Thu hồi — điểm 3 của QĐ-1. Suất trả lại NGAY, và không phải vì mã ở đây làm
 * gì cả: `fn_guarantee_slots_used` loại link có `revoked_at` ra khỏi câu đếm,
 * nên suất về đúng lúc câu UPDATE này commit.
 *
 * Không kiểm "link còn thu hồi được không" ở đây bằng một câu SELECT rồi mới
 * UPDATE: hai câu là hai thời điểm, và giữa chúng có chỗ cho một người khác
 * dùng link. Cứ UPDATE, để `trg_guarantee_invite_frozen` trả lời — nó chạy
 * TRONG câu lệnh, không có khe nào ở giữa.
 */
export async function revoke({ actor, id, reason }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [r] } = await trx.raw(
      `SELECT * FROM guarantee_invites WHERE id = ? AND community_id = ?`,
      [id, actor.communityId]
    );
    if (!r) throw NOT_FOUND();
    // Người bảo lãnh của chính link đó, hoặc ban duyệt. Vế thứ nhất phụ thuộc
    // dữ liệu của hàng nên không kiểm được ở middleware.
    if (r.referrer_id !== actor.id && !isApprover(actor)) {
      throw FORBIDDEN('Chỉ người bảo lãnh của link này và ban duyệt mới thu hồi được.');
    }

    const { rows: [updated] } = await trx.raw(
      `UPDATE guarantee_invites SET revoked_at = now(), revoked_reason = ?
        WHERE id = ? AND community_id = ? RETURNING *`,
      [reason, id, actor.communityId]
    );

    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'guarantee_invite.revoked',
      targetType: 'guarantee_invite',
      targetId: id,
      detail: { referrer_id: r.referrer_id, reason_length: reason.length },
    });

    return toRow(updated);
  });
}
