<script lang="ts" module>
  /** One provider in the picker. models: ids to list (the page adds the configured model); state: '' = usable, else a short reason
   *  (dimmed, not selectable); err: the last list fetch failed; loading: the list is being fetched. */
  export type PickGroup = { id: string; tpl: string; name: string; state: string; models: string[]; loading?: boolean; err?: string };
</script>
<script lang="ts">
  // Unified model picker (port of the approved prototype): ONE dropdown with the models of all connected providers,
  // grouped by provider (icon + name header). Choosing a row sets provider AND model. Custom opaque popup (the app's
  // Select cannot render icons in options). Both the compact and the full form offer "Wpisz model ręcznie" (manual id in
  // the same slot) unless manualEntry is off.
  // ponytail: the engine's /models list has no dates, so there is no "Najnowsze"/"Starsze" split or "nowy" mark; rows keep the engine order.
  import { tick } from 'svelte';
  import { Check, ChevronDown, LoaderCircle, Search } from '@lucide/svelte';
  import { uiLanguage, createUiTranslator } from '../../i18n';
  import ProviderIcon from '../../ui/ProviderIcon.svelte';
  import Button from '../../ui/Button.svelte';
  import Input from '../../ui/Input.svelte';
  import Select from '../../ui/Select.svelte';
  const tr = $derived(createUiTranslator($uiLanguage));

  let { groups, provider, model, ariaLabel, onpick, onopen, attention = false, full = false, manualEntry = true }: {
    groups: PickGroup[]; provider: string; model: string; ariaLabel: string; onpick: (provider: string, model: string) => void;
    onopen?: () => void; attention?: boolean; full?: boolean; manualEntry?: boolean } = $props();

  const uid = $props.id();
  const cur = $derived(groups.find(g => g.id === provider));
  const usable = $derived(groups.filter(g => !g.state));

  /* ---------- popup ---------- */
  let open = $state(false), query = $state(''), active = $state(0), kbd = $state(false);
  let trigger = $state<HTMLButtonElement>(), popup = $state<HTMLDivElement>(), list = $state<HTMLDivElement>();
  let pos = $state({ left: 0, top: 0, bottom: 0, up: false, min: 0, max: 360 });
  type Row = { idx: number; pid: string; id: string };
  const all = $derived(usable.reduce((n, g) => n + g.models.length, 0));
  const searchable = $derived(all > 12);
  const view = $derived.by(() => {
    let idx = 0; const q = query.trim().toLowerCase(); const flat: Row[] = [];
    const out = groups.map(g => {
      if (g.state) return { g, rows: [] as Row[] };
      const rows = g.models.filter(id => !q || id.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)).map(id => {
        const r: Row = { idx: idx++, pid: g.id, id }; flat.push(r); return r;
      });
      return { g, rows };
    }).filter(v => v.g.state ? !q : v.rows.length || v.g.loading || v.g.err);
    return { out, flat };
  });

  function portal(node: HTMLDivElement) {
    node.popover = 'manual'; document.body.appendChild(node); node.showPopover?.();
    return { destroy() { if (node.matches(':popover-open')) node.hidePopover?.(); node.remove(); } };
  }
  async function show(keyboard = false) {
    if (open || !trigger) return;
    onopen?.();
    query = ''; kbd = keyboard;
    const r = trigger.getBoundingClientRect();
    const below = innerHeight - r.bottom - 12, above = r.top - 12, up = below < 300 && above > below;
    pos = { left: r.left, top: r.bottom + 5, bottom: innerHeight - r.top + 5, up, min: r.width, max: Math.min(400, up ? above : below) };
    const sel = view.flat.findIndex(x => x.pid === provider && x.id === model);
    active = sel >= 0 ? sel : 0;
    open = true; await tick();
    if (!popup) return;
    pos.left = Math.max(8, Math.min(r.left, innerWidth - popup.offsetWidth - 8));
    (popup.querySelector<HTMLElement>('input') ?? list)?.focus({ preventScroll: true }); scrollActive(true);
  }
  function close(restore = true) { open = false; if (restore) trigger?.focus({ preventScroll: true }); }
  function scrollActive(center = false) { list?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: center ? 'center' : 'nearest' }); }
  function choose(i: number) { const r = view.flat[i]; if (!r) return; onpick(r.pid, r.id); close(); }
  async function keydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    const n = view.flat.length;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close();
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && n) {
      e.preventDefault(); kbd = true;
      active = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      await tick(); scrollActive();
    }
  }
  $effect(() => { query; active = 0; }); // a new search restarts at the first row
  $effect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { const t = e.target as Node; if (!trigger?.contains(t) && !popup?.contains(t)) close(false); };
    const scroll = (e: Event) => { if (!popup?.contains(e.target as Node)) close(); };
    const resize = () => close();
    document.addEventListener('pointerdown', outside); document.addEventListener('scroll', scroll, true); addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('scroll', scroll, true); removeEventListener('resize', resize); };
  });

  /* ---------- manual id (replaces the list in the same slot) ---------- */
  let manual = $state(false), typed = $state(''), mprov = $state('');
  function startManual() { typed = model; mprov = cur && !cur.state ? provider : usable[0]?.id ?? ''; manual = true; }
  function useManual() { const v = typed.trim(); if (!v || !mprov) return; onpick(mprov, v); manual = false; }
  const mprovOpts = $derived(usable.map(g => ({ value: g.id, label: g.name })));
  const mcur = $derived(groups.find(g => g.id === mprov));
</script>

{#snippet trig()}
  <button bind:this={trigger} type="button" class="vs-select-trigger mp-trig" class:attn={attention} role="combobox" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${uid}-lb` : undefined}
    onclick={e => open ? close() : show(e.detail === 0)}
    onkeydown={e => { if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); show(true); } }}>
    <span class="vs-select-value mp-val">
      {#if attention}<span class="mp-ph">{tr('Wybierz nowy domyślny model')}</span>
      {:else if cur}<ProviderIcon id={cur.tpl} size={16}/><span class="mp-txt">{cur.name} · {model || tr('wybierz model')}</span>
      {:else}<span class="mp-ph">{tr('Wybierz model')}</span>{/if}</span>
    <ChevronDown class="vs-control-chevron" size={14}/>
  </button>
{/snippet}
{#snippet manualRow()}
  <div class="mp-prov"><Select ariaLabel={tr('Dostawca własnego modelu')} value={mprov} options={mprovOpts} onchange={v => mprov = String(v)}>
    {#snippet triggerContent()}<span class="vs-select-value mp-chip">{#if mcur}<ProviderIcon id={mcur.tpl} size={16}/><span class="mp-pn">{mcur.name}</span>{/if}</span><ChevronDown class="vs-control-chevron" size={14}/>{/snippet}</Select></div>
  <Input class="mp-in" aria-label={tr('Własny identyfikator modelu')} placeholder={tr('Własny identyfikator modelu')} bind:value={typed}
    onkeydown={e => { if (e.key === 'Enter') useManual(); else if (e.key === 'Escape') manual = false; }}/>
  <Button disabled={!typed.trim() || !mprov} onclick={useManual}>{tr('Użyj')}</Button>
{/snippet}

{#if full}
  <div class="mp mp-full"><div class="mp-line">
    {#if manual}{@render manualRow()}
      <Button variant="ghost" size="xs" aria-pressed="true" onclick={() => manual = false}>{tr('Wybierz z listy')}</Button>
    {:else}{@render trig()}
      {#if manualEntry}<Button variant="ghost" size="xs" onclick={startManual}>{tr('Wpisz model ręcznie')}</Button>{/if}
    {/if}
  </div></div>
{:else}
  <div class="mp">
    {#if manual}{@render manualRow()}
      <Button variant="ghost" size="xs" aria-pressed="true" onclick={() => manual = false}>{tr('Wybierz z listy')}</Button>
    {:else}{@render trig()}
      {#if manualEntry}<Button variant="ghost" size="xs" onclick={startManual}>{tr('Wpisz model ręcznie')}</Button>{/if}
    {/if}
  </div>
{/if}

{#if open}
  <div class="mp-pop" bind:this={popup} use:portal role="presentation" onkeydown={keydown}
    style={`left:${pos.left}px;${pos.up ? `bottom:${pos.bottom}px` : `top:${pos.top}px`};min-width:${Math.max(pos.min, 320)}px;max-height:${pos.max}px`}>
    {#if searchable}
      <div class="mp-search"><Search size={14}/><Input unstyled class="mp-sin" bind:value={query} aria-label={tr('Szukaj modelu')} placeholder={tr('Szukaj modelu…')} role="combobox" aria-expanded="true" aria-controls={`${uid}-lb`} aria-activedescendant={view.flat.length ? `${uid}-o${active}` : undefined}/></div>
    {/if}
    <div id={`${uid}-lb`} class="mp-list" role="listbox" tabindex="-1" aria-label={ariaLabel} bind:this={list} aria-activedescendant={view.flat.length ? `${uid}-o${active}` : undefined}>
      {#each view.out as { g, rows } (g.id)}
        <div role="group" aria-labelledby={`${uid}-g-${g.id}`} class="mp-grp" class:dim={!!g.state}>
          <div id={`${uid}-g-${g.id}`} class="mp-gh"><ProviderIcon id={g.tpl} size={14}/><span>{g.name}</span>
            {#if g.state}<em>{g.state}</em>{:else if g.loading}<em class="mp-load"><LoaderCircle size={12} class="spin"/>{tr('Pobieram…')}</em>{:else if g.err}<em class="mp-errh" title={g.err}>{tr('Błąd pobierania')}</em>{/if}</div>
          {#each rows as r (r.id)}
            <div id={`${uid}-o${r.idx}`} role="option" tabindex="-1" class="mp-opt" class:act={active === r.idx} class:kbd={kbd && active === r.idx} data-i={r.idx}
              aria-selected={r.pid === provider && r.id === model} onclick={() => choose(r.idx)} onkeydown={() => {}} onpointermove={() => { kbd = false; active = r.idx; }}>
              <ProviderIcon id={g.tpl} size={16}/><span class="mp-id">{r.id}</span>
              <span class="mp-ck">{#if r.pid === provider && r.id === model}<Check size={14}/>{/if}</span>
            </div>
          {/each}
        </div>
      {/each}
      {#if !view.flat.length && query}<p class="mp-none">{tr('Brak modeli pasujących do „{query}”.', { query })}</p>{/if}
    </div>
  </div>
{/if}

<style>
  .mp{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
  .mp :global(.mp-trig){flex:1 1 240px;width:auto;min-width:190px;max-width:380px}
  .mp :global(.mp-trig.attn){border-color:var(--accent)}
  .mp-full{flex-direction:column;align-items:stretch;flex-wrap:nowrap;gap:6px;width:100%}
  .mp-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
  .mp-line :global(.mp-trig){flex:1 1 auto;max-width:none}
  .mp :global(.mp-in){height:32px;min-height:32px;box-sizing:border-box;flex:1 1 150px;min-width:0;width:auto;max-width:100%}
  .mp-ph{color:var(--muted)}
  .mp-val{display:inline-flex;align-items:center;gap:8px;min-width:0}
  .mp-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mp-prov{flex:none}
  .mp-prov :global(.vs-select-trigger){width:auto;padding:0 8px;gap:6px}
  .mp-chip{display:inline-flex;align-items:center;gap:6px;min-width:0}
  .mp-pn{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  /* popup: fully opaque */
  .mp-pop{position:fixed;inset:auto;margin:0;z-index:130;display:flex;flex-direction:column;overflow:hidden;width:max-content;max-width:calc(100vw - 16px);padding:0;
    background:var(--surface-raised);color:var(--foreground);border:1px solid color-mix(in srgb,var(--foreground) 10%,var(--surface-raised));border-radius:8px;
    box-shadow:0 16px 40px -18px rgb(0 0 0 / 55%);font-family:var(--font-ui);font-size:var(--ui-font-size,13px);-webkit-backdrop-filter:none;backdrop-filter:none}
  :global([data-colormode=dark]) .mp-pop{box-shadow:0 18px 44px -18px rgb(0 0 0 / 80%)}
  .mp-search{display:flex;align-items:center;gap:8px;padding:0 12px;height:38px;flex:none;border-bottom:1px solid var(--border);color:var(--muted);background:var(--surface-raised)}
  .mp-search :global(.mp-sin){flex:1;min-width:0;height:100%;border:0;background:transparent;box-shadow:none;padding:0;color:var(--foreground);outline:none}
  .mp-list{overflow-y:auto;overscroll-behavior:contain;padding:4px;outline:none;min-height:0;background:var(--surface-raised)}
  .mp-grp+.mp-grp{margin-top:4px;padding-top:4px;border-top:1px solid color-mix(in srgb,var(--foreground) 10%,transparent)}
  .mp-gh{display:flex;align-items:center;gap:8px;padding:6px 8px 4px;color:var(--muted);font-size:var(--ui-text-11);font-weight:600;letter-spacing:.06em;text-transform:uppercase}
  .mp-gh em{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-style:normal;font-weight:400;letter-spacing:0;text-transform:none}
  .mp-gh .mp-errh{color:var(--danger)}
  .mp-load :global(svg){color:var(--accent)}
  .mp-grp.dim{opacity:.55}
  .mp-opt{display:flex;align-items:center;gap:8px;min-height:30px;padding:5px 8px;border-radius:6px;cursor:pointer}
  .mp-opt.act{background:var(--neutral-selected-hover);color:var(--neutral-selected-foreground)}
  .mp-opt.kbd{outline:2px solid var(--focus,var(--accent));outline-offset:-2px}
  .mp-id{flex:1;min-width:0;overflow-wrap:anywhere}
  .mp-ck{width:14px;height:14px;flex:none;display:inline-flex}
  .mp-none{margin:0;padding:12px 8px;color:var(--muted);font-size:var(--ui-text-12)}
  .mp-pop :global(.spin){animation:mp-rot .8s linear infinite}@keyframes mp-rot{to{transform:rotate(360deg)}}
  @media(prefers-reduced-motion:reduce){.mp-pop :global(.spin){animation:none}}
</style>
