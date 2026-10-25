import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { getFirebaseDb, isFirebaseConfigured } from '@/config/firebase'
import { useActiveCompanyCode } from '@/hooks/useActiveCompanyCode'

export type CompanyScope = {
  /** The company picked in the top bar; undefined for all companies. */
  companyCode?: string
  /** That company's users, by uid and by lower-cased email, for records that carry no company of their own (sessions, email logs). */
  uids: Set<string>
  emails: Set<string>
  /** False while the company's users are still loading; filter only once it is true. */
  ready: boolean
}

const EMPTY = new Set<string>()

/** The top-bar company for platform admin pages, with the company's members for narrowing records by person. */
export const useCompanyScope = (): CompanyScope => {
  const { activeCompanyCode, isAllCompanies } = useActiveCompanyCode()
  const companyCode = isAllCompanies ? undefined : activeCompanyCode
  const [members, setMembers] = useState<{ companyCode: string; uids: Set<string>; emails: Set<string> }>()

  useEffect(() => {
    if (!companyCode || !isFirebaseConfigured) return
    let active = true
    getDocs(query(collection(getFirebaseDb(), 'users'), where('companyCode', '==', companyCode)))
      .then((snapshot) => {
        if (!active) return
        setMembers({
          companyCode,
          uids: new Set(snapshot.docs.flatMap((record) => [record.id, String(record.data().uid || '')]).filter(Boolean)),
          emails: new Set(snapshot.docs.map((record) => String(record.data().email || '').trim().toLowerCase()).filter(Boolean)),
        })
      })
      // Nobody to match: the company's person-linked figures show as empty rather than as everyone's.
      .catch(() => { if (active) setMembers({ companyCode, uids: EMPTY, emails: EMPTY }) })
    return () => { active = false }
  }, [companyCode])

  if (!companyCode) return { uids: EMPTY, emails: EMPTY, ready: true }
  const loaded = members?.companyCode === companyCode ? members : undefined
  return { companyCode, uids: loaded?.uids || EMPTY, emails: loaded?.emails || EMPTY, ready: !!loaded }
}

/** True when any of the addresses belongs to the scoped company (always true for all companies). */
export const sentToScope = (scope: CompanyScope, addresses: unknown) =>
  !scope.companyCode || [addresses].flat().some((address) => typeof address === 'string' && scope.emails.has(address.trim().toLowerCase()))
