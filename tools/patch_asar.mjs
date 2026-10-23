// 给已安装的 Folia 打一个「等长字节补丁」，把宿主音频图暴露成 window.__foliumFx
// 不改 asar 结构（文件长度完全不变），所以不需要重新打包。
//
// 用法：
//   node tools/patch_asar.mjs            # 试运行，只打印将替换的内容
//   node tools/patch_asar.mjs --apply    # 备份后写入
//   node tools/patch_asar.mjs --restore  # 从 .bak 还原

import { readFileSync, writeFileSync, existsSync, copyFileSync, statSync } from 'node:fs';

const ASAR = 'E:/Folia/resources/app.asar';
const BAK = ASAR + '.emofx.bak';
const MARK_END = '`),{gainNode:c';
const MARK_START = 'console.log(`[AudioContext] graph:';

const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--restore') ? 'restore' : 'dry';

if (mode === 'restore') {
  if (!existsSync(BAK)) {
    console.error('没有备份文件：', BAK);
    process.exit(1);
  }
  copyFileSync(BAK, ASAR);
  console.log('[restore] 已还原 app.asar，大小 =', statSync(ASAR).size);
  process.exit(0);
}

const buf = readFileSync(ASAR);
const s = buf.indexOf(MARK_START);
const e = buf.indexOf(MARK_END);
if (s < 0 || e < 0) {
  console.error('没找到补丁点（宿主版本可能变了）');
  process.exit(1);
}
const end = e + 1; // 包含结尾的 ')'
const original = buf.slice(s, end).toString('utf8');
const len = original.length;
console.log('补丁点 offset =', s, ' 长度 =', len, ' 字节');
console.log('原始片段：', original.slice(0, 120) + ' …');

// 注入的代码：把音频图对象挂到 window，供模组调用
const inject =
  'console.log("[AudioContext] graph ready"),' +
  'window.__foliumFx={ctx:e,ana:t,eq:r,fx:l,vol:c,fade:u,mix:a,eqOut:s,v:1}';

const pad = len - inject.length;
if (pad < 0) {
  console.error(`注入代码比原片段长 ${-pad} 字节，需要缩短：${inject.length} > ${len}`);
  process.exit(1);
}
const replacement = inject + ' '.repeat(pad);
if (replacement.length !== len) {
  console.error('长度不匹配');
  process.exit(1);
}

console.log('\n替换后（末尾空格数 =', pad, '）：');
console.log(replacement.slice(0, 200) + (pad > 60 ? ' …(空格)' : ''));

if (mode === 'dry') {
  console.log('\n[试运行] 未写入。加 --apply 生效。');
  process.exit(0);
}

if (!existsSync(BAK)) {
  copyFileSync(ASAR, BAK);
  console.log('[backup] 已备份 →', BAK);
}
const out = Buffer.from(buf);
out.write(replacement, s, 'utf8');
writeFileSync(ASAR, out);
console.log('[apply] 已写入，新大小 =', statSync(ASAR).size, '（应与原大小一致）');
