/**
 * Reading a list of prospects: a CSV file, or cells copied straight from Excel or Google Sheets (tab-separated).
 * The first row names the columns; common names in English are recognised (see COLUMN_NAMES).
 */

export type ImportField = 'businessName' | 'contactName' | 'phone' | 'email' | 'registrationNumber' | 'sector' | 'province' | 'interest' | 'notes'

const COLUMN_NAMES: Record<ImportField, string[]> = {
    businessName: ['business', 'business name', 'company', 'company name', 'organisation', 'organization', 'enterprise', 'trading name'],
    contactName: ['name', 'full name', 'contact', 'contact person', 'contact name', 'person', 'participant', 'attendee', 'learner', 'owner'],
    phone: ['phone', 'cell', 'cellphone', 'cell phone', 'mobile', 'whatsapp', 'contact number', 'tel', 'telephone', 'number'],
    email: ['email', 'e-mail', 'email address', 'mail'],
    registrationNumber: ['registration', 'registration number', 'reg number', 'reg no', 'cipc', 'company registration'],
    sector: ['sector', 'industry'],
    province: ['province', 'region'],
    interest: ['interest', 'interested in', 'course', 'service'],
    notes: ['notes', 'note', 'comments', 'comment'],
}

const normaliseHeader = (value: string) => value.trim().toLowerCase().replace(/[_.:]+/g, ' ').replace(/\s+/g, ' ')

/** Splits CSV or tab-separated text into rows of cells (quotes and line breaks inside quotes are respected). */
export const parseTable = (input: string): string[][] => {
    const text = input.replace(/^\uFEFF/, '')
    const firstLine = text.split(/\r?\n/, 1)[0] || ''
    const delimiter = firstLine.includes('\t') ? '\t' : (firstLine.split(';').length > firstLine.split(',').length ? ';' : ',')
    const rows: string[][] = []
    let row: string[] = []
    let cell = ''
    let quoted = false
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index]
        if (quoted) {
            if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1 }
            else if (char === '"') quoted = false
            else cell += char
        } else if (char === '"' && cell === '') quoted = true
        else if (char === delimiter) { row.push(cell); cell = '' }
        else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[index + 1] === '\n') index += 1
            row.push(cell); rows.push(row); row = []; cell = ''
        } else cell += char
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
    return rows.map((cells) => cells.map((value) => value.trim())).filter((cells) => cells.some(Boolean))
}

/** Which column holds which field, from the header row. */
export const mapColumns = (header: string[]): Partial<Record<ImportField, number>> => {
    const mapping: Partial<Record<ImportField, number>> = {}
    header.map(normaliseHeader).forEach((name, index) => {
        const field = (Object.keys(COLUMN_NAMES) as ImportField[]).find((key) => mapping[key] === undefined && COLUMN_NAMES[key].includes(name))
        if (field) mapping[field] = index
    })
    return mapping
}

export type ParsedProspect = Partial<Record<ImportField, string>> & { kind: 'business' | 'person' }

/** The rows as prospects: a row with a business name is a business, a row with only a person's name is a person. */
export const readProspects = (input: string, peopleAllowed = true) => readProspectRows(parseTable(input), peopleAllowed)

/** The same, from rows already split into cells (an Excel file, read by src/utils/spreadsheetRows.ts). */
export const readProspectRows = (table: string[][], peopleAllowed = true): { rows: ParsedProspect[], mapping: Partial<Record<ImportField, number>>, skipped: number } => {
    const [header = [], ...body] = table
    const mapping = mapColumns(header)
    let skipped = 0
    const rows = body.flatMap((cells) => {
        const row = Object.fromEntries(Object.entries(mapping).map(([field, index]) => [field, cells[index as number] || ''])) as Partial<Record<ImportField, string>>
        // Incubation takes businesses only: a row without a business name is left out there.
        if (!row.businessName && (!row.contactName || !peopleAllowed)) { skipped += 1; return [] }
        return [{ ...row, kind: row.businessName ? 'business' as const : 'person' as const }]
    })
    return { rows, mapping, skipped }
}
