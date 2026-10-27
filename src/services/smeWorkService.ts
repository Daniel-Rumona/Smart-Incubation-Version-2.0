import { collection, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import type { AssignedIntervention } from '@/contexts/AssignedInterventionsContext'
import { deriveConsultantStatus, progressForAssignment } from '@/pages/consultant/ConsultantWorkspaceUtils'
import { buildFollowUpFields, deliverableBlockReason } from '@/services/interventionOutcomeConfig'
import type { FullIdentity } from '@/types/identity'
import type { FirestoreDate } from '@/types/interventions'

/*
 * An SME's own work: the interventions assigned to them, whether from a programme, a consultant's accepted plan, or an
 * AI agent they started. Shared by the roadmap and the independent SME's dashboard, so both say the same thing.
 */

export type SmeWork = {
    id: string
    title: string
    area: string
    state: 'not_started' | 'in_progress' | 'waiting_you' | 'done'
    /** What the SME's own move is, when the state is waiting_you. */
    waitingOn?: 'plan' | 'confirmation'
    progress: number
    dueDate?: FirestoreDate
    helperName: string
    helperType: 'agent' | 'human'
    assigneeId: string
    note?: string
    raw: Record<string, unknown>
}

/** An assigned intervention as the SME's work, with its real status; declined or cancelled work is left out. */
export const toSmeWork = (id: string, data: Record<string, unknown>): SmeWork | null => {
    const assignment = { ...data, id } as unknown as AssignedIntervention
    const status = deriveConsultantStatus(assignment)
    if (status === 'Rejected') return null
    const participantSigned = String(data.participantStatus || '').toLowerCase() === 'accepted'
    const awaitingConfirmation = ['done', 'completed'].includes(String(data.assigneeCompletionStatus || '').toLowerCase())
        && String(data.participantCompletionStatus || '').toLowerCase() !== 'confirmed'
    const progress = progressForAssignment(assignment, status)
    const state: SmeWork['state'] = status === 'Completed'
        ? 'done'
        : !participantSigned || awaitingConfirmation ? 'waiting_you' : progress > 0 || Number(data.agentConversationCount) > 0 ? 'in_progress' : 'not_started'
    return {
        id,
        title: String(data.interventionTitle || data.title || 'Intervention'),
        area: String(data.areaOfSupport || 'General Support'),
        state,
        waitingOn: state === 'waiting_you' ? (!participantSigned ? 'plan' : 'confirmation') : undefined,
        progress,
        dueDate: data.dueDate as FirestoreDate,
        helperName: String(data.assigneeName || ''),
        helperType: data.deliveryActorType === 'agent' ? 'agent' : 'human',
        assigneeId: String(data.assigneeId || ''),
        note: typeof data.notes === 'string' && data.notes.trim() ? data.notes.trim() : undefined,
        raw: data,
    }
}

/** The SME's work, read by their own ids (their uid, and any participant record with their email). */
export const loadSmeWork = async (user: FullIdentity): Promise<SmeWork[]> => {
    const db = getFirebaseDb()
    const ids = new Set<string>([user.uid])
    if (user.email) {
        const participants = await getDocs(query(collection(db, 'participants'), where('email', '==', user.email))).catch(() => null)
        participants?.docs.forEach((row) => ids.add(row.id))
    }
    const snaps = await Promise.all([...ids].map((id) => getDocs(query(collection(db, 'assignedInterventions'), where('participantId', '==', id)))))
    const seen = new Map<string, SmeWork>()
    snaps.flatMap((snap) => snap.docs).forEach((row) => {
        const item = toSmeWork(row.id, row.data() as Record<string, unknown>)
        if (item) seen.set(row.id, item)
    })
    return [...seen.values()]
}

/** The SME confirms finished work and rates it; the same record the accepted SME's interventions page writes. */
export const confirmSmeWork = async (work: SmeWork, rating: number, comments: string) => {
    const blocked = deliverableBlockReason(work.raw)
    if (blocked) throw new Error(blocked)
    const db = getFirebaseDb()
    const feedback = { rating, comments: comments.trim() }
    await Promise.all([
        updateDoc(doc(db, 'assignedInterventions', work.id), {
            ...buildFollowUpFields(work.raw),
            participantCompletionStatus: 'confirmed',
            completionStatus: 'confirmed',
            completionConfirmedAt: serverTimestamp(),
            completedAt: serverTimestamp(),
            progress: 100,
            feedback,
            updatedAt: serverTimestamp(),
        }),
        setDoc(doc(db, 'interventionCompletions', work.id), {
            assignedInterventionId: work.id,
            participantId: String(work.raw.participantId || ''),
            interventionId: String(work.raw.interventionId || ''),
            programId: work.raw.programId || null,
            completedAt: serverTimestamp(),
            feedback,
            snapshot: { businessName: work.raw.businessName || null, interventionTitle: work.title, departmentName: work.area || null, assigneeName: work.helperName || null },
        }, { merge: true }),
    ])
}
