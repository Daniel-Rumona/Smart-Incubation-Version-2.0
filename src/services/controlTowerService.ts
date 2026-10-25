import { collection, doc, documentId, getDoc, getDocs, query, where, type DocumentData } from 'firebase/firestore'
import { db } from '@/firebase/config'
import { hasRolePermission } from '@/config/permissions'
import { loadDefinitions } from '@/services/interventionDefinitionLookup'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import type { FullIdentity } from '@/types/identity'
import { buildLivePlanItems, livePlanProgress, type LivePlanItem } from '@/utils/liveDiagnosticPlan'
import { assessReadiness, type SmeReadiness } from '@/utils/readiness'

type Row = DocumentData & { id: string }

export type ControlTowerSme = {
  id: string
  applicationId: string
  businessName: string
  ownerName: string
  email?: string
  phone?: string
  sector?: string
  stage?: string
  province?: string
  city?: string
  programId?: string
  programName?: string
  imageUrl?: string
  yearsOfTrading?: number
  /** Latest monthly revenue and the change over the recorded months (percent). */
  revenueLatest: number | null
  revenueChange: number | null
  /** Share of this SME's compliance documents that are valid, 0-100. */
  complianceScore: number | null
  complianceValid: number
  complianceTotal: number
  planProgress: number
  planCompleted: number
  planTotal: number
  readiness: SmeReadiness
}

const text = (...values: unknown[]) => values.map(value => String(value ?? '').trim()).find(Boolean) || ''
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size))
const INACTIVE = ['inactive', 'exited', 'removed', 'discontinued']

const monthlyRevenue = (participant: Row) => {
  const monthly = (participant.revenueHistory?.monthly || {}) as Record<string, unknown>
  return Object.entries(monthly)
    .map(([period, raw]) => ({ period, value: typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/,/g, '')) }))
    .filter(row => Number.isFinite(row.value))
    .sort((a, b) => a.period.localeCompare(b.period))
}

/**
 * Everything the control tower needs for one company's SMEs, read with company-scoped queries (so it works under
 * the security rules) and turned into one row per SME by the readiness rules.
 */
export const loadControlTower = async (user: FullIdentity, activeProgramId?: string | null): Promise<ControlTowerSme[]> => {
  if (!hasRolePermission(user.role, 'view_participants', user.permissions)) throw new Error('forbidden')
  const companyCode = text(user.companyCode)
  if (!companyCode) return []

  const [participantSnap, documentSnap, assignmentSnap, programSnap] = await Promise.all([
    getDocs(query(collection(db, 'participants'), where('companyCode', '==', companyCode))),
    getDocs(query(collection(db, 'complianceDocuments'), where('companyCode', '==', companyCode))),
    getDocs(query(collection(db, 'assignedInterventions'), where('companyCode', '==', companyCode))),
    getDocs(query(collection(db, 'programs'), where('companyCode', '==', companyCode))),
  ])

  const participants: Row[] = participantSnap.docs
    .map(row => ({ id: row.id, ...row.data() }) as Row)
    .filter(row => !INACTIVE.includes(text(row.status).toLowerCase()) && matchesActiveProgram(user, activeProgramId, row.programId))

  const applicationIds = [...new Set(participants.map(row => text(row.applicationId)).filter(Boolean))]
  const planSnaps = await Promise.all(chunks(applicationIds, 10).map(ids => getDocs(query(collection(db, 'diagnosticPlans'), where(documentId(), 'in', ids)))))
  const plans = new Map<string, Row>(planSnaps.flatMap(snap => snap.docs.map(row => [row.id, { id: row.id, ...row.data() }] as [string, Row])))

  const planRefs = [...plans.values()].flatMap(plan => (Array.isArray(plan.interventions) ? plan.interventions : []).map((item: DocumentData) => ({ interventionId: text(item.interventionId, item.id), companyCode: text(plan.companyCode, companyCode) })))
  const definitions = await loadDefinitions(db, planRefs)

  const documentsByParticipant = new Map<string, Row[]>()
  documentSnap.docs.forEach(row => {
    const id = text(row.data().participantId)
    if (id) documentsByParticipant.set(id, [...(documentsByParticipant.get(id) || []), { id: row.id, ...row.data() }])
  })
  const assignmentsByParticipant = new Map<string, Row[]>()
  assignmentSnap.docs.forEach(row => {
    const id = text(row.data().participantId)
    if (id) assignmentsByParticipant.set(id, [...(assignmentsByParticipant.get(id) || []), { id: row.id, ...row.data() }])
  })
  const programNames = new Map(programSnap.docs.map(row => [row.id, text(row.data().name, row.data().programName, row.data().title, row.id)]))

  // The SME's picture lives on their user account. Accounts can only be read one at a time and not every one is
  // readable, so a denied read just leaves initials.
  const profileIds = participants.map(row => text(row.applicantProfileId, row.uid))
  const userReads = await Promise.allSettled(profileIds.map(id => (id ? getDoc(doc(db, 'users', id)) : Promise.reject(new Error('no id')))))

  return participants.map((participant, index): ControlTowerSme => {
    const plan = plans.get(text(participant.applicationId))
    const planItems = (Array.isArray(plan?.interventions) ? plan.interventions : []).map((item: DocumentData) => {
      const definition = definitions.get(text(item.interventionId, item.id), text(plan?.companyCode, companyCode)) || {}
      return { ...item, areaOfSupport: item.areaOfSupport || definition.areaOfSupport, executionMode: item.executionMode || definition.executionMode, steps: Array.isArray(item.steps) ? item.steps : definition.steps }
    })
    const live = buildLivePlanItems(planItems as unknown as Array<{ title: string }>, assignmentsByParticipant.get(participant.id) || []) as unknown as LivePlanItem[]
    const documents = documentsByParticipant.get(participant.id) || []
    const revenue = monthlyRevenue(participant)
    const valid = documents.filter(row => text(row.currentStatus).toLowerCase() === 'valid').length
    const read = userReads[index]
    const userImage = read.status === 'fulfilled' && read.value.exists() ? text(read.value.data().profileImageUrl) : ''

    return {
      id: participant.id,
      applicationId: text(participant.applicationId),
      businessName: text(participant.businessName, participant.companyName) || 'Unnamed SME',
      ownerName: text(participant.participantName, participant.contactName, participant.ownerName),
      email: text(participant.email) || undefined,
      phone: text(participant.phone) || undefined,
      sector: text(participant.sector) || undefined,
      stage: text(participant.stage) || undefined,
      province: text(participant.province) || undefined,
      city: text(participant.city) || undefined,
      programId: text(participant.programId) || undefined,
      programName: programNames.get(text(participant.programId)) || undefined,
      imageUrl: text(participant.profileImageUrl, userImage) || undefined,
      yearsOfTrading: typeof participant.yearsOfTrading === 'number' ? participant.yearsOfTrading : undefined,
      revenueLatest: revenue.length ? revenue[revenue.length - 1].value : null,
      revenueChange: revenue.length > 1 && revenue[0].value ? Math.round(((revenue[revenue.length - 1].value - revenue[0].value) / Math.abs(revenue[0].value)) * 100) : null,
      complianceScore: documents.length ? Math.round((valid / documents.length) * 100) : null,
      complianceValid: valid,
      complianceTotal: documents.length,
      planProgress: livePlanProgress(live),
      planCompleted: live.filter(item => item.status === 'Completed').length,
      planTotal: live.length,
      readiness: assessReadiness({
        documents: documents.map(row => ({ key: row.key, type: row.type, currentStatus: row.currentStatus, expiryDate: row.expiryDate })),
        planItems: live,
        revenueMonthly: revenue,
        yearsOfTrading: typeof participant.yearsOfTrading === 'number' ? participant.yearsOfTrading : null,
        digitalPresence: participant.digitalPresence,
      }),
    }
  })
}
