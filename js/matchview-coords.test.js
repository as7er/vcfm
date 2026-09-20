/**
 * 坐标系统单元测试
 *
 * 运行方式：node js/matchview-coords.test.js
 */

import { coordSystem } from './matchview-coords.js';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertNear(actual, expected, tolerance = 0.01, message = '') {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `${message}\nExpected: ~${expected}\nActual: ${actual}\nDiff: ${Math.abs(actual - expected)}`
    );
  }
}

// ============ 测试用例 ============

test('slotToPitch - 主队不翻转', () => {
  const slot = { x: 50, y: 20 };
  const pos = coordSystem.slotToPitch(slot, true);
  assertNear(pos.x, 50, 0.01, 'Home x should not flip');
  assertNear(pos.y, 20, 0.01, 'Home y should not flip');
});

test('slotToPitch - 客队镜像翻转', () => {
  const slot = { x: 30, y: 20 };
  const pos = coordSystem.slotToPitch(slot, false);
  assertNear(pos.x, 70, 0.01, 'Away x should flip: 100 - 30 = 70');
  assertNear(pos.y, 80, 0.01, 'Away y should flip: 100 - 20 = 80');
});

test('攻击方向 - 主队向上（y 减小）', () => {
  const dir = coordSystem.attackDirection(true);
  assertNear(dir.dx, 0, 0.01);
  assertNear(dir.dy, -1, 0.01, 'Home attacks upward (y decreases)');
});

test('攻击方向 - 客队向下（y 增大）', () => {
  const dir = coordSystem.attackDirection(false);
  assertNear(dir.dx, 0, 0.01);
  assertNear(dir.dy, 1, 0.01, 'Away attacks downward (y increases)');
});

test('defendingGoal - 主队守下方', () => {
  const goal = coordSystem.defendingGoal(true);
  assertNear(goal.x, 50, 0.01);
  assertNear(goal.y, 96, 0.01, 'Home defends at y=96');
});

test('defendingGoal - 客队守上方', () => {
  const goal = coordSystem.defendingGoal(false);
  assertNear(goal.x, 50, 0.01);
  assertNear(goal.y, 4, 0.01, 'Away defends at y=4');
});

test('attackingGoal - 主队攻上方', () => {
  const goal = coordSystem.attackingGoal(true);
  assertNear(goal.x, 50, 0.01);
  assertNear(goal.y, 4, 0.01, 'Home attacks y=4');
});

test('attackingGoal - 客队攻下方', () => {
  const goal = coordSystem.attackingGoal(false);
  assertNear(goal.x, 50, 0.01);
  assertNear(goal.y, 96, 0.01, 'Away attacks y=96');
});

test('isInGoal - 主队球门内', () => {
  assert(coordSystem.isInGoal(50, 97, 'home'), 'Should be in home goal');
  assert(!coordSystem.isInGoal(50, 95, 'home'), 'y=95 is outside home goal');
  assert(!coordSystem.isInGoal(43, 97, 'home'), 'x=43 is outside goal width');
  assert(!coordSystem.isInGoal(57, 97, 'home'), 'x=57 is outside goal width');
});

test('isInGoal - 客队球门内', () => {
  assert(coordSystem.isInGoal(50, 3, 'away'), 'Should be in away goal');
  assert(!coordSystem.isInGoal(50, 5, 'away'), 'y=5 is outside away goal');
});

test('isInGoal - 任意球门', () => {
  assert(coordSystem.isInGoal(50, 97), 'Home goal without team param');
  assert(coordSystem.isInGoal(50, 3), 'Away goal without team param');
  assert(!coordSystem.isInGoal(50, 50), 'Midfield is not a goal');
});

test('isInBox - 主队大禁区', () => {
  assert(coordSystem.isInBox(50, 90, 'home', true), 'Center of home box');
  assert(coordSystem.isInBox(28, 82, 'home', true), 'Top-left corner');
  assert(coordSystem.isInBox(72, 96, 'home', true), 'Bottom-right corner');
  assert(!coordSystem.isInBox(50, 81, 'home', true), 'Just outside (y=81)');
  assert(!coordSystem.isInBox(27, 90, 'home', true), 'Just outside (x=27)');
});

test('isInBox - 客队大禁区', () => {
  assert(coordSystem.isInBox(50, 10, 'away', true), 'Center of away box');
  assert(coordSystem.isInBox(28, 4, 'away', true), 'Top-left corner');
  assert(coordSystem.isInBox(72, 18, 'away', true), 'Bottom-right corner');
  assert(!coordSystem.isInBox(50, 19, 'away', true), 'Just outside (y=19)');
});

test('isInBox - 小禁区更严格', () => {
  assert(coordSystem.isInBox(50, 92, 'home', false), 'In small box');
  assert(!coordSystem.isInBox(50, 86, 'home', false), 'In large box but not small');
  assert(!coordSystem.isInBox(38, 92, 'home', false), 'x=38 outside small box');
});

test('nearestCorner - 主队选择更近的角旗', () => {
  const leftSide = coordSystem.nearestCorner(20, 90, true);
  assertNear(leftSide.x, 5, 0.01, 'Should pick left corner');
  assertNear(leftSide.y, 93, 0.01);

  const rightSide = coordSystem.nearestCorner(80, 90, true);
  assertNear(rightSide.x, 95, 0.01, 'Should pick right corner');
  assertNear(rightSide.y, 93, 0.01);
});

test('nearestCorner - 客队角旗', () => {
  const corner = coordSystem.nearestCorner(20, 10, false);
  assertNear(corner.x, 5, 0.01);
  assertNear(corner.y, 7, 0.01, 'Away corner at y=7');
});

test('distance - 勾股定理', () => {
  const d = coordSystem.distance(0, 0, 3, 4);
  assertNear(d, 5, 0.01, '3-4-5 triangle');

  const d2 = coordSystem.distance(50, 50, 50, 50);
  assertNear(d2, 0, 0.01, 'Same point');
});

test('clamp - 限制在场地内', () => {
  const pos1 = coordSystem.clamp(-5, 50);
  assertNear(pos1.x, 0, 0.01, 'Negative x clamped to 0');
  assertNear(pos1.y, 50, 0.01);

  const pos2 = coordSystem.clamp(105, 110);
  assertNear(pos2.x, 100, 0.01, 'x > 100 clamped to 100');
  assertNear(pos2.y, 100, 0.01, 'y > 100 clamped to 100');

  const pos3 = coordSystem.clamp(50, 50, 10);
  assertNear(pos3.x, 50, 0.01, 'Inside with margin');
  assertNear(pos3.y, 50, 0.01);

  const pos4 = coordSystem.clamp(2, 98, 5);
  assertNear(pos4.x, 5, 0.01, 'x clamped by margin');
  assertNear(pos4.y, 95, 0.01, 'y clamped by margin');
});

test('lerp - 线性插值', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 100 };

  const mid = coordSystem.lerp(from, to, 0.5);
  assertNear(mid.x, 50, 0.01);
  assertNear(mid.y, 50, 0.01);

  const quarter = coordSystem.lerp(from, to, 0.25);
  assertNear(quarter.x, 25, 0.01);
  assertNear(quarter.y, 25, 0.01);

  const start = coordSystem.lerp(from, to, 0);
  assertNear(start.x, 0, 0.01);
  assertNear(start.y, 0, 0.01);

  const end = coordSystem.lerp(from, to, 1);
  assertNear(end.x, 100, 0.01);
  assertNear(end.y, 100, 0.01);
});

test('angleTowards - 计算方向角', () => {
  const right = coordSystem.angleTowards(0, 0, 10, 0);
  assertNear(right, 0, 0.01, 'Right is 0 radians');

  const up = coordSystem.angleTowards(0, 0, 0, -10);
  assertNear(up, -Math.PI / 2, 0.01, 'Up is -π/2');

  const down = coordSystem.angleTowards(0, 0, 0, 10);
  assertNear(down, Math.PI / 2, 0.01, 'Down is π/2');

  const left = coordSystem.angleTowards(0, 0, -10, 0);
  assertNear(Math.abs(left), Math.PI, 0.01, 'Left is ±π');
});

test('getCelebrationCorner - 选择更近的攻方角旗', () => {
  // 主队进球（攻客队球门 y=4），球在左侧
  const homeLeft = coordSystem.getCelebrationCorner(true, 30);
  assertNear(homeLeft.x, 5, 0.01, 'Home scores on left -> away left corner');
  assertNear(homeLeft.y, 7, 0.01);

  // 主队进球，球在右侧
  const homeRight = coordSystem.getCelebrationCorner(true, 70);
  assertNear(homeRight.x, 95, 0.01, 'Home scores on right -> away right corner');

  // 客队进球（攻主队球门 y=96），球在左侧
  const awayLeft = coordSystem.getCelebrationCorner(false, 30);
  assertNear(awayLeft.x, 5, 0.01, 'Away scores on left -> home left corner');
  assertNear(awayLeft.y, 93, 0.01);
});

test('distanceToGoal - 主队射门距离', () => {
  // 主队从中圈射门
  const d1 = coordSystem.distanceToGoal(50, 50, true);
  assertNear(d1, 46, 1, 'From center circle to away goal');

  // 主队从禁区边缘
  const d2 = coordSystem.distanceToGoal(50, 18, true);
  assertNear(d2, 14, 1, 'From away box edge');

  // 主队点球点
  const d3 = coordSystem.distanceToGoal(50, 14, true);
  assertNear(d3, 10, 1, 'From penalty spot');
});

test('distanceToGoal - 客队射门距离', () => {
  // 客队从中圈
  const d1 = coordSystem.distanceToGoal(50, 50, false);
  assertNear(d1, 46, 1, 'From center circle to home goal');

  // 客队从禁区边缘
  const d2 = coordSystem.distanceToGoal(50, 82, false);
  assertNear(d2, 14, 1, 'From home box edge');
});

test('shootingAngle - 正对球门角度最大', () => {
  // 正对球门中心
  const center = coordSystem.shootingAngle(50, 20, true);
  assert(center > 0.7, `Center should have good angle (got ${center})`);

  // 禁区角落（窄角度）
  const corner = coordSystem.shootingAngle(28, 18, true);
  assert(corner < center, `Corner (${corner}) should have worse angle than center (${center})`);
  assert(corner > 0, 'But still positive');

  // 边线外（极窄）
  const wide = coordSystem.shootingAngle(5, 18, true);
  assert(wide < corner, 'Wide position has worst angle');
});

test('logicToScreenPct - 横向球场（主队球门在左）', () => {
  const homeGoal = coordSystem.logicToScreenPct(50, 100);
  assertNear(homeGoal.left, 0, 0.01, 'engine y=100 → screen left');
  assertNear(homeGoal.top, 50, 0.01);

  const awayGoal = coordSystem.logicToScreenPct(50, 0);
  assertNear(awayGoal.left, 100, 0.01, 'engine y=0 → screen right');
  assertNear(awayGoal.top, 50, 0.01);
});

test('logicToCanvas - 横向映射', () => {
  coordSystem.updateCanvasSize(800, 1200, 1);

  const pos1 = coordSystem.logicToCanvas(0, 0);
  assertNear(pos1.x, 800, 0.01, 'engine (0,0) → 客队左角 = 画面右上');
  assertNear(pos1.y, 0, 0.01);

  const pos2 = coordSystem.logicToCanvas(100, 100);
  assertNear(pos2.x, 0, 0.01, 'engine (100,100) → 主队右角 = 画面左下');
  assertNear(pos2.y, 1200, 0.01);

  const pos3 = coordSystem.logicToCanvas(50, 50);
  assertNear(pos3.x, 400, 0.01, 'Center x');
  assertNear(pos3.y, 600, 0.01, 'Center y');
});

test('canvasToLogic - 反向转换', () => {
  coordSystem.updateCanvasSize(800, 1200, 1);

  const pos1 = coordSystem.canvasToLogic(800, 0);
  assertNear(pos1.x, 0, 0.01);
  assertNear(pos1.y, 0, 0.01);

  const pos2 = coordSystem.canvasToLogic(0, 1200);
  assertNear(pos2.x, 100, 0.01);
  assertNear(pos2.y, 100, 0.01);

  const pos3 = coordSystem.canvasToLogic(400, 600);
  assertNear(pos3.x, 50, 0.01);
  assertNear(pos3.y, 50, 0.01);
});

// ============ 运行测试 ============

console.log('\n🧪 Running CoordSystem Tests...\n');

for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   ${error.message}`);
    failed++;
  }
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${tests.length} total\n`);

if (failed > 0) {
  process.exit(1);
}
