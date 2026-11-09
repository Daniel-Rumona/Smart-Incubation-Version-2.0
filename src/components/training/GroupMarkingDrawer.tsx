import { useState } from 'react'
import { App, Button, Checkbox, Drawer, Grid, InputNumber, Space, Typography } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
import { MotionCard } from '@/components/shared/MotionCard'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { markTrainingGroup } from '@/services/trainingService'
import { useLanguage } from '@/providers/LanguageProvider'
import type { TrainingGroup, TrainingLearner, TrainingRubricCriterion } from '@/types/training'

type Props = {
    group?: TrainingGroup
    rubric: TrainingRubricCriterion[]
    learners: TrainingLearner[]
    onClose: () => void
}

/** Marks a group's case assignment against the rubric and records which members took part. */
export const GroupMarkingDrawer = ({ group, ...rest }: Props) => {
    if (!group) return <Drawer open={false} onClose={rest.onClose} />
    // Keyed by group: the form starts from the saved marks and is not reset by live updates while marking.
    return <GroupMarkingContent key={group.id} group={group} {...rest} />
}

const GroupMarkingContent = ({ group, rubric, learners, onClose }: Props & { group: TrainingGroup }) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const screens = Grid.useBreakpoint()
    const [marks, setMarks] = useState<Record<string, number>>(() => ({ ...group.rubricMarks }))
    const [absent, setAbsent] = useState<string[]>(() => [...group.absentLearnerIds])
    const [saving, setSaving] = useState(false)

    const members = group.learnerIds
        .map((id) => learners.find((learner) => learner.id === id))
        .filter((learner): learner is TrainingLearner => Boolean(learner))
    const total = rubric.reduce((sum, criterion) => sum + Math.min(criterion.maxMarks, marks[criterion.id] ?? 0), 0)
    const maxTotal = rubric.reduce((sum, criterion) => sum + criterion.maxMarks, 0)

    const save = async () => {
        if (!user) return
        setSaving(true)
        try {
            await markTrainingGroup(user, group, rubric, marks, absent)
            message.success(t('{name} marked.', undefined, { name: group.name }))
            onClose()
        } catch {
            message.error(t('The group mark could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Drawer
            open
            title={t('Mark {name}', undefined, { name: group.name })}
            width={screens.md ? 640 : '100%'}
            onClose={onClose}
            footer={(
                <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                    <Typography.Text strong>{t('Total: {score} of {total}', undefined, { score: total, total: maxTotal })}</Typography.Text>
                    <Button type="primary" icon={<CheckOutlined />} loading={saving} onClick={() => void save()}>{t('Save group mark')}</Button>
                </Space>
            )}
        >
            <Space orientation="vertical" style={{ width: '100%' }} size={12}>
                {rubric.map((criterion) => (
                    <MotionCard key={criterion.id} size="small">
                        <Space orientation="vertical" style={{ width: '100%' }} size={6}>
                            <Typography.Text strong>{criterion.label}</Typography.Text>
                            {criterion.guidance && <Typography.Text type="secondary">{criterion.guidance}</Typography.Text>}
                            <InputNumber
                                min={0}
                                max={criterion.maxMarks}
                                value={marks[criterion.id] ?? 0}
                                onChange={(value) => setMarks((current) => ({ ...current, [criterion.id]: Math.max(0, value ?? 0) }))}
                                addonAfter={t('of {count}', undefined, { count: criterion.maxMarks })}
                            />
                        </Space>
                    </MotionCard>
                ))}
                <MotionCard size="small" title={t('Took part')}>
                    <Space orientation="vertical">
                        <Typography.Text type="secondary">{t('Untick anyone who did not take part. They do not get the group\'s participation towards passing.')}</Typography.Text>
                        {members.map((learner) => (
                            <Checkbox
                                key={learner.id}
                                checked={!absent.includes(learner.id)}
                                onChange={(event) => setAbsent((current) => event.target.checked
                                    ? current.filter((id) => id !== learner.id)
                                    : [...current, learner.id])}
                            >
                                {learner.name} <Typography.Text type="secondary">({learner.organisation})</Typography.Text>
                            </Checkbox>
                        ))}
                    </Space>
                </MotionCard>
            </Space>
        </Drawer>
    )
}
