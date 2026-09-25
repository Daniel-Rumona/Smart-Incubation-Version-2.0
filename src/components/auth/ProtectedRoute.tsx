import { Alert } from 'antd'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { hasRolePermission } from '@/config/permissions'
import { canAccessPlatformOwnerRoute } from '@/services/companiesService'
import type { AppRoute } from '@/types/routes'
import { useLanguage } from '@/providers/LanguageProvider'

export const ProtectedRoute = ({ route }: { route: AppRoute }) => {
  const { t } = useLanguage()
  const { user } = useFullIdentity()
  const allowed = !!user
    && route.allowedRoles.includes(user.role)
    && (!route.requiredPermission || hasRolePermission(user.role, route.requiredPermission, user.permissions))
    && (!route.platformOwnerOnly || canAccessPlatformOwnerRoute(user))

  if (!allowed) {
    return <Alert type="error" showIcon message={t('You do not have permission to view this page.')} />
  }

  return route.element
}
