import dayjs, { type Dayjs } from 'dayjs'
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, where, writeBatch } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'
import type { SystemSettingsRecord } from '@/types/companySettings'

/**
 * Company settings a director changes directly (the rest still go through a change request to the platform admin).
 * Each change updates `companies/{code}` and writes a `companySettingsChanges` record in the same batch: the
 * settings page shows it as Change history, and a Cloud Function emails the platform admin about it.
 * firestore.rules allows exactly these fields and values (and departments/branches may only be turned on).
 */

export type DirectSettingKey = 'consultantLabel' | 'interventionDeliveryRoles' | 'assignmentModel' | 'smeDivisionModel' | 'hasDepartments' | 'hasBranches'

export const DIRECT_SETTING_KEYS: DirectSettingKey[] = ['consultantLabel', 'interventionDeliveryRoles', 'assignmentModel', 'smeDivisionModel', 'hasDepartments', 'hasBranches']

type SettingValue = string | boolean | string[]

export type SettingsChange = {
  id: string
  field: DirectSettingKey
  from: SettingValue | null
  to: SettingValue
  changedByName: string
  changedAt: Dayjs | null
}

const toDay = (value: unknown): Dayjs | null => {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') return dayjs((value as { toDate: () => Date }).toDate())
  return null
}

export const updateCompanySetting = async (
  user: FullIdentity,
  settings: SystemSettingsRecord,
  field: DirectSettingKey,
  value: SettingValue,
) => {
  const companyCode = String(user.companyCode || settings.companyCode || '').trim()
  if (!companyCode) throw new Error('missing-company')
  if ((field === 'hasDepartments' || field === 'hasBranches') && value !== true) throw new Error('turn-off-needs-request')
  const db = getFirebaseDb()
  const previous = (settings as Record<string, unknown>)[field]
  const batch = writeBatch(db)
  batch.update(doc(db, 'companies', companyCode), { [field]: value, updatedAt: serverTimestamp(), updatedByUid: user.uid })
  batch.set(doc(collection(db, 'companySettingsChanges')), {
    companyCode,
    companyName: settings.companyName || companyCode,
    field,
    from: previous === undefined ? null : previous,
    to: value,
    changedByUid: user.uid,
    changedByName: user.displayName || user.email || '',
    changedByEmail: user.email || '',
    changedAt: serverTimestamp(),
  })
  await batch.commit()
}

const mapChange = (id: string, data: Record<string, unknown>): SettingsChange => ({
  id,
  field: data.field as DirectSettingKey,
  from: (data.from ?? null) as SettingValue | null,
  to: data.to as SettingValue,
  changedByName: String(data.changedByName || data.changedByEmail || ''),
  changedAt: toDay(data.changedAt),
})

// The settings page shows this many of the latest changes; older ones stay on record but aren't loaded.
export const HISTORY_LIMIT = 10

/**
 * A company's latest changes, newest first, and whether older ones exist. Uses the companyCode + changedAt index
 * (firestore.indexes.json); until that index is deployed it falls back to reading the company's changes and sorting here.
 */
export const listCompanySettingsChanges = async (companyCode: string): Promise<{ changes: SettingsChange[], hasOlder: boolean }> => {
  if (!companyCode) return { changes: [], hasOlder: false }
  const changesRef = collection(getFirebaseDb(), 'companySettingsChanges')
  try {
    const snapshot = await getDocs(query(changesRef, where('companyCode', '==', companyCode), orderBy('changedAt', 'desc'), limit(HISTORY_LIMIT + 1)))
    const changes = snapshot.docs.map((record) => mapChange(record.id, record.data()))
    return { changes: changes.slice(0, HISTORY_LIMIT), hasOlder: changes.length > HISTORY_LIMIT }
  } catch (error) {
    if ((error as { code?: string }).code !== 'failed-precondition') throw error
    const snapshot = await getDocs(query(changesRef, where('companyCode', '==', companyCode)))
    const changes = snapshot.docs
      .map((record) => mapChange(record.id, record.data()))
      .sort((a, b) => (b.changedAt?.valueOf() || 0) - (a.changedAt?.valueOf() || 0))
    return { changes: changes.slice(0, HISTORY_LIMIT), hasOlder: changes.length > HISTORY_LIMIT }
  }
}

/** Platform admins: the latest direct changes across every company. */
export const listRecentSettingsChanges = async (max = 50) => {
  const snapshot = await getDocs(query(collection(getFirebaseDb(), 'companySettingsChanges'), orderBy('changedAt', 'desc'), limit(max)))
  return snapshot.docs.map((record) => ({
    ...mapChange(record.id, record.data()),
    companyName: String(record.data().companyName || record.data().companyCode || ''),
  }))
}
