// 开球摆球：母球 + 15 颗目标球三角堆
import { BALL_R, FOOT, CUE_START, BALL_COLORS } from './constants.js';

function typeOfNumber(n) {
  if (n === 8) return 'eight';
  return n <= 7 ? 'solid' : 'stripe';
}

// 生成一局新摆球（8 号固定居中，其余随机分布）
export function buildRack() {
  const spacing = 2 * BALL_R * 1.02;
  const dx = spacing * Math.cos(Math.PI / 6);
  // 15 个槽位坐标
  const slots = [];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j <= i; j++) {
      slots.push({
        x: FOOT.x + i * dx,
        y: FOOT.y + (j - i / 2) * spacing,
        row: i, col: j,
      });
    }
  }
  // 8 号球放在第 3 排中间（唯一确定位置）
  const centerIdx = slots.findIndex((s) => s.row === 2 && s.col === 1);
  const nums = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  // 洗牌
  for (let k = nums.length - 1; k > 0; k--) {
    const r = Math.floor(Math.random() * (k + 1));
    [nums[k], nums[r]] = [nums[r], nums[k]];
  }
  const balls = [];
  let p = 0;
  slots.forEach((s, idx) => {
    const number = idx === centerIdx ? 8 : nums[p++];
    balls.push({
      id: 'b' + number,
      type: typeOfNumber(number),
      number,
      color: BALL_COLORS[number],
      x: s.x, y: s.y,
    });
  });
  // 母球
  balls.push({
    id: 'cue', type: 'cue', number: 0, color: '#f7f7f7',
    x: CUE_START.x, y: CUE_START.y,
  });
  return balls;
}

// 仅目标球（不含母球）
export function objectBalls(rack) {
  return rack.filter((b) => b.type !== 'cue');
}
