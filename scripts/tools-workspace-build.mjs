import { build } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Bieżący App i komponenty produkcyjne. Zmieniony jest wyłącznie ekran startowy
// w izolowanej wersji QA, aby nie uruchamiać grafiki WebGL pulpitu podczas testów.
await build({
  configFile: false,
  plugins: [{
    name: 'tools-qa-start-page', enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/App.svelte')) return
      const original = "let page=$state<Page>('dashboard');"
      if (!source.includes(original)) throw new Error('Zmienił się punkt wejścia App. Zaktualizuj izolowany harness QA.')
      return source.replace(original, "let page=$state<Page>((['audiobooks','dubbing','conversion','batch','tools','transcription'].includes(new URLSearchParams(location.search).get('tool')||'')?new URLSearchParams(location.search).get('tool'):'dubbing') as Page);")
    },
  }, svelte()],
  build: { outDir: '.tmp/tools-workspace-dist', emptyOutDir: true },
})
