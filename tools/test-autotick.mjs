// test-autotick.mjs —— 直接单测 bundle 里的 autoTick（无界面引擎）
import { pathToFileURL } from 'node:url';

const bundleUrl = pathToFileURL('E:/app develovpment/projects/09-folia-emofx/mod/emofx/ui.bundle.mjs').href;

// 最小 DOM 垫片：bundle 顶层若引用 document 也不至于崩
globalThis.document = globalThis.document ?? {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {} }),
  body: { appendChild() {} },
};
globalThis.window = globalThis.window ?? { devicePixelRatio: 1 };

const mod = await import(bundleUrl);
console.log('导出:', Object.keys(mod).join(', '));

const bands = { bass: 200, lowMid: 180, mid: 150, vocal: 140, treble: 120 };
mod.feed(bands, 180);

const writes = [];
const folium = {
  host: { folium: { minor: 7 } },
  equalizer: {
    getState: () => ({ enabled: true, writable: true, gains: new Array(10).fill(0), bands: new Array(10).fill({ frequency: 0, shape: 'peaking' }) }),
    applyCurve: (g) => { writes.push(g); return { ok: true, state: { gains: g } }; },
    releaseCurve: () => true,
  },
};

// 第一次调用：写入
mod.autoTick(folium);
// 立刻再调用：应被 1.1 秒节流挡住
mod.autoTick(folium);

console.log('写入次数（应 1 次）:', writes.length);
if (writes.length) {
  console.log('曲线:', writes[0].map((v) => v.toFixed(1)).join(' '));
  console.log('段数（应 10）:', writes[0].length);
  const inRange = writes[0].every((v) => Math.abs(v) <= 12);
  console.log('都在 ±12 dB 内:', inRange);
}

// 等过节流窗口，换个音频再试：应产生第二次写入
await new Promise((r) => setTimeout(r, 1200));
mod.feed({ bass: 30, lowMid: 60, mid: 220, vocal: 240, treble: 200 }, 120);
mod.autoTick(folium);
console.log('第二次写入后总次数（应 2 次）:', writes.length);
if (writes.length === 2) console.log('第二条曲线:', writes[1].map((v) => v.toFixed(1)).join(' '));
