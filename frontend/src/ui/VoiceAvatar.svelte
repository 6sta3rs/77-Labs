<script lang="ts">
  import { uiLanguage, createUiTranslator } from '../i18n'
  const tr = $derived(createUiTranslator($uiLanguage))
  import VoiceOrb from '../playback/VoiceOrb.svelte'
  let { portraitSrc, voiceId, name, size = 32, decorative = true }: {
    portraitSrc?: string; voiceId: string; name?: string; size?: number | string; decorative?: boolean
  } = $props()
  let failed = $state('')
</script>

<span class="voice-avatar-image" style={`--avatar-size:${typeof size === 'number' ? `${size}px` : size}`}
  aria-hidden={decorative ? true : undefined} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : name || tr('Głos')}
  data-avatar-kind={portraitSrc && portraitSrc !== failed ? 'portrait' : 'orb'}>
  {#if portraitSrc && portraitSrc !== failed}<img src={portraitSrc} alt="" decoding="async" onerror={() => failed = portraitSrc || ''}/>
  {:else}<VoiceOrb {voiceId} {size} animated={false}/>{/if}
</span>

<style>
  .voice-avatar-image{display:inline-flex;width:var(--avatar-size);height:var(--avatar-size);flex-shrink:0;border-radius:50%;overflow:hidden;vertical-align:middle}.voice-avatar-image img{display:block;width:100%;height:100%;object-fit:cover}
</style>
