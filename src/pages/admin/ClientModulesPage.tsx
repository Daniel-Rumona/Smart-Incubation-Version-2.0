import { App, Col, Input, Popconfirm, Row, Select, Space, Switch, Tag, Typography, type TableProps } from 'antd'
import { AppstoreAddOutlined, BankOutlined, SearchOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { CLIENT_MODULE_KEYS, CLIENT_MODULES, type ClientModuleKey } from '@/config/clientModules'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listCompanyModules, setCompanyHomeModule, setCompanyModule, type CompanyModulesRow } from '@/services/clientModulesService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'

/** Platform admins switch client-specific modules on for the one company each was built for. */
const ClientModulesPage = () => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [rows, setRows] = useState<CompanyModulesRow[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [saving, setSaving] = useState<string | null>(null)

    useEffect(() => {
        if (!user) return
        let active = true
        void listCompanyModules(user)
            .then((result) => { if (active) setRows(result) })
            .catch(() => { if (active) message.error(t('Companies could not be loaded.')) })
            .finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [message, t, user])

    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return rows.filter((row) => !needle || `${row.name} ${row.code}`.toLowerCase().includes(needle))
    }, [rows, search])

    const enabledCount = (key: ClientModuleKey) => rows.filter((row) => row.modules[key]).length

    useRegisterAgentPageContext({
        pageKey: 'admin-client-modules',
        pageName: 'Client modules',
        purpose: 'Switch client-specific modules on for the companies they were built for. Every other company keeps them off.',
        currentFilters: { search },
        metrics: Object.fromEntries(CLIENT_MODULE_KEYS.map((key) => [key, enabledCount(key)])),
        dataSummary: { companies: rows.length },
    })

    const toggle = async (row: CompanyModulesRow, key: ClientModuleKey, enabled: boolean) => {
        if (!user) return
        const savingKey = `${row.code}:${key}`
        setSaving(savingKey)
        try {
            await setCompanyModule(user, row, key, enabled)
            setRows((current) => current.map((item) => item.code === row.code
                ? { ...item, modules: { ...item.modules, [key]: enabled }, homeModule: !enabled && item.homeModule === key ? null : item.homeModule }
                : item))
            message.success(enabled
                ? t('{module} switched on for {company}.', undefined, { module: t(CLIENT_MODULES[key].label), company: row.name })
                : t('{module} switched off for {company}.', undefined, { module: t(CLIENT_MODULES[key].label), company: row.name }))
        } catch {
            message.error(t('The module could not be changed.'))
        } finally {
            setSaving(null)
        }
    }

    const changeHome = async (row: CompanyModulesRow, key: ClientModuleKey | null) => {
        if (!user) return
        setSaving(`${row.code}:home`)
        try {
            await setCompanyHomeModule(user, row.code, key)
            setRows((current) => current.map((item) => item.code === row.code ? { ...item, homeModule: key } : item))
            message.success(t('Home page updated for {company}.', undefined, { company: row.name }))
        } catch {
            message.error(t('The home page could not be changed.'))
        } finally {
            setSaving(null)
        }
    }

    /** Staff of the company open this module instead of the standard dashboard. Only switched-on modules are offered. */
    const homeSelect = (row: CompanyModulesRow) => (
        <Select
            value={row.homeModule ?? 'standard'}
            loading={saving === `${row.code}:home`}
            style={{ minWidth: 180 }}
            onChange={(value: string) => void changeHome(row, value === 'standard' ? null : value as ClientModuleKey)}
            options={[
                { value: 'standard', label: t('Standard dashboard') },
                ...CLIENT_MODULE_KEYS.filter((key) => row.modules[key]).map((key) => ({ value: key, label: t(CLIENT_MODULES[key].label) })),
            ]}
            aria-label={t('Home page')}
        />
    )

    /** Switching on is immediate; switching off hides the module's pages from that company, so it asks first. */
    const moduleSwitch = (row: CompanyModulesRow, key: ClientModuleKey) => {
        const checked = row.modules[key]
        const busy = saving === `${row.code}:${key}`
        if (!checked) {
            return <Switch checked={false} loading={busy} onChange={() => void toggle(row, key, true)} aria-label={t(CLIENT_MODULES[key].label)} />
        }
        return (
            <Popconfirm
                title={t('Switch this module off?')}
                description={t('{company} will no longer see its pages. Its records are kept.', undefined, { company: row.name })}
                okText={t('Switch off')}
                okButtonProps={{ danger: true }}
                onConfirm={() => toggle(row, key, false)}
            >
                <Switch checked loading={busy} aria-label={t(CLIENT_MODULES[key].label)} />
            </Popconfirm>
        )
    }

    const columns: TableProps<CompanyModulesRow>['columns'] = [
        {
            title: t('Company'),
            dataIndex: 'name',
            render: (value: string, row) => <Space><Typography.Text strong>{value}</Typography.Text><Tag>{row.code}</Tag></Space>,
        },
        ...CLIENT_MODULE_KEYS.map((key) => ({
            title: t(CLIENT_MODULES[key].label),
            key,
            render: (_: unknown, row: CompanyModulesRow) => moduleSwitch(row, key),
        })),
        { title: t('Home page'), key: 'home', render: (_: unknown, row: CompanyModulesRow) => homeSelect(row) },
    ]

    return (
        <DashboardPage>
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<BankOutlined />} label={t('Companies')} value={rows.length} /></Col>
                {CLIENT_MODULE_KEYS.map((key) => (
                    <Col xs={12} lg={6} key={key}>
                        <DashboardMetricCard loading={loading} icon={<AppstoreAddOutlined />} label={t(CLIENT_MODULES[key].label)} value={enabledCount(key)} hint={t(CLIENT_MODULES[key].description)} />
                    </Col>
                ))}
            </Row>
            <FilterBar
                compact
                primary={<Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search company or code')} allowClear />}
            />
            <ResponsiveDataView
                rowKey="code"
                rows={visible}
                columns={columns}
                loading={loading}
                emptyText={t('No companies match your search.')}
                renderCard={(row) => (
                    <Space orientation="vertical" style={{ width: '100%' }}>
                        <Space><Typography.Text strong>{row.name}</Typography.Text><Tag>{row.code}</Tag></Space>
                        {CLIENT_MODULE_KEYS.map((key) => (
                            <Space key={key} style={{ justifyContent: 'space-between', width: '100%' }}>
                                <Typography.Text>{t(CLIENT_MODULES[key].label)}</Typography.Text>
                                {moduleSwitch(row, key)}
                            </Space>
                        ))}
                        <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                            <Typography.Text>{t('Home page')}</Typography.Text>
                            {homeSelect(row)}
                        </Space>
                    </Space>
                )}
            />
        </DashboardPage>
    )
}

export default ClientModulesPage
