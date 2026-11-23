import { Button, Input, Progress } from 'antd'
import {
    CheckCircleOutlined,
    CheckOutlined,
    ClockCircleOutlined,
    DownOutlined,
    FileDoneOutlined,
    InboxOutlined,
    PlusOutlined,
    RightOutlined,
    RobotOutlined,
    SearchOutlined,
    SendOutlined,
    SmileOutlined,
    UpOutlined,
} from '@ant-design/icons'
import { useState, type ReactNode } from 'react'
import { AppointmentInvitations } from '@/components/incubatee/AppointmentInvitations'
import { SmeCheckbacks } from '@/components/incubatee/SmeCheckbacks'
import { useLanguage } from '@/providers/LanguageProvider'
import type { IncubateeIntervention, IncubateeWorkspace } from '@/types/incubatee'
import '@/styles/incubatee-simple.css'

type Groups = Record<'action' | 'active' | 'waiting' | 'done', IncubateeIntervention[]>

type Props = {
    workspace: IncubateeWorkspace
    groups: Groups
    total: number
    completed: number
    planPending: boolean
    deliveredBy: (item: IncubateeIntervention) => string
    canOpenAgent: (item: IncubateeIntervention) => boolean
    onConfirm: (item: IncubateeIntervention) => void
    onReject: (item: IncubateeIntervention) => void
    onOpen: (item: IncubateeIntervention) => void
    onOpenAgent: (item: IncubateeIntervention) => void
    onSignPlan: () => void
    onRequest: () => void
    onChanged: () => void
}

type Next = { key: string, icon: ReactNode, heading: string, detail: string, buttons: ReactNode, item?: IncubateeIntervention }

/**
 * Simple view of the SME's interventions tracker. Left: what needs the SME (one "Do this next", then session
 * invitations, check-backs and other completions to confirm). Right, beside it on wide screens and below on phones:
 * the status of everything else. Every action opens the tracker's own forms, so the rules are the same as Full view.
 * "Show more detail" expands in place: counts, a search box, and a status line under every item.
 */
export const IncubateeTrackerSimple = ({
    workspace, groups, total, completed, planPending, deliveredBy, canOpenAgent,
    onConfirm, onReject, onOpen, onOpenAgent, onSignPlan, onRequest, onChanged,
}: Props) => {
    const { t } = useLanguage()
    const [showDone, setShowDone] = useState(false)
    const [showMore, setShowMore] = useState(false)
    const [search, setSearch] = useState('')
    const needle = showMore ? search.trim().toLowerCase() : ''
    const matches = (item: IncubateeIntervention) => !needle
        || `${item.title} ${item.areaOfSupport || ''} ${deliveredBy(item)}`.toLowerCase().includes(needle)
    // The line Full view shows on each row: area of support, status, and progress while it is under way.
    const detail = (item?: IncubateeIntervention) => (showMore && item
        ? <small className="sme-simple-detail-line">{[
            item.areaOfSupport || t('common.unassigned'),
            t(item.status),
            item.status === 'In Progress' ? `${item.progress}%` : '',
        ].filter(Boolean).join(' · ')}</small>
        : null)

    const howFar = (progress: number) => (progress <= 25 ? t('just started') : progress <= 60 ? t('about halfway') : t('nearly done'))
    const agentNext = groups.active.find(canOpenAgent) || groups.waiting.find(canOpenAgent)

    const confirmNext = (item: IncubateeIntervention): Next => {
        const who = deliveredBy(item)
        return {
            key: item.id,
            item,
            icon: <CheckCircleOutlined />,
            heading: t('Was "{title}" done?', undefined, { title: item.title }),
            detail: who
                ? t('{name} says it\'s finished. Tell us if you agree.', undefined, { name: who })
                : t('Your facilitator says it\'s finished. Tell us if you agree.'),
            buttons: <div className="sme-simple-next-actions">
                <Button type="primary" size="large" block onClick={() => onConfirm(item)}>{t('Yes, it\'s done')}</Button>
                <Button size="large" block onClick={() => onReject(item)}>{t('Not yet')}</Button>
            </div>,
        }
    }

    // Same priority as Full view's "Next step": the growth plan, then finished work to confirm, then agent work.
    const next: Next | null = planPending
        ? {
            key: 'plan',
            icon: <FileDoneOutlined />,
            heading: t('Confirm your growth plan'),
            detail: t('Read the plan your programme team made with you, then sign it.'),
            buttons: <Button type="primary" size="large" block onClick={onSignPlan}>{t('Sign my growth plan')}</Button>,
        }
        : groups.action[0]
            ? confirmNext(groups.action[0])
            : agentNext
                ? {
                    key: agentNext.id,
                    item: agentNext,
                    icon: <RobotOutlined />,
                    heading: t('Continue "{title}"', undefined, { title: agentNext.title }),
                    detail: t('Pick up where you left off with {name}.', undefined, { name: deliveredBy(agentNext) }),
                    buttons: <Button type="primary" size="large" block icon={<RobotOutlined />} onClick={() => onOpenAgent(agentNext)}>{t('Continue')}</Button>,
                }
                : null

    const moreToConfirm = groups.action.filter((item) => item.id !== next?.key && matches(item))
    const active = groups.active.filter((item) => item.id !== next?.key && matches(item))
    const waiting = groups.waiting.filter((item) => item.id !== next?.key && matches(item))
    const done = groups.done.filter(matches)
    const noMatches = Boolean(needle) && !moreToConfirm.length && !active.length && !waiting.length && !done.length
    // Nothing on the plan yet: no detail to show, and asking for support becomes the main action.
    const planEmpty = workspace.assignedInterventions.length === 0
    // Unfiltered, so searching never collapses the side column and shifts the layout.
    const hasSide = groups.active.some((item) => item.id !== next?.key) || groups.waiting.some((item) => item.id !== next?.key)
        || groups.done.length > 0 || workspace.requests.length > 0

    const waitingNote = (item: IncubateeIntervention) => {
        if (item.agentId) return t('You can start this with an agent')
        if (item.status === 'Not Started' && item.assigneeName) return t('{name} will start this soon', undefined, { name: item.assigneeName })
        return t('Your programme team will book this')
    }

    const statusRow = (item: IncubateeIntervention, sub: ReactNode, extra?: ReactNode) => (
        <li key={item.id}>
            <button type="button" className="sme-simple-status-row" onClick={() => onOpen(item)}>
                <span className="sme-simple-row-text">
                    <span>{item.title}</span>
                    <small>{sub}</small>
                    {detail(item)}
                    {extra}
                </span>
                <RightOutlined aria-hidden="true" />
            </button>
        </li>
    )

    return (
        <div className={`sme-simple is-tracker${hasSide ? ' has-side' : ''}`}>
            <div className="sme-simple-main">
                <div className="sme-simple-title-row">
                    <h2 className="sme-simple-greeting">{t('Your support')}</h2>
                    {total > 0 && <span>{t('{done} of {total} done', undefined, { done: completed, total })}</span>}
                </div>
                {total > 0 && <Progress className="sme-simple-overall" percent={Math.round((completed / total) * 100)} showInfo={false} size="small" status="normal" strokeColor="var(--ant-color-primary)" />}

                {showMore && (
                    <div className="sme-simple-more-panel">
                        <div className="sme-simple-counts">
                            <span><small>{t('Needs you')}</small><strong>{groups.action.length + (planPending ? 1 : 0)}</strong></span>
                            <span><small>{t('In progress')}</small><strong>{groups.active.length}</strong></span>
                            <span><small>{t('Not started')}</small><strong>{groups.waiting.length}</strong></span>
                            <span><small>{t('Done')}</small><strong>{groups.done.length}</strong></span>
                        </div>
                        <Input
                            prefix={<SearchOutlined />}
                            allowClear
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={t('Search your support')}
                            aria-label={t('Search your support')}
                        />
                        {noMatches && <p className="sme-simple-no-match">{t('No support matches your search.')}</p>}
                    </div>
                )}

                {next ? (
                    <section className="sme-simple-next" aria-label={t('Do this next')}>
                        <span className="sme-simple-eyebrow">{t('Do this next')}</span>
                        <div className="sme-simple-next-body">
                            <span className="sme-simple-next-icon" aria-hidden="true">{next.icon}</span>
                            <div>
                                <h3>{next.heading}</h3>
                                <p>{next.detail}</p>
                                {detail(next.item)}
                            </div>
                        </div>
                        {next.buttons}
                    </section>
                ) : planEmpty ? (
                    <section className="sme-simple-next is-done">
                        <InboxOutlined className="sme-simple-empty-icon" aria-hidden="true" />
                        <h3>{t('No support on your plan yet')}</h3>
                        <p>{t('When your programme team adds support to your plan, it shows here. If you need help with something now, ask for it.')}</p>
                        <Button type="primary" size="large" icon={<PlusOutlined />} onClick={onRequest}>{t('Ask for support')}</Button>
                    </section>
                ) : (
                    <section className="sme-simple-next is-done">
                        <SmileOutlined className="sme-simple-done-icon" aria-hidden="true" />
                        <h3>{t('Nothing needs you right now')}</h3>
                        {active.length + waiting.length > 0 && <p>{t('Your facilitators will let you know when something needs you.')}</p>}
                    </section>
                )}

                {/* Hidden by CSS while it has no rows: invitations and check-backs load on their own. */}
                <section className="sme-simple-needs">
                    <div className="sme-simple-list-title">{t('Also needs you')}</div>
                    <ul className="sme-simple-tasks">
                        {moreToConfirm.map((item) => (
                            <li key={item.id} className="sme-simple-task">
                                <CheckCircleOutlined className="sme-simple-task-icon" aria-hidden="true" />
                                <span className="sme-simple-task-text">
                                    <span>{t('Was "{title}" done?', undefined, { title: item.title })}</span>
                                    {deliveredBy(item) && <small>{t('{name} says it\'s finished.', undefined, { name: deliveredBy(item) })}</small>}
                                    {detail(item)}
                                </span>
                                <span className="sme-simple-task-actions">
                                    <Button size="small" type="primary" onClick={() => onConfirm(item)}>{t('Yes')}</Button>
                                    <Button size="small" onClick={() => onReject(item)}>{t('Not yet')}</Button>
                                </span>
                            </li>
                        ))}
                        <AppointmentInvitations workspace={workspace} onChanged={onChanged} variant="rows" showDetail={showMore} />
                        <SmeCheckbacks interventions={workspace.assignedInterventions} onAnswered={onChanged} variant="rows" showDetail={showMore} />
                    </ul>
                </section>

                {!planEmpty && <div className="sme-simple-footer">
                    <Button icon={<PlusOutlined />} onClick={onRequest}>{t('Ask for other support')}</Button>
                    <button type="button" className="sme-simple-more is-inline" aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>
                        {showMore ? t('Show less') : t('Show more detail')} {showMore ? <UpOutlined /> : <DownOutlined />}
                    </button>
                </div>}
            </div>

            {hasSide && <aside className="sme-simple-side" aria-label={t('Your other support')}>
                {active.length > 0 && (
                    <section className="sme-simple-side-card">
                        <span className="sme-simple-side-label">{t('Being worked on')}</span>
                        <ul className="sme-simple-status">
                            {active.map((item) => (canOpenAgent(item)
                                ? (
                                    <li key={item.id} className="sme-simple-status-agent">
                                        <span className="sme-simple-row-text">
                                            <span>{item.title}</span>
                                            <small>{t('You and {name}', undefined, { name: deliveredBy(item) })} · {howFar(item.progress)}</small>
                                            {detail(item)}
                                        </span>
                                        <Button size="small" icon={<RobotOutlined />} onClick={() => onOpenAgent(item)}>{t('Continue')}</Button>
                                    </li>
                                )
                                : statusRow(
                                    item,
                                    [deliveredBy(item) && t('{name} is helping you', undefined, { name: deliveredBy(item) }), howFar(item.progress)].filter(Boolean).join(' · '),
                                    <Progress percent={item.progress} showInfo={false} size="small" status="normal" strokeColor="var(--ant-color-primary)" />,
                                )))}
                        </ul>
                    </section>
                )}

                {waiting.length > 0 && (
                    <section className="sme-simple-side-card">
                        <span className="sme-simple-side-label">{t('Coming up')}</span>
                        <ul className="sme-simple-status">
                            {waiting.map((item) => statusRow(item, <><ClockCircleOutlined aria-hidden="true" /> {waitingNote(item)}</>))}
                        </ul>
                    </section>
                )}

                {done.length > 0 && (
                    <section className="sme-simple-side-card">
                        <div className="sme-simple-side-head">
                            <span className="sme-simple-side-label">{t('Done')}</span>
                            <Button type="link" size="small" onClick={() => setShowDone(!showDone)} icon={showDone ? <UpOutlined /> : <DownOutlined />} iconPlacement="end">
                                {showDone ? t('Hide') : t('Show {count}', undefined, { count: done.length })}
                            </Button>
                        </div>
                        {(showDone || Boolean(needle)) && (
                            <ul className="sme-simple-status">
                                {done.map((item) => statusRow(
                                    item,
                                    item.status === 'Completed'
                                        ? <><CheckOutlined className="sme-simple-done-tick" aria-hidden="true" /> {deliveredBy(item) || t('Completed')}</>
                                        : t('Not going ahead'),
                                ))}
                            </ul>
                        )}
                    </section>
                )}

                {workspace.requests.length > 0 && (
                    <section className="sme-simple-side-card">
                        <span className="sme-simple-side-label"><SendOutlined aria-hidden="true" /> {t('You asked for')}</span>
                        <ul className="sme-simple-status">
                            {workspace.requests.map((request) => (
                                <li key={request.id} className="sme-simple-status-agent">
                                    <span className="sme-simple-row-text">
                                        <span>{request.interventionTitle}</span>
                                        <small>{t(request.status)}</small>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </aside>}
        </div>
    )
}
