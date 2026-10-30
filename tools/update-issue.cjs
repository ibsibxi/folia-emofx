// update-issue.cjs —— 把 #77 的版本改成 v0.4.0，并回复作者逐条说明改动
const https = require('https');
const { execSync } = require('child_process');

const token = execSync('git credential fill', {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
}).split('\n').find((l) => l.startsWith('password=')).slice('password='.length).trim();

const call = (method, path, body) => new Promise((resolve, reject) => {
  const payload = body ? JSON.stringify(body) : null;
  const req = https.request({
    hostname: 'api.github.com',
    path,
    method,
    rejectUnauthorized: false,
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'folia',
      'Content-Type': 'application/json',
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
    },
  }, (r) => {
    let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => {
      try { resolve({ status: r.statusCode, json: JSON.parse(d) }); }
      catch { resolve({ status: r.statusCode, json: d }); }
    });
  });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});

const COMMENT = `已按审查意见修改，新 tag \`v0.4.0\`，issue 的「版本」一栏已改为该 tag。

### 1. 不再加载签名范围以外的代码（主要问题）

删掉了 \`index.cjs\` 的 \`ui.get\`：它优先读 \`mods-cache/emofx/ui.bundle.mjs\`，读不到才用模组目录里的副本；\`client.mjs\` 再把文本做成 blob URL 动态 import，并每 2 秒轮询重载。

现在 \`client.mjs\` 直接 \`import './ui.bundle.mjs'\`：**没有 rpc、没有 blob import、没有轮询**，main 入口（\`index.cjs\`）因此一并删除，\`mod.json\` 不再有 \`main\`。

顺带把 \`filesystem.data\` 也去掉了 —— 它原本只为「读缓存 + 写开发配置」服务，两件事都不存在了。现在权限只剩 \`stageLayers\` 和 \`equalizer.control\`。

热更新只在本地开发构建里做，不进提交版本。

### 2. 删除未使用的 React fiber 代码

\`eqwrite.mjs\` 整个文件删除（\`roots\` / \`walk\` / \`findEq\` / \`eqProbe\` / \`writeEq\` / \`probeNames\` / \`probeWithCover\`），连同 UI 里的 import 和探测按钮。

这一版已改走 \`folium.equalizer\`，\`writeEq\` 确实不再被调用 —— 但它会随签名发给所有用户，属于不该存在的代码。

### 3. 删除 window 全局回退与启动自检

\`resolveAudioApi\` 只保留官方 \`folium.equalizer\`：

- 去掉挂在 \`window\` 上的补丁版回退（任何页面脚本都能伪造）；
- 去掉未定型的实验面回退；
- 启动时写 \`apiProbe\` 的自检也删了。

### 4. \`src/\` 移出模组目录

\`mod/emofx/src/\` → \`dev/src/\`，只留在仓库里。构建脚本 \`tools/build_ui.mjs\` 也相应只把产物写到模组目录，不再写 \`mods-cache\`。

### 产物核对

\`v0.4.0\` 的模组目录现在只有 5 个文件：\`client.mjs\`、\`ui.bundle.mjs\`、\`mod.json\`、\`preview.jpg\`、\`LICENSE\`。

对打包产物做了一遍字符串扫描，以下全部为 0：

\`__reactFiber\`、\`__reactInternalInstance\`、\`probeNames\`、\`probeWithCover\`、\`writeEq\`、\`__foliumAudio\`、\`createObjectURL\`、动态 \`import(\`

### 关于 author 字段

\`mod.json\` 里是 \`ibsibxi\`。这个模组早期是和他一起做的，我需要跟他确认后再决定是否保留，暂时先没改。如果这会影响收录，请告诉我，我会在确认后调整并重新打 tag。

---

功能审查如果还有没过的点，先收录到「先行测试」我也接受。`;

(async () => {
  const issue = await call('GET', '/repos/chthollyphile/folium-compound/issues/77');
  if (issue.status !== 200) {
    console.log('✗ 读取 issue 失败:', issue.status);
    return;
  }
  const body = String(issue.json.body || '');
  const before = (body.match(/### 版本 \/ Version \(tag or commit\)\s*\n\s*\n([^\n]*)/) || [])[1];
  console.log('当前版本字段:', JSON.stringify(before));

  const patched = body.replace(
    /(### 版本 \/ Version \(tag or commit\)\s*\n\s*\n)[^\n]*/,
    '$1v0.4.0'
  );
  if (patched === body) {
    console.log('✗ 版本字段没匹配到，未修改');
    return;
  }

  const updated = await call('PATCH', '/repos/chthollyphile/folium-compound/issues/77', { body: patched });
  console.log('版本字段更新:', updated.status === 200 ? '✓ v0.4.0' : '✗ ' + updated.status);

  const commented = await call('POST', '/repos/chthollyphile/folium-compound/issues/77/comments', { body: COMMENT });
  console.log('已回复作者:', commented.status === 201 ? '✓' : '✗ ' + commented.status);
})();
