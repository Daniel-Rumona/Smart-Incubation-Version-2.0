/**
 * Team events: an expo, a workshop, a networking evening or a funder visit that people from the team go to. They sit on
 * the Appointments calendar beside the sessions. Most are just a date, a place and who is going; when the team says it
 * will look for SMEs there ("recruiting"), each person going gets their own sign-up code (a prospectSignupLinks doc,
 * made by the server), and everyone who signs up with it lands in Prospects with that person following up.
 */

export const TEAM_EVENT_TYPES = ['expo', 'workshop', 'networking', 'visit', 'other'] as const
export type TeamEventType = typeof TEAM_EVENT_TYPES[number]

export const TEAM_EVENT_TYPE_LABELS: Record<TeamEventType, string> = {
    expo: 'Expo',
    workshop: 'Workshop',
    networking: 'Networking',
    visit: 'Visit',
    other: 'Other',
}

export type TeamEventAttendee = { uid: string, name: string }

/** What the server did for one person going: their sign-up code, and whether WhatsApp reached them. */
export type TeamEventCode = {
    linkId?: string
    /** When the WhatsApp message went out. */
    sentAt?: string
    /** Why it did not: no WhatsApp number on their account, or the send failed. */
    sendProblem?: 'no_number' | 'failed'
}

export type TeamEvent = {
    id: string
    companyCode: string
    title: string
    type: TeamEventType
    startTime: string
    endTime: string
    venue: string
    notes: string
    attendees: TeamEventAttendee[]
    attendeeUids: string[]
    /** "We'll be looking for SMEs here": gives each person going a sign-up code. */
    recruiting: boolean
    /** The programme sign-ups would join; optional. */
    programId?: string
    programName?: string
    /** Message each person going on WhatsApp (the event, and their code when recruiting). */
    notifyOnWhatsApp: boolean
    /** Bumped by "Resend" so the server sends again. */
    resendRequestedAt?: string
    /** Set by the server only. */
    codes: Record<string, TeamEventCode>
    cancelledAt?: string
    createdAt: string
    createdBy: string
    updatedAt: string
}

export type TeamEventValues = Pick<TeamEvent, 'title' | 'type' | 'startTime' | 'endTime' | 'venue' | 'notes' | 'attendees' | 'recruiting' | 'programId' | 'programName' | 'notifyOnWhatsApp'>
