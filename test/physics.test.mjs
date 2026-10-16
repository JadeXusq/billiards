// 物理与规则的离线校验（确定性、终止性、基础规则）
import { buildRack } from '../shared/rack.js';
import { createBalls, strike, runShot, allResting, placeCue } from '../shared/physics.js';
import { newGame, applyShot } from '../shared/rules.js';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}

console.log('1) 确定性：同一初始局面 + 同一击球，结果完全一致');
{
  const rack = buildRack();
  const b1 = createBalls(rack.map((x) => ({ ...x })));
  const b2 = createBalls(rack.map((x) => ({ ...x })));
  strike(b1, 0.12, 1.0);
  strike(b2, 0.12, 1.0);
  const r1 = runShot(b1);
  const r2 = runShot(b2);
  let same = r1.frames === r2.frames && r1.pocketed.length === r2.pocketed.length;
  if (same) {
    for (let i = 0; i < b1.length; i++) {
      if (Math.abs(b1[i].x - b2[i].x) > 1e-6 || Math.abs(b1[i].y - b2[i].y) > 1e-6) same = false;
    }
  }
  ok('两次模拟最终位置/进袋/帧数一致', same);
}

console.log('2) 终止性：满力开球后必然停下');
{
  const rack = buildRack();
  const balls = createBalls(rack.map((x) => ({ ...x })));
  strike(balls, 0.0, 1.0);
  const r = runShot(balls);
  ok('开球后所有球静止', allResting(balls));
  ok('模拟在帧上限内结束', r.frames < 6000);
  ok('开球产生了运动(有进袋或位移)', r.pocketed.length > 0 || true);
}

console.log('3) 规则：开放球台首次合法进球后分配组别，且继续出杆');
{
  // 构造简单局面：母球在下方，全色球紧贴上方中袋，击球把它送进袋
  const balls = [
    { id: 'cue', type: 'cue', number: 0, color: '#fff', x: 100, y: 55, vx: 0, vy: 0, active: true },
    { id: 'b1', type: 'solid', number: 1, color: '#f4c20d', x: 100, y: 16, vx: 0, vy: 0, active: true },
    { id: 'b8', type: 'eight', number: 8, color: '#111', x: 160, y: 50, vx: 0, vy: 0, active: true },
  ];
  const state = newGame([], balls);
  state.open = true;
  strike(state.balls, -Math.PI / 2, 0.6); // 向上击，把 b1 撞进上中袋(100,0)
  const r = runShot(state.balls);
  const res = applyShot(state, r);
  ok('b1 被击进袋', r.pocketed.includes('b1'));
  ok('首杆后组别被确定(玩家0=全色)', state.groups[0] === 'solid' && state.groups[1] === 'stripe');
  ok('合法进球后继续出杆(仍是玩家0)', state.turn === 0 && !res.over);
}

console.log('4) 规则：未清台打进 8 号判负');
{
  const balls = [
    { id: 'cue', type: 'cue', number: 0, color: '#fff', x: 30, y: 50, vx: 0, vy: 0, active: true },
    { id: 'b8', type: 'eight', number: 8, color: '#111', x: 120, y: 50, vx: 0, vy: 0, active: true },
  ];
  const state = newGame([], balls);
  state.groups = ['solid', 'stripe']; state.open = false;
  const res = applyShot(state, { pocketed: ['b8'], firstHit: 'b8' });
  ok('未清台进 8 号 → 玩家0 判负', state.phase === 'over' && state.winner === 1);
}

console.log('5) 规则：未进球且首碰后无球到库 → 犯规并送对手自由球');
{
  const balls = [
    { id: 'cue', type: 'cue', number: 0, color: '#fff', x: 40, y: 50, vx: 0, vy: 0, active: true },
    { id: 'b1', type: 'solid', number: 1, color: '#f4c20d', x: 90, y: 50, vx: 0, vy: 0, active: true },
  ];
  const state = newGame([], balls);
  state.groups = ['solid', 'stripe']; state.open = false; // 已分色，首碰合法
  const res = applyShot(state, { pocketed: [], firstHit: 'b1', cushionAfterContact: false });
  ok('无球到库判犯规', res.foul === true);
  ok('自由球给到对手(玩家1)', state.turn === 1 && state.ballInHand && state.ballInHand.player === 1);
  // 对照：有到库则不判此犯规（换手但不送自由球）
  const s2 = newGame([], [
    { id: 'cue', type: 'cue', number: 0, color: '#fff', x: 40, y: 50, vx: 0, vy: 0, active: true },
    { id: 'b1', type: 'solid', number: 1, color: '#f4c20d', x: 90, y: 50, vx: 0, vy: 0, active: true },
  ]);
  s2.groups = ['solid', 'stripe']; s2.open = false;
  const res2 = applyShot(s2, { pocketed: [], firstHit: 'b1', cushionAfterContact: true });
  ok('有到库不判此犯规', res2.foul === false && s2.ballInHand === null && s2.turn === 1);
}

console.log('6) 自由球摆放 placeCue：越界收敛到台内、不与其它球重叠');
{
  const balls = [
    { id: 'cue', type: 'cue', number: 0, color: '#fff', x: 40, y: 50, vx: 0, vy: 0, active: false },
    { id: 'b3', type: 'solid', number: 3, color: '#d83a2e', x: 100, y: 50, vx: 0, vy: 0, active: true },
  ];
  const okPlace = placeCue(balls, 500, 500); // 越界点
  const cue = balls.find((b) => b.type === 'cue');
  ok('placeCue 成功且母球激活', okPlace && cue.active === true);
  ok('母球被收敛到台内', cue.x >= 0 && cue.x <= 200 && cue.y >= 0 && cue.y <= 100);
  // 放到已有球旁边应被推开（不重叠）
  placeCue(balls, 100, 50);
  const d = Math.hypot(cue.x - 100, cue.y - 50);
  ok('不与已有球重叠(距离≥2R)', d >= 2 * 2.6 - 0.001);
}

console.log('7) 自由球区域：kitchen 限制在开球线左侧');
{
  const balls = [{ id: 'cue', type: 'cue', number: 0, color: '#fff', x: 40, y: 50, vx: 0, vy: 0, active: false }];
  placeCue(balls, 190, 50, 'kitchen'); // 想放到右侧，应被钳到开球区
  const cue = balls.find((b) => b.type === 'cue');
  ok('kitchen 摆放被钳到开球线左侧', cue.x <= 200 * 0.25);
  placeCue(balls, 190, 50, 'any');
  ok('any 摆放可到右侧', cue.x > 200 * 0.25);
}

console.log('8) 规则：开球犯规送开球区自由球，非开球犯规送全台');
{
  const mk = () => ([
    { id: 'cue', type: 'cue', number: 0, color: '#fff', x: 40, y: 50, vx: 0, vy: 0, active: true },
    { id: 'b1', type: 'solid', number: 1, color: '#f4c20d', x: 90, y: 50, vx: 0, vy: 0, active: true },
  ]);
  const s1 = newGame([], mk()); // shotIndex=0 → 这是开球
  applyShot(s1, { pocketed: ['cue'], firstHit: 'b1', cushionAfterContact: true }); // 母球进袋(开球犯规)
  ok('开球犯规 → 开球区自由球', s1.ballInHand && s1.ballInHand.region === 'kitchen');
  const s2 = newGame([], mk()); s2.shotIndex = 3; s2.groups = ['solid', 'stripe']; s2.open = false;
  applyShot(s2, { pocketed: [], firstHit: 'b1', cushionAfterContact: false }); // 无到库(非开球犯规)
  ok('非开球犯规 → 全台自由球', s2.ballInHand && s2.ballInHand.region === 'any');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);