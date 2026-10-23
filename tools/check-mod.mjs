// check-mod.mjs —— 通过 CDP 检查 emofx 模组在 Folia 里的加载状态
import http from 'node:http';
import WS from './ws-shim.mjs';

const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9222, path: p }, (r) => {
    let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => res(d));
  }).on('error', rej);
});

const list = JSON.parse(await get('/json/list'));
const page = list.find((t) => t.type === 'page');
if (!page) { console.log('无页面'); process.exit(1); }

const ws = new WS(page.webSocketDebuggerUrl);
const send = (id, method, params) => ws.send(JSON.stringify({ id, method, params }));

const evaluate = (expr) => new Promise((resolve) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = (m) => {
    const j = JSON.parse(m);
    if (j.id !== id) return;
    ws.off('message', onMsg);
    resolve(j.result?.result?.value ?? j.result?.exceptionDetails?.text ?? null);
  };
  ws.on('message', onMsg);
  send(id, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
});

await new Promise((r) => ws.on('open', r));

const state = await evaluate(`(() => {
  const out = { hasFolium: typeof window.folium !== 'undefined' };
  // 找 Folia 暴露模组 API 的位置
  const globals = Object.keys(window).filter(k => /folium|folia|mods/i.test(k)).slice(0, 15);
  out.globals = globals;
  out.hasRequire = typeof window.require !== 'undefined';
  out.hasModRegistry = typeof window.__FOLIA_MODS__ !== 'undefined';
  try { out.runtimeConfig = JSON.parse(JSON.stringify(window.__FOLIA_RUNTIME_CONFIG__ || {})).constructor === Object ? Object.keys(window.__FOLIA_RUNTIME_CONFIG__).slice(0,20) : null; } catch(e) { out.runtimeConfig='err'; }
  try {
    out.foliumKeys = window.folium ? Object.keys(window.folium).slice(0, 20) : [];
    out.hostVersion = window.folium?.host?.app?.version ?? null;
    out.foliumMinor = window.folium?.host?.folium?.minor ?? null;
    out.hasEqualizer = Boolean(window.folium?.equalizer);
    out.eqMethods = window.folium?.equalizer
      ? ['getState','setMode','applyCurve','releaseCurve'].filter(k => typeof window.folium.equalizer[k] === 'function')
      : [];
    out.eqState = window.folium?.equalizer?.getState?.() ?? null;
  } catch (e) { out.err = String(e && e.message || e); }
  return JSON.stringify(out);
})()`);

console.log('Folium 状态:', state);
ws.close();
process.exit(0);
