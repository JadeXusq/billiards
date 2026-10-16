// 在线对战端到端冒烟测试：创建→加入→开局→状态广播→击球模拟→断线重连续位
// 验证自研零依赖 WebSocket 服务端的握手、帧编解码、房间开局、权威模拟广播与重连。
import http from 'http';
import crypto from 'crypto';
import { EventEmitter } from 'events';

class WSClient extends EventEmitter {
  constructor(port, host = '127.0.0.1') { super(); this.port = port; this.host = host; this.buf = Buffer.alloc(0); this.key = crypto.randomBytes(16).toString('base64'); this._closed = false; }
  connect() {
    const req = http.request({ host: this.host, port: this.port, path: '/', headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': this.key, 'Sec-WebSocket-Version': '13' } });
    req.on('upgrade', (res, socket) => { this.socket = socket; socket.on('error', () => {}); socket.on('data', (d) => this._on(d)); socket.on('close', () => this.emit('close')); this.emit('open'); });
    req.on('error', (e) => this.emit('error', e));
    req.end();
  }
  _on(chunk) { this.buf = Buffer.concat([this.buf, chunk]); while (true) { const f = this._parse(); if (!f) break; if (f.opcode === 0x1) this.emit('message', f.payload.toString('utf8')); else if (f.opcode === 0x8) this.close(false); } }
  _parse() {
    const b = this.buf; if (b.length < 2) return null;
    const opcode = b[0] & 0x0f; let len = b[1] & 0x7f; let off = 2;
    if (len === 126) { if (b.length < 4) return null; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return null; len = b.readUInt32BE(6); off = 10; }
    if (b.length < off + len) return null;
    const payload = b.slice(off, off + len); this.buf = b.slice(off + len); return { opcode, payload };
  }
  send(obj) {
    const payload = Buffer.from(JSON.stringify(obj)); const len = payload.length; const mask = crypto.randomBytes(4); let header;
    if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
    else { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
    const masked = Buffer.allocUnsafe(len); for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }
  close(sendFrame = true) {
    if (this._closed) return;
    this._closed = true;
    try { if (this.socket) { if (sendFrame) this.socket.write(Buffer.from([0x88, 0x80, 0, 0, 0, 0])); this.socket.end(); } } catch (e) {}
  }
}

const port = process.env.PORT || 8080;
const c1 = new WSClient(port), c2 = new WSClient(port), c3 = new WSClient(port);
const PID1 = 'TESTPID1', PID2 = 'TESTPID2';
let room = null, start1 = false, start2 = false, gotState = false, resultGot = false, done = false, shotSent = false;

function finish(code, msg) { if (done) return; done = true; console.log(msg); try { c1.close(); c2.close(); c3.close(); } catch (e) {} setTimeout(() => process.exit(code), 50); }

// ---------- 阶段 1：快速匹配（两名等待者自动配对开局） ----------
const q1 = new WSClient(port), q2 = new WSClient(port);
let qStart = 0, qDone = false;
function checkQ() {
  if (qDone || qStart < 2) return;
  qDone = true;
  console.log('✓ 快速匹配通过：两名等待者自动配对并开局');
  try { q1.close(); q2.close(); } catch (e) {}
  startMain();
}
q1.on('open', () => q1.send({ t: 'quickmatch', pid: 'QPID1' }));
q2.on('open', () => q2.send({ t: 'quickmatch', pid: 'QPID2' }));
q1.on('message', (m) => { if (JSON.parse(m).t === 'start') { qStart++; checkQ(); } });
q2.on('message', (m) => { if (JSON.parse(m).t === 'start') { qStart++; checkQ(); } });
q1.connect(); q2.connect();
setTimeout(() => { if (!qDone) finish(1, '✗ 快速匹配超时'); }, 8000);

// ---------- 阶段 2：建房/加入/击球/断线重连 ----------
function startMain() {
c1.on('open', () => c1.send({ t: 'create', pid: PID1 }));
c1.on('message', (m) => {
  const o = JSON.parse(m);
  if (o.t === 'created') { room = o.room; c2.connect(); setTimeout(() => c2.send({ t: 'join', room, pid: PID2 }), 80); }
  else if (o.t === 'start') { start1 = true; if (!shotSent) { shotSent = true; setTimeout(() => c1.send({ t: 'input', angle: 0.12, power: 0.85 }), 60); } }
  else if (o.t === 'state') { gotState = true; }
  else if (o.t === 'result') { resultGot = true; startReconnectTest(); }
});
c2.on('message', (m) => { const o = JSON.parse(m); if (o.t === 'start') start2 = true; else if (o.t === 'state') gotState = true; });

function startReconnectTest() {
  if (!(start1 && start2 && gotState && resultGot)) return;
  c1.close();
  setTimeout(() => {
    c3.on('open', () => c3.send({ t: 'reconnect', room, pid: PID1 }));
    c3.on('message', (m) => {
      const o = JSON.parse(m);
      if (o.t === 'reconnected' && o.you === 0) finish(0, '✓ 在线流程通过：创建/加入/开局/广播/击球模拟/断线重连 均正常');
      else if (o.t === 'error') finish(1, '✗ 重连被拒：' + o.msg);
    });
    c3.connect();
  }, 400);
}

c1.connect();
setTimeout(() => { if (!done) finish(1, '✗ 在线流程超时未完成'); }, 12000);
}
