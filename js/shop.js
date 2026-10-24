// 回合间军需站：购买入库 / 背包组装 / 补给 / Perk / 抽卡
import { WEAPONS, ATTACHMENTS, SLOT_NAMES, CAMOS, computeStats, attachmentAllowed, findAttachment } from './data.js';
import { ZPERKS, WALL_WEAPONS, drawCards, RARITY } from './mdata.js';
import { camoSwatch } from './materials.js';

// 配件价格
const SLOT_PRICE = { muzzle: 220, barrel: 320, laser: 180, optic: 380, stock: 200, under: 240, mag: 300, rear: 150 };
const MAX_ATT = 5;

export class Shop {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('shopLayer');
    this.tab = 'shop';
    this.slot = null;
    this.onClose = null;
    this.pickIndex = 0;      // 背包里正在组装的武器索引
    this._keyHandler = null;
    this._extraCards = null;
  }

  get open() { return this.el && !this.el.classList.contains('hidden'); }

  show(opts = {}) {
    if (!this.el) return;
    this.onClose = opts.onClose || null;
    this.tab = 'shop';
    this.slot = null;
    this.pickIndex = 0;
    this._extraCards = null;
    this.el.classList.remove('hidden');
    this.game.menu.overlayOpen = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.render();
    this._keyHandler = e => {
      if (e.code === 'Escape') { e.preventDefault(); this.close(); }
    };
    window.addEventListener('keydown', this._keyHandler);
    this.game.audio.ui('hover');
  }

  close() {
    if (!this.el) return;
    this.el.classList.add('hidden');
    this.el.innerHTML = '';
    this.game.menu.overlayOpen = false;
    if (this._keyHandler) { window.removeEventListener('keydown', this._keyHandler); this._keyHandler = null; }
    const cb = this.onClose; this.onClose = null;
    if (cb) cb();
  }

  // ================= 渲染入口 =================
  render() {
    const g = this.game, pl = g.player;
    if (!pl) return;
    const inv = g.inventory;
    const pts = g.points || 0;
    const sum = inv ? inv.summary() : { weapons: 0, parts: 0 };
    const tabs = [
      ['shop', '军需购买', '🛒'],
      ['stash', '背包仓库', '🎒'],
      ['supply', '补给', '📦'],
      ['perks', 'Perk', '❤'],
      ['cards', '抽卡', '🎴'],
    ];
    this.el.innerHTML = `
      <div class="shop">
        <div class="shop-head">
          <div class="shop-title">军 需 站</div>
          <div class="shop-sub">第 ${g.mode ? g.mode.round : 1} 回合结束 · 购买入库，背包组装</div>
          <div class="shop-bag">库存 ${sum.weapons} 枪 / ${sum.parts} 配件</div>
          <div class="shop-pts"><span class="d">$</span>${pts}</div>
        </div>
        <div class="shop-tabs">
          ${tabs.map(([id, name, icon]) => `<div class="shop-tab ${this.tab === id ? 'sel' : ''}" data-tab="${id}"><span class="i">${icon}</span>${name}</div>`).join('')}
        </div>
        <div class="shop-body" id="shopBody"></div>
        <div class="shop-foot">
          <div class="shop-hint">Esc 或点「跳过」直接进入下一回合</div>
          <button class="btn ghost" data-a="skip">跳过</button>
        </div>
      </div>`;

    this.el.querySelectorAll('[data-tab]').forEach(el => {
      el.addEventListener('click', () => { this.tab = el.dataset.tab; this.slot = null; this.game.audio.ui('click'); this.render(); });
    });
    this.el.querySelector('[data-a=skip]').addEventListener('click', () => this.close());

    const body = this.el.querySelector('#shopBody');
    if (this.tab === 'shop') this.renderShop(body);
    else if (this.tab === 'stash') this.renderStash(body);
    else if (this.tab === 'supply') this.renderSupply(body);
    else if (this.tab === 'perks') this.renderPerks(body);
    else if (this.tab === 'cards') this.renderCards(body);
  }

  // ================= 军需购买 =================
  renderShop(body) {
    const g = this.game, inv = g.inventory;
    const curId = g.player.ws.w ? g.player.ws.w.id : null;
    // 武器
    const weaponCards = WALL_WEAPONS.map(w => {
      const def = WEAPONS[w.id];
      const owned = inv.hasWeapon(w.id);
      const price = Math.round(w.price * (g.runMods.priceMul || 1));
      return `<div class="sh-card ${owned ? 'owned' : ''} ${g.points < price && !owned ? 'poor' : ''}" data-buyw="${w.id}" data-price="${price}">
        <div class="c-head"><b>${def.name}</b><span class="c-cls">${def.cls}</span></div>
        <div class="c-stats"><span>伤害 <b>${def.dmg[0]}</b></span><span>射速 <b>${def.rpm}</b></span><span>弹匣 <b>${def.mag}</b></span></div>
        <div class="c-price">${owned ? '已入库' : '$' + price}</div>
      </div>`;
    }).join('');

    // 配件（按槽位分组）
    const slotOrder = ['optic', 'muzzle', 'barrel', 'under', 'mag', 'stock', 'laser', 'rear'];
    const partGroups = slotOrder.map(slot => {
      const list = (ATTACHMENTS[slot] || []);
      if (!list.length) return '';
      const items = list.map(a => {
        const have = inv.partCount(a.id);
        const price = SLOT_PRICE[slot] || 250;
        return `<div class="sh-pcard ${have ? 'have' : ''} ${g.points < price && !have ? 'poor' : ''}" data-buyp="${a.id}" data-price="${price}">
          <div class="p-head"><b>${a.name}</b><span class="p-own">${have ? '×' + have : ''}</span></div>
          <div class="p-fx">${fxTags(a.fx)}</div>
          <div class="p-price">${have ? '已入库' : '$' + price}</div>
        </div>`;
      }).join('');
      return `<div class="p-group"><div class="p-slot">${SLOT_NAMES[slot] || slot}</div><div class="p-list">${items}</div></div>`;
    }).join('');

    body.innerHTML = `
      <div class="shop-sec">
        <div class="sec-title">武器</div>
        <div class="sh-cards">${weaponCards}</div>
      </div>
      <div class="shop-sec">
        <div class="sec-title">配件 <span class="sec-hint">买进仓库，到「背包仓库」装配</span></div>
        ${partGroups}
      </div>`;

    body.querySelectorAll('[data-buyw]').forEach(el => {
      el.addEventListener('click', () => this.buyWeapon(el.dataset.buyw, +el.dataset.price));
    });
    body.querySelectorAll('[data-buyp]').forEach(el => {
      el.addEventListener('click', () => this.buyPart(el.dataset.buyp, +el.dataset.price));
    });
  }

  buyWeapon(id, price) {
    const g = this.game, inv = g.inventory;
    if (inv.hasWeapon(id)) { g.hud.popup('已拥有该武器', '#9aa3ab'); return; }
    if (g.points < price) { g.audio.empty(); g.hud.popup('点数不足', '#ff6a5a'); return; }
    g.spendPoints(price);
    inv.addWeapon(id);
    g.audio.ui('equip');
    g.hud.popup(`${WEAPONS[id].name} 已入库`, '#9fe6ff', true);
    // 如果是第一把枪，自动装备
    if (inv.loadout.length === 0) {
      inv.equipWeapon(id);
      this.syncLoadout();
    }
    this.render();
  }

  buyPart(attId, price) {
    const g = this.game, inv = g.inventory;
    if (g.points < price) { g.audio.empty(); g.hud.popup('点数不足', '#ff6a5a'); return; }
    g.spendPoints(price);
    inv.addPart(attId, 1);
    g.audio.ui('equip');
    const a = this.findPart(attId);
    g.hud.popup(`${a ? a.name : attId} 已入库`, '#9fe6ff');
    this.render();
  }

  findPart(attId) {
    for (const s in ATTACHMENTS) {
      const a = ATTACHMENTS[s].find(x => x.id === attId);
      if (a) return a;
    }
    return null;
  }

  // ================= 背包仓库 =================
  renderStash(body) {
    const g = this.game, inv = g.inventory, pl = g.player;
    const loadout = inv.loadout;

    // 左：携带槽位
    const slotsHtml = [0, 1].map(i => {
      const w = loadout[i];
      if (!w) {
        return `<div class="st-slot empty ${this.pickIndex === i ? 'sel' : ''}" data-pick="${i}">
          <div class="ss-tag">槽位 ${i + 1}</div>
          <div class="ss-empty">空</div>
        </div>`;
      }
      const def = WEAPONS[w.id];
      const attN = Object.keys(w.att).length;
      return `<div class="st-slot ${this.pickIndex === i ? 'sel' : ''}" data-pick="${i}">
        <div class="ss-tag">槽位 ${i + 1}</div>
        <div class="ss-name">${def.name}</div>
        <div class="ss-sub">${def.cls} · 配件 ${attN}/${MAX_ATT}</div>
      </div>`;
    }).join('');

    // 仓库武器列表
    const stashWeapons = [...inv.weapons].map(id => {
      const equipped = loadout.some(w => w.id === id);
      const def = WEAPONS[id];
      return `<div class="st-w ${equipped ? 'eq' : ''}" data-w="${id}">
        <div class="w-n">${def.name}</div>
        <div class="w-c">${def.cls}</div>
        <div class="w-tag">${equipped ? '携带中' : '装备'}</div>
      </div>`;
    }).join('') || '<div class="shop-empty">仓库里还没有武器</div>';

    // 右侧：当前选中武器的组装面板
    const cur = loadout[this.pickIndex];
    let assembly = '<div class="shop-empty">先在左边选一把携带的武器</div>';
    if (cur) {
      const def = WEAPONS[cur.id];
      if (!this.slot) this.slot = def.slots[0];
      const slotTabs = def.slots.map(s => {
        const curAtt = cur.att[s] ? (findAttachment(s, cur.att[s]) || {}).name : null;
        return `<div class="as-slot ${s === this.slot ? 'sel' : ''}" data-aslot="${s}">
          <div class="k">${SLOT_NAMES[s] || s}</div>
          <div class="v ${curAtt ? '' : 'none'}">${curAtt || '空'}</div>
        </div>`;
      }).join('');
      const list = (ATTACHMENTS[this.slot] || []).filter(a => attachmentAllowed(cur.id, this.slot, a));
      const opts = list.map(a => {
        const equipped = cur.att[this.slot] === a.id;
        const avail = inv.availableParts(a.id, this.pickIndex);
        const inStash = inv.partCount(a.id);
        let state = 'ok', label = '装配';
        if (equipped) { state = 'on'; label = '已装配'; }
        else if (inStash === 0) { state = 'none'; label = '仓库无'; }
        else if (avail === 0) { state = 'used'; label = '已被占用'; }
        return `<div class="as-opt ${state}" data-opt="${a.id}">
          <div class="o-head"><b>${a.name}</b><span class="o-state">${label}${inStash ? ` (存 ${inStash})` : ''}</span></div>
          <div class="o-fx">${fxTags(a.fx)}</div>
        </div>`;
      }).join('') || '<div class="shop-empty">该栏位没有可用配件</div>';

      const stats = this.statBarsHtml(cur);

      assembly = `
        <div class="as-head">
          <div class="as-wn">${def.name}</div>
          <div class="as-wc">${def.cls}</div>
          <button class="btn ghost small" data-a="unequip">卸下</button>
        </div>
        <div class="as-slots">${slotTabs}</div>
        <div class="as-opts">${opts}</div>
        <div class="as-stats">${stats}</div>`;
    }

    body.innerHTML = `
      <div class="stash">
        <div class="st-left">
          <div class="sec-title">携带</div>
          ${slotsHtml}
          <div class="sec-title" style="margin-top:16px">仓库武器</div>
          <div class="st-wlist">${stashWeapons}</div>
        </div>
        <div class="st-right">${assembly}</div>
      </div>`;

    body.querySelectorAll('[data-pick]').forEach(el => {
      el.addEventListener('click', () => {
        this.pickIndex = +el.dataset.pick;
        this.slot = null;
        this.game.audio.ui('click');
        this.render();
      });
    });
    body.querySelectorAll('[data-w]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.w;
        const idx = loadout.findIndex(w => w.id === id);
        if (idx >= 0) { this.pickIndex = idx; }
        else {
          inv.equipWeapon(id, this.pickIndex < loadout.length ? this.pickIndex : null);
          this.syncLoadout();
        }
        this.slot = null;
        this.game.audio.ui('equip');
        this.render();
      });
    });
    body.querySelectorAll('[data-aslot]').forEach(el => {
      el.addEventListener('click', () => { this.slot = el.dataset.aslot; this.game.audio.ui('click'); this.render(); });
    });
    body.querySelectorAll('[data-opt]').forEach(el => {
      el.addEventListener('click', () => this.togglePart(el.dataset.opt, el.classList.contains('on')));
    });
    const un = body.querySelector('[data-a=unequip]');
    if (un) un.addEventListener('click', () => {
      inv.unequipWeapon(this.pickIndex);
      this.pickIndex = 0;
      this.syncLoadout();
      this.game.audio.ui('click');
      this.render();
    });
  }

  togglePart(attId, isOn) {
    const g = this.game, inv = g.inventory;
    if (isOn) {
      inv.detachPart(this.pickIndex, inv.slotOfPart(attId));
      this.syncLoadout();
      this.render();
      return;
    }
    const cur = inv.loadout[this.pickIndex];
    if (!cur) return;
    if (Object.keys(cur.att).length >= MAX_ATT && !cur.att[inv.slotOfPart(attId)]) {
      g.hud.popup(`最多装配 ${MAX_ATT} 个配件`, '#ff6a5a');
      g.audio.empty();
      return;
    }
    const r = inv.attachPart(this.pickIndex, attId);
    if (!r.ok) { g.audio.empty(); g.hud.popup(r.msg, '#ff6a5a'); return; }
    g.audio.ui('equip');
    this.syncLoadout();
    this.render();
  }

  /** 把背包配置同步到玩家的实际武器系统 */
  syncLoadout() {
    const g = this.game, inv = g.inventory, pl = g.player;
    if (!pl || !pl.ws) return;
    const list = inv.loadout.map(w => ({ id: w.id, att: Object.assign({}, w.att), camo: w.camo || 'none' }));
    if (!list.length) return;
    // 保留当前弹药
    const ammo = {};
    for (const s of pl.ws.slots) ammo[s.id] = { mag: s.mag, reserve: s.reserve, ascend: s.ascend, ascendLevel: s.ascendLevel };
    pl.ws.setLoadout(list);
    for (const s of pl.ws.slots) {
      const a = ammo[s.id];
      if (a) { s.mag = Math.min(a.mag ?? s.stats.mag, s.stats.mag); s.reserve = a.reserve ?? s.stats.reserve; s.ascend = a.ascend; s.ascendLevel = a.ascendLevel; }
      else { s.mag = s.stats.mag; s.reserve = s.stats.reserve; }
    }
    g.applyRunMods();
  }

  statBarsHtml(w) {
    const base = computeStats(w.id, {});
    const now = computeStats(w.id, w.att);
    // 叠加强化卡
    const m = this.game.runMods || {};
    const bars = [
      ['伤害', now.dmgNear * (m.dmgMul || 1), base.dmgNear, 1.6],
      ['射速', now.rpm * (m.rpmMul || 1), base.rpm, 1.6],
      ['射程', now.rangeFar, base.rangeFar, 1.6],
      ['弹匣', Math.round(now.mag * (m.magMul || 1)), base.mag, 2.2],
      ['操控', 10 / now.reload, 10 / base.reload, 1.8],
      ['稳定', 10 / (now.recoilV + now.recoilH * 0.5), 10 / (base.recoilV + base.recoilH * 0.5), 1.6],
    ];
    return bars.map(([name, v, b, k]) => {
      const pct = Math.max(6, Math.min(100, (v / (b * k)) * 100));
      const basePct = Math.max(6, Math.min(100, (b / (b * k)) * 100));
      const up = v > b * 1.01, down = v < b * 0.99;
      return `<div class="st-row">
        <div class="st-name">${name}</div>
        <div class="st-bar"><i class="st-base" style="width:${basePct}%"></i><i class="st-cur ${up ? 'up' : down ? 'down' : ''}" style="width:${pct}%"></i></div>
        <div class="st-val ${up ? 'up' : down ? 'down' : ''}">${Math.round(v * 10) / 10}</div>
      </div>`;
    }).join('');
  }

  // ================= 补给 =================
  renderSupply(body) {
    const g = this.game, pl = g.player;
    const w = pl.ws.w;
    const ammoPrice = Math.round((w ? w.stats.reserve * 1.2 : 300) * (g.runMods.priceMul || 1));
    const healPrice = Math.round(600 * (g.runMods.priceMul || 1));
    const hpPct = Math.round(pl.hp / pl.maxHp * 100);
    body.innerHTML = `
      <div class="sh-cards">
        <div class="sh-card" data-buy="ammo" data-price="${ammoPrice}">
          <div class="c-head"><b>全弹药补给</b><span class="c-cls">${w ? w.stats.name : '—'}</span></div>
          <div class="c-desc">补满当前武器弹匣与备弹</div>
          <div class="c-price">$${ammoPrice}</div>
        </div>
        <div class="sh-card" data-buy="ammoall" data-price="${ammoPrice * 2}">
          <div class="c-head"><b>全部武器弹药</b><span class="c-cls">所有槽位</span></div>
          <div class="c-desc">补满所有携带武器的弹药</div>
          <div class="c-price">$${ammoPrice * 2}</div>
        </div>
        <div class="sh-card ${hpPct >= 100 ? 'owned' : ''}" data-buy="heal" data-price="${healPrice}">
          <div class="c-head"><b>战地医疗</b><span class="c-cls">当前 ${hpPct}%</span></div>
          <div class="c-desc">立即回满生命值</div>
          <div class="c-price">${hpPct >= 100 ? '生命已满' : '$' + healPrice}</div>
        </div>
      </div>`;
    body.querySelectorAll('[data-buy]').forEach(el => {
      el.addEventListener('click', () => this.buySupply(el.dataset.buy, +el.dataset.price));
    });
  }

  buySupply(kind, price) {
    const g = this.game, pl = g.player;
    if (kind === 'heal' && pl.hp >= pl.maxHp) { g.hud.popup('生命已满', '#9aa3ab'); return; }
    if (g.points < price) { g.audio.empty(); g.hud.popup('点数不足', '#ff6a5a'); return; }
    g.spendPoints(price);
    if (kind === 'ammo' || kind === 'ammoall') { pl.ws.fullAmmo(); g.hud.popup('弹药已补满', '#ffd166'); }
    else if (kind === 'heal') { pl.hp = pl.maxHp; g.hud.popup('生命已回满', '#8fe06a'); }
    g.audio.ui('equip');
    this.render();
  }

  // ================= Perk =================
  renderPerks(body) {
    const g = this.game;
    const owned = g.perks || new Set();
    const items = ZPERKS.map(p => {
      const has = owned.has(p.id);
      const price = Math.round(p.price * (g.runMods.priceMul || 1));
      return `<div class="sh-card ${has ? 'owned' : ''} ${g.points < price && !has ? 'poor' : ''}" data-perk="${p.id}" data-price="${price}" style="--pc:${p.color}">
        <div class="c-head"><b style="color:${p.color}">${p.name}</b><span class="c-cls">${p.en}</span></div>
        <div class="c-desc">${p.desc}</div>
        <div class="c-price">${has ? '已拥有' : '$' + price}</div>
      </div>`;
    }).join('');
    body.innerHTML = `<div class="sh-cards">${items}</div>`;
    body.querySelectorAll('[data-perk]').forEach(el => {
      el.addEventListener('click', () => this.buyPerk(el.dataset.perk, +el.dataset.price));
    });
  }

  buyPerk(id, price) {
    const g = this.game;
    if ((g.perks || new Set()).has(id)) { g.hud.popup('已拥有该 Perk', '#9aa3ab'); return; }
    if (g.points < price) { g.audio.empty(); g.hud.popup('点数不足', '#ff6a5a'); return; }
    g.spendPoints(price);
    g.buyPerk(id);
    g.audio.ui('equip');
    const p = ZPERKS.find(x => x.id === id);
    g.hud.popup(`获得 Perk：${p.name}`, p.color, true);
    this.render();
  }

  // ================= 抽卡 =================
  renderCards(body) {
    const g = this.game;
    const price = Math.round(1200 * (g.runMods.priceMul || 1));
    let inner = '';
    if (this._extraCards) {
      inner = `<div class="sh-rhead">选择一张</div><div class="sh-cardrow">
        ${this._extraCards.map((c, i) => {
          const R = RARITY[c.rarity];
          return `<div class="sh-ucard" data-card="${i}" style="--rc:${R.color}">
            <div class="u-rar">${R.name}</div>
            <div class="u-icon">${c.icon}</div>
            <div class="u-name">${c.name}</div>
            <div class="u-desc">${c.desc}</div>
          </div>`;
        }).join('')}
      </div>`;
    } else {
      inner = `<div class="sh-cards">
        <div class="sh-card ${g.points < price ? 'poor' : ''}" data-buy="draw" data-price="${price}">
          <div class="c-head"><b>强化卡抽选</b><span class="c-cls">三选一</span></div>
          <div class="c-desc">额外抽一组强化卡，选一张永久生效。价格随次数递增。</div>
          <div class="c-price">$${price}</div>
        </div>
      </div>`;
    }
    body.innerHTML = inner;
    const drawBtn = body.querySelector('[data-buy=draw]');
    if (drawBtn) drawBtn.addEventListener('click', () => this.drawCards(price));
    body.querySelectorAll('[data-card]').forEach(el => {
      el.addEventListener('click', () => this.pickExtraCard(+el.dataset.card));
    });
  }

  drawCards(price) {
    const g = this.game;
    if (g.points < price) { g.audio.empty(); g.hud.popup('点数不足', '#ff6a5a'); return; }
    g.spendPoints(price);
    this._extraCards = drawCards(3, g.mode ? g.mode.round : 1);
    g.audio.tone(400, 0.4, 0.1, 'sine', null, 1.2);
    this.render();
  }

  pickExtraCard(i) {
    const g = this.game;
    const card = this._extraCards && this._extraCards[i];
    if (!card) return;
    g.mode.applyCard(card);
    g.hud.popup(`获得：${card.name}`, '#9fe6ff', true);
    g.audio.ui('equip');
    this._extraCards = null;
    this.render();
  }
}

function fxTags(fx) {
  const LABEL = {
    recoilV: ['后坐', -1], recoilH: ['水平', -1], ads: ['开镜', -1], range: ['射程', 1],
    mobility: ['机动', 1], mag: ['弹匣', 1], reload: ['换弹', -1], hip: ['腰射', -1], sprintFire: ['冲刺射击', -1],
  };
  const out = [];
  for (const k in fx) {
    const v = fx[k];
    if (!LABEL[k]) {
      if (k === 'suppressed') out.push('<span class="t good">消音</span>');
      else if (k === 'laser') out.push('<span class="t">激光</span>');
      else if (k === 'zoom') out.push(`<span class="t">${v}x</span>`);
      else if (k === 'flashHide') out.push('<span class="t good">消焰</span>');
      continue;
    }
    const [name, dir] = LABEL[k];
    const pct = Math.round((v - 1) * 100);
    if (!pct) continue;
    const good = pct * dir > 0;
    out.push(`<span class="t ${good ? 'good' : 'bad'}">${name} ${pct > 0 ? '+' : ''}${pct}%</span>`);
  }
  return out.join('') || '<span class="t">—</span>';
}
