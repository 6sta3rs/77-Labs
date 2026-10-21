import type { Render } from './data';
function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('voicestudio-next-library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('recordings', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function retentionRemovals(recordings: Render[], cap?: number): string[] {
  if (cap === undefined || cap === 0) return [];
  if (!Number.isInteger(cap) || cap < 0 || cap > 100000) throw new Error('Nieprawidłowy limit historii.');
  return recordings.filter(row => row.source === 'generation' && !row.starred)
    .sort((a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id))
    .slice(cap).map(row => row.id);
}

export async function saveRecording(recording: Render, cap?: number): Promise<string[]> {
  const database = await openLibrary();
  const { url: _url, ...serializable } = recording;
  let removed: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('recordings', 'readwrite');
    const store = transaction.objectStore('recordings');
    store.put(serializable);
    if (cap !== undefined && cap !== 0) {
      const all = store.getAll();
      all.onsuccess = () => {
        try { removed = retentionRemovals(all.result as Render[], cap); removed.forEach(id => store.delete(id)); }
        catch (error) { transaction.abort(); reject(error); }
      };
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => database.close());
  return removed;
}
export async function loadRecordings(): Promise<Render[]> {
  const database = await openLibrary();
  return new Promise<Render[]>((resolve, reject) => {
    const request = database.transaction('recordings').objectStore('recordings').getAll();
    request.onsuccess = () => resolve((request.result as Render[]).map(item => ({ ...item, url: item.blob ? URL.createObjectURL(item.blob) : undefined })).sort((a, b) => b.created.localeCompare(a.created)));
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}
export async function audioPeaks(blob: Blob, onDuration?: (duration:number)=>void): Promise<number[]> {
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    onDuration?.(buffer.duration);
    const data = buffer.getChannelData(0); const count = 48; const size = Math.max(1, Math.floor(data.length / count));
    const peaks = Array.from({ length: count }, (_, index) => {
      let peak = 0;
      for (let sample = index * size; sample < Math.min((index + 1) * size, data.length); sample += Math.max(1, Math.floor(size / 300))) peak = Math.max(peak, Math.abs(data[sample]));
      return peak;
    });
    const maximum = Math.max(...peaks, .001); return peaks.map(value => value / maximum);
  } catch { return []; } finally { if (context) await context.close().catch(() => {}); }
}
