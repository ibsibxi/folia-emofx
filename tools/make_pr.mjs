// 用 GitHub REST API 完成：fork → 建分支 → 提交 4 个文件改动 → 开 PR
// 干跑：node tools/make_pr.mjs
// 真跑：GITHUB_TOKEN=xxx node tools/make_pr.mjs --apply
//
// 说明：api.github.com 在本机被加速器映射到 127.0.0.1 且用自签证书，所以请求都带 -k。

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const OWNER = 'chthollyphile';
const REPO = 'folia-major';
const ME = 'ibsibxi';
const BRANCH = 'feat/folium-audio-mix';
const APPLY = process.argv.includes('--apply');
const TOKEN = process.env.GITHUB_TOKEN || '';

const api = (/** @type {string} */ path, /** @type {string} */ method = 'GET', /** @type {any} */ body = null) => {
  const args = ['-k', '-s', '-X', method, '-H', `Authorization: Bearer ${TOKEN}`, '-H', 'Accept: application/vnd.github+json', '-H', 'User-Agent: folia-mod', '-H', 'X-GitHub-Api-Version: 2022-11-28'];
  const tmp = 'E:/app develovpment/projects/09-folia-emofx/vendor/_api.json';
  if (body) {
    writeFileSync(tmp + '.in', JSON.stringify(body), 'utf8');
    args.push('--data-binary', '@' + tmp + '.in');
  }
  args.push(`https://api.github.com${path}`);
  execFileSync('curl.exe', args, { stdio: 'ignore' });
  try {
    return JSON.parse(readFileSync(tmp, 'utf8'));
  } catch {
    return null;
  }
};
// curl 需要 -o 才能落盘，这里简单重写一次
const apiCall = (/** @type {string} */ path, /** @type {string} */ method = 'GET', /** @type {any} */ body = null) => {
  const tmp = 'E:/app develovpment/projects/09-folia-emofx/vendor/_api.json';
  const args = ['-k', '-s', '-o', tmp, '-X', method, '-H', `Authorization: Bearer ${TOKEN}`, '-H', 'Accept: application/vnd.github+json', '-H', 'User-Agent: folia-mod-harness'];
  if (body) {
    const inp = tmp + '.in';
    writeFileSync(inp, JSON.stringify(body), 'utf8');
    args.push('--data-binary', '@' + inp);
  }
  args.push(`https://api.github.com${path}`);
  execFileSync('curl.exe', args, { stdio: 'ignore' });
  const text = readFileSync(tmp, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
};

// ---------- 1. 构造改动 ----------
const read = (/** @type {string} */ p) => readFileSync(p, 'utf8');
const apiTs = read('vendor/src/src/mods/folium/api.ts');
const contractTs = read('vendor/src/src/mods/folium/contract.ts');
const sharedJson = read('vendor/share.json');

const once = (/** @type {string} */ src, /** @type {string} */ needle, /** @type {string} */ label) => {
  const n = src.split(needle).length - 1;
  if (n !== 1) throw new Error(`锚点「${label}」出现 ${n} 次（应为 1）`);
};

// api.ts
const API_IMPORT_ANCHOR = "import { createFoliumLyricsService, createFoliumNetService, createFoliumPlaybackService, createFoliumUiService } from './services';";
const API_FIELD_ANCHOR = '        playback: createFoliumPlaybackService(mod, context),';
once(apiTs, API_IMPORT_ANCHOR, 'api.ts import');
once(apiTs, API_FIELD_ANCHOR, 'api.ts playback 字段');

const apiTs2 = apiTs
  .replace(API_IMPORT_ANCHOR, `${API_IMPORT_ANCHOR}\nimport { createFoliumAudioMixService } from './audioMix';`)
  .replace(API_FIELD_ANCHOR, `${API_FIELD_ANCHOR}\n        audioMix: createFoliumAudioMixService(context),`);

// contract.ts
const CONTRACT_FIELD_ANCHOR = '    readonly playback: FoliumPlaybackService;';
const CONTRACT_IFACE_ANCHOR = 'export interface FoliumClientApi {';
once(contractTs, CONTRACT_FIELD_ANCHOR, 'contract.ts playback 成员');
once(contractTs, CONTRACT_IFACE_ANCHOR, 'contract.ts FoliumClientApi');

const AUDIO_MIX_IFACE = `/**
 * The host's 10-band graph equalizer, ordered 31.5/63/125/250/500/1k/2k/4k/8k/16k Hz.
 * Gains are dB, clamped to ±12. Writes go through the settings store, so the equalizer
 * dialog shows them and they survive a restart.
 */
export interface FoliumAudioMix {
    /** The gains the host is currently using, in dB. */
    getEqualizer(): number[];
    /**
     * Applies 10 gains (dB). Missing entries keep their current value, extra entries are
     * ignored, and processing is turned on. Pass \`slot\` to also save the curve into a
     * custom slot (0 = the first one).
     */
    setEqualizer(gains: readonly number[], options?: { slot?: number }): void;
}

`;

const contractTs2 = contractTs
  .replace(CONTRACT_IFACE_ANCHOR, `${AUDIO_MIX_IFACE}${CONTRACT_IFACE_ANCHOR}`)
  .replace(CONTRACT_FIELD_ANCHOR, `${CONTRACT_FIELD_ANCHOR}\n    /** The graph equalizer: read and write the 10 bands (dB). */\n    readonly audioMix: FoliumAudioMix;`);

// foliumShared.json
const SHARED_ANCHOR = '        "render.export": { "guards": ["api.render.exportVideo"] },';
once(sharedJson, SHARED_ANCHOR, 'foliumShared.json render.export');
const sharedJson2 = sharedJson.replace(
  SHARED_ANCHOR,
  `        "audio.control": { "guards": ["folium.audioMix.setEqualizer"] },\n${SHARED_ANCHOR}`
);

const AUDIO_MIX_TS = `import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
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
 * The store owns the settings: writing through \`handleSetAudioEqualizerSettings\` persists them,
 * updates what the equalizer dialog shows, and lets the host's existing effect apply them to the
 * biquads. Writing the biquad gains directly would drift from the store and be overwritten the
 * next time the host applies its settings (measured on 0.7.21).
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
`;

const files = [
  { path: 'src/mods/folium/audioMix.ts', content: AUDIO_MIX_TS, isNew: true },
  { path: 'src/mods/folium/api.ts', content: apiTs2 },
  { path: 'src/mods/folium/contract.ts', content: contractTs2 },
  { path: 'electron/modSystem/foliumShared.json', content: sharedJson2 },
];

console.log('=== 干跑结果 ===');
for (const f of files) console.log(`${f.isNew ? '新增' : '修改'} ${f.path}  ${f.content.length} 字符`);
console.log('\napi.ts 改动预览:');
const a = apiTs2.split('\n').filter((l) => l.includes('audioMix') || l.includes('createFoliumAudioMixService'));
console.log(a.map((l) => '  + ' + l.trim()).join('\n'));
console.log('\ncontract.ts 改动预览:');
const c = contractTs2.split('\n').filter((l) => l.includes('audioMix') || l.includes('FoliumAudioMix'));
console.log(c.map((l) => '  + ' + l.trim()).join('\n'));
console.log('\nfoliumShared.json 改动预览:');
console.log('  + ' + sharedJson2.split('\n').find((l) => l.includes('audio.control')).trim());

if (!APPLY) {
  console.log('\n[干跑] 未提交。设置 GITHUB_TOKEN 并加 --apply 才真正执行。');
  process.exit(0);
}
if (!TOKEN) throw new Error('缺少 GITHUB_TOKEN');

// ---------- 2. fork ----------
console.log('\n[1/5] fork …');
let fork = apiCall(`/repos/${OWNER}/${REPO}/forks`, 'POST', { default_branch_only: true });
if (!fork || !fork.full_name) {
  // 可能已存在
  fork = apiCall(`/repos/${ME}/${REPO}`);
}
console.log('   ', fork?.full_name || JSON.stringify(fork).slice(0, 200));

// 等 fork 就绪
for (let i = 0; i < 20; i++) {
  const r = apiCall(`/repos/${ME}/${REPO}/git/ref/heads/main`);
  if (r && r.object && r.object.sha) break;
  await new Promise((res) => setTimeout(res, 3000));
}

// ---------- 3. 建分支 ----------
console.log('[2/5] 建分支 …');
const mainRef = apiCall(`/repos/${ME}/${REPO}/git/ref/heads/main`);
const baseSha = mainRef?.object?.sha;
if (!baseSha) throw new Error('拿不到 fork 的 main sha');
const branchRes = apiCall(`/repos/${ME}/${REPO}/git/refs`, 'POST', { ref: `refs/heads/${BRANCH}`, sha: baseSha });
console.log('   ', branchRes?.ref || JSON.stringify(branchRes).slice(0, 200));

// ---------- 4. 提交文件 ----------
console.log('[3/5] 提交文件 …');
for (const f of files) {
  const existing = apiCall(`/repos/${ME}/${REPO}/contents/${f.path}?ref=${BRANCH}`);
  const sha = existing && existing.sha ? existing.sha : undefined;
  const res = apiCall(`/repos/${ME}/${REPO}/contents/${f.path}`, 'PUT', {
    message: `${f.isNew ? 'feat' : 'feat'}(folium): ${f.path.split('/').pop()} — mod-writable graph equalizer`,
    content: Buffer.from(f.content, 'utf8').toString('base64'),
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  });
  console.log('   ', f.path, res?.content ? 'ok' : JSON.stringify(res).slice(0, 160));
}

// ---------- 5. 开 PR ----------
console.log('[4/5] 开 PR …');
const pr = apiCall(`/repos/${OWNER}/${REPO}/pulls`, 'POST', {
  title: 'feat(folium): mod-writable graph equalizer (folium.audioMix)',
  head: `${ME}:${BRANCH}`,
  base: 'main',
  body: [
    '## 做了什么',
    '给模组一个写 EQ 的入口：`folium.audioMix.getEqualizer()` / `setEqualizer(gains, { slot })`。',
    '',
    '## 为什么必须写到 store',
    '只写 `BiquadFilterNode.gain` 的话（我在 0.7.21 上实测）：面板里的「自定义 1」不会变，',
    '而且用户一打开音频效果器面板，宿主会按 store 重新应用一次 EQ，把节点刷回去 —— 听感上就是"没生效"。',
    '所以写入走 `handleSetAudioEqualizerSettings`，让宿主既有逻辑落到节点上。',
    '',
    '## 改动',
    '- 新增 `src/mods/folium/audioMix.ts`',
    '- `contract.ts`：`FoliumAudioMix` 接口 + `FoliumClientApi.audioMix`',
    '- `api.ts`：import + 返回对象加一行',
    '- `foliumShared.json`：新增权限 `audio.control`',
    '',
    '## 行为',
    '- 10 段，31.5/63/125/250/500/1k/2k/4k/8k/16k，单位 dB，夹到 ±12',
    '- 缺省项保持原值，多余项忽略；自动 `enabled: true`',
    '- `slot` 可选：传了同时写进自定义槽位（收藏用）',
    '- 只在主窗口可用；不返回任何音频数据',
  ].join('\n'),
});
console.log('[5/5]', pr?.html_url || JSON.stringify(pr).slice(0, 300));
