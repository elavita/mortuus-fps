// 僵尸模式数据：Perk、强化卡、特殊敌人、回合参数、墙面武器与神秘箱
import { WEAPONS } from './data.js';

// ---------------- 回合参数 ----------------
export const ROUND = {
  // 第 r 回合的僵尸总数
  count(r) { return Math.floor(6 + r * 2.2); },
  // 单只僵尸基础生命（指数增长）
  hp(r) { return Math.round(100 * Math.pow(1.115, r - 1)); },
  // 单只僵尸移速
  speed(r) { return 1.85 + Math.min(1.35, (r - 1) * 0.055); },
  // 伤害
  dmg(r) { return Math.round(18 + r * 3.2); },
  // 每批刷怪数量
  batch(r) { return Math.max(1, Math.min(6, Math.ceil(r / 3))); },
  // 批次间隔
  batchGap(r) { return Math.max(0.28, 0.95 - r * 0.035); },
  // 回合结束奖励
  bonus(r) { return 100 * r; },
};

// ---------------- 点数 ----------------
export const POINTS = {
  hit: 10, kill: 50, headKill: 100, meleeKill: 130,
  wallAmmoRatio: 0.5,
};

// ---------------- Perk ----------------
// id, 名称, 价格, 颜色, 图标, 效果字段
export const ZPERKS = [
  { id: 'jug', name: '厚血', en: 'JUGGERNOG', price: 2500, color: '#c0392b', icon: '❤', desc: '最大生命 +100，并立即回满。' },
  { id: 'speed', name: '快手', en: 'SPEED COLA', price: 3000, color: '#2980b9', icon: '✋', desc: '换弹速度 +40%，切枪速度 +30%。' },
  { id: 'stamina', name: '疾行', en: 'STAMIN-UP', price: 2000, color: '#27ae60', icon: '🏃', desc: '移动速度 +14%，冲刺时不再减速。' },
  { id: 'doubletap', name: '双发', en: 'DOUBLE TAP', price: 3500, color: '#8e44ad', icon: '⚡', desc: '射速 +33%，伤害 +15%。' },
  { id: 'deadshot', name: '鹰眼', en: 'DEADSHOT', price: 4000, color: '#d35400', icon: '🎯', desc: '开镜伤害 +30%，爆头伤害 +60%。' },
];

export function zperkById(id) { return ZPERKS.find(p => p.id === id); }

// ---------------- 强化卡池 ----------------
// rarity: 1 普通 / 2 稀有 / 3 史诗
export const CARDS = [
  // 火力
  { id: 'dmg1', cat: '火力', name: '穿甲弹头', icon: '🔴', rarity: 1, desc: '所有武器伤害 +12%', apply: s => s.dmgMul *= 1.12 },
  { id: 'dmg2', cat: '火力', name: '高爆装药', icon: '💥', rarity: 2, desc: '所有武器伤害 +22%', apply: s => s.dmgMul *= 1.22 },
  { id: 'dmg3', cat: '火力', name: '屠戮协议', icon: '☠', rarity: 3, desc: '所有武器伤害 +40%', apply: s => s.dmgMul *= 1.4 },
  { id: 'rpm1', cat: '火力', name: '轻量枪机', icon: '⚙', rarity: 1, desc: '射速 +12%', apply: s => s.rpmMul *= 1.12 },
  { id: 'rpm2', cat: '火力', name: '过载枪机', icon: '⚙', rarity: 2, desc: '射速 +25%', apply: s => s.rpmMul *= 1.25 },
  { id: 'mag1', cat: '火力', name: '扩容弹匣', icon: '📦', rarity: 1, desc: '弹匣容量 +35%，备弹 +35%', apply: s => { s.magMul *= 1.35; } },
  { id: 'pierce1', cat: '火力', name: '穿甲芯', icon: '➡', rarity: 2, desc: '子弹可穿透 +1 个目标', apply: s => s.pierce += 1 },
  { id: 'crit1', cat: '火力', name: '致命弱点', icon: '🎯', rarity: 2, desc: '爆头伤害 +50%', apply: s => s.headMul *= 1.5 },
  { id: 'melee1', cat: '火力', name: '重击', icon: '👊', rarity: 1, desc: '近战伤害 ×3，近战击杀点数翻倍', apply: s => { s.meleeMul *= 3; s.meleePts *= 2; } },

  // 生存
  { id: 'hp1', cat: '生存', name: '强化体质', icon: '❤', rarity: 1, desc: '最大生命 +30', apply: s => { s.maxHp += 30; } },
  { id: 'hp2', cat: '生存', name: '战地手术', icon: '❤', rarity: 2, desc: '最大生命 +60', apply: s => { s.maxHp += 60; } },
  { id: 'armor1', cat: '生存', name: '陶瓷插板', icon: '🛡', rarity: 1, desc: '受到伤害 -12%', apply: s => s.dmgTakenMul *= 0.88 },
  { id: 'armor2', cat: '生存', name: '复合装甲', icon: '🛡', rarity: 2, desc: '受到伤害 -22%', apply: s => s.dmgTakenMul *= 0.78 },
  { id: 'regen1', cat: '生存', name: '快速凝血', icon: '🩹', rarity: 1, desc: '脱战回血延迟减半', apply: s => s.regenDelay *= 0.5 },
  { id: 'regen2', cat: '生存', name: '再生血清', icon: '🩹', rarity: 2, desc: '脱战回血速度 ×2.5', apply: s => s.regenRate *= 2.5 },
  { id: 'iframe1', cat: '生存', name: '肾上腺素', icon: '💉', rarity: 3, desc: '受伤后 0.6 秒内受到的伤害 -70%', apply: s => { s.iframe = true; } },
  { id: 'revive1', cat: '生存', name: '亡者归来', icon: '⚰', rarity: 3, desc: '死亡时以 50% 生命复活一次（本局一次）', apply: s => { s.revives += 1; } },

  // 机动
  { id: 'spd1', cat: '机动', name: '轻装', icon: '🏃', rarity: 1, desc: '移动速度 +9%', apply: s => s.moveMul *= 1.09 },
  { id: 'spd2', cat: '机动', name: '猎豹步态', icon: '🏃', rarity: 2, desc: '移动速度 +16%', apply: s => s.moveMul *= 1.16 },
  { id: 'slide1', cat: '机动', name: '滑铲大师', icon: '🛝', rarity: 1, desc: '滑铲距离 +50%，冷却减半', apply: s => s.slideMul *= 1.5 },
  { id: 'ads1', cat: '机动', name: '快速举枪', icon: '🎯', rarity: 1, desc: '开镜速度 +30%', apply: s => s.adsMul *= 1.3 },

  // 经济
  { id: 'eco1', cat: '经济', name: '赏金猎人', icon: '💰', rarity: 1, desc: '击杀点数 +25%', apply: s => s.ptsMul *= 1.25 },
  { id: 'eco2', cat: '经济', name: '战争财', icon: '💰', rarity: 2, desc: '击杀点数 +50%', apply: s => s.ptsMul *= 1.5 },
  { id: 'eco3', cat: '经济', name: '黑市渠道', icon: '🏷', rarity: 2, desc: '所有购买价格 -20%', apply: s => s.priceMul *= 0.8 },
  { id: 'ammo1', cat: '经济', name: '弹药回收', icon: '🔁', rarity: 2, desc: '每回合开始自动补满备弹', apply: s => { s.refillEachRound = true; } },
  { id: 'box1', cat: '经济', name: '箱中好运', icon: '🎁', rarity: 2, desc: '神秘箱必出稀有武器，价格 -30%', apply: s => { s.boxLuck = true; } },
];

// 按稀有度加权抽取
export function drawCards(n = 3, round = 1) {
  // 后期提高稀有度权重
  const w = { 1: Math.max(30, 70 - round * 2), 2: 25 + round * 1.2, 3: Math.max(2, round * 0.9) };
  const pool = CARDS.slice();
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((a, c) => a + w[c.rarity], 0);
    let r = Math.random() * total, pick = pool[0];
    for (const c of pool) { r -= w[c.rarity]; if (r <= 0) { pick = c; break; } }
    out.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  }
  return out;
}

export const RARITY = {
  1: { name: '普通', color: '#9aa3ab', glow: 'rgba(154,163,171,.35)' },
  2: { name: '稀有', color: '#4fa3ff', glow: 'rgba(79,163,255,.45)' },
  3: { name: '史诗', color: '#c56bff', glow: 'rgba(197,107,255,.5)' },
};

// ---------------- 升格祭坛词条 ----------------
export const ASCEND = [
  { id: 'dmg', name: '强化枪管', desc: '本武器伤害 +30%', apply: u => u.dmgMul *= 1.3 },
  { id: 'rpm', name: '高速枪机', desc: '本武器射速 +22%', apply: u => u.rpmMul *= 1.22 },
  { id: 'mag', name: '双联弹匣', desc: '本武器弹匣容量 ×2', apply: u => u.magMul *= 2 },
  { id: 'reload', name: '快速装填', desc: '本武器换弹速度 +45%', apply: u => u.reloadMul *= 0.55 },
  { id: 'pierce', name: '穿甲弹', desc: '本武器穿透 +2', apply: u => u.pierce += 2 },
  { id: 'fire', name: '燃烧弹', desc: '命中附加燃烧伤害', apply: u => { u.element = 'fire'; } },
  { id: 'shock', name: '电击弹', desc: '命中使敌人短暂麻痹', apply: u => { u.element = 'shock'; } },
  { id: 'acid', name: '腐蚀弹', desc: '命中使敌人持续掉血', apply: u => { u.element = 'acid'; } },
];

// ---------------- 特殊敌人 ----------------
export const ZTYPES = {
  walker: { name: '行尸', hpMul: 1, speedMul: 1, scale: 1, dmgMul: 1, points: 1, color: 0x6b7d5a, skin: 0x8a9a72 },
  runner: { name: '奔尸', hpMul: 0.7, speedMul: 2.1, scale: 0.95, dmgMul: 0.85, points: 1.2, color: 0x7d5a4a, skin: 0xa87a62 },
  jugg: { name: '重装尸', hpMul: 6.5, speedMul: 0.55, scale: 1.45, dmgMul: 2.6, points: 3, color: 0x3a3a3a, skin: 0x5a5a4a, armored: true },
  lope: { name: '臂行者', hpMul: 1.3, speedMul: 1.75, scale: 1.0, dmgMul: 1.1, points: 1.6, color: 0x6a4a3a, skin: 0x9a6a52, noLegs: true },
  skitter: { name: '爬行尸', hpMul: 1.6, speedMul: 1.35, scale: 0.85, dmgMul: 1.2, points: 2, color: 0x4a3a5a, skin: 0x7a6a8a, ceiling: true },
};

// 按回合决定敌人构成
export function typeRoll(round) {
  const r = Math.random();
  if (round >= 12 && r < 0.06 + round * 0.004) return 'skitter';
  if (round >= 10 && r < 0.12 + round * 0.005) return 'lope';
  if (round >= 8 && r < 0.16 + round * 0.006) return 'jugg';
  if (round >= 3 && r < 0.30 + round * 0.012) return 'runner';
  return 'walker';
}

// ---------------- 墙面武器 ----------------
export const WALL_WEAPONS = [
  { id: 'm1911', price: 500 },
  { id: 'mp5', price: 1000 },
  { id: 'ak', price: 1200 },
  { id: 'm870', price: 1500 },
  { id: 'm4', price: 1800 },
  { id: 'sks', price: 2000 },
  { id: 'pkm', price: 3000 },
  { id: 'scar', price: 2600 },
];

// 神秘箱武器池（含稀有）
export const BOX_POOL = [
  { id: 'vector', w: 10 }, { id: 'm4', w: 10 }, { id: 'ak', w: 10 }, { id: 'scar', w: 9 },
  { id: 'm870', w: 10 }, { id: 'pkm', w: 8 }, { id: 'sks', w: 8 }, { id: 'l115', w: 6 },
  { id: 'revolver', w: 7 }, { id: 'rpg', w: 4 },
];

export function rollBox(luck) {
  const pool = BOX_POOL.slice();
  if (luck) for (const p of pool) if (['l115', 'rpg', 'pkm', 'scar'].includes(p.id)) p.w *= 2.5;
  const total = pool.reduce((a, c) => a + c.w, 0);
  let r = Math.random() * total;
  for (const p of pool) { r -= p.w; if (r <= 0) return p.id; }
  return 'm4';
}

// ---------------- 新武器（僵尸模式专用，追加到 WEAPONS） ----------------
export const ZEXTRA_WEAPONS = {
  wunder: {
    name: '亡者射线', cls: '奇迹武器', type: 'wonder', slot: 'primary',
    dmg: [260, 200], range: [40, 90], rpm: 150, mag: 12, reserve: 60, reload: 2.6, ads: 0.3,
    recoil: [1.2, 0.4], spread: 2.5, mobility: 0.95, fire: 'semi', headMul: 1.6, sprintFire: 0.2,
    sound: 'sniper', model: { recv: 0.3, barrel: 0.34, hand: 0.24, stock: 'sci', mag: 'cell', color: 'purple', grip: 'ar' },
    slots: ['optic', 'barrel'],
  },
};
