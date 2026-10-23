<script lang="ts">
  import { uiLanguage, createUiTranslator } from '../i18n';
  const tr = $derived(createUiTranslator($uiLanguage));
  import { downloadState } from './download-monitor';
  import { rateText } from './download-eta';
  import { byteLabel } from './model-management';
  let { onclick }: { onclick: () => void } = $props();
  const jobs = $derived($downloadState.jobs);
  const known = $derived(jobs.length > 0 && jobs.every(job => job.total_bytes));
  const total = $derived(jobs.reduce((sum, job) => sum + (job.total_bytes || 0), 0));
  const percent = $derived(known && total ? Math.min(99, Math.floor(jobs.reduce((sum, job) => sum + job.downloaded_bytes, 0) / total * 100)) : undefined);
  const speed = $derived(Object.values($downloadState.eta).reduce((sum, row) => sum + (row.speed || 0), 0));
  const label = $derived([tr('Pobieranie modeli'), percent !== undefined ? `${percent}%` : '', rateText({ speed }, tr, byteLabel)].filter(Boolean).join(' · '));
  const R = 7, C = 2 * Math.PI * R;
</script>
{#if jobs.length}
  <button class="download-indicator" type="button" title={label} aria-label={`${label}. ${tr('Otwórz Ustawienia → Modele')}`} {onclick}>
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" class:spin={percent === undefined}>
      <circle cx="9" cy="9" r={R} fill="none" stroke="var(--input-border)" stroke-width="2"/>
      <circle cx="9" cy="9" r={R} fill="none" stroke="var(--focus)" stroke-width="2" stroke-linecap="round" stroke-dasharray={C} stroke-dashoffset={C * (1 - (percent ?? 25) / 100)} transform="rotate(-90 9 9)"/>
    </svg>
    <span>{percent !== undefined ? `${percent}%` : tr('Pobieranie')}</span>
  </button>
{/if}
<style>
  .download-indicator{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border:1px solid var(--input-border);border-radius:8px;background:var(--control-background);color:var(--foreground);font-size:var(--ui-text-12);cursor:pointer}
  .download-indicator:hover{background:var(--hover, var(--control-background))}
  .spin{animation:dl-spin 1s linear infinite}
  @keyframes dl-spin{to{transform:rotate(360deg)}}
  @media(prefers-reduced-motion:reduce){.spin{animation:none}}
</style>
