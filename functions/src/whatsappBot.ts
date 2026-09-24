import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import type { Request } from 'firebase-functions/v2/https'

type HttpResponse = {
  status: (code: number) => { json: (body: unknown) => void, send: (body: string) => void }
  send: (body: string) => void
}

type Engine = 'LPH' | 'QTX'

type AiConversationState = {
  awaiting?: string | null
  appointmentId?: string | null
}

type BotState = {
  step?: string
  engine?: Engine
  participantId?: string
  contextType?: string
  appointmentId?: string
  conversation?: AiConversationState
  userId?: string
  companyCode?: string
  draft?: Record<string, string | number | null>
  updatedAt?: unknown
  authenticatedUntil?: Timestamp
  completedInteractions?: number
  lastRatingPromptAt?: Timestamp
  pendingRating?: boolean
}

type UserRecord = Record<string, unknown> & { id: string }
type Choice = { id: string, title: string, description?: string }
type OutboundMessageContext = {
  sourceEventId: string
  sourceMessageId: string
  sequence: number
  userId?: string
  companyCode?: string
}

const db = () => getFirestore()
const graphVersion = () => process.env.WHATSAPP_GRAPH_VERSION || 'v23.0'
const stateTtlMs = 30 * 60 * 1000
const authorizationTtlMs = 10 * 60 * 1000
const inboxLeaseMs = 5 * 60 * 1000
const inboxMaxAttempts = 8
const graphSendMaxAttempts = 3
const qtxAiBackendUrl = () => process.env.QTX_AI_BACKEND_URL || 'https://yoursdvniel-smart-incubation.hf.space'
const lphAiBackendUrl = () => process.env.LPH_AI_BACKEND_URL || 'https://yoursdvniel-lepharo-smart-inc.hf.space'
const lphGatewayUrl = () => String(process.env.LPH_WHATSAPP_GATEWAY_URL || '').replace(/\/$/, '')
const outboundMessageContext = new AsyncLocalStorage<OutboundMessageContext>()
const defaultRolePermissions: Record<string, string[]> = {
  systemadmin: ['assign_interventions'],
  admin: ['assign_interventions'],
  projectadmin: ['assign_interventions'],
  projectmanager: ['assign_interventions'],
  operations: ['assign_interventions'],
}

const normalize = (value: unknown) => String(value || '').trim().toLowerCase()
const normalizePhone = (value: unknown) => String(value || '').replace(/[^0-9]/g, '')
const short = (value: unknown, limit = 72) => {
  const text = String(value || '').trim()
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

const canAssign = (user: UserRecord) => {
  const role = normalize(user.role)
  const permissions = Array.isArray(user.permissions)
    ? user.permissions.map(normalize)
    : (defaultRolePermissions[role] || [])
  return permissions.includes('assign_interventions')
}

const sha256 = (value: string) => createHash('sha256').update(value).digest()
const verifyActionPin = (pin: string) => {
  const configuredHash = String(process.env.WHATSAPP_ACTION_PIN_SHA256 || '').trim().toLowerCase()
  const expected = configuredHash && /^[a-f0-9]{64}$/.test(configuredHash)
    ? Buffer.from(configuredHash, 'hex')
    : sha256(String(process.env.WHATSAPP_ACTION_PIN || ''))
  const actual = sha256(pin.trim())
  return expected.length === actual.length && timingSafeEqual(expected, actual)
    && Boolean(configuredHash || process.env.WHATSAPP_ACTION_PIN)
}

const verifySignature = (request: Request) => {
  const secret = String(process.env.WHATSAPP_APP_SECRET || '')
  if (!secret) return process.env.NODE_ENV !== 'production'
  const supplied = String(request.headers['x-hub-signature-256'] || '')
  const rawBody = request.rawBody
  if (!supplied.startsWith('sha256=') || !rawBody) return false
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

const waitForRetry = (attempt: number) => new Promise(resolve => setTimeout(resolve, 250 * (2 ** (attempt - 1))))

async function sendPayload(to: string, payload: Record<string, unknown>) {
  const token = String(process.env.WHATSAPP_ACCESS_TOKEN || '')
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '')
  if (!token || !phoneNumberId) throw new Error('WhatsApp credentials are incomplete.')

  const context = outboundMessageContext.getStore()
  const sequence = context ? context.sequence++ : 0
  const database = db()
  const outboundRef = context
    ? database.collection('whatsappOutboundMessages').doc(sha256(`${context.sourceEventId}:${sequence}`).toString('hex'))
    : database.collection('whatsappOutboundMessages').doc()
  const existing = await outboundRef.get()
  if (existing.exists && ['accepted', 'sent', 'delivered', 'read'].includes(String(existing.data()?.status || ''))) {
    return String(existing.data()?.wamid || '')
  }

  const messageType = String(payload.type || 'unknown')
  await outboundRef.set({
    recipient: normalizePhone(to),
    phoneNumberId,
    messageType,
    payload,
    status: 'queued',
    sourceEventId: context?.sourceEventId || null,
    sourceMessageId: context?.sourceMessageId || null,
    userId: context?.userId || null,
    companyCode: context?.companyCode || null,
    createdAt: existing.exists ? existing.data()?.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  const requestBody = JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload })
  let lastError = 'WhatsApp send failed.'
  let finalAttempt = 0
  for (let attempt = 1; attempt <= graphSendMaxAttempts; attempt += 1) {
    finalAttempt = attempt
    try {
      await outboundRef.set({ attempts: attempt, lastAttemptAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: requestBody,
        signal: AbortSignal.timeout(15000),
      })
      const responseText = await response.text()
      let result: { messages?: Array<{ id?: string }>, contacts?: Array<{ wa_id?: string }> } = {}
      try {
        result = JSON.parse(responseText) as typeof result
      } catch {
        result = {}
      }
      if (response.ok) {
        const wamid = String(result.messages?.[0]?.id || '')
        if (!wamid) throw new Error('WhatsApp accepted the request without returning a message ID.')
        const batch = database.batch()
        batch.set(outboundRef, {
          wamid,
          whatsappRecipientId: result.contacts?.[0]?.wa_id || null,
          status: 'accepted',
          acceptedAt: FieldValue.serverTimestamp(),
          lastError: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
        batch.set(database.collection('whatsappMessageIds').doc(sha256(wamid).toString('hex')), {
          wamid,
          outboundMessageId: outboundRef.id,
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: true })
        const metricDate = new Date().toISOString().slice(0, 10)
        batch.set(database.collection('whatsappDeliveryHealthDaily').doc(`global_${metricDate}`), {
          date: metricDate,
          scope: 'global',
          acceptedCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
        if (context?.companyCode) {
          batch.set(database.collection('whatsappDeliveryHealthDaily')
            .doc(`company_${sha256(context.companyCode).toString('hex').slice(0, 24)}_${metricDate}`), {
            date: metricDate,
            scope: 'company',
            companyCode: context.companyCode,
            acceptedCount: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true })
        }
        await batch.commit()
        return wamid
      }

      lastError = `WhatsApp send failed (${response.status}): ${short(responseText, 1000)}`
      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt === graphSendMaxAttempts) break
    } catch (error) {
      lastError = short(error instanceof Error ? error.message : String(error), 1000)
      if (attempt === graphSendMaxAttempts) break
    }
    await waitForRetry(attempt)
  }

  const failureBatch = database.batch()
  failureBatch.set(outboundRef, {
    status: 'failed', lastError, failedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  const metricDate = new Date().toISOString().slice(0, 10)
  failureBatch.set(database.collection('whatsappDeliveryHealthDaily').doc(`global_${metricDate}`), {
    date: metricDate,
    scope: 'global',
    sendFailureCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  if (context?.companyCode) {
    failureBatch.set(database.collection('whatsappDeliveryHealthDaily')
      .doc(`company_${sha256(context.companyCode).toString('hex').slice(0, 24)}_${metricDate}`), {
      date: metricDate,
      scope: 'company',
      companyCode: context.companyCode,
      sendFailureCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }
  const alertRef = database.collection('whatsappDeliveryAlerts').doc(`send_${outboundRef.id}`)
  failureBatch.set(alertRef, {
    type: 'send_failed',
    severity: 'high',
    status: 'open',
    outboundMessageId: outboundRef.id,
    companyCode: context?.companyCode || null,
    userId: context?.userId || null,
    recipientSuffix: normalizePhone(to).slice(-4),
    attempts: finalAttempt,
    error: lastError,
    openedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  failureBatch.set(database.collection('notifications').doc(`whatsapp_delivery_send_${outboundRef.id}`), {
    type: 'whatsapp_delivery_failed',
    severity: 'high',
    status: 'unread',
    companyCode: context?.companyCode || null,
    recipientRoles: ['systemadmin', 'admin'],
    message: `A WhatsApp message failed after ${finalAttempt} send attempt${finalAttempt === 1 ? '' : 's'}.`,
    source: 'whatsapp',
    deliveryAlertId: alertRef.id,
    createdAt: FieldValue.serverTimestamp(),
    readBy: {},
  }, { merge: true })
  await failureBatch.commit()
  throw new Error(lastError)
}

const sendText = async (to: string, body: string) => {
  await sendPayload(to, { type: 'text', text: { body, preview_url: false } })
}

const sendButtons = async (to: string, body: string, choices: Choice[]) => {
  await sendPayload(to, {
    type: 'interactive',
    interactive: {
      type: 'button', body: { text: short(body, 1024) },
      action: { buttons: choices.slice(0, 3).map(choice => ({ type: 'reply', reply: { id: choice.id, title: short(choice.title, 20) } })) },
    },
  })
}

const sendList = async (to: string, body: string, button: string, choices: Choice[]) => {
  await sendPayload(to, {
    type: 'interactive',
    interactive: {
      type: 'list', body: { text: short(body, 1024) },
      action: {
        button: short(button, 20),
        sections: [{ title: 'Available options', rows: choices.slice(0, 10).map(choice => ({
          id: choice.id, title: short(choice.title, 24), description: short(choice.description, 72),
        })) }],
      },
    },
  })
}

async function findUserByPhone(phone: string) {
  const direct = await db().collection('users').where('whatsappPhoneNumbers', 'array-contains', phone).limit(2).get()
  if (direct.size === 1) return { id: direct.docs[0].id, ...direct.docs[0].data() } as UserRecord
  // Handles a marked number saved in local format (for example 077...) while Meta sends
  // international digits. Only accept a unique suffix match to avoid misidentifying a user.
  const snapshot = await db().collection('users').limit(500).get()
  const suffix = phone.slice(-9)
  const matches = snapshot.docs.filter(row => {
    const data = row.data()
    const marked = [
      data.phoneIsWhatsApp === true ? data.phone : '',
      data.alternativePhoneIsWhatsApp === true ? data.alternativePhone : '',
    ]
    return marked.some(value => {
      const stored = normalizePhone(value)
      return suffix.length >= 8 && stored.length >= 8 && stored.slice(-9) === suffix
    })
  })
  if (matches.length === 1) return { id: matches[0].id, ...matches[0].data() } as UserRecord
  return null
}

const stateRef = (phone: string) => db().collection('whatsappConversations').doc(phone)

function removeUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map(item => removeUndefined(item))
      .filter(item => item !== undefined) as T
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nestedValue]) => nestedValue !== undefined)
        .map(([key, nestedValue]) => [
          key,
          removeUndefined(nestedValue),
        ]),
    ) as T
  }

  return value
}

async function saveState(phone: string, state: Partial<BotState>) {
  await stateRef(phone).set(
    {
      ...removeUndefined(state),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
}

async function clearFlow(phone: string, identity: UserRecord) {
  await stateRef(phone).set({
    userId: identity.id, companyCode: String(identity.companyCode || ''), step: 'menu', draft: {},
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

async function maybeRequestRating(to: string, phone: string) {
  const snapshot = await stateRef(phone).get()
  const state = (snapshot.data() || {}) as BotState
  const completed = Number(state.completedInteractions || 0) + 1
  const lastPrompt = state.lastRatingPromptAt?.toMillis?.() || 0
  const due = completed % 3 === 0 && Date.now() - lastPrompt >= 7 * 24 * 60 * 60 * 1000
  await saveState(phone, { completedInteractions: completed, pendingRating: due })
  if (!due) return false
  await sendList(to, 'Before you go, how would you rate this WhatsApp bot conversation?', 'Rate bot', [1, 2, 3, 4, 5].map(rating => ({
    id: `rating:${rating}`, title: `${rating} star${rating === 1 ? '' : 's'}`,
    description: rating === 1 ? 'Very poor' : rating === 5 ? 'Excellent' : undefined,
  })))
  return true
}

const roleGroup = (identity: UserRecord) => {
  const role = normalize(identity.role)
  if (role === 'incubatee') return 'incubatee'
  if (role === 'consultant') return 'consultant'
  if (['operations', 'projectadmin', 'projectmanager'].includes(role)) return 'operations'
  if (['admin', 'systemadmin'].includes(role)) return 'admin'
  return 'general'
}

const firestoreDate = (value: unknown) => {
  const date = (value as { toDate?: () => Date } | null)?.toDate?.()
  return date ? date.toLocaleDateString('en-ZA') : 'No date'
}

async function participantContext(identity: UserRecord) {
  const participantIds = new Set<string>([identity.id])
  const applicationIds = new Set<string>()
  const email = normalize(identity.email)
  const participantResults = await Promise.all([
    db().collection('participants').where('uid', '==', identity.id).limit(5).get(),
    ...(email ? [db().collection('participants').where('email', '==', email).limit(5).get()] : []),
  ])
  participantResults.forEach(result => result.docs.forEach(row => {
    participantIds.add(row.id)
    const data = row.data()
    if (data.participantId) participantIds.add(String(data.participantId))
    if (data.applicationId) applicationIds.add(String(data.applicationId))
  }))
  const applicationResults = await Promise.all([
    db().collection('applications').where('participantId', '==', identity.id).limit(10).get(),
    ...(email ? [db().collection('applications').where('email', '==', email).limit(10).get()] : []),
  ])
  applicationResults.forEach(result => result.docs.forEach(row => {
    applicationIds.add(row.id)
    if (row.data().participantId) participantIds.add(String(row.data().participantId))
  }))
  return { participantIds, applicationIds }
}

async function showDiagnosticPlan(to: string, identity: UserRecord) {
  const context = await participantContext(identity)
  const plans = new Map<string, Record<string, unknown>>()
  for (const applicationId of context.applicationIds) {
    const snapshot = await db().collection('diagnosticPlans').doc(applicationId).get()
    if (snapshot.exists) plans.set(snapshot.id, snapshot.data() || {})
  }
  if (!plans.size && identity.companyCode) {
    const snapshot = await db().collection('diagnosticPlans').where('companyCode', '==', String(identity.companyCode)).limit(100).get()
    snapshot.docs.forEach(row => {
      const data = row.data()
      if (context.participantIds.has(String(data.participantId || '')) || context.applicationIds.has(String(data.applicationId || row.id))) plans.set(row.id, data)
    })
  }
  const plan = [...plans.values()][0]
  if (!plan) {
    await sendText(to, 'I could not find a diagnostic plan linked to your account yet. Your programme team may still be preparing it.')
    return
  }
  const interventions = Array.isArray(plan.interventions) ? plan.interventions as Array<Record<string, unknown>> : []
  const titles = interventions.slice(0, 6).map((item, index) => `${index + 1}. ${item.title || item.interventionTitle || 'Intervention'}`)
  const status = String(plan.status || (plan.confirmed ? 'Confirmed' : 'In preparation'))
  await sendText(to, `Your diagnostic plan\n\nStatus: ${status}\nInterventions: ${interventions.length}\n${titles.join('\n') || 'No interventions listed yet.'}`)
}

async function scopedInterventions(identity: UserRecord) {
  const group = roleGroup(identity)
  const companyCode = String(identity.companyCode || '')
  const snapshot = companyCode
    ? await db().collection('assignedInterventions').where('companyCode', '==', companyCode).limit(150).get()
    : await db().collection('assignedInterventions').limit(150).get()
  if (group === 'incubatee') {
    const context = await participantContext(identity)
    return snapshot.docs.filter(row => context.participantIds.has(String(row.data().participantId || '')))
  }
  if (group === 'consultant') return snapshot.docs.filter(row => String(row.data().assigneeId || '') === identity.id || normalize(row.data().assigneeEmail) === normalize(identity.email))
  return snapshot.docs
}

async function showRoleInterventions(to: string, identity: UserRecord) {
  const rows = await scopedInterventions(identity)
  if (!rows.length) {
    await sendText(to, roleGroup(identity) === 'incubatee' ? 'You do not have any assigned interventions yet.' : 'No intervention assignments match your workspace scope.')
    return
  }
  const active = rows.filter(row => !['completed', 'confirmed', 'done'].includes(normalize(row.data().status || row.data().completionStatus))).length
  const lines = rows.slice(0, 8).map((row, index) => {
    const data = row.data()
    const who = roleGroup(identity) === 'incubatee' ? data.assigneeName || 'Unassigned' : data.beneficiaryName || 'SME'
    return `${index + 1}. ${data.interventionTitle || 'Intervention'} — ${who} (${data.status || 'assigned'}, ${Number(data.progress || 0)}%)`
  })
  await sendText(to, `Interventions: ${rows.length} total, ${active} active\n\n${lines.join('\n')}`)
}

async function showRoleAppointments(to: string, identity: UserRecord) {
  const group = roleGroup(identity)
  const companyCode = String(identity.companyCode || '')
  const snapshot = companyCode
    ? await db().collection('appointments').where('companyCode', '==', companyCode).limit(150).get()
    : await db().collection('appointments').limit(150).get()
  let rows = snapshot.docs
  if (group === 'incubatee') {
    const context = await participantContext(identity)
    rows = rows.filter(row => context.participantIds.has(String(row.data().participantId || '')) || normalize(row.data().participantEmail) === normalize(identity.email))
  } else if (group === 'consultant') {
    rows = rows.filter(row => String(row.data().assigneeId || '') === identity.id || normalize(row.data().assigneeEmail) === normalize(identity.email))
  }
  rows = rows.filter(row => !['cancelled', 'completed'].includes(normalize(row.data().status)))
  if (!rows.length) {
    await sendText(to, 'There are no upcoming appointments in your workspace scope.')
    return
  }
  rows.sort((a, b) => ((a.data().startTime as Timestamp | undefined)?.toMillis?.() || 0) - ((b.data().startTime as Timestamp | undefined)?.toMillis?.() || 0))
  const lines = rows.slice(0, 8).map((row, index) => {
    const data = row.data()
    return `${index + 1}. ${data.interventionTitle || 'Appointment'} — ${firestoreDate(data.startTime)} (${data.status || 'scheduled'})${group === 'incubatee' ? '' : ` · ${data.participantName || 'SME'}`}`
  })
  await sendText(to, `Upcoming appointments\n\n${lines.join('\n')}`)
}

async function showPlatformOverview(to: string) {
  const [users, ratings] = await Promise.all([
    db().collection('users').get(),
    db().collection('agentConversationRatings').limit(500).get(),
  ])
  const active = users.docs.filter(row => row.data().active !== false && normalize(row.data().status) !== 'inactive').length
  const scores = ratings.docs.map(row => Number(row.data().rating)).filter(score => Number.isFinite(score) && score >= 1 && score <= 5)
  const average = scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1) : 'No ratings'
  await sendText(to, `Platform overview\n\nUsers: ${users.size}\nActive users: ${active}\nAgent ratings: ${scores.length}\nAverage agent rating: ${average}${scores.length ? '/5' : ''}`)
}

async function menu(to: string, identity: UserRecord) {
  const group = roleGroup(identity)
  const choices: Record<string, Choice[]> = {
    incubatee: [{ id: 'action:diagnostic', title: 'My diagnostic plan' }, { id: 'action:interventions', title: 'My interventions' }, { id: 'action:appointments', title: 'My appointments' }],
    consultant: [{ id: 'action:interventions', title: 'My interventions' }, { id: 'action:appointments', title: 'My appointments' }, { id: 'action:help', title: 'Help' }],
    operations: [{ id: 'action:assign', title: 'Assign intervention' }, { id: 'action:interventions', title: 'Intervention status' }, { id: 'action:appointments', title: 'Appointments' }],
    admin: [{ id: 'action:platform', title: 'Platform overview' }, { id: 'action:interventions', title: 'Intervention status' }, { id: 'action:help', title: 'Help' }],
    general: [{ id: 'action:help', title: 'Help' }],
  }
  await sendButtons(to, 'Hi! What would you like to do today?', choices[group])
}

async function listParticipants(to: string, identity: UserRecord) {
  const companyCode = String(identity.companyCode || '')
  const snapshot = await db().collection('applications')
    .where('companyCode', '==', companyCode).limit(100).get()
  const choices = snapshot.docs.filter(row => normalize(row.data().applicationStatus) === 'accepted').map(row => {
    const data = row.data()
    return {
      id: `participant:${row.id}`,
      title: String(data.beneficiaryName || data.businessName || data.participantName || 'SME'),
      description: String(data.programName || data.email || ''),
    }
  })
  if (!choices.length) return sendText(to, 'I could not find an accepted SME in your company. Send “menu” to choose another action.')
  await sendList(to, 'Which SME should receive the intervention?', 'Choose SME', choices)
}

async function listInterventions(to: string, identity: UserRecord) {
  const snapshot = await db().collection('interventions')
    .where('companyCode', '==', String(identity.companyCode || '')).limit(50).get()
  const choices = snapshot.docs.map(row => {
    const data = row.data()
    return { id: `intervention:${row.id}`, title: String(data.interventionTitle || data.title || 'Intervention'), description: String(data.areaOfSupport || data.area || '') }
  })
  if (!choices.length) return sendText(to, 'There are no interventions configured for your company. Send “menu” to stop.')
  await sendList(to, 'Now choose the intervention.', 'Choose intervention', choices)
}

async function listAssignees(to: string, identity: UserRecord) {
  const snapshot = await db().collection('users').where('companyCode', '==', String(identity.companyCode || '')).limit(100).get()
  const allowed = new Set(['consultant', 'projectadmin', 'projectmanager', 'operations'])
  const choices = snapshot.docs.filter(row => allowed.has(normalize(row.data().role))).map(row => {
    const data = row.data()
    return { id: `assignee:${row.id}`, title: String(data.name || data.displayName || data.email || 'Delivery owner'), description: String(data.role || '') }
  })
  if (!choices.length) return sendText(to, 'I could not find an eligible delivery owner. Send “menu” to stop.')
  await sendList(to, 'Who should deliver it?', 'Choose owner', choices)
}

type IncomingMessage = {
  id?: string
  from?: string
  timestamp?: string
  type?: string
  interactive?: { button_reply?: { id?: string }, list_reply?: { id?: string } }
  text?: { body?: string }
}

type WhatsAppInboundEvent = {
  messageId?: string
  from?: string
  input?: string
  status?: string
  attempts?: number
  leaseUntil?: Timestamp
  message?: IncomingMessage
}

type IncomingMessageStatus = {
  id?: string
  status?: string
  timestamp?: string
  recipient_id?: string
  conversation?: Record<string, unknown>
  pricing?: Record<string, unknown>
  errors?: unknown[]
}

type WhatsAppStatusEvent = {
  wamid?: string
  deliveryStatus?: string
  statusTimestamp?: string
  processingStatus?: string
  attempts?: number
  leaseUntil?: Timestamp
  errors?: unknown[]
}

const messageInput = (message: IncomingMessage) => {
  if (message.type === 'interactive') {
    return String(message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || '')
  }
  return String(message.text?.body || '').trim()
}

const inboundEventId = (phoneNumberId: string, message: IncomingMessage) => {
  const stableId = String(message.id || JSON.stringify(message))
  return sha256(`${phoneNumberId}:${stableId}`).toString('hex')
}

const isAlreadyExistsError = (error: unknown) => {
  const code = (error as { code?: string | number } | null)?.code
  return code === 6 || code === '6' || code === 'already-exists'
}

async function persistInboundMessage(
  wabaId: string,
  phoneNumberId: string,
  displayPhoneNumber: string,
  message: IncomingMessage,
) {
  const from = normalizePhone(message.from)
  const input = messageInput(message)
  const status = from && input ? 'queued' : 'ignored'
  const eventId = inboundEventId(phoneNumberId, message)
  try {
    await db().collection('whatsappInboundEvents').doc(eventId).create({
      eventId,
      messageId: String(message.id || ''),
      wabaId,
      phoneNumberId,
      displayPhoneNumber,
      from,
      input,
      message,
      messageType: String(message.type || 'unknown'),
      status,
      attempts: 0,
      ignoredReason: status === 'ignored' ? 'unsupported_or_empty_message' : null,
      messageTimestamp: message.timestamp || null,
      receivedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return status
  } catch (error) {
    if (isAlreadyExistsError(error)) return 'duplicate'
    throw error
  }
}

async function persistMessageStatus(
  wabaId: string,
  phoneNumberId: string,
  displayPhoneNumber: string,
  status: IncomingMessageStatus,
) {
  const wamid = String(status.id || '')
  const deliveryStatus = normalize(status.status)
  if (!wamid || !deliveryStatus) return 'status_ignored'
  const eventId = sha256(`${wamid}:${deliveryStatus}:${status.timestamp || ''}`).toString('hex')
  try {
    await db().collection('whatsappMessageStatusEvents').doc(eventId).create({
      eventId,
      wamid,
      deliveryStatus,
      statusTimestamp: status.timestamp || null,
      recipientId: normalizePhone(status.recipient_id),
      wabaId,
      phoneNumberId,
      displayPhoneNumber,
      conversation: status.conversation || null,
      pricing: status.pricing || null,
      errors: status.errors || [],
      processingStatus: 'queued',
      attempts: 0,
      receivedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return 'status_queued'
  } catch (error) {
    if (isAlreadyExistsError(error)) return 'duplicate'
    throw error
  }
}

async function loadSelected(collection: string, id: string, companyCode: string) {
  const snapshot = await db().collection(collection).doc(id).get()
  if (!snapshot.exists || String(snapshot.data()?.companyCode || '') !== companyCode) return null
  return snapshot.data() || {}
}

async function commitAssignment(phone: string, identity: UserRecord, state: BotState, sourceMessageId: string) {
  const draft = state.draft || {}
  const companyCode = String(identity.companyCode || '')
  const applicationId = String(draft.applicationId || '')
  const interventionId = String(draft.interventionId || '')
  const assigneeId = String(draft.assigneeId || '')
  const dueDate = new Date(String(draft.dueDate || ''))
  if (Number.isNaN(dueDate.getTime()) || dueDate.getTime() < Date.now() - 86400000) throw new Error('The due date is no longer valid.')
  if (!companyCode || !applicationId || !interventionId || !assigneeId || !sourceMessageId) {
    throw new Error('The assignment request is incomplete.')
  }

  const database = db()
  const applicationRef = database.collection('applications').doc(applicationId)
  const interventionRef = database.collection('interventions').doc(interventionId)
  const assigneeRef = database.collection('users').doc(assigneeId)

  return database.runTransaction(async transaction => {
    const [applicationSnapshot, interventionSnapshot, assigneeSnapshot] = await transaction.getAll(
      applicationRef,
      interventionRef,
      assigneeRef,
    )
    const application = applicationSnapshot.data() || {}
    const intervention = interventionSnapshot.data() || {}
    const assignee = assigneeSnapshot.data() || {}
    if (!applicationSnapshot.exists || !interventionSnapshot.exists || !assigneeSnapshot.exists
      || String(application.companyCode || '') !== companyCode
      || String(intervention.companyCode || '') !== companyCode
      || String(assignee.companyCode || '') !== companyCode) {
      throw new Error('One of the selected records is no longer available.')
    }
    if (normalize(application.applicationStatus) !== 'accepted') throw new Error('The selected SME is no longer accepted.')

    const participantId = String(application.participantId || applicationId)
    const duplicateQuery = database.collection('assignedInterventions')
      .where('companyCode', '==', companyCode)
      .where('participantId', '==', participantId)
      .where('interventionId', '==', interventionId)
      .limit(1)
    const duplicate = await transaction.get(duplicateQuery)
    if (!duplicate.empty) {
      const existing = duplicate.docs[0]
      if (String(existing.data().createdFromMessageId || '') === sourceMessageId) return existing.id
      throw new Error('That intervention is already assigned to this SME.')
    }

    const assignmentId = sha256(`${companyCode}:${participantId}:${interventionId}`).toString('hex')
    const assignmentRef = database.collection('assignedInterventions').doc(assignmentId)
    const notificationRef = database.collection('notifications').doc(`whatsapp_assignment_${assignmentId}`)
    const interventionTitle = String(intervention.interventionTitle || intervention.title || 'Intervention')
    const assigneeName = String(assignee.name || assignee.displayName || assignee.email || 'Delivery owner')

    transaction.create(assignmentRef, {
      companyCode, participantId, applicationId, interventionId, interventionTitle,
      areaOfSupport: intervention.areaOfSupport || intervention.area || null,
      beneficiaryName: application.beneficiaryName || application.businessName || application.participantName || 'SME',
      programName: application.programName || null, programId: application.programId || null,
      assigneeId, assigneeName, assigneeEmail: assignee.email || null,
      assigneeType: normalize(assignee.role) || 'consultant', deliveryActorType: 'human',
      deliveryStrategy: 'human_only', configuredDeliveryStrategy: intervention.deliveryStrategy || 'human_only',
      executionMode: intervention.executionMode || 'single_session', type: 'singular', status: 'assigned',
      assigneeStatus: 'pending', participantStatus: 'pending', assigneeCompletionStatus: 'pending',
      participantCompletionStatus: 'pending', progress: 0, dueDate: Timestamp.fromDate(dueDate),
      targetMetric: draft.targetMetric || null, targetValue: Number(draft.targetValue) || null,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      createdByUid: identity.id, createdByEmail: identity.email || null, createdVia: 'whatsapp',
      createdFromPhone: phone, createdFromMessageId: sourceMessageId,
    })
    transaction.create(notificationRef, {
      companyCode, participantId, interventionId, interventionTitle,
      type: 'intervention_assigned', recipientRoles: ['consultant', 'operations', 'incubatee'],
      message: `${interventionTitle} has been assigned to ${assigneeName}.`,
      createdAt: FieldValue.serverTimestamp(), readBy: {}, source: 'whatsapp', sourceMessageId,
    })
    return assignmentId
  })
}


type AiAction = {
  type?: string
  appointmentId?: string | null
  reason?: string | null
  requestedDate?: string | null
  requestedTime?: string | null
  requestedDateText?: string | null
  requestedTimeText?: string | null
  foodItems?: string[] | null
}

type AiToolCall = {
  type?: string
  arguments?: Record<string, unknown>
}

type AiToolResult = {
  type: string
  result: unknown
}

type AiResponse = {
  ok?: boolean
  reply?: string
  intent?: string | null
  confidence?: number | null
  action?: AiAction | null
  toolCall?: AiToolCall | null
  conversation?: AiConversationState | null
  error?: { code?: string } | null
}

type LphGatewayIdentity = {
  id: string
  participantIds?: string[]
  participantName?: string
  phoneNumber?: string
  email?: string | null
  programId?: string | null
  uid?: string | null
}

type LphGatewayResponse = {
  ok?: boolean
  matched?: boolean
  identity?: LphGatewayIdentity
  appointment?: Record<string, unknown>
  appointments?: Array<Record<string, unknown>>
  meetingLink?: string | null
  foodMenu?: Array<{ id?: string, name?: string, category?: string }>
  foodSelections?: Array<Record<string, unknown>>
  error?: string
}

const aiRouterSecret = (engine: Engine) => {
  const specific = engine === 'LPH'
    ? process.env.LPH_WHATSAPP_ROUTER_SECRET
    : process.env.QTX_WHATSAPP_ROUTER_SECRET
  return String(specific || process.env.WHATSAPP_ROUTER_SECRET || '')
}

async function callAiBackend(
  engine: Engine,
  phone: string,
  message: string,
  state: BotState,
  appointment?: Record<string, unknown> | null,
  toolResults?: AiToolResult[],
): Promise<AiResponse> {
  const secret = aiRouterSecret(engine)
  if (!secret) throw new Error(`WhatsApp router secret is not configured for ${engine}.`)
  const baseUrl = engine === 'LPH' ? lphAiBackendUrl() : qtxAiBackendUrl()
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-WhatsApp-Router-Secret': secret,
    },
    body: JSON.stringify({
      channel: 'whatsapp',
      userId: `+${phone}`,
      message,
      context: {
        engine,
        ...(state.contextType ? { type: state.contextType } : {}),
        ...(state.appointmentId ? { appointmentId: state.appointmentId } : {}),
        ...(appointment ? { appointment } : {}),
        ...(state.conversation ? { conversation: state.conversation } : {}),
        ...(toolResults && toolResults.length ? { toolResults } : {}),
      },
    }),
    signal: AbortSignal.timeout(20000),
  })
  const text = await response.text()
  let body: AiResponse
  try {
    body = JSON.parse(text) as AiResponse
  } catch {
    throw new Error(`The ${engine} ai-backend returned an invalid response.`)
  }
  if (!response.ok || body.ok === false) {
    throw new Error(`The ${engine} ai-backend could not process the message (${body.error?.code || response.status}).`)
  }
  return body
}

type AgentProposal = { id: string, title: string, text: string }
type AgentBackendResponse = { ok?: boolean, reply?: string, proposal?: AgentProposal | null, error?: { code?: string } }

/**
 * Staff-facing agentic operations (schedule/assign/log outcomes). The ai-backend resolves the intent,
 * validates and stores a proposal; nothing is written until the user confirms with a button AND passes
 * the action PIN below. Unlike callAiBackend, rejected actions come back as ok:false with a user-safe
 * reply, so that reply is returned instead of thrown.
 */
async function callAgentBackend<T = AgentBackendResponse>(path: string, phone: string, userId: string, body: Record<string, unknown>): Promise<T> {
  const secret = aiRouterSecret('QTX')
  if (!secret) throw new Error('WhatsApp router secret is not configured for QTX.')
  const response = await fetch(`${qtxAiBackendUrl().replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-WhatsApp-Router-Secret': secret },
    body: JSON.stringify({ userId, phone: `+${phone}`, ...body }),
    signal: AbortSignal.timeout(50000),
  })
  const text = await response.text()
  let parsed: AgentBackendResponse
  try {
    parsed = JSON.parse(text) as AgentBackendResponse
  } catch {
    throw new Error(`The QTX ai-backend returned an invalid agent response (${response.status}).`)
  }
  // Only user-facing rejections (409 action rejected) carry a reply we may show; other failures are generic.
  if (!response.ok && parsed.error?.code !== 'ACTION_REJECTED') {
    throw new Error(`The QTX ai-backend agent call failed (${parsed.error?.code || response.status}).`)
  }
  return parsed as unknown as T
}

const agentEligible = (identity: UserRecord) => ['operations', 'consultant', 'admin'].includes(roleGroup(identity))

async function sendAgentTurn(to: string, response: AgentBackendResponse) {
  if (response.proposal) {
    await sendButtons(to, response.proposal.text, [
      { id: `agent:confirm:${response.proposal.id}`, title: 'Confirm' },
      { id: `agent:cancel:${response.proposal.id}`, title: 'Discard' },
    ])
    return
  }
  await sendText(to, String(response.reply || 'I could not work out what you need. Could you rephrase?'))
}

async function executeAgentConfirmation(to: string, phone: string, identity: UserRecord, proposalId: string) {
  try {
    const result = await callAgentBackend('/api/whatsapp/agent/confirm', phone, identity.id, { proposalId })
    await sendText(to, String(result.reply || 'Done.'))
    await maybeRequestRating(to, phone)
  } catch (error) {
    console.error('WhatsApp agent confirmation failed', { userId: identity.id, error: String(error) })
    await sendText(to, 'I could not complete that. Please check the workspace before trying again.')
  }
}

async function callLphGateway(payload: Record<string, unknown>): Promise<LphGatewayResponse> {
  const url = lphGatewayUrl()
  const secret = String(process.env.LPH_WHATSAPP_GATEWAY_SECRET || '')
  if (!url || !secret) throw new Error('The Lepharo WhatsApp gateway is not configured.')
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-WhatsApp-Gateway-Secret': secret,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  })
  const text = await response.text()
  let body: LphGatewayResponse
  try {
    body = JSON.parse(text) as LphGatewayResponse
  } catch {
    throw new Error('The Lepharo WhatsApp gateway returned an invalid response.')
  }
  if (!response.ok || body.ok === false) {
    throw new Error(`Lepharo gateway request failed (${body.error || response.status}).`)
  }
  return body
}

async function resolveLphIdentity(phone: string) {
  try {
    const result = await callLphGateway({ action: 'resolve_identity', phoneNumber: `+${phone}` })
    return result.matched && result.identity ? result.identity : null
  } catch (error) {
    console.warn('Lepharo identity lookup unavailable', {
      senderSuffix: phone.slice(-4),
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

const structuredRsvp = (input: string) => {
  const match = /^(LPH|QTX)\|RSVP\|([^|]+)\|(ACCEPT|DECLINE)$/i.exec(input.trim())
  if (!match) return null
  return {
    engine: match[1].toUpperCase() as Engine,
    appointmentId: match[2],
    response: match[3].toUpperCase() as 'ACCEPT' | 'DECLINE',
  }
}

async function qtxAppointmentForIdentity(appointmentId: string, identity: UserRecord) {
  if (!appointmentId) return null
  const snapshot = await db().collection('appointments').doc(appointmentId).get()
  if (!snapshot.exists) return null
  const data = snapshot.data() || {}
  const group = roleGroup(identity)
  if (group === 'incubatee') {
    const context = await participantContext(identity)
    const allowed = context.participantIds.has(String(data.participantId || ''))
      || normalize(data.participantEmail) === normalize(identity.email)
    if (!allowed) return null
  } else if (group === 'consultant') {
    const allowed = String(data.assigneeId || '') === identity.id
      || normalize(data.assigneeEmail) === normalize(identity.email)
    if (!allowed) return null
  } else if (identity.companyCode && String(data.companyCode || '') !== String(identity.companyCode || '')) {
    return null
  }
  return { ref: snapshot.ref, id: snapshot.id, data }
}

const qtxAppointmentSummary = (id: string, data: Record<string, unknown>) => ({
  id,
  participantId: String(data.participantId || ''),
  interventionTitle: String(data.interventionTitle || 'Appointment'),
  participantName: String(data.participantName || data.beneficiaryName || ''),
  assigneeName: String(data.assigneeName || data.consultantName || ''),
  date: String(data.date || ''),
  startTime: (data.startTime as Timestamp | undefined)?.toDate?.().toISOString?.() || null,
  endTime: (data.endTime as Timestamp | undefined)?.toDate?.().toISOString?.() || null,
  deliveryMode: String(data.deliveryMethod || data.deliveryMode || ''),
  meetingLink: String(data.meetingLink || ''),
  location: String(data.location || ''),
  status: String(data.status || 'scheduled'),
  beneficiaryConfirmation: String(data.beneficiaryConfirmation || data.userConfirmation || 'pending'),
})

async function qtxUpcomingAppointmentSummaries(identity: UserRecord) {
  const group = roleGroup(identity)
  const companyCode = String(identity.companyCode || '')
  const snapshot = companyCode
    ? await db().collection('appointments').where('companyCode', '==', companyCode).limit(150).get()
    : await db().collection('appointments').limit(150).get()
  let rows = snapshot.docs
  if (group === 'incubatee') {
    const context = await participantContext(identity)
    rows = rows.filter(row => context.participantIds.has(String(row.data().participantId || ''))
      || normalize(row.data().participantEmail) === normalize(identity.email))
  } else if (group === 'consultant') {
    rows = rows.filter(row => String(row.data().assigneeId || '') === identity.id
      || normalize(row.data().assigneeEmail) === normalize(identity.email))
  }
  rows = rows.filter(row => !['cancelled', 'completed'].includes(normalize(row.data().status)))
  rows.sort((a, b) => ((a.data().startTime as Timestamp | undefined)?.toMillis?.() || Number.MAX_SAFE_INTEGER)
    - ((b.data().startTime as Timestamp | undefined)?.toMillis?.() || Number.MAX_SAFE_INTEGER))
  return rows.slice(0, 10).map(row => qtxAppointmentSummary(row.id, row.data()))
}

const toCompactAppointment = (appointment: Record<string, unknown>) => ({
  title: String(appointment.interventionTitle || appointment.title || 'Appointment'),
  date: String(appointment.date || ''),
  startTime: String(appointment.startTime || ''),
  mode: String(appointment.deliveryMode || appointment.deliveryMethod || ''),
  location: String(appointment.location || ''),
})

async function runQtxReadTool(
  identity: UserRecord,
  type: string,
  appointmentId?: string,
): Promise<Record<string, unknown>> {
  if (type === 'get_upcoming_appointments') {
    const appointments = await qtxUpcomingAppointmentSummaries(identity)
    return { appointments: appointments.map(toCompactAppointment) }
  }
  const found = await qtxAppointmentForIdentity(String(appointmentId || ''), identity)
  if (!found) return { found: false }
  const summary = qtxAppointmentSummary(found.id, found.data)
  if (type === 'get_appointment') return { appointment: toCompactAppointment(summary) }
  if (type === 'get_meeting_link') return { meetingLink: summary.meetingLink || null }
  throw new Error(`Unsupported QTX read tool: ${type}`)
}

async function runQtxMutation(
  to: string,
  phone: string,
  identity: UserRecord,
  action: AiAction,
) {
  const type = String(action.type || '')
  const appointmentId = String(action.appointmentId || '')
  const appointment = await qtxAppointmentForIdentity(appointmentId, identity)
  if (!appointment) throw new Error('That appointment could not be found for your account.')

  if (type === 'appointment_accept') {
    await appointment.ref.set({
      beneficiaryConfirmation: 'confirmed', userConfirmation: 'confirmed', confirmationSource: 'whatsapp',
      confirmationPhone: phone, beneficiaryConfirmedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    await sendText(to, 'Your appointment has been confirmed.')
    return
  }
  if (type === 'appointment_decline') {
    const reason = String(action.reason || '').trim()
    if (!reason) throw new Error('Please provide a reason for declining the appointment.')
    await appointment.ref.set({
      beneficiaryConfirmation: 'declined', userConfirmation: 'declined', declineReason: reason,
      confirmationSource: 'whatsapp', confirmationPhone: phone,
      beneficiaryDeclinedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    await sendText(to, 'Your appointment has been declined and the reason was recorded.')
    return
  }
  if (type === 'appointment_reschedule_request') {
    await appointment.ref.set({
      rescheduleRequest: {
        status: 'requested', reasonText: action.reason || null,
        requestedDate: action.requestedDate || null, requestedTime: action.requestedTime || null,
        requestedDateText: action.requestedDateText || null, requestedTimeText: action.requestedTimeText || null,
        requestedVia: 'whatsapp', requestedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    await sendText(to, 'Your request to reschedule has been recorded for the programme team to review.')
    return
  }

  throw new Error(`Unsupported QTX WhatsApp mutation: ${type}`)
}

async function runLphReadTool(
  phone: string,
  type: string,
  appointmentId?: string,
): Promise<Record<string, unknown>> {
  const result = await callLphGateway({
    action: type,
    phoneNumber: `+${phone}`,
    appointmentId: appointmentId || null,
  })
  if (type === 'get_upcoming_appointments') {
    return { appointments: (result.appointments || []).map(toCompactAppointment) }
  }
  if (type === 'get_appointment') {
    return result.appointment ? { appointment: toCompactAppointment(result.appointment) } : { found: false }
  }
  if (type === 'get_meeting_link') {
    return { meetingLink: result.meetingLink || null }
  }
  if (type === 'get_food_menu') {
    return { foodMenu: (result.foodMenu || []).map(item => ({ name: item.name, category: item.category })) }
  }
  throw new Error(`Unsupported LPH read tool: ${type}`)
}

async function runLphMutation(to: string, phone: string, action: AiAction) {
  const type = String(action.type || '')
  try {
    await callLphGateway({
      action: type,
      phoneNumber: `+${phone}`,
      appointmentId: action.appointmentId || null,
      reason: action.reason || null,
      requestedDate: action.requestedDate || null,
      requestedTime: action.requestedTime || null,
      requestedDateText: action.requestedDateText || null,
      requestedTimeText: action.requestedTimeText || null,
      foodItems: action.foodItems || undefined,
    })
  } catch (error) {
    if (type === 'select_food_items') {
      const menu = await runLphReadTool(phone, 'get_food_menu', action.appointmentId || undefined)
      const names = ((menu.foodMenu as Array<{ name?: string }> | undefined) || [])
        .map(item => item.name)
        .filter(Boolean)
      await sendText(to, names.length
        ? `I couldn't match that to the menu. Options are: ${names.join(', ')}.`
        : "I couldn't find a food menu for this appointment.")
      return
    }
    throw error
  }

  if (type === 'appointment_accept') {
    await sendText(to, 'Your Lepharo appointment has been confirmed.')
    return
  }
  if (type === 'appointment_decline') {
    await sendText(to, 'Your Lepharo appointment has been declined and the reason was recorded.')
    return
  }
  if (type === 'appointment_reschedule_request') {
    await sendText(to, 'Your request to reschedule has been recorded for the Lepharo team to review.')
    return
  }
  if (type === 'select_food_items') {
    await sendText(to, 'Thanks, your food selection has been saved.')
    return
  }
  throw new Error(`Unsupported LPH WhatsApp mutation: ${type}`)
}

const MAX_AI_TOOL_ROUNDS = 3

async function resolveAiTurn(
  engine: Engine,
  phone: string,
  input: string,
  state: BotState,
  appointment: Record<string, unknown> | null,
  identity?: UserRecord | null,
): Promise<AiResponse> {
  const toolResults: AiToolResult[] = []
  for (let round = 0; round < MAX_AI_TOOL_ROUNDS; round++) {
    const response = await callAiBackend(engine, phone, input, state, appointment, toolResults)
    const toolCall = response.toolCall
    if (!toolCall?.type) return response
    try {
      let data: Record<string, unknown>
      if (engine === 'LPH') {
        data = await runLphReadTool(phone, toolCall.type, state.appointmentId)
      } else {
        if (!identity) throw new Error('QTX identity is required to read appointment data.')
        data = await runQtxReadTool(identity, toolCall.type, state.appointmentId)
      }
      toolResults.push({ type: toolCall.type, result: data })
    } catch (error) {
      console.error('WhatsApp AI tool call failed', { engine, type: toolCall.type, error: String(error) })
      return { ok: true, reply: "I couldn't retrieve that information right now. Please try again in a moment." }
    }
  }
  console.warn('WhatsApp AI tool loop exceeded max rounds', { engine, senderSuffix: phone.slice(-4) })
  return { ok: true, reply: "I'm having trouble finding what you need. Could you rephrase your request?" }
}

async function processAiMessage(
  engine: Engine,
  to: string,
  phone: string,
  input: string,
  state: BotState,
  identity?: UserRecord | null,
) {
  let appointment: Record<string, unknown> | null = null
  if (state.appointmentId) {
    if (engine === 'LPH') {
      const result = await callLphGateway({
        action: 'get_appointment', phoneNumber: `+${phone}`, appointmentId: state.appointmentId,
      })
      appointment = result.appointment || null
    } else if (identity) {
      const result = await qtxAppointmentForIdentity(state.appointmentId, identity)
      appointment = result ? qtxAppointmentSummary(result.id, result.data) : null
    }
  }

  const response = await resolveAiTurn(engine, phone, input, state, appointment, identity)
  const nextConversation = response.conversation || { awaiting: null, appointmentId: state.appointmentId || null }
  const nextAppointmentId = String(response.action?.appointmentId || nextConversation.appointmentId || state.appointmentId || '') || undefined
  await saveState(phone, {
    engine,
    contextType: nextAppointmentId ? (state.contextType || 'appointment_rsvp') : state.contextType,
    appointmentId: nextAppointmentId,
    conversation: nextConversation,
    ...(engine === 'QTX' && identity ? { userId: identity.id, companyCode: String(identity.companyCode || '') } : {}),
  })

  if (response.action?.type) {
    if (engine === 'LPH') await runLphMutation(to, phone, response.action)
    else if (identity) await runQtxMutation(to, phone, identity, response.action)
    else throw new Error('QTX identity is required to execute this action.')
    return
  }

  await sendText(to, String(response.reply || 'I could not determine what you need. Please try rephrasing your message.'))
}

async function processStructuredRsvp(to: string, phone: string, parsed: ReturnType<typeof structuredRsvp>) {
  if (!parsed) return false
  await saveState(phone, {
    engine: parsed.engine,
    contextType: 'appointment_rsvp',
    appointmentId: parsed.appointmentId,
    conversation: { awaiting: null, appointmentId: parsed.appointmentId },
  })

  if (parsed.response === 'DECLINE') {
    await saveState(phone, { conversation: { awaiting: 'appointment_decline_reason', appointmentId: parsed.appointmentId } })
    await sendText(to, 'I understand that you cannot attend. Please tell me why you are unable to make the appointment.')
    return true
  }

  if (parsed.engine === 'LPH') {
    await callLphGateway({
      action: 'appointment_accept', phoneNumber: `+${phone}`, appointmentId: parsed.appointmentId,
    })
    await sendText(to, 'Your Lepharo appointment has been confirmed.')
    return true
  }

  const identity = await findUserByPhone(phone)
  if (!identity) throw new Error('This WhatsApp number is not linked to a Smart Incubation account.')
  await runQtxMutation(to, phone, identity, { type: 'appointment_accept', appointmentId: parsed.appointmentId })
  return true
}

async function resolveEngineForMessage(to: string, phone: string, input: string): Promise<Engine | null> {
  const command = normalize(input)
  const snapshot = await stateRef(phone).get()
  const state = (snapshot.data() || {}) as BotState

  if (['lph', 'lepharo', 'tenant:lph'].includes(command)) {
    await saveState(phone, { engine: 'LPH', step: 'menu' })
    await sendText(to, 'Lepharo selected. How can I help you?')
    return null
  }
  if (['qtx', 'smart inc', 'smart incubation', 'tenant:qtx'].includes(command)) {
    await saveState(phone, { engine: 'QTX', step: 'menu' })
    await sendText(to, 'Smart Incubation selected. How can I help you?')
    return null
  }

  if (state.engine === 'LPH' || state.engine === 'QTX') return state.engine

  const [qtxIdentity, lphIdentity] = await Promise.all([
    findUserByPhone(phone),
    resolveLphIdentity(phone),
  ])

  if (qtxIdentity && lphIdentity) {
    await sendButtons(to, 'This number is linked to more than one Smart Inc workspace. Which one do you want to use?', [
      { id: 'tenant:LPH', title: 'Lepharo' },
      { id: 'tenant:QTX', title: 'Smart Inc' },
    ])
    return null
  }

  if (lphIdentity) {
    await saveState(phone, { engine: 'LPH', participantId: lphIdentity.id, step: 'menu' })
    return 'LPH'
  }
  if (qtxIdentity) {
    await saveState(phone, {
      engine: 'QTX', userId: qtxIdentity.id, companyCode: String(qtxIdentity.companyCode || ''), step: 'menu',
    })
    return 'QTX'
  }

  await sendText(to, 'I could not match this WhatsApp number to a Lepharo or Smart Incubation account. Ask your programme team to update the WhatsApp number on your profile.')
  return null
}

async function processLphMessage(to: string, input: string) {
  const phone = normalizePhone(to)
  const identity = await resolveLphIdentity(phone)
  if (!identity) {
    await sendText(to, 'I could not match this WhatsApp number to a Lepharo SME account. Please ask the Lepharo team to update your phone number.')
    return
  }
  const sendContext = outboundMessageContext.getStore()
  if (sendContext) sendContext.userId = identity.id
  const snapshot = await stateRef(phone).get()
  const state = (snapshot.data() || {}) as BotState
  await saveState(phone, { engine: 'LPH', participantId: identity.id })
  await processAiMessage('LPH', to, phone, input, { ...state, engine: 'LPH', participantId: identity.id })
}

async function processQtxMessage(to: string, input: string, sourceMessageId: string) {
  const phone = normalizePhone(to)
  console.info('WhatsApp inbound message', { senderSuffix: phone.slice(-4), inputType: input.includes(':') ? 'interactive' : 'text' })
  const identity = await findUserByPhone(phone)
  if (!identity) {
    console.info('WhatsApp identity not matched', { senderSuffix: phone.slice(-4) })
    await sendText(to, 'I could not match this WhatsApp number to a Smart Incubation account. Ask an administrator to add this number to your user profile.')
    return
  }
  console.info('WhatsApp identity matched', { userId: identity.id, role: identity.role })
  const sendContext = outboundMessageContext.getStore()
  if (sendContext) {
    sendContext.userId = identity.id
    sendContext.companyCode = String(identity.companyCode || '')
  }
  const snapshot = await stateRef(phone).get()
  let state = (snapshot.data() || {}) as BotState
  const updatedMillis = (state.updatedAt as Timestamp | undefined)?.toMillis?.() || 0
  if (!state.userId || state.userId !== identity.id || Date.now() - updatedMillis > stateTtlMs) {
    await clearFlow(phone, identity)
    state = { userId: identity.id, companyCode: String(identity.companyCode || ''), step: 'menu', draft: {} }
  }
  const command = normalize(input)
  if (state.pendingRating && input.startsWith('rating:')) {
    const rating = Number(input.slice('rating:'.length))
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
      await db().collection('agentConversationRatings').add({
        agentId: 'whatsapp-bot', agentName: 'WhatsApp Bot', agentType: 'system', channel: 'whatsapp',
        conversationId: phone, userUid: identity.id, companyCode: identity.companyCode || null,
        rating, createdAt: FieldValue.serverTimestamp(),
      })
      await saveState(phone, { pendingRating: false, lastRatingPromptAt: Timestamp.now() })
      await sendText(to, 'Thank you — your rating has been recorded. Send “menu” whenever you need me.')
      return
    }
  }
  if (['menu', 'cancel', 'start', 'hi', 'hie', 'hey', 'hello'].includes(command)) {
    await clearFlow(phone, identity)
    await menu(to, identity)
    return
  }
  if (input === 'action:help') {
    const help: Record<string, string> = {
      incubatee: 'I can show your diagnostic plan, assigned interventions, and upcoming appointments.',
      consultant: 'I can show interventions assigned to you and your upcoming delivery appointments.',
      operations: 'I can assign interventions, monitor company intervention status, and show programme appointments.',
      admin: 'I can show platform account health, agent ratings, and intervention status.',
      general: 'I can show the workspace actions available to your role.',
    }
    await sendText(to, `${help[roleGroup(identity)]} Send “menu” at any time to return to your options.`)
    await maybeRequestRating(to, phone)
    return
  }
  if (input === 'action:diagnostic' || /\b(my\s+)?diagnostic\s+plan\b/.test(command)) {
    if (roleGroup(identity) !== 'incubatee') {
      await sendText(to, 'Diagnostic plan lookup is available to incubatees. Send “menu” for the actions available to your role.')
      return
    }
    await showDiagnosticPlan(to, identity)
    await maybeRequestRating(to, phone)
    return
  }
  if (input === 'action:interventions' || input === 'action:tasks' || /\b(my\s+)?interventions?\b/.test(command) || /\bassignments?\b/.test(command)) {
    await showRoleInterventions(to, identity)
    await maybeRequestRating(to, phone)
    return
  }
  if (input === 'action:appointments' || /\b(my\s+)?appointments?\b/.test(command) || /\bmeetings?\b/.test(command)) {
    await showRoleAppointments(to, identity)
    await maybeRequestRating(to, phone)
    return
  }
  if (input === 'action:platform' || /\b(platform|user)\s+(overview|status|summary)\b/.test(command)) {
    if (roleGroup(identity) !== 'admin') {
      await sendText(to, 'Platform overview is restricted to platform administrators.')
      return
    }
    await showPlatformOverview(to)
    await maybeRequestRating(to, phone)
    return
  }
  if (input === 'action:assign' || /assign\s+(an?\s+)?intervention/.test(command)) {
    if (!canAssign(identity)) {
      await sendText(to, 'Your account does not have permission to assign interventions. I can still help with read-only actions.')
      return
    }
    await saveState(phone, { step: 'participant', draft: {} })
    await listParticipants(to, identity)
    return
  }
  if (state.step === 'participant' && input.startsWith('participant:')) {
    const applicationId = input.slice('participant:'.length)
    const application = await loadSelected('applications', applicationId, String(identity.companyCode || ''))
    if (!application || normalize(application.applicationStatus) !== 'accepted') return sendText(to, 'That SME is not available. Send “menu” and try again.')
    await saveState(phone, { step: 'intervention', draft: { applicationId, participantName: String(application.beneficiaryName || application.businessName || 'SME') } })
    await listInterventions(to, identity)
    return
  }
  if (state.step === 'intervention' && input.startsWith('intervention:')) {
    const interventionId = input.slice('intervention:'.length)
    const intervention = await loadSelected('interventions', interventionId, String(identity.companyCode || ''))
    if (!intervention) return sendText(to, 'That intervention is not available. Send “menu” and try again.')
    await saveState(phone, { step: 'assignee', draft: { ...(state.draft || {}), interventionId, interventionTitle: String(intervention.interventionTitle || intervention.title || 'Intervention') } })
    await listAssignees(to, identity)
    return
  }
  if (state.step === 'assignee' && input.startsWith('assignee:')) {
    const assigneeId = input.slice('assignee:'.length)
    const assignee = await loadSelected('users', assigneeId, String(identity.companyCode || ''))
    if (!assignee) return sendText(to, 'That delivery owner is not available. Send “menu” and try again.')
    await saveState(phone, { step: 'due_date', draft: { ...(state.draft || {}), assigneeId, assigneeName: String(assignee.name || assignee.displayName || assignee.email || 'Delivery owner') } })
    await sendText(to, 'What is the due date? Reply in YYYY-MM-DD format, for example 2026-08-31.')
    return
  }
  if (state.step === 'due_date') {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input) ? new Date(`${input}T12:00:00Z`) : new Date('invalid')
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() - 86400000) return sendText(to, 'Please enter a valid future date in YYYY-MM-DD format.')
    await saveState(phone, { step: 'target_metric', draft: { ...(state.draft || {}), dueDate: input } })
    await sendList(to, 'How will success be measured?', 'Choose measure', [
      { id: 'metric:Sessions', title: 'Sessions' }, { id: 'metric:Documents', title: 'Documents' },
      { id: 'metric:Milestones', title: 'Milestones' }, { id: 'metric:Percentage', title: 'Percentage' },
    ])
    return
  }
  if (state.step === 'target_metric' && input.startsWith('metric:')) {
    await saveState(phone, { step: 'target_value', draft: { ...(state.draft || {}), targetMetric: input.slice(7) } })
    await sendText(to, 'What is the numeric target value?')
    return
  }
  if (state.step === 'target_value') {
    const targetValue = Number(input)
    if (!Number.isFinite(targetValue) || targetValue <= 0) return sendText(to, 'Please enter a number greater than zero.')
    const draft: Record<string, string | number | null> = { ...(state.draft || {}), targetValue }
    await saveState(phone, { step: 'confirm', draft })
    await sendButtons(to, `Please confirm:\n\nSME: ${draft.participantName}\nIntervention: ${draft.interventionTitle}\nOwner: ${draft.assigneeName}\nDue: ${draft.dueDate}\nTarget: ${targetValue} ${draft.targetMetric}`, [
      { id: 'confirm:yes', title: 'Confirm' }, { id: 'confirm:no', title: 'Cancel' },
    ])
    return
  }
  if (state.step === 'confirm' && input === 'confirm:no') {
    await clearFlow(phone, identity)
    await sendText(to, 'Cancelled. Nothing was changed. Send “menu” when you are ready.')
    return
  }
  if (state.step === 'confirm' && input === 'confirm:yes') {
    const authorizedUntil = state.authenticatedUntil?.toMillis?.() || 0
    if (authorizedUntil > Date.now()) {
      try {
        const id = await commitAssignment(phone, identity, state, sourceMessageId)
        await clearFlow(phone, identity)
        await sendText(to, `Done — the intervention was assigned successfully. Reference: ${id}.`)
        await maybeRequestRating(to, phone)
      } catch (error) {
        await sendText(to, `${error instanceof Error ? error.message : 'The assignment could not be completed.'} Send “menu” to restart.`)
      }
      return
    }
    await saveState(phone, { step: 'pin' })
    await sendText(to, 'Authorisation required. Reply with your bot action PIN. For safety, use a PIN created only for WhatsApp actions—not your Smart Incubation password. The authorisation lasts 10 minutes.')
    return
  }
  if (state.step === 'pin') {
    if (!verifyActionPin(input)) {
      await sendText(to, 'That PIN is incorrect or the bot PIN has not been configured. Send “menu” to cancel, or try again.')
      return
    }
    const refreshed = (await stateRef(phone).get()).data() as BotState
    try {
      const id = await commitAssignment(phone, identity, refreshed, sourceMessageId)
      await stateRef(phone).set({ authenticatedUntil: Timestamp.fromMillis(Date.now() + authorizationTtlMs) }, { merge: true })
      await clearFlow(phone, identity)
      await sendText(to, `Authorised and completed — the intervention was assigned. Reference: ${id}.`)
      await maybeRequestRating(to, phone)
    } catch (error) {
      await sendText(to, `${error instanceof Error ? error.message : 'The assignment could not be completed.'} Send “menu” to restart.`)
    }
    return
  }
  if (input.startsWith('agent:confirm:') || input.startsWith('agent:cancel:')) {
    if (!agentEligible(identity)) return sendText(to, 'That action is not available for your role.')
    const confirming = input.startsWith('agent:confirm:')
    const proposalId = input.slice(confirming ? 'agent:confirm:'.length : 'agent:cancel:'.length)
    if (!confirming) {
      try {
        const result = await callAgentBackend('/api/whatsapp/agent/cancel', phone, identity.id, { proposalId })
        await sendText(to, String(result.reply || 'Discarded.'))
      } catch (error) {
        console.error('WhatsApp agent cancel failed', { userId: identity.id, error: String(error) })
        await sendText(to, 'I could not discard that. It will expire on its own shortly.')
      }
      return
    }
    // Same control as the assignment flow: a recent PIN authorises writes; otherwise ask for it first.
    if ((state.authenticatedUntil?.toMillis?.() || 0) > Date.now()) {
      await executeAgentConfirmation(to, phone, identity, proposalId)
      return
    }
    await saveState(phone, { step: 'agent_pin', draft: { proposalId } })
    await sendText(to, 'Authorisation required. Reply with your bot action PIN to confirm. Send “menu” to cancel. This PIN is separate from your Smart Incubation password.')
    return
  }
  if (state.step === 'agent_pin') {
    if (!verifyActionPin(input)) {
      await sendText(to, 'That PIN is incorrect or the bot PIN has not been configured. Send “menu” to cancel, or try again.')
      return
    }
    const proposalId = String(state.draft?.proposalId || '')
    await stateRef(phone).set({ authenticatedUntil: Timestamp.fromMillis(Date.now() + authorizationTtlMs) }, { merge: true })
    await clearFlow(phone, identity)
    if (!proposalId) return sendText(to, 'I lost track of that request. Please ask me again.')
    await executeAgentConfirmation(to, phone, identity, proposalId)
    return
  }
  if (agentEligible(identity) && !state.conversation?.awaiting) {
    try {
      const result = await callAgentBackend('/api/whatsapp/agent', phone, identity.id, { channel: 'whatsapp', message: input.slice(0, 1000) })
      await sendAgentTurn(to, result)
    } catch (error) {
      console.error('WhatsApp agent turn failed', { userId: identity.id, error: String(error) })
      await sendText(to, 'I could not process that right now. Please try again, or send “menu” for your options.')
    }
    return
  }
  await processAiMessage('QTX', to, phone, input, state, identity)
}

async function processMessage(to: string, input: string, sourceMessageId: string) {
  const phone = normalizePhone(to)
  const parsed = structuredRsvp(input)
  if (parsed && await processStructuredRsvp(to, phone, parsed)) return

  const engine = await resolveEngineForMessage(to, phone, input)
  if (!engine) return
  if (engine === 'LPH') {
    await processLphMessage(to, input)
    return
  }
  await processQtxMessage(to, input, sourceMessageId)
}

export async function processWhatsAppInboundEvent(eventId: string) {
  const eventRef = db().collection('whatsappInboundEvents').doc(eventId)
  const claim = await db().runTransaction(async transaction => {
    const snapshot = await transaction.get(eventRef)
    if (!snapshot.exists) return null
    const event = snapshot.data() as WhatsAppInboundEvent
    if (['completed', 'dead_letter', 'ignored'].includes(String(event.status || ''))) return null

    const leaseUntil = event.leaseUntil?.toMillis?.() || 0
    if (event.status === 'processing' && leaseUntil > Date.now()) {
      throw new Error(`WhatsApp event ${eventId} is already being processed.`)
    }

    const attempts = Number(event.attempts || 0) + 1
    if (attempts > inboxMaxAttempts) {
      transaction.set(eventRef, {
        status: 'dead_letter',
        deadLetteredAt: FieldValue.serverTimestamp(),
        leaseUntil: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return null
    }

    transaction.set(eventRef, {
      status: 'processing',
      attempts,
      leaseUntil: Timestamp.fromMillis(Date.now() + inboxLeaseMs),
      lastAttemptAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return {
      attempts,
      from: String(event.from || ''),
      input: String(event.input || ''),
      messageId: String(event.messageId || eventId),
    }
  })

  if (!claim) return
  const phone = normalizePhone(claim.from)
  const stateBefore = phone ? (await stateRef(phone).get()).data() as BotState | undefined : undefined
  const containsActionPin = stateBefore?.step === 'pin'

  try {
    if (!phone || !claim.input) throw new Error('The queued WhatsApp event has no processable sender or input.')
    await outboundMessageContext.run({
      sourceEventId: eventId,
      sourceMessageId: claim.messageId,
      sequence: 0,
    }, () => processMessage(phone, claim.input, claim.messageId))
    await eventRef.set({
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
      leaseUntil: FieldValue.delete(),
      lastError: FieldValue.delete(),
      ...(containsActionPin ? { input: '[REDACTED]', message: FieldValue.delete() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  } catch (error) {
    const deadLettered = claim.attempts >= inboxMaxAttempts
    await eventRef.set({
      status: deadLettered ? 'dead_letter' : 'failed',
      lastError: short(error instanceof Error ? error.message : String(error), 500),
      failedAt: FieldValue.serverTimestamp(),
      leaseUntil: FieldValue.delete(),
      ...(deadLettered ? { deadLetteredAt: FieldValue.serverTimestamp() } : {}),
      ...(deadLettered && containsActionPin ? { input: '[REDACTED]', message: FieldValue.delete() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    if (!deadLettered) throw error
  }
}

const deliveryStatusRank: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3 }

export async function processWhatsAppMessageStatusEvent(eventId: string) {
  const database = db()
  const eventRef = database.collection('whatsappMessageStatusEvents').doc(eventId)
  const claim = await database.runTransaction(async transaction => {
    const snapshot = await transaction.get(eventRef)
    if (!snapshot.exists) return null
    const event = snapshot.data() as WhatsAppStatusEvent
    if (['completed', 'dead_letter'].includes(String(event.processingStatus || ''))) return null
    const leaseUntil = event.leaseUntil?.toMillis?.() || 0
    if (event.processingStatus === 'processing' && leaseUntil > Date.now()) {
      throw new Error(`WhatsApp status event ${eventId} is already being processed.`)
    }
    const attempts = Number(event.attempts || 0) + 1
    if (attempts > inboxMaxAttempts) {
      transaction.set(eventRef, {
        processingStatus: 'dead_letter',
        deadLetteredAt: FieldValue.serverTimestamp(),
        leaseUntil: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return null
    }
    transaction.set(eventRef, {
      processingStatus: 'processing',
      attempts,
      leaseUntil: Timestamp.fromMillis(Date.now() + inboxLeaseMs),
      lastAttemptAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return {
      attempts,
      wamid: String(event.wamid || ''),
      deliveryStatus: normalize(event.deliveryStatus),
      statusTimestamp: String(event.statusTimestamp || ''),
      errors: event.errors || [],
    }
  })

  if (!claim) return
  try {
    if (!claim.wamid || !claim.deliveryStatus) throw new Error('The WhatsApp status event is incomplete.')
    const mappingRef = database.collection('whatsappMessageIds').doc(sha256(claim.wamid).toString('hex'))
    const mapping = await mappingRef.get()
    const outboundMessageId = String(mapping.data()?.outboundMessageId || '')
    if (!mapping.exists || !outboundMessageId) throw new Error('The outbound WhatsApp message has not been correlated yet.')

    const outboundRef = database.collection('whatsappOutboundMessages').doc(outboundMessageId)
    await database.runTransaction(async transaction => {
      const outbound = await transaction.get(outboundRef)
      if (!outbound.exists) throw new Error('The correlated outbound WhatsApp message does not exist.')
      const outboundData = outbound.data() || {}
      const currentStatus = normalize(outboundData.status)
      const nextStatus = claim.deliveryStatus
      const shouldAdvance = nextStatus === 'failed'
        ? !['delivered', 'read'].includes(currentStatus)
        : currentStatus !== 'failed'
          && (deliveryStatusRank[nextStatus] ?? -1) >= (deliveryStatusRank[currentStatus] ?? -1)
      const unixSeconds = Number(claim.statusTimestamp)
      const statusAt = Number.isFinite(unixSeconds) && unixSeconds > 0
        ? Timestamp.fromMillis(unixSeconds * 1000)
        : Timestamp.now()
      transaction.set(outboundRef, {
        ...(shouldAdvance ? {
          status: nextStatus,
          lastStatusAt: statusAt,
          ...(nextStatus === 'failed' ? { failedAt: statusAt, deliveryErrors: claim.errors } : {}),
        } : {}),
        statusHistory: FieldValue.arrayUnion({ eventId, status: nextStatus, timestamp: claim.statusTimestamp || null }),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      transaction.set(eventRef, {
        processingStatus: 'completed',
        outboundMessageId,
        completedAt: FieldValue.serverTimestamp(),
        leaseUntil: FieldValue.delete(),
        lastError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      const metricDate = statusAt.toDate().toISOString().slice(0, 10)
      const metricCounter = ['sent', 'delivered', 'read', 'failed'].includes(nextStatus)
        ? `${nextStatus}Count`
        : 'otherStatusCount'
      transaction.set(database.collection('whatsappDeliveryHealthDaily').doc(`global_${metricDate}`), {
        date: metricDate,
        scope: 'global',
        statusEventCount: FieldValue.increment(1),
        [metricCounter]: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      const companyCode = String(outboundData.companyCode || '')
      if (companyCode) {
        transaction.set(database.collection('whatsappDeliveryHealthDaily')
          .doc(`company_${sha256(companyCode).toString('hex').slice(0, 24)}_${metricDate}`), {
          date: metricDate,
          scope: 'company',
          companyCode,
          statusEventCount: FieldValue.increment(1),
          [metricCounter]: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      if (nextStatus === 'failed' && shouldAdvance) {
        const alertRef = database.collection('whatsappDeliveryAlerts').doc(`delivery_${outboundMessageId}`)
        transaction.set(alertRef, {
          type: 'delivery_failed',
          severity: 'high',
          status: 'open',
          outboundMessageId,
          wamid: claim.wamid,
          companyCode: companyCode || null,
          userId: outboundData.userId || null,
          recipientSuffix: String(outboundData.recipient || '').slice(-4),
          errors: claim.errors,
          openedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
        transaction.set(database.collection('notifications').doc(`whatsapp_delivery_status_${outboundMessageId}`), {
          type: 'whatsapp_delivery_failed',
          severity: 'high',
          status: 'unread',
          companyCode: companyCode || null,
          recipientRoles: ['systemadmin', 'admin'],
          message: 'WhatsApp accepted a message, but Meta later reported that delivery failed.',
          source: 'whatsapp',
          deliveryAlertId: alertRef.id,
          createdAt: FieldValue.serverTimestamp(),
          readBy: {},
        }, { merge: true })
      }
    })
  } catch (error) {
    const deadLettered = claim.attempts >= inboxMaxAttempts
    await eventRef.set({
      processingStatus: deadLettered ? 'dead_letter' : 'failed',
      lastError: short(error instanceof Error ? error.message : String(error), 500),
      failedAt: FieldValue.serverTimestamp(),
      leaseUntil: FieldValue.delete(),
      ...(deadLettered ? { deadLetteredAt: FieldValue.serverTimestamp() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    if (!deadLettered) throw error
  }
}


export async function whatsappDispatchHandler(request: Request, response: HttpResponse) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'method_not_allowed' })
    return
  }
  const expected = String(process.env.WHATSAPP_DISPATCH_SECRET || '')
  const supplied = String(request.headers['x-whatsapp-dispatch-secret'] || '')
  if (!expected || !supplied || expected !== supplied) {
    response.status(401).json({ error: 'unauthorized' })
    return
  }

  const engine = String(request.body?.engine || '').toUpperCase() as Engine
  const to = normalizePhone(request.body?.to)
  const type = String(request.body?.type || '')
  const appointmentId = String(request.body?.appointmentId || '')
  const body = String(request.body?.body || '')

  if (!['LPH', 'QTX'].includes(engine) || to.length < 8 || type !== 'appointment_rsvp' || !appointmentId || !body) {
    response.status(400).json({ error: 'invalid_request' })
    return
  }

  await saveState(to, {
    engine,
    contextType: 'appointment_rsvp',
    appointmentId,
    conversation: { awaiting: null, appointmentId },
    ...(request.body?.participantId ? { participantId: String(request.body.participantId) } : {}),
  })

  await outboundMessageContext.run({
    sourceEventId: `dispatch:${engine}:${appointmentId}`,
    sourceMessageId: `dispatch:${appointmentId}`,
    sequence: 0,
  }, async () => {
    await sendButtons(to, body, [
      { id: `${engine}|RSVP|${appointmentId}|ACCEPT`, title: 'Accept' },
      { id: `${engine}|RSVP|${appointmentId}|DECLINE`, title: 'Decline' },
    ])
  })

  response.status(200).json({ ok: true, engine, appointmentId })
}

export async function whatsappWebhookHandler(request: Request, response: HttpResponse) {
  if (request.method === 'GET') {
    const mode = String(request.query['hub.mode'] || '')
    const token = String(request.query['hub.verify_token'] || '')
    const challenge = String(request.query['hub.challenge'] || '')
    if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      response.status(200).send(challenge)
      return
    }
    response.status(403).send('Verification failed')
    return
  }
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'method_not_allowed' })
    return
  }
  if (!verifySignature(request)) {
    console.warn('WhatsApp webhook signature rejected')
    response.status(401).json({ error: 'invalid_signature' })
    return
  }
  const entries = Array.isArray(request.body?.entry) ? request.body.entry : []
  const writes: Array<Promise<string>> = []
  for (const entry of entries) {
    for (const change of (Array.isArray(entry?.changes) ? entry.changes : [])) {
      const value = change?.value || {}
      const phoneNumberId = String(value?.metadata?.phone_number_id || '')
      const displayPhoneNumber = String(value?.metadata?.display_phone_number || '')
      for (const message of (Array.isArray(value?.messages) ? value.messages : [])) {
        writes.push(persistInboundMessage(String(entry?.id || ''), phoneNumberId, displayPhoneNumber, message))
      }
      for (const status of (Array.isArray(value?.statuses) ? value.statuses : [])) {
        writes.push(persistMessageStatus(String(entry?.id || ''), phoneNumberId, displayPhoneNumber, status))
      }
    }
  }
  try {
    const results = await Promise.all(writes)
    const queued = results.filter(result => result === 'queued').length
    const duplicates = results.filter(result => result === 'duplicate').length
    const ignored = results.filter(result => result === 'ignored' || result === 'status_ignored').length
    const statusesQueued = results.filter(result => result === 'status_queued').length
    console.info('WhatsApp webhook ingested', { entries: entries.length, queued, statusesQueued, duplicates, ignored })
    response.status(200).json({ received: true, queued, statusesQueued, duplicates, ignored })
  } catch (error) {
    console.error('WhatsApp webhook ingestion failed', error)
    response.status(503).json({ received: false, error: 'inbox_persistence_failed' })
  }
}
