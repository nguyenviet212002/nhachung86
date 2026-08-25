function go(r,id){if(r!==S.r)S.tab=0;S.r=r;S.id=id||null;location.hash=r+(id?'/'+id:'');sbCl();paint();}
window.addEventListener('hashchange',()=>{const[r,id]=location.hash.slice(1).split('/');if(r&&(r!==S.r||id!=S.id)){S.r=r;S.id=id?+id:null;paint()}});
const[r0,i0]=location.hash.slice(1).split('/');if(r0)  {S.r=r0;S.id=i0?+i0:null}
