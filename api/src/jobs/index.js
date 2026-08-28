import { jobsKnex, closeJobsKnex } from './db.js';
import { withJobLock } from './lib.js';
import * as trustRecount from './trust-recount.js';
import * as overdue from './overdue.js';
import * as reminders from './reminders.js';
import * as auditPartition from './audit-partition.js';
import * as purgeJoinSecrets from './purge-join-secrets.js';
import * as purgeIdempotencyKeys from './purge-idempotency-keys.js';

// ---------------------------------------------------------------------------
// Khung tác vụ định kỳ — Task 18, bước 3.
//
// Ba khoản nợ kỹ thuật cùng chờ đúng khung này (progress.md), và cả ba được trả
// ở đây:
//   * "tác vụ 03:15 hằng đêm tính lại member_trust_stats"  → trust-recount.js
//   * "dọn join_request_secrets của đơn bị từ chối"        → purge-join-secrets.js
//   * "tạo phân mảnh audit_log tháng sau"                  → audit-partition.js
//
// VÌ SAO KHÔNG DÙNG THƯ VIỆN LỊCH (node-cron, v.v.): cả năm tác vụ ở đây chỉ
// cần "mỗi giờ ở phút X" hoặc "mỗi ngày lúc H:MM". Một phụ thuộc mới cho từng
// ấy việc là thêm một thứ phải theo dõi bản vá bảo mật, đổi lấy hai mươi dòng.
// (Lịch của CONTAINER SAO LƯU thì khác — nó dùng `dcron` thật, vì nó chạy
// những việc mà nếu bỏ lỡ thì phải biết là đã bỏ lỡ.)
//
// GIỚI HẠN, nói thẳng: bộ hẹn giờ này chạy TRONG tiến trình `api`. Nếu tiến
// trình đang tắt lúc 03:15 thì lượt ấy mất, và không có ai bù. Với năm tác vụ
// hiện tại, hậu quả của một lượt mất là "hoãn 24 giờ", trừ `audit.partition` —
// nên chính tác vụ ấy chạy hằng ngày và tạo trước hai tháng thay vì một.
// ---------------------------------------------------------------------------

export const JOBS = [auditPartition, trustRecount, purgeJoinSecrets, purgeIdempotencyKeys, overdue, reminders];

/** Lịch khớp không? `hour: null` nghĩa là mọi giờ. */
export function matches(schedule, date) {
  if (date.getMinutes() !== schedule.minute) return false;
  return schedule.hour === null || date.getHours() === schedule.hour;
}

/**
 * Chạy MỘT tác vụ ngay lập tức, bỏ qua lịch. Đây cũng là đường mà bộ kiểm thử
 * đi — không có bài test nào phải đợi tới 03:15, và không có mã nào chỉ tồn tại
 * cho bài test.
 */
export async function runJob(job, knex = jobsKnex()) {
  return withJobLock(knex, job.key, (trx) => job.run(trx));
}

/**
 * Chạy mọi tác vụ đến giờ. Một tác vụ hỏng KHÔNG được làm những tác vụ còn lại
 * không chạy: nếu `trust.recount` chết vì một lý do gì đó, `audit.partition`
 * vẫn phải tạo được phân mảnh tháng sau, nếu không thì một lỗi nhỏ kéo theo một
 * lỗi dừng hệ thống vào ngày đầu tháng.
 */
export async function tick(date = new Date(), { logger = console } = {}) {
  const knex = jobsKnex();
  const ran = [];
  for (const job of JOBS) {
    if (!matches(job.schedule, date)) continue;
    try {
      const result = await runJob(job, knex);
      if (result === null) logger.info?.(`tác vụ ${job.key}: một tiến trình khác đang chạy, bỏ lượt`);
      else {
        ran.push({ key: job.key, result });
        logger.info?.(`tác vụ ${job.key}: ${JSON.stringify(result)}`);
      }
    } catch (err) {
      // Không log nội dung lỗi CSDL nguyên văn ở mức cao hơn message: thông
      // báo lỗi của Postgres có thể mang theo giá trị của cột vi phạm.
      logger.error?.(`tác vụ ${job.key} thất bại: ${err.message}`);
    }
  }
  return ran;
}

let timer = null;

/** Gọi từ `server.js`. Không gọi từ `app.js` — bộ kiểm thử dựng app rất nhiều lần. */
export function startJobs({ logger = console } = {}) {
  if (timer) return timer;
  // Thức dậy đúng đầu mỗi phút thay vì cứ 60 giây một lần kể từ lúc khởi động:
  // nếu không, một lần khởi động lại lúc 03:14:40 sẽ làm mọi mốc bị lệch 40
  // giây mãi mãi, và một tác vụ hẹn ở phút 15 có thể không bao giờ khớp.
  const align = 60_000 - (Date.now() % 60_000);
  setTimeout(() => {
    tick(new Date(), { logger });
    timer = setInterval(() => tick(new Date(), { logger }), 60_000);
    if (timer.unref) timer.unref();
  }, align).unref?.();
  logger.info?.(`đã bật ${JOBS.length} tác vụ định kỳ`);
  return true;
}

export async function stopJobs() {
  if (timer) clearInterval(timer);
  timer = null;
  await closeJobsKnex();
}
