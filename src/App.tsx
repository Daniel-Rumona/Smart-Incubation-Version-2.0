import { Route, Routes } from 'react-router-dom'
import { appRoutes, publicRoutes } from '@/config/routes'
import { SystemLayout } from '@/layouts/SystemLayout'
import { NotFoundPage } from '@/pages/system/NotFoundPage'
import type { AppRoute } from '@/types/routes'
import type { ReactElement } from 'react'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'

const flattenRoutes = (routes: AppRoute[]): AppRoute[] =>
  routes.flatMap((route) => [route, ...(route.children ? flattenRoutes(route.children) : [])])

// Register each path once: shared pages appear in several role menus under the same URL.
const renderRoutes = (routes: AppRoute[]): ReactElement[] => {
  const routesByPath = new Map<string, AppRoute[]>()
  flattenRoutes(routes).forEach((route) => routesByPath.set(route.path, [...(routesByPath.get(route.path) || []), route]))
  return [...routesByPath].map(([path, entries]) => (
    <Route key={path} path={path} element={<ProtectedRoute routes={entries} />} />
  ))
}

function App() {
  return (
    <Routes>
      {publicRoutes.map((route) => (
        <Route key={route.path} path={route.path} element={<route.element />} />
      ))}
      <Route element={<SystemLayout />}>
        {renderRoutes(appRoutes)}
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default App
