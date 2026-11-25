import type { Firestore } from 'firebase-admin/firestore'
import type { AlertParts } from './alertMessages.js'
import { SIGNUP_LINKS } from './prospects.js'
import { whatsappNumbers } from './smeCheckbacks.js'

/*
 * Team events (teamEvents, see src/types/teamEvents.ts): an expo, workshop or visit that people from the team go to.
 * The browser saves the event; this module does what the browser must not:
 *   - when the team is looking for SMEs there, gives each person going their own sign-up code (a prospectSignupLinks
 *     doc they own, so whoever signs up with it lands in Prospects with them following up), and closes the codes of
 *     people taken off the event, or of a cancelled event, or once recruiting is switched off;
 *   - messages each person going on WhatsApp when asked: the event, and their code when there is one. Only team
 *     members are messaged; the people met at the event sign up by scanning, which is how they consent.
 */

export const TEAM_EVENTS = 'teamEvents'
const DAY = 24 * 3600 * 1000

type Data = Record<string, unknown>
type Code = { linkId?: string, sentAt?: string, sendProblem?: 'no_number' | 'failed' }

export type TeamEventDeps = {
  appUrl: string
  sendWhatsApp: (phone: string, text: string, parts: AlertParts) => Promise<boolean>
  now?: () => Date
}

const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const attendeesOf = (data: Data) => (Array.isArray(data.attendees) ? data.attendees : [])
  .map((row) => row as Data)
  .map((row) => ({ uid: clean(row.uid), name: clean(row.name) }))
  .filter((row) => row.uid && !row.uid.includes('/'))

/** Sign-ups stay open until the end of the day after the event. */
export const codesCloseAt = (endTime: string) => {
  const end = new Date(endTime)
  if (Number.isNaN(end.getTime())) return null
  return new Date(end.getTime() + DAY).toISOString()
}

const when = (startTime: string) => {
  const start = new Date(startTime)
  if (Number.isNaN(start.getTime())) return ''
  const options = { timeZone: 'Africa/Johannesburg' } as const
  return `${start.toLocaleDateString('en-GB', { ...options, weekday: 'short', day: 'numeric', month: 'short' })}, ${start.toLocaleTimeString('en-GB', { ...options, hour: '2-digit', minute: '2-digit' })}`
}

/** The WhatsApp message to one person going, as plain text and as the alert template's parts. */
export const eventMessage = (event: Data, person: { name: string }, codeUrl: string | null) => {
  const firstName = person.name.split(/\s+/)[0] || 'there'
  const title = clean(event.title) || 'an event'
  const venue = clean(event.venue)
  const date = when(clean(event.startTime))
  const lines = [
    `Hi ${firstName}, you're down for *${title}*${date ? ` on ${date}` : ''}${venue ? ` at ${venue}` : ''}.`,
    ...(codeUrl
      ? ['', 'You\'re looking for SMEs there, so here is your own sign-up code. Open it and show it at the stand:', codeUrl, '', 'Everyone who signs up with it is added to your follow-ups.']
      : []),
  ]
  const parts: AlertParts = {
    firstName,
    headline: codeUrl ? `your sign-up code for ${title}` : `${title} on the calendar`,
    items: [{ title, sme: codeUrl || venue || 'Team event', overdue: false, when: date }],
  }
  return { text: lines.join('\n'), parts }
}

/**
 * Brings one event's codes and messages up to date. Idempotent: run on every write, it only creates what is missing,
 * so its own write back to `codes` changes nothing the next time round.
 */
export async function syncTeamEvent(db: Firestore, eventId: string, before: Data | undefined, after: Data | undefined, deps: TeamEventDeps) {
  if (!after) return { changed: false }
  const now = (deps.now || (() => new Date()))()
  const at = now.toISOString()
  const companyCode = clean(after.companyCode)
  if (!companyCode) return { changed: false }

  const codes: Record<string, Code> = { ...((after.codes && typeof after.codes === 'object' ? after.codes : {}) as Record<string, Code>) }
  const attendees = attendeesOf(after)
  const going = new Set(attendees.map((row) => row.uid))
  const cancelled = Boolean(clean(after.cancelledAt))
  const recruiting = after.recruiting === true && !cancelled
  const closesAt = codesCloseAt(clean(after.endTime) || clean(after.startTime))
  const batch = db.batch()
  let writes = 0
  let codesChanged = false

  // Codes of people no longer going, or of an event no longer recruiting, are closed (kept, so their sign-ups still count).
  for (const [uid, code] of Object.entries(codes)) {
    if (!code.linkId || (recruiting && going.has(uid))) continue
    batch.update(db.collection(SIGNUP_LINKS).doc(code.linkId), { active: false, updatedAt: at, updatedBy: 'system' })
    writes += 1
  }

  if (recruiting) {
    const shared = {
      label: clean(after.title), programId: clean(after.programId) || null, programName: clean(after.programName) || null, closesAt,
    }
    for (const person of attendees) {
      const existing = codes[person.uid]?.linkId
      if (existing) {
        // Keep the code's label, programme and closing date in step with the event; reopen it if it was closed.
        batch.update(db.collection(SIGNUP_LINKS).doc(existing), { ...shared, active: true, updatedAt: at, updatedBy: 'system' })
        writes += 1
        continue
      }
      const ref = db.collection(SIGNUP_LINKS).doc()
      batch.set(ref, {
        companyCode, module: 'incubation', source: 'event', active: true, signups: 0, ...shared,
        ownerUid: person.uid, ownerName: person.name, eventId, createdAt: at, createdBy: 'system',
      })
      codes[person.uid] = { ...codes[person.uid], linkId: ref.id }
      codesChanged = true
      writes += 1
    }
  }

  // WhatsApp: everyone going who has not had the message yet, or everyone (or one person) again on "Resend".
  const resendAsked = clean(after.resendRequestedAt) !== '' && clean(after.resendRequestedAt) !== clean(before?.resendRequestedAt)
  const resendUid = clean(after.resendUid)
  const upcoming = new Date(clean(after.endTime) || clean(after.startTime)).getTime() >= now.getTime()
  if (after.notifyOnWhatsApp === true && !cancelled && upcoming) {
    for (const person of attendees) {
      const code = codes[person.uid] || {}
      const resend = resendAsked && (!resendUid || resendUid === person.uid)
      if (!resend && (code.sentAt || code.sendProblem)) continue
      const user = (await db.collection('users').doc(person.uid).get()).data() || {}
      const phone = whatsappNumbers(user)[0]
      if (!phone) {
        codes[person.uid] = { ...code, sendProblem: 'no_number' }
        codesChanged = true
        continue
      }
      const codeUrl = recruiting && code.linkId ? `${deps.appUrl}/p/${code.linkId}/qr` : null
      const message = eventMessage(after, { name: person.name || clean(user.name) }, codeUrl)
      const sent = await deps.sendWhatsApp(phone, message.text, message.parts).catch((error) => {
        console.warn('Team event WhatsApp failed', eventId, person.uid, error)
        return false
      })
      const rest = { ...code }
      delete rest.sendProblem
      codes[person.uid] = sent ? { ...rest, sentAt: at } : { ...rest, sendProblem: 'failed' }
      codesChanged = true
    }
  }

  if (codesChanged) {
    batch.update(db.collection(TEAM_EVENTS).doc(eventId), { codes })
    writes += 1
  }
  if (writes) await batch.commit()
  return { changed: codesChanged }
}
