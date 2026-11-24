// Moments that Matter: office TV. Rendering is the claude.ai prototype's, unchanged
// in look and behaviour; the data now comes from /api/data (the Google Sheet).
"use strict";

// ---- Data (filled from /api/data) ----
// d=start, e=end (inclusive), h=SAST time, t=title, s=sport, p=priority, v=to confirm, n=detail, c=campaign id
let EV = [], CAMPS = [], IMAGES = [], WEEK1 = null, UPDATED = null, AUTH_LOST = false, LOADED = false, SKEW = 0;

const POLL_MS = 4 * 60e3; // with the server's 5-minute refresh, a sheet edit shows within ~9 minutes
const STALE_MS = 2 * 36e5;
const DAY = 864e5;
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const sast = s => new Date(s+"T00:00:00+02:00");
// The server's clock, in case the TV's own clock drifts
const nowD = () => new Date(Date.now()+SKEW);
// SAST wall-clock parts of a Date
function parts(dt){const x=new Date(dt.getTime()+2*3600e3);return {y:x.getUTCFullYear(),m:x.getUTCMonth(),d:x.getUTCDate(),wd:x.getUTCDay(),hh:x.getUTCHours(),mm:x.getUTCMinutes()}}
const fmtD = dt => {const p=parts(dt);return `${p.d} ${MON[p.m]}`};
const fmtWD = dt => {const p=parts(dt);return `${WD[p.wd]} ${p.d} ${MON[p.m]}`};
const fmtHM = dt => {const p=parts(dt);return String(p.hh).padStart(2,"0")+":"+String(p.mm).padStart(2,"0")};
const isoDay = dt => {const p=parts(dt);return `${p.y}-${String(p.m+1).padStart(2,"0")}-${String(p.d).padStart(2,"0")}`};
function startOf(ev){return new Date(ev.d+"T"+(ev.h||"00:00")+":00+02:00")}
function endOf(ev){return new Date(sast(ev.e).getTime()+DAY)}
function el(tag,cls,txt){const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n}
function priTag(p){const s=el("span","pri "+p,p==="A"?"Priority A":p==="B"?"Priority B":p==="C"?"Priority C":"Context");return s}
function addTbc(node,ev){if(ev.v){node.appendChild(el("span","tbc","To confirm"))}}
function rangeTxt(ev){const a=sast(ev.d),b=sast(ev.e);if(ev.d===ev.e)return fmtWD(a)+(ev.h?", "+ev.h:"");return fmtD(a)+"–"+fmtD(b)+(ev.h?", "+ev.h:"")}

// ---- Fit stage to screen ----
function fit(){const st=document.getElementById("stage");const s=Math.min(innerWidth/1920,innerHeight/1080);st.style.transform=`scale(${s})`}
addEventListener("resize",fit);fit();

// ---- Clock ----
function tick(){const p=parts(nowD());document.getElementById("clk").textContent=String(p.hh).padStart(2,"0")+":"+String(p.mm).padStart(2,"0");
  document.getElementById("dte").textContent=`${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][p.wd]} ${p.d} ${["January","February","March","April","May","June","July","August","September","October","November","December"][p.m]}`}

// ---- Week helpers ----
// Monday (00:00 SAST) of the week containing dt
function mondayOf(dt){const p=parts(dt);return new Date(sast(isoDay(dt)).getTime()-((p.wd+6)%7)*DAY)}
// W1 is the sheet's week1_start while today is inside those 12 weeks; otherwise
// the grid rolls forward so the current week is W1 (the screen never goes stale).
let W0 = mondayOf(new Date());
function setAnchor(now){
  if(WEEK1){const w=sast(WEEK1);const i=Math.floor((now-w)/(7*DAY));if(i>=0&&i<12){W0=w;return}}
  W0=mondayOf(now)}
function weekIndex(now){return Math.floor((now-W0)/(7*DAY))} // 0 = W1
function weekRange(i){const a=new Date(W0.getTime()+i*7*DAY);return [a,new Date(a.getTime()+7*DAY)]}
function overlaps(ev,a,b){return startOf(ev)<b && endOf(ev)>a}
const prRank={A:0,B:1,C:2,X:3};

// ---- Original sport illustrations for the hero (drawn here, no photos) ----
function sportArt(s){
  if(s==="Rugby")return ""; // rugby uses the plain block
  const W='stroke="#fff"',N='#003DC4',R='#F13131';
  if(s==="Cricket")return `<svg viewBox="0 0 600 600" aria-hidden="true">
    <rect x="150" y="520" width="420" height="60" fill="#fff" opacity=".12"/>
    <g fill="#fff" opacity=".85">${[230,300,370].map(x=>`<rect x="${x}" y="190" width="26" height="340" rx="10"/>`).join("")}
      <rect x="236" y="170" width="72" height="14" rx="7"/><rect x="318" y="170" width="72" height="14" rx="7"/></g>
    <circle cx="470" cy="420" r="62" fill="${R}"/>
    <path d="M432 372 Q470 420 432 468 M508 372 Q470 420 508 468" fill="none" ${W} stroke-width="5" stroke-dasharray="8 7"/></svg>`;
  if(s==="Premier League"||s==="Football"||s==="UCL"||s==="PSL")return `<svg viewBox="0 0 600 600" aria-hidden="true">
    <g fill="none" ${W} stroke-width="8" opacity=".28"><circle cx="330" cy="330" r="230"/><line x1="330" y1="0" x2="330" y2="600"/><circle cx="330" cy="330" r="10" fill="#fff"/></g>
    <circle cx="360" cy="400" r="130" fill="#fff"/>
    <polygon points="360,350 403,381 387,431 333,431 317,381" fill="${N}"/>
    <g stroke="${N}" stroke-width="6" fill="none"><line x1="360" y1="350" x2="360" y2="280"/><line x1="403" y1="381" x2="480" y2="360"/><line x1="387" y1="431" x2="430" y2="505"/><line x1="333" y1="431" x2="290" y2="505"/><line x1="317" y1="381" x2="240" y2="360"/></g>
    <path d="M300 290 L330 270 L375 274 L360 282Z M470 340 L488 380 L478 420 L470 400Z" fill="${N}"/>
    <circle cx="360" cy="400" r="130" fill="none" stroke="${N}" stroke-width="4"/></svg>`;
  if(s==="Casino")return `<svg viewBox="0 0 600 600" aria-hidden="true">
    ${[[250,300,N],[420,250,N],[360,430,R]].map(([x,y,f])=>`<circle cx="${x}" cy="${y}" r="120" fill="${f}"/><circle cx="${x}" cy="${y}" r="104" fill="none" stroke="#fff" stroke-width="22" stroke-dasharray="36 28"/><circle cx="${x}" cy="${y}" r="66" fill="none" stroke="#fff" stroke-width="4" opacity=".7"/>`).join("")}</svg>`;
  return `<svg viewBox="0 0 600 600" aria-hidden="true"><g fill="none" ${W} stroke-width="10" opacity=".25"><circle cx="420" cy="420" r="260"/><circle cx="420" cy="420" r="170"/><circle cx="420" cy="420" r="80"/></g></svg>`;
}

// ---- Hero images (Images tab): an event match beats a sport match; expired images are skipped ----
function heroImage(ev,now){
  const today=isoDay(now),live=IMAGES.filter(i=>!i.useUntil||i.useUntil>=today),k=s=>(s||"").trim().toLowerCase();
  return live.find(i=>i.matchType==="event"&&k(i.matchValue)===k(ev.t))||live.find(i=>i.matchType==="sport"&&k(i.matchValue)===k(ev.s))||null}
function countdown(next,now,live){const cd=el("div","count");
  if(live){cd.appendChild(el("div","live","Live now"))}
  else{const ms=startOf(next)-now;const d=Math.floor(ms/DAY),h=Math.floor(ms%DAY/36e5),m=Math.floor(ms%36e5/6e4);
    [[d,d===1?"day":"days"],[h,h===1?"hour":"hours"],[m,"min"]].forEach(([n,u])=>{const b=el("div");b.appendChild(el("div","n",String(n).padStart(2,"0")));b.appendChild(el("div","u",u));cd.appendChild(b)})}
  return cd}

// ---- Scene 1 ----
function renderS1(now){
  setAnchor(now);
  const hero=document.getElementById("hero");hero.replaceChildren();
  hero.classList.remove("photo","bg");hero.style.backgroundImage="";
  if(!LOADED){hero.appendChild(el("div","lab","Loading the calendar…"))}
  // Hero: next Priority A moment that hasn't finished
  const next=EV.filter(e=>e.p==="A"&&endOf(e)>now).sort((a,b)=>startOf(a)-startOf(b))[0];
  const img=next?heroImage(next,now):null;
  if(next&&img&&img.textInImage){
    // The image carries its own words: show only the countdown on top
    hero.classList.add("photo");hero.style.backgroundImage=`url("${img.url}")`;
    const ov=el("div","ovcount");const live=startOf(next)<=now;
    ov.appendChild(el("div","lab",live?"Live now":"Kick-off in"));ov.appendChild(countdown(next,now,live));hero.appendChild(ov);
  } else if(next){
    if(img){hero.classList.add("bg");hero.style.backgroundImage=`url("${img.url}")`}
    else{const svg=sportArt(next.s);if(svg){const art=el("div","art");art.innerHTML=svg;hero.appendChild(art)}else{hero.appendChild(el("div","plaincircle"))}}
    const live=startOf(next)<=now;
    const top=el("div");top.appendChild(el("div","lab",live?"On now, Priority A":"Next Priority A moment"));
    const nm=el("div","name",next.t);top.appendChild(nm);
    top.appendChild(el("div","when",rangeTxt(next)+(next.n?". "+next.n:"")));
    hero.appendChild(top);
    hero.appendChild(countdown(next,now,live));
    const camp=CAMPS.find(c=>c.id===next.c);
    if(camp){const cp=el("div","camp");const b=el("b",null,camp.id+" "+camp.name+(camp.msg?": ":""));cp.appendChild(b);cp.appendChild(document.createTextNode(camp.msg));hero.appendChild(cp)}
  } else if(LOADED){hero.appendChild(el("div","name","No Priority A moments coming up"))}

  // This week
  let wi=Math.max(0,weekIndex(now));const [a,b]=weekRange(wi);
  document.getElementById("wkTitle").textContent=wi<12?`This week, W${wi+1}`:"This week";
  document.getElementById("wkSub").textContent=`${fmtD(a)} to ${fmtD(new Date(b-DAY))}`;
  const list=EV.filter(e=>overlaps(e,a,b)&&endOf(e)>now).sort((x,y)=>prRank[x.p]-prRank[y.p]||startOf(x)-startOf(y));
  const shown=list.slice(0,7).sort((x,y)=>startOf(x)-startOf(y));
  const rows=document.getElementById("wkRows");rows.replaceChildren();
  shown.forEach(ev=>{const r=el("div","row");
    const s=startOf(ev);const dayTxt=startOf(ev)<now&&ev.d!==ev.e?"Running":(()=>{const p=parts(s);return WD[p.wd]+" "+p.d})();
    r.appendChild(el("div","day",dayTxt));
    const mid=el("div");const t=el("div","ttl",ev.t);addTbc(t,ev);mid.appendChild(t);
    const det=[ev.h&&ev.d===ev.e?ev.h:null,ev.n].filter(Boolean).join(". ");if(det)mid.appendChild(el("div","det",det));
    r.appendChild(mid);r.appendChild(priTag(ev.p));rows.appendChild(r)});
  if(!shown.length&&LOADED)rows.appendChild(el("div","det","Nothing on the calendar for the rest of this week."));
  document.getElementById("wkMore").textContent=list.length>shown.length?`Plus ${list.length-shown.length} lower-priority events this week`:"";
}

// ---- Scene 2 ----
function renderS2(now){
  setAnchor(now);
  const g=document.getElementById("grid");g.replaceChildren();const cur=weekIndex(now);
  for(let i=0;i<12;i++){const [a,b]=weekRange(i);
    const c=el("div","cell"+(i===cur?" now":"")+(i<cur?" past":""));
    const wn=el("div","wn");wn.appendChild(el("b",null,"W"+(i+1)));wn.appendChild(el("span",null,`${fmtD(a)}–${fmtD(new Date(b-DAY))}`));c.appendChild(wn);
    c.appendChild(el("div","nowtag",i===cur?"This week":""));
    const evs=EV.filter(e=>e.p!=="X"&&overlaps(e,a,b))
      // a long-running event shows only in the week it starts, unless it is Priority A
      .filter(e=>e.p==="A"||startOf(e)>=a||(i===0))
      .sort((x,y)=>prRank[x.p]-prRank[y.p]||startOf(x)-startOf(y));
    // de-duplicate repeated titles inside a week
    const seen=new Set();const uniq=evs.filter(e=>!seen.has(e.t)&&seen.add(e.t));
    const ul=el("ul");uniq.slice(0,4).forEach(e=>{ul.appendChild(el("li",e.p,e.t))});c.appendChild(ul);
    if(uniq.length>4)c.appendChild(el("div","plus",`+${uniq.length-4} more`));
    g.appendChild(c)}
}

// ---- Scene 3 ----
const MAX_CAMPS = 5; // upper bound; renderS3 then drops rows that would overlap the footer
function renderS3(now){
  const box=document.getElementById("camps");box.replaceChildren();
  // 9-week view from the Monday of the current week
  const T0=mondayOf(now).getTime(),T1=T0+63*DAY;
  const pct=t=>((t-T0)/(T1-T0))*100;
  const ax=el("div","axis");
  [0,1,2,3,4].forEach(k=>{const t=T0+k*14*DAY;const s=el("span",null,fmtD(new Date(t)));s.style.left=pct(t)+"%";ax.appendChild(s)});
  box.appendChild(ax);
  // soonest first: by the first window that hasn't finished
  const nextT=cp=>Math.min(...cp.segs.filter(([,e])=>sast(e).getTime()+DAY>now.getTime()).map(([d])=>sast(d).getTime()),Infinity);
  const inView=CAMPS.filter(cp=>cp.segs.some(([d,e])=>sast(d).getTime()<T1&&sast(e).getTime()+DAY>T0)).sort((a,b)=>nextT(a)-nextT(b)).slice(0,MAX_CAMPS);
  inView.forEach(cp=>{const r=el("div","cp");const l=el("div");l.appendChild(el("div","id",cp.id));l.appendChild(el("div","nm",cp.name));l.appendChild(el("div","ms",cp.msg));r.appendChild(l);
    const lane=el("div","lane");
    cp.segs.forEach(([d,e,lab,main])=>{let x0=pct(sast(d).getTime()),x1=pct(sast(e).getTime()+DAY);if(x1<=0||x0>=100)return;x0=Math.max(0,x0);x1=Math.min(100,x1);
      const s=el("div","seg"+(main?" main":""));
      s.style.left=x0+"%";s.style.width=Math.max(.6,x1-x0)+"%";if(lab&&x1-x0>4)s.appendChild(el("i",null,lab));lane.appendChild(s)});
    const tp=pct(now.getTime());if(tp>=0&&tp<=100){const tl=el("div","todayline");tl.style.left=tp+"%";lane.appendChild(tl)}
    r.appendChild(lane);box.appendChild(r)});
  if(!inView.length&&LOADED){const r=el("div","cp");r.appendChild(el("div","ms","No Priority A campaigns in the next nine weeks."));box.appendChild(r)}
  // today label on the axis
  const tp=pct(now.getTime());if(tp>=0&&tp<=100){const t=el("div","todaylab","Today");t.style.left=tp+"%";t.style.top="auto";t.style.bottom="-34px";ax.appendChild(t)}
  const key=el("div","key");const k1=el("span");const i1=el("i");i1.style.background="var(--red)";k1.appendChild(i1);k1.appendChild(document.createTextNode("Main window"));
  const k2=el("span");const i2=el("i");i2.style.background="var(--blue)";k2.appendChild(i2);k2.appendChild(document.createTextNode("Pre-roll or tail"));
  key.appendChild(k1);key.appendChild(k2);box.appendChild(key);
  // Long messages make rows taller: drop the furthest-out campaigns until the key clears the footer
  const stage=document.getElementById("stage"),scale=stage.getBoundingClientRect().width/1920||1;
  const footTop=document.querySelector(".foot").getBoundingClientRect().top;
  const rows=[...box.querySelectorAll(".cp")];let hidden=0;
  while(rows.length>1&&key.getBoundingClientRect().bottom>footTop-8*scale){rows.pop().remove();hidden++}
  if(hidden)key.appendChild(el("span",null,`+${hidden} more Priority A campaign${hidden>1?"s":""} later`));
}

// ---- Notes: when the data was last read, and whether it has gone stale ----
function notes(){
  const now=nowD(),up=UPDATED?new Date(UPDATED):null;
  document.getElementById("note").textContent=up
    ?`Updated ${fmtD(up)}, ${fmtHM(up)} from the Moments Campaign Calendar. Times SAST. “To confirm” dates are unverified with the official source.`
    :"Loading the Moments Campaign Calendar…";
  const st=document.getElementById("stale");
  const msg=AUTH_LOST?"This TV has been signed out. Sign in again to keep the calendar updating."
    :up&&now-up>STALE_MS?`Data last updated ${fmtWD(up)}, ${fmtHM(up)}`:"";
  st.textContent=msg;st.style.display=msg?"block":"none";
}

// ---- Rotation ----
const SC=["sc1","sc2","sc3"],DUR=[22000,22000,16000];let cur=0,timer;
// Each scene renders on its own, so one bad value can't blank the whole screen
function safe(f,now){try{f(now)}catch(err){console.error(err)}}
function render(){const now=nowD();safe(renderS1,now);safe(renderS2,now);safe(renderS3,now);notes()}
function show(i){cur=i;SC.forEach((id,k)=>document.getElementById(id).classList.toggle("on",k===i));
  const dots=[...document.querySelectorAll("#dots span")];
  dots.forEach((d,k)=>{d.classList.remove("on","done");const b=d.firstChild;b.style.animation="none";void b.offsetWidth;b.style.animation="";
    if(k<i)d.classList.add("done");if(k===i){d.classList.add("on");b.style.animationDuration=DUR[k]+"ms"}});
  clearTimeout(timer);timer=setTimeout(()=>{if((i+1)%SC.length===0)render();show((i+1)%SC.length)},DUR[i])}
// Let a remote or keyboard step through scenes
addEventListener("keydown",e=>{if(e.key==="ArrowRight"||e.key===" ")show((cur+1)%SC.length);if(e.key==="ArrowLeft")show((cur+SC.length-1)%SC.length)});
document.getElementById("stage").addEventListener("click",()=>show((cur+1)%SC.length));

// ---- Loading ----
// A failed or refused fetch keeps whatever is on screen.
async function fetchData(){
  try{const r=await fetch("/api/data",{cache:"no-store",credentials:"same-origin",headers:{Accept:"application/json"}});
    if(r.status===401){AUTH_LOST=true;return null}
    if(!r.ok)return null;
    AUTH_LOST=false;return await r.json()}
  catch(err){console.warn("data fetch failed",err);return null}}
function adopt(d){
  EV=d.events.map(e=>({d:e.start,e:e.end,h:e.time,t:e.title,s:e.sport,p:e.priority,v:e.toConfirm,n:e.detail,c:e.campaignId}));
  CAMPS=d.campaigns.map(c=>({id:c.id,name:c.name,msg:c.message,segs:c.segments.map(s=>[s.start,s.end,s.label,s.main?1:0])}));
  IMAGES=d.images||[];WEEK1=d.settings&&d.settings.week1Start||null;UPDATED=d.updatedAt;
  if(d.serverTime){const s=Date.parse(d.serverTime)-Date.now();SKEW=Math.abs(s)>30e3?s:0}
  LOADED=true;
  // warm the browser cache so the hero never flashes empty
  IMAGES.forEach(i=>{const im=new Image();im.src=i.url})}
async function load(){const d=await fetchData();if(d){try{adopt(d);render()}catch(err){console.error("bad data",err)}}else notes();return !!d}

// Nightly full reload at 03:00 SAST, but only once the server answers, so a
// sign-out or outage at 3am never swaps the calendar for an error page.
function scheduleNightly(){const p=parts(nowD());let t=Date.UTC(p.y,p.m,p.d,1,0)-SKEW;if(t<=Date.now())t+=DAY;
  setTimeout(async function retry(){if(await fetchData())location.reload();else setTimeout(retry,10*60e3)},t-Date.now())}

tick();setInterval(tick,10000);
render();show(0);
setInterval(()=>{safe(renderS1,nowD());notes()},60000);
(async function first(){if(!(await load()))setTimeout(first,30e3)})();
setInterval(load,POLL_MS);
scheduleNightly();
