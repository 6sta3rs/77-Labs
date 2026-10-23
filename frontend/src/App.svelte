<script lang="ts">
  function uiOptions<T extends { label: string }>(items: readonly T[]): T[] { return items.map(item => ({ ...item, label: tr(item.label) })); }

  import { uiLanguage, createUiTranslator } from "./i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import Button from './ui/Button.svelte';
  import { mountModal, visibleFocusTarget } from './ui/overlay';
  import { onMount, tick } from 'svelte';
  import { AudioLines, BookOpen, Check, ChevronDown, ChevronRight, Clock3, Cpu, Download, Ellipsis, FileText, Film, Folder, Globe2, LoaderCircle, Mic2, Palette, PanelLeft, Plus, Search, Settings2, SlidersHorizontal, Smile, Sparkles, Square, Upload, X, RotateCcw, Play, Pause, Copy, ArrowUpRight, Undo2 } from '@lucide/svelte';
  import SpeechEditor from './tts/SpeechEditor.svelte';
  import VoicePicker from './voices/VoicePicker.svelte';
  import { engineCatalogSnapshot, markEngineConfirmed, unmarkEngineConfirmed } from './models/engine-catalog-state';
  import NavigationSidebar from './shell/NavigationSidebar.svelte';
  import Dashboard from './shell/Dashboard.svelte';
  import ShellTopbar from './shell/ShellTopbar.svelte';
  import DownloadIndicator from './models/DownloadIndicator.svelte';
  import { probeDownloads } from './models/download-monitor';
  import './shell/shell.css';
  import SettingsShell from './settings/SettingsShell.svelte';
  import GeneralPage from './settings/pages/GeneralPage.svelte';
  import AppearancePage from './settings/pages/AppearancePage.svelte';
  import DictionaryPage from './settings/pages/DictionaryPage.svelte';
  import ShortcutsPage from './settings/pages/ShortcutsPage.svelte';
  import UpdatesPage from './settings/pages/UpdatesPage.svelte';
  import EnginePage from './settings/pages/EnginePage.svelte';
  import ModelsPage from './settings/pages/ModelsPage.svelte';
  import NetworkPage from './settings/pages/NetworkPage.svelte';
  import IntegrationsPage from './settings/pages/IntegrationsPage.svelte';
  import AiPage from './settings/pages/AiPage.svelte';
  import StoragePage from './settings/pages/StoragePage.svelte';
  import PrivacyPage from './settings/pages/PrivacyPage.svelte';
  import Toaster from './ui/Toaster.svelte';
  import ConfirmDialog from './ui/ConfirmDialog.svelte';
  import { toast } from './ui/toast';
  import { userMessage } from './platform/user-message';
  import EngineStartup from './platform/EngineStartup.svelte';
  import type { SettingsSection } from './shell/navigation';
  import './shell/navigation-layout.css';
  import Player from './playback/Player.svelte';
  import VoiceAvatar from './ui/VoiceAvatar.svelte';
  import { VoicePortraits } from './voices/voice-portraits';
  import { idlePlaybackState, type PlaybackState } from './playback/playback-state';
  import VoiceOrb from './playback/VoiceOrb.svelte';
  import { playbackVoiceId } from './playback/playback-visual';
  import { quietActivity, type PlaybackActivity } from './playback/playback-meter';
  import './playback/voice-orb.css';
  import GenerationCard from './tts/GenerationCard.svelte';
  import InspectorSection from './tts/InspectorSection.svelte';
  import GenerationHistory from './projects/GenerationHistory.svelte';
  import './tts/tts-inspector.css';
  import './tts/ai.css';
  import { enhanceDialogue } from './tts/ai';
  import { validateTaggedTexts } from './tts/ai-validation';
  import ProductionWorkspace from './tools/production/ProductionWorkspace.svelte';
  import StoriesWorkspace from './tools/stories/StoriesWorkspace.svelte';
  import TranscriptionWorkspace from './tools/transcription/TranscriptionWorkspace.svelte';
  import DictationWorkspace from './tools/dictation/DictationWorkspace.svelte';
  import StudioTools from './tools/StudioTools.svelte';
  import AutomationWorkspace from './tools/automation/AutomationWorkspace.svelte';
  import AudioLab from './tools/audio-lab/AudioLab.svelte';
  import ModelLicenseOnboarding from './models/ModelLicenseOnboarding.svelte';
  import { storageSettings } from './settings/storage-settings';
  import { remoteBackendState } from './platform/remote-state';
  import VoiceManager from './voices/VoiceManager.svelte';
  import VoiceCreatePage from './voices/VoiceCreatePage.svelte';
  import { profileVoiceMetadata } from './voices/voice-metadata';
  import VoiceLibraryTools from './voices/VoiceLibraryTools.svelte';
  import { engineCatalog, selectEngine, type EngineFamily } from './tools/studio-tools';
  import Select from './ui/Select.svelte';
  import Slider from './ui/Slider.svelte';
  import ActionBar from './ui/ActionBar.svelte';
  import { sheetDrag } from './ui/sheet-drag';
  import ModelTrigger from './ui/ModelTrigger.svelte';
  import ModelPicker from './models/ModelPicker.svelte';
  import AdvancedSpeechSettings from './tts/AdvancedSpeechSettings.svelte';
  import { cloneSpeechSettings, defaultSpeechSettings, preferredSpeechLanguage, readStoredSpeechSettings, resetPresetForEngine, serializeSpeechSettings, speechLanguageChoices, speechLanguageLabel, type SpeechSettings } from './tts/speech-settings';
  import { assertModelLicenseResponse, requiredLicenseRepos } from './models/model-licenses';
  import { productionJson } from './tools/production/production';
  import type { IntegrationState } from './platform/integrations';
  import { normalizeTtsModels } from './models/model-picker';
  import { loadAppearance, applyAppearance, saveAppearance, defaultAppearance, type AppearanceSettings } from './settings/appearance';
  import { voices as previewVoices, durationLabel, type Voice, type Render, type Page, type Project } from './data';
  import { autoTagText, type SpeechBlock } from './tts/tags';
  import { audioPeaks, loadRecordings, saveRecording } from './projects/library';
  import { joinSpeechWave } from './playback/audio';
  import * as api from './platform/api';
  import { getRuntimeStatus, ensureRuntime, stopRuntime, readEngineAutostart, isDesktop as detectDesktop } from './platform/runtime';

  const demoMode=new URLSearchParams(location.search).get('demo')==='tts'&&!detectDesktop();
  const isDesktop=detectDesktop();
  let demoAudio=$state<Render>();
  const portraits = new VoicePortraits(); let voiceRefreshSequence = 0;
  let playbackState=$state<PlaybackState>(idlePlaybackState());
  let generatingPreview=$state<Render>();
  let playbackActivity=$state.raw<PlaybackActivity>(quietActivity());
  let voicePreviewBusy=$state(false);let voicePreviewId=$state('');let voicePreviewUrl='';let voicePreviewController:AbortController|undefined;
  let page=$state<Page>('dashboard');
  let requestedLicenseRepo=$state<string>();
  let requestedLicenseRepos=$state<string[]>([]);
  onMount(()=>{const required=(event:Event)=>{const repos=requiredLicenseRepos((event as CustomEvent<{models?:unknown}>).detail?.models);requestedLicenseRepos=repos;requestedLicenseRepo=repos[0];void showModels();};window.addEventListener('studio:model-license-required',required);return()=>window.removeEventListener('studio:model-license-required',required);});
  let navigationTrail=$state<Page[]>([]);let refreshing=$state(false);
  function goToPage(next:Page){if(next!==page){flushProjectSave();navigationTrail=[...navigationTrail.slice(-19),page];page=next;}}
  function backPage(){flushProjectSave();const previous=navigationTrail.at(-1)||'dashboard';navigationTrail=navigationTrail.slice(0,-1);page=previous;}
  function openVoiceCreate(){cancelVoicePreview();modal=null;settingsOpen=false;goToPage('voice-create');}
  function openLinkedVoice(){const id=new URLSearchParams(location.search).get('voice');if(id&&!linkedVoiceOpened&&voices.some(voice=>voice.id===id)){linkedVoiceOpened=true;linkedVoiceId=id;voiceBlockId=blocks[0]?.id||'';modal='voices';}}
  let linkedVoiceId=$state('');let linkedVoiceOpened=false;
  onMount(()=>{window.addEventListener('studio:create-voice',openVoiceCreate);return()=>window.removeEventListener('studio:create-voice',openVoiceCreate)});
  function openSearch(){query='';modal='search';}
  async function refreshStudio(){if(demoMode){notify('Dane przykładowe są gotowe. Odśwież stronę, aby przywrócić zestaw.');return;}if(refreshing)return;refreshing=true;try{if(isDesktop)await refreshRuntime();else{await api.health();runtime={state:'ready',message:'Lokalny silnik gotowy',port:4312,managed:false};await refreshVoices();await refreshEngine();}notify('Odświeżono stan studia.');}catch{notify('Nie można połączyć się z lokalnym silnikiem.');}finally{refreshing=false;}}
  function checkAppUpdates(){openSettings('updates','check');}
  let settingsOpen=$state(false);let settingsSection=$state<SettingsSection>('general');let settingsIntent=$state('');let settingsReturnFocus:HTMLElement|null=null;
  function openSettings(section?:SettingsSection,intent=''){flushProjectSave();if(!settingsOpen)settingsReturnFocus=document.activeElement as HTMLElement;settingsSection=section||settingsSection;settingsIntent=intent;settingsOpen=true;}
  const goSettings=(section:string,intent='')=>openSettings(section as SettingsSection,intent);
  function closeSettings(){settingsOpen=false;void tick().then(()=>{const target=settingsReturnFocus?.isConnected?settingsReturnFocus:document.querySelector<HTMLElement>('.settings-trigger');target?.focus();});}
  function navigate(next:Page){if(next==='pronunciation'){openSettings('dictionary');return;}if(next==='models'||next==='appearance'||next==='ai-settings'){if(next==='models')void showModels();else openSettings(next==='ai-settings'?'ai':next);}else{goToPage(next);settingsOpen=false;}}
  let tagging=$state(false); let aiResultMarker=$state('');
  let aiController:AbortController|undefined;
  let appearance=$state<AppearanceSettings>({...defaultAppearance});
  let sidebar=$state(true); let inspector=$state(false); let panelTab=$state('settings');let showVoicePreview=$state(false); let advanced=$state(false);
  let voices=$state<Voice[]>([...previewVoices]);
  let blocks=$state<SpeechBlock[]>([{id:crypto.randomUUID(),voiceId:previewVoices[0].id,text:''}]);
  let projects=$state<Project[]>([]);let projectId=$state<string>(crypto.randomUUID());let projectName=$state('Nowa narracja');
  let history=$state<Render[]>([]);let recording=$state<Render>();let running=$state(false);let generationStage=$state('');
  let language=$state('Polish');let speed=$state(1);let steps=$state(16);let seed=$state('');let effect=$state('raw');let speechSettings=$state(defaultSpeechSettings());
  let modal=$state<'voices'|'search'|'project'|null>(null);let voiceBlockId=$state('');let query=$state('');let voiceFilter=$state('all');
  let loaded=$state(false);
  let speechEditor=$state<SpeechEditor>();let player=$state<Player>();let audioInput:HTMLInputElement;let textInput:HTMLInputElement;
  let runtime=$state<{state:string;message:string;port:number;managed:boolean;dataDir?:string}>({state:'stopped',message:'Uruchamianie lokalnego silnika…',port:4312,managed:true});
  let runtimeBusy=$state(false);let controller:AbortController|undefined;
  let ttsFamily=$state<EngineFamily>();
  let generationCapabilities=$state({wav_bits:[] as string[],preset_voice:false,design_recipe:false});
  const voiceModelFamily=$derived(demoMode?ttsFamily:$engineCatalogSnapshot?.catalog.tts||ttsFamily);
  const voiceModel=$derived(voiceModelFamily?.backends.find(row=>row.id===voiceModelFamily?.active));
  let choosingModel=$state(false), modelLoading=$state(false), modelError=$state('');
  let engineCatalogEpoch=0, modelLoadEpoch=0, modelRequestsDisposed=false;
  let engineCatalogController:AbortController|undefined, modelSelectionController:AbortController|undefined;
  let modelSelectionPending:Promise<void>|undefined;
  const ttsModelItems=$derived(normalizeTtsModels(ttsFamily));
  let generationEngine=$derived(ttsFamily?.active || '');
  const generationBackend=$derived(ttsFamily?.backends.find(row=>row.id===generationEngine));
  let generationLanguages=$derived(speechLanguageChoices(ttsFamily?.backends.find(row=>row.id===generationEngine)?.supported_language_names || ['Auto','Polish','English']));
  const effectNames:Record<string,string>={raw:'Bez efektów',podcast:'Podcast',warm:'Ciepłe',broadcast:'Radiowe',cinematic:'Filmowe',bright:'Jasne'};
  async function copyVoiceId(){try{await navigator.clipboard.writeText(primaryVoice.id);notify('Skopiowano ID głosu.');}catch{notify('Nie udało się skopiować ID głosu.');}}
  let projectDraftName=$state('');
  const pageNames:Record<Page,string>={dashboard:'Pulpit',studio:'Tekst na mowę',voices:'Głosy','voice-create':'Dodaj głos',projects:'Projekty',history:'Nagrania',transcription:'Mowa na tekst',dictation:'Dyktowanie na żywo',models:'Modele',appearance:'Wygląd','ai-settings':'AI i klucze',dubbing:'Dubbing',audiobooks:'Audiobooki',stories:'Historie',pronunciation:'Słownik wymowy',batch:'Kolejka dubbingu',conversion:'Konwersja głosu',automation:'Automatyzacja',tools:'Narzędzia audio','audio-lab':'Obróbka audio','engine-history':'Historia silnika'};
  const mainNav=[{id:'studio' as Page,label:'Tekst na mowę',icon:AudioLines},{id:'voices' as Page,label:'Głosy',icon:Mic2},{id:'projects' as Page,label:'Projekty',icon:Folder}];
  const toolNav=[{id:'dubbing' as Page,label:'Dubbing',icon:Film},{id:'audiobooks' as Page,label:'Audiobooki',icon:BookOpen},{id:'stories' as Page,label:'Historie',icon:BookOpen},{id:'dictation' as Page,label:'Dyktowanie na żywo',icon:Mic2},{id:'transcription' as Page,label:'Mowa na tekst',icon:FileText},{id:'history' as Page,label:'Nagrania',icon:Clock3},{id:'engine-history' as Page,label:'Historia silnika',icon:Clock3},{id:'voice-create' as Page,label:'Klonowanie głosu',icon:Mic2},{id:'conversion' as Page,label:'Konwersja głosu',icon:Mic2},{id:'batch' as Page,label:'Kolejka dubbingu',icon:Film},{id:'pronunciation' as Page,label:'Słownik wymowy',icon:BookOpen},{id:'automation' as Page,label:'Automatyzacja',icon:SlidersHorizontal},{id:'tools' as Page,label:'Narzędzia audio',icon:SlidersHorizontal},{id:'audio-lab' as Page,label:'Obróbka audio',icon:AudioLines}];
  let totalText=$derived(blocks.map(block=>block.text).join('\n\n'));
  let charCount=$derived(totalText.length);
  let canUndoAI=$derived(aiResultMarker!=='' && aiResultMarker===`${projectId}:${JSON.stringify(blocks)}`);
  let primaryVoice=$derived(voices.find(voice=>voice.id===blocks[0]?.voiceId)||voices[0]);
  const generationUsesPreset=$derived(generationCapabilities.preset_voice && !!speechSettings.preset_voice && !!generationBackend?.preset_voices?.includes(speechSettings.preset_voice));
  const generationContext=$derived({hasReference:!generationUsesPreset && generationBackend?.supports_cloning!==false && primaryVoice.kind==='Klonowany',supportsWavBits:generationCapabilities.wav_bits.includes('16')&&generationCapabilities.wav_bits.includes('24')&&generationCapabilities.wav_bits.includes('32'),supportsPresetVoice:generationCapabilities.preset_voice,supportsDesignRecipe:generationCapabilities.design_recipe});
  const activeOrbVoiceId=$derived(playbackVoiceId(recording,primaryVoice.id));
  let primaryOrbPlaying=$derived(playbackActivity.playing);
  let primaryPlaybackLabel=$derived(recording?.url ? tr(playbackActivity.playing?'Wstrzymaj nagranie {title}':'Odtwórz nagranie {title}',{title:recording.title}) : tr('Odtwórz próbkę głosu {name}',{name:primaryVoice.name}));
  let filteredVoices=$derived(voices.filter(voice=>`${voice.name} ${voice.description}`.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl'))&&(voiceFilter==='all'||voice.kind===voiceFilter)));
  let canGenerate=$derived(totalText.trim().length>0&&charCount<=10000&&!running&&!tagging);
  let generateHint=$derived(canGenerate?'':tagging?'Trwa tagowanie tekstu — poczekaj na zakończenie.':!totalText.trim()?'Wpisz tekst, aby wygenerować mowę.':charCount>10000?'Tekst przekracza limit 10 000 znaków — skróć go.':'');
  let currentRecordings=$derived(history.filter(item=>item.projectId===projectId||(!item.projectId&&item.blocks?.some(block=>blocks.some(current=>current.id===block.id)))).slice(0,4));

  function notify(message:string,kind:'info'|'bad'='info'){toast[kind](tr(message));}
  function changeAppearance(value:AppearanceSettings){appearance=value;applyAppearance(value);saveAppearance(value);}
  let projectSaveTimer:ReturnType<typeof setTimeout>|undefined;
  let projectSaveDeadline:ReturnType<typeof setTimeout>|undefined;
  function persistProject(){
    clearTimeout(projectSaveTimer);clearTimeout(projectSaveDeadline);
    projectSaveTimer=undefined;projectSaveDeadline=undefined;
    if(!loaded)return;
    const project:Project={id:projectId,name:projectName,updated:new Date().toISOString(),blocks:blocks.map(block=>({...block})),speechSettings:cloneSpeechSettings(speechSettings),generationEngine};
    projects=[project,...projects.filter(item=>item.id!==projectId)];
    if(demoMode)return;
    try{localStorage.setItem('voicestudio.projects.v2',JSON.stringify(projects));localStorage.setItem('voicestudio.activeProject.v2',projectId);}catch{notify('Nie udało się zapisać szkicu. Możesz wyeksportować tekst.');}
  }
  // Zapis biblioteki jest synchroniczny. Łącz serię zmian, ale zapisuj również
  // podczas ciągłego pisania oraz przed opuszczeniem dokumentu/okna.
  function flushProjectSave(){if(projectSaveTimer!==undefined)persistProject();}
  function scheduleProjectSave(){clearTimeout(projectSaveTimer);projectSaveTimer=setTimeout(persistProject,250);projectSaveDeadline??=setTimeout(persistProject,1500);}
  function changeBlocks(value:SpeechBlock[]){blocks=value;scheduleProjectSave();}
  function changeSpeechSettings(value:SpeechSettings){speechSettings=value;scheduleProjectSave();}
  function openProject(project:Project){persistProject();const saved=projects.find(item=>item.id===project.id)||project;projectId=saved.id;projectName=saved.name;blocks=saved.blocks.map(block=>({...block}));speechSettings=readStoredSpeechSettings(saved.speechSettings);goToPage('studio');if(saved.generationEngine&&generationEngine&&saved.generationEngine!==generationEngine)notify(`Projekt używał silnika ${saved.generationEngine}. Bieżący silnik pozostaje wybrany; sprawdź jego głos i ustawienia przed generowaniem.`);if(demoMode)return;try{localStorage.setItem('voicestudio.activeProject.v2',projectId);}catch{}}
  function newProject(){if(running){notify('Poczekaj na zakończenie generowania.');return;}persistProject();projectId=crypto.randomUUID();projectName='Nowa narracja';blocks=[{id:crypto.randomUUID(),voiceId:voices[0].id,text:''}];speechSettings=resetPresetForEngine(defaultSpeechSettings(),generationBackend,generationCapabilities.preset_voice);goToPage('studio');persistProject();}
  function chooseVoice(voice:Voice){cancelVoicePreview();linkedVoiceId='';const id=voiceBlockId||blocks[0]?.id;changeBlocks(blocks.map(block=>block.id===id?{...block,voiceId:voice.id}:block));modal=null;query='';voiceFilter='all';}
  async function refreshVoices(){
    const sequence=++voiceRefreshSequence;
    const profiles=await api.profiles();
    if(sequence!==voiceRefreshSequence)return;
    const images=await portraits.load(profiles);
    if(sequence!==voiceRefreshSequence)return;
    const actual=profiles.map((profile,index)=>({id:profile.id,name:profile.name,portraitSrc:images.get(profile.id),initials:profile.name.slice(0,1).toUpperCase(),description:profile.description||'Zapisany lokalnie',language:profile.language||'Auto',color:['peach','purple','blue'][index%3],kind:profile.kind==='design'?'Projektowany':'Klonowany',demo:false,inLibrary:true,...profileVoiceMetadata(profile)}));
    voices=actual.length?actual:[...previewVoices];openLinkedVoice();
    if(actual[0]&&blocks.some(block=>!voices.some(voice=>voice.id===block.voiceId)))changeBlocks(blocks.map(block=>voices.some(voice=>voice.id===block.voiceId)?block:{...block,voiceId:actual[0].id}));
  }
  async function readEngineFamily():Promise<{family:EngineFamily;epoch:number;capabilities:typeof generationCapabilities}|undefined>{
    if(modelRequestsDisposed)return;
    engineCatalogController?.abort();
    const controller=new AbortController();engineCatalogController=controller;
    const epoch=++engineCatalogEpoch;
    try{
      const [catalog,integrations]=await Promise.all([engineCatalog(controller.signal),productionJson<IntegrationState>('/next/integrations/settings',{signal:controller.signal}).catch(()=>undefined)]);
      controller.signal.throwIfAborted();
      if(modelRequestsDisposed||epoch!==engineCatalogEpoch)return;
      const source=integrations?.source.generateCapabilities;
      return {family:catalog.tts,epoch,capabilities:{wav_bits:Array.isArray(source?.wav_bits)?source.wav_bits.filter(value=>['16','24','32'].includes(value)):[],preset_voice:source?.preset_voice===true,design_recipe:source?.design_recipe===true}};
    }finally{if(engineCatalogController===controller)engineCatalogController=undefined;}
  }
  function disposeModelRequests(){modelRequestsDisposed=true;engineCatalogEpoch++;modelLoadEpoch++;engineCatalogController?.abort();modelSelectionController?.abort();}
  async function refreshEngine(){
    if(modelRequestsDisposed)return;
    // Selecting an engine owns its confirmation read. A background refresh must
    // not supersede it with a snapshot taken before the write has completed.
    if(modelSelectionPending){await modelSelectionPending.catch(()=>{});return;}
    try{
      const snapshot=await readEngineFamily();
      if(!snapshot||modelRequestsDisposed||snapshot.epoch!==engineCatalogEpoch)return;
      ttsFamily=snapshot.family;
      generationCapabilities=snapshot.capabilities;
      speechSettings=resetPresetForEngine(speechSettings,generationBackend,generationCapabilities.preset_voice);
      language=preferredSpeechLanguage(generationLanguages,language);
    }catch(error){if(!modelRequestsDisposed&&(error as Error).name!=='AbortError')notify(userMessage(error,'Operacja nie powiodła się.'),'bad');}
  }
  async function refreshRuntime(){
    try{const previous=runtime.state;runtime=await getRuntimeStatus();if(runtime.state==='ready'&&previous!=='ready'){void probeDownloads();await refreshVoices();await refreshEngine();}}
    catch(error){runtime={state:'error',message:userMessage(error,'Nie udało się uruchomić silnika.'),port:4312,managed:true};}
  }
  async function bootRuntime(){if(demoMode){notify('Tryb demonstracyjny nie uruchamia silnika.');return;}runtimeBusy=true;try{await ensureRuntime();runtime=await getRuntimeStatus();if(runtime.state==='ready'){void probeDownloads();await refreshVoices();await refreshEngine();}}catch(error){notify(userMessage(error,'Operacja nie powiodła się.'),'bad');}finally{runtimeBusy=false;}}
  async function endRuntime(){if(demoMode)return;if(running){notify('Zakończ generowanie przed zatrzymaniem silnika.');return;}runtimeBusy=true;try{runtime=await stopRuntime();}catch(error){notify(userMessage(error,'Operacja nie powiodła się.'),'bad');}finally{runtimeBusy=false;}}
  async function restartRuntime(){if(running)throw new Error('Zakończ generowanie przed restartem silnika.');runtimeBusy=true;try{runtime=await stopRuntime();if(runtime.state!=='stopped')throw new Error(runtime.message||'Nie zatrzymano silnika. Spróbuj ponownie po zakończeniu bieżącej operacji.');await ensureRuntime();runtime=await getRuntimeStatus();await refreshVoices();await refreshEngine();}finally{runtimeBusy=false;}}
  async function storeAudio(row:Render){cancelVoicePreview();history=[row,...history];recording=row;if(demoMode)return;try{let retentionCap:number|undefined;if(row.source==='generation'){try{retentionCap=(await storageSettings.retention(AbortSignal.timeout(4000))).cap;}catch{notify('Nie odczytano limitu historii. Zachowano wszystkie lokalne nagrania.');}}const removed=await saveRecording(row,retentionCap);if(removed.length){const ids=new Set(removed);for(const item of history)if(ids.has(item.id)&&item.url)URL.revokeObjectURL(item.url);history=history.filter(item=>!ids.has(item.id));}}catch{notify('Nagranie jest gotowe, ale lokalny zapis nie powiódł się. Pobierz plik, aby go zachować.');}}
  async function generate(){
    if(!canGenerate)return;
    if(demoMode){
      if(!demoAudio){notify('Trwa przygotowanie przykładowego audio.');return;}
      const row:Render={...demoAudio,id:crypto.randomUUID(),projectId,title:projectName+' · przykład',text:totalText,blocks:blocks.map(block=>({...block})),modelId:generationEngine,modelName:ttsFamily?.backends.find(row=>row.id===generationEngine)?.display_name,created:new Date().toISOString()};
      await storeAudio(row);notify('Dodano przykład UI. WAV jest stałą próbką, niezależną od tekstu i wybranego głosu.');return;
    }
    if(isDesktop&&(runtime.state!=='ready'||!generationEngine)){
      running=true;generationStage='Uruchamianie silnika…';controller=new AbortController();
      try{await ensureRuntime(controller.signal);runtime=await getRuntimeStatus();await refreshVoices();await refreshEngine();}
      catch(error){if((error as Error).name!=='AbortError')notify(userMessage(error,'Operacja nie powiodła się.'),'bad');return;}
      finally{running=false;generationStage='';}
    }
    if(runtime.state!=='ready'){notify('To podgląd interfejsu. Synteza działa w aplikacji Windows z własnym silnikiem.');return;}
    if(!generationEngine){notify('Katalog silników nie został jeszcze wczytany. Otwórz Silnik, aby odświeżyć stan.');return;}
    const usesSavedVoice=!generationUsesPreset && generationBackend?.supports_cloning!==false;
    const speechSnapshot=cloneSpeechSettings(speechSettings);
    let parameters:Record<string,string>;
    try{parameters=serializeSpeechSettings(speechSnapshot,generationBackend,{...generationContext,hasReference:usesSavedVoice&&blocks.every(block=>voices.find(voice=>voice.id===block.voiceId)?.kind==='Klonowany')});}catch(error){notify(userMessage(error,'Operacja nie powiodła się.'),'bad');return;}
    const effectiveSpeech=cloneSpeechSettings({...speechSnapshot,wav_bits:parameters.wav_bits as SpeechSettings['wav_bits']||'16',preset_voice:parameters.preset_voice,design_recipe:parameters.design_recipe?JSON.parse(parameters.design_recipe):undefined});
    const generationSettings={engine:generationEngine,language,speed,steps,seed,effect,parameters};
    const generationModelName=ttsFamily?.backends.find(row=>row.id===generationSettings.engine)?.display_name||generationSettings.engine;
    const snapshot=blocks.filter(block=>block.text.trim()).map(block=>({...block}));
    if(usesSavedVoice&&snapshot.some(block=>!voices.find(voice=>voice.id===block.voiceId&&!voice.demo))){notify('Wybierz zapisany głos. Przykładowe karty służą wyłącznie do podglądu.');return;}
    if(seed.trim()&&!/^-?\d+$/.test(seed.trim())){notify('Ziarno musi być liczbą całkowitą.');return;}
    running=true;controller=new AbortController();
    const title=projectName;const renderProjectId=projectId;
    generatingPreview={id:'pending-generation',title,projectId:renderProjectId,text:'',voice:voices.find(voice=>voice.id===snapshot[0].voiceId)?.name||'',created:new Date().toISOString(),kind:'audio',blocks:snapshot};
    try{
      const outputs:Blob[]=[];let duration=0;
      for(const [index,block] of snapshot.entries()){
        generationStage=snapshot.length>1?`Mówca ${index+1} z ${snapshot.length}`:'Generowanie…';
        const result=await api.generate({text:block.text,profileId:usesSavedVoice?block.voiceId:'',...generationSettings},controller.signal).catch(error=>{if((error as Error).name!=='AbortError')unmarkEngineConfirmed(generationSettings.engine);throw error;});markEngineConfirmed(generationSettings.engine);
        outputs.push(result.blob);duration+=result.duration||0;
      }
      generationStage='Łączenie nagrań…';
      const joined=await joinSpeechWave(outputs,effectiveSpeech.wav_bits);const blob=joined.blob;
      controller.signal.throwIfAborted();
      duration=joined.duration;
      generationStage='Analiza audio…';const peaks=await audioPeaks(blob);
      controller.signal.throwIfAborted();
      const row:Render={id:crypto.randomUUID(),title,projectId:renderProjectId,text:snapshot.map(block=>block.text).join('\n\n'),voice:!usesSavedVoice?`${generationModelName} · ${effectiveSpeech.preset_voice||'głos silnika'}`:snapshot.length>1?`${snapshot.length} mówców`:voices.find(voice=>voice.id===snapshot[0].voiceId)!.name,created:new Date().toISOString(),kind:'audio',source:'generation',modelId:generationSettings.engine,modelName:generationModelName,voiceId:usesSavedVoice&&snapshot.length===1?snapshot[0].voiceId:undefined,blob,url:URL.createObjectURL(blob),filename:`${title.replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,70)||'narracja'}.wav`,duration:duration||undefined,peaks,blocks:snapshot,speechSettings:effectiveSpeech,wavBits:effectiveSpeech.wav_bits,presetVoice:effectiveSpeech.preset_voice,designRecipe:effectiveSpeech.design_recipe};
      generationStage='Zapisywanie nagrania…';await storeAudio(row);notify('Nagranie gotowe.');
    }catch(error){if((error as Error).name!=='AbortError')notify(userMessage(error,'Operacja nie powiodła się.'),'bad');}finally{running=false;generatingPreview=undefined;generationStage='';}
  }
  async function tagWithAI(){
    if(tagging||running||!totalText.trim())return;
    if(demoMode){changeBlocks(blocks.map(block=>({...block,text:autoTagText(block.text)})));notify('Dodano pauzy lokalną regułą demonstracyjną.');return;}
    if(generationEngine && generationEngine!=='omnivoice'){notify('Tagowanie AI obsługuje obecnie OmniVoice. Wybierz ten silnik w ustawieniach modeli.');return;}
    if(charCount>10000){notify('Tagowanie obsługuje do 10 000 znaków.');return;}
    const source=blocks.map(block=>({...block}));
    const sourceKey=`${projectId}:${JSON.stringify(source)}`;
    tagging=true;aiController=new AbortController();
    try{
      const result=await enhanceDialogue(source.map(block=>block.text),aiController.signal);
      if(page!=='studio'||`${projectId}:${JSON.stringify(blocks)}`!==sourceKey){notify('Projekt lub widok zmienił się podczas tagowania. Tekst pozostał bez zmian.');return;}
      validateTaggedTexts(source.map(block=>block.text),result.enhanced_blocks);
      const next=source.map((block,index)=>({...block,text:result.enhanced_blocks[index]}));
      if(JSON.stringify(source)===JSON.stringify(next)){notify('AI nie znalazło miejsc wymagających nowych tagów.');return;}
      speechEditor?.applyAutomaticTags(next);
      aiResultMarker=`${projectId}:${JSON.stringify(next)}`;
      notify(`Dodano tagi AI · ${result.model} · ${result.seconds.toLocaleString(tr.locale)} s.`);
    }catch(error){if((error as Error).name!=='AbortError')notify(userMessage(error,'Operacja nie powiodła się.'),'bad');}
    finally{tagging=false;aiController=undefined;}
  }
  function undoAITags(){if(canUndoAI){speechEditor?.undoAutoTag();aiResultMarker='';}}
  function keepAITags(){speechEditor?.keepAutomaticTags();aiResultMarker='';}
  function cancel(){controller?.abort();notify('Przerwano oczekiwanie. Silnik może jeszcze kończyć bieżący fragment.');}
  function cancelVoicePreview(){voicePreviewController?.abort();voicePreviewController=undefined;voicePreviewBusy=false;voicePreviewId='';}
  async function togglePrimaryPlayback(){
    if(recording?.url){cancelVoicePreview();await player?.toggle();}
    else await previewPrimaryVoice();
  }
  async function previewPrimaryVoice(){try{await previewVoice(primaryVoice);}catch(error){notify(userMessage(error,'Operacja nie powiodła się.'),'bad');}}
  async function previewVoice(voice:Voice){
    if(voicePreviewBusy&&voicePreviewId===voice.id){cancelVoicePreview();return;}
    if(recording?.id===`voice-preview-${voice.id}`){await player?.toggle();return;}
    if(demoMode){
      if(!demoAudio)throw new Error('Trwa przygotowanie próbki WAV.');
      await play({...demoAudio,id:`voice-preview-${voice.id}`,voiceId:voice.id,title:'Przykładowa próbka WAV',voice:'Próbka WAV z repozytorium'});return;
    }
    if((!isDesktop&&runtime.state!=='ready')||voice.demo)throw new Error('Wybierz zapisany głos, aby odtworzyć próbkę.');
    cancelVoicePreview();voicePreviewBusy=true;voicePreviewId=voice.id;
    const request=new AbortController();voicePreviewController=request;
    try{
      const response=await api.request(`/profiles/${encodeURIComponent(voice.id)}/audio`,{signal:request.signal});
      await assertModelLicenseResponse(response,request.signal);
      if(!response.ok)throw new Error(`Nie można wczytać próbki głosu (${response.status}).`);
      const blob=await response.blob();
      if(!blob.type.startsWith('audio/'))throw new Error('Silnik nie zwrócił próbki audio.');
      if(request.signal.aborted)return;
      if(voicePreviewUrl)URL.revokeObjectURL(voicePreviewUrl);
      voicePreviewUrl=URL.createObjectURL(blob);
      await play({id:`voice-preview-${voice.id}`,voiceId:voice.id,title:'Próbka głosu',voice:voice.name,text:'',created:new Date().toISOString(),kind:'audio',blob,url:voicePreviewUrl,filename:'probka-glosu.wav',blocks:[{id:'voice-preview',voiceId:voice.id,text:''}]});
    }catch(error){if((error as Error).name!=='AbortError')throw error;}
    finally{if(voicePreviewController===request){voicePreviewBusy=false;voicePreviewId='';voicePreviewController=undefined;}}
  }
  async function play(row:Render){cancelVoicePreview();if(recording?.id===row.id&&recording?.url===row.url){await player?.toggle();return;}recording=row;await tick();if(recording?.id===row.id&&recording?.url===row.url)await player?.play();}
  async function toggleRecordingStar(row:Render){const updated={...$state.snapshot(row),starred:!row.starred};try{if(!demoMode)await saveRecording(updated);history=history.map(item=>item.id===row.id?updated:item);if(recording?.id===row.id)recording=updated;}catch{notify('Nie zapisano gwiazdki nagrania.');}}
  async function importAudio(event:Event){const input=event.target as HTMLInputElement;const file=input.files?.[0];if(!file)return;if(!file.type.startsWith('audio/')&&!/\.(wav|mp3|m4a|ogg|flac)$/i.test(file.name)){notify('Wybierz obsługiwany plik audio.');return;}let duration:number|undefined;const peaks=await audioPeaks(file,value=>duration=value);const row:Render={id:crypto.randomUUID(),projectId,title:file.name.replace(/\.[^.]+$/,''),voice:'Wczytane nagranie',text:'',kind:'audio',source:'import',created:new Date().toISOString(),blob:file,url:URL.createObjectURL(file),filename:file.name,peaks,duration};await storeAudio(row);input.value='';}
  async function importText(event:Event){const input=event.target as HTMLInputElement;const file=input.files?.[0];if(file){changeBlocks([{id:crypto.randomUUID(),voiceId:primaryVoice.id,text:await file.text()}]);notify('Wczytano tekst.');}input.value='';}
  function downloadText(){const url=URL.createObjectURL(new Blob([totalText],{type:'text/plain;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`${projectName}.txt`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function reset(){speechSettings=resetPresetForEngine(defaultSpeechSettings(),generationBackend,generationCapabilities.preset_voice);speed=1;steps=16;seed='';effect='raw';language=preferredSpeechLanguage(generationLanguages,'Polish');scheduleProjectSave();}
  async function loadPickerModels() {
    if(demoMode)return;
    if(modelRequestsDisposed)return;
    const load=++modelLoadEpoch;
    modelLoading=true;modelError='';
    try {
      if(modelSelectionPending)await modelSelectionPending.catch(()=>{});
      if(modelRequestsDisposed||load!==modelLoadEpoch)return;
      const snapshot=await readEngineFamily();
      if(snapshot&&!modelRequestsDisposed&&load===modelLoadEpoch&&snapshot.epoch===engineCatalogEpoch){ttsFamily=snapshot.family;generationCapabilities=snapshot.capabilities;speechSettings=resetPresetForEngine(speechSettings,generationBackend,generationCapabilities.preset_voice);}
    }
    catch(error) { if(!modelRequestsDisposed&&load===modelLoadEpoch&&(error as Error).name!=='AbortError')modelError=`Nie można odczytać lokalnego katalogu. Uruchom silnik w ustawieniach. ${userMessage(error,'')}`.trim(); }
    finally { if(!modelRequestsDisposed&&load===modelLoadEpoch)modelLoading=false; }
  }
  async function openModelPicker() { choosingModel=true; await loadPickerModels(); }
  async function closeModelPicker() { choosingModel=false; await tick(); [...document.querySelectorAll<HTMLButtonElement>('.inspector .model-trigger,[data-model-dialog-return]')].find(visibleFocusTarget)?.focus({preventScroll:true}); }
  async function chooseInstalledModel(id:string) {
    if(modelRequestsDisposed)throw new DOMException('Widok został zamknięty.','AbortError');
    if(modelSelectionPending)throw new Error('Trwa już zmiana silnika. Poczekaj na jej zakończenie.');
    const model=ttsModelItems.find(item=>item.id===id);
    if(!model || (!model.available || !model.installed) && !model.canVerify) throw new Error(model?.reason || 'Ten silnik nie jest dostępny do wyboru.');
    if(demoMode){ttsFamily={...ttsFamily!,active:id,active_model:`demo/${id}`};language=preferredSpeechLanguage(generationLanguages,language);return;}
    engineCatalogController?.abort();const epoch=++engineCatalogEpoch;
    const controller=new AbortController();modelSelectionController=controller;
    const pending=(async()=>{
      const result=await selectEngine('tts',id,controller.signal);
      controller.signal.throwIfAborted();
      if(result.env_override || result.active!==id) throw new Error('Konfiguracja środowiska nie pozwoliła zmienić aktywnego silnika.');
      const catalog=await engineCatalog(controller.signal);
      controller.signal.throwIfAborted();
      if(modelRequestsDisposed||epoch!==engineCatalogEpoch)throw new DOMException('Wybór modelu został zastąpiony.','AbortError');
      if(catalog.tts.active!==id) throw new Error('Silnik nie potwierdził zmiany aktywnego modelu. Odśwież katalog.');
      ttsFamily=catalog.tts;
      speechSettings=resetPresetForEngine(speechSettings,generationBackend,generationCapabilities.preset_voice);scheduleProjectSave();
      language=preferredSpeechLanguage(generationLanguages,language);
    })();
    modelSelectionPending=pending;
    try{await pending;}finally{if(modelSelectionController===controller){modelSelectionController=undefined;modelSelectionPending=undefined;}}
  }
  function showModels(){openSettings('models');}
  function restore(row:Render){if(row.blocks)changeBlocks(row.blocks.map(block=>({...block})));else if(row.text)changeBlocks([{id:crypto.randomUUID(),voiceId:primaryVoice.id,text:row.text}]);speechSettings=readStoredSpeechSettings(row.speechSettings||{...defaultSpeechSettings(),wav_bits:row.wavBits||'16',preset_voice:row.presetVoice,design_recipe:row.designRecipe});scheduleProjectSave();goToPage('studio');if(row.modelId&&generationEngine&&row.modelId!==generationEngine)notify(`Nagranie używało silnika ${row.modelId}. Wybierz go przed ponownym renderem, aby zachować jego brzmienie.`);}
  function keys(event:KeyboardEvent){if(event.defaultPrevented)return;if(event.key==='Escape'&&modal){event.preventDefault();modal=null;return;}if(event.key==='Escape'&&inspector){event.preventDefault();inspector=false;return;}if(settingsOpen){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openSearch();}return;}if(event.key==='Escape'){modal=null;inspector=false;}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();modal=modal==='search'?null:'search';query='';}if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&!modal&&page==='studio'){event.preventDefault();void generate();}}
  function mountAppModal(node: HTMLDialogElement) {
    return mountModal(node, { initialFocus: 'input:not([type=file]),textarea', returnFocus: '.settings-shell .sidebar-search,.app-shell .sidebar-search,.mobile-inspector' })
  }
  function closeModalBackdrop(event: MouseEvent) {
    if (event.target !== event.currentTarget) return
    const rect = (event.currentTarget as HTMLDialogElement).getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) modal = null
  }
  function panelKeys(event: KeyboardEvent) {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
    const tabs = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role=tab]'))
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    tabs[next].focus(); tabs[next].click()
  }

  onMount(()=>{
    appearance=loadAppearance();applyAppearance(appearance);
    if(demoMode){
      let disposed=false;
      runtime={state:'stopped',message:'Dane przykładowe · bez silnika',port:4312,managed:false};page='studio';
      void import('./gallery/tts-demo').then(async fixture=>{
        if(disposed)return;
        voices=fixture.demoVoices.map(voice=>({...voice}));openLinkedVoice();ttsFamily=fixture.demoFamily();projects=fixture.demoProjects();
        projectId=projects[0].id;projectName=projects[0].name;blocks=projects[0].blocks.map(block=>({...block}));loaded=true;
        const rows=await fixture.demoRecordings(projects);
        if(disposed){rows.forEach(row=>row.url&&URL.revokeObjectURL(row.url));return;}
        history=rows;demoAudio=rows[0];
      }).catch(error=>{if(!disposed)notify(userMessage(error,'Nie można przygotować danych demonstracyjnych.'),'bad');});
      return()=>{disposed=true;disposeModelRequests();clearTimeout(projectSaveTimer);clearTimeout(projectSaveDeadline);history.forEach(row=>row.url&&URL.revokeObjectURL(row.url));};
    }
    const raw=localStorage.getItem('voicestudio.projects.v2')||'';let lost=false;
    try{const stored=JSON.parse(raw||'[]');if(Array.isArray(stored)){projects=stored.filter(item=>typeof item.id==='string'&&typeof item.name==='string'&&Array.isArray(item.blocks)&&item.blocks.length&&item.blocks.every((block:SpeechBlock)=>typeof block.text==='string'&&typeof block.voiceId==='string'&&typeof block.id==='string'));lost=projects.length!==stored.length;}else lost=true;const current=projects.find(item=>item.id===localStorage.getItem('voicestudio.activeProject.v2'))||projects[0];if(current){projectId=current.id;projectName=current.name;blocks=current.blocks;speechSettings=readStoredSpeechSettings(current.speechSettings);}}catch{lost=true;/* Retain an empty project. */}
    if(lost&&raw){let kept=false;try{localStorage.setItem('voicestudio.projects.v2.backup',raw);kept=true;}catch{}notify(kept?'Część zapisanych projektów była uszkodzona i została pominięta. Kopię surowych danych zachowano w pamięci przeglądarki.':'Część zapisanych projektów była uszkodzona i została pominięta. Nie udało się zachować ich kopii.');}
    loaded=true;persistProject();
    const flushHidden=()=>{if(document.hidden)flushProjectSave();};
    window.addEventListener('pagehide',flushProjectSave);
    window.addEventListener('beforeunload',flushProjectSave);
    document.addEventListener('visibilitychange',flushHidden);
    void loadRecordings().then(rows=>history=rows).catch(()=>{});
    const runtimeChanged=(event:Event)=>{runtime=(event as CustomEvent).detail;};
    window.addEventListener('studio-runtime',runtimeChanged);
    if(isDesktop){void refreshRuntime();if(!demoMode&&readEngineAutostart())void bootRuntime();void refreshVoices().catch(error=>notify(userMessage(error,'Operacja nie powiodła się.'),'bad'));}else{runtime={state:'stopped',message:'Podgląd interfejsu · synteza w aplikacji Windows',port:4312,managed:false};void api.health().then(async()=>{runtime={state:'ready',message:'Lokalny silnik gotowy',port:4312,managed:false};await refreshVoices();await refreshEngine();}).catch(()=>{});}
    let lastRuntimeRefresh=0;
    const refresh=setInterval(()=>{if(isDesktop&&!document.hidden&&!runtimeBusy&&(runtime.state==='starting'||runtime.state==='ready'&&Date.now()-lastRuntimeRefresh>10000)){lastRuntimeRefresh=Date.now();void refreshRuntime();}},2500);
    return()=>{window.removeEventListener('studio-runtime',runtimeChanged);disposeModelRequests();flushProjectSave();window.removeEventListener('pagehide',flushProjectSave);window.removeEventListener('beforeunload',flushProjectSave);document.removeEventListener('visibilitychange',flushHidden);voiceRefreshSequence++;portraits.dispose();clearInterval(refresh);controller?.abort();aiController?.abort();voicePreviewController?.abort();if(voicePreviewUrl)URL.revokeObjectURL(voicePreviewUrl);history.forEach(item=>{if(item.url)URL.revokeObjectURL(item.url);});};
  });
</script>

<svelte:window onkeydown={keys}/>
<input hidden type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac" bind:this={audioInput} onchange={importAudio}/>
<input hidden type="file" accept=".txt" bind:this={textInput} onchange={importText}/>

<div class="app-shell" class:sidebar-hidden={!sidebar} class:settings-underlay={settingsOpen} inert={settingsOpen}>
  <NavigationSidebar items={uiOptions([...mainNav,...toolNav])} active={page} {projects} {projectId} runtimeState={runtime.state} onnavigate={navigate} onnew={newProject} onproject={openProject} onsettings={section=>section==='models'?void showModels():openSettings(section)} onnotify={notify} onaddvoice={openVoiceCreate} onsearch={openSearch} onback={backPage} backLabel={tr(pageNames[navigationTrail.at(-1)||'dashboard'])} backDisabled={!navigationTrail.length&&page==='dashboard'} onrefresh={checkAppUpdates} refreshing={false}/>
  <main class="main"><ShellTopbar title={tr(pageNames[page])} collapsed={!sidebar} ontoggle={()=>sidebar=!sidebar}>{#snippet children()}{#if page==='studio'}<span class="breadcrumb-divider">/</span><button class="project-name" onclick={()=>{projectDraftName=projectName;modal='project';}}>{projectName}<ChevronDown size={12}/></button>{/if}{/snippet}{#snippet actions()}{#if $remoteBackendState.active}<button class="remote-mode-status" title={$remoteBackendState.url} onclick={()=>openSettings('network','remote')}>{$remoteBackendState.error?tr('Zdalny silnik wymaga uwagi'):tr('Zdalny silnik')}</button>{/if}<DownloadIndicator onclick={()=>openSettings('models')}/>{#if page==='studio'}{/if}{/snippet}</ShellTopbar>
    <div class="workspace" class:full-width={page!=='studio'}>
      <section class="content" class:tts-demo-content={demoMode&&page==='studio'} aria-label={tr(pageNames[page])}>
        {#if demoMode}<div class="tts-demo-notice" role="note"><strong>{tr("Dane przykładowe")}</strong><span>{tr("Fikcyjne głosy i projekty. Audio to syntetyczny ton bez mowy.")}</span><a href="/">{tr("Wyjdź z podglądu")}</a></div>{/if}
        {#if page==='dashboard'}<Dashboard voiceId={activeOrbVoiceId} orbVariant={appearance.orbVariant} orbSyncGroup="global-playback" orbSuspended={settingsOpen} level={playbackActivity.level} bands={playbackActivity.bands} orbAudio={playbackActivity.orbAudio} features={playbackActivity.features} playing={playbackActivity.playing} {voices} {projects} recordings={history} ready={isDesktop||runtime.state==='ready'} onnavigate={navigate} onnew={newProject} onproject={openProject} onvoice={voice=>{voiceBlockId=blocks[0].id;chooseVoice(voice);goToPage('studio');}} onplay={play}/>
        {:else if page==='studio'}
          <div class="speech-workspace"><div class="speech-scroll"><div class="speech-column"><SpeechEditor bind:this={speechEditor} {blocks} {voices} onblockschange={changeBlocks} onchoosevoice={(id)=>{voiceBlockId=id;query='';voiceFilter='all';modal='voices';}} disabled={running||tagging} hideToolbar={true}/></div></div><div class="studio-bottom"><div class="generation-grid">{#if generatingPreview}<GenerationCard recording={generatingPreview} index={history.length+1} generating generationLabel={tr(generationStage)} onplay={()=>{}}/>{/if}{#each currentRecordings as row,index}<GenerationCard recording={row} index={history.length-index} state={recording?.id===row.id?playbackState:undefined} onseek={recording?.id===row.id?seconds=>player?.seek(seconds):undefined} onplay={()=>play(row)} onrestore={()=>restore(row)} onstar={()=>toggleRecordingStar(row)}/>{/each}</div><div class="composer-actions"><div class="composer-tools"><Button variant="ghost" size="icon" aria-label={tr("Wczytaj tekst")} onclick={()=>textInput.click()}><Upload size={16}/></Button><Button variant="ghost" size="icon" aria-label={tr("Pobierz tekst")} disabled={!totalText.trim()} onclick={downloadText}><Download size={16}/></Button><span class="character-count" class:over-limit={charCount>10000}>{charCount.toLocaleString(tr.locale)} <span>/ 10 000</span></span></div><div class="composer-submit">{#if canUndoAI}<div class="ai-result-actions" aria-label={tr("Wynik tagowania AI")}><Button variant="ghost" onclick={undoAITags}>{tr("Cofnij")}</Button><Button variant="ghost" onclick={keepAITags}>{tr("Zachowaj")}</Button></div>{/if}<ActionBar generateLabel={demoMode?tr("Dodaj przykład"):tr("Wygeneruj mowę")} tagLabel={demoMode?tr("Dodaj pauzy"):tr("Automatyczne tagowanie")} {tagging} {running} tagDisabled={!totalText.trim()||charCount>10000} generateDisabled={!canGenerate} {generateHint} progressLabel={generationStage} ontag={tagWithAI} ontags={()=>speechEditor?.toggleTags()} ongenerate={generate} oncancel={cancel} onsettings={()=>{panelTab='settings';inspector=true;}} onhistory={()=>{panelTab='history';inspector=true;}}/></div></div></div></div>
        {:else if page==='dubbing'||page==='audiobooks'}{#key page}<ProductionWorkspace kind={page} ready={isDesktop||runtime.state==='ready'} onnotify={notify} onopenai={()=>goSettings('ai','funkcje')}/>{/key}
        {:else if page==='stories'}<StoriesWorkspace ready={isDesktop||runtime.state==='ready'} onnotify={notify}/>
        {:else if page==='audio-lab'}<div class="page-body"><AudioLab ready={runtime.state==='ready'} onresult={async result=>{const peaks=await audioPeaks(result.blob);await storeAudio({id:crypto.randomUUID(),title:result.title,text:'',voice:tr("Obróbka audio"),created:new Date().toISOString(),kind:'audio',source:'import',blob:result.blob,url:URL.createObjectURL(result.blob),filename:result.filename,duration:result.duration,peaks});}}/></div>
        {:else if page==='automation'}<AutomationWorkspace ready={runtime.state==='ready'} ontext={text=>{changeBlocks([{id:crypto.randomUUID(),voiceId:primaryVoice.id,text}]);goToPage('studio');}}/>
        {:else if page==='batch'||page==='conversion'||page==='tools'||page==='engine-history'}{#key page}<StudioTools kind={page} ready={isDesktop||runtime.state==='ready'} onopenai={()=>goSettings('ai','funkcje')} ontext={text=>{changeBlocks([{id:crypto.randomUUID(),voiceId:primaryVoice.id,text}]);goToPage('studio');}}/>{/key}
        {:else if page==='voice-create'}<VoiceCreatePage ready={!demoMode&&(isDesktop||runtime.state==='ready')} oncreated={async()=>{await refreshVoices();notify(tr("Zapisano nowy głos."));goToPage('voices');}} oncancel={backPage}/>
        {:else if page==='voices'}<div class="page-body"><div class="page-heading"><div><h1>{tr("Głosy")}</h1><p>{tr("Twoje brzmienia, zawsze pod ręką.")}</p></div><Button variant="default" onclick={openVoiceCreate}><Plus size={16}/>{tr("Dodaj głos")}</Button></div><div class="library-toolbar"><div class="filter-tabs">{#each ['all','Klonowany','Projektowany'] as filter}<button class:chosen={voiceFilter===filter} onclick={()=>voiceFilter=filter}>{filter==='all'?tr("Wszystkie"):filter==='Klonowany'?tr('Klonowane'):tr('Projektowane')}</button>{/each}</div><label class="search-field"><Search size={15}/><input aria-label={tr("Szukaj głosu")} placeholder={tr("Szukaj głosu")} bind:value={query}/></label></div><div class="voice-grid">{#each filteredVoices as voice}<button class="voice-card" onclick={()=>{voiceBlockId=blocks[0].id;chooseVoice(voice);goToPage('studio');}}><span class={`voice-avatar large ${voice.color}`}><VoiceAvatar voiceId={voice.id} name={voice.name} portraitSrc={voice.portraitSrc} size="100%"/></span><strong>{voice.name}</strong><p>{tr(voice.description)}</p><div><span>{tr(voice.kind)}</span><span>{tr(voice.language)}</span></div><footer>{tr("Użyj głosu")}<ArrowUpRight size={15}/></footer></button>{/each}</div>{#if voices.every(voice=>voice.demo)}<p class="page-footnote">{tr("Przykładowe karty pokazują wygląd biblioteki. Zapisane głosy pojawią się po uruchomieniu lokalnego silnika.")}</p>{/if}<VoiceManager ready={isDesktop||runtime.state==='ready'} onchange={refreshVoices}/><VoiceLibraryTools ready={isDesktop||runtime.state==='ready'} onchange={refreshVoices}/></div>
        {:else if page==='projects'}<div class="page-body"><div class="page-heading"><div><h1>{tr("Projekty")}</h1><p>{tr("Teksty i mówcy zapisują się automatycznie.")}</p></div><Button variant="default" onclick={newProject}><Plus size={16}/>{tr("Nowa narracja")}</Button></div><div class="project-list">{#each projects as project}<button onclick={()=>openProject(project)}><span class="project-icon"><FileText size={22}/></span><span><strong>{project.name}</strong><small>{project.blocks.length} {project.blocks.length===1?tr("mówca"):tr("mówców")} · {new Date(project.updated).toLocaleDateString(tr.locale)}</small></span><ChevronRight size={17}/></button>{/each}</div></div>
        {:else if page==='history'}<div class="page-body"><div class="page-heading"><div><h1>{tr("Nagrania")}</h1><p>{tr("Zapisane wyniki i pliki audio.")}</p></div><Button variant="outline" onclick={()=>audioInput.click()}><Upload size={15}/>{tr("Wczytaj audio")}</Button></div>{#if history.length}<div class="recording-list">{#each history as row,index}<div class="recording-row"><button class="mini-play" aria-label={tr("Odtwórz {value0}", {value0: (row.title)})} onclick={()=>play(row)}><Play size={14} fill="currentColor"/></button><div><strong>{row.title}</strong><span>{tr(row.voice)} · {new Date(row.created).toLocaleDateString(tr.locale)}</span></div>{#if row.text}<Button variant="ghost" onclick={()=>restore(row)}>{tr("Użyj tekstu")}</Button>{/if}<Button variant="ghost" size="icon" href={row.url} download={row.filename} aria-label={tr("Pobierz {value0}", {value0: (row.title)})}><Download size={17}/></Button></div>{/each}</div>{:else}<div class="empty-state"><AudioLines size={32}/><h2>{tr("Jeszcze cisza")}</h2><p>{tr("Wygenerowane lub wczytane nagrania pojawią się tutaj.")}</p><Button variant="outline" onclick={()=>page='studio'}>{tr("Przejdź do edytora")}</Button></div>{/if}</div>
        {:else if page==='dictation'}<DictationWorkspace ready={isDesktop||runtime.state==='ready'} onopenai={()=>goSettings('ai','funkcje')} ontext={text=>{changeBlocks([{id:crypto.randomUUID(),voiceId:primaryVoice.id,text}]);goToPage('studio');}}/>
        {:else if page==='transcription'}<TranscriptionWorkspace ready={isDesktop||runtime.state==='ready'} ontext={text=>{changeBlocks([{id:crypto.randomUUID(),voiceId:primaryVoice.id,text}]);goToPage('studio');}}/>

        {:else}<div class="page-body"><h1>{tr(pageNames[page])}</h1></div>{/if}
      </section>
      {#if page==='studio'}{#if inspector}<div class="sheet-backdrop" aria-hidden="true" onclick={()=>inspector=false}></div>{/if}<aside class="inspector tts-inspector" class:mobile-open={inspector} data-sheet aria-label={tr("Ustawienia generowania")}><div class="sheet-handle" aria-hidden="true" use:sheetDrag={()=>inspector=false}></div>
{#if choosingModel}<ModelPicker models={ttsModelItems} selectedId={generationEngine} loading={modelLoading} error={modelError} onrefresh={loadPickerModels} onselect={chooseInstalledModel} onclose={closeModelPicker}/>{:else}
<div class="panel-tabs" role="tablist" tabindex="-1" aria-label={tr("Panel generowania")} onkeydown={panelKeys}>
  <button id="generation-settings-tab" role="tab" aria-selected={panelTab==='settings'} tabindex={panelTab==='settings'?0:-1} aria-controls="generation-settings-panel" class:chosen={panelTab==='settings'} onclick={()=>panelTab='settings'}>{tr("Ustawienia")}</button>
  <button id="generation-history-tab" role="tab" aria-selected={panelTab==='history'} tabindex={panelTab==='history'?0:-1} aria-controls="generation-history-panel" class:chosen={panelTab==='history'} onclick={()=>panelTab='history'}>{tr("Historia")}</button>
  <Button variant="ghost" size="icon" class=" close-inspector" aria-label={tr("Zamknij ustawienia")} onclick={()=>inspector=false}><X size={16}/></Button>
</div>
<div id="generation-settings-panel" class="inspector-fields tts-fields" role="tabpanel" aria-labelledby="generation-settings-tab" hidden={panelTab!=='settings'}>
  <div class="inspector-section"><div class="tts-label-row"><span>{tr("Głos")}</span><button aria-expanded={showVoicePreview} aria-controls="tts-voice-preview" onclick={()=>showVoicePreview=!showVoicePreview}>{tr("Podgląd")}<ChevronDown size={12}/></button></div>
    <div class="tts-voice-tray"><button class="voice-select" aria-label={tr("Wybierz głos: ")+primaryVoice.name} onclick={()=>{voiceBlockId=blocks[0].id;query='';voiceFilter='all';modal='voices';}}><span class={'voice-avatar small '+primaryVoice.color}><VoiceAvatar voiceId={primaryVoice.id} name={primaryVoice.name} portraitSrc={primaryVoice.portraitSrc} size="100%"/></span><strong>{primaryVoice.name}</strong><ChevronRight size={16}/></button><button class="tts-copy-id" aria-label={tr("Skopiuj ID głosu")} title={tr("Skopiuj ID głosu")} onclick={copyVoiceId}><Copy size={14}/></button></div>
    {#if showVoicePreview}<div id="tts-voice-preview" class="tts-preview"><div class="voice-orb-preview"><VoiceOrb voiceId={activeOrbVoiceId} size={144} ring variant={appearance.orbVariant} syncGroup="global-playback" suspended={settingsOpen} features={playbackActivity.features} orbAudio={playbackActivity.orbAudio} level={primaryOrbPlaying?playbackActivity.level:0} bands={primaryOrbPlaying?playbackActivity.bands:[]} playing={primaryOrbPlaying}/><button class="voice-orb-play" aria-label={primaryPlaybackLabel} title={primaryPlaybackLabel} disabled={!recording?.url&&(voicePreviewBusy||(!demoMode&&(primaryVoice.demo||!isDesktop&&runtime.state!=='ready'))||demoMode&&!demoAudio)} onclick={togglePrimaryPlayback}>{#if voicePreviewBusy&&!recording?.url}<LoaderCircle class="spin" size={17}/>{:else if primaryOrbPlaying}<Pause size={15} fill="currentColor"/>{:else}<Play size={15} fill="currentColor"/>{/if}</button></div>{#if recording?.url}<Button variant="ghost" class=" voice-sample-button" disabled={voicePreviewBusy||(!demoMode&&(primaryVoice.demo||!isDesktop&&runtime.state!=='ready'))||demoMode&&!demoAudio} onclick={previewPrimaryVoice}>{#if voicePreviewBusy}<LoaderCircle class="spin" size={13}/>{:else}<Play size={13}/>{/if}{demoMode?tr("Posłuchaj próbki WAV"):tr("Posłuchaj próbki głosu")}</Button>{/if}</div>{/if}
  </div>
  <div class="inspector-section"><div class="tts-label-row"><span>{tr("Model")}</span><button onclick={showModels}>{tr("Informacje")}<ArrowUpRight size={12}/></button></div><div class="tts-model-tray"><ModelTrigger label="" active={!!generationEngine} name={ttsFamily?.backends.find(row=>row.id===generationEngine)?.display_name||generationEngine||'Wybierz model'} modelId={generationEngine} expanded={choosingModel} busy={modelLoading} onclick={openModelPicker}/></div>{#if ttsFamily?.active_model}<p class="active-model-repository" title={ttsFamily.active_model}>{ttsFamily.active_model}</p>{/if}</div>
  <Slider collapsible startLabel={tr("Wolniej")} endLabel={tr("Szybciej")} label={tr("Szybkość")} value={speed} min={.5} max={2} step={.05} valueLabel={speed.toFixed(2)+'×'} onchange={value=>speed=value}/>
  <InspectorSection label={tr("Język")} summary={speechLanguageLabel(language)}><Select ariaLabel={tr("Język generowania")} value={language} onchange={value=>language=value} options={uiOptions(generationLanguages.map(value=>({value,label:speechLanguageLabel(value)})))}/></InspectorSection>
  <InspectorSection label={tr("Efekty audio")} summary={tr(effectNames[effect]||effect)}><Select ariaLabel={tr("Preset efektów audio")} value={effect} onchange={value=>effect=value} options={uiOptions(Object.entries(effectNames).map(([value,label])=>({value,label})))}/></InspectorSection>
  {#if generationBackend?.supports_cloning===false}<p class="tts-format-note">{tr("Wybrany silnik używa własnego głosu. Zapisane profile nie są przekazywane do syntezy.")}</p>{/if}
  <AdvancedSpeechSettings value={speechSettings} engine={generationBackend} context={generationContext} disabled={running||tagging} onchange={changeSpeechSettings}/>
  <InspectorSection label={tr("Format wyjściowy")} summary="WAV" defaultOpen><Select ariaLabel={tr("Format wyjściowy")} value="wav" options={uiOptions([{value:'wav',label:'WAV — bez kompresji'}])}/><p class="tts-format-note">{tr("Częstotliwość próbkowania zależy od modelu.")}</p></InspectorSection>
  <InspectorSection label={tr("Zaawansowane")} summary={tr('{steps} kroków',{steps})}><Slider label={tr("Kroki generowania")} value={steps} min={8} max={64} step={8} onchange={value=>steps=value}/><label class="form-label" for="seed">{tr("Ziarno losowości")}</label><input class="text-input" id="seed" placeholder={tr("Losowe")} inputmode="numeric" bind:value={seed}/></InspectorSection>
  <button class="reset-settings" onclick={reset}><RotateCcw size={15}/>{tr("Resetuj wartości")}</button>
</div>
<GenerationHistory rows={history} active={panelTab==='history'} playingId={recording?.id} onplay={play} onrestore={restore} onstar={toggleRecordingStar}/>
{/if}</aside>{/if}
    </div><Player bind:this={player} {recording} orbVariant={appearance.orbVariant} orbVoiceId={activeOrbVoiceId} orbSyncGroup="global-playback" orbSuspended={settingsOpen} onimport={()=>audioInput.click()} onstate={value=>playbackState=value} onactivity={value=>playbackActivity=value}/>
  </main>
</div>
{#if settingsOpen}<SettingsShell section={settingsSection} onsection={section=>openSettings(section)} onback={closeSettings} backLabel={tr(pageNames[page])} onhome={()=>navigate('dashboard')} onsearch={openSearch} onprojects={()=>navigate('projects')} onrefresh={checkAppUpdates} refreshing={false} runtimeState={runtime.state} collapsed={!sidebar} ontoggle={()=>sidebar=!sidebar}>
  {#key settingsSection}
  {#if settingsSection==='general'}<GeneralPage ready={runtime.state==='ready'} onnavigate={goSettings}/>
  {:else if settingsSection==='appearance'}<AppearancePage value={appearance} voiceId={activeOrbVoiceId} onchange={changeAppearance}/>
  {:else if settingsSection==='dictionary'}<DictionaryPage ready={runtime.state==='ready'} onnavigate={goSettings}/>
  {:else if settingsSection==='shortcuts'}<ShortcutsPage desktop={isDesktop}/>
  {:else if settingsSection==='updates'}<UpdatesPage ready={runtime.state==='ready'} desktop={isDesktop} intent={settingsIntent} onnavigate={goSettings}/>
  {:else if settingsSection==='engine'}<EnginePage {runtime} busy={runtimeBusy} generating={running} desktop={isDesktop} intent={settingsIntent} onstart={bootRuntime} onstop={endRuntime} onrestart={isDesktop?restartRuntime:undefined} onrefresh={refreshStudio} onchange={refreshEngine} onnavigate={goSettings}/>
  {:else if settingsSection==='models'}<ModelsPage ready={runtime.state==='ready'} desktop={isDesktop} intent={settingsIntent} {requestedLicenseRepo} {requestedLicenseRepos} onchange={refreshEngine} onrestart={isDesktop?restartRuntime:undefined} onnavigate={goSettings}/>
  {:else if settingsSection==='network'}<NetworkPage ready={runtime.state==='ready'} intent={settingsIntent} onremotechange={async()=>{await refreshVoices();await refreshEngine();}} onnavigate={goSettings}/>
  {:else if settingsSection==='integrations'}<IntegrationsPage ready={runtime.state==='ready'} onnavigate={goSettings}/>
  {:else if settingsSection==='ai'}<AiPage ready={runtime.state==='ready'} intent={settingsIntent} onnavigate={goSettings}/>
  {:else if settingsSection==='storage'}<StoragePage ready={runtime.state==='ready'} onrestart={isDesktop?restartRuntime:undefined} onnavigate={goSettings}/>
  {:else if settingsSection==='privacy'}<PrivacyPage ready={runtime.state==='ready'} onnavigate={goSettings}/>
  {/if}
  {/key}
</SettingsShell>{/if}<EngineStartup {runtime} onmodels={showModels}/><Toaster/><ConfirmDialog/>
{#if !demoMode}<ModelLicenseOnboarding ready={runtime.state==='ready'} selection={`${ttsFamily?.active || ''}:${ttsFamily?.active_model || ''}`} onsetup={()=>void showModels()}/>{/if}
{#if modal==='voices'}<VoicePicker {voices} initialVoiceId={linkedVoiceId} onrefresh={demoMode?undefined:loadPickerModels} modelLanguages={voiceModel?.supported_language_names||[]} modelName={voiceModel?.display_name||voiceModelFamily?.active||''} languageLoading={!demoMode&&modelLoading} languageNotice={!demoMode&&modelError?tr("Nie udało się odczytać języków modelu. ")+modelError:''} selectedId={blocks.find(block=>block.id===voiceBlockId)?.voiceId||primaryVoice.id} demo={demoMode} ready={demoMode?!!demoAudio:isDesktop||runtime.state==='ready'} busyId={voicePreviewId} playingId={playbackState.status==='playing'?recording?.voiceId||'':''} onselect={chooseVoice} onpreview={previewVoice} onclose={()=>{cancelVoicePreview();linkedVoiceId='';modal=null;}} oncreate={()=>{openVoiceCreate();}}/>{/if}
{#if modal&&modal!=='voices'}{#key modal}<dialog class="modal" use:mountAppModal aria-label={modal==='project'?tr("Nazwa projektu"):tr('Szukaj')} oncancel={event=>{event.preventDefault();modal=null}} onkeydown={event=>{if(event.key==='Escape')event.stopPropagation()}} onclick={closeModalBackdrop}><Button variant="ghost" size="icon" class="modal-close " aria-label={tr("Zamknij okno")} onclick={()=>modal=null}><X size={18}/></Button>
{#if modal==='project'}<h2>{tr("Nazwa projektu")}</h2><label class="form-label" for="project-name">{tr("Nazwa")}</label><input class="text-input" id="project-name" bind:value={projectDraftName} maxlength="80" onkeydown={(event)=>{if(event.key==='Enter'&&projectDraftName.trim()){projectName=projectDraftName.trim();persistProject();modal=null;}}}/><Button variant="default" class=" full" disabled={!projectDraftName.trim()} onclick={()=>{projectName=projectDraftName.trim();persistProject();modal=null;}}>{tr("Zapisz")}</Button>
{:else}<h2>{tr("Przejdź do…")}</h2><label class="search-field"><Search size={16}/><input aria-label={tr("Szukaj ekranu")} placeholder={tr("Wpisz nazwę")} bind:value={query}/><kbd>{tr("esc")}</kbd></label><div class="search-results">{#each [{id:'dashboard' as Page,label:'Pulpit',icon:AudioLines},...mainNav,...toolNav,{id:'ai-settings' as Page,label:'AI i klucze',icon:Sparkles},{id:'appearance' as Page,label:'Wygląd',icon:Palette},{id:'models' as Page,label:'Modele',icon:Cpu}].filter(item=>item.label.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl'))) as item}<button onclick={()=>{navigate(item.id);modal=null;query='';}}><item.icon size={17}/>{tr(item.label)}<ArrowUpRight size={14}/></button>{/each}</div>{/if}
</dialog>{/key}{/if}

<style>
.remote-mode-status{font-size:var(--ui-text-11);color:var(--foreground);border:1px solid var(--border);border-radius:6px;padding:5px 9px;background:var(--surface)}
</style>
