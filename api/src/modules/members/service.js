import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import { contactStates, envelope, readContact } from '../../core/privacy.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy thành viên này.', { status: 404 });

// ---------------------------------------------------------------------------
// LIỆT KÊ TƯỜNG MINH, không đổ thẳng hàng CSDL ra vỏ HTTP (Ruling T9-e).
//
// Ở bảng members có những cột KHÔNG được ra tới client: `email` (dữ liệu liên
// hệ nhưng nằm ngoài bộ ba mức riêng tư của member_contacts), `password_hash`,
// `lat`/`lng` (toạ độ NHÀ — đúng thứ mục 5 đặc tả bỏ công xoá EXIF ảnh để
// không rò), `erased_at`. `SELECT *` rồi trải object ra JSON sẽ đưa cả bốn thứ
// đó lên dây, và mọi cột ai đó thêm vào members ở task sau cũng vậy.
//
// Vì thế hai chỗ đều liệt kê tường minh: câu SELECT chỉ lấy cột cần, và hàm
// dựng phản hồi chỉ gán khoá đã biết tên.
// ---------------------------------------------------------------------------
const LIST_COLUMNS = `m.id, m.full_name, m.job, m.avatar_url, m.work_status, m.status,
                      a.id AS area_id, a.name AS area_name`;

const DETAIL_COLUMNS = `m.id, m.full_name, m.job, m.bio, m.avatar_url, m.cover_url,
                        m.work_status, m.status, m.birth_year, m.joined_at,
                        a.id AS area_id, a.name AS area_name`;

// LEFT JOIN areas có ĐỦ CẢ HAI vế: a.id = m.area_id VÀ a.community_id =
// m.community_id. Vế thứ hai trông thừa (area_id là khoá ngoại nên đã trỏ tới
// một khu vực có thật) nhưng nó là chốt chặn rẻ cho đúng họ lỗi đã lặp năm lần:
// areas KHÔNG có ràng buộc nào buộc member và khu vực của họ cùng cộng đồng.
const FROM_MEMBERS = `FROM members m
       LEFT JOIN areas a ON a.id = m.area_id AND a.community_id = m.community_id`;

function areaOf(r) {
  return r.area_id ? { id: r.area_id, name: r.area_name } : null;
}

function listRow(r, contacts) {
  return {
    id: r.id,
    full_name: r.full_name,
    job: r.job,
    avatar_url: r.avatar_url,
    work_status: r.work_status,
    status: r.status,
    area: areaOf(r),
    contacts,
  };
}

function detailRow(r, contacts) {
  return {
    id: r.id,
    full_name: r.full_name,
    job: r.job,
    bio: r.bio,
    avatar_url: r.avatar_url,
    cover_url: r.cover_url,
    work_status: r.work_status,
    status: r.status,
    birth_year: r.birth_year,
    joined_at: r.joined_at,
    area: areaOf(r),
    contacts,
  };
}

// ILIKE '%' || ? || '%' là tham số hóa (không phải nối chuỗi), nên KHÔNG có lỗ
// tiêm SQL. Nhưng `%` và `_` do người dùng gõ vẫn là KÝ TỰ ĐẠI DIỆN của chính
// LIKE: một chữ `%` biến bộ lọc "nghề" thành "khớp tất cả", tức bộ lọc im lặng
// không lọc gì. Thoát chúng để mẫu tìm kiếm là văn bản thuần.
// (`\` là ký tự thoát mặc định của LIKE trong PostgreSQL khi không khai ESCAPE.)
function likeLiteral(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Danh bạ. MỘT truy vấn trạng thái riêng tư cho CẢ TRANG (contactStates) và
 * MỘT dòng audit_log cho cả trang — xem đặc tả mục 6 và dòng 883.
 *
 * `contacts` dựng bằng envelope(), nên `value` LUÔN null kể cả với trường mức
 * `public`. Giá trị thật chỉ ra ở readContactField(). Đây không phải chi tiết
 * cài đặt mà là chính nguyên tắc 4: một trang danh bạ 20 người không được phép
 * rò 20 số điện thoại cùng một lúc, và bộ đếm "ai đã xem gì" chỉ trung thực
 * khi mỗi lần xem là một hành động riêng.
 */
export async function list({ actor, filters = {}, page = 1, limit = 20 }) {
  return withActor(actor.id, async (trx) => {
    const offset = (page - 1) * limit;

    // Một nguồn sự thật cho vị từ lọc: cùng chuỗi WHERE dùng cho cả câu lấy
    // trang lẫn câu đếm tổng. Không có dữ liệu người dùng nào được nối vào
    // chuỗi này — chỉ tham số.
    const where = `m.community_id = ?
        AND (?::text IS NULL OR m.status = ?::text)
        AND (?::text IS NULL OR m.work_status = ?::text)
        AND (?::uuid IS NULL OR m.area_id = ?::uuid)
        AND (?::text IS NULL OR m.job ILIKE '%' || ?::text || '%')
        AND (?::text IS NULL OR f_unaccent(m.full_name) ILIKE '%' || f_unaccent(?::text) || '%')`;

    const job = filters.job ? likeLiteral(filters.job) : null;
    const q = filters.q ? likeLiteral(filters.q) : null;
    // Mặc định danh bạ CHỈ hiện `member`. Đặc tả cho `status` là bộ lọc nhưng
    // không nói mặc định nào, và mặc định "hiện tất cả" là sai với nguyên tắc 4:
    // `guest` là người CHƯA được duyệt — đưa họ vào danh bạ ngang hàng với người
    // đã qua khung gặp-mặt-và-hai-người-ký là hiện diện sai tư cách, và mời gọi
    // người khác liên hệ trước khi cộng đồng xác nhận họ là ai. `left` là người
    // ĐÃ RỜI, mà theo mục 10 hồ sơ người rời thành bia mộ — vẫn hiện họ trong
    // danh bạ đang hoạt động là ngầm khẳng định "người này còn ở đây".
    //
    // Cả hai đều là rò trạng thái tư cách thành viên. Chốt bây giờ vì luồng
    // "rời cộng đồng" chưa tồn tại: chốt trước khi có dữ liệu thật thì rẻ, chốt
    // sau thì phải đi sửa cả những chỗ đã trót dựa vào hành vi cũ.
    const status = filters.status ?? 'member';
    const workStatus = filters.workStatus ?? null;
    const areaId = filters.areaId ?? null;

    const whereArgs = [
      actor.communityId,
      status, status,
      workStatus, workStatus,
      areaId, areaId,
      job, job,
      q, q,
    ];

    const { rows } = await trx.raw(
      `SELECT ${LIST_COLUMNS}
         ${FROM_MEMBERS}
        WHERE ${where}
        ORDER BY m.full_name, m.id
        LIMIT ? OFFSET ?`,
      [...whereArgs, limit, offset]
    );

    // Câu đếm riêng chứ không phải `count(*) OVER ()` như mã mẫu kế hoạch: với
    // window function, một trang RỖNG (page vượt quá số trang) không trả hàng
    // nào, nên `rows[0]?.total ?? 0` báo total = 0 trong khi tổng thật khác 0 —
    // frontend phân trang sẽ thấy danh bạ "biến mất" khi bấm quá trang cuối.
    const { rows: [{ total }] } = await trx.raw(
      `SELECT count(*)::int AS total FROM members m WHERE ${where}`,
      whereArgs
    );

    const ids = rows.map((r) => r.id);
    // MỘT truy vấn cho cả trang. Không gọi contact_read ở đây — 52 người trong
    // danh bạ sẽ thành 52 lời gọi và 52 dòng nhật ký cho MỘT lần mở trang.
    const states = await contactStates(trx, actor.id, ids, actor.communityId);

    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'member.list',
      // MỘT dòng cho cả trang. Và detail KHÔNG chứa `q`/`job` nguyên văn: cả
      // hai là VĂN BẢN TỰ DO người dùng gõ, đúng thứ luật mục 10 cấm đưa vào
      // nhật ký (người ta tìm danh bạ bằng số điện thoại là chuyện thường).
      // assertSafeDetail cũng sẽ từ chối chúng, nhưng ở đây là quyết định thiết
      // kế chứ không phải né một lỗi runtime — chỉ ghi CÓ lọc hay KHÔNG.
      //
      // Đặc tả dòng 883 viết detail dạng {"count":20,"filters":{…}} — hình dạng
      // đó KHÔNG DÙNG ĐƯỢC: assertSafeDetail (core/audit.js) là
      // z.record(scalar | scalar[]), một object lồng trong detail bị từ chối.
      // Làm phẳng ra đây; xem task-10-report.md.
      detail: {
        count: rows.length,
        total,
        page,
        limit,
        status: status ?? null,
        work_status: workStatus ?? null,
        area_id: areaId ?? null,
        has_q: q !== null,
        has_job: job !== null,
      },
    });

    return {
      data: rows.map((r) =>
        listRow(r, envelope(states.get(r.id), { viewerId: actor.id, targetId: r.id }))
      ),
      meta: { page, limit, total },
    };
  });
}

/**
 * Hồ sơ một người. Ghi MỘT hàng profile_views và MỘT dòng audit_log
 * 'profile.view' trong CÙNG giao dịch với lượt đọc — hai thứ đó là bằng chứng
 * của cùng một hành động, tách giao dịch nghĩa là có thể còn cái này mất cái
 * kia.
 *
 * `contacts` vẫn là bao bì với value = null: hồ sơ chi tiết KHÔNG phải cửa
 * đọc số điện thoại (đặc tả dòng 789). Cửa đó là readContactField().
 */
export async function get({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [m] } = await trx.raw(
      `SELECT ${DETAIL_COLUMNS}
         ${FROM_MEMBERS}
        WHERE m.id = ? AND m.community_id = ?`,
      [id, actor.communityId]
    );
    // Ném thẳng ở đây an toàn (bẫy 1): giao dịch chưa ghi gì, rollback không
    // xoá mất dòng nhật ký nào. Dòng "từ chối" do errorHandler ghi trong một
    // giao dịch RIÊNG mở sau khi giao dịch này đã cuộn xong.
    if (!m) throw NOT_FOUND();

    const states = await contactStates(trx, actor.id, [m.id], actor.communityId);

    // Không ghi profile_views khi tự xem hồ sơ mình: màn "Ai đã xem hồ sơ của
    // tôi" mà đầy chính mình thì không còn đọc được. Quyết định này nằm ở chỗ
    // GHI chứ không ở chỗ ĐỌC, vì profile_views bị REVOKE UPDATE, DELETE
    // (migration 006) — hàng đã ghi thì vĩnh viễn ở đó, nên đừng ghi rác.
    if (actor.id !== m.id) {
      await trx.raw(
        `INSERT INTO profile_views (community_id, viewer_id, target_id, what) VALUES (?, ?, ?, ?)`,
        [actor.communityId, actor.id, m.id, 'profile']
      );
    }

    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'profile.view',
      targetType: 'member',
      targetId: m.id,
      detail: { self: actor.id === m.id },
    });

    return detailRow(m, envelope(states.get(m.id), { viewerId: actor.id, targetId: m.id }));
  });
}

/**
 * Đọc ĐÚNG MỘT trường liên hệ của ĐÚNG MỘT người — lối vào DUY NHẤT của
 * contact_read trong toàn bộ tầng ứng dụng.
 *
 * BẪY 1, và mã mẫu ở kế hoạch (Task 10, Bước 2) viết đúng lỗi này: contact_read
 * TỰ GHI một dòng audit_log 'contact.denied' TRONG giao dịch đang mở, rồi trả
 * về `allowed = false` (nó cố ý KHÔNG raise — xem migration 006). Nếu ta ném
 * AppError ngay tại đó, ngoại lệ cuộn cả giao dịch và XOÁ LUÔN dòng nhật ký vừa
 * ghi. Hậu quả cụ thể: mọi lần một người bị từ chối xem số điện thoại đều không
 * để lại dấu vết nào — một kẻ dò hồ sơ cả trăm lượt là vô hình, đúng hành vi mà
 * cả kiến trúc này dựng ra để nhìn thấy.
 *
 * Khuôn đúng (giống verifyOtp/login ở Task 7, confirmMet/reject ở Task 9): giao
 * dịch LUÔN COMMIT và trả {kind, ...}; AppError ném SAU khi commit xong.
 */
export async function readContactField({ actor, id, field }) {
  const outcome = await withActor(actor.id, async (trx) => {
    // Chốt chặn cộng đồng ở tầng ứng dụng. Chốt thật nằm trong contact_read
    // (migration 012a) — CSDL chặn, không phải service chặn. Câu này ở đây vì
    // lý do khác: contact_read RAISE 'NO_TARGET', mà NO_TARGET không có trong
    // bảng ánh xạ core/errors.js nên sẽ thành HTTP 500. Người dùng bấm vào một
    // hồ sơ vừa bị xoá xứng đáng nhận 404, không phải "lỗi hệ thống"; và một
    // ngoại lệ từ hàm CSDL còn nhiễm độc giao dịch (bẫy 2).
    const { rows: [t] } = await trx.raw(
      `SELECT id FROM members WHERE id = ? AND community_id = ?`,
      [id, actor.communityId]
    );
    if (!t) return { kind: 'not_found' };

    const r = await readContact(trx, id, field);
    if (!r.allowed) return { kind: 'denied', reason: r.reason };
    return { kind: 'ok', value: r.value };
  });

  // ----- Từ đây trở xuống giao dịch ĐÃ COMMIT. Dòng contact.denied an toàn. --
  if (outcome.kind === 'not_found') throw NOT_FOUND();
  if (outcome.kind === 'denied') {
    throw outcome.reason === 'CLOSED'
      ? new AppError('CONTACT_CLOSED', 'Chủ hồ sơ đã đóng thông tin này.', { status: 403 })
      : new AppError('CONTACT_NEEDS_CONSENT', 'Cần chủ hồ sơ đồng ý mới xem được.', { status: 403 });
  }
  return { value: outcome.value };
}
