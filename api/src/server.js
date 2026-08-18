import { buildApp } from './app.js';
import { config } from './config/index.js';

buildApp().listen(config.PORT, () => {
  console.log(`api nghe cổng ${config.PORT}`);
});
