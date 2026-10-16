import { Game } from './game.js';
import { Net } from './net.js';
import { sfx } from './audio.js';
import { TABLE } from '../../shared/constants.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const game = new Game(canvas);
let net = null;
let msgTimer = null;
let lastRoom = null;
let reconnecting = false;

// ---------- 本地持久化：玩家 ID（断线重联用）与静音偏好 ----------
let playerId = null;
try { playerId = localStorage.getItem('billiards.pid'); } catch (e) {}
if (!playerId) { playerId = 'p' + Math.random().toString(36).slice(2, 10); try { localStorage.setItem('billiards.pid', playerId); } catch (e) {} }
let muted = false;
try { muted = localStorage.getItem('billiards.muted') === '1'; } catch (e) {}
sfx.setMuted(muted);
function updateSoundBtn() { $('btnSound').textContent = muted ? '🔇' : '🔊'; }
updateSoundBtn();

// ---------- HUD / 遮罩回调 ----------
game.ui.message = (s) => {
  const el = $('msg'); el.textContent = s;
  clearTimeout(msgTimer); msgTimer = setTimeout(() => { el.textContent = ''; }, 3500);
};
game.ui.hud = (info) => {
  const g = (grp) => (grp === 'solid' ? '全色' : grp === 'stripe' ? '花色' : '开放');
  $('p0').querySelector('.group').textContent = info.open ? '开放' : g(info.groups[0]);
  $('p1').querySelector('.group').textContent = info.open ? '开放' : g(info.groups[1]);
  $('p0').classList.toggle('active', info.turn === 0);
  $('p1').classList.toggle('active', info.turn === 1);
  let tip;
  if (info.phase !== 'aim') tip = '击球中…';
  else if (info.placing) tip = '拖动摆放母球，松手确定';
  else if (info.ballInHand) tip = '自由球：请摆放母球';
  else if (info.mode === 'online') tip = info.turn === info.you ? '轮到你出杆' : '对手出杆';
  else if (info.mode === 'ai') tip = info.turn === 0 ? '轮到你出杆' : '对手出杆';
  else tip = '玩家' + (info.turn + 1) + ' 出杆';
  $('turnTip').textContent = tip;
};
game.ui.over = (w, record) => {
  $('overTitle').textContent = game.mode === 'online'
    ? (w === game.you ? '🎉 你赢了！' : '你输了')
    : (w === 0 ? '玩家1 获胜 🎉' : '玩家2 获胜 🎉');
  $('overSub').textContent = (game.mode === 'online' && record) ? `在线战绩：${record.w} 胜 ${record.l} 负` : '';
  $('netOverlay').classList.add('hidden');
  $('overlay').classList.remove('hidden');
};
game.ui.hideOver = () => $('overlay').classList.add('hidden');
game.ui.netStatus = (s) => {
  const n = $('netOverlay');
  if (s === 'opponent_reconnecting') { $('netStatus').textContent = '对手掉线，等待重连…'; n.classList.remove('hidden'); }
  else if (s === 'closed') { $('netStatus').textContent = '连接已断开'; n.classList.remove('hidden'); }
  else n.classList.add('hidden'); // ok
};

// ---------- 界面切换 ----------
function showMenu() { $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); $('overlay').classList.add('hidden'); $('netOverlay').classList.add('hidden'); }
function startGame() { $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); $('overlay').classList.add('hidden'); $('netOverlay').classList.add('hidden'); $('msg').textContent = ''; reconnecting = false; }

// ---------- 菜单 ----------
document.querySelectorAll('.modes button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    sfx.resume();
    if (mode === 'ai') { showDiff(); return; } // 先选难度
    if (mode === '2p') { game.startOffline('2p'); startGame(); }
    else if (mode === 'online-create') { ensureNet(); net.send({ t: 'create', pid: playerId }); $('onlineBox').classList.add('hidden'); $('roomInfo').classList.remove('hidden'); }
    else if (mode === 'online-quick') { ensureNet(); net.send({ t: 'quickmatch', pid: playerId }); $('onlineBox').classList.add('hidden'); $('roomInfo').classList.remove('hidden'); $('roomCode').textContent = '匹配中'; $('roomStatus').textContent = '正在寻找对手…'; }
    else if (mode === 'online-join') { $('onlineBox').classList.remove('hidden'); }
  });
});
$('joinBtn').addEventListener('click', () => {
  const code = ($('roomInput').value || '').trim().toUpperCase();
  if (code.length < 4) { $('roomStatus').textContent = '请输入 4 位房间号'; return; }
  ensureNet();
  net.send({ t: 'join', room: code, pid: playerId });
  $('onlineBox').classList.add('hidden'); $('roomInfo').classList.remove('hidden');
  $('roomStatus').textContent = '已发送加入请求…';
});
$('btnMenu').addEventListener('click', () => { if (net) net.close(); net = null; showMenu(); });
$('btnSound').addEventListener('click', () => { muted = !muted; sfx.setMuted(muted); try { localStorage.setItem('billiards.muted', muted ? '1' : '0'); } catch (e) {} updateSoundBtn(); sfx.resume(); });

// ---------- AI 难度选择 ----------
let lastDiff = 'normal';
try { lastDiff = localStorage.getItem('billiards.diff') || 'normal'; } catch (e) {}
function showDiff() {
  $('onlineBox').classList.add('hidden');
  const box = $('diffBox');
  box.classList.toggle('hidden');
  box.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.diff === lastDiff));
}
$('diffBox').querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const diff = btn.dataset.diff;
    lastDiff = diff;
    try { localStorage.setItem('billiards.diff', diff); } catch (e) {}
    sfx.resume();
    game.startOffline('ai', diff);
    $('diffBox').classList.add('hidden');
    startGame();
  });
});

// ---------- 结算遮罩按钮 ----------
$('btnRematch').addEventListener('click', () => {
  $('overlay').classList.add('hidden');
  if (game.mode === 'online') { if (net) net.send({ t: 'rematch' }); game.ui.message('已准备，等待对手…'); }
  else game.startOffline(game.mode);
});
$('btnToMenu').addEventListener('click', () => { if (net) net.close(); net = null; showMenu(); });
$('netToMenu').addEventListener('click', () => { if (net) net.close(); net = null; showMenu(); });

// ---------- 网络 ----------
function wsUrl() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host; }
function ensureNet() {
  if (net && net.ws && (net.ws.readyState === 0 || net.ws.readyState === 1)) return net;
  net = new Net(wsUrl());
  net.onmsg = onNet;
  net.onopen = () => $('netOverlay').classList.add('hidden');
  net.onclose = () => handleNetClose();
  net.connect();
  return net;
}
function onNet(m) {
  game.net = net; // 保证 game 通过当前连接发送
  switch (m.t) {
    case 'created': lastRoom = m.room; $('roomCode').textContent = m.room; $('roomStatus').textContent = '等待对手加入…'; break;
    case 'joined': lastRoom = m.room; $('roomStatus').textContent = '已加入，等待开始…'; break;
    case 'queued': lastRoom = null; $('roomStatus').textContent = '匹配中，等待对手…'; break;
    case 'start': {
      const oppName = m.opp?.name || '对手';
      if (m.you === 0) { $('p0').querySelector('.name').textContent = '你'; $('p1').querySelector('.name').textContent = oppName; }
      else { $('p0').querySelector('.name').textContent = oppName; $('p1').querySelector('.name').textContent = '你'; }
      game.startOnline(m.you, m.state, net);
      startGame();
      break;
    }
    case 'error': $('roomStatus').textContent = m.msg; break;
    case 'server_shutdown': game.ui.message('服务器正在重启，请稍后重进'); game.ui.netStatus('closed'); break;
    default: game.handleNet(m);
  }
}
// 掉线：在线对局中尝试按 playerId 重连续位
function handleNetClose() {
  if (game.mode !== 'online' || reconnecting) return;
  reconnecting = true;
  $('netStatus').textContent = '连接断开，正在重连…';
  $('netOverlay').classList.remove('hidden');
  let tries = 0;
  const attempt = () => {
    tries++;
    if (tries > 10) { $('netStatus').textContent = '重连失败，请返回菜单重进'; return; }
    const n = new Net(wsUrl());
    net = n; game.net = n;
    n.onmsg = onNet;
    n.onopen = () => { n.send({ t: 'reconnect', room: lastRoom, pid: playerId }); };
    n.onclose = () => setTimeout(attempt, 1500);
    n.connect();
  };
  attempt();
}

// ---------- 横屏提示 ----------
function checkOrientation() {
  const portrait = window.innerHeight > window.innerWidth;
  $('rotateHint').classList.toggle('hidden', !portrait);
}
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', checkOrientation);
checkOrientation();

canvas.addEventListener('pointerdown', () => sfx.resume());
window.__billiards = { game, TABLE };
