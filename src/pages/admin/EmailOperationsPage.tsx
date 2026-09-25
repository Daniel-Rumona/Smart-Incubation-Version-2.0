import { App, Button, Card, Col, Form, Input, Modal, Row, Segmented, Space, Tag, Typography } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, MailOutlined, ReloadOutlined, SendOutlined, StopOutlined, WarningOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { getEmailOperations, sendAdminEmail, type EmailOperations } from '@/services/emailOperationsService'
import { useLanguage } from '@/providers/LanguageProvider'

type SendForm = { to: string, subject: string, message: string }
const dateFormatter = new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })

export const EmailOperationsPage = () => {
  const { message } = App.useApp()
  const { t } = useLanguage()
  const [form] = Form.useForm<SendForm>()
  const [data, setData] = useState<EmailOperations>()
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [section, setSection] = useState<string | number>('delivery')

  const load = async () => {
    try {
      setLoading(true)
      setData(await getEmailOperations())
    } catch {
      message.error(t('emailOps.loadError'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timeout)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (values: SendForm) => {
    try {
      setSending(true)
      await sendAdminEmail(values)
      message.success(t('emailOps.queued'))
      setModalOpen(false)
      form.resetFields()
      await load()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('emailOps.sendError'))
    } finally {
      setSending(false)
    }
  }
  const summary = data?.summary

  return <DashboardPage>
    <Row gutter={[14, 14]} className="dashboard-metrics-row">
      <Col xs={12} lg={4}><DashboardMetricCard icon={<CheckCircleOutlined />} label={t('emailOps.sent')} value={summary?.sent || 0} /></Col>
      <Col xs={12} lg={4}><DashboardMetricCard icon={<CloseCircleOutlined />} label={t('emailOps.failed')} value={summary?.failed || 0} /></Col>
      <Col xs={12} lg={4}><DashboardMetricCard icon={<WarningOutlined />} label={t('emailOps.rejected')} value={summary?.rejected || 0} /></Col>
      <Col xs={12} lg={4}><DashboardMetricCard icon={<MailOutlined />} label={t('emailOps.bounced')} value={summary?.bounced || 0} /></Col>
      <Col xs={12} lg={4}><DashboardMetricCard icon={<StopOutlined />} label={t('emailOps.suppressed')} value={summary?.suppressed || 0} /></Col>
      <Col xs={12} lg={4}><DashboardMetricCard icon={<WarningOutlined />} label={t('emailOps.invalid')} value={summary?.invalid || 0} /></Col>
    </Row>
    <FilterBar title={t('emailOps.title')} primary={<></>} actions={<Space><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>{t('common.refresh')}</Button><Button type="primary" icon={<SendOutlined />} onClick={() => setModalOpen(true)}>{t('emailOps.send')}</Button></Space>} />
    <Segmented block value={section} onChange={setSection} options={[{ value: 'delivery', label: t('emailOps.delivery') }, { value: 'suppressed', label: t('emailOps.suppressed') }]} style={{ marginBottom: 14 }} />
    {section === 'delivery' ? <Card bordered={false}>
      <ResponsiveDataView rowKey="id" loading={loading} rows={data?.logs || []} emptyText={t('usage.noData')} columns={[
        { title: t('emailOps.recipient'), dataIndex: 'recipients', render: (value: string[]) => value.join(', ') || t('N/A') },
        { title: t('emailOps.source'), dataIndex: 'source' },
        { title: t('common.status'), dataIndex: 'status', render: (value: string) => <Tag color={value === 'sent' ? 'green' : value === 'failed' ? 'red' : 'orange'}>{value}</Tag> },
        { title: t('emailOps.detail'), render: (_, row) => row.error || row.reason || row.rejected.join(', ') || t('N/A') },
        { title: t('emailOps.recorded'), dataIndex: 'createdAt', render: (value?: string) => value ? dateFormatter.format(new Date(value)) : t('N/A') },
      ]} renderCard={(row) => <Space orientation="vertical"><Typography.Text strong>{row.recipients.join(', ') || t('N/A')}</Typography.Text><Tag color={row.status === 'sent' ? 'green' : row.status === 'failed' ? 'red' : 'orange'}>{row.status}</Tag><Typography.Text type="secondary">{row.error || row.reason || row.source}</Typography.Text></Space>} />
    </Card> : <Card bordered={false}>
      <ResponsiveDataView rowKey="id" loading={loading} rows={data?.suppressions || []} emptyText={t('usage.noData')} columns={[
        { title: t('common.email'), dataIndex: 'email' },
        { title: t('emailOps.reason'), dataIndex: 'reason' },
        { title: t('emailOps.failures'), dataIndex: 'failureCount' },
        { title: t('emailOps.recorded'), dataIndex: 'updatedAt', render: (value?: string) => value ? dateFormatter.format(new Date(value)) : t('N/A') },
      ]} renderCard={(row) => <Space orientation="vertical"><Typography.Text strong>{row.email}</Typography.Text><Tag color="orange">{row.reason}</Tag><Typography.Text type="secondary">{t('emailOps.failures')}: {row.failureCount}</Typography.Text></Space>} />
    </Card>}
    <Modal open={modalOpen} title={t('emailOps.send')} footer={null} onCancel={() => setModalOpen(false)}>
      <Form form={form} layout="vertical" onFinish={(values) => void send(values)}>
        <Form.Item name="to" label={t('emailOps.recipient')} rules={[{ required: true }, { type: 'email' }]}><Input /></Form.Item>
        <Form.Item name="subject" label={t('emailOps.subject')} rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="message" label={t('emailOps.message')} rules={[{ required: true }]}><Input.TextArea rows={6} /></Form.Item>
        <Button block type="primary" htmlType="submit" loading={sending}>{t('emailOps.queue')}</Button>
      </Form>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>{t('emailOps.bounceHint')}</Typography.Paragraph>
    </Modal>
  </DashboardPage>
}
