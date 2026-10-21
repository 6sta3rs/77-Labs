<script lang="ts">
  import Button from './ui/Button.svelte';
  import { ListFilter, Download, Undo2, Search, X, Star } from '@lucide/svelte';
  import Input from './ui/Input.svelte';
  import FilterChip from './ui/FilterChip.svelte';
  import VoiceOrb from './VoiceOrb.svelte';
  import { filterRecordings, groupRecordings, relativeRecordingTime } from './history-view';
  import type { Render } from './data';
  let { rows, active, playingId, onplay, onrestore, onstar }: { rows: Render[]; active: boolean; playingId?: string; onplay: (row: Render) => void; onrestore: (row: Render) => void; onstar?: (row:Render) => void } = $props();
  let query = $state<string | number | null>(''), voice = $state(''), model = $state(''), date = $state(''), source = $state(''), oldest = $state(false), now = $state(Date.now());
  const filtered = $derived(filterRecordings(rows, { query: String(query || ''), voice, model, date, source }, now));
  const groups = $derived(groupRecordings(filtered, now, oldest));
  const voiceOptions = $derived([...new Set(rows.map(row => row.voice))].map(value => ({ value, label: value })));
  const modelOptions = $derived([...new Map(rows.filter(row => row.modelId).map(row => [row.modelId!, { value: row.modelId!, label: row.modelName || row.modelId! }])).values(), ...(rows.some(row => !row.modelId) ? [{ value: 'unknown', label: 'Nie zapisano modelu' }] : [])]);
  const hasFilters = $derived(Boolean(query || voice || model || date || source));
  $effect(() => { if (!active) return; now = Date.now(); const timer = setInterval(() => now = Date.now(), 60000); return () => clearInterval(timer); });
  function reset() { query = ''; voice = ''; model = ''; date = ''; source = ''; }
</script>
<div id="generation-history-panel" class="tts-history" role="tabpanel" aria-labelledby="generation-history-tab" hidden={!active}>
  <div class="history-search-row"><Input class="history-search-input" aria-label="Szukaj w historii" placeholder="Szukaj w historii" bind:value={query}/><button class="history-sort" aria-label={oldest ? 'Najpierw najnowsze nagrania' : 'Najpierw najstarsze nagrania'} aria-pressed={oldest} title={oldest ? 'Od najstarszych' : 'Od najnowszych'} onclick={() => oldest = !oldest}><ListFilter size={17}/></button></div>
  <div class="history-filters"><FilterChip label="Głos" value={voice} onchange={value => voice = value} options={voiceOptions}/><FilterChip label="Model" value={model} onchange={value => model = value} options={modelOptions}/><FilterChip label="Data" value={date} onchange={value => date = value} options={[{ value: 'today', label: 'Dzisiaj' }, { value: 'week', label: 'Ostatnie 7 dni' }, { value: 'month', label: 'Ostatnie 30 dni' }]}/><FilterChip label="Źródło" value={source} onchange={value => source = value} options={[{ value: 'generation', label: 'Generowanie' }, { value: 'import', label: 'Wczytany plik' }, { value: 'unknown', label: 'Bez oznaczenia' }]}/></div>
  {#if hasFilters}<div class="history-results"><span>{filtered.length} z {rows.length} nagrań</span><button onclick={reset}><X size={12}/>Wyczyść filtry</button></div>{/if}
  {#each groups as group (group.key)}<section class="history-date-group" aria-label={group.label}><div class="history-date"><span>{group.label}</span></div>{#each group.rows as row (row.id)}<div class="history-entry" data-recording-id={row.id} class:current={playingId === row.id}><button class="history-open" aria-label={'Odtwórz: '+(row.text || row.title)} disabled={!row.url} onclick={() => onplay(row)}><strong title={row.text || row.title}>{row.text.trim() || row.title}</strong><span class="history-meta"><VoiceOrb voiceId={row.voiceId || row.blocks?.[0]?.voiceId || row.voice} size={13} animated={false}/><span title={row.voice}>{row.voice}</span><i>·</i><time datetime={row.created} title={new Date(row.created).toLocaleString('pl-PL')}>{relativeRecordingTime(row.created, now)}</time></span></button><div class="history-row-actions">{#if onstar}<Button variant="ghost" size="icon" aria-label={(row.starred?'Usuń gwiazdkę: ':'Zachowaj: ')+row.title} aria-pressed={!!row.starred} title="Zachowaj poza limitem historii" onclick={() => onstar?.(row)}><Star size={14} fill={row.starred?'currentColor':'none'}/></Button>{/if}{#if row.text}<Button variant="ghost" size="icon" aria-label={'Użyj tekstu: '+row.title} title="Użyj tekstu" onclick={() => onrestore(row)}><Undo2 size={14}/></Button>{/if}{#if row.url}<Button variant="ghost" size="icon" href={row.url} download={row.filename || 'nagranie.wav'} aria-label={'Pobierz: '+row.title} title="Pobierz nagranie"><Download size={14}/></Button>{/if}</div></div>{/each}</section>{/each}
  {#if !rows.length}<div class="tts-history-empty"><Search size={23}/><p>Wygenerowane i wczytane nagrania pojawią się tutaj.</p></div>{:else if !filtered.length}<div class="tts-history-empty"><Search size={23}/><p>Brak nagrań pasujących do filtrów.</p><button onclick={reset}>Wyczyść filtry</button></div>{/if}
</div>
