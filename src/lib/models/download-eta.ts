/** Download speed and ETA derived from successive byte counts (the engine reports bytes only). No imports: tested standalone. */
export type EtaSample = { t: number; bytes: number };
export type DownloadEta = { samples: EtaSample[]; speed?: number; eta?: number };

const WINDOW = 6;
const MIN_SPAN_MS = 1000;

/** Adds a sample and returns bytes/s averaged over the last few samples, plus seconds left when the total is known. */
export function nextEta(samples: EtaSample[], bytes: number, total: number | null | undefined, now: number): DownloadEta {
  const last = samples.at(-1);
  // A smaller count means the job restarted; a repeated timestamp adds no information.
  const kept = last && bytes < last.bytes ? [] : last && now <= last.t ? samples.slice(0, -1) : samples;
  const window = [...kept, { t: now, bytes }].slice(-WINDOW);
  const first = window[0], end = window[window.length - 1];
  const span = end.t - first.t;
  const speed = span >= MIN_SPAN_MS && end.bytes > first.bytes ? (end.bytes - first.bytes) / (span / 1000) : undefined;
  const eta = speed && total && total > bytes ? (total - bytes) / speed : undefined;
  return { samples: window, speed, eta };
}

type Translate = (text: string, params?: Record<string, string>) => string;

export function etaTime(seconds: number, tr: Translate) {
  if (seconds < 60) return tr('{n} s', { n: String(Math.max(1, Math.round(seconds))) });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return tr('{n} min', { n: String(minutes) });
  return tr('{h} h {m} min', { h: String(Math.floor(minutes / 60)), m: String(minutes % 60) });
}

/** "12,4 MB/s · pozostało ok. 3 min"; empty until a speed is known. */
export function rateText(info: { speed?: number; eta?: number } | undefined, tr: Translate, fmtBytes: (bytes: number) => string) {
  if (!info?.speed) return '';
  return [`${fmtBytes(info.speed)}/s`, info.eta !== undefined ? tr('pozostało ok. {time}', { time: etaTime(info.eta, tr) }) : ''].filter(Boolean).join(' · ');
}
