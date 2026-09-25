import { App, Avatar, Button, Card, Empty, Space, Table, Tag, Typography } from 'antd'
import { CheckOutlined, SafetyCertificateOutlined, StopOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardHeader from '@/components/shared/DashboardHeader'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listConsultantProfilesForVerification, setConsultantVerification } from '@/services/consultantMarketplaceService'
import type { ConsultantMarketplaceProfile, ConsultantVerificationStatus } from '@/types/consultantMarketplace'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const verificationColor: Record<ConsultantVerificationStatus, string> = { unverified: 'default', pending: 'orange', verified: 'green' }

export default function ConsultantVerificationPage() {
  const { t } = useLanguage()
  const { user } = useFullIdentity()
  const { message } = App.useApp()
  const [profiles, setProfiles] = useState<ConsultantMarketplaceProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string>()

  const load = async () => {
    if (!user) return
    try {
      setLoading(true)
      setProfiles(await listConsultantProfilesForVerification(user))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('Consultant profiles could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timeout)
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateVerification = async (profile: ConsultantMarketplaceProfile, status: ConsultantVerificationStatus) => {
    if (!user) return
    try {
      setUpdating(profile.uid)
      await setConsultantVerification(user, profile.uid, status)
      message.success(status === 'verified' ? `${profile.name} is now verified.` : `${profile.name} verification was removed.`)
      await load()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('Verification status could not be updated.'))
    } finally {
      setUpdating(undefined)
    }
  }

  return (
    <DashboardPage>
      <DashboardHeader title={t('Consultant verification')} subtitle={tr('Review consultant accounts and approve the profiles that meet your verification standard.')} actions={<Tag color="blue" icon={<SafetyCertificateOutlined />}>{t('System administrator only')}</Tag>} />
      <Card className="dashboard-section-card">
        <Table
          rowKey="uid"
          loading={loading}
          dataSource={profiles}
          locale={{ emptyText: <Empty description={t('No consultant profiles found.')} /> }}
          columns={[
            { title: t('Consultant'), render: (_: unknown, profile: ConsultantMarketplaceProfile) => <Space><Avatar src={profile.profileImageUrl || undefined}>{profile.name.charAt(0)}</Avatar><Space direction="vertical" size={0}><Typography.Text strong>{profile.name}</Typography.Text><Typography.Text type="secondary">{profile.email}</Typography.Text></Space></Space> },
            { title: t('Location'), render: (_: unknown, profile: ConsultantMarketplaceProfile) => [profile.province, profile.country].filter(Boolean).join(', ') || t('Not provided') },
            { title: t('Profile status'), dataIndex: 'status', render: (status: string) => <Tag color={status === 'published' ? 'green' : 'gold'}>{status}</Tag> },
            { title: t('Verification'), dataIndex: 'verificationStatus', render: (status: ConsultantVerificationStatus) => <Tag color={verificationColor[status]} icon={status === 'verified' ? <SafetyCertificateOutlined /> : undefined}>{status}</Tag> },
            { title: t('Actions'), render: (_: unknown, profile: ConsultantMarketplaceProfile) => <Space><Button type="primary" icon={<CheckOutlined />} loading={updating === profile.uid} disabled={profile.verificationStatus === 'verified'} onClick={() => void updateVerification(profile, 'verified')}>{t('Verify')}</Button><Button danger icon={<StopOutlined />} loading={updating === profile.uid} disabled={profile.verificationStatus !== 'verified'} onClick={() => void updateVerification(profile, 'unverified')}>{t('Remove badge')}</Button></Space> },
          ]}
        />
      </Card>
    </DashboardPage>
  )
}
