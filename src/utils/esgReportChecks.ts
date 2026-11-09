import { FOOTPRINT_INDICATORS, footprintTotals, sourceHasUsage } from '@/config/esgEmissions'
import { disclosureInEffect, standardOfDisclosure } from '@/config/esgStandards'
import type { EsgNarrativeSection, EsgReport } from '@/types/esg'

/**
 * Checks before an ESG report goes out, its completeness, the written sections it has, and its GRI content index.
 * The sections are shared with the AI backend (ai-backend/esg_report_agent.py), which drafts them from the data only.
 */

export const ESG_SECTIONS: Array<{ key: string, title: string, disclosures: string[] }> = [
    { key: 'about', title: 'About this report', disclosures: ['2-1', '2-2', '2-3'] },
    { key: 'leadership', title: 'Message from leadership', disclosures: ['2-22'] },
    { key: 'strategy', title: 'Organisation and strategy', disclosures: ['2-6', '2-23'] },
    { key: 'materiality', title: 'Material topics', disclosures: ['3-1', '3-2'] },
    { key: 'environment', title: 'Environmental performance', disclosures: [] },
    { key: 'climate', title: 'Climate change and energy', disclosures: [] },
    { key: 'social', title: 'Social performance', disclosures: [] },
    { key: 'governance', title: 'Governance', disclosures: ['2-9'] },
    { key: 'stakeholders', title: 'Stakeholder engagement', disclosures: ['2-29'] },
    { key: 'actions', title: 'Targets and next steps', disclosures: ['3-3'] },
]

/** The GRI 2 disclosures an "in accordance with" report must cover (or explain an omission for). */
const GRI2_REQUIRED = ['2-1', '2-2', '2-3', '2-4', '2-5', '2-6', '2-7', '2-8', '2-9', '2-10', '2-11', '2-12', '2-13', '2-14', '2-15', '2-16', '2-17', '2-18', '2-19', '2-20', '2-21', '2-22', '2-23', '2-24', '2-25', '2-26', '2-27', '2-28', '2-29', '2-30']

export type EsgCheck = { level: 'error' | 'warning', area: string, message: string, rowId?: string }

/** "12 500", "1,234.5", "45%" and "R 3.2m" as numbers; null when it is not a figure. */
export const figure = (value: string) => {
    const text = String(value || '').trim().toLowerCase()
    if (!text) return null
    const multiplier = /\dm\b|million/.test(text) ? 1e6 : /\dk\b/.test(text) ? 1e3 : 1
    const cleaned = text.replace(/(?<=\d)[\s,](?=\d{3}\b)/g, '').replace(/[^\d.-]/g, '')
    if (!cleaned || cleaned === '-' || cleaned === '.') return null
    const number = Number(cleaned)
    return Number.isFinite(number) ? number * multiplier : null
}

export const checkEsgReport = (report: EsgReport): EsgCheck[] => {
    const checks: EsgCheck[] = []
    if (!report.periodStart || !report.periodEnd) checks.push({ level: 'error', area: 'Setup', message: 'Set the reporting period.' })
    if (!report.publicationDate) checks.push({ level: 'warning', area: 'Setup', message: 'Set the planned publication date: it decides which GRI Standards are in effect.' })
    if (!report.indicators.length) checks.push({ level: 'error', area: 'Data', message: 'Add the client\'s data (or import the ESG toolkit workbook).' })
    for (const row of report.indicators) {
        const name = row.indicator || 'An indicator'
        if (!row.current.trim()) checks.push({ level: 'warning', area: 'Data', rowId: row.id, message: `${name}: no current value.` })
        if (!row.unit.trim()) checks.push({ level: 'warning', area: 'Data', rowId: row.id, message: `${name}: no unit.` })
        if (!row.evidence.trim()) checks.push({ level: 'warning', area: 'Data', rowId: row.id, message: `${name}: no evidence source.` })
        if (!row.disclosure) checks.push({ level: 'warning', area: 'Data', rowId: row.id, message: `${name}: not linked to a GRI disclosure, so it is left out of the content index.` })
        const baseline = figure(row.baseline)
        const current = figure(row.current)
        if (baseline !== null && current !== null && baseline !== 0) {
            const change = Math.round(((current - baseline) / Math.abs(baseline)) * 100)
            if (Math.abs(change) > 50) checks.push({ level: 'warning', area: 'Data', rowId: row.id, message: `${name}: ${change > 0 ? 'up' : 'down'} ${Math.abs(change)}% on the baseline. Check the figure and unit.` })
        }
    }
    for (const row of report.risks) {
        const name = row.risk || 'A risk'
        if (!row.mitigation.trim()) checks.push({ level: 'warning', area: 'Risks', rowId: row.id, message: `${name}: no mitigation or control.` })
        if (row.likelihood === null || row.impact === null) checks.push({ level: 'warning', area: 'Risks', rowId: row.id, message: `${name}: score the likelihood and impact (1-5).` })
    }
    const footprint = footprintTotals(report.footprint)
    for (const source of footprint.missingFactor) {
        checks.push({ level: 'error', area: 'Carbon footprint', rowId: source.id, message: `${source.label || 'A source'}: enter its emission factor, or its emissions are left out of the totals.` })
    }
    for (const source of report.footprint.sources) {
        if (!source.label.trim() || !source.unit.trim()) checks.push({ level: 'warning', area: 'Carbon footprint', rowId: source.id, message: 'A source needs a name and a unit.' })
        else if (typeof source.factor === 'number' && !source.factorSource.trim()) checks.push({ level: 'warning', area: 'Carbon footprint', rowId: source.id, message: `${source.label}: say where its emission factor comes from.` })
        else if (!sourceHasUsage(source)) checks.push({ level: 'warning', area: 'Carbon footprint', rowId: source.id, message: `${source.label}: no usage recorded yet.` })
    }
    if (report.footprint.sources.length && report.country === 'ZA' && report.footprint.carbonTaxPayer === 'unsure') {
        checks.push({ level: 'warning', area: 'Carbon footprint', message: 'Say whether the client pays carbon tax directly, so the report states its carbon tax position.' })
    }
    if (!report.stakeholders.length) checks.push({ level: 'warning', area: 'Stakeholders', message: 'No stakeholders mapped: GRI 2-29 asks how the organisation engages them.' })
    if (!report.risks.length) checks.push({ level: 'warning', area: 'Risks', message: 'No risks registered: the material topics (GRI 3) are drawn from them.' })
    for (const section of report.narrative) {
        if (section.unmatchedFigures?.length) checks.push({ level: 'warning', area: 'Report', message: `${section.title}: check ${section.unmatchedFigures.join(', ')}; not in the report's data.` })
    }
    if (report.status === 'final' && !report.approvedBy) checks.push({ level: 'warning', area: 'Report', message: 'Record who approved the report for the client (Report details).' })
    if (report.claim === 'in_accordance') {
        const covered = new Set(contentIndex(report).map((row) => row.disclosure))
        const missing = GRI2_REQUIRED.filter((id) => !covered.has(id))
        if (missing.length) checks.push({ level: 'error', area: 'Report', message: `"In accordance with" needs every GRI 2 disclosure or a reason for omitting it; ${missing.length} are not covered (${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', ...' : ''}). Use "with reference to" or add them.` })
    }
    return checks
}

/** How many of the report's sections are written: what the report page shows ("3 of 8 sections written"). */
export const esgSectionsWritten = (report: EsgReport) => ESG_SECTIONS.filter((section) => report.narrative.some((item) => item.key === section.key && item.text.trim())).length

/** How far the report is: data filled in, risks controlled and sections written. */
export const esgCompleteness = (report: EsgReport) => {
    const parts: boolean[] = [
        ...report.indicators.flatMap((row) => [Boolean(row.current.trim()), Boolean(row.unit.trim()), Boolean(row.disclosure), Boolean(row.evidence.trim())]),
        ...report.risks.map((row) => Boolean(row.mitigation.trim())),
        ...ESG_SECTIONS.map((section) => Boolean(report.narrative.find((item) => item.key === section.key)?.text.trim())),
        report.stakeholders.length > 0,
    ]
    return parts.length ? Math.round((parts.filter(Boolean).length / parts.length) * 100) : 0
}

export type ContentIndexRow = { standard: string, disclosure: string, title: string, location: string, note?: string }

const sectionOf = (narrative: EsgNarrativeSection[], key: string) => narrative.find((item) => item.key === key && item.text.trim())

/** The GRI content index: each disclosure covered, where it is in the report, and under which standard. */
export const contentIndex = (report: EsgReport): ContentIndexRow[] => {
    const rows = new Map<string, ContentIndexRow>()
    const recorded = footprintTotals(report.footprint).scopesRecorded
    const footprint = FOOTPRINT_INDICATORS.filter((item) => recorded.includes(item.scope)).map((item) => item.disclosure)
    const add = (id: string, location: string) => {
        const resolved = disclosureInEffect(id, report.publicationDate)
        const existing = rows.get(id)
        if (existing) {
            if (!existing.location.includes(location)) existing.location = `${existing.location}; ${location}`
            return
        }
        rows.set(id, {
            standard: resolved.standard ? `${resolved.standard.id}: ${resolved.standard.title}` : standardOfDisclosure(id),
            disclosure: id,
            title: resolved.title,
            location,
            ...(resolved.replacedBy ? { note: `Reported under ${resolved.replacedBy}` } : {}),
        })
    }
    for (const section of ESG_SECTIONS) {
        if (!sectionOf(report.narrative, section.key)) continue
        for (const id of section.disclosures) add(id, section.title)
    }
    // Every report states how its figures were checked; an approval names the highest governance body's role.
    add('2-5', 'Approval and assurance')
    if (report.approvedBy) add('2-14', 'Approval and assurance')
    if (report.stakeholders.length) add('2-29', 'Stakeholder engagement')
    if (report.risks.length) add('3-2', 'Material topics')
    for (const row of report.indicators) if (row.disclosure) add(row.disclosure, `Performance data: ${row.indicator}`)
    for (const id of footprint) add(id, 'Climate change and energy')
    const order = (id: string) => id.split('-').map(Number)
    return [...rows.values()].sort((a, b) => {
        const [x1, x2] = order(a.disclosure)
        const [y1, y2] = order(b.disclosure)
        return x1 - y1 || x2 - y2
    })
}
