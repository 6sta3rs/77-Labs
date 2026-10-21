import { request } from './api';
import { productionJson } from './production';
import { inspectReference, referenceFileError } from './voice-reference';

export type AudioPcm = { sampleRate: number; channels: Float32Array[] };
export type AudioMeasurements = { sampleRate: number; channels: number; frames: number; duration: number; peak: number; rms: number; clippedSamples: number };
export type AudioEdit = { start: number; end: number; gainDb: number; normalize: boolean; targetDb: number; fadeInMs: number; fadeOutMs: number };
export type AudioCatalog = { effects: Array<{id:string;label:string;description?:string}>; plugins: Array<{id?:string;display_name?:string;available?:boolean;is_local?:boolean;requires_api_key?:boolean}> };
export const defaultAudioEdit = (duration: number): AudioEdit => ({ start: 0, end: duration, gainDb: 0, normalize: false, targetDb: -2, fadeInMs: 0, fadeOutMs: 0 });
export function measureAudio(pcm: AudioPcm): AudioMeasurements {
  const frames = pcm.channels[0]?.length || 0;
  let peak = 0, squares = 0, clippedSamples = 0;
  for (const channel of pcm.channels) for (const raw of channel) { const value = Number.isFinite(raw) ? raw : 0; peak = Math.max(peak, Math.abs(value)); squares += value * value; if (Math.abs(value) >= 1) clippedSamples++; }
  return { sampleRate: pcm.sampleRate, channels: pcm.channels.length, frames, duration: frames / pcm.sampleRate, peak, rms: frames && pcm.channels.length ? Math.sqrt(squares / (frames * pcm.channels.length)) : 0, clippedSamples };
}
export function audioEditErrors(pcm: AudioPcm, edit: AudioEdit): string[] {
  const duration = (pcm.channels[0]?.length || 0) / pcm.sampleRate, errors: string[] = [];
  if (!Number.isFinite(pcm.sampleRate) || pcm.sampleRate <= 0 || !pcm.channels.length || pcm.channels.some(channel => channel.length !== pcm.channels[0].length)) errors.push('Nagranie nie zawiera poprawnych, równych kanałów PCM.');
  if (![edit.start, edit.end].every(Number.isFinite) || edit.start < 0 || edit.end <= edit.start || edit.end > duration + 1 / pcm.sampleRate) errors.push('Wybierz poprawny zakres nagrania: początek przed końcem, w obrębie pliku.');
  if (!Number.isFinite(edit.gainDb) || edit.gainDb < -60 || edit.gainDb > 24) errors.push('Głośność musi mieścić się w zakresie od −60 do +24 dB.');
  if (!Number.isFinite(edit.targetDb) || edit.targetDb < -24 || edit.targetDb > 0) errors.push('Szczyt normalizacji musi mieścić się w zakresie od −24 do 0 dBFS.');
  if (![edit.fadeInMs, edit.fadeOutMs].every(value => Number.isFinite(value) && value >= 0 && value <= Math.max(0, edit.end - edit.start) * 1000)) errors.push('Łagodne wejście i wyjście muszą mieścić się w długości wybranego fragmentu.');
  return errors;
}
export function processAudio(pcm: AudioPcm, edit: AudioEdit): { pcm: AudioPcm; measurements: AudioMeasurements; clippedBeforeLimit: number; silentNormalization: boolean } {
  const errors = audioEditErrors(pcm, edit); if (errors.length) throw new Error(errors.join('\n'));
  const first = Math.max(0, Math.floor(edit.start * pcm.sampleRate)), last = Math.min(pcm.channels[0].length, Math.ceil(edit.end * pcm.sampleRate));
  const channels = pcm.channels.map(channel => channel.slice(first, last));
  let peak = 0; for (const channel of channels) for (const value of channel) if (Number.isFinite(value)) peak = Math.max(peak, Math.abs(value));
  // Same silence floor as the backend's normalize_audio: never turn an empty
  // render/noise floor into loud hiss by normalizing it.
  const silentNormalization = edit.normalize && peak <= 10 ** (-50 / 20);
  const multiplier = edit.normalize ? silentNormalization ? 1 : 10 ** (edit.targetDb / 20) / peak : 10 ** (edit.gainDb / 20);
  const fadeIn = edit.fadeInMs * pcm.sampleRate / 1000, fadeOut = edit.fadeOutMs * pcm.sampleRate / 1000;
  let clippedBeforeLimit = 0;
  for (const channel of channels) for (let i = 0; i < channel.length; i++) {
    const envelope = Math.min(1, fadeIn > 0 ? i / fadeIn : 1, fadeOut > 0 ? (channel.length - 1 - i) / fadeOut : 1);
    const value = (Number.isFinite(channel[i]) ? channel[i] : 0) * multiplier * envelope;
    if (Math.abs(value) > 1) clippedBeforeLimit++;
    channel[i] = Math.max(-1, Math.min(1, value));
  }
  const result = { sampleRate: pcm.sampleRate, channels };
  return { pcm: result, measurements: measureAudio(result), clippedBeforeLimit, silentNormalization };
}
export function encodeAudioWav(pcm: AudioPcm): Blob {
  const channels = pcm.channels.length, frames = pcm.channels[0]?.length || 0;
  if (!channels || channels > 8 || !frames || pcm.channels.some(channel => channel.length !== frames) || !Number.isSafeInteger(pcm.sampleRate) || pcm.sampleRate <= 0) throw new Error('Nie można zapisać niepoprawnego nagrania PCM.');
  const bytes = new ArrayBuffer(44 + frames * channels * 2), view = new DataView(bytes);
  const ascii = (offset: number, value: string) => [...value].forEach((letter,i) => view.setUint8(offset+i, letter.charCodeAt(0)));
  ascii(0,'RIFF'); view.setUint32(4,bytes.byteLength-8,true); ascii(8,'WAVE'); ascii(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,channels,true); view.setUint32(24,pcm.sampleRate,true); view.setUint32(28,pcm.sampleRate*channels*2,true); view.setUint16(32,channels*2,true); view.setUint16(34,16,true); ascii(36,'data'); view.setUint32(40,frames*channels*2,true);
  let offset = 44;
  for (let i = 0; i < frames; i++) for (const channel of pcm.channels) { const raw = channel[i], value = Number.isFinite(raw) ? Math.max(-1,Math.min(1,raw)) : 0; view.setInt16(offset,Math.round(value*(value<0?32768:32767)),true); offset+=2; }
  return new Blob([bytes], { type: 'audio/wav' });
}
export async function decodeAudioFile(file: File, signal?: AbortSignal): Promise<AudioPcm> {
  const invalid = referenceFileError(file); if (invalid) throw new Error(invalid);
  const duration = await inspectReference(file, signal); signal?.throwIfAborted();
  if (duration && duration > 300) throw new Error('Lokalna obróbka obsługuje nagrania do 5 minut. Wybierz krótszy fragment.');
  const bytes = await file.arrayBuffer(); signal?.throwIfAborted();
  // Preserve PCM WAV's source rate; compressed inputs are decoded to the
  // studio's 24 kHz. The UI labels this as decoded PCM, not container metadata.
  const header = new DataView(bytes), isWav = bytes.byteLength >= 44 && String.fromCharCode(...new Uint8Array(bytes,0,4)) === 'RIFF' && String.fromCharCode(...new Uint8Array(bytes,8,4)) === 'WAVE';
  const wavRate = isWav ? header.getUint32(24,true) : 0;
  const sampleRate = wavRate >= 8000 && wavRate <= 96000 ? wavRate : 24000;
  const decoded = await new OfflineAudioContext(1,1,sampleRate).decodeAudioData(bytes); signal?.throwIfAborted();
  if (!decoded.length || decoded.length / decoded.sampleRate > 300 || decoded.length * decoded.numberOfChannels > 16_000_000) throw new Error('Nagranie przekracza limit lokalnej obróbki: 5 minut i 16 milionów próbek kanałów.');
  return { sampleRate: decoded.sampleRate, channels: Array.from({length:decoded.numberOfChannels}, (_,i) => decoded.getChannelData(i).slice()) };
}
export async function cleanAudio(file: File, signal?: AbortSignal) {
  const invalid = referenceFileError(file); if (invalid) throw new Error(invalid);
  const body = new FormData(); body.append('audio', file);
  const response = await request('/clean-audio', { method:'POST',body,signal }); signal?.throwIfAborted();
  if (!response.ok) throw new Error(`Nie udało się przygotować nagrania (${response.status}). ${(await response.text()).slice(0,250)}`);
  const blob = await response.blob(); signal?.throwIfAborted();
  if (!blob.size || !blob.type.startsWith('audio/')) throw new Error('Silnik nie zwrócił pliku audio.');
  const signature = new Uint8Array(await blob.slice(0,12).arrayBuffer()); signal?.throwIfAborted();
  if (signature.length < 12 || String.fromCharCode(...signature.slice(0,4)) !== 'RIFF' || String.fromCharCode(...signature.slice(8,12)) !== 'WAVE') throw new Error('Silnik nie zwrócił poprawnego kontenera WAV. Plik źródłowy pozostaje dostępny do odsłuchu.');
  return { blob, filename: /^mic_[a-zA-Z0-9_-]+\.wav$/.test(response.headers.get('X-Clean-Filename') || '') ? response.headers.get('X-Clean-Filename')! : 'mowa-po-przetworzeniu.wav', conversionFallback: response.headers.get('X-Clean-Conversion') === 'fallback' };
}
export async function audioCatalog(signal?: AbortSignal): Promise<AudioCatalog> {
  const [effects, plugins] = await Promise.all([productionJson<AudioCatalog['effects']>('/tools/effects', { signal }), productionJson<AudioCatalog['plugins']>('/tools/plugins', { signal })]);
  return { effects, plugins };
}
