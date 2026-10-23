// 给已安装的 Folia 注入「模组可用的音频效果 API」，用于验证上游方案。
//
// 注入点：宿主音频图构造函数内部（唯一命中）。那里的局部变量：
//   e = AudioContext, t = analyser, r = equalizerNodesRef(10 段 biquad 的 ref),
//   l = effectChain, c = 音量增益, u = 淡入增益, a = mix 输入, s = equaliser 输出
//
// 暴露（这就是要提给上游的形状）：
//   window.__foliumAudio.get()        -> number[10]  当前各段增益(dB)
//   window.__foliumAudio.set(gains)   -> void        写入（内部 setTargetAtTime，τ=150ms 平滑）
//
// 用法：
//   node tools/inject_api.mjs            # 试运行
//   node tools/inject_api.mjs --apply    # 备份后写入
//   node tools/inject_api.mjs --restore  # 还原

import { readFileSync, writeFileSync, existsSync, copyFileSync, statSync } from 'node:fs';

const ASAR = 'E:/Folia/resources/app.asar';
const BAK = 'E:/Folia/resources/app.asar.emofx.bak';
const START = 'console.log(`[AudioContext] graph:';
const END_MARK = '`),{gainNode:c';

const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--restore') ? 'restore' : 'dry';

if (mode === 'restore') {
  if (!existsSync(BAK)) throw new Error('没有备份：' + BAK);
  copyFileSync(BAK, ASAR);
  console.log('[restore] 已还原，大小 =', statSync(ASAR).size);
  process.exit(0);
}

const buf = readFileSync(ASAR);
const s = buf.indexOf(START);
const eMark = buf.indexOf(END_MARK);
if (s < 0 || eMark < 0) throw new Error('找不到注入点（宿主版本变了？）');
const end = eMark + 2; // 关键：把结尾的 "`)" 一起吃掉，否则留下孤立括号 → 语法错误
const slot = end - s;

const inject =
  'console.log("fx"),window.__foliumAudio={' +
  'set:g=>{const a=r.current||[];for(let i=0;i<Math.min(a.length,g.length);i++)a[i].gain.setTargetAtTime(g[i],e.currentTime,.15)},' +
  'get:()=>r.current.map(n=>n.gain.value)' +
  '}';

const pad = slot - inject.length;
console.log('注入点 offset =', s, ' 可用长度 =', slot, ' 注入长度 =', inject.length, ' 补空格 =', pad);
if (pad < 0) {
  console.error(`太长，需要再砍 ${-pad} 字节`);
  process.exit(1);
}
const replacement = inject + ' '.repeat(pad);

const bal = (/** @type {string} */ t) => {
  let c = 0;
  for (const ch of t) {
    if ('([{'.includes(ch)) c++;
    if (')]}'.includes(ch)) c--;
    if (c < 0) return false;
  }
  return c === 0;
};
if (!bal(replacement.trim())) {
  console.error('括号不平衡，放弃写入');
  process.exit(1);
}

console.log('\n替换后：\n' + replacement.trim().slice(0, 220));

if (mode === 'dry') {
  console.log('\n[试运行] 未写入。加 --apply 生效。');
  process.exit(0);
}

if (!existsSync(BAK)) copyFileSync(ASAR, BAK);
const out = Buffer.from(buf);
out.write(replacement, s, 'utf8');
writeFileSync(ASAR, out);
console.log('[apply] 已写入，大小 =', statSync(ASAR).size);
