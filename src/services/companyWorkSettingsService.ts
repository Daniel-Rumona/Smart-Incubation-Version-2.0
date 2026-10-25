import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { db } from '@/firebase'
import type { FullIdentity } from '@/types/identity'
import { PLATFORM_OWNER_CODE } from '@/services/companiesService'

/**
 * How a company's consultants work, set by its project admins and operations (never by the consultant):
 *  - operating hours for the whole company;
 *  - whether company consultants must accept new work before it starts (off unless the company turns it on);
 *  - per consultant, their areas of support (picked from the company's own) and, if they keep different
 *    hours, their own week. A consultant without their own hours works the company's.
 * One document per company: companyWorkSettings/{companyCode}.
 */

export type WorkWindow = { dayOfWeek: number; startTime: string; endTime: string }
export type ConsultantWork = { areasOfSupport?: string[]; hours?: WorkWindow[] | null }
export type CompanyWorkSettings = { companyCode: string; operatingHours: WorkWindow[]; consultants: Record<string, ConsultantWork>; requireConsultantAcceptance: boolean }

const empty = (companyCode: string): CompanyWorkSettings => ({ companyCode, operatingHours: [], consultants: {}, requireConsultantAcceptance: false })

export const canManageWorkSettings = (role?: string) => ['projectadmin', 'projectmanager', 'operations', 'admin', 'systemadmin'].includes(String(role || ''))

export const getCompanyWorkSettings = async (companyCode: string): Promise<CompanyWorkSettings> => {
    if (!companyCode) return empty(companyCode)
    const snapshot = await getDoc(doc(db, 'companyWorkSettings', companyCode))
    if (!snapshot.exists()) return empty(companyCode)
    const data = snapshot.data()
    return {
        companyCode,
        operatingHours: Array.isArray(data.operatingHours) ? data.operatingHours as WorkWindow[] : [],
        consultants: (data.consultants as Record<string, ConsultantWork>) || {},
        requireConsultantAcceptance: data.requireConsultantAcceptance === true,
    }
}

const changed = new EventTarget()

const write = async (user: FullIdentity, fields: Record<string, unknown>) => {
    const companyCode = String(user.companyCode || '')
    if (!companyCode) throw new Error('Your profile has no company, so these settings cannot be saved.')
    // merge keeps the other consultants' entries; a consultant's own entry is replaced field by field.
    await setDoc(doc(db, 'companyWorkSettings', companyCode), { ...fields, companyCode, updatedAt: serverTimestamp(), updatedByUid: user.uid }, { merge: true })
    changed.dispatchEvent(new Event('change'))
}

export const saveOperatingHours = (user: FullIdentity, operatingHours: WorkWindow[]) => write(user, { operatingHours })

/** hours: null means "works the company's operating hours". */
export const saveConsultantWork = (user: FullIdentity, consultantUid: string, work: { areasOfSupport: string[]; hours: WorkWindow[] | null }) =>
    write(user, { consultants: { [consultantUid]: work } })

/** The company's areas of support: every distinct area on the interventions it has set up. */
export const listCompanyAreasOfSupport = async (companyCode: string) => {
    if (!companyCode) return []
    const snapshot = await getDocs(query(collection(db, 'interventions'), where('companyCode', '==', companyCode)))
    return [...new Set(snapshot.docs.map((row) => String(row.data().areaOfSupport || '').trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right))
}

/** The hours a consultant works: their own if operations set some, otherwise the company's. */
export const hoursFor = (settings: CompanyWorkSettings | null, consultantUid?: string | null) => {
    const own = consultantUid ? settings?.consultants[consultantUid]?.hours : null
    if (own && own.length) return { windows: own, source: 'own' as const }
    return { windows: settings?.operatingHours || [], source: 'company' as const }
}

export const areasFor = (settings: CompanyWorkSettings | null, consultantUid?: string | null) =>
    (consultantUid && settings?.consultants[consultantUid]?.areasOfSupport) || []

const minutesOf = (date: Date) => date.getHours() * 60 + date.getMinutes()
const toMinutes = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number)
    return (hours || 0) * 60 + (minutes || 0)
}

/**
 * Whether an appointment falls outside the consultant's hours. Null when no hours are set at all
 * (nothing to compare against) or when it fits inside one of that day's windows.
 */
export const outsideHours = (settings: CompanyWorkSettings | null, consultantUid: string | null | undefined, start: Date, end: Date) => {
    const { windows, source } = hoursFor(settings, consultantUid)
    if (!windows.length) return null
    const day = windows.filter((window) => window.dayOfWeek === start.getDay())
    if (!day.length) return { closedDay: true, windows: day, source }
    const sameDay = start.toDateString() === end.toDateString()
    const fits = sameDay && day.some((window) => minutesOf(start) >= toMinutes(window.startTime) && minutesOf(end) <= toMinutes(window.endTime))
    return fits ? null : { closedDay: false, windows: day, source }
}

// One shared copy per company for the session, refreshed whenever any page saves a change.
const cache = new Map<string, Promise<CompanyWorkSettings>>()

export type WorkSettingsStatus = 'loading' | 'ready' | 'error'

/**
 * Settings plus whether they loaded. A failed read is reported as 'error' rather than looking like a company
 * with no hours, which an editor would then save over the real settings; it isn't cached, so retry() reads again.
 */
export const useCompanyWorkSettingsState = (companyCode?: string | null) => {
    const code = String(companyCode || '')
    const [state, setState] = useState<{ settings: CompanyWorkSettings | null; status: WorkSettingsStatus }>({ settings: null, status: 'loading' })
    const load = useCallback((fresh = false) => {
        if (!code) return
        if (fresh || !cache.has(code)) {
            const pending = getCompanyWorkSettings(code)
            cache.set(code, pending)
            pending.catch(() => { if (cache.get(code) === pending) cache.delete(code) })
        }
        cache.get(code)!.then(
            (settings) => setState({ settings, status: 'ready' }),
            () => setState((current) => ({ settings: current.settings, status: current.settings ? 'ready' : 'error' })),
        )
    }, [code])
    useEffect(() => {
        load()
        const refresh = () => load(true)
        changed.addEventListener('change', refresh)
        return () => changed.removeEventListener('change', refresh)
    }, [load])
    const retry = useCallback(() => {
        setState((current) => ({ ...current, status: current.settings ? 'ready' : 'loading' }))
        load(true)
    }, [load])
    return { ...state, retry }
}

export const useCompanyWorkSettings = (companyCode?: string | null) => useCompanyWorkSettingsState(companyCode).settings

export const saveRequireConsultantAcceptance = (user: FullIdentity, requireConsultantAcceptance: boolean) => write(user, { requireConsultantAcceptance })

/**
 * Whether new human-delivered work starts as accepted, or waits for the assignee to accept it:
 *  - work you assign to yourself is accepted, since you're the one who decided to take it on;
 *  - freelance (marketplace) consultants always accept, because taking the work is their own agreement;
 *  - everyone else in the company accepts only when the company has turned the requirement on.
 */
export const assignmentStartsAccepted = (input: {
    assignee: { id?: string | null; role?: string | null; companyCode?: string | null }
    assignerUid?: string | null
    settings: Pick<CompanyWorkSettings, 'requireConsultantAcceptance'> | null
}) => {
    const { assignee, assignerUid, settings } = input
    if (assignee.id && assignerUid && assignee.id === assignerUid) return true
    const role = String(assignee.role || '').toLowerCase()
    const companyCode = String(assignee.companyCode || '').trim()
    if (role === 'consultant' && (!companyCode || companyCode === PLATFORM_OWNER_CODE)) return false
    return !settings?.requireConsultantAcceptance
}
