import { collection, getDocs, query, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'

export type AgentFormSme = {
  id: string
  name: string
  imageUrl?: string
  programId?: string
  programName?: string
  sector?: string
  /** Required interventions on the SME's confirmed plan that have not been declined. */
  requiredInterventions: Array<{ id: string, title: string }>
}

export type AgentFormOwner = { id: string, name: string, role: string }

type Row = Record<string, any>

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()
const slug = (value: unknown) => normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const declinedKey = (id: unknown) => String(id ?? '').trim().replace(/[./]/g, '_')
const DELIVERY_ROLES = ['consultant', 'projectadmin', 'projectmanager', 'operations']

// Mirrors the eligibility rule of the Assign interventions page: an accepted application whose
// diagnostic plan operations has confirmed, with at least one readable required intervention.
const requiredOf = (application: Row, plan: Row): Row[] => {
  const found = [
    plan.interventions,
    application.interventions?.required,
    application.growthPlan?.interventions,
    application.growthPlan?.requiredInterventions,
    application.diagnosticPlan?.interventions,
    application.requiredInterventions,
  ].find((value) => Array.isArray(value))
  if (!Array.isArray(found)) return []
  const seen = new Set<string>()
  return found.filter(Boolean).filter((item: Row) => {
    const key = slug(item.title) || normalize(item.interventionId)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const planConfirmed = (application: Row, plan: Row) => {
  const confirmedBy = plan.confirmedBy || application.interventions?.confirmedBy || application.growthPlan?.confirmedBy || {}
  return confirmedBy.operations === true || confirmedBy.ops === true || confirmedBy.projectAdmin === true
    || (confirmedBy.operations && typeof confirmedBy.operations === 'object')
    || plan.confirmed === true
    || normalize(plan.status) === 'confirmed'
}

export const loadAgentFormData = async (user: FullIdentity): Promise<{ smes: AgentFormSme[], owners: AgentFormOwner[] }> => {
  if (!user.companyCode) return { smes: [], owners: [] }
  const db = getFirebaseDb()
  const [applications, participants, plans, users] = await Promise.all([
    getDocs(query(collection(db, 'applications'), where('companyCode', '==', user.companyCode))),
    getDocs(collection(db, 'participants')),
    getDocs(query(collection(db, 'diagnosticPlans'), where('companyCode', '==', user.companyCode))),
    getDocs(query(collection(db, 'users'), where('companyCode', '==', user.companyCode))),
  ])
  const participantById = new Map(participants.docs.map((row) => [row.id, row.data() as Row]))
  const planById = new Map(plans.docs.map((row) => [row.id, row.data() as Row]))

  const smes = new Map<string, AgentFormSme>()
  applications.docs.forEach((row) => {
    const application = row.data() as Row
    const plan = planById.get(row.id) || {}
    const required = requiredOf(application, plan)
    const participantId = String(application.participantId || '')
    if (!participantId || normalize(application.applicationStatus) !== 'accepted' || !required.length || !planConfirmed(application, plan)) return
    const profile = participantById.get(participantId) || {}
    const declined = plan.declinedInterventions && typeof plan.declinedInterventions === 'object' ? plan.declinedInterventions : {}
    smes.set(participantId, {
      id: participantId,
      name: String(application.beneficiaryName || profile.beneficiaryName || profile.businessName || application.businessName || 'SME'),
      imageUrl: String(profile.profileImageUrl || '').trim() || undefined,
      programId: String(application.programId || '') || undefined,
      programName: String(application.programName || '') || undefined,
      sector: String(profile.sector || application.sector || '') || undefined,
      requiredInterventions: required
        .map((item) => ({ id: String(item.interventionId || slug(item.title)), title: String(item.title || 'Intervention') }))
        .filter((item) => !declined[declinedKey(item.id)]),
    })
  })

  const owners = users.docs
    .map((row) => ({ id: row.id, name: String(row.data().name || row.data().displayName || row.data().email || 'Team member'), role: normalize(row.data().role) }))
    .filter((row) => DELIVERY_ROLES.includes(row.role))
    .sort((left, right) => left.name.localeCompare(right.name))

  return { smes: [...smes.values()].sort((left, right) => left.name.localeCompare(right.name)), owners }
}
