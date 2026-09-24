/**
 * Strips what a text-to-speech voice would otherwise mangle: markdown markers
 * (read aloud as symbols or odd noises), quotation marks, list bullets and raw
 * line breaks. What remains is plain sentences with punctuation for pauses.
 */
export const toSpeakable = (text: string) => text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/[“”"«»„]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[*_#~|<>]/g, ' ')
    .replace(/([.!?:;,])\s*\n+\s*/g, '$1 ')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim()

/**
 * Splits speakable text into sentence-sized chunks so playback can start on
 * the first one while the rest are still being synthesised. The first chunk is
 * kept short to start quickly.
 */
export const splitForSpeech = (text: string) => {
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean)
    const chunks: string[] = []
    let buffer = ''

    sentences.forEach((sentence) => {
        buffer = buffer ? `${buffer} ${sentence}` : sentence
        const target = chunks.length === 0 ? 50 : 130
        if (buffer.length >= target) {
            chunks.push(buffer)
            buffer = ''
        }
    })

    if (buffer) chunks.push(buffer)
    return chunks
}
