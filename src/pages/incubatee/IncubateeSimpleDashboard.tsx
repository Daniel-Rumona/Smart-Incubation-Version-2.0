import { Button, Progress, Skeleton, Tag } from 'antd'
import {
    AuditOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    DownOutlined,
    FileDoneOutlined,
    FormOutlined,
    MessageOutlined,
    RightOutlined,
    SmileOutlined,
    UpOutlined,
    UserOutlined,
} from '@ant-design/icons'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { openAssistant } from '@/components/agent/openAssistant'
import { meetingTypeLabel, toDayjs } from '@/components/interventions/appointmentSchedule'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useUiMode } from '@/hooks/useUiMode'
import { useLanguage } from '@/providers/LanguageProvider'
import { loadNextIncubateeSession, type IncubateeSession } from '@/services/incubateeSessionsService'
import type { IncubateeFormAssignment, IncubateeIntervention, IncubateeWorkspace } from '@/types/incubatee'
import { FINISH_PROFILE_PATH } from '@/utils/profilePrompt'
import { PLAN_READY_PATH } from '@/utils/planReadyPrompt'
import { describeDue } from './incubateeDashboardStatus'
import '@/styles/incubatee-simple.css'

type Task = {
    key: string
    icon: ReactNode
    /** Short instruction for the list row. */
    label: string
    /** The same task asked as a question or instruction when it is the one to do next. */
    heading: string
    detail?: string
    path: string
    /** Completions get Yes / Not yet; everything else one button. */
    confirmId?: string
    actionLabel?: string
}

type Props = {
    workspace: IncubateeWorkspace | null | undefined
    toConfirm: IncubateeIntervention[]
    notStarted: IncubateeIntervention[]
    openForms: IncubateeFormAssignment[]
    profileMissing?: number
    isDemo: boolean
}

/** After this many "Show more detail" opens, the panel suggests Full view. */
const MORE_OPENS_BEFORE_NUDGE = 3
const moreOpensKey = (uid?: string) => `smartv2.simpleViewMoreOpens.${uid || 'anon'}`

const readMoreOpens = (uid?: string) => {
    try {
        return Number(localStorage.getItem(moreOpensKey(uid))) || 0
    } catch {
        return 0
    }
}

/**
 * Simple view of the SME dashboard: one task to do next in plain words, the rest as a short list, and the numbers
 * behind "Show more detail". On wide screens the next session, progress and help sit in a quiet panel beside it.
 */
export const IncubateeSimpleDashboard = ({ workspace, toConfirm, notStarted, openForms, profileMissing, isDemo }: Props) => {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const { setMode } = useUiMode()
    const navigate = useNavigate()
    const [showMore, setShowMore] = useState(false)
    const [moreOpens, setMoreOpens] = useState(() => readMoreOpens(user?.uid))
    const [loadedSession, setSession] = useState<IncubateeSession | null>()
    // The demo workspace has no appointments to read.
    const session = isDemo ? null : loadedSession

    useEffect(() => {
        if (!workspace || isDemo) return
        let active = true
        loadNextIncubateeSession(workspace, user?.companyCode)
            .then((next) => { if (active) setSession(next) })
            .catch(() => { if (active) setSession(null) })
        return () => { active = false }
    }, [isDemo, user?.companyCode, workspace])

    const toggleMore = () => {
        if (!showMore) {
            const opens = moreOpens + 1
            setMoreOpens(opens)
            try { localStorage.setItem(moreOpensKey(user?.uid), String(opens)) } catch { /* nudge only */ }
        }
        setShowMore(!showMore)
    }

    if (workspace === undefined) {
        return <div className="sme-simple"><div className="sme-simple-main"><Skeleton active paragraph={{ rows: 6 }} /></div></div>
    }
    if (!workspace) return null

    const documents = workspace.outstandingDocuments || 0
    const tasks: Task[] = [
        ...toConfirm.map((item): Task => ({
            key: `confirm-${item.id}`,
            icon: <CheckCircleOutlined />,
            label: t('Confirm "{title}" is complete', undefined, { title: item.title }),
            heading: t('Was "{title}" done?', undefined, { title: item.title }),
            detail: item.assigneeName
                ? t('{name} says it\'s finished. Tell us if you agree.', undefined, { name: item.assigneeName })
                : t('Your facilitator says it\'s finished. Tell us if you agree.'),
            path: '/incubatee/interventions',
            confirmId: item.id,
        })),
        ...(workspace.growthPlanAvailable && !workspace.growthPlanConfirmed ? [{
            key: 'growth-plan',
            icon: <FileDoneOutlined />,
            label: t('Confirm your growth plan'),
            heading: t('Confirm your growth plan'),
            detail: t('Read the plan your programme team made with you, then sign it.'),
            path: PLAN_READY_PATH,
            actionLabel: t('Open my growth plan'),
        }] : []),
        ...(!isDemo && profileMissing ? [{
            key: 'profile',
            icon: <UserOutlined />,
            label: t('Finish your business details'),
            heading: t('Finish your business details'),
            detail: profileMissing === 1 ? t('1 thing is missing') : t('{count} things are missing', undefined, { count: profileMissing }),
            path: FINISH_PROFILE_PATH,
            actionLabel: t('Complete my details'),
        }] : []),
        ...(documents ? [{
            key: 'documents',
            icon: <AuditOutlined />,
            label: documents === 1 ? t('Upload 1 document') : t('Upload {count} documents', undefined, { count: documents }),
            heading: documents === 1 ? t('Upload 1 document') : t('Upload {count} documents', undefined, { count: documents }),
            detail: t('Your programme needs these to keep your file up to date.'),
            path: '/incubatee/compliance',
            actionLabel: t('Upload documents'),
        }] : []),
        ...openForms.map((form): Task => ({
            key: `form-${form.id}`,
            icon: <FormOutlined />,
            label: t('Fill in "{title}"', undefined, { title: form.title }),
            heading: t('Fill in "{title}"', undefined, { title: form.title }),
            detail: [t(`incubatee.forms.${form.kind}`), describeDue(form.dueAt)].filter(Boolean).join(' · '),
            path: '/incubatee/surveys',
            actionLabel: t('Start'),
        })),
    ]
    const [next, ...rest] = tasks

    const firstName = (user?.displayName || '').trim().split(/\s+/)[0]
    const summary = tasks.length === 0
        ? t('You\'re all caught up. We\'ll show your next task here.')
        : tasks.length === 1
            ? t('You have 1 thing to do.')
            : t('You have {count} things to do. Start with this one.', undefined, { count: tasks.length })

    const counted = workspace.assignedInterventions.filter((item) => item.status !== 'Declined' && item.status !== 'Rejected')
    const done = counted.filter((item) => item.status === 'Completed').length
    const start = session ? toDayjs(session.startTime) : null

    return (
        <div className="sme-simple">
            <div className="sme-simple-main">
                <h2 className="sme-simple-greeting">{firstName ? t('Hello, {name}', undefined, { name: firstName }) : t('Hello')}</h2>
                <p className="sme-simple-summary">{summary}</p>

                {next ? (
                    <section className="sme-simple-next" aria-label={t('Do this next')}>
                        <span className="sme-simple-eyebrow">{t('Do this next')}</span>
                        <div className="sme-simple-next-body">
                            <span className="sme-simple-next-icon" aria-hidden="true">{next.icon}</span>
                            <div>
                                <h3>{next.heading}</h3>
                                {next.detail && <p>{next.detail}</p>}
                            </div>
                        </div>
                        {next.confirmId ? (
                            <div className="sme-simple-next-actions">
                                <Button type="primary" size="large" block onClick={() => navigate(`/incubatee/interventions?confirm=${encodeURIComponent(next.confirmId!)}`)}>{t('Yes, it\'s done')}</Button>
                                <Button size="large" block onClick={() => navigate(`/incubatee/interventions?reject=${encodeURIComponent(next.confirmId!)}`)}>{t('Not yet')}</Button>
                            </div>
                        ) : (
                            <Button type="primary" size="large" block onClick={() => navigate(next.path)}>{next.actionLabel}</Button>
                        )}
                    </section>
                ) : (
                    <section className="sme-simple-next is-done">
                        <SmileOutlined className="sme-simple-done-icon" aria-hidden="true" />
                        <h3>{t('Nothing to do right now')}</h3>
                    </section>
                )}

                {rest.length > 0 && (
                    <>
                        <div className="sme-simple-list-title">{t('Also to do')}</div>
                        <ul className="sme-simple-list">
                            {rest.map((task) => (
                                <li key={task.key}>
                                    <button type="button" onClick={() => navigate(task.path)}>
                                        <span className="sme-simple-row-icon" aria-hidden="true">{task.icon}</span>
                                        <span className="sme-simple-row-text">
                                            <span>{task.label}</span>
                                            {task.detail && <small>{task.detail}</small>}
                                        </span>
                                        <RightOutlined aria-hidden="true" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </>
                )}

                <button type="button" className="sme-simple-more" aria-expanded={showMore} onClick={toggleMore}>
                    {showMore ? t('Show less') : t('Show more detail')} {showMore ? <UpOutlined /> : <DownOutlined />}
                </button>
                {showMore && (
                    <div className="sme-simple-detail">
                        <div className="sme-simple-metrics">
                            <button type="button" onClick={() => navigate('/incubatee/compliance')}><small>{t('incubatee.dashboard.pendingDocuments')}</small><strong>{documents}</strong></button>
                            <button type="button" onClick={() => navigate('/incubatee/interventions')}><small>{t('incubatee.dashboard.pendingInterventions')}</small><strong>{notStarted.length}</strong></button>
                            <button type="button" onClick={() => navigate('/incubatee/interventions')}><small>{t('incubatee.dashboard.toConfirm')}</small><strong>{toConfirm.length}</strong></button>
                            <button type="button" onClick={() => navigate('/incubatee/surveys')}><small>{t('incubatee.dashboard.pendingForms')}</small><strong>{openForms.length}</strong></button>
                        </div>
                        {moreOpens >= MORE_OPENS_BEFORE_NUDGE && (
                            <p className="sme-simple-nudge">
                                {t('Want this detail every time?')}{' '}
                                <Button type="link" size="small" onClick={() => void setMode('full')}>{t('Switch to Full view')}</Button>
                            </p>
                        )}
                    </div>
                )}
            </div>

            <aside className="sme-simple-side" aria-label={t('More about your programme')}>
                <section className="sme-simple-side-card">
                    <span className="sme-simple-side-label">{t('Next session')}</span>
                    {session === undefined ? <Skeleton active title={false} paragraph={{ rows: 2 }} /> : session && start ? (
                        <>
                            <strong>{session.title}</strong>
                            <span>{start.format('ddd D MMM · HH:mm')}</span>
                            <span>{session.location || meetingTypeLabel(session.meetingType)}</span>
                            {session.awaiting && <Tag color="gold">{t('Waiting for your answer')}</Tag>}
                        </>
                    ) : (
                        <span>{t('No sessions booked yet.')}</span>
                    )}
                    <Button type="link" size="small" icon={<CalendarOutlined />} onClick={() => navigate('/incubatee/appointments')}>{t('See all sessions')}</Button>
                </section>

                {counted.length > 0 && (
                    <section className="sme-simple-side-card">
                        <span className="sme-simple-side-label">{t('Your progress')}</span>
                        <Progress percent={Math.round((done / counted.length) * 100)} showInfo={false} size="small" status="normal" strokeColor="var(--ant-color-primary)" />
                        <span>{t('{done} of {total} support items done', undefined, { done, total: counted.length })}</span>
                    </section>
                )}

                <section className="sme-simple-side-card">
                    <span className="sme-simple-side-label">{t('Need help?')}</span>
                    <span>{t('Ask Thuso, your assistant. It knows your programme and what\'s next.')}</span>
                    <Button block icon={<MessageOutlined />} onClick={openAssistant}>{t('Get help')}</Button>
                </section>
            </aside>
        </div>
    )
}
