// Read-only attribution of committed runs and depth-conditioned support.
import { SimEngine, SIM } from "../js/sim/engine.js";
import { writeFileSync, mkdirSync } from "node:fs";
const count = Math.max(1, Number(process.argv[2]) || 6);
const label = process.argv[3] || "current";
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("invalid evidence label");
const attrs = ["pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
  "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning", "kicking", "decisions", "crossing"];
function club(name) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"].map((pos, i) => {
    const rating = 15 + ((i * 7 + 15) % 5) - 2;
    return {id:`${name}-p${i}`, name:`${name}-p${i}`, pos, number:i+1, fitness:100,
      attrs:Object.fromEntries(attrs.map(key => [key,rating]))};
  });
  return {id:name,name,players,tactics:{formation:"4-3-3",lineup:players.map(p=>p.id),pressing:3,tempo:3,defensiveLine:3}};
}
function seeded(seed) {
  let v = seed >>> 0;
  return () => {v += 0x6d2b79f5; let n=v; n=Math.imul(n^(n>>>15),n|1); n^=n+Math.imul(n^(n>>>7),n|61); return ((n^(n>>>14))>>>0)/4294967296;};
}
const metres = (a,b) => Math.hypot((a.x-b.x)*0.68,(a.y-b.y)*1.05);
const buckets = new Map();
const runs = [];
const matches = [];
const pipeline = {commits:0, held:0, beforeErrors:[], afterErrors:[]};
const median = values => {const sorted=[...values].sort((a,b)=>a-b); return sorted.length ? sorted[Math.floor(sorted.length/2)] : null;};
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted.length ? sorted[Math.min(sorted.length-1, Math.floor(sorted.length*fraction))] : null;
};
const controlTeam = engine => {
  const ball = engine.ball;
  return (ball.owner ? engine.agentById(ball.owner)?.team : null) ||
    (["pass", "shot"].includes(ball.state) ? ball.kickTeam : null);
};
for (let i=0;i<count;i++) {
  const seed=372000+i;
  const old=Math.random;
  let draws=0;
  const rng=seeded(seed);
  Math.random=()=>{draws++;return rng();};
  try {
    const e=new SimEngine(club(`h${seed}`),club(`a${seed}`),{simulationProfile:"standard",timeStep:SIM.DT,separationPasses:8});
    let active=null;
    const finished = new WeakSet();
    const commit = e._commitOffBallTarget;
    e._commitOffBallTarget = function(a, actor) {
      const plan = this._passSupportRun;
      const applies = plan?.playerId === a.id &&
        ["third-man-run", "cutback-outlet"].includes(a.offBallTargetKind);
      const before = applies ? metres({x:a.tx, y:a.ty}, plan) : null;
      const result = commit.call(this, a, actor);
      if (applies) {
        pipeline.commits++;
        pipeline.held += Number(a.offBallTarget?.decision === "held");
        pipeline.beforeErrors.push(before);
        pipeline.afterErrors.push(metres({x:a.tx, y:a.ty}, plan));
      }
      return result;
    };
    function endRun(reason) {
      const {plan,lastPosition,lastTime,...record} = active;
      record.displacement = metres(record.start,lastPosition);
      record.finalGap = metres(lastPosition,plan);
      record.seconds = lastTime-record.startedAt;
      record.reason = reason;
      runs.push(record);
      finished.add(plan);
      active = null;
    }
    for(let s=0;s<54000;s++) {
      e.step(SIM.DT);
      const plan=e._passSupportRun;
      const b=e.ball;
      const team=controlTeam(e);
      if(active) {
        const runner=e.agentById(active.plan.playerId);
        const reason = !runner || runner.sentOff || runner.injuredOff ? "unavailable"
          : b.restartType || e.t<(e.deadBallUntil||0) ? "restart"
          : b.owner===runner.id ? "received"
          : b.state==="pass" && b.receiverId===runner.id ? "assigned-reception"
          : team && team!==active.plan.team ? "turnover"
          : e._teamAttackSince[active.plan.team]!==active.plan.attackSince ? "new-possession"
          : plan!==active.plan ? "replaced"
          : e.t>plan.until ? "expired" : null;
        if(reason)endRun(reason);
      }
      if(!active && plan && !finished.has(plan) && e.t<=plan.until &&
          e._teamAttackSince[plan.team]===plan.attackSince && team===plan.team &&
          !b.restartType && b.owner!==plan.playerId &&
          !(b.state==="pass" && b.receiverId===plan.playerId)) {
        const a=e.agentById(plan.playerId);
        active={plan,seed,startedAt:e.t,start:{x:a.x,y:a.y},distance:metres(a,plan),cutback:plan.cutback,
          targetErrors:[],movingSamples:0,samples:0,lastPosition:{x:a.x,y:a.y},lastTime:e.t};
      }
      if(active) {
        const a=e.agentById(active.plan.playerId);
        active.lastPosition={x:a.x,y:a.y};
        active.lastTime=e.t;
      }
      if(s%5)continue;
      if(active) {
        const a=e.agentById(active.plan.playerId);
        active.targetErrors.push(metres({x:a.tx,y:a.ty},active.plan));
        active.samples++;
        if(Math.hypot(a.vx*0.68,a.vy*1.05)>=1)active.movingSamples++;
      }
      if(!team || b.restartType || e.t<(e.deadBallUntil||0) || !["held","control","pass"].includes(b.state))continue;
      const depth=Math.abs(b.y-e.targetGoalY(team))*1.05;
      if(depth>=38)continue;
      const zone=depth<5?"0-5":depth<10?"5-10":depth<16.5?"10-16.5":depth<25?"16.5-25":"25-38";
      const dir=e.attackDir(team);
      for(const a of e.agents) {
        if(a.team!==team || a.role==="GK" || a.sentOff || a.injuredOff || a.id===b.owner)continue;
        const key=`${zone}:${a.role}`;
        if(!buckets.has(key))buckets.set(key,{samples:0,ahead5:0,static:0,stranded:0,ahead:[]});
        const row=buckets.get(key);
        const lead=(a.ty-b.y)*dir*1.05;
        const still=Math.hypot(a.vx*0.68,a.vy*1.05)<1;
        row.samples++;
        row.ahead5+=Number(lead>=5);
        row.static+=Number(still);
        row.stranded+=Number(still && metres(a,{x:a.tx,y:a.ty})>=1.5);
        row.ahead.push(lead);
      }
    }
    if(active)endRun("match-end");
    matches.push({seed,score:e.score,draws});
  } finally {Math.random=old;}
}
const summary={label,matches,buckets:Object.fromEntries([...buckets].map(([key,row])=>[key,
  {samples:row.samples,ahead5Pct:row.ahead5/row.samples*100,staticPct:row.static/row.samples*100,
    strandedPct:row.stranded/row.samples*100,medianAhead:median(row.ahead)}])),
  pipeline:{commits:pipeline.commits,heldPct:pipeline.held/Math.max(1,pipeline.commits)*100,
    medianBeforeError:median(pipeline.beforeErrors),p90BeforeError:percentile(pipeline.beforeErrors,0.9),
    medianAfterError:median(pipeline.afterErrors),p90AfterError:percentile(pipeline.afterErrors,0.9)},
  runs:{count:runs.length,reason:Object.fromEntries([...new Set(runs.map(r=>r.reason))].map(reason=>[reason,runs.filter(r=>r.reason===reason).length])),
    medianDistance:median(runs.map(r=>r.distance)),medianDisplacement:median(runs.map(r=>r.displacement)),
    medianFinalGap:median(runs.map(r=>r.finalGap)),medianSeconds:median(runs.map(r=>r.seconds)),
    medianTargetError:median(runs.flatMap(r=>r.targetErrors)),
    p90TargetError:percentile(runs.flatMap(r=>r.targetErrors),0.9),
    expiredMedianDisplacement:median(runs.filter(r=>r.reason==="expired").map(r=>r.displacement)),
    expiredMedianFinalGap:median(runs.filter(r=>r.reason==="expired").map(r=>r.finalGap)),
    movingPct:runs.reduce((s,r)=>s+r.movingSamples,0)/Math.max(1,runs.reduce((s,r)=>s+r.samples,0))*100,
    displaced3mPct:runs.filter(r=>r.displacement>=3).length/Math.max(1,runs.length)*100}};
mkdirSync(new URL("../.tmp-continuity/",import.meta.url),{recursive:true});
writeFileSync(new URL(`../.tmp-continuity/pass-support-${label}.json`,import.meta.url),JSON.stringify({summary,runs},null,2));
console.log(JSON.stringify(summary,null,2));
