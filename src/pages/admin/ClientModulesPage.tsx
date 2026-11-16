import { App, Col, Input, Popconfirm, Row, Select, Space, Switch, Tag, Typography, type TableProps } from 'antd'
import { AppstoreAddOutlined, BankOutlined, ReadOutlined, SearchOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { CLIENT_MODULES, WORKSPACE_ADD_ONS, WORKSPACE_TYPES, type ClientModuleKey, type WorkspaceType } from '@/config/clientModules'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listCompanyModules, setCompanyModule, setCompanyWorkspaceType, type CompanyModulesRow } from '@/services/clientModulesService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'

/** Add-on columns, in order: ESG reporting on either type, training inside an incubation workspace. */
const ADD_ON_COLUMNS: ClientModuleKey[] = ['esgReporting', 'awarenessTraining']
const ADD_ON_LABELS: Record<ClientModuleKey, string> = { esgReporting: 'ESG reporting', awarenessTraining: 'Training add-on' }

/**
 * Platform admins set each company's workspace type (Incubation or Training) and switch add-ons on: ESG reporting
 * for either type, and training inside an incubation workspace. Every other company keeps the add-ons off.
 */
const ClientModulesPage = () => {
    const { t } = useLanguage()
    const { message, modal } = App.useApp()
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

    const counts = useMemo(() => ({
        training: rows.filter((row) => row.workspaceType === 'training').length,
        esg: rows.filter((row) => row.modules.esgReporting).length,
        trainingAddOn: rows.filter((row) => row.workspaceType === 'incubation' && row.modules.awarenessTraining).length,
    }), [rows])

    useRegisterAgentPageContext({
        pageKey: 'admin-client-modules',
        pageName: 'Workspace types and add-ons',
        purpose: 'Set each company\'s workspace type (Incubation or Training) and switch add-ons on for the companies they were built for: ESG reporting on either type, and training inside an incubation workspace. Every other company keeps them off.',
        currentFilters: { search },
        metrics: { trainingWorkspaces: counts.training, esgReportingAddOn: counts.esg, trainingAddOnInIncubators: counts.trainingAddOn },
        dataSummary: { companies: rows.length },
    })

    const toggle = async (row: CompanyModulesRow, key: ClientModuleKey, enabled: boolean) => {
        if (!user) return
        setSaving(`${row.code}:${key}`)
        try {
            await setCompanyModule(user, row, key, enabled)
            setRows((current) => current.map((item) => {
                if (item.code !== row.code) return item
                const homeModule = !enabled && item.homeModule === key ? null : item.homeModule
                return { ...item, modules: { ...item.modules, [key]: enabled }, homeModule, workspaceType: homeModule === 'awarenessTraining' ? 'training' : 'incubation' }
            }))
            message.success(enabled
                ? t('{module} switched on for {company}.', undefined, { module: t(ADD_ON_LABELS[key]), company: row.name })
                : t('{module} switched off for {company}.', undefined, { module: t(ADD_ON_LABELS[key]), company: row.name }))
        } catch {
            message.error(t('The add-on could not be changed.'))
        } finally {
            setSaving(null)
        }
    }

    const saveType = async (row: CompanyModulesRow, type: WorkspaceType) => {
        if (!user) return
        setSaving(`${row.code}:type`)
        try {
            await setCompanyWorkspaceType(user, row.code, type)
            setRows((current) => current.map((item) => item.code !== row.code ? item : type === 'training'
                ? { ...item, workspaceType: type, homeModule: 'awarenessTraining', modules: { ...item.modules, awarenessTraining: true } }
                : { ...item, workspaceType: type, homeModule: null }))
            message.success(t('{company} is now a {type} workspace.', undefined, { company: row.name, type: t(type === 'training' ? 'Training' : 'Incubation') }))
        } catch {
            message.error(t('The workspace type could not be changed.'))
        } finally {
            setSaving(null)
        }
    }

    /** Changing the type changes what the company's staff see, so it asks first. */
    const changeType = (row: CompanyModulesRow, type: WorkspaceType) => {
        if (type === row.workspaceType) return
        modal.confirm({
            title: type === 'training'
                ? t('Make {company} a Training workspace?', undefined, { company: row.name })
                : t('Make {company} an Incubation workspace?', undefined, { company: row.name }),
            content: type === 'training'
                ? t('Its staff open the training home. SMEs, interventions, diagnostics and the other incubation pages leave their menu. Their records are kept, and you can switch back.')
                : t('Its staff open the standard dashboard again. Training stays on as an add-on until you switch it off.'),
            okText: t('Change type'),
            onOk: () => saveType(row, type),
        })
    }

    const typeSelect = (row: CompanyModulesRow) => (
        <Select<WorkspaceType>
            value={row.workspaceType}
            loading={saving === `${row.code}:type`}
            style={{ minWidth: 150 }}
            onChange={(value) => changeType(row, value)}
            options={WORKSPACE_TYPES.map((type) => ({ value: type.key, label: t(type.label), title: t(type.description) }))}
            aria-label={t('Workspace type')}
        />
    )

    /** Switching on is immediate; switching off hides the add-on's pages from that company, so it asks first. */
    const addOnSwitch = (row: CompanyModulesRow, key: ClientModuleKey) => {
        if (!WORKSPACE_ADD_ONS[row.workspaceType].includes(key)) return <Tag color="blue">{t('Included')}</Tag>
        const checked = row.modules[key]
        const busy = saving === `${row.code}:${key}`
        if (!checked) {
            return <Switch checked={false} loading={busy} onChange={() => void toggle(row, key, true)} aria-label={t(ADD_ON_LABELS[key])} />
        }
        return (
            <Popconfirm
                title={t('Switch this add-on off?')}
                description={t('{company} will no longer see its pages. Its records are kept.', undefined, { company: row.name })}
                okText={t('Switch off')}
                okButtonProps={{ danger: true }}
                onConfirm={() => toggle(row, key, false)}
            >
                <Switch checked loading={busy} aria-label={t(ADD_ON_LABELS[key])} />
            </Popconfirm>
        )
    }

    const columns: TableProps<CompanyModulesRow>['columns'] = [
        {
            title: t('Company'),
            dataIndex: 'name',
            render: (value: string, row) => <Space><Typography.Text strong>{value}</Typography.Text><Tag>{row.code}</Tag></Space>,
        },
        { title: t('Workspace type'), key: 'type', render: (_: unknown, row: CompanyModulesRow) => typeSelect(row) },
        ...ADD_ON_COLUMNS.map((key) => ({
            title: t(ADD_ON_LABELS[key]),
            key,
            render: (_: unknown, row: CompanyModulesRow) => addOnSwitch(row, key),
        })),
    ]

    return (
        <DashboardPage>
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<BankOutlined />} label={t('Companies')} value={rows.length} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<ReadOutlined />} label={t('Training workspaces')} value={counts.training} hint={t(WORKSPACE_TYPES[1].description)} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<AppstoreAddOutlined />} label={t('ESG reporting add-on')} value={counts.esg} hint={t(CLIENT_MODULES.esgReporting.description)} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<AppstoreAddOutlined />} label={t('Training add-on')} value={counts.trainingAddOn} hint={t('Training classes inside an incubation workspace, next to its programmes.')} /></Col>
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
                        <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                            <Typography.Text>{t('Workspace type')}</Typography.Text>
                            {typeSelect(row)}
                        </Space>
                        {ADD_ON_COLUMNS.map((key) => (
                            <Space key={key} style={{ justifyContent: 'space-between', width: '100%' }}>
                                <Typography.Text>{t(ADD_ON_LABELS[key])}</Typography.Text>
                                {addOnSwitch(row, key)}
                            </Space>
                        ))}
                    </Space>
                )}
            />
        </DashboardPage>
    )
}

export default ClientModulesPage
