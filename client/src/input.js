// 触屏/鼠标输入：自由球摆放 或 向后拉动蓄力击球（弹弓式）
import { screenToTable } from './renderer.js';
import { HEAD_STRING, BALL_R } from '../../shared/constants.js';

const MAX_PULL = 35; // 达到满力所需的拉动距离（台面单位）

export class Input {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;
    this.active = false;   // 瞄准中
    this.placing = false;  // 自由球摆放中
    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e));
    canvas.addEventListener('pointercancel', (e) => this._cancel(e));
  }
  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  _down(e) {
    if (!this.game.view) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
    if (this.game.canPlace()) { this.placing = true; this._ghost(e); return; }
    if (!this.game.canShoot()) return;
    this.active = true;
    this._update(e);
  }
  _move(e) {
    if (this.placing) { e.preventDefault(); this._ghost(e); return; }
    if (!this.active) return;
    e.preventDefault();
    this._update(e);
  }
  _up(e) {
    e.preventDefault();
    if (this.placing) {
      this.placing = false;
      const [px, py] = this._pos(e);
      const v = this.game.view;
      if (v) { const [tx, ty] = screenToTable(v, px, py); this.game.commitPlace(tx, ty); }
      this.game.placeGhost = null;
      return;
    }
    if (!this.active) return;
    this.active = false;
    const aim = this.game.aim;
    this.game.aim = null;
    if (aim && aim.power > 0.04) this.game.shoot(aim.angle, aim.power);
  }
  _cancel(e) {
    if (this.placing) { this.placing = false; this.game.placeGhost = null; return; }
    if (this.active) { this.active = false; this.game.aim = null; }
  }
  _ghost(e) {
    const [px, py] = this._pos(e);
    let [tx, ty] = screenToTable(this.game.view, px, py);
    // 开球区自由球：预览也钳制在开球线左侧
    if (this.game.ballInHand && this.game.ballInHand.region === 'kitchen') {
      tx = Math.max(BALL_R, Math.min(HEAD_STRING - BALL_R, tx));
      ty = Math.max(BALL_R, ty);
    }
    this.game.placeGhost = { x: tx, y: ty };
  }
  _update(e) {
    const [px, py] = this._pos(e);
    const v = this.game.view;
    if (!v) return;
    const [tx, ty] = screenToTable(v, px, py);
    const cue = this.game.balls.find((b) => b.t === 'cue' && (b.a !== undefined ? b.a : b.active ? 1 : 0));
    if (!cue) return;
    const pullx = tx - cue.x, pully = ty - cue.y;
    const dist = Math.hypot(pullx, pully);
    if (dist < 1e-3) return;
    const angle = Math.atan2(-pully, -pullx); // 击球方向 = 拉动反方向
    const power = Math.min(dist / MAX_PULL, 1);
    this.game.aim = { angle, power, active: true };
  }
}
