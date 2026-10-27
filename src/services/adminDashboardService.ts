import { collection, getDocs } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'

export type AdminDashboardError = {
  id: string
  source: string
  message: string
  createdAt?: Date
}

/** One point per calendar month, oldest first; `month` is the first day of that month. */
export type AdminDashboardMonth = {
  month: Date
  newUsers: number
  totalUsers: number
  activeUsers: number
  companies: number
  applications: number
  errors: number
}

export type AdminApplicationStatus = 'pending' | 'accepted' | 'rejected' | 'other'

export type AdminDashboardSummary = {
  users: number
  activeUsers: number
  companies: number
  applications: number
  errors: number
  recentErrors: AdminDashboardError[]
  previous: Pick<AdminDashboardSummary, 'users' | 'activeUsers' | 'companies' | 'applications' | 'errors'>
  /** The 12 months up to the end of the selected range. */
  months: AdminDashboardMonth[]
  usersByRole: Record<string, number>
  applicationsByStatus: Record<AdminApplicationStatus, number>
  /** Sign-in sessions per day inside the selected range (capped to its last 31 days). */
  dailySessions: Array<{ day: Date; sessions: number; users: number }>
}

const toDate = (value: unknown) => {
  if (value instanceof Date) return value
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate() as Date
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }
  return undefined
}

const inRange = (value: unknown, range?: [Date, Date]) => {
  if (!range) return true
  const date = toDate(value)
  return !!date && date >= range[0] && date <= range[1]
}
const beforeEnd = (value: unknown, end?: Date) => !end || !toDate(value) || toDate(value)! <= end

const statusBucket = (value: unknown): AdminApplicationStatus => {
  const status = String(value || 'pending').toLowerCase()
  if (['accepted', 'approved', 'active', 'enrolled', 'completed'].includes(status)) return 'accepted'
  if (['rejected', 'declined', 'withdrawn', 'removed'].includes(status)) return 'rejected'
  if (['pending', 'submitted', 'under_review', 'in_review', 'review', 'shortlisted', 'draft'].includes(status)) return 'pending'
  return 'other'
}

/** `companyCode` narrows every figure to one company; leave it out for the whole platform. */
export const getAdminDashboardSummary = async (user: FullIdentity, range?: [Date, Date], previousRange?: [Date, Date], companyCode?: string): Promise<AdminDashboardSummary> => {
  if (user.role !== 'systemadmin') throw new Error('forbidden')
  const db = getFirebaseDb()
  const [allUsers, allApplications, failedLogs, allSessions] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'applications')),
    getDocs(collection(db, 'emailDeliveryLogs')),
    // Activity is a nice-to-have: the rest of the overview still loads without it.
    getDocs(collection(db, 'usageSessions')).catch(() => undefined),
  ])
  // Users and applications carry their company; sessions and email logs don't, so they follow the company's own
  // users (by uid and by recipient address).
  const company = companyCode?.trim()
  const ofCompany = (data: { companyCode?: unknown }) => !company || String(data.companyCode || '').trim() === company
  const users = { docs: allUsers.docs.filter((record) => ofCompany(record.data())) }
  const applications = { docs: allApplications.docs.filter((record) => ofCompany(record.data())) }
  const companyUids = new Set(users.docs.flatMap((record) => [record.id, String(record.data().uid || '')]).filter(Boolean))
  const companyEmails = new Set(users.docs.map((record) => String(record.data().email || '').trim().toLowerCase()).filter(Boolean))
  const sessions = allSessions && { docs: allSessions.docs.filter((record) => !company || companyUids.has(String(record.data().uid || record.id))) }
  const sentToCompany = (data: Record<string, unknown>) => {
    if (!company) return true
    return [data.recipients, data.to, data.email].flat().some((address) => typeof address === 'string' && companyEmails.has(address.trim().toLowerCase()))
  }
  const applicationDate = (record: (typeof applications.docs)[number]) => record.data().createdAt || record.data().submittedAt
  const companiesBy = (end?: Date) => {
    const codes = new Set<string>()
    users.docs.filter((record) => beforeEnd(record.data().createdAt, end)).forEach((record) => {
      const code = String(record.data().companyCode || '').trim()
      if (code) codes.add(code)
    })
    applications.docs.filter((record) => beforeEnd(applicationDate(record), end)).forEach((record) => {
      const code = String(record.data().companyCode || '').trim()
      if (code) codes.add(code)
    })
    return codes.size
  }
  const currentUsers = users.docs.filter((record) => beforeEnd(record.data().createdAt, range?.[1]))
  const previousUsers = users.docs.filter((record) => beforeEnd(record.data().createdAt, previousRange?.[1]))
  const currentApplications = applications.docs.filter((record) => inRange(applicationDate(record), range))
  const previousApplications = applications.docs.filter((record) => inRange(applicationDate(record), previousRange))
  const failed = failedLogs.docs.filter((record) => record.data().status === 'failed' && sentToCompany(record.data()))
  const currentErrors = failed.filter((record) => inRange(record.data().createdAt, range))
  const previousErrors = failed.filter((record) => inRange(record.data().createdAt, previousRange))
  const active = (record: (typeof users.docs)[number]) => record.data().status !== 'inactive' && record.data().status !== 'deleted' && record.data().active !== false

  const rangeEnd = range?.[1] || new Date()
  const months = Array.from({ length: 12 }, (_, index) => {
    const start = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth() - 11 + index, 1)
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999)
    const monthRange: [Date, Date] = [start, end]
    const usersByEnd = users.docs.filter((record) => beforeEnd(record.data().createdAt, end))
    return {
      month: start,
      newUsers: users.docs.filter((record) => inRange(record.data().createdAt, monthRange)).length,
      totalUsers: usersByEnd.length,
      activeUsers: usersByEnd.filter(active).length,
      companies: companiesBy(end),
      applications: applications.docs.filter((record) => inRange(applicationDate(record), monthRange)).length,
      errors: failed.filter((record) => inRange(record.data().createdAt, monthRange)).length,
    }
  })

  const usersByRole: Record<string, number> = {}
  currentUsers.filter(active).forEach((record) => {
    const role = String(record.data().role || 'unknown')
    usersByRole[role] = (usersByRole[role] || 0) + 1
  })

  const applicationsByStatus: Record<AdminApplicationStatus, number> = { pending: 0, accepted: 0, rejected: 0, other: 0 }
  currentApplications.forEach((record) => { applicationsByStatus[statusBucket(record.data().applicationStatus || record.data().status)] += 1 })

  const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
  const firstDay = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate() - 30)
  const rangeStart = range?.[0] && range[0] > firstDay ? new Date(range[0].getFullYear(), range[0].getMonth(), range[0].getDate()) : firstDay
  const days = new Map<string, { day: Date; sessions: number; uids: Set<string> }>()
  for (const day = new Date(rangeStart); day <= rangeEnd; day.setDate(day.getDate() + 1)) {
    days.set(dayKey(day), { day: new Date(day), sessions: 0, uids: new Set() })
  }
  sessions?.docs.forEach((record) => {
    const startedAt = toDate(record.data().startedAt)
    const bucket = startedAt && days.get(dayKey(startedAt))
    if (!bucket) return
    bucket.sessions += 1
    bucket.uids.add(String(record.data().uid || record.id))
  })

  return {
    users: currentUsers.length,
    activeUsers: currentUsers.filter(active).length,
    companies: companiesBy(range?.[1]),
    applications: currentApplications.length,
    errors: currentErrors.length,
    previous: {
      users: previousUsers.length,
      activeUsers: previousUsers.filter(active).length,
      companies: companiesBy(previousRange?.[1]),
      applications: previousApplications.length,
      errors: previousErrors.length,
    },
    months,
    usersByRole,
    applicationsByStatus,
    dailySessions: [...days.values()].map(({ day, sessions: count, uids }) => ({ day, sessions: count, users: uids.size })),
    recentErrors: failed.map((record) => ({
      id: record.id,
      source: String(record.data().source || 'email'),
      message: String(record.data().error || 'Unknown delivery error'),
      createdAt: toDate(record.data().createdAt),
    })).sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)).slice(0, 20),
  }
}
