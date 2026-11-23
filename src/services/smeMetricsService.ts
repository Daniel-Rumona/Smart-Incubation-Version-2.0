import {
  collection, doc, documentId, getDoc, getDocs, query,
  serverTimestamp, setDoc, where, type DocumentData,
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import dayjs from 'dayjs'
import { db } from '@/firebase/config'
import { storage } from '@/firebase'

export type MetricField = 'revenue' | 'headPermanent' | 'headTemporary' | 'orders' | 'customers' | 'traffic' | 'networking'
export type MetricSection = 'revenue' | 'employees' | 'sales' | 'traffic' | 'networking'
export type VerificationStatus = 'self_reported' | 'awaiting_confirmation' | 'confirmed' | 'disputed'
export type MonthlyRecord = {
  month: string
  revenue?: number
  headPermanent?: number
  headTemporary?: number
  orders?: number
  customers?: number
  traffic?: number
  networking?: number
  reportedSections?: MetricSection[]
  revenueProofUrls?: string[]
  employeeProofUrls?: string[]
  reportingSource?: 'sme' | 'operations'
  verificationStatus?: VerificationStatus
  enteredBy?: string
  enteredAt?: unknown
  updatedAt?: unknown
  createdAt?: unknown
}
export type SmeRow = {
  id: string
  businessName: string
  programId: string
  programName: string
  sector: string
  gender: string
  province: string
  beeLevel: string
  acceptedAt?: unknown
  monthly: MonthlyRecord[]
  historyError?: boolean
}
export type OpportunityStage = 'identified' | 'preparing' | 'submitted' | 'shortlisted' | 'awarded' | 'unsuccessful' | 'withdrawn'
export type OpportunityType = 'EOI' | 'RFQ' | 'RFP' | 'Tender' | 'Funding' | 'Pitch' | 'Other'
export type SmeOpportunity = {
  id: string
  title: string
  buyer: string
  type: OpportunityType
  stage: OpportunityStage
  value?: number
  submittedAt?: string
  closingAt?: string
  notes?: string
  reportingSource?: 'sme' | 'operations'
  verificationStatus?: VerificationStatus
}

type AnyDoc = Record<string, unknown>
const text = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback
const num = (value: unknown): number | undefined => {
  if (value === '' || value === undefined || value === null) return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}
const chunks = <T,>(items: T[], n: number) => Array.from({ length: Math.ceil(items.length / n) }, (_, i) => items.slice(i * n, (i + 1) * n))

export const monthToDate = (value: string) => {
  const iso = /^\d{4}-\d{2}$/.test(value) ? dayjs(`${value}-01`) : dayjs(`01 ${value}`)
  return iso.isValid() ? iso.startOf('month') : null
}

const toMonthly = (id: string, raw: DocumentData): MonthlyRecord | null => {
  const month = text(raw.month, id)
  if (!monthToDate(month)) return null
  const fields: Partial<Record<MetricField, number>> = {}
  for (const field of ['revenue','headPermanent','headTemporary','orders','customers','traffic','networking'] as MetricField[]) {
    const value = num(raw[field])
    if (value !== undefined) fields[field] = value
  }
  return {
    month, ...fields,
    reportedSections: Array.isArray(raw.reportedSections) ? raw.reportedSections : [],
    revenueProofUrls: Array.isArray(raw.revenueProofUrls) ? raw.revenueProofUrls : [],
    employeeProofUrls: Array.isArray(raw.employeeProofUrls) ? raw.employeeProofUrls : [],
    reportingSource: raw.reportingSource,
    verificationStatus: raw.verificationStatus,
    enteredBy: raw.enteredBy,
    enteredAt: raw.enteredAt,
    updatedAt: raw.updatedAt,
    createdAt: raw.createdAt,
  }
}

/** Reads the existing SME records. History is loaded with bounded concurrency, not a massive Promise.all. */
export async function listSmeMetrics(options: {
  activeProgramId: string | null | undefined
  isAllPrograms: boolean
  canAccessProgram: (programId: string) => boolean
  /** Operations staff only list their own company's SMEs (matches the old page and the applications rule). */
  companyCode?: string | null
}): Promise<SmeRow[]> {
  const constraints = options.companyCode ? [where('companyCode', '==', options.companyCode)] : []
  if (!options.isAllPrograms && options.activeProgramId) constraints.push(where('programId', '==', options.activeProgramId))
  const [participantsSnap, programsSnap] = await Promise.all([
    getDocs(query(collection(db, 'participants'), ...constraints)),
    getDocs(collection(db, 'programs')),
  ])
  const participants = participantsSnap.docs
    .map(d => ({ id: d.id, ...d.data() } as AnyDoc))
    .filter(p => !['inactive', 'exited', 'removed', 'discontinued'].includes(text(p.status).toLowerCase()))
    .filter(p => options.canAccessProgram(text(p.programId)))
  const programs = new Map(programsSnap.docs.map(d => [d.id, text(d.data().name, text(d.data().programName, text(d.data().title, 'Unassigned')))]))
  const profileIds = [...new Set(participants.map(p => text(p.businessProfileId, text(p.id))).filter(Boolean))]
  const applicationIds = [...new Set(participants.map(p => text(p.applicationId)).filter(Boolean))]
  const profiles = new Map<string, AnyDoc>()
  const applications = new Map<string, AnyDoc>()
  await Promise.all([
    ...chunks(profileIds, 10).map(async ids => {
      const snap = await getDocs(query(collection(db, 'businessProfiles'), where(documentId(), 'in', ids))).catch(() => null)
      if (!snap) return
      snap.docs.forEach(d => profiles.set(d.id, d.data() as AnyDoc))
    }),
    ...chunks(applicationIds, 10).map(async ids => {
      const snap = await getDocs(query(collection(db, 'applications'), where(documentId(), 'in', ids))).catch(() => null)
      if (!snap) return
      snap.docs.forEach(d => applications.set(d.id, d.data() as AnyDoc))
    }),
  ])

  const rows: SmeRow[] = participants.map(p => {
    const profile = profiles.get(text(p.businessProfileId, text(p.id))) || {}
    const application = applications.get(text(p.applicationId)) || {}
    const merged = { ...application, ...profile, ...p }
    const programId = text(p.programId, text(merged.programId))
    return {
      id: text(p.id),
      businessName: text(merged.businessName, text(merged.companyName, 'Unnamed SME')),
      programId,
      programName: programs.get(programId) || text(merged.programName, 'Unassigned'),
      sector: text(merged.sector, 'Unspecified'),
      gender: text(merged.gender, 'Unspecified'),
      province: text(merged.businessAddressProvince, text(merged.province, 'Unspecified')),
      beeLevel: text(merged.beeLevel, 'Unspecified'),
      acceptedAt: merged.acceptedAt,
      monthly: [],
    }
  })
  for (const batch of chunks(rows, 6)) {
    await Promise.all(batch.map(async row => {
      try {
        const snap = await getDocs(collection(db, 'monthlyPerformance', row.id, 'history'))
        row.monthly = snap.docs.map(d => toMonthly(d.id, d.data())).filter((r): r is MonthlyRecord => Boolean(r))
          .sort((a,b) => (monthToDate(b.month)?.valueOf() || 0) - (monthToDate(a.month)?.valueOf() || 0))
      } catch (error) {
        console.error('Unable to load SME reporting history', error)
        row.historyError = true
      }
    }))
  }
  return rows
}

export type SaveMonthlyInput = {
  participantId: string
  month: string
  values: Partial<Record<MetricField, number>>
  sections: MetricSection[]
  actorUid: string
  actorEmail: string
  revenueFiles?: File[]
  employeeFiles?: File[]
}

/** Writes ONLY selected sections; preserves older metrics and evidence in the month document. */
export async function saveAssistedMonthly(input: SaveMonthlyInput): Promise<MonthlyRecord> {
  if (!input.actorUid || !input.participantId || !monthToDate(input.month) || !input.sections.length) throw new Error('Missing reporting details.')
  const refMonth = doc(db, 'monthlyPerformance', input.participantId, 'history', input.month)
  const previous = await getDoc(refMonth)
  const existing = previous.exists() ? previous.data() : {}
  const sectionFields: Record<MetricSection, MetricField[]> = {
    revenue: ['revenue'], employees: ['headPermanent', 'headTemporary'], sales: ['orders', 'customers'],
    traffic: ['traffic'], networking: ['networking'],
  }
  const payload: Record<string, unknown> = {}
  for (const section of input.sections) {
    for (const field of sectionFields[section]) {
      const value = input.values[field]
      if (value === undefined || !Number.isFinite(value) || value < 0) throw new Error(`Enter a valid value for ${field}.`)
      payload[field] = value
    }
  }
  const upload = async (files: File[], category: string) => {
    const urls: string[] = []
    for (const file of files) {
      if (file.size > 15 * 1024 * 1024) throw new Error('Each attachment must be 15 MB or smaller.')
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `monthlyPerformance/${input.participantId}/${input.month}/${category}-${crypto.randomUUID()}-${safeName}`
      const fileRef = ref(storage, path)
      await uploadBytes(fileRef, file, { contentType: file.type || 'application/octet-stream' })
      urls.push(await getDownloadURL(fileRef))
    }
    return urls
  }
  const [revenueUrls, employeeUrls] = await Promise.all([
    upload(input.revenueFiles || [], 'revenue'), upload(input.employeeFiles || [], 'employee'),
  ])
  const oldSections: MetricSection[] = Array.isArray(existing.reportedSections) ? existing.reportedSections : []
  await setDoc(refMonth, {
    ...payload,
    month: input.month,
    reportedSections: [...new Set([...oldSections, ...input.sections])],
    revenueProofUrls: [...(Array.isArray(existing.revenueProofUrls) ? existing.revenueProofUrls : []), ...revenueUrls],
    employeeProofUrls: [...(Array.isArray(existing.employeeProofUrls) ? existing.employeeProofUrls : []), ...employeeUrls],
    reportingSource: 'operations',
    verificationStatus: 'awaiting_confirmation',
    enteredBy: input.actorUid,
    enteredByEmail: input.actorEmail,
    enteredAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(!previous.exists() ? { createdAt: serverTimestamp() } : {}),
  }, { merge: true })
  await setDoc(doc(db, 'monthlyPerformance', input.participantId), {
    participantId: input.participantId, updatedAt: serverTimestamp(),
  }, { merge: true })
  const updated = await getDoc(refMonth)
  return toMonthly(input.month, updated.data() || {}) as MonthlyRecord
}

export async function listSmeOpportunities(participantId: string): Promise<SmeOpportunity[]> {
  const snap = await getDocs(collection(db, 'smeOpportunities', participantId, 'items'))
  return snap.docs.map(d => ({
    id: d.id,
    title: text(d.data().title), buyer: text(d.data().buyer),
    type: d.data().type as OpportunityType, stage: d.data().stage as OpportunityStage,
    value: num(d.data().value), submittedAt: text(d.data().submittedAt),
    closingAt: text(d.data().closingAt), notes: text(d.data().notes),
    reportingSource: d.data().reportingSource,
    verificationStatus: d.data().verificationStatus,
  }))
}

export async function saveAssistedOpportunity(input: {
  participantId: string
  opportunityId?: string
  actorUid: string
  title: string
  buyer: string
  type: OpportunityType
  stage: OpportunityStage
  value?: number
  submittedAt?: string
  closingAt?: string
  notes?: string
}) {
  if (!input.title.trim() || !input.actorUid) throw new Error('Opportunity name is required.')
  if (input.value !== undefined && (!Number.isFinite(input.value) || input.value < 0)) throw new Error('Enter a valid opportunity value.')
  const destination = input.opportunityId
    ? doc(db, 'smeOpportunities', input.participantId, 'items', input.opportunityId)
    : doc(collection(db, 'smeOpportunities', input.participantId, 'items'))
  await setDoc(destination, {
    title: input.title.trim(), buyer: input.buyer.trim(), type: input.type, stage: input.stage,
    value: input.value ?? null, submittedAt: input.submittedAt || null, closingAt: input.closingAt || null,
    notes: input.notes?.trim() || '',
    reportingSource: 'operations', verificationStatus: 'awaiting_confirmation',
    enteredBy: input.actorUid, updatedAt: serverTimestamp(),
    ...(!input.opportunityId ? { createdAt: serverTimestamp() } : {}),
  }, { merge: true })
  return destination.id
}
