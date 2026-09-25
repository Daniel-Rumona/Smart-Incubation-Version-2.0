import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Alert, Avatar, Button, Card, Col, DatePicker, Descriptions, Empty, Form, Input, InputNumber, Modal, Pagination, Row, Segmented, Select, Space, Tag, Typography } from 'antd'
import { CheckCircleOutlined, RobotOutlined, SafetyCertificateOutlined, SearchOutlined, SendOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import DashboardHeader from '@/components/shared/DashboardHeader'
import DashboardPage from '@/components/shared/DashboardPage'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listActiveAgents } from '@/services/agentRegistryService'
import { listPublishedConsultants } from '@/services/consultantMarketplaceService'
import { createConnectionRequest, listConnectionRequestsForSme } from '@/services/connectionRequestService'
import { isPlatformOwnerSme, resolveSmeCompanyCode } from '@/services/companiesService'
import type { ConsultantMarketplaceProfile } from '@/types/consultantMarketplace'
import type { AgentDefinition } from '@/types/agentOrchestration'
import type { ConnectionRequest, ConnectionRequestDeliveryMode, ConnectionRequestStatus, ConnectionRequestUrgency } from '@/types/connectionRequest'
import '@/styles/consultant.css'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const { Text, Paragraph } = Typography
const PAGE_SIZE = 6

type ProviderView = 'consultants' | 'agents' | 'requests'
type RequestTarget = { type: 'consultant'; profile: ConsultantMarketplaceProfile } | { type: 'agent'; agent: AgentDefinition }

type RequestFormValues = {
  areaOfSupport: string
  deliveryMode: ConnectionRequestDeliveryMode
  preferredStartDate: Dayjs
  engagementDays?: number
  urgency: ConnectionRequestUrgency
  budget?: number
  note: string
}

const deliveryModeOptions = [
  { get label() { return tr('Online') }, value: 'online' },
  { get label() { return tr('In person') }, value: 'in_person' },
  { get label() { return tr('Hybrid') }, value: 'hybrid' },
  { get label() { return tr('No preference') }, value: 'no_preference' },
]

const urgencyOptions = [
  { get label() { return tr('Low - within the next quarter') }, value: 'low' },
  { get label() { return tr('Normal - within a month') }, value: 'normal' },
  { get label() { return tr('High - as soon as possible') }, value: 'high' },
]

const statusColor: Record<ConnectionRequestStatus, string> = {
  pending: 'orange',
  contacted: 'blue',
  matched: 'green',
  declined: 'red',
}

const statusHelp: Record<ConnectionRequestStatus, string> = {
  pending: 'Waiting for the operations team to review your choice.',
  contacted: 'Operations has reached out to arrange the engagement.',
  matched: 'You have been matched. The consultant will work with you.',
  declined: 'This request was not taken further.',
}

const formatDate = (value: unknown) => {
  const date = (value as { toDate?: () => Date })?.toDate?.() ?? (value instanceof Date ? value : undefined)
  return date ? date.toLocaleDateString('en-ZA') : 'Just now'
}

const targetIdOf = (target: RequestTarget) => target.type === 'consultant' ? target.profile.uid : target.agent.id
const targetNameOf = (target: RequestTarget) => target.type === 'consultant'
  ? (target.profile.headline || target.profile.name)
  : target.agent.name

export default function ProviderMarketplacePage() {
  const { t } = useLanguage()
  const { user } = useFullIdentity()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [form] = Form.useForm<RequestFormValues>()
  const [view, setView] = useState<ProviderView>('consultants')
  const [consultants, setConsultants] = useState<ConsultantMarketplaceProfile[]>([])
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [myRequests, setMyRequests] = useState<ConnectionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [requestTarget, setRequestTarget] = useState<RequestTarget>()
  const [submitting, setSubmitting] = useState(false)

  const uid = user?.uid
  const loadRequests = useCallback(async () => {
    if (!uid) return
    setMyRequests(await listConnectionRequestsForSme(uid))
  }, [uid])

  useEffect(() => {
    Promise.all([listPublishedConsultants(), listActiveAgents(), uid ? listConnectionRequestsForSme(uid) : Promise.resolve([])])
      .then(([consultantRows, agentRows, requestRows]) => {
        setConsultants(consultantRows)
        setAgents(agentRows)
        setMyRequests(requestRows)
      })
      .catch(() => message.error(t('Consultants and agents could not be loaded right now.')))
      .finally(() => setLoading(false))
  }, [message, uid, t])

  const openRequestIds = useMemo(
    () => new Set(myRequests.filter((row) => row.status === 'pending' || row.status === 'contacted').map((row) => row.targetId)),
    [myRequests],
  )

  const filteredConsultants = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return consultants
    return consultants.filter((profile) => {
      const text = `${profile.headline} ${profile.bio} ${profile.specialties.join(' ')}`.toLowerCase()
      return text.includes(term)
    })
  }, [consultants, search])

  const filteredAgents = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return agents
    return agents.filter((agent) => `${agent.name} ${agent.description} ${agent.capabilities.join(' ')}`.toLowerCase().includes(term))
  }, [agents, search])

  const pagedConsultants = filteredConsultants.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  /** The support areas a target can actually deliver, so the SME picks from real offers instead of typing one. */
  const supportOptions = useMemo(() => {
    if (!requestTarget) return []
    const values = requestTarget.type === 'consultant'
      ? requestTarget.profile.services.map((service) => service.areaOfSupport).filter(Boolean)
      : requestTarget.agent.capabilities
    return Array.from(new Set(values)).map((value) => ({ label: value, value }))
  }, [requestTarget])

  const currency = requestTarget?.type === 'consultant' ? (requestTarget.profile.currency || 'ZAR') : 'ZAR'

  const openRequest = (target: RequestTarget) => {
    setRequestTarget(target)
    const firstService = target.type === 'consultant' ? target.profile.services[0] : undefined
    form.setFieldsValue({
      areaOfSupport: firstService?.areaOfSupport || (target.type === 'agent' ? target.agent.capabilities[0] : undefined),
      deliveryMode: (firstService?.deliveryMode as ConnectionRequestDeliveryMode) || 'no_preference',
      preferredStartDate: dayjs().add(7, 'day'),
      engagementDays: undefined,
      urgency: 'normal',
      budget: user?.consultingBudget,
      note: '',
    } as RequestFormValues)
  }

  const closeRequest = () => {
    setRequestTarget(undefined)
    form.resetFields()
  }

  const submitRequest = async () => {
    if (!user || !requestTarget) return
    let values: RequestFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    setSubmitting(true)
    try {
      await createConnectionRequest({
        smeUid: user.uid,
        smeName: user.displayName || user.name || user.email,
        smeEmail: user.email,
        targetType: requestTarget.type,
        targetId: targetIdOf(requestTarget),
        targetName: targetNameOf(requestTarget),
        companyCode: resolveSmeCompanyCode(user),
        areaOfSupport: values.areaOfSupport,
        deliveryMode: values.deliveryMode,
        preferredStartDate: values.preferredStartDate?.format('YYYY-MM-DD'),
        engagementDays: values.engagementDays,
        urgency: values.urgency,
        budget: values.budget,
        currency,
        note: values.note,
      })
      message.success(t('Request sent. Our operations team will follow up with you.'))
      closeRequest()
      await loadRequests()
      setView('requests')
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('Your request could not be sent.'))
    } finally {
      setSubmitting(false)
    }
  }

  // The marketplace belongs to the platform owner's independently registered SMEs. Once an SME is
  // in a programme - QTX's own included - support is requested through their interventions page.
  if (!isPlatformOwnerSme(user) || !user?.isApplicant) {
    return (
      <DashboardPage className="consultant-page">
        <DashboardHeader title={t('Find a consultant or agent')} />
        <Card className="dashboard-section-card">
          <Empty
            description={t('Your programme provides consultants and agents directly. Request support from your interventions page and your programme team will assign the right person.')}
          >
            <Button type="primary" onClick={() => navigate('/incubatee/interventions')}>{t('Go to interventions')}</Button>
          </Empty>
        </Card>
      </DashboardPage>
    )
  }

  if (loading) return <LoadingOverlay tip={t('Loading consultants and agents')} />

  return (
    <DashboardPage className="consultant-page">
      <DashboardHeader
        title={t('Find a consultant or agent')}
        subtitle={tr('Browse available consultants and AI agents, choose the one that fits your needs, and send your request with the support you need.')}
      />

      <Card className="dashboard-section-card">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <Segmented
              value={view}
              onChange={(value) => { setView(value as ProviderView); setPage(1) }}
              options={[
                { label: `Consultants (${filteredConsultants.length})`, value: 'consultants' },
                { label: `AI Agents (${filteredAgents.length})`, value: 'agents' },
                { label: `My requests (${myRequests.length})`, value: 'requests' },
              ]}
            />
            {view !== 'requests' && (
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder={t('Search by name, specialty, or capability')}
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1) }}
                style={{ width: 280 }}
              />
            )}
          </Space>

          {view === 'consultants' && (
            filteredConsultants.length ? (
              <>
                <Row gutter={[14, 14]}>
                  {pagedConsultants.map((profile) => (
                    <Col xs={24} md={12} xl={8} key={profile.uid}>
                      <Card size="small" className="consultant-service-card" hoverable>
                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                          <Space><Avatar size="small" src={profile.profileImageUrl || undefined}>{profile.name.charAt(0)}</Avatar><Text strong>{profile.headline || profile.name}</Text>{profile.verificationStatus === 'verified' && <Tag color="blue" icon={<SafetyCertificateOutlined />}>{t('Verified')}</Tag>}</Space>
                          {profile.experienceYears > 0 && <Text type="secondary">{profile.experienceYears} {t('years experience')}</Text>}
                          <Paragraph type="secondary" ellipsis={{ rows: 3 }} style={{ marginBottom: 0 }}>{profile.bio || t('No description provided yet.')}</Paragraph>
                          <Space wrap>{profile.specialties.map((specialty) => <Tag key={specialty}>{specialty}</Tag>)}</Space>
                          {profile.services.length > 0 && (
                            <Space direction="vertical" size={2}>
                              <Text type="secondary">{t('From')} {profile.currency} {profile.services[0].rate} {t('per day')}</Text>
                              <Text type="secondary">{profile.services.map((service) => service.areaOfSupport).filter(Boolean).join(' · ')}</Text>
                            </Space>
                          )}
                          {(profile.country || profile.province || profile.physicalAddress || profile.operatingLocation) && <Text type="secondary">{t('Based in')} {[profile.province, profile.country].filter(Boolean).join(', ')} · {profile.serviceRadiusKm} {t('km in person')}</Text>}
                          {openRequestIds.has(profile.uid) ? (
                            <Button block disabled icon={<CheckCircleOutlined />}>{t('Request already sent')}</Button>
                          ) : (
                            <Button type="primary" block icon={<SendOutlined />} onClick={() => openRequest({ type: 'consultant', profile })}>
                              {t('Choose this consultant')}
                            </Button>
                          )}
                        </Space>
                      </Card>
                    </Col>
                  ))}
                </Row>
                {filteredConsultants.length > PAGE_SIZE && (
                  <div className="consultant-centered-pagination">
                    <Pagination current={page} pageSize={PAGE_SIZE} total={filteredConsultants.length} onChange={setPage} showSizeChanger={false} />
                  </div>
                )}
              </>
            ) : <Empty description={t('No published consultants match your search yet.')} />
          )}

          {view === 'agents' && (
            filteredAgents.length ? (
              <Row gutter={[14, 14]}>
                {filteredAgents.map((agent) => (
                  <Col xs={24} md={12} xl={8} key={agent.id}>
                    <Card size="small" className="consultant-service-card" hoverable>
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Space><RobotOutlined /><Text strong>{agent.name}</Text></Space>
                        <Paragraph type="secondary" style={{ marginBottom: 0 }}>{agent.description}</Paragraph>
                        <Space wrap>{agent.capabilities.map((capability) => <Tag key={capability} color="purple">{capability}</Tag>)}</Space>
                        {openRequestIds.has(agent.id) ? (
                          <Button block disabled icon={<CheckCircleOutlined />}>{t('Request already sent')}</Button>
                        ) : (
                          <Button type="primary" block icon={<SendOutlined />} onClick={() => openRequest({ type: 'agent', agent })}>
                            {t('Choose this agent')}
                          </Button>
                        )}
                      </Space>
                    </Card>
                  </Col>
                ))}
              </Row>
            ) : <Empty description={t('No AI agents match your search yet.')} />
          )}

          {view === 'requests' && (
            myRequests.length ? (
              <Row gutter={[14, 14]}>
                {myRequests.map((row) => (
                  <Col xs={24} md={12} xl={8} key={row.id}>
                    <Card size="small" className="consultant-service-card">
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Space wrap>
                          <Tag color={statusColor[row.status]}>{row.status.toUpperCase()}</Tag>
                          <Tag>{row.targetType === 'agent' ? t('AI agent') : t('Consultant')}</Tag>
                          <Text type="secondary">{t('Sent')} {formatDate(row.createdAt)}</Text>
                        </Space>
                        <Text strong>{row.targetName}</Text>
                        {row.areaOfSupport && <Text type="secondary">{row.areaOfSupport}</Text>}
                        {row.preferredStartDate && <Text type="secondary">{t('Preferred start:')} {row.preferredStartDate}</Text>}
                        {typeof row.budget === 'number' && <Text type="secondary">{t('Budget:')} {row.currency || t('ZAR')} {row.budget.toLocaleString()}</Text>}
                        <Text type="secondary">{statusHelp[row.status]}</Text>
                        {row.reviewerNote && <Alert type="info" showIcon message={t('Operations note')} description={row.reviewerNote} />}
                      </Space>
                    </Card>
                  </Col>
                ))}
              </Row>
            ) : <Empty description={t('You have not requested a consultant or agent yet.')} />
          )}
        </Space>
      </Card>

      <Modal
        open={Boolean(requestTarget)}
        title={requestTarget ? `Request ${targetNameOf(requestTarget)}` : ''}
        onCancel={closeRequest}
        onOk={() => void submitRequest()}
        confirmLoading={submitting}
        okText={t('Send request')}
        destroyOnHidden
        width={620}
      >
        {requestTarget && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label={t('You selected')}>{targetNameOf(requestTarget)}</Descriptions.Item>
              {requestTarget.type === 'consultant' && requestTarget.profile.services.length > 0 && (
                <Descriptions.Item label={t('Day rate from')}>{currency} {requestTarget.profile.services[0].rate.toLocaleString()}</Descriptions.Item>
              )}
            </Descriptions>

            <Form form={form} layout="vertical" requiredMark>
              <Form.Item
                name="areaOfSupport"
                label={t('What support do you need?')}
                rules={[{ required: true, message: tr('Choose or describe the support you need.') }]}
              >
                <Select
                  showSearch
                  allowClear
                  options={supportOptions}
                  placeholder={t('Select an area of support')}
                  {...(supportOptions.length === 0 ? { mode: 'tags' as const } : {})}
                />
              </Form.Item>

              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item name="deliveryMode" label={t('How would you like it delivered?')} rules={[{ required: true, message: tr('Choose a delivery mode.') }]}>
                    <Select options={deliveryModeOptions} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="urgency" label={t('How urgent is it?')} rules={[{ required: true, message: tr('Choose an urgency.') }]}>
                    <Select options={urgencyOptions} />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col xs={24} md={8}>
                  <Form.Item name="preferredStartDate" label={t('Preferred start date')} rules={[{ required: true, message: tr('Choose a preferred start date.') }]}>
                    <DatePicker style={{ width: '100%' }} disabledDate={(date) => date.isBefore(dayjs(), 'day')} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="engagementDays" label={t('Estimated days needed')}>
                    <InputNumber min={1} max={260} style={{ width: '100%' }} placeholder={t('e.g. 5')} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="budget" label={`Your budget (${currency})`}>
                    <InputNumber min={0} style={{ width: '100%' }} placeholder={t('Optional')} />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                name="note"
                label={t('Tell the consultant what you need')}
                rules={[{ required: true, message: tr('Describe what you need help with.') }, { min: 15, message: tr('Please give at least a sentence of detail.') }]}
              >
                <Input.TextArea rows={4} placeholder={t('Describe your business challenge, what you have tried, and the outcome you want.')} showCount maxLength={800} />
              </Form.Item>
            </Form>

            <Text type="secondary">{t('Your request goes to the operations team, who confirm availability and arrange the engagement.')}</Text>
          </Space>
        )}
      </Modal>
    </DashboardPage>
  )
}
