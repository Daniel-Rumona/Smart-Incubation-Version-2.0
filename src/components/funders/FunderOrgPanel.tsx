import { useEffect, useMemo, useState } from 'react'
import { Alert } from 'antd'
import LinkRequestCard from '@/components/funders/LinkRequestCard'
import { useLanguage } from '@/providers/LanguageProvider'
import { subscribeOrganisationLinks, subscribeOwnOrganisation, type FunderLink, type FunderOrganisation } from '@/services/funderOrganisationsService'
import type { FullIdentity } from '@/types/identity'
import '@/styles/funder-organisations.css'

type Props = { user: FullIdentity }

/**
 * The top of a funder organisation member's dashboard: a notice while a system admin confirms the organisation, and
 * the programme link requests waiting for an answer (accept, or "Not our project"). The programmes it funds and
 * inviting colleagues live in the account menu (FunderOrgAccountActions).
 */
export default function FunderOrgPanel({ user }: Props) {
  const { t } = useLanguage()
  const orgId = String(user.funderOrgId || '')
  const [organisation, setOrganisation] = useState<FunderOrganisation | null>(null)
  const [links, setLinks] = useState<FunderLink[]>([])
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (!orgId) return
    const failed = () => setLoadError(true)
    const stops = [
      subscribeOwnOrganisation(orgId, (row) => { setOrganisation(row); setLoadError(false) }, failed),
      subscribeOrganisationLinks(orgId, setLinks, failed),
    ]
    return () => stops.forEach((stop) => stop())
  }, [orgId])

  const pending = useMemo(() => links.filter((link) => link.status === 'pending')
    .sort((left, right) => (right.requestedAt?.getTime() || 0) - (left.requestedAt?.getTime() || 0)), [links])
  const confirmed = organisation?.status === 'confirmed'
  const name = organisation?.name || user.funderOrgName || t('Your organisation')

  if (!orgId || (!loadError && !pending.length && (!organisation || confirmed))) return null

  return (
    <div className="funder-requests">
      {loadError && <Alert type="error" showIcon message={t('Your organisation\'s details could not be loaded.')} />}

      {organisation && !confirmed && (
        <Alert
          type="info"
          showIcon
          message={t('{name} is being confirmed', undefined, { name })}
          description={t('A system admin checks each new funder organisation before it can see programme results. You can look through the requests below now, and accept them once it is confirmed. We\'ll email you.')}
        />
      )}

      {pending.map((link) => <LinkRequestCard key={link.id} link={link} confirmed={confirmed} />)}
    </div>
  )
}
