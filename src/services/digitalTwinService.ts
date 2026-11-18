import { collection, documentId, getDocs, query, where, type DocumentData } from 'firebase/firestore'
import { db } from '@/firebase/config'
import { hasRolePermission } from '@/config/permissions'
import { loadDefinitions } from '@/services/interventionDefinitionLookup'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import type { FullIdentity } from '@/types/identity'
import { documentLabel, type TwinDocument, type TwinInput, type TwinPlanItem } from '@/utils/digitalTwin'
import { buildLivePlanItems, type LivePlanItem } from '@/utils/liveDiagnosticPlan'

/**
 * Loads what the digital twin reads for one workspace's SMEs: the same company-scoped reads as the control tower
 * (participants, compliance documents, assigned interventions, growth plans), turned into the twin's inputs plus a
 * feed of recent activity. Nothing is written.
 */

type Row = DocumentData & { id: string }

export type TwinActivity = { at: Date; layer: 'growth' | 'support' | 'skills' | 'compliance' | 'sustainability' | 'engagement'; title: string; detail: string }

export type TwinBusiness = {
  id: string
  businessName: string
  ownerName: string
  sector?: string
  province?: string
  programId?: string
  programName?: string
  joinedAt: Date | null
  input: TwinInput
  activity: TwinActivity[]
  overdue: number
  /** LMS courses, when the workspace's records can be read. */
  courses: { completed: number; total: number } | null
  /** The same business as a training client in this workspace, linked on the company (linkedParticipantId) or by name. */
  linkedOrganisation: { id: string; name: string } | null
}

const text = (...values: unknown[]) => values.map((value) => String(value ?? '').trim()).find(Boolean) || ''
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size))
const INACTIVE = ['inactive', 'exited', 'removed', 'discontinued']
const toDate = (value: unknown): Date | null => {
  if (!value) return null
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') return (value as { toDate: () => Date }).toDate()
  const date = new Date(value as string)
  return Number.isNaN(date.getTime()) ? null : date
}
const latest = (dates: Array<Date | null>) => dates.filter((date): date is Date => !!date).sort((a, b) => b.getTime() - a.getTime())[0] || null
const earliest = (dates: Array<Date | null>) => dates.filter((date): date is Date => !!date).sort((a, b) => a.getTime() - b.getTime())[0] || null
const isOpen = (row: Row) => !['completed', 'cancelled', 'canceled', 'declined'].includes(text(row.status).toLowerCase())

const monthlyRevenue = (participant: Row) => Object.entries((participant.revenueHistory?.monthly || {}) as Record<string, unknown>)
  .map(([period, raw]) => ({ period, value: typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/,/g, '')) }))
  .filter((row) => Number.isFinite(row.value))
  .sort((a, b) => a.period.localeCompare(b.period))

export const loadTwinBusinesses = async (user: FullIdentity, activeProgramId?: string | null, now = new Date()): Promise<TwinBusiness[]> => {
  if (!hasRolePermission(user.role, 'view_participants', user.permissions)) throw new Error('forbidden')
  const companyCode = text(user.companyCode)
  if (!companyCode) return []

  const [participantSnap, documentSnap, assignmentSnap, programSnap, courseRead, organisationRead] = await Promise.all([
    getDocs(query(collection(db, 'participants'), where('companyCode', '==', companyCode))),
    getDocs(query(collection(db, 'complianceDocuments'), where('companyCode', '==', companyCode))),
    getDocs(query(collection(db, 'assignedInterventions'), where('companyCode', '==', companyCode))),
    getDocs(query(collection(db, 'programs'), where('companyCode', '==', companyCode))),
    getDocs(query(collection(db, 'courseProgress'), where('companyCode', '==', companyCode))).then((snap) => snap, () => null),
    getDocs(query(collection(db, 'trainingOrganisations'), where('companyCode', '==', companyCode))).then((snap) => snap, () => null),
  ])
  const organisations = (organisationRead?.docs || []).map((row) => ({ id: row.id, name: text(row.data().name), linkedParticipantId: text(row.data().linkedParticipantId) }))

  const participants: Row[] = participantSnap.docs
    .map((row) => ({ id: row.id, ...row.data() }) as Row)
    .filter((row) => !INACTIVE.includes(text(row.status).toLowerCase()) && matchesActiveProgram(user, activeProgramId, row.programId))

  const applicationIds = [...new Set(participants.map((row) => text(row.applicationId)).filter(Boolean))]
  const planSnaps = await Promise.all(chunks(applicationIds, 10).map((ids) => getDocs(query(collection(db, 'diagnosticPlans'), where(documentId(), 'in', ids)))))
  const plans = new Map<string, Row>(planSnaps.flatMap((snap) => snap.docs.map((row) => [row.id, { id: row.id, ...row.data() }] as [string, Row])))
  const planRefs = [...plans.values()].flatMap((plan) => (Array.isArray(plan.interventions) ? plan.interventions : []).map((item: DocumentData) => ({ interventionId: text(item.interventionId, item.id), companyCode: text(plan.companyCode, companyCode) })))
  const definitions = await loadDefinitions(db, planRefs)

  const group = (rows: Row[]) => {
    const map = new Map<string, Row[]>()
    rows.forEach((row) => { const id = text(row.participantId); if (id) map.set(id, [...(map.get(id) || []), row]) })
    return map
  }
  const documentsBy = group(documentSnap.docs.map((row) => ({ id: row.id, ...row.data() })))
  const assignmentsBy = group(assignmentSnap.docs.map((row) => ({ id: row.id, ...row.data() })))
  const coursesBy = group(courseRead ? courseRead.docs.map((row) => ({ id: row.id, ...row.data() })) : [])
  const programNames = new Map(programSnap.docs.map((row) => [row.id, text(row.data().name, row.data().programName, row.data().title, row.id)]))

  return participants.map((participant): TwinBusiness => {
    const assignments = assignmentsBy.get(participant.id) || []
    const byId = new Map(assignments.map((row) => [row.id, row]))
    const plan = plans.get(text(participant.applicationId))
    const planItems = (Array.isArray(plan?.interventions) ? plan.interventions : []).map((item: DocumentData) => {
      const definition = definitions.get(text(item.interventionId, item.id), text(plan?.companyCode, companyCode)) || {}
      return { ...item, areaOfSupport: item.areaOfSupport || definition.areaOfSupport, executionMode: item.executionMode || definition.executionMode, steps: Array.isArray(item.steps) ? item.steps : definition.steps }
    })
    const live = buildLivePlanItems(planItems as unknown as Array<{ title: string }>, assignments) as unknown as LivePlanItem[]
    const twinPlan: TwinPlanItem[] = live.map((item) => {
      const rows = item.stepRows.map((step) => (step.assignmentId ? byId.get(step.assignmentId) : undefined)).filter((row): row is Row => !!row)
      return {
        ...item,
        dueAt: latest(rows.filter(isOpen).map((row) => toDate(row.dueDate))),
        doneAt: item.status === 'Completed' ? latest(rows.map((row) => toDate(row.completionConfirmedAt) || toDate(row.completedAt))) : null,
        startedAt: earliest(rows.map((row) => toDate(row.createdAt))),
      }
    })
    const documents: TwinDocument[] = (documentsBy.get(participant.id) || []).map((row) => ({
      id: row.id, key: row.key, type: row.type, currentStatus: row.currentStatus, expiryDate: row.expiryDate,
      label: documentLabel(row as { key?: unknown; type?: unknown; documentName?: unknown }), issuedAt: toDate(row.issueDate) || toDate(row.createdAt), expiresAt: toDate(row.expiryDate),
    }))

    const activity: TwinActivity[] = []
    assignments.forEach((row) => {
      const title = text(row.interventionTitle, row.title) || 'Intervention'
      const completed = toDate(row.completionConfirmedAt) || toDate(row.completedAt)
      if (completed) activity.push({ at: completed, layer: 'support', title: 'Intervention completed', detail: title })
      const checkback = row.smeCheckback as { answer?: string; recordedAt?: unknown; via?: string } | undefined
      const checkedAt = toDate(checkback?.recordedAt)
      if (checkedAt) activity.push({ at: checkedAt, layer: 'engagement', title: `Check-back answered${checkback?.via === 'whatsapp' ? ' on WhatsApp' : ''}`, detail: `${title}: ${text(checkback?.answer) || 'answered'}` })
      const outcomeAt = toDate((row.outcomeResult as { recordedAt?: unknown } | undefined)?.recordedAt)
      if (outcomeAt) activity.push({ at: outcomeAt, layer: 'support', title: 'Outcome recorded', detail: `${title}: ${text((row.outcomeResult as { result?: string }).result)}` })
      ;(Array.isArray(row.progressSteps) ? row.progressSteps : []).forEach((step: DocumentData) => {
        const at = toDate(step.createdAt)
        if (at) activity.push({ at, layer: 'support', title: 'Progress logged', detail: `${title}: ${Number(step.progressAfter ?? 0)}%` })
      })
    })
    documents.forEach((doc) => { if (doc.issuedAt) activity.push({ at: doc.issuedAt, layer: 'compliance', title: 'Document on file', detail: `${doc.label[0].toUpperCase()}${doc.label.slice(1)} (${text(doc.currentStatus) || 'uploaded'})` }) })
    const revenue = monthlyRevenue(participant)
    revenue.slice(-3).forEach((row) => {
      const at = new Date(`${row.period}-28T12:00:00Z`)
      if (!Number.isNaN(at.getTime())) activity.push({ at, layer: 'growth', title: 'Monthly revenue reported', detail: `${row.period}: R ${Math.round(row.value).toLocaleString('en-ZA')}` })
    })
    const courses = coursesBy.get(participant.id) || []
    courses.forEach((row) => { const at = toDate(row.completedAt); if (at) activity.push({ at, layer: 'skills', title: 'Course completed', detail: text(row.courseTitle, row.title) || 'LMS course' }) })

    return {
      id: participant.id,
      businessName: text(participant.businessName, participant.companyName) || 'Unnamed SME',
      ownerName: text(participant.participantName, participant.contactName, participant.ownerName),
      sector: text(participant.sector) || undefined,
      province: text(participant.province) || undefined,
      programId: text(participant.programId) || undefined,
      programName: programNames.get(text(participant.programId)) || undefined,
      joinedAt: toDate(participant.acceptedAt) || toDate(participant.createdAt),
      input: {
        now,
        documents,
        plan: twinPlan,
        revenueMonthly: revenue,
        yearsOfTrading: typeof participant.yearsOfTrading === 'number' ? participant.yearsOfTrading : null,
        digitalPresence: participant.digitalPresence,
      },
      activity: activity.filter((item) => item.at.getTime() <= now.getTime()).sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 8),
      overdue: twinPlan.filter((item) => !['Completed', 'Declined', 'Not assigned'].includes(item.status) && item.dueAt && item.dueAt.getTime() < now.getTime()).length,
      courses: courseRead ? { completed: courses.filter((row) => text(row.status) === 'completed').length, total: courses.length } : null,
      linkedOrganisation: (() => {
        const name = text(participant.businessName, participant.companyName).toLowerCase()
        const found = organisations.find((row) => row.linkedParticipantId === participant.id) || organisations.find((row) => !row.linkedParticipantId && name && row.name.toLowerCase() === name)
        return found ? { id: found.id, name: found.name } : null
      })(),
    }
  })
}
