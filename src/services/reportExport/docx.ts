import PizZip from 'pizzip'
import type { ReportCell, ReportExportData, ReportInsights, ReportKpi, ReportTable, ReportTemplateId } from './types'

/**
 * Builds the report .docx directly as WordprocessingML, so tables can have any number of columns and
 * rows. Two layouts share these blocks: an executive summary (portrait, ~2 pages) and a detailed
 * report (landscape, with the data tables and per-section commentary).
 */

const BRAND = '5B4BD9'
const INK = '172033'
const MUTED = '64748B'
const RULE = 'E2E8F0'
const ZEBRA = 'F8F7FF'
const TONE_COLOURS = { good: '15803D', watch: 'B45309', risk: 'B91C1C' } as const
const PRIORITY_COLOURS: Record<string, string> = { High: 'B91C1C', Medium: 'B45309', Low: '15803D' }

const PORTRAIT = { width: 11906, height: 16838, margin: 1134, landscape: false }
const LANDSCAPE = { width: 16838, height: 11906, margin: 1134, landscape: true }
type Page = typeof PORTRAIT

const MAX_TABLE_ROWS = 60

// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g
const esc = (value: unknown) => String(value ?? '')
  .replace(INVALID_XML, '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

type RunOptions = { bold?: boolean, italic?: boolean, colour?: string, size?: number }
const run = (text: unknown, options: RunOptions = {}) => {
  const props = [
    options.bold ? '<w:b/>' : '',
    options.italic ? '<w:i/>' : '',
    options.colour ? `<w:color w:val="${options.colour}"/>` : '',
    options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : '',
  ].join('')
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
}

type ParaOptions = RunOptions & {
  style?: string
  align?: 'left' | 'center' | 'right'
  before?: number
  after?: number
  indent?: { left: number, hanging?: number }
  keepNext?: boolean
  pageBreakBefore?: boolean
}
const para = (content: string | string[], options: ParaOptions = {}) => {
  const runs = Array.isArray(content) ? content.join('') : run(content, options)
  const props = [
    options.style ? `<w:pStyle w:val="${options.style}"/>` : '',
    options.keepNext ? '<w:keepNext/>' : '',
    options.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    options.before !== undefined || options.after !== undefined ? `<w:spacing w:before="${options.before ?? 0}" w:after="${options.after ?? 120}"/>` : '',
    options.indent ? `<w:ind w:left="${options.indent.left}"${options.indent.hanging ? ` w:hanging="${options.indent.hanging}"` : ''}/>` : '',
    options.align ? `<w:jc w:val="${options.align}"/>` : '',
  ].join('')
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${runs}</w:p>`
}

const paragraphs = (text: string, options: ParaOptions = {}) => text
  .split(/\n+/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => para(line, options))
  .join('')

const heading = (text: string, level: 1 | 2 = 1, pageBreakBefore = false) => para(text, { style: level === 1 ? 'Heading1' : 'Heading2', keepNext: true, pageBreakBefore })

const bullets = (items: string[]) => items
  .map((item) => para([run('•  ', { colour: BRAND, bold: true }), run(item)], { indent: { left: 360, hanging: 260 }, after: 60 }))
  .join('')

type CellOptions = { width: number, shade?: string, span?: number, vAlign?: 'top' | 'center', margins?: number }
const cell = (content: string, options: CellOptions) => {
  const margin = options.margins ?? 100
  return `<w:tc><w:tcPr><w:tcW w:w="${options.width}" w:type="dxa"/>${options.span ? `<w:gridSpan w:val="${options.span}"/>` : ''}${options.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${options.shade}"/>` : ''}<w:tcMar><w:top w:w="${margin}" w:type="dxa"/><w:left w:w="${margin + 20}" w:type="dxa"/><w:bottom w:w="${margin}" w:type="dxa"/><w:right w:w="${margin + 20}" w:type="dxa"/></w:tcMar>${options.vAlign ? `<w:vAlign w:val="${options.vAlign}"/>` : ''}</w:tcPr>${content || para('', { after: 0 })}</w:tc>`
}

const borders = (colour: string, size = 4) => ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map((edge) => `<w:${edge} w:val="single" w:sz="${size}" w:space="0" w:color="${colour}"/>`)
  .join('')

const noBorders = () => ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map((edge) => `<w:${edge} w:val="nil"/>`)
  .join('')

const table = (rows: string[], widths: number[], options: { borders?: boolean } = {}) => `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((sum, width) => sum + width, 0)}" w:type="dxa"/><w:tblBorders>${options.borders === false ? noBorders() : borders(RULE)}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`

const row = (cells: string[], header = false) => `<w:tr><w:trPr><w:cantSplit/>${header ? '<w:tblHeader/>' : ''}</w:trPr>${cells.join('')}</w:tr>`

const spacer = (after = 120) => para('', { after })

const contentWidth = (page: Page) => page.width - page.margin * 2

const splitWidths = (total: number, weights: number[]) => {
  const sum = weights.reduce((acc, weight) => acc + weight, 0)
  const widths = weights.map((weight) => Math.floor((total * weight) / sum))
  widths[widths.length - 1] += total - widths.reduce((acc, width) => acc + width, 0)
  return widths
}

const cellText = (value: ReportCell | undefined) => (value === undefined || value === null || value === '' ? '-' : String(value))

const banner = (data: ReportExportData, roleName: string, page: Page) => {
  const width = contentWidth(page)
  return table([row([cell(
    para(data.title, { bold: true, colour: 'FFFFFF', size: 44, after: 60 })
    + para(`${roleName} report  |  ${data.periodLabel || 'Selected period'}`, { colour: 'E9E5FF', size: 22, after: 0 }),
    { width, shade: BRAND, margins: 220 },
  )])], [width], { borders: false })
}

const metaBlock = (data: ReportExportData, page: Page) => {
  const width = contentWidth(page)
  const half = Math.floor(width / 2)
  const item = (label: string, value: string) => cell(
    para(label.toUpperCase(), { colour: MUTED, size: 15, bold: true, after: 0 }) + para(value || '-', { size: 20, after: 0 }),
    { width: half, margins: 70 },
  )
  return table([
    row([item('Prepared for', data.organisation || 'Programme team'), item('Prepared by', data.preparedBy)]),
    row([item('Reporting period', data.periodLabel), item('Prepared on', new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }))]),
  ], [half, width - half], { borders: false })
}

const kpiGrid = (kpis: ReportKpi[], page: Page, columns: number) => {
  if (!kpis.length) return para('No headline figures were captured for this period.', { italic: true, colour: MUTED })
  const width = contentWidth(page)
  const widths = splitWidths(width, Array.from({ length: columns }, () => 1))
  const rows: string[] = []
  for (let start = 0; start < kpis.length; start += columns) {
    const chunk = kpis.slice(start, start + columns)
    rows.push(row(widths.map((cellWidth, index) => {
      const kpi = chunk[index]
      if (!kpi) return cell('', { width: cellWidth })
      const colour = kpi.tone ? TONE_COLOURS[kpi.tone] : BRAND
      return cell(
        para(String(kpi.value), { bold: true, colour, size: 36, after: 0 })
        + para(kpi.label, { colour: INK, size: 18, bold: true, after: 0 })
        + (kpi.note ? para(kpi.note, { colour: MUTED, size: 16, after: 0 }) : ''),
        { width: cellWidth, shade: ZEBRA, margins: 110 },
      )
    })))
  }
  return table(rows, widths)
}

const dataTable = (columns: string[], bodyRows: string[][], widths: number[], colourFor?: (columnIndex: number, value: string) => string | undefined) => {
  const head = row(columns.map((label, index) => cell(para(label, { bold: true, colour: 'FFFFFF', size: 17, after: 0 }), { width: widths[index], shade: BRAND, margins: 70 })), true)
  const body = bodyRows.map((cells, rowIndex) => row(cells.map((value, index) => cell(
    para(value, { size: 17, after: 0, colour: colourFor?.(index, value) || INK, bold: Boolean(colourFor?.(index, value)) }),
    { width: widths[index], shade: rowIndex % 2 ? ZEBRA : undefined, margins: 60 },
  ))))
  return table([head, ...body], widths)
}

const columnWeights = (columns: string[], bodyRows: string[][]) => columns.map((label, index) => {
  const lengths = bodyRows.slice(0, 25).map((cells) => cells[index]?.length || 0)
  const longest = Math.max(label.length * 0.6, lengths.length ? lengths.reduce((sum, length) => sum + length, 0) / lengths.length : 0)
  return Math.min(4, Math.max(1, Math.ceil(longest / 10)))
})

const reportTable = (source: ReportTable, page: Page) => {
  const shown = source.rows.slice(0, MAX_TABLE_ROWS)
  const bodyRows = shown.map((sourceRow) => source.columns.map((column) => cellText(sourceRow[column.key])))
  const labels = source.columns.map((column) => column.label)
  const widths = splitWidths(contentWidth(page), columnWeights(labels, bodyRows))
  const more = source.rows.length > shown.length
    ? para(`Showing the first ${shown.length} of ${source.rows.length} records.`, { italic: true, colour: MUTED, size: 16, before: 60 })
    : ''
  return dataTable(labels, bodyRows, widths) + more
}

const actionTable = (insights: ReportInsights, page: Page, withSuccessMeasure: boolean) => {
  if (!insights.actionPlan.length) return para('No actions were recommended for this period.', { italic: true, colour: MUTED })
  const columns = withSuccessMeasure ? ['Action', 'Owner', 'Priority', 'Due', 'Success measure'] : ['Action', 'Owner', 'Priority', 'Due']
  const widths = splitWidths(contentWidth(page), withSuccessMeasure ? [4, 2, 1, 1.6, 3.4] : [5, 2, 1.2, 2])
  const bodyRows = insights.actionPlan.map((item) => (withSuccessMeasure
    ? [item.action, item.owner, item.priority, item.due, item.successMeasure]
    : [item.action, item.owner, item.priority, item.due]))
  return dataTable(columns, bodyRows, widths, (index, value) => (index === 2 ? PRIORITY_COLOURS[value] : undefined))
}

const aiNote = (aiGenerated: boolean) => para(
  aiGenerated
    ? 'The narrative in this report was drafted by AI from the platform figures for this period. Please review it before sharing.'
    : 'The narrative in this report was generated from the platform figures for this period (the AI summary service was unavailable).',
  { italic: true, colour: MUTED, size: 16, before: 240 },
)

const executiveBody = (data: ReportExportData, insights: ReportInsights, roleName: string, aiGenerated: boolean) => [
  banner(data, roleName, PORTRAIT),
  spacer(160),
  metaBlock(data, PORTRAIT),
  heading('Executive summary'),
  paragraphs(insights.executiveSummary),
  heading('Headline figures'),
  kpiGrid(data.kpis.slice(0, 8), PORTRAIT, 4),
  insights.highlights.length ? heading('Key highlights') + bullets(insights.highlights) : '',
  insights.risks.length ? heading('Risks and watch-points') + bullets(insights.risks) : '',
  insights.outlook ? heading('Outlook') + paragraphs(insights.outlook) : '',
  heading('Recommended actions'),
  actionTable(insights, PORTRAIT, false),
  aiNote(aiGenerated),
].join('')

const detailedBody = (data: ReportExportData, insights: ReportInsights, roleName: string, aiGenerated: boolean) => [
  banner(data, roleName, LANDSCAPE),
  spacer(160),
  metaBlock(data, LANDSCAPE),
  heading('Executive summary'),
  paragraphs(insights.executiveSummary),
  heading('Headline figures'),
  kpiGrid(data.kpis.slice(0, 16), LANDSCAPE, 6),
  insights.highlights.length ? heading('Key highlights') + bullets(insights.highlights) : '',
  insights.risks.length ? heading('Risks and watch-points') + bullets(insights.risks) : '',
  insights.outlook ? heading('Outlook') + paragraphs(insights.outlook) : '',
  heading('Action plan'),
  actionTable(insights, LANDSCAPE, true),
  heading('Detailed data', 1, true),
  ...data.tables.map((source) => [
    heading(source.title, 2),
    insights.sectionNotes[source.key] ? para(insights.sectionNotes[source.key], { italic: true, colour: MUTED, size: 19 }) : '',
    source.rows.length ? reportTable(source, LANDSCAPE) : para('No records in this period.', { italic: true, colour: MUTED }),
    spacer(200),
  ].join('')),
  heading('About this report'),
  para(`Figures are taken from the Smart Incubation platform for ${data.periodLabel || 'the selected period'} and the scope selected when the report was exported.`, { size: 19 }),
  aiNote(aiGenerated),
].join('')

const PAGE_XML = (page: Page) => `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="${page.width}" w:h="${page.height}"${page.landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${page.margin}" w:right="${page.margin}" w:bottom="${page.margin}" w:left="${page.margin}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:color w:val="${INK}"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-ZA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="${BRAND}"/></w:pBdr><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="${BRAND}"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="${INK}"/><w:sz w:val="25"/><w:szCs w:val="25"/></w:rPr></w:style></w:styles>`

const footerXml = (title: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="${RULE}"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs></w:pPr>${run(`Smart Incubation  |  ${title}`, { colour: MUTED, size: 16 })}<w:r><w:tab/></w:r>${run('Page ', { colour: MUTED, size: 16 })}<w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`

const CONTENT_TYPES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'

const ROOT_RELS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'

const DOCUMENT_RELS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export const TEMPLATE_PAGES: Record<ReportTemplateId, Page> = { executive: PORTRAIT, detailed: LANDSCAPE }

export type BuildDocxInput = {
  data: ReportExportData
  insights: ReportInsights
  aiGenerated: boolean
  template: ReportTemplateId
  roleName: string
}

export const buildReportDocx = ({ data, insights, aiGenerated, template, roleName }: BuildDocxInput): Blob => {
  const page = TEMPLATE_PAGES[template]
  const body = template === 'detailed'
    ? detailedBody(data, insights, roleName, aiGenerated)
    : executiveBody(data, insights, roleName, aiGenerated)
  const footer = footerXml(data.title).replace('w:pos="9638"', `w:pos="${contentWidth(page)}"`)

  const zip = new PizZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML)
  zip.file('_rels/.rels', ROOT_RELS_XML)
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML)
  zip.file('word/styles.xml', STYLES_XML)
  zip.file('word/footer1.xml', footer)
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${PAGE_XML(page)}</w:body></w:document>`)
  return zip.generate({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' })
}
