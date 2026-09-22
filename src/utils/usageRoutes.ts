const routeLabels: Array<[RegExp, string]> = [
  [/^\/dashboard$/, 'Dashboard'],
  [/^\/operations$/, 'Operations Dashboard'],
  [/^\/operations\/staff\/manage$/, 'Staff / Manage'],
  [/^\/operations\/participants\/diagnostic-plans$/, 'Participants / Diagnostic Plans'],
  [/^\/operations\/participants\/all$/, 'Participants / View All'],
  [/^\/operations\/participants\/new$/, 'Participants / New Participant'],
  [/^\/operations\/participants\/applications$/, 'Participants / Applications'],
  [/^\/operations\/compliance$/, 'Compliance'],
  [/^\/operations\/interventions$/, 'Interventions'],
  [/^\/operations\/reports$/, 'Reports'],
  [/^\/admin\/users$/, 'Admin / User Management'],
  [/^\/admin\/usage$/, 'Admin / Usage Analytics'],
  [/^\/admin\/email-operations$/, 'Admin / Email Operations'],
  [/^\/settings$/, 'Settings'],
  [/^\/applicant\/profile$/, 'Applicant / Profile'],
  [/^\/applicant\/programs$/, 'Applicant / Programs'],
  [/^\/applicant\/application-tracker$/, 'Applicant / Application Tracker'],
  [/^\/incubatee$/, 'Incubatee Dashboard'],
  [/^\/incubatee\/interventions$/, 'Incubatee / Interventions'],
  [/^\/incubatee\/tracker$/, 'Incubatee / Interventions'],
]

export const formatUsageRoute = (path: string) => {
  const normalized = path.split('?')[0].replace(/\/+$/, '') || '/'
  const match = routeLabels.find(([pattern]) => pattern.test(normalized))
  if (match) return match[1]
  if (normalized === '/') return 'Home'
  return normalized.split('/').filter(Boolean).map((part) => part
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())).join(' / ')
}
