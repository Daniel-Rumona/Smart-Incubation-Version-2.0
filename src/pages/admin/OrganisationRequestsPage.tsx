import { useEffect, useState } from 'react'
import { Alert, App, Button, Card, Input, Space, Table, Tag, Typography } from 'antd'
import { collection, onSnapshot } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { useLanguage } from '@/providers/LanguageProvider'
import { decideOrganisationRequest, type OrganisationAccessRequest } from '@/services/organisationAccessService'

export default function OrganisationRequestsPage() {
  const { t } = useLanguage()
  const { message, modal } = App.useApp()
  const [requests, setRequests] = useState<OrganisationAccessRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => onSnapshot(collection(getFirebaseDb(), 'organisationAccessRequests'), snapshot => {
    setRequests(snapshot.docs.map(row => ({ ...row.data(), uid: row.id } as OrganisationAccessRequest))
      .sort((a, b) => (b.createdAt?.toDate().getTime() || 0) - (a.createdAt?.toDate().getTime() || 0)))
    setLoading(false)
    setError('')
  }, () => { setError(t('Organisation requests could not be loaded.')); setLoading(false) }), [attempt, t])

  const review = (request: OrganisationAccessRequest, decision: 'approved' | 'rejected') => {
    let reason = ''
    modal.confirm({
      title: t(decision === 'approved' ? 'Approve organisation access?' : 'Reject organisation access?'),
      content: <Space orientation="vertical">
        <Typography.Text>{request.organisationName} — {request.contactName} ({request.email})</Typography.Text>
        <Typography.Paragraph>{t(decision === 'approved' ? 'This allows the applicant to become a Director and set up their organisation.' : 'The applicant will remain blocked from organisation setup.')}</Typography.Paragraph>
        <Input.TextArea placeholder={t('Reason or review note (visible to applicant)')} maxLength={2000} rows={3} onChange={event => { reason = event.target.value }} />
      </Space>,
      okText: t(decision === 'approved' ? 'Approve' : 'Reject'),
      okButtonProps: { danger: decision === 'rejected' },
      onOk: async () => {
        try {
          await decideOrganisationRequest(request.uid, decision, reason)
          message.success(t('Decision saved.'))
        } catch (err) {
          message.error(err instanceof Error ? err.message : t('The decision could not be saved.'))
          throw err
        }
      },
    })
  }
  return <Card>
    <Typography.Title level={2}>{t('Organisation requests')}</Typography.Title>
    <Typography.Paragraph>{t('Review new incubation operators before they can create an organisation. Existing organisations retain their access.')}</Typography.Paragraph>
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => setAttempt(value => value + 1)}>{t('Try again')}</Button>} />}
    <Table rowKey="uid" dataSource={requests} loading={loading} scroll={{ x: 850 }} pagination={{ pageSize: 15 }}
      expandable={{ expandedRowRender: row => <Space orientation="vertical"><Typography.Text>{row.notes || t('No additional details')}</Typography.Text><Typography.Text>{row.reason}</Typography.Text></Space> }}
      columns={[
        { title: t('Organisation'), dataIndex: 'organisationName' },
        { title: t('Contact'), key: 'contact', render: (_, row) => <Space orientation="vertical" size={0}><Typography.Text>{row.contactName}</Typography.Text><Typography.Text>{row.email}</Typography.Text><Typography.Text>{row.phone}</Typography.Text></Space> },
        { title: t('Requested'), key: 'createdAt', render: (_, row) => row.createdAt?.toDate().toLocaleString() || '—' },
        { title: t('Status'), dataIndex: 'status', filters: ['pending', 'approved', 'rejected'].map(value => ({ text: t(value), value })), defaultFilteredValue: ['pending'], onFilter: (value, row) => row.status === value, render: status => <Tag color={status === 'approved' ? 'green' : status === 'rejected' ? 'red' : 'gold'}>{t(status)}</Tag> },
        { title: t('Actions'), key: 'actions', render: (_, row) => row.status === 'pending' ? <Space><Button type="primary" onClick={() => review(row, 'approved')}>{t('Approve')}</Button><Button danger onClick={() => review(row, 'rejected')}>{t('Reject')}</Button></Space> : '—' },
      ]} />
  </Card>
}
