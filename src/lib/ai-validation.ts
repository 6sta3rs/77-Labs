import { audioTags } from './tags';

const supported = new Set(audioTags.map(tag => tag.value));
const tags = (text: string): string[] => text.match(/\[[^\]\r\n]+\]/g) ?? [];
const tokens = (text: string): string[] => text.match(/\[[^\]\r\n]+\]|\S/gu) ?? [];
const plain = (text: string) => text.replace(/\[[^\]\r\n]+\]/g, tag => supported.has(tag) ? '' : tag).replace(/\s+/g, ' ').trim();

/** A malformed/provider response must never overwrite the document. */
export function validateTaggedTexts(before: string[], after: unknown): asserts after is string[] {
  if (!Array.isArray(after) || after.length !== before.length || after.some(text => typeof text !== 'string')) throw new Error('AI zwróciło nieprawidłowe bloki tekstu.');
  if (after.join('\n\n').length > 10000) throw new Error('Tekst z tagami przekracza 10 000 znaków.');
  before.forEach((text, index) => {
    if (!text.trim() && after[index].trim()) throw new Error('AI dodało treść do pustego bloku mówcy.');
    const existing = tags(text); const returned = tags(after[index]);
    if (returned.some(tag => !supported.has(tag) && !existing.includes(tag))) throw new Error('Wynik zawiera tag nieobsługiwany przez OmniVoice.');
    const source = tokens(text); let cursor = 0;
    for (const token of tokens(after[index])) {
      if (source[cursor] === token) cursor++;
      else if (!supported.has(token)) throw new Error('AI zmieniło tekst lub położenie istniejących tagów.');
    }
    if (cursor !== source.length) throw new Error('AI usunęło tekst lub istniejące tagi.');
    if (plain(text) !== plain(after[index])) throw new Error('AI zmieniło tekst. Wynik odrzucono.');
  });
}
