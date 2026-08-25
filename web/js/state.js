(function () {
  'use strict';
  // S: mutable app state. Fields carried over verbatim from thiet-ke-mau.html —
  // do not add fields here that the mockup didn't have; Task 4 (auth.js) and
  // Task 8 (viec.js) add what they need directly to this object at that point.
  // afterLogin: route (và id) người dùng định vào trước khi bị chặn về màn
  // đăng nhập — router.js/auth.js đọc/ghi để quay lại đúng chỗ sau khi đăng
  // nhập xong. Thêm ở đây (Task 3) vì router.js's guardedGo() và auth.js đều
  // cần một chỗ chung để nhớ, và S là chỗ chung duy nhất của toàn ứng dụng.
  window.S = window.S || {vai:'tv',r:'viec',id:null,tab:0,wz:1,pop:null,afterLogin:null,
   f:{q:'',nghe:[],kv:[],loai:[],tt:[],khan:[],sort:'moi'}};
})();
