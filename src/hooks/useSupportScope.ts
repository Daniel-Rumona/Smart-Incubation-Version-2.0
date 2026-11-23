import { useEffect, useState } from 'react'

/**
 * An accepted SME who also gets help outside their programme (consultants and agents they found
 * themselves) switches between the two from the top bar: 'programme' shows the incubatee workspace,
 * 'external' shows the independent SME pages (their own dashboard, roadmap, marketplace).
 */
export type SupportScope = 'programme' | 'external'

const STORAGE_KEY = 'smartv2.supportScope'
const CHANGE_EVENT = 'smartv2.supportScopeChanged'

export const getStoredSupportScope = (): SupportScope => {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'external' ? 'external' : 'programme'
    } catch {
        return 'programme'
    }
}

export const setSupportScope = (scope: SupportScope) => {
    try { localStorage.setItem(STORAGE_KEY, scope) } catch { /* the choice still applies to this tab */ }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: scope }))
}

export const useSupportScope = () => {
    const [scope, setScope] = useState<SupportScope>(getStoredSupportScope)

    useEffect(() => {
        const sync = (event: Event) => {
            const detail = (event as CustomEvent<SupportScope>).detail
            setScope(detail === 'external' || detail === 'programme' ? detail : getStoredSupportScope())
        }
        window.addEventListener('storage', sync)
        window.addEventListener(CHANGE_EVENT, sync)
        return () => {
            window.removeEventListener('storage', sync)
            window.removeEventListener(CHANGE_EVENT, sync)
        }
    }, [])

    return scope
}

/** Work an SME arranged themselves (marketplace consultants, their own agents) carries no programme. */
export const isExternalWork = (raw: Record<string, unknown>) => !String(raw.programId || '').trim()
