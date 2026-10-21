export const referenceAudioAccept = '.wav,.mp3,.m4a,.flac,.ogg,.oga,.opus,.aac,.webm';
export const referenceAudioExtensions = new Set(referenceAudioAccept.split(','));
export const maxReferenceBytes = 128 * 1024 * 1024;

export function referenceFileError(file: File): string {
  const extension = /\.[^.]+$/.exec(file.name)?.[0].toLowerCase() || '';
  if (!referenceAudioExtensions.has(extension)) return 'Wybierz obsługiwany format nagrania: WAV, MP3, M4A, FLAC, OGG, Opus, AAC lub WebM.';
  if (file.size < 1000) return 'Nagranie jest puste lub zbyt krótkie. Wybierz plik z wypowiedzianymi słowami.';
  if (file.size > maxReferenceBytes) return 'Nagranie przekracza limit 128 MB. Wybierz krótszy fragment.';
  return '';
}

export function referenceDurationWarning(duration?: number): string {
  if (!Number.isFinite(duration) || !duration || duration <= 0) return 'Nie udało się odczytać czasu nagrania. Sprawdź próbkę przed zapisem.';
  if (duration < 5) return 'Próbka jest krótka. Dla stabilniejszego brzmienia wybierz około 10–30 sekund wyraźnej mowy.';
  if (duration > 60) return 'Próbka jest długa. Fragment 10–30 sekund zwykle wystarczy i przyspieszy przygotowanie głosu.';
  return '';
}

/** Validate playable media, without opening AudioContext or buffering a decoded copy. */
export function inspectReference(file: File, signal?: AbortSignal): Promise<number | undefined> {
  signal?.throwIfAborted();
  const invalid = referenceFileError(file);
  if (invalid) return Promise.reject(new Error(invalid));
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancelled);
      audio.onloadedmetadata = null; audio.onerror = null;
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined;
      audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url);
      if (error) reject(error); else resolve(duration);
    };
    const cancelled = () => finish(signal?.reason instanceof Error ? signal.reason : new DOMException('Anulowano odczyt nagrania.', 'AbortError'));
    const timeout = setTimeout(() => finish(new Error('Nie można odczytać nagrania w ciągu 15 sekund. Wybierz inny plik.')), 15_000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish();
    audio.onerror = () => finish(new Error('Nie można odczytać nagrania. Wybierz poprawny plik audio w obsługiwanym formacie.'));
    signal?.addEventListener('abort', cancelled, { once: true });
    audio.src = url;
  });
}

export const profileLanguages = [
  { value: 'Auto', label: 'Automatycznie' },
  { value: 'Polish', label: 'Polski' }, { value: 'English', label: 'Angielski' },
  { value: 'German', label: 'Niemiecki' }, { value: 'French', label: 'Francuski' },
  { value: 'Spanish', label: 'Hiszpański' }, { value: 'Italian', label: 'Włoski' },
  { value: 'Portuguese', label: 'Portugalski' }, { value: 'Ukrainian', label: 'Ukraiński' },
  { value: 'Russian', label: 'Rosyjski' }, { value: 'Czech', label: 'Czeski' },
  { value: 'Dutch', label: 'Niderlandzki' }, { value: 'Swedish', label: 'Szwedzki' },
  { value: 'Arabic', label: 'Arabski' }, { value: 'Hindi', label: 'Hindi' },
  { value: 'Chinese', label: 'Chiński' }, { value: 'Japanese', label: 'Japoński' },
  { value: 'Korean', label: 'Koreański' }, { value: 'Turkish', label: 'Turecki' },
];
