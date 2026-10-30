// 情绪判定 + 曲线查表。只用宿主给的 5 个频段能量（ctx.audio.getBands），
// 与逆向侧 classify.py 的思路一致：把「低/中/高」三轴做归一化后与情绪原型算余弦相似度。

import { EMOTIONS, CURVES, GENRE_AXES } from './data.mjs';

const unit = (/** @type {number[]} */ v) => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};

/** ctx.audio.getBands() → 三轴（低/中/高） */
export function axesOf(/** @type {any} */ b) {
  if (!b) return null;
  const bass = Number(b.bass) || 0;
  const mid = Number(b.mid) || 0;
  const lowMid = Number(b.lowMid) || 0;
  const vocal = Number(b.vocal) || 0;
  const treble = Number(b.treble) || 0;
  return [bass * 0.75 + lowMid * 0.25, mid * 0.5 + vocal * 0.5, treble];
}

/** 三轴 → 最接近的情绪索引 */
export function matchEmotion(/** @type {number[]} */ axes) {
  const q = unit(axes);
  let best = 0;
  let bestR = -2;
  for (const e of EMOTIONS) {
    // 模型的情绪 one-hot 只有 14 格（0..13）。14/15 是越界索引，
    // 曲线表里那两行来自越界路径，我们的模型复现不了（实测误差可到 3.4 dB）。
    if (e.idx > 13) continue;
    const p = unit([e.low, e.mid, e.high]);
    const r = q[0] * p[0] + q[1] * p[1] + q[2] * p[2];
    if (r > bestR) {
      bestR = r;
      best = e.idx;
    }
  }
  return { idx: best, score: bestR };
}

/** 情绪 + 流派 → 10 段 dB（表里没有就退回该流派的 avg） */
export function curveFor(/** @type {number} */ emo, /** @type {number} */ genre) {
  const row = CURVES[emo];
  if (row && row[genre]) return row[genre];
  for (let e = 0; e < CURVES.length; e++) {
    if (CURVES[e][genre]) return CURVES[e][genre];
  }
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

export function emotionShape(/** @type {number} */ idx) {
  const e = EMOTIONS.find((x) => x.idx === idx);
  return e ? e.shape : '未知';
}

/**
 * 自动流派：把当前音频的三轴形状与 22 个官方预设的形状做比较。
 * 关键细节：预设的三轴都是正数（低音增强/高音增强），直接算余弦会「什么都很像」，
 * 所以两边都先去均值（只比「形状」，不比「整体抬升」），再看第一名领先第二名多少。
 */
export function matchGenre(/** @type {number[]} */ axes) {
  const center = (/** @type {number[]} */ v) => {
    const m = (v[0] + v[1] + v[2]) / 3;
    return [v[0] - m, v[1] - m, v[2] - m];
  };
  const q = unit(center(axes));
  let best = 8;
  let bestR = -2;
  let second = -2;
  for (const g of GENRE_AXES) {
    const p = unit(center(g.axes));
    const r = q[0] * p[0] + q[1] * p[1] + q[2] * p[2];
    if (r > bestR) {
      second = bestR;
      bestR = r;
      best = g.idx;
    } else if (r > second) {
      second = r;
    }
  }
  return { idx: best, score: bestR, margin: bestR - second };
}
