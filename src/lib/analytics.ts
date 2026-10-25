import { firebaseApp } from '@/config/firebase'

// Google Analytics via Firebase. Stays off (every call is a no-op) until VITE_FIREBASE_MEASUREMENT_ID is set,
// and the SDK is only downloaded once the first event fires.
const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string | undefined

type AnalyticsModule = typeof import('firebase/analytics')
type Analytics = ReturnType<AnalyticsModule['getAnalytics']>

let loading: Promise<{ mod: AnalyticsModule, analytics: Analytics } | null> | null = null

const load = () => {
    if (!loading) {
        loading = (async () => {
            if (!measurementId || !firebaseApp) return null
            const mod = await import('firebase/analytics')
            if (!(await mod.isSupported())) return null
            return { mod, analytics: mod.initializeAnalytics(firebaseApp, { config: { send_page_view: true } }) }
        })().catch(() => null)
    }
    return loading
}

export const trackEvent = (name: string, params?: Record<string, string | number>) => {
    if (!measurementId) return
    void load().then(ready => ready?.mod.logEvent(ready.analytics, name, params))
}
