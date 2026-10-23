// 在 Folia 的 app.asar 里按字节查找「QQ群 / 交流群 / 群号」等关键词，并打印上下文
import { readFileSync } from 'node:fs';

const buf = readFileSync('E:/Folia/resources/app.asar');

const needles = ['QQ群', '交流群', '群号', '官方群', '加入群', 'qq群', 'Tencent', 'tencent.com', 'txz.im', 'qun.qq.com'];
const seen = new Set();

for (const needle of needles) {
  const bytes = Buffer.from(needle, 'utf8');
  let from = 0;
  let hits = 0;
  while (hits < 5) {
    const idx = buf.indexOf(bytes, from);
    if (idx < 0) break;
    from = idx + bytes.length;
    hits++;
    // 取前后各 120 字节，转成可读文本
    const start = Math.max(0, idx - 120);
    const end = Math.min(buf.length, idx + 160);
    const text = buf.subarray(start, end).toString('utf8').replace(/[\u0000-\u001f]/g, ' ');
    if (seen.has(text.slice(0, 80))) continue;
    seen.add(text.slice(0, 80));
    console.log(`\n[${needle}] @${idx}`);
    console.log('  ' + text.slice(0, 280));
  }
}

// 顺带找找 5-10 位数字的 QQ 群号候选（带 qq / 群 上下文）
const text = buf.toString('latin1');
const re = /(qq|QQ|群)[^0-9]{0,12}([0-9]{6,11})/g;
let m;
let n = 0;
console.log('\n--- 群号候选 ---');
while ((m = re.exec(text)) && n < 12) {
  n++;
  const near = text.slice(Math.max(0, m.index - 40), m.index + 60).replace(/[^\x20-\x7e\u4e00-\u9fa5]/g, ' ');
  console.log(`  ${m[2]}   ← ${near.trim()}`);
}
if (n === 0) console.log('  没找到');
