/* ============================================================================
 * web/js/auth.js — màn đăng nhập, phiên, bảo vệ route chưa đăng nhập.
 *
 * KHÔNG CÓ OTP Ở ĐÂY. api/src/modules/auth/schema.js: otpRequestSchema.purpose
 * chỉ nhận 'register' | 'reset' — không có 'login'. service.js nói thẳng
 * bằng chú thích: OTP chỉ xác minh số điện thoại lúc nộp đơn gia nhập và lúc
 * đặt lại mật khẩu, KHÔNG dùng để đăng nhập. Màn đăng nhập chỉ có một khung:
 * số điện thoại/email + mật khẩu, gọi thẳng POST /auth/login.
 *
 * Cùng phong cách với router.js/ui.js: hàm toàn cục thẳng, không bọc IIFE —
 * khác api.js (lớp mạng, gói riêng thành window.api) vì tệp này là hành vi
 * trang, không phải một lớp dữ liệu độc lập.
 * ========================================================================== */

function loginWithPassword(identifier, password) {
  return api.post('/auth/login', { identifier: identifier, password: password });
}

function renderLogin() {
  return `<div style="min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--soft)">
   <div class="bx" style="width:100%;max-width:380px;background:#fff">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px">
     <div class="mk">86</div>
     <div><b style="font-size:16px">Nhà Chung 86</b><div style="font-size:12px;color:var(--fnt)">BÍNH DẦN 1986</div></div>
    </div>
    <h1 style="font-size:20px">Đăng nhập</h1>
    <div class="sub" style="margin-bottom:20px">Vào Hội bằng số điện thoại hoặc email đã đăng ký.</div>
    <form id="loginForm" onsubmit="return onLoginSubmit(event)">
     <div class="fd" id="fdIdentifier">
      <label>Số điện thoại hoặc email</label>
      <input class="in" id="loginIdentifier" autocomplete="username" placeholder="09xxxxxxxx hoặc email">
      <div class="err">Nhập số điện thoại hoặc email.</div>
     </div>
     <div class="fd" id="fdPassword">
      <label>Mật khẩu</label>
      <input class="in" id="loginPassword" type="password" autocomplete="current-password" placeholder="Mật khẩu">
      <div class="err">Nhập mật khẩu.</div>
     </div>
     <div id="loginError" style="display:none;font-size:13px;color:var(--rd);background:var(--rd-s);border-radius:9px;padding:10px 12px;margin-bottom:14px"></div>
     <button class="bt p f" type="submit" id="loginSubmitBtn">Đăng nhập</button>
    </form>
   </div>
  </div>`;
}

function onLoginSubmit(ev) {
  ev.preventDefault();

  var fdId = document.getElementById('fdIdentifier');
  var fdPw = document.getElementById('fdPassword');
  var identifier = document.getElementById('loginIdentifier').value.trim();
  var password = document.getElementById('loginPassword').value;
  var errBox = document.getElementById('loginError');

  fdId.classList.remove('bad');
  fdPw.classList.remove('bad');
  errBox.style.display = 'none';
  errBox.textContent = '';

  var bad = false;
  if (!identifier) { fdId.classList.add('bad'); bad = true; }
  if (!password) { fdPw.classList.add('bad'); bad = true; }
  if (bad) return false;

  var btn = document.getElementById('loginSubmitBtn');
  var label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Đang đăng nhập...';

  loginWithPassword(identifier, password).then(function (result) {
    api.setTokens(result);
    var next = S.afterLogin || { route: 'viec', id: null };
    S.afterLogin = null;
    go(next.route, next.id); // go() thẳng, không guardedGo() — token vừa lưu.
  }).catch(function (err) {
    // INVALID_CREDENTIALS (một câu chung cho mọi lý do sai — đúng ý thiết
    // kế, không phân biệt sai số/sai mật khẩu để không giúp kẻ dò mật khẩu)
    // và mọi lỗi khác đều chỉ hiện err.message: bảng dịch đã ở đúng MỘT chỗ
    // (api.js MESSAGES), không cần thông điệp riêng theo từng ô ở đây.
    errBox.textContent = err.message;
    errBox.style.display = 'block';
    btn.disabled = false;
    btn.textContent = label;
  });

  return false;
}

// Người dùng tự bấm "Đăng xuất" — khác api.onAuthLost() bên dưới (phiên MẤT
// giữa chừng ngoài ý muốn): đây là chủ động, không cần nhớ S.afterLogin để
// quay lại, và không cần gọi /auth/refresh hay bất kỳ API nào — chỉ xoá token
// cục bộ rồi về màn đăng nhập.
function logout() {
  api.clearTokens();
  S.afterLogin = null;
  go('login', null);
}

// Phiên mất giữa chừng (access hỏng và refresh cũng hỏng) → quay lại đăng
// nhập, nhớ chỗ đang đứng để quay lại sau khi đăng nhập lại.
api.onAuthLost(function () {
  S.afterLogin = { route: S.r, id: S.id };
  go('login', null);
});

// ----------------------------------------------------------------------------
// Khởi động phiên khi tải trang.
//
// Còn access token đã lưu (localStorage, đọc bởi api.js lúc tải) thì vào
// thẳng route đang đứng (từ hash, xem router.js) — KHÔNG ép về màn đăng nhập
// chỉ vì trang vừa tải lại. Ngược lại thì về màn đăng nhập, và nếu route
// định vào (từ hash) không phải chính 'login' thì nhớ nó lại — mở thẳng một
// đường dẫn sâu (vd. đã đánh dấu trang) lúc chưa đăng nhập vẫn quay lại đúng
// chỗ sau khi đăng nhập xong, giống hệt guardedGo()/onAuthLost() ở trên.
// ----------------------------------------------------------------------------
if (api.isLoggedIn()) {
  // S.r có thể là 'login' ở đây (vd. hash trong URL còn sót lại 'login' từ
  // một lần bị đá về trước đó, rồi người dùng tải lại trang mà token vẫn
  // còn) — 'login' là chuỗi khác rỗng nên `S.r || 'viec'` sẽ SAI ở chỗ này,
  // nhốt một người đã đăng nhập lại ở màn đăng nhập. Loại riêng route đó ra.
  go(S.r && S.r !== 'login' ? S.r : 'viec', S.id);
} else {
  if (S.r && S.r !== 'login') S.afterLogin = { route: S.r, id: S.id };
  go('login', null);
}
