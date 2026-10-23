// 生成改好的 foliumShared.json（新增 audio.control 权限）
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('E:/app develovpment/projects/09-folia-emofx/vendor/share.json', 'utf8');
const anchor = '        "render.export": { "guards": ["api.render.exportVideo"] },';
const count = src.split(anchor).length - 1;
if (count !== 1) throw new Error(`锚点出现 ${count} 次`);

const inserted = '        "audio.control": { "guards": ["folium.audioMix.setEqualizer"] },\n';
const out = src.replace(anchor, inserted + anchor);

// 校验仍然是合法 JSON
JSON.parse(out);

writeFileSync('E:/app develovpment/projects/09-folia-emofx/vendor/share.json.patched', out, 'utf8');
console.log('patched ok, 长度', src.length, '->', out.length);
