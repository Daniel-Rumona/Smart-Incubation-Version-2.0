import { useEffect, useState } from 'react'

/**
 * A director who runs the programme alone (users.secondRole = 'operations') switches between overseeing it
 * ('overview': the director pages) and running it ('operations': the operations pages). Remembered on this device.
 */
export type DirectorWorkspace = 'overview' | 'operations'

const STORAGE_KEY = 'smartv2.directorWorkspace'
const CHANGE_EVENT = 'smartv2.directorWorkspaceChanged'

export const getStoredDirectorWorkspace = (): DirectorWorkspace => {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'operations' ? 'operations' : 'overview'
    } catch {
        return 'overview'
    }
}

export const setDirectorWorkspace = (workspace: DirectorWorkspace) => {
    try { localStorage.setItem(STORAGE_KEY, workspace) } catch { /* the choice still applies to this tab */ }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: workspace }))
}

export const useDirectorWorkspace = () => {
    const [workspace, setWorkspace] = useState<DirectorWorkspace>(getStoredDirectorWorkspace)
    useEffect(() => {
        const sync = (event: Event) => {
            const detail = (event as CustomEvent<DirectorWorkspace>).detail
            setWorkspace(detail === 'operations' || detail === 'overview' ? detail : getStoredDirectorWorkspace())
        }
        window.addEventListener('storage', sync)
        window.addEventListener(CHANGE_EVENT, sync)
        return () => {
            window.removeEventListener('storage', sync)
            window.removeEventListener(CHANGE_EVENT, sync)
        }
    }, [])
    return workspace
}
