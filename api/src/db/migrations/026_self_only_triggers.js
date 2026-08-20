// Ba trigger `fn_self_only` của Task 13 — và VÌ SAO CHÚNG Ở ĐÂY CHỨ KHÔNG Ở
// 014/016 như kế hoạch viết.
//
// ==========================================================================
// ĐIỂM SAI TRONG KẾ HOẠCH/ĐẶC TẢ, đã kiểm bằng chạy thật.
//
// Kế hoạch Task 13, Bước 4: "`016_aid.js` — 5 bảng + `trg_slot_self_only` dùng
// lại `fn_self_only('member_id')`", và sổ phán quyết ghi "Task 13 chỉ cần thêm
// một CREATE TRIGGER". Đặc tả mục 11 cũng gán `trg_slot_self_only` cho `016`.
//
// Câu đó KHÔNG CHẠY ĐƯỢC. `fn_self_only` được tạo ở migration **025**
// (Ruling C8: T12 không sửa 011 đã chạy, nên hàm dời sang tệp mới 025). Trên
// một CSDL trắng, knex chạy theo thứ tự tên tệp: 016 chạy TRƯỚC 025, tức lúc đó
// hàm chưa tồn tại. Và `CREATE TRIGGER … EXECUTE FUNCTION fn_self_only(…)` đòi
// hàm phải CÓ NGAY lúc chạy — khác thân plpgsql, vốn phân giải tên bảng/hàm
// TRỄ (đó là lý do 006 tạo được contact_read khi audit_log chưa có).
// Hậu quả nếu chép nguyên văn: `42883: function fn_self_only() does not exist`,
// toàn bộ migration dừng, hệ thống không dựng nổi từ số không.
//
// Đây là hệ quả dây chuyền của Ruling C8 mà cả hai tài liệu chưa cập nhật: dời
// hàm sang 025 thì mọi trigger dùng nó cũng phải ở SAU 025.
//
// Cách sửa rẻ nhất và không phá gì: gom cả ba `CREATE TRIGGER` vào một tệp
// chạy sau 025. Không sửa 016 (nó vẫn tự đủ nghĩa), không sửa 025 (Ruling C8).
// ==========================================================================
//
// BA CHỖ, MỘT LUẬT — nguyên tắc 1 ở dạng cụ thể nhất: không ai ký thay ai.
//   * aid_slot_takers.member_id  — tự nhận suất, không điền hộ (spec mục 4.5).
//     Điền hộ nghĩa là một người bị ghi tên vào việc mình chưa nhận, rồi hoặc
//     họ không tới (cộng đồng mất một suất), hoặc họ phải tới vì đã có tên.
//   * signal_responses.responder_id — không trả lời thay ai. Câu trả lời cho
//     một tín hiệu là một cam kết ("nhận việc"), không phải một cái tick.
//   * signal_forwards.from_member_id — chuyển tiếp là NHẬN TRÁCH NHIỆM ("tên
//     anh Tuấn đi kèm"). Gán trách nhiệm đó cho người khác đúng là thứ nguyên
//     tắc 1 sinh ra để cấm, và `NOT NULL` một mình không bắt được: nó bắt được
//     ô TRỐNG, không bắt được ô điền TÊN NGƯỜI KHÁC.
export async function up(knex) {
  await knex.raw(`
    CREATE TRIGGER trg_slot_self_only BEFORE INSERT ON aid_slot_takers
      FOR EACH ROW EXECUTE FUNCTION fn_self_only('member_id');

    CREATE TRIGGER trg_sig_resp_self_only BEFORE INSERT ON signal_responses
      FOR EACH ROW EXECUTE FUNCTION fn_self_only('responder_id');

    CREATE TRIGGER trg_sig_fwd_self_only BEFORE INSERT ON signal_forwards
      FOR EACH ROW EXECUTE FUNCTION fn_self_only('from_member_id');
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_sig_fwd_self_only ON signal_forwards;
    DROP TRIGGER IF EXISTS trg_sig_resp_self_only ON signal_responses;
    DROP TRIGGER IF EXISTS trg_slot_self_only ON aid_slot_takers;
  `);
}
