import { spawn } from 'node:child_process';
import http from 'node:http';
const port = 9222;
const res = await new Promise((r) => {
  http.get({ host: '127.0.0.1', port, path: '/json/list' }, (x) => { let d=''; x.on('data',c=>d+=c); x.on('end',()=>r(d)); }).on('error', () => r(null));
});
if (!res) { console.log('CDP 未开（需要 --remote-debugging-port）'); process.exit(0); }
try { const list = JSON.parse(res); list.forEach(t => console.log(' ', t.type, '|', t.title?.slice(0,40), '|', t.url?.slice(0,60))); } catch { console.log('解析失败'); }