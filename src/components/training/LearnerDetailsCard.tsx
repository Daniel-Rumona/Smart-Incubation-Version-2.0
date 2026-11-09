import { useState } from 'react'
import { App, Button, Form, Typography } from 'antd'
import { MotionCard } from '@/components/shared/MotionCard'
import { DetailFields } from '@/components/training/DetailFields'
import type { DetailField } from '@/config/trainingDetails'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { saveMyLearnerDetails } from '@/services/trainingDetailsService'
import { useLanguage } from '@/providers/LanguageProvider'
import type { TrainingDetails, TrainingLearner } from '@/types/training'

/**
 * On the learner's training page while any of the details their training provider asks for is missing. Saved to each
 * of their class records.
 */
export const LearnerDetailsCard = ({ learners, fields, provider, onSaved }: { learners: TrainingLearner[], fields: DetailField[], provider: string, onSaved: () => void }) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [form] = Form.useForm<{ details: TrainingDetails }>()
    const [saving, setSaving] = useState(false)
    const known = Object.assign({}, ...learners.map((learner) => learner.details || {})) as TrainingDetails

    const save = async () => {
        if (!user) return
        const { details } = await form.validateFields()
        setSaving(true)
        try {
            await Promise.all(learners.map((learner) => saveMyLearnerDetails(user, learner.id, { ...(learner.details || {}), ...details })))
            message.success(t('Thank you. Your details were saved.'))
            onSaved()
        } catch {
            message.error(t('Your details could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <MotionCard title={t('Your details')} style={{ marginBottom: 14 }}>
            <Typography.Paragraph type="secondary">{t('{provider} asks every learner for these, for its training records.', undefined, { provider })}</Typography.Paragraph>
            <Form form={form} layout="vertical" requiredMark={false} initialValues={{ details: known }}>
                <DetailFields fields={fields} required />
            </Form>
            <Button type="primary" loading={saving} onClick={() => void save()}>{t('Save my details')}</Button>
        </MotionCard>
    )
}
