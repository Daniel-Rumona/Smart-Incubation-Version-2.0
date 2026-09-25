import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Col, Empty, Form, Grid, Input, Modal, Row, Segmented, Select, Space, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ApartmentOutlined, BankOutlined, EditOutlined, PlusOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage, tEnglish } from '@/providers/LanguageProvider'
import { getSystemSettings } from '@/services/companySettingsService'
import { listDirectorOrgUnits, saveDirectorOrgUnit } from '@/services/directorStructureService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import type { SystemSettingsRecord } from '@/types/companySettings'
import type { DirectorOrgUnit, DirectorOrgUnitStatus, DirectorOrgUnitType } from '@/types/director'
import '@/styles/dashboard.css'
import '@/styles/director.css'

type FormValues = {
  name: string
  code?: string
  managerName?: string
  managerEmail?: string
  status: DirectorOrgUnitStatus
  notes?: string
}

const statusColor = (status: DirectorOrgUnitStatus) => status === 'active' ? 'green' : 'default'

export const DirectorStructurePage = () => {
  const { message } = App.useApp()
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { user } = useFullIdentity()
  const [settings, setSettings] = useState<SystemSettingsRecord | null>(null)
  const [departments, setDepartments] = useState<DirectorOrgUnit[]>([])
  const [offices, setOffices] = useState<DirectorOrgUnit[]>([])
  const [active, setActive] = useState<DirectorOrgUnitType>('department')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | DirectorOrgUnitStatus>('all')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<DirectorOrgUnit | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm<FormValues>()

  const hasDepartments = !!settings?.hasDepartments
  const hasOffices = !!settings?.hasBranches
  const enabledTypes = useMemo<DirectorOrgUnitType[]>(() => [
    ...(hasDepartments ? ['department' as const] : []),
    ...(hasOffices ? ['office' as const] : []),
  ], [hasDepartments, hasOffices])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (!user?.companyCode) return
      setLoading(true)
      try {
        const settingsData = await getSystemSettings(user.companyCode)
        const [departmentRows, officeRows] = await Promise.all([
          listDirectorOrgUnits(user, 'department'),
          listDirectorOrgUnits(user, 'office'),
        ])
        if (!mounted) return
        setSettings(settingsData)
        setDepartments(departmentRows)
        setOffices(officeRows)
        if (!settingsData?.hasDepartments && settingsData?.hasBranches) setActive('office')
      } catch (error) {
        console.error(error)
        message.error(t('director.structure.loadError', 'Structure setup could not be loaded.'))
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void load()
    return () => {
      mounted = false
    }
  }, [message, t, user])

  const rows = active === 'department' ? departments : offices
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter(row => {
      const matchText = !term || [row.name, row.code, row.managerName, row.managerEmail].some(value => String(value || '').toLowerCase().includes(term))
      const matchStatus = status === 'all' || row.status === status
      return matchText && matchStatus
    })
  }, [rows, search, status])

  const metrics = useMemo(() => ({
    departments: departments.length,
    offices: offices.length,
    activeDepartments: departments.filter(row => row.status === 'active').length,
    activeOffices: offices.filter(row => row.status === 'active').length,
  }), [departments, offices])

  useRegisterAgentPageContext({
    pageKey: 'director-structure',
    pageName: tEnglish('director.structure.title', 'Departments and Offices'),
    purpose: 'Allows directors to set up departments and offices when enabled in company setup.',
    currentFilters: { active, search, status },
    metrics,
    dataSummary: { visibleUnits: filtered.length, enabledTypes },
  })

  const refreshType = async (type: DirectorOrgUnitType) => {
    if (!user) return
    const updated = await listDirectorOrgUnits(user, type)
    if (type === 'department') setDepartments(updated)
    else setOffices(updated)
  }

  const openModal = (row?: DirectorOrgUnit) => {
    setEditing(row || null)
    form.setFieldsValue({
      name: row?.name || '',
      code: row?.code || '',
      managerName: row?.managerName || '',
      managerEmail: row?.managerEmail || '',
      status: row?.status || 'active',
      notes: row?.notes || '',
    })
    setModalOpen(true)
  }

  const submit = async () => {
    if (!user) return
    setSaving(true)
    try {
      const values = await form.validateFields()
      await saveDirectorOrgUnit(user, active, values, editing?.id)
      message.success(t('director.structure.saved', 'Structure setup saved.'))
      setModalOpen(false)
      await refreshType(active)
    } catch (error) {
      console.error(error)
      message.error(t('director.structure.saveError', 'Structure setup could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  const unitLabel = active === 'department' ? t('director.structure.department', 'Department') : t('director.structure.office', 'Office')

  const columns: ColumnsType<DirectorOrgUnit> = [
    { title: unitLabel, dataIndex: 'name', key: 'name', render: (_, row) => <Space direction="vertical" size={0}><strong>{row.name}</strong><span className="director-muted">{row.code || t('common.noCode', 'No code')}</span></Space> },
    { title: t('director.structure.manager', 'Manager'), key: 'manager', render: (_, row) => <Space direction="vertical" size={0}><span>{row.managerName || t('common.unassigned', 'Unassigned')}</span><span className="director-muted">{row.managerEmail}</span></Space> },
    { title: t('common.status', 'Status'), dataIndex: 'status', key: 'status', width: 120, render: value => <Tag color={statusColor(value)}>{String(value).toUpperCase()}</Tag> },
    { title: '', key: 'actions', width: 100, align: 'right', render: (_, row) => <Button icon={<EditOutlined />} onClick={() => openModal(row)}>{t('common.edit', 'Edit')}</Button> },
  ]

  return (
    <DashboardPage className="director-page director-structure-page">
      <Row gutter={[12, 12]} className="dashboard-metrics-row">
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<ApartmentOutlined />} iconClassName="is-users" label={t('director.structure.departments', 'Departments')} value={metrics.departments} /></Col>
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<BankOutlined />} iconClassName="is-participants" label={t('director.structure.offices', 'Offices')} value={metrics.offices} /></Col>
        {!isMobile && <Col lg={6}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} iconClassName="is-delivery" label={t('director.structure.activeDepartments', 'Active departments')} value={metrics.activeDepartments} /></Col>}
        {!isMobile && <Col lg={6}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} iconClassName="is-attention" label={t('director.structure.activeOffices', 'Active offices')} value={metrics.activeOffices} /></Col>}
      </Row>

      {!enabledTypes.length && (
        <Alert
          type="warning"
          showIcon
          className="director-section-gap"
          message={t('director.structure.notEnabled', 'Departments and offices are not enabled for this company.')}
          description={t('director.structure.enableHint', 'Enable departments or branches/offices in Company Settings first, or submit a setup addition request.')}
          action={<Button onClick={() => navigate('/director/settings')}>{t('nav.companySettings', 'Company Settings')}</Button>}
        />
      )}

      {!!enabledTypes.length && (
        <>
          <FilterBar
            title={t('director.structure.filters', 'Structure filters')}
            primary={
              <>
                {enabledTypes.length > 1 && (
                  <Segmented<DirectorOrgUnitType>
                    block
                    value={active}
                    onChange={setActive}
                    options={[
                      { value: 'department', label: t('director.structure.departments', 'Departments'), disabled: !hasDepartments },
                      { value: 'office', label: t('director.structure.offices', 'Offices'), disabled: !hasOffices },
                    ]}
                  />
                )}
                <Input prefix={<SearchOutlined />} value={search} onChange={event => setSearch(event.target.value)} placeholder={t('director.structure.search', 'Search name, code, or manager')} allowClear />
                <Select value={status} onChange={setStatus} options={[{ value: 'all', label: t('common.all', 'All') }, { value: 'active', label: t('common.active', 'Active') }, { value: 'inactive', label: t('common.inactive', 'Inactive') }]} />
              </>
            }
            actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>{t('director.structure.add', 'Add')} {unitLabel}</Button>}
          />

          <Card className="dashboard-section-card motion-card director-section-gap">
            {filtered.length ? (
              <ResponsiveDataView
                rowKey="id"
                rows={filtered}
                columns={columns}
                emptyText={t('director.structure.empty', 'No structure records match the current filters.')}
                renderCard={row => (
                  <Space direction="vertical" className="dashboard-mobile-record">
                    <Space style={{ justifyContent: 'space-between', width: '100%' }}><strong>{row.name}</strong><Tag color={statusColor(row.status)}>{row.status.toUpperCase()}</Tag></Space>
                    <span className="director-muted">{row.code || t('common.noCode', 'No code')}</span>
                    <span>{row.managerName || t('common.unassigned', 'Unassigned')}</span>
                    <Button icon={<EditOutlined />} onClick={() => openModal(row)}>{t('common.edit', 'Edit')}</Button>
                  </Space>
                )}
              />
            ) : <Empty description={t('director.structure.empty', 'No structure records match the current filters.')} />}
          </Card>
        </>
      )}

      <Modal
        open={modalOpen}
        title={`${editing ? t('common.edit', 'Edit') : t('director.structure.add', 'Add')} ${unitLabel}`}
        okText={t('common.save', 'Save')}
        confirmLoading={saving}
        onOk={submit}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t('common.name', 'Name')} rules={[{ required: true, message: t('director.structure.nameRequired', 'Name is required.') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label={t('director.structure.code', 'Code')}>
            <Input />
          </Form.Item>
          <Form.Item name="managerName" label={t('director.structure.managerName', 'Manager name')}>
            <Input />
          </Form.Item>
          <Form.Item name="managerEmail" label={t('director.structure.managerEmail', 'Manager email')}>
            <Input type="email" />
          </Form.Item>
          <Form.Item name="status" label={t('common.status', 'Status')} rules={[{ required: true }]}>
            <Select options={[{ value: 'active', label: t('common.active', 'Active') }, { value: 'inactive', label: t('common.inactive', 'Inactive') }]} />
          </Form.Item>
          <Form.Item name="notes" label={t('director.structure.notes', 'Notes')}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </DashboardPage>
  )
}

export default DirectorStructurePage
