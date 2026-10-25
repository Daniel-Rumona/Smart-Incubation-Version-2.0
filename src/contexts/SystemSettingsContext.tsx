import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'

type SystemSettings = Record<string, unknown>

type SystemSettingsContextValue = {
  settings: SystemSettings
  loading: boolean
  consultantLabel: string
  smeDivisionModel: string
  getSetting: <T,>(key: string, fallback: T) => T
  refresh: () => Promise<void>
}

const SystemSettingsContext = createContext<SystemSettingsContextValue | undefined>(undefined)

export const SystemSettingsProvider = ({ children }: PropsWithChildren) => {
  const { user } = useFullIdentity()
  const [settings, setSettings] = useState<SystemSettings>({})
  const [loading, setLoading] = useState(false)

  const uid = user?.uid
  const companyCode = String(user?.companyCode || '').trim()

  // Settings are only readable once signed in, and must reload when the signed-in user changes
  // (not just their company: an SME without a companyCode would otherwise keep the signed-out, empty settings).
  const load = useCallback(async () => {
    if (!uid) {
      setSettings({})
      return
    }

    setLoading(true)
    try {
      const [globalSnapshot, companySnapshot, plansSnapshot] = await Promise.all([
        getDoc(doc(db, 'systemSettings', 'global')),
        companyCode ? getDoc(doc(db, 'companies', companyCode)) : Promise.resolve(null),
        // What each plan tier includes (edited on the admin Company plans page); optional, defaults apply without it.
        getDoc(doc(db, 'systemSettings', 'plans')).catch(() => null),
      ])
      setSettings(Object.assign(
        {},
        globalSnapshot.exists() ? globalSnapshot.data() : {},
        companySnapshot?.exists() ? companySnapshot.data() : {},
        plansSnapshot?.exists() ? { planDefinitions: plansSnapshot.data() } : {},
      ))
    } catch (error) {
      console.warn('Could not load system settings; using defaults.', error)
    } finally {
      setLoading(false)
    }
  }, [companyCode, uid])

  useEffect(() => {
    void load()
  }, [load])

  const getSetting = useCallback(<T,>(key: string, fallback: T) => {
    return (settings[key] ?? fallback) as T
  }, [settings])

  const consultantLabel = getSetting('consultantLabel', 'Consultants')
  const smeDivisionModel = getSetting('smeDivisionModel', 'registered_consultant_only')
  const value = useMemo(() => ({ settings, loading, consultantLabel, smeDivisionModel, getSetting, refresh: load }), [consultantLabel, getSetting, load, loading, settings, smeDivisionModel])

  return <SystemSettingsContext.Provider value={value}>{children}</SystemSettingsContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useSystemSettings = () => {
  const context = useContext(SystemSettingsContext)
  if (!context) throw new Error('useSystemSettings must be used inside SystemSettingsProvider')
  return context
}
