// 极简 WebSocket 服务端（零依赖，仅用 Node 内置 crypto / net）
// 支持：握手、文本帧收发、ping/pong、close。足够本游戏小报文使用。
import crypto from 'crypto';
import { EventEmitter } from 'events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WSConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.alive = true;
    this._buf = Buffer.alloc(0);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._die());
    socket.on('error', () => this._die());
  }
  _die() {
    if (!this.alive) return;
    this.alive = false;
    this.emit('close');
  }
  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    // 尽可能解析出完整帧
    while (true) {
      const f = this._parseFrame();
      if (!f) break;
      if (f.opcode === 0x8) { // close
        this.close(); return;
      } else if (f.opcode === 0x9) { // ping -> pong
        this._sendRaw(f.payload, 0xA);
      } else if (f.opcode === 0x1 || f.opcode === 0x2) {
        this.emit('message', f.payload.toString('utf8'));
      }
      // 忽略 continuation/其他
    }
  }
  _parseFrame() {
    const buf = this._buf;
    if (buf.length < 2) return null;
    const b0 = buf[0], b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buf.length < offset + 2) return null;
      len = buf.readUInt16BE(offset); offset += 2;
    } else if (len === 127) {
      if (buf.length < offset + 8) return null;
      const hi = buf.readUInt32BE(offset);
      const lo = buf.readUInt32BE(offset + 4);
      len = hi * 4294967296 + lo; offset += 8;
    }
    let maskKey = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      maskKey = buf.slice(offset, offset + 4); offset += 4;
    }
    if (buf.length < offset + len) return null;
    let payload = buf.slice(offset, offset + len);
    if (masked) {
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
      payload = out;
    }
    this._buf = buf.slice(offset + len);
    return { fin, opcode, payload };
  }
  _sendRaw(payload, opcode) {
    if (!this.alive) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode; header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode; header[1] = 127;
      header.writeUInt32BE(Math.floor(len / 4294967296), 2);
      header.writeUInt32BE(len >>> 0, 6);
    }
    try { this.socket.write(Buffer.concat([header, payload])); } catch (e) { this._die(); }
  }
  send(obj) { this._sendRaw(Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)), 0x1); }
  close() {
    if (!this.alive) return;
    try { this._sendRaw(Buffer.alloc(0), 0x8); } catch (e) {}
    try { this.socket.end(); } catch (e) {}
    this._die();
  }
}

// 在 http server 上升级处理 WebSocket
export function attachWebSocket(httpServer, onConnection) {
  httpServer.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n',
    ].join('\r\n');
    socket.write(headers);
    socket.setNoDelay(true);
    const conn = new WSConn(socket);
    onConnection(conn, req);
  });
}
