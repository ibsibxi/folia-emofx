// 扫描 app.asar，确认宿主是否已经存在「模组可用的音频效果 API」
import { readFileSync } from 'node:fs';

const buf = readFileSync('E:/Folia/resources/app.asar', 'utf8');

const pats = [
  'folium.audio',
  'audio.mix',
  'setEqualizer',
  'getEqualizer',
  'applyPreset',
  'registerEffect',
  'insertEffect',
  'audioNode',
  'equalizerNodesRef',
  'handleSetAudioEqualizerSettings',
  'openAudioEqualizer',
  'audioEqualizerSettings',
  'stores:{playback',
  'visualizerRegistry',
];

console.log('=== 命中统计 ===');
for (const p of pats) {
  const n = buf.split(p).length - 1;
  console.log(String(n).padStart(6), p);
}

console.log('\n=== folium 对象里都有哪些成员（找 createFolium 的返回） ===');
const idx = buf.indexOf('stores:Object.freeze(');
if (idx >= 0) console.log(buf.slice(idx - 400, idx + 260).replace(/\n/g, ' '));

console.log('\n=== 有没有任何 "audio" 挂在 folium 上 ===');
// 找 folium 对象构造：常见形态 { modId:..., host:..., registries:{...}, events:..., playback:..., ui:..., net:..., storage:... }
const m = buf.match(/modId:\w+,host:\w+[^}]{0,400}/g) || [];
for (const s of m.slice(0, 3)) console.log('•', s.slice(0, 400));
