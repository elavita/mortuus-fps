// 网页 FPS 鼠标输入方案
// 核心：Pointer Lock（瞄准）+ Fullscreen（抑制浏览器手势）
// 降级：不支持锁定时用"切换开镜"模式 + 普通鼠标移动
import { clamp } from './util.js';

/**
 * 统一管理指针锁定、全屏、开镜状态。
 *
 * 关键约束（按顺序，同一个用户点击回调内）：
 *   1. requestPointerLock({unadjustedMovement:true})  → 失败降级 requestPointerLock()
 *   2. requestFullscreen()
 * 不能 await 第一个再请求全屏，否则用户激活被消耗。
 */
export class MouseInput {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.isPointerLocked = false;
    this.isFullscreen = false;
    this.isAiming = false;
    this.adsMode = 'hold';            // 'hold' | 'toggle'
    this.toggleAiming = false;        // 切换模式下当前是否开镜
    this.lockSupported = typeof canvas.requestPointerLock === 'function';
    this.fsSupported = typeof document.documentElement.requestFullscreen === 'function';
    this.unadjustedSupported = true;  // 首次失败后置 false
    this.lastError = null;
    this.onStateChange = null;

    // 鼠标位移累积（未锁定时用降级方式累积）
    this.mdx = 0; this.mdy = 0;
    this._fallbackX = null; this._fallbackY = null;

    // 位移噪声过滤（指针锁定下 Windows Chrome/Edge 偶发巨大跳变）
    this._mf = { since: 0, avg: 0, strikes: 0, lastT: 0 };

    this._bind();
  }

  // ---------------- 事件绑定 ----------------
  _bind() {
    const cv = this.canvas;

    // 判断事件是否落在游戏区域（画布或"点击继续"遮罩），
    // 避免影响设置菜单、商店等 UI。
    const isGameArea = target => {
      if (!target) return false;
      if (target === cv) return true;
      const ctp = document.getElementById('clickToPlay');
      if (ctp && !ctp.classList.contains('hidden') && ctp.contains(target)) return true;
      // 全屏时画布铺满，指针锁定下 target 可能不是 canvas
      if (this.isPointerLocked) return true;
      return false;
    };

    // 1) 右键菜单 + 右键按下：在 window 的**捕获阶段**拦截，
    //    这样才能抢在鼠标手势扩展（它们也挂捕获阶段）之前吃掉事件。
    window.addEventListener('contextmenu', e => {
      if (!isGameArea(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }, true);

    window.addEventListener('mousedown', e => {
      if (e.button !== 2) return;
      if (!isGameArea(e.target)) return;
      this._rightDown = true;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }, { capture: true, passive: false });

    // 2) 右键拖动：手势扩展通常靠 mousemove + 右键状态识别轨迹。
    //    游戏区域内、右键按住期间，阻止事件冒泡到扩展。
    this._rightDown = false;
    window.addEventListener('mouseup', e => {
      if (e.button === 2) this._rightDown = false;
    }, true);

    // 2b) 其他可能被手势扩展利用的入口事件：游戏区域内右键时一并吃掉
    window.addEventListener('pointerdown', e => {
      if (e.button === 2 && isGameArea(e.target)) {
        e.stopPropagation();
        if (e.cancelable) e.preventDefault();
      }
    }, true);
    window.addEventListener('dragstart', e => {
      if (isGameArea(e.target)) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    window.addEventListener('selectstart', e => {
      if (isGameArea(e.target)) { e.preventDefault(); }
    }, true);
    window.addEventListener('auxclick', e => {
      if (e.button === 2 && isGameArea(e.target)) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    window.addEventListener('pointermove', e => {
      if (this._rightDown && isGameArea(e.target)) e.stopPropagation();
    }, true);

    // 3) 指针锁定期间，整个窗口都算游戏区域：拦截右键与拖动
    //    （锁定后鼠标不会真的移动，扩展也不该响应）
    // 4) 鼠标移动：锁定后用 movementX/Y；未锁定走降级
    window.addEventListener('mousemove', e => {
      if (this.isPointerLocked && this._rightDown) {
        // 锁定时吞掉冒泡，避免扩展拿到轨迹
        e.stopPropagation();
      }
      this._onMouseMove(e);
    }, true);

    // 5) 指针锁定状态
    document.addEventListener('pointerlockchange', () => this._onLockChange());
    document.addEventListener('pointerlockerror', () => this._onLockError());

    // 6) 全屏状态
    document.addEventListener('fullscreenchange', () => this._onFullscreenChange());
    document.addEventListener('fullscreenerror', () => {
      this.lastError = 'fullscreen';
      this._emit();
    });
  }

  _onMouseMove(e) {
    const g = this.game;
    if (this.isPointerLocked) {
      const now = performance.now();
      const MF = this._mf;
      if (now - MF.since < 120) return;      // 锁定刚生效，丢弃首帧跳变
      const dx = e.movementX || 0, dy = e.movementY || 0;
      const mag = Math.hypot(dx, dy);
      if (now - MF.lastT > 250) MF.avg = Math.min(MF.avg, 30);
      MF.lastT = now;
      const limit = Math.max(160, MF.avg * 7);
      if (mag > limit) {
        if (++MF.strikes < 3) return;        // 孤立跳变视为噪声
      } else MF.strikes = 0;
      MF.avg = MF.avg * 0.8 + Math.min(mag, limit) * 0.2;
      this.mdx += dx; this.mdy += dy;
      g.input.mdx += dx; g.input.mdy += dy;
    } else if (this.isAiming || this.adsMode === 'toggle') {
      // 降级：未锁定时用 clientX/Y 差值，仅用于开镜时的微调
      if (this._fallbackX !== null) {
        const dx = e.clientX - this._fallbackX;
        const dy = e.clientY - this._fallbackY;
        // 只在鼠标位于画布内才生效
        if (e.target === this.canvas) {
          g.input.mdx += dx * 0.8;
          g.input.mdy += dy * 0.8;
        }
      }
      this._fallbackX = e.clientX;
      this._fallbackY = e.clientY;
    }
  }

  _onLockChange() {
    const wasLocked = this.isPointerLocked;
    this.isPointerLocked = document.pointerLockElement === this.canvas;
    const MF = this._mf;
    MF.since = performance.now(); MF.avg = 0; MF.strikes = 0;
    this.game.input.mdx = 0; this.game.input.mdy = 0;

    if (this.isPointerLocked) {
      this.lastError = null;
      this._hideOverlay();
    } else {
      // 退出锁定：立即退出开镜
      this.forceExitAim();
      this.game.input.buttons = 0;
      if (wasLocked && this.game.state === 'play') {
        // 用户按 Esc 退出 → 暂停并显示"点击继续"
        this.game.onPointerUnlocked();
      }
    }
    this._emit();
  }

  _onLockError() {
    this.isPointerLocked = false;
    this.lastError = 'pointerlock';
    this.forceExitAim();
    this.game.onLockFailed();
    this._emit();
  }

  _onFullscreenChange() {
    this.isFullscreen = !!document.fullscreenElement;
    this._emit();
  }

  _emit() {
    if (this.onStateChange) {
      this.onStateChange({
        isPointerLocked: this.isPointerLocked,
        isFullscreen: this.isFullscreen,
        isAiming: this.isAiming,
        lastError: this.lastError,
      });
    }
  }

  // ---------------- 请求锁定 + 全屏 ----------------
  /**
   * 必须由真实用户点击触发。
   * 顺序：先 requestPointerLock，再 requestFullscreen（同一个调用栈内，不 await）。
   */
  requestLockAndFullscreen() {
    const cv = this.canvas;
    this.game.audio && this.game.audio.init();

    // --- 第一步：指针锁定 ---
    if (this.isPointerLocked) {
      // 已锁定，只补全屏
      this._requestFullscreen();
      return;
    }
    if (!this.lockSupported) {
      this.lastError = 'unsupported';
      this._emit();
      return;
    }

    // 超时兜底：某些环境（无头/被策略拦截）请求既不 resolve 也不触发 error
    const expectToken = (this._lockToken = (this._lockToken || 0) + 1);
    clearTimeout(this._lockTimer);
    this._lockTimer = setTimeout(() => {
      if (this._lockToken !== expectToken) return;
      if (this.isPointerLocked) return;
      this.lastError = 'pointerlock';
      this.forceExitAim();
      this.game.onLockFailed();
      this._emit();
    }, 1200);

    const doPlain = () => {
      try {
        const p = cv.requestPointerLock();
        if (p && p.catch) p.catch(() => { this.lastError = 'pointerlock'; this._emit(); });
      } catch (e) {
        this.lastError = 'pointerlock';
        this._emit();
      }
    };

    if (this.unadjustedSupported) {
      try {
        const p = cv.requestPointerLock({ unadjustedMovement: true });
        if (p && p.catch) {
          p.catch(err => {
            // NotSupportedError：浏览器不支持原始输入 → 永久降级
            if (err && (err.name === 'NotSupportedError' || err.name === 'TypeError')) {
              this.unadjustedSupported = false;
              doPlain();
            } else if (document.pointerLockElement !== cv) {
              // 其他失败（如用户快速连点）：再试一次普通模式
              doPlain();
            }
          });
        }
      } catch (e) {
        this.unadjustedSupported = false;
        doPlain();
      }
    } else {
      doPlain();
    }

    // --- 第二步：全屏（紧接着，不 await） ---
    this._requestFullscreen();
  }

  _requestFullscreen() {
    if (!this.fsSupported || document.fullscreenElement) return;
    try {
      const el = document.documentElement;
      const p = el.requestFullscreen({ navigationUI: 'hide' });
      if (p && p.catch) {
        p.catch(() => { this.lastError = 'fullscreen'; this._emit(); });
      }
    } catch (e) {
      this.lastError = 'fullscreen';
      this._emit();
    }
  }

  // ---------------- 开镜 ----------------
  setAdsMode(mode) {
    this.adsMode = mode === 'toggle' ? 'toggle' : 'hold';
    if (this.adsMode === 'hold') this.toggleAiming = false;
  }

  /** 右键按下 */
  onRightDown() {
    if (!this.isPointerLocked && this.adsMode === 'hold') {
      // 未锁定时不允许按住开镜（按需求：未锁定不得进入开镜）
      return false;
    }
    if (this.adsMode === 'toggle') {
      this.toggleAiming = !this.toggleAiming;
      this.isAiming = this.toggleAiming;
    } else {
      this.isAiming = true;
    }
    this._emit();
    return true;
  }

  /** 右键松开 */
  onRightUp() {
    if (this.adsMode === 'hold') {
      this.isAiming = false;
      this._emit();
    }
  }

  forceExitAim() {
    this.isAiming = false;
    this.toggleAiming = false;
    this._emit();
  }

  /** 当前是否应该处于开镜状态（交给武器系统） */
  get adsActive() {
    if (this.adsMode === 'toggle') return this.toggleAiming;
    return this.isAiming && this.isPointerLocked;
  }

  // ---------------- 释放 ----------------
  exitLock() {
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { }
  }
  exitFullscreen() {
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); } catch (e) { }
  }

  _hideOverlay() {
    const el = document.getElementById('clickToPlay');
    if (el) el.classList.add('hidden');
  }
}
