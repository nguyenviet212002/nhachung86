// Trợ giúp dựng dữ liệu cho các bài test cần một LINK MỜI (migration 031, QĐ-1).
//
// Vì sao phải có tệp này: từ QĐ-1, `POST /auth/register` không nhận `referrer_id`
// nữa — nó nhận token của một đường link mà người bảo lãnh đã phát. Bài test nào
// muốn tạo một đơn gia nhập đều phải đi qua đúng con đường ấy, và dựng lại đoạn
// đó ở mỗi tệp test là ba lần chép cùng một đoạn, tức ba lần trôi dạt.
//
// Hàm ở đây dùng kết nối OWNER: chúng là phần DỰNG DỮ LIỆU, không phải phần cần
// chứng minh. Bài nào muốn chứng minh luồng phát link hoạt động thì đi qua HTTP
// — `t28-guarantee-invites.test.js` làm đúng việc đó.
import { newInviteToken, hashInviteToken } from '../../src/modules/invites/token.js';

/**
 * Phát một link mời bằng đường CSDL, trả về `{ token, id }`.
 *
 * `token` là chuỗi thô — thứ duy nhất đi trong đường link, và thứ duy nhất
 * `/auth/register` nhận. CSDL chỉ giữ băm của nó.
 */
export async function mkInvite(db, cid, referrerId, opts = {}) {
  const token = opts.token ?? newInviteToken();
  // `expiresSql` là một biểu thức SQL, không phải một Date của JavaScript: mốc
  // hết hạn phải tính bằng ĐỒNG HỒ CỦA MÁY CHỦ CSDL, cùng đồng hồ mà
  // `expires_at > now()` trong câu đếm hạn mức dùng. Lấy giờ ở phía Node rồi
  // gửi xuống là trộn hai đồng hồ, và bài test sẽ chập chờn đúng ở những mốc
  // sát nhau — chỗ duy nhất đáng kiểm.
  const expiresSql = opts.expiresSql ?? `now() + interval '14 days'`;
  const { rows: [row] } = await db.raw(
    `INSERT INTO guarantee_invites
       (community_id, referrer_id, token_hash, created_by, on_behalf_reason_code, on_behalf_reason, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ${expiresSql})
     RETURNING id, expires_at`,
    [
      cid,
      referrerId,
      hashInviteToken(token),
      opts.createdBy ?? referrerId,
      opts.onBehalfReasonCode ?? null,
      opts.onBehalfReason ?? null,
    ]
  );
  return { token, id: row.id, expiresAt: row.expires_at };
}
