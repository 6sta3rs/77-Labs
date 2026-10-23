<script lang="ts">
  function uiOptions<T extends { label: string }>(items: readonly T[]): T[] { return items.map(item => ({ ...item, label: tr(item.label) })); }

  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import { AlignLeft, AlignCenter, AlignRight, List, LayoutGrid, RotateCcw } from '@lucide/svelte'
  import Button from '../ui/Button.svelte'
  import ButtonGroup from '../ui/ButtonGroup.svelte'
  import FilterChip from '../ui/FilterChip.svelte'

  let view = $state<string | string[]>('list')
  let alignment = $state<string | string[]>('left')
  let statuses = $state<string | string[]>([])
  let author = $state(''), status = $state('draft'), model = $state(''), source = $state(''), language = $state('')
  let action = $state('Wybierz działanie grupy.')
  const rows = [
    {name:'Powitanie',author:'anna',status:'draft',model:'omnivoice',source:'editor',language:'pl'},
    {name:'Przewodnik',author:'lektor',status:'ready',model:'omnivoice',source:'file',language:'pl'},
    {name:'Introduction',author:'anna',status:'draft',model:'other',source:'file',language:'en'},
    {name:'Rozdział pierwszy',author:'lektor',status:'draft',model:'omnivoice',source:'editor',language:'pl'},
    {name:'Demo',author:'anna',status:'ready',model:'other',source:'editor',language:'en'},
  ]
  const authors = [{value:'anna',label:'Anna'},{value:'lektor',label:'Lektor'}]
  const statusOptions = [{value:'draft',label:'W przygotowaniu'},{value:'ready',label:'Gotowe'}]
  const models = [{value:'omnivoice',label:'OmniVoice'},{value:'other',label:'Pozostałe'}]
  const sources = [{value:'editor',label:'Edytor'},{value:'file',label:'Plik'}]
  const languages = [{value:'pl',label:'Polski'},{value:'en',label:'Angielski'}]
  const filtered = $derived(rows.filter(row => (!author || row.author===author) && (!status || row.status===status) && (!model || row.model===model) && (!source || row.source===source) && (!language || row.language===language) && (!Array.isArray(statuses) || !statuses.length || statuses.includes(row.status))))
  const textAlign = $derived(alignment==='center'?'center':alignment==='right'?'right':'left')
  function reset() { author=''; status=''; model=''; source=''; language=''; statuses=[] }
</script>

<section class="group-filter-section" id="control-15">
  <div class="heading"><span>15</span><h2>{tr("Grupy przycisków i filtry")}</h2><code>{tr("ButtonGroup / FilterChip")}</code></div>
  <p>{tr("Połączone przyciski, wybór pojedynczy i wielokrotny. Strzałki, Home i End przenoszą focus; Spacja lub Enter aktywuje przycisk.")}</p>
  <div class="group-samples">
    <div><span class="sample-label">{tr("Zwykła grupa działań")}</span><ButtonGroup label={tr("Filtruj wyniki według języka")} items={uiOptions([{value:'all',label:'Wszystkie'},{value:'pl',label:'Polskie'},{value:'en',label:'Angielskie'}])} onactivate={value=>{language=value==='all'?'':value;action=tr("Zmieniono filtr języka: {value0}.", {value0: (value==='all'?'wszystkie':value==='pl'?'polskie':'angielskie')})}}/></div>
    <div><span class="sample-label">{tr("Widok wyników — wybór pojedynczy")}</span><ButtonGroup label={tr("Widok wyników")} mode="single" bind:value={view} items={uiOptions([{value:'list',label:'Lista',icon:List},{value:'grid',label:'Siatka',icon:LayoutGrid}])}/></div>
    <div><span class="sample-label">{tr("Wyrównanie tekstu — ikony")}</span><ButtonGroup label={tr("Wyrównanie przykładowego tekstu")} mode="single" iconOnly bind:value={alignment} items={uiOptions([{value:'left',label:'Do lewej',icon:AlignLeft},{value:'center',label:'Wyśrodkuj',icon:AlignCenter},{value:'right',label:'Do prawej',icon:AlignRight}])}/></div>
    <div><span class="sample-label">{tr("Dodatkowy wybór statusów — wiele opcji")}</span><ButtonGroup label={tr("Statusy wyników")} mode="multiple" bind:value={statuses} items={uiOptions(statusOptions)}/></div>
  </div>
  <p class="action-feedback" role="status">{tr(action)}</p>
  <div class="filter-bar" aria-label={tr("Filtry przykładowych projektów")}>
    <FilterChip label={tr("Utworzone przez")} options={uiOptions(authors)} bind:value={author}/>
    <FilterChip label={tr("Status")} options={uiOptions(statusOptions)} bind:value={status}/>
    <FilterChip label={tr("Model")} options={uiOptions(models)} bind:value={model}/>
    <FilterChip label={tr("Źródło")} options={uiOptions(sources)} bind:value={source}/>
    <FilterChip label={tr("Język")} options={uiOptions(languages)} bind:value={language}/>
    <Button variant="ghost" size="compact" onclick={reset}><RotateCcw/>{tr("Wyczyść filtry")}</Button>
  </div>
  <p class="results-count" role="status">{tr("Wyniki:")} {filtered.length} {tr("z")} {rows.length}{tr(". Filtry działają na jawnej lokalnej liście przykładowej.")}</p>
  <div class="results" class:grid={view==='grid'} style={`text-align:${textAlign}`}>
    {#each filtered as row}<article><strong>{tr(row.name)}</strong><span>{tr(authors.find(item=>item.value===row.author)?.label ?? "")} · {tr(statusOptions.find(item=>item.value===row.status)?.label ?? "")}</span><small>{tr(models.find(item=>item.value===row.model)?.label ?? "")} · {tr(sources.find(item=>item.value===row.source)?.label ?? "")} · {tr(languages.find(item=>item.value===row.language)?.label ?? "")}</small></article>{:else}<div class="empty">{tr("Brak projektów pasujących do wybranych filtrów.")}</div>{/each}
  </div>
</section>

<style>
  .group-filter-section{grid-column:1/-1;min-width:0;border:1px solid var(--border);border-radius:12px;padding:23px;scroll-margin-top:18px}.heading{display:flex;align-items:center;gap:10px;margin-bottom:20px}.heading>span{color:var(--muted);font-size:var(--ui-text-10)}.heading h2{font-size:var(--ui-text-14);font-weight:550}.heading code{margin-left:auto;color:var(--muted);font-size:var(--ui-text-10)}p{font-size:var(--ui-text-12);line-height:1.8;color:var(--muted);margin:0 0 18px}.group-samples{display:flex;flex-wrap:wrap;gap:22px 28px;margin:24px 0}.sample-label{display:block;font-size:var(--ui-text-11);color:var(--muted);margin-bottom:9px}.action-feedback{padding:9px 12px;border:1px solid var(--border);border-radius:6px}.filter-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:22px 0 14px}.results-count{font-size:var(--ui-text-11);margin-bottom:12px}.results{display:grid;gap:8px}.results.grid{grid-template-columns:repeat(3,minmax(0,1fr))}.results article{min-width:0;padding:13px;border:1px solid var(--border);border-radius:8px;background:var(--surface)}.results strong,.results span,.results small{display:block;overflow-wrap:anywhere}.results strong{font-size:var(--ui-text-12);font-weight:500}.results span{font-size:var(--ui-text-11);color:var(--muted);line-height:1.7;margin-top:6px}.results small{font-size:var(--ui-text-10);line-height:1.7;color:var(--muted);margin-top:3px}.empty{font-size:var(--ui-text-12);color:var(--muted);padding:22px 0}@media(max-width:700px){.group-filter-section{padding:18px}.heading{flex-wrap:wrap}.heading code{margin-left:0}.results.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
