// 把 dev/src 下的几个模块拼成一个自包含的 UI 包，写到模组目录里。
// 用法: node tools/build_ui.mjs
// 产物: mod/emofx/ui.bundle.mjs   ← 随模组一起签名，运行时由 client.mjs 静态 import
//
// 说明：早期版本会把产物写到 mods-cache 并让 client 动态加载，用来做「改 UI 不用
// 重新确认」的热更新。那等于绕过签名与启用确认（审查通过的那份和实际跑的那份可以
// 不一致），已被安全审查要求删除。现在只有这一个输出位置，代码就在签名范围内。
// 需要热更新时请只在自己本地的开发构建里做，不要带进提交版本。

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const SRC = join(root, 'dev', 'src');
// 顺序即拼接顺序：被依赖的放前面。eqwrite.mjs 已删除（那份 fiber 扫描代码不再使用）。
const ORDER = ['data.mjs', 'classify.mjs', 'live.mjs', 'eqofficial.mjs', 'ui.mjs'];
const OUT = join(root, 'mod', 'emofx', 'ui.bundle.mjs');

/** 去掉 import 行与 `export ` 前缀，保留声明本身 */
const flatten = (/** @type {string} */ code) =>
  code
    .split('\n')
    .filter((l) => !/^\s*import\s/.test(l))
    .map((l) => l.replace(/^(\s*)export\s+(?=(const|let|function|class)\b)/, '$1'))
    .join('\n');

const parts = ORDER.map((file) => {
  const code = readFileSync(join(SRC, file), 'utf8');
  return `// ===== ${file} =====\n${flatten(code)}`;
});

const bundle = `${parts.join('\n\n')}

export { mountFx as mount, feed, reset, autoTick };
`;

writeFileSync(OUT, bundle, 'utf8');
console.log('[build_ui] →', OUT);
console.log('[build_ui]', (bundle.length / 1024).toFixed(1), 'KB');
