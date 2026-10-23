// 离线验证：把 AI 曲线的 10 段 EQ 真实渲染到一段音频上，产出 A/B 两个 wav。
// 用法: node tools/eq_render.mjs --in "x.mp3" --emo 7 --genre 4 --sec 60
//
// 产物:
//   dist/ab_before.wav  原声（同格式同电平）
//   dist/ab_after.wav   调音后
//   dist/ab_curve.svg   曲线图

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { bands, loadModel, BANDS_HZ } from './ai_model.mjs';

const FFMPEG = 'E:/ffmpeg/bin/ffmpeg.exe';
const SR = 48000;

const arg = (/** @type {string} */ k, /** @type {any} */ d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};

const inFile = arg('in', 'C:/Users/JXGM/Downloads/《千年之后》氛围版.mp3');
const emo = Number(arg('emo', 7));
const genre = Number(arg('genre', 4));
const sec = Number(arg('sec', 60));
const Q = Number(arg('q', 1.41));

mkdirSync('dist', { recursive: true });

// ---------- 1) 解码 ----------
const raw = 'dist/_in.f32';
execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', inFile, '-t', String(sec), '-ac', '2', '-ar', String(SR), '-f', 'f32le', raw], { stdio: 'ignore' });
const buf = readFileSync(raw);
const frames = buf.length / 8; // f32 立体声
const L = new Float32Array(frames);
const R = new Float32Array(frames);
for (let i = 0; i < frames; i++) {
  L[i] = buf.readFloatLE(i * 8);
  R[i] = buf.readFloatLE(i * 8 + 4);
}
console.log(`解码 ${frames} 帧 (${(frames / SR).toFixed(1)} s, ${SR} Hz 立体声)`);

// ---------- 2) 曲线 ----------
const model = loadModel();
const curve = bands(model, new Array(64).fill(0), emo, genre);
console.log('emo=' + emo + ' genre=' + genre);
console.log('曲线(dB):', curve.map((v) => v.toFixed(2)).join(', '));

// ---------- 3) biquad ----------
/** RBJ peaking */
function peaking(f0, gainDb, q, fs) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const cw = Math.cos(w0);
  const b0 = 1 + alpha * A;
  const b1 = -2 * cw;
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * cw;
  const a2 = 1 - alpha / A;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** 直接 I 型，返回新数组 */
function applyBands(/** @type {Float32Array} */ x, /** @type {number[]} */ gains) {
  let out = Float32Array.from(x);
  for (let b = 0; b < 10; b++) {
    if (Math.abs(gains[b]) < 0.05) continue;
    const c = peaking(BANDS_HZ[b], gains[b], Q, SR);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const y = new Float32Array(out.length);
    for (let i = 0; i < out.length; i++) {
      const v = out[i];
      const o = c.b0 * v + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = o;
      y[i] = o;
    }
    out = y;
  }
  return out;
}

// ---------- 4) 处理 + 电平对齐 ----------
const rms = (/** @type {Float32Array} */ a) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / a.length);
};
const rmsIn = Math.sqrt((rms(L) ** 2 + rms(R) ** 2) / 2);

let L2 = applyBands(L, curve);
let R2 = applyBands(R, curve);
const rmsOut = Math.sqrt((rms(L2) ** 2 + rms(R2) ** 2) / 2);

// 电平对齐：让 A/B 响度一致，只比较音色（否则「更响」会被误判成「更好听」）
const gain = rmsIn / (rmsOut || 1);
const gainDb = 20 * Math.log10(gain);
for (let i = 0; i < frames; i++) {
  L2[i] *= gain;
  R2[i] *= gain;
}

// 软限幅，避免削顶
let peak = 0;
for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(L2[i]), Math.abs(R2[i]));
if (peak > 0.98) {
  const k = 0.98 / peak;
  for (let i = 0; i < frames; i++) {
    L2[i] = Math.tanh(L2[i] * k);
    R2[i] = Math.tanh(R2[i] * k);
  }
}

console.log(`电平对齐增益 ${gainDb.toFixed(2)} dB（让 A/B 响度一致，只比音色）`);
console.log(`原始峰值 ${peak.toFixed(3)}`);

// ---------- 5) 写 wav ----------
function writeWav(/** @type {string} */ path, /** @type {Float32Array} */ l, /** @type {Float32Array} */ r) {
  const n = l.length;
  const data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l[i] * 32767))), i * 4);
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r[i] * 32767))), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

writeWav('dist/ab_before.wav', L, R);
writeWav('dist/ab_after.wav', L2, R2);

// ---------- 6) 曲线图 ----------
const W = 720, H = 260, padL = 46, padB = 28;
const xOf = (/** @type {number} */ i) => padL + (i * (W - padL - 16)) / 9;
const yOf = (/** @type {number} */ db) => H - padB - ((db + 12) / 24) * (H - padB - 18);
const pts = BANDS_HZ.map((f, i) => `${xOf(i).toFixed(1)},${yOf(curve[i]).toFixed(1)}`).join(' ');
const dots = BANDS_HZ.map((f, i) => `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(curve[i]).toFixed(1)}" r="3.5" fill="#34d399"/>`).join('');
const labels = BANDS_HZ.map((f, i) => `<text x="${xOf(i).toFixed(1)}" y="${H - 8}" font-size="10" fill="#888" text-anchor="middle">${f >= 1000 ? f / 1000 + 'k' : f}</text>`).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="100%" height="100%" fill="#0e0f13"/>
<line x1="${padL}" y1="${yOf(0)}" x2="${W - 16}" y2="${yOf(0)}" stroke="#333"/>
<line x1="${padL}" y1="${yOf(12)}" x2="${W - 16}" y2="${yOf(12)}" stroke="#222"/>
<line x1="${padL}" y1="${yOf(-12)}" x2="${W - 16}" y2="${yOf(-12)}" stroke="#222"/>
<text x="8" y="${yOf(12) + 4}" font-size="10" fill="#666">+12</text>
<text x="8" y="${yOf(0) + 4}" font-size="10" fill="#666">0</text>
<text x="8" y="${yOf(-12) + 4}" font-size="10" fill="#666">-12</text>
<polyline points="${pts}" fill="none" stroke="#34d399" stroke-width="2"/>
${dots}${labels}
<text x="${W - 16}" y="20" font-size="11" fill="#aaa" text-anchor="end">emo=${emo} genre=${genre}</text>
</svg>`;
writeFileSync('dist/ab_curve.svg', svg);

console.log('\n产物：dist/ab_before.wav  dist/ab_after.wav  dist/ab_curve.svg');
