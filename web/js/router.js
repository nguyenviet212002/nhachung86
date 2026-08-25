function go(r,id){if(r!==S.r)S.tab=0;S.r=r;S.id=id||null;location.hash=r+(id?'/'+id:'');sbCl();paint();}

// id từ hash luôn là CHUỖI. Mọi mảng giả còn lại (JOBS/AID/ACTS/...) dùng id
// SỐ nguyên nhỏ và so khớp bằng ===, nên phải ép về số để chúng còn tìm thấy
// mục đã chọn — nhưng dữ liệu thật (vd. GET /members) dùng uuid, và `+uuid`
// ra NaN. parseRouteId giữ số khi ép được, giữ nguyên chuỗi khi không — vá cho
// CẢ HAI loại id cùng đi qua chỗ này mà không đổi hành vi của id số.
function parseRouteId(id){if(!id)return null;var n=+id;return isNaN(n)?id:n;}

// Route nào không cần đăng nhập vẫn xem được — chỉ 'login' hiện tại.
var PUBLIC_ROUTES=['login'];

// Cửa vào có gác cho mọi điều hướng do NGƯỜI DÙNG bấm (nav, nút trên đầu
// trang): chưa đăng nhập mà bấm vào một route cần đăng nhập thì nhớ lại
// route đó (S.afterLogin) rồi chuyển sang màn đăng nhập thay vì route đã
// định. go() bản thân KHÔNG đổi — auth.js gọi go() thẳng sau khi đăng nhập
// xong để nhảy tới đích, gọi guardedGo() ở đó sẽ chỉ dội ngược lại đăng nhập
// vì token vừa lưu có thể chưa kịp phản ánh trong một điều kiện đua hiếm gặp.
function guardedGo(r,id){
  if(PUBLIC_ROUTES.indexOf(r)===-1 && !api.isLoggedIn()){
    S.afterLogin={route:r,id:id||null};
    r='login';id=null;
  }
  go(r,id);
}

window.addEventListener('hashchange',()=>{
  const[r,id]=location.hash.slice(1).split('/');
  if(!r||(r===S.r&&id==S.id))return;
  // Sửa hash bằng tay hoặc bấm lùi/tới của trình duyệt cũng phải qua gác cổng
  // giống hệt guardedGo() — đây là đường vòng còn lại để tới một route cần
  // đăng nhập mà không qua nav.
  if(PUBLIC_ROUTES.indexOf(r)===-1 && !api.isLoggedIn()){
    S.afterLogin={route:r,id:parseRouteId(id)};
    go('login',null);
    return;
  }
  S.r=r;S.id=parseRouteId(id);paint();
});
const[r0,i0]=location.hash.slice(1).split('/');if(r0)  {S.r=r0;S.id=parseRouteId(i0)}
