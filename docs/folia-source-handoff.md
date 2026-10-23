# Folia 增加「汽水音乐」播放源 —— 交接文档

> 写给下一个会话（D:\reverse 下开工）。
> 内容分两部分：**先把结论放在最前面**（能不改 asar 就别改），再给实操经验（怎么改不闪退、怎么不依赖 DSH、怎么自主验证）。
> 所有结论都有实测依据，踩过的坑都标了「坑」。

---

## 0. 最重要的结论：先别碰 asar

我原本以为「给 Folia 加功能必须改 app.asar」。**这是错的。**

Folia 的在线源注册表 `src/services/onlineMusic/providerRegistry.ts` 里，注册函数是**导出的、运行时可用**的，注释写得很直白：

```ts
// Folium mods register and remove providers at runtime, after the UI first read the list.
export const registerOnlineMusicProvider = (provider: OnlineMusicProvider): void
export const unregisterOnlineMusicProvider = (providerId: OnlineProviderId): void
```

模组侧对应的公开接口在 `src/mods/folium/contract.ts`：

```ts
/** EXPERIMENTAL (`omni.providers`): an online music source. */
export interface FoliumOmniProviderDef {
    id: string;
    displayName: string;
    shortName?: string;
    search?(query, page): Promise<{ items: FoliumProviderSong[]; hasMore: boolean; total?: number }>;
    getSong?(id: string): Promise<FoliumProviderSong | null>;
    getAudioUrl?(song, quality): Promise<{ url: string; expiresAt?: number } | null>;
    getLyrics?(song): Promise<FoliumLyricsResult | FoliumLegacyLyricsResult | null>;
}
```

**所以正确的路线是：写一个 Folium 模组，`mod.json` 里声明 `"experimental": ["omni.providers"]`，注册一个汽水音乐源。**

好处：不用改二进制、不用重打包、不用重新确认权限、升级 Folia 不失效、可分发。

> 只有「模组拿不到的能力」才考虑改 asar。已知模组拿不到的：**写 EQ**（设置 store 不在 `internals` 里）、**读音频流**。加播放源不在其中。

---

## 1. 改 asar 的经验（万一真要用）

### 1.1 先做「一个字节」实验，别猜

我一度以为改 asar 会导致启动失败，因为 Electron 有 asar 完整性校验。做法是先做一次**完全无害的同长度替换**：

```js
// 把日志字符串里的一个字符改掉（长度不变，语义不变）
'[AudioContext]'  →  '[audioContext]'
```

结果：**Folia 正常启动**。结论：这个版本（0.7.21）**没有启用完整性校验拦截**（header 里虽然带 integrity 字段）。

> 教训：那次"改 asar 就闪退"的锅是我的代码，不是校验。

### 1.2 等长替换 + 括号平衡自检（坑）

asar 是拼接的，插入会破坏 offset，所以必须**等长替换**：用空格补齐。

**坑（我踩过，直接导致启动即退）**：我用一个字符串锚点切掉了 `console.log(...)` 的结尾，把反引号和右括号切散，留下一个孤立的 `)` → 整个 chunk 语法错误 → 启动闪退。

必须做两件事：

1. **切点包含完整的语法单元**（比如把 `` `), `` 一起吃掉）；
2. **替换前做括号平衡自检**：

```js
const balanced = (s) => {
  let d = 0;
  for (const ch of s) {
    if ('([{'.includes(ch)) d++;
    if (')]}'.includes(ch)) d--;
    if (d < 0) return false;
  }
  return d === 0;
};
```

### 1.3 锚点怎么找

- 打包产物里变量名全被压缩（`e,t,n,r,...`），**不要用变量名当锚点**；
- 用**唯一的字符串字面量**当锚点，例如 `console.log(\`[AudioContext] graph:`、报错文案、i18n key；
- 先打印锚点前后各 200 字符确认上下文，再动手：

```js
const i = buf.indexOf(anchor);
console.log(buf.subarray(i - 200, i + 200).toString('utf8'));
```

- 一次只能命中一次（`count === 1`），否则放弃。

### 1.4 必须可回滚

- 备份：`cp app.asar app.asar.bak`（124 MB，别怕）；
- 提供 `--restore` 一条命令还原；
- **不要连续 patch 两次**：第二次锚点可能已经被第一次改掉，脚本会静默失败或用错的锚点。

---

## 2. 不要依赖 DSH（这条是你特别要求的）

### 2.1 为什么会被带走

DSH 在 Windows 把子进程放进一个 **Job Object**，带 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`：

```js
// @deepseek-ai/dsh-win32-process/lib/index.js
information.writeUInt32LE(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, 16);
api.setInformationJobObject(job, 9, ...);
api.assignProcessToJobObject(job, info.hProcess);
```

**Job 句柄一关（DSH 退出/重启），内核杀掉 Job 里所有进程。**
我在 DSH 里 `Start-Process Folia.exe` 启动的实例，DSH 一重启就被杀了（6 个进程全没）。

### 2.2 正确启动方式：绕开 Job

```powershell
# 让 explorer 当代父进程 → 脱离 DSH 的 Job
Start-Process -FilePath 'explorer.exe' -ArgumentList '"E:\Folia\Folia.exe"'
```

已经写好可直接用：`tools/start-folia.ps1`（带 `-Restart`、自动检查父进程是不是 explorer）。

**坑**：`.ps1` 里有中文时，必须存成 **UTF-8 with BOM**。`powershell.exe`（5.1）会把无 BOM 的 UTF-8 当 ANSI 读，中文变乱码并可能让引号失配，报 `Unexpected token '}'`。

### 2.3 脚本要「无状态、可重跑」

- 所有中间状态**落盘成 JSON**（探测结果、进度、上次成功的时间戳），不要放在进程内存里；
- 脚本分三个阶段，任何一步中断都能单独重跑：`probe → build → verify`；
- 不要依赖"上一个命令的输出变量"，每个脚本自己从磁盘读。

---

## 3. 验证闭环（不看肉眼，不靠人）

### 3.1 模组热更新：改完 2 秒生效

Folia 的模组壳会轮询 `ui.bundle.mjs` 的 mtime，变了就重新挂载。所以：

```
改源码 → node tools/build_ui.mjs → 写到 %APPDATA%\Folia\mods-cache\<modid>\ui.bundle.mjs
       → Folia 2 秒内自动重载（不用重装、不用重新确认权限）
```

**这是最省时间的开发方式**：UI/逻辑迭代完全不用碰安装流程。

> 注意：只有 `client.mjs`/`index.cjs`/`mod.json` 改动才需要重装 + 重新确认（确认是绑定目录内容摘要的）。

### 3.2 从外部读取页面内的状态

页面里的结果没法直接看？把它写进模组存储，然后从磁盘读：

```js
folium.storage.set('probe', JSON.stringify(result));
```

落到 `%APPDATA%\Folia\mods-data\<modid>\mod-data.json`，外部 `Get-Content` 就能看到。

我用这招做过：React fiber 扫描结果、EQ 写入回读、每次自动应用的目标曲线 —— 全部不需要点界面。

### 3.3 音频类改动：只能人耳判定

写节点成功 ≠ 听得出效果。我的教训：

- 曲线本身只有 ±1.7 dB → 人耳没感觉，误判成"没生效"；
- 正确做法：造一个**极端测试信号**（±12 dB 的扫频/单段），先确认链路通，再调正常值；
- `setTargetAtTime` 是**调度**，写完立刻读 `gain.value` 还是旧值，要等 ~500ms 再读（我在这里误判过一次）。

### 3.4 截图/点击

- 150% 缩放下：**物理坐标 = 逻辑坐标 × 1.5**，算错就点空；
- 点击前确认目标窗口是前台，否则点到别的窗口（曾被自己 IDE 吃掉点击）；
- Electron 页面用 `getBoundingClientRect()` + `devicePixelRatio` 换算最靠谱，别硬编码。

---

## 4. 汽水音乐落地路线

### 4.1 动手前必须确认的三件事

| 问题 | 为什么关键 |
|---|---|
| 音频 URL 是否**带签名/时效**？ | 决定 `getAudioUrl` 要不要每次现取（大多数平台都这样，`expiresAt` 就是给这个用的） |
| 登录态怎么拿？ | 没有账号就没有 VIP 音质；`platform.raw` 需要账号能力时要有登录流程 |
| 有没有**官方开放接口**？ | 有就走正规接口；没有就只能走客户端接口（合规风险自己评估） |

### 4.2 探测顺序

1. 网页版/PC 客户端的**搜索**接口（最好抓，只读）；
2. **取播放地址**接口（关键，注意时效）；
3. **歌词**接口（如果有逐字歌词更好，Folia 支持 `wordByWord`）。

用 `curl` 或 Folia 的探针脚本先手动打通，**再写代码**。不要照着猜测的字段写实现——这是他们仓库 `skills/kugou-provider-alignment/SKILL.md` 里反复强调的原则：

> The documentation defines the request contract. The live response defines the response mapping. If they disagree, preserve the evidence, report the mismatch, and do not silently guess.

### 4.3 最小可用实现骨架

```js
// client.mjs 里
const provider = {
  id: 'soda',
  displayName: '汽水音乐',
  shortName: '汽水',
  async search(query, { limit, offset }) {
    const res = await folium.net.fetch(url, { headers });   // 用宿主代发，别自己 fetch
    const data = await res.json();
    return { items: data.map(toSong), hasMore: data.length >= limit };
  },
  async getAudioUrl(song, quality) {
    const data = await (await folium.net.fetch(urlFor(song, quality))).json();
    return { url: data.url, expiresAt: Date.now() + (data.ttl ?? 600) * 1000 };
  },
  async getLyrics(song) { /* 返回 LRC 或结构化的逐字歌词 */ },
};

// 注册（按 contract 的 experimental 约定）
folium.experimental['omni.providers'].register(provider);
```

`folium.net.fetch` 走宿主，**不要**在模组里直接 `fetch`：跨域、UA、cookie 都会被拦。

### 4.4 失败路径必须优雅

Folia 有 `handleOnlineMediaFailure` / `createOnlineRecoveryController` / `onlineFailureToast`。你的 provider 只要**返回 null 或抛错**，宿主会走自己的提示与回退。所以：

- `getAudioUrl` 拿不到 → 返回 `null`，不要抛一个看不懂的异常；
- `search` 网络失败 → 抛 `Error`，宿主会显示 toast；
- 401/403 → 明确区分"需要登录"和"接口挂了"。

### 4.5 合规红线（别踩）

- **不内置任何账号、cookie、token、密钥**；
- 不绕过付费/会员校验；
- 不把抓到的接口写死在公开仓库里当作"官方 API"；
- 本地自用、用户自己登录，这条线要守住。

---

## 5. 我踩过的坑清单（直接抄）

| 场景 | 坑 | 做法 |
|---|---|---|
| PowerShell 替换 | `$t -replace "a", $b + "c"` → 逗号优先，变成数组 | 先 `$rep = $b + "c"` 再 `-replace "a", $rep` |
| PowerShell 字符串 | 双引号里的反引号会被吃掉，模板字符串全废 | 用 `edit` 工具改文件，或改用单引号 |
| node 内联脚本 | `node -e "...复杂引号..."` 极易崩 | **一律写成 `.mjs` 文件**再跑 |
| 写 JSON | `Set-Content -Encoding UTF8` 加 BOM → `JSON.parse` 失败 | 用 `UTF8Encoding($false)`；读的时候剥 `\uFEFF` |
| 网络 | 加速器把 `api.github.com` 映射到 127.0.0.1（自签证书） | `curl -k`；`git` 用 `-c http.sslVerify=false` |
| 大文件读 | 把 124 MB asar 当 UTF-8 字符串跑正则 → 卡死 | 用 `Buffer.indexOf` 按字节找，再取上下文 |
| UI 事件 | 点击冒泡到宿主导航，看起来像"整页重载" | 容器上 `stopPropagation`（pointerdown/mousedown/click/dblclick） |
| UI 抖动 | 文字宽度变化推挤布局 | 固定宽度 + `text-overflow:ellipsis` |
| Canvas 闪白 | 尺寸没变却重设 `canvas.width` → 清空一帧 | 像素尺寸没变就不重设 |
| 越界索引 | 模型/表的索引范围不一致，取到脏数据 | 用真实范围过滤，别信"看起来连续" |

---

## 6. 验收检查表

做完一项就打个勾，别靠感觉：

- [ ] 搜索能返回结果，字段完整（id/title/artists/cover/duration）
- [ ] 点击能播，进度条走，暂停/继续正常
- [ ] 歌词能显示（有逐字更好），时间轴对得上
- [ ] 切歌 10 次不崩、不漏内存（看任务管理器）
- [ ] 断网 → 有提示，界面不卡死
- [ ] 登录态过期 → 提示"需要重新登录"，不是白屏
- [ ] `mod.json` 只声明必需权限，没有多余项
- [ ] 卸载模组后 Folia 恢复正常（注册表能正确注销）
- [ ] 全程不依赖 DSH 会话：关掉 DSH，Folia 与模组照常工作

---

## 7. 参考（都在这个仓库里）

| 文件 | 用途 |
|---|---|
| `src/services/onlineMusic/providerRegistry.ts` | 注册表：注册/注销/能力查询 |
| `src/services/onlineMusic/<源>/` | 现有实现：`netease/`、`kugou/`、`qq/`、`spotify/`、`ytm/`、`bodian/` |
| `src/mods/folium/contract.ts` | `FoliumOmniProviderDef`、`FoliumProviderSong`、`platform.raw` |
| `skills/kugou-provider-alignment/SKILL.md` | **官方给出的加源方法论**：先文档、再实测、不许猜 |
| `skills/online-song-omni-routing/SKILL.md` | 公共数据流必须走 Omni，不许绕过 |
| `docs/kugou-omni-capability-alignment.md` | 能力对齐案例 |
| `electron/<源>/` | 主进程侧的 API host（需要持久登录态时看这个） |
| `api/qq.js` | 服务端转发的最小例子 |
