import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { onAuthStateChanged, reload } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb, isFirebaseConfigured } from '@/config/firebase'
import { resolveIdentityPermissions } from '@/config/permissions'
import { isUserRole } from '@/config/roles'
import { isApplicantWorkspaceUser } from '@/services/applicationsService'
import { resolveAuthenticatedProfileData } from '@/services/authService'
import type { FullIdentity } from '@/types/identity'
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
          pendingProgramId: role === 'incubatee' ? pendingProgramIdFrom(profile) : null,
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
            pendingProgramId: pendingProgramIdFrom(data),
            companyCode: typeof data.companyCode === 'string' ? data.companyCode : current.companyCode,
            assignedProgramIds: Array.isArray(data.assignedProgramIds) ? data.assignedProgramIds.filter((id: unknown): id is string => typeof id === 'string') : current.assignedProgramIds,
            smeOnboardingComplete: data.smeOnboardingComplete !== false,
          }
          : {}
        const verificationFields: Partial<FullIdentity> = {
          emailVerified: current.emailVerified || data.emailVerified === true,
        }
        const roleUnchanged = Object.entries(roleFields).every(([key, value]) => value === current[key as keyof FullIdentity])
        const smeUnchanged = Object.entries(smeFields).every(([key, value]) => JSON.stringify(value) === JSON.stringify(current[key as keyof FullIdentity]))
        const verificationUnchanged = verificationFields.emailVerified === current.emailVerified

        return permissionsUnchanged && roleUnchanged && smeUnchanged && verificationUnchanged
          ? current
          : { ...current, ...roleFields, permissions, ...smeFields, ...verificationFields }
      })
    }, () => undefined)
  }, [uid])

  const updateIdentity = useCallback((patch: Partial<FullIdentity>) => setUser((current) => (current ? { ...current, ...patch } : current)), [])

  const value = useMemo(() => ({ user, loading, error, updateIdentity }), [error, loading, updateIdentity, user])

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useIdentity = () => {
  const context = useContext(IdentityContext)

  if (!context) throw new Error('useIdentity must be used inside IdentityProvider')

  return context
}
