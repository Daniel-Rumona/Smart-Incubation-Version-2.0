import PizZip from 'pizzip'

/**
 * Reads an assessment written in Word into a draft the facilitator reviews before saving:
 *  - numbered questions ("1. What does ESG stand for? Answer: ____"),
 *  - then a numbered memo, recognised where the numbering starts again ("1. Environmental, Social and Governance."),
 *  - then, optionally, the group case brief (the paragraph after a heading mentioning a case or assignment) and a
 *    rubric table whose second column holds each criterion's marks.
 * Nothing is saved from here; anything the layout did not reveal is simply left for the facilitator to fill in.
 */

export type ImportedAssessment = {
    title?: string
    durationMinutes?: number
    questions: Array<{ text: string, marks: number, memo: string }>
    caseBrief?: string
    rubric: Array<{ label: string, maxMarks: number, guidance?: string }>
}

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const NUMBERED = /^\s*(\d{1,3})\s*[.)]\s*(.+)$/
const TABLE_ROW = /^\|(.*)\|$/

const textOf = (node: Element) => Array.from(node.getElementsByTagNameNS(WORD_NS, 't')).map((part) => part.textContent || '').join('')

/** The document's paragraphs in order, with each table row as "| cell | cell |". */
export const readDocxLines = async (file: File): Promise<string[]> => {
    const zip = new PizZip(await file.arrayBuffer())
    const xml = zip.file('word/document.xml')?.asText()
    if (!xml) throw new Error('unreadable_document')
    const body = new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagNameNS(WORD_NS, 'body')[0]
    if (!body) throw new Error('unreadable_document')

    const lines: string[] = []
    Array.from(body.children).forEach((node) => {
        if (node.localName === 'p') {
            lines.push(textOf(node))
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

export const parseAssessmentLines = (lines: string[]): ImportedAssessment => {
    const questions: string[] = []
    const memo: string[] = []
    let phase: 'questions' | 'memo' = 'questions'
    let lastNumber = 0
    let afterIndex = lines.length

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        const match = TABLE_ROW.test(line) ? null : NUMBERED.exec(line)
        if (!match) {
            // The memo ends at the first line that is not a numbered answer; what follows is the case and rubric.
            if (phase === 'memo' && memo.length) { afterIndex = index; break }
            continue
        }
        const number = Number(match[1])
        if (phase === 'questions' && questions.length && number <= lastNumber) phase = 'memo'
        if (phase === 'questions') {
            const text = cleanQuestion(match[2])
            if (text) questions.push(text)
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
        questions: questions.map((text, index) => ({ text, marks, memo: memo[index] || '' })),
        caseBrief,
        rubric,
    }
}

export const importAssessmentFromDocx = async (file: File) => parseAssessmentLines(await readDocxLines(file))
