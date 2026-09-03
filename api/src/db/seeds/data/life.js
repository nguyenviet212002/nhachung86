import { id } from '../ids.js';
import { COMMUNITY_ID, areaAt } from './community.js';
import { byCode } from './tree.js';
import { monthsAgo } from './tree.js';

// ---------------------------------------------------------------------------
// Phần đời sống của cộng đồng — đặc tả mục 12.3: 7 tín hiệu, 5 nhu cầu việc,
// 5 yêu cầu giúp nhau, 4 hoạt động (2 có tổng kết), 12 bút toán quỹ (2 cái ≥ 1
// triệu có đủ chữ ký), 2 khoản vay.
//
// LỆCH có chủ đích khỏi mức tối thiểu đó: JOB_NEEDS có 14 tin, không phải 5 —
// để màn "Việc & hợp tác" có đủ dữ liệu demo cho người xem duyệt (đủ 11 nhóm
// nghề có ảnh minh hoạ CAT_PHOTO, đủ cả 5 job_type, đủ ba trạng thái open/
// filled/closed, và có tin trùng nhóm nghề để khối "Việc tương tự" không rỗng)
// — không vi phạm gì, đặc tả chỉ nói TỐI THIỂU 5, không nói ĐÚNG 5.
// ---------------------------------------------------------------------------

const m = (c) => byCode[c].id;

/**
 * 7 tín hiệu, mỗi chặng một cái.
 *
 * Lệch có chủ đích khỏi đặc tả: đặc tả mô tả vòng đời "created → archived",
 * nhưng `signals.status` (migration 014) chỉ có năm giá trị
 * `open/converging/closed/done/cancelled` — không có `created`, không có
 * `archived`. Bảy tín hiệu dưới đây phủ hết năm trạng thái ấy, hai trạng thái
 * đông việc nhất (`open`, `done`) có hai cái để còn thấy được biến thể khẩn
 * cấp và biến thể đã dẫn tới một bản ghi việc.
 *
 * `respond_by` của mọi tín hiệu còn mở đều ở TƯƠNG LAI. Cố ý: nếu dữ liệu mẫu
 * gieo sẵn một tín hiệu quá hạn trả lời thì tác vụ hằng giờ (Task 18) sẽ đóng
 * nó ngay lần chạy đầu, rồi lần seed sau lại mở ra — hai bên giằng nhau mãi
 * trên cùng một hàng. Dữ liệu cho tác vụ ấy do bài kiểm thử tự dựng.
 */
export const SIGNALS = [
  ['SIG-001', 'giup_gap', 'Cần người trông giúp cửa hàng buổi chiều', 'open', true, 3],
  ['SIG-002', 'can_nang_luc', 'Tìm thợ ốp lát nhận việc dài hạn', 'open', false, 14],
  ['SIG-003', 'keu_goi', 'Góp sách vở đầu năm học cho các cháu', 'converging', false, 21],
  ['SIG-004', 'tim_nguoi', 'Tìm người biết làm hồ sơ vay ngân hàng', 'closed', false, null],
  ['SIG-005', 'chia_se_co_hoi', 'Xưởng may tuyển 5 người, ưu tiên anh em 86', 'done', false, null],
  ['SIG-006', 'giup_gap', 'Nhà bị dột sau bão, cần lợp lại mái', 'done', true, null],
  ['SIG-007', 'can_nang_luc', 'Cần người dạy kèm tiếng Anh cấp hai', 'cancelled', false, null],
].map(([codeStr, type, title, status, urgent, days], i) => ({
  id: id('signal:' + codeStr),
  community_id: COMMUNITY_ID,
  code: codeStr,
  created_by: m('M' + String(2 + i).padStart(2, '0')),
  type,
  title,
  body: 'Nội dung tín hiệu mẫu, viết đủ dài để thử tìm kiếm tiếng Việt có dấu.',
  area_id: areaAt(i),
  urgent,
  ask: 'Ai giúp được nhắn lại giúp trước ngày hẹn.',
  respond_by: days === null ? null : futureDays(days),
  status,
}));

function futureDays(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(3, 0, 0, 0);
  return d.toISOString();
}

/**
 * 14 nhu cầu việc làm, nội dung đầy đủ — dùng hết các trường Task 7 đã mở ở
 * migration 041 (profession/people_needed/start_note|start_at/requirements/
 * warnings/contact_owner/contact_policy/close_at), không dừng ở
 * title/description/terms như bản 5-tin cũ.
 *
 * `profession` của MỌI tin khớp CHÍNH XÁC một khoá trong CAT_PHOTO
 * (web/index.html) — 'Xây dựng'/'Vận tải'/'Kế toán'/'Y tế'/'Nông sản'/
 * 'Giáo dục'/'Cơ khí'/'Dọn dẹp'/'Điện nước'/'Sửa xe'/'Ẩm thực' — để MỖI tin tự
 * có ảnh minh hoạ thật ở thẻ danh sách lẫn màn chi tiết (viec-detail's
 * fallbackCover/homeCardHtml's `it.cover || catPhotoUrl(it.tag)`), dù chưa
 * seed ảnh chụp thật nào qua job_need_images.
 *
 * CỐ Ý KHÔNG seed job_need_images/files ở đây: bảng `files.attached_type` chỉ
 * là danh sách trắng 'member_avatar'/'member_cover' (migration 030), và
 * ATTACH_READERS trong modules/files/service.js cũng chỉ khai quyền đọc cho
 * đúng hai loại đó — job_need_images tồn tại (migration 041) nhưng "ai đọc
 * được ảnh việc" CHƯA được mở, đúng như "giai đoạn 1" hai chỗ đó ghi rõ. Chèn
 * thẳng một hàng `files` với attached_type khác hai giá trị trên sẽ vỡ CHECK;
 * còn để NULL thì theo đúng luật hiện tại chỉ chính chủ đọc được — ảnh coi
 * như không ai xem thấy. Mở khoá đó là một quyết định bảo mật cần sửa ở CẢ
 * hai chỗ cùng lúc (không phải việc của một lượt seed dữ liệu mẫu), nên demo
 * "có ảnh" ở đây dựa hẳn vào ảnh minh hoạ nhóm nghề phía trình duyệt.
 *
 * Giữ NGUYÊN cách đánh id theo CHỈ SỐ (`job_need:0`..`job_need:13`, như bản cũ
 * — không đổi sang khoá chữ) để upsert() ghi ĐÈ đúng 5 hàng đã seed từ trước
 * thay vì bỏ mồ côi chúng bên cạnh 14 hàng mới.
 */
export const JOB_NEEDS = [
  {
    title: 'Cần thợ điện nước sửa đường ống rò rỉ gấp',
    poster: 'M10', jobType: 'thoi_vu', status: 'open', profession: 'Điện nước',
    description: 'Đường ống nước sau nhà bị rò rỉ hai hôm nay, nước thấm cả xuống nền bếp. Cần thợ có kinh nghiệm tới xem và sửa trong ngày, có thể phải thay một đoạn ống cũ đã mục.',
    terms: '300.000–500.000đ tuỳ mức độ hỏng, thoả thuận cụ thể sau khi thợ tới xem thực tế.',
    peopleNeeded: 1, startNote: 'Càng sớm càng tốt, tốt nhất trong hôm nay hoặc sáng mai.',
    requirements: 'Có đồ nghề sửa ống nước riêng, ưu tiên thợ đã quen việc sửa ống âm tường.',
    warnings: 'Nhà trong ngõ nhỏ, ô tô không vào được — thợ đi xe máy giúp.',
    contactOwner: 'Anh Cường (chủ nhà)', contactPolicy: 'anyone', closeDays: 5,
  },
  {
    title: 'Hợp tác lắp đặt hệ thống điện nước cho khu nhà trọ mới',
    poster: 'M18', jobType: 'hop_tac', status: 'filled', profession: 'Điện nước',
    description: 'Khu nhà trọ 12 phòng đang xây xong phần thô, cần đội thi công điện nước trọn gói: đi dây, lắp công tơ riêng từng phòng, đường ống cấp thoát nước.',
    terms: 'Trọn gói theo báo giá đội thi công, tạm ứng 40% trước khi bắt đầu.',
    peopleNeeded: 3, contactOwner: null, contactPolicy: 'approval',
  },
  {
    title: 'Cần thợ sơn lại toàn bộ nhà 2 tầng',
    poster: 'M11', jobType: 'thoi_vu', status: 'open', profession: 'Xây dựng',
    description: 'Sơn lại toàn bộ nhà 2 tầng, cả trong lẫn ngoài, tường cũ đã bong tróc nhiều chỗ cần cạo và bả lại trước khi sơn. Dự kiến làm khoảng 3-4 ngày.',
    terms: '400.000đ/ngày công, chủ nhà lo sơn và vật tư.',
    peopleNeeded: 2, startNote: 'Bắt đầu được ngay khi chốt người, không cần chờ.',
    requirements: 'Có kinh nghiệm sơn nhà dân dụng, biết pha màu theo mẫu.',
    contactOwner: 'Chị Hạnh', contactPolicy: 'anyone', closeDays: 10,
  },
  {
    title: 'Tuyển thợ xây dài hạn cho công trình nhà ở dân dụng',
    poster: 'M12', jobType: 'dai_han', status: 'open', profession: 'Xây dựng',
    description: 'Đội xây dựng đang nhận thêm thợ chính và thợ phụ làm dài hạn, công trình chủ yếu là nhà ở dân dụng trong và ngoài xã. Việc đều quanh năm, không lo thất nghiệp giữa mùa.',
    terms: 'Thợ chính 350.000đ/ngày, thợ phụ 250.000đ/ngày, trả lương theo tuần.',
    peopleNeeded: 4,
    requirements: 'Thợ chính cần biết đọc bản vẽ cơ bản; thợ phụ không yêu cầu kinh nghiệm, có sức khoẻ là nhận.',
    contactOwner: 'Anh Sơn (đội trưởng)', contactPolicy: 'anyone', closeDays: 30,
  },
  {
    title: 'Cần xe tải nhỏ chở đồ chuyển nhà trong ngày',
    poster: 'M13', jobType: 'thoi_vu', status: 'open', profession: 'Vận tải',
    description: 'Chuyển nhà từ xã bên sang, đồ đạc gồm giường tủ, bàn ghế và khoảng 20 thùng carton, quãng đường chừng 8km. Cần xe tải nhỏ và 1-2 người phụ bốc vác.',
    terms: '600.000đ trọn gói cả chuyến, đã tính công bốc vác hai đầu.',
    peopleNeeded: 1, startAtDays: 4,
    requirements: 'Xe tải thùng kín hoặc bạt, tránh làm ướt đồ nếu trời mưa.',
    contactOwner: 'Anh Nam', contactPolicy: 'anyone', closeDays: 6,
  },
  {
    title: 'Tuyển thợ hàn cơ khí làm việc lâu dài tại xưởng',
    poster: 'M14', jobType: 'dai_han', status: 'open', profession: 'Cơ khí',
    description: 'Xưởng cơ khí chuyên làm cổng sắt, lan can, mái tôn cần tuyển thợ hàn có tay nghề, làm việc ổn định lâu dài, có chỗ ở lại cho thợ ở xa nếu cần.',
    terms: 'Lương khởi điểm 9-12 triệu/tháng tuỳ tay nghề, thử việc 1 tháng.',
    peopleNeeded: 2,
    requirements: 'Biết hàn điện, hàn hơi cơ bản; ưu tiên người đã có kinh nghiệm làm cổng sắt, lan can.',
    warnings: 'Môi trường xưởng nhiều bụi và tiếng ồn, cần chịu được cường độ làm việc.',
    contactOwner: 'Anh Kiên (chủ xưởng)', contactPolicy: 'approval', closeDays: 20,
  },
  {
    title: 'Hỏi kinh nghiệm sửa cổng sắt bị kẹt bánh xe',
    poster: 'M19', jobType: 'hoi_tim', status: 'open', profession: 'Cơ khí',
    description: 'Cổng sắt kéo tay nhà mình bị kẹt bánh xe dưới ray, kéo rất nặng tay mấy hôm nay. Không biết là do lệch ray hay hỏng bánh, có ai từng gặp và biết cách xử lý không, chỉ giúp mình với.',
    terms: null, peopleNeeded: null,
    requirements: 'Chỉ cần chia sẻ kinh nghiệm hoặc gợi ý chỗ sửa uy tín, không nhất thiết phải tới tận nơi.',
    contactOwner: null, contactPolicy: 'anyone', closeDays: 14,
  },
  {
    title: 'Cần thợ sửa xe máy tại nhà, xe không nổ được máy',
    poster: 'M15', jobType: 'thoi_vu', status: 'open', profession: 'Sửa xe',
    description: 'Xe máy để lâu không đi, giờ đề mãi không nổ máy, nghi do bugi hoặc bình ắc quy yếu. Nhà không tiện dắt xe ra tiệm, cần thợ tới xem tại nhà giúp.',
    terms: 'Công + phụ tùng thay (nếu có) theo giá thị trường, trả tiền mặt ngay sau khi xong.',
    peopleNeeded: 1, startNote: 'Tiện lúc nào ghé qua cũng được trong tuần này.',
    contactOwner: 'Chị Yến', contactPolicy: 'anyone', closeDays: 7,
  },
  {
    title: 'Cần kế toán làm sổ sách theo quý cho cửa hàng tạp hoá',
    poster: 'M16', jobType: 'hop_tac', status: 'open', profession: 'Kế toán',
    description: 'Cửa hàng tạp hoá quy mô nhỏ, cần người làm sổ sách, kê khai thuế theo quý, không yêu cầu ngồi tại chỗ — có thể làm từ xa, gửi hoá đơn chứng từ qua Zalo.',
    terms: '1.500.000đ/quý, thanh toán sau khi nộp báo cáo xong.',
    peopleNeeded: 1,
    requirements: 'Có kinh nghiệm kế toán hộ kinh doanh, nắm được quy định kê khai thuế hiện hành.',
    contactOwner: null, contactPolicy: 'approval', closeDays: 15,
  },
  {
    title: 'Cần người chăm sóc bà cụ ban đêm, có kinh nghiệm điều dưỡng',
    poster: 'M17', jobType: 'thoi_vu', status: 'open', profession: 'Y tế',
    description: 'Bà cụ 82 tuổi mới xuất viện sau phẫu thuật, ban ngày con cháu thay nhau chăm được nhưng ban đêm cần người có kinh nghiệm túc trực, theo dõi tình trạng và hỗ trợ đi lại.',
    terms: '250.000đ/đêm, làm liên tục khoảng 2 tuần, có thể kéo dài thêm tuỳ tình hình.',
    peopleNeeded: 1, startNote: 'Cần bắt đầu ngay trong vài ngày tới.',
    requirements: 'Ưu tiên người từng làm điều dưỡng hoặc chăm người bệnh, biết đo huyết áp cơ bản.',
    warnings: 'Công việc thức đêm, cần người thật sự sắp xếp được thời gian, tránh nhận rồi bỏ giữa chừng.',
    contactOwner: 'Chị Lan (con gái)', contactPolicy: 'approval', closeDays: 4,
  },
  {
    title: 'Cần người thu hoạch rau vụ đông, làm trong 3 ngày',
    poster: 'M20', jobType: 'thoi_vu', status: 'closed', profession: 'Nông sản',
    description: 'Ruộng rau vụ đông đã tới lúc thu hoạch, cần người phụ cắt, bó và đóng sọt chuyển ra xe kịp phiên chợ sớm. Việc đã tìm đủ người, cảm ơn mọi người đã quan tâm.',
    terms: '200.000đ/ngày, bao bữa trưa.',
    peopleNeeded: 3,
    contactOwner: null, contactPolicy: 'anyone',
  },
  {
    title: 'Nhận dạy nghề may cho người mới bắt đầu, học việc có lương',
    poster: 'M21', jobType: 'hoc_nghe', status: 'open', profession: 'Giáo dục',
    description: 'Xưởng may nhỏ nhận dạy nghề cho người chưa biết may, học từ cơ bản: cắt, ráp, vắt sổ. Vừa học vừa làm, có phụ cấp ngay từ tháng đầu, thạo việc thì lên lương theo sản phẩm.',
    terms: 'Phụ cấp học việc 2.000.000đ/tháng đầu, sau đó tính theo sản phẩm hoàn thành.',
    peopleNeeded: 2, startNote: 'Nhận học viên mới đầu mỗi tháng.',
    requirements: 'Không cần biết trước, chỉ cần chăm chỉ và kiên trì học trong ít nhất 2 tháng đầu.',
    contactOwner: 'Cô Nga (chủ xưởng)', contactPolicy: 'anyone', closeDays: 25,
  },
  {
    title: 'Cần người dọn dẹp nhà cửa tổng vệ sinh cuối năm',
    poster: 'M22', jobType: 'thoi_vu', status: 'open', profession: 'Dọn dẹp',
    description: 'Nhà 3 tầng cần tổng vệ sinh trước Tết: lau cửa kính, dọn ban công, quét mạng nhện, lau chùi bếp và nhà tắm. Ước chừng làm trong một ngày là xong.',
    terms: '350.000đ trọn ngày, chủ nhà chuẩn bị sẵn dụng cụ vệ sinh cơ bản.',
    peopleNeeded: 2, startAtDays: 12,
    contactOwner: 'Anh Toàn', contactPolicy: 'anyone', closeDays: 15,
  },
  {
    title: 'Hợp tác mở quầy bán phở buổi sáng, góp vốn ăn chia',
    poster: 'M23', jobType: 'hop_tac', status: 'open', profession: 'Ẩm thực',
    description: 'Đã có mặt bằng đầu ngõ chợ, đang tìm người biết nấu phở ngon cùng hợp tác mở quầy bán buổi sáng, góp vốn ban đầu và chia lợi nhuận theo thoả thuận.',
    terms: 'Góp vốn ban đầu khoảng 15 triệu/người, chia lợi nhuận theo tỷ lệ góp vốn.',
    peopleNeeded: 1,
    requirements: 'Biết nấu phở ngon, có thể nấu thử trước khi hai bên quyết định hợp tác chính thức.',
    contactOwner: 'Anh Trung', contactPolicy: 'approval', closeDays: 20,
  },
].map((j, i) => ({
  id: id('job_need:' + i),
  community_id: COMMUNITY_ID,
  poster_id: m(j.poster),
  title: j.title,
  description: j.description,
  terms: j.terms ?? null,
  area_id: areaAt(i + 6),
  job_type: j.jobType,
  status: j.status,
  profession: j.profession,
  people_needed: j.peopleNeeded ?? null,
  start_note: j.startNote ?? null,
  start_at: j.startAtDays ? futureDays(j.startAtDays) : null,
  requirements: j.requirements ?? null,
  warnings: j.warnings ?? null,
  contact_owner: j.contactOwner ?? null,
  contact_policy: j.contactPolicy ?? 'approval',
  close_at: j.closeDays ? futureDays(j.closeDays) : null,
}));

/** 5 yêu cầu giúp nhau, hai cái có suất để thử `fn_aid_slot_capacity`. */
export const AID_REQUESTS = [
  ['Cần người chở đồ giúp ngày chuyển nhà', 'normal', 'queued', 2],
  ['Nhà bị dột, cần người lợp lại mái', 'urgent', 'matched', 3],
  ['Cần người trông cháu buổi sáng một tuần', 'normal', 'done', 0],
  ['Xin giúp dựng rạp đám hiếu', 'urgent', 'closed', 0],
  ['Cần người đưa đi khám ở tỉnh', 'normal', 'queued', 1],
].map(([title, urgency, status, slots], i) => ({
  id: id('aid_request:' + i),
  community_id: COMMUNITY_ID,
  requester_id: m('M' + String(20 + i).padStart(2, '0')),
  title,
  description: 'Mô tả yêu cầu giúp nhau mẫu.',
  area_id: areaAt(i + 4),
  urgency,
  status,
  slots: slots === 0 ? [] : [{
    id: id('aid_slot:' + i),
    community_id: COMMUNITY_ID,
    aid_request_id: id('aid_request:' + i),
    title: 'Suất giúp việc',
    needed: slots,
    // Một người nhận suất — hàng này đi qua `trg_ast_1_self_only`, nên seed
    // phải đóng dấu đúng người đó chứ không phải người tạo yêu cầu.
    takers: [m('M' + String(30 + i).padStart(2, '0'))],
  }],
}));

/**
 * 4 hoạt động, 2 đã có tổng kết.
 *
 * THỨ TỰ GHI LÀ MỘT PHẦN CỦA DỮ LIỆU: `trg_activity_summary_required`
 * (migration 017) từ chối tạo một hoạt động dùng quỹ khi trong cộng đồng còn
 * một hoạt động dùng quỹ ĐÃ XONG mà CHƯA có bản tổng kết. Nên hai hoạt động
 * dùng quỹ đã xong phải được ghi kèm bản tổng kết NGAY sau nó, trước khi hoạt
 * động dùng quỹ tiếp theo ra đời. Đảo thứ tự là seed đỏ — và đỏ đúng lý do.
 */
export const ACTIVITIES = [
  {
    key: 'act-tet', title: 'Gặp mặt đầu xuân Bính Dần',
    category: 'gap_mat', uses_fund: true, status: 'done',
    starts_at: '2026-02-14T02:00:00Z', ends_at: '2026-02-14T10:00:00Z',
    summary: { body: 'Gặp mặt 47 người, chi phí thuê hội trường và nước uống.', total_spent: '4200000' },
  },
  {
    key: 'act-trung-thu', title: 'Trung thu cho các cháu',
    category: 'thien_nguyen', uses_fund: true, status: 'done',
    starts_at: '2025-09-28T10:00:00Z', ends_at: '2025-09-28T14:00:00Z',
    summary: { body: 'Tặng 120 suất quà, có bản kê chi tiết kèm theo.', total_spent: '9800000' },
  },
  {
    key: 'act-bong-da', title: 'Giải bóng đá giao hữu các khu vực',
    category: 'the_thao', uses_fund: false, status: 'done',
    starts_at: '2026-05-10T00:00:00Z', ends_at: '2026-05-10T09:00:00Z',
    summary: null,
  },
  {
    key: 'act-hoc-bong', title: 'Trao học bổng đầu năm học',
    category: 'thien_nguyen', uses_fund: true, status: 'planned',
    starts_at: futureDays(30), ends_at: futureDays(31),
    summary: null,
  },
].map((a, i) => ({
  ...a,
  id: id('activity:' + a.key),
  community_id: COMMUNITY_ID,
  description: 'Mô tả hoạt động mẫu.',
  area_id: areaAt(i),
  created_by: m('M01'),
  summary_id: a.summary ? id('activity_summary:' + a.key) : null,
}));

/**
 * 12 bút toán quỹ. Hai cái ≥ 1 triệu (ngưỡng `fund_two_approver_threshold`,
 * mặc định 1.000.000) có ĐỦ HAI CHỮ KÝ approver, và hai người ký đó KHÁC người
 * tạo bút toán — `fn_fund_valid_signatures` không đếm chữ ký của chính người
 * tạo, đúng tinh thần mục 7.4.
 *
 * `locked = true` cho hai bút toán lớn: sổ đã chốt. Hệ quả trực tiếp là chúng
 * chỉ ghi được MỘT LẦN (`trg_fund_entry_locked` chặn mọi UPDATE sau đó), nên
 * lần chạy seed thứ hai phải bỏ qua chứ không được `ON CONFLICT DO UPDATE`.
 */
// Mười bút toán còn lại đều DƯỚI một triệu — không phải chuyện thẩm mỹ:
// `fn_fund_two_approvers` so `abs(amount)` với ngưỡng, nên một khoản THU 3,5
// triệu cũng đòi hai chữ ký y như một khoản CHI 3,5 triệu. Đặc tả nói đúng hai
// bút toán ≥ 1 triệu, nên mười cái kia phải thật sự nhỏ hơn ngưỡng.
export const FUND_ENTRIES = [
  ['Thu quỹ tháng 01', '850000', '2026-01-05', false, null],
  ['Thu quỹ tháng 02', '900000', '2026-02-05', false, null],
  ['Chi nước uống buổi họp', '-320000', '2026-02-10', false, null],
  ['Chi in ấn giấy tờ', '-150000', '2026-02-18', false, null],
  ['Thu quỹ tháng 03', '880000', '2026-03-05', false, null],
  ['Chi thuê hội trường gặp mặt', '-4200000', '2026-02-15', true, ['M01', 'M02']],
  ['Thu ủng hộ của anh em xa', '640000', '2026-03-20', false, null],
  ['Chi quà trung thu cho các cháu', '-9800000', '2025-09-29', true, ['M02', 'M03']],
  ['Chi hoa viếng đám hiếu', '-500000', '2026-04-02', false, null],
  ['Thu quỹ tháng 04', '910000', '2026-04-05', false, null],
  ['Chi sửa loa đài dùng chung', '-780000', '2026-04-22', false, null],
  ['Thu lãi gửi ngân hàng', '210000', '2026-05-01', false, null],
].map(([purpose, amount, occurredOn, locked, signers], i) => ({
  id: id('fund_entry:' + i),
  community_id: COMMUNITY_ID,
  amount,
  purpose,
  occurred_on: occurredOn,
  activity_id: null,
  locked,
  // Người ghi sổ là M04 (`tech`), KHÔNG mang vai `approver` — nhờ vậy hai chữ
  // ký của bút toán lớn chắc chắn là của hai người khác.
  created_by: m('M04'),
  signers: (signers ?? []).map((c) => m(c)),
}));

/** 2 khoản vay TingTingVác. */
export const LOANS = [
  {
    key: 'loan-1', borrower: 'M15', amount: '15000000', status: 'disbursed',
    purpose: 'Mua máy hàn mới cho xưởng', due_on: '2026-12-31', disbursed_on: '2026-03-01',
    guarantors: ['M02', 'M05'],
  },
  {
    key: 'loan-2', borrower: 'M28', amount: '8000000', status: 'repaying',
    purpose: 'Sửa lại mái nhà sau bão', due_on: '2026-10-31', disbursed_on: '2026-01-15',
    guarantors: ['M03'],
  },
].map((l) => ({
  ...l,
  id: id('loan:' + l.key),
  community_id: COMMUNITY_ID,
  borrower_id: m(l.borrower),
  guarantor_ids: l.guarantors.map((c) => m(c)),
}));

export { monthsAgo };
