// 自检 2：触屏输入/瞄准出杆、双人对战、瞄准辅助线渲染、在线客户端流程
import { setupBrowser, pump } from './_browser_env.mjs';
import { buildRack } from '../shared/rack.js';
import { createBalls } from '../shared/physics.js';
import { newGame, snapshot } from '../shared/rules.js';
import { chooseShot } from '../client/src/ai.js';

const { raf, getEl, modeButtons, diffButtons } = setupBrowser();
await import('../client/src/main.js');
const game = globalThis.window.__billiards.game;
const canvas = getEl('game');
let t = 0, fails = 0;
const ok = (n, c) => { console.log((c ? '  ✓ ' : '  ✗ ') + n); if (!c) fails++; };
const ev = (x, y) => ({ clientX: x, clientY: y, pointerId: 1, preventDefault() {} });

function aimAndShoot() {
  const v = game.view;
  const cue = game.balls.find((b) => b.t === 'cue');
  const sx = v.ox + cue.x * v.scale, sy = v.oy + cue.y * v.scale;
  canvas.fire('pointerdown', ev(sx - 40, sy));
  canvas.fire('pointermove', ev(sx - 95, sy));
  canvas.fire('pointerup', ev(sx - 95, sy));
}

console.log('A) 触屏输入 → 瞄准 → 出杆（双人 · 玩家0）');
modeButtons[1].click(); // '2p'
ok('双人开局 16 球', game.mode === '2p' && game.balls.length === 16);
t = pump(raf, 1, t);
ok('开局后可出杆(canShoot)', game.canShoot() === true);
aimAndShoot();
ok('触屏出杆后进入模拟(phase=sim)', game.phase === 'sim');
let g = 0; while (game.phase === 'sim' && g < 700) { t = pump(raf, 1, t); g++; }
ok('一杆后回到 aim', game.phase === 'aim');
console.log('     turn=', game.turn, 'open=', game.open, 'potted=', JSON.stringify(game.potted));
// 玩家1 再出一杆（同屏换手）
aimAndShoot();
ok('玩家1 也可出杆', game.phase === 'sim');
g = 0; while (game.phase === 'sim' && g < 700) { t = pump(raf, 1, t); g++; }
ok('玩家1 一杆后回到 aim', game.phase === 'aim');

console.log('B) 瞄准辅助线渲染（aim.active 走 raycast）');
game.aim = { angle: 0.4, power: 0.7, active: true };
t = pump(raf, 1, t);
game.aim = null;
ok('aim 辅助线渲染无异常', true);

console.log('C) 在线客户端流程（快照/回合门控/发送 input/over）');
const rack = buildRack();
const snap = snapshot(newGame(rack, createBalls(rack)));
const sent = [];
const fakeNet = { send(o) { sent.push(o); } };
game.startOnline(0, snap, fakeNet);
ok('在线开局 balls=16', game.mode === 'online' && game.balls.length === 16);
t = pump(raf, 2, t);
ok('轮到你(you=0)可出杆', game.canShoot() === true);
game.shoot(0.2, 0.8);
ok('在线出杆发送 input', sent.length === 1 && sent[0].t === 'input' && typeof sent[0].angle === 'number');
game.handleNet({ t: 'state', state: { ...snap, phase: 'sim' } });
t = pump(raf, 3, t);
game.handleNet({ t: 'state', state: { ...snap, phase: 'aim', turn: 1 } });
ok('切到对手回合后不可出杆', game.turn === 1 && game.canShoot() === false);
game.handleNet({ t: 'result', events: ['测试事件'], turn: 1, phase: 'aim', foul: false });
game.handleNet({ t: 'over', winner: 0 });
ok('over 回调无异常', true);

console.log('D) 在线快照插值（两帧之间按时间插到中点）');
{
  const snap2 = snapshot(newGame(buildRack(), createBalls(buildRack())));
  const cx = snap2.balls.find((b) => b.t === 'cue').x;
  const t0 = performance.now();
  game.snapBuf = [
    { t: t0, state: snap2 },
    { t: t0 + 100, state: { ...snap2, balls: snap2.balls.map((b) => (b.id === 'cue' ? { ...b, x: cx + 40 } : b)) } },
  ];
  game._interpolate(t0 + 50 + 110); // 渲染时刻 = now - INTERP_DELAY(110)，使之落在两帧中点
  const cue = game.balls.find((b) => b.id === 'cue');
  ok('插值到中点(~+20)', Math.abs(cue.x - (cx + 20)) < 1.5);
}

console.log('E) 自由球摆放（离线：拖摆母球后才能出杆）');
diffButtons[1].click(); // 切回人机离线（普通难度）
t = pump(raf, 1, t);
game.turn = 0; game.ballInHand = { player: 0 };
const cueB = game.balls.find((b) => b.t === 'cue'); cueB.active = false;
ok('自由球时不可出杆、进入摆放', game.canShoot() === false && game.canPlace() === true);
canvas.fire('pointerdown', ev(200, 200));
ok('拖摆出现幽灵母球', !!game.placeGhost);
canvas.fire('pointermove', ev(300, 260));
canvas.fire('pointerup', ev(300, 260));
ok('摆放后母球激活且可出杆', game.ballInHand === null && cueB.active === true && game.canShoot() === true);

console.log('F) 再来一局重置（离线）');
game.phase = 'over'; game.winner = 1; game.turn = 1; game.ballInHand = { player: 1 };
game.startOffline('ai');
ok('重开后状态复位', game.phase === 'aim' && game.turn === 0 && game.winner === null && game.ballInHand === null && game.balls.length === 16);

console.log('G) 开球区自由球：摆放钳制在开球线左侧');
game.turn = 0; game.ballInHand = { player: 0, region: 'kitchen' };
const cueC = game.balls.find((b) => b.t === 'cue'); cueC.active = false;
ok('开球区自由球可摆放', game.canPlace() === true);
canvas.fire('pointerdown', ev(760, 120)); // 试图摆到右侧
canvas.fire('pointermove', ev(760, 120));
canvas.fire('pointerup', ev(760, 120));
ok('母球被钳到开球线左侧且激活', cueC.active === true && cueC.x <= 200 * 0.25 + 0.001 && game.ballInHand === null);

console.log('H) AI 在稀疏局面也返回合法出杆（不抛错、力度有效）');
{
  const sparse = [
    { id: 'cue', type: 'cue', number: 0, color: '#fff', x: 30, y: 50, vx: 0, vy: 0, active: true, t: 'cue', n: 0 },
    { id: 'b2', type: 'solid', number: 2, color: '#1f5fd6', x: 170, y: 20, vx: 0, vy: 0, active: true, t: 'solid', n: 2 },
    { id: 'b10', type: 'stripe', number: 10, color: '#1f5fd6', x: 175, y: 80, vx: 0, vy: 0, active: true, t: 'stripe', n: 10 },
  ];
  const st = { groups: ['solid', 'stripe'], potted: { solid: [], stripe: [] }, open: false };
  const s = chooseShot(sparse, st, 0);
  ok('AI 返回有效角度/力度', typeof s.angle === 'number' && s.power > 0 && s.power <= 1);
}

console.log('I) AI 难度分级：三档均有效（含物理前瞻），且难度被记住');
game.startOffline('ai', 'hard'); t = pump(raf, 1, t);
ok('困难难度已设置', game.difficulty === 'hard');
for (const d of ['easy', 'normal', 'hard']) {
  const s = chooseShot(game.balls, game, 1, d);
  ok(`AI(${d}) 返回有效出杆`, typeof s.angle === 'number' && s.power > 0 && s.power <= 1);
}
// 前瞻会真实仿真候选杆，验证能在合理时间内完成（不卡顿）
{
  const t0 = performance.now();
  chooseShot(game.balls, game, 1, 'hard');
  const dt = performance.now() - t0;
  ok(`hard 前瞻耗时合理(${dt.toFixed(0)}ms < 800ms)`, dt < 800);
}

console.log(fails ? `\nFAILED (${fails})` : '\nALL PASS');
process.exit(fails ? 1 : 0);
