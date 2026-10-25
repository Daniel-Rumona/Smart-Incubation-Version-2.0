import { Navigate, useLocation } from 'react-router-dom'

/** Old `/operations/interventions/appointments` and `/consultant/appointments` links, keeping `?create=1` etc. */
export const AppointmentsRedirect = () => {
    const { search } = useLocation()
    return <Navigate to={`/shared/interventions/appointments${search}`} replace />
}
