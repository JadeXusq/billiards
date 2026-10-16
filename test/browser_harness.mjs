// 自检 1：离线人机流程（渲染画球 → AI 选杆 → 玩家开球 → 换 AI → AI 出杆）
import { setupBrowser, pump } from './_browser_env.mjs';
import { chooseShot } from '../client/src/ai.js';

const { raf, diffButtons } = setupBrowser();
await import('../client/src/main.js');
const game = globalThis.window.__billiards.game;
let t = 0, fails = 0;
const ok = (n, c) => { console.log((c ? '  ✓ ' : '  ✗ ') + n); if (!c) fails++; };

console.log('offline AI flow');
diffButtons[1].click(); // 选择「普通」难度开局
ok('人机开局 16 球', game.mode === 'ai' && game.balls.length === 16);
ok('物理球带 t/n 别名（渲染/AI 形状统一）', game.balls[0].t !== undefined && game.balls[0].n !== undefined);
t = pump(raf, 6, t);
ok('渲染循环画球无异常', true);

const s = chooseShot(game.balls, game, 1);
ok('AI 选杆返回有效角度/力度', typeof s.angle === 'number' && typeof s.power === 'number' && s.power > 0);

game.shoot(0.12, 0.9);
let g = 0; while (game.phase === 'sim' && g < 700) { t = pump(raf, 1, t); g++; }
ok('玩家开球后回到 aim', game.phase === 'aim');
console.log('     turn=', game.turn, 'open=', game.open, 'groups=', JSON.stringify(game.groups));

if (game.mode === 'ai' && game.turn === 1 && game.phase === 'aim') {
  game._aiShoot();
  g = 0; while (game.phase === 'sim' && g < 700) { t = pump(raf, 1, t); g++; }
  ok('AI 出杆后回到 aim', game.phase === 'aim');
  console.log('     turn=', game.turn);
}
console.log(fails ? `FAILED (${fails})` : 'DONE');
process.exit(fails ? 1 : 0);
