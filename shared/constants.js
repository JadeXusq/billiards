// 共享常量：物理与桌面几何（抽象单位，渲染时按比例缩放）
// 所有数值集中在此，方便手感调参。

export const TABLE = { w: 200, h: 100 }; // 台面内沿尺寸（2:1，横屏）
export const BALL_R = 2.6; // 球半径
export const POCKET_R = 4.3; // 袋口捕获半径

// 6 个袋：四角 + 两条长边中点
export const POCKETS = [
  { x: 0, y: 0 }, { x: TABLE.w / 2, y: 0 }, { x: TABLE.w, y: 0 },
  { x: 0, y: TABLE.h }, { x: TABLE.w / 2, y: TABLE.h }, { x: TABLE.w, y: TABLE.h },
];

// 物理参数
export const SUBSTEP = 1 / 240; // 物理子步长（确定性积分）
export const DAMP = 2.0; // 滚动阻尼系数（指数衰减 /s）
export const CUSHION_E = 0.85; // 库边弹性
export const BALL_E = 0.96; // 球-球弹性
export const STOP_SPEED = 0.8; // 低于此速度视为静止（单位/s）
export const MAX_SHOT_SPEED = 520; // 满力击球初速度（单位/s）

// 摆放位置
export const FOOT = { x: TABLE.w * 0.72, y: TABLE.h / 2 }; // 球堆顶点（三角顶点朝左）
export const CUE_START = { x: TABLE.w * 0.26, y: TABLE.h / 2 }; // 母球开球点
export const HEAD_STRING = TABLE.w * 0.25; // 开球线：其左侧为开球区（kitchen）

// 球颜色（1-7 全色，8 黑球，9-15 花色）
export const BALL_COLORS = {
  1: '#f4c20d', 2: '#1f5fd6', 3: '#d83a2e', 4: '#5b2d8e', 5: '#e8741e', 6: '#1f8a4c', 7: '#7a1f1f',
  8: '#111111',
  9: '#f4c20d', 10: '#1f5fd6', 11: '#d83a2e', 12: '#5b2d8e', 13: '#e8741e', 14: '#1f8a4c', 15: '#7a1f1f',
};

export const SIM_HZ = 60; // 模拟频率（与帧一致）
