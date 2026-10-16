// 游戏主控：统一离线（人机/双人）与在线对战的渲染与逻辑
import { createBalls, createEvents, stepFrame, allResting, strike, placeCue, respawnCue } from '../../shared/physics.js';
import { applyShot } from '../../shared/rules.js';
import { buildRack } from '../../shared/rack.js';
import { TABLE, CUE_START } from '../../shared/constants.js';
import { computeView, drawScene } from './renderer.js';
import { Input } from './input.js';
import { chooseShot } from './ai.js';
import { sfx } from './audio.js';

const INTERP_DELAY = 110; // 在线渲染插值延迟(ms)

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = null;
    this.balls = [];
    this.turn = 0; this.phase = 'aim'; this.open = true;
    this.groups = [null, null]; this.potted = { solid: [], stripe: [] };
    this.eightPotted = false; this.winner = null; this.ballInHand = null;
    this.you = 0; this.aim = null; this.view = null; this.net = null;
    this.events = null; this.acc = 0; this.lastT = 0;
    this.snapBuf = []; this.placeGhost = null; this.placeSent = false; this.difficulty = 'normal';
    this.ui = { message() {}, hud() {}, over() {}, hideOver() {}, netStatus() {} };
    this.input = new Input(canvas, this);
    this.running = true;
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  startOffline(mode, difficulty = 'normal') {
    this.mode = mode; this.net = null; this.you = 0; this.difficulty = difficulty; this.snapBuf = []; this.placeGhost = null; this.placeSent = false;
    const rack = buildRack();
    this.balls = createBalls(rack);
    this.turn = 0; this.phase = 'aim'; this.open = true;
    this.groups = [null, null]; this.potted = { solid: [], stripe: [] };
    this.eightPotted = false; this.winner = null; this.ballInHand = null;
  }
  startOnline(you, snap, net) {
    this.mode = 'online'; this.net = net; this.you = you;
    this.snapBuf = []; this.placeGhost = null; this.placeSent = false;
    this._ingestState(snap);
    this.snapBuf.push({ t: performance.now(), state: snap });
  }

  // 仅更新标量状态（位置在渲染时插值得到），避免直接覆写 this.balls
  _ingestState(snap) {
    this.turn = snap.turn; this.phase = snap.phase; this.open = snap.open;
    this.groups = snap.groups; this.potted = snap.potted;
    this.eightPotted = snap.eightPotted; this.winner = snap.winner;
    this.ballInHand = snap.ballInHand || null;
    if (!this.ballInHand) this.placeSent = false;
    if (this.balls.length !== snap.balls.length) {
      this.balls = snap.balls.map((b) => ({ id: b.id, n: b.n, t: b.t, x: b.x, y: b.y, a: b.a }));
    }
  }

  canShoot() {
    if (this.phase !== 'aim') return false;
    if (this.ballInHand) return false; // 先摆放自由球
    if (this.mode === 'online') return this.turn === this.you;
    if (this.mode === 'ai') return this.turn === 0;
    return true;
  }
  canPlace() {
    if (this.phase !== 'aim' || !this.ballInHand || this.placeSent) return false;
    const local = this.mode === 'online' ? this.you : this.turn;
    return this.ballInHand.player === local;
  }
  commitPlace(x, y) {
    if (!this.canPlace()) return;
    if (this.mode === 'online') {
      this.placeSent = true;
      if (this.net) this.net.send({ t: 'place', x, y });
      this.placeGhost = null;
    } else {
      placeCue(this.balls, x, y, this.ballInHand.region || 'any');
      this.ballInHand = null;
      this.ui.message('母球已摆放，可以出杆');
    }
  }

  shoot(angle, power, force = false) {
    if (this.phase !== 'aim' && !force) return;
    if (!force && !this.canShoot()) return;
    if (this.mode === 'online') { if (this.net) this.net.send({ t: 'input', angle, power }); return; }
    this.phase = 'sim';
    this.events = createEvents();
    strike(this.balls, angle, power);
    sfx.hit();
  }

  _loop(now) {
    if (!this.running) return;
    const dpr = window.devicePixelRatio || 1;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.view = computeView(W, H);

    if (this.mode !== 'online' && this.phase === 'sim') {
      const dt = this.lastT ? (now - this.lastT) / 1000 : 0;
      this.acc += Math.min(dt, 0.1);
      const step = 1 / 60;
      let guard = 0;
      while (this.acc >= step && guard < 8) {
        stepFrame(this.balls, step, this.events);
        this.acc -= step; guard++;
        if (allResting(this.balls)) { this._resolveOffline(); break; }
      }
    } else if (this.mode === 'online') {
      this._interpolate(now);
    }

    drawScene(this.ctx, W, H, this.view, this.balls, this.aim, this.placeGhost, this.placeGhost ? (this.ballInHand && this.ballInHand.region) : null);
    this.ui.hud({ turn: this.turn, groups: this.groups, open: this.open, you: this.you, mode: this.mode, phase: this.phase, ballInHand: this.ballInHand, placing: this.canPlace() });
    this.lastT = now;
    requestAnimationFrame(this._loop);
  }

  // 在线：按 INTERP_DELAY 在两份快照间插值出球位置
  _interpolate(now) {
    const buf = this.snapBuf;
    if (!buf.length) return;
    while (buf.length > 2 && buf[1].t < now - 1000) buf.shift();
    const rt = now - INTERP_DELAY;
    let a = buf[0], b = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) { if (buf[i].t <= rt && buf[i + 1].t >= rt) { a = buf[i]; b = buf[i + 1]; break; } }
    const span = (b.t - a.t) || 1;
    const f = Math.max(0, Math.min(1, (rt - a.t) / span));
    const latest = buf[buf.length - 1].state;
    const prev = new Map(); for (const pb of a.state.balls) prev.set(pb.id, pb);
    for (const lb of latest.balls) {
      let o = this.balls.find((x) => x.id === lb.id);
      if (!o) { o = { id: lb.id, n: lb.n, t: lb.t, x: lb.x, y: lb.y, a: lb.a }; this.balls.push(o); }
      const pa = prev.get(lb.id);
      if (pa) { o.x = pa.x + (lb.x - pa.x) * f; o.y = pa.y + (lb.y - pa.y) * f; }
      else { o.x = lb.x; o.y = lb.y; }
      o.a = lb.a; o.n = lb.n; o.t = lb.t;
    }
  }

  _resolveOffline() {
    const shot = { pocketed: this.events.pocketedOrder, firstHit: this.events.firstHit, cushionAfterContact: !!this.events.cushionAfterContact };
    const res = applyShot(this, shot);
    const cue = this.balls.find((b) => b.t === 'cue');
    if (res.foul) { if (cue) { cue.active = false; cue.vx = 0; cue.vy = 0; } }
    else if (cue && !cue.active) respawnCue(this.balls, CUE_START.x, CUE_START.y);
    if (this.phase !== 'over') this.phase = 'aim';
    if (this.events.pocketedOrder.length) sfx.pot();
    if (res.events.length) this.ui.message(res.events.join('；'));
    if (res.over) { this.ui.over(this.winner); if (this.winner === 0) sfx.win(); return; }
    // AI 回合
    if (this.mode === 'ai' && this.turn === 1) {
      if (this.ballInHand) { this.ui.message('对手获得自由球…'); setTimeout(() => this._aiPlaceShoot(), 700); }
      else { this.ui.message('对手思考中…'); setTimeout(() => this._aiShoot(), 700); }
    }
  }

  _aiPlaceShoot() {
    if (this.mode !== 'ai' || this.phase !== 'aim' || this.turn !== 1 || !this.ballInHand) return;
    const region = this.ballInHand.region || 'any';
    const x = region === 'kitchen' ? TABLE.w * 0.12 + Math.random() * TABLE.w * 0.1 : TABLE.w * 0.3;
    placeCue(this.balls, x, TABLE.h * (0.3 + Math.random() * 0.4), region);
    this.ballInHand = null;
    setTimeout(() => this._aiShoot(), 150);
  }
  _aiShoot() {
    if (this.mode !== 'ai' || this.phase !== 'aim' || this.turn !== 1 || this.ballInHand) return;
    const s = chooseShot(this.balls, this, 1, this.difficulty || 'normal');
    this.shoot(s.angle, s.power, true);
  }

  handleNet(m) {
    if (m.t === 'state') { this._ingestState(m.state); this.snapBuf.push({ t: performance.now(), state: m.state }); }
    else if (m.t === 'placed') { this.ui.message('母球已摆放'); }
    else if (m.t === 'result') { if (m.events && m.events.length) this.ui.message(m.events.join('；')); }
    else if (m.t === 'rematch') { this.ui.message(m.ready && m.ready[0] && m.ready[1] ? '双方就绪，即将开始' : '已准备，等待对手…'); }
    else if (m.t === 'opponent_reconnecting') { this.ui.netStatus('opponent_reconnecting'); }
    else if (m.t === 'opponent_back') { this.ui.netStatus('ok'); }
    else if (m.t === 'reconnected') { this.ui.netStatus('ok'); this.ui.message('已重连'); }
    else if (m.t === 'over') { this.ui.over(m.winner, m.record); if (m.winner === this.you) sfx.win(); }
    else if (m.t === 'opponent_left') { this.ui.message('对手已离开，对局结束'); this.ui.netStatus('closed'); }
  }
}
