# Folia · AI 情绪调音（emofx）

一个 Folia 模组：按当前歌曲的低/中/高频形判断情绪，查流派表得到一条 10 段 EQ 曲线，
实时画出来，并通过 Folia 官方的 `folium.equalizer` 接口写进宿主的图形均衡器。

> 需要 Folia **0.7.22** 或更高（`folium.equalizer` 是 Folium 1.7 新增的接口）。

## 它做什么

1. 取当前歌曲的频段能量（低/中/高），算出一组形状特征
2. 用这组特征匹配「情绪」，再结合流派查表得到目标曲线
3. 曲线画成折线图，跟着歌曲实时移动
4. 通过 `folium.equalizer.applyCurve()` 写入宿主 EQ

## 为什么走官方 equalizer 接口

早期版本是扫 React fiber 找到 settings store 的 setter，直接改 `customSlots` 和
`enabled`。那套做法有三个问题（folium-compound #819 里作者指出过）：

| 问题 | 后果 |
|---|---|
| 写用户的自定义槽 | 按歌自动切换会反复覆盖用户自己调好的设置 |
| 顺手把总开关设为 true | 会带出用户没打算听的效果链 |
| 依赖 React 内部结构 | Folia 一升级就静默失效 |

现在改为官方接口：

- 曲线作为独立一层放上去，**不碰用户的自定义槽，不动总开关**
- 曲线单独存储，重启后保留；用户在音频效果器面板里能**一键换回**自己的音效
- 面板开着时写入被拒绝（`panel-open`），**用户始终优先**
- 监听到曲线被换走时**让步**，不抢回来

官方接口每秒最多 1 次、每分钟最多 20 次「有变化的写入」，所以客户端做了 1.1 秒
节流，并在被拒时显示「等待中」而不是报错。

## 目录

```
mod/emofx/          模组本体（提交时 path = mod/emofx）
├── mod.json
├── client.mjs      渲染端入口：挂载界面、轮询热更新
├── index.cjs       主进程入口：把 UI 包读出来给渲染端
├── ui.bundle.mjs   构建产物：拼好的 UI 包（内置副本）
├── preview.jpg     模组市场介绍图（1280×720）
├── LICENSE
└── src/            源码（不打包，仅供审查/修改）
tools/              构建与打包脚本
assets/             宣传图源文件
```

### UI 包为什么要内置一份

模组原本把 UI 包放在 `mods-cache`，改完不用重启也不用重新确认——开发时很方便。
但从模组市场安装时没有 cache，只有内置副本才能显示界面。所以 `index.cjs` 做了
两级读取：**先 cache**（热更新优先），**缺失时读模组目录里的内置副本**。

## 构建

```bash
node tools/build_ui.mjs    # 把 src/ 拼成 ui.bundle.mjs（同时写 cache 和模组目录）
node tools/pack_mod.mjs    # 打成 dist/emofx-<version>.zip
```

打包会把非入口 `.mjs` 加版本后缀（`ui.bundle.0_3_1.mjs`），用来绕开宿主的 ESM 缓存。

## 许可证

MIT，见 [LICENSE](LICENSE)。
