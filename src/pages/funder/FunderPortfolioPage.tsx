import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Breadcrumb, Button, Card, Col, Empty, Popconfirm, Progress, Row, Segmented, Skeleton, Tag, Typography } from 'antd'
import { AppstoreOutlined, BankOutlined, DisconnectOutlined, DollarOutlined, ProjectOutlined, RightOutlined, TeamOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import FundingAmountText from '@/components/funders/FundingAmountText'
import LinkRequestCard from '@/components/funders/LinkRequestCard'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { setActiveImplementor, useActiveImplementor } from '@/hooks/useActiveImplementor'
import { ALL_PROGRAMS, setActiveProgramId, useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { DirectorPortfolioPage } from '@/pages/director/DirectorPortfolioPage'
import FunderSmePanels from '@/pages/funder/FunderSmePanels'
import { useLanguage } from '@/providers/LanguageProvider'
import { listDirectorPortfolio } from '@/services/directorPortfolioService'
import {
    funderOrgErrorMessage, removeFunderLink, subscribeOrganisationLinks, subscribeOwnOrganisation, type FunderLink, type FunderOrganisation,
} from '@/services/funderOrganisationsService'
import { ALL_IMPLEMENTORS, isOrgFunder, loadDataScope } from '@/services/funderScopeService'
import { formatCurrencyZAR } from '@/services/smePerformanceMetrics'
import { loadFunderCompliance, type FunderComplianceSummary } from '@/services/funderComplianceService'
import { isBehind } from '@/services/funderService'
import { CHART_COLORS } from '@/config/chartPalette'
import type { DirectorPortfolioSme } from '@/types/director'
import '@/styles/director.css'
import '@/styles/funder.css'
import '@/styles/funder-organisations.css'

const shortRand = (value: number) => {
    if (value >= 1_000_000) return `R${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
    if (value >= 1_000) return `R${Math.round(value / 1_000)}k`
    return formatCurrencyZAR(value)
}

type Implementor = { code: string; name: string; links: FunderLink[] }

/** The programme performance cards' colours: green from 75%, amber from 40%, red below. */
const healthColor = (value: number) => (value >= 75 ? CHART_COLORS.success : value >= 40 ? CHART_COLORS.amber : CHART_COLORS.danger)

/** Support done across some SMEs: completed against required, as the dashboard and programme cards count it. */
const progressOf = (rows: DirectorPortfolioSme[]) => {
    const required = rows.reduce((sum, row) => sum + row.execution.required, 0)
    const completed = rows.reduce((sum, row) => sum + row.execution.completed, 0)
    return { required, completed, rate: required ? Math.min(100, Math.round((completed / required) * 100)) : null }
}

type ComplianceState = FunderComplianceSummary | 'loading' | 'failed'

/** A card's key: an implementor (i:company) or a programme at its implementor (p:company:programme). */
const implementorKey = (code: string) => `i:${code}`
const programmeKey = (link: FunderLink) => `p:${link.companyCode}:${link.programId}`
const parseCardKey = (key: string) => {
    const [kind, implementor, programId] = key.split(':')
    return { key, implementor, programId: kind === 'p' ? programId : null }
}

/** Funding recorded on some links, and on how many of them; null when none has an amount. */
const fundingOf = (links: FunderLink[]) => {
    const amounts = links.map((link) => link.fundingAmount).filter((value): value is number => value !== null)
    return { total: amounts.length ? amounts.reduce((sum, value) => sum + value, 0) : null, recorded: amounts.length, of: links.length }
}

/**
 * A funder organisation's portfolio, top down: its implementors, then one implementor's programmes, then a programme's
 * SMEs (a list and the chosen SME side by side). "All SMEs" shows every SME at the first two levels. Where you are
 * follows the implementor and programme dropdowns in the top bar, both ways. Company-scoped funders keep the SME list.
 */
export const FunderPortfolioPage = () => {
    const { user } = useFullIdentity()
    if (!isOrgFunder(user)) return <DirectorPortfolioPage />
    return <OrganisationPortfolio />
}

function OrganisationPortfolio() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const { activeImplementor } = useActiveImplementor()
    const { activeProgramId } = useActiveProgramId()
    const orgId = String(user?.funderOrgId || '')
    const [links, setLinks] = useState<FunderLink[]>([])
    const [organisation, setOrganisation] = useState<FunderOrganisation | null>(null)
    const [linksLoaded, setLinksLoaded] = useState(false)
    const [smes, setSmes] = useState<DirectorPortfolioSme[]>([])
    const [smesLoading, setSmesLoading] = useState(true)
    const [error, setError] = useState(false)
    const [busy, setBusy] = useState<string>()
    // "Cards" or "All SMEs", per level; a level opens on its cards.
    const [smesAt, setSmesAt] = useState<string>()

    useEffect(() => {
        if (!orgId) return
        const stops = [
            subscribeOrganisationLinks(orgId, (rows) => { setLinks(rows); setLinksLoaded(true) }, () => { setError(true); setLinksLoaded(true) }),
            subscribeOwnOrganisation(orgId, setOrganisation, () => setOrganisation(null)),
        ]
        return () => stops.forEach((stop) => stop())
    }, [orgId])

    // Every SME the organisation funds, once; the levels filter it.
    useEffect(() => {
        if (!user) return
        let active = true
        const timeout = window.setTimeout(() => {
            setSmesLoading(true)
            loadDataScope(user, ALL_IMPLEMENTORS)
                .then((scope) => listDirectorPortfolio(user, ALL_PROGRAMS, scope))
                .then((rows) => { if (active) { setSmes(rows); setError(false) } })
                .catch((reason) => { console.error(reason); if (active) setError(true) })
                .finally(() => { if (active) setSmesLoading(false) })
        }, 0)
        return () => { active = false; window.clearTimeout(timeout) }
    }, [user])

    const active = useMemo(() => links.filter((link) => link.status === 'active'), [links])
    const pending = useMemo(() => links.filter((link) => link.status === 'pending'), [links])
    const implementors = useMemo<Implementor[]>(() => {
        const groups = new Map<string, Implementor>()
        active.forEach((link) => {
            const group = groups.get(link.companyCode) || { code: link.companyCode, name: link.companyName, links: [] }
            group.links.push(link)
            groups.set(link.companyCode, group)
        })
        return [...groups.values()]
            .map((group) => ({ ...group, links: group.links.sort((left, right) => left.programName.localeCompare(right.programName)) }))
            .sort((left, right) => left.name.localeCompare(right.name))
    }, [active])
    const smesOfProgramme = (programId: string) => smes.filter((row) => row.programId === programId)
    const smesOfImplementor = (code: string) => smes.filter((row) => row.companyCode === code)

    // Where we are, from the top bar: a programme, an implementor, or everything.
    const programmeLink = activeProgramId !== ALL_PROGRAMS ? active.find((link) => link.programId === activeProgramId) : undefined
    const implementor = implementors.find((row) => row.code === (programmeLink?.companyCode || activeImplementor))
    const level: 'all' | 'implementor' | 'programme' = programmeLink ? 'programme' : implementor ? 'implementor' : 'all'
    const levelKey = programmeLink ? `p:${programmeLink.programId}` : implementor ? `i:${implementor.code}` : 'all'
    const showingSmes = level === 'programme' || smesAt === levelKey

    const goAll = () => { setActiveProgramId(ALL_PROGRAMS); setActiveImplementor(ALL_IMPLEMENTORS); setSmesAt(undefined) }
    const goImplementor = (code: string) => { setActiveProgramId(ALL_PROGRAMS); setActiveImplementor(code); setSmesAt(undefined) }
    const goProgramme = (link: FunderLink) => { setActiveImplementor(link.companyCode); setActiveProgramId(link.programId) }

    const unlink = async (link: FunderLink) => {
        setBusy(link.id)
        try {
            await removeFunderLink(link.id)
            message.success(t('Removed. {company} has been told.', undefined, { company: link.companyName }))
            if (programmeLink?.id === link.id) goImplementor(link.companyCode)
        } catch (reason) {
            message.error(funderOrgErrorMessage(reason, t('That didn\'t work. Try again.'), ''))
        } finally {
            setBusy(undefined)
        }
    }

    const inView = level === 'programme' ? [programmeLink!] : level === 'implementor' ? implementor!.links : active
    const funding = fundingOf(inView)
    const smesInView = level === 'programme' ? smesOfProgramme(programmeLink!.programId) : level === 'implementor' ? smesOfImplementor(implementor!.code) : smes

    useRegisterAgentPageContext({
        pageKey: 'funder-portfolio',
        pageName: 'Funder portfolio',
        purpose: 'The implementors and programmes this funder organisation funds, their funding and SMEs, and the SMEs themselves.',
        metrics: { implementors: implementors.length, programmes: active.length, smes: smes.length, funding: fundingOf(active).total ?? 0 },
    })

    const breadcrumb = [
        { key: 'all', title: level === 'all' ? t('All implementors') : <a onClick={goAll}>{t('All implementors')}</a> },
        ...(implementor ? [{ key: 'implementor', title: level === 'implementor' ? implementor.name : <a onClick={() => goImplementor(implementor.code)}>{implementor.name}</a> }] : []),
        ...(programmeLink ? [{ key: 'programme', title: programmeLink.programName }] : []),
    ]

    const programmeCard = (link: FunderLink) => scorecard({
        key: programmeKey(link),
        title: link.programName,
        sub: link.respondedAt ? t('Accepted on {date}', undefined, { date: dayjs(link.respondedAt).format('D MMM YYYY') }) : t('Active'),
        tag: <Tag variant="filled" color="green">{t('Active')}</Tag>,
        rows: smesOfProgramme(link.programId),
        funding: <FundingAmountText link={link} compact />,
        onOpen: () => goProgramme(link),
        actions: <>
            <Button size="small" type="link" icon={<RightOutlined />} iconPlacement="end" onClick={() => goProgramme(link)}>{t('View SMEs')}</Button>
            <Popconfirm
                title={t('Stop funding this programme here?')}
                description={t('It leaves your dashboard, and {company} is told.', undefined, { company: link.companyName })}
                okText={t('Remove')}
                cancelText={t('Keep')}
                okButtonProps={{ danger: true }}
                onConfirm={() => void unlink(link)}
            >
                <Button size="small" type="text" danger icon={<DisconnectOutlined />} loading={busy === link.id}>{t('Unlink')}</Button>
            </Popconfirm>
        </>,
    })

    const implementorCard = (row: Implementor) => {
        const money = fundingOf(row.links)
        return scorecard({
            key: implementorKey(row.code),
            title: row.name,
            sub: row.links.length === 1 ? t('1 programme') : t('{count} programmes', undefined, { count: row.links.length }),
            rows: smesOfImplementor(row.code),
            funding: money.total === null
                ? <Typography.Text type="secondary">{t('Not entered yet')}</Typography.Text>
                : <span><b>{shortRand(money.total)}</b>{money.recorded < money.of && <Typography.Text type="secondary" className="director-small"> {t('on {count} of {total}', undefined, { count: money.recorded, total: money.of })}</Typography.Text>}</span>,
            onOpen: () => goImplementor(row.code),
        })
    }

    // Compliance for each card in view: one implementor, or one programme at its implementor.
    const [compliance, setCompliance] = useState<Record<string, ComplianceState>>({})
    // One key per card in view, joined, so the effect below only reruns when the cards change.
    const cardKeys = (showingSmes ? [] : level === 'all'
        ? implementors.map((row) => implementorKey(row.code))
        : (implementor?.links || []).map((link) => programmeKey(link))).join('|')
    useEffect(() => {
        let active = true
        const missing = cardKeys.split('|').filter((key) => key && !compliance[key]).map(parseCardKey)
        if (!missing.length) return
        const timeout = window.setTimeout(() => {
            setCompliance((current) => ({ ...current, ...Object.fromEntries(missing.map((card) => [card.key, 'loading' as const])) }))
            missing.forEach((card) => {
                loadFunderCompliance(card.programId, card.implementor)
                    .then((summary) => { if (active) setCompliance((current) => ({ ...current, [card.key]: summary })) })
                    .catch(() => { if (active) setCompliance((current) => ({ ...current, [card.key]: 'failed' })) })
            })
        }, 0)
        return () => { active = false; window.clearTimeout(timeout) }
    }, [cardKeys, compliance])


    const complianceStat = (key: string) => {
        const state = compliance[key]
        if (!state || state === 'loading') return <Typography.Text type="secondary">…</Typography.Text>
        if (state === 'failed') return <Typography.Text type="secondary">{t('Unavailable')}</Typography.Text>
        if (!state.total) return <Typography.Text type="secondary">{t('No SMEs yet')}</Typography.Text>
        const share = Math.round((state.compliant / state.total) * 100)
        return (
            <span>
                <Tag variant="filled" color={share >= 75 ? 'green' : share >= 40 ? 'orange' : 'red'}>{t('{count} of {total} compliant', undefined, { count: state.compliant, total: state.total })}</Tag>
                {state.expiring > 0 && <Typography.Text type="secondary" className="director-small">{t('{count} expiring soon', undefined, { count: state.expiring })}</Typography.Text>}
            </span>
        )
    }

    /** A card in the programme performance style: support done, then SMEs, funding, compliance and SMEs behind. */
    const scorecard = (input: {
        key: string
        title: string
        sub: string
        tag?: React.ReactNode
        rows: DirectorPortfolioSme[]
        funding: React.ReactNode
        onOpen: () => void
        actions?: React.ReactNode
    }) => {
        const progress = progressOf(input.rows)
        const behind = input.rows.filter(isBehind).length
        return (
            <div
                key={input.key}
                role="button"
                tabIndex={0}
                className="director-programme-scorecard portfolio-scorecard"
                style={{ borderTopColor: progress.rate === null ? undefined : healthColor(progress.rate) }}
                onClick={input.onOpen}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.onOpen() } }}
            >
                <span className="director-programme-scorecard-head">
                    <Typography.Text strong ellipsis>{input.title}</Typography.Text>
                    {input.tag || <RightOutlined />}
                </span>
                <Typography.Text type="secondary" className="director-programme-scorecard-sub">{input.sub}</Typography.Text>

                <div className="director-programme-scorecard-completion">
                    <span>
                        <Typography.Text type="secondary">{t('Support done')}</Typography.Text>
                        <Typography.Text strong>{progress.rate === null ? '—' : `${progress.rate}%`}</Typography.Text>
                    </span>
                    <Progress percent={progress.rate ?? 0} showInfo={false} size="small" strokeColor={progress.rate === null ? undefined : healthColor(progress.rate)} />
                    <Typography.Text type="secondary">
                        {progress.required ? t('{completed} of {required} required', undefined, { completed: progress.completed, required: progress.required }) : t('Nothing required yet')}
                    </Typography.Text>
                </div>

                <div className="director-programme-scorecard-stats">
                    <div><Typography.Text type="secondary">{t('SMEs')}</Typography.Text><b className="portfolio-stat">{smesLoading ? '…' : input.rows.length}</b></div>
                    <div><Typography.Text type="secondary">{t('Funding')}</Typography.Text><span className="portfolio-stat-funding">{input.funding}</span></div>
                    <div><Typography.Text type="secondary">{t('Compliance')}</Typography.Text>{complianceStat(input.key)}</div>
                    <div>
                        <Typography.Text type="secondary">{t('Behind')}</Typography.Text>
                        {smesLoading ? <span>…</span> : behind
                            ? <Tag variant="filled" color="red">{t('{count} SMEs', undefined, { count: behind })}</Tag>
                            : <Tag variant="filled" color="green">{t('None')}</Tag>}
                    </div>
                </div>
                {input.actions && <div className="portfolio-tile-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>{input.actions}</div>}
            </div>
        )
    }

    const loading = !linksLoaded

    return (
        <DashboardPage className="funder-page funder-portfolio-page">
            {error && <Alert type="error" showIcon message={t('Your portfolio could not be loaded.')} style={{ marginBottom: 16 }} />}

            {pending.length > 0 && (
                <div className="funder-requests">
                    {pending.map((link) => <LinkRequestCard key={link.id} link={link} confirmed={organisation?.status === 'confirmed'} />)}
                </div>
            )}

            <Row gutter={[16, 16]}>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={loading} icon={<BankOutlined />} iconClassName="is-users" label={t('Implementors')} value={implementor ? 1 : implementors.length} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={loading} icon={<ProjectOutlined />} iconClassName="is-delivery" label={t('Programmes funded')} value={inView.length} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={loading}
                        icon={<DollarOutlined />}
                        iconClassName="is-participants"
                        label={t('Funding committed')}
                        value={funding.total === null ? '—' : shortRand(funding.total)}
                        hint={funding.of ? t('{count} of {total} programmes have an amount', undefined, { count: funding.recorded, total: funding.of }) : undefined}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={smesLoading} icon={<TeamOutlined />} iconClassName="is-attention" label={t('SMEs in portfolio')} value={smesInView.length} />
                </Col>
            </Row>

            <Card className="admin-card portfolio-browser" variant="borderless">
                <div className="portfolio-browser-head">
                    <Breadcrumb items={breadcrumb} />
                    {level !== 'programme' && (
                        <Segmented
                            value={showingSmes ? 'smes' : 'cards'}
                            onChange={(value) => setSmesAt(value === 'smes' ? levelKey : undefined)}
                            options={[
                                { value: 'cards', label: level === 'all' ? t('Implementors') : t('Programmes'), icon: <AppstoreOutlined /> },
                                { value: 'smes', label: level === 'all' ? t('All SMEs') : t('All SMEs here'), icon: <TeamOutlined /> },
                            ]}
                        />
                    )}
                </div>

                {loading ? <Skeleton active /> : showingSmes ? (
                    <FunderSmePanels
                        smes={smesInView}
                        loading={smesLoading}
                        showImplementor={level === 'all'}
                        showProgramme={level !== 'programme'}
                    />
                ) : level === 'all' ? (
                    implementors.length
                        ? <div className="portfolio-tiles">{implementors.map((row) => implementorCard(row))}</div>
                        : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No programmes yet. Implementors send you a request when they list you as a funder.')} />
                ) : (
                    <div className="portfolio-tiles">{implementor!.links.map((link) => programmeCard(link))}</div>
                )}
            </Card>
        </DashboardPage>
    )
}

export default FunderPortfolioPage
