<script lang="ts">
  import Button from './ui/Button.svelte';
  import { onDestroy, onMount } from 'svelte'
  import { Plus, Trash2, ArrowUp, ArrowDown, Save, FolderOpen, Download, RefreshCw, Play, BookOpen, Upload, LoaderCircle } from '@lucide/svelte'
  import ToolWorkspace from './ToolWorkspace.svelte'
  import ToolModelSettings from './ToolModelSettings.svelte'
  import ToolVoiceSettings from './ToolVoiceSettings.svelte'
  import Select from './ui/Select.svelte'
  import Slider from './ui/Slider.svelte'
  import Switch from './ui/Switch.svelte'
  import { profiles as loadProfiles, request, type Profile } from './api'
  import { productionJson, productionStream, postJson, downloadProduction } from './production'
  import { saveTextFile } from './studio-tools'
  import { applyStoryEvent, compileStory, emptyStoryRender, moveStoryItem, newStory, newStoryBlock, newStoryScene, readStory, storyAudioPath, storyError, storyStats, STORIES_DRAFT_KEY, STORIES_MAX_BYTES, type StoryState, type StoryBlock, type StorySettings, type StoryProject, type StoryOutput, type StoryResume } from './stories'

  let { ready, onnotify = (_message: string) => {} }: { ready: boolean; onnotify?: (message: string) => void } = $props()
  const uid = $props.id()
  let story = $state<StoryState>(newStory()), selectedSceneId = $state(''), projectId = $state(''), dirty = $state(false)
  let view = $state<'editor' | 'library'>('editor'), tab = $state<'settings' | 'history'>('settings')
  let voices = $state<Profile[]>([]), projects = $state<StoryProject[]>([]), outputs = $state<StoryOutput[]>([]), resumable = $state<StoryResume[]>([])
  let loading = $state(false), busy = $state(false), modelBusy = $state(false), error = $state(''), message = $state(''), draftMessage = $state(''), draftFailed = $state(false)
  let render = $state(emptyStoryRender()), previewUrl = $state(''), previewName = $state(''), previewError = $state('')
  let controller: AbortController | undefined, refreshController: AbortController | undefined, draftTimer: ReturnType<typeof setTimeout> | undefined, disposed = false
  let draftStorage: Storage | undefined, draftWritable = true
  let importInput = $state<HTMLInputElement>()
  const locked = $derived(busy || modelBusy)
  const stats = $derived(storyStats(story))
  const knownVoices = $derived(new Set(voices.map(voice => voice.id)))
  const selectedScene = $derived(story.scenes.find(scene => scene.id === selectedSceneId) || story.scenes[0])
  const validation = $derived(storyError(story, ready ? knownVoices : undefined))
  const voiceOptions = $derived([{ value: '', label: 'Głos wspólny historii' }, ...voices.map(voice => ({ value: voice.id, label: voice.name }))])
  const renderedPartially = $derived(render.phase === 'done' && render.failed.length > 0)

  function fail(cause: unknown) { if (!disposed && !(cause instanceof Error && cause.name === 'AbortError')) error = cause instanceof Error ? cause.message : String(cause) }
  function writeDraft() {
    if (!draftStorage || !draftWritable) { draftFailed = true; draftMessage = 'Szkic lokalny jest niedostępny. Zapisz projekt w silniku lub pobierz JSON.'; return }
    try {
      readStory(story)
      const source = JSON.stringify({ version: 1, projectId, story })
      if (new TextEncoder().encode(source).length > STORIES_MAX_BYTES) throw new Error('Szkic przekracza 1 MB. Pobierz projekt JSON lub podziel historię.')
      draftStorage.setItem(STORIES_DRAFT_KEY, source)
      draftFailed = false; draftMessage = 'Szkic zapisano na tym urządzeniu.'
    } catch (cause) { draftFailed = true; draftMessage = cause instanceof Error && cause.name === 'QuotaExceededError' ? 'Brak miejsca na szkic. Zapisz projekt w silniku lub pobierz JSON.' : cause instanceof Error ? cause.message : 'Nie udało się zapisać szkicu.' }
  }
  function flushDraft() { if (draftTimer) { clearTimeout(draftTimer); draftTimer = undefined; writeDraft() } }
  function changed() { dirty = true; clearTimeout(draftTimer); draftMessage = 'Zapisywanie szkicu…'; draftTimer = setTimeout(() => { draftTimer = undefined; writeDraft() }, 350) }
  function setting<K extends keyof StorySettings>(key: K, value: StorySettings[K]) { story = { ...story, settings: { ...story.settings, [key]: value } }; changed() }
  function sceneTitle(value: string) { if (!selectedScene) return; story = { ...story, scenes: story.scenes.map(scene => scene.id === selectedScene.id ? { ...scene, title: value } : scene) }; changed() }
  function patchBlock(id: string, patch: Partial<StoryBlock>) { story = { ...story, scenes: story.scenes.map(scene => ({ ...scene, blocks: scene.blocks.map(block => block.id === id ? { ...block, ...patch } : block) })) }; changed() }
  function addScene() { const scene = newStoryScene(`Scena ${story.scenes.length + 1}`); story = { ...story, scenes: [...story.scenes, scene] }; selectedSceneId = scene.id; changed() }
  function removeScene(id: string) {
    const scene = story.scenes.find(row => row.id === id)
    if (!scene || story.scenes.length < 2 || !confirm(`Usunąć scenę „${scene.title}” i jej ${scene.blocks.length} bloków z bieżącego szkicu?`)) return
    story = { ...story, scenes: story.scenes.filter(row => row.id !== id) }; selectedSceneId = story.scenes[0]?.id || ''; changed()
  }
  function moveScene(id: string, direction: -1 | 1) { story = { ...story, scenes: moveStoryItem(story.scenes, id, direction) }; changed() }
  function addBlock(pauseOnly = false) { if (!selectedScene) return; const block = newStoryBlock(); if (pauseOnly) block.pauseMs = 500; story = { ...story, scenes: story.scenes.map(scene => scene.id === selectedScene.id ? { ...scene, blocks: [...scene.blocks, block] } : scene) }; changed() }
  function removeBlock(id: string) {
    const block = selectedScene?.blocks.find(row => row.id === id)
    if (block?.text.trim() && !confirm('Usunąć ten blok wypowiedzi z bieżącego szkicu?')) return
    story = { ...story, scenes: story.scenes.map(scene => ({ ...scene, blocks: scene.blocks.filter(block => block.id !== id) })) }; changed()
  }
  function moveBlock(id: string, direction: -1 | 1) { story = { ...story, scenes: story.scenes.map(scene => ({ ...scene, blocks: moveStoryItem(scene.blocks, id, direction) })) }; changed() }
  function transferBlock(id: string, targetId: string) {
    if (!selectedScene || selectedScene.id === targetId || !story.scenes.some(scene => scene.id === targetId)) return
    const block = selectedScene.blocks.find(row => row.id === id)
    if (!block) return
    story = { ...story, scenes: story.scenes.map(scene => ({ ...scene, blocks: scene.id === targetId ? [...scene.blocks, block] : scene.blocks.filter(row => row.id !== id) })) }; selectedSceneId = targetId; changed()
  }
  async function work(action: (signal: AbortSignal) => Promise<void>) {
    if (locked || disposed) return
    const abort = new AbortController(); controller = abort; busy = true; error = ''; message = ''
    try { await action(abort.signal) } catch (cause) { if (!disposed && abort.signal.aborted) message = 'Przerwano oczekiwanie. Silnik może kończyć bieżącą scenę; odśwież zadania przed wznowieniem.'; else fail(cause) }
    finally { if (controller === abort) { controller = undefined; if (!disposed) busy = false } }
  }
  async function refresh(parentSignal?: AbortSignal) {
    if (!ready || disposed) return
    refreshController?.abort(); const abort = new AbortController(); refreshController = abort
    const signal = parentSignal ? AbortSignal.any([abort.signal, parentSignal]) : abort.signal
    loading = true
    try {
      const results = await Promise.allSettled([
        loadProfiles(signal), productionJson<StoryProject[]>('/projects', { signal }), productionJson<{ jobs: StoryOutput[] }>('/longform/jobs?limit=100', { signal }), productionJson<{ jobs: StoryResume[] }>('/audiobook/jobs', { signal }),
      ])
      signal.throwIfAborted(); if (disposed || refreshController !== abort) return
      const warnings: string[] = []
      if (results[0].status === 'fulfilled') voices = results[0].value; else warnings.push('Nie udało się odczytać głosów.')
      if (results[2].status === 'fulfilled') outputs = results[2].value.jobs.filter(output => output.type === 'story'); else warnings.push('Nie udało się odczytać nagrań historii.')
      if (results[3].status === 'fulfilled') resumable = results[3].value.jobs.filter(job => job.type === 'story'); else warnings.push('Nie udało się odczytać zadań do wznowienia.')
      if (results[1].status === 'fulfilled') {
        const rows = results[1].value.slice(0, 100), found: StoryProject[] = []; let cursor = 0, skipped = 0
        // Metadata has no kind. Fetch details with four workers, avoiding a request burst.
        await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
          while (cursor < rows.length) {
            const row = rows[cursor++]
            try { const result = await productionJson<StoryProject>(`/projects/${encodeURIComponent(row.id)}`, { signal }); if (result.state && typeof result.state === 'object' && (result.state as { kind?: unknown }).kind === 'stories') { readStory(result.state); found.push(result) } }
            catch (cause) { signal.throwIfAborted(); skipped++ }
          }
        }))
        signal.throwIfAborted(); if (disposed || refreshController !== abort) return
        projects = found.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
        if (skipped) warnings.push(`Nie odczytano ${skipped} projektów. Odśwież bibliotekę, aby ponowić próbę.`)
        if (results[1].value.length > 100) warnings.push('Sprawdzono 100 ostatnich projektów silnika.')
      } else warnings.push('Nie udało się odczytać projektów.')
      if (warnings.length) error = warnings.join(' ')
    } finally { if (refreshController === abort) { loading = false; refreshController = undefined } }
  }
  function newProject() {
    if (locked || dirty && !confirm('Otworzyć nową historię? Bieżące zmiany projektu zastąpi nowy szkic.')) return
    flushDraft(); story = newStory(); selectedSceneId = story.scenes[0].id; projectId = ''; dirty = false; view = 'editor'; render = emptyStoryRender(); error = ''; message = ''; writeDraft()
  }
  async function saveProject() {
    if (!ready) return
    await work(async signal => {
      if (!story.title.trim()) throw new Error('Nadaj historii tytuł przed zapisaniem.')
      readStory(story)
      const result = await productionJson<{ id: string }>(projectId ? `/projects/${encodeURIComponent(projectId)}` : '/projects', { ...postJson({ name: story.title.trim(), state: story }, signal), method: projectId ? 'PUT' : 'POST' })
      signal.throwIfAborted(); projectId = result.id; dirty = false; writeDraft(); message = 'Projekt historii zapisano w prywatnej bibliotece.'; onnotify(message); await refresh(signal)
    })
  }
  async function openProject(id: string) {
    if (!ready || locked || dirty && !confirm('Otworzyć zapisany projekt? Bieżące zmiany zastąpi zapis z biblioteki.')) return
    await work(async signal => {
      const result = await productionJson<StoryProject>(`/projects/${encodeURIComponent(id)}`, { signal })
      const next = readStory(result.state); signal.throwIfAborted()
      story = next; projectId = result.id; selectedSceneId = next.scenes[0]?.id || ''; dirty = false; view = 'editor'; render = emptyStoryRender(); writeDraft(); message = 'Otworzono zapisany projekt historii.'
    })
  }
  function exportProject() { saveTextFile(JSON.stringify({ version: 1, story }, null, 2), 'historia-projekt.json') }
  async function importProject(file?: File) {
    if (!file || locked) return
    try {
      if (file.size > STORIES_MAX_BYTES) throw new Error('Projekt JSON nie może przekraczać 1 MB.')
      const data = JSON.parse(await file.text()); const next = readStory(data.story || data.state || data)
      if (dirty && !confirm('Otworzyć projekt z pliku? Bieżące zmiany zastąpi importowany szkic.')) return
      flushDraft(); story = next; projectId = ''; selectedSceneId = next.scenes[0]?.id || ''; dirty = true; view = 'editor'; render = emptyStoryRender(); writeDraft(); message = 'Wczytano projekt z pliku. Zapisz go w bibliotece, aby utworzyć osobny projekt.'
    } catch (cause) { fail(cause) }
    finally { if (importInput) importInput.value = '' }
  }
  function consumeEvent(event: { type: string; [key: string]: unknown }) { if (!disposed) render = applyStoryEvent(render, event) }
  function beginRender() { render = emptyStoryRender(); render.phase = 'running' }
  async function renderStory(selectedOnly = false) {
    if (!ready) return
    await work(async signal => {
      const chapters = selectedOnly && selectedScene ? [selectedScene] : story.scenes
      const body = compileStory(story, knownVoices, chapters)
      if (selectedOnly) body.metadata.title = `${story.title.trim()} — ${selectedScene?.title || 'scena'}`
      flushDraft(); beginRender()
      await productionStream('/longform/render', postJson(body, signal), consumeEvent)
      signal.throwIfAborted()
      if (render.phase === 'error') throw new Error(render.message)
      if (render.phase !== 'done' && render.phase !== 'stopped') throw new Error('Strumień zakończył się bez gotowego pliku. Sprawdź zadania do wznowienia.')
      message = render.message; await refresh(signal)
    })
  }
  async function resume(job: StoryResume) {
    if (!ready || job.type !== 'story' || ['running', 'queued'].includes(job.status)) return
    await work(async signal => {
      beginRender()
      await productionStream(`/audiobook/resume/${encodeURIComponent(job.job_id)}`, { method: 'POST', signal }, consumeEvent)
      signal.throwIfAborted()
      if (render.phase === 'error') throw new Error(render.message)
      if (render.phase !== 'done' && render.phase !== 'stopped') throw new Error('Wznowienie nie potwierdziło gotowego pliku. Odśwież listę zadań.')
      message = render.message; await refresh(signal)
    })
  }
  async function listen(output: string) {
    if (!ready) return
    await work(async signal => {
      const response = await request(storyAudioPath(output), { signal })
      if (!response.ok) throw new Error(`Nie można wczytać nagrania (${response.status}).`)
      if (Number(response.headers.get('Content-Length')) > 128 * 1024 * 1024) { await response.body?.cancel(); throw new Error('Nagranie przekracza limit odsłuchu 128 MB. Pobierz je i otwórz w odtwarzaczu systemowym.') }
      const blob = await response.blob(); signal.throwIfAborted()
      if (!blob.size || !blob.type.startsWith('audio/') && blob.type !== 'application/octet-stream') throw new Error('Silnik nie zwrócił obsługiwanego nagrania audio.')
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      previewUrl = URL.createObjectURL(blob.type === 'application/octet-stream' ? new Blob([blob], { type: output.endsWith('.m4b') ? 'audio/mp4' : 'audio/mpeg' }) : blob); previewName = output; previewError = ''; message = 'Wczytano nagranie. Uruchom odtwarzanie poniżej.'
    })
  }
  function download(output: string) { void work(async signal => { await downloadProduction(storyAudioPath(output), output, signal); message = 'Przygotowano pobieranie pliku.' }) }
  onMount(() => {
    try {
      draftStorage = localStorage
      const source = draftStorage.getItem(STORIES_DRAFT_KEY)
      if (source) {
        if (new TextEncoder().encode(source).length > STORIES_MAX_BYTES) throw new Error('Zapis szkicu przekracza limit 1 MB.')
        const draft = JSON.parse(source)
        if (draft.version !== 1 || typeof draft.projectId !== 'string') throw new Error('Nieobsługiwany zapis szkicu historii.')
        story = readStory(draft.story); projectId = draft.projectId; dirty = true; draftMessage = 'Przywrócono lokalny szkic. Zapisz projekt, aby utrwalić go w bibliotece.'
      }
    } catch (cause) { draftWritable = false; draftFailed = true; draftMessage = `${cause instanceof Error ? cause.message : 'Nie odczytano szkicu.'} Zachowano poprzedni zapis bez zmian.` }
    selectedSceneId = story.scenes[0]?.id || ''
    const flush = () => flushDraft(); window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  })
  $effect(() => {
    if (!ready) { controller?.abort(); refreshController?.abort(); return }
    const abort = new AbortController(); void refresh(abort.signal).catch(cause => { if (!abort.signal.aborted) fail(cause) })
    return () => { abort.abort(); refreshController?.abort() }
  })
  onDestroy(() => { flushDraft(); disposed = true; controller?.abort(); refreshController?.abort(); if (previewUrl) URL.revokeObjectURL(previewUrl) })
</script>

<ToolWorkspace title="Historie i dialogi" description="Ułóż sceny, przypisz głosy i nagraj historię z rozdziałami." bind:tab historyCount={outputs.length + resumable.length}>
  {#snippet headerActions()}
    <div class="story-header-actions"><Button variant="outline" disabled={locked} onclick={newProject}><Plus size={14}/>Nowa historia</Button><Button variant="outline" disabled={locked} onclick={() => { view = view === 'editor' ? 'library' : 'editor'; if (view === 'library') void refresh().catch(fail) }}><FolderOpen size={14}/>{view === 'editor' ? 'Biblioteka' : 'Edytor'}</Button></div>
  {/snippet}
  {#snippet content()}
    <div class="stories-content">
      {#if !ready}<p class="tool-workspace-note" role="status">Możesz pisać historię offline. Uruchom silnik w ustawieniach, aby odczytać głosy, zapisać projekt w bibliotece i generować nagrania.</p>{/if}
      {#if view === 'library'}
        <div class="story-section-heading"><h2>Zapisane projekty</h2><Button variant="ghost" disabled={!ready || loading || locked} onclick={() => void refresh().catch(fail)}><RefreshCw size={14}/>{loading ? 'Wczytywanie…' : 'Odśwież'}</Button></div>
        <div class="story-project-grid">{#each projects as project (project.id)}<article class="story-project"><BookOpen size={22}/><strong>{project.name}</strong><small>{project.updated_at ? new Date(project.updated_at * 1000).toLocaleString('pl-PL') : 'Projekt Stories'}</small><Button variant="outline" disabled={!ready || locked} onclick={() => openProject(project.id)}>Otwórz historię</Button></article>{/each}</div>
        {#if !projects.length}<p class="tool-workspace-empty">Zapisane projekty historii pojawią się tutaj.</p>{/if}
        <p class="tool-workspace-note">Gotowe nagrania i zadania do wznowienia są w zakładce „Historia” po prawej.</p>
      {:else}
        <label class="story-label" for={`${uid}-title`}>Tytuł historii</label><input id={`${uid}-title`} class="text-input story-title" value={story.title} disabled={locked} oninput={event => { story = { ...story, title: event.currentTarget.value }; changed() }}/>
        <div class="story-section-heading"><h2>Sceny</h2><Button variant="outline" disabled={locked} onclick={addScene}><Plus size={14}/>Dodaj scenę</Button></div>
        <nav class="story-scenes" aria-label="Sceny historii">{#each story.scenes as scene, index (scene.id)}<button class="story-scene-tab" class:selected={selectedScene?.id === scene.id} aria-current={selectedScene?.id === scene.id ? 'step' : undefined} onclick={() => selectedSceneId = scene.id}><span>{String(index + 1).padStart(2, '0')}</span>{scene.title || 'Bez tytułu'}<small>{scene.blocks.length}</small></button>{/each}</nav>
        {#if selectedScene}
          <div class="story-scene-heading"><input class="text-input" aria-label="Tytuł wybranej sceny" value={selectedScene.title} disabled={locked} oninput={event => sceneTitle(event.currentTarget.value)}/><Button variant="ghost" size="icon" aria-label="Przenieś scenę wcześniej" disabled={locked || story.scenes[0]?.id === selectedScene.id} onclick={() => moveScene(selectedScene.id, -1)}><ArrowUp size={15}/></Button><Button variant="ghost" size="icon" aria-label="Przenieś scenę później" disabled={locked || story.scenes.at(-1)?.id === selectedScene.id} onclick={() => moveScene(selectedScene.id, 1)}><ArrowDown size={15}/></Button><Button variant="ghost" size="icon" aria-label="Usuń wybraną scenę" disabled={locked || story.scenes.length < 2} onclick={() => removeScene(selectedScene.id)}><Trash2 size={15}/></Button></div>
          <div class="story-blocks">{#each selectedScene.blocks as block, index (block.id)}
            <article class="story-block"><header><strong>Blok {index + 1}{!block.text.trim() && block.pauseMs > 0 ? ' · przerwa' : ''}</strong><div><Button variant="ghost" size="icon" aria-label={`Przenieś blok ${index + 1} wcześniej`} disabled={locked || index === 0} onclick={() => moveBlock(block.id, -1)}><ArrowUp size={14}/></Button><Button variant="ghost" size="icon" aria-label={`Przenieś blok ${index + 1} później`} disabled={locked || index === selectedScene.blocks.length - 1} onclick={() => moveBlock(block.id, 1)}><ArrowDown size={14}/></Button><Button variant="ghost" size="icon" aria-label={`Usuń blok ${index + 1}`} disabled={locked} onclick={() => removeBlock(block.id)}><Trash2 size={14}/></Button></div></header>
              <Select label={`Głos bloku ${index + 1}`} value={block.voiceId} onchange={value => patchBlock(block.id, { voiceId: value })} options={block.voiceId && !knownVoices.has(block.voiceId) ? [...voiceOptions, { value: block.voiceId, label: `Profil niedostępny · ${block.voiceId}`, disabled: true }] : voiceOptions} disabled={locked}/>
              <textarea class="text-input story-script" aria-label={`Wypowiedź bloku ${index + 1}`} value={block.text} rows="3" placeholder="Wpisz wypowiedź. Pusty blok z przerwą dodaje ciszę." disabled={locked} oninput={event => patchBlock(block.id, { text: event.currentTarget.value })}></textarea>
              <div class="story-block-settings"><label>Przerwa po bloku · ms<input type="number" min="0" max="10000" step="50" aria-label={`Przerwa po bloku ${index + 1} w milisekundach`} value={Number.isFinite(block.pauseMs) ? block.pauseMs : ''} disabled={locked} oninput={event => patchBlock(block.id, { pauseMs: event.currentTarget.valueAsNumber })}/></label><label>Tempo · ×<input type="number" min="0.5" max="2" step="0.05" aria-label={`Tempo bloku ${index + 1}`} value={block.speed ?? story.settings.speed} disabled={locked} oninput={event => patchBlock(block.id, { speed: event.currentTarget.valueAsNumber })}/></label>{#if block.speed !== null}<Button variant="ghost" disabled={locked} onclick={() => patchBlock(block.id, { speed: null })}>Przywróć wspólne tempo</Button>{/if}</div>
              {#if story.scenes.length > 1}<Select label={`Przenieś blok ${index + 1} do sceny`} value={selectedScene.id} onchange={value => transferBlock(block.id, value)} options={story.scenes.map(scene => ({ value: scene.id, label: scene.title || 'Scena bez tytułu' }))} disabled={locked}/>{/if}
            </article>
          {/each}</div>
          {#if !selectedScene.blocks.length}<p class="tool-workspace-empty">Ta scena jest pusta. Dodaj wypowiedź lub przerwę.</p>{/if}
          <div class="story-add-actions"><Button variant="outline" disabled={locked} onclick={() => addBlock()}><Plus size={14}/>Dodaj wypowiedź</Button><Button variant="ghost" disabled={locked} onclick={() => addBlock(true)}>Dodaj przerwę</Button><Button variant="ghost" disabled={!ready || locked || !!storyError(story, knownVoices, [selectedScene])} onclick={() => renderStory(true)}><Play size={14}/>Nagraj wybraną scenę</Button></div>
        {/if}
        <details class="story-plan"><summary>Plan historii · {stats.scenes} scen · {stats.blocks} bloków · {stats.voices} głosów</summary><p class="tool-workspace-note">{stats.characters.toLocaleString('pl-PL')} znaków do wypowiedzenia. Jawne przerwy: {(stats.pauseMs / 1000).toLocaleString('pl-PL')} s. Sceny zostaną rozdziałami nagrania. Czas mowy poznamy po syntezie.</p>{#each story.scenes as scene}<p><strong>{scene.title || 'Scena bez tytułu'}</strong> · {scene.blocks.length} bloków</p>{/each}</details>
        {#if validation}<p class="tool-workspace-note" role="status">Przed generowaniem: {validation}</p>{/if}
        <div class="story-file-actions"><Button variant="ghost" disabled={locked} onclick={() => importInput?.click()}><Upload size={14}/>Wczytaj projekt JSON</Button><Button variant="ghost" disabled={locked} onclick={exportProject}><Download size={14}/>Pobierz projekt JSON</Button><input bind:this={importInput} type="file" accept="application/json,.json" aria-label="Projekt historii JSON" disabled={locked} onchange={event => void importProject(event.currentTarget.files?.[0])}/></div>
      {/if}
      {#if busy}<p class="story-status" role="status"><LoaderCircle size={14} class="spin"/>{render.phase !== 'idle' ? render.message || 'Generowanie historii…' : 'Przetwarzanie…'}<Button variant="ghost" onclick={() => controller?.abort()}>Przerwij oczekiwanie</Button></p><p class="tool-workspace-note">Po przerwaniu silnik może kończyć bieżącą scenę. Odśwież historię przed wznowieniem.</p>{/if}
      {#if render.total}<div class="story-progress"><span>Gotowe sceny: {render.completed.length} / {render.total}{render.failed.length ? ` · błędy: ${render.failed.length}` : ''}</span><progress max={render.total} value={render.completed.length}></progress></div>{/if}
      {#if render.output}<div class="story-result"><strong>{renderedPartially ? 'Nagranie jest niepełne' : 'Nagranie historii gotowe'}</strong><span>{render.output}</span><div><Button variant="outline" disabled={locked || !ready} onclick={() => listen(render.output)}><Play size={14}/>Wczytaj odsłuch</Button><Button variant="outline" disabled={locked || !ready} onclick={() => download(render.output)}><Download size={14}/>Pobierz {render.output.split('.').at(-1)?.toUpperCase()}</Button></div></div>{/if}
      {#if previewUrl}<div class="story-audio"><strong>{previewName}</strong><audio controls src={previewUrl} onerror={() => previewError = 'Nie można odtworzyć tego pliku w tym widoku. Pobierz go i otwórz w odtwarzaczu systemowym.'}></audio><Button href={previewUrl} download={previewName} variant="ghost">Pobierz wczytane nagranie</Button>{#if previewError}<p class="story-error" role="alert">{previewError}</p>{/if}</div>{/if}
      {#if render.logs.length}<details class="story-log"><summary>Dziennik generowania</summary>{#each render.logs as entry}<p>{entry}</p>{/each}</details>{/if}
      {#if error}<p class="story-error" role="alert">{error}</p>{/if}
      {#if message}<p class="tool-workspace-note" role="status">{message}</p>{/if}
      {#if draftMessage}<p class:story-error={draftFailed} class:tool-workspace-note={!draftFailed} role="status">{draftMessage}{dirty && !draftFailed ? ' Projekt ma zmiany niezapisane w bibliotece.' : ''}</p>{/if}
    </div>
  {/snippet}
  {#snippet settings()}
    <ToolModelSettings {ready} disabled={busy} family="tts" bind:busy={modelBusy}/>
    <ToolVoiceSettings profiles={voices} value={story.settings.defaultVoice} onchange={value => setting('defaultVoice', value)} {ready} disabled={locked} label="Wspólny głos historii"/>
    <Select label="Język historii" value={story.settings.language} onchange={value => setting('language', value)} options={['Auto', 'Polish', 'English', 'German', 'French', 'Spanish', 'Italian', 'Ukrainian'].map((value, i) => ({ value, label: ['Z profilu / automatycznie', 'Polski', 'Angielski', 'Niemiecki', 'Francuski', 'Hiszpański', 'Włoski', 'Ukraiński'][i] }))} disabled={locked}/>
    <Slider label="Wspólne tempo" value={story.settings.speed} min={0.5} max={2} step={0.05} valueLabel={`${story.settings.speed.toFixed(2)}×`} onchange={value => setting('speed', value)} disabled={locked}/>
    <Select label="Format nagrania" value={story.settings.format} onchange={value => setting('format', value as 'mp3' | 'm4b')} options={[{ value: 'mp3', label: 'MP3 · uniwersalne audio' }, { value: 'm4b', label: 'M4B · rozdziały' }]} disabled={locked}/>
    <Select label="Bitrate" value={story.settings.bitrate} onchange={value => setting('bitrate', value)} options={['64k', '128k', '192k', '256k'].map(value => ({ value, label: `${value.replace('k', '')} kb/s` }))} disabled={locked}/>
    <Select label="Wyrównanie głośności" value={story.settings.loudness} onchange={value => setting('loudness', value)} options={[{ value: 'off', label: 'Wyłączone' }, { value: 'acx', label: 'Profil ACX' }, { value: 'podcast', label: 'Podcast' }]} disabled={locked}/>
    <p class="tool-workspace-note">Profil głośności nie jest certyfikatem odbioru ACX. Generowanie używa aktywnego silnika TTS; nie każdy silnik obsługuje ten sam zakres języków i parametrów.</p>
    <Slider label="Przerwa między wypowiedziami" value={story.settings.lineGapMs} min={0} max={5000} step={50} valueLabel={`${story.settings.lineGapMs} ms`} onchange={value => setting('lineGapMs', value)} disabled={locked}/>
    <Slider label="Przerwa między akapitami" value={story.settings.paragraphGapMs} min={0} max={5000} step={50} valueLabel={`${story.settings.paragraphGapMs} ms`} onchange={value => setting('paragraphGapMs', value)} disabled={locked}/>
    <div class="story-switch"><span>Przytnij ciszę na brzegach</span><Switch label="Przytnij ciszę na brzegach" checked={story.settings.trimEdges} onchange={value => setting('trimEdges', value)} disabled={locked}/></div>
    <div class="story-switch"><span>Różne ujęcia powtarzanych zdań</span><Switch label="Różne ujęcia powtarzanych zdań" checked={story.settings.varyRepeats} onchange={value => setting('varyRepeats', value)} disabled={locked}/></div>
    <label class="story-label" for={`${uid}-author`}>Autor</label><input id={`${uid}-author`} class="text-input" value={story.settings.author} disabled={locked} oninput={event => setting('author', event.currentTarget.value)}/>
    <label class="story-label" for={`${uid}-narrator`}>Narrator / obsada</label><input id={`${uid}-narrator`} class="text-input" value={story.settings.narrator} disabled={locked} oninput={event => setting('narrator', event.currentTarget.value)}/>
    <details><summary>Parametry syntezy</summary><div class="story-advanced"><div class="story-switch"><span>Własne parametry jakości</span><Switch label="Własne parametry jakości" checked={story.settings.customQuality} onchange={value => setting('customQuality', value)} disabled={locked}/></div>{#if story.settings.customQuality}<Slider label="Kroki syntezy" value={story.settings.steps} min={1} max={64} step={1} onchange={value => setting('steps', value)} disabled={locked}/><Slider label="Współczynnik prowadzenia" value={story.settings.guidance} min={0} max={10} step={0.1} onchange={value => setting('guidance', value)} disabled={locked}/>{/if}<label class="story-label" for={`${uid}-seed`}>Seed · opcjonalnie</label><input id={`${uid}-seed`} class="text-input" inputmode="numeric" placeholder="Losowy / przypięty w profilu" value={story.settings.seed} disabled={locked} oninput={event => setting('seed', event.currentTarget.value)}/><p class="tool-workspace-note">Domyślne parametry renderu: 32 kroki i prowadzenie 2. Seed oraz parametry jakości są stosowane przez obsługujący je silnik.</p></div></details>
  {/snippet}
  {#snippet history()}
    <Button variant="outline" disabled={!ready || loading || locked} onclick={() => void refresh().catch(fail)}><RefreshCw size={14}/>{loading ? 'Wczytywanie…' : 'Odśwież historię'}</Button>
    <h2>Nagrania historii</h2>
    {#each outputs as output (output.job_id)}<article class="tool-workspace-history-item"><strong>{output.title || output.output}</strong><small>{output.chapters} scen · {output.duration_s.toLocaleString('pl-PL')} s · {output.output.split('.').at(-1)?.toUpperCase()}</small><div class="story-history-actions"><Button variant="outline" disabled={!ready || locked} onclick={() => listen(output.output)}><Play size={14}/>Odsłuch</Button><Button variant="ghost" disabled={!ready || locked} onclick={() => download(output.output)}><Download size={14}/>Pobierz</Button></div></article>{/each}
    {#if !outputs.length}<p class="tool-workspace-empty">Gotowe nagrania historii pojawią się tutaj. Audiobooki mają osobną bibliotekę.</p>{/if}
    <h2>Zadania do wznowienia</h2><p class="tool-workspace-note">Wznowienie korzysta z planu i parametrów zapisanych przy przerwanym renderze, niezależnie od zmian bieżącego edytora. Gotowe sceny są ponownie używane z cache.</p>
    {#each resumable as job (job.job_id)}<article class="tool-workspace-history-item"><strong>{job.title || job.job_id}</strong><small>{job.chapters_done} / {job.total_chapters} scen · {['running', 'queued'].includes(job.status) ? 'Silnik nadal wykonuje zadanie' : 'Render przerwany'}</small><Button variant="outline" disabled={!ready || locked || ['running', 'queued'].includes(job.status)} onclick={() => resume(job)}>Wznów historię</Button></article>{/each}
    {#if !resumable.length}<p class="tool-workspace-empty">Brak przerwanych historii do wznowienia.</p>{/if}
  {/snippet}
  {#snippet actions()}
    <span class="tool-workspace-note">{stats.scenes} scen · {stats.characters.toLocaleString('pl-PL')} znaków{dirty ? ' · zmieniony projekt' : ''}</span><div class="story-main-actions"><Button variant="outline" disabled={!ready || locked || !story.title.trim()} onclick={saveProject}><Save size={14}/>Zapisz projekt</Button><Button variant="default" disabled={!ready || locked || !!validation} onclick={() => renderStory()}>Nagraj historię</Button></div>
  {/snippet}
</ToolWorkspace>

<style>
  .stories-content{display:flex;flex-direction:column;gap:18px;min-width:0}.story-header-actions,.story-main-actions,.story-history-actions,.story-add-actions,.story-file-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.story-header-actions{justify-content:flex-end}.story-label{font-size:var(--ui-text-12);color:var(--muted)}.story-title{font-size:var(--ui-text-20)!important;font-weight:600}.story-section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.story-section-heading h2{font-size:var(--ui-text-14);font-weight:600}.story-scenes{display:flex;flex-wrap:wrap;gap:8px}.story-scene-tab{display:flex;gap:8px;align-items:center;max-width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:7px;color:var(--muted);background:var(--surface);font-size:var(--ui-text-12);text-align:left;overflow-wrap:anywhere}.story-scene-tab.selected{border-color:var(--foreground);color:var(--foreground);background:var(--surface-hover)}.story-scene-tab>span,.story-scene-tab>small{font-size:var(--ui-text-10);color:var(--muted)}.story-scene-heading{display:flex;align-items:center;gap:4px}.story-scene-heading>input{flex:1;min-width:0}.story-blocks{display:flex;flex-direction:column;gap:16px}.story-block{display:flex;flex-direction:column;gap:12px;padding:18px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}.story-block>header{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:var(--ui-text-12)}.story-block>header>div{display:flex;gap:2px}.story-script{resize:vertical;min-height:100px;line-height:1.8}.story-block-settings{display:flex;align-items:flex-end;flex-wrap:wrap;gap:12px}.story-block-settings label{display:flex;flex-direction:column;gap:7px;font-size:var(--ui-text-11);color:var(--muted)}.story-block-settings input{width:126px;max-width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;background:var(--input);color:var(--foreground);font:inherit}.story-plan,.story-log{font-size:var(--ui-text-12);line-height:1.8;padding:14px 0;border-top:1px solid var(--border)}summary{cursor:pointer;font-size:var(--ui-text-12)}.story-plan p,.story-log p{margin:8px 0;overflow-wrap:anywhere}.story-file-actions>input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}.story-status{display:flex;align-items:center;gap:8px;font-size:var(--ui-text-12)}.story-progress{display:flex;flex-direction:column;gap:9px;font-size:var(--ui-text-12);color:var(--muted)}.story-progress progress{width:100%;height:6px;accent-color:var(--foreground)}.story-error{font-size:var(--ui-text-12);line-height:1.8;color:var(--danger);overflow-wrap:anywhere}.story-result,.story-audio{display:flex;flex-direction:column;gap:12px;padding:18px;border:1px solid var(--border);border-radius:10px;font-size:var(--ui-text-12)}.story-result>span{color:var(--muted);overflow-wrap:anywhere}.story-result>div{display:flex;flex-wrap:wrap;gap:8px}.story-audio strong{overflow-wrap:anywhere}.story-audio audio{width:100%;height:40px}.story-switch{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:var(--ui-text-12)}.story-advanced{display:flex;flex-direction:column;gap:18px;padding-top:18px}.story-project-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}.story-project{display:flex;flex-direction:column;gap:12px;border:1px solid var(--border);border-radius:10px;padding:18px;font-size:var(--ui-text-12)}.story-project>small{color:var(--muted)}.story-project>strong{overflow-wrap:anywhere}@media(max-width:700px){.story-header-actions{justify-content:flex-start}.story-block{padding:12px}.story-main-actions{width:100%}}
</style>
