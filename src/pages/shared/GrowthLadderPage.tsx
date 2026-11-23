import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Col, Empty, Input, Row, Segmented, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ArrowUpOutlined, FieldTimeOutlined, RiseOutlined, SearchOutlined, TeamOutlined, TrophyOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { LADDER_STEPS, TOP_RUNG } from '@/services/growthLadder'
import { cohortSurvival, listGrowthLadder, markGraduated, STUCK_QUARTERS, undoGraduation, type LadderSme, type LadderStatus } from '@/services/growthLadderService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/growth-ladder.css'

const { Text } = Typography

const STATUS_TAG: Record<LadderStatus, { color: string, label: string }> = {
    active: { color: 'green', label: 'Active' },
    quiet: { color: 'orange', label: 'Quiet' },
    graduated: { color: 'purple', label: 'Graduated' },
    removed: { color: 'default', label: 'Removed' },
}

// Who may mark an SME as graduated: the same staff who may edit participant records (firestore.rules isOperationsStaff).
const GRADUATING_ROLES = new Set(['systemadmin', 'operations', 'projectadmin', 'projectmanager'])

type View = 'in' | 'all'

/** "3 · Growing", or "Not on the ladder yet" for step 0. */
const useStepName = () => {
    const { t } = useLanguage()
    return useCallback((rung: number) => (rung === 0 ? t('Not on the ladder yet') : `${rung} · ${t(LADDER_STEPS[rung - 1].title)}`), [t])
}

/** One dot per step: filled when the records show it, ringed when it is met but a lower step isn't. */
const StepDots = ({ sme }: { sme: LadderSme }) => {
    const { t } = useLanguage()
    return (
        <span className="ladder-dots" aria-label={t('{count} of {total} steps', undefined, { count: sme.current.rung, total: TOP_RUNG })}>
            {LADDER_STEPS.map((step, index) => {
                const met = sme.current.steps[step.key]
                const counted = index < sme.current.rung
                return (
                    <Tooltip key={step.key} title={`${t(step.title)}: ${met ? t('met') : t('not yet')}${met && !counted ? ` (${t('a lower step is missing')})` : ''}`}>
                        <span className={`ladder-dot${counted ? ' is-on' : met ? ' is-loose' : ''}`} />
                    </Tooltip>
                )
            })}
        </span>
    )
}

export default function GrowthLadderPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const stepName = useStepName()
    const [rows, setRows] = useState<LadderSme[]>([])
    const [loading, setLoading] = useState(true)
    const [view, setView] = useState<View>('in')
    const [search, setSearch] = useState('')
    const [graduating, setGraduating] = useState<LadderSme | null>(null)
    const [note, setNote] = useState('')
    const [saving, setSaving] = useState(false)
    const canGraduate = Boolean(user && GRADUATING_ROLES.has(user.role))

    const load = useCallback(async () => {
        if (!user) return
        setLoading(true)
        try {
            setRows(await listGrowthLadder(user, activeProgramId))
        } catch (error) {
            console.error('[GROWTH LADDER] Failed to load', error)
            message.error(t('The growth ladder could not be loaded.'))
            setRows([])
        } finally {
            setLoading(false)
        }
    }, [activeProgramId, message, t, user])

    useEffect(() => { void load() }, [load])

    const inProgramme = useMemo(() => rows.filter(row => row.status === 'active' || row.status === 'quiet'), [rows])
    const stuck = useMemo(() => inProgramme.filter(row => row.stuck).sort((left, right) => right.quartersOnStep - left.quartersOnStep), [inProgramme])
    const cohorts = useMemo(() => cohortSurvival(rows), [rows])
    const distribution = useMemo(() => Array.from({ length: TOP_RUNG + 1 }, (_, rung) => inProgramme.filter(row => row.current.rung === rung).length), [inProgramme])
    const maxOnStep = Math.max(1, ...distribution)
    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return (view === 'in' ? inProgramme : rows).filter(row => !needle || `${row.name} ${row.programName} ${row.cohort}`.toLowerCase().includes(needle))
    }, [inProgramme, rows, search, view])

    const kpis = useMemo(() => ({
        onLadder: inProgramme.length,
        averageStep: inProgramme.length ? Math.round((inProgramme.reduce((sum, row) => sum + row.current.rung, 0) / inProgramme.length) * 10) / 10 : 0,
        movedUp: inProgramme.filter(row => row.stepsGained > 0).length,
        stuck: stuck.length,
        graduated: rows.filter(row => row.status === 'graduated').length,
    }), [inProgramme, rows, stuck.length])

    useRegisterAgentPageContext({
        pageKey: 'growth-ladder',
        pageName: 'Growth ladder',
        purpose: 'Shows which step of the growth ladder each SME has reached from its own records, how cohorts are holding up, who is stuck, and who has graduated.',
        currentFilters: { view, search },
        metrics: kpis,
        dataSummary: { smes: rows.length, cohorts: cohorts.length },
    })

    const opportunitiesUnavailable = rows.some(row => row.opportunitiesUnavailable)

    const saveGraduation = async () => {
        if (!user || !graduating) return
        setSaving(true)
        try {
            await markGraduated(user, graduating, note)
            message.success(t('{name} is marked as graduated.', undefined, { name: graduating.name }))
            setGraduating(null)
            setNote('')
            await load()
        } catch (error) {
            console.error(error)
            message.error(t('Could not mark this SME as graduated.'))
        } finally {
            setSaving(false)
        }
    }

    const takeBack = async (sme: LadderSme) => {
        if (!user) return
        try {
            await undoGraduation(user, sme)
            message.success(t('Graduation taken back for {name}.', undefined, { name: sme.name }))
            await load()
        } catch (error) {
            console.error(error)
            message.error(t('Could not take the graduation back.'))
        }
    }

    const columns: ColumnsType<LadderSme> = [
        {
            title: t('SME'),
            key: 'name',
            render: (_, row) => (
                <div>
                    <Text strong>{row.name}</Text>
                    <div><Text type="secondary" style={{ fontSize: 12 }}>{row.programName} · {t('Cohort')} {row.cohort}</Text></div>
                </div>
            ),
            sorter: (left, right) => left.name.localeCompare(right.name),
        },
        {
            title: t('Step'),
            key: 'step',
            width: 230,
            render: (_, row) => (
                <Space direction="vertical" size={4}>
                    <Text>{stepName(row.current.rung)}</Text>
                    <StepDots sme={row} />
                </Space>
            ),
            sorter: (left, right) => left.current.rung - right.current.rung,
            defaultSortOrder: 'descend',
        },
        {
            title: t('Since joining'),
            key: 'gained',
            width: 130,
            render: (_, row) => row.stepsGained > 0
                ? <Tag color="green" icon={<ArrowUpOutlined />}>{t('+{count} steps', undefined, { count: row.stepsGained })}</Tag>
                : row.stepsGained < 0 ? <Tag color="red">{t('{count} steps', undefined, { count: row.stepsGained })}</Tag> : <Text type="secondary">{t('No change')}</Text>,
            sorter: (left, right) => left.stepsGained - right.stepsGained,
        },
        {
            title: t('On this step'),
            key: 'quarters',
            width: 140,
            render: (_, row) => (
                <Text type={row.stuck ? 'danger' : undefined}>
                    {row.quartersOnStep === 1 ? t('This quarter') : t('{count} quarters', undefined, { count: row.quartersOnStep })}
                </Text>
            ),
            sorter: (left, right) => left.quartersOnStep - right.quartersOnStep,
        },
        {
            title: t('Status'),
            key: 'status',
            width: 120,
            render: (_, row) => <Tag color={STATUS_TAG[row.status].color}>{t(STATUS_TAG[row.status].label)}</Tag>,
        },
        ...(canGraduate ? [{
            title: '',
            key: 'action',
            width: 150,
            align: 'right' as const,
            render: (_: unknown, row: LadderSme) => row.status === 'graduated'
                ? <Button size="small" onClick={() => void takeBack(row)}>{t('Take back')}</Button>
                : row.status === 'removed' ? null : <Button size="small" icon={<TrophyOutlined />} onClick={() => { setGraduating(row); setNote('') }}>{t('Graduate')}</Button>,
        }] : []),
    ]

    return (
        <DashboardPage className="growth-ladder-page">
            <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                <Col xs={12} md={6}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} iconClassName="is-users" label={t('SMEs in the programme')} value={kpis.onLadder} hint={t('Average step {step}', undefined, { step: kpis.averageStep })} /></Col>
                <Col xs={12} md={6}><DashboardMetricCard loading={loading} icon={<RiseOutlined />} iconClassName="is-participants" label={t('Moved up since joining')} value={kpis.movedUp} /></Col>
                <Col xs={12} md={6}><DashboardMetricCard loading={loading} icon={<FieldTimeOutlined />} iconClassName="is-attention" label={t('Stuck on a step')} value={kpis.stuck} hint={t('{count}+ quarters', undefined, { count: STUCK_QUARTERS })} /></Col>
                <Col xs={12} md={6}><DashboardMetricCard loading={loading} icon={<TrophyOutlined />} iconClassName="is-delivery" label={t('Graduated')} value={kpis.graduated} /></Col>
            </Row>

            {opportunitiesUnavailable && !loading && (
                <Card size="small" className="ladder-note">
                    <Text type="secondary">{t('Opportunities could not be read, so no SME is shown on the In the market or Winning work steps yet.')}</Text>
                </Card>
            )}

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={14}>
                    <Card loading={loading} className="dashboard-section-card" title={t('Where SMEs are on the ladder')}>
                        <div className="ladder-steps">
                            {[...LADDER_STEPS.map((step, index) => ({ rung: index + 1, title: step.title, rule: step.rule })).reverse(), { rung: 0, title: 'Not on the ladder yet', rule: 'No monthly figures for 3 of the last 4 months.' }].map(step => (
                                <div key={step.rung} className="ladder-step">
                                    <span className="ladder-step-rung">{step.rung || '–'}</span>
                                    <div className="ladder-step-body">
                                        <div className="ladder-step-head">
                                            <Text strong>{t(step.title)}</Text>
                                            <Text>{distribution[step.rung]}</Text>
                                        </div>
                                        <div className="ladder-bar"><span style={{ width: `${(distribution[step.rung] / maxOnStep) * 100}%` }} /></div>
                                        <Text type="secondary" className="ladder-step-rule">{t(step.rule)}</Text>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </Col>
                <Col xs={24} xl={10}>
                    <Card loading={loading} className="dashboard-section-card" title={t('Stuck for {count} quarters or more', undefined, { count: STUCK_QUARTERS })} style={{ height: '100%' }}>
                        {stuck.length ? (
                            <div className="ladder-stuck">
                                {stuck.slice(0, 12).map(row => (
                                    <div key={row.id} className="ladder-stuck-row">
                                        <div style={{ minWidth: 0 }}>
                                            <Text strong ellipsis>{row.name}</Text>
                                            <div><Text type="secondary" style={{ fontSize: 12 }}>{stepName(row.current.rung)}</Text></div>
                                        </div>
                                        <Tag color="red" style={{ marginInlineEnd: 0 }}>{t('{count} quarters', undefined, { count: row.quartersOnStep })}</Tag>
                                    </div>
                                ))}
                            </div>
                        ) : <Empty description={t('No SME has been on the same step that long.')} />}
                    </Card>
                </Col>

                <Col span={24}>
                    <Card loading={loading} className="dashboard-section-card" title={t('Survival by cohort')}>
                        <Table
                            size="small"
                            rowKey={row => `${row.programName}-${row.cohort}`}
                            dataSource={cohorts}
                            pagination={false}
                            scroll={{ x: 640 }}
                            locale={{ emptyText: t('No SMEs in scope yet.') }}
                            columns={[
                                { title: t('Programme'), dataIndex: 'programName', key: 'programName' },
                                { title: t('Cohort'), dataIndex: 'cohort', key: 'cohort', width: 100 },
                                { title: t('SMEs'), dataIndex: 'counted', key: 'counted', width: 80, align: 'right' },
                                { title: t('Active'), key: 'active', width: 120, align: 'right', render: (_, row) => <Text>{row.active} <Text type="secondary">({row.activeShare}%)</Text></Text> },
                                { title: t('Quiet'), dataIndex: 'quiet', key: 'quiet', width: 90, align: 'right' },
                                { title: t('Graduated'), dataIndex: 'graduated', key: 'graduated', width: 110, align: 'right' },
                                { title: t('Removed'), dataIndex: 'removed', key: 'removed', width: 100, align: 'right' },
                            ]}
                        />
                        <Text type="secondary" className="ladder-footnote">{t('Active: still in the programme and sent monthly figures in the last 3 months. Quiet: still in, but no figures in that time.')}</Text>
                    </Card>
                </Col>

                <Col span={24}>
                    <FilterBar
                        compact
                        primary={(
                            <>
                                <Segmented<View> value={view} onChange={setView} options={[{ label: t('In the programme'), value: 'in' }, { label: t('Everyone'), value: 'all' }]} />
                                <Input prefix={<SearchOutlined />} placeholder={t('Search SMEs, programmes or cohorts')} value={search} onChange={event => setSearch(event.target.value)} allowClear />
                            </>
                        )}
                    />
                    <Card className="dashboard-section-card" style={{ marginTop: 12 }}>
                        <Table rowKey="id" loading={loading} dataSource={visible} columns={columns} scroll={{ x: 900 }} pagination={{ pageSize: 15, showSizeChanger: false }} locale={{ emptyText: t('No SMEs in scope yet.') }} />
                    </Card>
                </Col>
            </Row>

            <ResponsiveModal
                open={Boolean(graduating)}
                onClose={() => !saving && setGraduating(null)}
                title={graduating ? t('Graduate {name}', undefined, { name: graduating.name }) : ''}
                footer={(
                    <>
                        <Button onClick={() => setGraduating(null)} disabled={saving}>{t('Cancel')}</Button>
                        <Button type="primary" icon={<TrophyOutlined />} loading={saving} onClick={() => void saveGraduation()}>{t('Mark as graduated')}</Button>
                    </>
                )}
            >
                {graduating && (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <Text>{t('Graduating means {name} has completed the programme. They stay on record, and count as graduated in the cohort figures instead of active or removed.', undefined, { name: graduating.name })}</Text>
                        <Text type="secondary">
                            {t('Step now: {step}.', undefined, { step: stepName(graduating.current.rung) })}
                            {graduating.current.rung < TOP_RUNG ? ` ${t('They have not reached the top step; you can still graduate them.')}` : ''}
                        </Text>
                        <Input.TextArea rows={3} value={note} onChange={event => setNote(event.target.value)} placeholder={t('Why now (optional), e.g. completed the programme and won a supplier contract')} maxLength={500} />
                        <Text type="secondary" style={{ fontSize: 12 }}>{t('Joined {date}.', undefined, { date: dayjs(graduating.joinedAt).format('D MMM YYYY') })}</Text>
                    </Space>
                )}
            </ResponsiveModal>
        </DashboardPage>
    )
}
