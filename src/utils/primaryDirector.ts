import type { BusinessDirector } from '@/types/applicant'
import { genderFromSaIdNumber, ownershipFromDirectors } from '@/utils/businessDirectors'

/** Stable identifier for a new registrant's director row. Existing director IDs are preserved. */
export const primaryDirectorKey = (uid: string) => `primary-director-${uid}`

type Identity = {
  participantName?: string
  fullName?: string
  email?: string
  idNumber?: string
  phone?: string
  gender?: string
  disabilityStatus?: string
}

const normalized = (value?: string) => (value || '').trim().toLowerCase()

/** Match a legacy row only when it is strongly attributable to the account holder. */
export function findPrimaryDirectorIndex(directors: BusinessDirector[], uid: string, identity: Identity): number {
  const stableKey = primaryDirectorKey(uid)
  const direct = directors.findIndex((director) => director.id === stableKey)
  if (direct >= 0) return direct
  if (identity.email) {
    const matches = directors.map((d, index) => normalized(d.email) === normalized(identity.email) ? index : -1).filter((n) => n >= 0)
    if (matches.length === 1) return matches[0]
  }
  if (identity.idNumber) {
    const matches = directors.map((d, index) => d.idNumber === identity.idNumber ? index : -1).filter((n) => n >= 0)
    if (matches.length === 1) return matches[0]
  }
  // No name-only matching: another person could share a name.
  return -1
}

/** Registration automatically creates a director (not automatically a shareholder). */
export function reconcilePrimaryDirector(directors: BusinessDirector[], uid: string, identity: Identity): BusinessDirector[] {
  if (!uid) return directors
  const index = findPrimaryDirectorIndex(directors, uid, identity)
  const existing = index >= 0 ? directors[index] : undefined
  const alreadyOwnsShares = existing?.role === 'both' || existing?.role === 'shareholder' || Number(existing?.sharePercent || 0) > 0
  const next: BusinessDirector = {
    ...existing,
    id: existing?.id || primaryDirectorKey(uid),
    fullName: identity.participantName || identity.fullName || existing?.fullName || '',
    email: identity.email || existing?.email || '',
    phone: identity.phone || '',
    idNumber: identity.idNumber || '',
    gender: genderFromSaIdNumber(identity.idNumber || '') || identity.gender || existing?.gender,
    disabilityStatus: identity.disabilityStatus || existing?.disabilityStatus,
    role: alreadyOwnsShares ? 'both' : 'director',
    sharePercent: alreadyOwnsShares ? Number(existing?.sharePercent || 0) : 0,
  } as BusinessDirector
  if (existing && JSON.stringify(existing) === JSON.stringify(next)) return directors
  if (index < 0) return [next, ...directors]
  return directors.map((director, i) => i === index ? next : director)
}

export function ownershipForDirectors(directors: BusinessDirector[]) {
  return ownershipFromDirectors(directors.filter((director) => director.role !== 'director' && Number(director.sharePercent || 0) > 0))
}
