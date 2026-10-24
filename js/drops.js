// 地面掉落物：点数、弹药、医疗包
import * as THREE from 'three';
import { mat } from './materials.js';
import { rand, clamp } from './util.js';

const _v = new THREE.Vector3();

/** 掉落的点数（发光小球，靠近自动吸附） */
export class PointDrop {
  constructor(game, pos, amount) {
    this.game = game;
    this.amount = amount;
    this.alive = true;
    this.pos = pos.clone();
    this.pos.y += 0.9;
    this.vel = new THREE.Vector3(rand(-1.6, 1.6), rand(2.4, 3.8), rand(-1.6, 1.6));
    this.age = 0;
    this.life = 22;
    this.magnet = false;

    const g = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.09),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.1, 0.4) })
    );
    g.add(core);
    // 外层光晕
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 10, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.4, 0.25), transparent: true, opacity: 0.28, depthWrite: false })
    );
    g.add(halo);
    g.position.copy(this.pos);
    game.scene.add(g);
    this.mesh = g;
    this.core = core;
    this.halo = halo;
    this.glowT = 0;
  }

  update(dt) {
    if (!this.alive) return;
    const g = this.game;
    const pl = g.player;
    this.age += dt;
    this.glowT += dt;
    // 旋转与呼吸
    this.core.rotation.y += dt * 3.2;
    this.core.rotation.x += dt * 1.8;
    const pulse = 0.85 + Math.sin(this.glowT * 5) * 0.15;
    this.halo.scale.setScalar(pulse);

    if (!pl || !pl.alive) { this.mesh.position.copy(this.pos); return; }

    const d = Math.hypot(this.pos.x - pl.pos.x, this.pos.z - pl.pos.z);
    // 吸附范围
    if (d < 3.4) this.magnet = true;
    if (this.magnet) {
      // 向玩家飞
      const target = _v.set(pl.pos.x, pl.pos.y + 1.0, pl.pos.z);
      const dir = target.sub(this.pos).normalize();
      const speed = 6 + (3.4 - Math.min(d, 3.4)) * 4;
      this.pos.addScaledVector(dir, speed * dt);
      this.mesh.position.copy(this.pos);
      if (d < 0.75) { this.collect(); return; }
      return;
    }

    // 物理下落
    this.vel.y -= 15 * dt;
    this.pos.addScaledVector(this.vel, dt);
    const gh = g.world ? g.world.groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.3, 0.1) : 0;
    if (this.pos.y <= gh + 0.22) {
      this.pos.y = gh + 0.22;
      if (this.vel.y < -1) {
        this.vel.y = Math.abs(this.vel.y) * 0.32;
        this.vel.x *= 0.6; this.vel.z *= 0.6;
        if (Math.abs(this.vel.y) < 0.8) { this.vel.y = 0; this.vel.x *= 0.3; this.vel.z *= 0.3; }
      } else { this.vel.y = 0; }
    }
    this.mesh.position.copy(this.pos);

    if (this.age > this.life) this.dispose();
  }

  collect() {
    const g = this.game;
    g.addPoints(this.amount, false);
    g.hud.popup(`+$${this.amount}`, '#ffcf5a');
    g.audio.click(1800 + Math.random() * 600, 0.05, 0.25);
    // 收集特效
    for (let i = 0; i < 5; i++) {
      g.effects.add.emit({
        x: this.pos.x, y: this.pos.y, z: this.pos.z,
        vx: rand(-1, 1), vy: rand(0.5, 2), vz: rand(-1, 1),
        life: 0.35, s0: 0.14, s1: 0.02, c0: [3, 2, 0.5], a0: 0.9,
      });
    }
    this.dispose();
  }

  dispose() {
    this.alive = false;
    this.game.scene.remove(this.mesh);
    this.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}

/** 掉落的弹药/医疗包（需要按 F 或走近拾取） */
export class SupplyDrop {
  constructor(game, pos, kind) {
    this.game = game;
    this.kind = kind; // 'ammo' | 'health'
    this.alive = true;
    this.pos = pos.clone();
    this.age = 0;
    this.life = 40;
    const g = new THREE.Group();
    const col = kind === 'ammo' ? 0x8a6a2a : 0x8a2a2a;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.24), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0.3 }));
    g.add(box);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.26), new THREE.MeshBasicMaterial({ color: new THREE.Color(kind === 'ammo' ? 2.4 : 2.6, kind === 'ammo' ? 1.8 : 0.3, 0.3) }));
    stripe.position.y = 0.06;
    g.add(stripe);
    g.position.copy(this.pos);
    g.position.y += 0.3;
    game.scene.add(g);
    this.mesh = g;
  }
  update(dt) {
    if (!this.alive) return;
    this.age += dt;
    this.mesh.rotation.y += dt * 1.6;
    this.mesh.position.y = this.pos.y + 0.3 + Math.sin(this.age * 2.4) * 0.06;
    if (this.age > this.life) this.dispose();
  }
  collect() {
    const g = this.game, pl = g.player;
    if (!pl) return;
    if (this.kind === 'ammo') {
      pl.ws.refill(0.5);
      g.hud.popup('弹药补给', '#ffd166');
    } else {
      pl.hp = Math.min(pl.maxHp, pl.hp + 60);
      g.hud.popup('医疗包 +60', '#8fe06a');
    }
    g.audio.ui('equip');
    this.dispose();
  }
  dispose() {
    this.alive = false;
    this.game.scene.remove(this.mesh);
    this.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }
}
