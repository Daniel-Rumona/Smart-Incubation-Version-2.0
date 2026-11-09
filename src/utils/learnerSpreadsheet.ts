import PizZip from 'pizzip'

/**
 * Learners for a class from a spreadsheet: an Excel workbook (.xlsx) or a CSV file. Headers are matched loosely, on
 * any sheet and any of the first rows, so the facilitator's own attendance register (Learner name, Organisation,
 * Day 1, ...) works as it is; email, ID or passport and phone columns are taken when the sheet has them. The XML is
 * read with patterns rather than a DOM parser, so this also runs outside the browser.
 */

export type SpreadsheetSheet = { name: string, rows: string[][] }

export type LearnerColumn = 'name' | 'firstName' | 'surname' | 'organisation' | 'email' | 'idNumber' | 'phone'

export type SpreadsheetLearner = {
    /** The row number as Excel shows it. */
    row: number
    name: string
    organisation: string
    email: string
    idNumber: string
    phone: string
}

export type LearnerSheet = {
    sheet: string
    columns: Partial<Record<LearnerColumn, number>>
    learners: SpreadsheetLearner[]
}

const HEADERS: Record<LearnerColumn, string[]> = {
    name: ['learnername', 'learner', 'learnerfullname', 'name', 'fullname', 'fullnames', 'nameandsurname', 'namesurname', 'names', 'participant', 'participantname', 'delegate', 'delegatename', 'attendee', 'attendeename', 'employee', 'employeename'],
    firstName: ['firstname', 'firstnames', 'givenname', 'givennames', 'forename', 'forenames'],
    surname: ['surname', 'lastname', 'familyname'],
    organisation: ['organisation', 'organization', 'organisationname', 'organizationname', 'company', 'companyname', 'employer', 'client', 'clientname', 'business', 'businessname'],
    email: ['email', 'emailaddress', 'mail', 'emails'],
    idNumber: ['id', 'idnumber', 'idno', 'idorpassport', 'idorpassportnumber', 'idpassport', 'idpassportnumber', 'passport', 'passportnumber', 'identitynumber', 'said', 'saidnumber'],
    phone: ['phone', 'phonenumber', 'cell', 'cellphone', 'cellnumber', 'cellphonenumber', 'mobile', 'mobilenumber', 'contactnumber', 'telephone', 'tel'],
}

/** The headers of the template the facilitator can download and fill in. */
export const LEARNER_TEMPLATE_HEADERS = ['Learner name', 'Organisation', 'Email', 'ID or passport number', 'Phone']

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

const decodeXml = (value: string) => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase()
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16))
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10))
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[lower]
})

const attribute = (attributes: string, name: string) => attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1]

/** The text runs of a shared string or inline string, leaving out phonetic hints. */
const textOf = (xml: string) => decodeXml([...xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '').replace(/<t\s*\/>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((match) => match[1]).join(''))

const columnIndex = (reference: string) => [...reference.replace(/\d+/g, '').toUpperCase()]
    .reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1

/** Numbers come back as Excel stored them; long ID numbers may be in exponent form. */
const numberText = (value: string) => /^-?\d+(\.\d+)?e\+?\d+$/i.test(value) ? Number(value).toFixed(0) : value.replace(/\.0+$/, '')

export const readXlsx = (data: ArrayBuffer | Uint8Array): SpreadsheetSheet[] => {
    const zip = new PizZip(data)
    const read = (path: string) => zip.file(path)?.asText() ?? ''
    const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1]))
    const targets = new Map([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)].map((match) => {
        const target = (attribute(match[1], 'Target') || '').replace(/^\//, '')
        return [attribute(match[1], 'Id') || '', target.startsWith('xl/') ? target : `xl/${target}`] as const
    }))

    return [...read('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?>/g)].flatMap((match) => {
        const path = targets.get(attribute(match[1], 'r:id') || '')
        const xml = path ? read(path) : ''
        if (!xml) return []
        const rows: string[][] = []
        let nextRow = 0
        for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
            const rowNumber = Number(attribute(rowMatch[1], 'r')) || nextRow + 1
            nextRow = rowNumber
            const cells: string[] = []
            let nextCell = 0
            for (const cell of (rowMatch[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
                const reference = attribute(cell[1], 'r')
                const index = reference ? columnIndex(reference) : nextCell
                nextCell = index + 1
                const type = attribute(cell[1], 't')
                const body = cell[2] || ''
                const raw = decodeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '')
                const value = type === 's' ? shared[Number(raw)] ?? ''
                    : type === 'inlineStr' ? textOf(body)
                        : type === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE')
                            : type === 'str' || type === 'e' ? raw
                                : numberText(raw)
                cells[index] = value.trim()
            }
            rows[rowNumber - 1] = Array.from(cells, (value) => value ?? '')
        }
        return [{ name: decodeXml(attribute(match[1], 'name') || 'Sheet'), rows: Array.from(rows, (row) => row ?? []) }]
    })
}

/** CSV as Excel writes it: quoted fields, commas or semicolons (the usual separator where a comma is the decimal mark). */
export const readCsv = (source: string): SpreadsheetSheet[] => {
    const content = source.replace(/^\uFEFF/, '')
    const firstLine = content.split(/\r?\n/, 1)[0] || ''
    const separator = (firstLine.match(/;/g)?.length || 0) > (firstLine.match(/,/g)?.length || 0) ? ';' : ','
    const rows: string[][] = []
    let row: string[] = []
    let field = ''
    let quoted = false
    for (let index = 0; index < content.length; index += 1) {
        const char = content[index]
        if (quoted) {
            if (char === '"' && content[index + 1] === '"') {
                field += '"'
                index += 1
            } else if (char === '"') quoted = false
            else field += char
        } else if (char === '"') quoted = true
        else if (char === separator) {
            row.push(field.trim())
            field = ''
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && content[index + 1] === '\n') index += 1
            row.push(field.trim())
            rows.push(row)
            row = []
            field = ''
        } else field += char
    }
    if (field || row.length) rows.push([...row, field.trim()])
    return [{ name: 'CSV', rows }]
}

export const readSpreadsheetFile = async (file: File): Promise<SpreadsheetSheet[]> => {
    const name = file.name.toLowerCase()
    if (name.endsWith('.csv') || file.type === 'text/csv') return readCsv(await file.text())
    if (name.endsWith('.xls')) throw new Error('xls_not_supported')
    return readXlsx(await file.arrayBuffer())
}

// Headers no list above names ("ID / Passport No.", "Cell no"), matched on part of the word, in this order.
const PARTIAL_HEADERS: Array<[LearnerColumn, RegExp]> = [
    ['idNumber', /passport|^idn|^idno|identity/],
    ['email', /email/],
    ['phone', /phone|cell|mobile|contactn|^tel/],
    ['organisation', /organi[sz]ation|company|employer/],
    ['surname', /surname|lastname/],
    ['firstName', /firstname|givenname|forename/],
    ['name', /name/],
]

const mapHeaders = (row: string[]) => {
    const columns: Partial<Record<LearnerColumn, number>> = {}
    row.forEach((cell, index) => {
        const header = normalise(cell)
        if (!header) return
        const column = (Object.keys(HEADERS) as LearnerColumn[]).find((key) => HEADERS[key].includes(header))
            ?? PARTIAL_HEADERS.find(([, pattern]) => pattern.test(header))?.[0]
        if (column && columns[column] === undefined) columns[column] = index
    })
    return columns
}

/** The sheet and header row that look most like a learner list, and the learners under it. Null when none does. */
export const findLearnerSheet = (sheets: SpreadsheetSheet[]): LearnerSheet | null => {
    let best: { sheet: SpreadsheetSheet, headerRow: number, columns: Partial<Record<LearnerColumn, number>>, score: number } | null = null
    for (const sheet of sheets) {
        for (let headerRow = 0; headerRow < Math.min(10, sheet.rows.length); headerRow += 1) {
            const columns = mapHeaders(sheet.rows[headerRow])
            if (columns.name === undefined && columns.firstName === undefined) continue
            const score = Object.keys(columns).length
            if (!best || score > best.score) best = { sheet, headerRow, columns, score }
        }
    }
    if (!best) return null
    const { sheet, headerRow, columns } = best
    const cell = (row: string[], column: LearnerColumn) => (columns[column] === undefined ? '' : String(row[columns[column] as number] ?? '').trim())
    const learners = sheet.rows.slice(headerRow + 1).flatMap((row, offset) => {
        const name = cell(row, 'name') || [cell(row, 'firstName'), cell(row, 'surname')].filter(Boolean).join(' ')
        if (!name) return []
        return [{
            row: headerRow + offset + 2,
            name: name.replace(/\s+/g, ' '),
            organisation: cell(row, 'organisation'),
            email: cell(row, 'email').toLowerCase(),
            idNumber: cell(row, 'idNumber').replace(/\s+/g, ''),
            phone: cell(row, 'phone'),
        }]
    })
    return { sheet: sheet.name, columns, learners }
}

const xmlText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * An empty workbook with the template's headers. The ID and phone columns are formatted as text, so Excel keeps their
 * leading zeros.
 */
export const buildLearnerTemplate = (): Uint8Array => {
    const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    const zip = new PizZip()
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + '</Types>')
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + `<Relationship Id="rId1" Type="${relationships}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
    zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${main}" xmlns:r="${relationships}">`
        + '<sheets><sheet name="Learners" sheetId="1" r:id="rId1"/></sheets></workbook>')
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + `<Relationship Id="rId1" Type="${relationships}/worksheet" Target="worksheets/sheet1.xml"/>`
        + `<Relationship Id="rId2" Type="${relationships}/styles" Target="styles.xml"/></Relationships>`)
    // Styles: 0 normal, 1 bold (headers), 2 text format (ID and phone columns).
    zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${main}">`
        + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        + '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')
    const headerCells = LEARNER_TEMPLATE_HEADERS.map((header, index) =>
        `<c r="${String.fromCharCode(65 + index)}1" t="inlineStr" s="1"><is><t>${xmlText(header)}</t></is></c>`).join('')
    zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${main}">`
        + '<cols><col min="1" max="3" width="30" customWidth="1"/><col min="4" max="5" width="24" style="2" customWidth="1"/></cols>'
        + `<sheetData><row r="1">${headerCells}</row></sheetData></worksheet>`)
    return zip.generate({ type: 'uint8array', compression: 'DEFLATE' })
}
