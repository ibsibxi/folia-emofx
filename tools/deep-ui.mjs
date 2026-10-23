// deep-ui.mjs —— 深挖面板里到底有什么
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
  const body = document.body.textContent || ''; // 用 textContent：innerText 会漏掉隐藏元素
  const marks = {
    autoGenre: body.includes('自动流派'),
    genre: body.includes('流派'),
    mountNo: /挂载 #/.test(body),
    bundleMissing: body.includes('UI 包还没准备好'),
    uiError: body.includes('UI 出错'),
    writeMsg: /已写入|等待中|写入失败|未检测到宿主/.test(body),
  };
  // 找挂载容器：Folia 给模组的容器通常是 panel 内一块 div
  const all = [...document.querySelectorAll('div')];
  const withCanvasParent = all.filter(d => d.querySelector(':scope > canvas') || (d.children.length === 1 && d.firstElementChild && d.firstElementChild.tagName === 'CANVAS'));
  const info = withCanvasParent.slice(0, 4).map(d => ({ cls: String(d.className).slice(0, 40), kids: d.children.length, w: Math.round(d.getBoundingClientRect().width) }));
  const own = ['.chips','.bands','.msg','.pickbtn','.gchip','.grid'].map(sel => ({ sel, n: document.querySelectorAll(sel).length }));
  const msgEl = document.querySelector('.msg');
  return JSON.stringify({ marks, own, msgText: msgEl ? (msgEl.textContent || '').slice(0,80) : null, canvasParents: info });
})()`);

console.log(out);
ws.close();
process.exit(0);
