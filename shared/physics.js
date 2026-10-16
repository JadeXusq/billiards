// 共享物理引擎：纯函数、确定性、无外部依赖。
// 客户端与服务端都引用同一份，保证在线对战时服务端权威模拟与客户端表现一致。
import {
  TABLE, BALL_R, POCKETS, POCKET_R, SUBSTEP, DAMP, CUSHION_E, BALL_E,
  STOP_SPEED, MAX_SHOT_SPEED, HEAD_STRING,
} from './constants.js';

// 一杆的事件收集器（firstHit 首碰球、pocketedOrder 进袋顺序、cushionAfterContact 首碰后是否有球到库）
export function createEvents() {
  return { firstHit: null, pocketedOrder: [], cushionAfterContact: false };
}

// 由 rack 定义创建运行期的球对象（含速度、active 标记）
// 同时提供 t/n 别名，使客户端渲染/AI 无需区分「在线快照(id,n,t,a)」与「离线物理球(id,number,type,active)」两种形状。
export function createBalls(rack) {
  return rack.map((b) => ({
    id: b.id, type: b.type, t: b.type,
    number: b.number, n: b.number, color: b.color,
    x: b.x, y: b.y, vx: 0, vy: 0, active: true,
  }));
}

// 单个物理子步。events 可选，用于记录本杆事件（首次碰撞、进袋顺序、首碰后到库）。
export function substep(balls, events) {
  const damp = Math.exp(-DAMP * SUBSTEP);
  // 1) 积分 + 阻尼
  for (const b of balls) {
    if (!b.active) continue;
    b.x += b.vx * SUBSTEP;
    b.y += b.vy * SUBSTEP;
    b.vx *= damp;
    b.vy *= damp;
    if (b.vx * b.vx + b.vy * b.vy < STOP_SPEED * STOP_SPEED) { b.vx = 0; b.vy = 0; }
  }
  // 2) 球-球碰撞（等质量弹性）
  const min = 2 * BALL_R;
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i];
    if (!a.active) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const c = balls[j];
      if (!c.active) continue;
      const dx = c.x - a.x, dy = c.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < min * min && d2 > 1e-9) {
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        const pen = (min - d) / 2;
        a.x -= nx * pen; a.y -= ny * pen;
        c.x += nx * pen; c.y += ny * pen;
        const rvx = c.vx - a.vx, rvy = c.vy - a.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const jimp = -(1 + BALL_E) * vn / 2; // 等质量
          a.vx -= jimp * nx; a.vy -= jimp * ny;
          c.vx += jimp * nx; c.vy += jimp * ny;
          if (events && events.firstHit === null) {
            if (a.type === 'cue') events.firstHit = c.id;
            else if (c.type === 'cue') events.firstHit = a.id;
          }
        }
      }
    }
  }
  // 3) 进袋 + 库边反弹
  for (const b of balls) {
    if (!b.active) continue;
    let captured = false;
    for (const p of POCKETS) {
      const dx = b.x - p.x, dy = b.y - p.y;
      if (dx * dx + dy * dy < POCKET_R * POCKET_R) {
        b.active = false; b.vx = 0; b.vy = 0;
        if (events) events.pocketedOrder.push(b.id);
        captured = true;
        break;
      }
    }
    if (captured) continue;
    let bounced = false;
    if (b.x < BALL_R) { b.x = BALL_R; if (b.vx < 0) { b.vx = -b.vx * CUSHION_E; bounced = true; } }
    else if (b.x > TABLE.w - BALL_R) { b.x = TABLE.w - BALL_R; if (b.vx > 0) { b.vx = -b.vx * CUSHION_E; bounced = true; } }
    if (b.y < BALL_R) { b.y = BALL_R; if (b.vy < 0) { b.vy = -b.vy * CUSHION_E; bounced = true; } }
    else if (b.y > TABLE.h - BALL_R) { b.y = TABLE.h - BALL_R; if (b.vy > 0) { b.vy = -b.vy * CUSHION_E; bounced = true; } }
    // 首碰球之后发生的到库，才计入「合法击球所需的到库」
    if (bounced && events && events.firstHit !== null) events.cushionAfterContact = true;
  }
}

// 推进一帧（固定 dt，内部多子步）
export function stepFrame(balls, dt = 1 / 60, events) {
  const n = Math.max(1, Math.round(dt / SUBSTEP));
  for (let k = 0; k < n; k++) substep(balls, events);
}

// 是否全部静止
export function allResting(balls) {
  for (const b of balls) if (b.active && (b.vx !== 0 || b.vy !== 0)) return false;
  return true;
}

// 击球：给母球设定初速度（angle 弧度，power 0..1）
export function strike(balls, angle, power) {
  const cue = balls.find((b) => b.type === 'cue' && b.active);
  if (!cue) return false;
  const sp = Math.max(0, Math.min(1, power)) * MAX_SHOT_SPEED;
  cue.vx = Math.cos(angle) * sp;
  cue.vy = Math.sin(angle) * sp;
  return true;
}

// 运行整杆直到静止，返回本杆事件（用于规则判定）
export function runShot(balls, maxFrames = 6000) {
  const events = createEvents();
  let frames = 0;
  while (!allResting(balls) && frames < maxFrames) {
    stepFrame(balls, 1 / 60, events);
    frames++;
  }
  return { pocketed: events.pocketedOrder, firstHit: events.firstHit, cushionAfterContact: events.cushionAfterContact, frames };
}

// 自由球摆放：把母球放到 (x,y)（限制在台内、按区域钳制、避免与其它球重叠）
// region: 'any' 全台 | 'kitchen' 仅开球区（开球线左侧）
export function placeCue(balls, x, y, region = 'any') {
  const cue = balls.find((b) => b.type === 'cue');
  if (!cue) return false;
  cue.vx = 0; cue.vy = 0;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const maxX = region === 'kitchen' ? HEAD_STRING - BALL_R : TABLE.w - BALL_R;
  const near = (ax, ay) => balls.some((b) => b.active && b !== cue && Math.hypot(b.x - ax, b.y - ay) < 2 * BALL_R);
  let px = clamp(x, BALL_R, maxX);
  let py = clamp(y, BALL_R, TABLE.h - BALL_R);
  let tries = 0;
  while (near(px, py) && tries < 80) {
    px = clamp(px + (Math.random() - 0.5) * 3, BALL_R, maxX);
    py = clamp(py + (Math.random() - 0.5) * 3, BALL_R, TABLE.h - BALL_R);
    tries++;
  }
  cue.x = px; cue.y = py; cue.active = true;
  return true;
}

// 母球进袋后重新摆放（若目标点被占则做小幅偏移）
export function respawnCue(balls, x, y) {
  placeCue(balls, x, y);
}
