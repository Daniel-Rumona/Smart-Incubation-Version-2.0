/**
 * The certificate's colours, taken from the training company's logo so every company's certificate carries its own
 * brand: the logo's main colour gives a dark shade (frame, title), a middle one and a light one (swooshes, lines) and
 * a pale tint (background). Gold stays the same for every company (highlights and the seal's rim). Pure functions, so
 * they also run under Node in tests.
 */

export type CertificatePalette = {
    dark: string
    mid: string
    light: string
    pale: string
    gold: string
    goldLight: string
    ink: string
    muted: string
}

const GOLD = '#b8962e'
const GOLD_LIGHT = '#e3c86b'
const INK = '#1f2a30'
const MUTED = '#5b6770'

/** HSL (hue 0-360, saturation and lightness 0-1) as a CSS hex colour. */
export const hslToHex = (hue: number, saturation: number, lightness: number) => {
    const s = Math.max(0, Math.min(1, saturation))
    const l = Math.max(0, Math.min(1, lightness))
    const k = (n: number) => (n + hue / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const channel = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))
    return `#${[channel(0), channel(8), channel(4)].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

export const rgbToHsl = (red: number, green: number, blue: number) => {
    const r = red / 255
    const g = green / 255
    const b = blue / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const lightness = (max + min) / 2
    if (max === min) return { hue: 0, saturation: 0, lightness }
    const delta = max - min
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
    const hue = max === r ? ((g - b) / delta + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / delta + 2) * 60 : ((r - g) / delta + 4) * 60
    return { hue, saturation, lightness }
}

/** The shades for one brand hue. */
export const paletteForHue = (hue: number, saturation: number): CertificatePalette => {
    const s = Math.max(0.35, Math.min(0.8, saturation))
    return {
        dark: hslToHex(hue, s, 0.22),
        mid: hslToHex(hue, s, 0.36),
        light: hslToHex(hue, Math.min(0.85, s + 0.05), 0.52),
        pale: hslToHex(hue, 0.35, 0.96),
        gold: GOLD,
        goldLight: GOLD_LIGHT,
        ink: INK,
        muted: MUTED,
    }
}

/** Without a logo (or one that cannot be read): the green the certificates have always used. */
export const DEFAULT_PALETTE: CertificatePalette = { ...paletteForHue(110, 0.42), dark: '#24502a', mid: '#2f6b2f', light: '#8dbf45' }

/** A logo with no colour of its own (black, grey): charcoal shades with the gold. */
export const NEUTRAL_PALETTE: CertificatePalette = { dark: '#1f2a30', mid: '#3b4a55', light: '#8a98a3', pale: '#f4f6f7', gold: GOLD, goldLight: GOLD_LIGHT, ink: INK, muted: MUTED }

/**
 * The palette for a logo's pixels (RGBA, as canvas getImageData gives them). The logo's main colour is the hue most
 * of its coloured pixels share (12° steps); white, near-black, grey and see-through pixels do not count.
 */
export const paletteFromPixels = (pixels: ArrayLike<number>): CertificatePalette => {
    const buckets = new Map<number, { count: number, saturation: number, hueX: number, hueY: number }>()
    let opaque = 0
    for (let index = 0; index + 3 < pixels.length; index += 4) {
        if (pixels[index + 3] < 180) continue
        opaque += 1
        const { hue, saturation, lightness } = rgbToHsl(pixels[index], pixels[index + 1], pixels[index + 2])
        if (lightness > 0.92 || lightness < 0.08 || saturation < 0.2) continue
        const key = Math.floor(hue / 12)
        const bucket = buckets.get(key) || { count: 0, saturation: 0, hueX: 0, hueY: 0 }
        bucket.count += 1
        bucket.saturation += saturation
        bucket.hueX += Math.cos((hue * Math.PI) / 180)
        bucket.hueY += Math.sin((hue * Math.PI) / 180)
        buckets.set(key, bucket)
    }
    const best = [...buckets.values()].sort((left, right) => right.count - left.count)[0]
    // A few coloured specks in a black or grey logo are not its colour.
    if (!best || best.count < Math.max(12, opaque * 0.04)) return opaque ? NEUTRAL_PALETTE : DEFAULT_PALETTE
    const hue = ((Math.atan2(best.hueY, best.hueX) * 180) / Math.PI + 360) % 360
    return paletteForHue(hue, best.saturation / best.count)
}
