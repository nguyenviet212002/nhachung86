import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { publishToMember } from '../../core/realtime.js';
import { log as auditLog } from '../../core/audit.js';
import {
  contactStates, envelope, readContact, pickFields, CONTACT_FIELDS, PROFILE_FIELDS,
} from '../../core/privacy.js';

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

// ---------------------------------------------------------------------------
// TÁM TRƯỜNG, MỘT CỬA (việc thừa kế (a) của Task 13, Ruling T11-f).
//
// Trước Task 13, `job` và `area` đi thẳng từ hàng CSDL ra JSON trong khi
// privacy_settings vẫn giữ mức riêng tư cho chúng. Đặt job='closed' rồi mở
// danh bạ: vẫn thấy đủ. Nay cả tám trường đi qua envelope() — cùng cửa với
// phone/zalo/messenger/address — nên chỉ còn MỘT chỗ quyết định che hay không.
//
// `job`/`area` vẫn nằm ở mức trên cùng của phản hồi vì đó là hình dạng frontend
// đang đọc; giá trị của chúng LẤY TỪ BAO BÌ chứ không lấy lại từ hàng CSDL —
// đọc lại từ `r.job` ở đây chính là cách bản vá này bị vô hiệu hoá lần sau.
// `profile_fields` đi kèm để màn "Quyền riêng tư" có mức và trạng thái thật mà
// hiển thị, thay vì để người dùng đoán cái nút họ vừa gạt có tác dụng gì không.
// ---------------------------------------------------------------------------
function profileValues(r) {
  // price nằm ở capabilities.price (migration 013), nhưng một thành viên có thể
  // có nhiều năng lực nên danh bạ không chọn bừa một giá. family chưa có nơi lưu.
  // Cả hai vẫn đi qua đúng cửa này để khi có dữ liệu thì không ai phải nhớ nối
  // lại; xem task-13-report.md.
  return { job: r.job, area: areaOf(r), price: null, family: null };
}

function listRow(r, env) {
  return {
    id: r.id,
    full_name: r.full_name,
    job: env.job.value,
    avatar_url: r.avatar_url,
    work_status: r.work_status,
    status: r.status,
    area: env.area.value,
    contacts: pickFields(env, CONTACT_FIELDS),
    profile_fields: pickFields(env, PROFILE_FIELDS),
  };
}

function detailRow(r, env) {
  return {
    id: r.id,
    full_name: r.full_name,
    job: env.job.value,
    bio: r.bio,
    avatar_url: r.avatar_url,
    cover_url: r.cover_url,
    work_status: r.work_status,
    status: r.status,
    birth_year: r.birth_year,
    joined_at: r.joined_at,
    area: env.area.value,
    contacts: pickFields(env, CONTACT_FIELDS),
    profile_fields: pickFields(env, PROFILE_FIELDS),
  };
}

async function profileExtras(trx, member) {
  const { rows: capabilities } = await trx.raw(
    `SELECT id, title, description, category, years_experience, service_area, scope,
            availability, conditions, created_at, updated_at
       FROM capabilities
      WHERE community_id = ? AND member_id = ? AND status = 'published'
      ORDER BY updated_at DESC, id`,
    [member.community_id, member.id]
  );

  const { rows: [referrer] } = await trx.raw(
    `SELECT r.id, r.full_name, r.avatar_url,
            source.inviter_note, source.introduced_at,
            source.note_author_id, note_author.full_name AS note_author_name
       FROM members subject
       JOIN members r
         ON r.id = subject.referrer_id AND r.community_id = subject.community_id
       LEFT JOIN LATERAL (
         SELECT gi.inviter_note, gi.created_by AS note_author_id,
                coalesce(gi.created_at, jr.created_at) AS introduced_at
           FROM join_requests jr
           LEFT JOIN guarantee_invites gi
             ON gi.used_by_join_request = jr.id AND gi.community_id = jr.community_id
          WHERE jr.member_id = subject.id
            AND jr.referrer_id = subject.referrer_id
            AND jr.community_id = subject.community_id
            AND jr.status = 'approved'
          ORDER BY jr.updated_at DESC, jr.id DESC
          LIMIT 1
       ) source ON true
       LEFT JOIN members note_author
         ON note_author.id = source.note_author_id
        AND note_author.community_id = subject.community_id
      WHERE subject.id = ? AND subject.community_id = ?`,
    [member.id, member.community_id]
  );

  const { rows: [ready] } = await trx.raw(
    `SELECT status, headline, availability, note, updated_at
       FROM ready_profiles WHERE member_id = ? AND community_id = ?`,
    [member.id, member.community_id]
  );
  const { rows: [activeConnection] } = await trx.raw(
    `SELECT c.id, c.status, c.poster_id, c.worker_id, c.updated_at,
            j.id AS job_id, j.title AS job_title
       FROM connections c
       LEFT JOIN job_needs j ON j.id = c.job_need_id AND j.community_id = c.community_id
      WHERE c.community_id = ? AND (c.poster_id = ? OR c.worker_id = ?)
        AND c.status IN ('agreed', 'working')
      ORDER BY CASE c.status WHEN 'working' THEN 0 ELSE 1 END, c.updated_at DESC
      LIMIT 1`,
    [member.community_id, member.id, member.id]
  );

  let workSummary;
  if (activeConnection) {
    workSummary = {
      status: activeConnection.status,
      source: 'connection',
      role: activeConnection.worker_id === member.id ? 'worker' : 'poster',
      connection_id: activeConnection.id,
      job_id: activeConnection.job_id,
      job_title: activeConnection.job_title,
      updated_at: activeConnection.updated_at,
    };
  } else if (ready) {
    workSummary = { ...ready, source: 'ready_profile' };
  } else {
    workSummary = { status: member.work_status, source: 'member_profile' };
  }

  const { rows: history } = await trx.raw(
    `SELECT kind, target_id, title, occurred_at, status
       FROM (
         SELECT 'joined'::text AS kind, m.id AS target_id,
                'Gia nhập cộng đồng'::text AS title,
                coalesce(m.joined_at, m.created_at) AS occurred_at,
                m.status::text AS status
           FROM members m WHERE m.id = ? AND m.community_id = ?
         UNION ALL
         SELECT 'capability', c.id, c.title, c.created_at, c.status
           FROM capabilities c
          WHERE c.member_id = ? AND c.community_id = ? AND c.status = 'published'
         UNION ALL
         SELECT 'work_completed', wr.id, wr.title, wr.done_on::timestamptz, 'confirmed'
           FROM work_participants wp
           JOIN work_records wr
             ON wr.id = wp.work_record_id AND wr.community_id = wp.community_id
          WHERE wp.member_id = ? AND wp.community_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM work_participants expected
               WHERE expected.work_record_id = wr.id
                 AND NOT EXISTS (
                   SELECT 1 FROM work_confirmations confirmed
                    WHERE confirmed.work_record_id = expected.work_record_id
                      AND confirmed.member_id = expected.member_id
                 )
            )
         UNION ALL
         SELECT 'activity', a.id, a.title, ap.joined_at, a.status
           FROM activity_participants ap
           JOIN activities a ON a.id = ap.activity_id AND a.community_id = ap.community_id
          WHERE ap.member_id = ? AND ap.community_id = ? AND a.status <> 'cancelled'
         UNION ALL
         SELECT 'job_posted', j.id, j.title, j.created_at, j.status
           FROM job_needs j WHERE j.poster_id = ? AND j.community_id = ?
         UNION ALL
         SELECT 'job_connection', c.id, coalesce(j.title, 'Kết nối việc làm'),
                c.updated_at, c.status
           FROM connections c
           LEFT JOIN job_needs j ON j.id = c.job_need_id AND j.community_id = c.community_id
          WHERE c.community_id = ? AND (c.poster_id = ? OR c.worker_id = ?)
            AND c.status IN ('agreed', 'working', 'done')
       ) events
      ORDER BY occurred_at DESC, target_id
      LIMIT 20`,
    [member.id, member.community_id,
     member.id, member.community_id,
     member.id, member.community_id,
     member.id, member.community_id,
     member.id, member.community_id,
     member.community_id, member.id, member.id]
  );

  return {
    capabilities,
    referrer: referrer ?? null,
    work_summary: workSummary,
    participation_history: history,
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
 * Mở rộng MỘT area_id thành chính nó + toàn bộ khu vực con (đệ quy trong JS,
 * không phải CTE — cây `areas` của một cộng đồng chỉ vài trăm hàng, đọc hết
 * rồi duyệt bằng tay rẻ hơn hẳn so với thêm một dạng SQL đệ quy mới vào file
 * vốn đã rất cẩn trọng với hình dạng WHERE dùng chung 2 câu). `null` giữ
 * nguyên `null` để vị từ `?::uuid[] IS NULL` ở list() không lọc gì, đúng hành
 * vi cũ khi không truyền area_id.
 */
async function resolveAreaIds(trx, communityId, areaId) {
  if (!areaId) return null;
  const { rows } = await trx.raw(`SELECT id, parent_id FROM areas WHERE community_id = ?`, [communityId]);
  const childrenOf = new Map();
  for (const r of rows) {
    if (!r.parent_id) continue;
    if (!childrenOf.has(r.parent_id)) childrenOf.set(r.parent_id, []);
    childrenOf.get(r.parent_id).push(r.id);
  }
  const ids = [areaId];
  const queue = [areaId];
  while (queue.length) {
    const cur = queue.shift();
    for (const child of childrenOf.get(cur) || []) { ids.push(child); queue.push(child); }
  }
  return ids;
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
    // BỘ LỌC CŨNG PHẢI TÔN TRỌNG MỨC RIÊNG TƯ, nếu không che giá trị chỉ là
    // che một nửa. `?job=bác sĩ` trả về đúng những người mang nghề đó — kể cả
    // người đã đặt job='closed' — nên bộ lọc là một kênh phụ đọc được trọn vẹn
    // cái trường vừa bị che. Cùng hình dạng với Ruling T8-c (che câu chữ mà để
    // hở trạng thái).
    //
    // Vị từ dùng CHÍNH fn_privacy_state — cùng hàm mà contactStates() và
    // contact_read gọi — nên không có bản sao thứ hai của luật để trôi dạt.
    //
    // area_id giờ lọc theo CẢ khu vực con: cây khu vực có 2 cấp (tỉnh → xã/
    // phường, xem db/seeds/data/community.js), nên lọc theo một tỉnh (vd. "Hà
    // Nội") phải ra mọi người ở bất kỳ xã/phường nào của tỉnh đó, không chỉ
    // người gán thẳng area_id = tỉnh. resolveAreaIds() mở rộng thành mảng
    // (chính nó khi là khu vực lá, không có con nào) rồi so bằng ANY(...).
    const where = `m.community_id = ?
        AND (?::text IS NULL OR m.status = ?::text)
        AND (?::text IS NULL OR m.work_status = ?::text)
        AND (?::uuid[] IS NULL OR (m.area_id = ANY(?::uuid[])
             AND fn_privacy_state(?::uuid, m.id, 'area') IN ('self','visible')))
        AND (?::text IS NULL OR (m.job ILIKE '%' || ?::text || '%'
             AND fn_privacy_state(?::uuid, m.id, 'job') IN ('self','visible')))
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
    const areaIds = await resolveAreaIds(trx, actor.communityId, filters.areaId ?? null);

    const whereArgs = [
      actor.communityId,
      status, status,
      workStatus, workStatus,
      areaIds, areaIds, actor.id,
      job, job, actor.id,
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
        area_id: filters.areaId ?? null,
        has_q: q !== null,
        has_job: job !== null,
      },
    });

    return {
      data: rows.map((r) => listRow(r, envelope(states.get(r.id), profileValues(r)))),
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

    return {
      ...detailRow(m, envelope(states.get(m.id), profileValues(m))),
      ...(await profileExtras(trx, { ...m, community_id: actor.communityId })),
    };
  });
}

export async function getMe({ actor }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [m] } = await trx.raw(
      `SELECT ${DETAIL_COLUMNS}, m.email ${FROM_MEMBERS}
        WHERE m.id = ? AND m.community_id = ?`, [actor.id, actor.communityId]
    );
    if (!m) throw NOT_FOUND();
    const states = await contactStates(trx, actor.id, [m.id], actor.communityId);
    const contact_values = {};
    for (const field of CONTACT_FIELDS) {
      const r = await readContact(trx, actor.id, field);
      contact_values[field] = r.value ?? null;
    }
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'profile.view', targetType: 'member', targetId: actor.id, detail: { self: true } });
    return {
      ...detailRow(m, envelope(states.get(m.id), profileValues(m))),
      ...(await profileExtras(trx, { ...m, community_id: actor.communityId })),
      area_id: m.area_id,
      email: m.email,
      contact_values,
    };
  });
}

/**
 * Read the relationship graph from the database source of truth.
 *
 * A guarantee edge is directed: member_a invited member_b. A worked-together
 * edge is undirected, so only the member opposite the current actor is exposed.
 * Profile fields still pass through the same privacy envelope as the directory.
 */
export async function listMyRelations({ actor }) {
  return withActor(actor.id, async (trx) => {
    const { rows } = await trx.raw(
      `SELECT mr.id, mr.kind, mr.member_a, mr.member_b, mr.first_work_record_id,
              mr.established_at, other.id AS other_id, other.full_name,
              other.job, other.avatar_url, other.work_status, other.status,
              a.id AS area_id, a.name AS area_name,
              wr.title AS first_work_title, wr.done_on AS first_work_done_on
         FROM member_relations mr
         JOIN members other
           ON other.id = CASE WHEN mr.member_a = ? THEN mr.member_b ELSE mr.member_a END
          AND other.community_id = mr.community_id
         LEFT JOIN areas a
           ON a.id = other.area_id AND a.community_id = other.community_id
         LEFT JOIN work_records wr
           ON wr.id = mr.first_work_record_id AND wr.community_id = mr.community_id
        WHERE mr.community_id = ? AND (mr.member_a = ? OR mr.member_b = ?)
        ORDER BY mr.established_at DESC, mr.id`,
      [actor.id, actor.communityId, actor.id, actor.id]
    );

    const states = await contactStates(
      trx,
      actor.id,
      [...new Set(rows.map((row) => row.other_id))],
      actor.communityId
    );
    const relatedMember = (row) => {
      const env = envelope(states.get(row.other_id), {
        job: row.job,
        area: areaOf(row),
        price: null,
        family: null,
      });
      return {
        id: row.other_id,
        full_name: row.full_name,
        job: env.job.value,
        area: env.area.value,
        avatar_url: row.avatar_url,
        work_status: row.work_status,
        status: row.status,
      };
    };
    const relation = (row) => ({
      id: row.id,
      kind: row.kind,
      established_at: row.established_at,
      first_work_record_id: row.first_work_record_id,
      first_work_title: row.first_work_title,
      first_work_done_on: row.first_work_done_on,
      member: relatedMember(row),
    });

    const invitedBy = rows.filter((row) => row.kind === 'guarantee' && row.member_b === actor.id).map(relation);
    const invitedMembers = rows.filter((row) => row.kind === 'guarantee' && row.member_a === actor.id).map(relation);
    const workedTogether = rows.filter((row) => row.kind === 'worked_together').map(relation);

    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'member_relations.list',
      targetType: 'member',
      targetId: actor.id,
      detail: {
        invited_by: invitedBy.length,
        invited_members: invitedMembers.length,
        worked_together: workedTogether.length,
      },
    });

    return {
      invited_by: invitedBy,
      invited_members: invitedMembers,
      worked_together: workedTogether,
    };
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

export async function updateMe({ actor, input }) {
  return withActor(actor.id, async (trx) => {
    if (Object.hasOwn(input, 'area_id') && input.area_id !== null) {
      const { rows: [area] } = await trx.raw(
        `SELECT id FROM areas WHERE id = ? AND community_id = ? AND is_active = true`,
        [input.area_id, actor.communityId]
      );
      if (!area) throw new AppError('VALIDATION_FAILED', 'Khu vực không thuộc cộng đồng hiện tại.', { status: 422 });
    }
    if (Object.hasOwn(input, 'avatar_url') && input.avatar_url !== null) {
      const match = /^\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(input.avatar_url);
      if (!match) {
        throw new AppError('VALIDATION_FAILED', 'Ảnh đại diện phải là ảnh đã tải lên hệ thống.', { status: 422 });
      }
      const { rows: [file] } = await trx.raw(
        `SELECT id FROM files
          WHERE id = ? AND community_id = ? AND owner_id = ?
            AND attached_type = 'member_avatar' AND attached_id = ?
            AND deleted_at IS NULL AND purged_at IS NULL`,
        [match[1], actor.communityId, actor.id, actor.id]
      );
      if (!file) {
        throw new AppError('VALIDATION_FAILED', 'Ảnh đại diện không thuộc hồ sơ của bạn.', { status: 422 });
      }
    }
    const profileKeys = ['full_name', 'email', 'job', 'area_id', 'bio', 'work_status', 'avatar_url'];
    const changed = profileKeys.filter((key) => Object.hasOwn(input, key));
    const has = (key) => Object.hasOwn(input, key);
    const { rows: [row] } = await trx.raw(
      `UPDATE members SET
         full_name = CASE WHEN ? THEN ? ELSE full_name END,
         email = CASE WHEN ? THEN ? ELSE email END,
         job = CASE WHEN ? THEN ? ELSE job END,
         area_id = CASE WHEN ? THEN ?::uuid ELSE area_id END,
         bio = CASE WHEN ? THEN ? ELSE bio END,
         work_status = CASE WHEN ? THEN ? ELSE work_status END,
         avatar_url = CASE WHEN ? THEN ? ELSE avatar_url END,
         updated_at = now()
       WHERE id = ? AND community_id = ? RETURNING id, full_name, email, job, area_id,
         bio, work_status, avatar_url, updated_at`,
      [has('full_name'), input.full_name ?? null, has('email'), input.email ?? null,
       has('job'), input.job ?? null, has('area_id'), input.area_id ?? null,
       has('bio'), input.bio ?? null, has('work_status'), input.work_status ?? null,
       has('avatar_url'), input.avatar_url ?? null, actor.id, actor.communityId]
    );
    const contactKeys = ['phone', 'zalo', 'messenger', 'address'].filter((key) => Object.hasOwn(input, key));
    for (const key of contactKeys) {
      await trx.raw(`SELECT contact_upsert(?, ?, ?)`, [actor.id, key, input[key]]);
    }
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'member.profile_updated', targetType: 'member', targetId: actor.id,
      detail: { fields: [...changed, ...contactKeys] } });
    return row;
  });
}

export async function requestContact({ actor, targetId, fieldKey, message }) {
  const result = await withActor(actor.id, async (trx) => {
    const { rows: [target] } = await trx.raw(
      `SELECT id FROM members WHERE id = ? AND community_id = ? AND status = 'member'`,
      [targetId, actor.communityId]
    );
    if (!target) throw NOT_FOUND();
    if (targetId === actor.id) throw new AppError('VALIDATION_FAILED', 'Không cần xin xem thông tin của chính mình.', { status: 422 });
    // Một lần bấm lại khi đơn vẫn đang chờ không được tạo thêm thông báo.
    // Đơn đã bị từ chối/đã duyệt thì được mở lại thành đơn mới và thông báo
    // lại cho chủ hồ sơ.
    const { rows: [current] } = await trx.raw(
      `SELECT * FROM contact_requests
        WHERE community_id = ? AND requester_id = ? AND target_id = ? AND field_key = ?
        FOR UPDATE`, [actor.communityId, actor.id, targetId, fieldKey]
    );
    if (current?.status === 'pending') return { row: current, notification: null };
    const { rows: [row] } = await trx.raw(
      `INSERT INTO contact_requests
        (community_id, requester_id, target_id, field_key, message)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (requester_id, target_id, field_key) DO UPDATE SET
         message = EXCLUDED.message, status = 'pending', decided_at = NULL, updated_at = now()
       RETURNING *`, [actor.communityId, actor.id, targetId, fieldKey, message ?? null]
    );
    const { rows: [notification] } = await trx.raw(
      `INSERT INTO notifications
        (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
       VALUES (?, ?, ?, 'contact_request', 'Yêu cầu xem thông tin liên hệ',
               'Một thành viên xin phép xem thông tin liên hệ của bạn.', 'contact_request', ?)
       RETURNING *`, [actor.communityId, targetId, actor.id, row.id]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'contact_request.created', targetType: 'contact_request', targetId: row.id,
      detail: { field: fieldKey, target_id: targetId } });
    return { row, notification };
  });
  if (result.notification) publishToMember(targetId, 'notification', result.notification);
  return result.row;
}

export async function listContactRequests({ actor, direction, status, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT cr.id, cr.requester_id, cr.target_id, cr.field_key, cr.message,
              cr.status, cr.decided_at, cr.created_at, cr.updated_at,
              m.full_name AS other_member_name
         FROM contact_requests cr
         JOIN members m ON m.id = CASE WHEN ? = 'incoming' THEN cr.requester_id ELSE cr.target_id END
        WHERE cr.community_id = ?
          AND ((? = 'incoming' AND cr.target_id = ?) OR (? = 'outgoing' AND cr.requester_id = ?))
          AND (?::text IS NULL OR cr.status = ?)
        ORDER BY cr.updated_at DESC LIMIT ? OFFSET ?`,
      [direction, actor.communityId, direction, actor.id, direction, actor.id,
       status ?? null, status ?? null, limit, offset]
    );
    return { data: rows, meta: { page, limit } };
  });
}

export async function decideContactRequest({ actor, id, status }) {
  const result = await withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `UPDATE contact_requests SET status = ?, decided_at = now(), updated_at = now()
        WHERE id = ? AND community_id = ? AND target_id = ? AND status = 'pending'
        RETURNING *`, [status, id, actor.communityId, actor.id]
    );
    if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy yêu cầu đang chờ này.', { status: 404 });
    const { rows: [notification] } = await trx.raw(
      `INSERT INTO notifications
        (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
       VALUES (?, ?, ?, 'system', ?, ?, 'member', ?)
       RETURNING *`, [
        actor.communityId,
        row.requester_id,
        actor.id,
        status === 'approved' ? 'Yêu cầu xem liên hệ được chấp thuận' : 'Yêu cầu xem liên hệ bị từ chối',
        status === 'approved'
          ? 'Chủ hồ sơ đã đồng ý cho bạn xem thông tin liên hệ.'
          : 'Chủ hồ sơ chưa đồng ý cho bạn xem thông tin liên hệ.',
        actor.id,
      ]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'contact_request.decided', targetType: 'contact_request', targetId: id,
      detail: { field: row.field_key, status } });
    return { row, notification };
  });
  publishToMember(result.row.requester_id, 'notification', result.notification);
  return result.row;
}

export async function getPrivacy({ actor }) {
  return withActor(actor.id, async (trx) => {
    const { rows } = await trx.raw(
      `SELECT fields.field_key, coalesce(ps.level, 'closed') AS level,
              ps.created_at, ps.updated_at
         FROM (VALUES ('phone'), ('zalo'), ('messenger'), ('address'),
                      ('job'), ('area'), ('price'), ('family')) AS fields(field_key)
         LEFT JOIN privacy_settings ps ON ps.member_id = ?
          AND ps.community_id = ? AND ps.field_key = fields.field_key
        ORDER BY fields.field_key`, [actor.id, actor.communityId]
    );
    return { data: rows };
  });
}

export async function updatePrivacy({ actor, field, level }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `INSERT INTO privacy_settings (community_id, member_id, field_key, level)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (member_id, field_key) DO UPDATE
         SET level = EXCLUDED.level, updated_at = now()
       RETURNING field_key, level, created_at, updated_at`,
      [actor.communityId, actor.id, field, level]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'privacy.updated', targetType: 'member', targetId: actor.id,
      detail: { field, level } });
    return row;
  });
}

export async function listProfileViews({ actor, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT pv.id, pv.viewer_id, pv.what, pv.viewed_at,
              m.full_name AS viewer_name, m.avatar_url
         FROM profile_views pv
         JOIN members m ON m.id = pv.viewer_id AND m.community_id = pv.community_id
        WHERE pv.target_id = ? AND pv.community_id = ?
        ORDER BY pv.viewed_at DESC LIMIT ? OFFSET ?`,
      [actor.id, actor.communityId, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(
      `SELECT count(*)::int AS total FROM profile_views
        WHERE target_id = ? AND community_id = ?`, [actor.id, actor.communityId]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'profile_views.list', targetType: 'member', targetId: actor.id,
      detail: { page, limit, count: rows.length, total } });
    return { data: rows, meta: { page, limit, total } };
  });
}
