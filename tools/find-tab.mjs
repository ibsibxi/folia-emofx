// find-tab.mjs —— 列出「AI 情绪调音」的所有候选元素及其属性，找真正的标签
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

const out = await evaluate(`(() => {
  const found = [...document.querySelectorAll('*')].filter(el =>
    (el.textContent || '').trim() === 'AI 情绪调音'
  );
  const rows = found.map((el, i) => {
    const r = el.getBoundingClientRect();
    let chain = [];
    let p = el;
    for (let k = 0; k < 4 && p; k++) { chain.push(p.tagName + (p.getAttribute('role') ? '[role=' + p.getAttribute('role') + ']' : '') + '.' + String(p.className || '').split(' ').slice(0,2).join('.')); p = p.parentElement; }
    return { i, tag: el.tagName, vis: r.width > 0 && r.height > 0, w: Math.round(r.width), h: Math.round(r.height), chain };
  });
  return JSON.stringify({ count: found.length, rows, url: location.hash });
})()`);

console.log(out);
ws.close();
process.exit(0);
