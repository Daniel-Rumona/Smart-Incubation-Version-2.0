import { Alert } from 'antd'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { hasRolePermission } from '@/config/permissions'
import { canAccessPlatformOwnerRoute } from '@/services/companiesService'
import type { AppRoute } from '@/types/routes'
import { journeyAllows, marketplaceConsultantAllows } from '@/utils/routeAccess'
import { useLanguage } from '@/providers/LanguageProvider'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { PageSkeleton } from '@/components/shared/PageSkeleton'

/**
 * Guards one URL. A shared page can be listed more than once in the route config (one nav entry per
 * role group), so the user gets in when any of the entries for this path allows them.
 */
export const ProtectedRoute = ({ routes }: { routes: AppRoute[] }) => {
  const { t } = useLanguage()
  const { user } = useFullIdentity()
  const { settings, ready: settingsReady } = useSystemSettings()
  const allowedRoute = user && routes.find((route) =>
    route.allowedRoles.includes(user.role)
    && (!route.requiredPermission || hasRolePermission(user.role, route.requiredPermission, user.permissions))
    && (!route.platformOwnerOnly || canAccessPlatformOwnerRoute(user))
    && (!route.requiredSetting || settings[route.requiredSetting] === true)
    && journeyAllows(route, user)
    && marketplaceConsultantAllows(route, user))

  if (!allowedRoute) {
    // A client module's page waits for the company settings before deciding, rather than flashing a refusal.
    if (!settingsReady && routes.some((route) => route.requiredSetting)) return <PageSkeleton />
    return <Alert type="error" showIcon message={t('You do not have permission to view this page.')} />
  }

  return allowedRoute.element
}
