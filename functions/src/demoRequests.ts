import { createHash } from 'node:crypto'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

/**
 * "Book a demo" from the public landing page. Anyone can submit, so the input is checked strictly, a hidden
 * honeypot field catches simple bots, and each IP may send only a few requests an hour. A good request is
 * saved to demoRequests (no client access; admin SDK only) and emailed to the sales contacts.
 */

export const DEMO_REQUEST_TO = 'daniel@quantilytix.co.za'
export const DEMO_REQUEST_CC = 'prince@quantilytix.co.za'

const MAX_PER_HOUR = 5

export const DEMO_ROLES = {
  incubator: 'Incubator / ESD programme team',
  funder: 'Funder or corporate sponsor',
  sme: 'SME',
  consultant: 'Consultant or service provider',
  other: 'Government / other',
} as const

export const DEMO_SIZES = {
  small: 'Under 20 SMEs',
  medium: '20 to 100 SMEs',
  large: 'More than 100 SMEs',
} as const

export type DemoRole = keyof typeof DEMO_ROLES
export type DemoSize = keyof typeof DEMO_SIZES

export type DemoRequest = {
  role: DemoRole
  name: string
  email: string
  organisation: string
  size: DemoSize | null
  phone: string
  availability: string
  interest: string
  language: string
}

export class DemoRequestError extends Error {
  constructor(public code: 'invalid' | 'too_many', message: string) {
    super(message)
  }
}

const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Checks and tidies what the form sent. Returns null for the honeypot (a bot): accept silently, send nothing. */
export const parseDemoRequest = (input: unknown): DemoRequest | null => {
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  if (text(data.website, 200)) return null

  const role = text(data.role, 20) as DemoRole
  if (!(role in DEMO_ROLES)) throw new DemoRequestError('invalid', 'Choose the option that best describes you.')
  const name = text(data.name, 120)
  if (name.length < 2) throw new DemoRequestError('invalid', 'Enter your name.')
  const email = text(data.email, 200).toLowerCase()
  if (!EMAIL.test(email)) throw new DemoRequestError('invalid', 'Enter a valid email address.')
  const organisation = text(data.organisation, 160)
  if (role !== 'sme' && organisation.length < 2) throw new DemoRequestError('invalid', 'Enter your organisation.')
  const sizeValue = text(data.size, 20) as DemoSize
  const size = (role === 'incubator' || role === 'funder') && sizeValue in DEMO_SIZES ? sizeValue : null

  const phone = text(data.phone, 40)
  if (phone && !/^[+()\d\s-]{7,40}$/.test(phone)) throw new DemoRequestError('invalid', 'Enter a valid phone number, or leave it empty.')

  return { role, name, email, organisation, size, phone, availability: text(data.availability, 160), interest: text(data.interest, 500), language: text(data.language, 8) || 'en' }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string))

export const demoRequestEmail = (request: DemoRequest) => {
  const rows: Array<[string, string]> = [
    ['Role', DEMO_ROLES[request.role]],
    ['Name', request.name],
    ['Email', request.email],
    ['Organisation', request.organisation || '—'],
    ...(request.size ? [['Programme size', DEMO_SIZES[request.size]] as [string, string]] : []),
    ['Phone', request.phone || '—'],
    ['Wants to see', request.interest || '—'],
    ['Preferred time', request.availability || '—'],
    ['Site language', request.language === 'zu' ? 'isiZulu' : 'English'],
  ]
  const who = request.organisation ? `${request.name} (${request.organisation})` : request.name
  return {
    subject: `Demo request: ${DEMO_ROLES[request.role]} · ${who}`,
    text: [`New Smart Incubation demo request.`, '', ...rows.map(([label, value]) => `${label}: ${value}`), '', `Reply to ${request.email} to arrange it.`].join('\n'),
    html: `
      <p>New Smart Incubation demo request.</p>
      <table cellpadding="6" style="border-collapse:collapse;font-size:14px;">
        ${rows.map(([label, value]) => `<tr><td style="color:#6b7280;">${escapeHtml(label)}</td><td><strong>${escapeHtml(value)}</strong></td></tr>`).join('')}
      </table>
      <p style="margin-top:16px;">Reply to <a href="mailto:${escapeHtml(request.email)}">${escapeHtml(request.email)}</a> to arrange it.</p>
    `,
  }
}

/** At most MAX_PER_HOUR requests per IP per rolling hour. The IP is stored only as a hash. */
const reserveSlot = async (ip: string) => {
  const db = getFirestore()
  const key = createHash('sha256').update(`demo:${ip || 'unknown'}`).digest('hex').slice(0, 40)
  const ref = db.collection('demoRequestThrottle').doc(key)
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const hourAgo = Date.now() - 60 * 60 * 1000
    const recent = ((snapshot.data()?.sentAt as number[] | undefined) || []).filter((at) => at > hourAgo)
    if (recent.length >= MAX_PER_HOUR) return false
    transaction.set(ref, { sentAt: [...recent, Date.now()], updatedAt: FieldValue.serverTimestamp() })
    return true
  })
}

export const submitDemoRequestHandler = async (input: unknown, ip: string) => {
  const request = parseDemoRequest(input)
  if (!request) return { ok: true }
  if (!(await reserveSlot(ip))) throw new DemoRequestError('too_many', 'Too many requests from this connection. Please try again later or email us directly.')

  const db = getFirestore()
  const saved = await db.collection('demoRequests').add({ ...request, status: 'new', createdAt: FieldValue.serverTimestamp() })
  await db.collection('mail').add({
    to: [DEMO_REQUEST_TO],
    cc: [DEMO_REQUEST_CC],
    replyTo: request.email,
    message: demoRequestEmail(request),
    source: 'demo_request',
    demoRequestId: saved.id,
    createdAt: FieldValue.serverTimestamp(),
  })
  return { ok: true }
}
