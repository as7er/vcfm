import { SimEngine, SIM } from "./engine.js";
function makeClub(name, power) {
  const roles = ["GK","DEF","DEF","DEF","DEF","MID","MID","MID","ATT","ATT","ATT"];
  const players = [], lineup = [];
  for (let i = 0; i < 11; i++) {
    const mean = power / 5;
    const g = () => Math.max(1, Math.min(20, Math.round(mean + (Math.random()-0.5)*5)));
    const id = `${name}-p${i}`;
    players.push({ id, name:id, pos:roles[i], number:i+1, fitness:100,
      attrs:{ pace:g(),shooting:g(),passing:g(),dribbling:g(),defending:g(),physical:g(),
        finishing:g(),tackling:g(),marking:g(),strength:g(),stamina:g(),vision:g(),
        reflexes:g(),handling:g(),positioning:g(),kicking:g() } });
    lineup.push(id);
  }
  return { name, players, tactics:{ formation:"4-3-3", lineup } };
}
const STEPS = Math.round((90*60)/SIM.DT);
let rawH=0, rawA=0, possH=0, possTot=0, deepH=0, deepA=0;
const N=10;
for (let n=0;n<N;n++){
  const eng=new SimEngine(makeClub("H",65),makeClub("A",65));
  for(let i=0;i<STEPS;i++){
    eng.step();
    const o=eng.ball.owner?eng.agentById(eng.ball.owner):null;
    if(o){possTot++; if(o.team==="home")possH++;}
  }
  rawH+=eng.events.filter(e=>e.type==="shot"&&e.team==="home").length;
  rawA+=eng.events.filter(e=>e.type==="shot"&&e.team==="away").length;
}
console.log(`原始射门 主${(rawH/N).toFixed(1)} 客${(rawA/N).toFixed(1)}`);
console.log(`控球 主${(possH/possTot*100).toFixed(1)}%`);
