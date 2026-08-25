function go(r,id){if(r!==S.r)S.tab=0;S.r=r;S.id=id||null;location.hash=r+(id?'/'+id:'');sbCl();paint();}

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
    S.afterLogin={route:r,id:id?+id:null};
    go('login',null);
    return;
  }
  S.r=r;S.id=id?+id:null;paint();
});
const[r0,i0]=location.hash.slice(1).split('/');if(r0)  {S.r=r0;S.id=i0?+i0:null}
