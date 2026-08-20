import { buildApp } from './app.js';
import { config } from './config/index.js';
import { startJobs } from './jobs/index.js';

buildApp().listen(config.PORT, () => {
  console.log(`api nghe cổng ${config.PORT}`);

  // Tác vụ định kỳ bật ở ĐÂY, không ở `app.js`. `buildApp()` được bộ kiểm thử
  // gọi hàng chục lần trong một lần chạy suite; nếu bộ hẹn giờ nằm trong đó thì
  // mỗi bài test lại dựng thêm một bộ hẹn giờ và một pool kết nối chủ sở hữu.
  // `server.js` chạy đúng một lần, và chỉ chạy khi có một máy chủ thật.
  if (process.env.JOBS_ENABLED !== 'false') startJobs();
});
