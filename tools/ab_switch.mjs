// 把 A/B 两个 wav 拼成交替试听文件：6s 原声 → 6s 调音后 → 交替，方便一耳朵判断。
import { readFileSync, writeFileSync } from 'node:fs';

const read = (/** @type {string} */ p) => {
  const b = readFileSync(p);
  const dataLen = b.readUInt32LE(40);
  const n = dataLen / 4;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = b.readInt16LE(44 + i * 4) / 32768;
    R[i] = b.readInt16LE(46 + i * 4) / 32768;
  }
  return { L, R, sr: b.readUInt32LE(24) };
};

const A = read('dist/ab_before.wav');
const B = read('dist/ab_after.wav');
const sr = A.sr;
const SEG = 6 * sr;
const XF = Math.floor(0.25 * sr);
const START = 20 * sr; // 跳过前奏

/** @type {number[]} */
const outL = [];
/** @type {number[]} */
const outR = [];
let cursor = START;
for (let k = 0; k < 6; k++) {
  const src = k % 2 === 0 ? A : B;
  for (let i = 0; i < SEG; i++) {
    const j = cursor + i;
    if (j >= A.L.length) break;
    let g = 1;
    if (i < XF) g = i / XF; // 段首淡入
    if (i > SEG - XF) g = (SEG - i) / XF; // 段尾淡出
    outL.push(src.L[j] * g);
    outR.push(src.R[j] * g);
  }
  cursor += SEG;
}

const n = outL.length;
const data = Buffer.alloc(n * 4);
for (let i = 0; i < n; i++) {
  data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(outL[i] * 32767))), i * 4);
  data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(outR[i] * 32767))), i * 4 + 2);
}
const h = Buffer.alloc(44);
h.write('RIFF', 0);
h.writeUInt32LE(36 + data.length, 4);
h.write('WAVE', 8);
h.write('fmt ', 12);
h.writeUInt32LE(16, 16);
h.writeUInt16LE(1, 20);
h.writeUInt16LE(2, 22);
h.writeUInt32LE(sr, 24);
h.writeUInt32LE(sr * 4, 28);
h.writeUInt16LE(4, 32);
h.writeUInt16LE(16, 34);
h.write('data', 36);
h.writeUInt32LE(data.length, 40);
writeFileSync('dist/ab_switch.wav', Buffer.concat([h, data]));
console.log(`交替试听：dist/ab_switch.wav  ${(n / sr).toFixed(1)}s（6s 原声 / 6s 调音后 × 3）`);
