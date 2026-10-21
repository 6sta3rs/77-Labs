<script lang="ts">
  import Button from '../ui/Button.svelte';
  import AudioPreview from '../playback/AudioPreview.svelte';
  import FilePicker from '../ui/FilePicker.svelte';
  import { onDestroy } from 'svelte';
  import { Mic, Square, X } from '@lucide/svelte';
  import { inspectReference, referenceAudioAccept, referenceDurationWarning } from './voice-reference';
  import { durationLabel } from '../data';

  let { label = 'Nagranie referencyjne', disabled = false, referenceAdvice = true, onchange, onrecordingchange }: {
    label?: string; disabled?: boolean; referenceAdvice?: boolean;
    onchange: (file: File | undefined, duration?: number) => void;
    onrecordingchange?: (recording: boolean) => void;
  } = $props();
  const uid = $props.id();
  let file = $state<File>(), audioUrl = $state(''), duration = $state<number>(), error = $state('');
  let checking = $state(false), recording = $state(false), starting = $state(false), elapsed = $state(0);
  let controller: AbortController | undefined, stream: MediaStream | undefined, recorder: MediaRecorder | undefined;
  let clock: ReturnType<typeof setInterval> | undefined, began = 0, disposed = false;
  const warning = $derived(file && referenceAdvice ? referenceDurationWarning(duration) : '');

  function releaseStream() { stream?.getTracks().forEach(track => track.stop()); stream = undefined; }
  function releaseUrl() { if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = ''; }
  async function select(next?: File, measured?: number) {
    controller?.abort(); controller = new AbortController(); const current = controller;
    releaseUrl(); file = undefined; duration = undefined; error = ''; onchange(undefined);
    if (!next) return;
    checking = true;
    try {
      const measuredMetadata = await inspectReference(next, current.signal);
      current.signal.throwIfAborted();
      if (disposed) return;
      file = next; duration = measuredMetadata ?? measured; audioUrl = URL.createObjectURL(next); onchange(next, duration);
    } catch (cause) { if (!disposed && !current.signal.aborted) error = (cause as Error).message; }
    finally { if (controller === current && !disposed) checking = false; }
  }
  function stop() { if (recorder?.state === 'recording') recorder.stop(); }
  async function record() {
    if (disabled || starting || recording || checking) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { error = 'Nagrywanie z mikrofonu nie jest dostępne w tym środowisku. Wybierz plik audio.'; return; }
    starting = true; error = ''; onrecordingchange?.(true);
    try {
      const opened = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (disposed) { opened.getTracks().forEach(track => track.stop()); return; }
      stream = opened;
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(opened, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { error = 'Nie udało się nagrać mikrofonu. Wybierz plik lub spróbuj ponownie.'; releaseStream(); clearInterval(clock); recording = false; onrecordingchange?.(false); };
      recorder.onstop = () => {
        const seconds = (performance.now() - began) / 1000;
        clearInterval(clock); releaseStream(); recording = false; onrecordingchange?.(false);
        if (disposed || !chunks.length) return;
        const type = recorder?.mimeType || chunks[0].type || 'audio/webm';
        const extension = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        void select(new File(chunks, `nagranie-mikrofonu.${extension}`, { type }), seconds);
      };
      recorder.start(250); began = performance.now(); elapsed = 0; recording = true;
      clock = setInterval(() => { elapsed = (performance.now() - began) / 1000; if (elapsed >= 60) stop(); }, 200);
    } catch (cause) {
      releaseStream(); onrecordingchange?.(false);
      error = (cause as Error).name === 'NotAllowedError' ? 'Brak dostępu do mikrofonu. Zezwól na dostęp lub wybierz plik audio.' : 'Nie można uruchomić mikrofonu. Sprawdź urządzenie lub wybierz plik audio.';
    } finally { if (!disposed) starting = false; }
  }
  onDestroy(() => { disposed = true; controller?.abort(); clearInterval(clock); stop(); releaseStream(); releaseUrl(); onrecordingchange?.(false); });
</script>

<div class="reference-input">
  <p class="form-label">{label}</p>
  <div class="tool-actions">
    <FilePicker label="Wybierz plik audio" ariaLabel={label} accept={referenceAudioAccept} disabled={disabled || starting || recording || checking} showName={false} onchange={files => { void select(files[0]); }}/>
    {#if recording}<Button type="button" variant="outline" onclick={stop}><Square size={14}/>Zatrzymaj nagranie · {durationLabel(elapsed)}</Button>
    {:else}<Button type="button" variant="outline" disabled={disabled || starting || checking} onclick={record}><Mic size={15}/>{starting ? 'Otwieranie mikrofonu…' : 'Nagraj z mikrofonu'}</Button>{/if}
    {#if file}<Button type="button" variant="ghost" disabled={disabled || starting || recording || checking} onclick={() => { void select(); }}><X size={14}/>Wyczyść nagranie</Button>{/if}
  </div>
  {#if checking}<p class="page-footnote" role="status">Sprawdzanie nagrania…</p>{/if}
  {#if error}<p class="tool-error" role="alert">{error}</p>{/if}
  {#if file}<p class="page-footnote">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB{duration ? ` · ${durationLabel(duration)}` : ''}</p><AudioPreview src={audioUrl} title={label}/>{#if warning}<p class="page-footnote">{warning}</p>{/if}{/if}
  <p class="page-footnote">Wybierz czystą mowę jednego głosu, bez muzyki i nakładających się wypowiedzi. Zalecana próbka: 10–30 s, maksymalny plik: 128 MB. Mikrofon zatrzymuje nagranie po 60 s.</p>
</div>

<style>
  .reference-input{display:grid;gap:10px;min-width:0}.reference-input p{margin:0}.reference-input .tool-actions{flex-wrap:wrap}
</style>
