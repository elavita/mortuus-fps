// 回合制僵尸模式：波次循环、点数、经济点位、升级卡
import * as THREE from 'three';
import { Player } from './player.js';
import { Zombie } from './zombies.js';
import { Teammate, SQUAD } from './teammates.js';
import { generateMap } from './bigmap.js';
import { Door, WallBuy, MysteryBox, PerkMachine, Altar } from './economy.js';
import { PointDrop, SupplyDrop } from './drops.js';
import { ROUND, POINTS, ZPERKS, drawCards, ASCEND, typeRoll, ZTYPES, WALL_WEAPONS } from './mdata.js';
import { WEAPONS } from './data.js';
import { rand, clamp, damp, pick } from './util.js';

const V = (x, z, y = 0) => new THREE.Vector3(x, y, z);
// 尸体在场上停留的时间（秒），之后淡出消失
const CORPSE_TIME = 12;

export class RoundMode {
  constructor(game, cfg) {
    this.game = game;
    this.cfg = cfg || {};
    this.seed = this.cfg.seed ?? Math.floor(Math.random() * 1e6);
    this.round = 0;
    this.state = 'idle';       // idle | spawning | fighting | intermission | cards | dead | ascend
    this.stateT = 0;
    this.toSpawn = 0;
    this.spawnedThisRound = 0;
    this.killedThisRound = 0;
    this.batchT = 0;
    this.interactables = [];
    this.doorsOpened = 0;
    this.cards = null;
    this.ascendOpts = null;
    this.interactPrompt = false;
    this.nvgAvailable = false;
    this.canChangeClass = false;
    this.over = false;
    this.startTime = 0;
    this.roundTime = 0;
    this.pendingSpawnQueue = [];
    this.spawnPoints = [];
    this.cardT = 0;
  }

  // ---------------- 启动 ----------------
  start() {
    const game = this.game;
    game.playerSleeve = 'fab_ally';

    // 生成地图
    const def = generateMap(this.seed);
    this.mapDef = def;
    game.loadMapFromDef(def);
    this.layout = def.layout;

    // 玩家状态容器（强化卡累加到这里）
    game.runMods = {
      dmgMul: 1, rpmMul: 1, magMul: 1, headMul: 1, pierce: 0, meleeMul: 1, meleePts: 1,
      maxHp: 0, dmgTakenMul: 1, regenDelay: 4, regenRate: 40, iframe: false, revives: 0,
      moveMul: 1, slideMul: 1, adsMul: 1, ptsMul: 1, priceMul: 1,
      refillEachRound: false, boxLuck: false,
    };
    game.points = 500;
    game.perks = new Set();
    game.zombies = [];
    game.teammates = [];
    game.chunks = [];
    game.drops = [];
    game.zombieId = 0;

    // 出生点
    const sr = this.layout.spawnRoom;
    const spawnPos = V(sr.cx, sr.cz, 0);
    this.spawnPos = spawnPos;
    // 确保出生点真的可站
    {
      const [ix, iz] = game.world.cellOf(spawnPos.x, spawnPos.z);
      if (!game.world.walkable(ix, iz)) {
        const p = game.world.randomWalkable(sr.cx, sr.cz, Math.min(sr.wx, sr.wz) * 0.4);
        spawnPos.copy(p);
        this.spawnPos = spawnPos;
      }
    }

    // 玩家
    const pl = game.player = new Player(game, { team: 'A', pos: spawnPos.clone(), yaw: 0, name: '你' });
    pl.maxHp = 100; pl.hp = 100;
    pl.equip({
      primary: { id: 'm1911', att: {}, camo: 'none' },
      secondary: null,
      lethal: 'frag', tactical: null, perks: [],
    });
    pl.ws.setLoadout([{ id: 'm1911', att: {}, camo: 'none' }]);
    game.entities.push(pl);

    // 初始化仓库：初始手枪入库并携带
    if (game.inventory) {
      game.inventory.reset();
      game.inventory.addWeapon('m1911');
      game.inventory.equipWeapon('m1911');
      // 送一个基础红点，让玩家一上来就能体验瞄具
      game.inventory.addPart('reddot', 1);
    }

    // 三名 AI 队友（散开站位，别贴着玩家）
    for (let i = 0; i < SQUAD.length; i++) {
      const t = new Teammate(game, SQUAD[i], i);
      const off = [[-3.4, 2.6], [3.4, 2.6], [0, 4.4]][i];
      t.pos.copy(spawnPos).add(V(off[0], off[1], 0));
      t.yaw = 0;
      t.model.root.position.copy(t.pos);
      game.teammates.push(t);
      game.entities.push(t);
    }

    // 经济点位
    this.placeEconomy();

    // 刷怪点（所有非出生房间）
    this.spawnPoints = this.layout.rooms
      .filter(r => r !== sr)
      .map(r => V(r.cx, r.cz, 0));

    game.hud.reset();
    game.hud.fade(1, 0);
    setTimeout(() => game.hud.fade(0, 2.0), 250);
    game.hud.announce('MORTUUS', '按 F 开门 · 撑过每一回合', 4.5);
    game.audio.loop('amb', 'wind', 0.05);
    this.startTime = game.time;
    this.nextRound();
  }

  // ---------------- 经济点位布置 ----------------
  placeEconomy() {
    const game = this.game;
    const L = this.layout;
    const rooms = L.rooms.slice().sort(() => Math.random() - 0.5);
    const sr = L.spawnRoom;

    // 门：直接用地图生成时记录的门洞位置
    const doorways = (L.doorways || []).slice();
    // 打乱，并排除离出生点太近的（避免一开局就被门围住）
    doorways.sort(() => Math.random() - 0.5);
    const spawnRoom = L.spawnRoom;
    const nearSpawn = d => Math.hypot(d.x - spawnRoom.cx, d.z - spawnRoom.cz) < 12;
    const usable = doorways.filter(d => !nearSpawn(d));
    const doorCount = Math.min(usable.length, 7);
    for (let i = 0; i < doorCount; i++) {
      const d = usable[i];
      const price = 750 + i * 250;
      const door = new Door(game, V(d.x, d.z, 0), d.horiz, 2.6, price);
      this.interactables.push(door);
    }

    // 墙上武器：4-6 个，贴在房间墙上
    const wcount = 5;
    for (let i = 0; i < wcount; i++) {
      const r = rooms[(i + 1) % rooms.length];
      if (r === sr) continue;
      // 贴墙：随机选一面
      const side = Math.floor(Math.random() * 4);
      let px, pz, yaw;
      const inset = 0.35;
      if (side === 0) { px = r.cx + rand(-r.wx / 3, r.wx / 3); pz = r.cz - r.wz / 2 + inset; yaw = 0; }
      else if (side === 1) { px = r.cx + rand(-r.wx / 3, r.wx / 3); pz = r.cz + r.wz / 2 - inset; yaw = Math.PI; }
      else if (side === 2) { px = r.cx - r.wx / 2 + inset; pz = r.cz + rand(-r.wz / 3, r.wz / 3); yaw = Math.PI / 2; }
      else { px = r.cx + r.wx / 2 - inset; pz = r.cz + rand(-r.wz / 3, r.wz / 3); yaw = -Math.PI / 2; }
      const ww = WALL_WEAPONS[Math.min(WALL_WEAPONS.length - 1, 1 + Math.floor(i * 1.2))];
      const wb = new WallBuy(game, V(px, pz, 0), yaw, ww.id);
      this.interactables.push(wb);
    }

    // Perk 机：3 台
    const perkPool = ZPERKS.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    for (let i = 0; i < perkPool.length; i++) {
      const r = rooms[(i + 2) % rooms.length];
      if (r === sr) continue;
      const px = r.cx + rand(-r.wx / 4, r.wx / 4);
      const pz = r.cz - r.wz / 2 + 0.7;
      const pm = new PerkMachine(game, V(px, pz, 0), 0, perkPool[i].id);
      this.interactables.push(pm);
    }

    // 神秘箱：放在死路房间
    const dead = L.deadEnds.length ? L.deadEnds : [rooms[rooms.length - 1]];
    const br = dead[Math.floor(Math.random() * dead.length)];
    this.box = new MysteryBox(game, V(br.cx, br.cz, 0));
    this.interactables.push(this.box);

    // 升格祭坛：离出生点最远的房间
    let far = rooms[0], farD = -1;
    for (const r of rooms) {
      const d = Math.hypot(r.cx - sr.cx, r.cz - sr.cz);
      if (d > farD) { farD = d; far = r; }
    }
    this.altar = new Altar(game, V(far.cx, far.cz, 0));
    this.interactables.push(this.altar);
  }

  // ---------------- 回合流程 ----------------
  nextRound() {
    const game = this.game;
    this.round++;
    this.roundTime = 0;
    this.toSpawn = ROUND.count(this.round);
    this.spawnedThisRound = 0;
    this.killedThisRound = 0;
    this.batchT = 0.6;
    this.state = 'spawning';
    this.stateT = 0;
    game.hud.announce(`第 ${this.round} 回合`, this.round === 1 ? '活下去' : `${this.toSpawn} 个目标`, 2.4);
    game.audio.tone(180, 0.8, 0.15, 'sine', null, 0.5);
    // 回合开始：队友复活（按队形分散，避免全叠在一点被分离力挤到墙角）
    for (let i = 0; i < game.teammates.length; i++) {
      const t = game.teammates[i];
      if (!t.alive || t.downed) {
        const off = [[-3.4, 2.6], [3.4, 2.6], [0, 4.4]][i % 3];
        const p = this.spawnPos.clone().add(V(off[0], off[1], 0));
        // 确保落点可走，否则退回出生点附近随机
        const [ix, iz] = game.world.cellOf(p.x, p.z);
        if (!game.world.walkable(ix, iz)) {
          const rp = game.world.randomWalkable(this.spawnPos.x, this.spawnPos.z, 6);
          p.copy(rp);
        }
        t.roundReset(p);
      }
    }
    if (game.runMods.refillEachRound) {
      game.player.ws.refill(1);
    }
    // 玩家小回血
    game.player.hp = Math.min(game.player.maxHp, game.player.hp + 25);
  }

  endRound() {
    const game = this.game;
    this.state = 'intermission';
    this.stateT = 0;
    const bonus = ROUND.bonus(this.round);
    game.addPoints(bonus, false);
    game.hud.announce(`第 ${this.round} 回合 完成`, `+$${bonus}`, 2.6);
    game.audio.tone(520, 0.5, 0.12, 'sine');
    setTimeout(() => game.audio.tone(780, 0.5, 0.12, 'sine'), 160);
    // 清掉残血僵尸
    for (const z of game.zombies) if (z.alive) z.die({ attacker: game.player, weapon: '回合结束' });
  }

  openCards() {
    const game = this.game;
    this.cards = drawCards(3, this.round);
    this.state = 'cards';
    game.showCardSelect(this.cards, (card) => {
      this.applyCard(card);
      this.cards = null;
      game.hideCardSelect();
      game.hud.popup(`获得：${card.name}`, '#9fe6ff', true);
      // 选完卡进入军需站
      this.state = 'shop';
      this.stateT = 0;
      setTimeout(() => this.openShop(), 420);
    });
  }

  openShop() {
    const game = this.game;
    if (!game.shop) return this.finishIntermission();
    // 打开商店：退出开镜、释放指针锁定，避免锁定状态下点不到 UI
    if (game.mouse) { game.mouse.forceExitAim(); game.mouse.exitLock(); }
    game.shop.show({
      onClose: () => this.finishIntermission(),
    });
  }

  finishIntermission() {
    const game = this.game;
    if (this.state === 'done') return;
    this.state = 'done';
    this.stateT = 0;
    game.hud.fade(0.7, 0.25);
    setTimeout(() => {
      game.hud.fade(0, 0.5);
      this.nextRound();
      // 回到战斗：提示点击继续（锁定需用户手势）
      game.showClickToPlay('点击继续');
    }, 380);
  }

  applyCard(card) {
    const game = this.game;
    const m = game.runMods;
    card.apply(m);
    if (card.id === 'hp1' || card.id === 'hp2') {
      game.player.maxHp = 100 + m.maxHp;
      game.player.hp = Math.min(game.player.maxHp, game.player.hp + (card.id === 'hp2' ? 60 : 30));
    }
    game.applyRunMods();
    // 弹匣扩容后补满
    if (card.id === 'mag1') {
      for (const s of game.player.ws.slots) s.mag = s.stats.mag;
    }
  }

  openAscend() {
    const game = this.game;
    const opts = ASCEND.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    this.ascendOpts = opts;
    this.state = 'ascend';
    game.showAscendSelect(opts, (opt) => {
      const pl = game.player;
      const slot = pl.ws.w;
      if (slot) {
        slot.ascend = slot.ascend || { dmgMul: 1, rpmMul: 1, magMul: 1, reloadMul: 1, pierce: 0, element: null };
        opt.apply(slot.ascend);
        if (opt.id === 'mag') {
          slot.stats.mag = Math.round(slot.stats.mag * 2);
          slot.mag = slot.stats.mag;
        }
        slot.ascendLevel = (slot.ascendLevel || 0) + 1;
        game.hud.popup(`武器升格：${opt.name}`, '#c56bff', true);
      }
      this.ascendOpts = null;
      this.state = 'intermission';
      this.stateT = 0;
      game.hideAscendSelect();
    });
  }

  buyPerk(perkId) {
    const game = this.game;
    game.perks.add(perkId);
    const pl = game.player;
    if (perkId === 'jug') { game.runMods.maxHp += 100; pl.maxHp = 100 + game.runMods.maxHp; pl.hp = pl.maxHp; }
    if (perkId === 'stamina') game.runMods.moveMul *= 1.14;
    game.applyRunMods();
  }

  // ---------------- 刷怪 ----------------
  spawnOne() {
    const game = this.game;
    const type = typeRoll(this.round);
    const T = ZTYPES[type];
    // 刷怪点：从「离玩家 12~28m」的房间里挑，避免刷在脸上也避免太远
    const pl = game.player;
    let cands = this.spawnPoints;
    if (pl) {
      const mid = this.spawnPoints.filter(sp => {
        const d = Math.hypot(sp.x - pl.pos.x, sp.z - pl.pos.z);
        return d > 10 && d < 30;
      });
      if (mid.length) cands = mid;
    }
    const best = cands[Math.floor(Math.random() * cands.length)];
    const pos = best.clone().add(V(rand(-2.2, 2.2), rand(-2.2, 2.2), 0));
    const [ix, iz] = game.world.cellOf(pos.x, pos.z);
    if (!game.world.walkable(ix, iz)) {
      const p = game.world.randomWalkable(best.x, best.z, 5);
      pos.copy(p);
    }
    const z = new Zombie(game, {
      type,
      pos,
      hp: ROUND.hp(this.round),
      speed: ROUND.speed(this.round),
      dmg: ROUND.dmg(this.round),
      spawning: true,
      target: game.player,
    });
    game.zombies.push(z);
    game.entities.push(z);
    this.spawnedThisRound++;
    this.toSpawn--;
  }

  // ---------------- 每帧 ----------------
  update(dt, inp) {
    const game = this.game;
    if (this.over) return;
    this.stateT += dt;

    // 僵尸更新：死亡僵尸也要更新（否则 deadT 不增长，倒地动画不播、尸体也不会消失）
    for (const z of game.zombies) z.update(dt);
    // 尸体清理：倒地停留 corpseTime 秒后淡出并移除
    for (let i = game.zombies.length - 1; i >= 0; i--) {
      const z = game.zombies[i];
      if (z.alive) continue;
      if (z.model.state.deadT > CORPSE_TIME) {
        z.dispose();
        game.zombies.splice(i, 1);
        game.entities = game.entities.filter(e => e !== z);
      }
    }
    // 碎块
    if (game.chunks && game.chunks.length) {
      game.chunks = game.chunks.filter(f => !f(dt));
    }
    // 掉落物
    if (game.drops && game.drops.length) {
      for (const d of game.drops) d.update(dt);
      game.drops = game.drops.filter(d => d.alive);
    }
    // 连杀计时：4 秒没击杀就重置
    if (this.streak > 0) {
      this.streakT = (this.streakT || 0) + dt;
      if (this.streakT > 4) { this.streak = 0; this.streakT = 0; }
    }
    // 队友
    for (const t of game.teammates) t.update(dt);

    // 经济点位动画
    for (const it of this.interactables) if (it.update) it.update(dt);

    // 交互检测
    this.updateInteract(inp);

    // 救援队友
    this.updateRevive(inp);

    // 状态机
    if (this.state === 'spawning' || this.state === 'fighting') {
      this.roundTime += dt;
      // 刷怪
      if (this.toSpawn > 0) {
        this.batchT -= dt;
        if (this.batchT <= 0) {
          const n = Math.min(this.toSpawn, ROUND.batch(this.round));
          for (let i = 0; i < n; i++) this.spawnOne();
          this.batchT = ROUND.batchGap(this.round);
        }
      }
      const alive = game.zombies.filter(z => z.alive).length;
      if (this.toSpawn <= 0 && alive === 0 && this.roundTime > 1.2) {
        this.endRound();
      }
    } else if (this.state === 'intermission') {
      if (this.stateT > 1.8 && !this.cards) this.openCards();
    }

    // 玩家死亡
    if (game.player && !game.player.alive && !this.deadHandled) this.onPlayerDeath();

    // HUD
    this.hudRound();
  }

  updateInteract(inp) {
    const game = this.game, pl = game.player;
    if (!pl || !pl.alive) { this.interactPrompt = false; game.hud.prompt(null); return; }
    let near = null, nd = 2.8;
    for (const it of this.interactables) {
      const d = it.distTo(pl.pos);
      if (d < nd) { near = it; nd = d; }
    }
    if (near) {
      this.interactPrompt = true;
      game.hud.prompt(near.prompt());
      if (inp.interactPressed) near.interact();
    } else {
      this.interactPrompt = false;
      game.hud.prompt(null);
    }
  }

  updateRevive(inp) {
    const game = this.game, pl = game.player;
    if (!pl || !pl.alive) return;
    let near = null, nd = 2.4;
    for (const t of game.teammates) {
      if (!t.downed) continue;
      const d = Math.hypot(t.pos.x - pl.pos.x, t.pos.z - pl.pos.z);
      if (d < nd) { near = t; nd = d; }
    }
    if (near) {
      if (inp.interact) {
        near.reviveProg += 0.55 * (1 / 60);
        game.hud.progress(clamp(near.reviveProg, 0, 1));
        if (near.reviveProg >= 1) { near.revive(); game.hud.progress(null); }
      } else {
        game.hud.progress(null);
        if (!this.interactPrompt) game.hud.prompt(`<b>按住 F</b> 救援 ${near.name}`);
      }
    } else {
      game.hud.progress(null);
    }
  }

  hudRound() {
    const game = this.game, pl = game.player;
    const alive = game.zombies.filter(z => z.alive).length;
    const remaining = alive + this.toSpawn;
    game.hud.roundInfo(this.round, remaining, game.points, this.state);
    // 队友状态
    game.hud.squadBar(game.teammates);
  }

  onKill(killer, victim, weapon, head, info) {
    const game = this.game;
    if (!victim || !victim.isZombie) return;
    // 玩家击杀给点数
    if (killer === game.player) {
      const base = head ? POINTS.headKill : (info && info.melee ? POINTS.meleeKill : POINTS.kill);
      const pts = Math.round(base * game.runMods.ptsMul * (victim.pointValue || 1));
      game.addPoints(pts, true);
      game.hud.popup(`+${pts}`, head ? '#ffd166' : '#9fe6ff');
      if (head) game.player.stats.headshots++;
      game.player.stats.kills++;
      game.hud.killfeed(killer, victim, weapon, head);
      // 连杀奖励：连杀数越多，额外点数越多
      this.streak = (this.streak || 0) + 1;
      this.streakT = 0;
      if (this.streak >= 3) {
        const bonus = Math.min(150, this.streak * 10);
        game.addPoints(bonus, false);
        game.hud.popup(`连杀 ×${this.streak}  +$${bonus}`, '#ff9a3c', true);
      }
    } else if (killer && killer.isTeammate) {
      game.hud.killfeed(killer, victim, weapon, head);
    }
    // 掉落点数（爆头掉得更多）
    this.dropPoints(victim, head, killer === game.player);
    this.killedThisRound++;
  }

  /** 僵尸死亡掉落点数 */
  dropPoints(victim, head, byPlayer) {
    const game = this.game;
    if (!game.drops) game.drops = [];
    // 掉落概率与数量
    let amount = 0;
    const r = Math.random();
    if (head) amount = 60 + Math.floor(Math.random() * 40);          // 爆头必掉 60-100
    else if (byPlayer) amount = r < 0.55 ? 20 + Math.floor(Math.random() * 25) : 0;
    else amount = r < 0.22 ? 15 + Math.floor(Math.random() * 15) : 0; // 队友击杀掉得少
    // 特殊敌人掉更多
    const pv = victim.pointValue || 1;
    if (pv > 1) amount = Math.round(amount * Math.min(3, pv));
    if (amount <= 0) return;
    // 拆成 1-3 个小球，视觉更爽
    const n = amount > 70 ? 3 : amount > 35 ? 2 : 1;
    const per = Math.max(5, Math.round(amount / n / 5) * 5);
    for (let i = 0; i < n; i++) {
      game.drops.push(new PointDrop(game, victim.pos, per));
    }
  }

  onPlayerDeath() {
    const game = this.game;
    this.deadHandled = true;
    this.over = true;
    game.ending = true;
    game.audio.say('你已阵亡');
    game.hud.announce('你已阵亡', `坚持到第 ${this.round} 回合`, 3);
    setTimeout(() => {
      if (document.pointerLockElement) document.exitPointerLock();
      game.menu.showResults({
        win: false,
        title: '你已阵亡',
        sub: `坚持到第 ${this.round} 回合`,
        stats: [
          ['到达回合', this.round],
          ['总击杀', game.player.stats.kills],
          ['爆头', game.player.stats.headshots],
          ['累计点数', game.totalEarned || 0],
          ['开门数', this.doorsOpened],
        ],
        again: () => game.startGame('zombies', { seed: Math.floor(Math.random() * 1e6) }),
      });
    }, 2200);
  }

  alertGroup() { }
  dispose() {
    const game = this.game;
    for (const it of this.interactables) it.dispose();
    this.interactables = [];
    for (const z of game.zombies) z.dispose();
    game.zombies = [];
    for (const t of game.teammates) t.dispose();
    game.teammates = [];
    game.hud.progress(null);
  }
}
