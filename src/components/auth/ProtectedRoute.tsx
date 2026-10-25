import { Alert } from 'antd'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { hasRolePermission } from '@/config/permissions'
import { canAccessPlatformOwnerRoute } from '@/services/companiesService'
import type { AppRoute } from '@/types/routes'
import { journeyAllows, marketplaceConsultantAllows } from '@/utils/routeAccess'
import { useLanguage } from '@/providers/LanguageProvider'

/**
 * Guards one URL. A shared page can be listed more than once in the route config (one nav entry per
 * role group), so the user gets in when any of the entries for this path allows them.
 */
export const ProtectedRoute = ({ routes }: { routes: AppRoute[] }) => {
  const { t } = useLanguage()
  const { user } = useFullIdentity()
  const allowedRoute = user && routes.find((route) =>
    route.allowedRoles.includes(user.role)
    && (!route.requiredPermission || hasRolePermission(user.role, route.requiredPermission, user.permissions))
    && (!route.platformOwnerOnly || canAccessPlatformOwnerRoute(user))
    && journeyAllows(route, user)
    && marketplaceConsultantAllows(route, user))

  if (!allowedRoute) {
    return <Alert type="error" showIcon message={t('You do not have permission to view this page.')} />
  }

  return allowedRoute.element
}
