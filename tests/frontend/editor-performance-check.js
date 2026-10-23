// Open /tools/preview/editor-performance.html on the dev server, then call this module.
export async function runEditorPerformanceCheck() {
  const harness = window.__editorPerformanceHarness;
  if (!harness) throw Error('Open the isolated editor-performance.html harness first.');
  const checks = [], measure = {}, check = (name, pass) => { checks.push({ name, passed: Boolean(pass) }); if (!pass) throw Error(name); };
  const frame = () => new Promise(resolve => { const timer = setTimeout(resolve, 100); requestAnimationFrame(() => { clearTimeout(timer); resolve(); }); });
  const input = () => document.querySelector('.speech-input');
  const type = async (field, text, type = 'insertText') => {
    field.focus(); field.setSelectionRange(field.value.length, field.value.length);
    field.dispatchEvent(new InputEvent('beforeinput', { inputType: type, data: text, bubbles: true, cancelable: true }));
    field.value += text;
    field.setSelectionRange(field.value.length, field.value.length);
    field.dispatchEvent(new InputEvent('input', { inputType: type, data: text, bubbles: true }));
    await harness.tick();
  };
  const key = async (field, key, shiftKey = false) => { field.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey, bubbles: true, cancelable: true })); await harness.tick(); };
  try {
    const large = Array.from({ length: 64 }, (_, i) => ({ id: `editor-qa-${i}`, voiceId: 'qa-voice', text: `Mówca ${i}. ` + 'Długa narracja po polsku. '.repeat(120) }));
    await harness.replace(large); await frame(); await frame();
    const field = input(), original = field.value;
    const stringify = JSON.stringify;
    let serializations = 0;
    const durations = [];
    try {
      JSON.stringify = function(value, ...args) { if (Array.isArray(value) && value[0]?.id?.startsWith('editor-qa-')) serializations++; return stringify.call(JSON, value, ...args); };
      for (let i = 0; i < 40; i++) { const start = performance.now(); await type(field, 'x'); durations.push(performance.now() - start); }
    } finally { JSON.stringify = stringify; }
    durations.sort((a,b) => a-b);
    measure.typing = { documentCharacters: large.reduce((total, block) => total + block.text.length, 0), edits: durations.length, medianMs: durations[Math.floor(durations.length / 2)], p95Ms: durations[Math.floor(durations.length * .95)], fullDocumentSerializations: serializations };
    check('Typing never serializes every speaker and text', serializations === 0);
    check('Typing preserves all other speaker content', harness.read().slice(1).every((block, index) => block.text === large[index + 1].text));
    check('Grouped undo restores the complete original text', (await key(field, 'z'), harness.read()[0].text === original));
    check('Redo restores every inserted character', (await key(field, 'z', true), harness.read()[0].text === original + 'x'.repeat(40)));

    await harness.replace([{ id: 'editor-qa-0', voiceId: 'qa-voice', text: 'Jeden dwa' }]);
    const selected = input(); selected.focus(); selected.setSelectionRange(6,9); selected.dispatchEvent(new Event('select', { bubbles: true }));
    await harness.editor().insertTag('[sigh]'); await harness.tick();
    check('Tag insertion preserves the selected range and caret', input().value === 'Jeden [sigh]' && input().selectionStart === 12);
    await key(input(), 'z');
    check('Tag undo restores original text and selection', input().value === 'Jeden dwa' && input().selectionStart === 6 && input().selectionEnd === 9);
    await harness.editor().applyAutomaticTags([{ id: 'editor-qa-0', voiceId: 'qa-voice', text: 'Jeden [pause]dwa' }]); await harness.tick();
    harness.editor().undoAutoTag(); await harness.tick();
    check('Automatic tags can be reverted exactly', input().value === 'Jeden dwa');
    await harness.replace([{ id: 'editor-qa-0', voiceId: 'qa-other', text: 'Zewnętrzna podmiana.' }]);
    await key(input(), 'z');
    check('External document or voice replacement clears stale undo', input().value === 'Zewnętrzna podmiana.');
    await type(input(), '!', 'insertCompositionText');
    check('Composed text survives the controlled editor update', input().value === 'Zewnętrzna podmiana.!');
    await harness.replace([{ id: 'editor-qa-0', voiceId: 'qa-voice', text: '['.repeat(30000) }]);
    const start = performance.now(); await type(input(), '['); await frame();
    measure.unclosedTagEditMs = performance.now() - start;
    check('A long malformed tag remains visible and editable', input().value.length === 30001 && document.querySelector('.highlight-layer').textContent.length === 30001);
    await harness.replace([{ id: 'editor-qa-0', voiceId: 'qa-voice', text: 'Linia\n'.repeat(100) }]); await frame(); await frame();
    check('Textarea grows to fit long multiline text', input().clientHeight >= input().scrollHeight - 1);
    await harness.replace([{ id: 'editor-qa-0', voiceId: 'qa-voice', text: 'Krótko.' }]); await frame(); await frame();
    check('Textarea shrinks after replacing a long text', input().clientHeight < 180);
    await harness.disable(true);
    check('Disabled editor retains its document', input().disabled && harness.read()[0].text === 'Krótko.');
    await harness.disable(false);
    return { passed: checks.length, checks, measure };
  } catch (error) { return { error: String(error), checks, measure }; }
}
