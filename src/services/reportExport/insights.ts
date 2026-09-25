import { agentApiBaseUrl, isAgentApiConfigured } from '@/config/agent'
import { getAgentAuthHeaders } from '@/services/agentAuth'
import type { ReportActionItem, ReportExportData, ReportInsights, ReportTemplateId } from './types'

const REQUEST_TIMEOUT_MS = 45_000
const MAX_ROWS_PER_TABLE = 25

export const ROLE_LABELS: Record<string, string> = {
  systemadmin: 'Platform administration',
  admin: 'Administration',
  director: 'Executive',
  projectadmin: 'Programme administration',
  projectmanager: 'Project management',
  operations: 'Operations',
  consultant: 'Consultant',
  incubatee: 'SME',
}

export const roleLabel = (role: string) => ROLE_LABELS[role] || 'Programme'

const isActionItem = (item: unknown): item is ReportActionItem => Boolean(item && typeof item === 'object' && 'action' in item)

const asInsights = (value: Partial<ReportInsights> | undefined): ReportInsights | null => {
  if (!value || typeof value.executiveSummary !== 'string' || !value.executiveSummary.trim()) return null
  return {
    executiveSummary: value.executiveSummary.trim(),
    highlights: Array.isArray(value.highlights) ? value.highlights.filter(Boolean) : [],
    risks: Array.isArray(value.risks) ? value.risks.filter(Boolean) : [],
    outlook: typeof value.outlook === 'string' ? value.outlook : '',
    actionPlan: Array.isArray(value.actionPlan) ? value.actionPlan.filter(isActionItem) : [],
    sectionNotes: value.sectionNotes && typeof value.sectionNotes === 'object' ? value.sectionNotes : {},
  }
}

/** Plain-rules narrative used when the AI service is not configured or unavailable, so an export never fails. */
export const buildFallbackInsights = (data: ReportExportData): ReportInsights => {
  const risky = data.kpis.filter((kpi) => kpi.tone === 'risk')
  const watch = data.kpis.filter((kpi) => kpi.tone === 'watch')
  const good = data.kpis.filter((kpi) => kpi.tone === 'good')
  const line = (kpi: ReportExportData['kpis'][number]) => `${kpi.label}: ${kpi.value}${kpi.note ? ` (${kpi.note})` : ''}`

  let executiveSummary = `This ${data.title.toLowerCase()} covers ${data.periodLabel || 'the selected period'} and is written for ${roleLabel(data.role).toLowerCase()} readers.`
  if (data.kpis.length) executiveSummary += ` Headline figures: ${data.kpis.slice(0, 5).map(line).join('; ')}.`
  else executiveSummary += ' No headline figures were captured for this period.'
  if (risky.length) executiveSummary += ` Attention is needed on ${risky.slice(0, 3).map((kpi) => kpi.label.toLowerCase()).join(', ')}.`

  const flagged = [...risky, ...watch]
  return {
    executiveSummary,
    highlights: (good.length ? good : data.kpis).slice(0, 5).map(line),
    risks: flagged.length ? flagged.slice(0, 5).map((kpi) => `${line(kpi)} needs follow-up.`) : ['No figure was flagged as at risk in this period.'],
    outlook: 'Track the flagged figures again next period to confirm they are moving the right way.',
    actionPlan: flagged.length
      ? flagged.slice(0, 4).map((kpi) => ({
        action: `Review and address ${kpi.label.toLowerCase()}`,
        owner: 'Programme team',
        priority: kpi.tone === 'risk' ? 'High' as const : 'Medium' as const,
        due: 'Next reporting cycle',
        successMeasure: `${kpi.label} improves against this report`,
      }))
      : [{ action: 'Keep monitoring the headline figures each cycle', owner: 'Programme team', priority: 'Low', due: 'Next reporting cycle', successMeasure: 'Figures hold or improve' }],
    sectionNotes: Object.fromEntries(data.tables.map((table) => [table.key, `${table.rows.length} record${table.rows.length === 1 ? '' : 's'} in this section.`])),
  }
}

export type ResolvedInsights = { insights: ReportInsights, aiGenerated: boolean }

/** Asks the AI backend for a role-aware narrative; degrades to the figures-based one on any failure. */
export const resolveReportInsights = async (data: ReportExportData, template: ReportTemplateId): Promise<ResolvedInsights> => {
  const fallback = () => ({ insights: buildFallbackInsights(data), aiGenerated: false })
  if (!isAgentApiConfigured) return fallback()

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${agentApiBaseUrl}/api/reports/insights`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(await getAgentAuthHeaders()) },
      body: JSON.stringify({
        reportTitle: data.title,
        periodLabel: data.periodLabel,
        companyName: data.organisation || null,
        role: data.role,
        template,
        kpis: data.kpis,
        sections: data.tables.map((table) => ({
          key: table.key,
          title: table.title,
          rows: table.rows.slice(0, MAX_ROWS_PER_TABLE).map((row) => Object.fromEntries(table.columns.map((column) => [column.label, row[column.key] ?? '']))),
        })),
      }),
    })
    if (!response.ok) return fallback()
    const body = await response.json() as { insights?: Partial<ReportInsights>, model?: string }
    const insights = asInsights(body.insights)
    return insights ? { insights, aiGenerated: body.model !== 'fallback' } : fallback()
  } catch {
    return fallback()
  } finally {
    window.clearTimeout(timeout)
  }
}
