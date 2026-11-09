import dayjs from 'dayjs'
import { SCOPE_LABELS, carbonTaxEstimate, perUnit, footprintMonths, footprintTotals, formatQuantity, sourceTonnes, sourceUsage } from '@/config/esgEmissions'
import { ESG_SECTORS, alignedStandards, countryName, griDisclosure } from '@/config/esgStandards'
import { fit, imageBytes, loadImage } from '@/utils/agreementDocx'
import { ESG_SECTIONS, contentIndex, figure } from '@/utils/esgReportChecks'
import { rand } from '@/utils/trainingFormat'
import type { EsgAssurance, EsgIndicator, EsgPillar, EsgReport, EsgScope } from '@/types/esg'

/**
 * The ESG report as a Word document, set out like a published sustainability report: cover and contents, about this
 * report (with the standards applied), performance at a glance, the leadership message, the written sections (with
 * the carbon footprint under climate change and energy), approval and assurance, then the performance data tables,
 * the registers, the monthly activity data, the GRI content index and abbreviations. Built with the `docx` library
 * like the signed agreements; the provider's logo is embedded when the storage bucket lets the browser fetch it.
 */

const FONT = 'Calibri'
const BRAND = '2E7D32'
const RULE = 'D9D9D9'
const HEAD = 'EAF4EA'
const PILLARS: Record<EsgPillar, string> = { E: 'Environmental', S: 'Social', G: 'Governance' }

export const periodLabel = (report: Pick<EsgReport, 'periodStart' | 'periodEnd'>) =>
    report.periodStart && report.periodEnd
        ? `${dayjs(report.periodStart).format('D MMMM YYYY')} to ${dayjs(report.periodEnd).format('D MMMM YYYY')}`
        : 'Period not set'

export const statementOfUse = (report: EsgReport) => report.claim === 'in_accordance'
    ? `${report.clientName} has reported in accordance with the GRI Standards for the period ${periodLabel(report)}.`
    : `${report.clientName} has reported the information cited in this GRI content index for the period ${periodLabel(report)} with reference to the GRI Standards.`

/** "up 12% on the baseline", from an indicator's baseline and current value; empty when they are not both figures. */
export const changeOnBaseline = (row: Pick<EsgIndicator, 'baseline' | 'current'>) => {
    const baseline = figure(row.baseline)
    const current = figure(row.current)
    if (baseline === null || current === null || baseline === 0) return ''
    const change = Math.round(((current - baseline) / Math.abs(baseline)) * 100)
    return change === 0 ? 'unchanged on the baseline' : `${change > 0 ? 'up' : 'down'} ${Math.abs(change)}% on the baseline`
}

const ASSURANCE_LABELS: Record<EsgAssurance, string> = {
    none: 'not independently assured',
    internal: 'reviewed internally',
    limited: 'independent limited assurance',
    reasonable: 'independent reasonable assurance',
}

/** Who approved the report and how its figures were checked, as the report states them. */
export const approvalStatements = (report: EsgReport, providerName: string) => {
    const approval = report.approvedBy
        ? `This report was approved by ${report.approvedBy}${report.approverRole ? `, ${report.approverRole}` : ''}, on behalf of ${report.clientName}${report.approvedOn ? `, on ${dayjs(report.approvedOn).format('D MMMM YYYY')}` : ''}.`
        : `Approval of this report by ${report.clientName} is not yet recorded.`
    const by = report.assuranceProvider ? ` by ${report.assuranceProvider}` : ''
    const assurance = {
        none: `The figures in this report have not been independently assured. They come from ${report.clientName}'s own records, as listed under evidence in the performance data.`,
        internal: `The figures in this report were reviewed internally${by}. They have not been independently assured.`,
        limited: `The figures in this report were independently assured${by} (limited assurance). The assurance statement sets out what was covered.`,
        reasonable: `The figures in this report were independently assured${by} (reasonable assurance). The assurance statement sets out what was covered.`,
    }[report.assurance]
    return { approval, assurance, prepared: `Prepared by ${providerName} from information provided by ${report.clientName}.` }
}

const ABBREVIATIONS: Array<[string, string]> = [
    ['CO2e', 'Carbon dioxide equivalent: other greenhouse gases expressed as the CO2 with the same warming effect'],
    ['DESNZ', 'UK Department for Energy Security and Net Zero (publisher of greenhouse gas conversion factors)'],
    ['DFFE', 'Department of Forestry, Fisheries and the Environment (South Africa)'],
    ['ESG', 'Environmental, social and governance'],
    ['GHG', 'Greenhouse gas'],
    ['GJ', 'Gigajoule'],
    ['GRI', 'Global Reporting Initiative'],
    ['kWh', 'Kilowatt hour'],
    ['SARS', 'South African Revenue Service'],
    ['t CO2e', 'Tonnes of carbon dioxide equivalent'],
]

export const downloadEsgReportDocx = async (report: EsgReport, provider: { name: string, logoUrl?: string | null }) => {
    const docx = await import('docx')
    const { AlignmentType, BorderStyle, Document, Footer, HeadingLevel, ImageRun, Packer, PageNumber, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } = docx
    const logo = await loadImage(provider.logoUrl, 500)
    const aligned = alignedStandards(report)
    const sector = ESG_SECTORS.find((item) => item.key === report.sector)?.label || report.sector
    const isDraft = report.status !== 'final'
    const footprint = footprintTotals(report.footprint)
    const hasFootprint = report.footprint.sources.length > 0
    const tax = carbonTaxEstimate(report.footprint, report)
    const statements = approvalStatements(report, provider.name)

    const run = (value: string, options: { bold?: boolean, size?: number, color?: string, italics?: boolean } = {}) =>
        new TextRun({ text: value, font: FONT, size: options.size ?? 22, bold: options.bold, color: options.color, italics: options.italics })
    const para = (value: string | InstanceType<typeof TextRun>[], options: { after?: number, before?: number, center?: boolean, bullet?: boolean } = {}) => new Paragraph({
        children: typeof value === 'string' ? [run(value)] : value,
        alignment: options.center ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { before: options.before ?? 0, after: options.after ?? 140 },
        ...(options.bullet ? { bullet: { level: 0 } } : {}),
    })
    const heading = (value: string, level: 1 | 2 = 1) => new Paragraph({
        heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
        spacing: { before: level === 1 ? 320 : 220, after: 120 },
        children: [run(value, { bold: true, size: level === 1 ? 30 : 25, color: BRAND })],
    })
    const paragraphs = (value: string) => value.split(/\n{2,}|\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => para(line))
    const border = { style: BorderStyle.SINGLE, size: 4, color: RULE }
    const cell = (value: string | InstanceType<typeof Paragraph>[], header = false, size = 17) => new TableCell({
        children: typeof value === 'string' ? [new Paragraph({ children: [run(value || '—', { size, bold: header })], spacing: { after: 0 } })] : value,
        shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: HEAD } : undefined,
        borders: { top: border, bottom: border, left: border, right: border },
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
    })
    const table = (headers: string[], rows: string[][], size = 17) => new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new TableRow({ tableHeader: true, children: headers.map((header) => cell(header, true, size)) }),
            ...rows.map((row) => new TableRow({ children: row.map((value) => cell(value, false, size)) })),
        ],
    })
    const gap = () => para('', { after: 80 })
    const narrative = (key: string) => report.narrative.find((section) => section.key === key && section.text.trim())
    const titleOf = (key: string) => narrative(key)?.title || ESG_SECTIONS.find((section) => section.key === key)?.title || key

    // Cover.
    const cover = [
        ...(logo ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 }, children: [new ImageRun({ type: 'png', data: imageBytes(logo), transformation: fit(logo, 220, 130) })] })] : []),
        para([run(`${report.clientName}`, { bold: true, size: 44, color: BRAND })], { after: 80 }),
        para([run('Sustainability (ESG) Report', { size: 30 })], { after: 80 }),
        para([run(periodLabel(report), { size: 24 })], { after: 360 }),
        para([run('Prepared by ', { size: 20 }), run(provider.name, { size: 20, bold: true })], { after: 60 }),
        para([run(`${sector} · ${countryName(report.country)}`, { size: 20 })], { after: 60 }),
        ...(report.publicationDate ? [para([run(`Published ${dayjs(report.publicationDate).format('D MMMM YYYY')}`, { size: 20 })])] : []),
        ...(isDraft ? [para([run('DRAFT: not for publication', { bold: true, color: 'B45309', size: 22 })], { before: 240 })] : []),
    ]

    // About this report, with the reporting basis.
    const about = [
        heading(titleOf('about')),
        ...(narrative('about') ? paragraphs(narrative('about')!.text) : []),
        heading('Reporting basis', 2),
        para([run('Organisation: ', { bold: true }), run(`${report.clientName} (${sector}, ${countryName(report.country)})`)]),
        para([run('Reporting period: ', { bold: true }), run(periodLabel(report))]),
        para([run('Statement of use: ', { bold: true }), run(statementOfUse(report))]),
        para([run('GRI 1 used: ', { bold: true }), run('GRI 1: Foundation 2021')]),
        para([run('Applicable GRI Sector Standard: ', { bold: true }), run(aligned.sector ? `${aligned.sector.id}: ${aligned.sector.title}` : 'None published for this sector')]),
        ...(aligned.topics.length ? [para([run('GRI Topic Standards reported against: ', { bold: true }), run(aligned.topics.map((item) => `${item.id}: ${item.title}`).join('; '))])] : []),
        ...aligned.frameworks.map((framework) => para([run(`${framework.label}. `, { bold: true }), run(framework.note, { size: 19 })])),
        ...(report.otherFrameworks ? [para([run('Also reported under: ', { bold: true }), run(report.otherFrameworks)])] : []),
        ...(hasFootprint ? [para([run('Greenhouse gas emissions: ', { bold: true }), run('calculated following the GHG Protocol Corporate Standard (see Climate change and energy).')])] : []),
        para([run('Assurance: ', { bold: true }), run(`${ASSURANCE_LABELS[report.assurance]} (see Approval and assurance).`)]),
        ...aligned.reasons.map((reason) => para([run(reason, { size: 19, italics: true })])),
    ]

    // Performance at a glance: the footprint and each pillar's headline figures.
    const withValue = (pillar: EsgPillar) => report.indicators.filter((row) => row.pillar === pillar && row.current.trim()).slice(0, 6)
    const glanceCell = (pillar: EsgPillar) => {
        const rows = withValue(pillar)
        return cell(rows.length ? rows.flatMap((row) => {
            const change = changeOnBaseline(row)
            return [
                new Paragraph({ spacing: { after: 0 }, children: [run(`${row.current}${row.unit ? ` ${row.unit}` : ''}`, { bold: true, size: 22, color: BRAND })] }),
                new Paragraph({ spacing: { after: 120 }, children: [run(row.indicator, { size: 17 }), ...(change ? [run(` (${change})`, { size: 16, color: '595959' })] : [])] }),
            ]
        }) : [new Paragraph({ children: [run('No figures yet', { size: 17, italics: true })] })])
    }
    const glanceTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new TableRow({ tableHeader: true, children: (['E', 'S', 'G'] as EsgPillar[]).map((pillar) => cell(PILLARS[pillar], true, 19)) }),
            new TableRow({ children: (['E', 'S', 'G'] as EsgPillar[]).map(glanceCell) }),
        ],
    })
    const glance = [
        heading('Performance at a glance'),
        ...(hasFootprint ? [para([
            run('Carbon footprint: ', { bold: true }),
            run(`${formatQuantity(footprint.total)} t CO2e`, { bold: true, color: BRAND }),
            run(` (Scope 1: ${formatQuantity(footprint.byScope[1])} t; Scope 2: ${formatQuantity(footprint.byScope[2])} t; Scope 3: ${formatQuantity(footprint.byScope[3])} t)`),
        ])] : []),
        glanceTable,
        gap(),
    ]

    // Climate change and energy: the written section and the carbon footprint.
    const scopes = ([1, 2, 3] as EsgScope[]).filter((scope) => footprint.scopesRecorded.includes(scope))
    const share = (value: number) => (footprint.total > 0 ? `${Math.round((value / footprint.total) * 100)}%` : '—')
    const factorLines = [...new Map(report.footprint.sources.filter((source) => typeof source.factor === 'number').map((source) => [
        `${source.label}|${source.factor}|${source.factorSource}`,
        `${source.label}: ${formatQuantity(source.factor as number, 5)} kg CO2e per ${perUnit(source.unit)}${source.factorSource ? `. ${source.factorSource}` : ''}`,
    ])).values()]
    const taxParts = () => {
        if (report.country !== 'ZA' || report.footprint.carbonTaxPayer === 'unsure') return []
        if (!tax.applies) {
            return [heading('Carbon tax', 2), para(`${report.clientName} does not pay carbon tax directly: it runs no activities listed in the Carbon Tax Act above the thresholds. Carbon tax on the petrol and diesel it uses is paid at the pump through the carbon fuel levy.`)]
        }
        // "LPG (gas bottles, ...)" -> "LPG", "Natural gas" -> "natural gas", for the sentence.
        const fuels = [...new Set(report.footprint.sources.filter((source) => source.scope === 1 && source.taxable).map((source) => {
            const name = source.label.replace(/\s*\(.*\)\s*$/, '').trim()
            return /^[A-Z0-9]{2,}\b/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1)
        }))]
        const fuelList = fuels.length > 1 ? `${fuels.slice(0, -1).join(', ')} and ${fuels[fuels.length - 1]}` : fuels[0]
        return [
            heading('Carbon tax', 2),
            para(`${report.clientName} pays carbon tax on its Scope 1 emissions${fuelList ? ` from ${fuelList}` : ''}. The estimate for this period is ${rand(tax.net)}: ${rand(tax.gross)} before tax-free allowances of ${tax.allowancePct}%. Petrol and diesel are left out, as their carbon tax is paid at the pump. This is an estimate; ${report.clientName}'s carbon tax return to SARS decides the amount.`),
            table(['Year', 'Taxable Scope 1 (t CO2e)', 'Rate per tonne', 'Before allowances'], tax.years.map((row) => [
                String(row.year), formatQuantity(row.tonnes), row.rate === null ? 'Not on file' : `${rand(row.rate)}${row.announced ? '' : ' (latest announced rate)'}`, row.rate === null ? '—' : rand(row.tonnes * row.rate),
            ])),
            gap(),
        ]
    }
    const climate = !narrative('climate') && !hasFootprint ? [] : [
        heading(titleOf('climate')),
        ...(narrative('climate') ? paragraphs(narrative('climate')!.text) : []),
        ...(hasFootprint ? [
            heading('Greenhouse gas emissions', 2),
            table(['Scope', 't CO2e', 'Share'], [
                ...scopes.map((scope) => [SCOPE_LABELS[scope], formatQuantity(footprint.byScope[scope]), share(footprint.byScope[scope])]),
                ['Total', formatQuantity(footprint.total), footprint.total > 0 ? '100%' : '—'],
            ], 19),
            gap(),
            heading('Emissions by source', 2),
            table(['Scope', 'Source', 'Activity in the period', 'Emission factor (kg CO2e per unit)', 't CO2e'], report.footprint.sources.map((source) => [
                String(source.scope), source.label, `${formatQuantity(sourceUsage(source))} ${sourceUsage(source) === 1 ? perUnit(source.unit) : source.unit}`,
                typeof source.factor === 'number' ? formatQuantity(source.factor, 5) : 'Not entered', typeof source.factor === 'number' ? formatQuantity(sourceTonnes(source)) : '—',
            ])),
            gap(),
            ...taxParts(),
            heading('Method and emission factors', 2),
            para(`Emissions are calculated as activity data multiplied by emission factors, following the GHG Protocol Corporate Standard, and reported in tonnes of carbon dioxide equivalent (t CO2e). Scope 2 is location-based: the official grid emission factor of ${countryName(report.country)} for the year${report.country === 'ZA' ? ', the national generation grid emission factor published by the Department of Forestry, Fisheries and the Environment (DFFE)' : ''}. The monthly activity data is in the appendix. The factors used:`),
            ...factorLines.map((line) => para([run(line, { size: 19 })], { bullet: true, after: 60 })),
        ] : []),
        gap(),
    ]

    const section = (key: string) => (narrative(key) ? [heading(titleOf(key)), ...paragraphs(narrative(key)!.text), gap()] : [])
    const approval = [
        heading('Approval and assurance'),
        para(statements.approval),
        para(statements.assurance),
        para(statements.prepared),
    ]
    const body = [
        ...about,
        ...glance,
        ...section('leadership'),
        ...section('strategy'),
        ...section('materiality'),
        ...section('environment'),
        ...climate,
        ...section('social'),
        ...section('governance'),
        ...section('stakeholders'),
        ...section('actions'),
        ...approval,
    ]

    // Performance data, the registers and the index: landscape, for the wide tables.
    const dataTables = (['E', 'S', 'G'] as EsgPillar[]).flatMap((pillar) => {
        const rows = report.indicators.filter((row) => row.pillar === pillar)
        return rows.length ? [
            heading(PILLARS[pillar], 2),
            table(['Indicator', 'Unit', 'Baseline', 'Current', 'Target', 'Change', 'Evidence', 'GRI'], rows.map((row) => [
                row.indicator, row.unit, row.baseline, row.current, row.target, changeOnBaseline(row).replace(' on the baseline', ''), row.evidence, row.disclosure,
            ])),
            gap(),
        ] : []
    })
    const months = footprintMonths(report.periodStart)
    let letter = 0
    const appendix = (title: string) => heading(`Appendix ${String.fromCharCode(65 + letter++)}: ${title}`)
    const appendices = [
        heading('Performance data'),
        ...(dataTables.length ? dataTables : [para('No figures recorded.')]),
        ...(report.risks.length ? [
            appendix('ESG risk register'),
            table(['Pillar', 'Risk', 'Affected stakeholders', 'Likelihood', 'Impact', 'Score', 'Mitigation / control', 'Owner', 'Status'], report.risks.map((row) => [
                PILLARS[row.pillar], row.risk, row.stakeholders, row.likelihood?.toString() || '', row.impact?.toString() || '',
                row.likelihood && row.impact ? String(row.likelihood * row.impact) : '', row.mitigation, row.owner, row.status,
            ])),
            gap(),
        ] : []),
        ...(report.stakeholders.length ? [
            appendix('Stakeholder map'),
            table(['Stakeholder', 'Concern', 'Influence', 'Impact', 'Engagement method', 'Owner', 'Next review'], report.stakeholders.map((row) => [
                row.stakeholder, row.concern, row.influence?.toString() || '', row.impact?.toString() || '', row.engagement, row.owner, row.nextReview,
            ])),
            gap(),
        ] : []),
        ...(report.actions.length ? [
            appendix('Action plan'),
            table(['Pillar', 'Action', 'Baseline', 'Target', 'KPI', 'Owner', 'Start', 'Due', 'Budget', 'Status'], report.actions.map((row) => [
                PILLARS[row.pillar], row.action, row.baseline, row.target, row.kpi, row.owner, row.startDate, row.dueDate, row.budget, row.status,
            ])),
            gap(),
        ] : []),
        ...(hasFootprint ? [
            appendix('Carbon footprint: monthly activity data'),
            table(['Source', 'Unit', ...months.map((month) => month.label), 'Total'], report.footprint.sources.map((source) => [
                `${source.label} (Scope ${source.scope})`, source.unit, ...source.monthly.map((value) => (typeof value === 'number' ? formatQuantity(value) : '')), formatQuantity(sourceUsage(source)),
            ]), 14),
            gap(),
        ] : []),
        heading('GRI content index'),
        para(statementOfUse(report), { after: 120 }),
        table(['GRI Standard', 'Disclosure', 'Location', 'Note'], contentIndex(report).map((row) => [
            row.standard, `${row.disclosure} ${griDisclosure(row.disclosure)?.title || row.title}`, row.location, row.note || '',
        ])),
        gap(),
        heading('Abbreviations'),
        table(['Abbreviation', 'Meaning'], ABBREVIATIONS),
    ]

    // Contents: the headings this document has, in order.
    const contentsTitles = [
        titleOf('about'), 'Performance at a glance',
        ...['leadership', 'strategy', 'materiality', 'environment'].filter((key) => narrative(key)).map(titleOf),
        ...(climate.length ? [titleOf('climate')] : []),
        ...['social', 'governance', 'stakeholders', 'actions'].filter((key) => narrative(key)).map(titleOf),
        'Approval and assurance', 'Performance data',
        ...(report.risks.length || report.stakeholders.length || report.actions.length || hasFootprint ? ['Appendices'] : []),
        'GRI content index', 'Abbreviations',
    ]
    const contents = [heading('Contents'), ...contentsTitles.map((title) => para(title, { after: 80 }))]

    const footer = new Footer({
        children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
                run(`${report.clientName} sustainability report · prepared by ${provider.name}${isDraft ? ' · DRAFT' : ''} · page `, { size: 16 }),
                new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16 }),
                run(' of ', { size: 16 }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16 }),
            ],
        })],
    })
    const portrait = { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } }
    const landscape = { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: { top: 900, right: 900, bottom: 900, left: 900 } } }

    const document = new Document({
        creator: provider.name,
        title: `${report.clientName} Sustainability (ESG) Report`,
        styles: { default: { document: { run: { font: FONT, size: 22 } } } },
        sections: [
            { properties: portrait, footers: { default: footer }, children: [...cover] },
            { properties: portrait, footers: { default: footer }, children: [...contents] },
            { properties: portrait, footers: { default: footer }, children: body },
            { properties: landscape, footers: { default: footer }, children: appendices },
        ],
    })
    const blob = await Packer.toBlob(document)
    const link = window.document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${report.clientName.replace(/[^\w.-]+/g, '-')}-ESG-report-${report.periodEnd.slice(0, 4) || 'draft'}.docx`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    return { logoEmbedded: Boolean(logo) }
}
