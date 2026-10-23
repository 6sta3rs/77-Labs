import { readdirSync } from 'node:fs';
import { existsSync } from 'node:fs';

// Test harnesses sometimes compile source with controlled dependencies. Resolve
// unique filenames without coupling those harnesses to feature folder names.
const root = new URL('../../frontend/src/', import.meta.url);
const sources = new Map();
function scan(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const url = new URL(item.name + (item.isDirectory() ? '/' : ''), directory);
    if (item.isDirectory()) scan(url);
    else {
      const matches = sources.get(item.name) ?? [];
      matches.push(url);
      sources.set(item.name, matches);
    }
  }
}
scan(root);
export function sourceUrl(filename) {
  if (filename.includes('/')) {
    const url = new URL(filename, root);
    if (existsSync(url)) return url;
  }
  const matches = (sources.get(filename) ?? []).filter(url => !url.pathname.includes('/themes/'));
  if (matches?.length !== 1) throw new Error(`Expected one source named ${filename}; found ${matches?.length ?? 0}`);
  return matches[0];
}
