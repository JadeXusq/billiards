// 网络层封装
export class Net {
  constructor(url) {
    this.url = url;
    this.onmsg = null;
    this.onopen = null;
    this.onclose = null;
    this.ws = null;
    this.open = false;
  }
  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => { this.open = true; if (this.onopen) this.onopen(); };
    this.ws.onclose = () => { this.open = false; if (this.onclose) this.onclose(); };
    this.ws.onmessage = (e) => {
      try { const m = JSON.parse(e.data); if (this.onmsg) this.onmsg(m); } catch (_) {}
    };
  }
  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }
  close() { try { if (this.ws) this.ws.close(); } catch (e) {} }
}
