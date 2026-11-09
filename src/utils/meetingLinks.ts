/** Online classes: recognise the meeting platform from the link the facilitator pastes. */

export type MeetingPlatform = 'zoom' | 'teams' | 'google_meet' | 'webex' | 'other'

export const MEETING_PLATFORM_LABELS: Record<MeetingPlatform, string> = {
    zoom: 'Zoom',
    teams: 'Microsoft Teams',
    google_meet: 'Google Meet',
    webex: 'Webex',
    other: 'Online meeting',
}

const hostOf = (url: string) => {
    try {
        return new URL(url.trim()).hostname.toLowerCase()
    } catch {
        return ''
    }
}

const isHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

export const detectMeetingPlatform = (url?: string): MeetingPlatform => {
    const host = hostOf(url || '')
    if (!host) return 'other'
    if (isHost(host, 'zoom.us') || isHost(host, 'zoom.com') || isHost(host, 'zoomgov.com')) return 'zoom'
    if (isHost(host, 'teams.microsoft.com') || isHost(host, 'teams.live.com') || host === 'teams.cloud.microsoft') return 'teams'
    if (host === 'meet.google.com') return 'google_meet'
    if (isHost(host, 'webex.com')) return 'webex'
    return 'other'
}

/** A link learners can safely be sent to: https only, with a host. */
export const isMeetingUrl = (url?: string) => {
    try {
        const parsed = new URL((url || '').trim())
        return parsed.protocol === 'https:' && Boolean(parsed.hostname)
    } catch {
        return false
    }
}
