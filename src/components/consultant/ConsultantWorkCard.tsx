import { Card, Space, Tag, Typography } from 'antd'
import { AimOutlined } from '@ant-design/icons'
import { useLanguage } from '@/providers/LanguageProvider'
import { areasFor, coversAllAreas, hoursFor, useCompanyWorkSettings } from '@/services/companyWorkSettingsService'
import '@/styles/week-hours.css'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ORDER = [1, 2, 3, 4, 5, 6, 0]

/**
 * A company consultant's areas of support and working hours, read-only: their project admins and
 * operations set these on Manage team, so the consultant sees what was set and who to ask.
 */
export const ConsultantWorkCard = ({ uid, companyCode }: { uid: string; companyCode?: string | null }) => {
    const { t } = useLanguage()
    const settings = useCompanyWorkSettings(companyCode)
    const areas = areasFor(settings, uid)
    const allAreas = coversAllAreas(settings, uid)
    const { windows, source } = hoursFor(settings, uid)

    return (
        <Card className="dashboard-section-card motion-card" title={<Space><AimOutlined /> {t('Your work')}</Space>}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <div>
                    <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>{t('Areas of support')}</Typography.Text>
                    {allAreas
                        ? <Tag>{t('All areas')}</Tag>
                        : areas.length
                            ? <Space size={[6, 6]} wrap>{areas.map((area) => <Tag key={area}>{area}</Tag>)}</Space>
                            : <Typography.Text type="secondary">{t('None set yet. You can only pick up work once operations add your areas.')}</Typography.Text>}
                </div>
                <div>
                    <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
                        {source === 'own' ? t('Your working hours') : t('Company operating hours')}
                    </Typography.Text>
                    {windows.length ? (
                        <ul className="week-hours-summary">
                            {ORDER.map((day) => {
                                const window = windows.find((item) => item.dayOfWeek === day)
                                return <li key={day} className={window ? undefined : 'is-closed'}><span>{t(DAYS[day])}</span><span>{window ? `${window.startTime} – ${window.endTime}` : t('Closed')}</span></li>
                            })}
                        </ul>
                    ) : <Typography.Text type="secondary">{t('No working hours set yet.')}</Typography.Text>}
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>{t('Set by your operations team. Ask them if something needs to change.')}</Typography.Text>
            </Space>
        </Card>
    )
}

export default ConsultantWorkCard
