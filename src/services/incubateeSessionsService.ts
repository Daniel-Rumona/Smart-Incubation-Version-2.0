import { collection, getDocs, query, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { toDayjs, type MeetingType } from '@/components/interventions/appointmentSchedule'
import type { IncubateeWorkspace } from '@/types/incubatee'

export type IncubateeSession = {
    id: string
    title: string
    startTime: unknown
    meetingType?: MeetingType
    location?: string
    /** Booked but the SME hasn't accepted it yet. */
    awaiting: boolean
}

const UPCOMING_STATUSES = new Set(['pending', 'accepted', 'confirmed'])
const CHUNK = 30 // Firestore `in` limit

/**
 * The SME's next booked session (pending or accepted, still to come), or null. Reads appointments the same way as
 * AppointmentInvitations: by the SME's own assigned interventions, scoped to their company.
 */
export const loadNextIncubateeSession = async (workspace: IncubateeWorkspace, companyCode?: string | null): Promise<IncubateeSession | null> => {
    const assignmentIds = workspace.assignedInterventions
        .filter((item) => !item.agentId && !item.id.startsWith('unassigned-'))
        .map((item) => item.id)
    if (!assignmentIds.length) return null

    const db = getFirebaseDb()
    const now = Date.now()
    let next: IncubateeSession | null = null
    let nextStart = Infinity
    for (let index = 0; index < assignmentIds.length; index += CHUNK) {
        const snapshot = await getDocs(query(
            collection(db, 'appointments'),
            where('assignedInterventionId', 'in', assignmentIds.slice(index, index + CHUNK)),
            ...(companyCode ? [where('companyCode', '==', companyCode)] : []),
        ))
        snapshot.docs.forEach((row) => {
            const data = row.data() as Record<string, unknown>
            const status = String(data.status || 'pending')
            const start = toDayjs(data.startTime)?.valueOf()
            if (!UPCOMING_STATUSES.has(status) || !start || start < now || start >= nextStart) return
            nextStart = start
            next = {
                id: row.id,
                title: String(data.interventionTitle || 'Appointment'),
                startTime: data.startTime,
                meetingType: data.meetingType as MeetingType | undefined,
                location: typeof data.location === 'string' && data.location.trim() ? data.location : undefined,
                awaiting: status === 'pending',
            }
        })
    }
    return next
}
