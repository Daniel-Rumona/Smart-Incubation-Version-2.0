import { useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Empty, Progress, Space, Typography } from 'antd'
import { CheckCircleOutlined } from '@ant-design/icons'
import DashboardPage from '@/components/shared/DashboardPage'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { loadIncubateeWorkspace } from '@/services/incubateeWorkspaceService'
import type { IncubateeIntervention, IncubateeWorkspace } from '@/types/incubatee'
import { describeDue, toDate } from './incubateeDashboardStatus'
import '@/styles/roadmap.css'

const { Text } = Typography

type Stage = 'done' | 'in_progress' | 'to_come'

/** Delivered counts as done here: the SME has had the session, even if the sign-off is still open. */
const stageOf = (item: IncubateeIntervention): Stage | null => {
    if (item.status === 'Completed' || item.status === 'Awaiting Confirmation') return 'done'
    if (item.status === 'In Progress') return 'in_progress'
    if (item.status === 'Declined' || item.status === 'Rejected') return null
    return 'to_come'
}

/**
 * A Training SME's programme at a glance: what's done, what's next and what's left, in the programme's order.
 * Read only; confirming sessions and appointments live on their own pages. Styled like the independent SME roadmap.
 */
export default function IncubateeTrainingRoadmapPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [workspace, setWorkspace] = useState<IncubateeWorkspace | null>()
    const [showDone, setShowDone] = useState(true)

    useEffect(() => {
        if (!user) return
        let active = true
        loadIncubateeWorkspace(user)
            .then((loaded) => { if (active) setWorkspace(loaded) })
            .catch((error) => {
                console.error('Could not load the incubatee workspace.', error)
                message.error(t('incubatee.common.loadError'))
                if (active) setWorkspace(null)
            })
        return () => { active = false }
    }, [message, t, user])

    const stages = useMemo(() => {
        const items = workspace?.assignedInterventions || []
        // The programme's own order (its set list) first, then by due date for anything added on top.
        const planOrder = new Map((workspace?.requiredInterventions || []).map((item, index) => [item.id, index]))
        const position = (item: IncubateeIntervention) => planOrder.get(item.interventionId) ?? Number.MAX_SAFE_INTEGER
        const due = (item: IncubateeIntervention) => toDate(item.dueDate)?.valueOf() ?? Number.MAX_SAFE_INTEGER
        const ordered = [...items].sort((a, b) => position(a) - position(b) || due(a) - due(b))
        const by = (stage: Stage) => ordered.filter((item) => stageOf(item) === stage)
        const inProgress = by('in_progress')
        const toCome = by('to_come')
        // Nothing under way: the next one to come is what's next.
        const next = inProgress.length ? inProgress : toCome.slice(0, 1)
        return {
            done: by('done'),
            next,
            later: inProgress.length ? toCome : toCome.slice(1),
            total: ordered.filter((item) => stageOf(item) !== null).length,
        }
    }, [workspace])

    if (workspace === undefined) return <PageSkeleton variant="detail" label={t('Loading your roadmap')} />
    if (!workspace) return <DashboardPage><Empty description={t('incubatee.common.noAcceptedProgram')} /></DashboardPage>

    const stateText = (item: IncubateeIntervention) => {
        if (item.status === 'Completed') return t('Done')
        if (item.status === 'Awaiting Confirmation') return t('Delivered')
        if (item.status === 'In Progress') return item.progress > 0 ? t('Under way · {percent}%', undefined, { percent: Math.round(item.progress) }) : t('Under way')
        if (item.status === 'Not Started') return t('Scheduled')
        return t('Not scheduled yet')
    }

    const row = (item: IncubateeIntervention) => {
        const stage = stageOf(item)
        const showDue = stage !== 'done' && describeDue(item.dueDate)
        return (
            <div key={item.id} className="roadmap-row">
                <span className={`roadmap-dot${stage === 'done' ? ' is-done' : stage === 'in_progress' ? ' is-in_progress' : ''}`} aria-hidden="true" />
                <div className="roadmap-row-text">
                    <Text strong>{item.title}</Text>
                    <Text type="secondary">{[item.areaOfSupport, stateText(item), showDue, item.assigneeName].filter(Boolean).join(' · ')}</Text>
                </div>
            </div>
        )
    }

    const doneCount = stages.done.length
    const summary = stages.total
        ? t('{done} of {total} done', undefined, { done: doneCount, total: stages.total })
        : t('Your programme team has not set up your sessions yet.')

    return (
        <DashboardPage className="sme-roadmap-page roadmap-v2">
            <section className="roadmap-head">
                <div className="roadmap-head-row">
                    <div className="roadmap-head-text">
                        <Text strong className="roadmap-title">{workspace.programName || t('Your roadmap')}</Text>
                        <Text type="secondary">{summary}</Text>
                    </div>
                </div>
                {stages.total > 0 && <Progress percent={Math.round((doneCount / stages.total) * 100)} showInfo={false} strokeColor="#6d5dfb" size="small" />}
            </section>

            {stages.total > 0 && doneCount === stages.total && (
                <Card className="roadmap-card"><Space><CheckCircleOutlined className="roadmap-done-icon" /><Text>{t('You have completed every session in this programme.')}</Text></Space></Card>
            )}

            {stages.next.length > 0 && (
                <Card className="roadmap-card" title={t('Up next')}>
                    {stages.next.map(row)}
                </Card>
            )}

            {stages.later.length > 0 && (
                <Card className="roadmap-card" title={t('Still to come ({count})', undefined, { count: stages.later.length })}>
                    {stages.later.map(row)}
                </Card>
            )}

            {doneCount > 0 && (
                <Card
                    className="roadmap-card"
                    title={<Space size={8}><CheckCircleOutlined className="roadmap-done-icon" />{t('Done ({count})', undefined, { count: doneCount })}</Space>}
                    extra={<Button type="link" size="small" onClick={() => setShowDone((current) => !current)}>{showDone ? t('Hide') : t('Show')}</Button>}
                >
                    {showDone ? stages.done.map(row) : null}
                </Card>
            )}
        </DashboardPage>
    )
}
