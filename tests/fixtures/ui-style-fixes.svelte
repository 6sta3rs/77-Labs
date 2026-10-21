<script lang="ts">
  import EngineCatalog from '../../src/lib/models/EngineCatalog.svelte'
  import {applyAppearance, defaultAppearance} from '../../src/lib/settings/appearance'
  import {onMount} from 'svelte'
  onMount(() => applyAppearance({...defaultAppearance}))
</script>

<main class="qa-workspace">
  <p role="note">Kontrola interfejsu. Dane przykładowe, brak dostępu do prawdziwego silnika.</p>
  <EngineCatalog ready requestedLicenseRepos={['qa/model-one','qa/model-two']} onchange={async()=>{}}/>
</main>

<style>
  .qa-workspace{max-width:1000px;padding:24px;margin:auto}
  .qa-workspace>p{font-size:var(--ui-text-12);margin-bottom:20px;color:var(--muted)}
</style>
