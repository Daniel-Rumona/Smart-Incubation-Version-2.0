import { useMemo, useState } from 'react'
import { App, Button, Drawer, Grid, InputNumber, Popconfirm, Segmented, Space, Tag, Typography } from 'antd'
import { CheckOutlined, DeleteOutlined } from '@ant-design/icons'
import { MotionCard } from '@/components/shared/MotionCard'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { deleteSubmission, saveSubmissionMarks } from '@/services/trainingAssessmentService'
import { useLanguage } from '@/providers/LanguageProvider'
import { choiceMarks, isChoiceQuestion, scoreMarks } from '@/utils/trainingResults'
import type { TrainingLearner, TrainingSubmission } from '@/types/training'

type Props = {
    submission?: TrainingSubmission
    learner?: TrainingLearner
    memo: Record<string, string>
    passMarkPct: number
    onClose: () => void
}

export const MarkingDrawer = ({ submission, learner, ...rest }: Props) => {
    if (!submission || !learner) return <Drawer open={false} onClose={rest.onClose} />
    // Keyed by attempt: marks being entered start from the saved ones and are not reset by live updates.
    return <MarkingDrawerContent key={submission.id} submission={submission} learner={learner} {...rest} />
}

const MarkingDrawerContent = ({ submission, learner, memo, passMarkPct, onClose }: Props & { submission: TrainingSubmission, learner: TrainingLearner }) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const screens = Grid.useBreakpoint()
    // Multiple-choice answers mark themselves (also done on the server when the test is handed in); marks already
    // saved win, so a facilitator's correction stays.
    const [marks, setMarks] = useState<Record<string, number>>(() => ({
        ...(submission.source === 'online' ? choiceMarks(submission.questions, submission.answers, memo) : {}),
        ...submission.marks,
    }))
    const [saving, setSaving] = useState(false)

    const totals = useMemo(() => scoreMarks(submission.questions, marks), [marks, submission])

    const isPaper = submission.source === 'paper'
    const title = submission.kind === 'pre'
        ? t('Pre-assessment: {name}', undefined, { name: learner.name })
        : t('Post-assessment attempt {attempt}: {name}', undefined, { attempt: submission.attempt, name: learner.name })

    const setMark = (questionId: string, value: number | null) =>
        setMarks((current) => ({ ...current, [questionId]: Math.max(0, value ?? 0) }))

    const save = async () => {
        if (!user) return
        setSaving(true)
        try {
            await saveSubmissionMarks(user, submission, marks)
            message.success(t('Marks saved for {name}.', undefined, { name: learner.name }))
            onClose()
        } catch {
            message.error(t('The marks could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const remove = async () => {
        if (!user) return
        try {
            await deleteSubmission(user, submission.id)
            message.success(t('Assessment attempt removed.'))
            onClose()
        } catch {
            message.error(t('The assessment attempt could not be removed.'))
        }
    }

    return (
        <Drawer
            open
            title={title}
            width={screens.md ? 760 : '100%'}
            onClose={onClose}
            extra={(
                <Popconfirm
                    title={t('Remove this assessment attempt?')}
                    description={t('Its answers and marks are deleted.')}
                    okText={t('Remove')}
                    okButtonProps={{ danger: true }}
                    onConfirm={remove}
                >
                    <Button danger icon={<DeleteOutlined />}>{t('Remove attempt')}</Button>
                </Popconfirm>
            )}
            footer={(
                <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                    <Typography.Text strong>
                        {t('Total: {score} of {total} ({pct}%)', undefined, { score: totals.score, total: totals.totalMarks, pct: totals.scorePct })}
                        {submission.kind === 'post' && (
                            <Tag color={totals.scorePct >= passMarkPct ? 'green' : 'orange'} style={{ marginLeft: 8 }}>
                                {totals.scorePct >= passMarkPct ? t('At or above the pass mark') : t('Below the {pct}% pass mark', undefined, { pct: passMarkPct })}
                            </Tag>
                        )}
                    </Typography.Text>
                    <Button type="primary" icon={<CheckOutlined />} loading={saving} onClick={() => void save()}>{t('Save marks')}</Button>
                </Space>
            )}
        >
            <Space orientation="vertical" style={{ width: '100%' }} size={12}>
                <Space wrap>
                    {isPaper && <Tag>{t('Written on paper')}</Tag>}
                    <Button onClick={() => setMarks(Object.fromEntries(submission.questions.map((question) => [question.id, question.marks])))}>
                        {t('Give full marks to all')}
                    </Button>
                    <Button onClick={() => setMarks({})}>{t('Clear marks')}</Button>
                </Space>
                {submission.questions.map((question, index) => (
                    <MotionCard key={question.id} size="small">
                        <Space orientation="vertical" style={{ width: '100%' }} size={6}>
                            <Space style={{ justifyContent: 'space-between', width: '100%' }} align="start">
                                <Typography.Text strong>{index + 1}. {question.text}</Typography.Text>
                                <Tag>{question.marks === 1 ? t('1 mark') : t('{count} marks', undefined, { count: question.marks })}</Tag>
                            </Space>
                            {isChoiceQuestion(question) && question.options?.length ? (
                                <MotionCard.SunkenPanel>
                                    <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                                        {question.options.map((option, position) => {
                                            const isCorrect = Boolean(memo[question.id]) && option.trim().toLowerCase() === memo[question.id].trim().toLowerCase()
                                            const chosen = !isPaper && option.trim().toLowerCase() === (submission.answers[question.id] || '').trim().toLowerCase()
                                            return (
                                                <Space key={`${position}-${option}`} wrap size={6}>
                                                    <Typography.Text strong={chosen || isCorrect} type={isCorrect ? 'success' : chosen ? 'danger' : undefined}>
                                                        {'abcdefghij'[position] || position + 1}) {option}
                                                    </Typography.Text>
                                                    {chosen && <Tag color={isCorrect ? 'green' : 'red'}>{t('Learner\'s choice')}</Tag>}
                                                    {isCorrect && <Tag color="green">{t('Correct')}</Tag>}
                                                </Space>
                                            )
                                        })}
                                        {!isPaper && !(submission.answers[question.id] || '').trim() && <Typography.Text type="secondary">{t('No option chosen.')}</Typography.Text>}
                                        {!memo[question.id]?.trim() && <Typography.Text type="warning">{t('No correct option is set for this question, so mark it yourself.')}</Typography.Text>}
                                        {!isPaper && memo[question.id]?.trim() && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('Marked automatically. You can still change the mark.')}</Typography.Text>}
                                    </Space>
                                </MotionCard.SunkenPanel>
                            ) : !isPaper && (
                                <MotionCard.SunkenPanel>
                                    <Typography.Text type="secondary">{t('Learner\'s answer')}</Typography.Text>
                                    <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                                        {submission.answers[question.id]?.trim() || t('No answer given.')}
                                    </Typography.Paragraph>
                                </MotionCard.SunkenPanel>
                            )}
                            {!isChoiceQuestion(question) && (
                                <Typography.Text type="success">
                                    {t('Memo: {answer}', undefined, { answer: memo[question.id]?.trim() || t('No memo answer saved.') })}
                                </Typography.Text>
                            )}
                            {question.marks === 1 ? (
                                <Segmented
                                    value={marks[question.id] ?? 0}
                                    onChange={(value) => setMark(question.id, Number(value))}
                                    options={[{ value: 0, label: t('0 – incorrect') }, { value: 1, label: t('1 – correct') }]}
                                />
                            ) : (
                                <InputNumber
                                    min={0}
                                    max={question.marks}
                                    value={marks[question.id] ?? 0}
                                    onChange={(value) => setMark(question.id, value)}
                                    addonAfter={t('of {count}', undefined, { count: question.marks })}
                                />
                            )}
                        </Space>
                    </MotionCard>
                ))}
            </Space>
        </Drawer>
    )
}
