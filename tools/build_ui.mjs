// 把 src 下的几个模块拼成一个自包含的 UI 包，写到模组的 cache 目录（不在内容指纹里）。
// 用法: node tools/build_ui.mjs
// 产物: %APPDATA%/Folia/mods-cache/emofx/ui.bundle.mjs

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'mod/emofx/src';
const ORDER = ['data.mjs', 'classify.mjs', 'live.mjs', 'eqwrite.mjs', 'eqofficial.mjs', 'ui.mjs'];
const OUT = join(process.env.APPDATA || '', 'Folia', 'mods-cache', 'emofx', 'ui.bundle.mjs');

/** 去掉 import 行与 `export ` 前缀，保留声明本身 */
const flatten = (/** @type {string} */ code) =>
  code
    .split('\n')
    .filter((l) => !/^\s*import\s/.test(l))
    .map((l) => l.replace(/^(\s*)export\s+(?=(const|let|function|class)\b)/, '$1'))
    .join('\n');

const parts = ORDER.map((f) => {
  const code = readFileSync(join(SRC, f), 'utf8');
  return `// ===== ${f} =====\n${flatten(code)}`;
});

const bundle = `${parts.join('\n\n')}

export { mountFx as mount, feed, reset, autoTick };
`;

mkdirSync(join(OUT, '..'), { recursive: true });
writeFileSync(OUT, bundle, 'utf8');
console.log('[build_ui] →', OUT);

// 同时往模组目录写一份内置副本：从 folium-compound 安装的模组没有 mods-cache，
// 只能靠目录里这份才能显示界面（见 index.cjs 的 bundledUiPath）。
const BUILT_IN = join(SRC, '..', 'ui.bundle.mjs');
writeFileSync(BUILT_IN, bundle, 'utf8');
console.log('[build_ui] →', BUILT_IN);
console.log('[build_ui]', (bundle.length / 1024).toFixed(1), 'KB,', statSync(OUT).mtimeMs.toFixed(0));
