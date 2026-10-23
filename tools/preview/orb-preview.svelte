<script lang="ts">
  import { tick } from 'svelte';
  import Player from '../../frontend/src/playback/Player.svelte';
  import VoiceOrb from '../../frontend/src/playback/VoiceOrb.svelte';
  import { quietActivity, type PlaybackActivity } from '../../frontend/src/playback/playback-meter';
  import type { Render } from '../../frontend/src/data';

  let activity=$state<PlaybackActivity>(quietActivity());
  let voice=$state('orb-test-a');
  let player=$state<Player>();
  let recording=$state<Render>();
  let urls:string[]=[];
  let samples:{time:number;level:number;available:boolean}[]=[];
  function signal(){
    const rate=24000,length=rate*6,bytes=new ArrayBuffer(44+length*2),view=new DataView(bytes);
    const ascii=(offset:number,text:string)=>[...text].forEach((char,i)=>view.setUint8(offset+i,char.charCodeAt(0)));
    ascii(0,'RIFF');view.setUint32(4,36+length*2,true);ascii(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,length*2,true);
    for(let i=0;i<length;i++){const t=i/rate,value=t<1.8||t>4.6?.28*Math.sin(2*Math.PI*440*t):0;view.setInt16(44+i*2,Math.round(value*32767),true);}
    const blob=new Blob([bytes],{type:'audio/wav'}),url=URL.createObjectURL(blob);urls.push(url);
    return {id:crypto.randomUUID(),voice:'Głos testowy',title:'Ton → cisza → ton',text:'',kind:'audio' as const,created:new Date().toISOString(),url,blob,filename:'test-wizualizacji.wav',blocks:[{id:'test',voiceId:voice,text:''}]};
  }
  export async function startSignal(){samples=[];recording=signal();await tick();await player?.play();}
  export async function pause(){const audio=document.querySelector<HTMLAudioElement>('#orb-test-player audio');audio?.pause();await tick();}
  export function readings(){return [...samples];}
  export function selectVoice(id:string){voice=id;}
  export function activitySnapshot(){return {...activity};}
  function report(next:PlaybackActivity){activity=next;const audio=document.querySelector<HTMLAudioElement>('#orb-test-player audio');samples.push({time:audio?.currentTime||0,level:next.level,available:next.available});}
  $effect(()=>()=>{for(const url of urls)URL.revokeObjectURL(url);});
</script>

<section class="test-stage">
  <div id="orb-test-large"><VoiceOrb voiceId={voice} size={230} level={activity.level} bands={activity.bands} playing={activity.playing} ring/></div>
  <h2>Wizualizacja głosu</h2><p>Stały wygląd głosu · ruch w bezczynności · reakcja na odtwarzanie</p>
  <div class="identities"><VoiceOrb voiceId="orb-test-a" animated={false} size={42}/><VoiceOrb voiceId="orb-test-b" animated={false} size={42}/><VoiceOrb voiceId="orb-test-c" animated={false} size={42}/></div>
</section>
<div id="orb-test-player"><Player bind:this={player} {recording} onimport={startSignal} onactivity={report}/></div>

<style>
  .test-stage{display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px}.test-stage h2{font-size:20px;font-weight:550;margin:0}.test-stage p{font-size:13px;color:var(--muted);margin:0;text-align:center}.identities{display:flex;gap:15px;margin-top:10px}#orb-test-player{width:min(980px,100%);margin:30px auto}#orb-test-player :global(.player){min-height:110px;grid-template-columns:240px minmax(200px,1fr) 90px;width:100%;border:1px solid var(--border);border-radius:12px;padding:20px;background:var(--surface)}
</style>
