import { useEffect, useMemo, useState } from 'react'
import { Button, Space, Typography } from 'antd'
import LinkRequestCard from '@/components/funders/LinkRequestCard'
import { getFirebaseAuth } from '@/config/firebase'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { useLanguage } from '@/providers/LanguageProvider'
import { subscribeOrganisationLinks, subscribeOwnOrganisation, type FunderLink, type FunderOrganisation } from '@/services/funderOrganisationsService'
import { isOrgFunder } from '@/services/funderScopeService'
import type { FullIdentity } from '@/types/identity'

// Keyed by the sign-in itself, so signing out and back in (even in the same tab) shows it again.
const signedInAt = () => {
  try {
    return getFirebaseAuth().currentUser?.metadata.lastSignInTime || ''
  } catch {
    return ''
  }
}
const seenKey = (uid: string) => `smartv2.funderLinkRequestsSeen.${uid}.${signedInAt()}`

const seenThisSession = (uid: string) => {
  try {
    return sessionStorage.getItem(seenKey(uid)) === '1'
  } catch {
    return false
  }
}

/**
 * Pops up once per sign-in for a funder organisation's member with programme link requests waiting, so they can
 * accept or decline them wherever they land. "Later" closes it until the next sign-in; the same requests stay on
 * the funder dashboard and in the notification bell.
 */
export default function FunderLinkRequestsPopup({ user }: { user: FullIdentity | null }) {
  const { t } = useLanguage()
  const orgId = isOrgFunder(user) ? String(user?.funderOrgId || '') : ''
  const uid = user?.uid || ''
  const [links, setLinks] = useState<FunderLink[]>([])
  const [organisation, setOrganisation] = useState<FunderOrganisation | null>(null)
  // The account loads after the first render, so "seen" is checked for whoever is signed in now.
  const [closedFor, setClosedFor] = useState<string>()
  const dismissed = !uid || closedFor === uid || seenThisSession(uid)

  useEffect(() => {
    if (!orgId) return
    const stops = [
      subscribeOrganisationLinks(orgId, setLinks, () => setLinks([])),
      subscribeOwnOrganisation(orgId, setOrganisation, () => setOrganisation(null)),
    ]
    return () => stops.forEach((stop) => stop())
  }, [orgId])

  const pending = useMemo(() => links.filter((link) => link.status === 'pending')
    .sort((left, right) => (right.requestedAt?.getTime() || 0) - (left.requestedAt?.getTime() || 0)), [links])

  const close = () => {
    try {
      sessionStorage.setItem(seenKey(uid), '1')
    } catch {
      // Storage blocked: it stays closed for this page load.
    }
    setClosedFor(uid)
  }

  // Shown once the organisation is known, so a request can't be offered before it's confirmed and then refused.
  const open = !!orgId && !dismissed && !!organisation && pending.length > 0
  const confirmed = organisation?.status === 'confirmed'

  return (
    <ResponsiveModal
      open={open}
      onClose={close}
      width={600}
      title={pending.length === 1 ? t('A programme lists you as a funder') : t('{count} programmes list you as a funder', undefined, { count: pending.length })}
      footer={<Button block onClick={close}>{t('Later')}</Button>}
    >
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          {confirmed
            ? t('Accept the ones your organisation funds. You can also answer them later from your dashboard.')
            : t('Your organisation is still being confirmed. You can accept these once it is; we\'ll email you.')}
        </Typography.Text>
        {pending.map((link) => <LinkRequestCard key={link.id} link={link} confirmed={confirmed} />)}
      </Space>
    </ResponsiveModal>
  )
}
