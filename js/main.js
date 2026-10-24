// 入口：渲染器、后处理、主循环、状态管理
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { initTextures, mat } from './materials.js';
import { setTextureSize } from './textures.js';
import { setFlashTexture } from './soldier.js';
import { World } from './world.js';
import { MAPS } from './maps.js';
import { Effects } from './effects.js';
import { Audio } from './audio.js';
import { HUD } from './hud.js';
import { Menu } from './menu.js';
import { MPMatch } from './mp.js';
import { Campaign } from './campaign.js';
import { RoundMode } from './rounds.js';
import { Shop } from './shop.js';
import { Inventory } from './inventory.js';
import { generateMap } from './bigmap.js';
import { buildGun } from './gunmodel.js';
import { DEFAULT_CLASSES, DEFAULT_STREAKS } from './data.js';
import { damp } from './util.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, nvg: { value: 0 }, thermal: { value: 0 }, hurt: { value: 0 }, vig: { value: 0.35 }, wp: { value: 0 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, nvg, thermal, hurt, vig, wp; uniform vec2 res; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      if (hurt > 0.01) { vec2 o = (uv - 0.5) * 0.008 * hurt; c.r = texture2D(tDiffuse, uv + o).r; c.b = texture2D(tDiffuse, uv - o).b; }
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, vec3(l), hurt * 0.55);
      float n = hash(uv * res + fract(time) * 100.0);
      if (nvg > 0.5) {
        float a = l * 7.0 + 0.015;
        a = a / (1.0 + a * 0.35);
        c = vec3(0.32, 1.0, 0.42) * a * 1.4 + (n - 0.5) * 0.09;
        float scan = sin(uv.y * res.y * 1.5) * 0.02; c += scan;
      }
      if (thermal > 0.5) {
        float t = clamp(l * 1.5, 0.0, 1.0);
        c = vec3(t * 0.45);
        if (l > 2.0) c = vec3(1.4);
        c += (n - 0.5) * 0.04;
      }
      if (wp > 0.01) { c = mix(c, c * vec3(1.6, 0.9, 0.5) + vec3(0.25, 0.08, 0.0), wp); }
      float d = length(uv - 0.5);
      c *= 1.0 - vig * smoothstep(0.35, 0.85, d);
      c += (n - 0.5) * 0.012;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

class Game {
  constructor() {
    this.settings = Object.assign({ sens: 1.0, adsSens: 0.9, fov: 78, quality: 'high', volume: 0.8, voice: true, invertY: false, showFps: true }, JSON.parse(localStorage.getItem('mf_settings') || '{}'));
    this.profile = Object.assign({ xp: 0, classes: JSON.parse(JSON.stringify(DEFAULT_CLASSES)), streaks: [...DEFAULT_STREAKS], selClass: 0, campaignBest: null }, JSON.parse(localStorage.getItem('mf_profile') || '{}'));
    if (!this.profile.classes || this.profile.classes.length < 5) this.profile.classes = JSON.parse(JSON.stringify(DEFAULT_CLASSES));
    this.state = 'loading';
    this.paused = false;
    this.time = 0;
    this.entities = []; this.bots = []; this.projectiles = []; this.pickups = []; this.noises = [];
    this.mat = mat;
    this.input = { keys: {}, pressed: {}, mdx: 0, mdy: 0, buttons: 0, wheel: 0 };
  }
  saveProfile() { localStorage.setItem('mf_profile', JSON.stringify(this.profile)); }
  saveSettings() { localStorage.setItem('mf_settings', JSON.stringify(this.settings)); }

  async init() {
    const q = this.settings.quality;
    setTextureSize(q === 'low' ? 256 : 512);
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 1.5 : 1));
    r.setSize(window.innerWidth, window.innerHeight, false);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1;
    r.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('app').appendChild(r.domElement);
    this.canvas = r.domElement;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 2500);
    this.scene.add(this.camera);
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.01, 10);
    this.vmHemi = new THREE.HemisphereLight(0xcfd8ff, 0x3a3020, 0.8);
    this.vmSun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.vmFill = new THREE.DirectionalLight(0xdde6ff, 0.9); this.vmFill.position.set(-0.5, 0.6, 1);
    this.vmScene.add(this.vmHemi, this.vmSun, this.vmSun.target, this.vmFill);
    this.audio = new Audio();
    this.audio.setVolume(this.settings.volume); this.audio.voice = this.settings.voice;
    const fill = document.getElementById('loadFill'), txt = document.getElementById('loadText');
    await initTextures(p => { fill.style.width = (p * 80) + '%'; });
    txt.textContent = '正在初始化渲染管线…';
    await new Promise(r => setTimeout(r, 10));
    this.effects = new Effects(this);
    setFlashTexture(this.effects.texFlash);
    this.hud = new HUD(this);
    this.setupComposer();
    this.setupInput();
    fill.style.width = '90%';
    txt.textContent = '正在构建菜单场景…';
    await new Promise(r => setTimeout(r, 10));
    this.menu = new Menu(this);
    this.shop = new Shop(this);
    this.inventory = new Inventory(this);
    // 预编译着色器
    fill.style.width = '100%';
    window.addEventListener('resize', () => this.onResize());
    document.getElementById('loading').style.display = 'none';
    this.state = 'menu';
    this.menu.showMain();
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setupComposer() {
    const r = this.renderer;
    const comp = this.composer = new EffectComposer(r);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.vmPass = new RenderPass(this.vmScene, this.vmCamera);
    this.vmPass.clear = false; this.vmPass.clearDepth = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.5, 0.92);
    this.grade = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    this.fxaa = new ShaderPass(FXAAShader);
    comp.addPass(this.renderPass); comp.addPass(this.vmPass); comp.addPass(this.bloom); comp.addPass(this.grade); comp.addPass(this.output); comp.addPass(this.fxaa);
    this.bloom.enabled = this.settings.quality !== 'low';
    this.onResize();
  }
  onResize() {
    const w = document.documentElement.clientWidth || window.innerWidth, h = document.documentElement.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer && this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    if (this.grade) this.grade.uniforms.res.value.set(w, h);
    if (this.menu) this.menu.onResize();
  }
  applyQuality() {
    const q = this.settings.quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 1.5 : 1));
    this.bloom.enabled = q !== 'low';
    this.onResize();
  }

  setupInput() {
    const I = this.input;
    const cv = this.canvas;
    window.addEventListener('keydown', e => {
      if (e.code === 'Tab') e.preventDefault();
      if (!I.keys[e.code]) I.pressed[e.code] = true;
      I.keys[e.code] = true;
      if (this.state === 'play') {
        if (e.code === 'Tab') this.hud.showScoreboard(true);
        if (e.code === 'Escape' && !document.pointerLockElement && !this.paused && !this.menu.overlayOpen) this.pause(true);
        if (this.dead && e.code === 'KeyC' && this.mode && this.mode.canChangeClass) this.menu.showClassSelect();
      }
    });
    window.addEventListener('keyup', e => { I.keys[e.code] = false; if (e.code === 'Tab' && this.state === 'play') this.hud.showScoreboard(false); });
    // 鼠标位移过滤：浏览器（尤其 Windows 版 Chrome/Edge）在指针锁定下偶尔会给出
    // 巨大的错误 movementX/Y（光标被拉回中心时的跳变、锁定刚生效时的第一帧等），
    // 表现为视角"闪现"。这里丢弃锁定后最初的事件，并剔除相对近期平均值异常巨大的单次跳变。
    const MF = this.mouseFilter = { since: 0, avg: 0, strikes: 0, lastT: 0 };
    window.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== cv) return;
      const now = performance.now();
      if (now - MF.since < 120) return;                       // 锁定刚生效：丢弃
      const dx = e.movementX || 0, dy = e.movementY || 0;
      const mag = Math.hypot(dx, dy);
      if (now - MF.lastT > 250) MF.avg = Math.min(MF.avg, 30); // 静止一段后重新起算
      MF.lastT = now;
      const limit = Math.max(160, MF.avg * 7);
      if (mag > limit) {
        // 连续多次大位移说明是真实的快速甩枪，放行；孤立的跳变视为噪声丢弃
        if (++MF.strikes < 3) return;
      } else MF.strikes = 0;
      MF.avg = MF.avg * 0.8 + Math.min(mag, limit) * 0.2;
      I.mdx += dx; I.mdy += dy;
    });
    window.addEventListener('mousedown', e => {
      if (this.state === 'play' && !this.paused && document.pointerLockElement !== cv && !this.menu.overlayOpen && e.target === cv) { this.lock(); return; }
      if (document.pointerLockElement === cv) { I.buttons |= (1 << e.button); I.pressed['Mouse' + e.button] = true; }
    });
    window.addEventListener('mouseup', e => { I.buttons &= ~(1 << e.button); });
    window.addEventListener('wheel', e => { if (document.pointerLockElement === cv) I.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === cv;
      MF.since = performance.now(); MF.avg = 0; MF.strikes = 0; I.mdx = 0; I.mdy = 0;
      document.getElementById('clickToPlay').classList.add('hidden');
      if (!locked && this.state === 'play' && !this.paused && !this.dead && !this.menu.overlayOpen && !this.ending) {
        // 只在用户手动 Esc 退出锁定后暂停；无头/自动化环境不打断
        if (this.userUnlocked) this.pause(true);
      }
      if (!locked) { I.buttons = 0; }
    });
    document.getElementById('clickToPlay').addEventListener('click', () => this.lock());
    document.getElementById('btnChangeClass').addEventListener('click', () => this.menu.showClassSelect());
  }
  lock() {
    this.audio.init();
    if (document.pointerLockElement === this.canvas) return;
    // 优先请求原始输入（unadjustedMovement）：绕过系统鼠标加速，也能避开 Chrome 的位移跳变 bug；
    // 不支持时回退到普通指针锁定
    const cv = this.canvas;
    const plain = () => { try { const q = cv.requestPointerLock(); if (q && q.catch) q.catch(() => { }); } catch (e) { } };
    try {
      const p = cv.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(err => { if (!err || err.name === 'NotSupportedError' || err.name === 'NotAllowedError' && document.pointerLockElement !== cv) plain(); });
      else if (!p) { /* 旧浏览器不返回 Promise：已按普通方式处理 */ }
    } catch (e) { plain(); }
  }
  pause(v) {
    if (this.state !== 'play') return;
    if (v && this.shop && this.shop.open) return;   // 商店打开时不弹暂停
    this.paused = v;
    if (v) { this.menu.showPause(); if (document.pointerLockElement) document.exitPointerLock(); }
    else { this.menu.hide(); this.lock(); }
  }

  // 帧输入快照
  snapshotInput() {
    const I = this.input, K = I.keys, P = I.pressed;
    const s = {
      fwd: K.KeyW, back: K.KeyS, left: K.KeyA, right: K.KeyD,
      sprint: K.ShiftLeft || K.ShiftRight, jumpPressed: P.Space, crouchPressed: P.KeyC || P.ControlLeft,
      fire: !!(I.buttons & 1), ads: !!(I.buttons & 4),
      reloadPressed: P.KeyR, swapPressed: I.wheel !== 0, slot1: P.Digit1, slot2: P.Digit2,
      meleePressed: P.KeyV || P.Mouse3, lethalPressed: P.KeyG, lethal: K.KeyG, tacticalPressed: P.KeyQ, tactical: K.KeyQ,
      interact: K.KeyF, interactPressed: P.KeyF, nvgPressed: P.KeyN,
      streak: P.Digit3 ? 0 : P.Digit4 ? 1 : P.Digit5 ? 2 : -1,
      firePressed: P.Mouse0, adsPressed: P.Mouse2,
      mdx: I.mdx, mdy: I.mdy,
    };
    I.mdx = 0; I.mdy = 0; I.wheel = 0;
    for (const k in P) delete P[k];
    return s;
  }

  // ---------- 世界管理 ----------
  clearWorld() {
    // 先关掉热成像/夜视，避免效果残留到菜单
    this.setThermal(false);
    this.nvg = false;
    this.scopeState = null;
    this.lowPowerOptic = null;
    this.thermalOn = false;
    for (const b of this.bots) b.dispose();
    if (this.zombies) for (const z of this.zombies) z.dispose();
    if (this.teammates) for (const t of this.teammates) t.dispose();
    for (const p of this.projectiles) if (p.mesh) this.scene.remove(p.mesh);
    for (const p of this.pickups) this.scene.remove(p.mesh);
    if (this.mode && this.mode.dispose) this.mode.dispose();
    if (this.player) this.player.ws.dispose();
    if (this.world) this.world.dispose();
    this.effects.clear();
    this.audio.stopAll();
    this.bots = []; this.entities = []; this.projectiles = []; this.pickups = []; this.noises = [];
    this.zombies = []; this.teammates = []; this.chunks = []; this.drops = [];
    this.world = null; this.player = null; this.mode = null;
    this.grade.uniforms.nvg.value = 0; this.grade.uniforms.thermal.value = 0; this.grade.uniforms.wp.value = 0;
    this.nvg = false;
    if (this.menu) { this.menu.hideCards(); this.menu.hideAscend(); }
  }
  loadMap(id) {
    const def = MAPS[id];
    return this.loadMapFromDef(def);
  }
  /** 用任意地图定义加载（程序化地图也走这里） */
  loadMapFromDef(def) {
    const w = new World(this, def);
    this.world = w;
    w.setupEnvironment(def.env);
    def.build(w, this);
    w.finalize();
    this.effects.setWeather(def.env.weather);
    // 视图模型灯光
    this.vmSun.color.set(def.env.sunColor); this.vmSun.intensity = Math.max(1.1, def.env.sun * 0.6);
    this.vmSun.position.set(...def.env.sunDir).multiplyScalar(10);
    this.vmHemi.intensity = Math.max(0.9, def.env.hemi);
    this.vmScene.environment = this.scene.environment;
    this.vmScene.environmentIntensity = Math.max(0.4, def.env.envIntensity);
    if (def.env.ambient) this.audio.loop('amb', def.env.ambient, def.env.ambient === 'rain' ? 0.12 : 0.08);
    return w;
  }

  // ---------- 僵尸模式：点数 ----------
  addPoints(n, showPopup = true) {
    this.points = (this.points || 0) + n;
    this.totalEarned = (this.totalEarned || 0) + n;
    if (showPopup) this.hud.popup(`+$${n}`, '#ffcf5a');
  }
  spendPoints(n) {
    this.points = Math.max(0, (this.points || 0) - n);
  }
  /** 把强化卡/Perk 的效果应用到玩家与武器 */
  applyRunMods() {
    const m = this.runMods || {};
    const pl = this.player;
    if (!pl) return;
    pl.maxHp = 100 + (m.maxHp || 0);
    pl.hp = Math.min(pl.hp, pl.maxHp);
    pl.dmgMul = m.dmgTakenMul || 1;
    pl.moveMul = m.moveMul || 1;
    pl.regenDelay = m.regenDelay ?? 4;
    pl.regenRate = m.regenRate ?? 40;
    for (const s of pl.ws.slots) {
      // 首次调用时记录基础属性（必须是干净的原始值）
      if (!s.baseStats) s.baseStats = Object.assign({}, s.stats);
      const base = s.baseStats;
      const a = s.ascend || {};
      s.stats.dmgNear = base.dmgNear * (m.dmgMul || 1) * (a.dmgMul || 1);
      s.stats.dmgFar = base.dmgFar * (m.dmgMul || 1) * (a.dmgMul || 1);
      s.stats.rpm = base.rpm * (m.rpmMul || 1) * (a.rpmMul || 1);
      s.stats.headMul = base.headMul * (m.headMul || 1);
      s.stats.reload = base.reload * (a.reloadMul || 1);
      s.stats.pierce = (base.pierce || 0) + (m.pierce || 0) + (a.pierce || 0);
      s.stats.element = a.element || null;
      s.stats.mag = Math.round(base.mag * (m.magMul || 1) * (a.magMul || 1));
      s.stats.reserve = Math.round(base.reserve * (m.magMul || 1));
    }
  }

  /** 回合结束强化卡选择 UI */
  showCardSelect(cards, onPick) {
    this.menu.showCards(cards, onPick);
  }
  hideCardSelect() { this.menu.hideCards(); }
  showAscendSelect(opts, onPick) { this.menu.showAscend(opts, onPick); }
  hideAscendSelect() { this.menu.hideAscend(); }
  // 模式方法代理（经济系统直接调 game）
  buyPerk(id) { if (this.mode && this.mode.buyPerk) this.mode.buyPerk(id); }
  openAscend() { if (this.mode && this.mode.openAscend) this.mode.openAscend(); }
  async startGame(kind, cfg) {
    this.menu.showLoadingOverlay('正在部署…');
    await new Promise(r => setTimeout(r, 30));
    this.audio.init();
    this.clearWorld();
    this.renderPass.scene = this.scene; this.renderPass.camera = this.camera;
    this.vmPass.enabled = true;
    if (kind === 'mp') {
      this.loadMap(cfg.map);
      this.mode = new MPMatch(this, cfg);
    } else if (kind === 'zombies') {
      this.mode = new RoundMode(this, cfg);
    } else {
      this.loadMap('kaldash');
      this.mode = new Campaign(this, cfg);
    }
    this.mode.start();
    this.state = 'play'; this.paused = false; this.dead = false; this.ending = false;
    this.time = 0;
    this.hud.show(true);
    if (kind !== 'zombies') this.hud.hideModeUI();
    document.body.classList.toggle('zombie-mode', kind === 'zombies');
    // 预热编译
    this.renderer.compile(this.scene, this.camera);
    this.menu.hide();
    // 指针锁定提示：不自动显示，避免遮挡画面；未锁定时点击画面会自动请求锁定
    const ctp = document.getElementById('clickToPlay');
    ctp.classList.add('hidden');
    this.lock();
  }
  exitToMenu() {
    this.clearWorld();
    this.state = 'menu'; this.paused = false; this.dead = false;
    this.hud.show(false); this.hud.showScoreboard(false);
    this.hud.hideModeUI();
    document.body.classList.remove('zombie-mode');
    document.getElementById('deathScreen').classList.add('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    this.menu.showMain();
  }

  // ---------- 事件 ----------
  onKill(killer, victim, weapon, head, info) {
    if (this.mode && this.mode.onKill) this.mode.onKill(killer, victim, weapon, head, info || {});
  }
  makeNoise(pos, r, team, footstep = false) {
    this.noises.push({ pos: pos.clone(), r, team, t: this.time, footstep });
  }
  alertGroup(g, pos) { if (this.mode && this.mode.alertGroup) this.mode.alertGroup(g, pos); }
  addBot(bot) { this.bots.push(bot); this.entities.push(bot); return bot; }
  removeBot(bot) {
    bot.dispose();
    this.bots = this.bots.filter(b => b !== bot);
    this.entities = this.entities.filter(b => b !== bot);
  }
  spawnPickup(weaponId, att, pos, mag, reserve) {
    const info = buildGun(weaponId, att || {}, 'none', { low: true });
    const m = info.group;
    m.position.set(pos.x, (this.world ? this.world.groundHeight(pos.x, pos.z, pos.y + 1, 0.2) : 0) + 0.06, pos.z);
    m.rotation.set(0, Math.random() * 6, Math.PI / 2);
    this.scene.add(m);
    const p = { weaponId, att: att || {}, mesh: m, pos: m.position.clone(), mag, reserve, t: 0 };
    this.pickups.push(p);
    if (this.pickups.length > 14) { const o = this.pickups.shift(); this.scene.remove(o.mesh); }
    return p;
  }

  setThermal(on) {
    if (this.thermalOn === on) return;
    this.thermalOn = on;
    this.grade.uniforms.thermal.value = on ? 1 : 0;
    // 收集所有需要高亮的模型（士兵 + 僵尸 + 队友）
    const roots = [];
    for (const b of this.bots) if (b.model) roots.push(b.model.root);
    for (const z of (this.zombies || [])) if (z.model) roots.push(z.model.root);
    for (const t of (this.teammates || [])) if (t.model) roots.push(t.model.root);
    const seen = new Set();
    for (const root of roots) {
      root.traverse(o => {
        if (!o.isMesh || !o.material || !o.material.emissive) return;
        const m = o.material;
        if (seen.has(m)) return;      // 共享材质只处理一次
        seen.add(m);
        if (on) {
          if (m.userData.emBase === undefined) {
            m.userData.emBase = [m.emissive.getHex(), m.emissiveIntensity];
          }
          m.emissive.setHex(0xffffff);
          m.emissiveIntensity = 3;
        } else if (m.userData.emBase !== undefined) {
          m.emissive.setHex(m.userData.emBase[0]);
          m.emissiveIntensity = m.userData.emBase[1];
          delete m.userData.emBase;
        }
      });
    }
  }

  // ---------- 主循环 ----------
  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.state === 'play') {
      const inp = this.snapshotInput();
      // 商店/选卡打开时冻结游戏世界，但仍渲染画面
      const overlayOpen = (this.shop && this.shop.open) || (this.menu && this.menu.overlayOpen);
      if (!this.paused && !overlayOpen) this.update(dt, inp);
      this.renderPass.scene = this.scene; this.renderPass.camera = this.camera; this.vmPass.enabled = !!(this.player && this.player.alive);
    } else if (this.state === 'menu') {
      this.snapshotInput();
      this.menu.update(dt);
      this.renderPass.scene = this.menu.scene3d; this.renderPass.camera = this.menu.camera3d; this.vmPass.enabled = false;
      // 菜单里强制清掉所有战斗滤镜，避免残留
      this.grade.uniforms.nvg.value = 0; this.grade.uniforms.hurt.value = 0; this.grade.uniforms.thermal.value = 0; this.grade.uniforms.wp.value = 0;
      if (this.thermalOn) this.setThermal(false);
      this.scopeState = null; this.lowPowerOptic = null;
    }
    this.grade.uniforms.time.value = performance.now() * 0.001;
    this.composer.render(dt);
  }
  update(dt, inp) {
    this.time += dt;
    this.pathBudget = 3;
    if (this.noises.length) this.noises = this.noises.filter(n => this.time - n.t < 0.6);
    const pl = this.player;
    if (pl) {
      if (pl.alive) {
        pl.update(dt, inp);
      } else {
        // 死亡视角
        const cam = this.camera;
        cam.position.y = damp(cam.position.y, pl.pos.y + 0.4, 3, dt);
        const k = this.deathKiller;
        if (k && k.pos) { const tgt = k.pos.clone(); tgt.y += 1.2; const m = new THREE.Matrix4().lookAt(cam.position, tgt, new THREE.Vector3(0, 1, 0)); const q = new THREE.Quaternion().setFromRotationMatrix(m); cam.quaternion.slerp(q, 1 - Math.exp(-2 * dt)); }
        this.audio.setListener(cam.position, pl.yaw);
      }
      // NVG
      if (inp.nvgPressed && this.mode && this.mode.nvgAvailable) {
        this.nvg = !this.nvg;
        this.audio.tone(this.nvg ? 2400 : 1600, 0.15, 0.1, 'sine', null, this.nvg ? 1.5 : 0.6);
      }
      this.grade.uniforms.nvg.value = this.nvg && pl.alive && !this.scopeState ? 1 : 0;
      document.getElementById('nvgFrame').classList.toggle('hidden', !(this.nvg && pl.alive && !this.scopeState));
      this.renderer.toneMappingExposure = (this.world.env.exposure ?? 1) * (this.nvg ? 1.0 : 1);
      // 热成像只在"活着 + 正开热成像镜"时生效，其余情况一律关闭
      const thermalNow = pl.alive && this.scopeState === 'thermal';
      this.setThermal(thermalNow);
      if (!thermalNow) this.grade.uniforms.thermal.value = 0;
      this.grade.uniforms.hurt.value = pl.alive ? Math.max(0, 1 - pl.hp / pl.maxHp - 0.2) : 0.8;
    }
    for (const b of this.bots) b.update(dt);
    for (const p of this.projectiles) p.update(dt);
    if (this.projectiles.some(p => !p.alive)) this.projectiles = this.projectiles.filter(p => p.alive);
    // 拾取
    this.updatePickups(dt, inp);
    if (this.mode) this.mode.update(dt, inp);
    this.world.update(dt, this.time, this.camera.position);
    this.effects.update(dt, this.camera.position);
    this.hud.update(dt);
  }
  updatePickups(dt, inp) {
    const pl = this.player;
    let near = null, nd = 1.8;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      if (p.t > 30) { this.scene.remove(p.mesh); this.pickups.splice(i, 1); continue; }
      if (!pl || !pl.alive) continue;
      const d = Math.hypot(p.pos.x - pl.pos.x, p.pos.z - pl.pos.z);
      // 相同武器自动拾取弹药
      const slot = pl.ws.slots.find(s => s.id === p.weaponId);
      if (slot && d < 1.3) {
        const add = Math.max(5, Math.floor((p.reserve ?? slot.stats.mag) * 0.5 + (p.mag || 0)));
        if (slot.reserve < slot.stats.reserve * 2) { slot.reserve = Math.min(slot.stats.reserve * 2, slot.reserve + add); this.hud.popup('+弹药 ' + add, '#ccc'); this.audio.click(2200, 0.05, 0.3); this.scene.remove(p.mesh); this.pickups.splice(i, 1); continue; }
      }
      if (!slot && d < nd) { near = p; nd = d; }
    }
    this.nearPickup = near;
    if (this.mode && this.mode.interactPrompt) return;
    if (near && pl && pl.alive) {
      const def = near.weaponId;
      this.hud.prompt(`<b>F</b>拾取 ${buildName(def)}`);
      if (inp.interactPressed) {
        const ws = pl.ws;
        const cur = ws.w;
        const isSecondary = ['m1911', 'revolver', 'rpg'].includes(def);
        let idx = ws.cur;
        if (ws.slots.length > 1) idx = isSecondary ? 1 : 0;
        if (ws.slots[idx] && ws.slots[idx].stats.type === 'pistol' && !isSecondary && ws.cur === 0) idx = 0;
        const old = ws.slots[idx];
        if (old) this.spawnPickup(old.id, old.att, pl.pos, old.mag, old.reserve);
        const st = { id: def, att: near.att, camo: 'none' };
        ws.replaceSlot(idx, st, near.mag ?? undefined, near.reserve ?? undefined);
        this.scene.remove(near.mesh); this.pickups = this.pickups.filter(p => p !== near);
        this.audio.ui('equip');
      }
    } else if (!this.mode || !this.mode.interactPrompt) this.hud.prompt(null);
  }
}

import { WEAPONS } from './data.js';
function buildName(id) { return WEAPONS[id] ? WEAPONS[id].name : id; }

const game = new Game();
window.game = game;
game.init().catch(e => { console.error(e); document.getElementById('loadText').textContent = '初始化失败：' + e.message; });
