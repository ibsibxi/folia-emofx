# Folia 侧改动说明（可直接提 PR / issue）

> 目标：给 Folium 模组一个**稳定的音频效果写入入口**，让「按歌自动调音」这类模组能真正生效。
> 本文描述的改动已在本机 0.7.21 上**实测跑通**（见末尾验证数据）。

---

## 1. 问题

模组能读 `ctx.audio` 的分析数据（`getSpectrum/getBands/getPower`），但**没有任何办法参与声音**：

- `folium.internals.stores` 只有 `playback / appView / visualizerSettings / themeSettings / lyricSettings`，不含音频设置；
- **`folium` 对象本身也没有任何音频成员**。实测把宿主交给模组的对象成员逐个列出来，只有：
  `modId / host / env / log / registries / events / playback / ui / net / storage / rpc / lyrics / theme / every / onDispose / experimental`
  —— 没有 `audio`，`experimental` 的白名单里也没有任何音频项；
- 对打包产物做符号扫描：`folium.audio`、`audio.mix`、`setEqualizer`、`getEqualizer`、`applyPreset`、
  `registerEffect`、`insertEffect` 全部 **0 命中**；而 `handleSetAudioEqualizerSettings`、`audioEqualizerSettings`
  有命中，说明实现存在、只是没暴露给模组；
- EQ / 效果链的状态在另一个 store（`audioEqualizerSettings` / `handleSetAudioEqualizerSettings`），模组既拿不到对象也拿不到 setter —— 实测全局扫 React 树：7968 个 hook、0 个与 equalizer 相关的函数，因为这个组件只在「音频效果器」弹窗挂载时才存在；
- 于是模组只能"建议"曲线，用户必须手动抄 10 个数字，体验断裂。

与此同时宿主**已经有完整的执行器**：渲染进程日志里自己打印

```
[AudioContext] graph: decks -> mix -> equaliser -> effects -> volume -> fade -> analyser -> out
```

即 10 段 biquad（31.5…16k）+ 效果链（低切/高切/饱和/比特/抖动/黑胶/宽度/混响/压缩）都已经接在链路上了。缺的只是一个**写参数的口子**。

---

## 2. 提议的 API（最小可用）

```ts
// 稳定服务（建议）；先放 experimental 也完全够用
export interface FoliumAudioMix {
  /** 读取当前 10 段增益（dB），顺序 31.5/63/125/250/500/1k/2k/4k/8k/16k */
  getEqualizer(): number[];
  /** 写入 10 段增益；内部必须复用宿主既有的平滑，不允许模组直接改节点 */
  setEqualizer(gainsDb: number[]): void;
}

folium.audio.mix.setEqualizer([2, 2.4, 0.1, -0.2, -2.8, 0.4, 0, 0.5, -0.3, -0.6]);
```

**实现要求（都很低风险）**

| 要求 | 原因 |
|---|---|
| **写到设置层（store），不要只写节点** | 只改 `BiquadFilterNode.gain` 时：面板里的「自定义 1」不会变；用户一打开面板，宿主会用自己的设置重新应用一次 EQ，把节点刷回去 —— 实测就是这样"看起来没生效"。必须同时更新 `audioEqualizerSettings.gains`（必要时 `customSlots`），由宿主既有的应用逻辑去写节点。 |
| 只写 `gain`，不改 `type/frequency/Q` | 结构不变 → 不产生爆音、不需要重建图 |
| 节点侧用 `gain.setTargetAtTime(v, ctx.currentTime, ~0.15)` | 复用宿主既有平滑，模组不用自己处理交叉淡化 |
| 数值夹到 ±12 dB、长度不足时忽略多余项 | 防御式，避免模组把声音搞炸 |
| 不返回任何音频数据 | 不改变现有安全模型（模组拿不到音频流） |

可选（后续）：`setEffects(partial)` 写宽度/混响/压缩等；`applyPreset(id)` 只切槽位。

---

## 3. 改动位置（已在本机实测的注入点）

在新版打包产物里，音频图构造函数长这样（变量名是压缩后的，此处按语义标注）：

```js
// 构造音频图：decks -> mix -> equaliser -> effects -> volume -> fade -> analyser
({ context: e, analyser: t, connectDecks: n, equalizerNodesRef: r, settings: i }) => {
  let a = e.createGain();            // mix 输入
  let o = n(e, a);                   // decks 接进来
  let s = e.createGain();            // equaliser 输出
  MTe({ context: e, input: a, output: s, nodesRef: r, settings: i });   // ← 这里建 10 段 biquad
  let c = e.createGain();            // volume
  let l = YTe({ ..., effects: i.effects, enabled: i.enabled });         // 效果链
  let u = e.createGain();            // fade
  return c.connect(u), u.connect(t), t.connect(e.destination),
         { gainNode: c, fadeNode: u, effectChain: l, decksConnected: o };
}
```

`equalizerNodesRef`（上例的 `r`）在其 `current` 上就是那 10 个 `BiquadFilterNode`。

**建议的上游实现**：在 `MTe` 返回后，把 `r` 挂到一个宿主持有的对象上，然后由 folium API 层暴露 `getEqualizer/setEqualizer`（约 10 行）。不要直接暴露 DOM 节点给模组，只暴露这两个方法。

---

## 4. 本机验证（0.7.21，未改任何其它逻辑）

为验证可行性，我在 `app.asar` 的该函数内注入了一段等价实现（206 字节，原片段 225 字节，**文件长度不变**）：

```js
window.__foliumAudio = {
  set: g => { const a = r.current || [];
    for (let i = 0; i < Math.min(a.length, g.length); i++)
      a[i].gain.setTargetAtTime(g[i], e.currentTime, .15) },
  get: () => r.current.map(n => n.gain.value)
};
```

验证结果（模组侧写回、500ms 后读回）：

```
target: [-0.13, 1.48, 0.07, -0.15, -1.73, 0.22, 0.02, 0.32, -0.21, -0.37]
later : [-0.13, 1.48, 0.07, -0.15, -1.73, 0.22, 0.02, 0.32, -0.21, -0.37]  ✅ 一致
```

即：写入生效、读回一致、无爆音、无需重启、无需打开任何面板。

**但这一步只证明了「节点可写」，不证明「设置可写」**：因为写的是 `BiquadFilterNode.gain` 而不是 store，
面板里的「自定义 1」仍然是旧值；用户打开「音频效果器」面板时，宿主按 store 重新应用一次 EQ，
节点又被刷回旧值 —— 听感上就是"没生效"。这正是 §2 里要求「必须写到设置层」的实测依据。

> 补充观察：AI 原始曲线本身只有 ±1.7 dB，人耳不明显；模组侧我们加了「强度」倍率（默认 160%）来放大到可听范围。这一点说明**上游 API 只需提供原始写入能力**，强度/偏好这类产品逻辑留给模组。

---

## 5. 兼容与风险

- 只写参数、不改结构 → 与现有 EQ/效果开关、预设切换、设备切换都不冲突；
- 可作为 `experimental['audio.mix']` 起步，稳定后再转正；
- 若不希望暴露给所有模组，可只允许声明了某权限的模组调用（例如新增 `audio.control`）；
- 模组侧我们已按 §2 的签名写好调用与降级（没有 API 时退回"复制数值"）。
