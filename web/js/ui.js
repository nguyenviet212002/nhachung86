const P={ck:'<path d="M20 6 9 17l-5-5"/>',hm:'<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',us:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>',wk:'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',cl:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',cn:'<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 10h5M9.5 14h5"/>',pf:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',sh:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',hr:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',im:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',gd:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',st:'<path d="M12 2l3 6.5 7 .9-5 4.9 1.2 7-6.2-3.4L5.8 21 7 14.3 2 9.4l7-.9z"/>',ar:'<path d="M5 12h14M12 5l7 7-7 7"/>',lf:'<path d="M19 12H5M12 19l-7-7 7-7"/>',bk:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',lk:'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'};
const ic=(n,s=18)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[n]||''}</svg>`;
function fpop(k){S.pop=S.pop===k?null:k;paint()}
function fpick(k,v){const a=S.f[k];const i=a.indexOf(v);i<0?a.push(v):a.splice(i,1);paint()}
function fclear(k){if(k){S.f[k]=[]}else{S.f={q:'',nghe:[],kv:[],loai:[],tt:[],khan:[],sort:S.f.sort}}S.pop=null;paint()}
function fsort(v){S.f.sort=v;paint()}
function fq(v){S.f.q=v;paint()}
const fcount=()=>['nghe','kv','loai','tt','khan'].reduce((n,k)=>n+S.f[k].length,0);

function filterBar(keys,total,shown){
 return `<div class="fbar">
  <div class="fsch">${ic('' ,0)}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8B8B8B" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
   <input placeholder="Tìm trong danh sách..." value="${S.f.q}" oninput="fq(this.value)">
   ${S.f.q?`<button class="mx" style="width:26px;height:26px" onclick="fq('')">✕</button>`:''}</div>
  <div class="frow">
   ${keys.map(k=>{const F=FSET[k],n=S.f[k].length;return `<div class="fb">
    <button class="fbtn ${n?'act':''}" onclick="event.stopPropagation();fpop('${k}')">${F.l}${n?`<span class="c">${n}</span>`:''} <span style="font-size:10px;color:var(--fnt)">▾</span></button>
    <div class="fpop ${S.pop===k?'on':''}" onclick="event.stopPropagation()">
     <div class="hd2"><b>CHỌN NHIỀU ĐƯỢC</b>${n?`<a onclick="fclear('${k}')">Bỏ chọn</a>`:''}</div>
     ${F.o.map(o=>`<div class="opt ${S.f[k].includes(o[0])?'on':''}" onclick="fpick('${k}','${o[0]}')"><span class="bxx">${S.f[k].includes(o[0])?'✓':''}</span><span>${o[0]}</span><span class="n2">${o[1]}</span></div>`).join('')}
    </div></div>`}).join('')}
   ${fcount()?`<button class="fbtn" onclick="fclear()" style="color:var(--rd);border-color:var(--rd-s)">Xoá hết lọc</button>`:''}
  </div>
  ${fcount()?`<div class="tags">${keys.flatMap(k=>S.f[k].map(v=>`<span class="tagx">${v}<i onclick="fpick('${k}','${v}')">✕</i></span>`)).join('')}</div>`:''}
  <div class="fsum">Hiện <b>${shown}</b> trên ${total}${fcount()?` · lọc theo ${fcount()} điều kiện`:''}
   <select onchange="fsort(this.value)">${Object.entries(SORTS).map(([k,v])=>`<option value="${k}" ${S.f.sort===k?'selected':''}>Sắp: ${v}</option>`).join('')}</select></div>
 </div>`;
}
function mo(n){S.md=n;S.wz=1;const o=document.getElementById('ov');o.innerHTML=(MD[n]||MD.xoa)();o.classList.add('on');document.body.style.overflow='hidden'}
function dong(){document.getElementById('ov').classList.remove('on');document.body.style.overflow='';S.md=null}
function wz(d){S.wz=Math.max(1,Math.min(3,S.wz+d));document.getElementById('ov').innerHTML=MD[S.md]()}
function paint(){
 document.getElementById('vsw').innerHTML=ROLES.map(r=>`<button class="${S.vai===r.k?'on':''}" onclick="doiVai('${r.k}')" title="${r.d}">${r.s}</button>`).join('');
 document.getElementById('nav').innerHTML=NAV_().map(g=>`${g.g?`<div class="cap">${g.g}</div>`:''}${g.items.map(it=>`<a class="nv ${S.r===it.r?'on':''}" onclick="go('${it.r}')">${ic(it.i)}<span>${it.l}</span>${it.n?`<span class="n">${it.n}</span>`:it.dt?'<span class="dt"></span>':''}</a>`).join('')}`).join('');
 const b=document.getElementById('body');
 b.className='body'+(SPLIT.includes(S.r)?' split':'')+(S.id?' sel':'');
 b.innerHTML=(V[S.r]||V.viec)();
 b.querySelectorAll('.pane').forEach(p=>p.scrollTop=0);
}
