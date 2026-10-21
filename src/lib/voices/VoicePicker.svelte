<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte'
  import { Search, X, RotateCcw, SlidersHorizontal, ArrowDownWideNarrow, Play, Pause, Check, Plus, LoaderCircle, ChevronDown, Globe2, MessageSquare, BookOpen, GraduationCap, Megaphone, Mic2, Headphones, Ellipsis, Copy, Link, FolderPlus, Bookmark, Clock3 } from '@lucide/svelte'
  import VoiceAvatar from '../ui/VoiceAvatar.svelte'
  import Input from '../ui/Input.svelte'
  import Button from '../ui/Button.svelte'
  import ButtonGroup from '../ui/ButtonGroup.svelte'
  import Tooltip from '../ui/Tooltip.svelte'
  import Select from '../ui/Select.svelte'
  import LanguageFlag from '../ui/LanguageFlag.svelte'
  import { detailsPopover, mountModal } from '../ui/overlay'
  import { voiceAge } from './voice-metadata'
  import { voiceFolders, defaultVoiceFolder, folderWithVoice, saveVoiceToFolder, addVoiceFolder, type VoiceFolder } from './voice-folders'
  import type { Voice } from '../data'
  import { emptyVoiceFilters, filterVoices, availableVoiceFilters, voiceLanguageCode, voiceLanguageSupport, normalizeVoiceLanguages, voiceLanguageCount, type VoiceFilters } from './voice-picker'
  import './voice-picker.css'

  let { voices, selectedId, initialVoiceId='', demo=false, ready=false, playingId='', busyId='', modelLanguages=[], modelName='', languageLoading=false, languageNotice='', onrefresh, onselect, onpreview, onclose, oncreate }: {
    voices:Voice[]; selectedId:string; initialVoiceId?:string; demo?:boolean; ready?:boolean; playingId?:string; busyId?:string;
    modelLanguages?:string[]; modelName?:string; languageLoading?:boolean; languageNotice?:string;
    onrefresh?:()=>void|Promise<void>; onselect:(voice:Voice)=>void; onpreview:(voice:Voice)=>Promise<void>; onclose:()=>void; oncreate:()=>void
  } = $props()
  const uid=$props.id()
  let filters=$state<VoiceFilters>({...emptyVoiceFilters(),query:untrack(()=>initialVoiceId)}), filtersOpen=$state(false), sort=$state('default'), error=$state(''), refreshError=$state(''), message=$state('')
  let viewportWidth=$state(window.innerWidth), dialogElement:HTMLDialogElement
  let demoFolders=$state<VoiceFolder[]>(defaultVoiceFolder()), folderId=$state('all'), savingId=$state(''), folderVoiceId=$state(''), newFolderName=$state(''), targetFolder=$state('saved')
  const folders=$derived(demo?demoFolders:$voiceFolders)
  const savedIds=$derived(new Set(folders.flatMap(folder=>folder.voiceIds)))
  let disposed=false, previewRevision=0
  const mobileFilters=$derived(filtersOpen&&viewportWidth<=720)
  $effect(()=>{if(mobileFilters)void tick().then(()=>{if(!disposed)dialogElement?.querySelector<HTMLButtonElement>('.voice-filter-heading button')?.focus()})})
  onDestroy(()=>{disposed=true;previewRevision++})
  const categoryIcons:Record<string,typeof MessageSquare>={Konwersacja:MessageSquare,Narracja:BookOpen,Edukacja:GraduationCap,Reklama:Megaphone,Podcast:Mic2,Audiobook:Headphones}
  const available=$derived(availableVoiceFilters(voices))
  const languages=$derived(normalizeVoiceLanguages(voices.flatMap(voice=>voiceLanguageSupport(voice,modelLanguages).languages)).sort((a,b)=>a.localeCompare(b,'pl')))
  const kinds=$derived([...new Set(voices.map(voice=>voice.kind).filter(Boolean))])
  const visible=$derived.by(()=>{const rows=filterVoices(voices.map(voice=>({...voice,inLibrary:voice.inLibrary||savedIds.has(voice.id)})),filters,modelLanguages).filter(voice=>folderId==='all'||folders.find(folder=>folder.id===folderId)?.voiceIds.includes(voice.id));return sort==='name'?[...rows].sort((a,b)=>a.name.localeCompare(b.name,'pl')):rows})
  const activeFilters=$derived(Number(filters.language!=='all')+filters.categories.length+Number(filters.kind!=='all')+Number(filters.gender!=='all')+Number(filters.ageGroup!=='all'))
  $effect(()=>{if(!languageLoading&&filters.language!=='all'&&!languages.includes(filters.language))filters.language='all'})
  const genders=[{value:'female',label:'Kobiecy'},{value:'male',label:'Męski'},{value:'neutral',label:'Neutralny'}]
  const ages=[{value:'young',label:'Młody'},{value:'adult',label:'Dorosły'},{value:'mature',label:'Dojrzały'}]
  function reset(){filters={...emptyVoiceFilters(),library:filters.library};folderId='all'}
  function category(value:string){filters.categories=filters.categories.includes(value)?filters.categories.filter(item=>item!==value):[...filters.categories,value]}
  function mountDialog(node:HTMLDialogElement){
    const modal=mountModal(node,{returnFocus:'.voice-select,.tool-voice-trigger,.mobile-inspector'})
    let active=true
    void tick().then(()=>{if(active)node.querySelector<HTMLInputElement>('.voice-picker-search input')?.focus()})
    return {destroy(){active=false;modal.destroy()}}
  }
  function backdrop(event:MouseEvent){if(event.target!==event.currentTarget)return;const box=(event.currentTarget as HTMLElement).getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)onclose()}
  async function preview(voice:Voice){const revision=++previewRevision;error='';try{await onpreview(voice)}catch(cause){if(!disposed&&revision===previewRevision)error=cause instanceof Error?cause.message:String(cause)}}
  async function refresh(){refreshError='';try{await onrefresh?.()}catch(cause){if(!disposed)refreshError=cause instanceof Error?cause.message:String(cause)}}
  async function closeFilters(){filtersOpen=false;await tick();dialogElement?.querySelector<HTMLButtonElement>('.voice-picker-mobile-filters')?.focus()}
  function sourceText(voice:Voice){const support=voiceLanguageSupport(voice,modelLanguages);return `${support.source==='model'?'Zakres modelu, bez osobnego testu jakości tego głosu':support.source==='profile'?'Języki zadeklarowane w profilu':'Znany tylko język próbki, brak pełnych danych'}: ${support.languages.join(', ')||'brak'}. Język próbki: ${support.sample||'nie podano'}.`}
  async function saveFolder(voiceId:string, folder='saved'){
    savingId=voiceId;error='';message=''
    try{if(demo)demoFolders=folderWithVoice(demoFolders,folder,voiceId);else saveVoiceToFolder(folder,voiceId);message=`Zapisano głos w folderze „${folders.find(row=>row.id===folder)?.name||''}”.`;folderVoiceId=''}catch(cause){error=`Nie można zapisać głosu: ${cause instanceof Error?cause.message:String(cause)}`}
    finally{savingId=''}
  }
  async function newFolder(voiceId:string){
    try{let id:string;if(demo){const existing=demoFolders.find(row=>row.name.toLocaleLowerCase('pl')===newFolderName.trim().toLocaleLowerCase('pl'));id=existing?.id||crypto.randomUUID();if(!existing)demoFolders=[...demoFolders,{id,name:newFolderName.trim().slice(0,80),voiceIds:[]}]}else id=addVoiceFolder(newFolderName);newFolderName='';await saveFolder(voiceId,id)}catch(cause){error=cause instanceof Error?cause.message:String(cause)}
  }
  async function copyVoice(voice:Voice,link=false){try{const url=new URL(location.href);url.searchParams.set('voice',voice.id);await navigator.clipboard.writeText(link?url.href:voice.id);message=link?'Skopiowano lokalny link do głosu.':'Skopiowano ID głosu.';error=''}catch{error='Nie można skopiować do schowka. Sprawdź uprawnienia aplikacji.'}}
  function dialogKey(event:KeyboardEvent){if(event.key!=='Escape')return;event.stopPropagation();const menu=dialogElement?.querySelector<HTMLDetailsElement>('.voice-row-menu[open]');if(menu){event.preventDefault();menu.open=false;menu.querySelector('summary')?.focus()}else if(mobileFilters){event.preventDefault();void closeFilters()}}
</script>

<svelte:window bind:innerWidth={viewportWidth}/>
<dialog bind:this={dialogElement} class="voice-picker" aria-labelledby={`${uid}-title`} use:mountDialog oncancel={event=>{event.preventDefault();if(mobileFilters)void closeFilters();else onclose()}} onclick={backdrop} onkeydown={dialogKey}>
  <aside class="voice-picker-filters" class:filters-open={filtersOpen} aria-label="Filtry głosów">
    <div class="voice-filter-heading"><h2>Filtry głosów</h2><Button variant="ghost" size="icon" aria-label="Zwiń filtry głosów" onclick={closeFilters}><X/></Button></div>
    <div class="voice-filter-content">
      <div class="voice-language-filter"><Select label="Język generowania" ariaLabel="Język głosu" size="lg" value={filters.language} onchange={value=>filters.language=value} options={[{value:'all',label:'Wszystkie języki'},...languages.map(value=>({value,label:value}))]}>{#snippet triggerContent()}<span class="voice-filter-language-value">{#if filters.language==='all'}<Globe2 size={18}/>{:else}<LanguageFlag language={filters.language}/>{/if}<span>{filters.language==='all'?'Wszystkie języki':filters.language}</span></span><ChevronDown size={14}/>{/snippet}</Select>{#if filters.language!=='all'}<Button variant="ghost" size="icon-xs" class="voice-language-clear" aria-label="Usuń filtr języka" onclick={()=>filters.language='all'}><X/></Button>{/if}</div>
      <Select label="Folder zapisanych głosów" ariaLabel="Folder głosów" value={folderId} onchange={value=>folderId=value} options={[{value:'all',label:'Wszystkie foldery'},...folders.map(folder=>({value:folder.id,label:`${folder.name} (${folder.voiceIds.filter(id=>voices.some(voice=>voice.id===id)).length})`}))]}/>
      <section class="voice-filter-group"><h3>Kategorie</h3>{#if available.categories.length}<div class="voice-category-chips">{#each available.categories as value}{@const Icon=categoryIcons[value]||MessageSquare}<Button variant="outline" size="sm" data-selection aria-pressed={filters.categories.includes(value)} onclick={()=>category(value)}>{#if filters.categories.includes(value)}<Check aria-hidden="true"/>{:else}<Icon/>{/if}{value}</Button>{/each}</div>{:else}<p>Profile nie mają oznaczeń kategorii.</p>{/if}</section>
      <section class="voice-filter-group"><h3>Typ głosu</h3><ButtonGroup label="Typ głosu" mode="single" value={filters.kind} onchange={value=>filters.kind=String(value)} items={[{value:'all',label:'Wszystkie typy'},...kinds.map(value=>({value,label:value}))]}/></section>
      <section class="voice-filter-group"><h3>Płeć</h3>{#if available.genders.length}<ButtonGroup label="Płeć głosu" mode="single" value={filters.gender} onchange={value=>filters.gender=String(value)} items={[{value:'all',label:'Dowolna'},...genders.filter(item=>available.genders.includes(item.value))]}/>{:else}<p>Brak danych o płci w profilach.</p>{/if}</section>
      <section class="voice-filter-group"><h3>Wiek brzmienia</h3>{#if available.ageGroups.length}<ButtonGroup label="Wiek brzmienia" mode="single" value={filters.ageGroup} onchange={value=>filters.ageGroup=String(value)} items={[{value:'all',label:'Dowolny'},...ages.filter(item=>available.ageGroups.includes(item.value))]}/>{:else}<p>Brak danych o wieku brzmienia.</p>{/if}</section>
    </div>
    <Button variant="ghost" class="voice-filter-reset" onclick={reset}><RotateCcw/>Zresetuj wszystkie filtry{#if activeFilters}<span>{activeFilters}</span>{/if}</Button>
    <Button class="voice-filter-apply" onclick={closeFilters}>Pokaż wyniki ({visible.length})</Button>
  </aside>
  <section class="voice-picker-main" inert={mobileFilters}>
    <header class="voice-picker-header"><h2 id={`${uid}-title`} class="visually-hidden">Wybierz głos</h2>
      <div class="voice-library-tabs"><ButtonGroup label="Biblioteka głosów" mode="single" value={filters.library?'mine':'all'} onchange={value=>filters.library=value==='mine'} items={[{value:'all',label:'Wszystkie głosy'},{value:'mine',label:'Moje głosy'}]}/></div>
      <label class="search-field voice-picker-search"><Search size={17}/><Input type="search" unstyled aria-label="Szukaj w głosach" placeholder="Szukaj głosu lub języka…" bind:value={filters.query}/></label>
      <Button variant="ghost" data-selection class="voice-picker-sort" aria-label={sort==='default'?'Sortuj głosy alfabetycznie':'Przywróć kolejność głosów'} aria-pressed={sort==='name'} onclick={()=>sort=sort==='default'?'name':'default'}>{#if sort==='name'}<Check aria-hidden="true"/>{:else}<ArrowDownWideNarrow/>{/if}<span>A–Z</span></Button>
      <Button variant="ghost" size="icon" class="voice-picker-mobile-filters" aria-label="Pokaż filtry głosów" aria-expanded={filtersOpen} onclick={()=>filtersOpen=!filtersOpen}><SlidersHorizontal/></Button>
      <Button variant="ghost" size="icon" class="voice-picker-close" aria-label="Zamknij wybór głosu" onclick={onclose}><X/></Button>
    </header>
    <div class="voice-picker-caption"><span role="status">Głosy: {visible.length} z {voices.length}</span><span>{demo?'Dane przykładowe · wspólna próbka WAV':'Lokalna biblioteka'}</span></div>
    <div class="voice-model-status" role="status">
      {#if languageLoading}<p><LoaderCircle class="spin" size={15}/>Wczytywanie języków modelu…</p>
      {:else if languageNotice||refreshError}<p>{languageNotice||refreshError}</p>{#if onrefresh}<Button variant="outline" size="sm" onclick={refresh}>Ponów odczyt języków</Button>{/if}
      {:else if modelName}<p><Globe2 size={15}/><span>Możliwości modelu: <strong>{modelName}</strong>. Nie jest to osobny test każdego głosu.</span></p>{#if onrefresh}<Button variant="ghost" size="xs" disabled={!ready} onclick={refresh}>Odśwież języki</Button>{/if}
      {:else}<p>Znany jest język próbki. Pełny zakres języków wymaga danych modelu lub profilu.</p>{#if onrefresh}<Button variant="outline" size="sm" disabled={!ready} onclick={refresh}>Sprawdź języki modelu</Button>{/if}{/if}
    </div>
    {#if error}<p class="voice-picker-error" role="alert">{error}</p>{/if}{#if message}<p class="voice-picker-message" role="status">{message}</p>{/if}
    <div class="voice-picker-results" aria-label="Dostępne głosy">
      {#each visible as voice (voice.id)}
        {@const support=voiceLanguageSupport(voice,modelLanguages)}
        {@const primary=support.sample||support.languages[0]}
        {@const unavailable=support.source==='profile'&&!support.languages.length}
        {@const sourceName=support.source==='model'?'Model':support.source==='profile'?'Profil':'Próbka'}
        <article class="voice-picker-row" class:selected={selectedId===voice.id} class:preview-playing={playingId===voice.id}>
          <Button variant="ghost" size="icon" class="voice-row-preview" disabled={!ready||(!demo&&voice.demo)} aria-label={`${busyId===voice.id?'Anuluj wczytywanie':playingId===voice.id?'Wstrzymaj':'Odtwórz'} ${demo?'próbkę WAV':'próbkę głosu'}: ${voice.name}`} onclick={()=>preview(voice)}><VoiceAvatar voiceId={voice.id} name={voice.name} portraitSrc={voice.portraitSrc} size={32}/><span class="voice-preview-icon">{#if busyId===voice.id}<LoaderCircle size={16} class="spin"/>{:else if playingId===voice.id}<Pause size={15} fill="currentColor"/>{:else}<Play size={15} fill="currentColor"/>{/if}</span></Button>
          <Tooltip content={`${voice.name} — ${voice.description}`}><Button variant="ghost" class="voice-row-name" disabled={unavailable} onclick={()=>onselect(voice)}><span class="voice-name-copy"><span class="voice-name-heading"><strong>{voice.name}</strong>{#if selectedId===voice.id}<Check class="voice-selected-check" size={15} aria-label="Wybrany głos"/>{/if}</span><span class="voice-row-description">{voice.description}</span></span></Button></Tooltip>
          <div class="voice-row-language"><span class="voice-language-line"><LanguageFlag language={primary||''}/><span>{primary||'Brak danych'}</span>{#if voice.accent}<span class="voice-accent">{voice.accent}</span>{/if}</span><Tooltip content={sourceText(voice)}><Button variant="ghost" size="xs" class="voice-language-summary" aria-label={`${sourceName}: języki dla ${voice.name}; ${support.source==='sample'?'brak danych o obsłudze':voiceLanguageCount(support.languages.length)}`}>{#if support.source==='sample'}<span class="voice-language-more">?</span>{:else}<span class="voice-language-more">{support.languages.length>1?`+${support.languages.length-1}`:support.languages.length}</span>{/if}</Button></Tooltip></div>
          <div class="voice-row-end"><Tooltip content={voice.createdAt?`Utworzono ${new Date(voice.createdAt).toLocaleString('pl-PL')}`:'Brak daty utworzenia w profilu'}><Button variant="ghost" class="voice-created"><Clock3 size={13}/><time datetime={voice.createdAt}>{voiceAge(voice.createdAt)}</time></Button></Tooltip>
            <div class="voice-row-actions"><Button variant="default" size="sm" disabled={unavailable} aria-label={`Użyj głosu ${voice.name}`} onclick={()=>onselect(voice)}>Użyj</Button><Button variant="outline" size="sm" disabled={savingId===voice.id} aria-label={`Dodaj głos ${voice.name} do folderu`} onclick={()=>{folderVoiceId=voice.id;targetFolder='saved';newFolderName=''}}><Bookmark/>{savedIds.has(voice.id)?'Zapisany':'Dodaj'}</Button>
              <details class="voice-row-menu"><summary aria-label={`Więcej opcji głosu ${voice.name}`}><Ellipsis size={16}/></summary><div class="voice-menu-items" popover="manual" use:detailsPopover><Button variant="ghost" onclick={event=>{void copyVoice(voice);event.currentTarget.closest('details')!.open=false}}><Copy/>Skopiuj ID głosu</Button><Button variant="ghost" onclick={event=>{void copyVoice(voice,true);event.currentTarget.closest('details')!.open=false}}><Link/>Skopiuj link do głosu</Button><Button variant="ghost" onclick={event=>{folderVoiceId=voice.id;targetFolder='saved';newFolderName='';event.currentTarget.closest('details')!.open=false}}><FolderPlus/>Zapisz do folderu</Button></div></details>
            </div>
          </div>
          {#if folderVoiceId===voice.id}<form class="voice-folder-form" onsubmit={event=>{event.preventDefault();void (newFolderName.trim()?newFolder(voice.id):saveFolder(voice.id,targetFolder))}}><Select label="Zapisz głos w folderze" ariaLabel="Folder docelowy" value={targetFolder} onchange={value=>targetFolder=value} options={folders.map(folder=>({value:folder.id,label:folder.name}))}/><label>Lub utwórz nowy folder<Input aria-label="Nazwa nowego folderu" maxlength={80} placeholder="Nazwa folderu" bind:value={newFolderName}/></label><div><Button type="submit" size="sm" disabled={savingId===voice.id}>{savingId===voice.id?'Zapisywanie…':'Zapisz'}</Button><Button variant="ghost" size="sm" onclick={()=>folderVoiceId=''}>Anuluj</Button></div></form>{/if}
        </article>
      {:else}<div class="voice-picker-empty"><Search size={27}/><h3>Brak pasujących głosów</h3><p>Zmień wyszukiwanie lub filtry.</p><Button variant="outline" onclick={reset}>Wyczyść filtry i wyszukiwanie</Button></div>{/each}
    </div>
    <footer class="voice-picker-footer"><span>{demo?'Głosy służą do pracy nad interfejsem.':'Języki modelu i język próbki są opisane oddzielnie.'}</span><Button variant="ghost" size="sm" onclick={oncreate}><Plus/>Dodaj głos</Button></footer>
  </section>
</dialog>
