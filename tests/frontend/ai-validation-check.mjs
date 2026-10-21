import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

const compile = path => transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText;
const tagsUrl = `data:text/javascript;base64,${Buffer.from(compile('../../src/lib/tts/tags.ts')).toString('base64')}`;
const source = compile('../../src/lib/tts/ai-validation.ts').replace("'./tags'", JSON.stringify(tagsUrl));
const { validateTaggedTexts } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
validateTaggedTexts(['A. B.', 'Dalej.', ''], ['A. [pause] B.', '[sigh] Dalej.', '']);
for (const [before, after] of [
  [['A.'], ['B.']], [['Tak.'], ['Tak!']], [['Tekst.'], ['[thoughtful] Tekst.']],
  [['A [sigh] B.'], ['[sigh] A B.']], [['A [pause] B.'], ['A B.']],
  [['A'], []], [['A'], [null]], [['a by'], ['aby']],
  [['A.', ''], ['A.', '[sigh]']],
]) assert.throws(() => validateTaggedTexts(before, after));
console.log('AI validation: multi-speaker success plus 9 malformed or destructive responses rejected.');
