/** One pen sample: canvas position in CSS pixels and milliseconds since the signature began. */
export type SignaturePoint = { x: number, y: number, t: number }

/** The pen movement behind a drawn signature, so it can be replayed when the person signs. */
export type SignatureStrokes = {
    width: number
    height: number
    strokes: SignaturePoint[][]
}

/**
 * Firestore form. Firestore has no nested arrays, so each stroke is a compact "x,y,t;x,y,t" string.
 * A typical signature is a few hundred points, well under 20 KB.
 */
export type StoredSignatureStrokes = {
    version: 1
    width: number
    height: number
    strokes: string[]
}

/** Beyond this the signature is not worth storing as strokes; the image fallback replays instead. */
const MAX_POINTS = 4000

const round = (value: number) => Math.round(value * 10) / 10

/** Reads the point groups from signature_pad (react-signature-canvas `toData()`). */
export const captureSignatureStrokes = (
    groups: Array<Array<{ x: number, y: number, time: number }>>,
    width: number,
    height: number,
): SignatureStrokes | null => {
    const strokes = groups.filter(group => group.length > 0)
    const total = strokes.reduce((sum, group) => sum + group.length, 0)
    if (!strokes.length || !width || !height || total > MAX_POINTS) return null
    const start = strokes[0][0].time
    return {
        width: Math.round(width),
        height: Math.round(height),
        strokes: strokes.map(group => group.map(point => ({ x: round(point.x), y: round(point.y), t: Math.max(0, Math.round(point.time - start)) }))),
    }
}

export const encodeSignatureStrokes = (value: SignatureStrokes): StoredSignatureStrokes => ({
    version: 1,
    width: value.width,
    height: value.height,
    strokes: value.strokes.map(stroke => stroke.map(point => `${point.x},${point.y},${point.t}`).join(';')),
})

/** Accepts whatever is on the user doc; anything malformed reads as "no strokes". */
export const decodeSignatureStrokes = (value: unknown): SignatureStrokes | null => {
    if (!value || typeof value !== 'object') return null
    const stored = value as Partial<StoredSignatureStrokes>
    if (stored.version !== 1 || typeof stored.width !== 'number' || typeof stored.height !== 'number' || !Array.isArray(stored.strokes)) return null
    const strokes = stored.strokes
        .filter((stroke): stroke is string => typeof stroke === 'string' && stroke.length > 0)
        .map(stroke => stroke.split(';').map((point) => {
            const [x, y, t] = point.split(',').map(Number)
            return { x, y, t }
        }).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.t)))
        .filter(stroke => stroke.length > 0)
    return strokes.length ? { width: stored.width, height: stored.height, strokes } : null
}
