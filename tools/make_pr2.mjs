// 补提交第 4 个文件 + 开 PR（带完整错误输出）
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ME = 'ibsibxi';
const REPO = 'folia-major';
const OWNER = 'chthollyphile';
const BRANCH = 'feat/folium-audio-mix';
const TOKEN = process.env.GITHUB_TOKEN || '';
if (!TOKEN) throw new Error('缺少 GITHUB_TOKEN');

const call = (path, method = 'GET', body = null) => {
  const out = 'E:/app develovpment/projects/09-folia-emofx/vendor/_r.json';
  const args = ['-k', '-sS', '-o', out, '-w', '%{http_code}', '-X', method,
    '-H', `Authorization: Bearer ${TOKEN}`,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: folia-mod-harness'];
  if (body) {
    const inp = out + '.in';
    writeFileSync(inp, JSON.stringify(body), 'utf8');
    args.push('--data-binary', '@' + inp);
  }
  args.push(`https://api.github.com${path}`);
  let code = '';
  try {
    code = execFileSync('curl.exe', args, { encoding: 'utf8' }).trim();
  } catch (e) {
    code = 'ERR:' + (e.message || '').slice(0, 120);
  }
  let json = null;
  try { json = JSON.parse(readFileSync(out, 'utf8')); } catch {}
  return { code, json };
};

// 1) 取当前 sha
const cur = call(`/repos/${ME}/${REPO}/contents/electron/modSystem/foliumShared.json?ref=${BRANCH}`);
console.log('GET sha =', cur.json?.sha, 'size =', cur.json?.size, 'http =', cur.code);

// 2) 读本地改好的内容
const content = readFileSync('E:/app develovpment/projects/09-folia-emofx/vendor/share.json.patched', 'utf8');
console.log('本地内容长度 =', content.length);

// 3) PUT
const put = call(`/repos/${ME}/${REPO}/contents/electron/modSystem/foliumShared.json`, 'PUT', {
  message: 'feat(folium): foliumShared — add audio.control permission',
  content: Buffer.from(content, 'utf8').toString('base64'),
  branch: BRANCH,
  sha: cur.json?.sha,
});
console.log('PUT http =', put.code, '->', put.json?.content ? 'ok sha=' + put.json.content.sha : JSON.stringify(put.json).slice(0, 300));

// 4) 开 PR
const pr = call(`/repos/${OWNER}/${REPO}/pulls`, 'POST', {
  title: 'feat(folium): mod-writable graph equalizer (folium.audioMix)',
  head: `${ME}:${BRANCH}`,
  base: 'main',
  body: [
    '## 做了什么',
    '给模组一个写 EQ 的入口：`folium.audioMix.getEqualizer()` / `setEqualizer(gains, { slot })`。',
    '',
    '## 为什么必须写到 store',
    '只写 `BiquadFilterNode.gain`（我在 0.7.21 上实测）：音频效果器面板里的「自定义 1」不会变；',
    '而且用户一打开面板，宿主会按 store 重新应用一次 EQ，把节点刷回去 —— 听感上等于"没生效"。',
    '所以写入走 `handleSetAudioEqualizerSettings`，让宿主既有逻辑落到节点上，同时面板同步、重启保留。',
    '',
    '## 改动（4 个文件）',
    '- 新增 `src/mods/folium/audioMix.ts`：`getEqualizer` / `setEqualizer`',
    '- `contract.ts`：新增 `FoliumAudioMix` 接口，`FoliumClientApi` 加 `audioMix`',
    '- `api.ts`：import 一行 + 返回对象加一行',
    '- `electron/modSystem/foliumShared.json`：新增权限 `audio.control`',
    '',
    '## 行为',
    '- 10 段：31.5/63/125/250/500/1k/2k/4k/8k/16k，单位 dB，夹到 ±12',
    '- 缺省项保持原值、多余项忽略，自动 `enabled: true`',
    '- `slot` 可选：传了同时写进自定义槽位（收藏用）',
    '- 只在主窗口可用；不返回任何音频数据、不改变现有安全模型',
    '',
    '## 备注',
    '我在本机做过等长的 asar 注入验证（只写节点），确认链路与频点正确，也确认了"只写节点会被回刷"这一点。',
    '模组侧已经做好能力探测，接口按这个形状落地就能直接用。',
  ].join('\n'),
});
console.log('PR http =', pr.code, '->', pr.json?.html_url || JSON.stringify(pr.json).slice(0, 400));
