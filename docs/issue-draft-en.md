# English version (for chthollyphile/folia-major Issues)

**Title**: `[Feature] A supported audio entry point for mods (folium.audio.*): today we can read audio, but not act on it`

---

## What I'm building

A Folium mod that matches the current song with a target EQ/effect curve (emotion + genre → a 10-band curve, decided once per track, not per frame). The analysis side works great thanks to `ctx.audio`. The execution side has nowhere to go.

## The gap

- `ctx.audio.getSpectrum() / getBands() / getPower()` — read-only, and good.
- There is no write path.
- `folium.internals` exposes `playback / appView / visualizerSettings / themeSettings / lyricSettings` — no audio store — and `internals` is scheduled for removal in Folium 2, so it is not a viable route.

Net effect: a mod can only *suggest* a curve. The user has to copy ten numbers into the settings panel by hand, which is where this whole class of mods dies.

## What the host already has (visible to any user)

The renderer logs its own graph:

```
graph: decks -> mix -> equaliser -> effects -> volume -> fade -> analyser -> out
```

…and the UI ("设置 → 音频效果器") exposes:

- 10 bands: 31 / 62 / 125 / 250 / 500 / 1k / 2k / 4k / 8k / 16k Hz, ±12 dB, 6 presets + 2 custom slots;
- an effect chain: low-cut, high-cut, saturation, bitcrush, dither, vinyl noise, stereo width, reverb, compressor;
- device output via `AudioContext.setSinkId`.

So the executor already exists — only a mod-facing entry point is missing.

## Proposal (three tiers, any one is enough)

### A — smallest, recommended: let a mod write the existing EQ/effect params

```js
const audio = folium.experimental['audio.mix'];   // or a stable folium.audio service

audio.getMix();                                   // { equalizer: { enabled, gains[10], preset }, effects: {...} }
audio.setEqualizer({ gains: [/* 10 dB values */] });
audio.setEffects({ width: 1.2, reverb: 0.15 });   // optional
```

- Writing should reuse the host's existing smoothing/limiting, so mods don't re-implement crossfades.
- Params only, no filter-structure changes: low risk.
- Even `setEqualizer` alone would unlock the "automatic EQ / automatic sound effect" class.

### B — most capable: let a mod insert an AudioNode

```js
folium.experimental['audio.chain'].insert((ctx) => myNode, { slot: 'post-mix' });
```

Enables things the host doesn't have (multiband compression, convolution reverb), but needs slot/lifecycle design. Not a first step.

### C — most conservative: preset switching only

```js
folium.audio.applyPreset('custom-1');
```

If A is a poor fit for the host's design, C is still enough for: mod computes curve → user stores it in a slot → mod switches slots.

## Why this matters beyond one mod

Today Folium's mod ecosystem is almost entirely visual (lyrics, backgrounds, progress bars, panels). Tier A would open an audio-side class:

- per-song automatic EQ / effects,
- hearing-loss / frequency-response compensation,
- night-mode loudness levelling,
- voice-forward mode for podcasts.

All local, no network, no audio export — no conflict with the current security model.

## What I can contribute

- Happy to ship behind `experimental` with no stability promise.
- Can provide a PoC mod + tests.
- The smoothing I already implemented (one-pole gain, τ ≈ 150 ms; 300 ms equal-power crossfade between curves) is reusable as-is.

## Boundaries

- No export of provider audio streams or decrypted files.
- No third-party API calls.
- Nothing runs unless the user enables and confirms the mod.

Thanks.
