// console-capture.mjs —— 重载页面并抓 [] 控制台输出，看模组自己说了什么
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

const logs = [];

ws.on('open', () => {
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
  ws.send(JSON.stringify({ id: 2, method: 'Log.enable' }));
  ws.send(JSON.stringify({ id: 3, method: 'Page.enable' }));
  setTimeout(() => ws.send(JSON.stringify({ id: 4, method: 'Page.reload', params: { ignoreCache: false } })), 300);
});

ws.on('message', (m) => {
  const j = JSON.parse(m);
  if (j.method === 'Runtime.consoleAPICalled') {
    const text = (j.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    if (/emofx|folium|mod|ui |equalizer/i.test(text)) logs.push(`[${j.params.type}] ${String(text).slice(0, 200)}`);
  }
  if (j.method === 'Log.entryAdded') {
    const e = j.params.entry;
    if (/emofx|equalizer|mod/i.test(e.text || '')) logs.push(`[log:${e.level}] ${String(e.text).slice(0, 200)}`);
  }
});

setTimeout(async () => {
  console.log('--- 模组相关日志 ---');
  if (logs.length === 0) console.log('（没有 emofx 相关输出）');
  logs.slice(0, 20).forEach((l) => console.log('  ' + l));
  ws.close();
  process.exit(0);
}, 9000);
