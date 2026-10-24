// 僵尸模型（体素/方块风）、断肢、动画
import * as THREE from 'three';
import { mat } from './materials.js';
import { ZTYPES } from './mdata.js';
import { rand, clamp, damp } from './util.js';

const _v = new THREE.Vector3();

// 方块身体材质：带轻微色差，做出"肉块"感
function fleshMat(color, rough = 0.92) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.02 });
}

const CACHE = new Map();
function cachedMat(key, make) {
  if (!CACHE.has(key)) CACHE.set(key, make());
  return CACHE.get(key);
}

/**
 * 创建一个方块僵尸模型。
 * 返回 { root, parts... , setSevered(part), updateAnim(state, dt) }
 */
export function createZombieModel(type = 'walker', variant = 0) {
  const T = ZTYPES[type] || ZTYPES.walker;
  // 每只僵尸有细微色差，避免"复制人"感
  const hueShift = rand(-0.03, 0.03);
  const skin = cachedMat('zskin' + type + variant, () => fleshMat(new THREE.Color(T.skin).offsetHSL(hueShift, rand(-0.05, 0.05), rand(-0.06, 0.04))));
  const cloth = cachedMat('zcloth' + type + variant, () => fleshMat(new THREE.Color(T.color).offsetHSL(hueShift, rand(-0.04, 0.04), rand(-0.05, 0.04))));
  const dark = cachedMat('zdark', () => new THREE.MeshStandardMaterial({ color: 0x1b1614, roughness: 0.95 }));
  const bone = cachedMat('zbone', () => new THREE.MeshStandardMaterial({ color: 0xcfc4a8, roughness: 0.7 }));
  const blood = cachedMat('zblood', () => new THREE.MeshStandardMaterial({ color: 0x4a0a08, roughness: 0.55 }));
  const eyeM = cachedMat('zeye', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.35, 0.15) }));

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);

  // 躯干（方块，略前倾）
  const torso = new THREE.Group();
  hips.add(torso);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.28), cloth);
  chest.position.y = 0.30;
  torso.add(chest);
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.26, 0.26), skin);
  belly.position.y = 0.03;
  torso.add(belly);
  // 肋骨外露 / 撕裂伤口
  const gash = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.04), blood);
  gash.position.set(0.02, 0.32, -0.15);
  torso.add(gash);
  // 肩部碎布
  const ragL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.20, 0.30), cloth);
  ragL.position.set(-0.20, 0.50, 0.02); ragL.rotation.z = 0.15; torso.add(ragL);
  const ragR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.28), cloth);
  ragR.position.set(0.21, 0.50, 0.02); ragR.rotation.z = -0.1; torso.add(ragR);

  // 头
  const neck = new THREE.Group();
  neck.position.y = 0.60;
  torso.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skin);
  head.position.y = 0.14;
  neck.add(head);
  // 下颚
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.20), skin);
  jaw.position.set(0, 0.02, 0.04);
  neck.add(jaw);
  // 眼睛
  const eyeGeo = new THREE.BoxGeometry(0.055, 0.035, 0.02);
  for (const x of [-0.062, 0.062]) {
    const e = new THREE.Mesh(eyeGeo, eyeM);
    e.position.set(x, 0.17, -0.131);
    neck.add(e);
  }
  // 露出的牙
  for (let i = -1; i <= 1; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.02), bone);
    t.position.set(i * 0.055, 0.055, -0.131);
    neck.add(t);
  }

  // 手臂：肩 -> 上臂 -> 肘 -> 前臂 -> 手
  const mkArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.28, 0.50, 0);
    torso.add(shoulder);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.34, 0.13), skin);
    upper.position.y = -0.17;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.34;
    shoulder.add(elbow);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.32, 0.115), skin);
    fore.position.y = -0.16;
    elbow.add(fore);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.10), skin);
    hand.position.y = -0.36;
    elbow.add(hand);
    return { shoulder, elbow, hand };
  };
  const armL = mkArm(-1), armR = mkArm(1);

  // 腿：髋 -> 大腿 -> 膝 -> 小腿 -> 脚
  const mkLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.13, -0.06, 0);
    hips.add(hip);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.40, 0.16), cloth);
    thigh.position.y = -0.20;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.40;
    hip.add(knee);
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.38, 0.14), cloth);
    shin.position.y = -0.19;
    knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.10, 0.26), dark);
    foot.position.set(0, -0.43, 0.05);
    knee.add(foot);
    return { hip, knee, foot };
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  const parts = { root, hips, torso, neck, head, jaw, armL, armR, legL, legR, skin, cloth, dark, bone };

  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  const state = {
    severed: { armL: false, armR: false, legL: false, legR: false, head: false },
    crawling: false,
    phase: rand(0, 6.28),
    speed: 0,
    attack: 0,
    hitT: 0,
    dead: false,
    deadT: 0,
    fallDir: 1,
    fallRoll: 0,
  };

  // 整体缩放
  const s = T.scale || 1;
  root.scale.setScalar(s);

  return {
    root, parts, state,
    type,
    /** 断肢：隐藏对应部位并返回脱落的世界坐标（用于生成碎块特效） */
    sever(part) {
      if (state.severed[part]) return null;
      state.severed[part] = true;
      const P = parts;
      let node = null;
      if (part === 'armL') node = P.armL.shoulder;
      else if (part === 'armR') node = P.armR.shoulder;
      else if (part === 'legL') node = P.legL.hip;
      else if (part === 'legR') node = P.legR.hip;
      else if (part === 'head') node = P.neck;
      if (!node) return null;
      root.updateMatrixWorld(true);
      const wp = node.getWorldPosition(new THREE.Vector3());
      node.visible = false;
      // 双腿都没了 -> 爬行
      if (state.severed.legL && state.severed.legR) state.crawling = true;
      if (state.severed.legL || state.severed.legR) state.crawling = true;
      return wp;
    },
    /** 死亡：按方向倒地 */
    die(dir, roll) {
      state.dead = true;
      state.deadT = 0;
      // 相对身体的前向 (-z 为前)
      const f = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), root.rotation.y);
      state.fallDir = f.dot(dir || new THREE.Vector3(0, 0, 1)) > 0 ? -1 : 1;
      state.fallRoll = roll ?? rand(-0.35, 0.35);
    },
    /** 每帧动画 */
    animate(dt, t) {
      const A = state;
      if (A.dead) {
        A.deadT += dt;
        const k = clamp(A.deadT / 0.5, 0, 1);
        const e = 1 - Math.pow(1 - k, 3);
        root.rotation.x = e * (Math.PI / 2) * A.fallDir;
        root.rotation.z = e * A.fallRoll;
        hips.position.y = 0.92 - e * 0.72;
        // 死亡后肢体松弛
        P.armL.shoulder.rotation.x = damp(P.armL.shoulder.rotation.x, 0.4, 6, dt);
        P.armR.shoulder.rotation.x = damp(P.armR.shoulder.rotation.x, 0.5, 6, dt);
        return;
      }
      const P = parts;
      A.hitT = Math.max(0, A.hitT - dt * 4);
      const moving = A.speed > 0.15;
      if (moving) A.phase += dt * A.speed * 2.6;

      if (A.crawling) {
        // 爬行：身体压低贴地，靠双臂拖动
        hips.position.y = damp(hips.position.y, 0.20, 8, dt);
        root.rotation.x = damp(root.rotation.x, 0.0, 8, dt);
        torso.rotation.x = damp(torso.rotation.x, -0.55, 6, dt);
        torso.position.y = damp(torso.position.y, -0.02, 6, dt);
        const sw = Math.sin(A.phase);
        P.armL.shoulder.rotation.x = -2.4 + sw * 0.6;
        P.armR.shoulder.rotation.x = -2.4 - sw * 0.6;
        P.armL.elbow.rotation.x = 0.45 - sw * 0.3;
        P.armR.elbow.rotation.x = 0.45 + sw * 0.3;
        neck.rotation.x = 0.55;
        return;
      }
      torso.position.y = damp(torso.position.y, 0, 8, dt);

      hips.position.y = damp(hips.position.y, 0.92, 8, dt);
      const sw = moving ? Math.sin(A.phase) : Math.sin(t * 0.9) * 0.12;
      const amp = moving ? Math.min(1, A.speed / 2.2) : 0.25;

      // 腿
      if (P.legL.hip.visible) {
        P.legL.hip.rotation.x = sw * 0.62 * amp;
        P.legL.knee.rotation.x = -Math.max(0, Math.cos(A.phase)) * 0.75 * amp;
      }
      if (P.legR.hip.visible) {
        P.legR.hip.rotation.x = -sw * 0.62 * amp;
        P.legR.knee.rotation.x = -Math.max(0, -Math.cos(A.phase)) * 0.75 * amp;
      }

      // 手臂：经典僵尸前伸（攻击时前挥）
      const atk = A.attack;
      const baseArm = -1.45 - atk * 0.45;
      if (!P.armL.shoulder.visible) { /* 断臂 */ }
      else {
        P.armL.shoulder.rotation.x = baseArm + sw * 0.20;
        P.armL.shoulder.rotation.z = 0.10;
        P.armL.elbow.rotation.x = -0.22 + Math.sin(t * 2.2) * 0.10;
      }
      if (!P.armR.shoulder.visible) { /* 断臂 */ }
      else {
        P.armR.shoulder.rotation.x = baseArm - sw * 0.20;
        P.armR.shoulder.rotation.z = -0.10;
        P.armR.elbow.rotation.x = -0.22 - Math.sin(t * 2.2) * 0.10;
      }

      // 躯干晃动 + 受击后仰
      torso.rotation.x = 0.12 + Math.sin(A.phase * 0.5) * 0.05 + A.hitT * 0.4;
      torso.rotation.z = sw * 0.05;
      neck.rotation.x = -0.1 + Math.sin(t * 1.3) * 0.05;
      neck.rotation.z = Math.sin(t * 0.7) * 0.08;
    },
  };
}

/** 生成断肢碎块（飞出的肢体） */
export function spawnLimbChunk(game, pos, dir, color, size = 0.16) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(size, size * 1.6, size), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  g.add(m);
  g.position.copy(pos);
  game.scene.add(g);
  const v = new THREE.Vector3(dir.x * 2.4 + rand(-1, 1), rand(2.5, 4.5), dir.z * 2.4 + rand(-1, 1));
  let t = 0;
  const upd = (dt) => {
    t += dt;
    v.y -= 16 * dt;
    g.position.addScaledVector(v, dt);
    g.rotation.x += dt * 7; g.rotation.z += dt * 5;
    const gh = game.world ? game.world.groundHeight(g.position.x, g.position.z, g.position.y + 0.3, 0.1) : 0;
    if (g.position.y <= gh + size * 0.8) { g.position.y = gh + size * 0.8; v.multiplyScalar(0.2); v.y = 0; }
    if (t > 6) { game.scene.remove(g); g.traverse(o => o.geometry && o.geometry.dispose()); return true; }
    return false;
  };
  (game.chunks = game.chunks || []).push(upd);
  return upd;
}
