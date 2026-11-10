// Lists each P0 story's acceptance criteria count and the tests tagged with its WR id
// (qa/test-strategy.md › Working with developer agents, step 5).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const stories = join('..', 'docs', 'stories');
const tests = [];
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.test\.tsx?$/.test(f)) tests.push(readFileSync(p, 'utf8'));
  }
}
walk('test');
const all = tests.join('\n');
let missing = 0;
for (const f of readdirSync(stories).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
  const text = readFileSync(join(stories, f), 'utf8');
  const wr = text.match(/Backlog id: \*\*(WR-\d+)\*\* · Priority: \*\*(P\d)\*\*/);
  if (!wr) continue;
  const [, id, prio] = wr;
  const criteria = (text.split('## Acceptance Criteria')[1] ?? '').split('##')[0].match(/^\d+\. /gm)?.length ?? 0;
  const tagged = (all.match(new RegExp(`['"\`]${id}[:\\s]`, 'g')) ?? []).length;
  const flag = prio === 'P0' && tagged === 0 ? '  <-- no tests' : '';
  if (flag) missing++;
  console.log(`${id} ${prio} ${f.padEnd(60)} criteria: ${criteria}  tests: ${tagged}${flag}`);
}
if (missing) {
  console.log(`\n${missing} P0 stories without tagged tests`);
  process.exitCode = 1;
}
