import { translateUi } from '../../i18n';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getRuntimeStatus, type RuntimeStatus } from '../../platform/runtime';

export type DictationDesktopPreferences = { enabled:boolean; shortcut:string; paste_enabled:boolean };
export type DictationDesktopStatus = { supported:boolean; preferences:DictationDesktopPreferences; registered:boolean; active_shortcut?:string|null; widget_visible:boolean; target?:{title:string;available:boolean}|null; error?:string|null };
export const defaultDictationDesktopPreferences = ():DictationDesktopPreferences => ({enabled:false,shortcut:'Ctrl+Alt+Shift+D',paste_enabled:false});
const previewStatus = ():DictationDesktopStatus => ({supported:false,preferences:defaultDictationDesktopPreferences(),registered:false,widget_visible:false});
const desktop = () => {if(!isTauri())throw new Error(translateUi("Ta funkcja jest dostępna w aplikacji desktopowej na Windows."));};
async function nativeCall<T>(command:string,args?:Record<string,unknown>):Promise<T>{try{return await invoke<T>(command,args);}catch(cause){throw cause instanceof Error?cause:new Error(typeof cause==='string'?cause:translateUi("Nie udało się wykonać operacji dyktowania Windows."));}}
export function shortcutError(raw:string):string{
  const parts=raw.split('+').map(part=>part.trim());if(raw.length>100||parts.length<3||parts.some(part=>!part))return translateUi("Użyj co najmniej dwóch modyfikatorów i klawisza, np. Ctrl+Alt+Shift+D.");
  const modifiers=parts.slice(0,-1).map(part=>({control:'ctrl',commandorcontrol:'ctrl',cmdorcontrol:'ctrl',option:'alt',meta:'super',win:'super'} as Record<string,string>)[part.toLowerCase()]||part.toLowerCase());
  if(modifiers.some(part=>!['ctrl','alt','shift','super'].includes(part))||new Set(modifiers).size!==modifiers.length||!modifiers.some(part=>part==='ctrl'||part==='alt'))return translateUi("Wybierz Ctrl lub Alt oraz drugi różny modyfikator: Ctrl, Alt, Shift albo Super.");
  const key=parts.at(-1)!.toUpperCase(),fn=/^F(\d{1,2})$/.exec(key);if(!/^[A-Z0-9]$/.test(key)&&key!=='SPACE'&&!(fn&&Number(fn[1])>=1&&Number(fn[1])<=24&&Number(fn[1])!==12))return translateUi("Wybierz literę, cyfrę, Space lub F1–F24 z wyjątkiem zarezerwowanego F12.");return '';
}
export const desktopDictationStatus = () => isTauri()?nativeCall<DictationDesktopStatus>('dictation_desktop_status'):Promise.resolve(previewStatus());
export async function configureDesktopDictation(preferences:DictationDesktopPreferences){desktop();const invalid=preferences.enabled?shortcutError(preferences.shortcut):'';if(invalid)throw new Error(invalid);return nativeCall<DictationDesktopStatus>('dictation_desktop_configure',{preferences});}
export async function showDictationWidget(){desktop();return nativeCall<DictationDesktopStatus>('dictation_widget_show');}
export async function hideDictationWidget(){desktop();return nativeCall<void>('dictation_widget_hide');}
export async function acknowledgeDictationStopped(generation:number){desktop();return nativeCall<void>('dictation_widget_stopped',{generation});}
function validateText(text:string){if(!text.trim())throw new Error(translateUi("Brak tekstu do skopiowania lub wklejenia."));if(text.length>200_000||Array.from(text).length>100_000||text.includes('\0'))throw new Error(translateUi("Tekst jest zbyt długi lub zawiera niedozwolony znak."));}
export async function copyDesktopDictation(text:string){desktop();validateText(text);await nativeCall<void>('dictation_desktop_copy',{text});}
export async function pasteDesktopDictation(text:string){desktop();validateText(text);await nativeCall<void>('dictation_desktop_paste',{text});}
export async function watchDesktopDictation(handlers:{status?:(value:DictationDesktopStatus)=>void;shown?:()=>void;hidden?:(generation:number)=>void},signal?:AbortSignal):Promise<UnlistenFn>{
  if(!isTauri())return()=>{};signal?.throwIfAborted();const disposers:UnlistenFn[]=[];let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;signal?.removeEventListener('abort',dispose);for(const stop of disposers)stop();disposers.length=0;};
  signal?.addEventListener('abort',dispose,{once:true});
  const add=async<T>(name:string,handler:(payload:T)=>void)=>{const stop=await listen<T>(name,event=>{if(!disposed)handler(event.payload);});if(disposed)stop();else disposers.push(stop);};
  try{await Promise.all([handlers.status?add<DictationDesktopStatus>('dictation-desktop:status',handlers.status):Promise.resolve(),handlers.shown?add<void>('dictation-desktop:shown',handlers.shown):Promise.resolve(),handlers.hidden?add<number>('dictation-desktop:hidden',handlers.hidden):Promise.resolve()]);return dispose;}
  catch(cause){dispose();throw cause;}
}
function delay(signal:AbortSignal,ms:number){signal.throwIfAborted();return new Promise<void>((resolve,reject)=>{const stop=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},ms);signal.addEventListener('abort',stop,{once:true});});}
/** Native ownership lets hiding/destroying the utility release its lease even
 * when its webview never gets a chance to run JS cleanup. */
export async function acquireWidgetRuntime(signal:AbortSignal):Promise<()=>Promise<void>>{
  desktop();signal.throwIfAborted();const result=await nativeCall<{lease:number;status:RuntimeStatus}>('dictation_widget_runtime_acquire');let released=false;
  const release=async()=>{if(released)return;released=true;await nativeCall<void>('dictation_widget_runtime_release',{lease:result.lease});};
  try{signal.throwIfAborted();let status=result.status;const deadline=Date.now()+185_000;while(status.state==='starting'&&Date.now()<deadline){await delay(signal,500);status=await getRuntimeStatus();signal.throwIfAborted();}if(status.state!=='ready')throw new Error(status.state==='starting'?translateUi("Przekroczono czas uruchamiania lokalnego silnika."):status.message);return release;}
  catch(cause){try{await release();}catch{/* Native hide/exit also releases owned leases. */}throw cause;}
}
