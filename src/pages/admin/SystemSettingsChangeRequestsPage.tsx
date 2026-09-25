import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Descriptions, Empty, Form, Input, Modal, Segmented, Space, Tag, Typography } from 'antd'
import { CheckOutlined, CloseOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listSystemSettingsChangeRequests, reviewSystemSettingsChangeRequest } from '@/services/companySettingsService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import type { ChangeRequestStatus, InterventionDeliveryRole, SystemSettingsChangeRequest } from '@/types/companySettings'
import '@/styles/dashboard.css'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const { Text } = Typography

const statusColor = (status: ChangeRequestStatus) => status === 'approved' ? 'green' : status === 'declined' ? 'red' : 'orange'
const formatDate = (value?: Date) => value ? value.toLocaleString('en-ZA') : 'Not recorded'
const roleLabel: Record<InterventionDeliveryRole, string> = { consultant: 'Consultants', projectadmin: 'Project Admins', operations: 'Operations' }

export const SystemSettingsChangeRequestsPage = () => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user } = useFullIdentity()
  const [rows, setRows] = useState<SystemSettingsChangeRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'all' | ChangeRequestStatus>('pending')
  const [selected, setSelected] = useState<SystemSettingsChangeRequest | null>(null)
  const [decision, setDecision] = useState<'approved' | 'declined'>('approved')
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<{ adminResponse: string }>()

  const load = async () => {
    if (!user) return
    setLoading(true)
    try {
      setRows(await listSystemSettingsChangeRequests(user))
    } catch (error) {
      console.error(error)
      message.error(t('Change requests could not be loaded.'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid])

  const filteredRows = useMemo(() => rows.filter(row => status === 'all' || row.status === status), [rows, status])
  const metrics = useMemo(() => ({
    pending: rows.filter(row => row.status === 'pending').length,
    approved: rows.filter(row => row.status === 'approved').length,
    declined: rows.filter(row => row.status === 'declined').length,
    total: rows.length,
  }), [rows])

  useRegisterAgentPageContext({
    pageKey: 'admin-company-change-requests',
    pageName: 'Company Setup Change Requests',
    purpose: 'Lets platform admins approve or decline director requests to change locked company setup.',
    currentFilters: { status },
    metrics,
    dataSummary: { visibleRequests: filteredRows.length },
  })

  const openReview = (record: SystemSettingsChangeRequest, nextDecision: 'approved' | 'declined') => {
    setSelected(record)
    setDecision(nextDecision)
    form.setFieldsValue({ adminResponse: nextDecision === 'approved' ? 'Your requested company setup change has been approved.' : 'Your requested company setup change has been declined.' })
  }

  const submitReview = async () => {
    if (!selected) return
    setSubmitting(true)
    try {
      const values = await form.validateFields()
      await reviewSystemSettingsChangeRequest(selected.id, decision, values.adminResponse)
      message.success(`Request ${decision}.`)
      setSelected(null)
      await load()
    } catch (error) {
      console.error(error)
      message.error(t('The review could not be submitted.'))
    } finally {
      setSubmitting(false)
    }
  }

  const columns = [
    { title: t('Company'), dataIndex: 'companyName', render: (_: string, row: SystemSettingsChangeRequest) => <Space direction="vertical" size={0}><Text strong>{row.companyName || row.companyCode}</Text><Text type="secondary">{row.companyCode}</Text></Space> },
    { title: t('Requested by'), dataIndex: 'requestedByEmail' },
    { title: t('Requested'), dataIndex: 'requestedAt', render: (value?: Date) => formatDate(value) },
    { title: t('Status'), dataIndex: 'status', render: (value: ChangeRequestStatus) => <Tag color={statusColor(value)}>{value.toUpperCase()}</Tag> },
    { title: t('Request'), dataIndex: 'reason', render: (value: string) => <Text>{value}</Text> },
    {
      title: '',
      key: 'actions',
      align: 'right' as const,
      render: (_: unknown, row: SystemSettingsChangeRequest) => row.status === 'pending' ? (
        <Space>
          <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => openReview(row, 'approved')}>{t('Accept')}</Button>
          <Button size="small" danger icon={<CloseOutlined />} onClick={() => openReview(row, 'declined')}>{t('Decline')}</Button>
        </Space>
      ) : <Text type="secondary">{t('Reviewed')}</Text>,
    },
  ]

  return (
    <DashboardPage>
      {loading && <LoadingOverlay tip={t('Loading change requests')} />}

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div className="dashboard-metrics-row">
          <Card className="dashboard-section-card motion-card">
            <Segmented
              block
              value={status}
              onChange={value => setStatus(value as typeof status)}
              options={[
                { label: `Pending (${metrics.pending})`, value: 'pending' },
                { label: `Approved (${metrics.approved})`, value: 'approved' },
                { label: `Declined (${metrics.declined})`, value: 'declined' },
                { label: `All (${metrics.total})`, value: 'all' },
              ]}
            />
          </Card>
        </div>

        <FilterBar
          title={t('Request queue')}
          primary={<Alert type="info" showIcon message={t('Accepting or declining sends the requester an email and updates their request history.')} />}
          actions={<Button icon={<ReloadOutlined />} onClick={() => void load()}>{t('Refresh')}</Button>}
        />

        <Card className="dashboard-section-card motion-card" title={<Space><SettingOutlined /> {t('Company Setup Requests')}</Space>}>
          {filteredRows.length ? (
            <ResponsiveDataView
              rowKey="id"
              rows={filteredRows}
              columns={columns}
              emptyText={t('No company setup change requests found.')}
              renderCard={row => (
                <Space direction="vertical" className="dashboard-mobile-record">
                  <Space><Tag color={statusColor(row.status)}>{row.status.toUpperCase()}</Tag><Text>{formatDate(row.requestedAt)}</Text></Space>
                  <Text strong>{row.companyName || row.companyCode}</Text>
                  <Text type="secondary">{row.requestedByEmail}</Text>
                  <Text>{row.reason}</Text>
                  {row.status === 'pending' && (
                    <Space>
                      <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => openReview(row, 'approved')}>{t('Accept')}</Button>
                      <Button size="small" danger icon={<CloseOutlined />} onClick={() => openReview(row, 'declined')}>{t('Decline')}</Button>
                    </Space>
                  )}
                </Space>
              )}
            />
          ) : <Empty description={t('No company setup change requests found.')} />}
        </Card>
      </Space>

      <Modal
        open={!!selected}
        title={decision === 'approved' ? t('Accept Change Request') : t('Decline Change Request')}
        okText={decision === 'approved' ? t('Accept & Email') : t('Decline & Email')}
        okButtonProps={{ danger: decision === 'declined' }}
        confirmLoading={submitting}
        onOk={submitReview}
        onCancel={() => setSelected(null)}
        destroyOnClose
      >
        {selected && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label={t('Company')}>{selected.companyName || selected.companyCode}</Descriptions.Item>
              <Descriptions.Item label={t('Requester')}>{selected.requestedByEmail}</Descriptions.Item>
              <Descriptions.Item label={t('Request')}>{selected.reason}</Descriptions.Item>
              {selected.requestedInterventionDeliveryRoles?.length && <Descriptions.Item label={t('Intervention delivery roles')}><Space wrap>{selected.requestedInterventionDeliveryRoles.map(role => <Tag key={role}>{roleLabel[role]}</Tag>)}</Space></Descriptions.Item>}
            </Descriptions>
            <Form form={form} layout="vertical">
              <Form.Item
                name="adminResponse"
                label={t('Response to requester')}
                rules={[{ required: true, message: tr('Add a response for the requester.') }]}
              >
                <Input.TextArea rows={4} />
              </Form.Item>
            </Form>
          </Space>
        )}
      </Modal>
    </DashboardPage>
  )
}

export default SystemSettingsChangeRequestsPage
