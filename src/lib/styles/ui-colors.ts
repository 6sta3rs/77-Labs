import type { ThemeColors } from '../themes/t3-palettes'

type Rgb = readonly [number, number, number]
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const mix = (a: Rgb, b: Rgb, amount: number): Rgb => a.map((value, index) => value * (1 - amount) + b[index] * amount) as unknown as Rgb
const hex = (rgb: Rgb) => '#' + rgb.map(value => Math.round(clamp(value) * 255).toString(16).padStart(2, '0')).join('')
const linear = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
const luminance = (rgb: Rgb) => linear(rgb[0]) * .2126 + linear(rgb[1]) * .7152 + linear(rgb[2]) * .0722
const contrast = (a: Rgb, b: Rgb) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)
const black: Rgb = [0, 0, 0], white: Rgb = [1, 1, 1]
let probe: CanvasRenderingContext2D | null | undefined

/** Literal built-in colors are resolved without a canvas; custom CSS colors use the browser. */
function rgb(css: string, backdrop: Rgb): Rgb {
  if (/^#[a-f\d]{6}$/i.test(css)) return [1, 3, 5].map(index => parseInt(css.slice(index, index + 2), 16) / 255) as unknown as Rgb
  if (/^#[a-f\d]{3}$/i.test(css)) return css.slice(1).split('').map(channel => parseInt(channel + channel, 16) / 255) as unknown as Rgb
  const match = css.match(/^oklch\(\s*([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)\s*\)$/i)
  if (match) {
    const [L, C, h] = match.slice(1).map(Number), a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180)
    const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.2914855480 * b) ** 3
    return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.7076147010 * s]
      .map(value => clamp(value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055)) as unknown as Rgb
  }
  if (typeof document !== 'undefined') {
    if (probe === undefined) { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; probe = canvas.getContext('2d', { willReadFrequently: true }) }
    if (probe) {
      probe.clearRect(0, 0, 1, 1); probe.fillStyle = hex(backdrop); probe.fillStyle = css; probe.fillRect(0, 0, 1, 1)
      const data = probe.getImageData(0, 0, 1, 1).data, alpha = data[3] / 255
      return [0, 1, 2].map(index => data[index] / 255 * alpha + backdrop[index] * (1 - alpha)) as unknown as Rgb
    }
  }
  return backdrop
}

/** Keep the original tone when possible; move only as far as needed for readable text. */
function readable(seed: Rgb, backgrounds: Rgb[], minimum = 4.7): string {
  const worst = (candidate: Rgb) => Math.min(...backgrounds.map(background => contrast(candidate, background)))
  if (worst(seed) >= minimum) return hex(seed)
  const end = worst(black) > worst(white) ? black : white
  let low = 0, high = 1
  for (let step = 0; step < 24; step++) {
    const middle = (low + high) / 2
    if (worst(mix(seed, end, middle)) >= minimum) high = middle
    else low = middle
  }
  return hex(mix(seed, end, high))
}

/** Derived UI roles leave the imported theme palette and neutral A+ selection intact. */
export function uiColorsForPalette(palette: ThemeColors, dark: boolean) {
  const canvas = rgb(palette.canvas, dark ? [10 / 255, 10 / 255, 10 / 255] : white)
  const backgrounds = [palette.surfaceOverlay, palette.surfaceRaised].flatMap(surface => {
    const color = rgb(surface, canvas)
    return [.7, .95, 1].map(alpha => mix(canvas, color, alpha))
  })
  const destructive = readable(rgb(palette.error, canvas), [white])
  return {
    overlayMuted: readable(rgb(palette.textMuted, canvas), backgrounds),
    overlayPlaceholder: readable(rgb(palette.placeholder, canvas), backgrounds),
    destructiveBackground: destructive,
    destructiveForeground: '#ffffff',
    destructiveHover: hex(mix(rgb(destructive, canvas), black, .08)),
    switchOnBackground: '#2563eb',
    switchOnForeground: '#ffffff',
  }
}
