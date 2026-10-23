<script lang="ts">
  import { uiLanguage, createUiTranslator } from '../i18n';
  const tr = $derived(createUiTranslator($uiLanguage));
  // Mounted once in App.svelte. Bottom-centre stack; colour by kind via tokens (docs/features/settings-style.md).
  import { CircleCheck, CircleX, TriangleAlert, Info, X } from '@lucide/svelte';
  import { toasts, dismiss, type ToastItem } from './toast';
  const TTL = { ok: 4000, info: 4000, warn: 6000 } as const;
  // Per-toast timer; hover pauses it (remaining time is kept), leave restarts it. `bad` has no timer.
  function life(node: HTMLElement, t: ToastItem) {
    const total = t.kind === 'bad' ? 0 : TTL[t.kind];
    let left = total, started = 0, h: ReturnType<typeof setTimeout> | undefined;
    const run = () => { if (!total) return; started = Date.now(); h = setTimeout(() => dismiss(t.id), left); };
    const pause = () => { if (h) { clearTimeout(h); h = undefined; left -= Date.now() - started; } };
    node.addEventListener('mouseenter', pause); node.addEventListener('mouseleave', run);
    run();
    return { destroy() { clearTimeout(h); } };
  }
  const icon = { ok: CircleCheck, bad: CircleX, warn: TriangleAlert, info: Info } as const;
</script>

<div class="p-toasts">
  {#each $toasts as t (t.id)}
    {@const Icon = icon[t.kind]}
    <div class="p-toast {t.kind}" role={t.kind === 'bad' ? 'alert' : 'status'} use:life={t}>
      <Icon size={15} aria-hidden="true"/><span>{t.text}</span>
      {#if t.kind === 'bad'}<button type="button" class="x" aria-label={tr("Zamknij powiadomienie")} onclick={() => dismiss(t.id)}><X size={14}/></button>{/if}
    </div>
  {/each}
</div>

<style>
  .p-toasts{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:300;display:flex;flex-direction:column;gap:8px;align-items:center;width:max-content;max-width:min(520px,calc(100vw - 32px));pointer-events:none}
  .p-toast{--tc:var(--muted);pointer-events:auto;display:flex;align-items:flex-start;gap:9px;width:100%;padding:10px 12px;border:1px solid color-mix(in srgb,var(--tc) 45%,var(--border));border-radius:8px;background:color-mix(in srgb,var(--tc) 12%,var(--surface-raised));color:var(--foreground);box-shadow:var(--popup-shadow);font-size:var(--ui-text-12);line-height:1.5;animation:p-toast-in .18s ease-out}
  .p-toast :global(svg){flex-shrink:0;margin-top:2px;color:var(--tc)}
  .p-toast span{min-width:0;overflow-wrap:anywhere}
  .ok{--tc:var(--success)}.bad{--tc:var(--danger)}.warn{--tc:var(--settings-warn)}
  .x{margin-left:auto;display:grid;place-items:center;width:20px;height:20px;border-radius:5px;color:var(--muted)}
  .x:hover{background:color-mix(in srgb,var(--foreground) 10%,transparent)}
  .p-toast .x :global(svg){margin:0;color:inherit}
  @keyframes p-toast-in{from{opacity:0;transform:translateY(8px)}}
  @media (prefers-reduced-motion:reduce){.p-toast{animation:none}}
  @media (max-width:640px){.p-toasts{width:calc(100vw - 32px);max-width:none}}
</style>
