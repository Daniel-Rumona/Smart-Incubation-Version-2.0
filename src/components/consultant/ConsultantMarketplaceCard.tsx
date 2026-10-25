import { Avatar, Card, Space, Tag, Typography } from 'antd'
import { SafetyCertificateOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import { useLanguage } from '@/providers/LanguageProvider'
import type { ConsultantMarketplaceProfile } from '@/types/consultantMarketplace'

const { Text, Paragraph } = Typography

/**
 * A consultant as SMEs see them in the marketplace. Shared by the marketplace and the consultant's
 * own "Preview as SME", so the preview can never drift from the real card.
 */
export const ConsultantMarketplaceCard = ({ profile, action }: { profile: ConsultantMarketplaceProfile, action?: ReactNode }) => {
    const { t } = useLanguage()
    return (
        <Card size="small" className="consultant-service-card" hoverable>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Space><Avatar size="small" src={profile.profileImageUrl || undefined}>{profile.name.charAt(0)}</Avatar><Text strong>{profile.headline || profile.name}</Text>{profile.verificationStatus === 'verified' && <Tag color="blue" icon={<SafetyCertificateOutlined />}>{t('Verified')}</Tag>}</Space>
                {profile.experienceYears > 0 && <Text type="secondary">{profile.experienceYears} {t('years experience')}</Text>}
                <Paragraph type="secondary" ellipsis={{ rows: 3 }} style={{ marginBottom: 0 }}>{profile.bio || t('No description provided yet.')}</Paragraph>
                <Space wrap>{profile.specialties.map((specialty) => <Tag key={specialty}>{specialty}</Tag>)}</Space>
                {profile.services.length > 0 && (
                    <Space direction="vertical" size={2}>
                        <Text type="secondary">{t('From')} {profile.currency} {profile.services[0].rate} {t('per day')}</Text>
                        <Text type="secondary">{profile.services.map((service) => service.areaOfSupport).filter(Boolean).join(' · ')}</Text>
                    </Space>
                )}
                {(profile.country || profile.province || profile.physicalAddress || profile.operatingLocation) && <Text type="secondary">{t('Based in')} {[profile.province, profile.country].filter(Boolean).join(', ')} · {profile.serviceRadiusKm} {t('km in person')}</Text>}
                {action}
            </Space>
        </Card>
    )
}

export default ConsultantMarketplaceCard
