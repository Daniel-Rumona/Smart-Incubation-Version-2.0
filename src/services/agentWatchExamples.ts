import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'

/*
 * Example requests for "New watch" / "New chaser", built from the user's own workspace so they name a
 * town, an SME and a count that actually exist. Anything that can't be read (a facilitator can't list
 * participants, for instance) is simply left out and the example falls back to wording without names.
 */

export type WatchExampleData = {
  /** The town most of the company's SMEs are in. */
  city?: string
  /** An SME with interventions still open. */
  smeWithOpenWork?: string
  /** Interventions still waiting on the facilitator or SME to accept. */
  waitingAcceptance: number
}

type Identity = { uid: string, role?: string | null, companyCode?: string | null }

const lower = (value: unknown) => String(value ?? '').trim().toLowerCase()
const CLOSED = new Set(['cancelled', 'canceled', 'declined', 'superseded', 'completed'])

const mostCommon = (values: string[]) => {
  const counts = new Map<string, number>()
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1))
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0]
}

export const loadWatchExampleData = async (user: Identity): Promise<WatchExampleData> => {
  const company = String(user.companyCode || '').trim()
  const result: WatchExampleData = { waitingAcceptance: 0 }
  if (!company) return result
  const db = getFirebaseDb()

  try {
    const scope = user.role === 'consultant'
      ? query(collection(db, 'assignedInterventions'), where('assigneeId', '==', user.uid), limit(500))
      : query(collection(db, 'assignedInterventions'), where('companyCode', '==', company), limit(500))
    const open = (await getDocs(scope)).docs.map((doc) => doc.data())
      .filter((row) => !CLOSED.has(lower(row.status)) && lower(row.assigneeStatus) !== 'declined' && lower(row.participantStatus) !== 'declined')
    result.waitingAcceptance = open.filter((row) => lower(row.assigneeStatus) !== 'accepted' || lower(row.participantStatus) !== 'accepted').length
    result.smeWithOpenWork = mostCommon(open.map((row) => String(row.businessName || row.participantName || '').trim()).filter(Boolean))
  } catch {
    // Not readable for this user: examples go without counts or SME names.
  }

  if (user.role !== 'consultant') {
    try {
      const participants = await getDocs(query(collection(db, 'participants'), where('companyCode', '==', company), limit(500)))
      const towns = participants.docs.map((doc) => {
        const row = doc.data()
        return String(row.city || row.businessAddressCity || row.town || '').trim()
      }).filter(Boolean)
      // Title-case for the sentence; the watch matches towns case-insensitively.
      const town = mostCommon(towns.map((value) => value.toLowerCase()))
      if (town) result.city = town.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
    } catch {
      // Not readable for this user.
    }
  }
  return result
}
