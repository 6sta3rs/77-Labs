/** userMessage(): technical errors become Polish text, readable Polish passes, nothing leaks stack traces or class names. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const js = ts.transpileModule(await readFile(new URL('../../src/lib/platform/user-message.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { userMessage } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const F = 'Fallback.';
const abort = new Error('This operation was aborted'); abort.name = 'AbortError';
assert.equal(userMessage(abort, F), 'Operację anulowano.');
assert.equal(userMessage(new TypeError('Failed to fetch'), F), 'Nie można połączyć się z silnikiem. Sprawdź, czy działa, i spróbuj ponownie.');
assert.match(userMessage(new Error('HTTP 500 Internal Server Error'), F), /błąd wewnętrzny/);
assert.match(userMessage(new Error('Not Found'), F), /Nie znaleziono/);
assert.match(userMessage(new SyntaxError('Unexpected token < in JSON at position 0'), F), /nieprawidłową odpowiedź/);
assert.equal(userMessage(new Error('Traceback (most recent call last):\n  File "x.py", line 3\nValueError: bad'), F), F);
assert.equal(userMessage(new Error('CudaOutOfMemoryError: oops'), F), F);
assert.equal(userMessage(new Error('Plugin failed to load: missing manifest'), F), F);
assert.equal(userMessage(new TypeError("Cannot read properties of undefined (reading 'x')"), F), F);
assert.equal(userMessage('Nie udało się zapisać pliku.', F), 'Nie udało się zapisać pliku.');
assert.equal(userMessage(new Error('Zakończ generowanie przed restartem silnika.'), F), 'Zakończ generowanie przed restartem silnika.');
assert.equal(userMessage(undefined, F), F);
assert.equal(userMessage({ weird: true }, F), F);
for (const e of [new Error('x.py line 3'), new Error('at foo (bar.js:1:2)')]) assert.equal(userMessage(e, F), F);
console.log('PASS user message mapping');
