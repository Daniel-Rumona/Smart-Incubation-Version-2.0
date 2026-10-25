import { useEffect, useState } from 'react'

type TypingGreetingProps = {
    /** The fixed start, e.g. "Daniel, ready to work on". */
    lead: string
    /** The phrases typed after it, one at a time. */
    words: string[]
}

const TYPE_MS = 55
const DELETE_MS = 28
const HOLD_MS = 2200
const GAP_MS = 350

const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * "Ready to work on ___?" with the blank typed, held, backspaced and replaced by the next phrase.
 * Screen readers get the whole sentence once; reduced motion swaps whole phrases without typing.
 */
export function TypingGreeting({ lead, words }: TypingGreetingProps) {
    const [index, setIndex] = useState(0)
    const [length, setLength] = useState(0)
    const [deleting, setDeleting] = useState(false)
    const reduced = prefersReducedMotion()
    const word = words[index % Math.max(words.length, 1)] || ''

    // A new set of phrases (role or language change) starts again from the first.
    const wordsKey = words.join('|')
    useEffect(() => {
        setIndex(0)
        setLength(0)
        setDeleting(false)
    }, [wordsKey])

    useEffect(() => {
        if (!word) return
        if (reduced) {
            if (words.length < 2) return
            const timer = window.setTimeout(() => setIndex((value) => value + 1), HOLD_MS + 1200)
            return () => window.clearTimeout(timer)
        }
        let delay = deleting ? DELETE_MS : TYPE_MS
        if (!deleting && length === word.length) delay = words.length > 1 ? HOLD_MS : -1
        if (deleting && length === 0) delay = GAP_MS
        if (delay < 0) return
        const timer = window.setTimeout(() => {
            if (!deleting && length === word.length) setDeleting(true)
            else if (deleting && length === 0) {
                setDeleting(false)
                setIndex((value) => value + 1)
            } else setLength((value) => value + (deleting ? -1 : 1))
        }, delay)
        return () => window.clearTimeout(timer)
    }, [word, length, deleting, reduced, words.length])

    const typed = reduced ? word : word.slice(0, length)
    const spoken = `${lead} ${words.join(', ')}?`

    return (
        <span className="typing-greeting" aria-label={spoken} role="text">
            <span aria-hidden="true">
                {lead}{' '}
                <span className="typing-greeting-word">{typed}</span>
                <span className={`typing-greeting-caret${deleting || length < word.length ? ' is-typing' : ''}`} />
                ?
            </span>
        </span>
    )
}
