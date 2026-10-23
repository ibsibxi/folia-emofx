// open-tab.mjs —— 点开「AI 情绪调音」标签，检查界面是否真的渲染出来
import http from 'node:http';
import WS from './ws-shim.mjs';

const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9222, path: p }, (r) => {
    let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => res(d));
  }).on('error', rej);
});

const list = JSON.parse(await get('/json/list'));
const page = list.find((t) => t.type === 'page');
const ws = new WS(page.webSocketDebuggerUrl);

const evaluate = (expr) => new Promise((resolve) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = (m) => {
    const j = JSON.parse(m);
    if (j.id !== id) return;
    ws.off('message', onMsg);
    resolve(j.result?.result?.value ?? j.result?.exceptionDetails?.text ?? null);
  };
  ws.on('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
});

await new Promise((r) => ws.on('open', r));

// 1) 点开标签
const clicked = await evaluate(`(() => {
  const label = [...document.querySelectorAll('span')].find(el =>
    el.children.length === 0 && (el.textContent || '').trim() === 'AI 情绪调音'
  );
  if (!label) return 'label-not-found';
  // 往上找可点击的祖先
  let el = label;
  for (let i = 0; i < 5 && el; i++) {
    if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'tab' || el.onclick) { el.click(); return 'clicked:' + el.tagName; }
    el = el.parentElement;
  }
  label.click();
  return 'clicked-span';
})()`);
console.log('点击结果:', clicked);

await new Promise((r) => setTimeout(r, 1200));

// 2) 看渲染结果
const report = await evaluate(`(() => {
  const body = document.body.innerText || '';
  const hasGenre = /流派/.test(body);
  const hasBand = /EQ|均衡|Hz/.test(body);
  const canvases = [...document.querySelectorAll('canvas')].map(c => c.width + 'x' + c.height);
  // 抓包含流派的那块区域文本
  let around = '';
  const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /流派/.test(e.textContent || ''));
  if (el) { let p = el; for (let i = 0; i < 6 && p; i++) p = p.parentElement; if (p) around = (p.innerText || '').slice(0, 300); }
  return JSON.stringify({ hasGenre, hasBand, canvases, around });
})()`);

console.log('渲染检查:', report);
ws.close();
process.exit(0);
