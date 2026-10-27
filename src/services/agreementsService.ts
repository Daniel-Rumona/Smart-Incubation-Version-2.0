import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import {
  COMPANY_AGREEMENTS,
  COMPANY_AGREEMENTS_VERSION,
  type BeneficiarySnapshot,
  type CompanyAgreementKey,
} from '@/config/agreements'
import type { FullIdentity } from '@/types/identity'

/**
 * Signed agreements (Code of Conduct, POPIA consent form), one immutable record per person, organisation, agreement
 * and wording version in `companyAgreementSubmissions`. A new version of the wording means everyone signs again.
 */

const COLLECTION = 'companyAgreementSubmissions'

export type SignedAgreement = {
  id: string
  agreementKey: CompanyAgreementKey
  agreementTitle: string
  acceptedAt: Date | null
  acceptedByUid: string
  acceptedByEmail: string
  acceptedByRole: string
  companyCode: string
  companyName: string
  signatureURL?: string | null
  beneficiarySnapshot?: BeneficiarySnapshot
  version: string
}

/** SMEs sign the Code of Conduct and the consent form; everyone else signs the consent form. */
export const requiredAgreements = (role?: string): CompanyAgreementKey[] =>
  role === 'incubatee' ? ['code-of-conduct', 'company-consent'] : ['company-consent']

/**
 * The organisation an agreement is recorded against: the person's company; SMEs and consultants without one belong to
 * the platform owner (as myCompany() in firestore.rules); anyone else without one is 'platform'.
 */
export const agreementScope = (user: Pick<FullIdentity, 'companyCode' | 'role'>) =>
  String(user.companyCode || '').trim() || (user.role === 'incubatee' || user.role === 'consultant' ? 'QTX' : 'platform')

export const agreementSubmissionId = (scope: string, uid: string, key: CompanyAgreementKey, version = COMPANY_AGREEMENTS_VERSION) =>
  `${scope}_${uid}_${key}_${version}`.replace(/[^A-Za-z0-9_-]/g, '_')

/** The required agreements this person hasn't signed for their organisation and the current wording. */
export const missingAgreements = async (user: FullIdentity): Promise<CompanyAgreementKey[]> => {
  const scope = agreementScope(user)
  const db = getFirebaseDb()
  const required = requiredAgreements(user.role)
  const signed = await Promise.all(required.map((key) => getDoc(doc(db, COLLECTION, agreementSubmissionId(scope, user.uid, key))).then((snapshot) => snapshot.exists())))
  return required.filter((_, index) => !signed[index])
}

const text = (...values: unknown[]) => values.map((value) => String(value ?? '').trim()).find(Boolean) || ''

/** What the person's record says at signing time, so the signed document shows who agreed even if details change later. */
export const buildBeneficiarySnapshot = async (user: FullIdentity): Promise<BeneficiarySnapshot> => {
  const db = getFirebaseDb()
  const read = async (path: string, id: string) => {
    try {
      const snapshot = await getDoc(doc(db, path, id))
      return snapshot.exists() ? snapshot.data() : {}
    } catch {
      return {}
    }
  }
  const [profile, participant, applicant] = await Promise.all([
    read('users', user.uid),
    user.role === 'incubatee' ? read('participants', user.uid) : Promise.resolve({} as Record<string, unknown>),
    user.role === 'incubatee' ? read('applicantProfiles', user.uid) : Promise.resolve({} as Record<string, unknown>),
  ])
  const snapshot: BeneficiarySnapshot = {
    fullName: text(applicant.participantName, participant.participantName, profile.name, profile.displayName, user.name, user.displayName),
    email: text(user.email, profile.email),
    mobileNumber: text(applicant.phone, participant.phone, profile.phone),
    businessName: text(participant.businessName, applicant.businessName) || undefined,
    idNumber: text(applicant.idNumber, participant.idNumber) || undefined,
  }
  return Object.fromEntries(Object.entries(snapshot).filter(([, value]) => value)) as BeneficiarySnapshot
}

/** Records the person's acceptance with their signature. Each version is signed once; records are never edited. */
export const signAgreement = async (user: FullIdentity, key: CompanyAgreementKey, input: { signatureURL: string; companyName: string }) => {
  if (!input.signatureURL) throw new Error('Add your signature before signing.')
  const scope = agreementScope(user)
  const beneficiarySnapshot = await buildBeneficiarySnapshot(user)
  await setDoc(doc(getFirebaseDb(), COLLECTION, agreementSubmissionId(scope, user.uid, key)), {
    agreementKey: key,
    agreementTitle: COMPANY_AGREEMENTS[key].title,
    accepted: true,
    acceptedAt: serverTimestamp(),
    acceptedByUid: user.uid,
    acceptedByEmail: user.email || '',
    acceptedByRole: user.role,
    companyCode: scope,
    companyName: input.companyName || scope,
    signatureURL: input.signatureURL,
    beneficiarySnapshot,
    version: COMPANY_AGREEMENTS_VERSION,
  })
}

const fromDoc = (id: string, data: Record<string, unknown>): SignedAgreement => {
  const at = data.acceptedAt as { toDate?: () => Date } | undefined
  return {
    id,
    agreementKey: data.agreementKey as CompanyAgreementKey,
    agreementTitle: String(data.agreementTitle || ''),
    acceptedAt: typeof at?.toDate === 'function' ? at.toDate() : null,
    acceptedByUid: String(data.acceptedByUid || ''),
    acceptedByEmail: String(data.acceptedByEmail || ''),
    acceptedByRole: String(data.acceptedByRole || ''),
    companyCode: String(data.companyCode || ''),
    companyName: String(data.companyName || ''),
    signatureURL: data.signatureURL ? String(data.signatureURL) : null,
    beneficiarySnapshot: (data.beneficiarySnapshot as BeneficiarySnapshot) || undefined,
    version: String(data.version || ''),
  }
}

/** Every agreement signed for a company (operations and directors see their own company's; firestore.rules). */
export const listCompanyAgreements = async (companyCode: string) => {
  if (!companyCode) return []
  const snapshot = await getDocs(query(collection(getFirebaseDb(), COLLECTION), where('companyCode', '==', companyCode)))
  return snapshot.docs.map((row) => fromDoc(row.id, row.data()))
}

/** Latest signed copy of each agreement per person, keyed by uid. */
export const latestAgreementsByPerson = (rows: SignedAgreement[]) => {
  const byPerson = new Map<string, Partial<Record<CompanyAgreementKey, SignedAgreement>>>()
  rows.forEach((row) => {
    const current = byPerson.get(row.acceptedByUid) || {}
    const existing = current[row.agreementKey]
    if (!existing || (row.acceptedAt?.getTime() || 0) > (existing.acceptedAt?.getTime() || 0)) current[row.agreementKey] = row
    byPerson.set(row.acceptedByUid, current)
  })
  return byPerson
}
