import { Easing, interpolate, useCurrentFrame } from 'remotion'
import { COLORS, LEAD_IN_FRAMES } from '../theme'

// Longest chunk shown at once; longer sentences break at the comma or colon nearest their middle.
const MAX_CHARS = 90

const splitLong = (sentence: string): string[] => {
  if (sentence.length <= MAX_CHARS) return [sentence]
  const breaks = [...sentence.matchAll(/[,:] /g)].map((match) => (match.index ?? 0) + 1)
  if (!breaks.length) return [sentence]
  const middle = sentence.length / 2
  const at = breaks.reduce((best, index) => (Math.abs(index - middle) < Math.abs(best - middle) ? index : best))
  return [...splitLong(sentence.slice(0, at).trim()), ...splitLong(sentence.slice(at).trim())]
}

const toChunks = (text: string): string[] => {
  const sentences = text.match(/[^.!?]+[.!?]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [text]
  return sentences.flatMap((sentence) => splitLong(sentence))
}

/**
 * Subtitles for viewers watching muted. The narration is split into sentences and each one is shown for a share
 * of the spoken time in proportion to its length, which tracks ElevenLabs' even delivery closely enough.
 */
export const Captions: React.FC<{ text: string; speechFrames: number; bottom?: number }> = ({ text, speechFrames, bottom = 36 }) => {
  const frame = useCurrentFrame() - LEAD_IN_FRAMES
  const sentences = toChunks(text)
  const total = sentences.reduce((sum, sentence) => sum + sentence.length, 0)

  let start = 0
  const timed = sentences.map((sentence) => {
    const length = (sentence.length / total) * speechFrames
    const span = { sentence, start, end: start + length }
    start += length
    return span
  })
  const current = timed.find((span) => frame >= span.start && frame < span.end)
  if (!current) return null

  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        key={current.start}
        style={{
          maxWidth: 1500,
          padding: '12px 26px',
          borderRadius: 14,
          background: 'rgba(11, 11, 18, 0.78)',
          border: `1px solid ${COLORS.border}`,
          fontSize: 34,
          lineHeight: 1.35,
          textAlign: 'center',
          color: COLORS.text,
          opacity: interpolate(frame, [current.start, current.start + 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) }),
        }}
      >
        {current.sentence}
      </div>
    </div>
  )
}
