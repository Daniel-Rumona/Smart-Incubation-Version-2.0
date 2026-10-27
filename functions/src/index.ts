import cors from 'cors'
import nodemailer from 'nodemailer'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore'
import { HttpsError, onCall, onRequest, type Request } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { runInterventionDeadlineDigest, type DigestDeps } from './deadlineDigest.js'
import { runFollowUpReminders } from './followUps.js'
import { acceptPlan, MarketplaceError, notifyChange, nudgeUnanswered, type MarketplaceDeps } from './marketplace.js'
import { AvailableWorkError, claimAvailableWork, listAvailableWork } from './availableWork.js'
import { runSmeCheckbackAsks } from './smeCheckbacks.js'
import { DirectorSetupError, completeDirectorSetup } from './directorSetup.js'
import { JoinError, buildConfirmedSetPlan, enrolInDirectProgram, forcedProgramInterventions, getProgramLinkInfo, joinProgram, type JoinInput } from './programJoin.js'
import {
  processWhatsAppInboundEvent,
  processWhatsAppMessageStatusEvent,
  sendSmeCheckbackTemplate,
  sendWhatsAppAlert,
  whatsappWebhookHandler,
  whatsappDispatchHandler,
} from './whatsappBot.js'

initializeApp()

export const whatsappWebhook = onRequest({ region: 'us-central1' }, whatsappWebhookHandler)

export const whatsappDispatch = onRequest({ region: 'us-central1' }, whatsappDispatchHandler)

export const processWhatsAppInbound = onDocumentCreated(
  {
    document: 'whatsappInboundEvents/{eventId}',
    region: 'us-central1',
    retry: true,
    secrets: [
      'LPH_WHATSAPP_GATEWAY_SECRET',
      'LPH_WHATSAPP_ROUTER_SECRET',
      // Shared with the Smart Incubation ai-backend (its WHATSAPP_ROUTER_SECRET). Without it every
      // QTX message that needs the AI backend fails.
      'QTX_WHATSAPP_ROUTER_SECRET',
    ],
  },
  async event => {
    if (!event.data) return

    await processWhatsAppInboundEvent(event.params.eventId)
  },
)

export const processWhatsAppMessageStatus = onDocumentCreated(
  {
    document: 'whatsappMessageStatusEvents/{eventId}',
    region: 'us-central1',
    retry: true,
  },
  async event => {
    if (!event.data) return
    await processWhatsAppMessageStatusEvent(event.params.eventId)
  },
)

const region = 'us-central1'
const corsHandler = cors({ origin: true })
const defaultAiBaseUrl = 'https://yoursdvniel-smart-incubation.hf.space'

type MailRecord = {
  to?: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  message?: {
    from?: string
    subject?: string
    text?: string
    html?: string
  }
  source?: string
}

type PlatformUserPayload = {
  email?: string
  name?: string
  role?: string
  jobTitle?: string | null
  assignedBranch?: string | null
  assignedProgramIds?: string[]
  assignedPrograms?: unknown[]
  companyCode?: string
  permissions?: string[]
  sendEmail?: boolean
  sendResetLink?: boolean
  allowExisting?: boolean
  phone?: string | null
  alternativePhone?: string | null
  phoneIsWhatsApp?: boolean
  alternativePhoneIsWhatsApp?: boolean
  phoneProvider?: string | null
}

type DeleteUserPayload = {
  uid?: string
  email?: string
  reason?: string
}

type UpdateUserPayload = {
  uid?: string
  /** Programmes the person is linked to; empty = all the company's. Not sent = unchanged. */
  assignedProgramIds?: string[]
  email?: string
  name?: string
  role?: string
  status?: string
  companyCode?: string
  permissions?: string[] | null
  phone?: string | null
  alternativePhone?: string | null
  phoneIsWhatsApp?: boolean
  alternativePhoneIsWhatsApp?: boolean
  phoneProvider?: string | null
}

type OrphanCleanupPayload = {
  dryRun?: boolean
  confirmation?: string
}

type OrphanUserSummary = {
  id: string
  email: string
  name: string
  role: string
  companyCode: string
}

function normalizeWhatsAppPhone(value: unknown) {
  return String(value || '').replace(/[^0-9]/g, '')
}

function whatsappNumbersFromPayload(payload: {
  phone?: string | null
  alternativePhone?: string | null
  phoneIsWhatsApp?: boolean
  alternativePhoneIsWhatsApp?: boolean
}) {
  return [
    payload.phoneIsWhatsApp ? normalizeWhatsAppPhone(payload.phone) : '',
    payload.alternativePhoneIsWhatsApp ? normalizeWhatsAppPhone(payload.alternativePhone) : '',
  ].filter((value, index, values) => value.length >= 8 && values.indexOf(value) === index)
}

type ParticipantAccountPayload = {
  email?: string
  participantName?: string
  businessName?: string
  phone?: string
  programId?: string
  programName?: string
  sector?: string
  stage?: string
  province?: string
  beeLevel?: string
  onboardingAnswers?: Record<string, string>
}

type ComplianceTimeline = {
  participantId?: string
  programId?: string | null
  branchId?: string | null
  key?: string
  type?: string
  fileName?: string | null
  url?: string | null
  issueDate?: string | null
  expiryDate?: string | null
  group?: string
  currentStatus?: string
  currentFile?: {
    url?: string | null
    fileName?: string | null
    issueDate?: string | null
    expiryDate?: string | null
    uploadedAt?: unknown
  } | null
}

type RequiredComplianceDoc = {
  id?: string
  key?: string
  title?: string
  type?: string
  group?: string
  requiredAt?: 'registration' | 'program'
  hasExpiry?: boolean
  expiryMonths?: number | null
  presetId?: string
}

type ComplianceReminderRecipient = {
  email: string
  name?: string
  firstName?: string
  participantId?: string
  participantName?: string
  programId?: string | null
  programName?: string | null
  documents: string[]
}

type ComplianceReminderPayload = {
  programId?: string | null
  programName?: string | null
  recipients?: ComplianceReminderRecipient[]
  source?: string
}

type ComplianceDocumentReminderPayload = {
  participantId?: string
  participantIds?: string[]
  programId?: string | null
  programName?: string | null
  includePending?: boolean
  source?: string
}

type InterventionBottleneckReminderItem = {
  assignedInterventionId?: string
  participantId?: string
  participantName?: string
  interventionId?: string
  interventionTitle?: string
  dueDate?: string | null
  status?: string
  urgency?: string
  urgencyLabel?: string
  assigneeId?: string
  assigneeRole?: string
  assigneeStatus?: string
  participantStatus?: string
  completionStatus?: string
  progress?: number
}

type InterventionBottleneckReminderRecipient = {
  email?: string
  name?: string
  role?: 'assignee' | 'beneficiary' | 'unknown'
  departmentName?: string
  stageLabel?: string
  overdueCount?: number
  totalCount?: number
  items?: InterventionBottleneckReminderItem[]
}

type InterventionBottleneckReminderPayload = {
  source?: string
  departmentId?: string
  departmentName?: string
  stage?: string
  stageLabel?: string
  responsibleRole?: 'assignee' | 'beneficiary' | 'unknown'
  recipients?: InterventionBottleneckReminderRecipient[]
}

type JsonHttpResponse = {
  status: (code: number) => {
    json: (body: unknown) => void
  }
}

function normalizeRecipients(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function jsonResponse(response: JsonHttpResponse, status: number, body: unknown) {
  response.status(status).json(body)
}

function env(name: string, fallback = '') {
  return process.env[name] || fallback
}

function getTransporter() {
  const port = Number(env('SMTP_PORT', '587'))
  const host = env('SMTP_HOST')
  const user = env('SMTP_USER')
  const pass = env('SMTP_PASS')
  const from = env('MAIL_FROM')

  if (!host || !user || !pass || !from) {
    throw new Error('SMTP email configuration is incomplete.')
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  })
}

function normalizeEmail(email?: string) {
  return String(email || '').trim().toLowerCase()
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function normalizeEmailAddress(value: unknown) {
  if (!value) return ''

  if (typeof value === 'string') {
    return normalizeEmail(value)
  }

  if (typeof value === 'object' && 'address' in value) {
    return normalizeEmail((value as { address?: string }).address)
  }

  return ''
}

function escapeHtml(value: string) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function buildBrandedEmailHtml(input: {
  title: string
  bodyHtml: string
  eyebrow?: string
}) {
  return `
    <div style="margin:0;padding:28px 14px;background:#f5f7fb;font-family:Arial,sans-serif;color:#111827;">
      <div style="max-width:720px;margin:0 auto;overflow:hidden;border:1px solid #e5e7eb;border-radius:18px;background:#ffffff;box-shadow:0 12px 30px rgba(15,23,42,.08);">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#6d5dfb,#4f7df3);color:#ffffff;">
          <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.82;">${escapeHtml(input.eyebrow || 'Smart Incubation Workspace')}</div>
          <h1 style="margin:8px 0 0;font-size:24px;line-height:1.25;">${escapeHtml(input.title)}</h1>
        </div>
        <div style="padding:28px;line-height:1.65;">
          ${input.bodyHtml}
        </div>
        <div style="padding:16px 28px;border-top:1px solid #e5e7eb;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.5;">
          This email was sent by the Smart Incubation workspace. If you did not expect it, please contact your programme administrator.
        </div>
      </div>
    </div>
  `
}

function buildActionButton(label: string, url: string) {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;margin:10px 0 4px;padding:12px 18px;border-radius:10px;background:#6d5dfb;color:#ffffff;font-weight:700;text-decoration:none;">${escapeHtml(label)}</a>`
}

function getAppBaseUrl(request?: Request) {
  const configured = env('APP_BASE_URL')
  if (configured) return configured.replace(/\/$/, '')

  const origin = String(request?.headers.origin || '').trim()
  if (/^https?:\/\//i.test(origin)) return origin.replace(/\/$/, '')

  return 'https://smart-incubation-71f96.web.app'
}

function buildEmailVerificationActionUrl(firebaseLink: string, request?: Request) {
  const parsed = new URL(firebaseLink)
  const oobCode = parsed.searchParams.get('oobCode')
  const mode = parsed.searchParams.get('mode') || 'verifyEmail'
  const apiKey = parsed.searchParams.get('apiKey') || ''
  const continueUrl = new URL('/email-verification', getAppBaseUrl(request))

  if (mode) continueUrl.searchParams.set('mode', mode)
  if (oobCode) continueUrl.searchParams.set('oobCode', oobCode)
  if (apiKey) continueUrl.searchParams.set('apiKey', apiKey)

  return continueUrl.toString()
}

/**
 * Sends password links to the app's own /set-password page instead of Firebase's hosted reset page, which is
 * unbranded and has no way back into the app. `invite` marks a brand-new account so the page says "set", not "reset".
 */
function buildPasswordActionUrl(firebaseLink: string, options: { invite?: boolean, request?: Request } = {}) {
  const parsed = new URL(firebaseLink)
  const actionUrl = new URL('/set-password', getAppBaseUrl(options.request))
  const oobCode = parsed.searchParams.get('oobCode')
  if (oobCode) actionUrl.searchParams.set('oobCode', oobCode)
  if (options.invite) actionUrl.searchParams.set('invite', '1')
  return actionUrl.toString()
}

function buildAuthActionTemplate(input: {
  title: string
  name?: string
  intro: string
  actionLabel: string
  actionUrl: string
  expiryNote: string
}) {
  const firstName = String(input.name || 'there').trim().split(/\s+/)[0] || 'there'
  const text = [
    `Hello ${firstName},`,
    '',
    input.intro,
    '',
    input.actionUrl,
    '',
    input.expiryNote,
    '',
    'Kind regards,',
    'Smart Incubation Team',
  ].join('\n')
  const html = `
    <p>Hello ${escapeHtml(firstName)},</p>
    <p>${escapeHtml(input.intro)}</p>
    <p>${buildActionButton(input.actionLabel, input.actionUrl)}</p>
    <p style="color:#6b7280;font-size:13px;">${escapeHtml(input.expiryNote)}</p>
    <p style="margin-top:22px;">Kind regards,<br /><strong>Smart Incubation Team</strong></p>
  `
  return { subject: input.title, text, html }
}

async function queueTemplateMail(input: {
  to: string
  source: string
  template: { subject: string, text: string, html: string }
}) {
  return getFirestore().collection('mail').add({
    to: [normalizeEmail(input.to)],
    message: input.template,
    source: input.source,
    createdAt: FieldValue.serverTimestamp(),
  })
}

async function reserveAuthEmailCooldown(key: string, cooldownSeconds = 60) {
  const db = getFirestore()
  const ref = db.collection('authEmailCooldowns').doc(key)
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    const lastRequestedAt = snapshot.data()?.requestedAt?.toMillis?.() || 0
    if (Date.now() - lastRequestedAt < cooldownSeconds * 1000) return false
    transaction.set(ref, { requestedAt: FieldValue.serverTimestamp() }, { merge: true })
    return true
  })
}

function getFirstName(item: ComplianceReminderRecipient) {
  const raw = item.firstName || item.name || item.participantName || item.email || 'Participant'
  return String(raw).trim().split(/\s+/)[0] || 'Participant'
}

function buildComplianceReminderTemplate(input: {
  firstName: string
  programName: string
  documents: string[]
}) {
  const documentsText = input.documents.map(item => `- ${item}`).join('\n')

  const documentsHtml = input.documents
    .map(item => `<li>${escapeHtml(item)}</li>`)
    .join('')

  const subject = `Compliance documents required for ${input.programName}`

  const text = [
    `Hello ${input.firstName},`,
    '',
    `We are reviewing compliance documents for ${input.programName} and found that some items still need your attention.`,
    '',
    'The following document items require action:',
    '',
    documentsText,
    '',
    'Please upload or correct these documents as soon as possible so your compliance record can be completed.',
    '',
    'If you have already submitted the required documents, please ignore this message or contact the programme team for assistance.',
    '',
    'Kind regards,',
    'Smart Incubation Team',
  ].join('\n')

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:640px;margin:0 auto;">
      <div style="border:1px solid #e5e7eb;border-radius:16px;padding:24px;background:#ffffff;">
        <h2 style="margin:0 0 12px;color:#111827;">Compliance documents required</h2>

        <p>Hello ${escapeHtml(input.firstName)},</p>

        <p>
          We are reviewing compliance documents for
          <strong>${escapeHtml(input.programName)}</strong>
          and found that some items still need your attention.
        </p>

        <p>The following document items require action:</p>

        <ul style="padding-left:20px;margin:12px 0;">
          ${documentsHtml}
        </ul>

        <p>
          Please upload or correct these documents as soon as possible so your compliance record can be completed.
        </p>

        <p style="color:#6b7280;font-size:13px;">
          If you have already submitted the required documents, please ignore this message or contact the programme team for assistance.
        </p>

        <p style="margin-top:24px;">
          Kind regards,<br />
          <strong>Smart Incubation Team</strong>
        </p>
      </div>
    </div>
  `

  return { subject, text, html }
}

function buildInterventionBottleneckReminderTemplate(input: {
  name: string
  role: string
  departmentName: string
  stageLabel: string
  overdueCount: number
  totalCount: number
  items: InterventionBottleneckReminderItem[]
}) {
  const firstName = String(input.name || 'Colleague').trim().split(/\s+/)[0] || 'Colleague'
  const safeDepartment = input.departmentName || 'your department'
  const safeStage = input.stageLabel || 'Pending action'

  const itemLines = input.items
    .slice(0, 12)
    .map(item => {
      const due = item.dueDate
        ? new Date(item.dueDate).toLocaleDateString('en-ZA')
        : 'No due date'

      return `- ${item.participantName || 'SME'}: ${item.interventionTitle || 'Intervention'} (${item.status || 'pending'}, ${item.urgencyLabel || 'waiting'}, due: ${due})`
    })
    .join('\n')

  const itemHtml = input.items
    .slice(0, 12)
    .map(item => {
      const due = item.dueDate
        ? new Date(item.dueDate).toLocaleDateString('en-ZA')
        : 'No due date'

      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.participantName || 'SME')}</td>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.interventionTitle || 'Intervention')}</td>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.status || 'pending')}</td>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.urgencyLabel || 'Waiting')}</td>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(due)}</td>
        </tr>
      `
    })
    .join('')

  const hiddenCount = Math.max(0, input.items.length - 12)
  const hiddenText = hiddenCount > 0 ? `\n\nThere are ${hiddenCount} additional item(s) not shown in this email.` : ''
  const hiddenHtml = hiddenCount > 0
    ? `<p style="color:#6b7280;font-size:13px;">There are ${hiddenCount} additional item(s) not shown in this email.</p>`
    : ''

  const subject = `Follow-up required: ${safeStage}`

  const text = [
    `Hello ${firstName},`,
    '',
    `This is a follow-up on intervention items currently held at: ${safeStage}.`,
    '',
    `Department: ${safeDepartment}`,
    `Total pending items: ${input.totalCount}`,
    `Overdue items: ${input.overdueCount}`,
    '',
    'Items requiring attention:',
    '',
    itemLines || '- No item details were provided.',
    hiddenText,
    '',
    'Please review and complete the required action as soon as possible so the intervention workflow can continue.',
    '',
    'Kind regards,',
    'Smart Incubation Team',
  ].join('\n')

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:760px;margin:0 auto;">
      <div style="border:1px solid #e5e7eb;border-radius:16px;padding:24px;background:#ffffff;">
        <h2 style="margin:0 0 12px;color:#111827;">Intervention follow-up required</h2>

        <p>Hello ${escapeHtml(firstName)},</p>

        <p>
          This is a follow-up on intervention items currently held at:
          <strong>${escapeHtml(safeStage)}</strong>.
        </p>

        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:14px;margin:16px 0;">
          <p style="margin:0;"><strong>Department:</strong> ${escapeHtml(safeDepartment)}</p>
          <p style="margin:6px 0 0;"><strong>Total pending items:</strong> ${input.totalCount}</p>
          <p style="margin:6px 0 0;"><strong>Overdue items:</strong> ${input.overdueCount}</p>
        </div>

        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb;">SME</th>
              <th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb;">Intervention</th>
              <th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb;">Status</th>
              <th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb;">Urgency</th>
              <th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb;">Due date</th>
            </tr>
          </thead>
          <tbody>
            ${itemHtml || `
              <tr>
                <td colspan="5" style="padding:10px;border-bottom:1px solid #e5e7eb;">
                  No item details were provided.
                </td>
              </tr>
            `}
          </tbody>
        </table>

        ${hiddenHtml}

        <p>
          Please review and complete the required action as soon as possible so the intervention workflow can continue.
        </p>

        <p style="margin-top:24px;">
          Kind regards,<br />
          <strong>Smart Incubation Team</strong>
        </p>
      </div>
    </div>
  `

  return { subject, text, html }
}

async function requireAuth(request: Request) {
  const header = request.headers.authorization || ''
  const match = header.match(/^Bearer (.+)$/)

  if (!match) {
    throw new Error('not_authenticated')
  }

  return getAuth().verifyIdToken(match[1])
}

/**
 * System admins, project admins and operations staff. `allowDirector` also admits directors, only on the staff
 * create/update/delete endpoints, where canManageProjectStaff then limits them to their company's reception admins.
 * `allowReception` admits company reception (`admin`), only for registering walk-in SMEs as pending applications.
 */
async function requireAccountManager(request: Request, options: { allowDirector?: boolean, allowReception?: boolean } = {}) {
  const decoded = await requireAuth(request)
  const snapshot = await getFirestore().collection('users').doc(decoded.uid).get()
  const role = String(snapshot.data()?.role || '').trim().toLowerCase()

  if (!['systemadmin', 'projectadmin', 'operations', ...(options.allowDirector ? ['director'] : []), ...(options.allowReception ? ['admin'] : [])].includes(role)) {
    throw new Error('permission_denied')
  }

  return {
    decoded,
    role,
    companyCode: String(snapshot.data()?.companyCode || '').trim(),
    isPlatformAdmin: role === 'systemadmin',
  }
}

/** Which account roles each company manager may create, edit or remove (platform admins may manage any). */
const MANAGEABLE_ROLES: Record<string, string[]> = {
  projectadmin: ['consultant', 'projectadmin', 'admin', 'funder'],
  operations: ['consultant', 'projectadmin'],
  // Directors only add their company's reception admins and funders.
  director: ['admin', 'funder'],
}

/**
 * The programme ids a person is linked to, kept only if they are that company's programmes. Empty means all of the
 * company's programmes, so an unknown id is dropped rather than widening or breaking the link.
 */
const companyProgramIds = async (db: FirebaseFirestore.Firestore, companyCode: unknown, ids: unknown): Promise<string[]> => {
  const wanted = Array.isArray(ids) ? [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))] : []
  const code = String(companyCode || '').trim()
  if (!wanted.length || !code) return []
  const snapshots = await Promise.all(wanted.map((id) => db.collection('programs').doc(id).get()))
  return snapshots.filter((snapshot) => snapshot.exists && String(snapshot.data()?.companyCode || '').trim() === code).map((snapshot) => snapshot.id)
}
/** Creates/refreshes a company record without ever overwriting a display name someone has already set. */
const ensureCompanyRecord = async (
  db: FirebaseFirestore.Firestore,
  companyCode: string,
  updatedBy: string,
) => {
  const ref = db.collection('companies').doc(companyCode)
  const existing = await ref.get()
  const hasName = Boolean(existing.exists && (existing.data()?.name || existing.data()?.companyName))
  await ref.set({
    companyCode,
    ...(hasName ? {} : { name: companyCode }),
    status: 'active',
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy,
  }, { merge: true })
}
const projectStaffPermissions = [
  'view_dashboard',
  'view_reports',
  'manage_programs',
  'manage_interventions',
  'assign_interventions',
  'track_interventions',
  'view_diagnostic_plans',
  'manage_diagnostic_plans',
  'view_applications',
  'manage_applications',
  'view_compliance',
  'manage_compliance',
  'view_participants',
  'view_staff',
  'manage_staff',
]
const sanitizeManagedPermissions = (
  manager: { isPlatformAdmin: boolean },
  permissions: unknown,
  targetRole?: unknown,
) => {
  if (!Array.isArray(permissions)) return undefined
  // Company reception (`admin`) and funders always run on their role's defaults; only a platform admin may customise them.
  if (!manager.isPlatformAdmin && ['admin', 'funder'].includes(String(targetRole || '').trim().toLowerCase())) return undefined
  return manager.isPlatformAdmin
    ? permissions.filter((permission): permission is string => typeof permission === 'string')
    : permissions.filter((permission): permission is string => typeof permission === 'string' && projectStaffPermissions.includes(permission))
}
const canManageProjectStaff = (
  manager: { role: string, companyCode: string, isPlatformAdmin: boolean },
  role: unknown,
  companyCode: unknown,
) => manager.isPlatformAdmin || (
  (MANAGEABLE_ROLES[manager.role] || []).includes(String(role || '').trim().toLowerCase())
  && !!manager.companyCode
  && manager.companyCode === String(companyCode || '').trim()
)

async function getSuppressedEmail(email: string) {
  const normalized = normalizeEmail(email)
  if (!normalized) return null

  const snap = await getFirestore()
    .collection('emailSuppressions')
    .doc(normalized)
    .get()

  if (!snap.exists) return null

  const data = snap.data() || {}
  if (data.active === false) return null

  return {
    email: normalized,
    reason: data.reason || 'suppressed',
    failureCount: data.failureCount || 0,
  }
}

async function sendMailRecord(mailId: string, data: MailRecord) {
  const to = normalizeRecipients(data.to).map(normalizeEmail).filter(Boolean)
  const cc = normalizeRecipients(data.cc).map(normalizeEmail).filter(Boolean)
  const bcc = normalizeRecipients(data.bcc).map(normalizeEmail).filter(Boolean)
  const allRecipients = Array.from(new Set([...to, ...cc, ...bcc]))

  if (!allRecipients.length) {
    throw new Error('Mail record has no recipients.')
  }

  const db = getFirestore()
  const suppressed: string[] = []
  const allowedTo: string[] = []

  for (const email of to) {
    const suppression = await getSuppressedEmail(email)
    if (suppression) suppressed.push(email)
    else allowedTo.push(email)
  }

  if (!allowedTo.length) {
    await db.collection('mail').doc(mailId).set(
      {
        delivery: {
          status: 'skipped',
          reason: 'all_recipients_suppressed',
          suppressed,
          skippedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    )

    await db.collection('emailDeliveryLogs').add({
      mailId,
      source: data.source || 'mail',
      status: 'skipped',
      reason: 'all_recipients_suppressed',
      recipients: allRecipients,
      suppressed,
      createdAt: FieldValue.serverTimestamp(),
    })

    return
  }

  const message = data.message || {}

  try {
    const info = await getTransporter().sendMail({
      from: env('MAIL_FROM'),
      to: allowedTo,
      cc,
      bcc,
      subject: message.subject || 'Smart Incubation notification',
      text: message.text || '',
      html: buildBrandedEmailHtml({
        title: message.subject || 'Smart Incubation notification',
        bodyHtml: message.html || `<p>${escapeHtml(message.text || '')}</p>`,
      }),
    })

    const accepted = Array.isArray(info.accepted)
      ? info.accepted.map((item: unknown) => normalizeEmailAddress(item)).filter(Boolean)
      : []

    const rejected = Array.isArray(info.rejected)
      ? info.rejected.map((item: unknown) => normalizeEmailAddress(item)).filter(Boolean)
      : []

    await db.collection('mail').doc(mailId).set(
      {
        delivery: {
          status: 'sent',
          providerMessageId: info.messageId || null,
          accepted,
          rejected,
          response: info.response || null,
          suppressed,
          sentAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    )

    await db.collection('emailDeliveryLogs').add({
      mailId,
      source: data.source || 'mail',
      status: 'sent',
      providerMessageId: info.messageId || null,
      accepted,
      rejected,
      response: info.response || null,
      recipients: allRecipients,
      suppressed,
      createdAt: FieldValue.serverTimestamp(),
    })

    await Promise.all(
      rejected.map((email: string) =>
        db.collection('emailSuppressions').doc(email).set(
          {
            email,
            active: true,
            reason: 'provider_rejected',
            failureCount: FieldValue.increment(1),
            lastFailureAt: FieldValue.serverTimestamp(),
            lastMailId: mailId,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        ),
      ),
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    await db.collection('mail').doc(mailId).set(
      {
        delivery: {
          status: 'failed',
          error: errorMessage,
          failedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    )

    await db.collection('emailDeliveryLogs').add({
      mailId,
      source: data.source || 'mail',
      status: 'failed',
      error: errorMessage,
      recipients: allRecipients,
      createdAt: FieldValue.serverTimestamp(),
    })

    throw error
  }
}

async function proxyAiEndpoint(path: string, request: Request) {
  const bases = [env('HF_AI_BASE_URL', defaultAiBaseUrl)]
  let response: Response | undefined

  for (const base of bases) {
    response = await fetch(`${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body || {}),
    })
    if (response.status !== 404) break
  }

  if (!response) throw new Error('No AI endpoint is configured.')
  const text = await response.text()

  try {
    return { status: response.status, body: JSON.parse(text) as unknown }
  } catch {
    return { status: response.status, body: { answer: text } }
  }
}

export const sendQueuedMail = onDocumentCreated(
  {
    document: 'mail/{mailId}',
    region,
  },
  async event => {
    const data = event.data?.data() as MailRecord | undefined
    if (!data) return

    try {
      await sendMailRecord(event.params.mailId, data)
    } catch (error) {
      await getFirestore().collection('mail').doc(event.params.mailId).set(
        {
          delivery: {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            failedAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      )
      throw error
    }
  },
)

export const sendComplianceReminderEmail = onRequest({ region }, (request, response) => {
  corsHandler(request, response, async () => {
    if (request.method !== 'POST') {
      jsonResponse(response, 405, { ok: false, error: 'Method not allowed' })
      return
    }

    try {
      const decoded = await requireAuth(request)
      const payload = request.body as ComplianceReminderPayload

      const recipients = Array.isArray(payload.recipients) ? payload.recipients : []
      const programName = String(payload.programName || 'your programme')

      if (!recipients.length) {
        jsonResponse(response, 400, { ok: false, error: 'recipients_required' })
        return
      }

      const db = getFirestore()

      const results = await Promise.all(
        recipients.map(async recipient => {
          const email = normalizeEmail(recipient.email)

          if (!email) {
            await db.collection('emailDeliveryLogs').add({
              source: payload.source || 'complianceReminder',
              status: 'skipped',
              reason: 'invalid_email',
              email: recipient.email || '',
              createdAt: FieldValue.serverTimestamp(),
              createdBy: decoded.uid,
            })
            return {
              email: recipient.email || '',
              status: 'skipped',
              reason: 'invalid_email',
            }
          }

          const suppression = await getSuppressedEmail(email)

          if (suppression) {
            await db.collection('emailDeliveryLogs').add({
              source: payload.source || 'complianceReminder',
              status: 'skipped',
              reason: 'suppressed',
              email,
              participantId: recipient.participantId || null,
              participantName: recipient.participantName || recipient.name || null,
              programId: recipient.programId || payload.programId || null,
              programName,
              documents: recipient.documents || [],
              createdAt: FieldValue.serverTimestamp(),
              createdBy: decoded.uid,
            })

            return {
              email,
              status: 'skipped',
              reason: 'suppressed',
            }
          }

          const template = buildComplianceReminderTemplate({
            firstName: getFirstName(recipient),
            programName,
            documents: recipient.documents || [],
          })

          const mailRef = await db.collection('mail').add({
            to: [email],
            message: {
              subject: template.subject,
              text: template.text,
              html: template.html,
            },
            meta: {
              templateId: 'compliance-reminder',
              participantId: recipient.participantId || null,
              participantName: recipient.participantName || recipient.name || null,
              programId: recipient.programId || payload.programId || null,
              programName,
              documents: recipient.documents || [],
            },
            createdAt: FieldValue.serverTimestamp(),
            createdBy: decoded.uid,
            source: payload.source || 'complianceReminder',
          })

          return {
            email,
            status: 'queued',
            mailId: mailRef.id,
          }
        }),
      )

      jsonResponse(response, 200, {
        ok: true,
        queued: results.filter(item => item.status === 'queued').length,
        skipped: results.filter(item => item.status === 'skipped').length,
        results,
      })
    } catch (error) {
      jsonResponse(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
})

export const sendInterventionBottleneckReminderEmail = onRequest({ region }, (request, response) => {
  corsHandler(request, response, async () => {
    if (request.method !== 'POST') {
      jsonResponse(response, 405, { ok: false, error: 'Method not allowed' })
      return
    }

    try {
      const decoded = await requireAuth(request)
      const payload = request.body as InterventionBottleneckReminderPayload
      const recipients = Array.isArray(payload.recipients) ? payload.recipients : []

      if (!recipients.length) {
        jsonResponse(response, 400, { ok: false, error: 'recipients_required' })
        return
      }

      const db = getFirestore()

      const results = await Promise.all(
        recipients.map(async recipient => {
          const email = normalizeEmail(recipient.email)

          if (!email) {
            await db.collection('emailDeliveryLogs').add({
              source: payload.source || 'interventionBottleneckReminder',
              status: 'skipped',
              reason: 'invalid_email',
              email: recipient.email || '',
              createdAt: FieldValue.serverTimestamp(),
              createdBy: decoded.uid,
            })
            return {
              email: recipient.email || '',
              status: 'skipped',
              reason: 'invalid_email',
            }
          }

          const suppression = await getSuppressedEmail(email)

          if (suppression) {
            await db.collection('emailDeliveryLogs').add({
              source: payload.source || 'interventionBottleneckReminder',
              status: 'skipped',
              reason: 'suppressed',
              email,
              departmentId: payload.departmentId || null,
              departmentName: recipient.departmentName || payload.departmentName || null,
              stage: payload.stage || null,
              stageLabel: recipient.stageLabel || payload.stageLabel || null,
              responsibleRole: recipient.role || payload.responsibleRole || null,
              itemCount: Array.isArray(recipient.items) ? recipient.items.length : 0,
              createdAt: FieldValue.serverTimestamp(),
              createdBy: decoded.uid,
            })

            return {
              email,
              status: 'skipped',
              reason: 'suppressed',
            }
          }

          const items = Array.isArray(recipient.items) ? recipient.items : []

          const template = buildInterventionBottleneckReminderTemplate({
            name: recipient.name || email,
            role: recipient.role || payload.responsibleRole || 'unknown',
            departmentName: recipient.departmentName || payload.departmentName || 'Department',
            stageLabel: recipient.stageLabel || payload.stageLabel || 'Pending action',
            overdueCount: Number(recipient.overdueCount || 0),
            totalCount: Number(recipient.totalCount || items.length || 0),
            items,
          })

          const mailRef = await db.collection('mail').add({
            to: [email],
            message: {
              subject: template.subject,
              text: template.text,
              html: template.html,
            },
            meta: {
              templateId: 'intervention-bottleneck-reminder',
              departmentId: payload.departmentId || null,
              departmentName: recipient.departmentName || payload.departmentName || null,
              stage: payload.stage || null,
              stageLabel: recipient.stageLabel || payload.stageLabel || null,
              responsibleRole: recipient.role || payload.responsibleRole || null,
              overdueCount: Number(recipient.overdueCount || 0),
              totalCount: Number(recipient.totalCount || items.length || 0),
              items,
            },
            createdAt: FieldValue.serverTimestamp(),
            createdBy: decoded.uid,
            source: payload.source || 'interventionBottleneckReminder',
          })

          await Promise.all(
            items
              .filter(item => item.assignedInterventionId)
              .map(item =>
                db.collection('assignedInterventions').doc(String(item.assignedInterventionId)).set(
                  {
                    lastBottleneckReminder: {
                      mailId: mailRef.id,
                      sentTo: email,
                      stage: payload.stage || null,
                      stageLabel: recipient.stageLabel || payload.stageLabel || null,
                      responsibleRole: recipient.role || payload.responsibleRole || null,
                      urgency: item.urgency || null,
                      urgencyLabel: item.urgencyLabel || null,
                      assigneeId: item.assigneeId || null,
                      assigneeRole: item.assigneeRole || null,
                      assigneeStatus: item.assigneeStatus || null,
                      participantStatus: item.participantStatus || null,
                      completionStatus: item.completionStatus || null,
                      progress: typeof item.progress === 'number' ? item.progress : null,
                      sentAt: FieldValue.serverTimestamp(),
                      sentBy: decoded.uid,
                    },
                    bottleneckReminderCount: FieldValue.increment(1),
                    updatedAt: FieldValue.serverTimestamp(),
                  },
                  { merge: true },
                ),
              ),
          )

          await db.collection('interventionBottleneckReminderLogs').add({
            mailId: mailRef.id,
            email,
            recipientName: recipient.name || null,
            departmentId: payload.departmentId || null,
            departmentName: recipient.departmentName || payload.departmentName || null,
            stage: payload.stage || null,
            stageLabel: recipient.stageLabel || payload.stageLabel || null,
            responsibleRole: recipient.role || payload.responsibleRole || null,
            overdueCount: Number(recipient.overdueCount || 0),
            totalCount: Number(recipient.totalCount || items.length || 0),
            items,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: decoded.uid,
            source: payload.source || 'interventionBottleneckReminder',
          })

          return {
            email,
            status: 'queued',
            mailId: mailRef.id,
          }
        }),
      )

      jsonResponse(response, 200, {
        ok: true,
        queued: results.filter(item => item.status === 'queued').length,
        skipped: results.filter(item => item.status === 'skipped').length,
        results,
      })
    } catch (error) {
      jsonResponse(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
})

export const queueMail = onRequest(
  {
    region,
  },
  (request, response) => {
    corsHandler(request, response, async () => {
      if (request.method !== 'POST') {
        jsonResponse(response, 405, { ok: false, error: 'Method not allowed' })
        return
      }

      try {
        await requireAuth(request)

        const ref = await getFirestore().collection('mail').add({
          ...(request.body as MailRecord),
          createdAt: FieldValue.serverTimestamp(),
          source: request.body?.source || 'queueMail',
        })

        jsonResponse(response, 200, { ok: true, id: ref.id })
      } catch (error) {
        jsonResponse(response, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
  },
)

export const getEmailOperations = onRequest({ region }, (request, response) => {
  corsHandler(request, response, async () => {
    if (request.method !== 'POST') {
      jsonResponse(response, 405, { ok: false, error: 'Method not allowed' })
      return
    }

    try {
      const admin = await requireAccountManager(request)
      if (!admin.isPlatformAdmin) {
        jsonResponse(response, 403, { ok: false, error: 'permission_denied' })
        return
      }

      const db = getFirestore()
      const [logsSnapshot, suppressionsSnapshot] = await Promise.all([
        db.collection('emailDeliveryLogs').orderBy('createdAt', 'desc').limit(200).get(),
        db.collection('emailSuppressions').where('active', '==', true).limit(200).get(),
      ])
      const logs = logsSnapshot.docs.map(record => {
        const data = record.data()
        return {
          id: record.id,
          source: String(data.source || 'mail'),
          status: String(data.status || 'unknown'),
          reason: String(data.reason || ''),
          error: String(data.error || ''),
          recipients: normalizeRecipients(data.recipients || data.email),
          accepted: normalizeRecipients(data.accepted),
          rejected: normalizeRecipients(data.rejected),
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        }
      })
      const suppressions = suppressionsSnapshot.docs.map(record => {
        const data = record.data()
        return {
          id: record.id,
          email: String(data.email || record.id),
          reason: String(data.reason || 'suppressed'),
          failureCount: Number(data.failureCount || 0),
          updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || null,
        }
      })

      jsonResponse(response, 200, {
        ok: true,
        summary: {
          sent: logs.filter(item => item.status === 'sent').length,
          failed: logs.filter(item => item.status === 'failed').length,
          rejected: logs.reduce((total, item) => total + item.rejected.length, 0),
          bounced: logs.filter(item => item.reason === 'bounced').length,
          suppressed: suppressions.length,
          invalid: logs.filter(item => item.reason === 'invalid_email').length,
        },
        logs,
        suppressions,
      })
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
})

export const sendAdminEmail = onRequest({ region }, (request, response) => {
  corsHandler(request, response, async () => {
    if (request.method !== 'POST') {
      jsonResponse(response, 405, { ok: false, error: 'Method not allowed' })
      return
    }

    try {
      const admin = await requireAccountManager(request)
      if (!admin.isPlatformAdmin) {
        jsonResponse(response, 403, { ok: false, error: 'permission_denied' })
        return
      }

      const to = normalizeEmail(request.body?.to)
      const subject = String(request.body?.subject || '').trim()
      const message = String(request.body?.message || '').trim()

      if (!isValidEmail(to)) {
        await getFirestore().collection('emailDeliveryLogs').add({
          source: 'sendAdminEmail',
          status: 'skipped',
          reason: 'invalid_email',
          email: to,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: admin.decoded.uid,
        })
        jsonResponse(response, 400, { ok: false, error: 'invalid_email' })
        return
      }
      if (!subject || !message) {
        jsonResponse(response, 400, { ok: false, error: 'subject_and_message_required' })
        return
      }

      const suppression = await getSuppressedEmail(to)
      if (suppression) {
        jsonResponse(response, 409, { ok: false, error: 'recipient_suppressed' })
        return
      }

      const ref = await getFirestore().collection('mail').add({
        to: [to],
        source: 'sendAdminEmail',
        message: {
          subject,
          text: message,
          html: `<p>${escapeHtml(message).replaceAll('\n', '<br />')}</p>`,
        },
        createdAt: FieldValue.serverTimestamp(),
        createdBy: admin.decoded.uid,
      })

      jsonResponse(response, 200, { ok: true, id: ref.id })
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
})

export const requestBrandedVerificationEmail = onRequest({ region }, (request, response) => {
  corsHandler(request, response, async () => {
    if (request.method !== 'POST') {
      jsonResponse(response, 405, { ok: false, error: 'Method not allowed' })
      return
    }

    try {
      const decoded = await requireAuth(request)
      const userRecord = await getAuth().getUser(decoded.uid)
      if (!userRecord.email) {
        jsonResponse(response, 400, { ok: false, error: 'email_required' })
        return
      }
      if (userRecord.emailVerified) {
        jsonResponse(response, 200, { ok: true, verified: true })
        return
      }
      if (!await reserveAuthEmailCooldown(`verify_${decoded.uid}`)) {
        jsonResponse(response, 200, { ok: true, throttled: true })
        return
      }
      const link = buildEmailVerificationActionUrl(
        await getAuth().generateEmailVerificationLink(userRecord.email),
        request,
      )
      await queueTemplateMail({
        to: userRecord.email,
        source: 'requestBrandedVerificationEmail',
        template: buildAuthActionTemplate({
          title: 'Verify your Smart Incubation email',
          name: userRecord.displayName,
          intro: 'Confirm your email address to finish securing your Smart Incubation account.',
          actionLabel: 'Verify email address',
          actionUrl: link,
          expiryNote: 'This verification link is time-sensitive. If it expires, request a new email from the workspace.',
        }),
      })
      jsonResponse(response, 200, { ok: true })
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
})

export const requestBrandedPasswordReset = onRequest({ region }, (request, response) => {
  corsHandler(request, response, async () => {
    if (request.method !== 'POST') {
      jsonResponse(response, 405, { ok: false, error: 'Method not allowed' })
      return
    }

    const email = normalizeEmail(request.body?.email)
    if (!email) {
      jsonResponse(response, 400, { ok: false, error: 'email_required' })
      return
    }

    try {
      const userRecord = await getAuth().getUserByEmail(email)
      if (!await reserveAuthEmailCooldown(`reset_${userRecord.uid}`)) {
        jsonResponse(response, 200, { ok: true, throttled: true })
        return
      }
      const link = buildPasswordActionUrl(await getAuth().generatePasswordResetLink(email), { request })
      await queueTemplateMail({
        to: email,
        source: 'requestBrandedPasswordReset',
        template: buildAuthActionTemplate({
          title: 'Reset your Smart Incubation password',
          name: userRecord.displayName,
          intro: 'We received a request to reset your Smart Incubation password. Use the secure link below to choose a new password.',
          actionLabel: 'Reset password',
          actionUrl: link,
          expiryNote: 'If you did not request a password reset, you can ignore this email. Your password will remain unchanged.',
        }),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('auth/user-not-found')) {
        jsonResponse(response, 500, { ok: false, error: message })
        return
      }
    }

    jsonResponse(response, 200, { ok: true })
  })
})

export const createPlatformUser = onRequest({ region }, (request, response) => {
  corsHandler(request, response, async () => {
    if (request.method !== 'POST') {
      jsonResponse(response, 405, { ok: false, error: 'Method not allowed' })
      return
    }

    try {
      const admin = await requireAccountManager(request, { allowDirector: true })

      const payload = request.body as PlatformUserPayload
      const permissions = sanitizeManagedPermissions(admin, payload.permissions, payload.role)
      const programIds = await companyProgramIds(getFirestore(), payload.companyCode, payload.assignedProgramIds)
      if (admin.role !== 'systemadmin' && payload.role === 'systemadmin') {
        jsonResponse(response, 403, { ok: false, error: 'permission_denied' })
        return
      }
      if (!canManageProjectStaff(admin, payload.role, payload.companyCode)) {
        jsonResponse(response, 403, { ok: false, error: 'permission_denied' })
        return
      }
      const email = String(payload.email || '').trim().toLowerCase()
      const name = String(payload.name || email)

      if (!email) {
        jsonResponse(response, 400, { ok: false, error: 'email_required' })
        return
      }

      let userRecord
      try {
        userRecord = await getAuth().getUserByEmail(email)
        if (!payload.allowExisting) {
          jsonResponse(response, 409, { ok: false, error: 'email_already_exists' })
          return
        }
      } catch {
        userRecord = await getAuth().createUser({
          email,
          displayName: name,
          emailVerified: false,
          disabled: false,
        })
      }

      const resetLink = payload.sendResetLink
        ? buildPasswordActionUrl(await getAuth().generatePasswordResetLink(email), { invite: true, request })
        : null

      const userDoc = {
        uid: userRecord.uid,
        email,
        name,
        displayName: name,
        role: payload.role || 'user',
        companyCode: payload.companyCode || null,
        jobTitle: payload.jobTitle || null,
        assignedBranch: payload.assignedBranch || null,
        branchId: payload.assignedBranch || null,
        assignedProgramIds: programIds,
        assignedPrograms: payload.assignedPrograms || [],
        phone: String(payload.phone || '').trim() || null,
        alternativePhone: String(payload.alternativePhone || '').trim() || null,
        phoneIsWhatsApp: payload.phoneIsWhatsApp === true,
        alternativePhoneIsWhatsApp: payload.alternativePhoneIsWhatsApp === true,
        phoneProvider: String(payload.phoneProvider || '').trim() || null,
        whatsappPhoneNumbers: whatsappNumbersFromPayload(payload),
        ...(permissions ? { permissions } : {}),
        mustChangePassword: true,
        active: true,
        status: 'active',
        updatedAt: FieldValue.serverTimestamp(),
      }

      const db = getFirestore()
      await Promise.all([
        db.collection('users').doc(userRecord.uid).set(
          {
            ...userDoc,
            createdAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        ),
        db.collection('userIdentities').doc(userRecord.uid).set(
          {
            uid: userRecord.uid,
            email,
            name,
            displayName: name,
            role: payload.role || 'user',
            companyCode: payload.companyCode || null,
            assignedBranch: payload.assignedBranch || null,
            branchId: payload.assignedBranch || null,
            phone: String(payload.phone || '').trim() || null,
            alternativePhone: String(payload.alternativePhone || '').trim() || null,
            phoneIsWhatsApp: payload.phoneIsWhatsApp === true,
            alternativePhoneIsWhatsApp: payload.alternativePhoneIsWhatsApp === true,
            phoneProvider: String(payload.phoneProvider || '').trim() || null,
            whatsappPhoneNumbers: whatsappNumbersFromPayload(payload),
            ...(permissions ? { permissions } : {}),
            mustChangePassword: true,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        ),
        ...(payload.companyCode ? [ensureCompanyRecord(db, payload.companyCode, admin.decoded.uid)] : []),
      ])

      if (payload.sendEmail && resetLink) {
        await queueTemplateMail({
          to: email,
          source: 'createPlatformUser',
          template: buildAuthActionTemplate({
            title: 'Your Smart Incubation account is ready',
            name,
            intro: 'Your Smart Incubation workspace account has been created. Use the secure link below to set your password and continue.',
            actionLabel: 'Set your password',
            actionUrl: resetLink,
            expiryNote: 'This account setup link is time-sensitive. Contact your programme administrator if you need a new invitation.',
          }),
        })
      }

      jsonResponse(response, 200, {
        ok: true,
        uid: userRecord.uid,
        user: { uid: userRecord.uid, email, name },
        resetLink,
      })
    } catch (error) {
      jsonResponse(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
})

export const createParticipantAccount = onRequest({ region }, (request, response) => {
  corsHandler(request, response, async () => {
    if (request.method !== 'POST') {
      jsonResponse(response, 405, { ok: false, error: 'Method not allowed' })
      return
    }

    try {
      const manager = await requireAccountManager(request, { allowReception: true })
      // Reception registers walk-ins for review: a Pending application, no participant record or plan until accepted.
      const isReception = manager.role === 'admin'
      const payload = request.body as ParticipantAccountPayload
      const email = normalizeEmail(payload.email)
      const participantName = String(payload.participantName || '').trim()
      const businessName = String(payload.businessName || '').trim()
      const programId = String(payload.programId || '').trim()

      if (!isValidEmail(email) || !participantName || !businessName || !programId) {
        jsonResponse(response, 400, { ok: false, error: 'participant_details_required' })
        return
      }
      if (isReception && !manager.companyCode) {
        jsonResponse(response, 403, { ok: false, error: 'permission_denied' })
        return
      }

      let userRecord
      try {
        userRecord = await getAuth().getUserByEmail(email)
      } catch {
        userRecord = await getAuth().createUser({
          email,
          displayName: participantName,
          emailVerified: false,
          disabled: false,
        })
      }
      const db = getFirestore()
      const applicationId = `${userRecord.uid}__${programId}`
      const [programSnapshot, existingApplication, existingUser] = await Promise.all([
        db.collection('programs').doc(programId).get(),
        db.collection('applications').doc(applicationId).get(),
        db.collection('users').doc(userRecord.uid).get(),
      ])
      if (isReception) {
        // Never turn a staff account into an SME, and never reset an application someone already decided on.
        const existingRole = String(existingUser.data()?.role || '').trim().toLowerCase()
        if (existingUser.exists && existingRole && existingRole !== 'incubatee') {
          jsonResponse(response, 409, { ok: false, error: 'email_in_use' })
          return
        }
        if (existingApplication.exists) {
          jsonResponse(response, 409, { ok: false, error: 'already_registered' })
          return
        }
      }
      const profile = {
        uid: userRecord.uid,
        participantId: userRecord.uid,
        applicationId,
        applicantProfileId: userRecord.uid,
        businessProfileId: userRecord.uid,
        participantName,
        businessName,
        email,
        phone: payload.phone || null,
        programId,
        programName: payload.programName || null,
        companyCode: manager.companyCode || null,
        sector: payload.sector || null,
        stage: payload.stage || null,
        province: payload.province || null,
        beeLevel: payload.beeLevel || null,
        onboardingAnswers: payload.onboardingAnswers || {},
        updatedAt: FieldValue.serverTimestamp(),
      }
      const plan = isReception ? null : await buildConfirmedSetPlan(db, { program: programSnapshot.data(), programId, applicationId, participantId: userRecord.uid })
      await Promise.all([
        ...(plan ? [db.collection('diagnosticPlans').doc(applicationId).set(plan)] : []),
        ...(isReception ? [] : [db.collection('participants').doc(userRecord.uid).set(profile, { merge: true })]),
        db.collection('applicantProfiles').doc(userRecord.uid).set({
          uid: userRecord.uid,
          participantName,
          email,
          phone: payload.phone || null,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
        db.collection('businessProfiles').doc(userRecord.uid).set({
          ownerUid: userRecord.uid,
          applicantProfileId: userRecord.uid,
          businessName,
          participantName,
          email,
          phone: payload.phone || null,
          sector: payload.sector || null,
          stage: payload.stage || null,
          province: payload.province || null,
          beeLevel: payload.beeLevel || null,
          companyCode: manager.companyCode || null,
          programId,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
        db.collection('users').doc(userRecord.uid).set({
          uid: userRecord.uid,
          email,
          name: participantName,
          displayName: participantName,
          role: 'incubatee',
          companyCode: manager.companyCode || null,
          mustChangePassword: true,
          active: true,
          status: 'active',
          ...(isReception ? {} : { assignedProgramIds: FieldValue.arrayUnion(programId) }),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
        db.collection('applications').doc(applicationId).set(isReception
          ? {
            ...profile,
            applicationStatus: 'Pending',
            source: 'walk_in',
            submittedAt: new Date().toISOString(),
            createdAt: FieldValue.serverTimestamp(),
            createdBy: manager.decoded.uid,
          }
          : {
            ...profile,
            // Staff-added SMEs skip the application, so they get the programme's set interventions here (never reset on a re-add).
            ...(!existingApplication.exists ? { interventions: { required: forcedProgramInterventions(programSnapshot.data()), assigned: [], completed: [], participationRate: 0 } } : {}),
            applicationStatus: 'Accepted',
            acceptedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            createdBy: manager.decoded.uid,
          }, { merge: true }),
      ])
      const resetLink = buildPasswordActionUrl(await getAuth().generatePasswordResetLink(email), { invite: true, request })
      await queueTemplateMail({
        to: email,
        source: 'createParticipantAccount',
        template: buildAuthActionTemplate({
          title: 'Your Smart Incubation account is ready',
          name: participantName,
          intro: isReception
            ? `You have been registered for ${payload.programName || 'a Smart Incubation programme'}. Your application is being reviewed; use the secure link below to set your password and follow its progress.`
            : `You have been added to ${payload.programName || 'a Smart Incubation programme'}. Use the secure link below to set your password and continue.`,
          actionLabel: 'Set your password',
          actionUrl: resetLink,
          expiryNote: 'This account setup link is time-sensitive. Contact your programme administrator if you need a new invitation.',
        }),
      })

      jsonResponse(response, 200, { ok: true, uid: userRecord.uid })
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
})

export const deleteUserAccount = onRequest({ region }, (request, response) => {
  corsHandler(request, response, async () => {
    if (request.method !== 'POST') {
      jsonResponse(response, 405, { ok: false, error: 'Method not allowed' })
      return
    }

    try {
      const admin = await requireAccountManager(request, { allowDirector: true })

      const payload = request.body as DeleteUserPayload
      let uid = payload.uid

      if (!uid && payload.email) {
        const user = await getAuth().getUserByEmail(payload.email)
        uid = user.uid
      }

      if (!uid) {
        jsonResponse(response, 400, { ok: false, error: 'uid_or_email_required' })
        return
      }
      if (uid === admin.decoded.uid) {
        jsonResponse(response, 403, { ok: false, error: 'self_delete' })
        return
      }

      const targetProfile = await getFirestore().collection('users').doc(uid).get()
      if (admin.role !== 'systemadmin' && targetProfile.data()?.role === 'systemadmin') {
        jsonResponse(response, 403, { ok: false, error: 'permission_denied' })
        return
      }
      if (!canManageProjectStaff(admin, targetProfile.data()?.role, targetProfile.data()?.companyCode)) {
        jsonResponse(response, 403, { ok: false, error: 'permission_denied' })
        return
      }

      await getAuth().deleteUser(uid).catch(error => {
        if (!String(error?.message || '').includes('no user record')) throw error
      })

      await Promise.all([
        getFirestore().collection('users').doc(uid).set(
          {
            active: false,
            status: 'deleted',
            deletedAt: FieldValue.serverTimestamp(),
            deleteReason: payload.reason || null,
          },
          { merge: true },
        ),
        getFirestore().collection('userIdentities').doc(uid).set(
          {
            active: false,
            status: 'deleted',
            deletedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        ),
      ])

      jsonResponse(response, 200, { ok: true, uid })
    } catch (error) {
      jsonResponse(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
})

async function listAuthIdentityKeys() {
  const uids = new Set<string>()
  const emails = new Set<string>()
  let pageToken: string | undefined
  do {
    const page = await getAuth().listUsers(1000, pageToken)
    page.users.forEach(user => {
      uids.add(user.uid)
      if (user.email) emails.add(normalizeEmail(user.email))
    })
    pageToken = page.pageToken
  } while (pageToken)
  return { uids, emails }
}

async function findOrphanUserRecords() {
  const [authKeys, usersSnapshot] = await Promise.all([
    listAuthIdentityKeys(),
    getFirestore().collection('users').get(),
  ])
  return usersSnapshot.docs.flatMap(record => {
    const data = record.data()
    const uid = String(data.uid || record.id).trim()
    const email = normalizeEmail(data.email)
    if (authKeys.uids.has(record.id) || authKeys.uids.has(uid) || (email && authKeys.emails.has(email))) return []
    return [{
      id: record.id,
      email,
      name: String(data.name || data.displayName || ''),
      role: String(data.role || ''),
      companyCode: String(data.companyCode || ''),
    } satisfies OrphanUserSummary]
  })
}

async function deleteOrphanAssociatedRecords(orphan: OrphanUserSummary) {
  const firestore = getFirestore()
  const refs = new Map<string, FirebaseFirestore.DocumentReference>()
  const addRef = (ref: FirebaseFirestore.DocumentReference) => refs.set(ref.path, ref)
  const identityCollections = ['users', 'userIdentities', 'assignees', 'participants', 'applicantProfiles', 'businessProfiles']
  identityCollections.forEach(collectionName => addRef(firestore.collection(collectionName).doc(orphan.id)))

  const searches: Array<Promise<FirebaseFirestore.QuerySnapshot>> = []
  for (const collectionName of identityCollections.filter(name => name !== 'users')) {
    for (const field of ['uid', 'userId', 'ownerUid']) {
      searches.push(firestore.collection(collectionName).where(field, '==', orphan.id).get())
    }
    if (orphan.email) searches.push(firestore.collection(collectionName).where('email', '==', orphan.email).get())
  }
  const matches = await Promise.all(searches)
  matches.forEach(snapshot => snapshot.docs.forEach(record => addRef(record.ref)))

  const refList = [...refs.values()]
  for (let offset = 0; offset < refList.length; offset += 450) {
    const batch = firestore.batch()
    refList.slice(offset, offset + 450).forEach(ref => batch.delete(ref))
    await batch.commit()
  }
  return refList.map(ref => ref.path)
}

export const cleanupOrphanUserRecords = onRequest({ region, timeoutSeconds: 300 }, (request, response) => {
  corsHandler(request, response, async () => {
    if (request.method !== 'POST') {
      jsonResponse(response, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const admin = await requireAccountManager(request)
      if (!admin.isPlatformAdmin) {
        jsonResponse(response, 403, { ok: false, error: 'platform_admin_required' })
        return
      }
      const payload = request.body as OrphanCleanupPayload
      const orphans = await findOrphanUserRecords()
      if (payload.dryRun !== false) {
        jsonResponse(response, 200, { ok: true, dryRun: true, count: orphans.length, orphans })
        return
      }
      if (payload.confirmation !== 'DELETE ORPHAN USERS') {
        jsonResponse(response, 400, { ok: false, error: 'confirmation_required' })
        return
      }
      const deletedPaths: string[] = []
      for (const orphan of orphans) deletedPaths.push(...await deleteOrphanAssociatedRecords(orphan))
      await getFirestore().collection('adminAuditLogs').add({
        action: 'cleanup_orphan_user_records', orphanCount: orphans.length,
        deletedRecordCount: deletedPaths.length, orphanIds: orphans.map(item => item.id),
        performedByUid: admin.decoded.uid, createdAt: FieldValue.serverTimestamp(),
      })
      jsonResponse(response, 200, {
        ok: true, dryRun: false, count: orphans.length,
        deletedRecordCount: deletedPaths.length, deletedUserIds: orphans.map(item => item.id),
      })
    } catch (error) {
      jsonResponse(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
})

export const updatePlatformUser = onRequest({ region }, (request, response) => {
  corsHandler(request, response, async () => {
    if (request.method !== 'POST') {
      jsonResponse(response, 405, { ok: false, error: 'Method not allowed' })
      return
    }

    try {
      const admin = await requireAccountManager(request, { allowDirector: true })
      const payload = request.body as UpdateUserPayload
      const permissions = sanitizeManagedPermissions(admin, payload.permissions, payload.role)
      const uid = String(payload.uid || '').trim()

      if (!uid) {
        jsonResponse(response, 400, { ok: false, error: 'uid_required' })
        return
      }

      const profile = await getFirestore().collection('users').doc(uid).get()
      if (!profile.exists || profile.data()?.status === 'deleted') {
        jsonResponse(response, 404, { ok: false, error: 'user_not_found' })
        return
      }
      // A manager must not demote or disable their own account.
      if (uid === admin.decoded.uid && (
        (payload.role && payload.role !== profile.data()?.role) || payload.status === 'inactive'
      )) {
        jsonResponse(response, 403, { ok: false, error: 'self_lockout' })
        return
      }
      // Nobody changes their own access: a limit one manager puts on another has to stick, and a manager must not
      // be able to remove their own Manage team access. Saving your own details sends no permissions at all.
      if (uid === admin.decoded.uid && payload.permissions !== undefined) {
        jsonResponse(response, 403, { ok: false, error: 'self_permissions' })
        return
      }

      if (admin.role !== 'systemadmin' && (profile.data()?.role === 'systemadmin' || payload.role === 'systemadmin')) {
        jsonResponse(response, 403, { ok: false, error: 'permission_denied' })
        return
      }
      if (
        !canManageProjectStaff(admin, profile.data()?.role, profile.data()?.companyCode)
        || !canManageProjectStaff(admin, payload.role || profile.data()?.role, payload.companyCode || profile.data()?.companyCode)
      ) {
        jsonResponse(response, 403, { ok: false, error: 'permission_denied' })
        return
      }

      const name = String(payload.name || '').trim()
      const status = payload.status === 'inactive' ? 'inactive' : 'active'
      try {
        await getAuth().updateUser(uid, { displayName: name || undefined, disabled: status === 'inactive' })
      } catch (error) {
        if ((error as { code?: string })?.code === 'auth/user-not-found') {
          jsonResponse(response, 404, { ok: false, error: 'user_not_found' })
          return
        }
        throw error
      }

      const updates = {
        name,
        displayName: name,
        role: payload.role || profile.data()?.role || 'incubatee',
        status,
        active: status === 'active',
        companyCode: String(payload.companyCode || '').trim(),
        // null clears the override so the person follows their role's default permissions again. Not sent means
        // unchanged: writing `[]` here would strip every feature from someone on their role's defaults.
        ...(payload.permissions === undefined ? {} : { permissions: payload.permissions === null ? FieldValue.delete() : permissions || [] }),
        phone: String(payload.phone || '').trim() || null,
        alternativePhone: String(payload.alternativePhone || '').trim() || null,
        phoneIsWhatsApp: payload.phoneIsWhatsApp === true,
        alternativePhoneIsWhatsApp: payload.alternativePhoneIsWhatsApp === true,
        phoneProvider: String(payload.phoneProvider || '').trim() || null,
        whatsappPhoneNumbers: whatsappNumbersFromPayload(payload),
        ...(Array.isArray(payload.assignedProgramIds)
          ? { assignedProgramIds: await companyProgramIds(getFirestore(), payload.companyCode || profile.data()?.companyCode, payload.assignedProgramIds) }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      }

      await Promise.all([
        getFirestore().collection('users').doc(uid).set(updates, { merge: true }),
        getFirestore().collection('userIdentities').doc(uid).set(updates, { merge: true }),
        ...(updates.companyCode ? [ensureCompanyRecord(getFirestore(), updates.companyCode, admin.decoded.uid)] : []),
      ])

      jsonResponse(response, 200, { ok: true, uid })
    } catch (error) {
      jsonResponse(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
})

type AdminPasswordResetPayload = {
  uid?: string
  email?: string
  sendEmail?: boolean
}

type PasswordResetRequestPayload = {
  email?: string
}

type ResendEmailDeliveryLogPayload = {
  logId?: string
  mailId?: string
}

type SystemSettingsChangeReviewPayload = {
  requestId?: string
  decision?: 'approved' | 'declined'
  adminResponse?: string
}

type LegacyCallableRequest<T> = {
  auth?: { uid?: string }
  data: T
}

const companyChangeRequestAdminEmail = 'daniel@quantilytix.co.za'

function buildCompanyChangeRequestAdminTemplate(input: {
  companyName: string
  companyCode: string
  requesterEmail: string
  reason: string
}) {
  const subject = `Company setup change request: ${input.companyName || input.companyCode}`
  const text = [
    'A company setup change request is waiting for review.',
    '',
    `Company: ${input.companyName || input.companyCode}`,
    `Company code: ${input.companyCode || 'Not recorded'}`,
    `Requested by: ${input.requesterEmail || 'Not recorded'}`,
    '',
    'Request:',
    input.reason,
    '',
    'Open Smart Incubation and go to Admin > Change Requests to accept or decline it.',
  ].join('\n')
  const html = `
    <p>A company setup change request is waiting for review.</p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:14px;margin:16px 0;">
      <p style="margin:0;"><strong>Company:</strong> ${escapeHtml(input.companyName || input.companyCode)}</p>
      <p style="margin:6px 0 0;"><strong>Company code:</strong> ${escapeHtml(input.companyCode || 'Not recorded')}</p>
      <p style="margin:6px 0 0;"><strong>Requested by:</strong> ${escapeHtml(input.requesterEmail || 'Not recorded')}</p>
    </div>
    <p><strong>Request:</strong></p>
    <p>${escapeHtml(input.reason).replaceAll('\n', '<br />')}</p>
    <p style="color:#6b7280;font-size:13px;">Open Smart Incubation and go to Admin &gt; Change Requests to accept or decline it.</p>
  `

  return { subject, text, html }
}

// Labels for the settings a director changes directly (src/services/companySettingsEditService.ts).
const directSettingLabels: Record<string, string> = {
  consultantLabel: 'What you call facilitators',
  interventionDeliveryRoles: 'Who delivers interventions',
  assignmentModel: 'Who assigns interventions',
  smeDivisionModel: 'How SMEs are divided among facilitators',
  hasDepartments: 'Departments',
  hasBranches: 'Branches or offices',
}

const describeSettingValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 'Not set'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(String).join(', ')
  return String(value)
}

function buildCompanySettingChangedTemplate(input: {
  companyName: string
  companyCode: string
  changedBy: string
  field: string
  from: unknown
  to: unknown
}) {
  const setting = directSettingLabels[input.field] || input.field
  const subject = `Company setting changed: ${input.companyName || input.companyCode}`
  const change = `${setting}: ${describeSettingValue(input.from)} → ${describeSettingValue(input.to)}`
  const text = [
    'A director changed a company setting. No action is needed unless it looks wrong.',
    '',
    `Company: ${input.companyName || input.companyCode}`,
    `Company code: ${input.companyCode || 'Not recorded'}`,
    `Changed by: ${input.changedBy || 'Not recorded'}`,
    '',
    change,
  ].join('\n')
  const html = `
    <p>A director changed a company setting. No action is needed unless it looks wrong.</p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:14px;margin:16px 0;">
      <p style="margin:0;"><strong>Company:</strong> ${escapeHtml(input.companyName || input.companyCode)}</p>
      <p style="margin:6px 0 0;"><strong>Company code:</strong> ${escapeHtml(input.companyCode || 'Not recorded')}</p>
      <p style="margin:6px 0 0;"><strong>Changed by:</strong> ${escapeHtml(input.changedBy || 'Not recorded')}</p>
    </div>
    <p>${escapeHtml(change)}</p>
    <p style="color:#6b7280;font-size:13px;">The change is listed under Admin &gt; Change Requests.</p>
  `
  return { subject, text, html }
}

function buildCompanyChangeRequestResponseTemplate(input: {
  companyName: string
  decision: 'approved' | 'declined'
  adminResponse: string
}) {
  const approved = input.decision === 'approved'
  const subject = approved
    ? `Company setup change approved: ${input.companyName || 'Smart Incubation'}`
    : `Company setup change declined: ${input.companyName || 'Smart Incubation'}`
  const text = [
    `Your company setup change request has been ${approved ? 'approved' : 'declined'}.`,
    '',
    input.adminResponse,
    '',
    'You can view this response in Settings > Change Requests.',
    '',
    'Kind regards,',
    'Smart Incubation Team',
  ].join('\n')
  const html = `
    <p>Your company setup change request has been <strong>${approved ? 'approved' : 'declined'}</strong>.</p>
    <p>${escapeHtml(input.adminResponse).replaceAll('\n', '<br />')}</p>
    <p style="color:#6b7280;font-size:13px;">You can view this response in Settings &gt; Change Requests.</p>
    <p style="margin-top:22px;">Kind regards,<br /><strong>Smart Incubation Team</strong></p>
  `

  return { subject, text, html }
}

async function requireCallableAccountManager(request: LegacyCallableRequest<unknown>) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'not_authenticated')

  const snapshot = await getFirestore().collection('users').doc(uid).get()
  const role = String(snapshot.data()?.role || '').trim().toLowerCase()
  if (!['systemadmin', 'projectadmin', 'operations'].includes(role)) {
    throw new HttpsError('permission-denied', 'permission_denied')
  }

  return {
    decoded: { uid },
    role,
    companyCode: String(snapshot.data()?.companyCode || '').trim(),
    isPlatformAdmin: role === 'systemadmin',
  }
}

async function sendAdminPasswordResetCallable(
  request: LegacyCallableRequest<AdminPasswordResetPayload>,
  source = 'sendSystemPasswordResetEmail',
) {
  const admin = await requireCallableAccountManager(request)
  const payload = request.data || {}
  let userRecord = null

  if (payload.uid) {
    userRecord = await getAuth().getUser(String(payload.uid))
  } else if (payload.email) {
    userRecord = await getAuth().getUserByEmail(normalizeEmail(payload.email))
  }

  if (!userRecord?.email) {
    throw new HttpsError('invalid-argument', 'uid_or_email_required')
  }

  const targetProfile = await getFirestore().collection('users').doc(userRecord.uid).get()
  if (admin.role !== 'systemadmin' && targetProfile.data()?.role === 'systemadmin') {
    throw new HttpsError('permission-denied', 'permission_denied')
  }
  if (!canManageProjectStaff(admin, targetProfile.data()?.role, targetProfile.data()?.companyCode)) {
    throw new HttpsError('permission-denied', 'permission_denied')
  }

  const resetLink = buildPasswordActionUrl(await getAuth().generatePasswordResetLink(userRecord.email))
  if (payload.sendEmail !== false) {
    await queueTemplateMail({
      to: userRecord.email,
      source,
      template: buildAuthActionTemplate({
        title: 'Reset your Smart Incubation password',
        name: userRecord.displayName,
        intro: 'A workspace administrator requested a password reset for your Smart Incubation account. Use the secure link below to choose a new password.',
        actionLabel: 'Reset password',
        actionUrl: resetLink,
        expiryNote: 'If you did not expect this email, contact your programme administrator.',
      }),
    })
  }

  return { ok: true, uid: userRecord.uid, resetLink }
}

async function deleteUserAndFirestoreCallable(request: LegacyCallableRequest<DeleteUserPayload>) {
  const admin = await requireCallableAccountManager(request)
  const payload = request.data || {}
  let uid = String(payload.uid || '').trim()

  if (!uid && payload.email) {
    uid = (await getAuth().getUserByEmail(normalizeEmail(payload.email))).uid
  }

  if (!uid) {
    throw new HttpsError('invalid-argument', 'uid_or_email_required')
  }

  const db = getFirestore()
  const targetProfile = await db.collection('users').doc(uid).get()
  if (admin.role !== 'systemadmin' && targetProfile.data()?.role === 'systemadmin') {
    throw new HttpsError('permission-denied', 'permission_denied')
  }
  if (!canManageProjectStaff(admin, targetProfile.data()?.role, targetProfile.data()?.companyCode)) {
    throw new HttpsError('permission-denied', 'permission_denied')
  }

  await getAuth().deleteUser(uid).catch(error => {
    if (!String(error?.message || '').includes('no user record')) throw error
  })

  await Promise.all([
    db.collection('users').doc(uid).delete(),
    db.collection('userIdentities').doc(uid).delete(),
    db.collection('participants').doc(uid).delete(),
  ])

  return { ok: true, uid }
}

async function createManagedUserCallable(request: LegacyCallableRequest<PlatformUserPayload>) {
  const admin = await requireCallableAccountManager(request)
  const payload = request.data || {}
  const permissions = sanitizeManagedPermissions(admin, payload.permissions, payload.role)

  if (admin.role !== 'systemadmin' && payload.role === 'systemadmin') {
    throw new HttpsError('permission-denied', 'permission_denied')
  }
  if (!canManageProjectStaff(admin, payload.role, payload.companyCode)) {
    throw new HttpsError('permission-denied', 'permission_denied')
  }

  const email = normalizeEmail(payload.email)
  const name = String(payload.name || email)
  if (!isValidEmail(email)) {
    throw new HttpsError('invalid-argument', 'email_required')
  }

  let userRecord
  try {
    userRecord = await getAuth().getUserByEmail(email)
    if (!payload.allowExisting) {
      throw new HttpsError('already-exists', 'email_already_exists')
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    userRecord = await getAuth().createUser({
      email,
      displayName: name,
      emailVerified: false,
      disabled: false,
    })
  }

  const resetLink = payload.sendResetLink
    ? buildPasswordActionUrl(await getAuth().generatePasswordResetLink(email), { invite: true })
    : null
  const userDoc = {
    uid: userRecord.uid,
    email,
    name,
    displayName: name,
    role: payload.role || 'user',
    companyCode: payload.companyCode || null,
    jobTitle: payload.jobTitle || null,
    assignedBranch: payload.assignedBranch || null,
    branchId: payload.assignedBranch || null,
    assignedProgramIds: payload.assignedProgramIds || [],
    assignedPrograms: payload.assignedPrograms || [],
    ...(permissions ? { permissions } : {}),
    mustChangePassword: true,
    active: true,
    status: 'active',
    updatedAt: FieldValue.serverTimestamp(),
  }
  const db = getFirestore()
  await Promise.all([
    db.collection('users').doc(userRecord.uid).set({
      ...userDoc,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
    db.collection('userIdentities').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email,
      name,
      displayName: name,
      role: payload.role || 'user',
      companyCode: payload.companyCode || null,
      assignedBranch: payload.assignedBranch || null,
      branchId: payload.assignedBranch || null,
      ...(permissions ? { permissions } : {}),
      mustChangePassword: true,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ])

  if (payload.sendEmail && resetLink) {
    await queueTemplateMail({
      to: email,
      source: 'createManagedUser',
      template: buildAuthActionTemplate({
        title: 'Your Smart Incubation account is ready',
        name,
        intro: 'Your Smart Incubation workspace account has been created. Use the secure link below to set your password and continue.',
        actionLabel: 'Set your password',
        actionUrl: resetLink,
        expiryNote: 'This account setup link is time-sensitive. Contact your programme administrator if you need a new invitation.',
      }),
    })
  }

  return { ok: true, uid: userRecord.uid, user: { uid: userRecord.uid, email, name }, resetLink }
}

async function updateManagedUserCallable(request: LegacyCallableRequest<UpdateUserPayload>) {
  const admin = await requireCallableAccountManager(request)
  const payload = request.data || {}
  const permissions = sanitizeManagedPermissions(admin, payload.permissions, payload.role)
  const uid = String(payload.uid || '').trim()

  if (!uid) throw new HttpsError('invalid-argument', 'uid_required')

  const profile = await getFirestore().collection('users').doc(uid).get()
  if (!profile.exists) throw new HttpsError('not-found', 'user_not_found')
  if (admin.role !== 'systemadmin' && (profile.data()?.role === 'systemadmin' || payload.role === 'systemadmin')) {
    throw new HttpsError('permission-denied', 'permission_denied')
  }
  if (
    !canManageProjectStaff(admin, profile.data()?.role, profile.data()?.companyCode)
    || !canManageProjectStaff(admin, payload.role || profile.data()?.role, payload.companyCode || profile.data()?.companyCode)
  ) {
    throw new HttpsError('permission-denied', 'permission_denied')
  }

  const name = String(payload.name || '').trim()
  const status = payload.status === 'inactive' ? 'inactive' : 'active'
  await getAuth().updateUser(uid, { displayName: name || undefined, disabled: status === 'inactive' })
  const updates = {
    name,
    displayName: name,
    role: payload.role || profile.data()?.role || 'incubatee',
    status,
    active: status === 'active',
    companyCode: String(payload.companyCode || '').trim(),
    permissions: permissions || profile.data()?.permissions || [],
    updatedAt: FieldValue.serverTimestamp(),
  }
  await Promise.all([
    getFirestore().collection('users').doc(uid).set(updates, { merge: true }),
    getFirestore().collection('userIdentities').doc(uid).set(updates, { merge: true }),
  ])

  return { ok: true, uid }
}

export const createManagedUser = onCall({ region }, request =>
  createManagedUserCallable(request as LegacyCallableRequest<PlatformUserPayload>))

export const updateManagedUser = onCall({ region }, request =>
  updateManagedUserCallable(request as LegacyCallableRequest<UpdateUserPayload>))

export const deleteUserAndFirestore = onCall({ region }, request =>
  deleteUserAndFirestoreCallable(request as LegacyCallableRequest<DeleteUserPayload>))

export const sendSystemPasswordResetEmail = onCall({ region }, request =>
  sendAdminPasswordResetCallable(request as LegacyCallableRequest<AdminPasswordResetPayload>))

export const adminResetUserPassword = onCall({ region }, request =>
  sendAdminPasswordResetCallable(request as LegacyCallableRequest<AdminPasswordResetPayload>, 'adminResetUserPassword'))

export const sendForgotPasswordEmail = onDocumentCreated(
  {
    document: 'passwordResetRequests/{requestId}',
    region,
  },
  async event => {
    const requestRef = event.data?.ref
    const payload = event.data?.data() as PasswordResetRequestPayload | undefined
    const email = normalizeEmail(payload?.email)

    if (!isValidEmail(email)) {
      await requestRef?.set({
        status: 'skipped',
        reason: 'email_required',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return
    }

    try {
      const userRecord = await getAuth().getUserByEmail(email)
      if (!await reserveAuthEmailCooldown(`reset_${userRecord.uid}`)) {
        await requestRef?.set({
          status: 'throttled',
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
        return
      }

      const link = buildPasswordActionUrl(await getAuth().generatePasswordResetLink(email))
      const mailRef = await queueTemplateMail({
        to: email,
        source: 'sendForgotPasswordEmail',
        template: buildAuthActionTemplate({
          title: 'Reset your Smart Incubation password',
          name: userRecord.displayName,
          intro: 'We received a request to reset your Smart Incubation password. Use the secure link below to choose a new password.',
          actionLabel: 'Reset password',
          actionUrl: link,
          expiryNote: 'If you did not request a password reset, you can ignore this email. Your password will remain unchanged.',
        }),
      })

      await requestRef?.set({
        status: 'queued',
        mailId: mailRef.id,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await requestRef?.set({
        status: message.includes('auth/user-not-found') ? 'skipped' : 'failed',
        reason: message.includes('auth/user-not-found') ? 'user_not_found' : message,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })

      if (!message.includes('auth/user-not-found')) throw error
    }
  },
)

export const sendUserVerificationEmail = onCall({ region }, async request => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'not_authenticated')

  const userRecord = await getAuth().getUser(request.auth.uid)
  if (!userRecord.email) throw new HttpsError('invalid-argument', 'email_required')
  if (userRecord.emailVerified) return { ok: true, verified: true }
  if (!await reserveAuthEmailCooldown(`verify_${request.auth.uid}`)) {
    return { ok: true, throttled: true }
  }

  const link = buildEmailVerificationActionUrl(
    await getAuth().generateEmailVerificationLink(userRecord.email),
  )
  await queueTemplateMail({
    to: userRecord.email,
    source: 'sendUserVerificationEmail',
    template: buildAuthActionTemplate({
      title: 'Verify your Smart Incubation email',
      name: userRecord.displayName,
      intro: 'Confirm your email address to finish securing your Smart Incubation account.',
      actionLabel: 'Verify email address',
      actionUrl: link,
      expiryNote: 'This verification link is time-sensitive. If it expires, request a new email from the workspace.',
    }),
  })

  return { ok: true }
})

export const sendSystemEmail = onCall({ region }, async request => {
  const admin = await requireCallableAccountManager(request as LegacyCallableRequest<unknown>)
  if (!admin.isPlatformAdmin) throw new HttpsError('permission-denied', 'permission_denied')

  const payload = (request.data || {}) as { to?: string, subject?: string, message?: string }
  const to = normalizeEmail(payload.to)
  const subject = String(payload.subject || '').trim()
  const message = String(payload.message || '').trim()

  if (!isValidEmail(to)) throw new HttpsError('invalid-argument', 'invalid_email')
  if (!subject || !message) throw new HttpsError('invalid-argument', 'subject_and_message_required')
  if (await getSuppressedEmail(to)) throw new HttpsError('failed-precondition', 'recipient_suppressed')

  const ref = await getFirestore().collection('mail').add({
    to: [to],
    source: 'sendSystemEmail',
    message: {
      subject,
      text: message,
      html: `<p>${escapeHtml(message).replaceAll('\n', '<br />')}</p>`,
    },
    createdAt: FieldValue.serverTimestamp(),
    createdBy: admin.decoded.uid,
  })

  return { ok: true, id: ref.id }
})

export const notifyCompanySettingsChangeRequest = onDocumentCreated(
  {
    document: 'systemSettingsChangeRequests/{requestId}',
    region,
  },
  async event => {
    const data = event.data?.data() || {}
    const reason = String(data.reason || '').trim()
    const companyCode = String(data.companyCode || '').trim()
    const requesterEmail = normalizeEmail(data.requestedByEmail)

    if (!reason || !companyCode) return

    const template = buildCompanyChangeRequestAdminTemplate({
      companyName: String(data.companyName || companyCode),
      companyCode,
      requesterEmail,
      reason,
    })

    const mailRef = await queueTemplateMail({
      to: companyChangeRequestAdminEmail,
      source: 'companySettingsChangeRequestAdminNotification',
      template,
    })

    await event.data?.ref.set({
      adminNotificationMailId: mailRef.id,
      adminNotificationQueuedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  },
)

// A director changed a company setting directly: tell the platform admin (they no longer approve these).
export const notifyCompanySettingsChange = onDocumentCreated(
  {
    document: 'companySettingsChanges/{changeId}',
    region,
  },
  async event => {
    const data = event.data?.data() || {}
    const companyCode = String(data.companyCode || '').trim()
    const field = String(data.field || '').trim()
    if (!companyCode || !field) return

    const template = buildCompanySettingChangedTemplate({
      companyName: String(data.companyName || companyCode),
      companyCode,
      changedBy: String(data.changedByName || '') + (data.changedByEmail ? ` (${normalizeEmail(data.changedByEmail)})` : ''),
      field,
      from: data.from,
      to: data.to,
    })

    const mailRef = await queueTemplateMail({
      to: companyChangeRequestAdminEmail,
      source: 'companySettingsDirectChangeAdminNotification',
      template,
    })

    await event.data?.ref.set({
      adminNotificationMailId: mailRef.id,
      adminNotificationQueuedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  },
)

export const reviewSystemSettingsChangeRequest = onCall({ region }, async request => {
  const admin = await requireCallableAccountManager(request as LegacyCallableRequest<unknown>)
  if (!admin.isPlatformAdmin) throw new HttpsError('permission-denied', 'permission_denied')

  const payload = (request.data || {}) as SystemSettingsChangeReviewPayload
  const requestId = String(payload.requestId || '').trim()
  const decision = payload.decision
  const adminResponse = String(payload.adminResponse || '').trim()

  if (!requestId) throw new HttpsError('invalid-argument', 'request_id_required')
  if (decision !== 'approved' && decision !== 'declined') throw new HttpsError('invalid-argument', 'valid_decision_required')
  if (!adminResponse) throw new HttpsError('invalid-argument', 'admin_response_required')

  const db = getFirestore()
  const requestRef = db.collection('systemSettingsChangeRequests').doc(requestId)
  const adminUser = await getAuth().getUser(admin.decoded.uid).catch(() => null)

  const updated = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(requestRef)
    if (!snapshot.exists) throw new HttpsError('not-found', 'request_not_found')
    const data = snapshot.data() || {}
    if (String(data.status || 'pending') !== 'pending') {
      throw new HttpsError('failed-precondition', 'request_already_reviewed')
    }

    transaction.set(requestRef, {
      status: decision,
      adminResponse,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedByUid: admin.decoded.uid,
      reviewedByEmail: adminUser?.email || '',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    const companyCode = String(data.companyCode || '').trim()
    const allowedDeliveryRoles = new Set(['consultant', 'projectadmin', 'operations'])
    const requestedDeliveryRoles = Array.isArray(data.requestedInterventionDeliveryRoles)
      ? data.requestedInterventionDeliveryRoles.map((role: unknown) => String(role || '').trim().toLowerCase()).filter((role: string) => allowedDeliveryRoles.has(role))
      : []
    if (decision === 'approved' && companyCode && requestedDeliveryRoles.length) {
      transaction.set(db.collection('companies').doc(companyCode), {
        companyCode,
        name: String(data.companyName || companyCode),
        interventionDeliveryRoles: requestedDeliveryRoles,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: admin.decoded.uid,
      }, { merge: true })
    }

    return {
      requesterEmail: normalizeEmail(data.requestedByEmail),
      companyName: String(data.companyName || data.companyCode || 'Smart Incubation'),
    }
  })

  if (isValidEmail(updated.requesterEmail)) {
    const template = buildCompanyChangeRequestResponseTemplate({
      companyName: updated.companyName,
      decision,
      adminResponse,
    })

    const mailRef = await queueTemplateMail({
      to: updated.requesterEmail,
      source: 'companySettingsChangeRequestResponse',
      template,
    })

    await requestRef.set({
      responseMailId: mailRef.id,
      responseQueuedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }

  return { ok: true, id: requestId, status: decision }
})

/** Director first-login: claim a company code, save the company profile and lock its settings. */
export const completeDirectorCompanySetup = onCall({ region }, async request => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'not_authenticated')
  const email = String(request.auth?.token?.email || '').toLowerCase()
  try {
    return { ok: true, ...(await completeDirectorSetup(getFirestore(), uid, email, (request.data || {}) as Record<string, never>)) }
  } catch (error) {
    if (error instanceof DirectorSetupError) {
      const map = { invalid: 'invalid-argument', forbidden: 'permission-denied', conflict: 'already-exists', not_found: 'not-found' } as const
      throw new HttpsError(map[error.code], error.message)
    }
    throw error
  }
})

const joinErrorToHttps = (error: unknown) => {
  if (error instanceof JoinError) {
    const map = { invalid: 'invalid-argument', forbidden: 'permission-denied', not_found: 'not-found' } as const
    return new HttpsError(map[error.code], error.message)
  }
  return error
}

/** Public (no sign-in): which programme and company a join link is for, shown before the SME creates an account. */
export const getProgramJoinInfo = onCall({ region }, async request => {
  try {
    return { ok: true, ...(await getProgramLinkInfo(getFirestore(), String((request.data as { programId?: unknown } | undefined)?.programId || ''))) }
  } catch (error) {
    throw joinErrorToHttps(error)
  }
})

/** Attaches the signed-in SME to a company and programme. The browser never writes its own company code. */
export const joinProgramAsSme = onCall({ region }, async request => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'not_authenticated')
  try {
    return { ok: true, ...(await joinProgram(getFirestore(), uid, (request.data || {}) as JoinInput)) }
  } catch (error) {
    throw joinErrorToHttps(error)
  }
})

/**
 * After staff move an SME's application to another programme: if that programme has no application and a set
 * list, the SME's growth plan becomes that list, already confirmed. Other programmes are left to staff.
 */
export const applyProgrammeGrowthPlan = onCall({ region }, async request => {
  const manager = await requireCallableAccountManager(request as LegacyCallableRequest<unknown>)
  const applicationId = String((request.data as { applicationId?: unknown } | undefined)?.applicationId || '').trim()
  if (!applicationId || applicationId.includes('/')) throw new HttpsError('invalid-argument', 'application_required')
  const db = getFirestore()
  const application = await db.collection('applications').doc(applicationId).get()
  if (!application.exists) throw new HttpsError('not-found', 'application_not_found')
  const data = application.data() as Record<string, unknown>
  const companyCode = String(data.companyCode || '').trim()
  if (!manager.isPlatformAdmin && companyCode !== manager.companyCode) throw new HttpsError('permission-denied', 'permission_denied')
  const programId = String(data.programId || '').trim()
  const program = programId ? (await db.collection('programs').doc(programId).get()).data() : undefined
  const participantId = String(data.participantId || data.uid || data.applicantProfileId || '').trim()

  // The SME's own programme list decides their workspace (e.g. the Training menu), so it follows the move.
  // Older records keep the login uid under uid/userId, or only share the email with the account.
  let accountUid = String(data.uid || data.userId || '').trim()
  if (!accountUid && participantId && (await db.collection('users').doc(participantId).get()).exists) accountUid = participantId
  if (!accountUid && data.email) accountUid = await getAuth().getUserByEmail(String(data.email)).then(user => user.uid).catch(() => '')
  const accountRef = accountUid ? db.collection('users').doc(accountUid) : null
  if (accountRef && programId && (await accountRef.get()).exists) {
    await accountRef.update({ assignedProgramIds: [programId], updatedAt: FieldValue.serverTimestamp() })
  }

  const plan = await buildConfirmedSetPlan(db, { program, programId, applicationId, participantId, replaceOtherProgramme: true })
  if (!plan) return { ok: true, applied: false }
  const batch = db.batch()
  // Replaces any plan from the previous programme outright, so no old confirmations or interventions linger.
  batch.set(db.collection('diagnosticPlans').doc(applicationId), plan)
  batch.update(db.collection('applications').doc(applicationId), {
    'interventions.required': forcedProgramInterventions(program),
    updatedAt: FieldValue.serverTimestamp(),
  })
  await batch.commit()
  return { ok: true, applied: true }
})

/** Accepts the signed-in SME into a no-application programme once their profile is complete. */
export const enrolInDirectProgramme = onCall({ region }, async request => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'not_authenticated')
  try {
    return { ok: true, ...(await enrolInDirectProgram(getFirestore(), uid, String((request.data as { programId?: unknown } | undefined)?.programId || ''))) }
  } catch (error) {
    throw joinErrorToHttps(error)
  }
})

export const resendEmailDeliveryLog = onCall({ region }, async request => {
  const admin = await requireCallableAccountManager(request as LegacyCallableRequest<ResendEmailDeliveryLogPayload>)
  if (!admin.isPlatformAdmin) throw new HttpsError('permission-denied', 'permission_denied')

  const payload = (request.data || {}) as ResendEmailDeliveryLogPayload
  let mailId = String(payload.mailId || '').trim()

  if (!mailId && payload.logId) {
    const logSnap = await getFirestore().collection('emailDeliveryLogs').doc(String(payload.logId)).get()
    mailId = String(logSnap.data()?.mailId || '').trim()
  }

  if (!mailId) throw new HttpsError('invalid-argument', 'mail_id_required')

  const mailSnap = await getFirestore().collection('mail').doc(mailId).get()
  if (!mailSnap.exists) throw new HttpsError('not-found', 'mail_not_found')

  await sendMailRecord(mailId, mailSnap.data() as MailRecord)
  return { ok: true, mailId }
})

function aiFunction(path: string) {
  return onRequest({ region }, (request, response) => {
    corsHandler(request, response, async () => {
      if (request.method !== 'POST') {
        jsonResponse(response, 405, { ok: false, error: 'Method not allowed' })
        return
      }

      try {
        const result = await proxyAiEndpoint(path, request)
        jsonResponse(response, result.status, result.body)
      } catch (error) {
        jsonResponse(response, 502, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
  })
}

function cleanComplianceKey(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function getRequiredDocKey(item: RequiredComplianceDoc) {
  return cleanComplianceKey(
    item.key ||
      item.presetId ||
      item.id ||
      item.title ||
      '',
  )
}

function getTimelineDocKey(item: ComplianceTimeline) {
  return cleanComplianceKey(item.key || item.type || '')
}

function isTimelineDocExpired(item: ComplianceTimeline, requirement?: RequiredComplianceDoc) {
  if (!requirement?.hasExpiry) return false

  const rawExpiryDate = item.currentFile?.expiryDate || item.expiryDate
  if (!rawExpiryDate) return false

  const parsed = new Date(String(rawExpiryDate))
  if (Number.isNaN(parsed.getTime())) return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return parsed < today
}

function getTimelineDocComputedStatus(item: ComplianceTimeline, requirement?: RequiredComplianceDoc) {
  if (isTimelineDocExpired(item, requirement)) return 'expired'
  return String(item.currentStatus || 'pending').trim().toLowerCase()
}

function isActionableComplianceStatus(status: string, includePending = false) {
  if (includePending && ['pending', 'uploaded'].includes(status)) return true
  return ['missing', 'expired', 'invalid', 'rejected', 'queried'].includes(status)
}

function complianceReminderDocumentLabel(requirement: RequiredComplianceDoc, status: string) {
  const title = requirement.title || requirement.key || requirement.id || 'Compliance document'
  if (status === 'missing') return `${title} (upload required)`
  if (status === 'expired') return `${title} (expired - replace required)`
  if (status === 'queried') return `${title} (correction requested)`
  if (['invalid', 'rejected'].includes(status)) return `${title} (replace required)`
  return `${title} (${status})`
}

function normalizeRequiredComplianceDocs(items: RequiredComplianceDoc[]) {
  return items.map(item => {
    const key = getRequiredDocKey(item)
    return {
      ...item,
      key,
      id: item.id || key,
      title: item.title || item.key || key,
      type: 'upload',
      hasExpiry: !!item.hasExpiry,
      expiryMonths: item.expiryMonths ?? null,
    }
  }).filter(item => item.key)
}

async function loadRequiredComplianceDocs(programId: string) {
  const db = getFirestore()

  const deptRequirementsSnap = await db
    .collection('programs')
    .doc(programId)
    .collection('deptRequirements')
    .get()

  const deptRequiredDocs = deptRequirementsSnap.docs.flatMap(docSnap => {
    const data = docSnap.data() || {}
    const docs = Array.isArray(data.requiredDocuments) ? data.requiredDocuments : []

    return docs.map(item => ({
      ...(item as RequiredComplianceDoc),
      departmentId: docSnap.id,
      departmentName: data.departmentName || null,
    }))
  })

  if (deptRequiredDocs.length) {
    return normalizeRequiredComplianceDocs(deptRequiredDocs.filter(item => !item.type || item.type === 'upload'))
  }

  const programSnap = await db.collection('programs').doc(programId).get()
  const programData = programSnap.exists ? programSnap.data() || {} : {}
  const complianceRequirements = Array.isArray(programData.complianceRequirements)
    ? programData.complianceRequirements
    : []

  return normalizeRequiredComplianceDocs(
    complianceRequirements.map((item: Record<string, unknown>) => {
      return {
        id: String(item.id || ''),
        key: String(item.id || item.name || ''),
        title: String(item.name || ''),
        type: 'upload',
        group: String(item.category || 'General'),
        requiredAt: 'program',
        hasExpiry: false,
        expiryMonths: null,
      } satisfies RequiredComplianceDoc
    }),
  )
}

export const chat = aiFunction('chat')
export const chatb = aiFunction('chatb')
export const agentinc = aiFunction('agentinc')
export const analytics = aiFunction('analytics')
export const validateComplianceDocument = aiFunction('compliance')

export const syncApplicationComplianceSummary = onDocumentWritten(
  {
    document: 'complianceDocuments/{complianceId}',
    region,
  },
  async event => {
    const after = event.data?.after.data() as ComplianceTimeline | undefined
    const before = event.data?.before.data() as ComplianceTimeline | undefined
    const source = after || before

    if (!source?.participantId || !source.programId) return

    const db = getFirestore()
    const participantId = source.participantId
    const programId = source.programId

    const [timelineSnap, requiredDocs] = await Promise.all([
      db
        .collection('complianceDocuments')
        .where('participantId', '==', participantId)
        .where('programId', '==', programId)
        .get(),
      loadRequiredComplianceDocs(programId),
    ])

    const timelineDocs = timelineSnap.docs.map(docSnap => ({
      id: docSnap.id,
      ...(docSnap.data() as ComplianceTimeline),
    }))

    const timelineByKey = new Map<string, ComplianceTimeline>()

    for (const item of timelineDocs) {
      const key = getTimelineDocKey(item)
      if (!key) continue

      const existing = timelineByKey.get(key)

      if (!existing) {
        timelineByKey.set(key, item)
        continue
      }

      const existingStatus = getTimelineDocComputedStatus(existing)
      const nextStatus = getTimelineDocComputedStatus(item)

      if (existingStatus !== 'valid' && nextStatus === 'valid') {
        timelineByKey.set(key, item)
      }
    }

    const required = requiredDocs.map(item => getRequiredDocKey(item)).filter(Boolean)

    const complianceDocuments = requiredDocs.map(requirement => {
      const key = getRequiredDocKey(requirement)
      const docItem = timelineByKey.get(key)
      const status = docItem ? getTimelineDocComputedStatus(docItem, requirement) : 'missing'

      return {
        key,
        type: requirement.title || requirement.key || key,
        requiredType: requirement.type || 'upload',
        group: requirement.group || null,
        status,
        fileName: docItem?.currentFile?.fileName || docItem?.fileName || null,
        url: docItem?.currentFile?.url || docItem?.url || null,
        expiryDate: docItem?.currentFile?.expiryDate || docItem?.expiryDate || null,
      }
    })

    const completed = complianceDocuments
      .filter(item => item.status === 'valid')
      .map(item => item.key)

    const missing = complianceDocuments
      .filter(item => item.status === 'missing')
      .map(item => item.key)

    const problem = complianceDocuments
      .filter(item => ['missing', 'expired', 'invalid', 'rejected'].includes(item.status))
      .map(item => item.key)

    const pending = complianceDocuments
      .filter(item => ['pending', 'uploaded', 'queried'].includes(item.status))
      .map(item => item.key)

    const score = required.length
      ? Math.round((completed.length / required.length) * 100)
      : 0

    const appSnap = await db
      .collection('applications')
      .where('participantId', '==', participantId)
      .where('programId', '==', programId)
      .limit(1)
      .get()

    if (appSnap.empty) return

    await appSnap.docs[0].ref.set(
      {
        compliance: {
          summary: {
            required,
            completed,
            missing,
            pending,
            problem,
            score,
            totalRequired: required.length,
            totalCompleted: completed.length,
            totalMissing: missing.length,
            totalPending: pending.length,
            totalProblem: problem.length,
            source: 'complianceDocuments',
            updatedAt: FieldValue.serverTimestamp(),
          },
          documents: complianceDocuments,
        },
      },
      { merge: true },
    )
  },
)

export const sendComplianceDocumentUploadReminders = onRequest({ region }, (request, response) => {
  corsHandler(request, response, async () => {
    if (request.method !== 'POST') {
      jsonResponse(response, 405, { ok: false, error: 'Method not allowed' })
      return
    }

    try {
      const manager = await requireAccountManager(request)
      const payload = request.body as ComplianceDocumentReminderPayload
      const db = getFirestore()
      const participantIds = new Set(
        [
          payload.participantId,
          ...(Array.isArray(payload.participantIds) ? payload.participantIds : []),
        ]
          .map(item => String(item || '').trim())
          .filter(Boolean),
      )
      const programId = String(payload.programId || '').trim()
      const includePending = payload.includePending === true
      let participantQuery: FirebaseFirestore.Query = db.collection('participants')

      if (programId) {
        participantQuery = participantQuery.where('programId', '==', programId)
      }

      if (!manager.isPlatformAdmin && manager.companyCode) {
        participantQuery = participantQuery.where('companyCode', '==', manager.companyCode)
      }

      const participantsSnap = await participantQuery.get()
      const participants = participantsSnap.docs.filter(docSnap => {
        if (!participantIds.size) return true
        const data = docSnap.data() || {}
        const participantId = String(data.participantId || data.uid || docSnap.id)
        return participantIds.has(docSnap.id) || participantIds.has(participantId)
      })

      if (participantIds.size && !participants.length) {
        jsonResponse(response, 404, { ok: false, error: 'participants_not_found' })
        return
      }

      const requiredByProgram = new Map<string, RequiredComplianceDoc[]>()
      const programNameById = new Map<string, string>()

      const results = await Promise.all(participants.map(async participantSnap => {
        const participant = participantSnap.data() || {}
        const participantId = String(participant.participantId || participant.uid || participantSnap.id)
        const participantProgramId = String(participant.programId || programId || '').trim()
        const email = normalizeEmail(participant.email || participant.contactEmail || participant.ownerEmail)
        const participantName = String(participant.businessName || participant.participantName || participant.name || 'SME')

        if (!participantProgramId) {
          return { participantId, participantName, status: 'skipped', reason: 'missing_program' }
        }

        if (!email || !isValidEmail(email)) {
          return { participantId, participantName, email, status: 'skipped', reason: 'invalid_email' }
        }

        if (!requiredByProgram.has(participantProgramId)) {
          requiredByProgram.set(participantProgramId, await loadRequiredComplianceDocs(participantProgramId))
        }

        if (!programNameById.has(participantProgramId)) {
          if (payload.programName) {
            programNameById.set(participantProgramId, String(payload.programName))
          } else {
            const programSnap = await db.collection('programs').doc(participantProgramId).get()
            const programData = programSnap.data() || {}
            programNameById.set(participantProgramId, String(programData.name || programData.programName || programData.title || 'your programme'))
          }
        }

        const requiredDocs = requiredByProgram.get(participantProgramId) || []
        const timelineSnap = await db
          .collection('complianceDocuments')
          .where('participantId', '==', participantId)
          .where('programId', '==', participantProgramId)
          .get()
        const timelineByKey = new Map<string, ComplianceTimeline>()

        timelineSnap.docs.forEach(docSnap => {
          const item = docSnap.data() as ComplianceTimeline
          const key = getTimelineDocKey(item)
          if (!key) return

          const existing = timelineByKey.get(key)
          if (!existing || (getTimelineDocComputedStatus(existing) !== 'valid' && getTimelineDocComputedStatus(item) === 'valid')) {
            timelineByKey.set(key, item)
          }
        })

        const documents = requiredDocs.flatMap(requirement => {
          const key = getRequiredDocKey(requirement)
          const status = timelineByKey.has(key)
            ? getTimelineDocComputedStatus(timelineByKey.get(key) as ComplianceTimeline, requirement)
            : 'missing'

          return isActionableComplianceStatus(status, includePending)
            ? [complianceReminderDocumentLabel(requirement, status)]
            : []
        })

        if (!documents.length) {
          return { participantId, participantName, email, status: 'skipped', reason: 'no_actionable_documents' }
        }

        const suppression = await getSuppressedEmail(email)

        if (suppression) {
          await db.collection('emailDeliveryLogs').add({
            source: payload.source || 'complianceDocumentUploadReminder',
            status: 'skipped',
            reason: 'suppressed',
            email,
            participantId,
            participantName,
            programId: participantProgramId,
            programName: programNameById.get(participantProgramId),
            documents,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: manager.decoded.uid,
          })
          return { participantId, participantName, email, status: 'skipped', reason: 'suppressed' }
        }

        const template = buildComplianceReminderTemplate({
          firstName: getFirstName({
            email,
            name: String(participant.participantName || participant.name || participant.businessName || ''),
            participantName,
            documents,
          }),
          programName: programNameById.get(participantProgramId) || 'your programme',
          documents,
        })

        const mailRef = await db.collection('mail').add({
          to: [email],
          message: {
            subject: template.subject,
            text: template.text,
            html: template.html,
          },
          meta: {
            templateId: 'compliance-document-upload-reminder',
            participantId,
            participantName,
            programId: participantProgramId,
            programName: programNameById.get(participantProgramId) || null,
            documents,
          },
          createdAt: FieldValue.serverTimestamp(),
          createdBy: manager.decoded.uid,
          source: payload.source || 'complianceDocumentUploadReminder',
        })

        await db.collection('emailDeliveryLogs').add({
          source: payload.source || 'complianceDocumentUploadReminder',
          status: 'queued',
          email,
          participantId,
          participantName,
          programId: participantProgramId,
          programName: programNameById.get(participantProgramId),
          documents,
          mailId: mailRef.id,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: manager.decoded.uid,
        })

        return { participantId, participantName, email, status: 'queued', mailId: mailRef.id, documents }
      }))

      jsonResponse(response, 200, {
        ok: true,
        queued: results.filter(item => item.status === 'queued').length,
        skipped: results.filter(item => item.status === 'skipped').length,
        results,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      jsonResponse(response, message === 'permission_denied' ? 403 : 401, { ok: false, error: message })
    }
  })
})

const buildDeadlineDigestDeps = (overrides: Partial<DigestDeps> = {}): DigestDeps => ({
  db: getFirestore(),
  appUrl: getAppBaseUrl(),
  sendEmail: async (to, template) => {
    const email = normalizeEmail(to)
    if (!isValidEmail(email)) return 'invalid'
    if (await getSuppressedEmail(email)) return 'suppressed'
    await queueTemplateMail({ to: email, source: 'interventionDeadlineDigest', template })
    return 'queued'
  },
  sendWhatsApp: sendWhatsAppAlert,
  ...overrides,
})

/**
 * Every morning (05:15 UTC): nudge facilitators whose completed interventions are due a follow-up outcome check,
 * then ask the SMEs for their own check-back on the same rounds (in the app, and on WhatsApp where they opted in).
 */
export const notifyInterventionFollowUps = onSchedule(
  { schedule: '15 5 * * *', timeZone: 'Etc/UTC', region, timeoutSeconds: 300 },
  async () => {
    await runFollowUpReminders({ db: getFirestore(), appUrl: getAppBaseUrl(), sendWhatsApp: sendWhatsAppAlert })
    await runSmeCheckbackAsks({ db: getFirestore(), sendCheckbackTemplate: sendSmeCheckbackTemplate, sendWhatsAppAlert })
  },
)

/** Every morning (05:00 UTC, 07:00 in South Africa): tell operations about overdue and near-due interventions. */
export const notifyInterventionDeadlines = onSchedule(
  { schedule: '0 5 * * *', timeZone: 'Etc/UTC', region, timeoutSeconds: 300 },
  async () => {
    await runInterventionDeadlineDigest(buildDeadlineDigestDeps())
  },
)

/**
 * Manual trigger for the same digest (POST, signed-in operations / project admin / admin). Body options:
 * { dryRun: true } to count without sending, { force: true } to resend today's digest.
 * Non-platform users only ever run it for their own company.
 */
export const runInterventionDeadlineDigestNow = onRequest({ region, timeoutSeconds: 300 }, (request, response) => {
  corsHandler(request, response, async () => {
    if (request.method !== 'POST') {
      jsonResponse(response, 405, { ok: false, error: 'Method not allowed' })
      return
    }
    try {
      const manager = await requireAccountManager(request)
      const body = (request.body || {}) as { dryRun?: boolean, force?: boolean }
      const result = await runInterventionDeadlineDigest(buildDeadlineDigestDeps({
        dryRun: body.dryRun === true,
        force: body.force === true,
        ...(manager.isPlatformAdmin ? {} : { companyCode: manager.companyCode }),
      }))
      jsonResponse(response, 200, { ok: true, ...result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      jsonResponse(response, message === 'permission_denied' ? 403 : message === 'not_authenticated' ? 401 : 500, { ok: false, error: message })
    }
  })
})

// ---------------------------------------------------------------------------
// Facilitators picking up their own work (see availableWork.ts)
// ---------------------------------------------------------------------------

/** What the signed-in facilitator can pick up: their programmes and areas, nothing anyone is already on. */
export const listFacilitatorAvailableWork = onCall({ region }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to see available work.')
  try {
    return await listAvailableWork(getFirestore(), request.auth.uid)
  } catch (error) {
    if (error instanceof AvailableWorkError) throw new HttpsError(error.code, error.message)
    throw error
  }
})

/** The facilitator picks up one intervention (or its next step); the first to do so gets it. */
export const claimFacilitatorWork = onCall({ region }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to pick up work.')
  const data = (request.data || {}) as { participantId?: unknown, interventionId?: unknown, stepId?: unknown }
  try {
    return await claimAvailableWork(getFirestore(), request.auth.uid, {
      participantId: String(data.participantId || ''),
      interventionId: String(data.interventionId || ''),
      stepId: data.stepId ? String(data.stepId) : null,
    })
  } catch (error) {
    if (error instanceof AvailableWorkError) throw new HttpsError(error.code, error.message)
    throw error
  }
})

// Consultant marketplace: plans, alerts and the unanswered-request nudge (see marketplace.ts)
// ---------------------------------------------------------------------------

const buildMarketplaceDeps = (): MarketplaceDeps => ({
  db: getFirestore(),
  appUrl: getAppBaseUrl(),
  sendEmail: async (input) => {
    const email = normalizeEmail(input.to)
    if (!isValidEmail(email) || await getSuppressedEmail(email)) return false
    const template = buildAuthActionTemplate({ title: input.subject, name: input.name, intro: input.intro, actionLabel: input.actionLabel, actionUrl: input.actionUrl, expiryNote: '' })
    await queueTemplateMail({ to: email, source: input.source, template: { ...template, subject: input.subject } })
    return true
  },
  sendWhatsApp: sendWhatsAppAlert,
})

/** The SME accepts a consultant's plan: the plan's interventions are created for the consultant. */
export const acceptConnectionPlan = onCall({ region }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to accept this plan.')
  const requestId = String((request.data as { requestId?: unknown } | null)?.requestId || '').trim()
  if (!requestId) throw new HttpsError('invalid-argument', 'Which request is this?')
  try {
    return { assignmentIds: await acceptPlan(getFirestore(), request.auth.uid, requestId) }
  } catch (error) {
    if (error instanceof MarketplaceError) throw new HttpsError(error.code, error.message)
    throw error
  }
})

/** Tells the other side when something happens on a marketplace request. */
export const notifyConnectionRequestChange = onDocumentWritten({ document: 'connectionRequests/{requestId}', region }, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() as Record<string, unknown> : null
  const after = event.data?.after?.exists ? event.data.after.data() as Record<string, unknown> : null
  await notifyChange(buildMarketplaceDeps(), String(event.params.requestId), before, after)
})

/** Every morning (06:00 UTC): alert operations about requests a consultant hasn't answered in 3 days. */
export const nudgeUnansweredConnectionRequests = onSchedule(
  { schedule: '0 6 * * *', timeZone: 'Etc/UTC', region, timeoutSeconds: 120 },
  async () => {
    await nudgeUnanswered(buildMarketplaceDeps())
  },
)
