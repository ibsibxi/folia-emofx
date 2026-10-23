const fs = require('fs');
const buf = fs.readFileSync('E:/Folia/resources/app.asar');
for (const needle of ['qqGroup', 'communityQq', 'qqGroupNumber', 'QQ_GROUP', 'qq_group']) {
  const bytes = Buffer.from(needle, 'utf8');
  let from = 0, n = 0;
  while (n < 6) {
    const idx = buf.indexOf(bytes, from);
    if (idx < 0) break;
    from = idx + bytes.length;
    n++;
    const s = Math.max(0, idx - 100);
    const text = buf.subarray(s, Math.min(buf.length, idx + 180)).toString('utf8').replace(/[\u0000-\u001f]/g, ' ');
    console.log(`[${needle}] @${idx}`);
    console.log('   ' + text.replace(/\s+/g, ' ').slice(0, 260));
  }
}