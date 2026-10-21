import { request, type Profile } from '../platform/api';

/** Profile photos stay local; backend-provided URLs never select a remote host. */
export class VoicePortraits {
  private cache = new Map<string, { version: string; url: string }>();
  private sequence = 0;
  private disposed = false;
  async load(profiles: Profile[]): Promise<Map<string, string>> {
    const sequence = ++this.sequence;
    const next = new Map<string, { version: string; url: string }>();
    await Promise.all(profiles.filter(profile => profile.image_url).map(async profile => {
      const version = profile.image_url!;
      const cached = this.cache.get(profile.id);
      if (cached?.version === version) { next.set(profile.id, cached); return; }
      try {
        const response = await request(`/profiles/${encodeURIComponent(profile.id)}/image`, { signal: AbortSignal.timeout(3000) });
        if (!response.ok) return;
        const blob = await response.blob();
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(blob.type) || blob.size > 8 * 1024 * 1024) return;
        next.set(profile.id, { version, url: URL.createObjectURL(blob) });
      } catch { /* Missing photo retains the static voice identity. */ }
    }));
    if (this.disposed || sequence !== this.sequence) {
      for (const [id, value] of next) if (this.cache.get(id)?.url !== value.url) URL.revokeObjectURL(value.url);
      return new Map();
    }
    for (const [id, value] of this.cache) if (next.get(id)?.url !== value.url) URL.revokeObjectURL(value.url);
    this.cache = next;
    return new Map([...next].map(([id, value]) => [id, value.url]));
  }
  dispose() {
    this.disposed = true; this.sequence++;
    for (const value of this.cache.values()) URL.revokeObjectURL(value.url);
    this.cache.clear();
  }
}
