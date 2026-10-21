<script lang="ts">
  import { tick } from 'svelte';
  import VoiceAvatar from '../ui/VoiceAvatar.svelte';
  import { ChevronDown, Plus, Search, Smile, Sparkles, Undo2, X } from '@lucide/svelte';
  import { audioTags, autoTagText, insertAtSelection, tokenizeSpeech, sameSpeechBlocks, type SpeechBlock } from './tags';

  type EditorVoice = { id: string; name: string; initials?: string; color?: string; portraitSrc?: string };
  let { blocks, voices, onblockschange, onchoosevoice, disabled = false, hideToolbar = false }: {
    blocks: SpeechBlock[];
    voices: EditorVoice[];
    onblockschange: (blocks: SpeechBlock[]) => void;
    onchoosevoice: (blockId: string) => void;
    disabled?: boolean;
    hideToolbar?: boolean;
  } = $props();

  let activeId = $state('');
  let tagsOpen = $state(false);
  let query = $state('');
  let searchInput = $state<HTMLInputElement>();
  let ownTagTrigger = $state<HTMLButtonElement>();
  let popupElement: HTMLDivElement | undefined;
  let popupAnchor: HTMLElement | undefined;
  let status = $state('');
  let beforeAuto = $state<SpeechBlock[] | null>(null);
  let afterAuto = $state<SpeechBlock[] | null>(null);
  const inputs = new Map<string, HTMLTextAreaElement>();
  const selections = new Map<string, { start: number; end: number }>();
  type EditSnapshot = { blocks: SpeechBlock[]; activeId: string; selection?: { start: number; end: number } };
  let undoStack: EditSnapshot[] = [];
  let redoStack: EditSnapshot[] = [];
  let lastEditGroup = '';
  let lastEditTime = 0;
  let expectedBlocks: SpeechBlock[] | undefined;
  let inputType = '';
  let filteredTags = $derived(audioTags.filter(tag => `${tag.label} ${tag.value} ${tag.category}`.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl'))));
  let canUndoAuto = $derived(beforeAuto !== null && sameSpeechBlocks(blocks, afterAuto));

  $effect(() => {
    const current = blocks.map(block => ({ ...block }));
    // A document replacement or a voice change owned by the parent begins a new history.
    if (expectedBlocks !== undefined && !sameSpeechBlocks(current, expectedBlocks)) {
      undoStack = []; redoStack = []; lastEditGroup = ''; clearAutoHistory();
    }
    expectedBlocks = current;
  });

  function snapshot(): EditSnapshot {
    return { blocks: blocks.map(block => ({ ...block })), activeId, selection: selections.get(activeId) };
  }
  function recordEdit(group = '') {
    const now = Date.now();
    if (!group || group !== lastEditGroup || now - lastEditTime > 900 || redoStack.length) {
      undoStack.push(snapshot());
      if (undoStack.length > 100) undoStack.shift();
    }
    redoStack = []; lastEditGroup = group; lastEditTime = now;
  }
  function emit(next: SpeechBlock[]) {
    expectedBlocks = next.map(block => ({ ...block }));
    onblockschange(next);
  }
  async function restoreHistory(event: KeyboardEvent) {
    if (disabled || event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    const isUndo = event.key.toLowerCase() === 'z';
    const isRedo = (isUndo && event.shiftKey) || event.key.toLowerCase() === 'y';
    if (!isUndo && !isRedo) return;
    event.preventDefault();
    const from = isRedo ? redoStack : undoStack;
    const to = isRedo ? undoStack : redoStack;
    const previous = from.pop();
    if (!previous) return;
    to.push(snapshot()); lastEditGroup = ''; clearAutoHistory();
    emit(previous.blocks.map(block => ({ ...block })));
    activeId = previous.activeId;
    await tick();
    const input = inputs.get(activeId);
    if (input) {
      input.focus();
      if (previous.selection) input.setSelectionRange(previous.selection.start, previous.selection.end);
      rememberSelection(activeId, input);
    }
  }

  function clearAutoHistory() { beforeAuto = null; afterAuto = null; }
  function rememberSelection(id: string, input: HTMLTextAreaElement) {
    activeId = id;
    selections.set(id, { start: input.selectionStart, end: input.selectionEnd });
  }
  const resizeQueue = new Set<HTMLTextAreaElement>();
  let resizeFrame = 0;
  function sizeInput(input: HTMLTextAreaElement) {
    resizeQueue.add(input);
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const fields = [...resizeQueue].filter(field => field.isConnected);
      resizeQueue.clear();
      // Batch all writes before measuring: many speakers need only one layout pass.
      for (const field of fields) field.style.height = '0px';
      const heights = fields.map(field => Math.max(56, field.scrollHeight));
      fields.forEach((field, index) => field.style.height = `${heights[index]}px`);
    });
  }
  function editorField(input: HTMLTextAreaElement, block: SpeechBlock) {
    inputs.set(block.id, input);
    sizeInput(input);
    let lastWidth = 0;
    let lastText = block.text;
    // Observe only inline size: changing the textarea's height cannot trigger a resize loop.
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width === undefined || Math.abs(width - lastWidth) < .5) return;
      lastWidth = width;
      sizeInput(input);
    });
    observer.observe(input);
    // A font load or an appearance change can alter line wrapping without changing width.
    const appearanceObserver = new MutationObserver(() => {
      sizeInput(input);
    });
    appearanceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    const fontsChanged = () => sizeInput(input);
    document.fonts?.addEventListener('loadingdone', fontsChanged);
    return {
      update(next: SpeechBlock) {
        if (lastText === next.text) return;
        lastText = next.text;
        if (input.value !== next.text) input.value = next.text;
        sizeInput(input);
      },
      destroy() {
        observer.disconnect(); appearanceObserver.disconnect(); document.fonts?.removeEventListener('loadingdone', fontsChanged);
        resizeQueue.delete(input);
        if (!resizeQueue.size) { cancelAnimationFrame(resizeFrame); resizeFrame = 0; }
        inputs.delete(block.id); selections.delete(block.id);
      },
    };
  }

  function placePopup() {
    if (!popupElement || !popupAnchor?.isConnected) return;
    const margin = 8;
    const gap = 7;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rect = popupAnchor.getBoundingClientRect();
    const width = Math.min(355, Math.max(0, viewportWidth - margin * 2));
    popupElement.style.width = `${width}px`;
    const availableAbove = Math.max(0, rect.top - margin - gap);
    const availableBelow = Math.max(0, viewportHeight - rect.bottom - margin - gap);
    const naturalHeight = Math.min(410, popupElement.scrollHeight);
    const above = availableAbove >= naturalHeight || availableAbove > availableBelow;
    const maxHeight = Math.min(viewportHeight - margin * 2, above ? availableAbove : availableBelow);
    popupElement.style.maxHeight = `${Math.max(0, maxHeight)}px`;
    const height = popupElement.getBoundingClientRect().height;
    const left = Math.max(margin, Math.min(rect.right - width, viewportWidth - width - margin));
    const top = Math.max(margin, Math.min(above ? rect.top - gap - height : rect.bottom + gap, viewportHeight - height - margin));
    popupElement.style.left = `${left}px`;
    popupElement.style.top = `${top}px`;
    popupElement.style.visibility = 'visible';
  }

  function popupPortal(node: HTMLDivElement) {
    popupElement = node;
    document.body.appendChild(node);
    let frame = 0;
    const schedulePosition = (event?: Event) => {
      if (event?.type === 'scroll' && event.target instanceof Node && node.contains(event.target)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(placePopup);
    };
    const observer = new ResizeObserver(() => schedulePosition());
    observer.observe(node);
    window.addEventListener('resize', schedulePosition);
    document.addEventListener('scroll', schedulePosition, true);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); void closeTags(); }
    };
    document.addEventListener('keydown', escape);
    placePopup();
    return { destroy() {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('resize', schedulePosition);
      document.removeEventListener('scroll', schedulePosition, true);
      document.removeEventListener('keydown', escape);
      if (popupElement === node) popupElement = undefined;
      node.remove();
    } };
  }
  function edit(block: SpeechBlock, input: HTMLTextAreaElement) {
    const groupable = ['insertText', 'insertCompositionText', 'deleteContentBackward', 'deleteContentForward'].includes(inputType);
    recordEdit(groupable ? `${block.id}:${inputType}` : '');
    clearAutoHistory();
    rememberSelection(block.id, input);
    emit(blocks.map(row => row.id === block.id ? { ...row, text: input.value } : row));
  }

  export async function insertTag(tag: string) {
    if (disabled || !audioTags.some(item => item.value === tag)) return;
    const block = blocks.find(row => row.id === activeId) ?? blocks[0];
    if (!block) return;
    const input = inputs.get(block.id);
    const selection = selections.get(block.id) ?? { start: block.text.length, end: block.text.length };
    const inserted = insertAtSelection(block.text, tag, selection.start, selection.end);
    activeId = block.id;
    selections.set(block.id, selection);
    recordEdit();
    clearAutoHistory();
    emit(blocks.map(row => row.id === block.id ? { ...row, text: inserted.text } : row));
    tagsOpen = false;
    await tick();
    if (input) {
      input.focus(); input.setSelectionRange(inserted.caret, inserted.caret);
      rememberSelection(block.id, input); sizeInput(input);
    }
  }
  export function autoTag() {
    if (disabled) return;
    const next = blocks.map(block => ({ ...block, text: autoTagText(block.text) }));
    if (sameSpeechBlocks(next, blocks)) { status = 'Nie ma nowych miejsc na pauzy.'; return; }
    recordEdit();
    beforeAuto = blocks.map(block => ({ ...block }));
    afterAuto = next.map(block => ({ ...block }));
    emit(next);
    status = 'Dodano pauzy po wielokropkach i między akapitami. Możesz cofnąć tę operację.';
    tagsOpen = false;
  }
  export function undoAutoTag() {
    if (disabled || !canUndoAuto || !beforeAuto) return;
    recordEdit();
    emit(beforeAuto.map(block => ({ ...block })));
    clearAutoHistory(); status = 'Cofnięto automatyczne tagowanie.';
  }
  export function applyAutomaticTags(next: SpeechBlock[]) {
    recordEdit();
    beforeAuto = blocks.map(block => ({ ...block }));
    afterAuto = next.map(block => ({ ...block }));
    emit(next);
    tagsOpen = false;
    status = 'Dodano tagi AI. Możesz cofnąć zmianę lub zachować wynik.';
  }
  export function keepAutomaticTags() { clearAutoHistory(); status = 'Zachowano tagi AI.'; }
  export async function toggleTags() {
    if (disabled) return;
    if (!tagsOpen) {
      const focused = document.activeElement;
      popupAnchor = focused instanceof HTMLElement && focused.matches('[data-speech-tag-trigger], .tag-toggle')
        ? focused : hideToolbar ? document.querySelector<HTMLElement>('[data-speech-tag-trigger]') ?? undefined : ownTagTrigger;
    }
    tagsOpen = !tagsOpen;
    if (tagsOpen) { query = ''; await tick(); placePopup(); searchInput?.focus({ preventScroll: true }); }
  }
  async function addSpeaker(afterId?:string) {
    if(disabled)return;
    const id = crypto.randomUUID();
    recordEdit();
    clearAutoHistory();
    const index=afterId?blocks.findIndex(block=>block.id===afterId):blocks.length-1;
    const at=index<0?blocks.length:index+1;
    emit([...blocks.slice(0,at), { id, voiceId: blocks[index]?.voiceId ?? voices[0]?.id ?? '', text: '' },...blocks.slice(at)]);
    await tick(); inputs.get(id)?.focus(); activeId = id;
  }
  async function clearText(id:string){
    if(disabled)return;
    recordEdit();clearAutoHistory();
    emit(blocks.map(block=>block.id===id?{...block,text:''}:block));
    activeId=id;selections.set(id,{start:0,end:0});
    await tick();inputs.get(id)?.focus();status='Wyczyszczono tekst mówcy. Ctrl+Z przywróci treść.';
  }
  async function removeSpeaker(id: string) {
    const index = blocks.findIndex(block => block.id === id);
    const remaining = blocks.filter(block => block.id !== id);
    recordEdit();
    clearAutoHistory();
    emit(remaining);
    const target = remaining[Math.min(Math.max(0, index), remaining.length - 1)];
    if (target) {
      activeId = target.id;
      await tick();
      inputs.get(target.id)?.focus({ preventScroll: true });
    }
  }
  async function closeTags() {
    tagsOpen = false;
    await tick();
    (popupAnchor?.isConnected ? popupAnchor : inputs.get(activeId))?.focus({ preventScroll: true });
  }
</script>

<svelte:window onpointerdown={(event) => { if (tagsOpen && !(event.target as Element).closest('.speech-tag-controls, .tag-popover, [data-speech-tag-trigger]')) tagsOpen = false; }} />

<div class="speech-editor" aria-label="Edytor narracji">
  <div class="speech-blocks">
    {#each blocks as block, index (block.id)}
      {@const voice = voices.find(row => row.id === block.voiceId)}
      <section class="speech-block" aria-label={`Mówca ${index + 1}`}>
        <div class="speaker-row">
          <button class="voice-pill" disabled={disabled} onclick={() => onchoosevoice(block.id)} aria-label={`Wybierz głos dla mówcy ${index + 1}: ${voice?.name ?? 'Nie wybrano'}`}>
            <span class="voice-avatar" aria-hidden="true"><VoiceAvatar voiceId={block.voiceId} portraitSrc={voice?.portraitSrc} size={16}/></span>
            <span>{voice?.name ?? 'Wybierz głos'}</span><ChevronDown size={13} />
          </button>
          <div class="speaker-actions">{#if blocks.length > 1}<button class="remove-speaker" disabled={disabled} onclick={() => removeSpeaker(block.id)} aria-label={`Usuń mówcę ${index + 1}`} title="Usuń mówcę (Ctrl+Z cofa)"><X size={17}/></button>
          {:else}<button class="clear-text" disabled={disabled||!block.text} onclick={()=>clearText(block.id)} aria-label={`Wyczyść tekst mówcy ${index+1}`} title="Wyczyść tekst"><X size={17}/></button>{/if}</div>
        </div>
        <div class="editor-field">
          <div class="highlight-layer" aria-hidden="true">{#each tokenizeSpeech(block.text) as token}<span class:audio-tag={token.isTag}>{token.text}</span>{/each}{#if block.text.endsWith('\n')}<br />{/if}</div>
          <textarea
            use:editorField={block}
            class="speech-input"
            value={block.text}
            disabled={disabled}
            aria-label={`Tekst mówcy ${index + 1}`}
            placeholder="Wpisz tekst, który ma zabrzmieć…"
            spellcheck="true"
            onbeforeinput={(event) => {
              inputType = (event as InputEvent).inputType;
              rememberSelection(block.id, event.currentTarget);
              if (inputType === 'historyUndo' || inputType === 'historyRedo') {
                event.preventDefault();
                void restoreHistory(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: inputType === 'historyRedo' }));
              }
            }}
            oninput={(event) => edit(block, event.currentTarget)}
            onkeydown={event=>{if(event.key==='Enter'&&event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.isComposing){event.preventDefault();void addSpeaker(block.id);}else void restoreHistory(event);}}
            onfocus={(event) => rememberSelection(block.id, event.currentTarget)}
            onselect={(event) => rememberSelection(block.id, event.currentTarget)}
            onkeyup={(event) => rememberSelection(block.id, event.currentTarget)}
            onclick={(event) => rememberSelection(block.id, event.currentTarget)}
          ></textarea>
        </div>
      </section>
    {/each}
  </div>
  <div class="add-speaker-row"><span></span><button disabled={disabled} onclick={()=>addSpeaker()} title="Shift+Enter w tekście"><Plus size={16} />Dodaj mówcę</button><span></span></div>
  <div class="speech-tag-controls" class:hidden-toolbar={hideToolbar}>
    {#if tagsOpen}
      <div class="tag-popover" role="dialog" aria-label="Tagi audio" use:popupPortal>
        <div class="tag-search"><Search size={15} /><input bind:this={searchInput} bind:value={query} placeholder="Szukaj tagów…" aria-label="Szukaj tagów audio" onkeydown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); (event.currentTarget.closest('.tag-popover')?.querySelector('.tag-option') as HTMLButtonElement)?.focus(); } }} /><button aria-label="Zamknij tagi" onclick={closeTags}><X size={14} /></button></div>
        <div class="tag-options">
          {#each ['Pauzy', 'Wokalizacje', 'Reakcje'] as category}
            {#if filteredTags.some(tag => tag.category === category)}
              <p class="tag-category">{category}</p>
              <div class="tag-category-items">
                {#each filteredTags.filter(tag => tag.category === category) as tag}
                  <button class="tag-option" onclick={() => insertTag(tag.value)} title={`${tag.description} · ${tag.value}`}>{tag.label}</button>
                {/each}
              </div>
            {/if}
          {/each}
          {#if filteredTags.length === 0}<p class="no-tags">Brak pasujących tagów.</p>{/if}
        </div>
        <p class="tag-note">Tagi obsługiwane przez OmniVoice. Automatyczne pauzy nie dobierają emocji.</p>
      </div>
    {/if}
    {#if !hideToolbar}
      <button bind:this={ownTagTrigger} class="tag-toggle" disabled={disabled} aria-expanded={tagsOpen} onclick={toggleTags}><Smile size={15} /><span>Tagi audio</span><ChevronDown size={13} /></button>
      <button class="auto-tag" disabled={disabled || !blocks.some(block => block.text.trim())} onclick={autoTag} title="Lokalna reguła: pauza po wielokropku i między akapitami"><Sparkles size={14} />Automatyczne pauzy</button>
      {#if canUndoAuto}<button class="undo-tag" disabled={disabled} onclick={undoAutoTag} aria-label="Cofnij automatyczne pauzy" title="Cofnij automatyczne pauzy"><Undo2 size={14} /></button>{/if}
    {/if}
  </div>
  <span class="editor-status" role="status">{status}</span>
</div>

<style>
  .speech-editor { position: relative; color: var(--foreground); width: 100%; }
  .speech-block + .speech-block { margin-top: 24px; }
  .speaker-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  button { color: inherit; font: inherit; cursor: pointer; }
  button:disabled { cursor: default; opacity: .45; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .voice-pill { display: inline-flex; align-items: center; gap: 6px; max-width:calc(100% - 76px);min-height:32px; border: 1px solid var(--border); background: transparent; border-radius: 10px; padding: 5px 10px; font-size:var(--ui-text-13); font-weight: 550; }
  .voice-pill>span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.voice-pill>:global(svg){flex-shrink:0}
  .voice-pill:hover { background: var(--surface); }
  .voice-pill :global(svg) { color: var(--muted); }
  .voice-avatar { display: grid; place-items: center; width: 16px; height: 16px; flex-shrink:0; border-radius: 50%; }
  .speaker-actions{display:flex;gap:2px;margin-left:auto;opacity:0;transition:opacity 150ms}.speech-block:hover .speaker-actions,.speech-block:focus-within .speaker-actions{opacity:1}.remove-speaker,.clear-text { border: 0; background: none; color: var(--muted);width:32px;height:32px;border-radius:8px; padding: 5px; display: grid; place-items: center; }.remove-speaker:hover,.clear-text:hover{background:var(--surface-hover);color:var(--foreground)}
  .editor-field { position: relative; min-height: 56px; }
  .highlight-layer, .speech-input { width: 100%; margin: 0; padding: 0; border: 0; font-family: inherit; font-size: var(--editor-font-size, 17px); font-weight: 400; line-height: 1.75; letter-spacing: 0; text-align: start; white-space: pre-wrap; overflow-wrap: break-word; tab-size: 4; box-sizing: border-box; }
  .highlight-layer { position: absolute; inset: 0; pointer-events: none; color: var(--foreground); }
  .speech-input { position: relative; display: block; min-height: 56px; background: transparent; color: transparent; caret-color: var(--foreground); resize: none; overflow: hidden; outline: none; -webkit-text-fill-color: transparent; }
  .speech-input::placeholder { color: var(--muted); -webkit-text-fill-color: var(--muted); opacity: .85; }
  .speech-input::selection { background: color-mix(in srgb, var(--accent) 28%, transparent); color: transparent; }
  .speech-input:focus-visible { outline: none; }
  .audio-tag { color: var(--tag, #c682e9); background: color-mix(in srgb, var(--tag, #c682e9) 5%, transparent); border-radius: 6px; box-shadow: 0 0 0 1px color-mix(in srgb, var(--tag, #c682e9) 22%, transparent); }
  .add-speaker-row { display: flex; align-items: center; gap: 0; margin-top: 16px; }
  .add-speaker-row > span { height: 1px; background: var(--border); flex: 1; opacity: .65; }
  .add-speaker-row button { display: flex; align-items: center; gap: 7px; background:var(--background); border: 0;border-radius:10px; font-size:var(--ui-text-13);font-weight:500; padding: 7px 12px; }.add-speaker-row button:hover{background:var(--surface-hover)}
  .speech-tag-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; position: relative; margin-top: 25px; }
  .speech-tag-controls.hidden-toolbar { margin-top: 0; }
  .tag-toggle, .auto-tag, .undo-tag { display: inline-flex; align-items: center; gap: 7px; padding: 7px 9px; border: 1px solid var(--border); border-radius: 7px; background: transparent; font-size:var(--ui-text-12); white-space: nowrap; }
  .tag-toggle :global(svg:first-child) { color: var(--tag, #c682e9); }
  .auto-tag, .undo-tag { border-color: transparent; color: var(--muted); }
  .auto-tag:hover, .undo-tag:hover, .tag-toggle:hover { background: var(--surface); color: var(--foreground); }
  .tag-popover { position: fixed; top: 8px; left: 8px; visibility: hidden; display: flex; flex-direction: column; width: min(355px, calc(100vw - 16px)); max-height: calc(100dvh - 16px); color: var(--foreground); font-family: var(--font-ui, inherit); border: 1px solid var(--border); box-shadow: var(--popup-shadow); border-radius: 11px; padding: 9px; z-index: 70; box-sizing: border-box; }
  .tag-search { display: flex; gap: 8px; align-items: center; flex-shrink: 0; border: 1px solid var(--border); padding: 8px; border-radius: 7px; color: var(--muted); }
  .tag-search input { width: 100%; min-width: 0; border: 0; background: transparent; color: var(--foreground); font: inherit; font-size:var(--ui-text-12); outline: none; }
  .tag-search button { background: none; border: 0; color: var(--muted); padding: 0; display: grid; place-items: center; }
  .tag-options { overflow-y: auto; min-height: 0; max-height: 250px; padding: 0 3px 7px; }
  .tag-category { color: var(--muted); font-size:var(--ui-text-11); margin: 13px 0 7px; }
  .tag-category-items { display: flex; flex-wrap: wrap; gap: 5px; }
  .tag-option { border: 1px solid var(--border); background: transparent; border-radius: 5px; font-size:var(--ui-text-11); padding: 5px 7px; }
  .tag-option:hover { border-color: var(--tag, #c682e9); color: var(--tag, #c682e9); }
  .tag-note, .no-tags { color: var(--muted); font-size:var(--ui-text-10); line-height: 1.6; margin: 7px 3px 1px; }
  .tag-note { flex-shrink: 0; padding-top: 7px; border-top: 1px solid var(--border); }
  .editor-status { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
  @media(pointer:coarse){.speaker-actions{opacity:1}}@media(prefers-reduced-motion:reduce){.speaker-actions{transition:none}}
  @media (forced-colors: active) { .highlight-layer { display: none; } .speech-input { color: CanvasText; -webkit-text-fill-color: CanvasText; } }
</style>
