import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
    App, Button, Card, Checkbox, Col, Empty, Grid, Input, Modal, Row, Select,
    Space, Switch, Table, Tag, Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    CheckCircleOutlined, CrownOutlined, EditOutlined, RocketOutlined,
    SearchOutlined, SettingOutlined, StarOutlined,
} from '@ant-design/icons'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { PageLoadingBar } from '@/components/shared/PageSkeleton'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    DEFAULT_PLAN_FEATURES, FEATURES, FEATURE_KEYS, PLAN_TIERS, TIERS,
    resolveEntitlements, type FeatureKey, type PlanFeatures, type PlanTier,
} from '@/config/entitlements'
import { listWorkspaceCompanies, type WorkspaceCompany } from '@/services/companiesService'
import {
    getCompanyPlan, getPlanFeatures, saveCompanyPlan, savePlanFeatures,
    type CompanyPlan,
} from '@/services/companyPlanService'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/admin-dashboard.css'
import '@/styles/company-plans.css'

type CompanyRow = WorkspaceCompany & { plan: CompanyPlan }
type TierFilter = 'all' | PlanTier | 'legacy'

const TIER_ICONS: Record<PlanTier, ReactNode> = {
    basic: <StarOutlined />,
    standard: <RocketOutlined />,
    premium: <CrownOutlined />,
}

const sameFeatures = (a: FeatureKey[], b: FeatureKey[]) =>
    a.length === b.length && a.every((key) => b.includes(key))

export const CompanyPlansPage = () => {
    const { t } = useLanguage()
    const { message, modal } = App.useApp()
    const { user } = useFullIdentity()
    const screens = Grid.useBreakpoint()
    const isMobile = !screens.md

    const [rows, setRows] = useState<CompanyRow[]>([])
    const [loading, setLoading] = useState(true)
    const [planFeatures, setPlanFeatures] = useState<PlanFeatures>(DEFAULT_PLAN_FEATURES)
    const [search, setSearch] = useState('')
    const [tierFilter, setTierFilter] = useState<TierFilter>('all')

    const [editingTier, setEditingTier] = useState<PlanTier | null>(null)
    const [draftFeatures, setDraftFeatures] = useState<FeatureKey[]>([])
    const [savingTier, setSavingTier] = useState(false)

    const [editingCompanyCode, setEditingCompanyCode] = useState<string | null>(null)
    const [draftCompanyPlan, setDraftCompanyPlan] = useState<CompanyPlan | null>(null)
    const [savingCompany, setSavingCompany] = useState(false)

    useEffect(() => {
        if (!user) {
            setLoading(false)
            return
        }
        let active = true
        setLoading(true)
        void (async () => {
            try {
                const [companies, features] = await Promise.all([
                    listWorkspaceCompanies(user),
                    getPlanFeatures().catch(() => DEFAULT_PLAN_FEATURES),
                ])
                const plans = await Promise.all(companies.map((company) => getCompanyPlan(company.code)))
                if (!active) return
                setRows(companies.map((company, index) => ({ ...company, plan: plans[index] })))
                setPlanFeatures(features)
            } catch {
                if (active) message.error(t('Companies and plans could not be loaded.'))
            } finally {
                if (active) setLoading(false)
            }
        })()
        return () => { active = false }
    }, [message, t, user])

    const editingCompany = rows.find((row) => row.code === editingCompanyCode)

    const openTier = (tier: PlanTier) => {
        setDraftFeatures([...planFeatures[tier]])
        setEditingTier(tier)
    }

    const closeTier = () => {
        if (savingTier) return
        setEditingTier(null)
        setDraftFeatures([])
    }

    const toggleDraftFeature = (feature: FeatureKey, checked: boolean) => {
        setDraftFeatures((current) => checked
            ? [...new Set([...current, feature])]
            : current.filter((item) => item !== feature))
    }

    const persistTier = async (tier: PlanTier, nextFeatures: FeatureKey[]) => {
        if (!user) return
        setSavingTier(true)
        try {
            // The service persists the complete feature map; update only the selected tier.
            const next: PlanFeatures = { ...planFeatures, [tier]: nextFeatures }
            await savePlanFeatures(user, next)
            setPlanFeatures(next)
            setEditingTier(null)
            setDraftFeatures([])
            message.success(t('Plan features saved.'))
        } catch {
            message.error(t('The plan features could not be saved.'))
        } finally {
            setSavingTier(false)
        }
    }

    const saveTier = () => {
        if (!editingTier || !user || savingTier) return
        const tier = editingTier
        const next = [...draftFeatures]
        const removed = planFeatures[tier].filter((feature) => !next.includes(feature))
        const affected = removed.map((feature) => ({
            feature,
            count: rows.filter((row) => row.plan.tier === tier && !row.plan.addOns.includes(feature)).length,
        })).filter((entry) => entry.count > 0)

        if (!affected.length) {
            void persistTier(tier, next)
            return
        }
        modal.confirm({
            title: t('Confirm feature removal'),
            content: (
                <div>
                    <Typography.Paragraph>
                        {t('Removing these features will immediately change access for companies on this plan unless they have the feature as an add-on.')}
                    </Typography.Paragraph>
                    <ul className="company-plans-removals">
                        {affected.map(({ feature, count }) => (
                            <li key={feature}>{t(FEATURES[feature].label)} — {count} {t('companies affected')}</li>
                        ))}
                    </ul>
                </div>
            ),
            okText: t('Save changes'),
            okButtonProps: { danger: true },
            onOk: async () => { await persistTier(tier, next) },
        })
    }

    const openCompany = (row: CompanyRow) => {
        setEditingCompanyCode(row.code)
        setDraftCompanyPlan({ tier: row.plan.tier, addOns: [...row.plan.addOns] })
    }

    const closeCompany = () => {
        if (savingCompany) return
        setEditingCompanyCode(null)
        setDraftCompanyPlan(null)
    }

    const saveCompany = async () => {
        if (!user || !editingCompanyCode || !draftCompanyPlan || savingCompany) return
        const code = editingCompanyCode
        const next: CompanyPlan = { tier: draftCompanyPlan.tier, addOns: [...draftCompanyPlan.addOns] }
        setSavingCompany(true)
        try {
            await saveCompanyPlan(user, code, next)
            setRows((current) => current.map((row) => row.code === code ? { ...row, plan: next } : row))
            setEditingCompanyCode(null)
            setDraftCompanyPlan(null)
            message.success(t('Company plan saved.'))
        } catch {
            message.error(t('The company plan could not be saved.'))
        } finally {
            setSavingCompany(false)
        }
    }

    const visibleRows = useMemo(() => {
        const term = search.trim().toLowerCase()
        return rows.filter((row) =>
            (tierFilter === 'all' || row.plan.tier === tierFilter) &&
            (!term || `${row.name} ${row.code}`.toLowerCase().includes(term)),
        )
    }, [rows, search, tierFilter])

    const featureCount = (plan: CompanyPlan) => {
        const resolved = resolveEntitlements(
            plan.tier === 'legacy' ? null : { tier: plan.tier, addOns: plan.addOns },
            planFeatures,
        )
        return FEATURE_KEYS.filter((key) => resolved.features[key]).length
    }

    const columns: ColumnsType<CompanyRow> = [
        {
            title: t('Company'),
            key: 'company',
            render: (_, row) => <Typography.Text strong>{row.name}</Typography.Text>,
        },
        {
            title: t('Assigned plan'),
            key: 'plan',
            render: (_, row) => <Tag className="company-plans-tier-tag">{row.plan.tier === 'legacy' ? t('Legacy (all features)') : t(TIERS[row.plan.tier].label)}</Tag>,
        },
        {
            title: t('Available features'),
            key: 'features',
            render: (_, row) => <Typography.Text type="secondary">{featureCount(row.plan)} / {FEATURE_KEYS.length}</Typography.Text>,
        },
        {
            title: t('Add-ons'),
            key: 'addons',
            render: (_, row) => {
                // Held in a variable so the "not legacy" check still applies inside the filter callback.
                const tier = row.plan.tier
                return <Typography.Text type="secondary">{tier === 'legacy' ? '—' : row.plan.addOns.filter((key) => !planFeatures[tier].includes(key)).length}</Typography.Text>
            },
        },
        {
            title: '',
            key: 'actions',
            align: 'right',
            render: (_, row) => <Button icon={<EditOutlined />} onClick={() => openCompany(row)}>{t('Manage')}</Button>,
        },
    ]

    return (
        <DashboardPage className="company-plans-page admin-overview">
            <PageLoadingBar active={loading} label={t('Loading companies')} />

            <Row gutter={[14, 14]} className="company-plans-tier-grid">
                {PLAN_TIERS.map((tier) => {
                    const active = planFeatures[tier]
                    const count = rows.filter((row) => row.plan.tier === tier).length
                    return (
                        <Col key={tier} xs={24} sm={24} lg={8}>
                            <Card className={`admin-card company-plan-card is-${tier}`} bordered={false} loading={loading}>
                                <div className="company-plan-head">
                                    <span className="company-plan-icon">{TIER_ICONS[tier]}</span>
                                    <div className="company-plan-heading-copy">
                                        <Typography.Text strong>{t(TIERS[tier].label)}</Typography.Text>
                                        <Typography.Text type="secondary">{count} {t('companies')}</Typography.Text>
                                    </div>
                                    <div className="company-plan-feature-counter"><strong>{active.length}</strong><span>/{FEATURE_KEYS.length}</span></div>
                                </div>
                                <div className="company-plan-feature-preview">
                                    {active.length ? (
                                        <>
                                            {active.slice(0, 3).map((key) => <Tag key={key}>{t(FEATURES[key].label)}</Tag>)}
                                            {active.length > 3 && <Tag>+{active.length - 3}</Tag>}
                                        </>
                                    ) : <Typography.Text type="secondary">{t('Core platform only')}</Typography.Text>}
                                </div>
                                <Button block icon={<SettingOutlined />} className="company-plan-manage-btn" onClick={() => openTier(tier)}>
                                    {t('Manage features')}
                                </Button>
                            </Card>
                        </Col>
                    )
                })}
            </Row>

            <Card className="admin-card company-plans-companies" bordered={false}>
                <div className="company-plans-section-heading company-plans-company-heading">
                    <div>
                        <Typography.Title level={4}>{t('Company assignments')}</Typography.Title>
                        <Typography.Text type="secondary">{t('Assign subscription tiers and optional features to companies.')}</Typography.Text>
                    </div>
                    <Tag>{rows.length} {t('companies')}</Tag>
                </div>
                <FilterBar
                    primary={<Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search companies')} allowClear />}
                    actions={<Select value={tierFilter} onChange={setTierFilter} className="company-plans-filter" options={[
                        { value: 'all', label: t('All plans') },
                        { value: 'legacy', label: t('Legacy (all features)') },
                        ...PLAN_TIERS.map((tier) => ({ value: tier, label: t(TIERS[tier].label) })),
                    ]} />}
                />
                {isMobile ? (
                    <div className="company-plans-mobile-list">
                        {visibleRows.length ? visibleRows.map((row) => (
                            <div key={row.code} className="company-plans-mobile-company">
                                <div className="company-plans-mobile-details">
                                    <Typography.Text strong>{row.name}</Typography.Text>
                                    <Typography.Text type="secondary">{row.plan.tier === 'legacy' ? t('Legacy (all features)') : t(TIERS[row.plan.tier].label)} · {featureCount(row.plan)} {t('features')}</Typography.Text>
                                </div>
                                <Button type="text" icon={<EditOutlined />} aria-label={t('Manage company plan')} onClick={() => openCompany(row)} />
                            </div>
                        )) : !loading && <Empty description={t('No companies match your filters.')} />}
                    </div>
                ) : (
                    <Table rowKey="code" columns={columns} dataSource={visibleRows} loading={loading} pagination={{ pageSize: 10, hideOnSinglePage: true }} />
                )}
            </Card>

            <Modal
                open={editingTier !== null}
                title={editingTier ? <Space><span className="company-plan-modal-icon">{TIER_ICONS[editingTier]}</span>{t(TIERS[editingTier].label)} — {t('Features')}</Space> : null}
                onCancel={closeTier}
                onOk={saveTier}
                okText={t('Save changes')}
                okButtonProps={{ disabled: !editingTier || sameFeatures(draftFeatures, planFeatures[editingTier]), loading: savingTier }}
                cancelButtonProps={{ disabled: savingTier }}
                closable={!savingTier}
                maskClosable={!savingTier}
                centered
                width={620}
                className="company-plans-modal"
                destroyOnHidden
            >
                <Typography.Paragraph type="secondary" className="company-plans-modal-description">
                    {t('Features enabled here are available to all companies on this tier. Company-specific add-ons remain separate.')}
                </Typography.Paragraph>
                <div className="company-plans-modal-feature-list">
                    {FEATURE_KEYS.map((feature) => {
                        const checked = draftFeatures.includes(feature)
                        return (
                            <div key={feature} className={`company-plans-modal-feature${checked ? ' is-on' : ''}`}>
                                <div>
                                    <Typography.Text strong>{t(FEATURES[feature].label)}</Typography.Text>
                                    <Typography.Text type="secondary">{t(FEATURES[feature].description)}</Typography.Text>
                                </div>
                                <Switch checked={checked} disabled={savingTier} onChange={(value) => toggleDraftFeature(feature, value)} aria-label={t(FEATURES[feature].label)} />
                            </div>
                        )
                    })}
                </div>
                <Typography.Text type="secondary" className="company-plans-modal-count">
                    <CheckCircleOutlined /> {draftFeatures.length} / {FEATURE_KEYS.length} {t('premium features enabled')}
                </Typography.Text>
            </Modal>

            <Modal
                open={Boolean(editingCompany && draftCompanyPlan)}
                title={editingCompany?.name ?? t('Company plan')}
                onCancel={closeCompany}
                onOk={() => void saveCompany()}
                okText={t('Save plan')}
                okButtonProps={{ loading: savingCompany, disabled: !draftCompanyPlan }}
                cancelButtonProps={{ disabled: savingCompany }}
                closable={!savingCompany}
                maskClosable={!savingCompany}
                centered
                width={580}
                className="company-plans-modal"
                destroyOnHidden
            >
                {draftCompanyPlan && (
                    <div className="company-plans-company-editor">
                        <div className="company-plans-field">
                            <Typography.Text strong>{t('Subscription plan')}</Typography.Text>
                            <Select
                                value={draftCompanyPlan.tier}
                                disabled={savingCompany}
                                onChange={(tier: CompanyPlan['tier']) => setDraftCompanyPlan((current) => current ? { ...current, tier } : current)}
                                options={[
                                    { value: 'legacy', label: t('Legacy (all features)') },
                                    ...PLAN_TIERS.map((tier) => ({ value: tier, label: t(TIERS[tier].label) })),
                                ]}
                            />
                        </div>
                        <div className="company-plans-field">
                            <Typography.Text strong>{t('Additional features')}</Typography.Text>
                            <Typography.Text type="secondary">{t('Select optional features not already included in the assigned plan.')}</Typography.Text>
                            {draftCompanyPlan.tier === 'legacy' ? (
                                <Typography.Text type="secondary">{t('Legacy access includes all features.')}</Typography.Text>
                            ) : (
                                <div className="company-plans-addon-list">
                                    {FEATURE_KEYS.map((key) => {
                                        if (draftCompanyPlan.tier === 'legacy') return null
                                        const included = planFeatures[draftCompanyPlan.tier].includes(key)
                                        return (
                                            <Checkbox
                                                key={key}
                                                disabled={included || savingCompany}
                                                checked={included || draftCompanyPlan.addOns.includes(key)}
                                                onChange={(event) => setDraftCompanyPlan((current) => current ? {
                                                    ...current,
                                                    addOns: event.target.checked
                                                        ? [...new Set([...current.addOns, key])]
                                                        : current.addOns.filter((item) => item !== key),
                                                } : current)}
                                            >
                                                {t(FEATURES[key].label)} {included && <Typography.Text type="secondary">({t('Included')})</Typography.Text>}
                                            </Checkbox>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </Modal>
        </DashboardPage>
    )
}

export default CompanyPlansPage
