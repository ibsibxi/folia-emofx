# PR 改动草案：给模组一个「写 EQ」的入口

> 基于 `main` 分支实测源码整理。文件路径、成员名、权限都按仓库现有约定写的。
> 我本机拉不动 `node_modules`（网络慢），所以没跑 `tsc`；类型导入路径请按仓库实际调整。

---

## 1. 新增 `src/mods/folium/audioMix.ts`

```ts
import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import type { FoliumContextKind, FoliumAudioMix } from './contract';

const EQ_BAND_COUNT = 10;
const EQ_GAIN_LIMIT_DB = 12;

const clampGain = (value: unknown): number => {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return Math.max(-EQ_GAIN_LIMIT_DB, Math.min(EQ_GAIN_LIMIT_DB, numeric));
};

/**
 * The graph EQ, writable from a mod.
 *
 * The store owns the settings: writing through `handleSetAudioEqualizerSettings`
 * persists them, updates what the equalizer dialog shows, and lets the host's
 * existing effect apply them to the biquads. Writing the biquad gains directly
 * would drift from the store and be overwritten the next time the host applies
 * its settings — measured on 0.7.21.
 */
export const createFoliumAudioMixService = (context: FoliumContextKind): FoliumAudioMix => {
    const available = context === 'main';

    return Object.freeze({
        getEqualizer: (): number[] => (
            available ? [...useAudioSettingsStore.getState().audioEqualizerSettings.gains] : []
        ),
        setEqualizer: (gains: readonly number[], options?: { slot?: number }): void => {
            if (!available || !Array.isArray(gains) || gains.length === 0) return;

            const state = useAudioSettingsStore.getState();
            const current = state.audioEqualizerSettings;
            const next = current.gains
                .slice(0, EQ_BAND_COUNT)
                .map((value, index) => (index < gains.length ? clampGain(gains[index]) : value));

            const slot = options?.slot;
            const customSlots = typeof slot === 'number' && slot >= 0 && slot < current.customSlots.length
                ? current.customSlots.map((entry, index) => (index === slot ? { ...entry, gains: [...next] } : entry))
                : current.customSlots;

            state.handleSetAudioEqualizerSettings({ ...current, enabled: true, gains: next, customSlots });
        },
    });
};
```

> 说明：`slot` 可选。不传就只改「当前生效的曲线」（自动调音用这个）；传了就同时写进自定义槽位（收藏用）。

---

## 2. `src/mods/folium/contract.ts`

**① 在 `FoliumClientApi` 里加一个成员**（放在 `playback` 后面）

```ts
    /** Playback state and control. */
    readonly playback: FoliumPlaybackService;
    /** The graph equalizer: read and write the 10 bands (dB). */
    readonly audioMix: FoliumAudioMix;
```

**② 加接口定义**（放在 `FoliumPlaybackService` 附近）

```ts
/**
 * The host's 10-band graph equalizer, ordered 31.5/63/125/250/500/1k/2k/4k/8k/16k Hz.
 * Gains are dB, clamped to ±12. Writes go through the settings store, so the
 * equalizer dialog shows them and they survive a restart.
 */
export interface FoliumAudioMix {
    /** The gains the host is currently using, in dB. */
    getEqualizer(): number[];
    /**
     * Applies 10 gains (dB). Missing entries keep their current value; extra
     * entries are ignored. Turns processing on. Pass `slot` to also save the
     * curve into a custom slot (0 = 自定义 1).
     */
    setEqualizer(gains: readonly number[], options?: { slot?: number }): void;
}
```

---

## 3. `src/mods/folium/api.ts`

**① 导入**（和 `createFoliumPlaybackService` 同一行区域）

```ts
import { createFoliumAudioMixService } from './audioMix';
```

**② 返回值里加一行**

```ts
        playback: createFoliumPlaybackService(mod, context),
        audioMix: createFoliumAudioMixService(context),
```

---

## 4. `electron/modSystem/foliumShared.json`

`permissions` 里加一项（放在 `playback.control` 后面）：

```json
        "audio.control": {
            "guards": [
                "folium.audioMix.setEqualizer"
            ]
        },
```

> 如果不想新增权限，也可以先复用 `playback.control` 或挂在 `experimental: ["audio.mix"]` 下 —— 这点由你定。
> 我倾向新增 `audio.control`：它和播放控制是两件事，用户看权限列表时也更容易理解。

---

## 5. 为什么必须写到 store（实测依据）

我在本机 0.7.21 上做过一版只写节点的注入验证：

```
只写 BiquadFilterNode.gain：
  · 节点值确实变了（target 与读回一致）
  · 但音频效果器面板里的「自定义 1」没变
  · 用户一打开面板 → 宿主按 store 重新应用一次 EQ → 节点被刷回旧值 → 听感上"没生效"
```

所以接口必须落在 `audioEqualizerSettings` 上，让宿主既有的应用逻辑去写节点。
`handleSetAudioEqualizerSettings` 内部已经是 `resolve → write（持久化）→ set（更新 store）`，
直接调用它就能同时满足「面板同步 / 重启保留 / 节点生效」三件事。

---

## 6. 我的模组侧（已就绪，不用改）

模组已经在做能力探测，支持以下任一形态，落地哪个都能直接用：

```js
window.__foliumAudio                                   // 本机验证补丁
folium.audioMix.setEqualizer / getEqualizer            // ← 本 PR 建议
folium.audio.mix.setEqualizer                          // 备选命名
folium.experimental['audio.mix']                       // 备选命名
```

调用方式：

```js
folium.audioMix.setEqualizer([0.2, 2.4, 0.1, -0.2, -2.8, 0.4, 0, 0.5, -0.3, -0.6]);
folium.audioMix.getEqualizer();   // -> number[10]
```
