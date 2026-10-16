// 离线 AI：为目标球寻找可进袋的击球角度与力度
// 进阶：用真实物理仿真做前瞻（克隆球局→模拟到静止→评估洗袋/续杆/收8），难度越高前瞻候选越多。
import { POCKETS, BALL_R, TABLE, POCKET_R } from '../../shared/constants.js';
import { strike, runShot } from '../../shared/physics.js';

// 难度参数：
//  noise 瞄准抖动 / pickNoise 选杆随机度 / potJitter 力度抖动 /
//  look 前瞻候选数(0=不做) / nextSim 每个可续杆加分 / scratchAvoid 仿真洗袋否决 /
//  safetyPow 安全球力度区间
export const DIFFICULTIES = {
  easy:   { noise: 0.07, pickNoise: 30, potJitter: 0.28, look: 0, nextSim: 0,  scratchAvoid: 0,   safetyPow: [0.30, 0.5] },
  normal: { noise: 0.03, pickNoise: 4,  potJitter: 0.12, look: 3, nextSim: 12, scratchAvoid: 1,   safetyPow: [0.42, 0.52] },
  hard:   { noise: 0.012, pickNoise: 1, potJitter: 0.05, look: 6, nextSim: 22, scratchAvoid: 1,   safetyPow: [0.40, 0.55] },
};

function act(b) { return b.a !== undefined ? b.a : (b.active ? 1 : 0); }
function pointSegDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function segClear(a, b, balls, ignore) {
  for (const o of balls) {
    if (!act(o) || ignore.includes(o.id)) continue;
    if (pointSegDist(o, a, b) < 2 * BALL_R - 0.3) return false;
  }
  return true;
}
function nearestPocket(x, y) { let m = Infinity; for (const p of POCKETS) m = Math.min(m, Math.hypot(p.x - x, p.y - y)); return m; }

function ghost(tg, pk) {
  let dx = tg.x - pk.x, dy = tg.y - pk.y;
  const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  return { x: tg.x + dx * 2 * BALL_R, y: tg.y + dy * 2 * BALL_R };
}
function inTable(p) { return p.x >= BALL_R && p.x <= TABLE.w - BALL_R && p.y >= BALL_R && p.y <= TABLE.h - BALL_R; }

// 克隆当前球局用于仿真（不影响真实球）
function cloneBalls(balls) {
  return balls.map((b) => ({ id: b.id, type: b.type, number: b.number, color: b.color, x: b.x, y: b.y, vx: 0, vy: 0, active: !!act(b) }));
}
function groupBallsActive(sim, group) {
  return sim.filter((b) => b.active && b.type === group);
}
// 仿真后：该组还有多少“可进之球”
function makeableCount(sim, group) {
  const cue = sim.find((b) => b.type === 'cue' && b.active);
  if (!cue) return 0;
  let cnt = 0;
  for (const tg of groupBallsActive(sim, group)) {
    for (const pk of POCKETS) {
      const G = ghost(tg, pk);
      if (!inTable(G)) continue;
      if (!segClear(cue, G, sim, [cue.id, tg.id])) continue;
      if (!segClear(tg, pk, sim, [cue.id, tg.id])) continue;
      cnt++;
    }
  }
  return cnt;
}

export function chooseShot(balls, state, pid, diffName = 'normal') {
  const cfg = DIFFICULTIES[diffName] || DIFFICULTIES.normal;
  const cue = balls.find((b) => b.t === 'cue' && act(b));
  if (!cue) return { angle: 0, power: 0.5 };
  const myGroup = state.groups[pid];
  const cleared = myGroup && state.potted[myGroup].length >= 7;
  let targets;
  if (cleared) targets = balls.filter((b) => b.t === 'eight' && act(b));
  else if (state.open) targets = balls.filter((b) => b.t !== 'cue' && b.t !== 'eight' && act(b));
  else targets = balls.filter((b) => b.t === myGroup && act(b));
  if (targets.length === 0) targets = balls.filter((b) => b.t !== 'cue' && act(b));
  if (targets.length === 0) return { angle: 0, power: 0.4 };

  // ---- 枚举可进球候选 ----
  const cands = [];
  for (const tg of targets) {
    for (const pk of POCKETS) {
      const G = ghost(tg, pk);
      if (!inTable(G)) continue;
      if (!segClear(cue, G, balls, [cue.id, tg.id])) continue;
      if (!segClear(tg, pk, balls, [cue.id, tg.id])) continue;
      const cueToG = Math.hypot(G.x - cue.x, G.y - cue.y);
      const tgToPk = Math.hypot(pk.x - tg.x, pk.y - tg.y);
      const angle = Math.atan2(G.y - cue.y, G.x - cue.x);
      let power = Math.min(1, 0.3 + cueToG / (TABLE.w * 0.85) + tgToPk / (TABLE.w * 0.85));
      power = Math.min(0.95, power);
      cands.push({ tg, pk, G, cueToG, tgToPk, angle, power, base: -cueToG - tgToPk * 0.15 });
    }
  }

  if (cands.length) {
    cands.sort((a, b) => b.base - a.base);
    const pool = cands.slice(0, Math.max(1, cfg.look));
    let best = null;
    for (const c of pool) {
      let score = c.base + (Math.random() - 0.5) * cfg.pickNoise;
      if (cfg.look > 0) {
        // 真实仿真这一杆
        const sim = cloneBalls(balls);
        strike(sim, c.angle, c.power);
        runShot(sim);
        const cueScratched = !sim.find((b) => b.type === 'cue').active;
        if (cueScratched) { score -= 1000 * cfg.scratchAvoid; }
        else {
          const grp = state.open ? c.tg.type : myGroup; // 开放台按本杆进球定组
          score += makeableCount(sim, grp) * cfg.nextSim; // 续杆选择越多越好
          if (groupBallsActive(sim, grp).length === 0 && makeableCount(sim, 'eight') > 0) score += 500; // 能顺势收 8
        }
      }
      if (!best || score > best.score) best = c;
    }
    const angle = best.angle + (Math.random() - 0.5) * cfg.noise;
    const power = Math.min(0.98, best.power * (1 - cfg.potJitter / 2 + Math.random() * cfg.potJitter));
    return { angle, power };
  }

  // ---- 无球可进 → 安全球 ----
  let bestSafe = null;
  for (const tg of targets) {
    const angle = Math.atan2(tg.y - cue.y, tg.x - cue.x);
    const pocketRisk = nearestPocket(tg.x, tg.y) < POCKET_R + 6 ? 40 : 0;
    const score = -pocketRisk - Math.hypot(tg.x - cue.x, tg.y - cue.y) * 0.05 + (Math.random() - 0.5) * 6;
    if (!bestSafe || score > bestSafe.score) bestSafe = { angle, score, tg };
  }
  if (bestSafe) {
    const [lo, hi] = cfg.safetyPow;
    return { angle: bestSafe.angle + (Math.random() - 0.5) * cfg.noise, power: lo + Math.random() * (hi - lo) };
  }

  // 兜底
  let near = targets[0], nd = Infinity;
  for (const t of targets) { const d = Math.hypot(t.x - cue.x, t.y - cue.y); if (d < nd) { nd = d; near = t; } }
  return { angle: Math.atan2(near.y - cue.y, near.x - cue.x), power: 0.5 };
}
