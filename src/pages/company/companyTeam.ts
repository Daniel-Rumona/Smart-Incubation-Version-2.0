import { classPhase } from '@/utils/trainingResults'
import type { TrainingClass, TrainingLearner, TrainingOrganisation, TrainingTeamMember } from '@/types/training'

/**
 * A client company's team, put together for its pages: the people on its team list, each with the classes they are
 * booked on, plus anyone booked before the list existed (so nobody goes missing). A person and a booking belong
 * together when their emails match, or, without an email, their names.
 */

export type TeamStatus = 'certified' | 'in_class' | 'booked' | 'not_booked'

export type TeamPerson = {
    id: string
    member: TrainingTeamMember
    bookings: TrainingLearner[]
    status: TeamStatus
    /** The class they are booked on or in now, if any. */
    current: { learner: TrainingLearner; trainingClass: TrainingClass } | null
    /** On the team list (rather than only known from a booking). */
    listed: boolean
}

const key = (name: string, email?: string) => (email ? `e:${email.trim().toLowerCase()}` : `n:${name.trim().toLowerCase()}`)

export const teamOf = (organisation: TrainingOrganisation, learners: TrainingLearner[], classes: TrainingClass[]): TeamPerson[] => {
    const classById = new Map(classes.map((row) => [row.id, row]))
    const people = new Map<string, TeamPerson>()
    organisation.team.forEach((member) => {
        people.set(key(member.name, member.email), { id: member.id, member, bookings: [], status: 'not_booked', current: null, listed: true })
    })
    learners.forEach((learner) => {
        const found = people.get(key(learner.name, learner.email)) || people.get(key(learner.name))
        if (found) { found.bookings.push(learner); return }
        people.set(key(learner.name, learner.email), {
            id: `booking-${learner.id}`, member: { id: `booking-${learner.id}`, name: learner.name, email: learner.email, ...(learner.phone ? { phone: learner.phone } : {}) },
            bookings: [learner], status: 'not_booked', current: null, listed: false,
        })
    })
    return [...people.values()].map((person) => {
        const open = person.bookings
            .map((learner) => ({ learner, trainingClass: classById.get(learner.classId) }))
            .filter((row): row is { learner: TrainingLearner; trainingClass: TrainingClass } => !!row.trainingClass && classPhase(row.trainingClass) !== 'finished')
            .sort((a, b) => a.trainingClass.startDate.localeCompare(b.trainingClass.startDate))[0] || null
        const certified = person.bookings.some((learner) => !!learner.certificateId)
        const status: TeamStatus = certified ? 'certified' : open ? (classPhase(open.trainingClass) === 'upcoming' ? 'booked' : 'in_class') : 'not_booked'
        return { ...person, status, current: open }
    }).sort((a, b) => Number(b.member.isDirector === true) - Number(a.member.isDirector === true) || a.member.name.localeCompare(b.member.name))
}

export const newTeamId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
