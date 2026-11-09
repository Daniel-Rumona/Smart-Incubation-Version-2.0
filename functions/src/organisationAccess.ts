import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'

export const REGISTRATION_NOTIFY_EMAIL = 'daniel@quantilytix.co.za'
const staffRoles = new Set(['admin', 'projectadmin', 'projectmanager', 'operations', 'consultant', 'funder'])
export const isOrganisationStaff = (user: Record<string, unknown>) =>
  staffRoles.has(String(user.role)) && Boolean(user.companyCode)
const clean = (value: unknown) => String(value || '').trim()

export const registrationKind = (user: Record<string, unknown>) => {
  if (user.organisationAccessStatus || user.managedAccount === true || user.mustChangePassword === true) return null
  if (user.firstLoginComplete !== true) return null
  if (user.role === 'consultant' && !user.companyCode) return 'consultant'
  if (user.role === 'incubatee' && user.smeOnboardingComplete === true) {
    return user.registrationProgramLink ? null : 'SME'
  }
  return null
}

const notification = (subject: string, text: string) => ({
  to: [REGISTRATION_NOTIFY_EMAIL], source: 'registrationNotification',
  message: { subject, text }, createdAt: FieldValue.serverTimestamp(),
})

export async function requestOrganisationAccess(db: Firestore, uid: string, email: string, input: Record<string, unknown>, appUrl: string) {
  const organisationName = clean(input.organisationName)
  const contactName = clean(input.contactName)
  const phone = clean(input.phone)
  const notes = clean(input.notes)
  if (organisationName.length < 2 || organisationName.length > 120 || !contactName || contactName.length > 120 || phone.length > 40 || notes.length > 2000) {
    throw new HttpsError('invalid-argument', 'Enter your name and organisation name. Keep the message under 2,000 characters.')
  }
  const userRef = db.collection('users').doc(uid)
  const requestRef = db.collection('organisationAccessRequests').doc(uid)
  return db.runTransaction(async tx => {
    const [userSnap, existing] = await Promise.all([tx.get(userRef), tx.get(requestRef)])
    if (existing.exists) return { status: existing.get('status') as string }
    const user = userSnap.data()
    if (!user || !['incubatee', 'consultant'].includes(user.role) || user.companyCode || user.firstLoginComplete === true) {
      throw new HttpsError('permission-denied', 'Organisation requests are for new accounts without an existing organisation.')
    }
    tx.create(requestRef, { uid, email, contactName, organisationName, phone, notes, status: 'pending', createdAt: FieldValue.serverTimestamp() })
    tx.update(userRef, { organisationAccessStatus: 'pending', updatedAt: FieldValue.serverTimestamp() })
    tx.create(db.collection('mail').doc(`organisation-request-${uid}`), notification(
      `Organisation access request: ${organisationName}`,
      `${contactName} (${email}) has requested access for ${organisationName}.\nPhone: ${phone || 'Not provided'}\n${notes}\n\nReview: ${appUrl}/admin/organisation-requests?view=review`,
    ))
    return { status: 'pending' }
  })
}

export async function reviewOrganisationAccess(db: Firestore, reviewerUid: string, uid: string, decision: string, reason: string) {
  if (!uid || uid.includes('/') || !['approved', 'rejected'].includes(decision) || reason.length > 2000) {
    throw new HttpsError('invalid-argument', 'Choose a valid request and decision.')
  }
  return db.runTransaction(async tx => {
    const reviewer = await tx.get(db.collection('users').doc(reviewerUid))
    if (reviewer.get('role') !== 'systemadmin') throw new HttpsError('permission-denied', 'Only a System Admin can review organisation requests.')
    const ref = db.collection('organisationAccessRequests').doc(uid)
    const userRef = db.collection('users').doc(uid)
    const [request, user] = await Promise.all([tx.get(ref), tx.get(userRef)])
    if (!request.exists || !user.exists) throw new HttpsError('not-found', 'The request or account no longer exists.')
    if (request.get('status') === decision) return { status: decision }
    if (request.get('status') !== 'pending') throw new HttpsError('failed-precondition', 'This request has already been reviewed.')
    if (user.get('companyCode') || !['incubatee', 'consultant'].includes(user.get('role'))) {
      throw new HttpsError('failed-precondition', 'This account has changed since the request was submitted. Review its existing access first.')
    }
    tx.update(ref, { status: decision, reason, reviewedByUid: reviewerUid, reviewedAt: FieldValue.serverTimestamp() })
    tx.update(userRef, {
      organisationAccessStatus: decision,
      ...(decision === 'approved' ? { role: 'director', firstLoginComplete: false, organisationName: request.get('organisationName') } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { status: decision }
  })
}

/** Called only for a new account or an onboarding transition, never for routine profile edits. */
export async function notifyCompletedRegistration(db: Firestore, uid: string, appUrl: string) {
  await db.runTransaction(async tx => {
    const user = await tx.get(db.collection('users').doc(uid))
    const kind = registrationKind(user.data() || {})
    if (!kind) return
    const marker = db.collection('registrationNotifications').doc(uid)
    if ((await tx.get(marker)).exists) return
    tx.create(marker, { kind, notifiedAt: FieldValue.serverTimestamp() })
    const created = user.get('createdAt')?.toDate?.()?.toISOString() || 'Not recorded'
    tx.create(db.collection('mail').doc(`registration-${uid}`), notification(
      `New ${kind} registration: ${clean(user.get('name')) || clean(user.get('email'))}`,
      `Name: ${clean(user.get('name'))}\nEmail: ${clean(user.get('email'))}\nRole: ${kind}\nOrganisation: ${clean(user.get('companyCode')) || 'Independent'}\nRegistered: ${created}\n\nReview accounts: ${appUrl}/admin/users?view=registrations`,
    ))
  })
}

/** A transaction and permanent company marker prevent duplicate milestone emails under retries/concurrency. */
export async function notifyFirstOrganisationStaff(db: Firestore, uid: string, companyCode: string, appUrl: string) {
  if (!companyCode || companyCode.includes('/')) return
  await db.runTransaction(async tx => {
    const marker = db.collection('organisationMilestones').doc(companyCode)
    const milestone = await tx.get(marker)
    if (milestone.exists && milestone.get('status') !== 'awaiting_first_staff') return
    const [company, user, members] = await Promise.all([
      tx.get(db.collection('companies').doc(companyCode)), tx.get(db.collection('users').doc(uid)),
      tx.get(db.collection('users').where('companyCode', '==', companyCode)),
    ])
    if (!user.exists || user.get('companyCode') !== companyCode || !isOrganisationStaff(user.data()!)) return
    // Existing organisations with staff get a silent baseline, not a misleading "first staff" email.
    const joinedAt = user.get('staffJoinedAt')?.toMillis?.() ?? user.get('createdAt')?.toMillis?.() ?? 0
    const hadStaff = !milestone.exists && members.docs.some(member => member.id !== uid && isOrganisationStaff(member.data())
      && (member.get('staffJoinedAt')?.toMillis?.() ?? member.get('createdAt')?.toMillis?.() ?? 0) < joinedAt)
    tx.set(marker, { status: 'recorded', firstStaffUid: uid, recordedAt: FieldValue.serverTimestamp(), notificationQueued: !hadStaff })
    if (hadStaff) return
    const name = clean(company.get('name')) || companyCode
    tx.create(db.collection('mail').doc(`first-staff-${companyCode}`), notification(
      `${name} has registered its first staff member`,
      `Organisation: ${name} (${companyCode})\nStaff member: ${clean(user.get('name'))}\nEmail: ${clean(user.get('email'))}\nRole: ${clean(user.get('role'))}\n\nNo further staff registration emails will be sent for this organisation.\nReview: ${appUrl}/admin/users?view=registrations`,
    ))
  })
}
