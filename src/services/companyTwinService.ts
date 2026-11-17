import { collection, getDocs, query, where, type DocumentData } from 'firebase/firestore'
import { db } from '@/firebase/config'
import type { FullIdentity } from '@/types/identity'
import type { TwinActivity } from '@/services/digitalTwinService'
import type { CompanyInput, CompanyLearner, CompanyTwinSource } from '@/utils/companyTwin'
import { money } from '@/utils/twinView'

/**
 * Loads what the training side's digital twin reads for one training provider's client companies: companies, their
 * people and classes, certificates, marked final assessments, business figures and ESG reports, all company-scoped
 * reads. A read the rules refuse is left out rather than failing the twin. Nothing is written.
 */

type Row = DocumentData & { id: string }
const text = (...values: unknown[]) => values.map((value) => String(value ?? '').trim()).find(Boolean) || ''
const toDate = (value: unknown): Date | null => {
  if (!value) return null
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') return (value as { toDate: () => Date }).toDate()
  const date = new Date(value as string)
  return Number.isNaN(date.getTime()) ? null : date
}
const DAY_MS = 86_400_000

const read = async (name: string, companyCode: string): Promise<Row[]> => {
  try {
    const snapshot = await getDocs(query(collection(db, name), where('companyCode', '==', companyCode)))
    return snapshot.docs.map((row) => ({ id: row.id, ...row.data() }))
  } catch {
    return []
  }
}

export const loadCompanyTwins = async (user: FullIdentity, now = new Date()): Promise<CompanyTwinSource[]> => {
  const companyCode = text(user.companyCode)
  if (!companyCode) return []
  const [organisations, learners, classes, certificates, submissions, metrics, reports] = await Promise.all(
    ['trainingOrganisations', 'trainingLearners', 'trainingClasses', 'trainingCertificates', 'trainingSubmissions', 'trainingOrgMetrics', 'esgReports'].map((name) => read(name, companyCode)),
  )

  const classById = new Map(classes.map((row) => {
    const start = toDate(`${text(row.startDate)}T08:00:00`)
    const days = Math.max(1, Number(row.dayCount) || 1)
    return [row.id, { title: text(row.courseTitle) || 'a class', start, end: start ? new Date(start.getTime() + (days - 1) * DAY_MS + 9 * 3_600_000) : null, passMark: Number(row.passMarkPct) || 50 }]
  }))
  const nextClass = [...classById.values()]
    .filter((row) => row.start && row.end && row.start.getTime() > now.getTime())
    .sort((a, b) => (a.start as Date).getTime() - (b.start as Date).getTime())[0] || null

  return organisations.map((organisation): CompanyTwinSource => {
    const nameKey = text(organisation.name).toLowerCase()
    const people = learners.filter((row) => text(row.organisationId) === organisation.id || (!text(row.organisationId) && text(row.organisation).toLowerCase() === nameKey))
    const ids = new Set(people.map((row) => row.id))
    const certificateBy = new Map(certificates.filter((row) => ids.has(text(row.learnerId)) && text(row.status) !== 'cancelled').map((row) => [text(row.learnerId), row]))
    const finals = submissions.filter((row) => ids.has(text(row.learnerId)) && text(row.kind) === 'post' && text(row.status) === 'marked' && toDate(row.markedAt))

    const companyLearners: CompanyLearner[] = people.map((row) => {
      const cls = classById.get(text(row.classId))
      const certificate = certificateBy.get(row.id)
      return { id: row.id, name: text(row.name), classEnd: cls?.end || null, certifiedAt: certificate ? toDate(certificate.issuedOn) || toDate(certificate.createdAt) || cls?.end || null : null }
    })
    const documents = Object.entries((organisation.documents || {}) as Record<string, { uploadedAt?: unknown }>).map(([key, value]) => ({ key, uploadedAt: toDate(value?.uploadedAt) }))
    const ownMetrics = metrics.filter((row) => text(row.organisationId) === organisation.id)
      .map((row) => ({ period: text(row.period), revenue: Number(row.revenue) || 0, employees: typeof row.employees === 'number' ? row.employees : null, recordedAt: toDate(row.recordedAt) }))
      .filter((row) => /^\d{4}-\d{2}$/.test(row.period))
      .sort((a, b) => a.period.localeCompare(b.period))
    const report = reports.filter((row) => text(row.organisationId) === organisation.id || text(row.clientName).toLowerCase() === nameKey)
      .sort((a, b) => (toDate(b.updatedAt)?.getTime() || 0) - (toDate(a.updatedAt)?.getTime() || 0))[0]
    const status = text(report?.status)
    const esg = report ? {
      status: (status === 'final' || status === 'in_review' ? status : 'draft') as 'draft' | 'in_review' | 'final',
      createdAt: toDate(report.createdAt),
      finalAt: status === 'final' ? toDate(report.updatedAt) || toDate(report.createdAt) : null,
    } : null

    const activity: TwinActivity[] = []
    companyLearners.forEach((learner) => { if (learner.certifiedAt) activity.push({ at: learner.certifiedAt, layer: 'skills', title: 'Certificate issued', detail: learner.name }) })
    finals.forEach((row) => { const at = toDate(row.markedAt); if (at) activity.push({ at, layer: 'skills', title: 'Final assessment marked', detail: `${Math.round(Number(row.scorePct) || 0)}%` }) })
    people.forEach((row) => Object.values((row.attendance || {}) as Record<string, { present?: boolean; recordedAt?: unknown }>).forEach((day) => {
      const at = toDate(day?.recordedAt)
      if (at && day.present) activity.push({ at, layer: 'support', title: 'Attended a class day', detail: text(row.name) })
    }))
    documents.forEach((doc) => { if (doc.uploadedAt) activity.push({ at: doc.uploadedAt, layer: 'compliance', title: 'Document uploaded', detail: doc.key }) })
    ownMetrics.forEach((row) => { if (row.recordedAt) activity.push({ at: row.recordedAt, layer: 'growth', title: 'Business figures recorded', detail: `${row.period}: ${money(row.revenue)}` }) })
    if (report) { const at = toDate(report.updatedAt) || toDate(report.createdAt); if (at) activity.push({ at, layer: 'sustainability', title: 'ESG report updated', detail: status || 'draft' }) }

    const input: CompanyInput = {
      now,
      detailsAt: toDate(organisation.detailsSubmittedAt),
      documents,
      learners: companyLearners,
      results: finals.map((row) => ({ markedAt: toDate(row.markedAt) as Date, passed: (Number(row.scorePct) || 0) >= (classById.get(text(row.classId))?.passMark ?? 50) })),
      metrics: ownMetrics.map(({ period, revenue, employees }) => ({ period, revenue, employees })),
      esg,
      nextClass: nextClass ? { title: nextClass.title, start: nextClass.start as Date, end: nextClass.end as Date } : null,
    }
    const details = (organisation.details || {}) as Record<string, unknown>
    return {
      input,
      subject: {
        id: organisation.id,
        name: text(organisation.name) || 'Client company',
        sub: [text(organisation.contactName), text(details.sector), `${people.length} staff booked`].filter(Boolean).join(' · '),
        peerGroup: text(details.sector) || 'all',
        activity: activity.filter((item) => item.at.getTime() <= now.getTime()).sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 8),
        now,
      },
    }
  })
}
