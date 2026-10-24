// 僵尸 AI：寻路、攻击、断肢、特殊行为
import * as THREE from 'three';
import { createZombieModel, spawnLimbChunk } from './zombie.js';
import { ZTYPES } from './mdata.js';
import { clamp, damp, rand, angleDiff } from './util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
let zid = 0;

export class Zombie {
  constructor(game, o) {
    this.game = game;
    this.id = ++zid;
    this.isZombie = true;
    this.type = o.type || 'walker';
    const T = ZTYPES[this.type];
    this.T = T;
    this.team = 'Z';
    this.name = T.name;
    this.alive = true;
    this.pos = o.pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = o.yaw ?? rand(-3, 3);
    this.radius = 0.34 * (T.scale || 1);
    this.maxHp = Math.max(20, Math.round((o.hp || 100) * T.hpMul));
    this.hp = this.maxHp;
    this.speed = (o.speed || 1.6) * T.speedMul;
    this.damage = (o.dmg || 20) * T.dmgMul;
    this.pointValue = T.points;
    this.model = createZombieModel(this.type, Math.floor(rand(0, 3)));
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    game.scene.add(this.model.root);
    // 部位累计伤害（用于断肢）
    this.partDmg = { legL: 0, legR: 0, armL: 0, armR: 0, head: 0 };
    this.severThreshold = this.maxHp * 0.22;
    this.attackT = 0; this.attackCD = 0; this.animAttack = 0;
    this.path = null; this.pathT = -99; this.pathGoal = null;
    this.stunT = 0; this.burnT = 0; this.burnDmg = 0; this.acidT = 0; this.acidDmg = 0;
    this.target = o.target || null; // 玩家
    this.stuckT = 0; this.lastProg = this.pos.clone();
    this.spawnT = 0;              // 出场动画（从地下钻出）
    this.spawning = !!o.spawning;
    if (this.spawning) { this.model.root.position.y = this.pos.y - 1.9; }
    this.ceiling = !!T.ceiling;
    this.grabT = 0;
    this.hitFlash = 0;
  }

  eyePos(out) { return out.set(this.pos.x, this.pos.y + 1.55, this.pos.z); }
  chestPos(out) { return out.set(this.pos.x, this.pos.y + 1.15, this.pos.z); }
  forward(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  /** 命中测试：分头/躯干/腿/手臂 */
  hitTest(o, d, maxT) {
    if (!this.alive) return null;
    const sc = this.T.scale || 1;
    const crawling = this.model.state.crawling;
    // 僵尸总高约 1.85m（模型 hips 0.92 + 躯干 0.6 + 头 0.3）
    const headY = this.pos.y + (crawling ? 0.42 : 1.72) * sc;
    const headR = 0.19 * sc;
    let t = raySphere2(o.x, o.y, o.z, d.x, d.y, d.z, this.pos.x, headY, this.pos.z, headR);
    if (t >= 0 && t < maxT) return { t, part: 'head' };
    if (crawling) {
      const b = { x0: this.pos.x - 0.34 * sc, x1: this.pos.x + 0.34 * sc, y0: this.pos.y, y1: this.pos.y + 0.62 * sc, z0: this.pos.z - 0.55 * sc, z1: this.pos.z + 0.55 * sc };
      t = rayAABB2(o, d, b, maxT);
      if (t >= 0) return { t, part: 'body' };
      return null;
    }
    // 躯干（0.55 ~ 头顶下方）
    let b = { x0: this.pos.x - 0.30 * sc, x1: this.pos.x + 0.30 * sc, y0: this.pos.y + 0.50 * sc, y1: this.pos.y + 1.60 * sc, z0: this.pos.z - 0.28 * sc, z1: this.pos.z + 0.28 * sc };
    t = rayAABB2(o, d, b, maxT);
    if (t >= 0) return { t, part: 'body' };
    // 腿
    if (!this.model.state.severed.legL || !this.model.state.severed.legR) {
      b = { x0: this.pos.x - 0.26 * sc, x1: this.pos.x + 0.26 * sc, y0: this.pos.y, y1: this.pos.y + 0.55 * sc, z0: this.pos.z - 0.24 * sc, z1: this.pos.z + 0.24 * sc };
      t = rayAABB2(o, d, b, maxT);
      if (t >= 0) return { t, part: 'legs' };
    }
    return null;
  }

  takeDamage(dmg, info = {}) {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.hitFlash = 0.12;
    if (info.attacker) this.target = info.attacker;
    // 断肢判定
    const part = info.part;
    if (part === 'legs') {
      // 均摊到两条腿
      const half = dmg * 0.5;
      for (const k of ['legL', 'legR']) {
        if (this.model.state.severed[k]) continue;
        this.partDmg[k] += half;
        if (this.partDmg[k] >= this.severThreshold) this.severLimb(k, info.dir);
      }
    } else if (part === 'head') {
      this.partDmg.head += dmg;
    } else if (part === 'body') {
      // 小概率打断手臂
      if (Math.random() < 0.12) {
        const k = Math.random() < 0.5 ? 'armL' : 'armR';
        if (!this.model.state.severed[k]) {
          this.partDmg[k] += dmg * 1.4;
          if (this.partDmg[k] >= this.severThreshold) this.severLimb(k, info.dir);
        }
      }
    }
    if (info.burn) { this.burnT = Math.max(this.burnT, 2.5); this.burnDmg = Math.max(this.burnDmg, dmg * 0.35); }
    if (info.shock) this.stunT = Math.max(this.stunT, 0.45);
    if (info.acid) { this.acidT = Math.max(this.acidT, 4); this.acidDmg = Math.max(this.acidDmg, dmg * 0.18); }
    if (this.hp <= 0) { this.die(info); return true; }
    return false;
  }

  severLimb(part, dir) {
    const wp = this.model.sever(part);
    if (!wp) return;
    const d = dir || new THREE.Vector3(0, 0, 1);
    const col = part === 'head' ? 0x9a8a6a : (part.startsWith('arm') ? this.T.skin : this.T.color);
    spawnLimbChunk(this.game, wp, d, col, 0.14 * (this.T.scale || 1));
    this.game.effects.blood(wp, d, part === 'head');
    this.game.audio.click(180, 0.12, 0.4, wp);
    // 断腿后减速
    if (this.model.state.crawling) { this.speed *= 0.55; }
  }

  die(info = {}) {
    this.alive = false;
    this.hp = 0;
    // 倒地停留 12 秒（最后 2 秒下沉淡出）
    this.model.die(info.dir || new THREE.Vector3(0, 0, 1), undefined, 12);
    const g = this.game;
    if (info.head) {
      // 爆头额外喷血
      const p = this.chestPos(new THREE.Vector3()); p.y += 0.45;
      g.effects.blood(p, info.dir || new THREE.Vector3(0, 1, 0), true);
    }
    g.onKill(info.attacker, this, info.weapon, info.head, info);
  }

  dispose() {
    this.game.scene.remove(this.model.root);
    this.model.root.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
  }

  requestPath(goal) {
    const g = this.game;
    if (g.pathBudget <= 0) return;
    g.pathBudget--;
    this.path = g.world.findPath(this.pos, goal);
    this.pathT = g.time;
    this.pathGoal = goal.clone();
  }

  update(dt) {
    const g = this.game;
    const A = this.model.state;
    // 死亡：只播倒地动画（不覆盖 root 位置，避免盖掉尸体下沉效果）
    if (!this.alive) {
      this.model.animate(dt, g.time);
      return;
    }
    // 出场
    if (this.spawning) {
      this.spawnT += dt;
      const k = clamp(this.spawnT / 0.9, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      this.model.root.position.y = this.pos.y - 1.95 * (1 - e);
      // 钻出时的土屑
      if (k < 0.8 && Math.random() < dt * 18) {
        g.effects.smoke.emit({
          x: this.pos.x + rand(-0.3, 0.3), y: this.pos.y + 0.1, z: this.pos.z + rand(-0.3, 0.3),
          vx: rand(-0.6, 0.6), vy: rand(0.4, 1.4), vz: rand(-0.6, 0.6),
          drag: 1.4, life: 1.0, s0: 0.25, s1: 0.9, c0: [0.28, 0.26, 0.24], a0: 0.55,
        });
      }
      this.model.animate(dt, g.time);
      if (k >= 1) { this.spawning = false; this.model.root.position.y = this.pos.y; g.audio.tone(rand(90, 130), 0.3, 0.05, 'sawtooth', this.pos); }
      return;
    }

    this.stunT -= dt;
    // 持续伤害
    if (this.burnT > 0) { this.burnT -= dt; this.hp -= this.burnDmg * dt; if (Math.random() < dt * 12) g.effects.add.emit({ x: this.pos.x + rand(-.2, .2), y: this.pos.y + rand(.4, 1.5), z: this.pos.z + rand(-.2, .2), vx: 0, vy: 1.4, vz: 0, life: .4, s0: .25, s1: .05, c0: [4, 1.4, .2], a0: .9 }); }
    if (this.acidT > 0) { this.acidT -= dt; this.hp -= this.acidDmg * dt; }
    if (this.hp <= 0) { this.die({ attacker: this.lastAttacker, weapon: '持续伤害' }); return; }

    const pl = g.player;
    const canSee = pl && pl.alive;
    // 目标点（复制，避免引用玩家实时位置导致路径比较失真）
    const goal = canSee ? _c.copy(pl.pos) : null;
    const dToPlayer = goal ? Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z) : 999;

    // 攻击
    this.attackCD -= dt;
    if (canSee && dToPlayer < 1.75 * (this.T.scale || 1) && this.attackCD <= 0 && this.stunT <= 0) {
      this.attackCD = 1.05;
      this.animAttack = 1;
      this.grabT = 0.25;
      setTimeout(() => {
        if (!this.alive || !pl.alive) return;
        const d = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
        if (d < 2.1 * (this.T.scale || 1)) {
          pl.takeDamage(this.damage, { attacker: this, weapon: this.name, dir: new THREE.Vector3(pl.pos.x - this.pos.x, 0, pl.pos.z - this.pos.z).normalize() });
          g.audio.click(260, 0.1, 0.35);
        }
      }, 200);
    }
    this.animAttack = damp(this.animAttack, 0, 6, dt);
    A.attack = this.animAttack;

    // 移动
    let desired = _a.set(0, 0, 0);
    const stunned = this.stunT > 0;
    if (stunned) {
      desired.set(Math.sin(g.time * 6 + this.id) * 0.8, 0, Math.cos(g.time * 5 + this.id) * 0.8);
    } else if (goal && dToPlayer > 1.4 * (this.T.scale || 1)) {
      // 寻路
      if (!this.path || !this.pathGoal || this.pathGoal.distanceTo(goal) > 2.5 || g.time - this.pathT > 3.5) this.requestPath(goal);
      let next = goal;
      if (this.path && this.path.length) {
        while (this.path.length > 1 && Math.hypot(this.path[0].x - this.pos.x, this.path[0].z - this.pos.z) < 0.7) this.path.shift();
        next = this.path[0];
      }
      const dx = next.x - this.pos.x, dz = next.z - this.pos.z;
      const l = Math.hypot(dx, dz);
      if (l > 0.01) desired.set(dx / l * this.speed, 0, dz / l * this.speed);
      // 分离力（避免叠在一起）
      for (const o of g.zombies) {
        if (o === this || !o.alive) continue;
        const ddx = this.pos.x - o.pos.x, ddz = this.pos.z - o.pos.z;
        const d2 = ddx * ddx + ddz * ddz;
        const minD = (this.radius + o.radius) * 1.1;
        if (d2 < minD * minD && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          desired.x += ddx / d * 2.4; desired.z += ddz / d * 2.4;
        }
      }
    }
    // 限速
    const dl = Math.hypot(desired.x, desired.z);
    const maxS = this.speed * (stunned ? 0.35 : 1);
    if (dl > maxS) desired.multiplyScalar(maxS / dl);
    const k = 1 - Math.exp(-9 * dt);
    this.vel.x += (desired.x - this.vel.x) * k;
    this.vel.z += (desired.z - this.vel.z) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    g.world.collide(this.pos, this.vel, this.radius, 1.7, 0.45, { ignorePlayersOnly: true });
    const gh = g.world.groundHeight(this.pos.x, this.pos.z, this.pos.y, this.radius);
    this.pos.y = damp(this.pos.y, gh, 14, dt);

    // 卡住检测
    this.stuckT += dt;
    if (this.stuckT > 1.6) {
      if (this.lastProg.distanceTo(this.pos) < 0.35 && dl > 0.4) { this.path = null; this.pathT = -99; }
      this.lastProg.copy(this.pos); this.stuckT = 0;
    }

    // 朝向玩家
    const spd = Math.hypot(this.vel.x, this.vel.z);
    let lookYaw = this.yaw;
    if (canSee && dToPlayer < 18) lookYaw = Math.atan2(-(pl.pos.x - this.pos.x), -(pl.pos.z - this.pos.z));
    else if (spd > 0.3) lookYaw = Math.atan2(-this.vel.x, -this.vel.z);
    const ad = angleDiff(this.yaw, lookYaw);
    this.yaw += clamp(ad, -4.5 * dt, 4.5 * dt);

    // 动画
    A.speed = spd;
    this.model.animate(dt, g.time);
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;

    // 受击闪白
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      const on = this.hitFlash > 0;
      this.model.parts.skin.emissive && this.model.parts.skin.emissive.setHex(on ? 0x661111 : 0x000000);
    }

    // 低吼
    if (Math.random() < dt * 0.35 && dToPlayer < 26) g.audio.tone(rand(70, 110), 0.45, 0.06, 'sawtooth', this.pos, -0.4);
  }
}

function raySphere2(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  const thc = Math.sqrt(r * r - d2);
  const t = tca - thc;
  return t >= 0 ? t : (tca + thc >= 0 ? 0 : -1);
}
function rayAABB2(o, d, b, maxT) {
  let tmin = 0, tmax = maxT;
  for (const [oc, dc, lo, hi] of [[o.x, d.x, b.x0, b.x1], [o.y, d.y, b.y0, b.y1], [o.z, d.z, b.z0, b.z1]]) {
    if (Math.abs(dc) < 1e-8) { if (oc < lo || oc > hi) return -1; continue; }
    let t1 = (lo - oc) / dc, t2 = (hi - oc) / dc;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}
