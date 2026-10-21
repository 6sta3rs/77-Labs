import type { Engine } from './studio-tools';

/** Fictional picker previews; never install a package or report live readiness. */
export const extraTtsDemoEngines: Engine[] = [
  {id:'chatterbox-multilingual',display_name:'Chatterbox Multilingual V3 · przykład',description:'Przykład narracji po polsku z klonowaniem głosu.',available:true,installed:true,supports_cloning:true,supported_language_names:['Polish','English','German','French','Spanish']},
  {id:'kokoro',display_name:'Kokoro-82M · przykład',description:'Przykład gotowego głosu dobranego do języka, bez klonowania profilu.',available:true,installed:true,supports_cloning:false,supported_language_names:['English','Spanish','French','Hindi','Italian','Portuguese']},
  {id:'kittentts',display_name:'KittenTTS 0.8 Mini · przykład',description:'Przykład lekkiej syntezy angielskiej na CPU z gotowym głosem.',available:true,installed:true,supports_cloning:false,supported_language_names:['English']},
  {id:'kittentts2',display_name:'KittenTTS 2 · przykład',description:'Przykład klonowania z tekstem referencji. W rzeczywistym silniku wymaga osobnych warunków wag.',available:true,installed:true,supports_cloning:true,supported_language_names:['English','French','German','Spanish'],license_required:true,license_accepted:false},
  {id:'qwen3-tts',display_name:'Qwen3-TTS Base 0.6B · przykład',description:'Przykład klonowania głosu w obsługiwanych językach, bez polskiego.',available:true,installed:true,supports_cloning:true,supported_language_names:['English','Chinese','German','French','Spanish']},
  {id:'qwen3-tts-1.7b',display_name:'Qwen3-TTS Base 1.7B · przykład',description:'Przykład większego wariantu modelu do klonowania głosu.',available:true,installed:true,supports_cloning:true,supported_language_names:['English','Chinese','German','French','Spanish']},
  {id:'qwen3-voice-design',display_name:'Qwen3-TTS VoiceDesign · przykład',description:'Przykład modelu, który tworzy głos z opisu; nie klonuje wybranego profilu.',available:true,installed:true,supports_cloning:false,supported_language_names:['English','Chinese','German','French','Spanish']},
  {id:'fish-s2-pro',display_name:'Fish S2 Pro · przykład',description:'Przykład modelu po polsku z osobną usługą Linux/WSL i warunkami licencji.',available:true,installed:true,supports_cloning:true,supported_language_names:['Polish','English','German','French'],license_required:true,license_accepted:false},
];
