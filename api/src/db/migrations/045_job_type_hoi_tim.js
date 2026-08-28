// Frontend "Hỏi & tìm" (hỏi thông tin, không thuê ai) đã có UI từ trước nhưng
// bị chặn khi gửi vì job_type chỉ nhận 4 giá trị (dai_han/thoi_vu/hop_tac/
// hoc_nghe) — không có giá trị nào cho loại "chỉ hỏi". Thêm 'hoi_tim' vào
// đúng ràng buộc CHECK hiện có (job_needs_job_type_check), không đổi gì khác
// — loại này vẫn dùng chung bảng job_needs, vẫn nhận applications/connections
// như các loại việc khác (trả lời = ứng tuyển kèm ghi chú).
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE job_needs DROP CONSTRAINT job_needs_job_type_check;
    ALTER TABLE job_needs ADD CONSTRAINT job_needs_job_type_check
      CHECK (job_type IN ('dai_han','thoi_vu','hop_tac','hoc_nghe','hoi_tim'));
  `);
}

export async function down(knex) {
  await knex.raw(`
    ALTER TABLE job_needs DROP CONSTRAINT job_needs_job_type_check;
    ALTER TABLE job_needs ADD CONSTRAINT job_needs_job_type_check
      CHECK (job_type IN ('dai_han','thoi_vu','hop_tac','hoc_nghe'));
  `);
}
