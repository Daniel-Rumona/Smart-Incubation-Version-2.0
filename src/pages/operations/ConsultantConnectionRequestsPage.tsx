import { useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Descriptions, Empty, Form, Input, Modal, Segmented, Select, Space, Tag, Typography } from 'antd'
import { CheckOutlined, CloseOutlined, PhoneOutlined, ReloadOutlined, SendOutlined, TeamOutlined } from '@ant-design/icons'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { PageLoadingBar } from '@/components/shared/PageSkeleton'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { forwardConnectionRequest, listConnectionRequests, listForwardingStaff, updateConnectionRequestStatus } from '@/services/connectionRequestService'
import type { ConnectionRequest, ConnectionRequestDeliveryMode, ConnectionRequestStatus } from '@/types/connectionRequest'
import '@/styles/dashboard.css'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { ConnectionThread, PlanSummary, connectionStatusColor, connectionStatusText } from '@/components/marketplace/ConnectionThread'
import { useLanguage } from '@/providers/LanguageProvider'
import { singleActionFooter } from '@/components/shared/modalFooter'

const { Text } = Typography

const statusColor = connectionStatusColor

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
  const [viewing, setViewing] = useState<ConnectionRequest>()
  // Consultant requests are handled by the consultant; operations follow along and can step in. Agent requests are operations' to arrange.
  const statusLabel = (row: ConnectionRequest) => row.targetType === 'consultant' ? t(connectionStatusText(row.status, 'operations', row.declinedBy)) : row.status.toUpperCase()
  const [form] = Form.useForm<{ reviewerNote: string }>()
  // Reception marks requests contacted and forwards them to staff; deciding them stays with operations.
  const isReception = user?.role === 'admin'
  const [forwarding, setForwarding] = useState<ConnectionRequest>()
  const [staffOptions, setStaffOptions] = useState<Array<{ uid: string, name: string, role: string }>>([])
  const [forwardForm] = Form.useForm<{ staffUid: string, reviewerNote?: string }>()

  const openForward = (row: ConnectionRequest) => {
    setForwarding(row)
    forwardForm.setFieldsValue({ staffUid: row.forwardedToUid, reviewerNote: '' })
    if (!staffOptions.length) void listForwardingStaff(user).then(setStaffOptions).catch(() => message.error(t('Staff could not be loaded.')))
  }

  const submitForward = async () => {
    if (!forwarding) return
    const values = await forwardForm.validateFields()
    const staff = staffOptions.find((row) => row.uid === values.staffUid)
    if (!staff) return
    setSubmitting(true)
    try {
      await forwardConnectionRequest(forwarding.id, staff, values.reviewerNote, user)
      message.success(t('Request forwarded to {name}.', undefined, { name: staff.name }))
      setForwarding(undefined)
      await load()
    } catch {
      message.error(t('The request could not be forwarded.'))
    } finally {
      setSubmitting(false)
    }
  }

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
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid])

  const filteredRows = useMemo(() => rows.filter((row) => status === 'all' || row.status === status), [rows, status])
  const metrics = useMemo(() => ({
    pending: rows.filter((row) => row.status === 'pending').length,
    contacted: rows.filter((row) => row.status === 'contacted').length,
    proposed: rows.filter((row) => row.status === 'proposed').length,
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
    { title: t('Status'), dataIndex: 'status', render: (_: ConnectionRequestStatus, row: ConnectionRequest) => <Space direction="vertical" size={2}><Tag color={statusColor[row.status]}>{statusLabel(row)}</Tag>{row.forwardedToName && <Text type="secondary">{t('Forwarded to {name}', undefined, { name: row.forwardedToName })}</Text>}</Space> },
    {
      title: '',
      key: 'actions',
      align: 'right' as const,
      render: (_: unknown, row: ConnectionRequest) => row.targetType === 'consultant' ? (
        <Button size="small" onClick={() => setViewing(row)}>{t('View')}</Button>
      ) : isReception && ['pending', 'contacted'].includes(row.status) ? (
        <Space>
          {row.status === 'pending' && <Button size="small" type="primary" icon={<PhoneOutlined />} onClick={() => openReview(row, 'contacted')}>{t('Mark contacted')}</Button>}
          <Button size="small" icon={<SendOutlined />} onClick={() => openForward(row)}>{row.forwardedToName ? t('Forwarded to {name}', undefined, { name: row.forwardedToName }) : t('Forward')}</Button>
        </Space>
      ) : row.status === 'pending' ? (
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
      <PageLoadingBar active={Boolean(loading)} label={t('Loading connection requests')} />

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
                { label: `Plan sent (${metrics.proposed})`, value: 'proposed' },
                { label: `Matched (${metrics.matched})`, value: 'matched' },
                { label: `All (${metrics.total})`, value: 'all' },
              ]}
            />
          </Card>
        </div>

        <FilterBar
          title={t('SME connection requests')}
          primary={<Text type="secondary">{t('Independent SMEs choose consultants and agents from the marketplace. Consultants answer their own requests and send plans; you can follow each one and step in. Agent requests are yours to arrange.')}</Text>}
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
                  <Space><Tag color={statusColor[row.status]}>{statusLabel(row)}</Tag><Text>{formatDate(row.createdAt)}</Text></Space>
                  <Text strong>{row.smeName}</Text>
                  <Text type="secondary">{row.smeEmail}</Text>
                  <Text>{row.targetName} ({row.targetType === 'agent' ? t('AI agent') : t('Consultant')})</Text>
                  {row.targetType === 'consultant' && <Button size="small" onClick={() => setViewing(row)}>{t('View')}</Button>}
                  {row.forwardedToName && <Text type="secondary">{t('Forwarded to {name}', undefined, { name: row.forwardedToName })}</Text>}
                  {row.targetType !== 'consultant' && row.status === 'pending' && (
                    <Space>
                      <Button size="small" type="primary" icon={<PhoneOutlined />} onClick={() => openReview(row, 'contacted')}>{t('Mark contacted')}</Button>
                      {!isReception && <Button size="small" danger icon={<CloseOutlined />} onClick={() => openReview(row, 'declined')}>{t('Decline')}</Button>}
                    </Space>
                  )}
                  {isReception && row.targetType !== 'consultant' && ['pending', 'contacted'].includes(row.status) && (
                    <Button size="small" icon={<SendOutlined />} onClick={() => openForward(row)}>{t('Forward')}</Button>
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
        {...singleActionFooter({ danger: decision === 'declined' })}
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

      {/* A consultant request as both sides see it, read-only, with operations able to decline it if needed. */}
      <ResponsiveModal open={!!viewing} onClose={() => setViewing(undefined)} title={viewing ? `${viewing.smeName} → ${viewing.targetName}` : ''} width={640} centered>
        {viewing && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space wrap size={8}>
              <Tag bordered={false} color={statusColor[viewing.status]}>{statusLabel(viewing)}</Tag>
              <Text type="secondary">{[viewing.areaOfSupport, `${t('Received')} ${formatDate(viewing.createdAt)}`].filter(Boolean).join(' · ')}</Text>
            </Space>
            {viewing.plan && <div><Text strong style={{ display: 'block', marginBottom: 8 }}>{t('Plan')}</Text><PlanSummary plan={viewing.plan} /></div>}
            <div><Text strong style={{ display: 'block', marginBottom: 8 }}>{t('Conversation')}</Text><ConnectionThread request={viewing} viewer="operations" /></div>
            {!isReception && ['pending', 'contacted', 'proposed'].includes(viewing.status) && (
              <Button danger icon={<CloseOutlined />} onClick={() => { const row = viewing; setViewing(undefined); openReview(row, 'declined') }}>{t('Decline on their behalf')}</Button>
            )}
          </Space>
        )}
      </ResponsiveModal>

      <Modal
        open={Boolean(forwarding)}
        title={t('Forward request')}
        okText={t('Forward')}
        {...singleActionFooter()}
        confirmLoading={submitting}
        onOk={() => void submitForward()}
        onCancel={() => setForwarding(undefined)}
        destroyOnClose
      >
        {forwarding && (
          <Form form={forwardForm} layout="vertical">
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>{forwarding.smeName} → {forwarding.targetName}</Text>
            <Form.Item name="staffUid" label={t('Staff member')} rules={[{ required: true, message: t('Choose who should pick this up.') }]}>
              <Select showSearch optionFilterProp="label" placeholder={t('Choose a staff member')} options={staffOptions.map((row) => ({ value: row.uid, label: row.name }))} />
            </Form.Item>
            <Form.Item name="reviewerNote" label={t('Note (optional)')}>
              <Input.TextArea rows={3} />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </DashboardPage>
  )
}
