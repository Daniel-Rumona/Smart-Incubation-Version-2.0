import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ConfigProvider, theme as antdTheme } from 'antd'
import { darkTheme, lightTheme } from '@/config/theme'

type ThemeMode = 'light' | 'dark'

type ThemeContextValue = {
    mode: ThemeMode
    setMode: (mode: ThemeMode) => void
    toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const THEME_STORAGE_KEY = 'smartv2.themeMode'

const readStoredPreference = (): ThemeMode | null => {
    try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
        return stored === 'light' || stored === 'dark' ? stored : null
    } catch {
        return null
    }
}

const systemPrefersDark = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches

export const ThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
    // An explicit choice (saved across refreshes) wins; with none saved, the theme follows the operating system.
    const [preference, setPreference] = useState<ThemeMode | null>(readStoredPreference)
    const [systemDark, setSystemDark] = useState(systemPrefersDark)
    const mode: ThemeMode = preference ?? (systemDark ? 'dark' : 'light')

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return
        const query = window.matchMedia('(prefers-color-scheme: dark)')
        const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
        query.addEventListener('change', onChange)
        return () => query.removeEventListener('change', onChange)
    }, [])

    useEffect(() => {
        document.documentElement.dataset.theme = mode
        document.body.dataset.theme = mode
    }, [mode])

    const setMode = useCallback((next: ThemeMode) => {
        setPreference(next)
        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, next)
        } catch {
            // Storage can be unavailable (private windows); the choice still applies for this session.
        }
    }, [])

    const value = useMemo<ThemeContextValue>(() => {
        return {
            mode,
            setMode,
            toggleTheme: () => setMode(mode === 'light' ? 'dark' : 'light'),
        }
    }, [mode, setMode])

    const config = mode === 'light' ? lightTheme : darkTheme

    return (
        <ThemeContext.Provider value={value}>
            <ConfigProvider
                pagination={{ showSizeChanger: false }}
                theme={{
                    ...config,
                    algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
                }}
            >
                {children}
            </ConfigProvider>
        </ThemeContext.Provider>
    )
}

// Provider and hook intentionally share a module while the recovery structure settles.
// eslint-disable-next-line react-refresh/only-export-components
export const useThemeMode = () => {
    const context = useContext(ThemeContext)

    if (!context) {
        throw new Error('useThemeMode must be used inside ThemeProvider')
    }

    return context
}
