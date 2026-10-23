const fs = require('fs');
const buf = fs.readFileSync('E:/Folia/resources/app.asar');
const t = buf.toString('utf8');
const n = t.split('372521584').length - 1;
console.log('372521584 出现次数:', n);
let i = t.indexOf('372521584');
console.log('上下文:', t.slice(Math.max(0, i - 160), i + 80).replace(/\s+/g, ' '));