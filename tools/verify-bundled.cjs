// verify-bundled.cjs —— 用一个隔离进程验证 index.cjs 的两级读取逻辑
const fs = require('fs');
const path = require('path');

const MOD_DIR = path.join(process.env.APPDATA, 'Folia', 'mods', 'emofx');
const CACHE_DIR = path.join(process.env.APPDATA, 'Folia', 'mods-cache', 'emofx');

// 复刻 index.cjs 里的 bundledUiPath
function bundledUiPath() {
  try {
    const dir = MOD_DIR;
    const hit = fs.readdirSync(dir).find((n) => /^ui\.bundle(\.[0-9_]+)?\.mjs$/.test(n));
    return hit ? path.join(dir, hit) : null;
  } catch {
    return null;
  }
}

console.log('模组目录:', MOD_DIR);
console.log('内置副本:', bundledUiPath() || '未找到');

const cacheFile = path.join(CACHE_DIR, 'ui.bundle.mjs');
console.log('cache 文件:', fs.existsSync(cacheFile) ? '存在' : '不存在（模拟市场安装）');

// 直接跑真正的 index.cjs
const api = {
  storage: { paths: { cache: CACHE_DIR } },
  log: { info: () => {} },
  rpc: {
    _handler: null,
    handle(name, fn) { this._handler = fn; },
  },
};

const activate = require(path.join(MOD_DIR, 'index.cjs'));
activate(api);

(async () => {
  const r = await api.rpc._handler();
  if (r.ok) {
    console.log('✓ ui.get 成功');
    console.log('  size:', Math.round(r.size / 1024 * 10) / 10, 'KB');
    console.log('  有 mount 导出:', /export\s*\{[^}]*mount/.test(r.text));
    console.log('  来源:', fs.existsSync(cacheFile) ? 'cache' : '内置副本');
  } else {
    console.log('✗ ui.get 失败:', r.reason);
  }
})();
