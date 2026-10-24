// 经济系统：门、墙上武器、神秘箱、Perk 机、升格祭坛
import * as THREE from 'three';
import { mat } from './materials.js';
import { ZPERKS, WALL_WEAPONS, ASCEND, rollBox } from './mdata.js';
import { PointDrop } from './drops.js';
import { WEAPONS } from './data.js';
import { rand, clamp, damp } from './util.js';

const _v = new THREE.Vector3();

/** 可交互基类 */
class Interactable {
  constructor(game, pos, radius = 2.2) {
    this.game = game;
    this.pos = pos.clone();
    this.radius = radius;
    this.used = false;
    this.group = new THREE.Group();
    game.scene.add(this.group);
  }
  distTo(p) { return Math.hypot(p.x - this.pos.x, p.z - this.pos.z); }
  dispose() { this.game.scene.remove(this.group); this.group.traverse(o => o.geometry && o.geometry.dispose()); }
}

// ---------------- 门 ----------------
export class Door extends Interactable {
  constructor(game, pos, horiz, width, price) {
    super(game, pos, 2.6);
    this.horiz = horiz;
    this.width = width;
    this.price = price;
    this.open = false;
    this.openT = 0;
    const h = 2.5;
    // 门板（双开）
    this.leafL = new THREE.Mesh(new THREE.BoxGeometry(horiz ? width / 2 : 0.1, h, horiz ? 0.1 : width / 2), mat('wood'));
    this.leafR = this.leafL.clone();
    this.leafL.position.set(horiz ? -width / 4 : 0, h / 2, horiz ? 0 : -width / 4);
    this.leafR.position.set(horiz ? width / 4 : 0, h / 2, horiz ? 0 : width / 4);
    this.group.add(this.leafL, this.leafR);
    // 门框上的价格牌
    this.sign = makeSign(`$${price}`, '#ffcf5a');
    this.sign.position.set(horiz ? 0 : -0.16, 2.85, horiz ? -0.16 : 0);
    if (!horiz) this.sign.rotation.y = Math.PI / 2;
    this.group.add(this.sign);
    // 锁头（红灯）
    this.lockLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.2) }));
    this.lockLight.position.set(horiz ? 0 : 0.14, 1.5, horiz ? 0.14 : 0);
    this.group.add(this.lockLight);
    this.group.position.copy(this.pos);
    // 碰撞体：只挡玩家，不挡僵尸（僵尸能从门缝里挤过来，压迫感更强）
    this.collider = horiz
      ? game.world.collider(pos.x - width / 2, 0, pos.z - 0.1, pos.x + width / 2, h, pos.z + 0.1)
      : game.world.collider(pos.x - 0.1, 0, pos.z - width / 2, pos.x + 0.1, h, pos.z + width / 2);
    this.collider.isDoor = true;
    this.collider.playersOnly = true;
  }
  prompt() { return this.open ? null : `<b>F</b> 打开门 · <span class="cost">$${this.price}</span>`; }
  interact() {
    const g = this.game;
    if (this.open) return;
    if (g.points < this.price) { g.audio.empty(); g.hud.popup('点数不足', '#ff6a5a'); return; }
    g.spendPoints(this.price);
    this.open = true;
    this.openT = 0;
    g.world.boxes = g.world.boxes.filter(b => b !== this.collider);
    this.sign.visible = false;
    this.lockLight.material.color.setHex(0x22ff55);
    g.audio.ui('equip');
    g.hud.popup(`门已打开 -$${this.price}`, '#ffcf5a');
    g.doorsOpened++;
  }
  update(dt) {
    if (!this.open) return;
    this.openT += dt;
    const k = clamp(this.openT / 0.7, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    const swing = e * Math.PI * 0.62;
    if (this.horiz) {
      this.leafL.rotation.y = swing;
      this.leafR.rotation.y = -swing;
      this.leafL.position.x = -this.width / 4 - Math.sin(swing) * 0;
    } else {
      this.leafL.rotation.y = swing;
      this.leafR.rotation.y = -swing;
    }
  }
}

// ---------------- 墙上武器 ----------------
export class WallBuy extends Interactable {
  constructor(game, pos, normalYaw, weaponId) {
    super(game, pos, 2.0);
    this.weaponId = weaponId;
    this.normalYaw = normalYaw;
    const def = WALL_WEAPONS.find(w => w.id === weaponId);
    this.price = def ? def.price : 1000;
    this.ammoPrice = Math.round(this.price * 0.5);
    this.group.position.copy(this.pos);
    this.group.rotation.y = normalYaw;

    // 墙上的枪轮廓（用简单几何拼一个剪影）
    const wdef = WEAPONS[weaponId];
    const outline = new THREE.Group();
    const bodyM = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.6 });
    const recv = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.06), bodyM); recv.position.set(0, 0, 0.02); outline.add(recv);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.05), bodyM); barrel.position.set(0.55, 0.03, 0.02); outline.add(barrel);
    const magM = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.05), bodyM); magM.position.set(0.02, -0.16, 0.02); outline.add(magM);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), bodyM); stock.position.set(-0.48, 0, 0.02); outline.add(stock);
    outline.position.y = 1.35;
    this.group.add(outline);

    // 背光
    this.panel = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.75, 0.04), new THREE.MeshStandardMaterial({ color: 0x0a0d10, emissive: 0x1a3550, emissiveIntensity: 1.2, roughness: 0.6 }));
    this.panel.position.set(0, 1.35, -0.02);
    this.group.add(this.panel);

    // 价格牌
    this.sign = makeSign(`${wdef.name}\n$${this.price}`, '#9fe6ff', 512, 220, 28);
    this.sign.scale.set(1.4, 0.6, 1);
    this.sign.position.set(0, 0.85, 0.05);
    this.group.add(this.sign);
    this.light = new THREE.PointLight(0x3a7ab0, 2.5, 4.5);
    this.light.position.set(0, 1.4, 0.5);
    this.group.add(this.light);
  }
  prompt() {
    const g = this.game;
    const pl = g.player;
    if (!pl) return null;
    const has = pl.ws.slots.some(s => s.id === this.weaponId);
    if (has) return `<b>F</b> 购买弹药 · <span class="cost">$${this.ammoPrice}</span>`;
    return `<b>F</b> 购买 ${WEAPONS[this.weaponId].name} · <span class="cost">$${this.price}</span>`;
  }
  interact() {
    const g = this.game, pl = g.player;
    if (!pl) return;
    const slot = pl.ws.slots.find(s => s.id === this.weaponId);
    if (slot) {
      if (g.points < this.ammoPrice) { g.audio.empty(); g.hud.popup('点数不足', '#ff6a5a'); return; }
      g.spendPoints(this.ammoPrice);
      slot.reserve = Math.min(slot.stats.reserve * 2, slot.reserve + slot.stats.reserve);
      slot.mag = slot.stats.mag;
      g.hud.popup(`弹药已补充 -$${this.ammoPrice}`, '#9fe6ff');
      g.audio.reload('in');
      return;
    }
    if (g.points < this.price) { g.audio.empty(); g.hud.popup('点数不足', '#ff6a5a'); return; }
    g.spendPoints(this.price);
    // 进仓库，并自动装备到空闲槽位
    if (g.inventory) {
      g.inventory.addWeapon(this.weaponId);
      g.inventory.equipWeapon(this.weaponId);
      g.shop.syncLoadout();
    } else {
      const old = pl.ws.slots[0];
      if (old) g.spawnPickup(old.id, old.att, pl.pos, old.mag, old.reserve);
      pl.ws.replaceSlot(0, { id: this.weaponId, att: {}, camo: 'none' });
    }
    g.hud.popup(`获得 ${WEAPONS[this.weaponId].name}（已入库） -$${this.price}`, '#9fe6ff');
    g.audio.ui('equip');
  }
}

// ---------------- 神秘箱 ----------------
export class MysteryBox extends Interactable {
  constructor(game, pos) {
    super(game, pos, 2.4);
    this.price = 950;
    this.group.position.copy(this.pos);
    // 箱子
    const boxM = mat('crate');
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.95, 0.95), boxM);
    body.position.y = 0.48; body.castShadow = true; this.group.add(body);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.14, 1.0), mat('wood'));
    lid.position.y = 1.0; this.group.add(lid);
    this.lid = lid;
    // 发光边缘
    const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 2.4) });
    for (const [x, y, z, w, h, d] of [[0, 0.05, 0.48, 1.5, 0.04, 0.03], [0, 0.05, -0.48, 1.5, 0.04, 0.03], [0.75, 0.05, 0, 0.03, 0.04, 0.95], [-0.75, 0.05, 0, 0.03, 0.04, 0.95]]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glowM);
      e.position.set(x, y, z); this.group.add(e);
    }
    this.sign = makeSign(`? 神秘箱 $${this.price}`, '#7fe6ff', 640, 180, 30);
    this.sign.scale.set(1.8, 0.5, 1);
    this.sign.position.set(0, 1.55, 0);
    this.group.add(this.sign);
    this.light = new THREE.PointLight(0x2ab0ff, 6, 8);
    this.light.position.set(0, 1.4, 0);
    this.group.add(this.light);
    this.opening = false; this.openT = 0; this.result = null;
  }
  prompt() {
    if (this.opening) return null;
    return `<b>F</b> 打开神秘箱 · <span class="cost">$${this.price}</span>`;
  }
  interact() {
    const g = this.game, pl = g.player;
    if (this.opening || !pl) return;
    const price = Math.round(this.price * (g.runMods.boxLuck ? 0.7 : 1) * g.runMods.priceMul);
    if (g.points < price) { g.audio.empty(); g.hud.popup('点数不足', '#ff6a5a'); return; }
    g.spendPoints(price);
    this.opening = true; this.openT = 0;
    this.result = rollBox(g.runMods.boxLuck);
    g.audio.tone(300, 1.2, 0.12, 'sawtooth', this.pos, 1.5);
    g.hud.popup('正在开启…', '#7fe6ff');
  }
  update(dt) {
    this.light.intensity = 5 + Math.sin(this.game.time * 3) * 1.5;
    if (!this.opening) return;
    this.openT += dt;
    const k = clamp(this.openT / 1.6, 0, 1);
    // 盖子缓缓打开
    this.lid.rotation.x = -k * 1.1;
    this.lid.position.y = 1.0 + k * 0.15;
    this.lid.position.z = -k * 0.35;
    // 光柱
    if (k > 0.2 && Math.random() < dt * 30) {
      this.game.effects.add.emit({
        x: this.pos.x + rand(-0.3, 0.3), y: this.pos.y + 1.0 + k * 0.5, z: this.pos.z + rand(-0.2, 0.2),
        vx: rand(-0.3, 0.3), vy: rand(1.5, 3.5), vz: rand(-0.3, 0.3),
        life: 0.8, s0: 0.3, s1: 0.02, c0: [0.5, 2.2, 3.2], a0: 0.9,
      });
    }
    if (k >= 1) {
      this.opening = false;
      this.lid.rotation.x = 0; this.lid.position.set(0, 1.0, 0);
      const pl = this.game.player;
      if (pl) {
        if (this.game.inventory) {
          this.game.inventory.addWeapon(this.result);
          this.game.inventory.equipWeapon(this.result);
          this.game.shop.syncLoadout();
        } else {
          const old = pl.ws.slots[0];
          if (old) this.game.spawnPickup(old.id, old.att, pl.pos, old.mag, old.reserve);
          pl.ws.replaceSlot(0, { id: this.result, att: {}, camo: 'none' });
        }
        this.game.hud.popup(`神秘箱：${WEAPONS[this.result].name}`, '#7fe6ff', true);
        this.game.audio.ui('equip');
        // 开箱返还点数（300-800），越贵越值
        const refund = 300 + Math.floor(Math.random() * 500);
        this.game.addPoints(refund, false);
        this.game.hud.popup(`开箱返还 +$${refund}`, '#ffcf5a');
        // 返还的金币从箱子里飘出来
        if (this.game.drops) {
          const per = Math.round(refund / 3 / 5) * 5;
          for (let i = 0; i < 3; i++) {
            const p = this.pos.clone();
            p.x += rand(-0.4, 0.4); p.z += rand(-0.4, 0.4);
            this.game.drops.push(new PointDrop(this.game, p, per));
          }
        }
      }
    }
  }
}

// ---------------- Perk 机 ----------------
export class PerkMachine extends Interactable {
  constructor(game, pos, yaw, perkId) {
    super(game, pos, 2.4);
    this.perkId = perkId;
    const perk = ZPERKS.find(p => p.id === perkId);
    this.perk = perk;
    this.group.position.copy(this.pos);
    this.group.rotation.y = yaw;
    // 机身
    const bodyM = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5, metalness: 0.4 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.1, 0.65), bodyM);
    body.position.y = 1.05; body.castShadow = true; this.group.add(body);
    // 彩色面板
    const col = new THREE.Color(perk.color);
    const panelM = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.25), emissive: col, emissiveIntensity: 1.6, roughness: 0.4 });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.95, 0.04), panelM);
    panel.position.set(0, 1.5, 0.34); this.group.add(panel);
    // 图标
    const iconTex = makeIconTexture(perk.icon, perk.color);
    const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: iconTex, transparent: true }));
    icon.position.set(0, 1.62, 0.37); this.group.add(icon);
    // 名称
    this.sign = makeSign(`${perk.name}\n$${perk.price}`, perk.color, 512, 220, 30);
    this.sign.scale.set(1.2, 0.55, 1);
    this.sign.position.set(0, 0.7, 0.36);
    this.group.add(this.sign);
    // 光
    this.light = new THREE.PointLight(col, 4, 6);
    this.light.position.set(0, 1.6, 0.8);
    this.group.add(this.light);
    // 顶部灯条
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(3) }));
    bar.position.set(0, 2.12, 0.3); this.group.add(bar);
    this.owned = false;
  }
  prompt() {
    if (this.owned) return `${this.perk.name} · 已拥有`;
    return `<b>F</b> 购买 ${this.perk.name} · <span class="cost">$${this.perk.price}</span>`;
  }
  interact() {
    const g = this.game, pl = g.player;
    if (this.owned || !pl) return;
    const price = Math.round(this.perk.price * g.runMods.priceMul);
    if (g.points < price) { g.audio.empty(); g.hud.popup('点数不足', '#ff6a5a'); return; }
    g.spendPoints(price);
    this.owned = true;
    g.buyPerk(this.perkId);
    this.sign.material.map = makeSignTexture('已拥有', '#9dff8a', 512, 220, 34);
    this.sign.material.needsUpdate = true;
    g.hud.popup(`获得 Perk：${this.perk.name}`, this.perk.color, true);
    g.audio.ui('equip');
  }
  update(dt) {
    this.light.intensity = 3.5 + Math.sin(this.game.time * 2.4 + this.pos.x) * 1.2;
  }
}

// ---------------- 升格祭坛 ----------------
export class Altar extends Interactable {
  constructor(game, pos) {
    super(game, pos, 2.6);
    this.group.position.copy(this.pos);
    this.level = 0;
    this.basePrice = 1500;
    // 基座
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.2, 0.5, 8), mat('concreteDark'));
    base.position.y = 0.25; base.castShadow = true; this.group.add(base);
    // 立柱
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 1.5, 8), mat('steel'));
    col.position.y = 1.25; this.group.add(col);
    // 悬浮核心
    this.core = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), new THREE.MeshStandardMaterial({ color: 0x2a1a3a, emissive: 0xaa44ff, emissiveIntensity: 3, roughness: 0.2, metalness: 0.6 }));
    this.core.position.y = 2.35; this.group.add(this.core);
    this.light = new THREE.PointLight(0xaa44ff, 8, 9);
    this.light.position.y = 2.3; this.group.add(this.light);
    this.sign = makeSign(`升格祭坛\n$${this.basePrice}`, '#c56bff', 640, 240, 30);
    this.sign.scale.set(1.5, 0.62, 1);
    this.sign.position.set(0, 3.15, 0);
    this.group.add(this.sign);
    // 地面光环
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.55, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.2, 1.2), transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; this.group.add(ring);
    this.ring = ring;
  }
  get price() { return this.basePrice + this.level * 700; }
  prompt() {
    return `<b>F</b> 强化当前武器 · <span class="cost">$${this.price}</span>`;
  }
  interact() {
    const g = this.game, pl = g.player;
    if (!pl) return;
    const price = Math.round(this.price * g.runMods.priceMul);
    if (g.points < price) { g.audio.empty(); g.hud.popup('点数不足', '#ff6a5a'); return; }
    g.spendPoints(price);
    this.level++;
    g.openAscend();
    this.sign.material.map = makeSignTexture(`升格祭坛 Lv.${this.level}\n$${this.price}`, '#c56bff', 640, 240, 28);
    this.sign.material.needsUpdate = true;
  }
  update(dt) {
    this.core.rotation.y += dt * 1.2;
    this.core.rotation.x += dt * 0.6;
    this.core.position.y = 2.35 + Math.sin(this.game.time * 1.6) * 0.08;
    this.ring.rotation.z += dt * 0.4;
    this.light.intensity = 7 + Math.sin(this.game.time * 2.2) * 2;
  }
}

// ---------------- 工具：价格牌 ----------------
function makeSignTexture(text, color = '#ffffff', w = 512, h = 256, size = 34) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, w, h);
  // 底板
  c.fillStyle = 'rgba(8,10,12,.82)';
  roundRect(c, 6, 6, w - 12, h - 12, 14); c.fill();
  c.strokeStyle = color; c.lineWidth = 4; c.globalAlpha = 0.8;
  roundRect(c, 6, 6, w - 12, h - 12, 14); c.stroke();
  c.globalAlpha = 1;
  c.fillStyle = color;
  c.font = `bold ${size}px "Consolas", monospace`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const lines = String(text).split('\n');
  const lh = size * 1.28;
  lines.forEach((ln, i) => {
    c.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
export function makeSign(text, color, w, h, size) {
  const tex = makeSignTexture(text, color, w || 512, h || 200, size || 32);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.62), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.renderOrder = 5;
  return m;
}
function makeIconTexture(icon, color) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, 128, 128);
  c.font = '96px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = color;
  c.fillText(icon, 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
