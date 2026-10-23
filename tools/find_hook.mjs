// 只读探测：在 app.asar 里定位宿主打印音频图的那行日志，并打印上下文，用于设计等长补丁。
// 用法: node tools/find_hook.mjs
import { readFileSync } from 'node:fs';

const ASAR = 'E:/Folia/resources/app.asar';
const NEEDLE = '[AudioContext] graph:';

const buf = readFileSync(ASAR);
console.log('asar size =', buf.length);

const needle = Buffer.from(NEEDLE, 'utf8');
let from = 0;
let hits = 0;
while (true) {
  const i = buf.indexOf(needle, from);
  if (i < 0) break;
  hits++;
  const start = Math.max(0, i - 260);
  const end = Math.min(buf.length, i + 520);
  const ctx = buf.slice(start, end).toString('utf8');
  console.log(`\n=== hit #${hits} @ ${i} ===`);
  console.log(ctx.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '.'));
  from = i + needle.length;
}
console.log(`\ntotal hits = ${hits}`);
