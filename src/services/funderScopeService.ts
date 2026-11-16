import { collection, doc, getDoc, getDocs, query, where, type DocumentData, type QueryConstraint, type QueryDocumentSnapshot } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'

/**
 * Which company data a portfolio page may load, as a list of companies and, per company, the programmes it is limited
 * to (null = all of that company's). Staff and directors get their own company. A company-scoped funder gets their
 * company and linked programmes (users.assignedProgramIds; none = all). A funder organisation member (no company)
 * gets every company their organisation's active links cover, each with its linked programmes.
 *
 * firestore.rules only lets a funder list records whose query names the company and programmes it may read, so every
 * read goes through getDocsInScope, which runs one query per company (and per 30 programmes).
 */

export type ScopeEntry = { companyCode: string; companyName: string; programIds: string[] | null }
export type DataScope = ScopeEntry[]

/** The implementor filter's value for "every implementor". */
export const ALL_IMPLEMENTORS = 'all'

const text = (value: unknown) => String(value ?? '').trim()
const unique = (values: unknown[] | undefined) => [...new Set((values || []).map(text).filter(Boolean))]

/** A funder organisation's member: role funder, an organisation, and no company of their own. */
export const isOrgFunder = (user: FullIdentity | null | undefined) =>
  user?.role === 'funder' && !!text(user.funderOrgId) && !text(user.companyCode)

/** A company-scoped funder's linked programmes; empty for everyone else, and for a funder linked to all of the company's. */
export const funderProgramIds = (user: FullIdentity) =>
  user.role === 'funder' && !isOrgFunder(user) ? unique(user.assignedProgramIds) : []

const companyNames = new Map<string, Promise<string>>()
const companyName = (companyCode: string) => {
  if (!companyNames.has(companyCode)) {
    companyNames.set(companyCode, getDoc(doc(getFirebaseDb(), 'companies', companyCode))
      .then((snapshot) => text(snapshot.data()?.companyName || snapshot.data()?.name) || companyCode)
      .catch(() => companyCode))
  }
  return companyNames.get(companyCode)!
}

const orgScopes = new Map<string, Promise<DataScope>>()

/** An organisation funder's companies and programmes, from the lists the server keeps on their account. */
const loadOrgFunderScope = (user: FullIdentity) => {
  const programIds = unique(user.funderProgramIds)
  const companies = unique(user.funderCompanyCodes)
  const key = `${user.uid}|${programIds.join(',')}|${companies.join(',')}`
  if (!orgScopes.has(key)) {
    orgScopes.set(key, (async () => {
      if (!programIds.length || !companies.length) return []
      const linked = new Set(programIds)
      // Programme documents say which company runs each linked programme (any signed-in user may read them).
      const entries = await Promise.all(companies.map(async (companyCode) => {
        const [programmes, name] = await Promise.all([
          getDocs(query(collection(getFirebaseDb(), 'programs'), where('companyCode', '==', companyCode))),
          companyName(companyCode),
        ])
        const ids = programmes.docs.map((row) => row.id).filter((id) => linked.has(id))
        return { companyCode, companyName: name, programIds: ids }
      }))
      return entries.filter((entry) => entry.programIds.length > 0).sort((left, right) => left.companyName.localeCompare(right.companyName))
    })().catch((error) => { orgScopes.delete(key); throw error }))
  }
  return orgScopes.get(key)!
}

/**
 * The scope for this person, narrowed to one implementor when one is chosen (organisation funders only; anyone else
 * has a single company). An empty list means there is nothing they may load.
 */
export const loadDataScope = async (user: FullIdentity | null | undefined, implementor: string = ALL_IMPLEMENTORS): Promise<DataScope> => {
  if (!user) return []
  if (isOrgFunder(user)) {
    const scope = await loadOrgFunderScope(user)
    return implementor && implementor !== ALL_IMPLEMENTORS ? scope.filter((entry) => entry.companyCode === implementor) : scope
  }
  // Without a company there is nothing to load; never query without the company filter.
  const companyCode = text(user.companyCode)
  if (!companyCode) return []
  const programIds = funderProgramIds(user)
  return [{ companyCode, companyName: '', programIds: programIds.length ? programIds : null }]
}

/** One collection's records across the scope: each company's, narrowed to its programmes when it is limited to some. */
export const getDocsInScope = async (scope: DataScope, collectionName: string, constraints: QueryConstraint[] = []) => {
  const db = getFirebaseDb()
  const queries = scope.flatMap((entry) => {
    const company = where('companyCode', '==', entry.companyCode)
    if (entry.programIds === null) return [query(collection(db, collectionName), company, ...constraints)]
    // 'in' takes 30 values at a time.
    return Array.from({ length: Math.ceil(entry.programIds.length / 30) }, (_, index) => entry.programIds!.slice(index * 30, index * 30 + 30))
      .map((chunk) => query(collection(db, collectionName), company, ...constraints, where('programId', 'in', chunk)))
  })
  const snapshots = await Promise.all(queries.map((item) => getDocs(item)))
  return snapshots.flatMap((snapshot) => snapshot.docs) as Array<QueryDocumentSnapshot<DocumentData>>
}

/** Which implementor (company) a programme belongs to, within the scope. */
export const scopeCompanyOfProgram = (scope: DataScope, programId: string) =>
  scope.find((entry) => entry.programIds?.includes(programId))?.companyCode
  || (scope.length === 1 ? scope[0].companyCode : undefined)
