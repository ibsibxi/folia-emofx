// 打包 mod/emofx → dist/emofx-<version>.zip
// 手写 ZIP：条目名正斜杠、非入口模块加版本后缀（绕开宿主的 ESM 缓存）、产物可复现。
import { deflateRawSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const srcDir = join(root, 'mod', 'emofx');
const manifest = JSON.parse(readFileSync(join(srcDir, 'mod.json'), 'utf8'));
const outPath = join(root, 'dist', `emofx-${manifest.version}.zip`);

const walk = (/** @type {string} */ dir, /** @type {string[]} */ acc = []) => {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (st.isFile()) acc.push(p);
  }
  return acc;
};

const files = walk(srcDir)
  .map((p) => ({ p, name: relative(srcDir, p).split(sep).join('/') }))
  // src/ 只留在仓库里（build_ui 会把它拼成 cache 里的 ui.bundle.mjs）；
  // 打进包里会让「改 UI」也改变内容指纹，热更新就失效了。
  .filter((f) => !f.name.startsWith('src/'))
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

for (const key of ['main', 'client', 'preview']) {
  const rel = manifest[key];
  if (rel && !files.some((f) => f.name === rel)) {
    console.error(`[pack] 清单声明了 ${key}=${rel}，但目录里没有`);
    process.exit(1);
  }
}

const vshort = manifest.version.replace(/\./g, '_');
const entries = new Set([manifest.main, manifest.client].filter(Boolean));
const packedName = (/** @type {string} */ n) =>
  n.endsWith('.mjs') && !entries.has(n) ? n.replace(/\.mjs$/, `.${vshort}.mjs`) : n;

const table = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
const crc32 = (/** @type {Buffer} */ b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const locals = [];
const centrals = [];
let offset = 0;
const dosTime = 0;
const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

for (const f of files) {
  let raw = readFileSync(f.p);
  if (f.name.endsWith('.mjs')) {
    const src = raw
      .toString('utf8')
      .replace(/(from\s*['"])(\.{1,2}\/[^'"]*?)(\.mjs)(['"])/g, (_m, a, b, c, d) => `${a}${b}.${vshort}${c}${d}`);
    raw = Buffer.from(src, 'utf8');
  }
  const crc = crc32(raw);
  const deflated = deflateRawSync(raw, { level: 9 });
  const useDeflate = deflated.length < raw.length;
  const body = useDeflate ? deflated : raw;
  const method = useDeflate ? 8 : 0;
  const nameBuf = Buffer.from(packedName(f.name), 'utf8');

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0x0800, 6);
  lh.writeUInt16LE(method, 8);
  lh.writeUInt16LE(dosTime, 10);
  lh.writeUInt16LE(dosDate, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(body.length, 18);
  lh.writeUInt32LE(raw.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  lh.writeUInt16LE(0, 28);
  locals.push(lh, nameBuf, body);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(method, 10);
  ch.writeUInt16LE(dosTime, 12);
  ch.writeUInt16LE(dosDate, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(body.length, 20);
  ch.writeUInt32LE(raw.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt16LE(0, 30);
  ch.writeUInt16LE(0, 32);
  ch.writeUInt16LE(0, 34);
  ch.writeUInt16LE(0, 36);
  ch.writeUInt32LE(0o644 << 16, 38);
  ch.writeUInt32LE(offset, 42);
  centrals.push(ch, nameBuf);

  offset += lh.length + nameBuf.length + body.length;
}

const cd = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(cd.length, 12);
eocd.writeUInt32LE(offset, 16);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, Buffer.concat([...locals, cd, eocd]));

console.log(`[pack] ${manifest.id}@${manifest.version} → ${outPath}`);
console.log(`[pack] ${files.length} 个条目，${statSync(outPath).size} 字节`);
for (const f of files) console.log('   ', packedName(f.name));
