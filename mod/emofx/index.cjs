// main 入口：把 UI 包读出来给渲染端。
//
// 两个来源，按顺序：
//   1. mods-cache 里的 ui.bundle.mjs —— 热更新用。cache 不在模组目录内、不在内容指纹里，
//      所以改它不会让宿主撤销「启用确认」，改完不用重启 Folia。
//   2. 模组目录里的内置副本 —— 从 folium-compound 安装时没有 cache，靠这一份才能用。
//      打包会把非入口 .mjs 加版本后缀（ui.bundle.0_3_1.mjs），所以按前缀找。
//
// cache 优先：开发者改了 UI 立刻生效；普通用户没碰过 cache，用内置那份。

const fs = require('fs');
const path = require('path');

/** 模组目录里的内置 UI 包；打包后文件名带版本后缀，按前缀匹配。 */
function bundledUiPath() {
  try {
    const dir = __dirname;
    const hit = fs.readdirSync(dir).find((n) => /^ui\.bundle(\.[0-9_]+)?\.mjs$/.test(n));
    return hit ? path.join(dir, hit) : null;
  } catch {
    return null;
  }
}

/** @param {any} api */
module.exports = function activate(api) {
  const cacheFile = () => path.join(api.storage.paths.cache, 'ui.bundle.mjs');

  /** 读一个文件并返回宿主需要的结构；读不到返回 null。 */
  const read = (f) => {
    if (!f || !fs.existsSync(f)) return null;
    const st = fs.statSync(f);
    return { ok: true, mtime: st.mtimeMs, size: st.size, text: fs.readFileSync(f, 'utf8') };
  };

  api.rpc.handle('ui.get', async () => {
    try {
      // 1) cache（热更新）
      const hot = read(cacheFile());
      if (hot) return hot;

      // 2) 内置副本（正常安装的情况）
      const built = read(bundledUiPath());
      if (built) return built;

      return { ok: false, reason: 'no-bundle' };
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) };
    }
  });

  api.log?.info?.('[emofx] main ready; cache =', api.storage.paths.cache);
};
