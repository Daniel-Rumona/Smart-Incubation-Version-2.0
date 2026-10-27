import { useState } from 'react'
import { App, Button, DatePicker, Input, Segmented, Space, Typography } from 'antd'
import { CalendarOutlined, StopOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { requestInterventionChange, type ChangeRequestType } from '@/services/interventionOverrideService'
import { ModalActions } from '@/components/shared/ModalActions'

const { Text } = Typography

/** Work this late is more likely stale than still in progress, so the dashboard groups it and offers this request. */
export const LONG_OVERDUE_DAYS = 90

type Props = {
    /** The intervention to ask about; null keeps the modal closed. */
    assignment: { id: string; title: string; participant: string } | null
    onClose: () => void
    /** Called once the request is saved, so the page can reload. */
    onSent?: () => void
}

/**
 * The assigned consultant asks operations to move the due date or close an overdue intervention. Nothing changes
 * until operations approve it on Interventions Monitoring.
 */
export function ChangeRequestModal({ assignment, onClose, onSent }: Props) {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [type, setType] = useState<ChangeRequestType>('extend')
    const [dueDate, setDueDate] = useState<Dayjs | null>(null)
    const [reason, setReason] = useState('')
    const [errors, setErrors] = useState<{ dueDate?: string; reason?: string }>({})
    const [saving, setSaving] = useState(false)

    const close = () => {
        setType('extend')
        setDueDate(null)
        setReason('')
        setErrors({})
        onClose()
    }

    const send = async () => {
        if (!user || !assignment) return
        const next = {
            dueDate: type === 'extend' && !dueDate ? t('Choose the new due date.') : undefined,
            reason: !reason.trim() ? (type === 'extend' ? t('Say why it needs more time.') : t('Say why it’s no longer needed.')) : undefined,
        }
        setErrors(next)
        if (next.dueDate || next.reason) return
        setSaving(true)
        try {
            await requestInterventionChange(user, assignment, { type, dueDate: dueDate?.toDate() ?? null, reason })
            message.success(t('Request sent to operations.'))
            close()
            onSent?.()
        } catch (failure) {
            message.error(failure instanceof Error ? failure.message : t('The request could not be sent.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <ResponsiveModal
            open={!!assignment}
            onClose={close}
            title={t('Ask operations to extend or close')}
            width={520}
            centered
            footer={<ModalActions><Button type="primary" loading={saving} onClick={() => void send()}>{t('Send request')}</Button></ModalActions>}
        >
            {assignment && (
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <Text type="secondary">{t('{title} for {sme}. Nothing changes until operations approve it.', undefined, { title: assignment.title, sme: assignment.participant })}</Text>
                    <Segmented<ChangeRequestType>
                        block
                        value={type}
                        onChange={(value) => { setType(value); setErrors({}) }}
                        options={[
                            { value: 'extend', label: t('Move the due date'), icon: <CalendarOutlined /> },
                            { value: 'close', label: t('Close it'), icon: <StopOutlined /> },
                        ]}
                    />
                    {type === 'extend' && (
                        <div>
                            <Text strong style={{ display: 'block', marginBottom: 6 }}>{t('New due date')}</Text>
                            <DatePicker
                                style={{ width: '100%' }}
                                value={dueDate}
                                onChange={(value) => { setDueDate(value); setErrors((current) => ({ ...current, dueDate: undefined })) }}
                                disabledDate={(day) => day.isBefore(dayjs().add(1, 'day'), 'day')}
                                status={errors.dueDate ? 'error' : undefined}
                            />
                            {errors.dueDate && <Text type="danger" style={{ fontSize: 13 }}>{errors.dueDate}</Text>}
                        </div>
                    )}
                    <div>
                        <Text strong style={{ display: 'block', marginBottom: 6 }}>{type === 'extend' ? t('Why does it need more time?') : t('Why is it no longer needed?')}</Text>
                        <Input.TextArea
                            rows={3}
                            maxLength={500}
                            showCount
                            value={reason}
                            onChange={(event) => { setReason(event.target.value); setErrors((current) => ({ ...current, reason: undefined })) }}
                            status={errors.reason ? 'error' : undefined}
                            placeholder={type === 'extend' ? t('The SME postponed the workshops until after harvest.') : t('The SME already has a website from another supplier.')}
                        />
                        {errors.reason && <Text type="danger" style={{ fontSize: 13 }}>{errors.reason}</Text>}
                    </div>
                </Space>
            )}
        </ResponsiveModal>
    )
}

export default ChangeRequestModal
