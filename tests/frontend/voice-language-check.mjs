// Exercise the production helpers without starting the runtime or synthesizing audio.
// Run: node tests/frontend/voice-language-check.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../../frontend/src/voices/voice-picker.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const picker = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const { normalizeVoiceLanguages, voiceLanguageCode, voiceLanguageSupport, voiceLanguageCount, filterVoices, emptyVoiceFilters } = picker;
const voice = (overrides = {}) => ({
  id: 'qa-polish', name: 'Anna', initials: 'A', description: 'Ciepła narracja', language: 'Polish',
  color: 'peach', kind: 'Klonowany', demo: false, ...overrides,
});
const modelLanguages = ['Polish', 'English', 'German', 'French', 'Spanish', 'Italian', 'Portuguese'];
const filters = (overrides = {}) => ({ ...emptyVoiceFilters(), ...overrides });
let passed = 0;
const errors = [];
function check(name, action) {
  try { action(); passed++; console.log(`PASS ${name}`); }
  catch (error) { errors.push(error); console.error(`FAIL ${name}: ${error.message}`); }
}

check('A Polish reference exposes seven model languages with an honest model source', () => {
  assert.deepEqual(voiceLanguageSupport(voice(), modelLanguages), {
    languages: ['Polski', 'Angielski', 'Niemiecki', 'Francuski', 'Hiszpański', 'Włoski', 'Portugalski'],
    source: 'model', sample: 'Polski',
  });
});

check('English filters find a Polish recording when the selected model supports English', () => {
  const rows = [voice()];
  for (const language of ['Angielski', 'English', 'en', 'en-US']) {
    assert.deepEqual(filterVoices(rows, filters({ language }), modelLanguages).map(row => row.id), ['qa-polish']);
  }
  assert.deepEqual(filterVoices(rows, filters({ language: 'Japoński' }), modelLanguages), []);
});

check('Language aliases and locales deduplicate while Auto never increases the count', () => {
  const languages = normalizeVoiceLanguages(['PL', 'Polish', 'polski', 'en', 'English', 'en-US', 'en_GB', 'Auto', 'automatic', 'unknown', '']);
  assert.deepEqual(languages, ['Polski', 'Angielski']);
  assert.equal(voiceLanguageCount(languages.length), '2 języki');
  assert.equal(voiceLanguageCode('  EN_us  '), 'en');
});

check('A narrow selected model never inherits unsupported model languages', () => {
  const result = voiceLanguageSupport(voice(), ['English']);
  assert.deepEqual(result, { languages: ['Angielski'], source: 'model', sample: 'Polski' });
  assert.equal(filterVoices([voice()], filters({ language: 'Polski' }), ['English']).length, 0);
  assert.equal(filterVoices([voice()], filters({ language: 'Angielski' }), ['English']).length, 1);
});

check('Explicit profile languages intersect the selected model rather than expanding', () => {
  const profile = voice({ supportedLanguages: ['Polish', 'English', 'English'] });
  assert.deepEqual(voiceLanguageSupport(profile, ['English', 'German']), {
    languages: ['Angielski'], source: 'profile', sample: 'Polski',
  });
  assert.equal(filterVoices([profile], filters({ language: 'Niemiecki' }), ['English', 'German']).length, 0);
});

check('A disjoint explicit profile and model report no supported language', () => {
  const profile = voice({ supportedLanguages: ['Polish'] });
  assert.deepEqual(voiceLanguageSupport(profile, ['English']), {
    languages: [], source: 'profile', sample: 'Polski',
  });
  assert.deepEqual(filterVoices([profile], filters({ language: 'English' }), ['English']), []);
});

check('Explicit profile metadata remains available when no model metadata exists', () => {
  assert.deepEqual(voiceLanguageSupport(voice({ supportedLanguages: ['pl', 'en-GB', 'Auto'] })), {
    languages: ['Polski', 'Angielski'], source: 'profile', sample: 'Polski',
  });
});

check('A recording language alone remains a sample source without inferred multilingual support', () => {
  assert.deepEqual(voiceLanguageSupport(voice()), { languages: ['Polski'], source: 'sample', sample: 'Polski' });
  assert.deepEqual(filterVoices([voice()], filters({ language: 'English' })), []);
});

check('Automatic, unknown and missing recording languages never fabricate a language', () => {
  for (const language of ['Auto', 'Automatycznie', 'unknown', '']) {
    assert.deepEqual(voiceLanguageSupport(voice({ language })), { languages: [], source: 'sample', sample: '' });
    assert.deepEqual(filterVoices([voice({ language })], filters({ language: 'English' })), []);
  }
});

check('Model language metadata works even when the recording language is unknown', () => {
  assert.deepEqual(voiceLanguageSupport(voice({ language: 'Auto' }), ['English', 'Auto', 'en-US']), {
    languages: ['Angielski'], source: 'model', sample: '',
  });
});

check('Search recognizes Polish and English language names without Polish diacritics', () => {
  for (const query of ['Angielski', 'English', 'angielski Anna', 'wloski', 'Italian']) {
    assert.equal(filterVoices([voice()], filters({ query }), modelLanguages).length, 1, query);
  }
  assert.equal(filterVoices([voice()], filters({ query: 'Japanese' }), modelLanguages).length, 0);
});

check('Language filtering still composes with profile attributes and library selection', () => {
  const rows = [
    voice({ categories: ['Narracja'], gender: 'female', ageGroup: 'adult' }),
    voice({ id: 'qa-demo', categories: ['Narracja'], gender: 'female', ageGroup: 'adult', demo: true }),
    voice({ id: 'qa-male', categories: ['Narracja'], gender: 'male', ageGroup: 'adult' }),
  ];
  assert.deepEqual(filterVoices(rows, filters({ language: 'English', categories: ['Narracja'], kind: 'Klonowany', gender: 'female', ageGroup: 'adult', library: true }), modelLanguages).map(row => row.id), ['qa-polish']);
});

check('Polish language-count labels remain correct around teen and decade boundaries', () => {
  for (const [count, label] of [[0, '0 języków'], [1, '1 język'], [2, '2 języki'], [4, '4 języki'], [5, '5 języków'], [12, '12 języków'], [14, '14 języków'], [21, '21 języków'], [22, '22 języki'], [24, '24 języki'], [112, '112 języków']]) {
    assert.equal(voiceLanguageCount(count), label);
  }
});

check('Two-letter and bibliographic/terminological ISO codes identify the same languages', () => {
  assert.deepEqual(normalizeVoiceLanguages(['en', 'eng', 'English', 'pl', 'pol', 'Polski', 'de', 'deu', 'ger', 'fr', 'fra', 'fre']), ['Angielski', 'Polski', 'Niemiecki', 'Francuski']);
  const profile = voice({ supportedLanguages: ['eng', 'pol'] });
  assert.deepEqual(voiceLanguageSupport(profile, ['en-US', 'pl-PL']).languages, ['Angielski', 'Polski']);
});

check('Arbitrary metadata and non-language codes never inflate capabilities or sample counts', () => {
  const invalid = ['not-a-language', 'banana', 'English-ish', 'zz', 'zzz', '123', 'en--US', 'en-!', 'und', 'mul', 'zxx', 'x-private'];
  assert.deepEqual(normalizeVoiceLanguages(invalid), []);
  for (const language of invalid) {
    assert.equal(voiceLanguageCode(language), '', language);
    assert.deepEqual(voiceLanguageSupport(voice({ language })), { languages: [], source: 'sample', sample: '' });
  }
});

check('Valid regional, script, extension and uncommon BCP47 language tags remain usable', () => {
  for (const [value, code] of [['en-Latn-US', 'en'], ['pt_BR', 'pt'], ['sr-Cyrl-RS', 'sr'], ['zh-Hant-TW', 'zh'], ['de-DE-u-co-phonebk', 'de'], ['ace-ID', 'ace'], ['yue-Hant-HK', 'yue']]) {
    assert.equal(voiceLanguageCode(value), code, value);
    assert.equal(normalizeVoiceLanguages([value]).length, 1, value);
  }
});

check('Real uncommon languages from the bundled engine survive validation and round trips', () => {
  for (const [name, code] of [['Abadi', 'kbt'], ['Fe\'fe\'', 'fmp'], ['Dũya', 'ldb'], ['Santa Ana de Tusi Pasco Quechua', 'qxt'], ['Ömie', 'aom']]) {
    assert.equal(voiceLanguageCode(name), code, name);
    const normalized = normalizeVoiceLanguages([name, code]);
    assert.equal(normalized.length, 1, name);
    assert.equal(voiceLanguageCode(normalized[0]), code, name);
  }
});

check('Distinct engine languages remain distinct when CLDR gives them the same label', () => {
  const languages = normalizeVoiceLanguages(['Goan Konkani', 'Konkani']);
  assert.equal(languages.length, 2);
  assert.notEqual(languages[0], languages[1]);
  assert.deepEqual(languages.map(voiceLanguageCode), ['kok', 'knn']);
});

check('Corrupt languages cannot create a language filter option beside valid model data', () => {
  assert.deepEqual(voiceLanguageSupport(voice({ language: 'not-a-language' }), ['English', 'banana', 'eng', 'Auto']), {
    languages: ['Angielski'], source: 'model', sample: '',
  });
  assert.equal(filterVoices([voice()], filters({ language: 'not-a-language' }), ['English', 'banana']).length, 0);
});

check('Available attribute filters contain only explicit metadata present in this library', () => {
  assert.deepEqual(picker.availableVoiceFilters([voice()]), { categories: [], genders: [], ageGroups: [] });
  assert.deepEqual(picker.availableVoiceFilters([
    voice({ categories: ['Podcast', 'Narracja', 'Podcast', '', '  '], gender: 'male', ageGroup: 'mature' }),
    voice({ categories: ['Edukacja'], gender: 'female', ageGroup: 'adult' }),
    voice({ gender: 'invalid', ageGroup: 'invalid' }),
  ]), { categories: ['Narracja', 'Edukacja', 'Podcast'], genders: ['female', 'male'], ageGroups: ['adult', 'mature'] });
});

check('Engine language options list every engine language once, popular group first', () => {
  const options = picker.engineLanguageOptions();
  assert.ok(options.length > 600, `expected the full engine map, got ${options.length}`);
  assert.equal(new Set(options.map(option => option.value)).size, options.length);
  assert.equal(options[0].group, 'Popularne');
  const firstRest = options.findIndex(option => option.group !== 'Popularne');
  assert.ok(firstRest > 0 && options.slice(firstRest).every(option => option.group === options[firstRest].group));
  assert.equal(options.find(option => option.value === 'pl')?.label, 'Polski');
  assert.equal(picker.engineLanguageOptions(), options, 'computed once');
});

if (errors.length) { console.error(`Voice languages: ${errors.length} failed, ${passed} passed.`); process.exitCode = 1; }
else console.log(`Voice languages: all ${passed} regression groups passed.`);
