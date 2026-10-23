const fs = require('fs');
const buf = fs.readFileSync('E:/Folia/resources/app.asar');
const text = buf.toString('utf8');
const pats = ['k_e=', 'k_e =', 'N2=', 'const k_e'];
for (const p of pats) {
  let i = -1, n = 0;
  while ((i = text.indexOf(p, i + 1)) >= 0 && n < 4) {
    n++;
    console.log(`[${p}] @${i}`);
    console.log('   ' + text.slice(i, i + 220).replace(/\s+/g, ' '));
  }
  if (n === 0) console.log(`[${p}] 没找到`);
}