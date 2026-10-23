<script lang="ts">
  import Input from '../../ui/Input.svelte'
  import { uiLanguage, createUiTranslator } from "../../i18n"
  import { confirmDialog } from "../../ui/confirm"
  const tr = $derived(createUiTranslator($uiLanguage))

  import '../../ui/document-editor.css'
  import Button from '../../ui/Button.svelte'
  import FilePicker from '../../ui/FilePicker.svelte';
  import AudioPreview from '../../playback/AudioPreview.svelte';
  import VideoCard from '../../ui/VideoCard.svelte';
  import { onDestroy } from 'svelte'
  import { Sparkles, Undo2, BookOpen, Clapperboard, Download, FileText, LoaderCircle, RefreshCw, Save, Upload, Plus, Library, RotateCcw } from '@lucide/svelte'
  import { profiles, request, type Profile } from '../../platform/api'
  import Select from '../../ui/Select.svelte'
  import Slider from '../../ui/Slider.svelte'
  import Switch from '../../ui/Switch.svelte'
  import ToolWorkspace from '../ToolWorkspace.svelte'
  import ToolModelSettings from '../../models/ToolModelSettings.svelte'
  import ToolVoiceSettings from '../../voices/ToolVoiceSettings.svelte'
  import AudiobookPlayer from '../../playback/AudiobookPlayer.svelte'
  import type { BookAudioChunk } from '../../playback/audiobook-playback'
  import { saveTextFile, subtitleText } from '../studio-tools'
  import { bookCanResume, bookJobsBusy, bookDrainState, bookJobStatus, readLongformActivity, dubRequestSegments, dubExportPath } from './production-segments'
  import { currentGeneralPreferences } from '../../settings/general-settings'
  import { bookTextChunks, cleanBookText } from '../../tts/ai'
  import './production-workspace.css'
  import { productionJson, productionStream, downloadProduction, postJson, productionLanguages, type BookPlan, type DubSegment, type FinishedBook, type FinishedDub, type ProductionEvent, type ProductionProject, type ResumableBook } from './production'
  let { kind, ready, onnotify }: { kind: 'dubbing' | 'audiobooks'; ready: boolean; onnotify: (message: string) => void } = $props()
  let title = $state(''), text = $state(''), voice = $state(''), language = $state('pl')
  let voices = $state<Profile[]>([]), busy = $state(false), message = $state(''), error = $state('')
  let file = $state<File>(), plan = $state<BookPlan>(), segments = $state<DubSegment[]>([])
  let jobId = $state(''), prepared = $state(false), translated = $state(false), done = $state(false)
  let projectId = $state(''), projectOptions = $state<ProductionProject[]>([]), books = $state<FinishedBook[]>([])
  let dubs = $state<Array<FinishedDub & { languages: string[] }>>([])
  let output = $state(''), log = $state<string[]>([]), completed = $state(0), total = $state(0)
  // Fraction of the current chapter already synthesized; chapters only finish as a whole.
  let partial = $state(0), startedAt = $state(0), now = $state(0)
  let controller: AbortController | undefined, refreshController: AbortController | undefined
  let refreshPending: Promise<void> | undefined
  let loading = $state(false)
  let tab = $state<'settings' | 'history'>('settings'), modelBusy = $state(false)
  let bookView = $state<'library' | 'editor'>('library'), libraryQuery = $state('')
  let bookFormat = $state('m4b'), bitrate = $state('128k'), loudness = $state('off')
  let author = $state(''), narrator = $state(''), lineGap = $state(0), paragraphGap = $state(0), trimEdges = $state(false)
  let customSteps = $state(false), steps = $state(32), guidance = $state(2)
  let sourceLanguage = $state('auto'), quality = $state(currentGeneralPreferences().translationQuality), timing = $state('strict_slot'), speed = $state(1)
  let sourceUrl = $state(''), sourceVideo = $state(false)
  let finishedDub = $state<{ id: string; language: string }>(), failedChapters = $state(0)
  let resumable = $state<ResumableBook[]>([]), taskId = $state(''), stopping = $state(false), cancelled = $state(false)
  let activeLongform = $state(false), bookJobId = $state(''), bookDrain = $state(false), drainChecking = $state(false), drainMessage = $state('')
  let drainController: AbortController | undefined
  let preserveBackground = $state(false), burnSubtitles = $state(false), dualSubtitles = $state(false), karaokeSubtitles = $state(false)
  let mediaUrl = $state(''), mediaIsVideo = $state(false), ingestUrl = $state(''), sourceMode = $state<'file' | 'url'>('file')
  let disposed = false
  let bookPlayer = $state<AudiobookPlayer>()
  const uid = $props.id()
  const isBook = $derived(kind === 'audiobooks')
  const locked = $derived(!ready || busy || loading || modelBusy || bookDrain)
  const filteredProjects = $derived(projectOptions.filter(project => project.name.toLocaleLowerCase('pl').includes(libraryQuery.toLocaleLowerCase('pl'))))
  const filteredBooks = $derived(books.filter(book => (book.title || book.output).toLocaleLowerCase('pl').includes(libraryQuery.toLocaleLowerCase('pl'))))
  const stage = $derived(done ? 4 : translated ? 3 : segments.length ? 2 : prepared ? 1 : 0)
  $effect(() => {
    if (!file) { sourceUrl = ''; return }
    const url = URL.createObjectURL(file); sourceUrl = url
    return () => URL.revokeObjectURL(url)
  })
  function fail(cause: unknown) { if (disposed) return; if (cause instanceof Error && cause.name === 'AbortError') message = bookDrain ? 'Zamknięto strumień. Trwa potwierdzanie rzeczywistego zatrzymania silnika.' : 'Zatrzymano oczekiwanie. Sprawdź zadanie przed ponowieniem.'; else error = cause instanceof Error && cause.name === 'TimeoutError' ? 'Silnik nie odpowiedział na czas. Spróbuj ponownie.' : cause instanceof Error ? cause.message : String(cause) }
  async function work(action: (signal: AbortSignal) => Promise<void>) {
    if (!ready || busy || modelBusy || bookDrain || disposed) return
    const current = new AbortController(); controller = current
    busy = true; error = ''; message = ''; cancelled = false
    try { await action(current.signal) } catch (cause) { if (!disposed) fail(cause) }
    finally { if (controller === current) { controller = undefined; if (!disposed) { busy = false; taskId = '' } } }
  }
  function event(event: ProductionEvent) {
    const type = event.type
    if (isBook && type === 'audio_chunk') {
      if (typeof event.output === 'string' && typeof event.sequence === 'number' && typeof event.duration_s === 'number' && event.job_id === bookJobId) {
        bookPlayer?.append({ sequence: event.sequence, output: event.output, duration_s: event.duration_s, title: String(event.title || ''), chapter_index: Number(event.chapter_index || 0), text: typeof event.text === 'string' ? event.text : undefined } satisfies BookAudioChunk)
        if (typeof event.part === 'number' && typeof event.parts === 'number' && event.parts > 0) partial = Math.min(1, event.part / event.parts)
        message = `Gotowy fragment ${event.sequence + 1} · rozdział ${Number(event.chapter_index || 0) + 1} · część ${event.part} / ${event.parts}`
      }
      return
    }
    const labels: Record<string, string> = { started: isBook ? 'Ładowanie modelu i generowanie pierwszego fragmentu…' : 'Uruchomiono render', chapter: `Ukończono rozdział: ${event.title || ''}`, assembling: 'Łączenie rozdziałów', mastering: 'Przygotowywanie pliku', ready: 'Plik przygotowany do transkrypcji', done: 'Gotowe', progress: `Generowanie ${event.current ?? ''} / ${event.total ?? ''}`, extract: 'Wydzielanie audio', demucs: 'Separacja głosu', stopped: 'Render zatrzymany', cancelled: 'Zadanie anulowane' }
    message = labels[type] || String(event.message || event.stage || type)
    if (type === 'error' || type === 'chapter_error') error = String(event.error || event.message || 'Błąd wykonania zadania')
    if (type === 'ready') prepared = true
    if (isBook && type === 'started' && typeof event.job_id === 'string') bookJobId = event.job_id
    if (type === 'cancelled' || type === 'stopped') { cancelled = true; done = false }
    if (typeof event.total === 'number') total = event.total
    if (type === 'started' && typeof event.chapters === 'number') total = event.chapters
    if (type === 'chapter') { completed += 1; partial = 0 }
    if (type === 'progress' && typeof event.current === 'number') completed = event.current
    if (type === 'done') { done = true; if (isBook && typeof event.output === 'string') output = event.output; failedChapters = typeof event.failed_chapters === 'number' ? event.failed_chapters : Array.isArray(event.failed_chapters) ? event.failed_chapters.length : 0; if (failedChapters) error = `Nie udało się wygenerować ${failedChapters} rozdziałów. Plik jest niepełny. Sprawdź dziennik etapów.` }
    if (type === 'done') completed = total
    log = [...log.slice(-29), message]
  }
  function refresh(parentSignal?: AbortSignal): Promise<void> {
    if (refreshPending && !refreshController?.signal.aborted) return refreshPending
    const abort = new AbortController(); refreshController = abort
    const signal = parentSignal ? AbortSignal.any([abort.signal, parentSignal]) : abort.signal
    const bookView = kind === 'audiobooks'
    loading = true
    refreshPending = (async () => {
      try {
        const result = await Promise.allSettled([
          profiles(signal),
          bookView ? productionJson<{ jobs: FinishedBook[] }>('/longform/jobs?limit=30', { signal }) : Promise.resolve(undefined),
          bookView ? productionJson<ProductionProject[]>('/projects', { signal }) : Promise.resolve(undefined),
          !bookView ? productionJson<FinishedDub[]>('/dub/history', { signal }) : Promise.resolve(undefined),
          bookView ? productionJson<{ jobs: ResumableBook[] }>('/audiobook/jobs', { signal }) : Promise.resolve(undefined),
        ])
        signal.throwIfAborted()
        if (disposed || refreshController !== abort) return
        if (result[0].status === 'fulfilled') voices = result[0].value
        else throw result[0].reason
        if (result[1].status === 'fulfilled' && result[1].value) books = result[1].value.jobs.filter((book) => book.type === 'audiobook')
        if (result[2].status === 'fulfilled' && result[2].value) {
          // The list contains metadata only. Read state before classifying a project.
          const details = await Promise.allSettled(result[2].value.map(project => productionJson<ProductionProject>(`/projects/${encodeURIComponent(project.id)}`, { signal })))
          signal.throwIfAborted()
          if (disposed || refreshController !== abort) return
          projectOptions = details.flatMap(result => result.status === 'fulfilled' && result.value.state?.kind === 'audiobooks' ? [result.value] : [])
          if (details.some(result => result.status === 'rejected')) error = 'Nie udało się wczytać części projektów. Odśwież bibliotekę, aby ponowić odczyt.'
        }
        if (result[3].status === 'fulfilled' && result[3].value) dubs = result[3].value.flatMap((dub) => {
          try { const languages: unknown = JSON.parse(dub.tracks || '[]'); return Array.isArray(languages) && languages.length ? [{ ...dub, languages: languages.filter((lang): lang is string => typeof lang === 'string') }] : [] } catch { return [] }
        })
        if (bookView && result[1].status === 'rejected') throw result[1].reason
        if (bookView && result[2].status === 'rejected') throw result[2].reason
        if (!bookView && result[3].status === 'rejected') throw result[3].reason
        if (result[4].status === 'fulfilled' && result[4].value) resumable = (result[4].value.jobs ?? []).filter(job => job.type === 'audiobook')
        if (bookView && result[4].status === 'rejected') throw result[4].reason
      } finally {
        if (refreshController === abort) { refreshPending = undefined; if (!disposed) loading = false }
      }
    })()
    return refreshPending
  }
  $effect(() => {
    if (!ready) return
    const abort = new AbortController()
    void refresh(abort.signal).then(() => { if (!abort.signal.aborted && bookDrain) void waitForBookDrain() }).catch(cause => { if (!abort.signal.aborted) fail(cause) })
    return () => { abort.abort(); refreshController?.abort(); controller?.abort(); drainController?.abort(); busy = false; loading = false }
  })
  $effect(() => {
    if (!busy || !startedAt) return
    const timer = setInterval(() => now = Date.now(), 1000)
    return () => clearInterval(timer)
  })
  const progressValue = $derived(Math.min(total, completed + (done ? 0 : partial)))
  const elapsed = $derived(startedAt ? Math.max(0, now - startedAt) / 1000 : 0)
  const remaining = $derived(busy && total && progressValue > 0 ? elapsed * (total - progressValue) / progressValue : undefined)
  function clock(seconds: number) { const s = Math.round(seconds); return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor(s % 3600 / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s` }
  onDestroy(() => { disposed = true; controller?.abort(); refreshController?.abort(); drainController?.abort(); if (mediaUrl) URL.revokeObjectURL(mediaUrl) })
  function clearPreview() { if (mediaUrl) URL.revokeObjectURL(mediaUrl); mediaUrl = '' }
  async function previewOutput(path: string, video = false) {
    if (isBook) bookPlayer?.pause()
    await work(async signal => {
      const response = await request(path, { signal }); if (!response.ok) throw new Error(`Nie można wczytać podglądu (${response.status}).`)
      const blob = await response.blob(); signal.throwIfAborted()
      if (!blob.type.startsWith(video ? 'video/' : 'audio/')) throw new Error('Silnik nie zwrócił oczekiwanego nagrania.')
      clearPreview(); mediaIsVideo = video; mediaUrl = URL.createObjectURL(blob)
    })
  }
  async function stopProduction() {
    if (!busy || stopping) return
    stopping = true
    try {
      if (isBook && activeLongform) {
        cancelled = true; bookDrain = true; drainMessage = 'Wysłano zatrzymanie. Silnik kończy bieżący fragment i zwalnia procesy…'
        controller?.abort(); message = drainMessage
      } else if (taskId) { await productionJson(`/tasks/cancel/${encodeURIComponent(taskId)}`, { method: 'POST' }); message = 'Wysłano anulowanie. Silnik kończy bieżący fragment…' }
      else { controller?.abort(); message = 'Przerwano oczekiwanie. Sprawdź stan zadania przed ponowieniem.' }
    } catch (cause) { fail(cause) }
    finally { stopping = false }
  }
  async function readBookJobs(signal: AbortSignal) {
    const result = await productionJson<{ jobs: ResumableBook[] }>('/audiobook/jobs', { signal })
    signal.throwIfAborted()
    if (!Array.isArray(result.jobs)) throw new Error('Silnik nie zwrócił prawidłowej listy zadań audiobooka.')
    const jobs = result.jobs.filter(job => job.type === 'audiobook')
    if (!disposed) resumable = jobs
    return jobs
  }
  async function waitForBookDrain() {
    if (!ready || disposed || drainChecking || !bookDrain) return
    const abort = new AbortController(); drainController?.abort(); drainController = abort; drainChecking = true
    const deadline = Date.now() + 90_000
    try {
      while (!disposed && !abort.signal.aborted && Date.now() < deadline) {
        try {
          const jobs = await readBookJobs(abort.signal)
          const activity = await readLongformActivity(request, abort.signal)
          abort.signal.throwIfAborted()
          const status = bookDrainState(jobs, activity, bookJobId)
          if (status === 'confirmed') {
            bookDrain = false
            message = 'Silnik potwierdził zakończenie pracy. Odświeżono listę zadań; zachowane rozdziały można wznowić z biblioteki.'
            drainMessage = ''
            try { await refresh(abort.signal) } catch (cause) { if (!abort.signal.aborted) fail(cause) }
            return
          }
          drainMessage = status === 'unavailable'
            ? 'Odświeżono zadania, ale brak potwierdzenia zakończenia pracy silnika. Wznowienie pozostaje zablokowane; sprawdzanie będzie ponowione.'
            : activity?.reason === 'longform-proof-error' || activity?.reason === 'interrupted-request' || activity?.reason === 'probe-error'
              ? 'Silnik nie może jeszcze potwierdzić zwolnienia poprzedniej pracy. Zaczekaj i sprawdź ponownie; wznowienie pozostaje zablokowane.'
              : 'Silnik nadal kończy pracę lub zwalnia zasoby. Lista zadań jest odświeżana; wznowienie będzie dostępne po potwierdzeniu.'
        } catch { if (abort.signal.aborted) return; drainMessage = 'Silnik jeszcze nie potwierdził zatrzymania. Ponawianie odczytu stanu; poprzednia praca może nadal trwać.' }
        await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', finish); resolve() }
          const timer = setTimeout(finish, 1000); abort.signal.addEventListener('abort', finish, { once: true })
        })
      }
      if (!disposed && !abort.signal.aborted) drainMessage = 'Nie otrzymano jeszcze potwierdzenia zakończenia pracy. Kliknij „Sprawdź zatrzymanie”, aby odświeżyć rzeczywisty stan. Wznowienie pozostaje zablokowane.'
    } finally { if (drainController === abort) { drainController = undefined; if (!disposed) drainChecking = false } }
  }
  async function bookStream(path: string, options: RequestInit, signal: AbortSignal) {
    activeLongform = true; bookJobId = ''
    try {
      const headers = new Headers(options.headers); headers.set('X-Next-Audiobook-Stream', '1')
      await productionStream(path, { ...options, headers }, event)
    } finally {
      bookPlayer?.finish()
      activeLongform = false
      if (!disposed && (cancelled || signal.aborted || !done)) {
        bookDrain = true; drainMessage = 'Zamknięto strumień. Sprawdzanie zadań i rzeczywistego zakończenia pracy silnika…'
        void waitForBookDrain()
      }
    }
  }
  async function resumeBook(id: string) {
    await work(async signal => {
      const jobs = await readBookJobs(signal)
      const job = jobs.find(row => row.job_id === id)
      if (!bookCanResume(job)) { message = `Nie można wznowić tego zadania: ${job ? bookJobStatus(job.status) : 'nie ma go już na liście do wznowienia'}. Lista została odświeżona.`; return }
      if (bookJobsBusy(jobs)) { message = 'Na liście jest jeszcze zadanie w trakcie pracy lub zatrzymywania. Zaczekaj na jego zakończenie i odśwież listę.'; return }
      const activity = await readLongformActivity(request, signal)
      if (activity && bookDrainState(jobs, activity, id) !== 'confirmed') { message = 'Silnik nadal pracuje. Zaczekaj na zakończenie poprzedniego zadania i ponów wznowienie.'; return }
      done = false; output = ''; failedChapters = 0; completed = 0; total = 0; log = []; clearPreview(); bookPlayer?.reset()
      await bookStream(`/audiobook/resume/${encodeURIComponent(id)}`, { method: 'POST', signal }, signal)
      if (!done && !cancelled && !error) throw new Error('Wznawianie zakończyło się bez potwierdzenia gotowego pliku.')
      if (!cancelled) await refresh(signal)
    })
  }
  let cleaning = $state(false), textBeforeClean = $state<string>()
  async function cleanWithAI() {
    if (cleaning || busy || !text.trim()) return
    const original = text, parts = bookTextChunks(original), cleaned: string[] = []
    cleaning = true; error = ''
    try {
      for (const [index, part] of parts.entries()) {
        message = `Porządkowanie tekstu przez AI · część ${index + 1} / ${parts.length}`
        cleaned.push(part.trim() ? (await cleanBookText(part)).text : part)
      }
      if (text !== original) throw new Error('Tekst zmienił się w trakcie porządkowania. Wynik AI odrzucono.')
      changedText(cleaned.map(part => part.trim()).filter(Boolean).join('\n\n')); textBeforeClean = original
      message = `Uporządkowano tekst · usunięto ${(original.length - text.length).toLocaleString('pl-PL')} znaków. Sprawdź wynik przed generowaniem.`
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Nie udało się uporządkować tekstu.'; message = '' }
    finally { cleaning = false }
  }
  function changedText(next: string) { text = next; plan = undefined; done = false; output = ''; total = 0; completed = 0; log = []; message = ''; error = ''; bookPlayer?.reset() }
  async function importText(imported?: File) {
    if (!imported) return
    if (imported.size > 8 * 1024 * 1024) { error = 'Wybierz plik tekstowy mniejszy niż 8 MB.'; return }
    const form = new FormData(); form.append('file', imported)
    await work(async signal => { const result = await productionJson<{ text: string; chapters: number }>('/audiobook/import', { method: 'POST', body: form, signal: signal }); changedText(result.text); if (!title) title = imported.name.replace(/\.[^.]+$/, ''); message = `Zaimportowano ${result.chapters} rozdziałów.` })
  }
  async function previewBook() { await work(async signal => { plan = await productionJson<BookPlan>('/audiobook/plan', postJson({ text, default_voice: voice || null }, signal)); message = `Plan: ${plan.chapter_count} rozdziałów · ${plan.char_count.toLocaleString(tr.locale)} znaków` }) }
  async function saveBook() { await work(async signal => { const result = await productionJson<{ id: string }>(projectId ? `/projects/${encodeURIComponent(projectId)}` : '/projects', { ...postJson({ name: title.trim() || 'Nowy audiobook', state: { kind: 'audiobooks', text, voice, language, plan, render: { bookFormat, bitrate, loudness, author, narrator, lineGap, paragraphGap, trimEdges, customSteps, steps, guidance } } }, signal), method: projectId ? 'PUT' : 'POST' }); projectId = result.id; onnotify('Projekt audiobooka zapisany.'); await refresh(signal) }) }
  function resetSettings() {
    bookFormat = 'm4b'; bitrate = '128k'; loudness = 'off'; author = ''; narrator = ''
    lineGap = 0; paragraphGap = 0; trimEdges = false; customSteps = false; steps = 32; guidance = 2
    sourceLanguage = 'auto'; quality = currentGeneralPreferences().translationQuality; timing = 'strict_slot'; speed = 1
    translated = false; done = false
  }
  async function newBook() {
    if (busy || bookDrain || (text.trim() && !(await confirmDialog({ message: tr('Otworzyć pusty projekt? Niezapisany tekst i ustawienia zostaną zastąpione.'), confirmLabel: tr('Otwórz') })))) return
    title = ''; changedText(''); projectId = ''; voice = ''; language = 'pl'; resetSettings(); bookView = 'editor'; tab = 'settings'; message = ''; error = ''; log = []; total = 0
  }
  async function openProject(id: string) {
    if (!id || busy || (text.trim() && !(await confirmDialog({ message: tr('Otworzyć zapisany projekt? Bieżące niezapisane zmiany zostaną zastąpione.'), confirmLabel: tr('Otwórz') })))) return
    await work(async signal => {
      const project = await productionJson<ProductionProject>(`/projects/${encodeURIComponent(id)}`, { signal })
      if (project.state?.kind !== 'audiobooks') throw new Error('To projekt innego rodzaju. Wybierz zapisany audiobook.')
      projectId = id; title = project.name; changedText(project.state.text || ''); voice = project.state.voice || ''; language = project.state.language || 'pl'; plan = project.state.plan
      resetSettings()
      const render = project.state.render
      if (render) {
        bookFormat = render.bookFormat === 'mp3' ? 'mp3' : 'm4b'; bitrate = ['64k', '128k', '192k', '256k'].includes(render.bitrate) ? render.bitrate : '128k'
        loudness = ['off', 'acx', 'podcast'].includes(render.loudness) ? render.loudness : 'off'
        author = render.author || ''; narrator = render.narrator || ''; lineGap = render.lineGap ?? 0; paragraphGap = render.paragraphGap ?? 0
        trimEdges = render.trimEdges ?? false; customSteps = render.customSteps ?? false; steps = render.steps ?? 32; guidance = render.guidance ?? 2
      }
      total = 0; log = []; bookView = 'editor'; tab = 'settings'
    })
  }
  async function renderBook() {
    await work(async signal => {
      done = false; output = ''; failedChapters = 0; completed = 0; partial = 0; startedAt = now = Date.now(); total = plan?.chapter_count || 0; log = []
      clearPreview(); bookPlayer?.reset()
      await bookStream('/audiobook', postJson({ text, default_voice: voice || null, language: productionLanguages.find(item => item.value === language)?.tts,
        format: bookFormat, bitrate, loudness, line_gap_ms: lineGap, paragraph_gap_ms: paragraphGap, trim_edges: trimEdges,
        ...(customSteps ? { num_step: steps, guidance_scale: guidance } : {}),
        metadata: { title: title.trim() || 'Nowy audiobook', author, narrator } }, signal), signal)
      if (!done && !cancelled && !error) throw new Error('Strumień zakończył się bez gotowego pliku.')
      if (!cancelled) await refresh(signal)
    })
  }
  async function previewChapter(index: number) {
    bookPlayer?.pause()
    await work(async signal => {
      const result = await productionJson<{ output: string; duration_s: number; cached: boolean }>('/audiobook/preview', postJson({ text, chapter_index: index, default_voice: voice || null, language: productionLanguages.find(item => item.value === language)?.tts,
        line_gap_ms: lineGap, paragraph_gap_ms: paragraphGap, trim_edges: trimEdges,
        ...(customSteps ? { num_step: steps, guidance_scale: guidance } : {}) }, signal))
      const response = await request(`/audio/${result.output.split('/').map(encodeURIComponent).join('/')}`, { signal }); if (!response.ok) throw new Error(`Nie można odczytać rozdziału (${response.status}).`)
      const blob = await response.blob(); signal.throwIfAborted(); clearPreview(); mediaIsVideo = false; mediaUrl = URL.createObjectURL(blob)
      message = `Próbka rozdziału gotowa · ${result.duration_s.toFixed(1)} s${result.cached ? ' · użyto zapisanego audio' : ''}`
    })
  }
  let dubPicker = $state<{ open: () => void }>()
  function selectFile(next?: File) {
    if (busy || !next) return
    if (!/\.(mp4|mkv|mov|webm|avi|wav|mp3|m4a|ogg|flac|aac)$/i.test(next.name) && !/^(audio|video)\//.test(next.type)) { error = 'Wybierz obsługiwany plik audio lub wideo.'; return }
    file = next; quality = currentGeneralPreferences().translationQuality; clearPreview(); sourceVideo = next.type.startsWith('video/') || /\.(mp4|mkv|mov|webm|avi)$/i.test(next.name)
    prepared = false; segments = []; done = false; translated = false; jobId = ''; finishedDub = undefined; total = 0; log = []; message = ''; error = ''
  }
  async function uploadDub() {
    if (sourceMode === 'file' && !file) return
    if (sourceMode === 'url') { try { const url = new URL(ingestUrl); if (!['http:', 'https:'].includes(url.protocol)) throw new Error() } catch { error = 'Wpisz pełny adres HTTP lub HTTPS materiału.'; return } }
    await work(async signal => {
      prepared = false; done = false; translated = false; segments = []; log = []; total = 0; finishedDub = undefined
      clearPreview()
      const form = new FormData(); if (file) form.append('video', file); form.append('input_type', sourceVideo ? 'video' : 'audio')
      if (sourceLanguage !== 'auto') form.append('source_lang', sourceLanguage)
      const result = sourceMode === 'url'
        ? await productionJson<{ job_id: string; task_id: string }>('/dub/ingest-url', postJson({ url: ingestUrl.trim(), source_lang: sourceLanguage === 'auto' ? null : sourceLanguage, fetch_subs: false }, signal))
        : await productionJson<{ job_id: string; task_id: string }>('/dub/upload', { method: 'POST', body: form, signal })
      if (sourceMode === 'url') sourceVideo = true
      jobId = result.job_id; taskId = result.task_id; message = 'Przygotowywanie materiału…'
      await productionStream(`/tasks/stream/${encodeURIComponent(result.task_id)}`, { signal }, event)
      if (!prepared && !cancelled && !error) throw new Error('Przygotowanie nie potwierdziło gotowości. Sprawdź dziennik silnika.')
      if (!currentGeneralPreferences().reviewMode && prepared && !cancelled && !error) {
        signal.throwIfAborted(); await transcribeDubRequest(signal)
        signal.throwIfAborted(); await translateDubRequest(signal)
      }
    })
  }
  async function transcribeDubRequest(signal: AbortSignal) {
      message = 'Transkrypcja materiału…'; done = false; finishedDub = undefined
      const result = await productionJson<{ segments: DubSegment[] }>(`/dub/transcribe/${encodeURIComponent(jobId)}`, { method: 'POST', signal })
      signal.throwIfAborted()
      segments = result.segments; translated = false; message = `Rozpoznano ${segments.length} segmentów.`
  }
  async function transcribeDub() {
    await work(async signal => {
      await transcribeDubRequest(signal)
      if (!currentGeneralPreferences().reviewMode) { signal.throwIfAborted(); await translateDubRequest(signal) }
    })
  }
  async function translateDubRequest(signal: AbortSignal) {
      translated = false; done = false; finishedDub = undefined; message = 'Tłumaczenie segmentów…'
      // Without an explicit provider the engine falls back to Google, ignoring the engine selected in settings.
      const { active } = await productionJson<{ active?: string }>('/engines/translation', { signal })
      signal.throwIfAborted()
      if (active === 'argos') {
        // Argos needs one offline pack per language pair; the engine never downloads it implicitly.
        const packs = { job_id: jobId, target_langs: [language] }
        const status = await productionJson<{ pairs: Array<{ installed: boolean }> }>('/engines/translation/argos/packs/status', postJson(packs, signal))
        signal.throwIfAborted()
        if (status.pairs.some(pair => !pair.installed)) {
          if (!(await confirmDialog({ message: tr('Tłumaczenie lokalne (Argos) wymaga pakietu językowego dla tej pary języków. Pobrać go teraz z internetu? Zwykle to kilkadziesiąt MB, pobiera się jednorazowo.'), confirmLabel: tr('Pobierz') }))) throw new Error('Tłumaczenie wymaga pakietu językowego Argos. Pobierz go albo wybierz inny silnik tłumaczenia w ustawieniach.')
          message = 'Pobieranie pakietu językowego Argos…'
          const installed = await productionJson<{ pairs: Array<{ installed: boolean }> }>('/engines/translation/argos/packs/install', postJson(packs, signal))
          signal.throwIfAborted()
          if (installed.pairs.some(pair => !pair.installed)) throw new Error('Nie udało się zainstalować pakietu językowego Argos.')
          message = 'Tłumaczenie segmentów…'
        }
      }
      const result = await productionJson<{ translated: Array<{ id: string; text: string; error?: string; translate_error?: string }>; cinematic_skipped?: boolean | string; quality_used?: string }>('/dub/translate', postJson({ job_id: jobId, target_lang: language, quality, ...(active ? { provider: active } : {}),
        segments: segments.map((segment, index) => ({ id: String(segment.id ?? index), text: segment.text_original ?? segment.text, start: segment.start, end: segment.end, slot_seconds: segment.end - segment.start })) }, signal))
      signal.throwIfAborted()
      const rows = new Map(result.translated.map(row => [String(row.id), row]))
      if (segments.some((segment, index) => { const row = rows.get(String(segment.id ?? index)); return !row || row.error || row.translate_error || !row.text?.trim() })) throw new Error('Nie wszystkie segmenty zostały przetłumaczone. Sprawdź konfigurację tłumaczenia i ponów próbę.')
      segments = segments.map((segment, index) => ({ ...segment, text_original: segment.text_original ?? segment.text, text: rows.get(String(segment.id ?? index))!.text }))
      translated = true; message = result.cinematic_skipped || result.quality_used && result.quality_used !== quality ? 'Tłumaczenie gotowe w trybie podstawowym. Ulepszanie tekstu było niedostępne. Sprawdź segmenty przed generowaniem.' : 'Tłumaczenie gotowe. Możesz poprawić tekst przed generowaniem.'
  }
  async function translateDub() { await work(translateDubRequest) }
  async function generateDub() {
    await work(async signal => {
      done = false; finishedDub = undefined; completed = 0; total = segments.length; log = []
      const id = jobId, lang = language
      const payload = dubRequestSegments(segments, voice, lang, speed)
      const result = await productionJson<{ task_id: string }>(`/dub/generate/${encodeURIComponent(id)}`, postJson({ language: productionLanguages.find(item => item.value === lang)?.tts, language_code: lang, timing_strategy: timing, speed,
        ...(customSteps ? { num_step: steps, guidance_scale: guidance } : {}),
        segment_ids: segments.map((segment, index) => String(segment.id ?? index)), segments: payload }, signal))
      taskId = result.task_id
      await productionStream(`/tasks/stream/${encodeURIComponent(result.task_id)}`, { signal }, event)
      if (!done && !cancelled && !error) throw new Error('Brak potwierdzenia ukończenia dubbingu.')
      if (done && !error) { finishedDub = { id, language: lang }; await refresh(signal) }
    })
  }
  async function importSubtitles(uploaded?: File) {
    if (!uploaded) return
    if (uploaded.size > 8 * 1024 * 1024) { error = 'Wybierz plik napisów mniejszy niż 8 MB.'; return }
    if (segments.length && !(await confirmDialog({ message: tr('Zastąpić bieżące segmenty napisami z pliku?'), confirmLabel: tr('Zastąp') }))) return
    await work(async signal => {
      const form = new FormData(); form.append('file', uploaded)
      const result = await productionJson<{ segments: DubSegment[]; skipped_cues?: number; dropped_overlaps?: number; clamped_cues?: number }>(`/dub/import-srt/${encodeURIComponent(jobId)}`, { method: 'POST', body: form, signal })
      segments = result.segments; translated = false; done = false; finishedDub = undefined; clearPreview()
      message = `Zaimportowano ${segments.length} segmentów. Pominięte: ${result.skipped_cues || 0}, poprawione nakładanie: ${result.dropped_overlaps || 0}. Sprawdź tekst i czasy.`
    })
  }
  function useCurrentText() { translated = true; done = false; finishedDub = undefined; message = 'Używamy bieżącego tekstu jako wersji docelowej. Sprawdź język i głosy przed nagraniem.' }
  function updateSegment(index: number, patch: Partial<DubSegment>) {
    segments = segments.map((segment, i) => i === index ? { ...segment, ...patch } : segment)
    done = false; finishedDub = undefined; clearPreview()
  }
  async function download(path: string, name: string) { await work(async signal => { message = 'Pobieranie pliku…'; await downloadProduction(path, name, signal); message = 'Przekazano plik do pobrania.' }) }
</script>

<ToolWorkspace title={tr(String(isBook ? 'Audiobooki' : 'Dubbing'))} description={isBook ? tr("Twoje książki, rozdziały i nagrania w jednym miejscu.") : tr("Od oryginalnego materiału do nowej ścieżki głosu.")} bind:tab historyLabel={isBook ? 'Biblioteka' : tr("Historia")} historyCount={isBook ? books.length : dubs.length}>
  {#snippet headerActions()}
    {#if isBook}<div class="production-inline"><Button variant="outline" disabled={busy} onclick={() => bookView = bookView === 'editor' ? 'library' : 'editor'}><Library size={14}/>{bookView === 'editor' ? 'Biblioteka' : 'Edytor'}</Button><Button variant="default" disabled={busy || bookDrain} onclick={newBook}><Plus size={14}/>{tr("Nowy projekt")}</Button></div>{/if}
  {/snippet}
  {#snippet content()}
    <div class="production-content">
      {#if !ready}<p class="production-notice" role="status">{tr("Uruchom lokalny silnik w „Silnik”, aby wczytać głosy, projekty i generować nagrania.")}</p>{/if}
      {#if loading && !busy}<p class="tool-workspace-note" role="status">{tr("Wczytywanie biblioteki…")}</p>{/if}
      {#if isBook && bookView === 'library'}
        <button class="book-create" disabled={busy || bookDrain} onclick={newBook}><BookOpen size={25}/><span><strong>{tr("Utwórz audiobook")}</strong><small>{tr("Wklej tekst lub importuj książkę. Wybierz lektora i przygotuj rozdziały.")}</small></span><Plus size={19}/></button>
        <div class="production-library-toolbar"><input class="text-input" aria-label={tr("Szukaj audiobooka")} placeholder={tr("Szukaj książki lub projektu…")} bind:value={libraryQuery}/><Button variant="ghost" size="icon" aria-label={tr("Odśwież bibliotekę")} disabled={locked} onclick={() => work(refresh)}><RefreshCw size={16}/></Button></div>
        {#if resumable.length}<h2 class="production-section-title">{tr("Zadania i wznowienie")} <span>{resumable.length}</span></h2><div class="book-grid">{#each resumable as job}<article class="book-card"><strong>{job.title || 'Przerwany audiobook'}</strong><small>{job.chapters_done} / {job.total_chapters} {tr("rozdziałów ·")} {bookJobStatus(job.status)}</small><Button variant="outline" disabled={locked || !bookCanResume(job)} onclick={() => resumeBook(job.job_id)}><RotateCcw size={14}/>{bookCanResume(job) ? tr("Wznów render") : job.status === 'done' ? tr("Ukończone") : tr("Zaczekaj na zakończenie")}</Button></article>{/each}</div>{/if}
        <h2 class="production-section-title">{tr("Projekty")} <span>{filteredProjects.length}</span></h2>
        <div class="book-grid">{#each filteredProjects as project}<button class="book-card" disabled={locked} onclick={() => openProject(project.id)}><div class="book-cover"><BookOpen size={30}/><span>{tr("Projekt")}</span></div><strong>{project.name}</strong><small>{project.state?.plan ? project.state.plan.chapter_count + ' rozdziałów' : tr("Bez planu rozdziałów")} · {project.state?.language?.toUpperCase() || 'PL'}</small></button>{/each}</div>
        {#if !filteredProjects.length}<p class="tool-workspace-empty">{libraryQuery ? tr("Brak projektów pasujących do wyszukiwania.") : tr("Zapisane projekty pojawią się tutaj. Utwórz pierwszy audiobook.")}</p>{/if}
        <h2 class="production-section-title">{tr("Gotowe audiobooki")} <span>{filteredBooks.length}</span></h2>
        <div class="book-grid">{#each filteredBooks as book}<article class="book-card"><div class="book-cover ready"><BookOpen size={30}/><span>{tr("Gotowe")}</span></div><strong>{book.title || book.output}</strong><small>{book.chapters} {tr("rozdziałów ·")} {Math.round(book.duration_s / 60)} {tr("min")}</small><Button variant="outline" disabled={locked} onclick={() => download(`/audio/${encodeURIComponent(book.output)}`, book.output)}><Download size={14}/>{tr("Pobierz")}</Button></article>{/each}</div>
        {#if !filteredBooks.length}<p class="tool-workspace-empty">{libraryQuery ? tr("Brak nagrań pasujących do wyszukiwania.") : tr("Gotowe nagrania będą dostępne po zakończeniu generowania.")}</p>{/if}
      {:else if isBook}
        <div class="production-field"><label for={`${uid}-title`}>{tr("Tytuł audiobooka")}</label><input class="text-input book-title" id={`${uid}-title`} bind:value={title} placeholder={tr("Książka bez tytułu")} disabled={busy}/></div>
        <div class="manuscript-header"><label for={`${uid}-text`}>{tr("Tekst książki")}</label>{#if textBeforeClean !== undefined}<Button variant="ghost" disabled={busy || cleaning} onclick={() => { const previous = textBeforeClean!; changedText(previous); textBeforeClean = undefined; message = tr('Przywrócono tekst sprzed porządkowania.') }}><Undo2 size={14}/>{tr("Cofnij porządkowanie")}</Button>{/if}<Button variant="ghost" disabled={busy || cleaning || !text.trim()} title={tr("Usuwa numery stron, nagłówki, przypisy i przeniesienia słów z PDF. AI może tylko usuwać — nie zmienia słów.")} onclick={cleanWithAI}>{#if cleaning}<LoaderCircle size={14} class="spin"/>{:else}<Sparkles size={14}/>{/if}{tr("Uporządkuj tekst AI")}</Button><FilePicker variant="ghost" label={tr("Importuj plik")} ariaLabel={tr("Importuj książkę")} accept=".txt,.md,.epub,.pdf" showName={false} disabled={locked} onchange={files => void importText(files[0])}/></div>
        <textarea class="book-manuscript vs-document-editor" id={`${uid}-text`} value={text} oninput={e => { changedText(e.currentTarget.value); textBeforeClean = undefined }} placeholder={tr("# Rozdział 1\n\nWklej tekst swojej książki. Nagłówki # wyznaczają rozdziały.")} disabled={busy || cleaning}></textarea>
        {#if plan}<div class="production-section-heading"><h2>{tr("Rozdziały")}</h2><span>{plan.chapter_count} · {plan.char_count.toLocaleString(tr.locale)} {tr("znaków")}</span></div><ol class="chapter-list">{#each plan.chapters as chapter, index}<li><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{chapter.title}</strong><small>{chapter.char_count.toLocaleString(tr.locale)} {tr("znaków")}</small></div><Button variant="outline" disabled={locked || !voice} onclick={() => previewChapter(index)}>{tr("Próbka rozdziału")}</Button></li>{/each}</ol>{:else}<p class="tool-workspace-note">{tr("Sprawdź podział przed generowaniem. Nagłówki oznaczone # rozpoczną nowe rozdziały.")}</p>{/if}
      {:else}
        <ol class="dub-stages" aria-label={tr("Etapy dubbingu")}>{#each ['Materiał', 'Transkrypcja', 'Tłumaczenie', 'Nagranie'] as name, index}<li class:complete={stage > index} class:current={stage === index}><span>{index + 1}</span>{name}</li>{/each}</ol>
        <div class="filter-tabs"><button class:chosen={sourceMode === 'file'} disabled={busy} onclick={() => { sourceMode = 'file'; prepared = false }}>{tr("Plik z dysku")}</button><button class:chosen={sourceMode === 'url'} disabled={busy} onclick={() => { sourceMode = 'url'; prepared = false }}>{tr("Adres materiału")}</button></div>
        {#if sourceMode === 'url'}<label class="production-field">{tr("Adres filmu")}<input class="text-input" aria-label={tr("Adres materiału do dubbingu")} type="url" bind:value={ingestUrl} placeholder={tr("https://…")} disabled={busy}/></label><p class="tool-workspace-note">{tr("Pobranie przez lokalny yt-dlp nastąpi po kliknięciu „Przygotuj materiał”.")}</p>{:else}
        <button type="button" class="production-drop" class:has-file={!!file} disabled={busy} onclick={() => dubPicker?.open()} ondragover={e => e.preventDefault()} ondrop={e => { e.preventDefault(); selectFile(e.dataTransfer?.files[0]) }}><Upload size={26}/><strong>{file?.name || tr("Przeciągnij plik lub wybierz z dysku")}</strong><span>{file ? tr("{arg0} MB · kliknij, aby zmienić", { arg0: String((file.size / 1024 / 1024).toFixed(1)) }) : tr("Wideo lub audio · MP4, MKV, MOV, WAV, MP3 i inne")}</span></button><FilePicker bind:this={dubPicker} bare accept="video/*,audio/*,.mp4,.mkv,.mov,.webm,.wav,.mp3,.m4a,.flac" disabled={busy} onchange={files => selectFile(files[0])}/>
        {/if}
        {#if sourceUrl}<div class="production-source">{#if sourceVideo}<VideoCard src={sourceUrl} title="Materiał źródłowy"/>{:else}<AudioPreview src={sourceUrl} title={tr("Materiał źródłowy")}/>{/if}<p class="tool-workspace-note">{tr("Materiał źródłowy")}</p></div>{/if}
        {#if segments.length}
          <div class="production-section-heading"><h2>{translated ? tr("Tekst dubbingu") : 'Rozpoznana mowa'}</h2><span>{segments.length} {tr("segmentów")}</span></div>
          <div class="dub-segments">{#each segments as segment, index}<article class="dub-segment">
            <header><span>{String(index + 1).padStart(2, '0')} · {segment.start.toFixed(1)}–{segment.end.toFixed(1)} {tr("s")}</span><Select ariaLabel={tr("Głos segmentu {arg0}", { arg0: String(index + 1) })} value={segment.profile_id || ''} options={[{ value: '', label: tr("Głos całego materiału") }, ...voices.map(row => ({ value: row.id, label: row.name }))]} disabled={locked} onchange={value => updateSegment(index, { profile_id: value })}/></header>
            <div class="segment-timing"><label>{tr("Początek (s)")}<Input aria-label={tr("Początek segmentu {arg0}", { arg0: String(index + 1) })} type="number" min="0" step="0.01" value={segment.start} disabled={busy} onchange={e => updateSegment(index, { start: e.currentTarget.valueAsNumber })}/></label><label>{tr("Koniec (s)")}<Input aria-label={tr(String(`Koniec segmentu ${index + 1}`))} type="number" min="0" step="0.01" value={segment.end} disabled={busy} onchange={e => updateSegment(index, { end: e.currentTarget.valueAsNumber })}/></label><label>{tr("Szybkość")}<Input aria-label={tr("Szybkość segmentu {arg0}", { arg0: String(index + 1) })} type="number" min="0.5" max="2" step="0.05" value={segment.speed ?? speed} disabled={busy} onchange={e => updateSegment(index, { speed: e.currentTarget.valueAsNumber })}/></label></div>
            {#if segment.text_original !== undefined}<p class="segment-original">{segment.text_original}</p>{/if}<textarea class="text-input" aria-label={tr("Tekst segmentu {arg0}", { arg0: String(index + 1) })} value={segment.text} disabled={busy} oninput={e => updateSegment(index, { text: e.currentTarget.value })}></textarea>
            <input class="text-input" aria-label={tr(String(`Instrukcja segmentu ${index + 1}`))} placeholder={tr("Opcjonalna instrukcja interpretacji głosu")} value={segment.direction || ''} disabled={busy} onchange={e => updateSegment(index, { direction: e.currentTarget.value })}/>
          </article>{/each}</div>
        {:else}<p class="tool-workspace-empty">{tr("Po rozpoznaniu mowy pojawią się tutaj segmenty z czasem, tekstem i wyborem głosu. Możesz je poprawić przed renderem.")}</p>{/if}
        {#if finishedDub}<div class="production-result"><strong>{tr("Ścieżka dubbingu gotowa ·")} {finishedDub.language.toUpperCase()}</strong><div class="production-inline"><Button variant="outline" disabled={locked} onclick={() => previewOutput(dubExportPath(finishedDub!.id, finishedDub!.language, 'wav', preserveBackground, false, false, false))}>{tr("Odsłuchaj")}</Button>{#each ['wav', 'mp3'] as format}<Button variant="outline" disabled={locked} onclick={() => download(dubExportPath(finishedDub!.id, finishedDub!.language, format as 'wav' | 'mp3', preserveBackground, false, false, false), `dubbing-${finishedDub!.language}.${format}`)}><Download size={14}/>{format.toUpperCase()}</Button>{/each}{#if sourceVideo}<Button variant="outline" disabled={locked} onclick={() => download(dubExportPath(finishedDub!.id, finishedDub!.language, 'video', preserveBackground, burnSubtitles, dualSubtitles, karaokeSubtitles), `dubbing-${finishedDub!.language}.mp4`)}><Download size={14}/>{tr("Wideo MP4")}</Button>{/if}{#each ['srt', 'vtt', 'ass'] as format}<Button variant="outline" disabled={locked} onclick={() => download(`/dub/${format}/${encodeURIComponent(finishedDub!.id)}?lang=${encodeURIComponent(finishedDub!.language)}&dual=${dualSubtitles}&karaoke=${karaokeSubtitles}`, `dubbing-${finishedDub!.language}.${format}`)}>{format.toUpperCase()}</Button>{/each}</div></div>{/if}
      {/if}
      {#if isBook}<AudiobookPlayer bind:this={bookPlayer}/>{/if}
      {#if error}<p class="production-error" role="alert">{tr(String(error))}</p>{/if}
      {#if bookDrain}<div class="production-status" role="status">{#if drainChecking}<LoaderCircle size={16} class="spin"/>{/if}<span>{drainMessage}</span><Button variant="outline" disabled={!ready || drainChecking} onclick={waitForBookDrain}>{tr("Sprawdź zatrzymanie")}</Button></div>{:else if busy || message}<div class="production-status" role="status">{#if busy}<LoaderCircle size={16} class="spin"/>{/if}<span>{message ? tr(String(message)) : tr('Trwa przetwarzanie…')}</span>{#if busy}<Button variant="ghost" disabled={stopping} onclick={stopProduction}>{taskId || activeLongform ? tr('Zatrzymaj zadanie') : tr('Przestań czekać')}</Button>{/if}</div>{/if}
      {#if mediaUrl}<div class="production-source">{#if mediaIsVideo}<VideoCard src={mediaUrl} title="Odsłuch"/>{:else}<AudioPreview src={mediaUrl} title={tr("Odsłuch")}/>{/if}<Button variant="ghost" onclick={clearPreview}>{tr("Zamknij odsłuch")}</Button></div>{/if}
      {#if total > 0}<progress max={total} value={progressValue} aria-label={tr("Postęp generowania")}></progress><p class="tool-workspace-note">{completed} / {total} {isBook ? tr('rozdziałów') : tr('segmentów')}{#if isBook && busy && startedAt} · {Math.round(progressValue / total * 100)}% · {tr('minęło')} {clock(elapsed)}{#if remaining !== undefined} · {tr('zostało ok.')} {clock(remaining)}{/if}{/if}</p>{/if}
      {#if output}<div class="production-result"><strong>{failedChapters ? tr('Audiobook jest niepełny') : tr('Audiobook gotowy')}</strong><div class="production-inline"><Button variant="outline" disabled={locked} onclick={() => previewOutput(`/audio/${encodeURIComponent(output)}`)}>{tr("Odsłuchaj")}</Button><Button variant="outline" disabled={locked} onclick={() => download(`/audio/${encodeURIComponent(output)}`, output)}><Download size={14}/>{tr("Pobierz audiobook")}</Button></div></div>{/if}
      {#if log.length}<details class="production-log"><summary>{tr("Dziennik etapów")}</summary>{#each log as line}<p>{line}</p>{/each}</details>{/if}
    </div>
  {/snippet}
  {#snippet settings()}
    <ToolVoiceSettings label={isBook ? tr('Lektor domyślny') : tr('Głos całego materiału')} profiles={voices} {ready} value={voice} onchange={next => { voice = next; done = false; if (isBook) plan = undefined }} disabled={locked}/>
    {#if !voice}<p class="tool-workspace-note">{isBook ? tr('Wybierz lektora. Bez profilu silnik losuje głos dla każdego fragmentu, więc w książce byłoby słychać różne głosy.') : tr('Wybierz profil głosu przed generowaniem. Każdemu segmentowi możesz przypisać inny głos.')}</p>{/if}
    <ToolModelSettings {ready} disabled={busy || loading || bookDrain} bind:busy={modelBusy}/>
    <Select label={isBook ? tr("Język narracji") : tr("Język docelowy")} value={language} onchange={next => { language = next; translated = false; done = false }} options={productionLanguages.map(option=>({...option,label:tr(option.label)}))} disabled={locked}/>
    {#if isBook}
      <Select label={tr("Format wyjściowy")} value={bookFormat} onchange={next => bookFormat = next} options={[{ value: 'm4b', label: tr("M4B · rozdziały w jednym pliku") }, { value: 'mp3', label: 'MP3 · uniwersalne audio' }]} disabled={locked}/>
      <Select label={tr("Jakość audio")} value={bitrate} onchange={next => bitrate = next} options={['64k', '128k', '192k', '256k'].map(value => ({ value, label: value.replace('k', ' kb/s') }))} disabled={locked}/>
      <Select label={tr("Wyrównanie głośności")} value={loudness} onchange={next => loudness = next} options={[{ value: 'off', label: tr("Bez wyrównania") }, { value: 'acx', label: 'Audiobook (ACX)' }, { value: 'podcast', label: 'Podcast' }]} disabled={locked}/>
      <details class="production-options"><summary>{tr("Metadane książki")}</summary><label>{tr("Autor")}<input class="text-input" aria-label={tr("Autor książki")} bind:value={author} disabled={busy}/></label><label>{tr("Narrator")}<input class="text-input" aria-label={tr("Narrator książki")} bind:value={narrator} disabled={busy}/></label></details>
      <details class="production-options"><summary>{tr("Pauzy i generowanie")}</summary><Slider label={tr("Pauza między liniami")} value={lineGap} min={0} max={5000} step={50} valueLabel={lineGap + ' ms'} onchange={value => lineGap = value} disabled={locked}/><Slider label={tr("Pauza między akapitami")} value={paragraphGap} min={0} max={5000} step={50} valueLabel={paragraphGap + ' ms'} onchange={value => paragraphGap = value} disabled={locked}/><div class="production-switch"><span>{tr("Przytnij ciszę na krawędziach")}</span><Switch label={tr("Przytnij ciszę na krawędziach")} checked={trimEdges} onchange={value => trimEdges = value} disabled={locked}/></div><div class="production-switch"><span>{tr("Własne parametry syntezy")}</span><Switch label={tr("Własne parametry syntezy")} checked={customSteps} onchange={value => customSteps = value} disabled={locked}/></div>{#if customSteps}<Slider label={tr("Kroki syntezy")} value={steps} min={1} max={128} step={1} onchange={value => steps = value} disabled={locked}/><Slider label={tr("Siła prowadzenia")} value={guidance} min={0} max={20} step={0.1} valueLabel={guidance.toFixed(1)} onchange={value => guidance = value} disabled={locked}/>{/if}<p class="tool-workspace-note">{tr("Bez własnych parametrów używane są wartości domyślne silnika audiobooków.")}</p></details>
      <p class="tool-workspace-note">{tr("M4B zachowuje oznaczenia rozdziałów. Projekt zapisuje tekst, lektora i ustawienia renderu.")}</p>
    {:else}
      <Select label={tr("Język źródłowy")} value={sourceLanguage} onchange={value => { sourceLanguage = value; prepared = false; translated = false; segments = []; done = false }} options={[{ value: 'auto', label: 'Rozpoznaj automatycznie' }, ...productionLanguages]} disabled={locked}/>
      <Select label={tr("Tryb tłumaczenia")} value={quality} onchange={value => { quality = value as typeof quality; translated = false; done = false }} options={[{ value: 'fast', label: 'Podstawowy' }, { value: 'autofit', label: tr("Dopasuj tekst do czasu · LLM") }, { value: 'cinematic', label: 'Z ulepszaniem tekstu' }]} disabled={locked}/>
      <p class="tool-workspace-note">{tr("Tłumaczenie korzysta z dostawcy skonfigurowanego w silniku. Zależnie od konfiguracji może wymagać internetu.")}</p>
      <Select label={tr("Dopasowanie do oryginału")} value={timing} onchange={value => timing = value} options={[{ value: 'strict_slot', label: tr("Zachowaj czas segmentów") }, { value: 'concise', label: tr("Naturalne tempo · tekst musi się zmieścić") }, { value: 'smart_fit', label: tr("Inteligentne dopasowanie dźwięku i wideo") }, { value: 'stretch_video', label: tr("Dopasuj długość wideo do mowy") }]} disabled={locked}/>
      <Slider label={tr("Szybkość mowy")} value={speed} min={0.5} max={2} step={0.05} valueLabel={speed.toFixed(2) + '×'} startLabel="Wolniej" endLabel="Szybciej" onchange={value => speed = value} disabled={locked}/>
      <div class="production-switch"><span>{tr("Zachowaj tło materiału")}</span><Switch label={tr("Zachowaj tło materiału")} checked={preserveBackground} onchange={value => preserveBackground = value} disabled={locked}/></div>
      <div class="production-switch"><span>{tr("Wypal napisy w wideo")}</span><Switch label={tr("Wypal napisy w wideo")} checked={burnSubtitles} onchange={value => burnSubtitles = value} disabled={locked}/></div>
      {#if burnSubtitles}<div class="production-switch"><span>{tr("Napisy dwujęzyczne")}</span><Switch label={tr("Napisy dwujęzyczne")} checked={dualSubtitles} onchange={value => { dualSubtitles = value; if (value) karaokeSubtitles = false }} disabled={locked}/></div><div class="production-switch"><span>{tr("Podświetlanie słów")}</span><Switch label={tr("Podświetlanie słów")} checked={karaokeSubtitles} onchange={value => { karaokeSubtitles = value; if (value) dualSubtitles = false }} disabled={locked}/></div>{/if}
      {#if prepared}<FilePicker label={tr("Importuj SRT")} ariaLabel={tr("Importuj napisy do dubbingu")} accept=".srt" showName={false} disabled={locked} onchange={files => void importSubtitles(files[0])}/>{/if}
      <div class="tool-workspace-section"><h2>{tr("Format wyjściowy")}</h2><p class="tool-workspace-note">{tr("Ścieżka głosu WAV. Eksport tekstu i napisów obejmuje aktualne segmenty.")}</p><div class="production-inline"><Button variant="outline" disabled={!segments.length || busy} onclick={() => saveTextFile(segments.map(row => row.text).join('\n'), 'dubbing.txt', 'text/plain;charset=utf-8')}>{tr("TXT")}</Button><Button variant="outline" disabled={!segments.length || busy} onclick={() => saveTextFile(subtitleText(segments, 'srt'), 'dubbing.srt', 'text/plain;charset=utf-8')}>{tr("SRT")}</Button></div></div>
    {/if}
    <Button variant="ghost" class=" production-reset" disabled={locked} onclick={resetSettings}><RotateCcw size={14}/>{tr("Resetuj ustawienia")}</Button>
  {/snippet}
  {#snippet history()}
    <div class="production-section-heading"><h2>{isBook ? 'Projekty i nagrania' : tr("Gotowe ścieżki")}</h2><Button variant="ghost" size="icon" aria-label={tr("Odśwież historię produkcji")} disabled={locked} onclick={() => work(refresh)}><RefreshCw size={15}/></Button></div>
    {#if isBook}
      {#each projectOptions as project}<button class="tool-workspace-history-item production-project" disabled={locked} onclick={() => openProject(project.id)}><FileText size={17}/><strong>{project.name}</strong><small>{tr("Otwórz projekt")}</small></button>{/each}
      {#each books as book}<article class="tool-workspace-history-item"><strong>{book.title || book.output}</strong><small>{book.chapters} {tr("rozdziałów ·")} {Math.round(book.duration_s / 60)} {tr("min")}</small><Button variant="outline" disabled={locked} onclick={() => download(`/audio/${encodeURIComponent(book.output)}`, book.output)}><Download size={14}/>{tr("Pobierz")}</Button></article>{/each}
      {#if !books.length && !projectOptions.length}<p class="tool-workspace-empty">{tr("Twoje projekty i ukończone audiobooki pojawią się tutaj.")}</p>{/if}
    {:else}
      {#each dubs as dub}{#each dub.languages as lang}<article class="tool-workspace-history-item"><strong>{dub.filename}</strong><small>{lang.toUpperCase()} · {Math.round(dub.duration)} {tr("s")}</small><Button variant="outline" disabled={locked} onclick={() => download(`/dub/download-audio/${encodeURIComponent(dub.id)}?lang=${encodeURIComponent(lang)}&preserve_bg=false`, `${dub.filename.replace(/\.[^.]+$/, '')}-${lang}.wav`)}><Download size={14}/>{tr("Pobierz WAV")}</Button></article>{/each}{/each}
      {#if !dubs.length}<p class="tool-workspace-empty">{tr("Ukończone ścieżki dubbingu pojawią się tutaj.")}</p>{/if}
    {/if}
  {/snippet}
  {#snippet actions()}
    <span class="production-action-note">{isBook ? tr("{arg0} znaków{arg1}", { arg0: String(text.length.toLocaleString(tr.locale)), arg1: String(plan ? ' · ' + plan.chapter_count + ' rozdziałów' : '') }) : !file ? tr("Wybierz materiał źródłowy") : !prepared ? tr("Przygotuj materiał") : !segments.length ? tr("Rozpoznaj mowę w materiale") : !translated ? tr("Przetłumacz i sprawdź tekst") : tr("Tekst gotowy do nagrania")}</span>
    <div class="production-inline">
      {#if isBook && bookView === 'editor'}<Button variant="outline" disabled={locked || !text.trim()} onclick={previewBook}><FileText size={14}/>{tr("Podgląd rozdziałów")}</Button><Button variant="outline" disabled={locked || !text.trim()} onclick={saveBook}><Save size={14}/>{tr("Zapisz")}</Button><Button variant="default" disabled={locked || !text.trim() || !plan || !voice} title={!voice ? tr('Wybierz lektora w ustawieniach') : !plan ? tr('Najpierw sprawdź podział na rozdziały') : undefined} onclick={renderBook}>{tr("Generuj audiobook")}</Button>
      {:else if isBook}<Button variant="default" disabled={busy || bookDrain} onclick={newBook}><Plus size={14}/>{tr("Utwórz audiobook")}</Button>
      {:else}{#if !prepared}<Button variant="default" disabled={locked || (sourceMode === 'file' ? !file : !ingestUrl.trim())} onclick={uploadDub}>{tr("Przygotuj materiał")}</Button>{:else if !segments.length}<Button variant="default" disabled={locked} onclick={transcribeDub}>{tr("Rozpoznaj mowę")}</Button>{:else}{#if !translated}<Button variant="outline" disabled={locked} onclick={useCurrentText}>{tr("Użyj bieżącego tekstu")}</Button>{/if}<Button variant="outline" disabled={locked} onclick={translateDub}>{translated ? tr('Przetłumacz ponownie') : tr('Przetłumacz')}</Button><Button variant="default" disabled={locked || !translated || segments.some(row => !row.text.trim() || !(row.profile_id || voice))} onclick={generateDub}>{tr("Generuj dubbing")}</Button>{/if}{/if}
    </div>
  {/snippet}
</ToolWorkspace>
