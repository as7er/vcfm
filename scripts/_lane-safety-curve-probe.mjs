/**
 * RACE_SAFETY_CURVE 的来源（2026-09-25，v292）：把赛跑余量（米）按分位数对齐到旧 `_laneSafety` 分布。
 * 改动赛跑模型参数后必须重跑本脚本、重填 engine.js 的曲线，否则传球整体权重会漂。
 * 用法：node scripts/_lane-safety-curve-probe.mjs
 */
import { CLUB_TEMPLATES } from "../js/data.js";
import { createMatchSession } from "../js/match.js";
import { createWorld } from "../js/models.js";
import { ensureSimEngine, runSimPeriodRaw } from "../js/sim/adapt.js";
import { ensureStaff } from "../js/staff.js";
import { SimEngine } from "../js/sim/engine.js";
function mulberry32(seed){let a=seed>>>0;return function(){a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const r=Math.random,dn=Date.now; Math.random=mulberry32(0x1a2b3c); Date.now=()=>1789000000000;
const src=createWorld(CLUB_TEMPLATES.find(c=>c.division===3).id,"R"); for(const c of src.clubs) ensureStaff(c);
Math.random=r; Date.now=dn;
const MX=68/100, MY=105/100;
function margin(eng,a,tx,ty,eta){const ox=eng.ball.owner===a.id?eng.ball.x:a.x, oy=eng.ball.owner===a.id?eng.ball.y:a.y;
 const dx=(tx-ox)*MX,dy=(ty-oy)*MY,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len;let m=Infinity;
 for(const o of eng.agents){if(o.team===a.team||o.role==="GK"||o.sentOff||o.injuredOff)continue;let t=((o.x-ox)*MX*ux+(o.y-oy)*MY*uy)/len;if(t<-0.05||t>1.05)continue;t=Math.max(0,Math.min(1,t));
  const bt=eta*t, px=o.x+(o.vx||0)*bt, py=o.y+(o.vy||0)*bt; const perp=Math.abs((px-ox)*MX*uy-(py-oy)*MY*ux); m=Math.min(m,perp-(1+6.5*Math.max(0,bt-0.25)));}
 return m===Infinity?12:m;}
const naive=[], race=[];
const P=SimEngine.prototype; const oc=P._collectPassCandidates;
P._collectPassCandidates=function(a){const out=oc.call(this,a); for(const c of out){ if(c.backpass) continue; const distM=Math.hypot((c.tx-a.x)*MX,(c.ty-a.y)*MY); naive.push(this._laneSafety(a,c.agent,c.tx,c.ty)); race.push(margin(this,a,c.tx,c.ty,Math.max(0.2,distM/15))); } return out;};
for(const s of [1,2]){const w=structuredClone(src);const fx=w.fixtures.find(f=>f.home===w.userClubId);const st=createMatchSession(w,fx);st.random=mulberry32(s);const e=ensureSimEngine(st);runSimPeriodRaw(e,1,45);runSimPeriodRaw(e,46,90);}
naive.sort((x,y)=>x-y); race.sort((x,y)=>x-y); const q=(a,f)=>a[Math.min(a.length-1,Math.floor(a.length*f))];
console.log("candidates",naive.length);
for(const f of [0.05,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0.95]) console.log(`q${f}`.padEnd(6), "naive", q(naive,f).toFixed(3), " raceMargin(m)", q(race,f).toFixed(2));
