import { mount, unmount, tick } from 'svelte';
import OrbPreview from './orb-preview.svelte';
import VoiceOrb from '../src/lib/VoiceOrb.svelte';
import { voiceIdentity } from '../src/lib/voice-orb';
import { applyAppearance, defaultAppearance } from '../src/lib/appearance';
import '../src/styles.css';

applyAppearance({...defaultAppearance,mode:'dark',reduceMotion:false});
const preview=mount(OrbPreview,{target:document.getElementById('orb-preview')});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const large=()=>document.querySelector('#orb-test-large .voice-orb');
const count=()=>Number(large()?.querySelector('canvas')?.dataset.frames||0);
async function advances(previous){for(let attempt=0;attempt<25&&count()<=previous;attempt++)await delay(100);return count()>previous;}
const checks=[];
function check(name,condition,detail){checks.push({name,pass:!!condition,...detail?{detail}:{}});if(!condition)throw new Error(name);}
const output=document.getElementById('orb-results');
const start=document.getElementById('orb-start');
start.onclick=async()=>{
  start.disabled=true;checks.length=0;output.textContent='Sprawdzanie reakcji na ton i ciszę…';
  window.scrollTo(0,0);
  const previousMotion=document.documentElement.dataset.reducedMotion;
  try{
    check('WebGL shader compiled',large()?.dataset.renderer==='webgl');
    await delay(150);const before=count();check('Idle animation advances',await advances(before),{before,after:count()});
    check('Same voice has stable seed',voiceIdentity('orb-test-a').seed===voiceIdentity('orb-test-a').seed);
    check('Different voices have distinct seeds',voiceIdentity('orb-test-a').seed!==voiceIdentity('orb-test-b').seed);
    await preview.startSignal();await delay(4500);
    const readings=preview.readings();
    const tone=readings.filter(row=>row.time>.25&&row.time<1.7),silence=readings.filter(row=>row.time>3&&row.time<4.4);
    check('Real audio produces measured level',tone.length>0&&tone.some(row=>row.level>.2),{samples:tone.length,peak:Math.max(0,...tone.map(row=>row.level))});
    check('Silence returns near zero',silence.length>0&&silence.every(row=>row.level<.015),{samples:silence.length,peak:Math.max(0,...silence.map(row=>row.level))});
    check('Web Audio analyser available',readings.some(row=>row.available));
    await preview.pause();await delay(80);check('Pause clears audio activity',!preview.activitySnapshot().playing&&preview.activitySnapshot().level===0);
    document.documentElement.dataset.reducedMotion='true';await delay(100);const reduced=count();await delay(180);check('Reduced motion stops rendering',count()===reduced);
    if(previousMotion===undefined)delete document.documentElement.dataset.reducedMotion;else document.documentElement.dataset.reducedMotion=previousMotion;
    check('Animation resumes after motion preference changes',await advances(reduced));
    const region=document.getElementById('orb-test-large');region.style.display='none';await delay(150);const hidden=count();await delay(150);check('Offscreen orb stops rendering',count()===hidden);region.style.display='';check('Visible orb resumes rendering',await advances(hidden));
    preview.selectVoice('orb-test-b');await tick();check('Voice change updates visual identity',large()?.dataset.voice==='orb-test-b');
    const target=document.createElement('div');target.style.cssText='width:80px;height:80px';document.body.appendChild(target);
    const original=HTMLCanvasElement.prototype.getContext;
    let fallback;
    try{HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'?null:original.call(this,type,...args);};fallback=mount(VoiceOrb,{target,props:{voiceId:'fallback-test',size:80}});await tick();await delay(50);check('No WebGL uses visible fallback',target.querySelector('.voice-orb')?.dataset.renderer==='fallback');}
    finally{HTMLCanvasElement.prototype.getContext=original;if(fallback)await unmount(fallback);target.remove();}
    await preview.startSignal();for(let attempt=0;attempt<25&&!preview.readings().some(row=>row.available&&row.level>.1);attempt++)await delay(100);check('Source replacement still plays and measures',preview.readings().some(row=>row.available&&row.level>.1));await preview.pause();
    const result={date:'2026-10-19',checks,passed:checks.filter(row=>row.pass).length,failed:checks.filter(row=>!row.pass).length,realSignal:true,speechSynthesis:false};
    output.textContent=JSON.stringify(result,null,2);output.dataset.status='passed';
  }catch(error){output.textContent=JSON.stringify({checks,error:String(error)},null,2);output.dataset.status='failed';}
  finally{if(previousMotion===undefined)delete document.documentElement.dataset.reducedMotion;else document.documentElement.dataset.reducedMotion=previousMotion;start.disabled=false;}
};
document.getElementById('orb-play').onclick=()=>preview.startSignal();
