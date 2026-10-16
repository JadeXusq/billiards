// 台球游戏服务端：静态资源 + WebSocket 权威模拟
// 思路（参考 gandengyang 的 ws 方案）：服务端跑物理、按固定频率向客户端广播状态快照，
// 客户端只发送击球意图（角度+力度）与自由球摆放，不做权威判定，避免作弊与不同步。
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { attachWebSocket } from './ws.js';
import { buildRack } from '../shared/rack.js';
import { createBalls, createEvents, stepFrame, allResting, strike, placeCue, respawnCue } from '../shared/physics.js';
import { newGame, applyShot, snapshot } from '../shared/rules.js';
import { CUE_START, SIM_HZ } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.join(__dirname, '..', 'client');
const SHARED_ROOT = path.join(__dirname, '..', 'shared');
const PORT = process.env.PORT || 8080;
const RECONNECT_GRACE_MS = 30000; // 断线重连宽限期
const ROOM_WAIT_TTL = 10 * 60 * 1000; // 建房后长期未配对的房间过期时间

// ---------- 战绩持久化（按匿名 playerId，服务端 JSON 文件） ----------
const DATA_FILE = path.join(__dirname, 'data.json');
const stats = { players: {} };
try { if (fs.existsSync(DATA_FILE)) Object.assign(stats, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch (e) {}
let saveTimer = null;
function saveStats() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(stats)); } catch (e) {} }, 200); }
function recordResult(wPid, lPid) {
  if (!wPid || !lPid || wPid === lPid) return;
  const w = stats.players[wPid] || (stats.players[wPid] = { w: 0, l: 0 });
  const l = stats.players[lPid] || (stats.players[lPid] = { w: 0, l: 0 });
  w.w++; l.l++; saveStats();
}
function recordOf(pid) { const p = stats.players[pid]; return p ? { w: p.w, l: p.l } : { w: 0, l: 0 }; }

// ---------- 静态文件服务 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};
function serve(res, filePath, root) {
  if (!filePath.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}
const httpServer = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') { serve(res, path.join(CLIENT_ROOT, 'index.html'), CLIENT_ROOT); return; }
  if (urlPath.startsWith('/shared/')) { serve(res, path.join(SHARED_ROOT, urlPath.slice('/shared/'.length)), SHARED_ROOT); return; }
  serve(res, path.join(CLIENT_ROOT, urlPath), CLIENT_ROOT);
});

// ---------- 房间管理 ----------
const rooms = new Map();
const matchQueue = []; // 快速匹配等待队列
function genRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do { id = ''; for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)]; } while (rooms.has(id));
  return id;
}
function genPlayerId() { return 'p' + Math.random().toString(36).slice(2, 10); }

class Room {
  constructor(id) {
    this.id = id;
    this.players = [null, null]; // 连接（按座位）
    this.seatPid = [null, null]; // 每座的持久 playerId（断线重连匹配用）
    this.phase = 'waiting';
    this.state = null;
    this.timer = null;
    this.rematchReady = [false, false];
    this.graceTimer = null;
    this.graceSeat = -1;
    this.createdAt = Date.now();
    this.started = false;
  }
  seatOf(conn) { return this.players.indexOf(conn); }
  addPlayer(conn, name, playerId) {
    const pid = this.players[0] ? 1 : 0;
    this.players[pid] = conn;
    this.seatPid[pid] = playerId || genPlayerId();
    conn.pid = pid;
    conn.playerId = this.seatPid[pid];
    conn.name = name || ('玩家' + (pid + 1));
    conn.room = this;
    return pid;
  }
  broadcast(obj) { for (const c of this.players) if (c && c.alive) c.send(obj); }
  broadcastState() { this.broadcast({ t: 'state', state: snapshot(this.state) }); }

  start() {
    const rack = buildRack();
    this.state = newGame(rack, createBalls(rack));
    this.phase = 'aim';
    this.rematchReady = [false, false];
    this.started = true;
    this.players.forEach((c, pid) => {
      if (c) c.send({ t: 'start', you: pid, opp: { name: this.players[1 - pid]?.name || '对手' }, state: snapshot(this.state) });
    });
    this.broadcastState();
  }

  handleInput(conn, angle, power) {
    if (this.phase !== 'aim') return;
    if (!this.state || conn.pid !== this.state.turn) return;
    if (this.state.ballInHand) return; // 必须先摆放自由球
    if (typeof angle !== 'number' || typeof power !== 'number') return;
    power = Math.max(0, Math.min(1, power));
    this.phase = 'sim';
    strike(this.state.balls, angle, power);
    this.broadcast({ t: 'shot', by: conn.pid, angle, power });
    const events = createEvents();
    const tick = () => {
      stepFrame(this.state.balls, 1 / SIM_HZ, events);
      this.broadcastState();
      if (allResting(this.state.balls)) { clearInterval(this.timer); this.timer = null; this.finalize(events); }
    };
    this.timer = setInterval(tick, 1000 / SIM_HZ);
  }

  handlePlace(conn, x, y) {
    if (this.phase !== 'aim' || !this.state) return;
    if (!this.state.ballInHand || this.state.ballInHand.player !== conn.pid) return;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const region = this.state.ballInHand.region || 'any';
    placeCue(this.state.balls, x, y, region);
    this.state.ballInHand = null;
    this.broadcast({ t: 'placed', by: conn.pid });
    this.broadcastState();
  }

  finalize(events) {
    const shot = { pocketed: events.pocketedOrder, firstHit: events.firstHit, cushionAfterContact: !!events.cushionAfterContact };
    const res = applyShot(this.state, shot);
    const cue = this.state.balls.find((b) => b.type === 'cue');
    if (res.foul) { if (cue) { cue.active = false; cue.vx = 0; cue.vy = 0; } } // 犯规：母球入手，等待摆放
    else if (cue && !cue.active) respawnCue(this.state.balls, CUE_START.x, CUE_START.y);
    this.broadcast({ t: 'result', events: res.events, turn: this.state.turn, phase: this.state.phase, foul: res.foul, ballInHand: this.state.ballInHand });
    this.broadcastState();
    if (this.state.phase === 'over') {
      this.phase = 'over';
      this.rematchReady = [false, false];
      const wp = this.seatPid[this.state.winner];
      const lp = this.seatPid[1 - this.state.winner];
      if (wp && lp) recordResult(wp, lp);
      this.players.forEach((c, pid) => {
        if (c) c.send({ t: 'over', winner: this.state.winner, record: recordOf(this.seatPid[pid]) });
      });
    } else {
      this.phase = 'aim';
    }
  }

  handleRematch(conn) {
    if (!this.state || this.state.phase !== 'over') return;
    this.rematchReady[conn.pid] = true;
    this.broadcast({ t: 'rematch', ready: this.rematchReady.slice() });
    if (this.rematchReady[0] && this.rematchReady[1]) { this.start(); }
  }

  // ---- 断线 / 重连 ----
  onDisconnect(conn) {
    const seat = conn.pid;
    if (seat < 0 || !this.seatPid[seat]) return;
    if (this.players[seat] !== conn) return; // 座位已被重连顶替，忽略这条迟到的 close
    this.players[seat] = null;
    const other = this.players[1 - seat];
    if (other) other.send({ t: 'opponent_reconnecting' });
    // 宽限期内保留房间与座位，允许同 playerId 重连；模拟定时器保持运行（广播自动跳过空位），重连者可续上
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceSeat = seat;
    this.graceTimer = setTimeout(() => this.endByAbandon(seat), RECONNECT_GRACE_MS);
  }
  tryReconnect(conn, playerId) {
    const seat = this.seatPid.indexOf(playerId);
    if (seat < 0) return false;
    const cur = this.players[seat];
    if (cur && cur !== conn && cur.alive) return false; // 座位仍被活跃连接占用
    if (cur && cur !== conn) { cur.room = null; cur.pid = -1; } // 失效旧连接，避免其迟到 close 覆盖重连者
    this.players[seat] = conn;
    conn.pid = seat; conn.playerId = playerId; conn.room = this; conn.name = conn.name || ('玩家' + (seat + 1));
    if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = null; this.graceSeat = -1; }
    conn.send({ t: 'reconnected', you: seat, phase: this.phase, state: this.state ? snapshot(this.state) : null });
    const other = this.players[1 - seat];
    if (other) other.send({ t: 'opponent_back' });
    return true;
  }
  endByAbandon(seat) {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const other = this.players[1 - seat];
    if (other) {
      other.send({ t: 'opponent_left' });
      if (this.state && this.phase !== 'over') {
        this.state.winner = other.pid; this.state.phase = 'over'; this.phase = 'over';
        other.send({ t: 'over', winner: other.pid });
      }
    }
    rooms.delete(this.id);
  }
}

// ---------- WebSocket 接入 ----------
attachWebSocket(httpServer, (conn) => {
  conn.pid = -1;
  conn.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || !msg.t) return;
    if (msg.t === 'create') {
      const id = genRoomId();
      const room = new Room(id);
      rooms.set(id, room);
      room.addPlayer(conn, msg.name, msg.pid);
      conn.send({ t: 'created', room: id, you: conn.pid });
    } else if (msg.t === 'join') {
      const room = rooms.get((msg.room || '').toUpperCase());
      if (!room) { conn.send({ t: 'error', msg: '房间不存在' }); return; }
      if (room.players[0] && room.players[1]) { conn.send({ t: 'error', msg: '房间已满' }); return; }
      room.addPlayer(conn, msg.name, msg.pid);
      conn.send({ t: 'joined', room: room.id, you: conn.pid });
      room.start();
    } else if (msg.t === 'reconnect') {
      const room = rooms.get((msg.room || '').toUpperCase());
      if (!room) { conn.send({ t: 'error', msg: '房间已结束' }); return; }
      if (!room.tryReconnect(conn, msg.pid)) { conn.send({ t: 'error', msg: '无法重连（可能已超时或座位被占）' }); return; }
    } else if (msg.t === 'quickmatch') {
      if (conn.room) return;
      if (matchQueue.includes(conn)) { conn.send({ t: 'queued' }); return; }
      conn.playerId = msg.pid || conn.playerId || genPlayerId();
      conn.name = msg.name || conn.name || '玩家';
      let other = null;
      while (matchQueue.length) { const c = matchQueue.shift(); if (c.alive && !c.room) { other = c; break; } }
      if (other) {
        const id = genRoomId();
        const room = new Room(id);
        rooms.set(id, room);
        room.addPlayer(other, other.name, other.playerId);
        room.addPlayer(conn, conn.name, conn.playerId);
        room.start();
      } else {
        matchQueue.push(conn);
        conn.send({ t: 'queued' });
      }
    } else if (msg.t === 'input') {
      if (conn.room) conn.room.handleInput(conn, msg.angle, msg.power);
    } else if (msg.t === 'place') {
      if (conn.room) conn.room.handlePlace(conn, msg.x, msg.y);
    } else if (msg.t === 'rematch') {
      if (conn.room) conn.room.handleRematch(conn);
    }
  });
  conn.on('close', () => {
    const qi = matchQueue.indexOf(conn); if (qi >= 0) matchQueue.splice(qi, 1);
    if (conn.room) conn.room.onDisconnect(conn);
  });
});

httpServer.listen(PORT, () => {
  console.log(`台球游戏服务端已启动: http://localhost:${PORT}`);
  console.log(`手机访问: http://<本机局域网IP>:${PORT}`);
});

// ---------- 房间过期清理（长期未配对/空房） ----------
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.players[0] && room.players[1]) continue; // 满座对局不清
    if ((now - room.createdAt) > ROOM_WAIT_TTL || (!room.players[0] && !room.players[1])) {
      room.broadcast({ t: 'error', msg: '房间已过期' });
      if (room.timer) clearInterval(room.timer);
      rooms.delete(id);
    }
  }
}, 60000);

// ---------- 优雅停机：通知在线对局 ----------
function shutdown() {
  for (const room of rooms.values()) room.broadcast({ t: 'server_shutdown' });
  setTimeout(() => process.exit(0), 300);
  try { httpServer.close(() => process.exit(0)); } catch (e) { process.exit(0); }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
