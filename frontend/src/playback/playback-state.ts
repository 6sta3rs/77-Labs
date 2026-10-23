export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
export type PlaybackState = {
  status: PlaybackStatus
  currentTime: number
  duration: number
  error?: string
}
export const idlePlaybackState = (): PlaybackState => ({ status: 'idle', currentTime: 0, duration: 0 })
export function playbackStatusLabel(status: PlaybackStatus): string {
  return { idle: 'Gotowe do odtwarzania', loading: 'Wczytywanie audio…', playing: 'Odtwarzanie', paused: 'Wstrzymano', ended: 'Odtwarzanie zakończone', error: 'Błąd odtwarzania' }[status]
}
