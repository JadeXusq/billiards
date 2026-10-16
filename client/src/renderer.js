// 渲染器：把台面/球/瞄准线画到 Canvas（输入为 CSS 像素坐标）
import { TABLE, BALL_R, POCKETS, POCKET_R, BALL_COLORS, HEAD_STRING } from '../../shared/constants.js';

export function computeView(W, H) {
  const m = 14;
  const scale = Math.min((W - 2 * m) / TABLE.w, (H - 2 * m) / TABLE.h);
  return { scale, ox: (W - TABLE.w * scale) / 2, oy: (H - TABLE.h * scale) / 2 };
}
export function screenToTable(view, sx, sy) {
  return [(sx - view.ox) / view.scale, (sy - view.oy) / view.scale];
}
function isActive(b) { return b.a !== undefined ? b.a : (b.active ? 1 : 0); }

function rr(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 从母球沿 angle 射线求首个碰撞（球或库边），用于瞄准辅助线
export function firstContact(balls, cue, angle) {
  const d = [Math.cos(angle), Math.sin(angle)];
  let best = Infinity, hit = null;
  for (const b of balls) {
    if (b === cue || !isActive(b)) continue;
    const fx = cue.x - b.x, fy = cue.y - b.y;
    const bb = 2 * (d[0] * fx + d[1] * fy);
    const c = fx * fx + fy * fy - (2 * BALL_R) * (2 * BALL_R);
    const disc = bb * bb - 4 * c;
    if (disc < 0) continue;
    const t = (-bb - Math.sqrt(disc)) / 2;
    if (t > 1e-3 && t < best) { best = t; hit = b; }
  }
  const xmin = BALL_R, xmax = TABLE.w - BALL_R, ymin = BALL_R, ymax = TABLE.h - BALL_R;
  const tryPlane = (t, axis, val) => {
    if (t > 1e-3 && t < best) {
      const px = cue.x + d[0] * t, py = cue.y + d[1] * t;
      if (px >= xmin - 1 && px <= xmax + 1 && py >= ymin - 1 && py <= ymax + 1) best = t;
    }
  };
  if (d[0] > 1e-6) tryPlane((xmax - cue.x) / d[0]);
  if (d[0] < -1e-6) tryPlane((xmin - cue.x) / d[0]);
  if (d[1] > 1e-6) tryPlane((ymax - cue.y) / d[1]);
  if (d[1] < -1e-6) tryPlane((ymin - cue.y) / d[1]);
  const t = best === Infinity ? 50 : best;
  return { x: cue.x + d[0] * t, y: cue.y + d[1] * t, hit, t };
}

function drawBall(ctx, view, b) {
  if (!isActive(b)) return;
  const num = b.n !== undefined ? b.n : b.number; // 在线快照用 n，离线用 number
  const r = BALL_R * view.scale;
  const cx = view.ox + b.x * view.scale;
  const cy = view.oy + b.y * view.scale;
  ctx.save();
  // 阴影
  ctx.beginPath(); ctx.arc(cx + r * 0.12, cy + r * 0.16, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const color = b.t === 'cue' ? '#f7f7f7' : (b.color || BALL_COLORS[num] || '#ccc');
  if (b.t === 'stripe') {
    ctx.save(); ctx.clip();
    ctx.fillStyle = '#f7f7f7'; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    ctx.fillStyle = color; ctx.fillRect(cx - r, cy - r * 0.5, 2 * r, r);
    ctx.restore();
  } else {
    ctx.fillStyle = color; ctx.fill();
  }
  // 高光
  ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.35, r * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();
  // 描边 + 号码
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  if (b.t !== 'cue') {
    ctx.fillStyle = b.t === 'eight' ? '#fff' : '#fff';
    ctx.font = `${Math.round(r * 0.95)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.strokeText(String(num), cx, cy);
    ctx.fillText(String(num), cx, cy);
  }
  ctx.restore();
}

export function drawScene(ctx, W, H, view, balls, aim, placeGhost, placeRegion) {
  ctx.clearRect(0, 0, W, H);
  const rail = 10 * view.scale;
  // 外框（木边）
  rr(ctx, view.ox - rail, view.oy - rail, TABLE.w * view.scale + 2 * rail, TABLE.h * view.scale + 2 * rail, 18);
  ctx.fillStyle = '#5a3a22'; ctx.fill();
  // 台呢
  rr(ctx, view.ox, view.oy, TABLE.w * view.scale, TABLE.h * view.scale, 8);
  ctx.fillStyle = '#1f7a4d'; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2; ctx.stroke();
  // 袋口
  for (const p of POCKETS) {
    ctx.beginPath(); ctx.arc(view.ox + p.x * view.scale, view.oy + p.y * view.scale, POCKET_R * view.scale, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0f0c'; ctx.fill();
  }
  // 开球区（自由球限开球区时）
  if (placeRegion === 'kitchen') {
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.fillRect(view.ox, view.oy, HEAD_STRING * view.scale, TABLE.h * view.scale);
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(view.ox + HEAD_STRING * view.scale, view.oy);
    ctx.lineTo(view.ox + HEAD_STRING * view.scale, view.oy + TABLE.h * view.scale);
    ctx.stroke(); ctx.setLineDash([]);
  }
  // 瞄准辅助
  const cue = balls.find((b) => b.t === 'cue' && isActive(b));
  if (aim && aim.active && cue) {
    const fc = firstContact(balls, cue, aim.angle);
    const sx = view.ox + cue.x * view.scale, sy = view.oy + cue.y * view.scale;
    const ex = view.ox + fc.x * view.scale, ey = view.oy + fc.y * view.scale;
    const col = aim.power > 0.8 ? '#ff5a5a' : aim.power > 0.5 ? '#ffd66b' : '#9be8b0';
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    //  ghost 球
    ctx.beginPath(); ctx.arc(ex, ey, BALL_R * view.scale, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.5; ctx.stroke();
    if (fc.hit) {
      const dx = fc.hit.x - fc.x, dy = fc.hit.y - fc.y;
      const dl = Math.hypot(dx, dy) || 1;
      ctx.beginPath(); ctx.moveTo(ex, ey);
      ctx.lineTo(ex + (dx / dl) * 26 * view.scale, ey + (dy / dl) * 26 * view.scale);
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.stroke();
    }
  }
  // 球
  for (const b of balls) drawBall(ctx, view, b);

  // 自由球摆放：幽灵母球
  if (placeGhost) {
    const gx = view.ox + placeGhost.x * view.scale, gy = view.oy + placeGhost.y * view.scale;
    ctx.beginPath(); ctx.arc(gx, gy, BALL_R * view.scale, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(247,247,247,.5)'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // 力度条
  if (aim && aim.active) {
    const bw = 160, bh = 10, bx = (W - bw) / 2, by = H - 24;
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(bx, by, bw, bh);
    const col = aim.power > 0.8 ? '#ff5a5a' : aim.power > 0.5 ? '#ffd66b' : '#9be8b0';
    ctx.fillStyle = col; ctx.fillRect(bx, by, bw * aim.power, bh);
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
  }
}
