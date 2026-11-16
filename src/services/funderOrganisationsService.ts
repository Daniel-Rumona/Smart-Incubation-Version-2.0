import { collection, doc, onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp, getFirebaseDb } from '@/config/firebase'

/**
 * Funder organisations and their links to programmes (functions/src/funderOrganisations.ts; plan in
 * docs/funder-organisations-plan.md). Clients only read funderOrganisations and funderLinks; every change goes through
 * a Cloud Function, which checks who may make it.
 */

export type FunderOrgStatus = 'invited' | 'confirmed' | 'merged'
export type FunderLinkStatus = 'pending' | 'active' | 'declined' | 'removed' | 'expired'
export type FunderOrgType = 'foundation' | 'government' | 'corporate' | 'dfi' | 'other'

type Stamp = { toDate?: () => Date } | null | undefined

export type FunderOrganisation = {
  id: string
  name: string
  type: FunderOrgType
  status: FunderOrgStatus
  mergedInto?: string
  contactName?: string
  contactEmail?: string
  createdByCompany?: string
  createdByCompanyName?: string
  createdAt?: Date | null
}

export type FunderLink = {
  id: string
  programId: string
  programName: string
  companyCode: string
  companyName: string
  funderOrgId: string
  funderOrgName: string
  /** The organisation's status, copied onto the link (implementors can't read the organisation itself). */
  funderOrgStatus: FunderOrgStatus
  funderOrgContactEmail?: string
  funderOrgContactName?: string
  status: FunderLinkStatus
  requestedAt?: Date | null
  respondedAt?: Date | null
  /** Funding committed to the programme, in rand (either side enters it); null when not recorded. */
  fundingAmount: number | null
  /** When the funding amount was last set, and by which side (the implementor; a system admin may correct it). */
  fundingUpdatedAt?: Date | null
  fundingUpdatedSide?: string
}

export type FunderOrgMatch = { id: string; name: string; type: FunderOrgType }

export const FUNDER_ORG_TYPES: FunderOrgType[] = ['foundation', 'government', 'corporate', 'dfi', 'other']
export const FUNDER_ORG_TYPE_LABELS: Record<FunderOrgType, string> = {
  foundation: 'Foundation',
  government: 'Government',
  corporate: 'Corporate',
  dfi: 'Development finance',
  other: 'Other',
}

const text = (value: unknown) => String(value ?? '').trim()
const toDate = (value: unknown) => (value as Stamp)?.toDate?.() ?? null
const orgStatus = (value: unknown): FunderOrgStatus => (value === 'confirmed' || value === 'merged' ? value : 'invited')
const linkStatus = (value: unknown): FunderLinkStatus =>
  (['pending', 'active', 'declined', 'removed', 'expired'].includes(text(value)) ? text(value) as FunderLinkStatus : 'pending')
const orgType = (value: unknown): FunderOrgType => (FUNDER_ORG_TYPES.includes(text(value) as FunderOrgType) ? text(value) as FunderOrgType : 'other')

const toLink = (id: string, data: Record<string, unknown>): FunderLink => ({
  id,
  programId: text(data.programId),
  programName: text(data.programName),
  companyCode: text(data.companyCode),
  companyName: text(data.companyName) || text(data.companyCode),
  funderOrgId: text(data.funderOrgId),
  funderOrgName: text(data.funderOrgName),
  funderOrgStatus: orgStatus(data.funderOrgStatus),
  funderOrgContactEmail: text(data.funderOrgContactEmail) || undefined,
  funderOrgContactName: text(data.funderOrgContactName) || undefined,
  status: linkStatus(data.status),
  requestedAt: toDate(data.requestedAt),
  respondedAt: toDate(data.respondedAt),
  fundingAmount: typeof data.fundingAmount === 'number' && Number.isFinite(data.fundingAmount) ? data.fundingAmount : null,
  fundingUpdatedAt: toDate(data.fundingUpdatedAt),
  fundingUpdatedSide: text(data.fundingUpdatedSide) || undefined,
})

const toOrganisation = (id: string, data: Record<string, unknown>): FunderOrganisation => ({
  id,
  name: text(data.name),
  type: orgType(data.type),
  status: orgStatus(data.status),
  mergedInto: text(data.mergedInto) || undefined,
  contactName: text(data.contactName) || undefined,
  contactEmail: text(data.contactEmail) || undefined,
  createdByCompany: text(data.createdByCompany) || undefined,
  createdByCompanyName: text(data.createdByCompanyName) || undefined,
  createdAt: toDate(data.createdAt),
})

/** One programme's funder links, live. The query names the company, as firestore.rules requires of implementor staff. */
export const subscribeProgrammeFunderLinks = (companyCode: string, programId: string, onChange: (links: FunderLink[]) => void, onError: () => void): Unsubscribe =>
  onSnapshot(
    query(collection(getFirebaseDb(), 'funderLinks'), where('companyCode', '==', companyCode), where('programId', '==', programId)),
    (snapshot) => onChange(snapshot.docs.map((row) => toLink(row.id, row.data())).filter((link) => link.status !== 'removed')),
    onError,
  )

/** A funder organisation's own links, live (its members). The query names the organisation, as firestore.rules requires. */
export const subscribeOrganisationLinks = (orgId: string, onChange: (links: FunderLink[]) => void, onError: () => void): Unsubscribe =>
  onSnapshot(
    query(collection(getFirebaseDb(), 'funderLinks'), where('funderOrgId', '==', orgId)),
    (snapshot) => onChange(snapshot.docs.map((row) => toLink(row.id, row.data()))),
    onError,
  )

/** The member's own organisation, live (its status changes when a system admin confirms it). */
export const subscribeOwnOrganisation = (orgId: string, onChange: (organisation: FunderOrganisation | null) => void, onError: () => void): Unsubscribe =>
  onSnapshot(doc(getFirebaseDb(), 'funderOrganisations', orgId), (snapshot) => onChange(snapshot.exists() ? toOrganisation(snapshot.id, snapshot.data()) : null), onError)

/** Every link (system admins). */
export const subscribeAllFunderLinks = (onChange: (links: FunderLink[]) => void, onError: () => void): Unsubscribe =>
  onSnapshot(collection(getFirebaseDb(), 'funderLinks'), (snapshot) => onChange(snapshot.docs.map((row) => toLink(row.id, row.data()))), onError)

/** Every funder organisation (system admins). */
export const subscribeFunderOrganisations = (onChange: (organisations: FunderOrganisation[]) => void, onError: () => void): Unsubscribe =>
  onSnapshot(collection(getFirebaseDb(), 'funderOrganisations'), (snapshot) => onChange(
    snapshot.docs.map((row) => toOrganisation(row.id, row.data())).sort((left, right) => left.name.localeCompare(right.name)),
  ), onError)

/** A funder made the old way: one company and its programmes (none = all of them), no organisation. */
export type OldStyleFunder = { uid: string; name: string; email: string; companyCode: string; programIds: string[]; active: boolean }

/**
 * Funder accounts (system admins may list users): how many sign-ins each organisation has, and the funders made the
 * old way that still need converting. Training-module funders (users.funderId) are a different kind and not listed.
 */
export const subscribeFunderAccounts = (onChange: (accounts: { counts: Map<string, number>; oldStyle: OldStyleFunder[] }) => void, onError: () => void): Unsubscribe =>
  onSnapshot(query(collection(getFirebaseDb(), 'users'), where('role', '==', 'funder')), (snapshot) => {
    const counts = new Map<string, number>()
    const oldStyle: OldStyleFunder[] = []
    snapshot.docs.forEach((row) => {
      const orgId = text(row.get('funderOrgId'))
      const companyCode = text(row.get('companyCode'))
      if (orgId && !companyCode) counts.set(orgId, (counts.get(orgId) || 0) + 1)
      else if (!orgId && companyCode && !text(row.get('funderId'))) {
        const programIds = row.get('assignedProgramIds')
        oldStyle.push({
          uid: row.id,
          name: text(row.get('name') || row.get('displayName')) || text(row.get('email')),
          email: text(row.get('email')),
          companyCode,
          programIds: Array.isArray(programIds) ? programIds.map(text).filter(Boolean) : [],
          active: row.get('status') !== 'inactive' && row.get('active') !== false,
        })
      }
    })
    onChange({ counts, oldStyle: oldStyle.sort((left, right) => left.name.localeCompare(right.name)) })
  }, onError)

/** A system admin adds a funder organisation directly; it is confirmed at once. */
export const createFunderOrganisation = (values: { name: string; type: FunderOrgType }) =>
  call<{ name: string; type: FunderOrgType }, { orgId: string; name: string }>('createFunderOrg', { name: values.name.trim(), type: values.type })

/** Converts a funder made the old way into a member of a funder organisation (an existing one, or a new one). */
export const convertCompanyFunder = (values: { userId: string; orgId?: string; newOrg?: { name: string; type: FunderOrgType } }) =>
  call<typeof values, { orgId: string; orgName: string; programmes: number }>('convertCompanyFunder', values)

const call = async <Input, Output>(name: string, input: Input): Promise<Output> => {
  if (!firebaseApp) throw new Error('functions_unavailable')
  try {
    return (await httpsCallable<Input, Output>(getFunctions(firebaseApp, 'us-central1'), name)(input)).data
  } catch (error) {
    const code = String((error as { code?: string })?.code || '')
    if (code.endsWith('already-exists') && String((error as Error)?.message || '').includes('email_already_exists')) {
      throw new Error('email_already_exists', { cause: error })
    }
    throw error
  }
}

/** Records the funding committed to a programme (rand), or clears it with null. */
export const setLinkFunding = (linkId: string, amount: number | null) =>
  call<{ linkId: string; amount: number | null }, { linkId: string; fundingAmount: number | null }>('setFunderOrgLinkFunding', { linkId, amount })

/** Confirmed organisations matching a name (and lookalikes of it), for an implementor choosing a funder. */
export const searchFunderOrganisations = async (searchText: string) =>
  (await call<{ query: string }, { matches: FunderOrgMatch[] }>('searchFunderOrgs', { query: searchText.trim() })).matches

export const requestFunderLink = (programId: string, funderOrgId: string) =>
  call<{ programId: string; funderOrgId: string }, { linkId: string }>('requestFunderOrgLink', { programId, funderOrgId })

export const inviteFunderOrganisation = (values: { programId: string; name: string; type: FunderOrgType; contactName: string; email: string }) =>
  call<typeof values, { orgId: string; linkId: string; setPasswordLink: string | null }>('inviteFunderOrganisation', {
    ...values, name: values.name.trim(), contactName: values.contactName.trim(), email: values.email.trim().toLowerCase(),
  })

export const removeFunderLink = (linkId: string) => call<{ linkId: string }, { orgId: string }>('removeFunderOrgLink', { linkId })

export const respondToFunderLink = (linkId: string, accept: boolean) =>
  call<{ linkId: string; accept: boolean }, { status: FunderLinkStatus }>('respondToFunderOrgLink', { linkId, accept })

export const resendFunderInvite = (orgId: string) => call<{ orgId: string }, { ok: boolean }>('resendFunderOrgInvite', { orgId })

export const changeFunderInviteEmail = (orgId: string, email: string) =>
  call<{ orgId: string; email: string }, { ok: boolean }>('changeFunderOrgInviteEmail', { orgId, email: email.trim().toLowerCase() })

export const confirmFunderOrganisation = (orgId: string) => call<{ orgId: string }, { orgId: string }>('confirmFunderOrg', { orgId })

export const mergeFunderOrganisations = (sourceId: string, targetId: string) =>
  call<{ sourceId: string; targetId: string }, { orgId: string }>('mergeFunderOrgs', { sourceId, targetId })

export const inviteFunderColleague = (values: { name: string; email: string }) =>
  call<typeof values, { uid: string; setPasswordLink: string | null }>('inviteFunderOrgColleague', { name: values.name.trim(), email: values.email.trim().toLowerCase() })

/** The message to show for a failed call: the server's own wording where it gave one. */
export const funderOrgErrorMessage = (error: unknown, fallback: string, emailTaken: string) => {
  if (error instanceof Error && error.message === 'email_already_exists') return emailTaken
  const message = String((error as { message?: unknown })?.message || '').trim()
  return message && !message.startsWith('internal') && message !== 'INTERNAL' ? message : fallback
}
