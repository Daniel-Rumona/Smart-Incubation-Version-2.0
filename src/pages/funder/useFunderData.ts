import { useEffect, useState } from 'react'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { loadFunderData, type FunderData } from '@/services/funderService'

/** The funder pages' shared data, reloaded when the programme selector changes. */
export const useFunderData = () => {
  const { user } = useFullIdentity()
  const { activeProgramId } = useActiveProgramId()
  const [data, setData] = useState<FunderData>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!user) return
    let active = true
    const timeout = window.setTimeout(() => {
      setLoading(true)
      loadFunderData(user, activeProgramId)
        .then((next) => { if (active) { setData(next); setError(false) } })
        .catch(() => { if (active) setError(true) })
        .finally(() => { if (active) setLoading(false) })
    }, 0)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [activeProgramId, user])

  return { data, loading, error, user }
}
