export type NeutralSelection = { background: string; foreground: string; border: string; hover: string }

/** The three A+ levels approved against #0A0A0A, #111111 and #181818. */
export function neutralSelectionForRgb(rgb: readonly number[], dark: boolean): NeutralSelection {
  if (!dark) return { background: '#e5e5e5', foreground: '#171717', border: '#c4c4c4', hover: '#dcdcdc' }
  const valid = rgb.length === 3 && rgb.every(Number.isFinite)
  const brightness = valid ? rgb.reduce((sum, channel) => sum + Math.min(255, Math.max(0, channel)), 0) / 3 : 10
  const [background, hover, border] = brightness <= 10
    ? ['#343434', '#242424', '#565656']
    : brightness <= 17 ? ['#3b3b3b', '#292929', '#606060'] : ['#444444', '#303030', '#6a6a6a']
  return { background, foreground: '#f5f5f5', border, hover }
}

let probe: CanvasRenderingContext2D | null | undefined
/** Resolve the actual palette literal, including OKLCH, without changing the DOM. */
export function neutralSelectionForColor(color: string, dark: boolean): NeutralSelection {
  if (!dark || typeof document === 'undefined') return neutralSelectionForRgb([10, 10, 10], dark)
  try {
    if (probe === undefined) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
      probe = canvas.getContext('2d', { willReadFrequently: true })
    }
    if (probe) {
      probe.clearRect(0, 0, 1, 1)
      probe.fillStyle = '#0a0a0a'; probe.fillStyle = color; probe.fillRect(0, 0, 1, 1)
      const rgba = probe.getImageData(0, 0, 1, 1).data, alpha = rgba[3] / 255
      return neutralSelectionForRgb([rgba[0], rgba[1], rgba[2]].map(value => value * alpha + 10 * (1 - alpha)), dark)
    }
  } catch { /* A missing color probe retains the approved darkest-background level. */ }
  return neutralSelectionForRgb([10, 10, 10], dark)
}
