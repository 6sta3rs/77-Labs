export type SpeechBlock = { id: string; voiceId: string; text: string };
/** Compare document values without allocating a serialized copy of every spoken character. */
export function sameSpeechBlocks(left: SpeechBlock[], right: SpeechBlock[] | null | undefined): boolean {
  return right != null && left.length === right.length && left.every((block, index) => {
    const other = right[index];
    return block.id === other.id && block.voiceId === other.voiceId && block.text === other.text;
  });
}
export type TagItem = { value: string; label: string; category: 'Pauzy' | 'Wokalizacje' | 'Reakcje'; description: string };

// This is deliberately a closed catalog of tokens accepted by the OmniVoice engine.
export const audioTags: TagItem[] = [
  { value: '[pause]', label: 'Pauza', category: 'Pauzy', description: 'Naturalna przerwa w wypowiedzi' },
  { value: '[pause 250ms]', label: 'Krótka pauza', category: 'Pauzy', description: 'Przerwa 250 ms' },
  { value: '[laughter]', label: 'Śmiech', category: 'Wokalizacje', description: 'Wokalizacja śmiechu' },
  { value: '[sigh]', label: 'Westchnienie', category: 'Wokalizacje', description: 'Wokalizacja westchnienia' },
  { value: '[confirmation-en]', label: 'Potwierdzenie · en', category: 'Reakcje', description: 'Krótki dźwięk potwierdzenia' },
  ...['en', 'ah', 'oh', 'ei', 'yi'].map(s => ({ value: `[question-${s}]`, label: `Pytanie · ${s}`, category: 'Reakcje' as const, description: 'Pytająca intonacja wokalizacji' })),
  ...['ah', 'oh', 'wa', 'yo'].map(s => ({ value: `[surprise-${s}]`, label: `Zaskoczenie · ${s}`, category: 'Reakcje' as const, description: 'Wokalizacja zaskoczenia' })),
  { value: '[dissatisfaction-hnn]', label: 'Niezadowolenie · hnn', category: 'Reakcje', description: 'Wokalizacja niezadowolenia' },
];

const supportedTags = new Set(audioTags.map(tag => tag.value));
export type SpeechToken = { text: string; isTag: boolean };

/** Unknown tokens remain ordinary text; Svelte renders all content as text nodes. */
export function tokenizeSpeech(text: string): SpeechToken[] {
  const tokens: SpeechToken[] = [];
  const boundary = /[\]\r\n]/g;
  let cursor = 0, plainStart = 0;
  while (cursor < text.length) {
    const start = text.indexOf('[', cursor);
    if (start === -1) break;
    boundary.lastIndex = start + 1;
    const end = boundary.exec(text);
    // Do not retry every opening bracket when a long pasted line has no closing one.
    if (!end) break;
    cursor = end.index + 1;
    if (end[0] !== ']' || end.index === start + 1) continue;
    if (start > plainStart) tokens.push({ text: text.slice(plainStart, start), isTag: false });
    const part = text.slice(start, cursor);
    tokens.push({ text: part, isTag: supportedTags.has(part) });
    plainStart = cursor;
  }
  if (plainStart < text.length) tokens.push({ text: text.slice(plainStart), isTag: false });
  return tokens;
}

/** Local, deterministic pause insertion. Does not rewrite the spoken words. */
export function autoTagText(text: string): string {
  const withEllipses = text.replace(/\.{3,}|…/g, (match, offset: number) => {
    const remaining = text.slice(offset + match.length);
    return /^\s*\[pause(?: \d+ms)?\]/.test(remaining) ? match : `${match}[pause]`;
  });
  return withEllipses.replace(/(?:\r?\n[\t ]*){2,}/g, (gap, offset: number) => {
    const before = withEllipses.slice(0, offset);
    const after = withEllipses.slice(offset + gap.length);
    if (!before.trim() || !after.trim() || /\[pause(?: \d+ms)?\]\s*$/.test(before) || /^\s*\[pause(?: \d+ms)?\]/.test(after)) return gap;
    return `[pause]${gap}`;
  });
}

export function insertAtSelection(text: string, tag: string, start: number, end: number): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  return { text: text.slice(0, from) + tag + text.slice(to), caret: from + tag.length };
}
