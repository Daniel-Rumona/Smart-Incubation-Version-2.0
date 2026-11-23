import { PROSPECT_SOURCES, statusOption, type ProspectModule } from '@/config/prospects'
import { prospectName, type Prospect } from '@/types/prospects'

/**
 * Dates and the CSV export for prospects. Dates always in South African form ("5 Nov 2026"), never the browser's
 * own locale, so every viewer reads the same day.
 */

const DATE = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' })

export const formatDate = (value?: string | null) => {
    if (!value) return '—'
    const date = new Date(value.length === 10 ? `${value}T12:00:00+02:00` : value)
    return Number.isNaN(date.getTime()) ? '—' : DATE.format(date)
}

/** Today in South Africa, YYYY-MM-DD. */
export const todaySa = (now = new Date()) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

export const isFollowUpDue = (prospect: Pick<Prospect, 'nextFollowUpAt' | 'archivedAt'>, today = todaySa()) =>
    Boolean(prospect.nextFollowUpAt && !prospect.archivedAt && prospect.nextFollowUpAt <= today)

const csvCell = (value: unknown) => {
    const text = String(value ?? '')
    // A leading = + - @ would run as a formula in Excel: prefix it so it stays text.
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export const prospectsCsv = (prospects: Prospect[], module: ProspectModule) => {
    const header = ['Name', 'Business', 'Contact person', 'Phone', 'Email', 'Sector', 'Province', 'Came from', 'Detail',
        module === 'training' ? 'Interested in' : 'Programme', 'Follows up', 'Status', 'Status since', 'Next follow-up', 'Agreed to messages', 'Added']
    const rows = prospects.map((row) => [
        prospectName(row), row.businessName, row.contactName, row.phone, row.email, row.sector, row.province,
        PROSPECT_SOURCES.find((option) => option.key === row.source)?.label || row.source, row.sourceDetail,
        row.programName || row.interest || '', row.ownerName || '', statusOption(module, row.status).label,
        formatDate(row.statusChangedAt), row.nextFollowUpAt ? formatDate(row.nextFollowUpAt) : '', row.consent.contactAllowed ? 'Yes' : 'No', formatDate(row.createdAt),
    ])
    return [header, ...rows].map((line) => line.map(csvCell).join(',')).join('\r\n')
}

export const downloadText = (fileName: string, content: string, type = 'text/csv;charset=utf-8') => {
    const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
