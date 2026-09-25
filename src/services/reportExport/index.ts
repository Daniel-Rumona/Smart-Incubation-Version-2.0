import { getCompanyName } from '@/services/userProfileService'
import { buildReportDocx } from './docx'
import { resolveReportInsights, roleLabel } from './insights'
import type { ReportExportData, ReportTemplateId } from './types'

export type { ReportCell, ReportExportData, ReportKpi, ReportTable, ReportTemplateId, ReportTone } from './types'
export { roleLabel } from './insights'

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const saveBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Writes the AI narrative for the reader's role, lays it out in the chosen template and downloads the
 * .docx. `aiGenerated` is false when the narrative had to be built from the figures instead.
 */
export const exportReport = async (reportData: ReportExportData, template: ReportTemplateId) => {
  // Pages pass the company code; readers should see the company's name.
  const data = reportData.organisation ? { ...reportData, organisation: await getCompanyName(reportData.organisation) } : reportData
  const { insights, aiGenerated } = await resolveReportInsights(data, template)
  const blob = buildReportDocx({ data, insights, aiGenerated, template, roleName: roleLabel(data.role) })
  saveBlob(blob, `${slug(data.title)}-${template}-${slug(data.periodLabel) || 'report'}.docx`)
  return { aiGenerated }
}
