import { collection, getDoc, getDocs, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'

export type WorkspaceCompany = {
  id: string
  code: string
  name: string
  isPlatformOwner?: boolean
}

export const PLATFORM_OWNER_CODE = 'QTX'
const PLATFORM_OWNER_NAME = 'Quantilytix'

const ADMIN_ROLES = new Set(['systemadmin', 'admin'])

export const isPlatformAdmin = (user?: FullIdentity | null) => Boolean(user && ADMIN_ROLES.has(user.role))

type CompanyScoped = Pick<FullIdentity, 'companyCode'> & { role?: FullIdentity['role'] }

const rawCompanyCode = (user?: CompanyScoped | null) => String(user?.companyCode || '').trim()

/**
 * An SME's company for scoping. SMEs who register independently rather than through a
 * company's program link have no code of their own, so they fall back to the platform
 * owner (QTX), which is the workspace that monitors and funds them.
 */
export const resolveSmeCompanyCode = (user?: CompanyScoped | null) => rawCompanyCode(user) || PLATFORM_OWNER_CODE

/** An SME in the platform owner's fallback bucket: independent, not in a company's program pipeline. */
export const isPlatformOwnerSme = (user?: CompanyScoped | null) =>
  user?.role === 'incubatee' && resolveSmeCompanyCode(user) === PLATFORM_OWNER_CODE

/**
 * Staff who run the platform owner's workspace. Deliberately strict - no QTX fallback here,
 * because a staff account with a blank company must not inherit QTX's queues.
 */
export const isPlatformOwnerStaff = (user?: CompanyScoped | null) =>
  Boolean(user) && (rawCompanyCode(user) === PLATFORM_OWNER_CODE || isPlatformAdmin(user as FullIdentity))

/**
 * Consultants with the marketplace listing: independent consultants (no company) and the platform
 * owner's own. A consultant employed by a client company works inside that company and has no
 * public marketplace presence, so they get the universal profile instead.
 */
export const hasConsultantMarketplaceProfile = (user?: CompanyScoped | null) =>
  user?.role === 'consultant' && (!rawCompanyCode(user) || rawCompanyCode(user) === PLATFORM_OWNER_CODE)

/** Where "My profile" leads for each kind of user. */
export const profilePathForUser = (user?: CompanyScoped | null) => {
  if (user?.role === 'incubatee') return '/applicant/profile'
  if (hasConsultantMarketplaceProfile(user)) return '/consultant/profile'
  return '/profile'
}

/** Gate for pages that only exist inside the platform owner's workspace (the SME marketplace and its review queue). */
export const canAccessPlatformOwnerRoute = (user?: CompanyScoped | null) =>
  isPlatformOwnerSme(user) || isPlatformOwnerStaff(user)

const upsertCompany = (
  companies: Map<string, WorkspaceCompany>,
  id: string,
  data: Record<string, unknown>,
) => {
  const code = String(data.companyCode || id || '').trim()
  if (!code) return

  const name = String(data.companyName || data.name || data.displayName || code).trim()
  companies.set(code, {
    id: code,
    code,
    name: name || code,
    isPlatformOwner: data.isPlatformOwner === true,
  })
}

const fetchAllCompanies = async () => {
  const db = getFirebaseDb()
  const companiesSnapshot = await getDocs(collection(db, 'companies'))
  const companies = new Map<string, WorkspaceCompany>()

  companiesSnapshot.docs.forEach((row) => upsertCompany(companies, row.id, row.data()))

  return [...companies.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export const listWorkspaceCompanies = async (user?: FullIdentity | null) => {
  if (!isPlatformAdmin(user)) throw new Error('forbidden')

  return fetchAllCompanies()
}

/** Any authenticated user can read the company directory to pick their company during onboarding. */
export const listCompaniesForOnboarding = async () => {
  const companies = await fetchAllCompanies()
  return companies.filter((company) => !company.isPlatformOwner)
}

export const ensureWorkspaceCompany = async (companyCode: string, name?: string, updatedBy?: string) => {
  const code = companyCode.trim()
  if (!code) return
  const ref = doc(getFirebaseDb(), 'companies', code)
  // Never overwrite a display name that has already been set (e.g. "Quantilytix") with the bare code.
  const existing = await getDoc(ref).catch(() => null)
  const hasName = Boolean(existing?.exists() && (existing.data()?.name || existing.data()?.companyName))
  await setDoc(ref, {
    companyCode: code,
    ...(hasName ? {} : { name: name?.trim() || code }),
    status: 'active',
    updatedAt: serverTimestamp(),
    ...(updatedBy ? { updatedBy } : {}),
  }, { merge: true })
}

/**
 * Resolves the company record that represents the platform operator, so "general" SMEs
 * with no company affiliation still land under a visible company for ops tooling.
 * Self-bootstraps the record on first use (idempotent).
 */
export const getOrCreatePlatformOwnerCompany = async (): Promise<WorkspaceCompany> => {
  const companies = await fetchAllCompanies()
  const existing = companies.find((company) => company.isPlatformOwner)
  if (existing) return existing

  await setDoc(doc(getFirebaseDb(), 'companies', PLATFORM_OWNER_CODE), {
    companyCode: PLATFORM_OWNER_CODE,
    name: PLATFORM_OWNER_NAME,
    status: 'active',
    isPlatformOwner: true,
    updatedAt: serverTimestamp(),
  }, { merge: true })

  return { id: PLATFORM_OWNER_CODE, code: PLATFORM_OWNER_CODE, name: PLATFORM_OWNER_NAME, isPlatformOwner: true }
}
