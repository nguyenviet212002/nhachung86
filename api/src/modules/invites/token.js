import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Token của link mời — chuỗi ngẫu nhiên 256 bit, base64url (43 ký tự).
//
// Vì sao sha256 chứ không argon2: token KHÔNG phải mật khẩu người gõ. Nó có
// 256 bit entropy thật từ CSPRNG, nên không có gì để dò — hàm băm chậm chỉ làm
// mỗi lần nhận link tốn thêm vài trăm mili-giây mà không mua thêm được bit an
// toàn nào. Cùng lập luận đã ghi ở `hashToken` của refresh token
// (modules/auth/service.js).
//
// Vì sao KHÔNG trộn pepper: `token_hash` là khoá tra cứu UNIQUE ở CSDL, và
// migration 031 ép hình dạng `^[0-9a-f]{64}$` ngay tại cột. Trộn pepper sẽ
// khiến mọi link đã phát chết theo lần xoay pepper — mà pepper là thứ được
// phép xoay. Băm không pepper vẫn đủ: kể cả người đọc được cả bảng cũng không
// dựng lại được token từ băm.
// ---------------------------------------------------------------------------
export function newInviteToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashInviteToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
