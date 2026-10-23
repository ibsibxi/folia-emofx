# 配套 Prompt（新会话直接粘贴）

> 用法：在 D:\reverse 下开新会话，把下面 `---` 之间的内容整段粘进去。
> 它把「不要先改 asar」「不要依赖 DSH」「怎么验证」这些约束前置了，省得新会话从零踩坑。

---

## 你要做的事

我在给 Folia 音乐播放器（`E:\Folia`，版本 0.7.21）增加一个新的在线播放源：**汽水音乐**。
目标是一个能用的最小闭环：搜索 → 播放 → 歌词。

请按下面顺序做，每一步完成后再进入下一步。**不要跳步，不要先写代码。**

### 1. 先读，别猜

按顺序读这几个文件（都在 `E:\Folia\resources` 的打包产物里找不到源码，源码请用 GitHub 拉取或让我提供）：

- `src/services/onlineMusic/providerRegistry.ts` —— 在线源注册表
- `src/mods/folium/contract.ts` —— 搜 `FoliumOmniProviderDef`、`FoliumProviderSong`
- `skills/kugou-provider-alignment/SKILL.md` —— 官方给出的"加一个源"的方法论
- `src/services/onlineMusic/qq/` 或 `kugou/` —— 看一个现成实现的结构

**结论必须是这一条**：加播放源应该做成 **Folium 模组**（`mod.json` 声明 `"experimental": ["omni.providers"]`），
**不要改 `app.asar`**。如果你认为必须改 asar，先停下来告诉我原因，不要直接动手。

### 2. 探测接口（先打通，再写码）

用 `curl` 或临时 `.mjs` 脚本手动打通这三件事，把真实响应存成 JSON 落盘：

1. 搜索：关键词 → 歌曲列表（id/title/artists/cover/duration）
2. 取播放地址：歌曲 id + 音质 → URL（注意是否有签名、有效期）
3. 歌词：歌曲 id → LRC 或逐字歌词

**规则**：
- 只按**实际响应**写字段映射，不许照着"看起来合理"的字段猜；
- 如果拿不到，如实汇报是哪一步、卡在什么错误码，不要编造；
- 任何时候不要在代码或日志里写入账号、cookie、token。

### 3. 实现（模组，不是改宿主）

在 `E:\app develovpment\projects\` 下新建一个干净目录，产出：

```
mod.json          # folia/folium 版本范围、permissions、experimental: ["omni.providers"]
client.mjs        # 注册 provider：search / getAudioUrl / getLyrics
```

要点：
- 网络一律走 `folium.net.fetch`（宿主代发），**不要**用裸 `fetch`；
- `getAudioUrl` 拿不到时返回 `null`，不要抛怪异常（宿主有自己的失败提示）；
- 只有 `getLyrics` 和 `search` 抛错，让宿主显示 toast。

### 4. 验证（不许只靠"看起来对了"）

- 把 provider 的探测结果写进模组存储：`folium.storage.set('probe', JSON.stringify(x))`，
  然后从 `%APPDATA%\Folia\mods-data\<modid>\mod-data.json` 读出来核对——**这是你唯一能"看见"页面内状态的可靠办法**。
- 开发期用热更新：改完 `client.mjs` 相关的 bundle 后写进 `%APPDATA%\Folia\mods-cache\<modid>\`，
  Folia 会在 2 秒内自动重载，不用重装、不用重新确认权限。
- 起 Folia 一律用 `explorer.exe "E:\Folia\Folia.exe"` 启动。
  **绝对不要**在这个会话里用 `Start-Process` 直接起 Folia —— DSH 的 Job Object 会把它连同整个进程树一起杀掉。

### 5. 交付

- 一个能装的 zip（模组目录，别塞无关文件）；
- 一份 `README.md`：怎么装、需要什么权限、已知限制；
- 一份 `NOTES.md`：探测到的接口、字段映射、失败码含义、还没做的部分。

---

## 硬约束（违反会浪费时间）

1. **不改 `app.asar`**（除了我明确说"这次必须改"）。
2. **不在代码里内置任何账号、cookie、token、密钥**；不绕过付费。
3. **不写死"官方 API"**：这是逆向出来的接口，随时可能变，要在 NOTES 里写清"可能失效"。
4. **不依赖 DSH 会话**：所有脚本要能脱离 DSH 单独跑；长驻进程用 explorer 或计划任务启动。
5. **不猜字段**：响应里没有的字段就不写；拿不到就说拿不到。
6. PowerShell 写文件一律 `UTF8Encoding($false)`（无 BOM）；`.ps1` 带中文时反过来要 **UTF-8 with BOM**。
7. 复杂脚本写成 `.mjs` 文件再跑，别用 `node -e` 拼引号。
8. 大文件（如 124 MB 的 `app.asar`）用 `Buffer.indexOf` 按字节找，别整份转字符串跑正则。

## 遇到问题时的汇报格式

```
现象：<一句话>
证据：<命令 + 输出片段 / 文件路径 + 行号>
我的判断：<…>
需要你确认：<…>
```

不要用"应该可以""大概没问题"这类话。能验证的就去验证。

---

## 背景资料（可选，需要时再读）

如果你需要知道「为什么不能改 asar」「怎么在没有源码的情况下验证」，看这个文件：

`E:\app develovpment\projects\09-folia-emofx\docs\folia-source-handoff.md`

里面是我这一轮实操的全部经验：等长字节替换的括号陷阱、Job Object 导致进程被带走、
模组热更新怎么做、外部读取页面状态的办法、以及一张踩坑清单。
