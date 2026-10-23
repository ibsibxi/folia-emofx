// 纯 JS 版网易云 emofxnet 蒸馏权重推理（对齐 src/infer_numpy.py）
// 输入: features(64) + onehot_emotion(14) + onehot_genre(22) + base_extra(32) = 132
// 输出: 32 维，前 10 维 = 10 段 EQ 增益(dB)

import { readFileSync } from 'node:fs';

const W_PATH = 'D:/reverse/netease_ai_eq/data/model/distilled_weights.json';
export const BANDS_HZ = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EMO_N = 14;
const GENRE_N = 22;

export function loadModel(path = W_PATH) {
  const w = JSON.parse(readFileSync(path, 'utf8'));
  const m = w.meta;
  return {
    meta: m,
    xMean: Float32Array.from(m.x_mean),
    xStd: Float32Array.from(m.x_std),
    yMean: Float32Array.from(m.y_mean),
    yStd: Float32Array.from(m.y_std),
    layers: w.layers.map((l) => ({
      W: l.W, // [out][in]
      b: Float32Array.from(l.b),
      act: l.act,
    })),
  };
}

function matmul(x, layer) {
  const { W, b, act } = layer;
  // 权重按 [in][out] 存储（W.length = 输入维，W[0].length = 输出维）
  const nIn = W.length;
  const nOut = W[0].length;
  const out = new Float32Array(nOut);
  for (let o = 0; o < nOut; o++) out[o] = b[o];
  for (let i = 0; i < nIn; i++) {
    const xi = x[i];
    if (xi === 0) continue;
    const row = W[i];
    for (let o = 0; o < nOut; o++) out[o] += row[o] * xi;
  }
  if (act === 'tanh') for (let o = 0; o < nOut; o++) out[o] = Math.tanh(out[o]);
  return out;
}

/**
 * @param {ReturnType<typeof loadModel>} model
 * @param {Float32Array|number[]} features 64 维
 * @param {number} emotionIdx 0..13
 * @param {number} genreIdx 4..25
 * @param {Float32Array|number[]} [base] 32 维
 */
export function predict(model, features, emotionIdx, genreIdx, base = null) {
  if (features.length !== 64) throw new Error(`features 需要 64 维，实际 ${features.length}`);
  const g = genreIdx - 4;
  if (g < 0 || g >= GENRE_N) throw new Error(`genreIdx 应在 4..25，实际 ${genreIdx}`);

  const x = new Float32Array(132);
  for (let i = 0; i < 64; i++) x[i] = features[i];
  x[64 + emotionIdx] = 1;
  x[64 + EMO_N + g] = 1;
  if (base) for (let i = 0; i < 32; i++) x[64 + EMO_N + GENRE_N + i] = base[i];

  for (let i = 0; i < 132; i++) x[i] = (x[i] - model.xMean[i]) / model.xStd[i];

  let y = x;
  for (const layer of model.layers) y = matmul(y, layer);

  const out = new Float32Array(32);
  for (let i = 0; i < 32; i++) out[i] = y[i] * model.yStd[i] + model.yMean[i];
  return out;
}

export function bands(model, features, emotionIdx, genreIdx, base = null) {
  return Array.from(predict(model, features, emotionIdx, genreIdx, base).slice(0, 10));
}
