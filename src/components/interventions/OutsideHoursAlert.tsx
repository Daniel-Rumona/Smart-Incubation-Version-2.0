import { Alert } from 'antd'
import type { Dayjs } from 'dayjs'
import { useLanguage } from '@/providers/LanguageProvider'
import { outsideHours, useCompanyWorkSettings } from '@/services/companyWorkSettingsService'

/**
 * Warns (never blocks) when an appointment falls outside the consultant's working hours — their own if
 * operations set some, otherwise the company's. Says nothing when no hours are set.
 */
export const OutsideHoursAlert = ({ companyCode, assigneeId, range }: { companyCode?: string | null; assigneeId?: string | null; range?: [Dayjs | null, Dayjs | null] | null }) => {
    const { t } = useLanguage()
    const settings = useCompanyWorkSettings(companyCode)
    if (!range?.[0] || !range?.[1] || !settings) return null
    const result = outsideHours(settings, assigneeId, range[0].toDate(), range[1].toDate())
    if (!result) return null
    const hours = result.windows.map((window) => `${window.startTime}–${window.endTime}`).join(', ')
    const whose = result.source === 'own' ? t('the consultant’s hours') : t('company operating hours')
    return (
        <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={result.closedDay
                ? t('This day is outside {whose}.', undefined, { whose })
                : t('This time is outside {whose} ({hours}).', undefined, { whose, hours })}
            description={t('You can still book it. Check with the consultant first.')}
        />
    )
}

export default OutsideHoursAlert
