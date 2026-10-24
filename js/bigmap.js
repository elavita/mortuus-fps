// 程序化粗野主义地图生成器
// 方案：房间格网（3x3 大格）+ 在格间挖 L 形走廊，保证全连通
import * as THREE from 'three';
import { mulberry32, rand, randInt, pick, clamp } from './util.js';

const V = (x, z, y = 0) => new THREE.Vector3(x, y, z);
const CELL = 8;      // 每格 8m
const GRID = 9;      // 9x9 格

export function generateMap(seed) {
  const rng = mulberry32(seed);
  const R = (a, b) => a + rng() * (b - a);
  const RI = (a, b) => Math.floor(R(a, b + 1));
  const P = arr => arr[Math.floor(rng() * arr.length)];

  const size = GRID * CELL;
  const half = size / 2;

  // ---------- 1. 在 9x9 格网上生成房间 ----------
  // 每个房间是矩形（格坐标），房间之间至少隔 1 格（走廊）
  const rooms = [];
  const occupied = new Uint8Array(GRID * GRID);

  const tryPlace = (x, z, w, d) => {
    if (x < 0 || z < 0 || x + w > GRID || z + d > GRID) return false;
    // 需要外扩 1 格不被占用（留走廊）
    for (let zz = z - 1; zz <= z + d; zz++) {
      for (let xx = x - 1; xx <= x + w; xx++) {
        if (xx < 0 || zz < 0 || xx >= GRID || zz >= GRID) continue;
        if (occupied[zz * GRID + xx]) return false;
      }
    }
    for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) occupied[zz * GRID + xx] = 1;
    rooms.push({ x, z, w, d });
    return true;
  };

  // 先放几个大房间，再补小房间
  const layoutPlan = [
    [0, 0, 3, 3], [4, 0, 3, 2], [7, 0, 2, 4],
    [0, 4, 2, 3], [3, 4, 3, 3], [7, 4, 2, 2],
    [0, 7, 3, 2], [4, 7, 4, 2],
  ];
  for (const [x, z, w, d] of layoutPlan) {
    if (rng() < 0.88) tryPlace(x, z, w, d);
  }
  // 补一些随机房间填缝
  for (let attempt = 0; attempt < 24; attempt++) {
    const w = RI(2, 3), d = RI(2, 3);
    const x = RI(0, GRID - w), z = RI(0, GRID - d);
    if (rng() < 0.55) tryPlace(x, z, w, d);
  }

  // 房间世界坐标
  for (const r of rooms) {
    r.cx = (r.x + r.w / 2) * CELL - half;
    r.cz = (r.z + r.d / 2) * CELL - half;
    r.wx = r.w * CELL;
    r.wz = r.d * CELL;
    r.id = rooms.indexOf(r);
  }

  // ---------- 2. 走廊：连接房间（最小生成树 + 少量环路） ----------
  const grid = new Uint8Array(GRID * GRID);
  for (const r of rooms) for (let z = r.z; z < r.z + r.d; z++) for (let x = r.x; x < r.x + r.w; x++) grid[z * GRID + x] = 1;

  const corridors = [];
  function carvePath(a, b) {
    const ax = Math.floor(a.x + a.w / 2), az = Math.floor(a.z + a.d / 2);
    const bx = Math.floor(b.x + b.w / 2), bz = Math.floor(b.z + b.d / 2);
    const pts = [];
    const horizFirst = rng() < 0.5;
    if (horizFirst) {
      const s = ax < bx ? 1 : -1;
      for (let x = ax; x !== bx + s; x += s) pts.push([x, az]);
      const s2 = az < bz ? 1 : -1;
      for (let z = az; z !== bz + s2; z += s2) pts.push([bx, z]);
    } else {
      const s = az < bz ? 1 : -1;
      for (let z = az; z !== bz + s; z += s) pts.push([ax, z]);
      const s2 = ax < bx ? 1 : -1;
      for (let x = ax; x !== bx + s2; x += s2) pts.push([x, bz]);
    }
    const carved = [];
    for (const [x, z] of pts) {
      if (x < 0 || z < 0 || x >= GRID || z >= GRID) continue;
      if (grid[z * GRID + x] === 0) { grid[z * GRID + x] = 2; carved.push([x, z]); }
    }
    if (carved.length) corridors.push({ cells: carved, a: rooms.indexOf(a), b: rooms.indexOf(b) });
  }

  // Prim MST
  const n = rooms.length;
  if (n > 1) {
    const inTree = new Array(n).fill(false);
    inTree[0] = true;
    let count = 1;
    while (count < n) {
      let best = null, bestD = Infinity;
      for (let i = 0; i < n; i++) {
        if (!inTree[i]) continue;
        for (let j = 0; j < n; j++) {
          if (inTree[j]) continue;
          const d = Math.hypot(rooms[i].cx - rooms[j].cx, rooms[i].cz - rooms[j].cz);
          if (d < bestD) { bestD = d; best = [i, j]; }
        }
      }
      if (!best) break;
      carvePath(rooms[best[0]], rooms[best[1]]);
      inTree[best[1]] = true;
      count++;
    }
    // 加环路
    const extra = Math.min(3, Math.floor(n / 3));
    for (let k = 0; k < extra; k++) {
      const i = Math.floor(rng() * n), j = Math.floor(rng() * n);
      if (i !== j) carvePath(rooms[i], rooms[j]);
    }
  }

  // 兜底：若一条走廊都没有，强行打通前两个房间
  if (!corridors.length && rooms.length >= 2) {
    const a = rooms[0], b = rooms[1];
    const ax = Math.floor(a.x + a.w / 2), az = Math.floor(a.z + a.d / 2);
    const bx = Math.floor(b.x + b.w / 2), bz = Math.floor(b.z + b.d / 2);
    const carved = [];
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) { if (!grid[az * GRID + x]) { grid[az * GRID + x] = 2; carved.push([x, az]); } }
    for (let z = Math.min(az, bz); z <= Math.max(az, bz); z++) { if (!grid[z * GRID + bx]) { grid[z * GRID + bx] = 2; carved.push([bx, z]); } }
    corridors.push({ cells: carved, a: 0, b: 1 });
  }

  // ---------- 3. 出生房与死路 ----------
  let spawnRoom = rooms[0];
  let bestD = -1;
  for (const r of rooms) {
    const d = Math.hypot(r.cx, r.cz);
    if (d > bestD) { bestD = d; spawnRoom = r; }
  }
  const connCount = {};
  for (const c of corridors) { connCount[c.a] = (connCount[c.a] || 0) + 1; connCount[c.b] = (connCount[c.b] || 0) + 1; }
  let deadEnds = rooms.filter((r, i) => (connCount[i] || 0) <= 1 && r !== spawnRoom);
  if (!deadEnds.length) deadEnds = rooms.filter(r => r !== spawnRoom).slice(-2);

  // ---------- 4. 地图定义 ----------
  const def = {
    id: 'proc' + seed, name: 'MORTUUS · 区块 ' + (seed % 999), size, seed, surface: 'concrete',
    env: {
      sky: 'day', sunDir: [0.36, 0.55, 0.22], sunColor: 0xfff2e0, sun: 4.2, hemi: 0.42,
      sky2: 0x7f93a8, ground: 0x2e2b28, fog: 0x5a6672, fogDensity: 0.0075,
      turbidity: 14, rayleigh: 2.0, mie: 0.009, exposure: 0.85, envIntensity: 0.38,
      weather: 'none', ambient: 'wind',
    },
    layout: { rooms, corridors, spawnRoom, deadEnds, grid, GRID, CELL, half },
    build(w) { buildGeometry(w, def, rng, P, RI, R); },
  };
  return def;
}

/** 把格网转成世界几何 */
function buildGeometry(w, def, rng, P, RI, R) {
  const L = def.layout;
  const { rooms, corridors, grid, GRID, CELL, half } = L;
  const R2 = (a, b) => a + rng() * (b - a);
  const RI2 = (a, b) => Math.floor(R2(a, b + 1));

  w.ground('concreteDark', def.size + 60);
  w.bounds();

  // 地面
  for (const r of rooms) {
    w.box(r.cx, -0.02, r.cz, r.wx - 0.2, 0.03, r.wz - 0.2, 'concrete', { collide: false, texScale: 4 });
  }
  for (const c of corridors) {
    for (const [cx, cz] of c.cells) {
      const wx = (cx + 0.5) * CELL - half;
      const wz = (cz + 0.5) * CELL - half;
      w.box(wx, -0.02, wz, CELL, 0.03, CELL, 'asphalt', { collide: false, texScale: 4 });
    }
  }

  // ---------- 墙体 ----------
  const cellW = (cx, cz) => (cx < 0 || cz < 0 || cx >= GRID || cz >= GRID) ? 0 : grid[cz * GRID + cx];
  const H = 4.2, T = 0.34;
  const doorways = [];

  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++) {
      const here = cellW(x, z);
      if (!here) continue;
      const wx = (x + 0.5) * CELL - half;
      const wz = (z + 0.5) * CELL - half;
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nb = cellW(x + dx, z + dz);
        if (nb === here) continue;             // 同类型（都是房间或都是走廊）：不建墙
        if (nb === 1 && here === 2) continue;  // 走廊与房间之间：不建墙（门洞由房间侧统一处理）
        if (nb === 2 && here === 1) {
          // 房间 → 走廊：开门洞
          const isHoriz = dz !== 0;
          const dw = 2.6;
          const edgeLen = CELL + T;
          const s1 = (edgeLen - dw) / 2;
          if (isHoriz) {
            const mz = (z + (dz > 0 ? 1 : 0)) * CELL - half;
            w.box(wx - edgeLen / 2 + s1 / 2, 0, mz, s1, H, T, 'concrete', { texScale: 3 });
            w.box(wx + edgeLen / 2 - s1 / 2, 0, mz, s1, H, T, 'concrete', { texScale: 3 });
            w.box(wx, 2.5, mz, dw, H - 2.5, T, 'concrete', { texScale: 3 });
            doorways.push({ x: wx, z: mz, horiz: true, w: dw });
          } else {
            const mx = (x + (dx > 0 ? 1 : 0)) * CELL - half;
            w.box(mx, 0, wz - edgeLen / 2 + s1 / 2, T, H, s1, 'concrete', { texScale: 3 });
            w.box(mx, 0, wz + edgeLen / 2 - s1 / 2, T, H, s1, 'concrete', { texScale: 3 });
            w.box(mx, 2.5, wz, T, H - 2.5, dw, 'concrete', { texScale: 3 });
            doorways.push({ x: mx, z: wz, horiz: false, w: dw });
          }
          continue;
        }
        // 其余情况（房间/走廊 → 空地）：建实墙
        const isHoriz = dz !== 0;
        const edgeLen = CELL + T;
        if (isHoriz) {
          const mz = (z + (dz > 0 ? 1 : 0)) * CELL - half;
          w.box(wx, 0, mz, edgeLen, H, T, 'concrete', { texScale: 3 });
        } else {
          const mx = (x + (dx > 0 ? 1 : 0)) * CELL - half;
          w.box(mx, 0, wz, T, H, edgeLen, 'concrete', { texScale: 3 });
        }
      }
    }
  }

  // ---------- 天花板 ----------
  const courtyardSet = new Set();
  const shuffled = rooms.slice().sort(() => rng() - 0.5);
  const courtyardCount = Math.min(2, Math.max(1, Math.floor(rooms.length / 5)));
  for (let i = 0; i < courtyardCount; i++) courtyardSet.add(shuffled[i].id);

  for (const r of rooms) {
    if (courtyardSet.has(r.id)) continue;
    w.box(r.cx, H, r.cz, r.wx + T, 0.3, r.wz + T, 'concreteDark', { texScale: 4 });
    // 灯带：按房间面积铺，保证照度
    const nx = Math.max(1, Math.round(r.wx / 7));
    const nz = Math.max(1, Math.round(r.wz / 7));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const lx = r.cx - r.wx / 2 + (i + 0.5) * (r.wx / nx);
        const lz = r.cz - r.wz / 2 + (j + 0.5) * (r.wz / nz);
        // 灯管
        w.box(lx, H - 0.16, lz, 2.0, 0.08, 0.3, 'lampCold', { collide: false });
        w.pointLight(lx, H - 0.6, lz, 0xd8e8ff, 2.2, 16);
      }
    }
    // 房间中央补一盏
    w.pointLight(r.cx, H - 1.0, r.cz, 0xc8dcf0, 1.4, 14);
  }
  for (const c of corridors) {
    for (const [cx, cz] of c.cells) {
      const wx = (cx + 0.5) * CELL - half;
      const wz = (cz + 0.5) * CELL - half;
      w.box(wx, H, wz, CELL + T, 0.3, CELL + T, 'concreteDark', { collide: false });
    }
    for (let i = 0; i < c.cells.length; i += 2) {
      const [cx, cz] = c.cells[i];
      const wx = (cx + 0.5) * CELL - half;
      const wz = (cz + 0.5) * CELL - half;
      w.box(wx, H - 0.15, wz, 1.4, 0.07, 0.26, 'lampCold', { collide: false });
      w.pointLight(wx, H - 0.55, wz, 0xc0d8f0, 1.8, 13);
    }
  }

  // ---------- 道具 ----------
  const containers = ['containerRed', 'containerBlue', 'containerGreen', 'containerOrange', 'containerGray', 'containerYellow'];
  // 出生房间中央留空（半径 4m 内不放道具）
  const spawnRoomRef = L.spawnRoom;
  const clearR = 4.5;
  for (const r of rooms) {
    const n = RI2(2, 5);
    for (let i = 0; i < n; i++) {
      const px = r.cx + R2(-r.wx / 2 + 1.4, r.wx / 2 - 1.4);
      const pz = r.cz + R2(-r.wz / 2 + 1.4, r.wz / 2 - 1.4);
      // 出生房中央留空
      if (r === spawnRoomRef && Math.hypot(px - r.cx, pz - r.cz) < clearR) continue;
      const kind = rng();
      if (kind < 0.26) w.container(px, pz, rng() < 0.5 ? 0 : Math.PI / 2, P(containers));
      else if (kind < 0.44) w.crateStack(px, pz);
      else if (kind < 0.60) w.barrel(px, pz, P(containers));
      else if (kind < 0.74) w.jersey(px, pz, rng() < 0.5 ? 0 : Math.PI / 2);
      else if (kind < 0.88) w.sandbags(px, pz, RI2(2, 4), rng() < 0.5 ? 0 : Math.PI / 2);
      else w.rock(px, pz, R2(0.6, 1.2), 'rock');
    }
  }

  L.doorways = doorways;
  L.courtyards = [...courtyardSet].map(id => rooms.find(r => r.id === id));
  L.wallHeight = H;
}
