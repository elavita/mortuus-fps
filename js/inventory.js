// 背包 / 仓库：管理已购买的武器与配件
import { WEAPONS, ATTACHMENTS, findAttachment } from './data.js';

/**
 * 仓库模型
 *  - weapons: 已拥有武器 id 的集合（Set）
 *  - parts:   { [attId]: count }  配件库存
 *  - loadout: [{ id, att: {slot: attId}, camo }]  当前携带（最多 2 把）
 */
export class Inventory {
  constructor(game) {
    this.game = game;
    this.weapons = new Set();
    this.parts = {};
    this.loadout = [];
    this.camo = {};
  }

  reset() {
    this.weapons = new Set();
    this.parts = {};
    this.loadout = [];
    this.camo = {};
  }

  // ---------- 武器 ----------
  hasWeapon(id) { return this.weapons.has(id); }
  addWeapon(id) {
    if (!WEAPONS[id]) return false;
    if (this.weapons.has(id)) return false;
    this.weapons.add(id);
    return true;
  }
  /** 把武器放进携带槽位。slotIndex 为 null 时自动找空位，没有空位才替换第二个 */
  equipWeapon(id, slotIndex = null) {
    if (!this.weapons.has(id)) return false;
    const exist = this.loadout.findIndex(w => w.id === id);
    if (exist >= 0) return false;
    const entry = { id, att: {}, camo: this.camo[id] || 'none' };
    if (slotIndex === null) {
      if (this.loadout.length < 2) this.loadout.push(entry);
      else this.loadout[1] = entry;      // 满了两把才替换副武器位
    } else if (slotIndex < this.loadout.length) {
      // 指定槽位：替换该位置
      this.loadout[slotIndex] = entry;
    } else {
      this.loadout.push(entry);
    }
    this.loadout = this.loadout.filter(Boolean);
    return true;
  }
  unequipWeapon(index) {
    if (index < 0 || index >= this.loadout.length) return false;
    // 卸下的武器配件回到仓库
    const w = this.loadout[index];
    for (const slot in w.att) this.addPart(w.att[slot], 1);
    this.loadout.splice(index, 1);
    return true;
  }

  // ---------- 配件 ----------
  partCount(attId) { return this.parts[attId] || 0; }
  addPart(attId, n = 1) {
    this.parts[attId] = (this.parts[attId] || 0) + n;
    return this.parts[attId];
  }
  removePart(attId, n = 1) {
    if (!this.parts[attId]) return false;
    this.parts[attId] -= n;
    if (this.parts[attId] <= 0) delete this.parts[attId];
    return true;
  }
  /** 找到配件属于哪个槽位 */
  slotOfPart(attId) {
    for (const slot in ATTACHMENTS) {
      if (ATTACHMENTS[slot].some(a => a.id === attId)) return slot;
    }
    return null;
  }
  /** 该配件是否已装在别的枪上（占用了库存） */
  isPartEquipped(attId, exceptWeaponIndex = -1) {
    return this.loadout.some((w, i) => i !== exceptWeaponIndex && Object.values(w.att).includes(attId));
  }
  /** 可用数量（库存 - 已装配到其他枪的） */
  availableParts(attId, weaponIndex) {
    let used = 0;
    this.loadout.forEach((w, i) => {
      if (i === weaponIndex) return;
      for (const s in w.att) if (w.att[s] === attId) used++;
    });
    return Math.max(0, this.partCount(attId) - used);
  }

  // ---------- 组装 ----------
  /** 给某把枪装配件（从库存扣除占用） */
  attachPart(weaponIndex, attId) {
    const w = this.loadout[weaponIndex];
    if (!w) return { ok: false, msg: '武器不存在' };
    const slot = this.slotOfPart(attId);
    if (!slot) return { ok: false, msg: '未知配件' };
    const def = WEAPONS[w.id];
    if (!def.slots.includes(slot)) return { ok: false, msg: '该武器没有这个栏位' };
    if (this.availableParts(attId, weaponIndex) <= 0) return { ok: false, msg: '仓库里没有这个配件' };
    // 同槽位已有配件：先卸下
    if (w.att[slot] === attId) return { ok: false, msg: '已装配' };
    w.att[slot] = attId;
    return { ok: true, slot };
  }
  detachPart(weaponIndex, slot) {
    const w = this.loadout[weaponIndex];
    if (!w || !w.att[slot]) return false;
    delete w.att[slot];
    return true;
  }
  clearParts(weaponIndex) {
    const w = this.loadout[weaponIndex];
    if (!w) return;
    w.att = {};
  }

  // ---------- 统计 ----------
  summary() {
    return {
      weapons: this.weapons.size,
      parts: Object.values(this.parts).reduce((a, b) => a + b, 0),
      loadout: this.loadout.map(w => w.id),
    };
  }
}
