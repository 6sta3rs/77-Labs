<script lang="ts">
  // Notes under the environment installer: the disk requirement and removal of failed attempts (installer_cleanup).
  import { uiLanguage, createUiTranslator } from '../../i18n';
  import Button from '../../ui/Button.svelte';
  import { toast } from '../../ui/toast';
  import { runtimeInstaller } from '../../platform/runtime-installer';
  const tr = $derived(createUiTranslator($uiLanguage));
  let { state, busy, onrun }: { state: string; busy: boolean; onrun: (job: () => Promise<void>) => Promise<void> } = $props();
</script>

<p class="p-sub">{tr('Potrzebne wolne miejsce na dysku: ok. 20 GB (CPU) lub 35 GB (CUDA), bez wag modeli.')}</p>
{#if ['failed', 'cancelled', 'interrupted'].includes(state)}
  <Button variant="ghost" disabled={busy} onclick={() => onrun(async () => { await runtimeInstaller.cleanup(); toast.ok(tr('Usunięto nieudane próby')); })}>{tr('Usuń nieudane próby')}</Button>
{/if}
