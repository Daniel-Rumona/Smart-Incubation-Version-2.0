import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { type LanguageCode, translations } from '@/config/languages'
import { zuCatalog } from '@/config/i18n/zuCatalog'

type LanguageContextValue = {
    language: LanguageCode
    setLanguage: (language: LanguageCode) => void
    /** Looks up `key` (a dotted key or the English source text); `vars` fills `{name}` placeholders. */
    t: (key: string, fallback?: string, vars?: Vars) => string
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined)

type Vars = Record<string, string | number>

const readStoredLanguage = (): LanguageCode => {
    try {
        return localStorage.getItem('smartv2.language') === 'zu' ? 'zu' : 'en'
    } catch {
        return 'en'
    }
}

let activeLanguage: LanguageCode = readStoredLanguage()

const translate = (language: LanguageCode, key: string, fallback?: string, vars?: Vars) => {
    const catalogued = language === 'zu' ? (zuCatalog[key] || (fallback ? zuCatalog[fallback] : undefined)) : undefined
    const text = translations[language]?.[key] || catalogued || fallback || key
    return vars ? text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match)) : text
}

/**
 * Translates with the language that is active right now. Use it where the `useLanguage` hook cannot go
 * (module-level getters, helpers called during render); components should still prefer `t` from the hook
 * so they re-render when the language changes.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const tr = (key: string, fallback?: string, vars?: Vars) => translate(activeLanguage, key, fallback, vars)

/** Always resolves English. Use for text that is sent to the agent or written to Firestore, which must stay English. */
// eslint-disable-next-line react-refresh/only-export-components
export const tEnglish = (key: string, fallback?: string, vars?: Vars) => translate('en', key, fallback, vars)

export const LanguageProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
    const [language, setLanguageState] = useState<LanguageCode>(readStoredLanguage)

    const setLanguage = useCallback((nextLanguage: LanguageCode) => {
        localStorage.setItem('smartv2.language', nextLanguage)
        activeLanguage = nextLanguage
        setLanguageState(nextLanguage)
    }, [])

    const value = useMemo<LanguageContextValue>(() => {
        return {
            language,
            setLanguage,
            t: (key, fallback, vars) => translate(language, key, fallback, vars),
        }
    }, [language, setLanguage])

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

// Provider and hook intentionally share a module while the recovery structure settles.
// eslint-disable-next-line react-refresh/only-export-components
export const useLanguage = () => {
    const context = useContext(LanguageContext)

    if (!context) {
        throw new Error('useLanguage must be used inside LanguageProvider')
    }

    return context
}
