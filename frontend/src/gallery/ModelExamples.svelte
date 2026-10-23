<script lang="ts">
  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import ModelTrigger from '../ui/ModelTrigger.svelte'
  import ModelIcon from '../ui/ModelIcon.svelte'
  import ModelPicker from '../models/ModelPicker.svelte'
  import type { ModelPickerItem } from '../models/model-picker'
  let selected = $state('omnivoice'), panel = $state(false), dialog = $state(false), notice = $state('')
  const models: ModelPickerItem[] = [
    { id:'omnivoice', name:'OmniVoice',description:'Przykład modelu do narracji z klonowaniem głosu.',languages:['Polski','English','Deutsch','Español'],installed:true,available:true,tags:['Narracja','Klonowanie'] },
    { id:'example-local',name:'Model lokalny — przykład',brand:'L',description:'Drugi zainstalowany silnik w demonstracyjnym katalogu.',languages:['Polski','English'],installed:true,available:true,tags:['Lokalnie'] },
    { id:'example-gpu',name:'Model GPU — przykład',brand:'G',description:'Przykład zainstalowanego silnika, który nie może teraz pracować.',languages:['English'],installed:true,available:false,reason:'Przykładowy powód: brak zgodnego urządzenia GPU.' },
    { id:'example-missing',name:'Model niezainstalowany — przykład',description:'Pozycja wyłącznie do pokazania stanu niedostępności.',languages:['Polski'],installed:false,available:false,reason:'Model nie jest zainstalowany. Wybór nie uruchamia pobierania.' },
  ]
  const active = $derived(models.find(model=>model.id===selected)!)
  async function choose(id: string) { selected=id;notice=tr("Wybrano w podglądzie: {name}.", { name: tr(models.find(model=>model.id===id)?.name ?? "") }) }
</script>
<section class="model-example" id="control-16">
  <header><span>16</span><h2>{tr("Wybór modeli")}</h2><code>{tr("ModelTrigger / ModelPicker")}</code></header>
  <p>{tr("Przykładowy katalog pokazuje działanie komponentów. W Studio te same kontrolki odczytują lokalne silniki.")}</p>
  <div class="verified-icons" aria-label={tr("Oryginalne znaki modeli i wydawców")}>{#each [{id:'omnivoice',name:'OmniVoice · k2-fsa'},{id:'voxcpm2',name:'VoxCPM'},{id:'moss-tts-nano',name:'OpenMOSS'},{id:'pockettts',name:'PocketTTS'}] as model}<span><ModelIcon id={model.id} size={32}/>{model.name}</span>{/each}</div>
  <div class="examples-layout"><div>
    <ModelTrigger name={active.name} modelId={active.id} brand={active.brand} expanded={panel} active={panel} onclick={()=>panel=!panel}/>
    <p class="selection-copy">{tr("Wybrany:")} <strong>{active.name}</strong></p>
    <ModelTrigger label={tr("Przeglądarka modeli")} name="Otwórz pełne okno" popup="dialog" expanded={dialog} onclick={()=>dialog=true}/>
    <p class="hint">{tr("Sprawdź wyszukiwanie, filtry dostępności i języka, listę/karty oraz pozycje wyłączone.")}</p>
    <p role="status">{tr(notice)}</p>
  </div><div class="picker-example">{#if panel}<ModelPicker {models} selectedId={selected} onselect={choose} onclose={()=>panel=false}/>{:else}<div class="picker-placeholder">{tr("Kliknij nazwę modelu, aby otworzyć panel wyboru.")}</div>{/if}</div></div>
</section>
{#if dialog}<ModelPicker {models} mode="dialog" selectedId={selected} onselect={choose} onclose={()=>dialog=false}/>{/if}
<style>
  .verified-icons{display:flex;flex-wrap:wrap;gap:12px 24px;margin-bottom:24px}.verified-icons>span{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:var(--ui-text-11)}
  .model-example{grid-column:1/-1;min-width:0;padding:23px;border:1px solid var(--border);border-radius:12px;scroll-margin-top:18px}header{display:flex;align-items:center;gap:10px;margin-bottom:20px}header>span{color:var(--muted);font-size:var(--ui-text-10)}h2{font-size:var(--ui-text-14);font-weight:550}code{margin-left:auto;font-size:var(--ui-text-10);color:var(--muted)}p{font-size:var(--ui-text-12);line-height:1.8;color:var(--muted);margin:0 0 18px}.examples-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:26px;align-items:start}.selection-copy{margin:12px 0 24px}.hint{margin-top:14px}.picker-example{min-width:0;border:1px solid var(--border);border-radius:10px;padding:16px;background:var(--background)}.picker-placeholder{min-height:110px;display:grid;place-items:center;text-align:center;color:var(--muted);font-size:var(--ui-text-12);padding:22px;line-height:1.8}@media(max-width:700px){.model-example{padding:18px}.examples-layout{grid-template-columns:1fr}code{font-size:var(--ui-text-9)}}
</style>
