// 八球规则引擎（纯逻辑，客户端/服务端共用）
import { TABLE } from './constants.js';

// 新建一局状态
export function newGame(rack, balls) {
  return {
    phase: 'aim',
    turn: 0,
    open: true,
    groups: [null, null], // 'solid' | 'stripe'
    potted: { solid: [], stripe: [] }, // 已进的目标球 id（按组）
    eightPotted: false,
    winner: null,
    ballInHand: null, // { player, region:'any'|'kitchen' } 犯规后对手获得自由球
    shotIndex: 0, // 已完成的杆数（0 = 尚未开球）
    balls, // 物理球（含 number/type）
  };
}

export function ballById(state, id) {
  return state.balls.find((b) => b.id === id);
}

export function groupOf(state, p) {
  return state.groups[p];
}

// 玩家 p 是否已清完本组 7 颗
export function isCleared(state, p) {
  const g = state.groups[p];
  if (!g) return false;
  return state.potted[g].length >= 7;
}

// 应用一杆结果，原地修改 state，返回可读事件
export function applyShot(state, shot) {
  const me = state.turn;
  const opp = 1 - me;
  state.ballInHand = null; // 新的一杆开始，先清除上一杆的自由球状态
  const potted = shot.pocketed.filter((id) => id !== 'cue');
  const cueScratched = shot.pocketed.includes('cue');
  // 8 号球用「类型」判定（球 id 为 'b8'，不是字符串 'eight'）
  const eightPotted = potted.some((id) => ballById(state, id)?.type === 'eight');
  const fhType = shot.firstHit ? ballById(state, shot.firstHit)?.type : null;

  let foul = false;
  const reasons = [];
  if (cueScratched) { foul = true; reasons.push('母球进袋'); }
  if (!shot.firstHit) { foul = true; reasons.push('空杆未碰球'); }

  if (!state.open && !foul) {
    const myGroup = state.groups[me];
    const onEight = isCleared(state, me);
    if (onEight) {
      if (fhType !== 'eight') { foul = true; reasons.push('清台后未先碰 8 号'); }
    } else if (fhType !== myGroup) {
      foul = true; reasons.push('先碰了非本组球');
    }
  }

  // 未进球且首碰后无任何球到库 → 犯规
  if (!foul && potted.length === 0 && !shot.cushionAfterContact) {
    foul = true; reasons.push('未进球且无球到库');
  }

  // 开放球台：首次合法进球后分配组别
  let assignedNow = null;
  if (state.open && !foul && !eightPotted && potted.length > 0) {
    const tset = new Set(potted.map((id) => ballById(state, id).type));
    if (tset.size === 1) assignedNow = [...tset][0];
  }
  if (assignedNow) {
    state.groups[me] = assignedNow;
    state.groups[opp] = assignedNow === 'solid' ? 'stripe' : 'solid';
    state.open = false;
  }

  // 记录进袋
  for (const id of potted) {
    const t = ballById(state, id).type;
    if (t === 'solid') state.potted.solid.push(id);
    else if (t === 'stripe') state.potted.stripe.push(id);
  }
  if (eightPotted) state.eightPotted = true;

  const events = [];
  if (assignedNow) events.push(`组别确定：你执${assignedNow === 'solid' ? '全色' : '花色'}`);

  // 8 号球结算（胜负）
  if (eightPotted) {
    if (foul || !isCleared(state, me)) {
      state.winner = opp; state.phase = 'over';
      events.push(foul ? '犯规打进 8 号 → 你输' : '未清台打进 8 号 → 你输');
      return { foul, continueTurn: false, events, over: true };
    } else {
      state.winner = me; state.phase = 'over';
      events.push('合法打进 8 号 → 你赢');
      return { foul, continueTurn: false, events, over: true };
    }
  }

  if (foul) {
    events.push('犯规：' + reasons.join('、'));
  }

  // 是否继续（合法且进了本组球）
  const myGroup = state.groups[me];
  const pottedOwn = potted.some((id) => {
    const t = ballById(state, id).type;
    if (state.open) return t !== 'eight';
    return t === myGroup;
  });
  const continueTurn = !foul && pottedOwn;
  if (pottedOwn && !foul) events.push('进球，继续出杆');

  if (!continueTurn) state.turn = opp;
  state.shotIndex = (state.shotIndex || 0) + 1;
  if (foul) {
    // 开球犯规 → 在开球区摆放；其余犯规 → 全台自由球
    const region = (state.shotIndex === 1) ? 'kitchen' : 'any';
    state.ballInHand = { player: state.turn, region };
  }
  return { foul, continueTurn, events, over: false };
}

// 紧凑状态（网络传输用）
export function snapshot(state) {
  return {
    phase: state.phase,
    turn: state.turn,
    open: state.open,
    groups: state.groups,
    potted: state.potted,
    eightPotted: state.eightPotted,
    winner: state.winner,
    ballInHand: state.ballInHand,
    shotIndex: state.shotIndex || 0,
    balls: state.balls.map((b) => ({
      id: b.id, n: b.number, t: b.type, x: +b.x.toFixed(3), y: +b.y.toFixed(3), a: b.active ? 1 : 0,
    })),
  };
}
