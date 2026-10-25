import { useLayoutEffect, type RefObject } from 'react'

/**
 * Keeps a single-row bar from overflowing. When the row is wider than its box, `data-fit` is set to each step
 * in turn (a space-separated list of tokens the CSS keys off with `[data-fit~='token']`) until it fits, so
 * longer labels in some languages give way in a set order instead of pushing controls off screen.
 *
 * Re-checks after every render and whenever the row or anything in it changes size. Uses an attribute
 * rather than a class so React's own className updates leave it alone.
 */
export const useFitSteps = (ref: RefObject<HTMLElement | null>, steps: string[], enabled = true, onFit?: (row: HTMLElement, step: string) => void) => {
    const key = steps.join('|')
    useLayoutEffect(() => {
        const row = ref.current
        if (!row) return
        if (!enabled) {
            delete row.dataset.fit
            return
        }
        const fit = () => {
            for (const step of ['', ...key.split('|')]) {
                if (step) row.dataset.fit = step
                else delete row.dataset.fit
                if (row.scrollWidth <= row.clientWidth + 1) break
            }
            onFit?.(row, row.dataset.fit || '')
        }
        fit()
        let frame = 0
        const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit) })
        observer.observe(row)
        Array.from(row.children).forEach((child) => observer.observe(child))
        return () => { observer.disconnect(); cancelAnimationFrame(frame) }
    })
}
