// 轻量向量工具
export function len(x, y) { return Math.hypot(x, y); }
export function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// 角度归一化到 [-PI, PI]
export function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
