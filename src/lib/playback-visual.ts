import type { Render } from './data';

/** The visualization represents the loaded audio, even after choosing another editor voice. */
export function playbackVoiceId(recording?: Render, fallback = 'voicestudio'): string {
  if (!recording?.url) return fallback;
  if (recording.voiceId) return recording.voiceId;
  const speakers = new Set(recording.blocks?.map(block => block.voiceId).filter(Boolean));
  if (speakers.size === 1) return [...speakers][0];
  return recording.voice || fallback;
}
