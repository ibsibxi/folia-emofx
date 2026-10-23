// UI v2：自绘下拉（不用原生 select）+ 逐帧缓动的曲线动画。
// 仍然只做显示与复制，不碰宿主音频。

import { BANDS_HZ, GENRES } from './data.mjs';
import { axesOf, curveFor, matchEmotion, matchGenre, emotionShape } from './classify.mjs';
import { shared, alive } from './live.mjs';
import { eqProbe, writeEq, probeNames, probeWithCover } from './eqwrite.mjs';
import { hasOfficialEqualizer, applyEqCurve, readEqState, releaseEqCurve, syncEqCurve, isOurCurveInPlace } from './eqofficial.mjs';

/** 模组 id，与 mod.json 一致；官方接口用它标识曲线归属。 */
const MOD_ID = 'emofx';

/**
 * 整个模组只跑一个 EQ 写入循环。
 *
 * Folia 会同时挂上多个视图（首页标签 + 播放页面板），每个 mountFx 原本各有一个
 * applyTimer。它们各自按自己的流派/情绪算曲线、各自计时节流，结果互相覆盖写入，
 * 宿主里的 EQ 来回跳变（实测 9 秒内 16 次写入，日志里曲线在两组值之间反复切换）。
 *
 * 现在只留一个循环：优先让正在显示的那个视图决定写什么；都不显示时沿用最后一个，
 * 这样面板关掉也照样跟歌调音。
 */
const eqWriters = { list: [], timer: null };

/**
 * 没有界面时也能自己跟歌调音的引擎状态。
 *
 * Folia 的标签页是「打开才挂载」的，所以视图里的逻辑在面板关掉后就完全停了 ——
 * 而模组的本意是「放歌就自动匹配 EQ」，不该要求用户一直开着面板。
 *
 * 面板打开过之后，视图会把学到的流派/情绪同步进这里；之后即使面板关掉，
 * 这个引擎仍按同一套规则算曲线、写宿主。默认值（流派 8、自动流派开、目标峰值 3.5 dB）
 * 与视图一致，所以从未打开过面板也能工作。
 */
const engine = {
  genre: 8,
  autoGenre: true,
  emo: 0,
  candIdx: -1,
  candCount: 0,
  lastAt: 0,
  lastKey: '',
};

/** 视图里的写入循环已经在跑时，引擎让位，避免两个写者互相覆盖。 */
export function autoTick(/** @type {any} */ folium) {
  if (eqWriters.list.length > 0) return;
  if (!hasOfficialEqualizer(folium)) return;
  if (!alive() || !shared.bands) return;

  const now = Date.now();
  if (now - engine.lastAt < 1100) return;

  const axes = axesOf(shared.bands);
  if (!axes) return;
  engine.emo = matchEmotion(axes).idx;

  if (engine.autoGenre) {
    const g = matchGenre(axes);
    if (g.margin >= 0.06 && g.idx !== engine.genre) {
      if (g.idx === engine.candIdx) engine.candCount++;
      else {
        engine.candIdx = g.idx;
        engine.candCount = 1;
      }
      // 与视图一样的防抖：同一候选连续两次才切。
      if (engine.candCount >= 2) {
        engine.genre = g.idx;
        engine.candCount = 0;
      }
    } else {
      engine.candIdx = -1;
      engine.candCount = 0;
    }
  }

  const raw = curveFor(engine.emo, engine.genre);
  let peak = 0;
  for (const v of raw) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0.05 ? Math.min(3, Math.max(0.8, 3.5 / peak)) : 1;
  const gains = raw.map((v) => Math.max(-12, Math.min(12, v * gain)));

  const key = gains.map((v) => v.toFixed(1)).join(',');
  engine.lastAt = now;
  if (key === engine.lastKey) return;

  const result = applyEqCurve(folium, gains);
  if (result.ok) engine.lastKey = key;
}

const CSS = `
.fx{--acc:#6d7cff;--accT:#e6e9ff;--bd:rgba(109,124,255,.55);--card:rgba(127,127,127,.08);--line:rgba(127,127,127,.18);
  display:flex;flex-direction:column;gap:9px;padding:12px 13px 16px;height:100%;box-sizing:border-box;overflow:auto;
  color:var(--folium-text,#e6e6e6);font:13px/1.45 system-ui,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;
  scrollbar-width:none;-ms-overflow-style:none}
.fx::-webkit-scrollbar{width:0;height:0;display:none}
.fx .card{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:9px 11px}
.fx .row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.fx .dim{opacity:.62;font-size:11.5px}
.fx button{font:inherit;color:inherit;background:rgba(127,127,127,.16);border:1px solid rgba(127,127,127,.28);
  border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;white-space:nowrap;transition:background .12s}
.fx button:hover{background:rgba(127,127,127,.28)}
.fx button.pri{background:var(--acc);border-color:transparent;color:#fff;font-weight:600}
.fx canvas{width:100%;height:132px;display:block;border-radius:9px;background:rgba(0,0,0,.28)}
.fx .chips{display:flex;gap:6px;flex-wrap:wrap;align-content:flex-start;min-height:44px}
.fx .chip.fixw{width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;display:inline-block}
.fx .chip{background:rgba(109,124,255,.2);border:1px solid var(--bd);color:var(--accT);border-radius:999px;padding:0 9px;font-size:11.5px}
.fx .bands{display:grid;grid-template-columns:repeat(10,1fr);gap:2px;text-align:center;font-size:10.5px}
.fx .bands b{display:block;font-size:12px;font-variant-numeric:tabular-nums}
.fx .msg{font-size:11.5px;opacity:.75;min-height:15px}

/* 流派：卡片内展开的中文胶囊 */
.fx .pickbtn{display:flex;align-items:center;gap:9px;width:112px}
.fx .pickbtn .lb{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.fx .pickbtn .car{opacity:.55;font-size:10px;transition:transform .15s}
.fx .grid{display:flex;flex-wrap:wrap;gap:5px;max-height:0;opacity:0;overflow:hidden;transition:max-height .18s ease,opacity .18s ease}
.fx .grid.open{max-height:180px;opacity:1}
.fx .gchip{font-size:12px;padding:4px 11px;border-radius:999px}
.fx .gchip.on{background:var(--acc);border-color:transparent;color:#fff;font-weight:600}
.fx .dditem .idx{opacity:.45;font-size:10.5px}
`;

export function mountFx(/** @type {HTMLElement} */ container, /** @type {any} */ ctx, /** @type {any} */ folium) {
  const el = (/** @type {string} */ t, /** @type {any} */ p = {}, /** @type {any[]} */ k = []) => {
    const n = document.createElement(t);
    for (const [a, v] of Object.entries(p)) {
      if (a === 'style') n.setAttribute('style', v);
      else if (a === 'text') n.textContent = String(v);
      else if (a === 'hidden') n.hidden = !!v;
      else if (a.startsWith('on') && typeof v === 'function') n.addEventListener(a.slice(2).toLowerCase(), v);
      else if (v !== undefined && v !== null) n.setAttribute(a, String(v));
    }
    for (const c of k) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  };

  const dot = el('span', { class: 'dim', text: '等待数据' });
  const chips = el('div', { class: 'chips' });
  const canvas = /** @type {HTMLCanvasElement} */ (el('canvas', { width: 800, height: 132 }));
  const bandsRow = el('div', { class: 'bands' });
  const msg = el('div', { class: 'msg', text: '' });

  // ---------- 流派选择：卡片内展开的中文胶囊（不用浮层，位置永远不会错） ----------
  let genre = 8;
  let pickOpen = false;
  const pickLabel = el('span', { class: 'lb', text: '' });
  const pickCar = el('span', { class: 'car', text: '▾' });
  const pickBtn = el('button', { class: 'pickbtn' }, [pickLabel, pickCar]);
  const pickGrid = el('div', { class: 'grid' });

  const genreName = (/** @type {number} */ idx) => GENRES.find((g) => g.idx === idx)?.name || String(idx);

  /** @type {Map<number, HTMLElement>} */
  const gridBtns = new Map();

  /** 只切换高亮，不重建 DOM（重建会让面板滚动位置和行高抖动） */
  const syncGrid = () => {
    for (const [idx, b] of gridBtns) b.classList.toggle('on', idx === genre);
  };

  for (const g of GENRES) {
    const b = el('button', { class: 'gchip', text: g.name });
    b.addEventListener('click', () => {
      genre = g.idx;
      autoGenre = false;
      autoBtn.textContent = '自动流派 · 关';
      autoBtn.classList.remove('pri');
      pickLabel.textContent = g.name;
      syncGrid();
      pickOpen = false;
      pickGrid.classList.remove('open');
      pickCar.style.transform = '';
      tick();
    });
    gridBtns.set(g.idx, b);
    pickGrid.append(b);
  }

  const togglePick = () => {
    pickOpen = !pickOpen;
    pickGrid.classList.toggle('open', pickOpen);
    pickCar.style.transform = pickOpen ? 'rotate(180deg)' : '';
  };
  pickBtn.addEventListener('click', togglePick);

  // 自动探测已关闭：实测拿不到 store（见对话结论），保留按钮手动触发

  // 自检：宿主打过注入补丁的话，这里能摸到 __foliumAudio；结果写进模组存储
  setTimeout(() => {
    try {
      const api = /** @type {any} */ (window).__foliumAudio;
      const rep = JSON.stringify({
        present: !!api,
        keys: api ? Object.keys(api) : [],
        gains: api && api.get ? api.get() : null,
      });
      folium?.storage?.set?.('apiProbe', rep)?.catch?.(() => {});
    } catch (e) {
      folium?.storage?.set?.('apiProbe', 'err: ' + String((e && e.message) || e))?.catch?.(() => {});
    }
  }, 1500);

  let autoGenre = true;
  // 目标峰值 dB：AI 原始曲线只有 ±1.7dB，按峰值自动定倍率，不写死百分比
  let targetPeak = 3.5;
  let gain = 1; // 实际倍率（每帧按曲线动态范围算出）
  const autoBtn = el('button', { text: '自动流派 · 开' });

  // 强度：AI 原始曲线只有 ±1.7 dB（听感太淡），这里做倍率放大
  const stLab = el('span', { class: 'mono dim', text: '3.5 dB' });
  const stRange = /** @type {HTMLInputElement} */ (
    el('input', { type: 'range', min: '1.5', max: '6', step: '0.5', value: '3.5', style: 'flex:1;min-width:80px;accent-color:#6d7cff' })
  );
  stRange.addEventListener('input', () => {
    targetPeak = Number(stRange.value);
    stLab.textContent = `${targetPeak.toFixed(1)} dB`;
    tick();
  });

  const root = el('div', { class: 'fx' }, [
    el('div', { class: 'card row' }, [dot, chips]),
    el('div', { class: 'card' }, [canvas]),
    el('div', { class: 'card' }, [
      el('div', { class: 'row' }, [el('span', { class: 'dim', text: '强度' }), stRange, stLab]),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'row' }, [el('span', { class: 'dim', text: '流派' }), pickBtn, autoBtn]),
      pickGrid,
    ]),
    el('div', { class: 'card' }, [bandsRow, msg]),
  ]);
  container.append(el('style', { text: CSS }), root);

  // 阻止指针事件冒泡到宿主面板：否则宿主会把这个点击当成面板级操作，导致整页重挂
  for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick']) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }

  // 诊断用：每次挂载 +1，若切换流派时这个数变了，说明是宿主在重挂我们
  const w0 = /** @type {any} */ (window);
  const mountNo = (w0.__emofxMount = (w0.__emofxMount || 0) + 1);
  msg.textContent = `挂载 #${mountNo}`;

  // ---------- 画布 ----------
  let w = 800;
  const h = 132;
  const padX = 12;
  const g2d = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const resize = (/** @type {{width:number,height:number}} */ s) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const nextW = Math.max(240, Math.floor(s.width));
    const pxW = Math.floor(nextW * dpr);
    const pxH = Math.floor(h * dpr);
    w = nextW;
    // 尺寸没变就别碰 canvas.width，否则画布会被清空、出现一帧闪白
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
      g2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  };
  if (ctx.onResize) ctx.onResize(resize);
  else resize({ width: 800, height: 132 });

  const xOf = (/** @type {number} */ i) => padX + (i * (w - padX * 2)) / 9;
  const yOf = (/** @type {number} */ db) => h / 2 - (Math.max(-12, Math.min(12, db)) / 12) * (h / 2 - 12);

  /** 目标曲线与显示曲线（显示曲线逐帧追赶目标） */
  let target = new Array(10).fill(0);
  let shown = new Array(10).fill(0);
  let emo = 0;
  let live = false;
  let genreConf = 0;

  const paint = () => {
    g2d.clearRect(0, 0, w, h);
    // 网格
    for (const db of [6, 0, -6]) {
      g2d.strokeStyle = db === 0 ? 'rgba(127,127,127,.32)' : 'rgba(127,127,127,.13)';
      g2d.beginPath();
      g2d.moveTo(0, yOf(db));
      g2d.lineTo(w, yOf(db));
      g2d.stroke();
    }
    // 面积
    g2d.beginPath();
    shown.forEach((db, i) => (i ? g2d.lineTo(xOf(i), yOf(db)) : g2d.moveTo(xOf(i), yOf(db))));
    g2d.lineTo(xOf(9), h / 2);
    g2d.lineTo(xOf(0), h / 2);
    g2d.closePath();
    g2d.fillStyle = 'rgba(52,211,153,.10)';
    g2d.fill();
    // 曲线
    g2d.beginPath();
    shown.forEach((db, i) => (i ? g2d.lineTo(xOf(i), yOf(db)) : g2d.moveTo(xOf(i), yOf(db))));
    g2d.strokeStyle = 'rgba(52,211,153,.95)';
    g2d.lineWidth = 2;
    g2d.stroke();
    // 点
    g2d.fillStyle = 'rgba(52,211,153,.95)';
    shown.forEach((db, i) => {
      g2d.beginPath();
      g2d.arc(xOf(i), yOf(db), 3, 0, Math.PI * 2);
      g2d.fill();
    });
  };

  // 10 个格子和两个 chip 只建一次，之后只改文字（重建 DOM 会让面板抖动）
  /** @type {HTMLElement[]} */
  const bandVals = [];
  BANDS_HZ.forEach((f) => {
    const b = el('b', { text: '0.0' });
    bandVals.push(b);
    bandsRow.append(
      el('div', {}, [
        el('span', { text: f >= 1000 ? `${f / 1000}k` : String(f), style: 'opacity:.45;font-size:9.5px' }),
        b,
      ])
    );
  });

  const chipEmo = el('span', { class: 'chip', text: '—' });
  // 固定宽度 + 单行省略：置信度数字位数变化不再推挤布局
  const chipGenre = el('span', { class: 'chip fixw', text: '—' });
  chips.append(chipEmo, chipGenre);

  const renderBands = () => {
    for (let i = 0; i < 10; i++) {
      const v = target[i] || 0;
      bandVals[i].textContent = `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
    }
  };

  let candIdx = -1;
  let candCount = 0;

  function tick() {
    live = alive();
    let ax = null;
    if (live && shared.bands) {
      ax = axesOf(shared.bands);
      emo = ax ? matchEmotion(ax).idx : 0;
      if (autoGenre && ax) {
        const g = matchGenre(ax);
        genreConf = g.score;
        // 防抖：同一个候选连续 2 次（约 600ms）才真正切，避免边缘抖动
        if (g.margin >= 0.06 && g.idx !== genre) {
          if (g.idx === candIdx) candCount++;
          else {
            candIdx = g.idx;
            candCount = 1;
          }
          if (candCount >= 2) {
            genre = g.idx;
            candCount = 0;
            pickLabel.textContent = genreName(genre);
            pickLabel.title = genreName(genre);
            syncGrid();
          }
        } else {
          candIdx = -1;
          candCount = 0;
        }
      }
    }
    // 按曲线自身的动态范围定倍率：把最大起伏拉到「目标峰值」，而不是写死百分比。
    // 平缓的曲线（±1 dB）自动放大，本来就狠的曲线（±3.5 dB）几乎不动。
    const raw = curveFor(emo, genre);
    let peak = 0;
    for (const v of raw) peak = Math.max(peak, Math.abs(v));
    gain = peak > 0.05 ? Math.min(3, Math.max(0.8, targetPeak / peak)) : 1;
    target = raw.map((v) => Math.max(-12, Math.min(12, v * gain)));
    dot.textContent = live ? '● 跟随中' : '○ 无频谱（在播放页放歌）';
    dot.style.color = live ? '#34d399' : '';
    stLab.textContent = `${targetPeak.toFixed(1)} dB · ×${gain.toFixed(1)}`;
    chipEmo.textContent = `情绪 ${emo} · ${emotionShape(emo)}`;
    chipGenre.textContent = autoGenre
      ? `流派 ${genreName(genre)}${genreConf ? ` · ${genreConf.toFixed(2)}` : ''}`
      : `流派 ${genreName(genre)} · 手动`;
    renderBands();
    // 把学到的流派/情绪同步给无界面引擎：面板关掉后由它继续跟歌调音。
    engine.genre = genre;
    engine.autoGenre = autoGenre;
    engine.emo = emo;
    applyToHost();
  }

  autoBtn.addEventListener('click', () => {
    autoGenre = !autoGenre;
    autoBtn.textContent = autoGenre ? '自动流派 · 开' : '自动流派 · 关';
    autoBtn.classList.toggle('pri', autoGenre);
    if (!autoGenre) genreConf = 0;
    tick();
  });
  autoBtn.classList.add('pri');

  /**
   * 这个视图现在还看得见吗。
   *
   * Folia 会把注册过的标签页都挂上（首页标签 + 播放页面板），切走后容器被隐藏。
   * 隐藏的那些如果继续跑，会有三个后果：
   *   · 各自按自己的流派/情绪算曲线，互相覆盖写入 → 宿主里的 EQ 来回跳变；
   *   · 每个视图都有自己的节流计时，合起来远超声明的「每秒 1 次」；
   *   · 白耗 CPU 画一张没人看的图。
   * 所以隐藏时既不画也不写。
   */
  const isVisible = () => {
    if (!container.isConnected) return false;
    const rect = container.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  };

  // ---------- 逐帧缓动 ----------
  let raf = 0;
  let last = performance.now();
  const frame = (/** @type {number} */ now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // 看不见就不画；缓动值也停住，切回来时从原处继续，不会跳。
    if (isVisible()) {
      const k = 1 - Math.exp(-dt / 0.16); // 时间常数 160ms：肉眼是连续滑动，不是跳变
      for (let i = 0; i < 10; i++) shown[i] += (target[i] - shown[i]) * k;
      paint();
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const timer = setInterval(tick, 300);

  /**
   * 解析可用的音频写入接口，兼容多种落地形态：
   *  1) 本机补丁版：window.__foliumAudio.set/get
   *  2) 上游稳定服务：folium.audio.mix.setEqualizer / folium.audio.setEqualizer
   *  3) 上游实验接口：folium.experimental['audio.mix'] / ['audio']
   */
  function resolveAudioApi() {
    const w = /** @type {any} */ (window);
    if (hasOfficialEqualizer(folium)) {
      return {
        via: 'official',
        // 返回 { ok, reason } 而不是抛错：限频 / 面板开着都是正常状态。
        set: (g) => applyEqCurve(folium, g),
        get: () => {
          const s = readEqState(folium);
          return s.ok ? s.state.gains : null;
        },
      };
    }
    try {
      if (w.__foliumAudio && typeof w.__foliumAudio.set === 'function') {
        return { via: 'patch', set: (g) => w.__foliumAudio.set(g), get: () => (w.__foliumAudio.get ? w.__foliumAudio.get() : null) };
      }
    } catch {}
    const candidates = [];
    try { candidates.push(folium?.audio?.mix, folium?.audio); } catch {}
    try { candidates.push(folium?.experimental?.['audio.mix'], folium?.experimental?.['audio']); } catch {}
    for (const c of candidates) {
      if (!c) continue;
      try {
        if (typeof c.setEqualizer === 'function') {
          return { via: 'api', set: (g) => c.setEqualizer(g), get: () => (typeof c.getEqualizer === 'function' ? c.getEqualizer() : null) };
        }
      } catch {}
    }
    return null;
  }

  // ---------- 自动写入 ----------

  // 宿主打过注入补丁时，直接写 10 段增益；没补丁就只在界面提示，不再让用户手动复制。
  let lastApplyKey = '';
  /** 用户手动点「应用」时置 true，允许覆盖自己之前的曲线（自动流程不覆盖）。 */
  let forceApply = false;
  /*
   * 写入节流：官方接口限「每秒 1 次、每分钟 20 次」，而 tick 每 300ms 跑一次。
   * 不在客户端拦住的话，每两三次 tick 就会撞一次限频 —— 虽然现在不会误报失败了，
   * 但会白白消耗每分钟 20 次的配额，用户手动改的时候反而可能被拒。
   * 这里按 1.1 秒的最小间隔放行（略大于官方 1 秒，留一点余量）。
   */
  const WRITE_MIN_INTERVAL_MS = 1100;
  let lastWriteAt = 0;
  const applyToHost = () => {
    const api = resolveAudioApi();
    if (!api) {
      msg.textContent = '未检测到宿主音频 API（本机补丁版或上游新版本才支持写入）';
      msg.style.color = '#fbbf24';
      return false;
    }
    const key = target.map((v) => v.toFixed(1)).join(',');
    let need = key !== lastApplyKey;
    if (!need && typeof api.get === 'function') {
      // 宿主一开面板就会按 store 回刷，这里比对一次，发现被刷回去就重写
      const cur = api.get();
      need = Array.isArray(cur) && cur.some((v, i) => Math.abs(v - target[i]) > 0.15);
    }
    /*
     * 用户优先：官方接口下，一旦曲线被换走（用户在音频效果器面板里改过，或别的模组接管），
     * 就不再抢回来 —— 文档明确要求此时让步。下面那些过渡形态做不到这一点，只在 official 时判。
     */
    if (api.via === 'official' && !forceApply && lastApplyKey === key) {
      const s = readEqState(folium);
      if (s.ok && !isOurCurveInPlace(folium, MOD_ID)) {
        msg.textContent = '已让步：用户改过音效，不再自动写入';
        msg.style.color = '#94a3b8';
        return false;
      }
    }
    // 节流：距上次写入不足最小间隔就跳过，下一个 tick 自然重试（曲线不会因此丢失）。
    if (api.via === 'official' && Date.now() - lastWriteAt < WRITE_MIN_INTERVAL_MS) return true;
    if (!need) return true;
    try {
      const writeResult = api.set(target);
      /*
       * 官方接口的拒绝要分开对待，不能一律报「失败」：
       *   · rate-limited —— 每秒最多 1 次、每分钟 20 次。tick 每 300ms 跑一次，
       *     所以每两三次就会撞上一次，这是正常节奏，不是错误；
       *   · panel-open —— 用户在音频效果器面板里，按文档要求必须让它。
       * 这两种都不写 lastApplyKey，下一个 tick 会自然重试。
       */
      if (writeResult && writeResult.ok === false) {
        const reason = String(writeResult.reason || '');
        if (reason === 'rate-limited' || reason === 'panel-open') {
          msg.textContent = reason === 'panel-open'
            ? '等待中：音频效果器面板开着'
            : '等待中：写入限频（每秒 1 次）';
          msg.style.color = '#94a3b8';
          return true;
        }
        if (reason.startsWith('equalizer-unavailable')) {
          msg.textContent = '官方接口不可用（需 Folia 0.7.22+）';
          msg.style.color = '#fbbf24';
          return false;
        }
        msg.textContent = '写入被拒绝：' + reason;
        msg.style.color = '#fca5a5';
        return false;
      }
      lastWriteAt = Date.now();
      lastApplyKey = key;
      try {
        folium?.storage?.set?.('autoWrite', JSON.stringify({ t: Date.now(), via: api.via, gains: target }))?.catch?.(() => {});
      } catch {}
      forceApply = false;
      msg.textContent = api.via === 'official'
        ? '已写入宿主 EQ（官方接口）'
        : api.via === 'patch' ? '已写入宿主 EQ（本机补丁）' : '已写入宿主 EQ（API）';
      msg.style.color = '#34d399';
      return true;
    } catch (e) {
      msg.textContent = '写入失败：' + String((e && e.message) || e);
      msg.style.color = '#fca5a5';
      return false;
    }
  };

  // 稳一笔：tick 改了曲线就写；另外每 1.5 秒自检一次，被宿主回刷就补写。
  // 写入函数交给模块级单循环统一驱动，见 eqWriters 的注释。
  applyToHost.isVisible = isVisible;
  eqWriters.list.push(applyToHost);
  if (!eqWriters.timer) {
    eqWriters.timer = setInterval(() => {
      if (eqWriters.list.length === 0) return;
      const visible = eqWriters.list.filter((fn) => fn.isVisible?.());
      const pick = visible[visible.length - 1] || eqWriters.list[eqWriters.list.length - 1];
      try {
        pick?.();
      } catch {}
    }, 1500);
  }

  pickLabel.textContent = genreName(genre);
  syncGrid();
  tick();
  shown = [...target];

  return () => {
    clearInterval(timer);
    cancelAnimationFrame(raf);
    const at = eqWriters.list.indexOf(applyToHost);
    if (at >= 0) eqWriters.list.splice(at, 1);
    if (eqWriters.list.length === 0 && eqWriters.timer) {
      clearInterval(eqWriters.timer);
      eqWriters.timer = null;
    }
    container.innerHTML = '';
  };
}