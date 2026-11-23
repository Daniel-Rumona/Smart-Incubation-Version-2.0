import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { onAuthStateChanged, reload, signOut } from 'firebase/auth'
import { ACCOUNT_DEACTIVATED_MESSAGE, isDeactivatedProfile, rememberDeactivatedSignOut } from '@/utils/accountDeactivated'
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb, isFirebaseConfigured } from '@/config/firebase'
import { resolveIdentityPermissions } from '@/config/permissions'
import { isUserRole } from '@/config/roles'
import { isApplicantWorkspaceUser } from '@/services/applicationsService'
import { isExternalWork, useSupportScope } from '@/hooks/useSupportScope'
import { useDirectorWorkspace } from '@/hooks/useDirectorWorkspace'
import { resolveAuthenticatedProfileData } from '@/services/authService'
import type { FullIdentity, UiMode } from '@/types/identity'
import { decodeSignatureStrokes } from '@/utils/signatureStrokes'
import { pendingProgramIdFrom, resolveSmeJourney } from '@/utils/smeJourney'

type IdentityContextValue = {
  user: FullIdentity | null
  loading: boolean
  error?: string
  /** Patches the in-memory identity after the user edits their own profile, so the UI updates without a reload. */
  updateIdentity: (patch: Partial<FullIdentity>) => void
}

const IdentityContext = createContext<IdentityContextValue | undefined>(undefined)

/** Only directors carry a second role (operations, for those who run the programme alone). */
const secondRoleFrom = (role: string, data: Record<string, unknown> | null | undefined) =>
  (role === 'director' && data?.secondRole === 'operations' ? 'operations' as const : null)

const uiModeFrom = (data: Record<string, unknown> | null | undefined): UiMode | undefined =>
  (data?.uiMode === 'simple' || data?.uiMode === 'full' ? data.uiMode : undefined)

const stringList = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id.trim() !== '') : [])

/** A funder organisation member's organisation and what its active links cover (blank for company-scoped funders). */
const funderOrgFields = (data: Record<string, unknown> | null | undefined): Partial<FullIdentity> => ({
  funderOrgId: typeof data?.funderOrgId === 'string' && data.funderOrgId ? data.funderOrgId : null,
  funderOrgName: typeof data?.funderOrgName === 'string' && data.funderOrgName ? data.funderOrgName : null,
  funderProgramIds: stringList(data?.funderProgramIds),
  funderCompanyCodes: stringList(data?.funderCompanyCodes),
})

/**
 * Chose the independent route at onboarding: consultants and agents ('marketplace') or skipped. Read from what the
 * join server recorded, not resolveSmeJourney, which calls anyone without a recorded route independent.
 */
const cameInAsIndependent = (profile: Record<string, unknown> | undefined) => {
  const path = String(((profile?.smeOnboarding || {}) as Record<string, unknown>).path || '')
  return path === 'marketplace' || path === 'skip'
}

/** Help the SME arranged outside the programme that is still going: no programme, not finished, not declined. */
const isOngoingExternalWork = (raw: Record<string, unknown>) => {
  if (!isExternalWork(raw)) return false
  const lower = (value: unknown) => String(value || '').toLowerCase()
  const finished = ['completed', 'cancelled', 'rejected', 'declined'].includes(lower(raw.status))
    || lower(raw.completionStatus) === 'completed'
    || Number(raw.progress) >= 100
    || (lower(raw.assigneeCompletionStatus) === 'done' && lower(raw.participantCompletionStatus) === 'confirmed')
  const declined = lower(raw.participantStatus) === 'declined' || lower(raw.assigneeStatus) === 'declined'
  return !finished && !declined
}

export const IdentityProvider = ({ children }: PropsWithChildren) => {
  const [user, setUser] = useState<FullIdentity | null>(null)
  const [loading, setLoading] = useState(isFirebaseConfigured)
  const [error, setError] = useState<string>()
  const identityRequest = useRef(0)

  useEffect(() => {
    if (!isFirebaseConfigured) return

    return onAuthStateChanged(getFirebaseAuth(), async (authUser) => {
      const request = ++identityRequest.current
      setLoading(true)
      if (!authUser) {
        setUser(null)
        setLoading(false)
        return
      }

      try {
        await reload(authUser).catch(() => undefined)
        const { data: profile } = await resolveAuthenticatedProfileData(authUser.uid, authUser.email ?? '')
        // A deactivated account is signed straight back out (an older session, or a sign-in method that
        // got past the disabled sign-in account).
        if (isDeactivatedProfile(profile)) {
          if (request !== identityRequest.current) return
          rememberDeactivatedSignOut()
          setUser(null)
          setError(ACCOUNT_DEACTIVATED_MESSAGE)
          await signOut(getFirebaseAuth()).catch(() => undefined)
          return
        }
        const role = isUserRole(profile?.role) ? profile.role : 'incubatee'
        const email = authUser.email ?? ''
        const isApplicant = role === 'incubatee'
          ? await isApplicantWorkspaceUser({ uid: authUser.uid, email }, profile?.isApplicant)
          : false

        const displayName = typeof profile?.displayName === 'string'
          ? profile.displayName
          : typeof profile?.name === 'string'
            ? profile.name
            : authUser.displayName ?? ''
        const signatureURL = typeof profile?.signatureURL === 'string'
          ? profile.signatureURL
          : typeof profile?.signatureUrl === 'string'
            ? profile.signatureUrl
            : typeof profile?.signature === 'object' && profile.signature && typeof profile.signature.url === 'string'
              ? profile.signature.url
              : null

        // Auth transitions can overlap (especially when switching accounts). Do not
        // let an older profile request replace the identity for the current session.
        if (request !== identityRequest.current || getFirebaseAuth().currentUser?.uid !== authUser.uid) return

        setUser({
          uid: authUser.uid,
          email,
          emailVerified: authUser.emailVerified || profile?.emailVerified === true,
          displayName,
          name: displayName,
          role,
          isApplicant,
          firstLoginComplete: profile?.firstLoginComplete === true,
          organisationAccessStatus: profile?.organisationAccessStatus,
          mustChangePassword: profile?.mustChangePassword === true,
          companyCode: typeof profile?.companyCode === 'string' ? profile.companyCode : null,
          branchId: typeof profile?.branchId === 'string' ? profile.branchId : null,
          departmentId: typeof profile?.departmentId === 'string' ? profile.departmentId : null,
          signatureURL,
          signatureStrokes: signatureURL ? decodeSignatureStrokes(profile?.signatureStrokes) : null,
          profileImageUrl: typeof profile?.profileImageUrl === 'string' && profile.profileImageUrl.trim() ? profile.profileImageUrl : null,
          assignedProgramIds: Array.isArray(profile?.assignedProgramIds)
            ? profile.assignedProgramIds.filter((id): id is string => typeof id === 'string')
            : [],
          permissions: resolveIdentityPermissions(role, profile?.permissions),
          consultingBudget: typeof profile?.consultingBudget === 'number' ? profile.consultingBudget : undefined,
          smeOnboardingComplete: profile?.smeOnboardingComplete !== false,
          smeJourney: role === 'incubatee' ? resolveSmeJourney(profile, isApplicant) : undefined,
          showProgrammes: profile?.smeShowProgrammes === true,
          uiMode: uiModeFrom(profile),
          secondRole: secondRoleFrom(role, profile),
          pendingProgramId: role === 'incubatee' ? pendingProgramIdFrom(profile) : null,
          ...(role === 'clientorg' ? {
            organisationId: typeof profile?.organisationId === 'string' ? profile.organisationId : null,
            organisationName: typeof profile?.organisationName === 'string' ? profile.organisationName : null,
            orgRole: profile?.orgRole === 'director' ? 'director' as const : 'coordinator' as const,
          } : {}),
          ...(role === 'funder' ? funderOrgFields(profile) : {}),
        })
        setError(undefined)
      } catch {
        if (request !== identityRequest.current) return
        setUser(null)
        setError('Your account details could not be loaded.')
      } finally {
        if (request === identityRequest.current) setLoading(false)
      }
    })
  }, [])

  // Feature access is edited by staff managers while this person is signed in, so follow their
  // profile document instead of keeping the permissions read at sign-in until the next login.
  const uid = user?.uid
  useEffect(() => {
    if (!isFirebaseConfigured || !uid) return
    return onSnapshot(doc(getFirebaseDb(), 'users', uid), (snapshot) => {
      const data = snapshot.data()
      if (!data) return
      // Deactivated while signed in: end the session now rather than when the sign-in token next refreshes.
      if (isDeactivatedProfile(data)) {
        rememberDeactivatedSignOut()
        setError(ACCOUNT_DEACTIVATED_MESSAGE)
        void signOut(getFirebaseAuth()).catch(() => undefined)
        return
      }
      setUser((current) => {
        if (!current || current.uid !== uid) return current
        // Welcome can change a self-registered user's provisional SME role to consultant.
        // Keep the in-memory identity in sync immediately rather than waiting for a reload.
        const role = isUserRole(data.role) ? data.role : current.role
        const roleFields: Partial<FullIdentity> = role === current.role
          ? {}
          : { role, isApplicant: role === 'incubatee' ? current.isApplicant : false }
        const effectiveRole = roleFields.role ?? current.role
        const permissions = resolveIdentityPermissions(effectiveRole, data.permissions)
        const permissionsUnchanged = permissions.length === current.permissions.length && permissions.every((permission) => current.permissions.includes(permission))

        // Joining a programme (server-side) changes the SME's journey, company and programmes mid-session.
        const smeFields: Partial<FullIdentity> = effectiveRole === 'incubatee'
          ? {
            smeJourney: resolveSmeJourney(data, current.isApplicant),
            showProgrammes: data.smeShowProgrammes === true,
            uiMode: uiModeFrom(data),
            pendingProgramId: pendingProgramIdFrom(data),
            companyCode: typeof data.companyCode === 'string' ? data.companyCode : current.companyCode,
            assignedProgramIds: Array.isArray(data.assignedProgramIds) ? data.assignedProgramIds.filter((id: unknown): id is string => typeof id === 'string') : current.assignedProgramIds,
            smeOnboardingComplete: data.smeOnboardingComplete !== false,
          }
          : {}
        const verificationFields: Partial<FullIdentity> = {
          emailVerified: current.emailVerified || data.emailVerified === true,
          organisationAccessStatus: data.organisationAccessStatus,
          // Set by the team-size setting (server-side) mid-session; follow it so the switch appears straight away.
          secondRole: secondRoleFrom(effectiveRole, data),
        }
        // A funder's links are accepted, removed and confirmed mid-session; follow them so the pages reload.
        const funderFields: Partial<FullIdentity> = effectiveRole === 'funder' ? funderOrgFields(data) : {}
        const roleUnchanged = Object.entries(roleFields).every(([key, value]) => value === current[key as keyof FullIdentity])
        const smeUnchanged = Object.entries(smeFields).every(([key, value]) => JSON.stringify(value) === JSON.stringify(current[key as keyof FullIdentity]))
        const verificationUnchanged = Object.entries(verificationFields).every(([key, value]) => value === current[key as keyof FullIdentity])
        const funderUnchanged = Object.entries(funderFields).every(([key, value]) => JSON.stringify(value) === JSON.stringify(current[key as keyof FullIdentity]))

        return permissionsUnchanged && roleUnchanged && smeUnchanged && verificationUnchanged && funderUnchanged
          ? current
          : { ...current, ...roleFields, permissions, ...smeFields, ...verificationFields, ...funderFields }
      })
    }, () => undefined)
  }, [uid])

  const updateIdentity = useCallback((patch: Partial<FullIdentity>) => setUser((current) => (current ? { ...current, ...patch } : current)), [])

  // An accepted SME with help outside their programme can switch to it (External support in the top bar).
  const isAcceptedSme = user?.role === 'incubatee' && !user.isApplicant
  const [hasExternalSupport, setHasExternalSupport] = useState(false)
  useEffect(() => {
    if (!isFirebaseConfigured || !uid || !isAcceptedSme) {
      setHasExternalSupport(false)
      return
    }
    let cancelled = false
    void (async () => {
      const db = getFirebaseDb()
      const profile = (await getDoc(doc(db, 'users', uid)).catch(() => null))?.data()
      // Both must hold: they came in as an independent (chose consultants and agents, or skipped, at onboarding,
      // before applying to a programme), and someone outside the programme is still helping them.
      if (!cameInAsIndependent(profile)) {
        if (!cancelled) setHasExternalSupport(false)
        return
      }
      const ownWork = await getDocs(query(collection(db, 'assignedInterventions'), where('participantId', '==', uid))).catch(() => null)
      if (!cancelled) setHasExternalSupport(Boolean(ownWork?.docs.some((row) => isOngoingExternalWork(row.data()))))
    })()
    return () => { cancelled = true }
  }, [isAcceptedSme, uid])

  const supportScope = useSupportScope()
  const directorWorkspace = useDirectorWorkspace()
  const effectiveUser = useMemo<FullIdentity | null>(() => {
    // A director who runs the programme alone acts as operations while on that side: the operations pages, menus and
    // permissions apply (the rules accept the second role too). baseRole keeps who they really are.
    if (user?.role === 'director' && user.secondRole === 'operations') {
      return directorWorkspace === 'operations'
        ? { ...user, role: 'operations', baseRole: 'director', actingAs: 'operations', permissions: resolveIdentityPermissions('operations', undefined) }
        : { ...user, baseRole: 'director', actingAs: 'overview' }
    }
    if (!user || !isAcceptedSme) return user
    const scope = hasExternalSupport ? supportScope : 'programme'
    return {
      ...user,
      acceptedSme: true,
      hasExternalSupport,
      supportScope: scope,
      ...(scope === 'external' ? { isApplicant: true, smeJourney: 'independent' as const } : {}),
    }
  }, [directorWorkspace, hasExternalSupport, isAcceptedSme, supportScope, user])

  const value = useMemo(() => ({ user: effectiveUser, loading, error, updateIdentity }), [effectiveUser, error, loading, updateIdentity])

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useIdentity = () => {
  const context = useContext(IdentityContext)

  if (!context) throw new Error('useIdentity must be used inside IdentityProvider')

  return context
}
