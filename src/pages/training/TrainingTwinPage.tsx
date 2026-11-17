import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Empty, Skeleton } from 'antd'
import TwinScreen from '@/components/twin/TwinScreen'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { loadCompanyTwins } from '@/services/companyTwinService'
import { COMPANY_KIND, buildCompanyTwin, companyScore, type CompanyTwinSource } from '@/utils/companyTwin'
import '@/styles/digital-twin.css'

/** The training side's digital twin: one client company at a time, by its training standing. */
export const TrainingTwinPage = () => {
  const { user } = useFullIdentity()
  const { organisationId } = useParams()
  const navigate = useNavigate()
  const [sources, setSources] = useState<CompanyTwinSource[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    let cancelled = false
    loadCompanyTwins(user)
      .then((rows) => { if (!cancelled) setSources(rows.sort((a, b) => a.subject.name.localeCompare(b.subject.name))) })
      .catch(() => { if (!cancelled) setError('The twin could not be loaded.') })
    return () => { cancelled = true }
  }, [user])

  const subjects = useMemo(() => (sources || []).map((source) => ({ source, subject: source.subject, score: companyScore(source.input) })), [sources])
  // Opens on the company with the most going on (most staff booked), unless one is named in the address.
  const current = useMemo(() => subjects.find((row) => row.subject.id === organisationId) || [...subjects].sort((a, b) => b.source.input.learners.length - a.source.input.learners.length)[0] || null, [subjects, organisationId])
  const build = useCallback((picked: Record<string, boolean>) => buildCompanyTwin((current as NonNullable<typeof current>).source, picked), [current])

  if (error) return <div className='dt-mode dt-center'><Empty description={error} /></div>
  if (!sources) return <div className='dt-mode dt-center'><Skeleton active paragraph={{ rows: 10 }} /></div>
  if (!current) return <div className='dt-mode dt-center'><Empty description='No client companies yet.' /></div>

  return (
    <TwinScreen
      kind={COMPANY_KIND}
      subjects={subjects}
      subject={current.subject}
      build={build}
      onSelect={(id) => navigate(`${COMPANY_KIND.path}/${id}`)}
    />
  )
}

export default TrainingTwinPage
