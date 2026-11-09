import { suggestDisclosure } from '@/config/esgStandards'
import type { EsgAction, EsgIndicator, EsgPillar, EsgRegisterKey, EsgRisk, EsgStakeholder } from '@/types/esg'
import { readCsv, readXlsx, type SpreadsheetSheet } from '@/utils/learnerSpreadsheet'

/**
 * Reads the facilitator's ESG toolkit workbook (or any sheet with the same headers) into a report's registers. Each
 * register is found by its header row on any sheet: ESG Data Register (Pillar, Indicator, Unit, Baseline, Current,
 * Target, Period, Owner, Evidence source, Quality check), ESG Risk Register, Stakeholder Map and 90 Day Action Plan.
 * Rows without the register's main column are skipped. Each register comes back only when its sheet was found.
 */

type Field = { key: string, headers: string[] }
type RegisterSpec = { key: EsgRegisterKey, main: string, fields: Field[] }

const field = (key: string, ...headers: string[]): Field => ({ key, headers })

const REGISTERS: RegisterSpec[] = [
    {
        key: 'indicators',
        main: 'indicator',
        fields: [
            field('pillar', 'pillar', 'esgpillar'),
            field('indicator', 'indicator', 'metric', 'kpi', 'measure'),
            field('unit', 'unit', 'units', 'uom'),
            field('baseline', 'baseline'),
            field('current', 'current', 'actual', 'value', 'currentvalue'),
            field('target', 'target'),
            field('period', 'period', 'frequency', 'reportingperiod'),
            field('owner', 'owner', 'responsible'),
            field('evidence', 'evidencesource', 'evidence', 'source'),
            field('qualityCheck', 'qualitycheck', 'quality', 'qc', 'verified'),
            field('disclosure', 'gri', 'gridisclosure', 'disclosure'),
        ],
    },
    {
        key: 'risks',
        main: 'risk',
        fields: [
            field('pillar', 'pillar'),
            field('risk', 'risk', 'riskdescription'),
            field('stakeholders', 'affectedstakeholders', 'stakeholders', 'affected'),
            field('likelihood', 'likelihood15', 'likelihood'),
            field('impact', 'impact15', 'impact', 'consequence'),
            field('mitigation', 'mitigationcontrol', 'mitigation', 'control', 'controls'),
            field('owner', 'owner'),
            field('reviewDate', 'reviewdate', 'review'),
            field('status', 'status'),
        ],
    },
    {
        key: 'stakeholders',
        main: 'stakeholder',
        fields: [
            field('stakeholder', 'stakeholder', 'stakeholdergroup'),
            field('concern', 'concern', 'concerns', 'keyconcern'),
            field('influence', 'influence15', 'influence'),
            field('impact', 'impact15', 'impact'),
            field('engagement', 'engagementmethod', 'engagement', 'method'),
            field('owner', 'owner'),
            field('nextReview', 'nextreview', 'review'),
        ],
    },
    {
        key: 'actions',
        main: 'action',
        fields: [
            field('pillar', 'pillar'),
            field('action', 'action', 'actions'),
            field('baseline', 'baseline'),
            field('target', 'target'),
            field('kpi', 'kpi', 'measure'),
            field('owner', 'owner'),
            field('startDate', 'startdate', 'start'),
            field('dueDate', 'duedate', 'due', 'deadline'),
            field('budget', 'budgetzar', 'budget', 'cost'),
            field('evidence', 'evidence'),
            field('status', 'status'),
        ],
    },
]

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

export const toPillar = (value: string): EsgPillar => {
    const text = value.trim().toUpperCase()
    if (text.startsWith('S')) return 'S'
    if (text.startsWith('G')) return 'G'
    return 'E'
}

const score = (value: string) => {
    const number = Number(String(value).replace(/[^\d.]/g, ''))
    return Number.isFinite(number) && number >= 1 && number <= 5 ? Math.round(number) : null
}

/** Excel stores dates as day counts from 1899-12-30; this turns those back into `YYYY-MM-DD`. */
const dateText = (value: string) => {
    if (/^\d{5}(\.\d+)?$/.test(value)) {
        const date = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(value)) * 86400000)
        return date.toISOString().slice(0, 10)
    }
    return value
}

let counter = 0
export const newRowId = () => `r${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

const findHeader = (sheets: SpreadsheetSheet[], spec: RegisterSpec) => {
    for (const sheet of sheets) {
        for (let index = 0; index < Math.min(10, sheet.rows.length); index += 1) {
            const headers = sheet.rows[index].map(normalise)
            const columns: Record<string, number> = {}
            for (const item of spec.fields) {
                const position = headers.findIndex((header) => item.headers.includes(header))
                if (position >= 0 && !Object.values(columns).includes(position)) columns[item.key] = position
            }
            // The register's own column must be there, plus at least two more of its headers.
            if (columns[spec.main] !== undefined && Object.keys(columns).length >= 3) return { sheet, index, columns }
        }
    }
    return null
}

export type EsgToolkitImport = {
    indicators?: EsgIndicator[]
    risks?: EsgRisk[]
    stakeholders?: EsgStakeholder[]
    actions?: EsgAction[]
    /** Which sheet each register came from. */
    sheets: Partial<Record<EsgRegisterKey, string>>
}

export const importEsgToolkit = (sheets: SpreadsheetSheet[]): EsgToolkitImport => {
    const result: EsgToolkitImport = { sheets: {} }
    for (const spec of REGISTERS) {
        const found = findHeader(sheets, spec)
        if (!found) continue
        const value = (row: string[], key: string) => (found.columns[key] === undefined ? '' : String(row[found.columns[key]] ?? '').trim())
        const rows = found.sheet.rows.slice(found.index + 1).filter((row) => value(row, spec.main))
        result.sheets[spec.key] = found.sheet.name
        if (spec.key === 'indicators') {
            result.indicators = rows.map((row) => {
                const indicator = value(row, 'indicator')
                const unit = value(row, 'unit')
                return {
                    id: newRowId(), pillar: toPillar(value(row, 'pillar')), indicator, unit,
                    baseline: value(row, 'baseline'), current: value(row, 'current'), target: value(row, 'target'),
                    period: value(row, 'period'), owner: value(row, 'owner'), evidence: value(row, 'evidence'),
                    qualityCheck: value(row, 'qualityCheck'),
                    disclosure: value(row, 'disclosure').replace(/^GRI\s*/i, '') || suggestDisclosure(indicator, unit),
                }
            })
        } else if (spec.key === 'risks') {
            result.risks = rows.map((row) => ({
                id: newRowId(), pillar: toPillar(value(row, 'pillar')), risk: value(row, 'risk'), stakeholders: value(row, 'stakeholders'),
                likelihood: score(value(row, 'likelihood')), impact: score(value(row, 'impact')), mitigation: value(row, 'mitigation'),
                owner: value(row, 'owner'), reviewDate: dateText(value(row, 'reviewDate')), status: value(row, 'status'),
            }))
        } else if (spec.key === 'stakeholders') {
            result.stakeholders = rows.map((row) => ({
                id: newRowId(), stakeholder: value(row, 'stakeholder'), concern: value(row, 'concern'),
                influence: score(value(row, 'influence')), impact: score(value(row, 'impact')), engagement: value(row, 'engagement'),
                owner: value(row, 'owner'), nextReview: dateText(value(row, 'nextReview')),
            }))
        } else {
            result.actions = rows.map((row) => ({
                id: newRowId(), pillar: toPillar(value(row, 'pillar')), action: value(row, 'action'), baseline: value(row, 'baseline'),
                target: value(row, 'target'), kpi: value(row, 'kpi'), owner: value(row, 'owner'), startDate: dateText(value(row, 'startDate')),
                dueDate: dateText(value(row, 'dueDate')), budget: value(row, 'budget'), evidence: value(row, 'evidence'), status: value(row, 'status'),
            }))
        }
    }
    return result
}

export const readEsgToolkitFile = async (file: File) => {
    const name = file.name.toLowerCase()
    if (name.endsWith('.xls')) throw new Error('xls_not_supported')
    const sheets = name.endsWith('.csv') ? readCsv(await file.text()) : readXlsx(await file.arrayBuffer())
    return importEsgToolkit(sheets)
}
