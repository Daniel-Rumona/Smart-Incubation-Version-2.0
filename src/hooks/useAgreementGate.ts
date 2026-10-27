import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { COMPANY_AGREEMENTS_VERSION } from '@/config/agreements'
import { missingAgreements } from '@/services/agreementsService'
import type { FullIdentity } from '@/types/identity'

// One check per person, wording version and browser session: after that the session is known to be signed up.
const checkedKey = (uid: string) => `agreements-checked:${uid}:${COMPANY_AGREEMENTS_VERSION}`

export const markAgreementsChecked = (uid: string) => {
  try { sessionStorage.setItem(checkedKey(uid), '1') } catch { /* storage unavailable: the check simply runs again */ }
}

const alreadyChecked = (uid: string) => {
  try { return sessionStorage.getItem(checkedKey(uid)) === '1' } catch { return false }
}

/**
 * Sends someone who finished Welcome but hasn't signed the current agreements (existing accounts, or after the wording
 * changed) to /consent. A failed lookup lets them through rather than locking anyone out.
 */
export const useAgreementGate = (user: FullIdentity | null | undefined) => {
  const navigate = useNavigate()
  useEffect(() => {
    if (!user?.firstLoginComplete || alreadyChecked(user.uid)) return
    let cancelled = false
    missingAgreements(user)
      .then((missing) => {
        if (cancelled) return
        if (missing.length) navigate('/consent', { replace: true })
        else markAgreementsChecked(user.uid)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [navigate, user])
}
