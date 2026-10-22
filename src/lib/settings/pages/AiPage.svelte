<script lang="ts">
  // "AI i klucze": LLM providers (engine registry + the Codex/ChatGPT account), AI functions (engine LLM skills),
  // editor tagging (Codex), dictation refinement, translators (private credentials) and the OpenAI-compatible ASR server.
  // Port of the approved prototype (.tmp/settings-redesign/svelte/AiPage.svelte); every value comes from the engine.
  import { onDestroy, tick, untrack } from 'svelte';
  import { Plus, Save, LoaderCircle, Sparkles, Check, KeyRound } from '@lucide/svelte';
  import { uiLanguage, createUiTranslator } from '../../i18n';
  import Button from '../../ui/Button.svelte';
  import ButtonGroup from '../../ui/ButtonGroup.svelte';
  import Select from '../../ui/Select.svelte';
  import Tooltip from '../../ui/Tooltip.svelte';
  import Switch from '../../ui/Switch.svelte';
  import Input from '../../ui/Input.svelte';
  import StatusBadge, { type BadgeKind } from '../../ui/StatusBadge.svelte';
  import ProviderIcon from '../../ui/ProviderIcon.svelte';
  import { toast } from '../../ui/toast';
  import ModelPicker, { type PickGroup } from './ModelPicker.svelte';
  import { productionJson, postJson } from '../../tools/production/production';
  import { skillLabels, connectionMessage, type LlmProvider, type LlmSkill, type RefinementSettings, type AsrEndpoint, type ConnectionResult } from '../general-settings';
  import { putSettings, settingsError, type CredentialState } from '../system-settings';
  import { getAISettings, getAIStatus, saveAISettings, testAI, type AISettings, type AIStatus } from '../../tts/ai';
  const tr = $derived(createUiTranslator($uiLanguage));

  let { ready, intent = '', onnavigate }: { ready: boolean; intent?: string; onnavigate?: (id: string, intent?: string) => void } = $props();

  /* ---------- helpers ---------- */
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  let disposed = false;
  const abort = new AbortController();
  onDestroy(() => { disposed = true; abort.abort(); timers.forEach(clearTimeout); });
  const signal = abort.signal;
  let flashed = $state<Record<string, boolean>>({});
  function flash(key: string) { flashed[key] = true; later(() => flashed[key] = false, 1800); }
  let armed = $state<Record<string, boolean>>({});
  const armTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  function arm(key: string, fn: () => void) {
    if (armed[key]) { clearTimeout(armTimers[key]); armed[key] = false; fn(); return; }
    armed[key] = true; armTimers[key] = later(() => armed[key] = false, 4000);
  }
  const urlOk = (u: string) => /^https?:\/\/\S+$/i.test(u.trim());
  const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };
  const pl = (n: number, one: string, few: string, many: string) => n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
  const fail = (cause: unknown) => { if (!disposed && !signal.aborted) toast.bad(tr(settingsError(cause))); };
  const enc = encodeURIComponent;

  /* ---------- tabs ---------- */
  type Tab = 'llm' | 'trans' | 'funkcje';
  const tabs: [Tab, string][] = [['llm', 'Modele językowe'], ['trans', 'Tłumaczenie i rozpoznawanie'], ['funkcje', 'Funkcje AI']];
  let tab = $state<Tab>('llm');

  /* ---------- engine data ---------- */
  type Prov = LlmProvider & { transport?: string; supports_model_listing?: boolean; has_api_key?: boolean; activation_blocked?: boolean };
  type Providers = { active?: string | null; engine_active?: string; engine_from_env?: boolean; providers: Prov[] };
  let all = $state.raw<Prov[]>([]), active = $state(''), pinned = $state(false);
  let skills = $state.raw<LlmSkill[]>([]);
  let refinement = $state<RefinementSettings>();
  let asrSaved = $state<AsrEndpoint>();
  let creds = $state<CredentialState>();
  let loaded = $state(false), loading = $state(false), failed = $state<string[]>([]);
  // Session-only check results (the engine does not persist health).
  let health = $state<Record<string, 'ok' | 'bad'>>({});
  function accept(data: Providers) { all = data.providers; active = data.active || ''; pinned = !!data.engine_from_env; }
  const readProviders = async () => accept(await productionJson<Providers>('/api/settings/llm-providers', { signal }));
  const readSkills = async () => { skills = (await productionJson<{ skills: LlmSkill[] }>('/api/settings/llm-skills', { signal })).skills; };

  async function load() {
    loading = true;
    const parts: [string, () => Promise<unknown>][] = [
      ['dostawców LLM', readProviders], ['funkcji LLM', readSkills],
      ['redakcji dyktowania', async () => { refinement = await productionJson<RefinementSettings>('/api/settings/dictation-refinement', { signal }); }],
      ['zewnętrznego ASR', async () => { asrSaved = await productionJson<AsrEndpoint>('/api/settings/asr-openai-compat', { signal }); asrSync(); }],
      ['tłumaczy', async () => { creds = await productionJson<CredentialState>('/next/settings/credentials', { signal }); svcSync(); }]];
    const results = await Promise.allSettled(parts.map(([, run]) => run()));
    if (disposed) return;
    failed = parts.flatMap(([label], i) => results[i].status === 'rejected' ? [label] : []);
    loaded = true; loading = false;
    void refreshAi();
  }
  $effect(() => { if (ready && !loaded && !loading) untrack(() => void load()); });
  $effect(() => { if (!ready) untrack(() => { loaded = false; ed = null; }); });

  /* ---------- ChatGPT account through Codex (tagging; one session shared by the whole app) ---------- */
  const CHATGPT = 'chatgpt';
  let aiSet = $state<AISettings>(), aiStat = $state<AIStatus>(), aiLoading = $state(false), aiErr = $state('');
  const gptOk = $derived(!!aiStat?.connected);
  const codexModels = $derived(aiStat?.models.map(m => m.id) ?? []);
  async function refreshAi() {
    if (aiLoading) return false;
    aiLoading = true; aiErr = '';
    try { const [s, st] = await Promise.all([getAISettings(signal), getAIStatus(signal)]); if (disposed) return false; aiSet = s; aiStat = st; return true; }
    catch (cause) { if (!disposed && !signal.aborted) { aiStat = undefined; aiErr = cause instanceof Error ? cause.message : String(cause); } return false; }
    finally { if (!disposed) aiLoading = false; }
  }

  /* ---------- provider rows ---------- */
  // CLI agents other than Claude Code are not in the approved design (they behave the same: not detected in this app).
  const HIDDEN = new Set(['codex-cli', 'pi-cli', 'opencode-cli']);
  const ICON: Record<string, string> = { 'google-ai': 'gemini', 'claude-code': 'anthropic', [CHATGPT]: 'openai' };
  const ALIAS: Record<string, string> = { gemini: 'google-ai', claudecode: 'claude-code' };
  const NAMES: Record<string, string> = { custom: 'Własny (zgodny z OpenAI)', sdk: 'LiteLLM (inni dostawcy)' };
  const iconOf = (id: string) => ICON[id] ?? id;
  const nameOf = (p: Prov) => NAMES[p.id] ? tr(NAMES[p.id]) : p.display_name.replace(/ \(local\)$/, '');
  const CC_TIP = 'Zgodność z warunkami Anthropic wymaga sprawdzenia przed wdrożeniem.';
  const ccLine = 'Używa zainstalowanego Claude Code i jego logowania — bez wpisywania klucza.';
  // Providers without a key (local servers, CLI) that the user added; the engine has no "added" flag for them.
  const ADDED_KEY = 'voicestudio.ai.providers.v1';
  let added = $state<string[]>((() => { try { const v = JSON.parse(localStorage.getItem(ADDED_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch { return []; } })());
  function setAdded(next: string[]) { added = next; try { localStorage.setItem(ADDED_KEY, JSON.stringify(next)); } catch { /* list stays for this session */ } }
  const addRow = (id: string) => { if (!added.includes(id)) setAdded([...added, id]); };

  type Auth = 'key' | 'chatgpt' | 'local' | 'cli';
  type Row = { id: string; tpl: string; name: string; local: boolean; auth: Auth; p?: Prov };
  const authOf = (p: Prov): Auth => p.transport === 'cli' ? 'cli' : p.local ? 'local' : 'key';
  const provById = (id: string) => all.find(p => p.id === id);
  const rows = $derived.by((): Row[] => {
    const list: Row[] = all.filter(p => !HIDDEN.has(p.id) && (p.has_api_key || p.id === active || added.includes(p.id) || skills.some(s => s.provider_override === p.id)))
      .map(p => ({ id: p.id, tpl: iconOf(p.id), name: nameOf(p), local: p.local, auth: authOf(p), p }));
    if (gptOk || added.includes(CHATGPT)) list.splice(list.findIndex(r => r.id === 'openai') + 1, 0, { id: CHATGPT, tpl: 'openai', name: 'OpenAI', local: false, auth: 'chatgpt' });
    return list;
  });
  const isReady = (r: Row) => r.auth === 'chatgpt' ? gptOk : !!r.p?.configured;
  const missing = (r: Row) => r.auth === 'chatgpt' ? 'Niezalogowany' : r.auth === 'cli' ? 'Nie wykryto' : !r.p?.has_key ? 'Brak klucza' : 'Wymaga konfiguracji';
  const stOf = (r: Row): [BadgeKind, string] => r.auth === 'chatgpt' ? (aiLoading ? ['wait', 'Sprawdzanie…'] : gptOk ? ['ok', 'Połączony'] : ['warn', 'Niezalogowany'])
    : r.id === active && isReady(r) && health[r.id] !== 'bad' ? ['ok', 'Aktywny']
    : !isReady(r) ? ['warn', missing(r)]
    : health[r.id] === 'bad' ? ['bad', 'Błąd'] : health[r.id] === 'ok' ? ['ok', 'Połączony'] : ['neutral', 'Niesprawdzony'];
  function subOf(r: Row) {
    if (r.auth === 'cli') return tr(r.p?.configured ? 'Wykryto Claude Code na tym komputerze' : 'Nie wykryto — zainstaluj Claude Code');
    if (r.auth === 'chatgpt') return tr('{model} · konto ChatGPT', { model: aiSet?.model || aiStat?.defaultModel || '—' });
    const p = r.p!; const where = p.base_url ? host(p.base_url) : p.transport === 'sdk' ? '' : tr('brak adresu');
    return [p.model || tr('brak modelu'), where].filter(Boolean).join(' · ');
  }

  let checking = $state<string | null>(null);
  async function check(r: Row) {
    if (checking) return;
    checking = r.id;
    try {
      if (r.auth === 'chatgpt') {
        if (await refreshAi()) gptOk ? toast.ok(tr('Połączono przez ChatGPT.')) : toast.warn(tr(aiStat?.message ?? 'Zaloguj Codex przez ChatGPT: codex login.'));
        else toast.bad(tr(aiErr));
        return;
      }
      const action = r.id === active ? 'test' : 'connect';
      const res = await productionJson<ConnectionResult>(`/api/settings/llm-providers/${enc(r.id)}/${action}`, postJson({}, signal));
      if (disposed) return;
      health = { ...health, [r.id]: res.ok ? 'ok' : 'bad' };
      if (!res.ok) { toast.bad(`${r.name}: ${connectionMessage(res, tr)}`); return; }
      if (action === 'connect') { await Promise.all([readProviders(), readSkills()]); addRow(r.id); }
      const ms = typeof res.latency_ms === 'number' ? Math.round(res.latency_ms) : 0;
      toast.ok(action === 'connect' ? tr('{name} jest teraz aktywnym dostawcą · {ms} ms.', { name: r.name, ms }) : connectionMessage(res, tr));
    } catch (cause) { health = { ...health, [r.id]: 'bad' }; fail(cause); }
    finally { if (!disposed) checking = null; }
  }
  function detach(r: Row) { setAdded(added.filter(x => x !== r.id)); if (ed?.row === r.id) ed = null; toast.ok(tr('Odłączono: {name}', { name: r.name })); }

  /* ---------- model lists (GET /llm-providers/{id}/models; only OpenAI-compatible providers can list) ---------- */
  let lists = $state<Record<string, { models: string[]; err: string; loading: boolean }>>({});
  // ponytail: name-based filter for obvious non-chat models; the engine list has no capability flag. Manual entry covers misses.
  const NON_CHAT = /embed|whisper|tts|transcri|moderation|dall-e|imagen|rerank|realtime|speech/i;
  async function fetchList(p: Prov): Promise<string> {
    lists[p.id] = { models: lists[p.id]?.models ?? [], err: '', loading: true };
    try {
      const res = await productionJson<{ ok: boolean; models: string[]; kind?: string; detail?: string }>(`/api/settings/llm-providers/${enc(p.id)}/models`, { signal });
      const err = res.ok ? '' : connectionMessage(res, tr);
      lists[p.id] = { models: res.ok ? res.models.filter(id => !NON_CHAT.test(id)) : [], err, loading: false };
      return err;
    } catch (cause) { const err = settingsError(cause); lists[p.id] = { models: [], err, loading: false }; return err; }
  }
  function fetchLists() { for (const r of rows) if (r.p?.supports_model_listing && isReady(r) && (!lists[r.id] || lists[r.id].err)) void fetchList(r.p); }
  const modelsOf = (p: Prov) => { const ids = lists[p.id]?.models ?? []; return p.model && !ids.includes(p.model) ? [p.model, ...ids] : ids; };

  /* ---------- editor (add / edit), rendered under the edited row or under the list ---------- */
  type Ed = { mode: 'add' | 'edit'; row: string; tpl: string; auth: Auth; url: string; model: string; account: string; key: string };
  let ed = $state<Ed | null>(null);
  let eBusy = $state<'check' | 'models' | 'save' | null>(null);
  let datalist = $state<string[]>([]);
  const edP = $derived(ed?.tpl ? provById(ed.tpl) : undefined);
  const pickable = $derived(all.filter(p => !HIDDEN.has(p.id)));
  const shown = $derived(new Set(rows.map(r => r.id)));
  const usedTpl = (id: string) => id === 'openai' ? shown.has('openai') && shown.has(CHATGPT) : shown.has(id);
  const authItems = $derived(ed?.tpl === 'openai' ? [{ value: 'key', label: tr('Klucz API') }, { value: 'chatgpt', label: tr('Konto ChatGPT') }] : edP?.local ? [{ value: 'local', label: tr('Adres lokalny') }] : [{ value: 'key', label: tr('Klucz API') }]);
  const authHelp = $derived(ed?.tpl === 'openai' ? 'Własny klucz API albo subskrypcja ChatGPT.' : edP?.local ? 'Serwer na tym komputerze, bez klucza.' : 'Klucz z panelu dostawcy.');
  const storedKey = $derived(!!edP?.has_api_key && !edP.key_from_env);
  function openAdd() { datalist = []; ed = { mode: 'add', row: '', tpl: '', auth: 'key', url: '', model: '', account: '', key: '' }; }
  function edFor(p: Prov, auth: Auth, mode: Ed['mode'], row: string): Ed {
    return { mode, row, tpl: p.id, auth, url: p.base_url, model: auth === 'chatgpt' ? aiSet?.model ?? '' : p.model, account: p.account_id ?? '', key: '' };
  }
  function openEdit(r: Row) { const p = r.p ?? provById('openai'); if (!p) return; datalist = []; ed = edFor(p, r.auth, 'edit', r.id); }
  function pickTpl(id: string) { const p = provById(id); if (!p || !ed) return; datalist = []; ed = edFor(p, id === 'openai' && usedTpl('openai') === false && shown.has('openai') ? 'chatgpt' : authOf(p), 'add', ''); }
  function setAuth(v: string) { if (!ed || !edP) return; ed.auth = v as Auth; ed.model = v === 'chatgpt' ? aiSet?.model ?? '' : edP.model; }
  // `#ai/add` opens the add-provider picker, `#ai/<providerId>` that provider's editor, `#ai/funkcje` the functions tab.
  let lastIntent = '';
  $effect(() => {
    const it = intent; if (!it || !loaded || it === lastIntent) return;
    untrack(() => {
      lastIntent = it; tab = it === 'funkcje' ? 'funkcje' : 'llm'; if (it === 'funkcje') return;
      if (it === 'add') openAdd();
      else { const id = ALIAS[it] ?? it, r = rows.find(x => x.id === id); if (r) openEdit(r); else if (provById(id)) { openAdd(); pickTpl(id); } }
      tick().then(() => document.querySelector('.ai-page .form')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    });
  });
  // one blue button per editor: "Zapisz dostawcę" steps back to outline while a key is typed or the ChatGPT account is not connected
  const otherPrimary = $derived(!!ed && ((ed.auth === 'key' && ed.mode === 'edit' && !!ed.key.trim()) || (ed.auth === 'chatgpt' && !gptOk)));
  const edHint = $derived(!ed ? '' : !ed.tpl ? 'Wybierz dostawcę.' : ed.auth === 'cli' ? (edP?.configured ? '' : 'Nie wykryto Claude Code — zainstaluj go, aby połączyć.')
    : ed.auth === 'chatgpt' ? '' : edP?.transport === 'openai' && !urlOk(ed.url) ? 'Podaj adres zaczynający się od http:// lub https://.'
    : !ed.model.trim() && !edP?.local ? 'Podaj nazwę modelu.' : edP?.needs_account && !ed.account.trim() ? 'Podaj Id konta dostawcy.' : '');
  async function putProvider(id: string, body: Record<string, unknown>) {
    accept(await productionJson<Providers>(`/api/settings/llm-providers/${enc(id)}`, { ...postJson({ make_active: false, activate_if_unset: false, ...body }, signal), method: 'PUT' }));
  }
  const edBody = (e: Ed, p: Prov) => ({ ...(p.transport === 'openai' ? { base_url: e.url.trim() } : {}), model: e.model.trim(), ...(p.needs_account ? { account_id: e.account.trim() } : {}), ...(e.key.trim() ? { api_key: e.key.trim() } : {}) });
  async function saveEd() {
    if (!ed || !edP || edHint || eBusy) return;
    const e = ed, p = edP; eBusy = 'save';
    try {
      if (e.auth === 'chatgpt') {
        if (aiSet && e.model !== aiSet.model) aiSet = await saveAISettings({ ...aiSet, model: e.model }, signal);
        addRow(CHATGPT); toast.ok(tr('Zapisano dostawcę.'));
      } else if (e.auth === 'cli') { addRow(p.id); toast.ok(tr('Połączono Claude Code. Wybierz „Użyj”, aby go aktywować.')); }
      else {
        const changed = e.url.trim() !== p.base_url || !!e.key.trim();
        await putProvider(p.id, edBody(e, p)); addRow(p.id);
        if (changed) { const { [p.id]: _, ...rest } = health; health = rest; }
        toast.ok(tr(e.mode === 'add' ? 'Zapisano dostawcę. Wybierz „Sprawdź i aktywuj”, aby go używać.' : p.id === active ? 'Zapisano. Dostawca jest aktywny.' : 'Zapisano dostawcę.'));
      }
      if (!disposed) ed = null;
    } catch (cause) { fail(cause); }
    finally { if (!disposed) eBusy = null; }
  }
  async function fetchModels() {
    if (!ed || !edP || eBusy) return;
    const e = ed, p = edP; eBusy = 'models';
    try {
      if (urlOk(e.url) || p.transport !== 'openai') await putProvider(p.id, edBody(e, p)); // the engine lists with the saved address and key
      e.key = '';
      const err = await fetchList(p); if (disposed) return;
      if (err) { toast.bad(tr('Nie udało się pobrać modeli: {reason}', { reason: err })); return; }
      datalist = lists[p.id].models; const n = datalist.length;
      toast.ok(tr('Pobrano {n} {word}. Wybierz jeden w polu „Model LLM”.', { n, word: tr(pl(n, 'model', 'modele', 'modeli')) }));
    } catch (cause) { fail(cause); }
    finally { if (!disposed) eBusy = null; }
  }
  async function saveKey() {
    if (!ed || !edP || !ed.key.trim() || eBusy) return;
    const e = ed, p = edP; eBusy = 'save';
    try { await putProvider(p.id, { api_key: e.key.trim() }); e.key = ''; const { [p.id]: _, ...rest } = health; health = rest; flash('keySaved'); }
    catch (cause) { fail(cause); } finally { if (!disposed) eBusy = null; }
  }
  async function checkKey() {
    if (!ed || !edP || eBusy) return;
    const e = ed, p = edP, typed = e.key.trim();
    if (!typed && !p.has_api_key) { toast.bad(tr('Brak klucza do sprawdzenia. Wklej klucz API.')); return; }
    eBusy = 'check';
    try {
      if (typed) { await putProvider(p.id, { api_key: typed }); e.key = ''; if (e.mode === 'add') addRow(p.id); }
      if (p.supports_model_listing) {
        const t0 = performance.now(); const err = await fetchList(p); if (disposed) return;
        if (err) toast.bad(err); else toast.ok(tr('Klucz działa · {ms} ms. Sprawdzenie odczytuje listę modeli i nie zużywa limitu.', { ms: Math.round(performance.now() - t0) }));
      } else {
        const res = await productionJson<ConnectionResult>(`/api/settings/llm-providers/${enc(p.id)}/test`, postJson({}, signal)); if (disposed) return;
        health = { ...health, [p.id]: res.ok ? 'ok' : 'bad' };
        res.ok ? toast.ok(tr('Klucz działa · {ms} ms. Test wysłał krótkie żądanie do dostawcy.', { ms: Math.round(res.latency_ms ?? 0) })) : toast.bad(connectionMessage(res, tr));
      }
    } catch (cause) { fail(cause); } finally { if (!disposed) eBusy = null; }
  }
  async function clearKey() {
    if (!edP) return;
    try { await putProvider(edP.id, { api_key: '' }); const { [edP.id]: _, ...rest } = health; health = rest; ed = null; toast.ok(tr('Usunięto zapisany klucz z prywatnego magazynu')); }
    catch (cause) { fail(cause); }
  }

  /* ---------- translators (private credentials, /next/settings/credential) + ASR ---------- */
  type Field = { key: string; label: string; desc?: string; secret?: boolean; ph?: string };
  type Svc = { id: string; name: string; desc: string; fields: Field[] };
  const SVC: Svc[] = [
    { id: 'deepl', name: 'DeepL', desc: 'Tłumaczenie tekstu i napisów.', fields: [{ key: 'DEEPL_API_KEY', label: 'Klucz API', secret: true }, { key: 'DEEPL_BASE_URL', label: 'Adres API', desc: 'Zmień tylko dla innego regionu lub własnej bramki.', ph: 'https://api-free.deepl.com/v2' }] },
    { id: 'ms', name: 'Microsoft Translator', desc: 'Tłumaczenie tekstu i napisów.', fields: [{ key: 'MICROSOFT_API_KEY', label: 'Klucz API', secret: true }, { key: 'MICROSOFT_REGION', label: 'Region', desc: 'Region zasobu Azure, np. westeurope.', ph: 'westeurope' }, { key: 'MICROSOFT_BASE_URL', label: 'Adres API', desc: 'Zmień tylko dla innego regionu lub własnej bramki.', ph: 'https://api.cognitive.microsofttranslator.com' }] },
    { id: 'google', name: 'Google Cloud Translation', desc: 'Tłumaczenie tekstu i napisów.', fields: [{ key: 'GOOGLE_TRANSLATE_API_KEY', label: 'Klucz API', secret: true }] },
    { id: 'aws', name: 'Amazon Translate', desc: 'Tłumaczenie przez profil z lokalnej konfiguracji AWS.', fields: [{ key: 'AWS_PROFILE', label: 'Profil AWS', desc: 'Nazwa profilu z lokalnej konfiguracji AWS.', ph: 'default' }, { key: 'AWS_REGION', label: 'Region AWS', desc: 'Region usługi, np. eu-central-1.', ph: 'eu-central-1' }] }];
  const URL_KEYS = new Set(['DEEPL_BASE_URL', 'MICROSOFT_BASE_URL']);
  let svcIn = $state<Record<string, string>>({}), svcErr = $state<Record<string, string>>({}), svcBusy = $state('');
  const cred = (key: string) => creds?.fields.find(f => f.key === key);
  function svcSync() { for (const s of SVC) for (const f of s.fields) svcIn[f.key] = f.secret ? '' : cred(f.key)?.value ?? ''; }
  const fieldDirty = (f: Field) => f.secret ? !!svcIn[f.key]?.trim() : (svcIn[f.key] ?? '').trim() !== (cred(f.key)?.value ?? '');
  const svcSet = (s: Svc) => !!cred(s.fields[0].key)?.set;
  async function svcSave(s: Svc) {
    const bad = s.fields.find(f => URL_KEYS.has(f.key) && svcIn[f.key]?.trim() && !urlOk(svcIn[f.key]));
    if (bad) { svcErr[s.id] = 'Adres API musi zaczynać się od http:// lub https://.'; return; }
    svcErr[s.id] = ''; svcBusy = s.id;
    try { for (const f of s.fields.filter(fieldDirty)) creds = await putSettings<CredentialState>('/next/settings/credential', { key: f.key, value: (svcIn[f.key] ?? '').trim() }, signal); svcSync(); flash(s.id); }
    catch (cause) { fail(cause); } finally { if (!disposed) svcBusy = ''; }
  }
  async function svcClear(s: Svc) {
    svcBusy = s.id;
    try { for (const f of s.fields.filter(f => cred(f.key)?.set)) creds = await putSettings<CredentialState>('/next/settings/credential', { key: f.key, value: '' }, signal); svcSync(); svcErr[s.id] = ''; toast.ok(tr('Wyczyszczono klucz: {name}', { name: s.name })); }
    catch (cause) { fail(cause); } finally { if (!disposed) svcBusy = ''; }
  }

  let asr = $state({ url: '', model: '', key: '' });
  let asrHealth = $state<'none' | 'ok' | 'bad'>('none'), asrBusy = $state<'' | 'save' | 'test'>('');
  function asrSync() { asr = { url: asrSaved?.base_url ?? '', model: asrSaved?.model ?? '', key: '' }; }
  const asrDirty = $derived(!!asr.key.trim() || asr.url.trim() !== (asrSaved?.base_url ?? '') || asr.model.trim() !== (asrSaved?.model ?? ''));
  const asrBad = $derived(!urlOk(asr.url) ? 'Adres serwera ASR musi zaczynać się od http:// lub https://.' : !asr.model.trim() ? 'Podaj model transkrypcji.' : '');
  async function asrPut(extra: Record<string, unknown> = {}) {
    asrSaved = await productionJson<AsrEndpoint>('/api/settings/asr-openai-compat', { ...postJson({ base_url: asr.url.trim(), model: asr.model.trim(), ...(asr.key.trim() ? { api_key: asr.key.trim() } : {}), ...extra }, signal), method: 'PUT' });
    asrSync();
  }
  async function asrSave() {
    if (asrBad || asrBusy) return; asrBusy = 'save';
    try { await asrPut(); asrHealth = 'none'; flash('asr'); toast.ok(tr('Zapisano serwer ASR. Wybierz ten silnik w katalogu modeli.')); }
    catch (cause) { fail(cause); } finally { if (!disposed) asrBusy = ''; }
  }
  async function asrTest() {
    if (asrBad || asrBusy) return; asrBusy = 'test';
    try {
      if (asrDirty) await asrPut();
      const res = await productionJson<ConnectionResult>('/api/settings/asr-openai-compat/test', postJson({}, signal)); if (disposed) return;
      asrHealth = res.ok ? 'ok' : 'bad';
      res.ok ? toast.ok(`${connectionMessage(res, tr)} ${tr('Test sprawdza listę modeli i nie potwierdza transkrypcji.')}`) : toast.bad(connectionMessage(res, tr));
    } catch (cause) { asrHealth = 'bad'; fail(cause); } finally { if (!disposed) asrBusy = ''; }
  }
  async function asrClear() {
    try { await asrPut({ api_key: '' }); asrHealth = 'none'; toast.ok(tr('Usunięto prywatny klucz ASR')); } catch (cause) { fail(cause); }
  }
  const asrBadge = $derived<[BadgeKind, string]>(asrHealth === 'ok' ? ['ok', 'Połączony'] : asrHealth === 'bad' ? ['bad', 'Błąd'] : ['neutral', 'Niesprawdzony']);

  /* ---------- AI functions (engine LLM skills) ---------- */
  const SKILL_DESC: Record<string, string> = {
    dub_translation: 'Tłumaczy kwestie z zachowaniem znaczenia i długości.', cinematic_translation: 'Wygładza tłumaczenie, by brzmiało jak mowa.',
    slot_fitting: 'Skraca lub rozszerza zdania do długości fragmentu.', glossary_extract: 'Zbiera nazwy własne i terminy przed tłumaczeniem.',
    direction_parse: 'Wykrywa emocje i didaskalia w tekście.', dictation_refinement: 'Poprawia tekst rozpoznany z mikrofonu i nagrań.' };
  const skLabel = (sk: LlmSkill) => tr(skillLabels[sk.id] ?? sk.id);
  const llmRows = $derived(rows.filter(r => r.p));
  const usableRow = (r: Row) => isReady(r) && health[r.id] !== 'bad';
  const blocked = $derived(!llmRows.some(usableRow));
  const unavailable = (id: string) => { const r = llmRows.find(x => x.id === id); return !r || !usableRow(r); };
  const pickGroups = $derived(llmRows.map((r): PickGroup => ({ id: r.id, tpl: r.tpl, name: r.name + (r.local ? tr(' · lokalny') : ''),
    state: !isReady(r) ? tr(missing(r)) : health[r.id] === 'bad' ? tr('Niedostępny') : '', models: r.p ? modelsOf(r.p) : [], loading: lists[r.id]?.loading, err: lists[r.id]?.err })));
  const defModel = $derived(provById(active)?.model ?? '');
  const attention = $derived(!blocked && unavailable(active));
  function startConnect() { tab = 'llm'; openAdd(); tick().then(() => document.querySelector('.ai-page .form')?.scrollIntoView({ block: 'center', behavior: 'smooth' })); }
  let working = $state(false);
  async function guard(run: () => Promise<void>) { if (working) return; working = true; try { await run(); } catch (cause) { fail(cause); } finally { if (!disposed) working = false; } }
  // ponytail: the engine keeps ONE model per provider (no per-function model), so picking a model also sets it for that provider.
  async function setProviderModel(pid: string, m: string) { const p = provById(pid); if (p && p.model !== m) await putProvider(pid, { model: m }); }
  function setDef(pid: string, m: string) {
    void guard(async () => {
      await setProviderModel(pid, m);
      accept(await productionJson<Providers>('/api/settings/llm-providers/active', postJson({ provider: pid }, signal)));
      await readSkills(); toast.ok(tr('Domyślny model: {name} · {model}', { name: llmRows.find(r => r.id === pid)?.name ?? pid, model: m }));
    });
  }
  async function putSkill(sk: LlmSkill, patch: { enabled?: boolean; provider_override?: string }) {
    skills = (await productionJson<{ skills: LlmSkill[] }>(`/api/settings/llm-skills/${enc(sk.id)}`, { ...postJson(patch, signal), method: 'PUT' })).skills;
  }
  const modeOf = (sk: LlmSkill) => sk.provider_override ? 'custom' : 'default';
  function target(sk: LlmSkill) { const id = sk.provider_override || active; const p = provById(id); return { id, p, model: p?.model ?? '', bad: unavailable(id), noModel: !p?.model }; }
  let openFn = $state<string | null>(null), tagOpen = $state(false);
  function setSkMode(sk: LlmSkill, v: string) { if (v === modeOf(sk)) return; void guard(async () => { await putSkill(sk, { provider_override: v === 'custom' ? active : '' }); flash('s' + sk.id); }); }
  function setSk(sk: LlmSkill, pid: string, m: string) {
    void guard(async () => {
      const shared = provById(pid)?.model !== m && (pid === active || skills.some(s => s.id !== sk.id && s.provider_override === pid));
      await setProviderModel(pid, m); await putSkill(sk, { provider_override: pid }); flash('s' + sk.id);
      if (shared) toast.info(tr('Model {model} ustawiono dla dostawcy {name}; inne funkcje tego dostawcy też go używają.', { model: m, name: llmRows.find(r => r.id === pid)?.name ?? pid }));
    });
  }
  function setSkOn(sk: LlmSkill, v: boolean) { if (!v && openFn === sk.id) openFn = null; void guard(async () => { await putSkill(sk, { enabled: v }); flash('s' + sk.id); }); }
  function useDefault(sk: LlmSkill) { void guard(async () => { await putSkill(sk, { provider_override: '' }); flash('s' + sk.id); toast.ok(tr('{name}: używa teraz modelu domyślnego', { name: skLabel(sk) })); }); }
  const nOwn = $derived(skills.filter(s => s.enabled && s.provider_override).length);
  const nDef = $derived(skills.filter(s => s.enabled && !s.provider_override).length);
  const anyOwn = $derived(!blocked && skills.some(s => s.provider_override));
  function resetAll() { void guard(async () => { for (const s of skills.filter(x => x.provider_override)) await putSkill(s, { provider_override: '' }); toast.ok(tr('Wszystkie funkcje używają teraz modelu domyślnego')); }); }

  /* ---------- tagging (Codex / ChatGPT account; the only provider the engine's tagging supports today) ---------- */
  const tagMode = $derived(aiSet?.model ? 'custom' : 'default');
  const tagModel = $derived(aiSet?.model || aiStat?.defaultModel || '');
  const tagMissing = $derived(!!aiSet?.model && gptOk && !codexModels.includes(aiSet.model));
  const tagGroups = $derived<PickGroup[]>([{ id: CHATGPT, tpl: 'openai', name: tr('OpenAI (ChatGPT)'), state: gptOk ? '' : tr('Niezalogowany'), models: codexModels }]);
  const tagBadge = $derived<[BadgeKind, string]>(aiLoading ? ['wait', 'Sprawdzanie…'] : gptOk ? (tagMissing ? ['warn', 'Wybierz model'] : ['ok', 'Połączony']) : aiErr ? ['bad', 'Błąd'] : ['warn', 'Niezalogowany']);
  const TAG_INT: Record<string, string> = { subtle: 'Subtelna', natural: 'Naturalna', expressive: 'Ekspresyjna' };
  let tagBusy = $state(false), tagSaving = $state(false), tagErr = $state('');
  let tagRes = $state<{ parts: string[]; line: string } | null>(null);
  async function saveTag(patch: Partial<AISettings>, key: string) {
    // One write at a time and never during the test: overlapping PUTs could restore a stale `prev`, and the test must see saved settings.
    if (!aiSet || tagSaving || tagBusy) return;
    const prev = aiSet; aiSet = { ...aiSet, ...patch }; tagRes = null; tagErr = ''; tagSaving = true;
    try { aiSet = await saveAISettings({ ...aiSet }, signal); flash(key); } catch (cause) { if (!disposed) aiSet = prev; fail(cause); }
    finally { if (!disposed) tagSaving = false; }
  }
  async function tagTest() {
    if (tagBusy || tagSaving) return; tagRes = null;
    tagErr = !gptOk ? 'Nie można przetestować: zaloguj konto ChatGPT (Codex).' : tagMissing ? 'Nie można przetestować: wybierz model.' : '';
    if (tagErr) return;
    tagBusy = true; const int = aiSet?.intensity ?? 'natural';
    try {
      const res = await testAI(signal); if (disposed) return;
      tagRes = { parts: res.enhanced_blocks.join(' ').split(/(\[[^\]]+\])/).filter(Boolean),
        line: tr('Model: OpenAI · {model} · intensywność: {intensity} · {seconds} s', { model: res.model, intensity: tr(TAG_INT[int]), seconds: res.seconds.toLocaleString(tr.locale) }) };
    } catch (cause) { if (!disposed && !signal.aborted) tagErr = cause instanceof Error && cause.name === 'TimeoutError' ? 'Usługa AI nie odpowiedziała na czas. Spróbuj ponownie.' : cause instanceof Error ? cause.message : String(cause); }
    finally { if (!disposed) tagBusy = false; }
  }

  /* ---------- dictation refinement ---------- */
  type DictKey = 'auto' | 'smart_cleanup' | 'self_correction' | 'preserve_technical';
  const dictItems: [DictKey, string, string][] = [
    ['auto', 'Automatyczna redakcja dyktowania', 'Poprawia tekst zaraz po zakończeniu dyktowania.'],
    ['smart_cleanup', 'Porządkuj interpunkcję i wypełniacze', 'Usuwa „yyy”, „no więc” i dodaje znaki interpunkcyjne.'],
    ['self_correction', 'Rozpoznawaj wypowiedziane poprawki', 'Fraza „nie, jednak…” zastępuje poprzednie słowa.'],
    ['preserve_technical', 'Zachowuj słownictwo techniczne', 'Nie zmienia nazw, kodu ani skrótów.']];
  async function setDict(k: DictKey, v: boolean) {
    if (!refinement) return;
    const prev = refinement; refinement = { ...refinement, [k]: v };
    try { refinement = await productionJson<RefinementSettings>('/api/settings/dictation-refinement', { ...postJson({ [k]: v }, signal), method: 'PUT' }); flash('d' + k); }
    catch (cause) { if (!disposed) refinement = prev; fail(cause); }
  }
</script>

{#snippet modelPick(prov: string, model: string, label: string, onpick: (pid: string, m: string) => void, full = false, attn = false)}
  <ModelPicker groups={pickGroups} provider={prov} {model} ariaLabel={label} {onpick} onopen={fetchLists} attention={attn} {full}/>
{/snippet}
<!-- resolved model of a default / disabled function: a plain status, not a select; long names end with "…" (full name in the tooltip) -->
{#snippet roPick(tpl: string, name: string, model: string, label: string, empty = '')}
  <span class="mstat" class:none={!model} role="status" aria-label={label} title={model ? `${name} · ${model}` : undefined}>{#if model}<ProviderIcon id={tpl} size={16}/><span class="mtxt">{name} · {model}</span>{:else}{tr(empty)}{/if}</span>
{/snippet}
{#snippet spin(text: string)}<LoaderCircle size={15} class="spin"/>{tr(text)}{/snippet}

{#snippet editor()}
  {#if ed}
    <div class="form">
      <b class="form-t">{ed.mode === 'add' ? tr('Dodaj dostawcę') : tr('Edycja: {name}', { name: rows.find(r => r.id === ed?.row)?.name ?? '' })}</b>
      {#if ed.mode === 'add'}
        <div class="pick" role="group" aria-label={tr('Wybierz dostawcę')}>
          {#each pickable as t (t.id)}
            {@const used = usedTpl(t.id)}
            <button type="button" class="pk" class:sel={ed.tpl === t.id} disabled={used} aria-pressed={ed.tpl === t.id} onclick={() => pickTpl(t.id)}>
              <ProviderIcon id={iconOf(t.id)} size={20}/><span class="pn">{nameOf(t)}</span>
              {#if used}<em>{tr('Dodany')}</em>{:else if ed.tpl === t.id}<Check size={15} class="pk-ok"/>{/if}
            </button>
          {/each}
        </div>
      {/if}
      {#if ed.tpl && edP}
        {#if ed.tpl === 'anthropic'}<p class="p-notice info">{tr('Subskrypcji Claude (Pro/Max) nie można używać w innych aplikacjach — zezwala na to tylko Claude Code i claude.ai. Użyj klucza API z konsoli Anthropic.')}</p>{/if}
        {#if ed.auth === 'cli'}
          <div class="p-rows"><div class="p-row"><div class="t"><b>{tr(edP.configured ? 'Wykryto Claude Code na tym komputerze' : 'Nie wykryto — zainstaluj Claude Code')}</b><span>{tr(ccLine)}</span></div>
            <div class="inline"><Tooltip content={tr(CC_TIP)}><StatusBadge kind="warn" text={tr('Do potwierdzenia')}/></Tooltip></div></div></div>
        {:else}
        <div class="p-rows">
          <div class="p-row"><div class="t"><b>{tr('Sposób połączenia')}</b><span>{tr(authHelp)}</span></div>
            <ButtonGroup label={tr('Sposób połączenia')} mode="single" value={ed.auth} items={authItems} onchange={v => setAuth(String(v))}/></div>

          {#if ed.auth === 'key'}
            <div class="p-row"><div class="t"><b>{tr('Klucz API')}</b><span>{#if edP.key_from_env}{tr('Używany jest klucz ze zmiennej środowiskowej; ma pierwszeństwo przed zapisanym.')}{:else if storedKey}{tr('Klucz jest zapisany. Puste pole zachowuje go.')}{:else}{tr('Trafia do prywatnego magazynu i nie jest pokazywany ponownie.')}{/if}</span></div>
              <div class="keyctl">
                <Input class="fld" type="password" autocomplete="off" aria-label={tr('Klucz API')} placeholder={tr('Wklej klucz API')} bind:value={ed.key}/>
                <div class="inline wrap">
                  {#if ed.mode === 'edit'}<Button disabled={!ed.key.trim() || !!eBusy} onclick={saveKey}><KeyRound size={15}/>{tr('Zapisz klucz')}</Button>{/if}
                  <Button variant="outline" disabled={!!eBusy} onclick={checkKey}>{#if eBusy === 'check'}{@render spin('Sprawdzam…')}{:else}{tr('Sprawdź klucz')}{/if}</Button>
                  {#if storedKey && ed.mode === 'edit'}<Button variant={armed.clearKey ? 'destructive' : 'outline'} onclick={() => arm('clearKey', clearKey)}>{tr(armed.clearKey ? 'Potwierdź usunięcie klucza' : 'Usuń zapisany klucz')}</Button>{/if}
                  {#if flashed.keySaved}<span class="saved on">{tr('Zapisano')}</span>{/if}
                </div>
              </div></div>
          {:else if ed.auth === 'chatgpt'}
            <div class="p-row"><div class="t"><b>{tr('Konto ChatGPT')}</b><span>{aiLoading ? tr('Sprawdzam połączenie…') : gptOk ? tr('Sesja Codex aktywna na tym komputerze.') : tr(aiErr || aiStat?.message || 'Zaloguj Codex przez ChatGPT: codex login.')}</span></div>
              <div class="inline wrap">
                {#if gptOk}<StatusBadge kind="ok" text={aiStat?.plan ? tr('Połączono · konto ChatGPT {plan}', { plan: aiStat.plan }) : tr('Połączono · konto ChatGPT')}/>{/if}
                <Button variant={gptOk ? 'outline' : 'default'} disabled={aiLoading} onclick={() => void refreshAi()}>{#if aiLoading}{@render spin('Sprawdzam…')}{:else}{tr('Sprawdź połączenie')}{/if}</Button>
              </div></div>
          {/if}

          {#if ed.auth !== 'chatgpt'}
            {#if edP.transport === 'openai'}<div class="p-row"><div class="t"><b>{tr('Adres serwera')}</b><span>{tr('Adres zgodny z API OpenAI.')}</span></div><Input class="fld" aria-label={tr('Adres serwera')} bind:value={ed.url}/></div>{/if}
            <div class="p-row"><div class="t"><b>{tr('Model LLM')}</b><span>{tr(edP.supports_model_listing ? 'Nazwa modelu; „Pobierz listę modeli” podpowie dostępne.' : 'Nazwa modelu u tego dostawcy.')}</span></div><Input class="fld" aria-label={tr('Model LLM')} list="ai-models" bind:value={ed.model}/></div>
          {:else}
            <div class="p-row"><div class="t"><b>{tr('Model LLM')}</b><span>{tr('Modele dostępne w planie ChatGPT.')}</span></div><Select ariaLabel={tr('Model LLM')} disabled={!gptOk} value={ed.model} options={[{ value: '', label: tr('Domyślny Codex') + (aiStat?.defaultModel ? ` · ${aiStat.defaultModel}` : '') }, ...(aiStat?.models ?? []).map(m => ({ value: m.id, label: m.name }))]} onchange={v => { if (ed) ed.model = String(v); }}/></div>
          {/if}
          {#if edP.needs_account && ed.auth !== 'chatgpt'}<div class="p-row"><div class="t"><b>{tr('Id konta dostawcy')}</b><span>{tr('Wymagane przez tego dostawcę.')}</span></div><Input class="fld" aria-label={tr('Id konta dostawcy')} bind:value={ed.account}/></div>{/if}
        </div>
        {/if}
        {#if ed.auth === 'chatgpt'}<p class="p-sub">{tr('Korzysta z limitów twojej subskrypcji ChatGPT.')}</p>{/if}
        <datalist id="ai-models">{#each datalist as m (m)}<option value={m}></option>{/each}</datalist>
        <div class="p-actions">
          <Button variant={otherPrimary ? 'outline' : 'default'} disabled={!!edHint || !!eBusy} onclick={saveEd}>{#if eBusy === 'save'}{@render spin('Zapisuję…')}{:else}<Save size={15}/>{tr(ed.auth === 'cli' ? 'Połącz dostawcę' : 'Zapisz dostawcę')}{/if}</Button>
          {#if (ed.auth === 'key' || ed.auth === 'local') && edP.supports_model_listing}<Button variant="outline" disabled={!!eBusy} onclick={fetchModels}>{#if eBusy === 'models'}{@render spin('Pobieram…')}{:else}{tr('Pobierz listę modeli')}{/if}</Button>{/if}
          <Button variant="outline" onclick={() => ed = null}>{tr('Anuluj')}</Button>
        </div>
        {#if edHint}<p class="p-sub">{tr(edHint)}</p>{/if}
      {:else}
        <p class="p-sub">{tr('Wybierz dostawcę, aby skonfigurować połączenie.')}</p>
        <div class="p-actions"><Button variant="outline" onclick={() => ed = null}>{tr('Anuluj')}</Button></div>
      {/if}
    </div>
  {/if}
{/snippet}

<div class="p-page ai-page">
  <div class="page-heading">
    <div><h1>{tr('AI i klucze')}</h1><p>{tr('Dostawcy modeli językowych, tłumacze, serwer rozpoznawania mowy i funkcje, które z nich korzystają.')}</p></div>
  </div>

  {#if !ready}
    <p class="p-notice warn">{tr('Silnik nie działa. Uruchom go, aby skonfigurować dostawców AI, tłumaczy i serwer rozpoznawania mowy.')}{#if onnavigate}<Button variant="ghost" onclick={() => onnavigate('engine')}>{tr('Przejdź do silnika')}</Button>{/if}</p>
  {:else if !loaded}
    <div class="p-progress" role="status"><progress class="p-bar" aria-label={tr('Wczytywanie ustawień AI')}></progress><span>{tr('Wczytuję ustawienia z silnika…')}</span></div>
  {:else}
  {#if failed.length}<p class="p-notice bad" role="alert">{tr('Nie odczytano: {sections}.', { sections: failed.map(s => tr(s)).join(', ') })}<Button variant="ghost" disabled={loading} onclick={() => void load()}>{tr('Spróbuj ponownie')}</Button></p>{/if}

  <div class="filter-tabs p-tabs" role="tablist" aria-label={tr('Sekcje AI i kluczy')}>
    {#each tabs as [id, label] (id)}<button role="tab" aria-selected={tab === id} class:chosen={tab === id} onclick={() => tab = id}>{tr(label)}</button>{/each}
  </div>

  <div class="stack">
  {#if tab === 'llm'}
   <section class="p-card panel">
    <div class="p-section">
      <header class="split"><div><h3>{tr('Dostawcy modeli językowych')}</h3><p>{tr(!rows.length && !ed ? 'Nie połączono żadnego dostawcy. Połącz dostawcę, aby używać tłumaczenia, redakcji tekstu i tagowania.' : 'Obsługują tłumaczenie i redakcję. Sam zapis nie wysyła tekstu do dostawcy.')}</p>
        {#if pinned}<p>{tr('Wybór aktywnego dostawcy jest narzucony przez zmienną środowiskową silnika.')}</p>{/if}</div>
        {#if rows.length && !(ed?.mode === 'add')}<Button variant={ed ? 'outline' : 'default'} onclick={openAdd}><Plus size={15}/>{tr('Dodaj dostawcę')}</Button>{/if}</header>
      {#if !rows.length && !ed}
        <div class="p-actions"><Button onclick={openAdd}><Plus size={15}/>{tr('Dodaj dostawcę')}</Button><Button variant="ghost" onclick={() => { openAdd(); if (ed && provById('openai')) { ed = edFor(provById('openai')!, 'chatgpt', 'add', ''); } }}>{tr('Zaloguj kontem ChatGPT')}</Button></div>
        <div class="starters" role="group" aria-label={tr('Szybki start')}>
          {#each ['openai', 'anthropic', 'claude-code', 'google-ai', 'openrouter', 'ollama'].map(provById).filter(p => !!p) as p (p.id)}
            <button type="button" class="pk" aria-label={tr('Dodaj dostawcę: {name}', { name: nameOf(p) })} onclick={() => { openAdd(); pickTpl(p.id); }}><ProviderIcon id={iconOf(p.id)} size={20}/><span class="pn">{nameOf(p)}</span></button>
          {/each}
        </div>
      {/if}
      <div class="plist">
        {#each rows as r (r.id)}
          {@const s = stOf(r)}
          <div class="prov">
            <ProviderIcon id={r.tpl} size={22}/>
            <div class="nm"><b>{r.name}{#if r.local}<em>{tr('lokalny')}</em>{/if}{#if r.auth === 'cli'}<Tooltip content={tr(CC_TIP)}><StatusBadge kind="warn" text={tr('Do potwierdzenia')}/></Tooltip>{/if}</b><span>{subOf(r)}</span>{#if r.auth === 'cli'}<span>{tr(ccLine)}</span>{/if}</div>
            <StatusBadge kind={s[0]} text={tr(s[1])}/>
            <div class="acts">
              {#if r.auth === 'cli'}
                <Button variant="outline" disabled={checking !== null || !isReady(r)} onclick={() => check(r)}>{#if checking === r.id}{@render spin('Sprawdzam…')}{:else}{tr(r.id === active ? 'Sprawdź ponownie' : 'Użyj')}{/if}</Button>
                <Button variant={armed['d' + r.id] ? 'destructive' : 'ghost'} onclick={() => arm('d' + r.id, () => detach(r))}>{tr(armed['d' + r.id] ? 'Potwierdź odłączenie' : 'Odłącz')}</Button>
              {:else}
                <Button variant="outline" disabled={checking !== null || (r.auth !== 'chatgpt' && (!isReady(r) || !!r.p?.activation_blocked && r.id !== active))} onclick={() => check(r)}>{#if checking === r.id}{@render spin('Sprawdzam…')}{:else}{tr(r.auth === 'chatgpt' ? (gptOk ? 'Sprawdź ponownie' : 'Sprawdź połączenie') : r.id === active ? 'Sprawdź ponownie' : 'Sprawdź i aktywuj')}{/if}</Button>
                <Button variant={ed?.row === r.id ? 'light' : 'ghost'} onclick={() => ed?.row === r.id ? ed = null : openEdit(r)}>{tr(ed?.row === r.id ? 'Zamknij' : 'Edytuj')}</Button>
              {/if}
            </div>
            {#if ed?.mode === 'edit' && ed.row === r.id}<div class="prov-more">{@render editor()}</div>{/if}
          </div>
        {/each}
      </div>
      {#if ed?.mode === 'add'}{@render editor()}{/if}
    </div>
   </section>

  {:else if tab === 'trans'}
   <section class="p-card panel">
    {#each SVC as s (s.id)}
      {@const dirty = s.fields.some(fieldDirty)}
      {@const anySet = s.fields.some(f => cred(f.key)?.set)}
      <div class="p-section">
        <header class="split"><div><h3>{s.name}</h3><p>{tr(s.desc)}</p></div><StatusBadge kind={svcSet(s) ? 'ok' : 'neutral'} text={tr(svcSet(s) ? 'Skonfigurowany' : s.fields[0].secret ? 'Brak klucza' : 'Nie skonfigurowano')}/></header>
        <div class="p-rows">
          {#each s.fields as f (f.key)}
            {@const c = cred(f.key)}
            <div class="p-row"><div class="t"><b>{tr(f.label)}</b><span>{#if f.secret}{c?.set ? tr('Zapisany klucz: {mask}. Puste pole zachowuje go.', { mask: c.masked ?? '••••' }) : tr('Wklej klucz z panelu usługi.')}{:else}{tr(f.desc ?? '')}{/if}</span></div>
              {#if f.secret}<Input class="fld" type="password" autocomplete="off" aria-label={`${tr(f.label)} ${s.name}`} placeholder={tr(c?.set ? 'Zostaw puste, aby zachować' : 'Nowy klucz API')} bind:value={svcIn[f.key]}/>
              {:else}<Input class="fld" aria-label={`${tr(f.label)} ${s.name}`} placeholder={f.ph} bind:value={svcIn[f.key]}/>{/if}</div>
          {/each}
        </div>
        {#if svcErr[s.id]}<p class="p-field-err" role="alert">{tr(svcErr[s.id])}</p>{/if}
        <div class="p-actions">
          <Button disabled={!dirty || !!svcBusy} onclick={() => svcSave(s)}>{#if svcBusy === s.id}{@render spin('Zapisuję…')}{:else}<Save size={15}/>{tr('Zapisz')}{/if}</Button>{#if flashed[s.id]}<span class="saved on" role="status">{tr('Zapisano')}</span>{/if}
          {#if anySet}<span class="grow"></span><Button variant={armed['c' + s.id] ? 'destructive' : 'outline'} disabled={!!svcBusy} onclick={() => arm('c' + s.id, () => svcClear(s))}>{tr(armed['c' + s.id] ? 'Potwierdź wyczyszczenie' : 'Wyczyść')}</Button>{/if}
        </div>
      </div>
    {/each}

    <div class="p-section">
      <header class="split"><div><h3>{tr('Serwer ASR zgodny z OpenAI')}</h3><p>{tr('Zewnętrzne rozpoznawanie mowy. Po zapisaniu wybierz ten silnik w katalogu modeli.')}</p></div><StatusBadge kind={asrBadge[0]} text={tr(asrBadge[1])}/></header>
      <div class="p-rows">
        <div class="p-row"><div class="t"><b>{tr('Adres serwera ASR')}</b><span>{tr('Zwykle kończy się na /v1.')}</span></div><Input class="fld" aria-label={tr('Adres serwera ASR')} placeholder="http://127.0.0.1:8000/v1" bind:value={asr.url}/></div>
        <div class="p-row"><div class="t"><b>{tr('Model transkrypcji')}</b><span>{tr('Nazwa modelu na tym serwerze.')}</span></div><Input class="fld" aria-label={tr('Model transkrypcji')} bind:value={asr.model}/></div>
        <div class="p-row"><div class="t"><b>{tr('Nowy klucz ASR')}</b><span>{tr(asrSaved?.has_key ? 'Klucz jest zapisany. Puste pole zachowuje go.' : 'Opcjonalny; wiele serwerów lokalnych go nie wymaga.')}</span></div>
          <Input class="fld" type="password" autocomplete="off" aria-label={tr('Nowy klucz ASR')} placeholder={tr(asrSaved?.has_key ? 'Zostaw puste, aby zachować' : 'Opcjonalny klucz serwera')} bind:value={asr.key}/></div>
      </div>
      {#if asrBad && (asr.url || asr.model)}<p class="p-field-err" role="alert">{tr(asrBad)}</p>{/if}
      <div class="p-actions">
        <Button disabled={!asrDirty || !!asrBad || !!asrBusy} onclick={asrSave}>{#if asrBusy === 'save'}{@render spin('Zapisuję…')}{:else}<Save size={15}/>{tr('Zapisz')}{/if}</Button>
        <Button variant="outline" disabled={!!asrBusy || !!asrBad} onclick={asrTest}>{#if asrBusy === 'test'}{@render spin('Testuję…')}{:else}{tr('Testuj')}{/if}</Button>
        {#if flashed.asr}<span class="saved on" role="status">{tr('Zapisano')}</span>{/if}
        {#if asrSaved?.has_key}<span class="grow"></span><Button variant={armed.asrClear ? 'destructive' : 'outline'} disabled={!!asrBusy} onclick={() => arm('asrClear', asrClear)}>{tr(armed.asrClear ? 'Potwierdź usunięcie klucza' : 'Wyczyść klucz')}</Button>{/if}
      </div>
    </div>
   </section>

  {:else}
   <section class="p-card panel">
    <div class="p-section">
      <div class="p-row flat half">
        <div class="t"><b class="tt">{tr('Domyślny model')}{#if blocked}<StatusBadge kind="warn" text={tr('Brak dostawcy')}/>{:else if attention}<StatusBadge kind="warn" text={tr('Dostawca niedostępny')}/>{:else if !defModel}<StatusBadge kind="warn" text={tr('Wybierz model')}/>{/if}</b>
          <span>{tr(blocked ? 'Najpierw połącz dostawcę. Bez niego żadna funkcja AI nie ma modelu.' : 'Używany wszędzie, gdzie nie wybrano inaczej.')}</span></div>
        <div class="ctl">{#if blocked}<Button onclick={startConnect}><Plus size={15}/>{tr('Połącz dostawcę')}</Button>{:else}{@render modelPick(active, defModel, tr('Domyślny model'), setDef, true, attention)}{/if}</div>
      </div>
    </div>

    <div class="p-section">
      <header><h3>{tr('Funkcje')}</h3><p>{tr('Domyślnie wszystko używa modelu domyślnego. „Zmień” pozwala wskazać inny model dla jednej funkcji.')}</p></header>
      <div class="fns">
        {#each skills as sk (sk.id)}
          {@const t = target(sk)}
          {@const label = skLabel(sk)}
          {@const r = llmRows.find(x => x.id === t.id)}
          <div class="fn" class:off={!sk.enabled}>
            <div class="fr">
              <div class="t"><b>{label}</b><span>{tr(SKILL_DESC[sk.id] ?? '')}</span></div>
              {#if flashed['s' + sk.id]}<span class="saved on" role="status">{tr('Zapisano')}</span>{/if}
              <div class="tctl">
              {#if blocked || (sk.enabled && t.noModel && !t.bad)}{@render roPick('', '', '', tr('Model: {name}', { name: label }), 'Brak modelu')}
              {:else if !sk.enabled}{@render roPick('', '', '', tr('Model: {name}', { name: label }), 'Wyłączona')}
              {:else if t.bad && !sk.provider_override}<StatusBadge kind="warn" text={tr('Domyślny model niedostępny')}/>
              {:else if t.bad}<StatusBadge kind="bad" text={tr('Dostawca niedostępny')}/><Button variant="ghost" disabled={working} onclick={() => useDefault(sk)}>{tr('Użyj domyślnego')}</Button>
              {:else}{@render roPick(r?.tpl ?? iconOf(t.id), r?.name ?? t.id, t.model, tr(sk.provider_override ? 'Model: {name}' : 'Model (domyślny): {name}', { name: label }))}{/if}
              {#if sk.enabled && !blocked}
                <Button variant={openFn === sk.id ? 'light' : 'outline'} aria-expanded={openFn === sk.id} aria-label={`${tr(openFn === sk.id ? 'Gotowe' : 'Zmień')}: ${label}`} onclick={() => openFn = openFn === sk.id ? null : sk.id}>{tr(openFn === sk.id ? 'Gotowe' : 'Zmień')}</Button>
              {/if}
              </div>
              <Tooltip content={tr('Połącz dostawcę, aby włączyć')} disabled={!blocked}><Switch label={tr('Włącz: {name}', { name: label })} checked={sk.enabled && !blocked} disabled={blocked || working} onchange={v => setSkOn(sk, v)}/></Tooltip>
            </div>
            {#if openFn === sk.id && sk.enabled && !blocked}
              <div class="fe">
                <ButtonGroup label={tr('Model dla funkcji: {name}', { name: label })} mode="single" value={modeOf(sk)} disabled={working} onchange={v => setSkMode(sk, String(v))} items={[{ value: 'default', label: tr('Domyślny') }, { value: 'custom', label: tr('Własny') }]}/>
                {#if sk.provider_override}{@render modelPick(sk.provider_override, t.model, tr('Model: {name}', { name: label }), (pid, m) => setSk(sk, pid, m))}{/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
      <footer class="sumrow">
        <p class="sum" role="status">{#if blocked}{tr('Żadna funkcja nie ma modelu')}{:else}{tr('{n} {verb} domyślnego modelu · {own} {ownVerb}', { n: nDef, verb: tr(pl(nDef, 'funkcja używa', 'funkcje używają', 'funkcji używa')), own: nOwn, ownVerb: tr(pl(nOwn, 'ma własny', 'mają własny', 'ma własny')) })}{/if}</p>
        <Button variant={armed.resetAll ? 'destructive' : 'ghost'} disabled={!anyOwn || working} onclick={() => arm('resetAll', resetAll)}>{tr(armed.resetAll ? 'Potwierdź przywrócenie' : 'Przywróć wszystkie do domyślnego')}</Button>
      </footer>
    </div>
   </section>

   <section class="p-card panel" aria-label={tr('Tagowanie w edytorze')}>
    <div class="p-section">
      <header class="split"><div><h3>{tr('Tagowanie w edytorze')}</h3><p>{tr('Model dodaje do narracji pauzy i reakcje, np. [pauza] albo [śmiech].')}</p></div>
        {#if aiSet?.enabled}<StatusBadge kind={tagBadge[0]} text={tr(tagBadge[1])}/>{/if}</header>
      <div class="p-rows">
        <div class="p-row"><div class="t"><b>{tr('Automatyczne tagowanie AI')}</b><span>{tr('Dodaje pauzy i reakcje do narracji w edytorze.')}</span></div>
          <div class="inline">{#if flashed.tagOn}<span class="saved on" role="status">{tr('Zapisano')}</span>{/if}<Tooltip content={tr('Zaloguj konto ChatGPT (Codex), aby włączyć')} disabled={gptOk}><Switch label={tr('Włącz: automatyczne tagowanie AI')} checked={!!aiSet?.enabled && gptOk} disabled={!gptOk || !aiSet || tagSaving || tagBusy} onchange={v => saveTag({ enabled: v }, 'tagOn')}/></Tooltip></div></div>
        {#if aiSet?.enabled && gptOk}
        <div class="p-row"><div class="t"><b>{tr('Model językowy')}</b><span>{tr(tagMode === 'default' ? 'Domyślny model konta ChatGPT (Codex).' : 'Własny model tylko do tagowania.')}</span></div>
          <div class="tctl">
            {#if flashed.tagModel}<span class="saved on" role="status">{tr('Zapisano')}</span>{/if}
            {@render roPick('openai', tr('OpenAI (ChatGPT)'), tagModel, tr(tagMode === 'default' ? 'Model (domyślny): tagowanie w edytorze' : 'Model: tagowanie w edytorze'), 'Brak modelu')}
            <Button variant={tagOpen ? 'light' : 'outline'} aria-expanded={tagOpen} aria-label={tr(tagOpen ? 'Gotowe: model tagowania' : 'Zmień: model tagowania')} onclick={() => tagOpen = !tagOpen}>{tr(tagOpen ? 'Gotowe' : 'Zmień')}</Button>
          </div></div>
        {#if tagOpen}
          <div class="fe">
            <ButtonGroup label={tr('Model dla tagowania')} mode="single" disabled={tagSaving || tagBusy} value={tagMode} onchange={v => { if (v !== tagMode) saveTag({ model: v === 'custom' ? aiStat?.defaultModel || codexModels[0] || '' : '' }, 'tagModel'); }} items={[{ value: 'default', label: tr('Domyślny') }, { value: 'custom', label: tr('Własny') }]}/>
            {#if tagMode === 'custom'}<ModelPicker groups={tagGroups} provider={CHATGPT} model={aiSet.model} ariaLabel={tr('Model: tagowanie w edytorze')} onpick={(_, m) => saveTag({ model: m }, 'tagModel')} manualEntry={false}/>{/if}
          </div>
        {/if}
        {#if tagMissing}<p class="p-sub tagnote"><StatusBadge kind="warn" text={tr('Ograniczone')}/>{tr('Zapisany model {model} nie występuje w bieżącym katalogu Codex. Wybierz inny model albo „Domyślny”.', { model: aiSet.model })}</p>{/if}
        <div class="p-row"><div class="t"><b>{tr('Intensywność tagowania')}</b><span>{tr('Jak często AI dodaje reakcje.')}</span></div>
          <div class="inline">{#if flashed.tagInt}<span class="saved on" role="status">{tr('Zapisano')}</span>{/if}<ButtonGroup label={tr('Intensywność tagowania')} mode="single" disabled={tagSaving || tagBusy} value={aiSet.intensity} onchange={v => saveTag({ intensity: String(v) as AISettings['intensity'] }, 'tagInt')} items={[{ value: 'subtle', label: tr('Subtelna') }, { value: 'natural', label: tr('Naturalna') }, { value: 'expressive', label: tr('Ekspresyjna') }]}/></div></div>
        <div class="p-row"><div class="t"><b>{tr('Reakcje głosowe')}</b><span>{tr('Śmiech i westchnienia w narracji.')}</span></div>
          <div class="inline">{#if flashed.tagReact}<span class="saved on" role="status">{tr('Zapisano')}</span>{/if}<Switch label={tr('Włącz: reakcje głosowe')} checked={aiSet.reactions} disabled={tagSaving || tagBusy} onchange={v => saveTag({ reactions: v }, 'tagReact')}/></div></div>
        {/if}
      </div>
      {#if aiSet?.enabled && gptOk}
        <div class="p-actions"><Button disabled={tagBusy || tagSaving} onclick={tagTest}>{#if tagBusy}{@render spin('Generuję podgląd…')}{:else}<Sparkles size={15}/>{tr('Przetestuj tagowanie')}{/if}</Button></div>
        {#if tagErr}<p class="p-field-err" role="alert">{tr(tagErr)}</p>{/if}
        {#if tagBusy}<div class="p-progress" role="status"><progress class="p-bar" aria-label={tr('Generowanie podglądu tagowania')}></progress><span>{tr('Czekam na odpowiedź modelu…')}</span></div>{/if}
        {#if tagRes}
          <div class="tagprev" role="status"><p class="tp-text">{#each tagRes.parts as part, i (i)}{#if part.startsWith('[')}<span class="tg">{part}</span>{:else}{part}{/if}{/each}</p>
            <div class="tp-foot"><span class="p-sub">{tagRes.line}</span><Button variant="ghost" onclick={tagTest}>{tr('Spróbuj ponownie')}</Button></div></div>
        {/if}
      {:else if !gptOk && !aiLoading}<p class="p-sub">{tr('Tagowanie działa tylko przez konto ChatGPT (Codex). Zaloguj Codex poleceniem codex login, a potem sprawdź połączenie w zakładce „Modele językowe”.')}</p>{/if}
    </div>
   </section>

   {#if refinement}
   <section class="p-card panel" aria-label={tr('Redakcja dyktowania')}>
    <div class="p-section">
      <header class="split"><div><h3>{tr('Redakcja dyktowania')}</h3><p>{tr('Poprawia tekst rozpoznany z mikrofonu. Wymaga skonfigurowanego dostawcy LLM.')}</p>
        {#if refinement.last_refine_status?.ok === false}<p>{tr('Ostatnia redakcja nie powiodła się; silnik zachował tekst rozpoznany przez ASR.')}</p>{/if}</div>
        <StatusBadge kind={refinement.llm_ready ? 'ok' : 'warn'} text={tr(refinement.llm_ready ? 'LLM skonfigurowany' : 'Brak LLM')}/></header>
      <div class="p-rows">
        {#each dictItems as [k, label, desc] (k)}
          <div class="p-row"><div class="t"><b>{tr(label)}</b><span>{tr(desc)}</span></div>
            <div class="inline">{#if flashed['d' + k]}<span class="saved on" role="status">{tr('Zapisano')}</span>{/if}<Tooltip content={tr('Połącz dostawcę, aby włączyć')} disabled={!blocked}><Switch label={tr(label)} checked={refinement[k] && !blocked} disabled={blocked} onchange={v => setDict(k, v)}/></Tooltip></div></div>
        {/each}
      </div>
    </div>
   </section>
   {/if}
  {/if}
  </div>
  {/if}
</div>

<style>
  .mstat{display:inline-flex;align-items:center;gap:8px;min-width:0;max-width:100%;font-size:var(--ui-text-13)}.mstat.none{color:var(--muted)}
  .mstat :global(svg),.mstat :global(.pi){flex:none}.mtxt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  /* status + "Zmień" stay on one line; a long model name is cut with "…" at the max width (full name in the tooltip) */
  .tctl:has(.mstat){flex:0 1 340px;flex-wrap:nowrap;min-width:0}
  .fe{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:0 0 12px;padding:11px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface-raised)}
  .tctl :global(.vs-group-button),.fe :global(.vs-group-button),.fe :global(.vs-button-size-xs){height:32px;font-size:var(--ui-text-13)}
  .stack{display:flex;flex-direction:column;gap:20px;min-width:0}
  .panel{display:flex;flex-direction:column;gap:18px;padding:22px}
  .inline{display:flex;align-items:center;gap:8px}
  .grow{flex:1}
  .half>*{flex:1 1 0;min-width:0}
  .half .t b.tt{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
  .half .ctl{display:flex;flex-direction:column;align-items:stretch;min-width:0}
  .tctl{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;min-width:0}
  .tagnote{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:0;padding:0 0 12px;border-bottom:1px solid var(--border)}
  .tagprev{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:1px solid var(--border);border-radius:8px;background:var(--surface-raised)}
  .tp-text{margin:0;font-size:var(--ui-text-14);line-height:1.9}
  .tg{display:inline-block;margin:0 1px;padding:0 6px;border-radius:6px;color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,transparent);font-size:var(--ui-text-13);font-weight:600;line-height:1.6}
  .tp-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.tp-foot .p-sub{margin:0}
  .saved{color:var(--success);font-size:var(--ui-text-12);opacity:0;transition:opacity .2s}.saved.on{opacity:1}
  .fns{display:flex;flex-direction:column}
  .fn{border-top:1px solid var(--border)}.fn:first-child{border-top:0}
  .fr{display:flex;align-items:center;gap:12px;padding:12px 0}
  .fr .t{flex:1 1 230px;display:flex;flex-direction:column;gap:2px;min-width:0}
  .fr .t b{font-size:var(--ui-text-13);font-weight:550}
  .fr .t span{color:var(--muted);font-size:var(--ui-text-12);line-height:1.5}
  .fn.off .t b{color:var(--muted)}
  .fe>:global(.mp){flex:1 1 auto}
  .sumrow{display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid var(--border);padding-top:14px}
  .sum{margin:0;font-size:var(--ui-text-12);color:var(--muted)}
  .ai-page :global(.fld){width:300px;max-width:100%}
  .ai-page :global(.spin){animation:rot .8s linear infinite}@keyframes rot{to{transform:rotate(360deg)}}
  @media(prefers-reduced-motion:reduce){.ai-page :global(.spin){animation:none}}
  .ai-page :global(.vs-button svg.spin){color:var(--accent)}
  .starters{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;width:100%}
  .plist{display:flex;flex-direction:column}
  .prov{display:grid;grid-template-columns:auto 1fr auto auto;gap:14px;align-items:center;padding:13px 0;border-top:1px solid var(--border)}
  .prov:first-child{border-top:0}
  .nm{display:flex;flex-direction:column;gap:2px;min-width:0}
  .nm b{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:var(--ui-text-13);font-weight:550}
  .nm b em{font-style:normal;font-weight:400;font-size:var(--ui-text-11);color:var(--muted);margin-left:0}
  .nm span{color:var(--muted);font-size:var(--ui-text-12);line-height:1.6;overflow-wrap:anywhere}
  .acts{display:flex;align-items:center;gap:6px}
  .prov-more{grid-column:1/-1}
  .form{display:flex;flex-direction:column;gap:12px;border:1px solid var(--border);border-radius:8px;padding:14px;background:var(--surface-raised)}
  .form-t{font-size:var(--ui-text-13);font-weight:600}
  .p-notice :global([data-slot=button]){height:auto;padding:0 6px;margin-left:4px}
  .keyctl{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
  .inline.wrap{flex-wrap:wrap;justify-content:flex-end}
  .pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
  .pk{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--foreground);font:inherit;font-size:var(--ui-text-13);text-align:left;cursor:pointer}
  .pk:hover:not(:disabled){border-color:var(--muted)}
  .pk.sel{border-color:var(--accent)}
  .pk:disabled{cursor:default;opacity:.55}
  .pk:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .pk .pn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pk em{font-style:normal;font-size:var(--ui-text-11);color:var(--muted)}
  .pk :global(.pk-ok){color:var(--accent);flex:none}
  @media(max-width:700px){.half>*{flex-basis:100%}.fr{flex-wrap:wrap}.sumrow{flex-direction:column;align-items:flex-start}.prov{grid-template-columns:auto 1fr auto}.acts{grid-column:1/-1}.panel{padding:16px}}
</style>
