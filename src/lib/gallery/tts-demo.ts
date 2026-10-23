import type { Voice, Project, Render } from '../data';
import type { Engine, EngineFamily } from '../tools/studio-tools';
import { extraTtsDemoEngines } from './extra-tts-demo';
import { audioPeaks } from '../projects/library';
import { translateUi as t } from '../i18n';
const sampleUrl = '/demo/interface-tone.wav';

/** Fictional UI fixtures; availability and languages are illustrative. Polish source text is translated with `t` (keys in i18n/en/demo.ts) when the fixtures are built, in the language active at that time. */
const voiceFixtures: Voice[] = [
  { id:'demo-anna', name:'Anna', initials:'A', description:'Ciepła i naturalna narracja', language:'Polski', color:'peach', kind:'Projektowany', demo:true, categories:['Narracja','Konwersacja'],accent:'Standardowy',gender:'female',ageGroup:'adult',inLibrary:true },
  { id:'demo-marek', name:'Marek', initials:'M', description:'Spokojny lektor audiobooków', language:'Polski', color:'blue', kind:'Klonowany', demo:true,categories:['Audiobook','Narracja'],accent:'Standardowy',gender:'male',ageGroup:'mature',inLibrary:true },
  { id:'demo-zofia', name:'Zofia', initials:'Z', description:'Energia do reklam i podcastów', language:'Polski', color:'purple', kind:'Projektowany', demo:true,categories:['Reklama','Podcast'],accent:'Standardowy',gender:'female',ageGroup:'young' },
  { id:'demo-alex', name:'Alex', initials:'A', description:'Wyraźny głos do prezentacji', language:'English', color:'blue', kind:'Klonowany', demo:true,categories:['Edukacja','Konwersacja'],accent:'Neutralny',gender:'neutral',ageGroup:'adult',inLibrary:true },
  { id:'demo-emilia', name:'Emilia', initials:'E', description:'Miękka opowieść wieczorna', language:'Polski', color:'peach', kind:'Projektowany', demo:true,categories:['Audiobook','Narracja'],accent:'Standardowy',gender:'female',ageGroup:'adult' },
  { id:'demo-jan', name:'Jan', initials:'J', description:'Niski głos dokumentalny', language:'Polski', color:'purple', kind:'Klonowany', demo:true,categories:['Edukacja','Podcast'],accent:'Standardowy',gender:'male',ageGroup:'mature' },
  { id:'demo-natalia', name:'Natalia', initials:'N', description:'Jasny i przyjazny głos do rozmów', language:'Polski',color:'peach',kind:'Projektowany',demo:true,categories:['Konwersacja','Edukacja'],gender:'female',ageGroup:'young',accent:'Standardowy' },
  { id:'demo-piotr', name:'Piotr', initials:'P',description:'Opowieści, audiobooki i dłuższe formy',language:'Polski',color:'blue',kind:'Klonowany',demo:true,categories:['Audiobook','Narracja'],gender:'male',ageGroup:'adult',accent:'Standardowy',inLibrary:true },
  { id:'demo-alicja', name:'Alicja', initials:'A',description:'Spokojny ton do materiałów edukacyjnych',language:'Polski',color:'purple',kind:'Projektowany',demo:true,categories:['Edukacja','Narracja'],gender:'female',ageGroup:'mature',accent:'Standardowy' },
  { id:'demo-tomasz', name:'Tomasz — niski i chropowaty', initials:'T',description:'Wyraziste brzmienie dokumentalne',language:'Polski',color:'blue',kind:'Klonowany',demo:true,categories:['Narracja','Podcast'],gender:'male',ageGroup:'mature',accent:'Standardowy' },
  { id:'demo-lena', name:'Lena', initials:'L',description:'Lekka, dynamiczna prezentacja produktu',language:'Polski',color:'peach',kind:'Projektowany',demo:true,categories:['Reklama','Podcast'],gender:'female',ageGroup:'young',accent:'Standardowy' },
  { id:'demo-sam', name:'Sam', initials:'S',description:'Clear and friendly conversational voice',language:'English',color:'purple',kind:'Projektowany',demo:true,categories:['Konwersacja','Reklama'],gender:'neutral',ageGroup:'adult',accent:'Neutralny' },
];
const demoLanguageCoverage: Record<string,string[]> = {
  'demo-anna':['Polish','English','German','French','Spanish','Italian','Portuguese'],
  'demo-marek':['Polish','English','German','French','Spanish'],
  'demo-zofia':['Polish','English','German','French'],
  'demo-alex':['English','German'],
  'demo-emilia':['Polish','English','Italian'],
  'demo-jan':['Polish','English','German'],
  'demo-natalia':['Polish','English','Spanish'],
  'demo-piotr':['Polish','English'],
  'demo-alicja':['Polish','English','German','French'],
  'demo-tomasz':['Polish','English'],
  'demo-lena':['Polish','English','Spanish','Italian'],
  'demo-sam':['English','French','Spanish'],
};
export const demoVoices:Voice[]=voiceFixtures.map(voice=>({...voice,name:t(voice.name),description:t(voice.description),supportedLanguages:demoLanguageCoverage[voice.id],createdAt:new Date(Date.UTC(2024,0,15+voiceFixtures.indexOf(voice))).toISOString()}));
export function demoFamily(): EngineFamily {
  const backends: Engine[] = [
    {id:'omnivoice',display_name:'OmniVoice · przykład',description:'Przykładowa konfiguracja do narracji z klonowaniem głosu i tagami audio.',available:true,installed:true,supports_cloning:true,supported_language_names:['Polish','English','German','French','Spanish','Italian','Portuguese']},
    {id:'pockettts',display_name:'PocketTTS · przykład',description:'Przykładowy lekki silnik do krótkich wypowiedzi. Sprawdź wybór języka i ustawienia.',available:true,installed:true,supported_language_names:['English']},
    {id:'voxcpm2',display_name:'VoxCPM · przykład',description:'Przykładowa alternatywa do dialogów i materiałów z kilkoma mówcami.',available:true,installed:true,supports_cloning:true,supported_language_names:['Polish','English']},
    {id:'demo-gpu',display_name:'Model GPU · przykład',available:false,installed:true,reason:'Przykładowy stan: urządzenie GPU jest zajęte.',supported_language_names:['Polish']},
    {id:'demo-missing',display_name:'Model niezainstalowany · przykład',available:false,installed:false,reason:'Przykładowy stan: brak lokalnych wag.',supported_language_names:['Polish','English']},
    {id:'demo-license',display_name:'Model z licencją · przykład',available:true,installed:true,license_required:true,license_accepted:false,supported_language_names:['English']},
    ...extraTtsDemoEngines,
  ];
  return { active:'omnivoice', active_model:'demo/omnivoice-narracja', backends:backends.map(engine=>({...engine,display_name:t(engine.display_name!),description:engine.description&&t(engine.description),reason:engine.reason&&t(engine.reason)})) };
}
export function demoProjects(): Project[] {
  const projects: Project[] = [
    {id:'demo-dialog',name:'Rozmowa o dobrym głosie',updated:'2026-10-20T08:30:00Z',blocks:[
      {id:'demo-block-anna',voiceId:'demo-anna',text:'Każda opowieść zaczyna się od głosu. [pause 250ms] Czasem ciepłego i spokojnego, a czasem pełnego energii. Jak zabrzmi twoja historia?'},
      {id:'demo-block-marek',voiceId:'demo-marek',text:'Wybierz brzmienie, dopracuj tempo i zostaw chwilę na oddech. [pause 500ms] To przestrzeń na twoje słowa.'},
    ]},
    {id:'demo-podcast',name:'Podcast — poranna inspiracja',updated:'2026-10-19T16:15:00Z',blocks:[{id:'demo-block-zofia',voiceId:'demo-zofia',text:'Dzień dobry! W dzisiejszym odcinku porozmawiamy o małych pomysłach, które prowadzą do wielkich zmian. [pause 300ms] Zaczynamy.'}]},
    {id:'demo-book',name:'Audiobook — pierwszy rozdział',updated:'2026-10-18T10:00:00Z',blocks:[{id:'demo-block-jan',voiceId:'demo-jan',text:'Za oknem powoli zapadał zmierzch. Na biurku leżał list, którego nikt nie otwierał od wielu lat. [pause 500ms] Tego wieczoru wszystko miało się zmienić.'}]},
  ];
  return projects.map(project=>({...project,name:t(project.name),blocks:project.blocks.map(block=>({...block,text:t(block.text)}))}));
}
export async function demoRecordings(projects: Project[]): Promise<Render[]> {
  const response=await fetch(sampleUrl);
  if(!response.ok)throw new Error(t('Nie można wczytać przykładowego WAV.'));
  const blob=await response.blob();let duration: number|undefined;
  const peaks=await audioPeaks(blob,value=>duration=value);
  return projects.flatMap((project,index)=>Array.from({length:index===0?3:1},(_,take)=>({
    id:`demo-audio-${index}-${take}`,projectId:project.id,title:`${project.name} · ${t('przykład')} ${take+1}`,
    text:project.blocks.map(block=>block.text).join('\n\n'),blocks:project.blocks.map(block=>({...block})),
    voice:t('Ton testowy · bez mowy'),created:`2026-10-${20-index}T08:${30-take*5}:00Z`,kind:'audio' as const,
    modelId:'demo-tone',modelName:t('Syntetyczny ton · bez modelu'),source:'import' as const,
    blob,url:URL.createObjectURL(blob),filename:'probka-interfejsu.wav',duration,peaks,
  })));
}
