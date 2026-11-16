import type { Firestore } from 'firebase-admin/firestore'

/**
 * Compliance for funders, as counts only. Funders can't read complianceDocuments (the records link to uploaded IDs
 * and tax certificates, and Firestore can't hide single fields), so the funder Analytics page gets this summary
 * instead: how many SMEs are fully compliant, how many have a document expiring soon, how many are missing one,
 * and which documents are most often missing. No names, files or links leave the server.
 *
 * Scope follows firestore.rules' funderProgramAllows: the funder's linked programmes (users.assignedProgramIds), or
 * every programme of their company when none are linked, narrowed to the one picked in the programme selector.
 *
 * The document catalogue and statuses mirror src/config/complianceDocuments.ts and the displayStatus rule in
 * src/services/incubateeComplianceService.ts; keep them in step.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

export class FunderComplianceError extends Error {
  constructor(public code: 'permission-denied' | 'failed-precondition', message: string) {
    super(message)
  }
}

export type FunderComplianceSummary = {
  total: number
  compliant: number
  expiring: number
  missing: number
  /** Required documents most often missing, expired or not yet approved, by how many SMEs. */
  missingDocuments: Array<{ name: string, smes: number }>
}

const EXPIRING_DAYS = 30

const CATALOGUE: Array<{ key: string, name: string, aliases: string[] }> = [
  { key: 'id-document', name: 'ID document', aliases: ['Certified ID Copy', 'ID copy'] },
  { key: 'proof-of-address', name: 'Proof of address', aliases: [] },
  { key: 'cipc-registration', name: 'CIPC registration', aliases: ['CIPC', 'CIPC documents'] },
  { key: 'tax-compliance', name: 'Tax compliance (PIN or clearance)', aliases: ['Tax PIN', 'Tax clearance', 'Tax compliance'] },
  { key: 'b-bbee-certificate', name: 'B-BBEE certificate', aliases: ['BBBEE certificate', 'B-BBEE affidavit'] },
  { key: 'bank-confirmation', name: 'Bank confirmation letter', aliases: ['Bank confirmation'] },
  { key: 'bank-statements', name: "Three months' bank statements", aliases: ['Three Months Bank Statements', 'Bank statements'] },
  { key: 'management-accounts', name: 'Management accounts', aliases: [] },
]

const cleanKey = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const lookup = new Map<string, { key: string, name: string }>()
CATALOGUE.forEach((entry) => [entry.key, entry.name, ...entry.aliases].forEach((name) => lookup.set(cleanKey(name), entry)))
const keyFor = (name: unknown) => lookup.get(cleanKey(name))?.key || cleanKey(name)

/** The documents a programme requires; everything in the catalogue when it hasn't chosen. */
const requirementsOf = (complianceRequirements: unknown) => {
  const configured = Array.isArray(complianceRequirements) ? complianceRequirements as Row[] : []
  const seen = new Set<string>()
  const chosen = configured.flatMap((item) => {
    const rawName = String(item?.name || '').trim()
    if (!rawName) return []
    const entry = lookup.get(cleanKey(rawName))
    const key = entry?.key || cleanKey(rawName)
    if (seen.has(key)) return []
    seen.add(key)
    return item.required === false ? [] : [{ key, name: entry?.name || rawName }]
  })
  return configured.length ? chosen : CATALOGUE.map((entry) => ({ key: entry.key, name: entry.name }))
}

const dateOf = (value: unknown): Date | null => {
  if (!value) return null
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate()
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.valueOf()) ? null : parsed
}

/** valid / expiring / not ok, for one stored document (see displayStatus in incubateeComplianceService.ts). */
const documentState = (row: Row, now: Date): 'valid' | 'expiring' | 'not_ok' => {
  const url = row.url || row.link || row.fileUrl
  const current = String(row.currentStatus || row.status || '').toLowerCase()
  const verification = String(row.verificationStatus || '').toLowerCase()
  const expiry = dateOf(row.expiryDate)
  if (!url || current === 'missing' || current === 'expired') return 'not_ok'
  if (expiry && expiry.valueOf() < now.valueOf()) return 'not_ok'
  if (!(current === 'valid' || current === 'approved' || verification === 'verified')) return 'not_ok'
  if (expiry && expiry.valueOf() - now.valueOf() <= EXPIRING_DAYS * 86_400_000) return 'expiring'
  return 'valid'
}

const chunks = <T,>(items: T[], size = 30) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size))

const idList = (value: unknown) => [...new Set(((Array.isArray(value) ? value : []) as unknown[]).map((id) => String(id).trim()).filter(Boolean))]

/**
 * The companies and programmes this funder may see. A company-scoped funder: their company, and their linked programmes
 * (none = all). A funder organisation's member (no company): each company its active links cover, with those
 * programmes only (users.funderProgramIds / funderCompanyCodes, kept by functions/src/funderOrganisations.ts),
 * narrowed to one implementor when one is chosen.
 */
const funderScopes = async (db: Firestore, me: Row, implementor: string) => {
  const companyCode = String(me.companyCode || '').trim()
  if (companyCode) {
    const programmes = (await db.collection('programs').where('companyCode', '==', companyCode).get()).docs
    const linked = idList(me.assignedProgramIds)
    return [{ companyCode, programmes, allowed: programmes.map((programme) => programme.id).filter((id) => !linked.length || linked.includes(id)) }]
  }
  if (!String(me.funderOrgId || '').trim()) throw new FunderComplianceError('failed-precondition', 'Your account has no company.')
  const linked = new Set(idList(me.funderProgramIds))
  const companies = idList(me.funderCompanyCodes).filter((code) => !implementor || implementor === 'all' || code === implementor)
  return Promise.all(companies.map(async (code) => {
    const programmes = (await db.collection('programs').where('companyCode', '==', code).get()).docs
    return { companyCode: code, programmes, allowed: programmes.map((programme) => programme.id).filter((id) => linked.has(id)) }
  }))
}

export const funderComplianceSummary = async (db: Firestore, uid: string, selectedProgramId?: string | null, implementor?: string | null): Promise<FunderComplianceSummary> => {
  const me = (await db.doc(`users/${uid}`).get()).data() || {}
  if (String(me.role || '') !== 'funder') throw new FunderComplianceError('permission-denied', 'Only funders can see this summary.')

  const picked = String(selectedProgramId || '').trim()
  const scopes = (await funderScopes(db, me, String(implementor || '').trim()))
    .map((scope) => ({ ...scope, allowed: picked && picked !== 'all' ? scope.allowed.filter((id) => id === picked) : scope.allowed }))
    .filter((scope) => scope.allowed.length > 0)
  if (!scopes.length) return { total: 0, compliant: 0, expiring: 0, missing: 0, missingDocuments: [] }
  const requirements = new Map(scopes.flatMap((scope) => scope.programmes.map((programme) => [programme.id, requirementsOf(programme.data().complianceRequirements)] as const)))

  const perCompany = await Promise.all(scopes.map(async (scope) => {
    const rows = (await Promise.all(chunks(scope.allowed).map((ids) => db.collection('participants')
      .where('companyCode', '==', scope.companyCode).where('programId', 'in', ids).get()))).flatMap((snapshot) => snapshot.docs)
    const ids = new Set(rows.map((row) => row.id))
    const docs = (await db.collection('complianceDocuments').where('companyCode', '==', scope.companyCode).get()).docs
      .map((row) => row.data())
      .filter((row) => ids.has(String(row.participantId || '')))
    return { rows, docs }
  }))
  const participants = perCompany.flatMap((entry) => entry.rows)
  const documents = perCompany.flatMap((entry) => entry.docs)

  const now = new Date()
  const missingByKey = new Map<string, { name: string, smes: number }>()
  let compliant = 0
  let expiring = 0
  let missing = 0
  participants.forEach((participant) => {
    const programId = String(participant.data().programId || '')
    const required = requirements.get(programId) || requirementsOf(null)
    // A document counts for the programme the SME is in (older uploads without a programme still count).
    const best = new Map<string, 'valid' | 'expiring' | 'not_ok'>()
    const rank = { not_ok: 0, expiring: 1, valid: 2 }
    documents
      .filter((row) => row.participantId === participant.id && (!row.programId || String(row.programId) === programId))
      .forEach((row) => {
        const key = keyFor(row.type || row.key)
        const state = documentState(row, now)
        if (!best.has(key) || rank[state] > rank[best.get(key)!]) best.set(key, state)
      })
    const gaps = required.filter((requirement) => (best.get(requirement.key) || 'not_ok') === 'not_ok')
    gaps.forEach((requirement) => {
      const entry = missingByKey.get(requirement.key) || { name: requirement.name, smes: 0 }
      entry.smes += 1
      missingByKey.set(requirement.key, entry)
    })
    if (gaps.length) missing += 1
    else if (required.some((requirement) => best.get(requirement.key) === 'expiring')) expiring += 1
    else compliant += 1
  })

  return {
    total: participants.length,
    compliant,
    expiring,
    missing,
    missingDocuments: Array.from(missingByKey.values()).sort((left, right) => right.smes - left.smes).slice(0, 4),
  }
}
