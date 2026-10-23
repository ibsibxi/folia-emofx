// check-ui.mjs —— 确认 emofx 的界面真的挂进了 Folia 的 DOM
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
const evaluate = (expr) => new Promise((resolve) => {
  const id = Math.floor(Math.random() * 1e6);
  const onMsg = (m) => {
    const j = JSON.parse(m);
    if (j.id !== id) return;
    ws.off('message', onMsg);
    resolve(j.result?.result?.value ?? j.result?.exceptionDetails?.text ?? null);
  };
  ws.on('message', onMsg);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true, awaitPromise2: true } }));
});

await new Promise((r) => ws.on('open', r));

const out = await evaluate(`(() => {
  const text = document.body.innerText || '';
  const hasTab = text.includes('AI 情绪调音');
  // 找所有含模组名的元素
  const nodes = [...document.querySelectorAll('*')].filter(el =>
    el.children.length === 0 && (el.textContent || '').includes('AI 情绪调音')
  ).slice(0, 5).map(el => ({ tag: el.tagName, cls: String(el.className).slice(0, 40), text: el.textContent.slice(0, 30) }));
  return JSON.stringify({ hasTabLabel: hasTab, matches: nodes.length, nodes });
})()`);

console.log('UI 挂载情况:', out);
ws.close();
process.exit(0);
