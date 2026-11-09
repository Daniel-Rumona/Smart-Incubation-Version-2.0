import { useEffect, useState } from 'react'
import { App, AutoComplete, Button, Form, Input, Modal } from 'antd'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { DetailFields } from '@/components/training/DetailFields'
import { FunderSelect } from '@/components/training/FunderSelect'
import { DEFAULT_DETAILS_SETTINGS, LEARNER_DETAIL_FIELDS, fieldsFor } from '@/config/trainingDetails'
import { getTrainingDetailsSettings } from '@/services/trainingDetailsService'
import { addTrainingLearner, updateTrainingLearner } from '@/services/trainingService'
import { useLanguage } from '@/providers/LanguageProvider'
import type { TrainingLearner, TrainingLearnerValues } from '@/types/training'

type Props = {
    open: boolean
    classId: string
    learner?: TrainingLearner
    /** Organisations already in the class, offered as suggestions so one client is not spelled two ways. */
    organisations: string[]
    onClose: () => void
}

export const LearnerFormModal = ({ open, classId, learner, organisations, onClose }: Props) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [form] = Form.useForm<TrainingLearnerValues>()
    const [saving, setSaving] = useState(false)
    const [learnerFields, setLearnerFields] = useState(DEFAULT_DETAILS_SETTINGS.learnerFields)

    useEffect(() => {
        if (!open || !user) return
        let cancelled = false
        getTrainingDetailsSettings(user).then((settings) => { if (!cancelled) setLearnerFields(settings.learnerFields) }, () => undefined)
        return () => { cancelled = true }
    }, [open, user])

    useEffect(() => {
        if (!open) return
        form.setFieldsValue({
            name: learner?.name || '',
            email: learner?.email || '',
            idNumber: learner?.idNumber || '',
            organisation: learner?.organisation || '',
            phone: learner?.phone || '',
            funderId: learner?.funderId,
            details: learner?.details || {},
        })
    }, [form, learner, open])

    const submit = async (addAnother: boolean) => {
        if (!user) return
        const values = await form.validateFields()
        setSaving(true)
        try {
            if (learner) await updateTrainingLearner(user, learner, values)
            else await addTrainingLearner(user, classId, values)
            message.success(learner ? t('Learner updated.') : t('{name} added to the class.', undefined, { name: values.name.trim() }))
            if (addAnother) {
                // Keep the organisation: learners usually arrive in groups from the same client.
                form.setFieldsValue({ name: '', email: '', idNumber: '', phone: '' })
                form.getFieldInstance('name')?.focus?.()
            } else {
                onClose()
            }
        } catch (error) {
            message.error(error instanceof Error && error.message === 'duplicate_learner'
                ? t('A learner with this email address is already in the class.')
                : t('The learner could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal
            open={open}
            title={learner ? t('Edit learner') : t('Add learner')}
            onCancel={onClose}
            destroyOnHidden
            okText={learner ? t('Save changes') : t('Add learner')}
            confirmLoading={saving}
            onOk={() => void submit(false)}
            footer={(_, { OkBtn, CancelBtn }) => (
                <>
                    <CancelBtn />
                    {!learner && <Button loading={saving} onClick={() => void submit(true)}>{t('Add and add another')}</Button>}
                    <OkBtn />
                </>
            )}
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item name="name" label={t('Full name')} rules={[{ required: true, whitespace: true, message: t('Enter the learner\'s name.') }]}>
                    <Input maxLength={120} autoComplete="off" />
                </Form.Item>
                <Form.Item name="organisation" label={t('Organisation')} rules={[{ required: true, whitespace: true, message: t('Enter the organisation the learner attends for.') }]}>
                    <AutoComplete
                        options={organisations.map((value) => ({ value }))}
                        filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())}
                        maxLength={160}
                    />
                </Form.Item>
                <Form.Item
                    name="email"
                    label={t('Email address')}
                    extra={learner?.uid ? t('The learner signs in with this address, so it can no longer be changed here.') : t('The learner\'s sign-in link is sent here. Needed to invite them to write assessments online.')}
                    rules={[{ type: 'email', message: t('Enter a valid email address.') }]}
                >
                    <Input maxLength={160} autoComplete="off" disabled={Boolean(learner?.uid)} />
                </Form.Item>
                <Form.Item
                    name="idNumber"
                    label={t('ID or passport number')}
                    rules={[{ max: 30 }]}
                >
                    <Input autoComplete="off" />
                </Form.Item>
                <Form.Item name="phone" label={t('Phone number (optional)')}>
                    <Input maxLength={30} autoComplete="off" />
                </Form.Item>
                <DetailFields fields={fieldsFor(LEARNER_DETAIL_FIELDS, learnerFields)} />
                <Form.Item name="funderId" label={t('Funded by (optional)')} extra={t('Only when someone other than the class\'s funder pays for this learner.')}>
                    <FunderSelect placeholder={t('Same as the class')} />
                </Form.Item>
            </Form>
        </Modal>
    )
}
