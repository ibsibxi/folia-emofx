// main 入口：只做一件事——把 mods-cache 里的 UI 包读出来给渲染端。
// 放在 cache 目录是刻意的：cache 不在模组目录内，不在内容指纹里，
// 所以改它不会让宿主撤销「启用确认」，也就实现了热更新。

const fs = require('fs');
const path = require('path');

/** @param {any} api */
module.exports = function activate(api) {
  const file = () => path.join(api.storage.paths.cache, 'ui.bundle.mjs');

  api.rpc.handle('ui.get', async () => {
    try {
      const f = file();
      if (!fs.existsSync(f)) return { ok: false, reason: 'no-bundle' };
      const st = fs.statSync(f);
      return { ok: true, mtime: st.mtimeMs, size: st.size, text: fs.readFileSync(f, 'utf8') };
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) };
    }
  });

  api.log?.info?.('[emofx] main ready; cache =', api.storage.paths.cache);
};
