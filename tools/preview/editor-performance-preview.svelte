<script lang="ts">
  import { onMount, tick } from 'svelte';
  import SpeechEditor from '../../src/lib/tts/SpeechEditor.svelte';
  import type { SpeechBlock } from '../../src/lib/tts/tags';
  let blocks = $state<SpeechBlock[]>([{ id: 'editor-qa-0', voiceId: 'qa-voice', text: 'Początkowa narracja.' }]);
  let disabled = $state(false);
  let editor: SpeechEditor;
  let report = $state('');
  let checking = $state(false);
  async function runCheck() {
    checking = true;
    try {
      const { runEditorPerformanceCheck } = await import('../../tests/frontend/editor-performance-check.js');
      report = JSON.stringify(await runEditorPerformanceCheck(), null, 2);
    } finally { checking = false; }
  }
  const voices = [{ id: 'qa-voice', name: 'Test edytora' }, { id: 'qa-other', name: 'Drugi głos testowy' }];
  onMount(() => {
    const harness = {
      async replace(value: SpeechBlock[]) { blocks = value; await tick(); },
      async disable(value: boolean) { disabled = value; await tick(); },
      read: () => blocks.map(block => ({ ...block })),
      editor: () => editor,
      tick,
    };
    Object.assign(window, { __editorPerformanceHarness: harness });
    return () => { delete (window as unknown as Record<string, unknown>).__editorPerformanceHarness; };
  });
</script>
<main><h1>Odizolowana kontrola rzeczywistego edytora</h1><p>Bez App, localStorage, IndexedDB i silnika.</p><button onclick={runCheck} disabled={checking}>Uruchom kontrolę edytora</button><pre data-testid="editor-report">{report}</pre><SpeechEditor bind:this={editor} {blocks} {voices} {disabled} onblockschange={value => blocks = value} onchoosevoice={() => {}}/></main>
<style>:global(body){font-family:system-ui;background:#161616;color:#eee;--foreground:#eee;--muted:#aaa;--border:#444;--surface:#222;--accent:#a88add;--focus:#a88add;--tag:#c682e9}main{max-width:800px;margin:auto;padding:24px}h1{font-size:18px}</style>
