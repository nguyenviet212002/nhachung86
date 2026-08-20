/* ============================================================================
 * web/js/api.js — lớp duy nhất nói chuyện với /api/v1
 *
 * Ba việc, không hơn:
 *   1. gắn access token vào mọi lời gọi;
 *   2. tự làm mới khi 401, GỘP các lời gọi làm mới song song thành một;
 *   3. dịch `error.code` sang câu tiếng Việt ở ĐÚNG MỘT chỗ.
 *
 * Không có framework, không có bước build: tệp này được Caddy phục vụ tĩnh
 * nguyên văn từ ./web (xem proxy/Caddyfile: `root * /srv`, và docker-compose.yml
 * mount `./web:/srv:ro`).
 *
 * QUY ƯỚC VỎ HTTP LÀ snake_case (đặc tả mục 5). Dự án đã mất bốn lần vì chỗ
 * này (`otpToken`, `refreshToken`, `fullName`, `communityId` — Ruling T9-c,
 * T9-e). Tệp này đọc/ghi ĐÚNG tên khoá của đặc tả và không bao giờ chấp nhận
 * biến thể camelCase "cho dễ": chấp nhận cả hai nghĩa là đóng đinh cái sai.
 * ========================================================================== */
(function () {
  'use strict';

  var BASE = '/api/v1';

  // ------------------------------------------------------------------------
  // MỘT chỗ duy nhất dịch error.code sang tiếng Việt.
  //
  // Danh sách này là hợp của BA nguồn, không phải chép lại một nguồn:
  //   (a) bảng ánh xạ lỗi ở đặc tả mục 5.1 — 15 mã;
  //   (b) mọi `new AppError(<code>, …)` thật sự tồn tại trong api/src — bảng
  //       5.1 chỉ liệt kê lỗi do TRIGGER/RÀNG BUỘC CSDL ném ra, nên nó thiếu
  //       toàn bộ lỗi do tầng ứng dụng tự ném (VALIDATION_FAILED,
  //       UNAUTHENTICATED, INVALID_CREDENTIALS, OTP_*, …) — đúng những mã mà
  //       ba màn của mốc này gặp nhiều nhất;
  //   (c) RATE_LIMITED — middleware/rateLimit.js trả thẳng JSON 429, không đi
  //       qua AppError nên không grep ra được từ (b).
  //
  // Kế hoạch (Task 11, Bước 2) chỉ liệt kê 9 mã; 13 mã của riêng bảng 5.1 bị
  // bỏ sót. Xem task-11-report.md.
  //
  // THỨ TỰ ƯU TIÊN: bảng này TRƯỚC câu của máy chủ. Lý do: câu tiếng Việt
  // người dùng đọc là việc của giao diện, và nếu để câu máy chủ thắng thì cùng
  // một mã lỗi có thể hiện hai câu khác nhau tuỳ route — đúng loại bất nhất mà
  // "một chỗ duy nhất" sinh ra để chặn. Câu của máy chủ vẫn là lưới đỡ cho mã
  // mà bảng này chưa biết (route của giai đoạn sau), nên thêm route mới KHÔNG
  // làm hỏng gì; chỉ là câu chữ chưa được biên tập.
  // ------------------------------------------------------------------------
  var MESSAGES = {
    // --- (a) Bảng ánh xạ lỗi CSDL → HTTP, đặc tả mục 5.1 ---------------
    GUARANTEE_QUOTA_EXCEEDED:   'Người bảo lãnh đã dùng hết số lượt trong 12 tháng gần nhất.',
    MANUAL_PAIR_QUOTA_EXCEEDED: 'Hai người đã ghi quá số việc thủ công cho phép trong 12 tháng.',
    SELF_ONLY:                  'Việc này chỉ chính người đó làm được, không ai điền hộ.',
    MET_CONFIRMATION_REQUIRED:  'Chưa có xác nhận đã gặp mặt nên chưa thể thành thành viên.',
    SUMMARY_REQUIRED:           'Còn hoạt động dùng quỹ chưa có tổng kết.',
    FUND_ENTRY_LOCKED:          'Bút toán đã khóa. Hãy ghi bút toán điều chỉnh mới.',
    TWO_APPROVERS_REQUIRED:     'Bút toán từ một triệu đồng trở lên cần hai người duyệt.',
    GUARANTEE_CYCLE:            'Sợi bảo lãnh tạo thành vòng tròn.',
    WORK_RECORD_FROZEN:         'Việc đã có xác nhận nên không sửa được nữa.',
    REFERRER_FROZEN:            'Sợi bảo lãnh đã thành sự thật lịch sử, không sửa được.',
    CONTACT_WRITE_DENIED:       'Bạn không có quyền sửa thông tin liên hệ này.',
    TWO_SIGNERS_REQUIRED:       'Bảo chứng cần đúng hai người khác nhau ký.',
    DUPLICATE:                  'Dữ liệu này đã tồn tại.',
    INVALID_REFERENCE:          'Dữ liệu tham chiếu không hợp lệ.',
    INTERNAL:                   'Hệ thống đang trục trặc. Thử lại sau ít phút.',

    // --- (b) Lỗi do tầng ứng dụng ném, không có trong bảng 5.1 ----------
    VALIDATION_FAILED:      'Dữ liệu gửi lên chưa hợp lệ. Xem lại các ô được tô đỏ.',
    UNAUTHENTICATED:        'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
    FORBIDDEN:              'Bạn không có quyền làm việc này.',
    NOT_FOUND:              'Không tìm thấy dữ liệu này.',
    INVALID_STATE:          'Việc này không còn ở trạng thái thực hiện được nữa.',
    INVALID_CREDENTIALS:    'Số điện thoại/email hoặc mật khẩu không đúng.',
    INVALID_REFRESH:        'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
    OTP_INVALID:            'Mã xác minh không đúng hoặc đã hết hạn.',
    OTP_LOCKED:             'Số này tạm khóa 15 phút do nhập sai nhiều lần.',
    REFERRAL_UNAVAILABLE:   'Không dùng được người bảo lãnh này.',
    REFERRER_REQUIRED:      'Phải có người bảo lãnh.',
    CONTACT_NEEDS_CONSENT:  'Cần chủ hồ sơ đồng ý mới xem được.',
    CONTACT_CLOSED:         'Chủ hồ sơ đã đóng thông tin này.',
    PHOTO_CONSENT_INCOMPLETE: 'Còn người có mặt trong ảnh chưa đồng ý.',
    JOIN_SECRET_DENIED:     'Chỉ ban duyệt của chính cộng đồng này mới duyệt được đơn, và chỉ khi đơn đã có xác nhận gặp mặt.',
    JOIN_SECRET_MISSING:    'Đơn này không có dữ liệu đăng ký kèm theo nên không duyệt được.',

    // Sáu mã của migration 025 (Task 12). Chưa màn nào gọi tới — endpoint việc
    // thuộc giai đoạn sau — nhưng để sẵn ở đây vì bảng này phải khớp
    // core/errors.js, và một mã thiếu sẽ hiện ra câu chung chung đúng lúc người
    // dùng cần biết mình vướng luật nào. `t23-error-map.test.js` canh việc khớp.
    WORK_PARTICIPANTS_FROZEN: 'Việc đã có người xác nhận nên không thêm bớt người tham gia được nữa.',
    MANUAL_CREATOR_NOT_PARTICIPANT: 'Người ghi việc thủ công phải là một trong những người đã làm việc đó.',
    MANUAL_REVIEW_BEFORE_WORK: 'Việc thủ công không thể sinh ra đã được duyệt sẵn.',
    REVIEWER_NOT_APPROVER:  'Chỉ ban duyệt của chính cộng đồng này mới duyệt được việc thủ công.',
    REVIEWER_IS_PARTICIPANT: 'Người tham gia không tự duyệt việc của mình được.',
    REVIEWER_REQUIRED:      'Phải ghi rõ ai là người duyệt.',

    // Mã của Task 13 (migration 013–026). Bảy mã "không tìm thấy X" đã gộp về
    // NOT_FOUND ngay ở core/errors.js nên không xuất hiện ở đây — người dùng
    // cần biết thứ họ trỏ tới không còn ở đó, không cần biết trigger nào bắt.
    AID_SLOT_FULL:          'Suất giúp này đã có đủ người nhận.',
    EVIDENCE_NOT_PARTICIPANT: 'Chỉ người đã làm việc đó mới lấy nó làm bằng chứng năng lực được.',
    EVIDENCE_NOT_CONFIRMED: 'Việc chưa đủ xác nhận của mọi người tham gia nên chưa làm bằng chứng được.',
    ENDORSEMENT_SELF_SIGN:  'Không ai tự bảo chứng cho chính mình.',
    LOAN_GUARANTOR_IS_BORROWER: 'Người vay không thể tự đứng ra bảo lãnh cho khoản vay của mình.',
    SUBJECT_KEY_IMMUTABLE:  'Khoá này đã cấp nên không đổi được.',
    SUBJECT_KEY_DESTROYED:  'Khoá đã hủy thì không hồi sinh được.',
    SIGNER_IS_TARGET:       'Người bị ảnh hưởng bởi quyết định này không được ký duyệt nó.',
    SIGNER_ROLE_REQUIRED:   'Bạn không có vai được ký duyệt việc này.',
    TWO_SIGNATURES_REQUIRED: 'Việc này cần đúng hai người khác nhau ký.',
    CREATOR_SIGNATURE_MISSING: 'Người đề xuất phải ký trước khi việc được thi hành.',

    // Ba mã của migration 027 (vòng rà bất biến liên bảng, docs/RANG-BUOC.md).
    // Ba trigger khác của cùng migration cố ý dùng lại SELF_ONLY /
    // LOAN_GUARANTOR_IS_BORROWER / PHOTO_CONSENT_INCOMPLETE / REFERRER_FROZEN
    // đã có ở trên, nên không thêm câu mới cho chúng.
    CAPABILITY_OWNER_FROZEN: 'Năng lực đã dẫn bằng chứng nên không chuyển sang tên người khác được.',
    PENDING_ACTION_FROZEN:  'Việc này đã có chữ ký nên nội dung không đổi được nữa. Hãy tạo lại và ký lại từ đầu.',
    JOIN_REQUEST_FROZEN:    'Những dữ kiện này của đơn đã cố định, không sửa lại được.',
    PHOTO_PEOPLE_FROZEN:    'Không dời được người có mặt sang tấm ảnh khác. Đổi ý thì sửa câu trả lời đồng ý.',

    // Mã của migration 028 — `communities.config` và `guarantee_quota_overrides`
    // nay đi qua khung hai người ký, và bảo chứng đòi vai approver (QĐ-2).
    CONFIG_CHANGE_UNSIGNED: 'Đổi chính sách của Hội phải qua một việc chờ có đủ hai người ký.',
    QUOTA_OVERRIDE_UNSIGNED: 'Nới hạn mức bảo lãnh phải qua một việc chờ có đủ hai người ký.',
    ENDORSER_ROLE_REQUIRED: 'Bảo chứng là việc của Ban điều hành: cả hai người ký phải là người duyệt.',

    // Khung hai người ký (core/twoPerson.js, đặc tả mục 7). Năm mã này do tầng
    // ứng dụng ném, không có trong BY_MESSAGE.
    ACTION_NOT_AVAILABLE:   'Việc này chưa mở để ký trong giai đoạn hiện tại.',
    PENDING_ACTION_EXPIRED: 'Việc này đã quá hạn hoặc không còn chờ ký. Hãy tạo lại.',
    PENDING_ACTION_STALE:   'Dữ liệu liên quan đã thay đổi kể từ chữ ký đầu. Hãy tạo lại việc này và ký lại từ đầu.',
    NEEDS_SECOND_PERSON:    'Cần một người thứ hai ký. Người đề xuất đã là chữ ký thứ nhất.',
    REAUTH_FAILED:          'Mật khẩu không đúng. Ký một việc vận hành phải nhập lại mật khẩu.',

    // --- (c) Không đi qua AppError -------------------------------------
    RATE_LIMITED:           'Bạn thao tác quá nhanh, thử lại sau ít phút.',

    // --- Chỉ tồn tại ở phía client: mạng hỏng, máy chủ không trả JSON ---
    NETWORK:                'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'
  };

  var FALLBACK = 'Có lỗi xảy ra. Thử lại sau ít phút.';

  // ------------------------------------------------------------------------
  // Token
  // ------------------------------------------------------------------------
  var access = null;
  var refresh = null;
  try {
    access = localStorage.getItem('nc_access');
    refresh = localStorage.getItem('nc_refresh');
  } catch (e) {
    // Trình duyệt chặn localStorage (chế độ riêng tư nghiêm ngặt): vẫn chạy
    // được trong một phiên, chỉ là không nhớ sau khi đóng tab.
  }

  function store(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* xem chú thích ở trên */ }
  }

  // Đặc tả mục 5.3: /auth/login và /auth/refresh trả `{ access, refresh }`.
  // KHÔNG đọc t.accessToken / t.access_token: chỉ một tên là đúng, và chấp
  // nhận thêm tên khác chính là cách bốn lỗi camelCase trước sống sót lâu.
  function setTokens(t) {
    access = t.access;
    refresh = t.refresh;
    store('nc_access', access);
    store('nc_refresh', refresh);
  }

  function clearTokens() {
    access = null;
    refresh = null;
    store('nc_access', null);
    store('nc_refresh', null);
  }

  // Nơi ứng dụng cắm phản ứng "phiên đã mất" (quay về màn đăng nhập). Mặc
  // định không làm gì để api.js dùng được cả ở trang chưa có giao diện.
  var onAuthLost = function () {};

  // ------------------------------------------------------------------------
  // Lỗi
  // ------------------------------------------------------------------------
  function ApiError(code, serverMessage, fields, status) {
    var e = new Error(MESSAGES[code] || serverMessage || FALLBACK);
    e.name = 'ApiError';
    e.code = code;
    e.fields = fields || null;
    e.status = status || 0;
    // Giữ nguyên câu của máy chủ để gỡ lỗi, nhưng KHÔNG hiện cho người dùng
    // trừ khi bảng trên không biết mã đó.
    e.serverMessage = serverMessage || null;
    return e;
  }

  // ------------------------------------------------------------------------
  // LÀM MỚI TOKEN — chỗ nguy hiểm nhất của tệp này, hai bẫy riêng biệt.
  //
  // Bẫy 1 — VÒNG LẶP VÔ TẬN: nếu chính /auth/refresh trả 401 mà ta lại đi làm
  // mới, mỗi lần hỏng sinh một lần gọi mới. renew() dùng fetch TRẦN chứ không
  // gọi lại raw(), nên vòng lặp không dựng được về mặt cấu trúc. Nhưng cấu
  // trúc có thể bị người sau phá bằng một dòng "cho tiện", nên còn thêm chốt
  // tường minh NO_AUTO_REFRESH bên dưới: hai đường auth công khai đó không bao
  // giờ được tự làm mới, kể cả khi ai đó gọi chúng qua api.post().
  //
  // Bẫy 2 — ĐĂNG XUẤT OAN VÌ XOAY VÒNG REFRESH TOKEN: đặc tả dòng 817 quy định
  // refresh token XOAY VÒNG và "phát hiện dùng lại token cũ thì thu hồi cả
  // family_id". Hai lời gọi song song cùng gặp 401 sẽ cùng đi làm mới; cái thứ
  // hai nộp đúng token vừa bị cái thứ nhất thay ⇒ máy chủ coi là dùng lại ⇒
  // THU HỒI CẢ HỌ ⇒ người dùng bị đá ra ngoài giữa chừng dù không làm gì sai.
  // Một trang danh bạ mở ra là đã có hơn một lời gọi song song, nên đây không
  // phải rủi ro lý thuyết.
  //
  // Cách chặn: gộp — mọi lời gọi làm mới đang chạy dùng CHUNG một promise.
  // Cái thứ hai không gửi thêm request nào, nó chờ kết quả của cái thứ nhất
  // rồi thử lại bằng token mới.
  // ------------------------------------------------------------------------
  var NO_AUTO_REFRESH = ['/auth/refresh', '/auth/login', '/auth/otp/request', '/auth/otp/verify', '/auth/register'];

  var renewing = null; // Promise<boolean> | null

  function renew() {
    if (renewing) return renewing;
    if (!refresh) return Promise.resolve(false);

    var used = refresh; // chụp lại: nếu có ai đổi refresh giữa chừng thì vẫn biết ta đã nộp cái nào

    renewing = fetch(BASE + '/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // snake_case: schema của máy chủ (modules/auth/schema.js) CHỈ nhận
      // `refresh_token`; gửi `refreshToken` sẽ nhận VALIDATION_FAILED.
      body: JSON.stringify({ refresh_token: used })
    })
      .then(function (res) {
        if (!res.ok) return false;
        return res.json().then(function (data) {
          if (!data || !data.access || !data.refresh) return false;
          setTokens(data);
          return true;
        });
      })
      .catch(function () { return false; })
      .then(function (ok) {
        renewing = null;
        if (!ok) {
          clearTokens();
          try { onAuthLost(); } catch (e) {}
        }
        return ok;
      });

    return renewing;
  }

  // ------------------------------------------------------------------------
  // Lời gọi
  // ------------------------------------------------------------------------
  function raw(method, path, body, allowRetry) {
    if (allowRetry === undefined) allowRetry = true;

    var headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (access) headers['authorization'] = 'Bearer ' + access;

    return fetch(BASE + path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }).catch(function () {
      // fetch chỉ reject khi mạng hỏng / bị chặn — biến nó thành cùng một
      // hình dạng lỗi với mọi thứ khác để nơi gọi chỉ phải bắt một loại.
      throw ApiError('NETWORK', null, null, 0);
    }).then(function (res) {
      var canRefresh = allowRetry && refresh && NO_AUTO_REFRESH.indexOf(path.split('?')[0]) === -1;

      if (res.status === 401 && canRefresh) {
        return renew().then(function (ok) {
          if (ok) return raw(method, path, body, false); // thử lại ĐÚNG MỘT lần
          return finish(res);                            // renew() đã xoá token + báo onAuthLost
        });
      }

      if (res.status === 401 && !canRefresh && access) {
        // Hết đường: token hỏng và không có (hoặc không được phép dùng) refresh.
        clearTokens();
        try { onAuthLost(); } catch (e) {}
      }

      return finish(res);
    });
  }

  function finish(res) {
    if (res.status === 204) return Promise.resolve(null);

    return res.json().catch(function () { return null; }).then(function (data) {
      if (res.ok) return data;
      var e = (data && data.error) || {};
      throw ApiError(e.code || 'INTERNAL', e.message, e.fields, res.status);
    });
  }

  function qs(params) {
    var parts = [];
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      var v = params[k];
      if (v === undefined || v === null || v === '') continue;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
    return parts.length ? '?' + parts.join('&') : '';
  }

  window.api = {
    get:  function (p) { return raw('GET', p); },
    post: function (p, b) { return raw('POST', p, b === undefined ? {} : b); },
    put:  function (p, b) { return raw('PUT', p, b === undefined ? {} : b); },
    del:  function (p) { return raw('DELETE', p); },

    setTokens: setTokens,
    clearTokens: clearTokens,
    isLoggedIn: function () { return Boolean(access); },
    onAuthLost: function (fn) { onAuthLost = fn; },

    qs: qs,
    // Xuất ra để bài test / màn hình dùng chung đúng một bảng, không chép lại.
    MESSAGES: MESSAGES,
    messageFor: function (code) { return MESSAGES[code] || FALLBACK; }
  };
})();
