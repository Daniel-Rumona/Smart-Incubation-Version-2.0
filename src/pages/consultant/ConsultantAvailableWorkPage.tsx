import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Empty, Input, Select, Tag, Typography, type TableProps } from 'antd'
import { CheckOutlined, InboxOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { useAssignedInterventions } from '@/contexts/AssignedInterventionsContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { claimWork, isAlreadyTaken, listAvailableWork, type AvailableWorkBlock, type AvailableWorkItem } from '@/services/availableWorkService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import '@/styles/available-work.css'

const keyOf = (item: AvailableWorkItem) => `${item.participantId}|${item.interventionId}|${item.stepId || ''}`

const BLOCK_TEXT: Record<AvailableWorkBlock, string> = {
    not_enabled: 'Your company’s operations team assigns interventions, so there’s nothing to pick up here.',
    not_delivery_role: 'Facilitators aren’t one of your company’s delivery roles at the moment, so there’s nothing to pick up.',
    no_areas: 'You can pick up work once your operations team adds your areas of support on Manage team.',
}

/**
 * Facilitators pick up interventions themselves when the company uses "Facilitators pick their own": the work in
 * their programmes and areas that nobody is on yet. The first to pick something up gets it.
 */
export const ConsultantAvailableWorkPage = () => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const navigate = useNavigate()
    const { refresh: refreshAssignments } = useAssignedInterventions()
    const [items, setItems] = useState<AvailableWorkItem[]>([])
    const [block, setBlock] = useState<AvailableWorkBlock | null>(null)
    const [loading, setLoading] = useState(true)
    const [claiming, setClaiming] = useState<string>()
    const [search, setSearch] = useState('')
    const [area, setArea] = useState('all')

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const result = await listAvailableWork()
            setBlock(result.block)
            setItems(result.items)
        } catch (error) {
            console.error('[AVAILABLE WORK] Failed to load:', error)
            message.error(t('Available work could not be loaded.'))
            setItems([])
        } finally {
            setLoading(false)
        }
    }, [message, t])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const pickUp = async (item: AvailableWorkItem) => {
        setClaiming(keyOf(item))
        try {
            await claimWork(item)
            setItems((current) => current.filter((row) => keyOf(row) !== keyOf(item)))
            message.success(t('{title} is yours. It’s now in My interventions.', undefined, { title: item.title }))
            void refreshAssignments?.()
        } catch (error) {
            if (isAlreadyTaken(error)) {
                message.warning(t('Someone has already picked this up.'))
                void load()
            } else {
                console.error('[AVAILABLE WORK] Pick-up failed:', error)
                message.error(t('This couldn’t be picked up. Please try again.'))
            }
        } finally {
            setClaiming(undefined)
        }
    }

    const areas = useMemo(() => [...new Set(items.map((item) => item.area).filter((value): value is string => !!value))].sort(), [items])
    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return items.filter((item) => (area === 'all' || item.area === area)
            && (!needle || `${item.smeName} ${item.title} ${item.programName || ''}`.toLowerCase().includes(needle)))
    }, [area, items, search])

    useRegisterAgentPageContext({
        pageKey: 'consultant-available-work',
        pageName: 'Available work',
        purpose: 'Interventions in the facilitator’s programmes and areas of support that nobody is on yet; the facilitator picks them up.',
        metrics: { available: items.length, shown: rows.length },
        currentFilters: { search, area },
    })

    const stepLabel = (item: AvailableWorkItem) => (item.stepNumber && item.stepCount
        ? t('Step {number} of {count}: {title}', undefined, { number: item.stepNumber, count: item.stepCount, title: item.stepTitle || '' })
        : null)

    const pickUpButton = (item: AvailableWorkItem, block?: boolean) => (
        <Button type="primary" icon={<CheckOutlined />} block={block} loading={claiming === keyOf(item)} disabled={!!claiming && claiming !== keyOf(item)} onClick={() => void pickUp(item)}>
            {t('Pick up')}
        </Button>
    )

    const columns: TableProps<AvailableWorkItem>['columns'] = [
        { title: t('SME'), key: 'sme', render: (_, item) => <Typography.Text strong>{item.smeName}</Typography.Text> },
        {
            title: t('Intervention'),
            key: 'intervention',
            render: (_, item) => (
                <span className="available-work-title">
                    <Typography.Text>{item.title}</Typography.Text>
                    {stepLabel(item) && <Typography.Text type="secondary">{stepLabel(item)}</Typography.Text>}
                </span>
            ),
        },
        { title: t('Area'), key: 'area', width: 160, render: (_, item) => (item.area ? <Tag bordered={false}>{item.area}</Tag> : <Typography.Text type="secondary">—</Typography.Text>) },
        { title: t('Programme'), key: 'programme', width: 200, render: (_, item) => item.programName || <Typography.Text type="secondary">—</Typography.Text> },
        { title: '', key: 'action', width: 140, align: 'right', render: (_, item) => pickUpButton(item) },
    ]

    return (
        <DashboardPage className="available-work-page">
            {block ? (
                <Card className="dashboard-section-card motion-card">
                    <Empty image={<InboxOutlined className="available-work-empty-icon" />} description={t(BLOCK_TEXT[block])} />
                </Card>
            ) : (
                <>
                    <FilterBar
                        compact
                        primary={(
                            <>
                                <Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search SME or intervention')} allowClear />
                                {areas.length > 1 && (
                                    <Select value={area} onChange={setArea} options={[{ value: 'all', label: t('All areas') }, ...areas.map((value) => ({ value, label: value }))]} />
                                )}
                                <Button icon={<ReloadOutlined />} onClick={() => void load()} aria-label={t('Refresh')} />
                            </>
                        )}
                    />
                    <Card
                        className="dashboard-section-card motion-card"
                        title={t('Available work')}
                        extra={<Typography.Link onClick={() => navigate('/consultant/interventions')}>{t('My interventions')}</Typography.Link>}
                    >
                        <Typography.Paragraph type="secondary" className="available-work-intro">
                            {t('Interventions in your programmes and areas of support that nobody is on yet. Pick one up and it’s yours.')}
                        </Typography.Paragraph>
                        <ResponsiveDataView<AvailableWorkItem>
                            rowKey={keyOf}
                            rows={rows}
                            columns={columns}
                            loading={loading}
                            emptyText={items.length ? t('Nothing matches your search.') : t('Nothing to pick up right now. New work appears here as SMEs’ growth plans are confirmed.')}
                            renderCard={(item) => (
                                <div className="available-work-card">
                                    <Typography.Text strong>{item.title}</Typography.Text>
                                    {stepLabel(item) && <Typography.Text type="secondary">{stepLabel(item)}</Typography.Text>}
                                    <Typography.Text>{item.smeName}</Typography.Text>
                                    <span className="available-work-meta">
                                        {item.area && <Tag bordered={false}>{item.area}</Tag>}
                                        {item.programName && <Typography.Text type="secondary">{item.programName}</Typography.Text>}
                                    </span>
                                    {pickUpButton(item, true)}
                                </div>
                            )}
                        />
                    </Card>
                </>
            )}
        </DashboardPage>
    )
}

export default ConsultantAvailableWorkPage
