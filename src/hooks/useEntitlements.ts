import { useMemo } from 'react'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { normalizePlanFeatures, resolveEntitlements, type FeatureKey, type Subscription } from '@/config/entitlements'

/**
 * What the signed-in person's company plan includes. Reads `subscription` from the company record and the plan
 * contents (`planDefinitions`) that SystemSettingsProvider already loads, so no extra request is made. Platform
 * admins (no company) are never restricted.
 */
export const useEntitlements = (options: { unrestricted?: boolean } = {}) => {
  const { settings } = useSystemSettings()
  return useMemo(() => {
    const resolved = resolveEntitlements(settings.subscription as Subscription, normalizePlanFeatures(settings.planDefinitions))
    const has = (feature: FeatureKey) => options.unrestricted || resolved.features[feature]
    return { ...resolved, has }
  }, [settings.subscription, settings.planDefinitions, options.unrestricted])
}
