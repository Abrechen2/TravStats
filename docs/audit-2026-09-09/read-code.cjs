// Read-only audit view. Retains line numbers; omits block comments and blank/comment-only lines.
const fs = require('node:fs');
for (const p of process.argv.slice(2)) {
  const source = fs.readFileSync(p, 'utf8');
  const lines = source.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).split(/\r?\n/);
  console.log('FILE ' + p);
  lines.forEach((line, index) => {
    if (line.trim() && !line.trim().startsWith('//')) console.log(`${index + 1}:${line}`);
  });
}
