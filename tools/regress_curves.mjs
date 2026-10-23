// 全量回归：蒸馏模型（JS）对 390 组（情绪×流派、特征=0）的曲线 vs 原始模型导出的曲线表
// 这一步就是"模型还需要完善吗"的硬答案。
import { readFileSync } from 'node:fs';
import { loadModel, bands } from './ai_model.mjs';

const table = JSON.parse(readFileSync('D:/reverse/netease_ai_eq/data/ai_curve_table.json', 'utf8'));
const curves = table.curves;
const model = loadModel();

const keys = Object.keys(curves).filter((k) => { const [e, g] = k.split('_').map(Number); return e <= 13 && g >= 4; });
const skipped = Object.keys(curves).length - keys.length;
console.log('跳过 genre<4 的组合: ' + skipped + '（模型不覆盖 0..3）');
let maxAbs = 0;
let sumAbs = 0;
let count = 0;
const worst = [];

for (const key of keys) {
  const [emo, genre] = key.split('_').map(Number);
  const ref = curves[key].bands;
  const zeros = new Array(64).fill(0);
  const base = new Array(32).fill(0);
  const got = bands(model, zeros, emo, genre, base);
  let err = 0;
  for (let i = 0; i < 10; i++) {
    const d = Math.abs(got[i] - ref[i]);
    if (d > err) err = d;
    sumAbs += d;
    count++;
  }
  if (err > maxAbs) maxAbs = err;
  worst.push({ key, err: +err.toFixed(3), ref, got: got.map((v) => +v.toFixed(2)) });
}

worst.sort((a, b) => b.err - a.err);
console.log(`组合数: ${keys.length}   数据点: ${count}`);
console.log(`平均绝对误差: ${(sumAbs / count).toFixed(4)} dB`);
console.log(`最大绝对误差: ${maxAbs.toFixed(4)} dB`);
console.log('\n最差 5 组:');
for (const w of worst.slice(0, 5)) {
  console.log(` ${w.key}  err=${w.err}`);
  console.log(`   ref ${JSON.stringify(w.ref)}`);
  console.log(`   got ${JSON.stringify(w.got)}`);
}
const over1 = worst.filter((w) => w.err > 1).length;
const over05 = worst.filter((w) => w.err > 0.5).length;
console.log(`\n误差 >0.5 dB 的组合: ${over05} / ${keys.length}`);
console.log(`误差 >1.0 dB 的组合: ${over1} / ${keys.length}`);
