const fs = require('fs');
const b = fs.readFileSync('E:/Folia/resources/app.asar', 'utf8');
const i = b.indexOf('modId:');
console.log('--- folium 对象成员 ---');
console.log(b.slice(Math.max(0, i - 150), i + 900).replace(/\n/g, ' '));
console.log('');
console.log('--- audio: 出现位置 ---');
let k = -1, n = 0;
while ((k = b.indexOf('audio:', k + 1)) >= 0 && n < 6) {
  n++;
  console.log(k, JSON.stringify(b.slice(k - 70, k + 90)));
}