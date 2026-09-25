import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Checkbox, Col, Descriptions, Empty, Form, Input, Modal, Row, Segmented, Space, Tag, Typography } from 'antd'
import { ApartmentOutlined, ExclamationCircleOutlined, MailOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons'
import DashboardPage from '@/components/shared/DashboardPage'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { getSystemSettings, listMySystemSettingsChangeRequests, submitSystemSettingsChangeRequest } from '@/services/companySettingsService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { DEFAULT_INTERVENTION_DELIVERY_ROLES, type InterventionDeliveryRole, type SystemSettingsChangeRequest, type SystemSettingsRecord } from '@/types/companySettings'
import '@/styles/dashboard.css'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const { Text } = Typography

type SectionKey = 'account' | 'company' | 'requests'

const statusColor = (status: string) => status === 'approved' ? 'green' : status === 'declined' ? 'red' : 'orange'

const prettyAssignment = (value?: string) => {
  if (value === 'ops_assign_consultant') return 'Ops assigns consultants'
  if (value === 'consultant_self_assign') return 'Consultants self-assign'
  return 'Not configured'
}

const prettyDivision = (value?: string) => {
  if (value === 'system_equal_random') return 'System divides SMEs equally'
  if (value === 'ops_assign_smes_to_consultants') return 'Ops assigns SMEs to consultants'
  if (value === 'consultants_register_their_smes') return 'Consultants manage SMEs they register'
  return 'Not configured'
}

const formatDate = (value?: Date) => value ? value.toLocaleString('en-ZA') : 'Not recorded'
const deliveryRoleLabels: Record<InterventionDeliveryRole, string> = {
  consultant: 'Consultants',
  projectadmin: 'Project Admins',
  operations: 'Operations',
}

export const CompanySettingsPage = () => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user } = useFullIdentity()
  const [active, setActive] = useState<SectionKey>('account')
  const [settings, setSettings] = useState<SystemSettingsRecord | null>(null)
  const [requests, setRequests] = useState<SystemSettingsChangeRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<{ reason: string; interventionDeliveryRoles: InterventionDeliveryRole[] }>()

  const canRequestChange = user?.role === 'director' || user?.role === 'admin' || user?.role === 'systemadmin'

  const load = async () => {
    if (!user) return
    setLoading(true)
    try {
      const [settingsData, requestData] = await Promise.all([
        user.companyCode ? getSystemSettings(user.companyCode) : Promise.resolve(null),
        listMySystemSettingsChangeRequests(user),
      ])
      setSettings(settingsData)
      setRequests(requestData)
    } catch (error) {
      console.error(error)
      message.error(t('Settings could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, user?.companyCode])

  useRegisterAgentPageContext({
    pageKey: 'company-settings',
    pageName: 'Settings',
    purpose: 'Shows account and company setup details and allows directors to request locked setup changes.',
    currentFilters: { section: active },
    metrics: { changeRequests: requests.length, pending: requests.filter(request => request.status === 'pending').length },
  })

  const companyName = useMemo(() => settings?.companyName || user?.companyCode || 'Workspace', [settings?.companyName, user?.companyCode])
  const requestChangeLabel = settings ? 'Request Change' : 'Request Setup Addition'

  const submitRequest = async () => {
    if (!user) return
    setSubmitting(true)
    try {
      const values = await form.validateFields()
      await submitSystemSettingsChangeRequest(user, settings, values.reason, values.interventionDeliveryRoles)
      message.success(settings ? t('Change request sent to the admin account.') : t('Setup addition request sent to the admin account.'))
      setRequestOpen(false)
      form.resetFields()
      await load()
    } catch (error) {
      console.error(error)
      message.error(t('The change request could not be submitted.'))
    } finally {
      setSubmitting(false)
    }
  }

  const requestColumns = [
    { title: t('Requested'), dataIndex: 'requestedAt', render: (value?: Date) => formatDate(value) },
    { title: t('Status'), dataIndex: 'status', render: (value: string) => <Tag color={statusColor(value)}>{value.toUpperCase()}</Tag> },
    { title: t('Request'), dataIndex: 'reason', render: (value: string) => <Text>{value}</Text> },
    { title: t('Response'), dataIndex: 'adminResponse', render: (value: string) => value || <Text type="secondary">{t('Awaiting response')}</Text> },
  ]

  return (
    <DashboardPage>
      {loading && <LoadingOverlay tip={t('Loading settings')} />}

      <Card className="dashboard-section-card motion-card" style={{ marginBottom: 16 }}>
        <Segmented<SectionKey>
          block
          value={active}
          onChange={setActive}
          options={[
            { label: t('Account'), value: 'account', icon: <UserOutlined /> },
            { label: t('Company Setup'), value: 'company', icon: <SettingOutlined /> },
            { label: t('Change Requests'), value: 'requests', icon: <ExclamationCircleOutlined /> },
          ]}
        />
      </Card>

      {active === 'account' && (
        <Card className="dashboard-section-card motion-card" title={<Space><UserOutlined /> {t('Account')}</Space>}>
          <Descriptions bordered column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label={t('Name')}>{user?.displayName || user?.name || t('Not recorded')}</Descriptions.Item>
            <Descriptions.Item label={t('Email')}>{user?.email || t('Not recorded')}</Descriptions.Item>
            <Descriptions.Item label={t('Role')}><Tag>{String(user?.role || '').toUpperCase()}</Tag></Descriptions.Item>
            <Descriptions.Item label={t('Company')}>{companyName}</Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {active === 'company' && (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={16}>
            <Card className="dashboard-section-card motion-card" title={<Space><ApartmentOutlined /> {t('Company Setup')}</Space>}>
              {!settings ? (
                <Alert type="warning" showIcon message={t('No company setup record was found for this workspace.')} />
              ) : (
                <Descriptions bordered column={1}>
                  <Descriptions.Item label={t('Company Name')}>{settings.companyName || t('Not recorded')}</Descriptions.Item>
                  <Descriptions.Item label={t('Company Code')}>{settings.companyCode || user?.companyCode || t('Not recorded')}</Descriptions.Item>
                  <Descriptions.Item label={t('Consultant Label')}>{settings.consultantLabel || t('Consultants')}</Descriptions.Item>
                  <Descriptions.Item label={t('Departments')}>{settings.hasDepartments ? t('Yes') : t('No')}</Descriptions.Item>
                  <Descriptions.Item label={t('Branches / Offices')}>{settings.hasBranches ? t('Yes') : t('No')}</Descriptions.Item>
                  <Descriptions.Item label={t('Branch-scoped Management')}>{settings.branchScopedManagement ? t('Yes') : t('No')}</Descriptions.Item>
                  <Descriptions.Item label={t('Intervention Assignment')}>{prettyAssignment(settings.assignmentModel)}</Descriptions.Item>
                  <Descriptions.Item label={t('Intervention Delivery Roles')}>
                    <Space wrap>{(settings.interventionDeliveryRoles?.length ? settings.interventionDeliveryRoles : DEFAULT_INTERVENTION_DELIVERY_ROLES).map(role => <Tag key={role}>{deliveryRoleLabels[role]}</Tag>)}</Space>
                  </Descriptions.Item>
                  <Descriptions.Item label={t('SME Division')}>{prettyDivision(settings.smeDivisionModel)}</Descriptions.Item>
                  <Descriptions.Item label={t('Owner')}>{settings.ownerEmail || settings.createdByEmail || t('Not recorded')}</Descriptions.Item>
                  <Descriptions.Item label={t('Status')}>{settings.locked ? <Tag color="orange">{t('LOCKED')}</Tag> : <Tag color="green">{t('EDITABLE')}</Tag>}</Descriptions.Item>
                </Descriptions>
              )}
            </Card>
          </Col>

          <Col xs={24} xl={8}>
            <Card className="dashboard-section-card motion-card" title={t('Actions')}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Alert
                  type="info"
                  showIcon
                  message={settings ? t('Company setup changes are reviewed by the platform admin.') : t('Company setup additions are reviewed by the platform admin.')}
                />
                <Button
                  type="primary"
                  icon={<MailOutlined />}
                  block
                  disabled={!canRequestChange}
                  onClick={() => {
                    form.resetFields()
                    form.setFieldValue('interventionDeliveryRoles', settings?.interventionDeliveryRoles?.length ? settings.interventionDeliveryRoles : DEFAULT_INTERVENTION_DELIVERY_ROLES)
                    setRequestOpen(true)
                  }}
                >
                  {requestChangeLabel}
                </Button>
              </Space>
            </Card>
          </Col>
        </Row>
      )}

      {active === 'requests' && (
        <Card className="dashboard-section-card motion-card" title={<Space><ExclamationCircleOutlined /> {t('My Change Requests')}</Space>}>
          {requests.length ? (
            <ResponsiveDataView
              rowKey="id"
              columns={requestColumns}
              rows={requests}
              emptyText={t('No change requests have been submitted.')}
              renderCard={request => (
                <Space direction="vertical" className="dashboard-mobile-record">
                  <Space><Tag color={statusColor(request.status)}>{request.status.toUpperCase()}</Tag><Text>{formatDate(request.requestedAt)}</Text></Space>
                  <Text>{request.reason}</Text>
                  <Text type="secondary">{request.adminResponse || t('Awaiting response')}</Text>
                </Space>
              )}
            />
          ) : <Empty description={t('No change requests have been submitted.')} />}
        </Card>
      )}

      <Modal
        open={requestOpen}
        title={settings ? t('Request Company Setup Change') : t('Request Company Setup Addition')}
        okText={t('Submit Request')}
        confirmLoading={submitting}
        onOk={submitRequest}
        onCancel={() => setRequestOpen(false)}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          message={t('Send enough detail for review.')}
          description={settings
            ? t('The request will be sent to daniel@quantilytix.co.za and the response will appear in your request history.')
            : t('The setup addition request will be sent to daniel@quantilytix.co.za and the response will appear in your request history.')}
          style={{ marginBottom: 12 }}
        />
        <Form form={form} layout="vertical">
          <Form.Item
            name="interventionDeliveryRoles"
            label={t('Roles allowed to deliver interventions')}
            rules={[{ required: true, type: 'array', min: 1, message: tr('Choose at least one delivery role.') }]}
          >
            <Checkbox.Group>
              <Space direction="vertical">
                {DEFAULT_INTERVENTION_DELIVERY_ROLES.map(role => <Checkbox key={role} value={role}>{deliveryRoleLabels[role]}</Checkbox>)}
              </Space>
            </Checkbox.Group>
          </Form.Item>
          <Form.Item
            name="reason"
            label={settings ? t('Requested change') : t('Requested setup addition')}
            rules={[
              { required: true, message: tr('Describe the change you need.') },
              { min: 10, message: tr('Please add a bit more detail.') },
            ]}
          >
            <Input.TextArea rows={5} placeholder={settings ? t('Example: We now have two regional offices and need branch-scoped consultant management enabled.') : t('Example: Please add our company setup with departments enabled and operations assigning SMEs to consultants.')} />
          </Form.Item>
        </Form>
      </Modal>
    </DashboardPage>
  )
}

export default CompanySettingsPage
