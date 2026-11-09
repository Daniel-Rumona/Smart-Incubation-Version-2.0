import { useState } from 'react'
import { Alert, App, Button, Collapse, Popconfirm, Space, Tag, Tooltip, Typography, type TableProps } from 'antd'
import { DeleteOutlined, EditOutlined, FormOutlined, PlusOutlined } from '@ant-design/icons'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { GroupFormModal } from '@/components/training/GroupFormModal'
import { GroupMarkingDrawer } from '@/components/training/GroupMarkingDrawer'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { deleteTrainingGroup } from '@/services/trainingService'
import { useLanguage } from '@/providers/LanguageProvider'
import type { TrainingAssessment, TrainingClass, TrainingGroup, TrainingLearner } from '@/types/training'

type Props = {
    trainingClass: TrainingClass
    assessment: TrainingAssessment | null
    learners: TrainingLearner[]
    groups: TrainingGroup[]
    loading: boolean
}

export const GroupsPanel = ({ trainingClass, assessment, learners, groups, loading }: Props) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [editing, setEditing] = useState<TrainingGroup | 'new' | null>(null)
    const [markingId, setMarkingId] = useState<string | null>(null)

    const rubric = assessment?.rubric || []
    const maxTotal = rubric.reduce((sum, criterion) => sum + criterion.maxMarks, 0)
    const grouped = new Set(groups.flatMap((group) => group.learnerIds))
    const ungrouped = learners.filter((learner) => !grouped.has(learner.id))
    const nameOf = (id: string) => learners.find((learner) => learner.id === id)?.name

    const remove = async (group: TrainingGroup) => {
        if (!user) return
        try {
            await deleteTrainingGroup(user, group.id)
            message.success(t('Group deleted.'))
        } catch {
            message.error(t('The group could not be deleted.'))
        }
    }

    const markLabel = (group: TrainingGroup) => group.markedAt
        ? <Tag color="green">{t('{score} of {total}', undefined, { score: group.total ?? 0, total: group.maxTotal || maxTotal })}</Tag>
        : <Tag>{t('Not marked')}</Tag>

    const actions = (group: TrainingGroup) => (
        <Space onClick={(event) => event.stopPropagation()}>
            <Tooltip title={rubric.length ? undefined : t('Add the rubric to the assessment first.')}>
                <Button icon={<FormOutlined />} disabled={!rubric.length} onClick={() => setMarkingId(group.id)}>{t('Mark')}</Button>
            </Tooltip>
            <Tooltip title={t('Edit group')}><Button icon={<EditOutlined />} onClick={() => setEditing(group)} aria-label={t('Edit group')} /></Tooltip>
            <Popconfirm
                title={t('Delete {name}?', undefined, { name: group.name })}
                description={t('Its members lose the group mark.')}
                okText={t('Delete')}
                okButtonProps={{ danger: true }}
                onConfirm={() => remove(group)}
            >
                <Tooltip title={t('Delete group')}><Button danger icon={<DeleteOutlined />} aria-label={t('Delete group')} /></Tooltip>
            </Popconfirm>
        </Space>
    )

    const members = (group: TrainingGroup) => (
        <Space wrap size={[4, 4]}>
            {group.learnerIds.map((id) => (
                <Tag key={id} color={group.absentLearnerIds.includes(id) ? 'red' : undefined}>
                    {nameOf(id) || t('Removed learner')}{group.absentLearnerIds.includes(id) ? ` · ${t('did not take part')}` : ''}
                </Tag>
            ))}
        </Space>
    )

    const columns: TableProps<TrainingGroup>['columns'] = [
        { title: t('Group'), dataIndex: 'name', render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
        { title: t('Members'), key: 'members', render: (_, group) => members(group) },
        { title: t('Mark'), key: 'mark', render: (_, group) => markLabel(group) },
        { title: '', key: 'actions', align: 'right', render: (_, group) => actions(group) },
    ]

    return (
        <>
            {!assessment && (
                <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('Choose the class assessment to mark groups against its rubric.')} />
            )}
            {assessment && !rubric.length && (
                <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('The assessment has no group rubric yet. Add it under Training > Assessments to mark groups.')} />
            )}
            {assessment?.caseBrief && (
                <Collapse
                    style={{ marginBottom: 12 }}
                    items={[{ key: 'brief', label: t('Case assignment brief'), children: <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{assessment.caseBrief}</Typography.Paragraph> }]}
                />
            )}
            <FilterBar
                compact
                primary={(
                    <Typography.Text type="secondary">
                        {ungrouped.length
                            ? t('{count} learner(s) not in a group yet.', undefined, { count: ungrouped.length })
                            : learners.length ? t('Every learner is in a group.') : t('Add learners before creating groups.')}
                    </Typography.Text>
                )}
                actions={<Button type="primary" icon={<PlusOutlined />} disabled={!ungrouped.length} onClick={() => setEditing('new')}>{t('New group')}</Button>}
            />
            <ResponsiveDataView
                rowKey="id"
                rows={groups}
                columns={columns}
                loading={loading}
                emptyText={trainingClass.groupAssignmentRequired
                    ? t('No groups yet. Learners need a marked group assignment to pass this class.')
                    : t('No groups yet.')}
                renderCard={(group) => (
                    <Space orientation="vertical" style={{ width: '100%' }}>
                        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Typography.Text strong>{group.name}</Typography.Text>
                            {markLabel(group)}
                        </Space>
                        {members(group)}
                        {actions(group)}
                    </Space>
                )}
            />
            <GroupFormModal
                open={editing !== null}
                classId={trainingClass.id}
                group={editing && editing !== 'new' ? editing : undefined}
                groups={groups}
                learners={learners}
                maxTotal={maxTotal}
                onClose={() => setEditing(null)}
            />
            <GroupMarkingDrawer
                group={groups.find((group) => group.id === markingId)}
                rubric={rubric}
                learners={learners}
                onClose={() => setMarkingId(null)}
            />
        </>
    )
}
