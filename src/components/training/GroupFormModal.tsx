import { useEffect, useMemo, useState } from 'react'
import { App, Form, Input, Modal, Select } from 'antd'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { saveTrainingGroup } from '@/services/trainingService'
import { useLanguage } from '@/providers/LanguageProvider'
import type { TrainingGroup, TrainingGroupValues, TrainingLearner } from '@/types/training'

type Props = {
    open: boolean
    classId: string
    group?: TrainingGroup
    groups: TrainingGroup[]
    learners: TrainingLearner[]
    /** The rubric total, kept on the group so its mark reads "x of y" even before marking. */
    maxTotal: number
    onClose: () => void
}

export const GroupFormModal = ({ open, classId, group, groups, learners, maxTotal, onClose }: Props) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [form] = Form.useForm<TrainingGroupValues>()
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!open) return
        form.setFieldsValue({
            name: group?.name || t('Group {n}', undefined, { n: groups.length + 1 }),
            learnerIds: group?.learnerIds || [],
        })
    }, [form, group, groups.length, open, t])

    // A learner can be in one group; learners already placed elsewhere are not offered.
    const options = useMemo(() => {
        const taken = new Set(groups.filter((row) => row.id !== group?.id).flatMap((row) => row.learnerIds))
        return learners
            .filter((learner) => !taken.has(learner.id))
            .map((learner) => ({ value: learner.id, label: `${learner.name} (${learner.organisation})` }))
    }, [group?.id, groups, learners])

    const submit = async () => {
        if (!user) return
        const values = await form.validateFields()
        setSaving(true)
        try {
            await saveTrainingGroup(user, classId, values, maxTotal, group?.id)
            message.success(group ? t('Group updated.') : t('Group created.'))
            onClose()
        } catch (error) {
            message.error(error instanceof Error && error.message === 'learner_in_other_group'
                ? t('One of these learners is already in another group.')
                : t('The group could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal
            open={open}
            title={group ? t('Edit group') : t('New group')}
            okText={group ? t('Save changes') : t('Create group')}
            onOk={() => void submit()}
            confirmLoading={saving}
            onCancel={onClose}
            destroyOnHidden
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item name="name" label={t('Group name')} rules={[{ required: true, whitespace: true, message: t('Enter a group name.') }]}>
                    <Input maxLength={60} />
                </Form.Item>
                <Form.Item name="learnerIds" label={t('Members')} rules={[{ required: true, type: 'array', min: 1, message: t('Choose at least one learner.') }]}>
                    <Select mode="multiple" options={options} optionFilterProp="label" placeholder={t('Choose the learners in this group')} />
                </Form.Item>
            </Form>
        </Modal>
    )
}
