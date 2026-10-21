/** Minimal App-only staging transform. Never writes the shared worktree. */
import ts from 'typescript';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function transformAppReadiness(source) {
  const old = "if(!model?.available || !model.installed) throw new Error(model?.reason || 'Ten silnik nie jest dostępny do wyboru.');";
  const next = "if(!model || (!model.available || !model.installed) && !model.canVerify) throw new Error(model?.reason || 'Ten silnik nie jest dostępny do wyboru.');";
  if (source.includes(next)) return source;
  if (source.includes('needsEngineVerification(ttsFamily?.backends.find')) return source;
  if (source.includes(old)) {
    if (source.split(old).length !== 2) throw new Error('Niejednoznaczny guard modelu; nie zmieniono pliku.');
    return source.replace(old, next);
  }
  const match = source.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Brak skryptu App.');
  const script = match[1], offset = source.indexOf(script);
  const tree = ts.createSourceFile('App.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const action = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'selectGenerationEngine');
  if (!action || !ts.isIdentifier(action.parameters[0]?.name)) throw new Error('Nieobsługiwany wariant App; zastosuj jawny mikrohunk ręcznie.');
  const id = action.parameters[0].name.text, edits = [];
  function visit(node) {
    if (ts.isIfStatement(node)) {
      const condition = node.expression.getText(tree);
      const compact = condition.replace(/\s/g, '');
      if ([`${id}===generationEngine`, `generationEngine===${id}`].includes(compact)) {
        edits.push({ start: offset + node.expression.getStart(tree), end: offset + node.expression.end,
          value: `(${condition}) && !needsEngineVerification(ttsFamily?.backends.find(engine => engine.id === ${id}) ?? {})` });
      } else {
        const guard = /^!([a-zA-Z_$][\w$]*)\??\.available$/.exec(compact);
        if (guard) edits.push({ start: offset + node.expression.getStart(tree), end: offset + node.expression.end,
          value: `${condition} && !needsEngineVerification(${guard[1]} ?? {})` });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(action);
  if (!edits.length) throw new Error('Brak rozpoznanego guardu w selectGenerationEngine; nie zmieniono pliku.');
  for (const edit of edits.sort((a,b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  const scriptStart = source.indexOf(script.slice(0, Math.min(30, script.length)));
  if (!source.includes("from './lib/models/engine-readiness'")) source = source.slice(0, scriptStart) + "\n  import { needsEngineVerification } from './lib/models/engine-readiness';\n" + source.slice(scriptStart);
  return source;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), input = args[args.indexOf('--input') + 1], output = args[args.indexOf('--output') + 1];
  if (!args.includes('--input') || !args.includes('--output') || !input || !output) throw new Error('Użyj --input <snapshot App> --output <nowy plik w .tmp>.');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), destination = resolve(output);
  const local = relative(resolve(root, '.tmp'), destination);
  if (!local || isAbsolute(local) || local.startsWith('..') || resolve(input) === destination) throw new Error('Output musi być nowym snapshotem w repo/.tmp, poza współdzielonym App.');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, transformAppReadiness(await readFile(resolve(input), 'utf8')), { encoding: 'utf8', flag: 'wx' });
}
