<script lang="ts">
  import Button from '../../src/lib/ui/Button.svelte'
  import { applyAppearance, defaultAppearance } from '../../src/lib/settings/appearance'
  applyAppearance(defaultAppearance)
  let actions = $state(0), submits = $state(0), files = $state(0)
  let inactive = $state(true)
</script>

<main class="button-audit">
  <h1>Odbiór wspólnego Button</h1>
  <form onsubmit={event => { event.preventDefault(); submits++ }}>
    <Button onclick={() => actions++}>Akcja</Button>
    <Button variant="outline" type="submit">Zapisz formularz</Button>
    <Button variant="ghost" disabled={inactive} onclick={() => actions++}>Niedostępna akcja</Button>
    <Button variant="outline" aria-disabled="true" onclick={() => actions++}>Zablokowane przez ARIA</Button>
  </form>
  <div class="audit-actions">
    <Button variant="outline" href="data:text/plain;charset=utf-8,Test%20wspolnego%20przycisku" download="przycisk-test.txt">Pobierz próbkę</Button>
    <Button variant="outline" href="#pobrane" disabled={inactive} onclick={() => actions++}>Niedostępny link</Button>
    <Button variant="outline" as="label">Importuj plik<input aria-label="Plik testowy" type="file" onchange={() => files++}/></Button>
    <Button variant="ghost" size="icon" aria-label="Przycisk ikonowy">⋯</Button>
    <Button variant="ghost" size="icon-xs" aria-label="Mały przycisk ikonowy">⋯</Button>
    <Button variant="outline" onclick={() => inactive = !inactive}>Przełącz dostępność</Button>
  </div>
  <output aria-live="polite" data-actions={actions} data-submits={submits} data-files={files}>Akcje: {actions}, zapis: {submits}, pliki: {files}</output>
  <div id="pobrane">Cel linku</div>
</main>

<style>
  .button-audit{max-width:760px;padding:24px;margin:auto;font-family:var(--font-ui)}h1{font-size:18px;margin-bottom:20px}form,.audit-actions{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:24px}.audit-actions :global(input[type=file]){position:absolute;width:1px;height:1px;opacity:0}output{display:block;margin-bottom:20px}
</style>
