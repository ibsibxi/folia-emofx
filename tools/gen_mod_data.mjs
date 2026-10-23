// 从逆向数据生成模组内嵌数据：mod/emofx/src/data.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';

const SRC = 'D:/reverse/netease_ai_eq/data';
const readJson = (/** @type {string} */ p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const sem = readJson(`${SRC}/index_semantics.json`);
const tbl = readJson(`${SRC}/ai_curve_table.json`);

// 流派索引 → 名字（来自 docs 的 best-effort 映射）
const GENRE_NAMES = {
  4: '摇滚', 5: '金属', 6: '蓝调', 7: '乡村', 8: '流行', 9: '现场',
  10: '低音高音', 11: '抒情', 12: '中频', 13: '慢速', 14: '二次元',
  15: '国风', 16: '柔高音', 17: '嘻哈', 18: '电子', 19: '舞曲',
  20: '古典', 21: '爵士', 22: '低音', 23: '重低音', 24: '柔和', 25: '柔低音',
};
const GENRE_EN = {
  4: 'rock', 5: 'heavy_metal', 6: 'blues', 7: 'country', 8: 'pop', 9: 'live',
  10: 'bass_treble', 11: 'ballad', 12: 'mid', 13: 'downtempo', 14: 'acg',
  15: 'chinese', 16: 'soft_treble', 17: 'hiphop', 18: 'electronic', 19: 'dance',
  20: 'classical', 21: 'jazz', 22: 'bass', 23: 'strong_bass', 24: 'soft', 25: 'soft_bass',
};

// 16 x 26 的曲线网格（缺失为 null）
const rows = [];
for (let e = 0; e < 16; e++) {
  const row = [];
  for (let g = 0; g < 26; g++) {
    const k = `${e}_${g}`;
    const c = tbl.curves[k];
    row.push(c ? c.bands.map((v) => Math.round(v * 100) / 100) : null);
  }
  rows.push(row);
}

const emotions = sem.emotions.map((r) => ({
  idx: r.idx,
  low: Math.round(r.low * 1000) / 1000,
  mid: Math.round(r.mid * 1000) / 1000,
  high: Math.round(r.high * 1000) / 1000,
  shape: r.shape,
}));

const genres = sem.genres.map((r) => ({ idx: r.idx, name: GENRE_NAMES[r.idx] || ('g' + r.idx), en: GENRE_EN[r.idx] || '' }));
genres.sort((a, b) => a.idx - b.idx);

// 22 个官方预设的「低/中/高」三轴形状（用于自动流派匹配）
const presetAxes = {};
for (const file of readdirSync(`${SRC}/eq_presets`)) {
  if (!file.endsWith('.json')) continue;
  const name = file.replace(/\.json$/, '');
  const g = genres.find((x) => x.en === name);
  if (!g) continue;
  const p = readJson(`${SRC}/eq_presets/${file}`);
  const e = p.eqs;
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  presetAxes[g.idx] = [avg(e.slice(0, 3)), avg(e.slice(3, 7)), avg(e.slice(7, 10))].map(
    (v) => Math.round(v * 1000) / 1000
  );
}

const GENRE_AXES = genres
  .filter((g) => presetAxes[g.idx])
  .map((g) => ({ idx: g.idx, name: g.name, axes: presetAxes[g.idx] }));

const out = `// 自动生成，别手改。来源：netease emofxnet 390 条曲线 + index_semantics
export const BANDS_HZ = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EMOTIONS = ${JSON.stringify(emotions)};
export const GENRES = ${JSON.stringify(genres)};
export const CURVES = ${JSON.stringify(rows)};
export const GENRE_AXES = ${JSON.stringify(GENRE_AXES)};
`;

mkdirSync('mod/emofx/src', { recursive: true });
writeFileSync('mod/emofx/src/data.mjs', out);
console.log('data.mjs 已生成', (out.length / 1024).toFixed(1), 'KB；情绪', emotions.length, '流派', genres.length);
