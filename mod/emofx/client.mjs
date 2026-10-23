// client 入口：从 mods-cache 动态加载 UI 包（blob import），并每 2 秒检查一次版本。
// 变了就重新 import 并原地重挂——不用重启 Folia，也不用重新确认模组。
//
// 注意：本文件与 index.cjs 一起构成「不动的壳」，改动极少；日常迭代只改 cache 里的 ui.bundle.mjs。

const POLL_MS = 2000;

/** @param {any} folium */
export default function activate(folium) {
  /** @type {{mod:any, mtime:number}|null} */
  let loaded = null;
  /** @type {Set<{container:HTMLElement, ctx:any, host:HTMLElement, dispose:()=>void}>} */
  const views = new Set();
  let disposed = false;

  /** 从 cache 拉取并加载 UI 包 */
  async function pull() {
    const r = await folium.rpc.call('ui.get');
    if (!r || !r.ok) return { ok: false, reason: r?.reason || 'rpc-failed' };
    if (loaded && loaded.mtime === r.mtime) return { ok: true, changed: false };

    const url = URL.createObjectURL(new Blob([r.text], { type: 'text/javascript' }));
    try {
      const mod = await import(url);
      loaded = { mod, mtime: r.mtime };
      return { ok: true, changed: true };
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) };
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }

  /** 挂载一个视图（供不同入口复用） */
  function mountView(container, ctx) {
    container.innerHTML = '';
    const host = document.createElement('div');
    host.style.cssText = 'height:100%;display:flex;flex-direction:column;min-height:0';
    container.appendChild(host);

    const rec = { container, ctx, host, dispose: () => {} };
    views.add(rec);

    const paint = () => {
      try {
        rec.dispose?.();
      } catch {}
      host.innerHTML = '';
      if (!loaded) {
        host.innerHTML =
          '<div style="padding:16px;opacity:.7;font:13px system-ui">UI 包还没准备好（mods-cache 里没有 ui.bundle.mjs）</div>';
        return;
      }
      try {
        const d = loaded.mod.mount(host, ctx, folium);
        rec.dispose = typeof d === 'function' ? d : () => {};
      } catch (e) {
        host.innerHTML = `<div style="padding:16px;color:#fca5a5;font:12px system-ui">UI 出错：${String(
          (e && e.message) || e
        )}</div>`;
      }
    };
    rec.repaint = paint;
    paint();

    return () => {
      try {
        rec.dispose?.();
      } catch {}
      views.delete(rec);
      container.innerHTML = '';
    };
  }

  // stageLayer：把宿主频谱喂给 UI 包（同样走动态包，保证和 UI 同一份状态）
  folium.registries.stageLayers.register({
    id: 'analyzer',
    slot: 'player.stage.back',
    interactive: false,
    mount(container, ctx) {
      if (!ctx.audio) return;
      ctx.onFrame(() => {
        try {
          loaded?.mod.feed(ctx.audio.getBands(), ctx.audio.getPower());
          // 面板没开时由引擎自己算曲线并写入宿主 —— 模组不该要求用户一直开着面板。
          loaded?.mod.autoTick?.(folium);
        } catch {}
      });
      return () => {
        try {
          loaded?.mod.reset();
        } catch {}
      };
    },
  });

  const mount = (/** @type {HTMLElement} */ c, /** @type {any} */ ctx) => mountView(c, ctx);

  folium.registries.homeTabs.register({
    id: 'fx',
    label: { 'zh-CN': 'AI 情绪调音', en: 'AI Emo FX' },
    order: 330,
    mount,
  });
  folium.registries.playerPanelTabs.register({
    id: 'fx',
    label: { 'zh-CN': 'AI 情绪调音', en: 'AI Emo FX' },
    mount,
  });

  // 首次加载 + 轮询热更新
  const boot = async () => {
    const r = await pull();
    if (!r.ok) {
      folium.log?.warn?.('[emofx] ui bundle:', r.reason);
    }
    for (const v of views) v.repaint?.();
  };
  boot();

  const timer = setInterval(async () => {
    if (disposed) return;
    const r = await pull();
    if (r.ok && r.changed) {
      folium.log?.info?.('[emofx] hot-reloaded ui bundle');
      for (const v of views) v.repaint?.();
    }
  }, POLL_MS);

  const stop = () => {
    disposed = true;
    clearInterval(timer);
    for (const v of [...views]) {
      try {
        v.dispose?.();
      } catch {}
    }
    views.clear();
    loaded = null;
  };
  folium.onDispose?.(stop);
  folium.log?.info?.('[emofx] shell ready (hot reload every 2s)');
  return stop;
}
