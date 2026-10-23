// Release notes for one version from CHANGELOG.md: the "Update notes (Polish):" line when the section has one, else the whole section.
// Usage: node tools/release/changelog-notes.mjs <version>   (prints the notes; exits 1 when the version has no section)
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Notes for `version` from the changelog text, or undefined when there is no `## <version>` section. */
export function changelogNotes(text, version) {
  const heading = new RegExp(`^## ${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: - .*)?$`, 'm').exec(text);
  if (!heading) return undefined;
  const rest = text.slice(heading.index + heading[0].length);
  const section = rest.slice(0, rest.search(/^## /m) === -1 ? undefined : rest.search(/^## /m)).trim();
  return section.match(/^Update notes \(Polish\):\s*(.+)$/m)?.[1].trim() ?? section;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  const notes = version && changelogNotes(readFileSync(join(resolve(import.meta.dirname, '../..'), 'CHANGELOG.md'), 'utf8'), version);
  if (!notes) { console.error(`CHANGELOG.md has no section for ${version ?? '(no version given)'}.`); process.exit(1); }
  console.log(notes);
}
