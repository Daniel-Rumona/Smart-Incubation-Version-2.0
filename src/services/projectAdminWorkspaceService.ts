import { collection, getDocs, query, where } from 'firebase/firestore'
import dayjs, { type Dayjs } from 'dayjs'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import { db } from '@/firebase/config'
import type { FullIdentity } from '@/types/identity'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'

dayjs.extend(isSameOrAfter)
dayjs.extend(isSameOrBefore)

export type ProjectAdminApplication = {
  id: string
  businessName: string
  programId: string
  programName: string
  status: string
  createdAt: Date | null
  submittedAt: Date | null
  acceptedAt: Date | null
  gender: string
  ageGroup: string
  stage: string
  hub: string
  province: string
  city: string
  sector: string
  beeLevel: string
  disabilityStatus: string
  educationLevel: string
  employmentStatus: string
  maritalStatus: string
  locationType: string
  age: number | null
  yearsOfTrading: number | null
  youthOwnedPercent: number | null
  femaleOwnedPercent: number | null
  blackOwnedPercent: number | null
}

export type ProjectAdminParticipant = {
  id: string
  businessName: string
  programId: string
  programName: string
  status: string
  createdAt: Date | null
  onboardedAt: Date | null
  acceptedAt: Date | null
  approvedAt: Date | null
  revenue?: unknown
  annualRevenue?: unknown
  monthlyRevenue?: unknown
  turnover?: unknown
  annualTurnover?: unknown
  employeeCount?: unknown
  employees?: unknown
  numberOfEmployees?: unknown
  staffCount?: unknown
  jobsCreated?: unknown
  revenueHistory?: { monthly?: Record<string, unknown>; annual?: Record<string, unknown> }
  headcountHistory?: { monthly?: Record<string, unknown>; annual?: Record<string, unknown> }
}

export type ProjectAdminIntervention = {
  id: string
  participantName: string
  title: string
  owner: string
  programId: string
  programName: string
  status: string
  progress: number
  dueDate: Date | null
  assignedAt: Date | null
  completedAt: Date | null
}

export type ProjectAdminComplianceDocument = {
  id: string
  participantId: string
  programId: string
  status: string
  expiryDate: Date | null
  updatedAt: Date | null
}

export type ProjectAdminStaffMember = {
  id: string
  name: string
  role: string
  status: string
}

export type ProjectAdminWorkspaceData = {
  applications: ProjectAdminApplication[]
  participants: ProjectAdminParticipant[]
  interventions: ProjectAdminIntervention[]
  complianceDocuments: ProjectAdminComplianceDocument[]
  staff: ProjectAdminStaffMember[]
}

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()

const toDate = (value: unknown): Date | null => {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(+value) ? null : value
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate()
  }
  if (typeof value === 'object' && value && 'seconds' in value && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000)
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(+parsed) ? null : parsed
  }
  return null
}

const numberValue = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0
}

const optionalNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

const firstUsefulText = (...values: unknown[]) => {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text && normalize(text) !== 'unnamed sme') return text
  }
  return ''
}

const readBusinessName = (data: Record<string, unknown>) =>
  firstUsefulText(data.businessName, data.beneficiaryName, data.companyName, data.enterpriseName, data.participantName)
  || 'Unnamed SME'

const isInRange = (date: Date | null, range?: [Dayjs, Dayjs] | null) => {
  if (!range || !date) return true
  return dayjs(date).isSameOrAfter(range[0], 'day') && dayjs(date).isSameOrBefore(range[1], 'day')
}

export const isOpenApplicationStatus = (status: string) =>
  !['accepted', 'approved', 'rejected', 'declined', 'withdrawn', 'cancelled'].includes(normalize(status))

export const isCompletedInterventionStatus = (status: string) =>
  ['completed', 'complete', 'done', 'closed', 'confirmed'].includes(normalize(status))

export const isOverdueIntervention = (intervention: ProjectAdminIntervention, referenceDate = dayjs()) =>
  Boolean(intervention.dueDate)
  && !isCompletedInterventionStatus(intervention.status)
  && dayjs(intervention.dueDate).isBefore(referenceDate, 'day')

export const isComplianceAttentionStatus = (status: string) =>
  ['missing', 'pending', 'rejected', 'invalid', 'expired', 'queried'].includes(normalize(status))

export const loadProjectAdminWorkspace = async (
  user: FullIdentity,
  activeProgramId?: string | null,
): Promise<ProjectAdminWorkspaceData> => {
  const companyCode = String(user.companyCode || '').trim()
  const companyConstraints = companyCode ? [where('companyCode', '==', companyCode)] : []

  const [
    applicationsSnap,
    participantsSnap,
    interventionsSnap,
    complianceSnap,
    staffSnap,
    programsSnap,
  ] = await Promise.all([
    getDocs(query(collection(db, 'applications'), ...companyConstraints)),
    getDocs(query(collection(db, 'participants'), ...companyConstraints)),
    getDocs(collection(db, 'assignedInterventions')),
    getDocs(query(collection(db, 'complianceDocuments'), ...companyConstraints)),
    getDocs(query(collection(db, 'users'), ...companyConstraints)),
    getDocs(query(collection(db, 'programs'), ...companyConstraints)),
  ])

  // Applications/participants/interventions often only carry programId, not programName -
  // resolve the display name from the programs collection instead of falling through to
  // "Unassigned program" (which previously split one cohort's participants and their own
  // interventions into two different-looking programmes).
  const programNameById = new Map<string, string>()
  programsSnap.docs.forEach((row) => {
    const data = row.data()
    const name = String(data.name || data.title || '').trim()
    if (name) programNameById.set(row.id, name)
  })
  const resolveProgramName = (programId: string, rawName: unknown, rawTitle: unknown) => {
    const explicit = String(rawName || rawTitle || '').trim()
    if (explicit) return explicit
    return programNameById.get(programId) || 'Unassigned program'
  }

  const applications = applicationsSnap.docs.flatMap((row) => {
    const data = row.data()
    const formValues = data.formValues && typeof data.formValues === 'object'
      ? data.formValues as Record<string, unknown>
      : {}
    const profile = data.profile && typeof data.profile === 'object'
      ? data.profile as Record<string, unknown>
      : {}
    const ownership = data.ownership && typeof data.ownership === 'object'
      ? data.ownership as Record<string, unknown>
      : {}
    const programId = String(data.programId || '').trim()
    if (!matchesActiveProgram(user, activeProgramId, programId)) return []

    return [{
      id: row.id,
      businessName: readBusinessName(data),
      programId,
      programName: resolveProgramName(programId, data.programName, data.programTitle),
      status: String(data.applicationStatus || data.status || data.stage || 'pending'),
      createdAt: toDate(data.createdAt),
      submittedAt: toDate(data.submittedAt),
      acceptedAt: toDate(data.acceptedAt || data.approvedAt),
      gender: firstUsefulText(data.gender, formValues.gender, profile.gender),
      ageGroup: firstUsefulText(data.ageGroup, formValues.ageGroup, profile.ageGroup),
      stage: firstUsefulText(data.stage, formValues.stage, profile.stage),
      hub: firstUsefulText(data.hub, formValues.hub, profile.hub),
      province: firstUsefulText(data.province, formValues.province, profile.province),
      city: firstUsefulText(data.city, formValues.city, profile.city),
      sector: firstUsefulText(data.sector, formValues.sector, profile.sector),
      beeLevel: firstUsefulText(data.beeLevel, data.bbeeLevel, formValues.beeLevel, profile.beeLevel),
      disabilityStatus: firstUsefulText(data.disabilityStatus, formValues.disabilityStatus, profile.disabilityStatus),
      educationLevel: firstUsefulText(data.educationLevel, formValues.educationLevel, profile.educationLevel),
      employmentStatus: firstUsefulText(data.employmentStatus, formValues.employmentStatus, profile.employmentStatus),
      maritalStatus: firstUsefulText(data.maritalStatus, formValues.maritalStatus, profile.maritalStatus),
      locationType: firstUsefulText(data.locationType, data.location, formValues.locationType, formValues.location, profile.locationType),
      age: optionalNumber(data.age, formValues.age, profile.age),
      yearsOfTrading: optionalNumber(data.yearsOfTrading, formValues.yearsOfTrading, profile.yearsOfTrading),
      youthOwnedPercent: optionalNumber(data.youthOwnedPercent, ownership.youthOwnedPercent, formValues.youthOwnedPercent, profile.youthOwnedPercent),
      femaleOwnedPercent: optionalNumber(data.femaleOwnedPercent, ownership.femaleOwnedPercent, formValues.femaleOwnedPercent, profile.femaleOwnedPercent),
      blackOwnedPercent: optionalNumber(data.blackOwnedPercent, ownership.blackOwnedPercent, formValues.blackOwnedPercent, profile.blackOwnedPercent),
    }]
  })

  const participants = participantsSnap.docs.flatMap((row) => {
    const data = row.data()
    const programId = String(data.programId || '').trim()
    if (!matchesActiveProgram(user, activeProgramId, programId)) return []

    return [{
      id: row.id,
      businessName: readBusinessName(data),
      programId,
      programName: resolveProgramName(programId, data.programName, data.programTitle),
      status: String(data.status || data.participantStatus || 'active'),
      createdAt: toDate(data.createdAt || data.acceptedAt),
      onboardedAt: toDate(data.onboardedAt || data.acceptedAt || data.approvedAt),
      acceptedAt: toDate(data.acceptedAt),
      approvedAt: toDate(data.approvedAt),
      revenue: data.revenue,
      annualRevenue: data.annualRevenue,
      monthlyRevenue: data.monthlyRevenue,
      turnover: data.turnover,
      annualTurnover: data.annualTurnover,
      employeeCount: data.employeeCount,
      employees: data.employees,
      numberOfEmployees: data.numberOfEmployees,
      staffCount: data.staffCount,
      jobsCreated: data.jobsCreated,
      revenueHistory: data.revenueHistory as ProjectAdminParticipant['revenueHistory'],
      headcountHistory: data.headcountHistory as ProjectAdminParticipant['headcountHistory'],
    }]
  })

  const participantIds = new Set(participants.map((participant) => participant.id))
  const applicationsById = new Map(applications.map((application) => [application.id, application]))
  const participantNamesById = new Map(participants.map((participant) => [participant.id, participant.businessName]))

  const interventions = interventionsSnap.docs.flatMap((row) => {
    const data = row.data()
    const snapshot = data.snapshot && typeof data.snapshot === 'object'
      ? data.snapshot as Record<string, unknown>
      : {}
    const programId = String(data.programId || '').trim()
    const participantId = String(data.participantId || data.smmeId || data.smeId || '').trim()
    const applicationId = String(data.applicationId || '').trim()
    const hasKnownParticipant = !participantId
      || participantIds.has(participantId)
      || applicationsById.has(participantId)
      || applicationsById.has(applicationId)
    const sameCompany = !companyCode || !data.companyCode || String(data.companyCode).trim() === companyCode
    if (!sameCompany || !hasKnownParticipant || !matchesActiveProgram(user, activeProgramId, programId)) return []

    return [{
      id: row.id,
      participantName: firstUsefulText(
        data.beneficiaryName,
        data.businessName,
        data.smmeName,
        data.smeName,
        data.companyName,
        snapshot.businessName,
        participantNamesById.get(participantId),
        applicationsById.get(applicationId)?.businessName,
        applicationsById.get(participantId)?.businessName,
        data.participantName,
      ) || 'Unassigned SME',
      title: String(data.interventionTitle || 'Untitled intervention'),
      owner: String(data.assigneeName || 'Unassigned'),
      programId,
      programName: resolveProgramName(programId, data.programName, undefined),
      status: String(data.status || data.completionStatus || data.coordinatorCompletionStatus || 'pending'),
      progress: numberValue(data.progress),
      dueDate: toDate(data.dueDate),
      assignedAt: toDate(data.assignedAt || data.createdAt),
      completedAt: toDate(data.completedAt || data.completionConfirmedAt),
    }]
  })

  const complianceDocuments = complianceSnap.docs.flatMap((row) => {
    const data = row.data()
    const programId = String(data.programId || '').trim()
    if (!matchesActiveProgram(user, activeProgramId, programId)) return []

    return [{
      id: row.id,
      participantId: String(data.participantId || ''),
      programId,
      status: String(data.verificationStatus || data.currentStatus || data.status || 'pending'),
      expiryDate: toDate(data.expiryDate),
      updatedAt: toDate(data.updatedAt || data.createdAt),
    }]
  })

  const staff = staffSnap.docs.flatMap((row) => {
    const data = row.data()
    const role = normalize(data.role)
    if (!['consultant', 'projectadmin', 'operations', 'projectmanager'].includes(role)) return []

    return [{
      id: row.id,
      name: String(data.name || data.displayName || data.email || 'Unnamed staff member'),
      role,
      status: String(data.status || (data.active === false ? 'inactive' : 'active')),
    }]
  })

  return { applications, participants, interventions, complianceDocuments, staff }
}

export const filterProjectAdminDataByRange = (
  data: ProjectAdminWorkspaceData,
  range?: [Dayjs, Dayjs] | null,
): ProjectAdminWorkspaceData => ({
  applications: data.applications.filter((item) => isInRange(item.submittedAt || item.createdAt, range)),
  participants: data.participants.filter((item) => isInRange(item.onboardedAt || item.createdAt, range)),
  interventions: data.interventions.filter((item) => isInRange(item.completedAt || item.assignedAt || item.dueDate, range)),
  complianceDocuments: data.complianceDocuments.filter((item) => isInRange(item.updatedAt || item.expiryDate, range)),
  staff: data.staff,
})
