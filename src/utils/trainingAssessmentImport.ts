import PizZip from 'pizzip'

/**
 * Reads an assessment written in Word into a draft the facilitator reviews before saving:
 *  - numbered questions ("1. What does ESG stand for? Answer: ____"),
 *  - multiple-choice options under a question, lettered "a) ...", "b. ...", "(c) ..." (typed or Word's own lettered
 *    list); an option marked with * or "(correct)" is the correct one,
 *  - then a numbered memo, recognised where the numbering starts again ("1. Environmental, Social and Governance.",
 *    or for a multiple-choice question its letter: "2. b"),
 *  - then, optionally, the group case brief (the paragraph after a heading mentioning a case or assignment) and a
 *    rubric table whose second column holds each criterion's marks.
 * Word's automatic numbering is read from the document's numbering definitions, so "1." and "a)" count whether they
 * were typed or made by Word. Nothing is saved from here; anything the layout did not reveal is simply left for the
 * facilitator to fill in.
 */

export type ImportedQuestion = {
    text: string
    marks: number
    /** For a multiple-choice question, the correct option's text (when the document gives it). */
    memo: string
    type?: 'choice'
    options?: string[]
}

export type ImportedAssessment = {
    title?: string
    durationMinutes?: number
    questions: ImportedQuestion[]
    caseBrief?: string
    rubric: Array<{ label: string, maxMarks: number, guidance?: string }>
}

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const NUMBERED = /^\s*(\d{1,3})\s*[.)]\s*(.+)$/
const OPTION = /^\s*\(?([a-jA-J])\s*[.)]\s+(.+)$/
const TABLE_ROW = /^\|(.*)\|$/
const CORRECT_MARK = /(^\*\s*|\s*\*$|\s*\((?:correct|answer)\)$|\s*[✓✔]$)/i

const textOf = (node: Element) => Array.from(node.getElementsByTagNameNS(WORD_NS, 't')).map((part) => part.textContent || '').join('')
const attr = (node: Element | undefined, name: string) => node?.getAttributeNS(WORD_NS, name) ?? node?.getAttribute(`w:${name}`) ?? null
const child = (node: Element | undefined, name: string) => node ? Array.from(node.children).find((item) => item.localName === name) : undefined

type Level = { format: string, text: string, start: number }

const roman = (value: number) => {
    const table: Array<[number, string]> = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
    let rest = value
    let out = ''
    for (const [size, letters] of table) {
        while (rest >= size) { out += letters; rest -= size }
    }
    return out
}

const formatNumber = (value: number, format: string) => {
    if (format === 'lowerLetter') return String.fromCharCode(96 + ((value - 1) % 26) + 1)
    if (format === 'upperLetter') return String.fromCharCode(64 + ((value - 1) % 26) + 1)
    if (format === 'lowerRoman') return roman(value)
    if (format === 'upperRoman') return roman(value).toUpperCase()
    return String(value)
}

/**
 * Word's list numbering: for each list (numId), the format of each level ("%1.", "%2)") from numbering.xml, so the
 * label Word shows ("3.", "b)") can be put back in front of the paragraph's text.
 */
const readNumbering = (xml: string | undefined) => {
    const lists = new Map<string, { levels: Map<number, Level>, starts: Map<number, number> }>()
    if (!xml) return lists
    const root = new DOMParser().parseFromString(xml, 'application/xml')
    const abstracts = new Map<string, Map<number, Level>>()
    Array.from(root.getElementsByTagNameNS(WORD_NS, 'abstractNum')).forEach((abstract) => {
        const levels = new Map<number, Level>()
        Array.from(abstract.getElementsByTagNameNS(WORD_NS, 'lvl')).forEach((level) => {
            levels.set(Number(attr(level, 'ilvl') || 0), {
                format: attr(child(level, 'numFmt'), 'val') || 'decimal',
                text: attr(child(level, 'lvlText'), 'val') ?? '',
                start: Number(attr(child(level, 'start'), 'val') || 1),
            })
        })
        abstracts.set(attr(abstract, 'abstractNumId') || '', levels)
    })
    Array.from(root.getElementsByTagNameNS(WORD_NS, 'num')).forEach((num) => {
        const levels = abstracts.get(attr(child(num, 'abstractNumId'), 'val') || '') || new Map<number, Level>()
        const starts = new Map<number, number>()
        Array.from(num.getElementsByTagNameNS(WORD_NS, 'lvlOverride')).forEach((override) => {
            const start = attr(child(override, 'startOverride'), 'val')
            if (start !== null) starts.set(Number(attr(override, 'ilvl') || 0), Number(start))
        })
        lists.set(attr(num, 'numId') || '', { levels, starts })
    })
    return lists
}

/** The document's paragraphs in order, with Word's list labels put back and each table row as "| cell | cell |". */
export const readDocxLines = async (file: File | Blob): Promise<string[]> => {
    const zip = new PizZip(await file.arrayBuffer())
    const xml = zip.file('word/document.xml')?.asText()
    if (!xml) throw new Error('unreadable_document')
    const body = new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagNameNS(WORD_NS, 'body')[0]
    if (!body) throw new Error('unreadable_document')

    const lists = readNumbering(zip.file('word/numbering.xml')?.asText())
    // Numbering can also come from the paragraph's style (e.g. "List Number").
    const styleNumbering = new Map<string, Element>()
    const stylesXml = zip.file('word/styles.xml')?.asText()
    if (stylesXml) {
        Array.from(new DOMParser().parseFromString(stylesXml, 'application/xml').getElementsByTagNameNS(WORD_NS, 'style')).forEach((style) => {
            const numPr = child(child(style, 'pPr'), 'numPr')
            if (numPr) styleNumbering.set(attr(style, 'styleId') || '', numPr)
        })
    }
    const counters = new Map<string, number[]>()
    const labelOf = (paragraph: Element) => {
        const pPr = child(paragraph, 'pPr')
        const own = child(pPr, 'numPr')
        const fromStyle = styleNumbering.get(attr(child(pPr, 'pStyle'), 'val') || '')
        // The paragraph's own list and level win; either may come from its style instead.
        const numId = attr(child(own, 'numId'), 'val') ?? attr(child(fromStyle, 'numId'), 'val')
        if (!numId || numId === '0') return ''
        const list = lists.get(numId)
        const ilvl = Number(attr(child(own, 'ilvl'), 'val') ?? attr(child(fromStyle, 'ilvl'), 'val') ?? 0)
        const level = list?.levels.get(ilvl)
        if (!list || !level || level.format === 'bullet' || level.format === 'none') return ''
        const counts = counters.get(numId) || []
        counts[ilvl] = counts[ilvl] === undefined ? (list.starts.get(ilvl) ?? level.start) : counts[ilvl] + 1
        counts.length = ilvl + 1 // a deeper level starts again under each new item
        counters.set(numId, counts)
        return level.text.replace(/%(\d)/g, (_, digit: string) => {
            const index = Number(digit) - 1
            const value = counts[index] ?? list.levels.get(index)?.start ?? 1
            return formatNumber(value, list.levels.get(index)?.format || 'decimal')
        })
    }

    const lines: string[] = []
    Array.from(body.children).forEach((node) => {
        if (node.localName === 'p') {
            const label = labelOf(node)
            const content = textOf(node)
            lines.push(label && content.trim() ? `${label} ${content}` : content)
        } else if (node.localName === 'tbl') {
            Array.from(node.getElementsByTagNameNS(WORD_NS, 'tr')).forEach((row) => {
                const cells = Array.from(row.getElementsByTagNameNS(WORD_NS, 'tc')).map((cell) => textOf(cell).trim())
                lines.push(`| ${cells.join(' | ')} |`)
            })
        }
    })
    return lines.map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

const cleanQuestion = (value: string) => value
    .replace(/\s*answer\s*:?\s*_*\s*$/i, '')
    .replace(/_{2,}/g, '')
    .trim()

const cellsOf = (line: string) => TABLE_ROW.exec(line)?.[1].split('|').map((cell) => cell.trim()) ?? null

type Draft = { text: string, options: string[], correct?: number }

/**
 * The correct option a memo line names: its letter ("b", "B)", "(b) Governance") or the option's own text. Returns
 * the option's text, or the memo as written when it names none.
 */
const memoOption = (memo: string, options: string[]) => {
    const letter = /^\(?([a-jA-J])\)?(?:[.)\s:-]|$)/.exec(memo.trim())
    if (letter) {
        const index = letter[1].toLowerCase().charCodeAt(0) - 97
        if (options[index]) return options[index]
    }
    const named = options.find((option) => option.trim().toLowerCase() === memo.trim().toLowerCase())
    return named || memo.trim()
}

export const parseAssessmentLines = (lines: string[]): ImportedAssessment => {
    const drafts: Draft[] = []
    const memo: string[] = []
    let phase: 'questions' | 'memo' = 'questions'
    let lastNumber = 0
    let afterIndex = lines.length

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        if (TABLE_ROW.test(line)) {
            if (phase === 'memo' && memo.length) { afterIndex = index; break }
            continue
        }
        const match = NUMBERED.exec(line)
        // A lettered line under a question is one of its options.
        const option = !match && phase === 'questions' && drafts.length ? OPTION.exec(line) : null
        if (option) {
            const current = drafts[drafts.length - 1]
            const marked = CORRECT_MARK.test(option[2])
            const text = option[2].replace(CORRECT_MARK, '').trim()
            if (text) {
                if (marked) current.correct = current.options.length
                current.options.push(text)
            }
            continue
        }
        if (!match) {
            // The memo ends at the first line that is not a numbered answer; what follows is the case and rubric.
            if (phase === 'memo' && memo.length) { afterIndex = index; break }
            continue
        }
        const number = Number(match[1])
        if (phase === 'questions' && drafts.length && number <= lastNumber) phase = 'memo'
        if (phase === 'questions') {
            const text = cleanQuestion(match[2])
            if (text) drafts.push({ text, options: [] })
            lastNumber = number
        } else {
            memo[number - 1] = match[2].trim()
        }
    }

    const rest = lines.slice(afterIndex)
    const rubric = rest.flatMap((line) => {
        const cells = cellsOf(line)
        if (!cells || cells.length < 2 || !/^\d{1,3}$/.test(cells[1])) return []
        return [{ label: cells[0], maxMarks: Number(cells[1]), guidance: cells.slice(2).join(' ').trim() || undefined }]
    }).filter((criterion) => criterion.label && criterion.maxMarks > 0)

    const caseHeading = rest.findIndex((line) => !TABLE_ROW.test(line) && /case|assignment/i.test(line))
    const caseBrief = caseHeading >= 0 ? rest.slice(caseHeading + 1).find((line) => !TABLE_ROW.test(line) && line.length > 40) : undefined

    const eachMarks = lines.map((line) => /(\d+)\s*marks?\s*each/i.exec(line)?.[1]).find(Boolean)
    const marks = eachMarks ? Math.max(1, Number(eachMarks)) : 1
    const minutes = lines.map((line) => /(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?\s*minutes/i.exec(line)).find(Boolean)
    const title = lines[0] && lines[0].length <= 120 && !NUMBERED.test(lines[0]) ? lines[0] : undefined

    return {
        title,
        durationMinutes: minutes ? Number(minutes[2] || minutes[1]) : undefined,
        questions: drafts.map((draft, index): ImportedQuestion => {
            // Two or more lettered lines make a multiple-choice question when the document points to the correct one
            // (marked, or named by the memo) or gives no memo for it. A memo that names none of them means they are
            // parts of a written question ("a) Define ESG. b) Give an example."), so they stay in its text.
            if (draft.options.length >= 2) {
                const named = memo[index] ? memoOption(memo[index], draft.options) : ''
                const memoNamesOption = Boolean(named) && draft.options.includes(named)
                if (draft.correct !== undefined || memoNamesOption || !memo[index]) {
                    const correct = draft.correct !== undefined ? draft.options[draft.correct] : memoNamesOption ? named : ''
                    return { text: draft.text, marks, memo: correct, type: 'choice', options: draft.options }
                }
                const parts = draft.options.map((part, position) => `${String.fromCharCode(97 + position)}) ${part}`).join(' ')
                return { text: `${draft.text} ${parts}`, marks, memo: memo[index] || '' }
            }
            return { text: draft.text, marks, memo: memo[index] || '' }
        }),
        caseBrief,
        rubric,
    }
}

export const importAssessmentFromDocx = async (file: File) => parseAssessmentLines(await readDocxLines(file))
