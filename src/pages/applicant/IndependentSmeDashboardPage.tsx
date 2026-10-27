import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Button, Card, Input, Progress, Rate, Space, Tag, Typography } from 'antd'
import { ArrowRightOutlined, BulbOutlined, IdcardOutlined, RobotOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import DashboardPage from '@/components/shared/DashboardPage'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { formatMoney } from '@/components/marketplace/ConnectionThread'
import { BUSINESS_PROFILE_SECTIONS } from '@/components/applicant/businessProfileSectionsConfig'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { toDate } from '@/pages/consultant/ConsultantWorkspaceUtils'
import { getApplicantProfileBundle } from '@/services/applicantService'
import { lastMessage, listConnectionRequestsForSme } from '@/services/connectionRequestService'
import { confirmSmeWork, loadSmeWork, type SmeWork } from '@/services/smeWorkService'
import type { ConnectionRequest } from '@/types/connectionRequest'
import { profileCompletion, profileValuesFromBundle } from '@/utils/applicantProfileCompletion'
import '@/styles/sme-dashboard.css'

const { Text } = Typography

type Need = { key: string; title: string; detail: string; tag?: { text: string; color: string }; action: { label: string; onClick: () => void } }

const requestLink = (request: ConnectionRequest) => `/applicant/marketplace?view=requests&request=${request.id}`

/**
 * Home for an SME who chose consultants and AI agents instead of a programme: the one thing to do now, what's
 * waiting on them, the work under way, who's helping, and where to find more help. A brand-new SME gets three
 * ways to start instead.
 */
export default function IndependentSmeDashboardPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)
    const [requests, setRequests] = useState<ConnectionRequest[]>([])
    const [work, setWork] = useState<SmeWork[]>([])
    const [profile, setProfile] = useState<{ percent: number; missing: string[] }>({ percent: 0, missing: [] })
    const [confirming, setConfirming] = useState<SmeWork | null>(null)
    const [rating, setRating] = useState(0)
    const [comments, setComments] = useState('')
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        if (!user) return
        try {
            const [nextRequests, nextWork, bundle] = await Promise.all([
                listConnectionRequestsForSme(user.uid).catch(() => []),
                loadSmeWork(user).catch(() => []),
                getApplicantProfileBundle(user.uid, user.email).catch(() => null),
            ])
            setRequests(nextRequests.filter((row) => row.targetType === 'consultant'))
            setWork(nextWork)
            setProfile(profileCompletion(profileValuesFromBundle(bundle, user)))
        } finally {
            setLoading(false)
        }
    }, [user])

    useEffect(() => { void load() }, [load])

    const labelFor = (field: string) => t(BUSINESS_PROFILE_SECTIONS.flatMap((section) => section.fields).find((item) => item.name === field)?.label || field)
    const formatDue = (value: unknown) => {
        const date = toDate(value)
        return date ? dayjs(date).format('D MMM') : ''
    }

    const activeWork = useMemo(() => work
        .filter((item) => item.state !== 'done')
        .sort((left, right) => (toDate(left.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER) - (toDate(right.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER)), [work])
    const doneCount = work.length - activeWork.length

    // Waiting on the SME, most important first: plans, then replies, then work to confirm.
    const needs: Need[] = [
        ...requests.filter((row) => row.status === 'proposed' && row.plan).map((row) => ({
            key: `plan-${row.id}`,
            title: t('Plan from {name}', undefined, { name: row.targetName }),
            detail: [
                row.plan!.items.length === 1 ? t('1 intervention') : t('{count} interventions', undefined, { count: row.plan!.items.length }),
                formatMoney(row.plan!.total, row.plan!.currency),
            ].join(' · '),
            tag: { text: t('Plan waiting'), color: 'purple' },
            action: { label: t('Review'), onClick: () => navigate(requestLink(row)) },
        })),
        ...requests.filter((row) => ['pending', 'contacted'].includes(row.status) && lastMessage(row)?.from === 'consultant').map((row) => ({
            key: `reply-${row.id}`,
            title: t('{name} replied', undefined, { name: row.targetName }),
            detail: `“${lastMessage(row)?.text || ''}”`,
            action: { label: t('Reply'), onClick: () => navigate(requestLink(row)) },
        })),
        ...work.filter((item) => item.state === 'waiting_you' && item.waitingOn === 'confirmation').map((item) => ({
            key: `confirm-${item.id}`,
            title: t('Confirm: {title}', undefined, { title: item.title }),
            detail: item.helperName ? t('Marked done by {name}', undefined, { name: item.helperName }) : t('Marked done'),
            tag: { text: t('Your OK'), color: 'gold' },
            action: { label: t('Confirm'), onClick: () => { setRating(0); setComments(''); setConfirming(item) } },
        })),
    ]

    // People and agents helping: anyone with work for the SME, plus consultants still talking to them.
    const helpers = useMemo(() => {
        const byId = new Map<string, { id: string; name: string; type: 'agent' | 'human'; area: string; request?: ConnectionRequest }>()
        work.filter((item) => item.helperName && item.assigneeId).forEach((item) => {
            if (!byId.has(item.assigneeId)) byId.set(item.assigneeId, { id: item.assigneeId, name: item.helperName, type: item.helperType, area: item.area })
        })
        requests.filter((row) => ['contacted', 'proposed', 'matched'].includes(row.status)).forEach((row) => {
            const existing = byId.get(row.targetId)
            byId.set(row.targetId, { id: row.targetId, name: existing?.name || row.targetName, type: 'human', area: existing?.area || row.areaOfSupport || '', request: row })
        })
        return [...byId.values()].slice(0, 5)
    }, [requests, work])

    const firstName = (user?.displayName || user?.name || '').trim().split(/\s+/)[0]
    const hour = dayjs().hour()
    const greeting = hour < 12 ? t('Good morning') : hour < 17 ? t('Good afternoon') : t('Good evening')
    const isNew = !requests.length && !work.length
    const focus: { text: string; action?: { label: string; onClick: () => void } } = needs[0]
        ? { text: needs[0].key.startsWith('plan') ? t('{title} is waiting for you.', undefined, { title: needs[0].title }) : `${needs[0].title}.`, action: needs[0].action }
        : profile.missing.length
            ? { text: t('Your business profile is missing a few details.'), action: { label: t('Finish your profile'), onClick: () => navigate('/applicant/profile') } }
            : activeWork.length
                ? { text: t('Nothing is waiting on you. Your support is under way.') }
                : { text: t('Nothing is waiting on you right now.') }

    const confirmWork = async () => {
        if (!confirming) return
        setSaving(true)
        try {
            await confirmSmeWork(confirming, rating, comments)
            message.success(t('Thanks. {title} is marked complete.', undefined, { title: confirming.title }))
            setConfirming(null)
            await load()
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('That couldn’t be confirmed.'))
        } finally {
            setSaving(false)
        }
    }

    // They chose consultants and agents, so programmes stay out of the menu until they ask (users/{uid}.smeShowProgrammes).
    const setShowProgrammes = async (show: boolean) => {
        if (!user) return
        try {
            await updateDoc(doc(db, 'users', user.uid), { smeShowProgrammes: show, updatedAt: serverTimestamp() })
            if (show) navigate('/applicant/programs')
            else message.success(t('Programmes are hidden from your menu again.'))
        } catch {
            message.error(t('That couldn’t be saved.'))
        }
    }
    const programmesCard = (
        <Card className="sme-dash-card" title={user?.showProgrammes ? undefined : t('Interested in a programme too?')}>
            {user?.showProgrammes ? (
                <Text type="secondary">{t('Programmes are in your menu.')} <Button type="link" size="small" className="sme-dash-inline-link" onClick={() => void setShowProgrammes(false)}>{t('Hide them')}</Button></Text>
            ) : (
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <Text type="secondary">{t('Some programmes offer funding and longer-term support. They stay hidden until you want them.')}</Text>
                    <Button onClick={() => void setShowProgrammes(true)}>{t('Show programmes')}</Button>
                </Space>
            )}
        </Card>
    )

    if (loading) return <PageSkeleton variant="detail" label={t('Loading your workspace')} />

    const header = (
        <Card className="sme-dash-card sme-dash-greeting">
            <div className="sme-dash-greeting-row">
                <div className="sme-dash-greeting-text">
                    <Text type="secondary">{dayjs().format('dddd D MMMM')}</Text>
                    <Text strong className="sme-dash-greeting-line">
                        {isNew
                            ? (firstName ? t('Welcome, {name}. Let’s find the right help for your business.', undefined, { name: firstName }) : t('Welcome. Let’s find the right help for your business.'))
                            : `${firstName ? `${greeting}, ${firstName}.` : `${greeting}.`} ${focus.text}`}
                    </Text>
                </div>
                {!isNew && focus.action && <Button type="primary" icon={<ArrowRightOutlined />} iconPlacement="end" onClick={focus.action.onClick}>{focus.action.label}</Button>}
            </div>
        </Card>
    )

    if (isNew) {
        const starts = [
            { key: 'challenge', icon: <BulbOutlined />, title: t('Tell us what’s holding the business back'), detail: t('AI suggests a few steps, using your answer and profile.'), label: t('Start'), primary: true, path: '/applicant/roadmap' },
            { key: 'support', icon: <TeamOutlined />, title: t('Browse consultants and AI agents'), detail: t('Pick someone and send a request.'), label: t('Find support'), path: '/applicant/marketplace' },
            ...(profile.missing.length ? [{ key: 'profile', icon: <IdcardOutlined />, title: t('Finish your business profile'), detail: t('Consultants see it when you ask for help · {percent}% done', undefined, { percent: profile.percent }), label: t('Continue'), path: '/applicant/profile' }] : []),
        ]
        return (
            <DashboardPage className="sme-dash">
                {header}
                <div className="sme-dash-grid">
                    <Card className="sme-dash-card" title={t('Where would you like to start?')}>
                        {starts.map((item) => (
                            <div key={item.key} className="sme-dash-row">
                                <span className="sme-dash-row-icon" aria-hidden="true">{item.icon}</span>
                                <div className="sme-dash-row-text"><Text strong>{item.title}</Text><Text type="secondary">{item.detail}</Text></div>
                                <Button type={item.primary ? 'primary' : 'default'} onClick={() => navigate(item.path)}>{item.label}</Button>
                            </div>
                        ))}
                    </Card>
                    <Card className="sme-dash-card" title={t('How it works')}>
                        <ol className="sme-dash-steps">
                            <li>{t('Choose a consultant or AI agent.')}</li>
                            <li>{t('They reply and send you a plan with prices.')}</li>
                            <li>{t('Accept it, and the work shows on your roadmap.')}</li>
                        </ol>
                    </Card>
                    {programmesCard}
                </div>
            </DashboardPage>
        )
    }

    return (
        <DashboardPage className="sme-dash">
            {header}
            <div className="sme-dash-grid">
                <div className="sme-dash-stack">
                    {needs.length > 0 && (
                        <Card className="sme-dash-card" title={t('Needs you')}>
                            {needs.slice(0, 6).map((item) => (
                                <div key={item.key} className="sme-dash-row">
                                    <div className="sme-dash-row-text"><Text strong>{item.title}</Text><Text type="secondary" className="sme-dash-detail">{item.detail}</Text></div>
                                    {item.tag && <Tag bordered={false} color={item.tag.color} className="sme-dash-tag">{item.tag.text}</Tag>}
                                    <Button size="small" onClick={item.action.onClick}>{item.action.label}</Button>
                                </div>
                            ))}
                        </Card>
                    )}
                    <Card className="sme-dash-card" title={t('Under way')} extra={<Button type="link" size="small" onClick={() => navigate('/applicant/roadmap')}>{t('Open roadmap')}</Button>}>
                        {activeWork.length ? activeWork.slice(0, 4).map((item) => (
                            <div key={item.id} className="sme-dash-row">
                                <div className="sme-dash-row-text">
                                    <Text strong>{item.title}</Text>
                                    {item.progress > 0
                                        ? <Progress percent={item.progress} size="small" strokeColor="#6d5dfb" showInfo={false} />
                                        : <Text type="secondary">{item.helperType === 'agent' && item.state === 'in_progress' ? t('Started with {name}', undefined, { name: item.helperName || t('the agent') }) : t('Not started yet')}</Text>}
                                </div>
                                {item.dueDate && <Text type="secondary" className="sme-dash-due">{t('due {date}', undefined, { date: formatDue(item.dueDate) })}</Text>}
                                {item.helperType === 'agent' && <Button size="small" onClick={() => navigate('/applicant/roadmap')}>{t('Continue')}</Button>}
                            </div>
                        )) : <Text type="secondary">{t('Nothing under way yet. Accept a consultant’s plan or start with an agent to see it here.')}</Text>}
                        {doneCount > 0 && <Text type="secondary" className="sme-dash-foot">{doneCount === 1 ? t('1 done so far') : t('{count} done so far', undefined, { count: doneCount })}</Text>}
                    </Card>
                    {/* In the wider column, so the gap and what's missing read at a glance. */}
                    <Card className="sme-dash-card" title={t('Business profile')} extra={<Text type="secondary">{profile.percent}%</Text>}>
                        <Progress percent={profile.percent} size="small" showInfo={false} strokeColor={profile.missing.length ? '#6d5dfb' : '#15803d'} />
                        <div className="sme-dash-profile-row">
                            {profile.missing.length
                                ? <Text type="secondary">{t('{fields} missing', undefined, { fields: profile.missing.slice(0, 4).map(labelFor).join(', ') + (profile.missing.length > 4 ? ` +${profile.missing.length - 4}` : '') })}</Text>
                                : <Text type="secondary">{t('Complete. Consultants see it when you ask for help.')}</Text>}
                            <Button size="small" type={profile.missing.length ? 'primary' : 'default'} onClick={() => navigate('/applicant/profile')}>
                                {profile.missing.length ? (profile.missing.length === 1 ? t('Add it') : t('Add them')) : t('View')}
                            </Button>
                        </div>
                    </Card>
                </div>
                <div className="sme-dash-stack">
                    {helpers.length > 0 && (
                        <Card className="sme-dash-card" title={t('Helping you')}>
                            {helpers.map((helper) => (
                                <div key={helper.id} className="sme-dash-row">
                                    <span className="sme-dash-avatar" aria-hidden="true">{helper.type === 'agent' ? <RobotOutlined /> : <UserOutlined />}</span>
                                    <div className="sme-dash-row-text">
                                        <Text strong>{helper.name}</Text>
                                        <Text type="secondary">{[helper.type === 'agent' ? t('AI agent') : t('Consultant'), helper.area].filter(Boolean).join(' · ')}</Text>
                                    </div>
                                    {helper.type === 'agent'
                                        ? <Button size="small" onClick={() => navigate('/applicant/roadmap')}>{t('Chat')}</Button>
                                        : helper.request && <Button size="small" onClick={() => navigate(requestLink(helper.request!))}>{t('Message')}</Button>}
                                </div>
                            ))}
                        </Card>
                    )}
                    <Card className="sme-dash-card" title={t('Need something else?')}>
                        <Space direction="vertical" size={10} style={{ width: '100%' }}>
                            <Text type="secondary">{t('Consultants and AI agents for marketing, compliance, finance and more.')}</Text>
                            <Button icon={<TeamOutlined />} onClick={() => navigate('/applicant/marketplace')}>{t('Find support')}</Button>
                        </Space>
                    </Card>
                    {programmesCard}
                </div>
            </div>

            {/* Confirming finished work: the SME's sign-off, with a rating for whoever did it. */}
            <ResponsiveModal
                open={!!confirming}
                onClose={() => setConfirming(null)}
                title={confirming ? t('Confirm {title} is done', undefined, { title: confirming.title }) : ''}
                width={460}
                centered
                footer={<Space><Button onClick={() => setConfirming(null)}>{t('Not yet')}</Button><Button type="primary" loading={saving} disabled={!rating} onClick={() => void confirmWork()}>{t('Confirm')}</Button></Space>}
            >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Text type="secondary">{confirming?.helperName ? t('How did {name} do?', undefined, { name: confirming.helperName }) : t('How did it go?')}</Text>
                    <Rate value={rating} onChange={setRating} />
                    <Input.TextArea rows={3} maxLength={600} value={comments} onChange={(event) => setComments(event.target.value)} placeholder={t('Anything you’d like to add (optional)')} />
                </Space>
            </ResponsiveModal>
        </DashboardPage>
    )
}
