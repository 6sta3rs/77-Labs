<script lang="ts">
  import { Globe2 } from '@lucide/svelte'
  import { voiceLanguageCode } from '../voices/voice-picker'

  let { language }: { language: string } = $props()
  // Build-time local assets only. A flag identifies the language visually; it
  // does not assert a speaker's nationality, regional accent or capabilities.
  const flags = import.meta.glob<string>('./language-flags/*.svg', { eager: true, query: '?url', import: 'default' })
  const code = $derived(voiceLanguageCode(language))
  const source = $derived(flags[`./language-flags/${code}.svg`])
</script>

<span class="language-flag" aria-hidden="true">
  {#if source}
    <img src={source} alt="" width="18" height="18" draggable="false"/>
  {:else}
    <Globe2 size={18}/>
  {/if}
</span>

<style>
  .language-flag{display:inline-flex;width:18px;height:18px;flex:0 0 18px;border-radius:50%;overflow:hidden;vertical-align:middle;box-shadow:0 0 0 1px var(--border)}
  .language-flag img,.language-flag :global(svg){display:block;width:100%;height:100%;margin:0;object-fit:contain}
</style>
