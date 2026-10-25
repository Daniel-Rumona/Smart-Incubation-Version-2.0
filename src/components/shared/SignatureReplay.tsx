import { useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import type { SignatureStrokes } from '@/utils/signatureStrokes'

import '@/styles/signature-replay.css'

type SignatureReplayProps = {
    /** Recorded pen movement. Without it the stored image is revealed left to right instead. */
    strokes?: SignatureStrokes | null
    imageUrl?: string | null
    /** Nothing shows until this turns true; turning it false clears the line again. */
    playing: boolean
    onComplete?: () => void
    alt: string
    className?: string
}

/** Pen lifts longer than this are shortened: the hesitation reads as lag, not as handwriting. */
const MAX_PAUSE_MS = 160
/** Long signatures are sped up to land within this; short ones keep their real pace. */
const MAX_DURATION_MS = 2200
const PADDING = 6

type TimedStroke = { points: Array<{ x: number, y: number, t: number }>, start: number, end: number }

/** Quadratic curves through the midpoints, so the replay is as smooth as the pad's own rendering. */
const pathFor = (points: Array<{ x: number, y: number }>) => {
    if (!points.length) return ''
    const [first] = points
    if (points.length === 1) return `M${first.x} ${first.y}l0.01 0`
    let d = `M${first.x} ${first.y}`
    for (let index = 1; index < points.length - 1; index += 1) {
        const point = points[index]
        const next = points[index + 1]
        d += `Q${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`
    }
    const last = points[points.length - 1]
    return `${d}L${last.x} ${last.y}`
}

/** Shortens pen lifts, then scales the whole timeline to fit the duration budget. */
const buildTimeline = (value: SignatureStrokes) => {
    let shift = 0
    let previousEnd = 0
    const raw = value.strokes.map((stroke, index) => {
        const gap = stroke[0].t - previousEnd
        if (index > 0 && gap > MAX_PAUSE_MS) shift += gap - MAX_PAUSE_MS
        previousEnd = stroke[stroke.length - 1].t
        return stroke.map(point => ({ ...point, t: point.t - shift }))
    })
    const total = Math.max(1, raw[raw.length - 1].at(-1)?.t ?? 1)
    const scale = total > MAX_DURATION_MS ? MAX_DURATION_MS / total : 1
    const strokes: TimedStroke[] = raw.map((points) => {
        const scaled = points.map(point => ({ ...point, t: point.t * scale }))
        return { points: scaled, start: scaled[0].t, end: scaled[scaled.length - 1].t }
    })
    return { strokes, duration: total * scale }
}

/** Crops to the ink, so the signature fills the line instead of the canvas it was drawn on. */
const viewBoxFor = (value: SignatureStrokes) => {
    const points = value.strokes.flat()
    const xs = points.map(point => point.x)
    const ys = points.map(point => point.y)
    const minX = Math.min(...xs) - PADDING
    const minY = Math.min(...ys) - PADDING
    return `${minX} ${minY} ${Math.max(...xs) - minX + PADDING} ${Math.max(...ys) - minY + PADDING}`
}

/**
 * Writes a signature onto a line, replaying the pen movement recorded when it was set up. Older,
 * typed and uploaded signatures have no strokes, so their image is revealed left to right like ink
 * going down. Reduced motion shows the finished signature straight away.
 */
export default function SignatureReplay({ strokes, imageUrl, playing, onComplete, alt, className = '' }: SignatureReplayProps) {
    const reduce = useReducedMotion()
    const timeline = useMemo(() => (strokes ? buildTimeline(strokes) : null), [strokes])
    const viewBox = useMemo(() => (strokes ? viewBoxFor(strokes) : ''), [strokes])
    const pathRefs = useRef<Array<SVGPathElement | null>>([])
    const completeRef = useRef(onComplete)
    const [imageState, setImageState] = useState<'loading' | 'ready' | 'failed'>('loading')

    useEffect(() => { completeRef.current = onComplete }, [onComplete])

    // Stroke replay: paths are written straight to the DOM each frame, so React does not re-render 60 times a second.
    useEffect(() => {
        if (!timeline) return
        const paths = pathRefs.current
        if (!playing) {
            paths.forEach(path => path?.setAttribute('d', ''))
            return
        }
        if (reduce) {
            timeline.strokes.forEach((stroke, index) => paths[index]?.setAttribute('d', pathFor(stroke.points)))
            const timeout = window.setTimeout(() => completeRef.current?.(), 200)
            return () => window.clearTimeout(timeout)
        }

        let frame = 0
        let started = 0
        const drawn = new Set<number>()
        const tick = (now: number) => {
            if (!started) started = now
            const elapsed = now - started
            timeline.strokes.forEach((stroke, index) => {
                if (drawn.has(index) || elapsed < stroke.start) return
                const path = paths[index]
                if (elapsed >= stroke.end) {
                    path?.setAttribute('d', pathFor(stroke.points))
                    drawn.add(index)
                    return
                }
                // The points already reached, plus where the pen is between the last one and the next.
                const reached = stroke.points.filter(point => point.t <= elapsed)
                const next = stroke.points[reached.length]
                const last = reached[reached.length - 1]
                if (next && last && next.t > last.t) {
                    const progress = (elapsed - last.t) / (next.t - last.t)
                    reached.push({ x: last.x + (next.x - last.x) * progress, y: last.y + (next.y - last.y) * progress, t: elapsed })
                }
                path?.setAttribute('d', pathFor(reached))
            })
            if (elapsed >= timeline.duration) {
                completeRef.current?.()
                return
            }
            frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
    }, [timeline, playing, reduce])

    // Image fallback: the CSS reveal starts once the image has loaded and its animationend reports back.
    // With no image, or one that will not load, there is nothing to wait for.
    useEffect(() => {
        if (!timeline && playing && (!imageUrl || imageState === 'failed')) completeRef.current?.()
    }, [timeline, playing, imageUrl, imageState])

    if (timeline) {
        return (
            <svg className={`signature-replay ${className}`.trim()} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label={alt}>
                {timeline.strokes.map((_, index) => (
                    <path key={index} ref={(node) => { pathRefs.current[index] = node }} d={playing && reduce ? pathFor(timeline.strokes[index].points) : ''} />
                ))}
            </svg>
        )
    }

    if (!imageUrl) return null
    const revealing = playing && imageState === 'ready'
    return (
        <img
            className={`signature-replay signature-replay-image${revealing ? (reduce ? ' is-shown' : ' is-revealing') : ''} ${className}`.trim()}
            src={imageUrl}
            alt={alt}
            onLoad={() => setImageState('ready')}
            onError={() => setImageState('failed')}
            onAnimationEnd={() => completeRef.current?.()}
        />
    )
}
