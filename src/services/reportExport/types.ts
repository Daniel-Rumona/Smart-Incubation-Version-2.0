export type ReportTemplateId = 'executive' | 'detailed'

export type ReportTone = 'good' | 'watch' | 'risk'

export type ReportKpi = {
  label: string
  value: string | number
  note?: string
  tone?: ReportTone
}

export type ReportCell = string | number

export type ReportTable = {
  key: string
  title: string
  columns: Array<{ key: string, label: string }>
  rows: Array<Record<string, ReportCell>>
}

/** What a reports page hands over: the figures it is already showing, in document-friendly form. */
export type ReportExportData = {
  /** User role, so the AI frames the narrative for that reader. */
  role: string
  title: string
  periodLabel: string
  organisation?: string
  preparedBy: string
  kpis: ReportKpi[]
  tables: ReportTable[]
}

export type ReportActionItem = {
  action: string
  owner: string
  priority: 'High' | 'Medium' | 'Low'
  due: string
  successMeasure: string
}

export type ReportInsights = {
  executiveSummary: string
  highlights: string[]
  risks: string[]
  outlook: string
  actionPlan: ReportActionItem[]
  sectionNotes: Record<string, string>
}

export type ReportTemplateInfo = {
  id: ReportTemplateId
  label: string
  description: string
}
