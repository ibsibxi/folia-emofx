// click-tab2.mjs —— 点播放页面板里的「AI 情绪调音」按钮，抓取挂载后的内容
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

const clicked = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(
    (el) => (el.textContent || '').trim() === 'AI 情绪调音'
  );
  if (!btn) return 'no-button';
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  return 'clicked';
})()`);
console.log('点击:', clicked);

await new Promise((r) => setTimeout(r, 1500));

const report = await evaluate(`(() => {
  const body = document.body.innerText || '';
  // 找刚挂上去的面板：含「流派 / 情绪 / EQ」字样的最近容器
  const hit = [...document.querySelectorAll('*')].find(
    (el) => el.children.length === 0 && /流派|情绪/.test(el.textContent || '')
  );
  let panelText = '';
  if (hit) { let p = hit; for (let i = 0; i < 8 && p; i++) p = p.parentElement; if (p) panelText = (p.innerText || '').slice(0, 400); }
  return JSON.stringify({
    hasError: body.includes('UI 包还没准备好') || body.includes('UI 出错'),
    foundKeyword: Boolean(hit),
    panelText,
    canvas: [...document.querySelectorAll('canvas')].map(c => c.width + 'x' + c.height),
  });
})()`);

console.log('面板内容:', report);
ws.close();
process.exit(0);
