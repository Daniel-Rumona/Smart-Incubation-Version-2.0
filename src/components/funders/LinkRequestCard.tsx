import { useState } from 'react'
import { App, Button, Card, Popconfirm, Space, Typography } from 'antd'
import { CheckOutlined, CloseOutlined, LinkOutlined } from '@ant-design/icons'
import { useLanguage } from '@/providers/LanguageProvider'
import { funderOrgErrorMessage, respondToFunderLink, type FunderLink } from '@/services/funderOrganisationsService'
import '@/styles/funder.css'

/**
 * One programme link request for a funder organisation's member: accept it, or "Not our project". Used on the funder
 * dashboard (FunderOrgPanel) and in the sign-in pop-up (FunderLinkRequestsPopup). Accept waits for the organisation
 * to be confirmed.
 */
export default function LinkRequestCard({ link, confirmed }: { link: FunderLink; confirmed: boolean }) {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const [busy, setBusy] = useState<'accept' | 'decline'>()

  const answer = async (accept: boolean) => {
    setBusy(accept ? 'accept' : 'decline')
    try {
      await respondToFunderLink(link.id, accept)
      message.success(accept
        ? t('Accepted. {programme} is now on your dashboard.', undefined, { programme: link.programName })
        : t('Declined. {company} has been told.', undefined, { company: link.companyName }))
    } catch (error) {
      message.error(funderOrgErrorMessage(error, t('That didn\'t work. Try again.'), ''))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <Card size="small" className="funder-request-card">
      <LinkOutlined className="funder-request-icon" aria-hidden="true" />
      <div className="funder-request-body">
        <Typography.Text strong>{t('{company} lists you as a funder', undefined, { company: link.companyName })}</Typography.Text>
        <p>{t('Programme: {programme}. Accept to add its results to your dashboard: SMEs supported, jobs, revenue and support delivered, never SME contact details.', undefined, { programme: link.programName })}</p>
        <Space wrap>
          <Button
            type="primary"
            icon={<CheckOutlined />}
            disabled={!confirmed}
            title={confirmed ? undefined : t('You can accept once your organisation is confirmed.')}
            loading={busy === 'accept'}
            onClick={() => void answer(true)}
          >
            {t('Accept')}
          </Button>
          <Popconfirm
            title={t('Not your project?')}
            description={t('{company} is told, so they can check the funder\'s name.', undefined, { company: link.companyName })}
            okText={t('Not our project')}
            cancelText={t('Keep')}
            onConfirm={() => void answer(false)}
          >
            <Button icon={<CloseOutlined />} loading={busy === 'decline'}>{t('Not our project')}</Button>
          </Popconfirm>
        </Space>
      </div>
    </Card>
  )
}
