import { collection, getDocs, query, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'
import { isPlatformAdmin, listTeamRegisteredCompanyCodes } from '@/services/companiesService'

export type WorkspaceProgram = {
  id: string
  name: string
  agentSupportMode?: AgentSupportMode
  openToExternalSmes?: boolean
}

export type AgentSupportMode = 'simultaneous' | 'post_diagnostic' | 'fully_agentic'

export const normalizeAgentSupportMode = (data?: Record<string, unknown> | null): AgentSupportMode => {
  const raw = String(data?.agentSupportMode || '').trim().toLowerCase()
  if (raw === 'fully_agentic') return 'fully_agentic'
  if (raw === 'post_diagnostic') return 'post_diagnostic'
  return 'simultaneous'
}

export const getAssignedProgramIds = (user?: FullIdentity | null) =>
  new Set((user?.assignedProgramIds || []).map((id) => String(id).trim()).filter(Boolean))

export const canAccessProgram = (user: FullIdentity | null | undefined, programId?: string | null) => {
  const assignedIds = getAssignedProgramIds(user)
  if (!assignedIds.size) return true

  const normalizedProgramId = String(programId || '').trim()
  return Boolean(normalizedProgramId && assignedIds.has(normalizedProgramId))
}

export const matchesActiveProgram = (
  user: FullIdentity | null | undefined,
  activeProgramId?: string | null,
  programId?: string | null,
) => {
  const normalizedActiveProgramId = String(activeProgramId || '').trim()
  const normalizedProgramId = String(programId || '').trim()

  if (normalizedActiveProgramId && normalizedActiveProgramId !== 'all') {
    return normalizedProgramId === normalizedActiveProgramId
  }

  return canAccessProgram(user, normalizedProgramId)
}

export const listWorkspacePrograms = async (user?: FullIdentity | null) => {
  const snapshot = await getDocs(collection(getFirebaseDb(), 'programs'))
  const assignedIds = getAssignedProgramIds(user)
  const companyCode = String(user?.companyCode || '').trim()
  const shouldScopeToCompany = !isPlatformAdmin(user)

  return snapshot.docs.flatMap((row) => {
    const data = row.data()
    if (shouldScopeToCompany && (!companyCode || String(data.companyCode || '').trim() !== companyCode)) return []
    if (assignedIds.size && !assignedIds.has(row.id)) return []

    return [{
      id: row.id,
      name: data.name || row.id,
      agentSupportMode: normalizeAgentSupportMode(data),
    }]
  }).sort((left, right) => left.name.localeCompare(right.name))
}

/** Programs at a specific company, usable before the caller has that companyCode on their own profile (e.g. during onboarding). */
export const listProgramsForCompany = async (companyCode: string) => {
  const code = companyCode.trim()
  if (!code) return []

  const snapshot = await getDocs(query(collection(getFirebaseDb(), 'programs'), where('companyCode', '==', code)))
  return snapshot.docs.map((row) => {
    const data = row.data()
    return {
      id: row.id,
      name: data.name || row.id,
      agentSupportMode: normalizeAgentSupportMode(data),
      openToExternalSmes: data.openToExternalSmes === true,
    }
  }).sort((left, right) => left.name.localeCompare(right.name))
}

export type OpenWorkspaceProgram = WorkspaceProgram & { companyCode: string; companyName?: string }

/** Programs any company has flagged as open to SMEs outside their own company ("outsourced" consulting programs). */
export const listOpenPrograms = async (): Promise<OpenWorkspaceProgram[]> => {
  const [snapshot, teamRegistered] = await Promise.all([
    getDocs(query(collection(getFirebaseDb(), 'programs'), where('openToExternalSmes', '==', true))),
    listTeamRegisteredCompanyCodes().catch(() => new Set<string>()),
  ])

  return snapshot.docs.filter((row) => !teamRegistered.has(String(row.data().companyCode || '').trim())).map((row) => {
    const data = row.data()
    return {
      id: row.id,
      name: data.name || row.id,
      agentSupportMode: normalizeAgentSupportMode(data),
      openToExternalSmes: true,
      companyCode: String(data.companyCode || '').trim(),
      companyName: typeof data.companyName === 'string' ? data.companyName : undefined,
    }
  }).sort((left, right) => left.name.localeCompare(right.name))
}
