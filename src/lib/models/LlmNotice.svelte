<script lang="ts">
  // Shown by tools that need a language model (text tools, LLM translation, dictation refinement) when none is available.
  // The engine's /engines/llm catalogue only knows the local openai-compat backend, so the provider registry is the truth.
  import { uiLanguage, createUiTranslator } from '../i18n'
  import Button from '../ui/Button.svelte'
  import { productionJson } from '../tools/production/production'
  import { usableProvider, type UsableProvider } from './llm-usable'
  const tr = $derived(createUiTranslator($uiLanguage))

  let { ready, onopenai, source = 'providers' }: { ready: boolean; onopenai?: () => void; source?: 'providers' | 'refinement' } = $props()
  let none = $state(false)

  $effect(() => {
    none = false
    if (!ready) return
    const controller = new AbortController()
    const read = source === 'refinement'
      ? productionJson<{ auto?: boolean; llm_ready?: boolean }>('/api/settings/dictation-refinement', { signal: controller.signal }).then(state => state.auto !== false && state.llm_ready === false) // only when refinement is switched on
      : productionJson<{ providers: UsableProvider[] }>('/api/settings/llm-providers', { signal: controller.signal })
        .then(state => !state.providers.some(usableProvider)) // same definition as the AI settings page
    // ponytail: a failed read shows nothing (the tool's own error handling covers an unreachable engine).
    void read.then(value => { if (!controller.signal.aborted) none = value }, () => {})
    return () => controller.abort()
  })
</script>

{#if ready && none}
  <p class="tool-workspace-note" role="status">{tr('Brak modelu językowego. Połącz dostawcę w „AI i klucze”.')} {tr('Potrzebny jest dostawca z kluczem API lub lokalny.')}{#if onopenai} <Button variant="ghost" onclick={onopenai}>{tr('Otwórz „AI i klucze”')}</Button>{/if}</p>
{/if}
