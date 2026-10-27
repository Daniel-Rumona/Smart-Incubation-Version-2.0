import PizZip from 'pizzip'

/*
 * Reads the first sheet of an .xlsx file, or a .csv file, into rows of text.
 * An .xlsx is a zip of XML parts, so pizzip (already used for .docx exports) is enough; no spreadsheet library.
 */

const columnIndex = (cellRef: string) => {
    const letters = cellRef.replace(/[^A-Z]/gi, '').toUpperCase()
    let index = 0
    for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64)
    return index - 1
}

const parseXml = (text: string) => new DOMParser().parseFromString(text, 'application/xml')
const textOf = (node: Element) => Array.from(node.getElementsByTagName('t')).map((item) => item.textContent || '').join('')

const readXlsx = (buffer: ArrayBuffer): string[][] => {
    const zip = new PizZip(buffer)
    const shared = zip.file('xl/sharedStrings.xml')
    const sharedStrings = shared ? Array.from(parseXml(shared.asText()).getElementsByTagName('si')).map(textOf) : []

    // The first sheet in workbook order, found through the workbook's relationships.
    const workbook = parseXml(zip.file('xl/workbook.xml')?.asText() || '')
    const firstSheet = workbook.getElementsByTagName('sheet')[0]
    const relId = firstSheet?.getAttribute('r:id') || firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    const rels = parseXml(zip.file('xl/_rels/workbook.xml.rels')?.asText() || '')
    const target = Array.from(rels.getElementsByTagName('Relationship')).find((rel) => rel.getAttribute('Id') === relId)?.getAttribute('Target')
    const sheetPath = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : 'xl/worksheets/sheet1.xml'
    const sheet = zip.file(sheetPath)
    if (!sheet) throw new Error('The spreadsheet has no sheets.')

    return Array.from(parseXml(sheet.asText()).getElementsByTagName('row')).map((row) => {
        const values: string[] = []
        for (const cell of Array.from(row.getElementsByTagName('c'))) {
            const type = cell.getAttribute('t')
            const raw = cell.getElementsByTagName('v')[0]?.textContent ?? ''
            const value = type === 's' ? sharedStrings[Number(raw)] ?? '' : type === 'inlineStr' ? textOf(cell) : raw
            values[columnIndex(cell.getAttribute('r') || '')] = value.trim()
        }
        return Array.from(values, (value) => value ?? '')
    })
}

const readCsv = (text: string): string[][] => {
    const rows: string[][] = []
    let row: string[] = []
    let field = ''
    let quoted = false
    for (let i = 0; i < text.length; i++) {
        const char = text[i]
        if (quoted) {
            if (char === '"' && text[i + 1] === '"') { field += '"'; i++ }
            else if (char === '"') quoted = false
            else field += char
        } else if (char === '"') quoted = true
        else if (char === ',' || char === ';') { row.push(field.trim()); field = '' }
        else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[i + 1] === '\n') i++
            row.push(field.trim()); rows.push(row); row = []; field = ''
        } else field += char
    }
    if (field || row.length) { row.push(field.trim()); rows.push(row) }
    return rows
}

/** Rows of cell text with fully empty rows dropped. The first row is the header. */
export const readSpreadsheetRows = async (file: File): Promise<string[][]> => {
    const rows = /\.csv$/i.test(file.name) ? readCsv((await file.text()).replace(/^﻿/, '')) : readXlsx(await file.arrayBuffer())
    return rows.filter((row) => row.some((cell) => cell))
}
