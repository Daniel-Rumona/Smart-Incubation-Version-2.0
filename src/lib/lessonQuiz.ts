export const QUIZ_LABEL = 'Quiz me on this lesson'
export const NEXT_QUIZ_LABEL = 'Next question'

/** Sent to the assistant instead of the short label the learner sees. */
export const QUIZ_PROMPT = 'Ask me ONE new multiple-choice question about this lesson, different from any you have already asked. Reply with ONLY a JSON object, no other text and no markdown fences, in exactly this shape: {"question":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"one short sentence on why that answer is right"}. Use 4 options and vary which position is correct.'

export type ChatQuiz = {
    question: string
    options: string[]
    correctIndex: number
    explanation: string
}

/** The assistant is asked for JSON; anything that isn't a valid question is left to render as normal text. */
export const parseChatQuiz = (content: string): ChatQuiz | null => {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) return null

    try {
        const data = JSON.parse(match[0]) as Partial<ChatQuiz>
        if (typeof data.question !== 'string' || !Array.isArray(data.options)) return null
        const options = data.options.filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
        const correctIndex = Number(data.correctIndex)
        if (options.length < 2 || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) return null
        return { question: data.question, options, correctIndex, explanation: typeof data.explanation === 'string' ? data.explanation : '' }
    } catch {
        return null
    }
}

const LETTERS = 'abcdef'

// Speech recognition rarely hears a bare letter cleanly, so accept what it tends to produce.
const SPOKEN_LETTERS: Record<string, number> = {
    a: 0, eh: 0, ay: 0, hey: 0,
    b: 1, be: 1, bee: 1,
    c: 2, see: 2, sea: 2, si: 2,
    d: 3, dee: 3, de: 3,
    e: 4, f: 5,
}

const SPOKEN_ORDINALS: Record<string, number> = {
    first: 0, one: 0, '1': 0, second: 1, two: 1, '2': 1, third: 2, three: 2, '3': 2, fourth: 3, four: 3, '4': 3, fifth: 4, five: 4, sixth: 5, six: 5,
}

const FILLER = new Set(['i', 'think', 'its', "it's", 'is', 'the', 'answer', 'option', 'choice', 'letter', 'number', 'one', 'ones', 'pick', 'choose', 'go', 'with', 'say', 'would', 'guess', 'my', 'final', 'so', 'um', 'uh', 'it', 'be', 'maybe', 'probably'])

const tokens = (text: string) => text.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean)

/**
 * Works out which option a typed or spoken reply picks: a letter ("D", "option D"),
 * an ordinal ("the fourth one"), or the option's own words. Returns undefined when
 * the reply isn't clearly an answer, so it goes to the assistant as a normal message.
 */
export const matchQuizAnswer = (reply: string, quiz: ChatQuiz): number | undefined => {
    const words = tokens(reply)
    if (!words.length) return undefined
    // A question about the material is a question, even if it borrows an option's words.
    if (/^(why|what|how|explain|can|could|does|do|who|when|where|tell|help)$/.test(words[0]) || reply.includes('?')) return undefined

    // A bare "one" means the first option; anywhere else it is just filler ("the fourth one").
    if (words.length === 1 && words[0] === 'one') return 0
    const meaningful = words.filter((word) => !FILLER.has(word))
    if (meaningful.length === 1) {
        const word = meaningful[0]
        const index = word in SPOKEN_LETTERS ? SPOKEN_LETTERS[word] : SPOKEN_ORDINALS[word]
        if (index !== undefined && index < quiz.options.length) return index
    }

    if (words.length > 3) {
        const spoken = new Set(words)
        let best = -1
        let bestScore = 0
        let secondScore = 0
        quiz.options.forEach((option, index) => {
            const optionWords = tokens(option).filter((word) => word.length > 2)
            if (!optionWords.length) return
            const score = optionWords.filter((word) => spoken.has(word)).length / optionWords.length
            if (score > bestScore) { secondScore = bestScore; best = index; bestScore = score } else if (score > secondScore) secondScore = score
        })
        // Clearly closest to one option, not merely sharing common words with several.
        if (best >= 0 && bestScore >= 0.6 && bestScore - secondScore >= 0.25) return best
    }

    return undefined
}

export const optionLetter = (index: number) => LETTERS[index]?.toUpperCase() ?? ''

export const quizSpeech = (quiz: ChatQuiz) =>
    `${quiz.question} ${quiz.options.map((option, index) => `${'ABCDEF'[index]}. ${option}.`).join(' ')}`
