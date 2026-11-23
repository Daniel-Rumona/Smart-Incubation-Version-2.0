import { useState } from 'react'
import { App, Button, Card, Segmented, Space, Typography } from 'antd'
import { UserAddOutlined, UserOutlined } from '@ant-design/icons'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useTeamSize } from '@/hooks/useTeamSize'
import { useLanguage } from '@/providers/LanguageProvider'
import type { TeamSize } from '@/services/directorSetupService'

const { Text } = Typography

/**
 * Directors say who runs the programme day to day. "Just me" gives their own account the operations role too
 * (set server-side; firestore.rules never lets anyone add it to their own record), so one login can run it.
 * While it's "Just me", the team pages are out of the menu, so this card is the way in to add a first team member.
 */
export function TeamSizeCard({ teamSize }: { teamSize?: TeamSize }) {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const { changeTeamSize, openManageTeam } = useTeamSize()
    // Two choices: Just me, or With a team (saved as 'small'; an older 'large' reads as a team too).
    const [value, setValue] = useState<TeamSize>(teamSize === 'solo' || (!teamSize && user?.secondRole === 'operations') ? 'solo' : 'small')
    const [saving, setSaving] = useState(false)

    const change = async (next: TeamSize) => {
        const previous = value
        setValue(next)
        setSaving(true)
        try {
            await changeTeamSize(next)
            message.success(next === 'solo'
                ? t('Your account can now run the programme too. Switch between overseeing and running it from the top bar.')
                : t('Saved. Your account is back to overseeing only.'))
        } catch (error) {
            console.error(error)
            setValue(previous)
            message.error(t('This could not be saved. Try again.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card className="dashboard-section-card motion-card" title={<Space><UserOutlined /> {t('Who runs the programme')}</Space>}>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Segmented<TeamSize>
                    block
                    value={value}
                    disabled={saving}
                    onChange={(next) => void change(next)}
                    options={[
                        { value: 'solo', label: t('Just me') },
                        { value: 'small', label: t('With a team') },
                    ]}
                />
                <Text type="secondary" className="settings-hint">
                    {value === 'solo'
                        ? t('You oversee the programme and run it from this one account: approving applications, assigning support and recording progress.')
                        : t('Your operations team runs the programme from their own accounts; you oversee it.')}
                </Text>
                {value === 'solo' && (
                    <>
                        <Button icon={<UserAddOutlined />} onClick={openManageTeam} disabled={saving}>{t('Add a team member')}</Button>
                        <Text type="secondary" className="settings-hint">{t('Growing your team? Add people here. Once someone joins, switch to With a team.')}</Text>
                    </>
                )}
            </Space>
        </Card>
    )
}
