import type { Prospect } from '@/types/prospects'
import type { TeamEvent } from '@/types/teamEvents'

/** How far along the incubation pipeline a prospect got (closed ones count as signed up only, unless they joined). */
const ORDER = ['new', 'contacted', 'invited', 'applied', 'joined']
const stage = (prospect: Prospect) => (prospect.convertedAt || prospect.participantId ? 4 : Math.max(ORDER.indexOf(prospect.status), 0))

export type SignupFunnel = { signedUp: number, contacted: number, applied: number, joined: number }

export const signupFunnel = (rows: Prospect[]): SignupFunnel => ({
    signedUp: rows.length,
    contacted: rows.filter((row) => stage(row) >= 1).length,
    applied: rows.filter((row) => stage(row) >= 3).length,
    joined: rows.filter((row) => stage(row) >= 4).length,
})

/** The sign-up code of each person going, by code: who owns it. */
export const eventLinkOwners = (event: TeamEvent) => new Map(Object.entries(event.codes)
    .filter(([, code]) => code.linkId)
    .map(([uid, code]) => [String(code.linkId), uid]))

/** The prospects who signed up with one of this event's codes. */
export const eventSignups = (event: TeamEvent, prospects: Prospect[]) => {
    const owners = eventLinkOwners(event)
    return prospects.filter((row) => row.signupLinkId && owners.has(row.signupLinkId))
}

/** Per team member across the given events: sign-ups through their codes, and how many of those joined. */
export const signupsByPerson = (events: TeamEvent[], prospects: Prospect[]) => {
    const owners = new Map<string, string>()
    const names = new Map<string, string>()
    for (const event of events) {
        for (const [linkId, uid] of eventLinkOwners(event)) owners.set(linkId, uid)
        for (const person of event.attendees) names.set(person.uid, person.name)
    }
    const rows = new Map<string, { uid: string, name: string, signups: number, joined: number }>()
    for (const prospect of prospects) {
        const uid = prospect.signupLinkId ? owners.get(prospect.signupLinkId) : undefined
        if (!uid) continue
        const row = rows.get(uid) || { uid, name: names.get(uid) || prospect.ownerName || '', signups: 0, joined: 0 }
        row.signups += 1
        if (stage(prospect) >= 4) row.joined += 1
        rows.set(uid, row)
    }
    return [...rows.values()].sort((a, b) => b.signups - a.signups)
}
