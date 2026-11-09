import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_DETAILS_SETTINGS, type TrainingDetailsSettings } from '@/config/trainingDetails'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { getTrainingDetailsSettings } from '@/services/trainingDetailsService'
import { getMyOrganisation } from '@/services/trainingOrganisationsService'
import { useLanguage } from '@/providers/LanguageProvider'
import type { TrainingOrganisation } from '@/types/training'

/**
 * The client company's own record and what its training provider asks of it, for the company's pages (role clientorg).
 * `organisation` is undefined while loading and null when it could not be found.
 */
export const useMyOrganisation = () => {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const { settings } = useSystemSettings()
    const [organisation, setOrganisation] = useState<TrainingOrganisation | null>()
    const [detailsSettings, setDetailsSettings] = useState<TrainingDetailsSettings>(DEFAULT_DETAILS_SETTINGS)

    const reload = useCallback(async () => {
        if (!user) return
        try {
            const [own, asked] = await Promise.all([getMyOrganisation(user), getTrainingDetailsSettings(user)])
            setOrganisation(own)
            setDetailsSettings(asked)
        } catch {
            setOrganisation(null)
        }
    }, [user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void reload(), 0)
        return () => window.clearTimeout(timeout)
    }, [reload])

    const provider = String(settings.companyName || settings.name || '').trim() || t('your training provider')
    const logoUrl = typeof settings.logoUrl === 'string' && settings.logoUrl ? settings.logoUrl : undefined
    return { user, organisation, detailsSettings, provider, logoUrl, reload }
}
