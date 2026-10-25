import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { App, Button, Card, Checkbox, Col, Input, Row, Select, Space, Switch, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CrownOutlined, InfoCircleOutlined, RocketOutlined, SaveOutlined, SearchOutlined, StarOutlined, UndoOutlined } from '@ant-design/icons'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { PageLoadingBar } from '@/components/shared/PageSkeleton'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { DEFAULT_PLAN_FEATURES, FEATURES, FEATURE_KEYS, PLAN_TIERS, TIERS, resolveEntitlements, type FeatureKey, type PlanFeatures, type PlanTier } from '@/config/entitlements'
import { listWorkspaceCompanies, type WorkspaceCompany } from '@/services/companiesService'
import { getCompanyPlan, getPlanFeatures, saveCompanyPlan, savePlanFeatures, type CompanyPlan } from '@/services/companyPlanService'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/admin-dashboard.css'
import '@/styles/company-plans.css'

type Row = WorkspaceCompany & { plan: CompanyPlan; saved: CompanyPlan }

const TIER_ICONS: Record<PlanTier, ReactNode> = { basic: <StarOutlined />, standard: <RocketOutlined />, premium: <CrownOutlined /> }

const same = (left: CompanyPlan, right: CompanyPlan) =>
  left.tier === right.tier && [...left.addOns].sort().join('|') === [...right.addOns].sort().join('|')
const sameFeatures = (left: FeatureKey[], right: FeatureKey[]) => [...left].sort().join('|') === [...right].sort().join('|')

export const CompanyPlansPage = () => {
  const { t } = useLanguage()
  const { message, modal } = App.useApp()
  const { user } = useFullIdentity()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [savingCode, setSavingCode] = useState<string>()
  const [planFeatures, setPlanFeatures] = useState<PlanFeatures>(DEFAULT_PLAN_FEATURES)
  const [savedPlanFeatures, setSavedPlanFeatures] = useState<PlanFeatures>(DEFAULT_PLAN_FEATURES)
  const [savingPlans, setSavingPlans] = useState(false)
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState<'all' | PlanTier | 'legacy'>('all')

  useEffect(() => {
    if (!user) return
    let active = true
    void (async () => {
      try {
        const [companies, features] = await Promise.all([listWorkspaceCompanies(user), getPlanFeatures().catch(() => DEFAULT_PLAN_FEATURES)])
        const plans = await Promise.all(companies.map((company) => getCompanyPlan(company.code).catch((): CompanyPlan => ({ tier: 'legacy', addOns: [] }))))
        if (!active) return
        setRows(companies.map((company, index) => ({ ...company, plan: plans[index], saved: plans[index] })))
        setPlanFeatures(features)
        setSavedPlanFeatures(features)
      } catch {
        message.error(t('Companies could not be loaded.'))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [message, t, user])

  const update = (code: string, patch: Partial<CompanyPlan>) =>
    setRows((current) => current.map((row) => (row.code === code ? { ...row, plan: { ...row.plan, ...patch } } : row)))

  const save = async (row: Row) => {
    if (!user) return
    try {
      setSavingCode(row.code)
      await saveCompanyPlan(user, row.code, row.plan)
      setRows((current) => current.map((item) => (item.code === row.code ? { ...item, saved: item.plan } : item)))
      message.success(t('Plan saved.'))
    } catch {
      message.error(t('The plan could not be saved.'))
    } finally {
      setSavingCode(undefined)
    }
  }

  const toggleFeature = (tier: PlanTier, feature: FeatureKey, on: boolean) =>
    setPlanFeatures((current) => ({ ...current, [tier]: on ? [...new Set([...current[tier], feature])] : current[tier].filter((item) => item !== feature) }))

  const companiesOn = (tier: PlanTier) => rows.filter((row) => row.saved.tier === tier)
  const plansChanged = PLAN_TIERS.some((tier) => !sameFeatures(planFeatures[tier], savedPlanFeatures[tier]))

  const savePlans = () => {
    if (!user) return
    // Removing a feature switches it off for every company on that plan (unless they have it as an add-on), so say who.
    const removals = PLAN_TIERS.flatMap((tier) => savedPlanFeatures[tier]
      .filter((feature) => !planFeatures[tier].includes(feature))
      .map((feature) => ({ tier, feature, affected: companiesOn(tier).filter((row) => !row.saved.addOns.includes(feature)).length })))
      .filter((item) => item.affected)
    const run = async () => {
      try {
        setSavingPlans(true)
        await savePlanFeatures(user, planFeatures)
        setSavedPlanFeatures(planFeatures)
        message.success(t('Plan contents saved.'))
      } catch {
        message.error(t('The plan contents could not be saved.'))
      } finally {
        setSavingPlans(false)
      }
    }
    if (!removals.length) return void run()
    modal.confirm({
      title: t('Switch features off for these companies?'),
      content: (
        <ul className="company-plans-removals">
          {removals.map((item) => <li key={`${item.tier}-${item.feature}`}>{t('{feature} goes off for {count} companies on {plan}.', undefined, { feature: t(FEATURES[item.feature].label), count: item.affected, plan: t(TIERS[item.tier].label) })}</li>)}
        </ul>
      ),
      okText: t('Save plan contents'),
      onOk: run,
    })
  }

  const term = search.trim().toLowerCase()
  const visibleRows = useMemo(() => rows.filter((row) => (tierFilter === 'all' || row.saved.tier === tierFilter)
    && (!term || `${row.name} ${row.code}`.toLowerCase().includes(term))), [rows, term, tierFilter])

  const columns: ColumnsType<Row> = [
    { title: t('Company'), dataIndex: 'name', render: (_, row) => <Space direction="vertical" size={0}><Typography.Text strong>{row.name}</Typography.Text><Typography.Text type="secondary">{row.code}</Typography.Text></Space> },
    {
      title: t('Plan'),
      render: (_, row) => (
        <Select
          style={{ minWidth: 190 }}
          value={row.plan.tier}
          onChange={(tier) => update(row.code, { tier })}
          options={[
            { value: 'legacy', label: t('Legacy (all features)') },
            ...PLAN_TIERS.map((tier) => ({ value: tier, label: t(TIERS[tier].label) })),
          ]}
        />
      ),
    },
    {
      title: t('Add-ons'),
      render: (_, row) => (
        <Checkbox.Group
          disabled={row.plan.tier === 'legacy'}
          value={row.plan.addOns}
          onChange={(values) => update(row.code, { addOns: values as FeatureKey[] })}
          // A feature the plan already includes needs no add-on.
          options={FEATURE_KEYS.map((key) => ({ value: key, label: t(FEATURES[key].label), disabled: row.plan.tier !== 'legacy' && planFeatures[row.plan.tier].includes(key) }))}
        />
      ),
    },
    {
      title: t('Includes'),
      render: (_, row) => {
        const resolved = resolveEntitlements(row.plan.tier === 'legacy' ? null : { tier: row.plan.tier, addOns: row.plan.addOns }, planFeatures)
        const on = FEATURE_KEYS.filter((key) => resolved.features[key])
        return <Space wrap size={[6, 6]}>{on.map((key) => <span key={key} className="admin-role-tag">{t(FEATURES[key].label)}</span>)}{!on.length && <span className="company-plans-none">{t('No premium features')}</span>}</Space>
      },
    },
    {
      title: '',
      render: (_, row) => <Button type="primary" shape="round" icon={<SaveOutlined />} disabled={same(row.plan, row.saved)} loading={savingCode === row.code} onClick={() => void save(row)}>{t('Save')}</Button>,
    },
  ]

  return (
    <DashboardPage className="company-plans-page admin-overview">
      <PageLoadingBar active={Boolean(loading)} label={t('Loading companies')} />

      <div className="company-plans-section-head">
        <div>
          <h2>{t('Plans')}</h2>
          <span>{t('What each plan includes. Changes apply to every company on that plan within a minute.')}</span>
        </div>
        <Space wrap>
          {plansChanged && <Button shape="round" icon={<UndoOutlined />} onClick={() => setPlanFeatures(savedPlanFeatures)}>{t('Undo changes')}</Button>}
          <Button type="primary" shape="round" icon={<SaveOutlined />} disabled={!plansChanged} loading={savingPlans} onClick={savePlans}>{t('Save plan contents')}</Button>
        </Space>
      </div>
      <Row gutter={[16, 16]}>
        {PLAN_TIERS.map((tier) => {
          const changed = !sameFeatures(planFeatures[tier], savedPlanFeatures[tier])
          return (
            <Col key={tier} xs={24} md={8}>
              <Card className={`admin-card company-plan-card is-${tier}${changed ? ' is-changed' : ''}`} bordered={false} loading={loading}>
                <div className="company-plan-head">
                  <span className="admin-kpi-icon">{TIER_ICONS[tier]}</span>
                  <div>
                    <h3>{t(TIERS[tier].label)}</h3>
                    <span>{t('{count} companies', undefined, { count: companiesOn(tier).length })}</span>
                  </div>
                  {changed && <span className="company-plan-changed">{t('Unsaved')}</span>}
                </div>
                <ul className="company-plan-features">
                  {FEATURE_KEYS.map((feature) => {
                    const on = planFeatures[tier].includes(feature)
                    return (
                      <li key={feature} className={on ? 'is-on' : undefined}>
                        <div>
                          <strong>{t(FEATURES[feature].label)}</strong>
                          <small>{t(FEATURES[feature].description)}</small>
                        </div>
                        <Switch checked={on} onChange={(checked) => toggleFeature(tier, feature, checked)} aria-label={t(FEATURES[feature].label)} />
                      </li>
                    )
                  })}
                </ul>
                <p className="company-plan-summary">{planFeatures[tier].length
                  ? t('{count} of {total} premium features', undefined, { count: planFeatures[tier].length, total: FEATURE_KEYS.length })
                  : t('Core platform only')}</p>
              </Card>
            </Col>
          )
        })}
      </Row>
      <p className="company-plans-note"><InfoCircleOutlined /> {t('Legacy companies (no plan recorded) keep every feature. New self-registered companies start on Basic. A new feature needs code before it can be added to a plan.')}</p>

      <Card className="admin-card company-plans-companies" bordered={false}>
        <FilterBar
          primary={<Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search companies')} allowClear />}
          actions={<Select value={tierFilter} onChange={setTierFilter} style={{ minWidth: 170 }} options={[{ value: 'all', label: t('All plans') }, { value: 'legacy', label: t('Legacy (all features)') }, ...PLAN_TIERS.map((tier) => ({ value: tier, label: t(TIERS[tier].label) }))]} />}
        />
        <Table rowKey="code" columns={columns} dataSource={visibleRows} loading={loading} pagination={false} scroll={{ x: 900 }} />
      </Card>
    </DashboardPage>
  )
}

export default CompanyPlansPage
