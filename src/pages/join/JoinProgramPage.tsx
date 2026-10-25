import { useEffect, useState } from 'react'
import { Alert, Button, Card, Result, Skeleton, Space, Typography } from 'antd'
import { ArrowRightOutlined, LoginOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { useLanguage } from '@/providers/LanguageProvider'
import { callableMessage, getProgramLinkInfo, savePendingProgramLink, type ProgramLinkInfo } from '@/services/programLinkService'

const { Title, Paragraph, Text } = Typography

/**
 * Public landing page for a programme link (`/join/<programId>`). It shows who the SME is joining, remembers the
 * programme, and sends them to the register side of the login. Role and company are then set automatically.
 */
export default function JoinProgramPage() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { programId = '' } = useParams<{ programId: string }>()
  const [info, setInfo] = useState<ProgramLinkInfo>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    getProgramLinkInfo(programId)
      .then((result) => { if (active) setInfo(result) })
      .catch((cause) => { if (active) setError(callableMessage(cause, t('This programme link could not be opened.'))) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [programId, t])

  const start = (mode: 'signup' | 'login') => {
    savePendingProgramLink(programId)
    navigate(`/auth?mode=${mode}`)
  }

  const usable = info && info.open && info.selfApplication

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <Card style={{ width: 'min(520px, 100%)', textAlign: 'center' }}>
        {loading && <Skeleton active />}

        {!loading && error && <Result status="warning" title={t('Link not available')} subTitle={error} extra={<Button onClick={() => navigate('/auth')}>{t('Go to sign in')}</Button>} />}

        {!loading && info && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {info.logoUrl && <img src={info.logoUrl} alt={info.companyName} style={{ maxHeight: 64, maxWidth: '100%', margin: '0 auto' }} />}
            <Text type="secondary">{t('You have been invited to join')}</Text>
            <Title level={3} style={{ margin: 0 }}>{info.programName}</Title>
            {info.companyName && <Paragraph style={{ margin: 0 }}>{t('Offered by')} <strong>{info.companyName}</strong></Paragraph>}

            {!info.selfApplication && (
              <Alert type="info" showIcon message={t('This organisation registers its own SMEs.')} description={t('Please contact the programme team and they will set you up.')} />
            )}
            {info.selfApplication && !info.open && (
              <Alert type="warning" showIcon message={t('This programme is not accepting applications right now.')} />
            )}

            {usable && (
              <>
                <Paragraph type="secondary" style={{ margin: 0 }}>{t('Create your account, tell us about your business, then apply. We will take you through it step by step.')}</Paragraph>
                <Button type="primary" size="large" block icon={<ArrowRightOutlined />} onClick={() => start('signup')}>{t('Create my account')}</Button>
                <Button size="large" block icon={<LoginOutlined />} onClick={() => start('login')}>{t('I already have an account')}</Button>
              </>
            )}
          </Space>
        )}
      </Card>
    </main>
  )
}
