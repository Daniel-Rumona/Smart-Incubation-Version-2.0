import { useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Descriptions, Empty, Form, Input, Modal, Segmented, Space, Tag, Typography } from 'antd'
import { CheckOutlined, CloseOutlined, PhoneOutlined, ReloadOutlined, TeamOutlined } from '@ant-design/icons'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listConnectionRequests, updateConnectionRequestStatus } from '@/services/connectionRequestService'
import type { ConnectionRequest, ConnectionRequestDeliveryMode, ConnectionRequestStatus } from '@/types/connectionRequest'
import '@/styles/dashboard.css'
import { useLanguage } from '@/providers/LanguageProvider'

const { Text } = Typography

const statusColor: Record<ConnectionRequestStatus, string> = {
  pending: 'orange',
  contacted: 'blue',
  matched: 'green',
  declined: 'red',
}

const deliveryModeLabel: Record<ConnectionRequestDeliveryMode, string> = {
  online: 'Online',
  in_person: 'In person',
  hybrid: 'Hybrid',
  no_preference: 'No preference',
}

const formatDate = (value: unknown) => {
  const date = (value as { toDate?: () => Date })?.toDate?.() ?? (value instanceof Date ? value : undefined)
  return date ? date.toLocaleString('en-ZA') : 'Just now'
}

export default function ConsultantConnectionRequestsPage() {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user } = useFullIdentity()
  const [rows, setRows] = useState<ConnectionRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'all' | ConnectionRequestStatus>('pending')
  const [selected, setSelected] = useState<ConnectionRequest>()
  const [decision, setDecision] = useState<ConnectionRequestStatus>('contacted')
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<{ reviewerNote: string }>()

  const load = async () => {
    if (!user) return
    setLoading(true)
    try {
      setRows(await listConnectionRequests(user))
    } catch {
      message.error(t('Connection requests could not be loaded.'))
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

  const filteredRows = useMemo(() => rows.filter((row) => status === 'all' || row.status === status), [rows, status])
  const metrics = useMemo(() => ({
    pending: rows.filter((row) => row.status === 'pending').length,
    contacted: rows.filter((row) => row.status === 'contacted').length,
    matched: rows.filter((row) => row.status === 'matched').length,
    total: rows.length,
  }), [rows])

  const openReview = (row: ConnectionRequest, nextDecision: ConnectionRequestStatus) => {
    setSelected(row)
    setDecision(nextDecision)
    form.setFieldsValue({ reviewerNote: '' })
  }

  const submitReview = async () => {
    if (!selected) return
    setSubmitting(true)
    try {
      const values = await form.validateFields()
      await updateConnectionRequestStatus(selected.id, decision, values.reviewerNote, user)
      message.success(`Request marked as ${decision}.`)
      setSelected(undefined)
      await load()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('The review could not be submitted.'))
    } finally {
      setSubmitting(false)
    }
  }

  const columns = [
    { title: t('SME'), dataIndex: 'smeName', render: (_: string, row: ConnectionRequest) => <Space direction="vertical" size={0}><Text strong>{row.smeName}</Text><Text type="secondary">{row.smeEmail}</Text></Space> },
    { title: t('Requested'), dataIndex: 'targetName', render: (_: string, row: ConnectionRequest) => <Space direction="vertical" size={0}><Text>{row.targetName}</Text><Tag>{row.targetType === 'agent' ? t('AI agent') : t('Consultant')}</Tag></Space> },
    { title: t('Support needed'), dataIndex: 'areaOfSupport', render: (_: string, row: ConnectionRequest) => <Space direction="vertical" size={0}><Text>{row.areaOfSupport || t('Not specified')}</Text>{row.preferredStartDate && <Text type="secondary">{t('From')} {row.preferredStartDate}</Text>}</Space> },
    { title: t('Budget'), dataIndex: 'budget', render: (value: number | undefined, row: ConnectionRequest) => value ? `${row.currency || 'ZAR'} ${value.toLocaleString()}` : t('Not specified') },
    { title: t('Received'), dataIndex: 'createdAt', render: (value: unknown) => formatDate(value) },
    { title: t('Status'), dataIndex: 'status', render: (value: ConnectionRequestStatus) => <Tag color={statusColor[value]}>{value.toUpperCase()}</Tag> },
    {
      title: '',
      key: 'actions',
      align: 'right' as const,
      render: (_: unknown, row: ConnectionRequest) => row.status === 'pending' ? (
        <Space>
          <Button size="small" type="primary" icon={<PhoneOutlined />} onClick={() => openReview(row, 'contacted')}>{t('Mark contacted')}</Button>
          <Button size="small" danger icon={<CloseOutlined />} onClick={() => openReview(row, 'declined')}>{t('Decline')}</Button>
        </Space>
      ) : row.status === 'contacted' ? (
        <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => openReview(row, 'matched')}>{t('Mark matched')}</Button>
      ) : <Text type="secondary">{t('Closed')}</Text>,
    },
  ]

  return (
    <DashboardPage>
      {loading && <LoadingOverlay tip={t('Loading connection requests')} />}

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div className="dashboard-metrics-row">
          <Card className="dashboard-section-card motion-card">
            <Segmented
              block
              value={status}
              onChange={(value) => setStatus(value as typeof status)}
              options={[
                { label: `Pending (${metrics.pending})`, value: 'pending' },
                { label: `Contacted (${metrics.contacted})`, value: 'contacted' },
                { label: `Matched (${metrics.matched})`, value: 'matched' },
                { label: `All (${metrics.total})`, value: 'all' },
              ]}
            />
          </Card>
        </div>

        <FilterBar
          title={t('SME connection requests')}
          primary={<Text type="secondary">{t('Independently registered SMEs - those who signed up outside a company\'s program link - choose consultants and agents from the marketplace here. Contact them, arrange the engagement and its funding, then mark the outcome.')}</Text>}
          actions={<Button icon={<ReloadOutlined />} onClick={() => void load()}>{t('Refresh')}</Button>}
        />

        <Card className="dashboard-section-card motion-card" title={<Space><TeamOutlined /> {t('Requests')}</Space>}>
          {filteredRows.length ? (
            <ResponsiveDataView
              rowKey="id"
              rows={filteredRows}
              columns={columns}
              emptyText={t('No connection requests found.')}
              renderCard={(row) => (
                <Space direction="vertical" className="dashboard-mobile-record">
                  <Space><Tag color={statusColor[row.status]}>{row.status.toUpperCase()}</Tag><Text>{formatDate(row.createdAt)}</Text></Space>
                  <Text strong>{row.smeName}</Text>
                  <Text type="secondary">{row.smeEmail}</Text>
                  <Text>{row.targetName} ({row.targetType === 'agent' ? t('AI agent') : t('Consultant')})</Text>
                  {row.status === 'pending' && (
                    <Space>
                      <Button size="small" type="primary" icon={<PhoneOutlined />} onClick={() => openReview(row, 'contacted')}>{t('Mark contacted')}</Button>
                      <Button size="small" danger icon={<CloseOutlined />} onClick={() => openReview(row, 'declined')}>{t('Decline')}</Button>
                    </Space>
                  )}
                </Space>
              )}
            />
          ) : <Empty description={t('No connection requests found.')} />}
        </Card>
      </Space>

      <Modal
        open={Boolean(selected)}
        title={decision === 'declined' ? t('Decline request') : `Mark as ${decision}`}
        okText={t('Save')}
        okButtonProps={{ danger: decision === 'declined' }}
        confirmLoading={submitting}
        onOk={() => void submitReview()}
        onCancel={() => setSelected(undefined)}
        destroyOnClose
      >
        {selected && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label={t('SME')}>{selected.smeName} ({selected.smeEmail})</Descriptions.Item>
              <Descriptions.Item label={t('Requested')}>{selected.targetName}</Descriptions.Item>
              {selected.areaOfSupport && <Descriptions.Item label={t('Support needed')}>{selected.areaOfSupport}</Descriptions.Item>}
              {selected.deliveryMode && <Descriptions.Item label={t('Delivery mode')}>{deliveryModeLabel[selected.deliveryMode]}</Descriptions.Item>}
              {selected.preferredStartDate && <Descriptions.Item label={t('Preferred start')}>{selected.preferredStartDate}</Descriptions.Item>}
              {selected.engagementDays && <Descriptions.Item label={t('Estimated days')}>{selected.engagementDays}</Descriptions.Item>}
              {selected.urgency && <Descriptions.Item label={t('Urgency')}>{selected.urgency.toUpperCase()}</Descriptions.Item>}
              <Descriptions.Item label={t('Budget')}>{selected.budget ? `${selected.currency || 'ZAR'} ${selected.budget.toLocaleString()}` : t('Not specified')}</Descriptions.Item>
              {selected.note && <Descriptions.Item label={t('Note')}>{selected.note}</Descriptions.Item>}
            </Descriptions>
            <Form form={form} layout="vertical">
              <Form.Item name="reviewerNote" label={t('Note (optional)')}>
                <Input.TextArea rows={3} />
              </Form.Item>
            </Form>
          </Space>
        )}
      </Modal>
    </DashboardPage>
  )
}
