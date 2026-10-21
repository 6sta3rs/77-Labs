import { invoke, isTauri } from '@tauri-apps/api/core';

export const licenseSourceHosts = ['github.com', 'huggingface.co', 'modelscope.cn'] as const;
const invalid = 'Otwórz prawidłowy odnośnik HTTPS do źródła warunków na GitHub, Hugging Face lub ModelScope.';

export function validateLicenseSource(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.trim() !== value || /[\u0000-\u001f\u007f-\u009f\\]/u.test(value)) throw new Error(invalid);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(invalid); }
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/iu.exec(value)?.[1];
  if (authority === undefined || authority.includes('@') || url.protocol !== 'https:' || url.username || url.password ||
      (url.port && url.port !== '443') || !(licenseSourceHosts as readonly string[]).includes(url.hostname) || url.href.length > 8192) throw new Error(invalid);
  return url.href;
}

/** Call only from an explicit click. Native success means Windows accepted
 * opening the URL; it is never evidence that the person read/accepted terms. */
export async function openLicenseSource(raw: string): Promise<void> {
  const url = validateLicenseSource(raw);
  if (isTauri()) {
    try { await invoke<void>('open_license_source', { url }); }
    catch (cause) { throw cause instanceof Error ? cause : new Error(typeof cause === 'string' ? cause : 'Nie otwarto strony warunków. Skopiuj odnośnik i otwórz go ręcznie.'); }
    return;
  }
  // Ordinary browser preview: keep the user gesture and never grant opener
  // access. A noopener window can return null even when opening succeeds.
  window.open(url, '_blank', 'noopener,noreferrer');
}
