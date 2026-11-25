import { collection, doc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { workspaceCompanyCode } from '@/services/companiesService'
import type { FullIdentity } from '@/types/identity'
import { TEAM_EVENT_TYPES, type TeamEvent, type TeamEventCode, type TeamEventType, type TeamEventValues } from '@/types/teamEvents'

/** Team events (src/types/teamEvents.ts). Company staff read them; operations and reception add and change them. */

const EVENTS = 'teamEvents'
const MANAGER_ROLES = new Set(['projectadmin', 'projectmanager', 'operations', 'admin'])

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const canManageTeamEvents = (user?: Pick<FullIdentity, 'role'> | null) => Boolean(user && MANAGER_ROLES.has(String(user.role)))

const toTeamEvent = (id: string, data: Record<string, unknown>): TeamEvent => {
    const attendees = (Array.isArray(data.attendees) ? data.attendees : [])
        .map((row) => row as Record<string, unknown>)
        .map((row) => ({ uid: text(row.uid), name: text(row.name) }))
        .filter((row) => row.uid)
    const codes = (data.codes && typeof data.codes === 'object' ? data.codes : {}) as Record<string, TeamEventCode>
    return {
        id,
        companyCode: text(data.companyCode),
        title: text(data.title),
        type: (TEAM_EVENT_TYPES as readonly string[]).includes(text(data.type)) ? text(data.type) as TeamEventType : 'other',
        startTime: text(data.startTime),
        endTime: text(data.endTime) || text(data.startTime),
        venue: text(data.venue),
        notes: text(data.notes),
        attendees,
        attendeeUids: attendees.map((row) => row.uid),
        recruiting: data.recruiting === true,
        programId: text(data.programId) || undefined,
        programName: text(data.programName) || undefined,
        notifyOnWhatsApp: data.notifyOnWhatsApp === true,
        resendRequestedAt: text(data.resendRequestedAt) || undefined,
        codes,
        cancelledAt: text(data.cancelledAt) || undefined,
        createdAt: text(data.createdAt),
        createdBy: text(data.createdBy),
        updatedAt: text(data.updatedAt),
    }
}

/** The company's events, kept live so the codes the server adds show up without a reload. */
export const watchTeamEvents = (user: FullIdentity, onChange: (events: TeamEvent[]) => void, onError?: () => void) => {
    const companyCode = workspaceCompanyCode(user)
    // No company: nothing to watch (the caller starts with no events).
    if (!companyCode) return () => undefined
    return onSnapshot(
        query(collection(getFirebaseDb(), EVENTS), where('companyCode', '==', companyCode)),
        (snapshot) => onChange(snapshot.docs.map((row) => toTeamEvent(row.id, row.data())).filter((row) => !row.cancelledAt)),
        () => onError?.(),
    )
}

const fields = (values: TeamEventValues) => {
    const attendees = values.attendees.filter((row) => row.uid).map((row) => ({ uid: row.uid, name: text(row.name) }))
    return {
        title: text(values.title),
        type: values.type,
        startTime: values.startTime,
        endTime: values.endTime,
        venue: text(values.venue),
        notes: text(values.notes),
        attendees,
        attendeeUids: attendees.map((row) => row.uid),
        recruiting: values.recruiting === true,
        // The programme only means something when the team is looking for SMEs.
        programId: values.recruiting ? text(values.programId) || null : null,
        programName: values.recruiting ? text(values.programName) || null : null,
        notifyOnWhatsApp: values.notifyOnWhatsApp === true,
    }
}

export const createTeamEvent = async (user: FullIdentity, values: TeamEventValues) => {
    const companyCode = workspaceCompanyCode(user)
    if (!companyCode || !canManageTeamEvents(user)) throw new Error('forbidden')
    const ref = doc(collection(getFirebaseDb(), EVENTS))
    const at = new Date().toISOString()
    await setDoc(ref, { companyCode, module: 'incubation', ...fields(values), codes: {}, createdAt: at, createdBy: user.uid, updatedAt: at, updatedBy: user.uid })
    return ref.id
}

export const updateTeamEvent = async (user: FullIdentity, event: TeamEvent, values: TeamEventValues) => {
    if (!canManageTeamEvents(user)) throw new Error('forbidden')
    await updateDoc(doc(getFirebaseDb(), EVENTS, event.id), { ...fields(values), updatedAt: new Date().toISOString(), updatedBy: user.uid })
}

/** Asks the server to send the WhatsApp messages again (to everyone it could not reach, or one person). */
export const resendTeamEventMessages = async (user: FullIdentity, event: TeamEvent, uid?: string) => {
    if (!canManageTeamEvents(user)) throw new Error('forbidden')
    await updateDoc(doc(getFirebaseDb(), EVENTS, event.id), {
        notifyOnWhatsApp: true, resendRequestedAt: new Date().toISOString(), resendUid: uid || null, updatedAt: new Date().toISOString(), updatedBy: user.uid,
    })
}

const TEAM_ROLES = new Set(['projectadmin', 'projectmanager', 'operations', 'admin', 'consultant', 'director'])

/** Who can go to an event: the company's staff and facilitators, active accounts only. */
export const listTeamMembers = async (user: FullIdentity) => {
    const companyCode = workspaceCompanyCode(user)
    if (!companyCode) return []
    const snapshot = await getDocs(query(collection(getFirebaseDb(), 'users'), where('companyCode', '==', companyCode)))
    return snapshot.docs.flatMap((row) => {
        const data = row.data()
        if (!TEAM_ROLES.has(String(data.role)) || data.status === 'deleted' || data.status === 'inactive' || data.active === false) return []
        const whatsApp = (Array.isArray(data.whatsappPhoneNumbers) && data.whatsappPhoneNumbers.length > 0) || (data.phoneIsWhatsApp === true && Boolean(data.phone))
        return [{ uid: row.id, name: text(data.name) || text(data.displayName) || text(data.email), whatsApp }]
    }).sort((a, b) => a.name.localeCompare(b.name))
}

export const cancelTeamEvent =async (user: FullIdentity, event: TeamEvent) => {
    if (!canManageTeamEvents(user)) throw new Error('forbidden')
    const at = new Date().toISOString()
    await updateDoc(doc(getFirebaseDb(), EVENTS, event.id), { cancelledAt: at, updatedAt: at, updatedBy: user.uid })
}
