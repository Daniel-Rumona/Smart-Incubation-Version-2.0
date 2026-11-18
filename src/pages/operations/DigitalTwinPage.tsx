import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Empty, Skeleton } from 'antd'
import TwinScreen from '@/components/twin/TwinScreen'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { loadTwinBusinesses, type TwinBusiness } from '@/services/digitalTwinService'
import { SME_KIND, buildSmeTwin, smeScore, smeSubject } from '@/utils/twinView'
import '@/styles/digital-twin.css'

/** The incubation side's digital twin: one SME at a time, by the control tower's readiness rules. */
export const DigitalTwinPage = () => {
  const { user } = useFullIdentity()
  const { activeProgramId } = useActiveProgramId()
  const { participantId } = useParams()
  const navigate = useNavigate()
  const [businesses, setBusinesses] = useState<TwinBusiness[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    let cancelled = false
    loadTwinBusinesses(user, activeProgramId)
      .then((rows) => { if (!cancelled) setBusinesses(rows.sort((a, b) => a.businessName.localeCompare(b.businessName))) })
      .catch((reason: Error) => { if (!cancelled) setError(reason.message === 'forbidden' ? 'You do not have access to the digital twin.' : 'The twin could not be loaded.') })
    return () => { cancelled = true }
  }, [user, activeProgramId])

  const subjects = useMemo(() => (businesses || []).map((business) => ({ business, subject: smeSubject(business), score: smeScore(business) })), [businesses])
  // Opens on the business furthest along, unless one is named in the address.
  const current = useMemo(() => subjects.find((row) => row.subject.id === participantId) || [...subjects].sort((a, b) => b.score - a.score)[0] || null, [subjects, participantId])
  const build = useCallback((picked: Record<string, boolean>) => buildSmeTwin((current as NonNullable<typeof current>).business, picked), [current])

  if (error) return <div className='dt-mode dt-center'><Empty description={error} /></div>
  if (!businesses) return <div className='dt-mode dt-center'><Skeleton active paragraph={{ rows: 10 }} /></div>
  if (!current) return <div className='dt-mode dt-center'><Empty description='No SMEs in this workspace yet.' /></div>

  return (
    <TwinScreen
      key={current.subject.id}
      kind={SME_KIND}
      subjects={subjects}
      subject={current.subject}
      build={build}
      onSelect={(id) => navigate(`${SME_KIND.path}/${id}`)}
    />
  )
}

export default DigitalTwinPage
