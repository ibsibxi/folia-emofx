// diag-ui.mjs —— 找 UI 没渲染的原因
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
  const body = document.body.innerText || '';
  const errors = [];
  if (body.includes('UI 包还没准备好')) errors.push('bundle-missing');
  if (body.includes('UI 出错')) errors.push('ui-error');
  // 抓所有 "UI " 开头的提示文字
  const hints = [...document.querySelectorAll('div')]
    .filter(el => el.children.length === 0 && /UI|模组|出错|还没/.test(el.textContent || ''))
    .map(el => (el.textContent || '').trim().slice(0, 80)).filter(Boolean).slice(0, 8);
  // 当前可见的主要标题
  const heads = [...document.querySelectorAll('h1,h2,h3,span')]
    .filter(el => el.children.length === 0 && (el.textContent || '').trim().length > 1)
    .map(el => (el.textContent || '').trim()).slice(0, 15);
  return JSON.stringify({ errors, hints, heads, bodyLen: body.length, bodyHead: body.slice(0, 200) });
})()`);

console.log(out);
ws.close();
process.exit(0);
