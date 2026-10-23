// Fails when the built interface (dist/assets) outgrows its budget. Run after `npm run build`: npm run test:bundle.
// Budgets are in tools/dev/bundle-budget.json (bytes, about 5% above the measured size on 23 October 2026). Raise one only with a reason;
// lower it when the build shrinks by more than 10% (the script says so).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const assets = join(root, 'dist/assets');
const budget = JSON.parse(readFileSync(join(import.meta.dirname, 'bundle-budget.json'), 'utf8'));
const files = readdirSync(assets).map(name => ({ name, size: statSync(join(assets, name)).size }));
const size = prefix => files.filter(file => file.name.startsWith(prefix) && file.name.endsWith('.js')).reduce((sum, file) => sum + file.size, 0);
const measured = {
  entryChunk: size('index-'),
  appChunk: size('App-'),
  totalJs: files.filter(file => file.name.endsWith('.js')).reduce((sum, file) => sum + file.size, 0),
  totalCss: files.filter(file => file.name.endsWith('.css')).reduce((sum, file) => sum + file.size, 0),
};
let failed = false;
for (const [key, limit] of Object.entries(budget.bytes)) {
  const value = measured[key];
  const state = value === 0 ? 'MISSING (chunk renamed?)' : value > limit ? 'OVER' : value < limit * 0.9 / 1.05 ? 'lower the budget' : 'ok';
  if (value > limit || value === 0) failed = true;
  console.log(`${key.padEnd(11)} ${String(value).padStart(9)} / ${limit}  ${state}`);
}
if (failed) { console.error('Bundle budget exceeded (tools/dev/bundle-budget.json).'); process.exit(1); }
