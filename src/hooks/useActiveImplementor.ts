import { useEffect, useState } from 'react'
import { ALL_IMPLEMENTORS } from '@/services/funderScopeService'

/**
 * The implementor a funder organisation's member is looking at (a company code, or "all"), chosen in the dropdown
 * next to the programme selector. Kept in the browser like the programme choice, and shared across tabs and pages.
 */

export const ACTIVE_IMPLEMENTOR_STORAGE_KEY = 'smartv2.activeImplementor'
export const ACTIVE_IMPLEMENTOR_CHANGE_EVENT = 'smartv2.activeImplementorChanged'

const read = () => {
  try {
    return localStorage.getItem(ACTIVE_IMPLEMENTOR_STORAGE_KEY) || ALL_IMPLEMENTORS
  } catch {
    return ALL_IMPLEMENTORS
  }
}

export const setActiveImplementor = (implementor: string) => {
  try {
    localStorage.setItem(ACTIVE_IMPLEMENTOR_STORAGE_KEY, implementor)
  } catch {
    // Storage blocked: the choice still applies to this tab through the event below.
  }
  window.dispatchEvent(new CustomEvent(ACTIVE_IMPLEMENTOR_CHANGE_EVENT, { detail: implementor }))
}

export const useActiveImplementor = () => {
  const [activeImplementor, setImplementor] = useState(read)

  useEffect(() => {
    const sync = (event: Event) => setImplementor(event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : read())
    window.addEventListener('storage', sync)
    window.addEventListener(ACTIVE_IMPLEMENTOR_CHANGE_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(ACTIVE_IMPLEMENTOR_CHANGE_EVENT, sync)
    }
  }, [])

  return { activeImplementor, isAllImplementors: activeImplementor === ALL_IMPLEMENTORS }
}
