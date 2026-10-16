// 浏览器环境 stub（供 Node 自检客户端用）：严格 canvas（非有限参数抛 IndexSizeError）+ 最小 DOM。
export function setupBrowser() {
  const raf = [];

  function makeCtx() {
    const bad = (name, args) => {
      for (const a of args) {
        if (typeof a === 'number' && !Number.isFinite(a)) {
          const e = new Error(`IndexSizeError: ${name} got non-finite arg [${args.join(', ')}]`);
          e.name = 'IndexSizeError'; throw e;
        }
      }
    };
    const target = {
      save() { bad('save', [...arguments]); }, restore() { bad('restore', [...arguments]); },
      clearRect() { bad('clearRect', [...arguments]); },
      beginPath() { bad('beginPath', [...arguments]); }, closePath() { bad('closePath', [...arguments]); },
      fill() { bad('fill', [...arguments]); }, stroke() { bad('stroke', [...arguments]); },
      fillRect() { bad('fillRect', [...arguments]); }, strokeRect() { bad('strokeRect', [...arguments]); },
      arc() { bad('arc', [...arguments]); }, arcTo() { bad('arcTo', [...arguments]); },
      roundRect() { bad('roundRect', [...arguments]); },
      moveTo() { bad('moveTo', [...arguments]); }, lineTo() { bad('lineTo', [...arguments]); },
      setLineDash() { bad('setLineDash', [...arguments]); },
      fillText() { bad('fillText', [...arguments]); }, strokeText() { bad('strokeText', [...arguments]); },
      setTransform() { bad('setTransform', [...arguments]); },
    };
    return new Proxy(target, {
      get(t, p) { return p in t ? t[p] : () => {}; },
      set(t, p, v) { t[p] = v; return true; },
    });
  }

  function makeEl(id) {
    return {
      id, textContent: '', value: '', dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      _h: {},
      addEventListener(type, fn) { (this._h[type] || (this._h[type] = [])).push(fn); },
      querySelector() { return makeEl(id + '>sub'); },
      querySelectorAll() { return id === 'diffBox' ? diffButtons : []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 400 }; },
      setPointerCapture() {},
      clientWidth: 800, clientHeight: 400, width: 0, height: 0,
      getContext() { return makeCtx(); },
      click() { (this._h.click || []).forEach((f) => f({ preventDefault() {} })); },
      fire(type, ev) { (this._h[type] || []).forEach((f) => f(ev)); },
    };
  }

  const byId = {};
  const getEl = (id) => byId[id] || (byId[id] = makeEl(id));
  const modeButtons = ['ai', '2p', 'online-create', 'online-join'].map((m) => {
    const b = getEl('btn-' + m); b.dataset.mode = m; return b;
  });
  const diffButtons = ['easy', 'normal', 'hard'].map((d) => { const b = getEl('diff-' + d); b.dataset.diff = d; return b; });

  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };

  globalThis.window = {
    devicePixelRatio: 2, innerWidth: 800, innerHeight: 400, localStorage,
    addEventListener() {}, location: { protocol: 'http:', host: 'localhost:8080' },
    AudioContext: function () {
      return { state: 'suspended', resume() {}, currentTime: 0, destination: {},
        createOscillator: () => ({ type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }),
        createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }) };
    },
  };
  globalThis.location = globalThis.window.location;
  globalThis.localStorage = localStorage;
  globalThis.document = { getElementById: getEl, querySelectorAll: (s) => (s === '.modes button' ? modeButtons : []) };
  globalThis.requestAnimationFrame = (cb) => { raf.push(cb); return raf.length; };
  globalThis.cancelAnimationFrame = () => {};

  return { raf, byId, modeButtons, diffButtons, getEl };
}

// 泵送 n 帧；任一帧抛错即打印堆栈并以 code 退出
export function pump(raf, n, startT, onThrowExit = 2) {
  let t = startT || 0;
  for (let i = 0; i < n; i++) {
    const cbs = raf.splice(0);
    for (const cb of cbs) {
      try { cb((t += 16.7)); }
      catch (e) { console.log('\n*** FRAME THREW:', e.name + ': ' + e.message); console.log((e.stack || '').split('\n').slice(0, 6).join('\n')); process.exit(onThrowExit); }
    }
  }
  return t;
}
