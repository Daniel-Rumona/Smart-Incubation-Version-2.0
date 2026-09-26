import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'

/*
 * Daily overdue / near-due intervention digest for operations staff.
 *
 * For each company it finds assigned interventions that are not finished and are either overdue or due
 * within `dueSoonDays`, then tells every operations-side user (operations, project admin, project
 * manager) about the ones in their scope over three channels:
 *   - in the system: a `staffNotifications` document (shown by the bell in the app's top bar)
 *   - email: a `mail` document (delivered by the Trigger Email extension), unless the address is suppressed
 *   - WhatsApp: a message to the user's WhatsApp-marked number
 * One digest per user per day: the `staffNotifications/{uid}_deadline_{date}` document is created with
 * `create()`, so a second run the same day (a retry, or the manual trigger) sends nothing unless `force`.
 *
 * The Firestore / mail / WhatsApp specifics are injected so this file has no dependency on index.ts.
 */

const OPERATIONS_SIDE_ROLES = ['operations', 'projectadmin', 'projectmanager']
const MAX_ITEMS_IN_DIGEST = 8

export type DigestTemplate = { subject: string, text: string, html: string }

export type DigestDeps = {
  db: Firestore
  appUrl: string
  sendEmail: (to: string, template: DigestTemplate) => Promise<'queued' | 'suppressed' | 'invalid'>
  sendWhatsApp: (phone: string, text: string) => Promise<boolean>
  now?: Date
  dueSoonDays?: number
  dryRun?: boolean
  /** Send again even if today's digest already went out. */
  force?: boolean
  /** Only this company (used when a non-platform admin triggers the run manually). */
  companyCode?: string
}

type Item = {
  id: string
  title: string
  sme: string
  assignee: string
  programId: string
  dueDate: Date
  daysLate: number
  level: 'overdue' | 'due_soon'
}

export type DigestResult = {
  companies: number
  recipients: number
  notified: number
  skippedAlreadySent: number
  overdueItems: number
  dueSoonItems: number
  dryRun: boolean
}

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()
const escapeHtml = (value: string) => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const dayKey = (date: Date) => date.toISOString().slice(0, 10)
const startOfDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
const toDate = (value: unknown): Date | null => {
  if (!value) return null
  if (value instanceof Timestamp) return value.toDate()
  if (value instanceof Date) return value
  if (typeof value === 'object' && 'toDate' in (value as object) && typeof (value as { toDate: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate()
  const parsed = new Date(String(value))
  return Number.isNaN(+parsed) ? null : parsed
}

const isFinished = (data: Record<string, unknown>) =>
  ['completed', 'cancelled', 'canceled'].includes(normalize(data.status))
  || normalize(data.completionStatus) === 'completed'
  || (normalize(data.assigneeCompletionStatus) === 'done' && normalize(data.participantCompletionStatus) === 'confirmed')
  || Number(data.progress) >= 100
  || normalize(data.assigneeStatus) === 'declined'
  || normalize(data.participantStatus) === 'declined'

const dueLabel = (item: Item) =>
  item.level === 'overdue'
    ? `${item.daysLate} day${item.daysLate === 1 ? '' : 's'} overdue`
    : item.daysLate === 0 ? 'due today' : `due in ${Math.abs(item.daysLate)} day${Math.abs(item.daysLate) === 1 ? '' : 's'}`

const countsLine = (overdue: number, dueSoon: number) => {
  const parts = []
  if (overdue) parts.push(`${overdue} overdue`)
  if (dueSoon) parts.push(`${dueSoon} due soon`)
  return parts.join(' and ')
}

const buildEmail = (name: string, overdue: number, dueSoon: number, items: Item[], link: string): DigestTemplate => {
  const firstName = String(name || 'there').trim().split(/\s+/)[0] || 'there'
  const subject = `Intervention deadlines: ${countsLine(overdue, dueSoon)}`
  const text = [
    `Hello ${firstName},`,
    '',
    `There ${overdue + dueSoon === 1 ? 'is' : 'are'} ${countsLine(overdue, dueSoon)} intervention${overdue + dueSoon === 1 ? '' : 's'} in your programmes.`,
    '',
    ...items.map(item => `- ${item.title} (${item.sme}), assigned to ${item.assignee}: ${dueLabel(item)}`),
    '',
    `Review them here: ${link}`,
    '',
    'Kind regards,',
    'Smart Incubation Team',
  ].join('\n')
  const rows = items.map(item => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;"><strong>${escapeHtml(item.title)}</strong><br /><span style="color:#6b7280;font-size:12px;">${escapeHtml(item.sme)}</span></td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.assignee)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:${item.level === 'overdue' ? '#dc2626' : '#b45309'};font-weight:600;">${escapeHtml(dueLabel(item))}</td>
    </tr>`).join('')
  const html = `
    <p>Hello ${escapeHtml(firstName)},</p>
    <p>There ${overdue + dueSoon === 1 ? 'is' : 'are'} <strong>${escapeHtml(countsLine(overdue, dueSoon))}</strong> intervention${overdue + dueSoon === 1 ? '' : 's'} in your programmes.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <thead><tr style="text-align:left;color:#6b7280;font-size:12px;"><th style="padding:6px 10px;">Intervention</th><th style="padding:6px 10px;">Assigned to</th><th style="padding:6px 10px;">Deadline</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p><a href="${escapeHtml(link)}" style="display:inline-block;margin:14px 0 4px;padding:12px 18px;border-radius:10px;background:#6d5dfb;color:#ffffff;font-weight:700;text-decoration:none;">Review interventions</a></p>
    <p style="margin-top:22px;">Kind regards,<br /><strong>Smart Incubation Team</strong></p>`
  return { subject, text, html }
}

const whatsappNumbers = (user: Record<string, unknown>) => {
  const listed = Array.isArray(user.whatsappPhoneNumbers) ? user.whatsappPhoneNumbers.map(String) : []
  if (listed.length) return listed
  return user.phoneIsWhatsApp === true && user.phone ? [String(user.phone)] : []
}

export async function runInterventionDeadlineDigest(deps: DigestDeps): Promise<DigestResult> {
  const { db } = deps
  const now = deps.now || new Date()
  const today = startOfDay(now)
  const dueSoonDays = deps.dueSoonDays ?? 3
  const cutoff = new Date(today.getTime() + (dueSoonDays + 1) * 86400000 - 1)

  const snapshot = await db.collection('assignedInterventions').where('dueDate', '<=', Timestamp.fromDate(cutoff)).get()

  const byCompany = new Map<string, Item[]>()
  snapshot.docs.forEach(row => {
    const data = row.data()
    if (isFinished(data)) return
    const dueDate = toDate(data.dueDate)
    const companyCode = String(data.companyCode || '').trim()
    if (!dueDate || !companyCode) return
    if (deps.companyCode && companyCode !== deps.companyCode) return
    const days = Math.round((today.getTime() - startOfDay(dueDate).getTime()) / 86400000)
    const item: Item = {
      id: row.id,
      title: String(data.interventionTitle || 'Intervention'),
      sme: String(data.businessName || data.participantName || 'SME'),
      assignee: String(data.assigneeName || 'Unassigned'),
      programId: String(data.programId || ''),
      dueDate,
      daysLate: days,
      level: days > 0 ? 'overdue' : 'due_soon',
    }
    byCompany.set(companyCode, [...(byCompany.get(companyCode) || []), item])
  })

  const result: DigestResult = { companies: byCompany.size, recipients: 0, notified: 0, skippedAlreadySent: 0, overdueItems: 0, dueSoonItems: 0, dryRun: Boolean(deps.dryRun) }

  for (const [companyCode, companyItems] of byCompany) {
    const usersSnapshot = await db.collection('users').where('companyCode', '==', companyCode).get()
    const recipients = usersSnapshot.docs.filter(row => {
      const data = row.data()
      return OPERATIONS_SIDE_ROLES.includes(normalize(data.role)) && normalize(data.status || 'active') !== 'inactive' && data.active !== false
    })

    for (const recipient of recipients) {
      const user = recipient.data()
      const restricted = Array.isArray(user.assignedProgramIds) ? user.assignedProgramIds.map(String).filter(Boolean) : []
      const items = companyItems
        .filter(item => !restricted.length || restricted.includes(item.programId))
        .sort((left, right) => (left.level === right.level ? right.daysLate - left.daysLate : left.level === 'overdue' ? -1 : 1))
      if (!items.length) continue

      const overdue = items.filter(item => item.level === 'overdue').length
      const dueSoon = items.length - overdue
      result.recipients += 1
      result.overdueItems += overdue
      result.dueSoonItems += dueSoon
      if (deps.dryRun) continue

      const notificationRef = db.collection('staffNotifications').doc(`${recipient.id}_deadline_${dayKey(now)}`)
      const top = items.slice(0, MAX_ITEMS_IN_DIGEST)
      const link = `${deps.appUrl}/operations/interventions/monitoring`
      const base = {
        recipientUid: recipient.id,
        companyCode,
        type: 'intervention_deadlines',
        title: `${countsLine(overdue, dueSoon)} intervention${items.length === 1 ? '' : 's'}`,
        body: top.slice(0, 3).map(item => `${item.title} (${item.sme}): ${dueLabel(item)}`).join('\n'),
        counts: { overdue, dueSoon },
        items: top.map(item => ({ id: item.id, title: item.title, sme: item.sme, assignee: item.assignee, level: item.level, daysLate: item.daysLate, dueDate: item.dueDate.toISOString() })),
        link: '/operations/interventions/monitoring',
        readAt: null,
        channels: { inApp: 'created' } as Record<string, string>,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }

      try {
        if (deps.force) await notificationRef.set(base)
        else await notificationRef.create(base)
      } catch (error) {
        if ((error as { code?: number }).code === 6) {
          result.skippedAlreadySent += 1
          continue
        }
        throw error
      }

      const channels: Record<string, string> = { inApp: 'created' }

      const email = normalize(user.email)
      if (email) {
        try {
          channels.email = await deps.sendEmail(email, buildEmail(String(user.name || user.displayName || email), overdue, dueSoon, top, link))
        } catch {
          channels.email = 'failed'
        }
      } else {
        channels.email = 'no_address'
      }

      const numbers = whatsappNumbers(user)
      if (numbers.length) {
        const text = `Smart Incubation: ${countsLine(overdue, dueSoon)} intervention${items.length === 1 ? '' : 's'} need attention.\n${top.slice(0, 3).map(item => `• ${item.title} (${item.sme}): ${dueLabel(item)}`).join('\n')}\n${link}`
        try {
          channels.whatsapp = (await deps.sendWhatsApp(numbers[0], text)) ? 'sent' : 'failed'
        } catch {
          channels.whatsapp = 'failed'
        }
      } else {
        channels.whatsapp = 'no_number'
      }

      await notificationRef.set({ channels, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      result.notified += 1
    }
  }

  return result
}
