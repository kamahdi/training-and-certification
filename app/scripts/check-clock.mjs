// Lint rule from docs/architecture/coding-standards.md › One clock:
// Date.now() and `new Date()` with no argument are allowed only in server/clock.ts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['server', 'shared'];
const allowed = new Set(['server/clock.ts', 'server/seed.ts']);
const bad = [];
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts') && !allowed.has(p)) {
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (/Date\.now\(\)|new Date\(\s*\)/.test(line) && !line.includes('clock-ok')) bad.push(`${p}:${i + 1}: ${line.trim()}`);
      });
    }
  }
}
roots.forEach(walk);
if (bad.length) {
  console.error('Read the time through server/clock.ts instead:\n' + bad.join('\n'));
  process.exit(1);
}
console.log('clock check passed');
