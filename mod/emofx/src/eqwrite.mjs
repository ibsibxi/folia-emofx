// 直接写 Folia 的 EQ 设置：从 React fiber 树里找到 settings store 的 setter 并调用。
// 不打开任何面板、不点任何宿主控件。
//
// 原理：EQ 弹窗那类组件用 `useStore(sel => sel.audioEqualizerSettings)` 取当前值，
// 用 `useStore(sel => sel.handleSetAudioEqualizerSettings)` 取 setter。这两个值都会
// 落在该组件 fiber 的 hook 链表里（useSyncExternalStore 的 memoizedState）。
// 于是：全局扫 fiber → 找到 hook 里带 customSlots/gains 的对象 → 同一 fiber 里
// 再找 length === 1 的函数（= 单参数 setter）→ 调用。

const FIBER_KEY = /^__react(Fiber|InternalInstance|Container)\$/;

/** 收集页面里所有 React 根 fiber */
export function roots() {
  /** @type {Set<any>} */
  const out = new Set();
  for (const el of document.querySelectorAll('*')) {
    for (const k of Object.getOwnPropertyNames(el)) {
      if (!FIBER_KEY.test(k)) continue;
      let f = /** @type {any} */ (el)[k];
      // 往上爬到根
      let guard = 0;
      while (f && f.return && guard++ < 5000) f = f.return;
      if (f) out.add(f);
      break;
    }
  }
  return [...out];
}

/** 广度遍历 fiber 树 */
export function* walk(/** @type {any} */ root) {
  const stack = [root];
  let guard = 0;
  while (stack.length && guard++ < 200000) {
    const f = stack.pop();
    if (!f) continue;
    yield f;
    if (f.sibling) stack.push(f.sibling);
    if (f.child) stack.push(f.child);
  }
}

/** 判断一个值像不像 EQ 设置对象 */
function looksLikeEq(/** @type {any} */ v) {
  return (
    v &&
    typeof v === 'object' &&
    Array.isArray(v.gains) &&
    v.gains.length >= 5 &&
    Array.isArray(v.customSlots) &&
    typeof v.enabled === 'boolean'
  );
}

/**
 * 找到「持有 EQ 设置」的 fiber，以及同一组件里所有单参数函数（setter 候选）。
 */
export function findEq() {
  for (const r of roots()) {
    for (const f of walk(r)) {
      let h = f.memoizedState;
      let depth = 0;
      /** @type {any} */ let eqHook = null;
      /** @type {any[]} */ const fns = [];
      while (h && depth++ < 80) {
        const v = h.memoizedState;
        if (!eqHook && looksLikeEq(v)) eqHook = v;
        if (typeof v === 'function') fns.push(v);
        h = h.next;
      }
      if (eqHook) {
        return {
          fiber: f,
          settings: eqHook,
          setters: fns.filter((fn) => fn.length === 1),
          allFns: fns.map((fn) => ({ name: String(fn.name || '?'), arity: fn.length })),
        };
      }
    }
  }
  return null;
}

/** 只读报告：不写任何东西，用于确认能不能拿到 */
export function eqProbe() {
  const t0 = performance.now();
  const rootsArr = roots();
  const found = findEq();
  const ms = Math.round(performance.now() - t0);
  if (!found) {
    return JSON.stringify({ ok: false, roots: rootsArr.length, ms, reason: 'eq-settings-not-found' });
  }
  const s = found.settings;
  return JSON.stringify({
    ok: true,
    roots: rootsArr.length,
    ms,
    preset: s.preset,
    enabled: s.enabled,
    gains0: s.gains,
    customSlots: s.customSlots.map((x) => (x && Array.isArray(x.gains) ? x.gains.length : -1)),
    effectsKeys: s.effects ? Object.keys(s.effects) : null,
    setters: found.setters.length,
    fnList: found.allFns,
  });
}

/**
 * 写入：把 gains 应用到当前预设，同时存进「自定义 1」。
 * @param {number[]} gains 10 段 dB
 * @param {number} [slot] 自定义槽位下标（0 = 自定义 1）
 */
export function writeEq(gains, slot = 0) {
  const found = findEq();
  if (!found) return { ok: false, reason: 'eq-settings-not-found' };
  const cur = found.settings;
  const next = {
    ...cur,
    enabled: true,
    gains: [...gains],
    customSlots: cur.customSlots.map((s, i) => (i === slot ? { ...s, gains: [...gains] } : s)),
  };
  /** @type {string[]} */
  const tried = [];
  for (const fn of found.setters) {
    tried.push(String(fn.name || 'anon'));
    try {
      fn(next);
    } catch {}
  }
  return { ok: found.setters.length > 0, applied: found.setters.length, tried, before: cur.gains, after: next.gains };
}

/** 扫描全树，列出所有「名字像音频/效果器」的 hook 函数 —— 用来判断能不能直接摸到 store action */
export function probeNames() {
  /** @type {Map<string, number>} */
  const hits = new Map();
  let total = 0;
  let hooks = 0;
  for (const r of roots()) {
    for (const f of walk(r)) {
      let h = f.memoizedState;
      let d = 0;
      while (h && d++ < 80) {
        hooks++;
        const v = h.memoizedState;
        if (typeof v === 'function') {
          total++;
          const n = String(v.name || '');
          if (n && /equal|audio|effect|preset|mix/i.test(n)) hits.set(n, (hits.get(n) || 0) + 1);
        }
        h = h.next;
      }
    }
  }
  return JSON.stringify({ hooks, fns: total, hits: [...hits.entries()] });
}
/** 程序化切换宿主面板页签（不打开任何弹窗，只是让含 EQ 入口的组件挂载） */
function clickTabByText(/** @type {string} */ text) {
  const nodes = [...document.querySelectorAll('button,[role="tab"],span,div')];
  const hit = nodes.find((n) => (n.textContent || '').trim() === text && n.childElementCount <= 2);
  if (!hit) return false;
  const t = hit.closest('button,[role="tab"]') || hit;
  try {
    t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  } catch {
    return false;
  }
}

/**
 * 实验：切到「封面」页 → 扫描 → 切回。
 * 返回 { coverTab, eqEntry, names, eq } 供外部判断。
 */
export async function probeWithCover(/** @type {string} */ backTo) {
  const out = { coverTab: false, eqEntry: false, names: [], eq: null };
  out.coverTab = clickTabByText('封面');
  await new Promise((r) => setTimeout(r, 500));
  out.eqEntry = !!document.querySelector('[data-ponder="audio-equalizer"]');
  const seen = new Map();
  for (const r of roots()) {
    for (const f of walk(r)) {
      let h = f.memoizedState;
      let d = 0;
      while (h && d++ < 80) {
        const v = h.memoizedState;
        if (typeof v === 'function') {
          const n = String(v.name || '');
          if (n && /equal|audio|effect|preset/i.test(n)) seen.set(n, (seen.get(n) || 0) + 1);
        }
        h = h.next;
      }
    }
  }
  out.names = [...seen.entries()];
  const eq = findEq();
  out.eq = eq ? { preset: eq.settings.preset, setters: eq.setters.length } : null;
  clickTabByText(backTo);
  return JSON.stringify(out);
}