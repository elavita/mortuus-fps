// AI 队友：跟随、交火、倒地与救援
import * as THREE from 'three';
import { createSoldierModel, animateSoldier } from './soldier.js';
import { computeStats } from './data.js';
import { clamp, damp, rand, angleDiff } from './util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

// 三名队友的预设
export const SQUAD = [
  {
    key: 'blake', name: '布雷克', role: '突击', style: 'ally',
    weapon: 'm4', att: { optic: 'holo', under: 'vgrip' }, sleeve: 'fab_ally',
    color: '#6cc5ff', dmg: 34, rpm: 0.13, spread: 0.055, hp: 140,
  },
  {
    key: 'raven', name: '渡鸦', role: '狙击', style: 'snowA',
    weapon: 'sks', att: { optic: 'acog' }, sleeve: 'fab_snowA',
    color: '#ffd166', dmg: 78, rpm: 0.62, spread: 0.02, hp: 120,
  },
  {
    key: 'vex', name: '维克丝', role: '支援', style: 'snowB',
    weapon: 'm870', att: { laser: 'tac' }, sleeve: 'fab_snowB',
    color: '#9dff8a', dmg: 26, rpm: 0.75, spread: 0.10, hp: 160, pellets: 6,
  },
];

export class Teammate {
  constructor(game, cfg, index) {
    this.game = game;
    this.cfg = cfg;
    this.index = index;
    this.isTeammate = true;
    this.team = 'A';
    this.name = cfg.name;
    this.role = cfg.role;
    this.color = cfg.color;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.radius = 0.36;
    this.maxHp = cfg.hp; this.hp = cfg.hp;
    this.alive = true;
    this.downed = false; this.bleedT = 0; this.reviveProg = 0;
    this.deadUntilRound = false;
    this.points = 500;
    this.kills = 0; this.headshots = 0; this.downs = 0;
    this.stats = computeStats(cfg.weapon, cfg.att || {});
    this.model = createSoldierModel(cfg.style, cfg.weapon, cfg.att || {}, 'none');
    game.scene.add(this.model.root);
    this.anim = { speed: 0, phase: rand(0, 6), crouch: 0, pitch: 0, dead: false, deadT: 0, fallDir: 1, fallRoll: 0, recoil: 0 };
    this.fireT = 0; this.target = null; this.targetT = 0;
    this.formation = new THREE.Vector3();
    this.reloadT = 0; this.mag = this.stats.mag;
    this.recoilT = 0;
    this.path = null; this.pathT = -99; this.pathGoal = null;
    this.muzzleT = 0;
    this.stuckT = 0; this.lastProg = new THREE.Vector3();
    this.spawnGrace = 1.5;
  }

  eyePos(out) { return out.set(this.pos.x, this.pos.y + 1.6, this.pos.z); }
  chestPos(out) { return out.set(this.pos.x, this.pos.y + 1.15, this.pos.z); }
  forward(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  hitTest(o, d, maxT) {
    if (!this.alive) return null;
    const hy = this.pos.y + (this.downed ? 0.5 : 1.66);
    let t = raySphere(o, d, this.pos.x, hy, this.pos.z, 0.16);
    if (t >= 0 && t < maxT) return { t, part: 'head' };
    const b = { x0: this.pos.x - 0.28, x1: this.pos.x + 0.28, y0: this.pos.y, y1: hy - 0.12, z0: this.pos.z - 0.28, z1: this.pos.z + 0.28 };
    t = rayAABB(o, d, b, maxT);
    if (t >= 0) return { t, part: 'body' };
    return null;
  }

  takeDamage(dmg, info = {}) {
    if (!this.alive || this.downed) return false;
    this.hp -= dmg;
    this.anim.recoil = 0.5;
    this.game.hud.damageFrom(this.pos);
    if (this.hp <= 0) { this.goDown(info); return true; }
    return false;
  }

  goDown(info) {
    this.downed = true;
    this.hp = 0;
    this.bleedT = 30;
    this.downs++;
    this.anim.dead = true;
    this.anim.deadT = 0;
    this.game.hud.popup(`${this.name} 倒地！靠近按 F 救援`, this.color);
    this.game.audio.say(`${this.name}倒地`);
  }

  revive() {
    this.downed = false;
    this.anim.dead = false;
    this.anim.deadT = 0;
    this.hp = Math.round(this.maxHp * 0.55);
    this.model.root.rotation.set(0, this.yaw, 0);
    this.reviveProg = 0;
    this.game.hud.popup(`${this.name} 已被救起`, '#9dff8a');
  }

  /** 回合结束时复活 */
  roundReset(pos) {
    this.downed = false; this.deadUntilRound = false;
    this.anim.dead = false; this.anim.deadT = 0;
    this.alive = true;
    this.hp = this.maxHp;
    this.model.root.rotation.set(0, this.yaw, 0);
    if (pos) this.pos.copy(pos);
  }

  respawnAt(pos, yaw) {
    this.pos.copy(pos); this.yaw = yaw;
    this.hp = this.maxHp; this.alive = true; this.downed = false; this.deadUntilRound = false;
    this.anim.dead = false; this.anim.deadT = 0;
    this.model.root.rotation.set(0, yaw, 0);
    this.spawnGrace = 2.0;
    this.mag = this.stats.mag;
  }

  requestPath(goal) {
    const g = this.game;
    if (g.pathBudget <= 0) return;
    g.pathBudget--;
    this.path = g.world.findPath(this.pos, goal);
    this.pathT = g.time;
    this.pathGoal = goal.clone();
  }

  steer(goal, speed, out) {
    const g = this.game;
    if (!goal) return out.set(0, 0, 0);
    const dGoal = Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z);
    if (dGoal < 0.9) { this.path = null; return out.set(0, 0, 0); }
    if (!this.path || !this.pathGoal || this.pathGoal.distanceTo(goal) > 2.5 || g.time - this.pathT > 3) this.requestPath(goal);
    let next = goal;
    if (this.path && this.path.length) {
      while (this.path.length > 1 && Math.hypot(this.path[0].x - this.pos.x, this.path[0].z - this.pos.z) < 0.8) this.path.shift();
      next = this.path[0];
    }
    const dx = next.x - this.pos.x, dz = next.z - this.pos.z, l = Math.hypot(dx, dz);
    if (l < 0.01) return out.set(0, 0, 0);
    return out.set(dx / l * speed, 0, dz / l * speed);
  }

  update(dt) {
    const g = this.game;
    const A = this.anim;
    this.spawnGrace -= dt;
    if (!this.alive) return;

    // 倒地：流血倒计时
    if (this.downed) {
      this.bleedT -= dt;
      A.deadT += dt;
      animateSoldier(this.model, A, dt);
      this.model.root.position.copy(this.pos);
      if (this.bleedT <= 0) {
        this.downed = false; this.alive = false; this.deadUntilRound = true;
        g.hud.popup(`${this.name} 已阵亡，下回合归队`, '#ff6a5a');
        this.model.root.visible = false;
      }
      return;
    }
    this.model.root.visible = true;

    const pl = g.player;
    this.fireT -= dt; this.reloadT -= dt; this.recoilT = Math.max(0, this.recoilT - dt * 4);
    this.muzzleT -= dt;
    this.model.flash.visible = this.muzzleT > 0;

    // ---------- 选目标 ----------
    this.targetT -= dt;
    if (this.targetT <= 0) {
      this.targetT = 0.25;
      this.target = this.pickTarget();
    }
    const tgt = this.target;

    // ---------- 移动 ----------
    const desired = _a.set(0, 0, 0);
    const dToPlayer = pl ? Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z) : 0;
    let speed = 4.2;
    let lookYaw = null;

    if (tgt && tgt.alive) {
      const d = Math.hypot(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z);
      // 交战时保持中距离，环绕
      const ang = Math.atan2(tgt.pos.z - this.pos.z, tgt.pos.x - this.pos.x);
      const want = this.role === '狙击' ? 16 : this.role === '支援' ? 6 : 10;
      const radial = d > want * 1.35 ? 1 : d < want * 0.65 ? -1 : 0;
      const tangent = Math.sin(g.time * 0.7 + this.index * 2.1) * 0.7;
      const tx = Math.cos(ang) * radial - Math.sin(ang) * tangent;
      const tz = Math.sin(ang) * radial + Math.cos(ang) * tangent;
      const len = Math.hypot(tx, tz) || 1;
      desired.set(tx / len * speed, 0, tz / len * speed);
      lookYaw = Math.atan2(-(tgt.pos.x - this.pos.x), -(tgt.pos.z - this.pos.z));
      // 开火
      if (d < 45 && this.fireT <= 0 && this.hasLOS(tgt)) this.fire(tgt, d);
    } else {
      // 跟随玩家，保持队形（拉开距离，避免挡住玩家视野）
      const off = FORMATION[this.index % FORMATION.length];
      const fx = Math.sin(pl ? pl.yaw : 0), fz = Math.cos(pl ? pl.yaw : 0);
      const goal = _b.set(
        (pl ? pl.pos.x : 0) + fx * off.z + fz * off.x,
        0,
        (pl ? pl.pos.z : 0) + fz * off.z - fx * off.x
      );
      // 离玩家太近就后退（防止贴脸挡视线）
      const dGoal = Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z);
      this.steer(goal, dToPlayer > 9 ? 5.4 : 3.6, desired);
      if (dToPlayer < 3.2 && pl) {
        // 推开：远离玩家
        const ax = this.pos.x - pl.pos.x, az = this.pos.z - pl.pos.z;
        const al = Math.hypot(ax, az) || 1;
        desired.x += ax / al * 3.2; desired.z += az / al * 3.2;
      }
      if (dToPlayer > 14 && pl && pl.alive) {
        // 掉队太久，直接传送到玩家附近
        if (dToPlayer > 26) {
          const p = g.world.randomWalkable(pl.pos.x, pl.pos.z, 6);
          this.pos.copy(p); this.path = null;
        }
      }
    }

    // 分离
    for (const o of g.teammates) {
      if (o === this || !o.alive || o.downed) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.1 && d2 > 0.0001) { const d = Math.sqrt(d2); desired.x += dx / d * 2; desired.z += dz / d * 2; }
    }
    const dl = Math.hypot(desired.x, desired.z);
    if (dl > speed) desired.multiplyScalar(speed / dl);
    const k = 1 - Math.exp(-9 * dt);
    this.vel.x += (desired.x - this.vel.x) * k;
    this.vel.z += (desired.z - this.vel.z) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    g.world.collide(this.pos, this.vel, this.radius, 1.75, 0.45, { ignorePlayersOnly: true });
    const gh = g.world.groundHeight(this.pos.x, this.pos.z, this.pos.y, this.radius);
    this.pos.y = damp(this.pos.y, gh, 14, dt);

    // 朝向
    const spd = Math.hypot(this.vel.x, this.vel.z);
    if (lookYaw === null) {
      if (spd > 0.4) lookYaw = Math.atan2(-this.vel.x, -this.vel.z);
      else lookYaw = this.yaw;
    }
    this.yaw += clamp(angleDiff(this.yaw, lookYaw), -7 * dt, 7 * dt);

    // 动画
    A.speed = spd; A.phase += dt * spd * 2.2; A.crouch = 0;
    A.recoil = this.recoilT;
    animateSoldier(this.model, A, dt);
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    if (spd > 3 && Math.random() < dt * 2.5) g.audio.step(this.pos, 'concrete', 0.16);
  }

  pickTarget() {
    const g = this.game;
    let best = null, bestScore = 1e9;
    for (const z of g.zombies) {
      if (!z.alive) continue;
      const d = Math.hypot(z.pos.x - this.pos.x, z.pos.z - this.pos.z);
      if (d > 48) continue;
      // 优先打离玩家近的
      const dp = g.player ? Math.hypot(z.pos.x - g.player.pos.x, z.pos.z - g.player.pos.z) : d;
      const score = d * 0.6 + dp * 0.8;
      if (score < bestScore) { bestScore = score; best = z; }
    }
    return best;
  }

  hasLOS(z) {
    const g = this.game;
    const a = this.eyePos(_a);
    const b = z.chestPos(_b);
    return !g.world.lineBlocked(a, b);
  }

  fire(tgt, dist) {
    const g = this.game, cfg = this.cfg;
    if (this.mag <= 0) {
      if (this.reloadT <= 0) { this.reloadT = this.stats.reload * 1.2; this.mag = this.stats.mag; g.audio.reload('out', this.pos); }
      return;
    }
    this.mag--;
    this.fireT = cfg.rpm * rand(0.85, 1.25);
    this.recoilT = 1;
    this.muzzleT = 0.05;
    this.model.flash.material.rotation = Math.random() * 6;

    const muzzle = this.model.muzzle.getWorldPosition(new THREE.Vector3());
    const aim = tgt.chestPos(new THREE.Vector3());
    // 命中率：距离越远越差
    const acc = clamp(1 - dist / 60, 0.35, 0.92);
    const pellets = cfg.pellets || 1;
    let anyHit = false, killed = false;
    for (let i = 0; i < pellets; i++) {
      const roll = Math.random();
      if (roll > acc) {
        // 未命中：打在地面/墙上的曳光
        const miss = aim.clone().add(new THREE.Vector3(rand(-1.6, 1.6), rand(-0.6, 1.6), rand(-1.6, 1.6)));
        g.effects.tracer(muzzle, miss, [1.5, 1.1, 0.6]);
        continue;
      }
      anyHit = true;
      const head = Math.random() < 0.16;
      const dmg = cfg.dmg * (head ? 2.1 : 1) * rand(0.9, 1.1);
      const dir = new THREE.Vector3().subVectors(aim, this.eyePos(new THREE.Vector3())).normalize();
      const did = tgt.takeDamage(dmg, { attacker: this, head, dir, weapon: this.name + '·' + this.stats.name, part: head ? 'head' : 'body' });
      if (head) this.headshots++;
      if (did) { killed = true; this.kills++; this.points += head ? 100 : 50; }
      else this.points += 10;
      g.effects.blood(tgt.chestPos(new THREE.Vector3()), dir, head);
      if (i === 0) g.effects.tracer(muzzle, tgt.chestPos(new THREE.Vector3()), [1.5, 1.1, 0.6]);
    }
    g.effects.flashLight(muzzle, 0xffb060, 2.2, 0.05, 7);
    g.audio.shot(this.stats.sound, this.pos, this.stats.suppressed);
    if (killed) g.hud.killfeed(this, tgt, this.stats.name, false);
  }

  dispose() {
    this.game.scene.remove(this.model.root);
  }
}

const FORMATION = [
  new THREE.Vector3(-3.2, 0, 3.4),
  new THREE.Vector3(3.2, 0, 3.4),
  new THREE.Vector3(0, 0, 5.2),
];

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  const thc = Math.sqrt(r * r - d2);
  const t = tca - thc;
  return t >= 0 ? t : (tca + thc >= 0 ? 0 : -1);
}
function rayAABB(o, d, b, maxT) {
  let tmin = 0, tmax = maxT;
  const axes = [[o.x, d.x, b.x0, b.x1], [o.y, d.y, b.y0, b.y1], [o.z, d.z, b.z0, b.z1]];
  for (const [oc, dc, lo, hi] of axes) {
    if (Math.abs(dc) < 1e-8) { if (oc < lo || oc > hi) return -1; continue; }
    let t1 = (lo - oc) / dc, t2 = (hi - oc) / dc;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}
