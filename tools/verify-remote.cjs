// verify-remote.cjs —— 核对 v0.4.0 在远端的内容是否符合安全审查要求
const https = require('https');
const { execSync } = require('child_process');

const token = execSync('git credential fill', {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
}).split('\n').find((l) => l.startsWith('password=')).slice('password='.length).trim();

const get = (path) => new Promise((resolve, reject) => {
  https.get({
    hostname: 'api.github.com',
    path,
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'folia' },
    rejectUnauthorized: false,
  }, (r) => {
    let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => resolve(JSON.parse(d)));
  }).on('error', reject);
});

(async () => {
  const tag = await get('/repos/ibsibxi/folia-emofx/git/ref/tags/v0.4.0');
  console.log('tag v0.4.0 →', tag.object ? tag.object.sha.slice(0, 7) : '未找到');

  const files = await get('/repos/ibsibxi/folia-emofx/contents/mod/emofx?ref=v0.4.0');
  if (!Array.isArray(files)) {
    console.log('✗ 目录读取失败:', JSON.stringify(files).slice(0, 200));
    return;
  }
  console.log('\nmod/emofx 内容:');
  for (const f of files) {
    console.log('  ' + f.name + (f.type === 'dir' ? '  (目录)' : '  ' + Math.round(f.size / 1024) + ' KB'));
  }

  const manifest = await get('/repos/ibsibxi/folia-emofx/contents/mod/emofx/mod.json?ref=v0.4.0');
  const json = JSON.parse(Buffer.from(manifest.content, 'base64').toString());
  console.log('\nmod.json:');
  console.log('  version   =', json.version);
  console.log('  author    =', json.author);
  console.log('  main      =', json.main === undefined ? '（已删除）✓' : json.main);
  console.log('  permissions =', JSON.stringify(json.permissions));

  const problems = [];
  if (json.main) problems.push('仍有 main 入口');
  if ((json.permissions || []).includes('filesystem.data')) problems.push('仍声明 filesystem.data');
  if (files.some((f) => f.name === 'src')) problems.push('mod 目录里仍有 src/');
  if (files.some((f) => f.name === 'index.cjs')) problems.push('index.cjs 仍存在');

  console.log('\n判定:', problems.length === 0 ? '✓ 全部符合要求' : '✗ ' + problems.join('；'));
})();
