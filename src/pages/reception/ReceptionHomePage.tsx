import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, Empty, Row, Skeleton, Tag, Typography } from 'antd'
import { AuditOutlined, CalendarOutlined, IdcardOutlined, RightOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import dayjs, { type Dayjs } from 'dayjs'
import { AdminKpiTile } from '@/components/admin/AdminKpiTile'
import DashboardPage from '@/components/shared/DashboardPage'
import { getFirebaseDb } from '@/config/firebase'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { isPlatformOwnerStaff } from '@/services/companiesService'
import { listConnectionRequests } from '@/services/connectionRequestService'
import type { ConnectionRequest } from '@/types/connectionRequest'
import '@/styles/admin-dashboard.css'
import '@/styles/reception.css'

type Appointment = { id: string; start: Dayjs; participantName: string; interventionTitle: string; assigneeName: string; status: string }
type Application = { id: string; businessName: string; participantName: string; programName: string; submittedAt: Dayjs | null; source: string }

const toDayjs = (value: unknown): Dayjs | null => {
  if (!value) return null
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') return dayjs((value as { toDate: () => Date }).toDate())
  const parsed = dayjs(value as string)
  return parsed.isValid() ? parsed : null
}

/** Reception's front desk: today's bookings, applications waiting for review, and requests to pass on. */
export const ReceptionHomePage = () => {
  const { t } = useLanguage()
  const { user } = useFullIdentity()
  const navigate = useNavigate()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [applications, setApplications] = useState<Application[]>([])
  const [requests, setRequests] = useState<ConnectionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const companyCode = String(user?.companyCode || '').trim()
  const handlesRequests = isPlatformOwnerStaff(user)

  useEffect(() => {
    if (!user || !companyCode) return
    let active = true
    const db = getFirebaseDb()
    void Promise.all([
      getDocs(query(collection(db, 'appointments'), where('companyCode', '==', companyCode))).catch(() => null),
      getDocs(query(collection(db, 'applications'), where('companyCode', '==', companyCode))).catch(() => null),
      handlesRequests ? listConnectionRequests(user).catch(() => []) : Promise.resolve([]),
    ]).then(([appointmentSnap, applicationSnap, requestRows]) => {
      if (!active) return
      setAppointments((appointmentSnap?.docs || []).flatMap((row) => {
        const data = row.data()
        const start = toDayjs(data.startTime)
        if (!start) return []
        return [{
          id: row.id,
          start,
          participantName: String(data.participantName || data.beneficiaryName || data.businessName || ''),
          interventionTitle: String(data.interventionTitle || data.title || ''),
          assigneeName: String(data.assigneeName || data.consultantName || ''),
          status: String(data.status || 'pending').toLowerCase(),
        }]
      }))
      setApplications((applicationSnap?.docs || []).flatMap((row) => {
        const data = row.data()
        if (String(data.applicationStatus || 'pending').toLowerCase() !== 'pending') return []
        return [{
          id: row.id,
          businessName: String(data.businessName || data.companyName || ''),
          participantName: String(data.participantName || data.name || ''),
          programName: String(data.programName || ''),
          submittedAt: toDayjs(data.submittedAt || data.createdAt),
          source: String(data.source || ''),
        }]
      }))
      setRequests((requestRows as ConnectionRequest[]).filter((row) => ['pending', 'contacted'].includes(row.status)))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [companyCode, handlesRequests, user])

  const today = dayjs()
  const todays = useMemo(() => appointments
    .filter((row) => row.start.isSame(today, 'day') && row.status !== 'cancelled' && row.status !== 'declined')
    .sort((left, right) => left.start.valueOf() - right.start.valueOf()), [appointments]) // eslint-disable-line react-hooks/exhaustive-deps
  const upcomingWeek = appointments.filter((row) => row.start.isAfter(today, 'day') && row.start.isBefore(today.add(8, 'day'), 'day') && !['cancelled', 'declined', 'completed'].includes(row.status)).length
  const awaitingConfirmation = appointments.filter((row) => row.status === 'pending' && row.start.isAfter(today)).length
  const newestApplications = [...applications].sort((left, right) => (right.submittedAt?.valueOf() || 0) - (left.submittedAt?.valueOf() || 0))
  const firstName = (user?.name || user?.displayName || '').split(' ')[0]

  useRegisterAgentPageContext({
    pageKey: 'reception-home',
    pageName: 'Reception',
    purpose: 'Front desk overview: today\'s appointments, applications waiting for review and connection requests to pass on.',
    metrics: { appointmentsToday: todays.length, pendingApplications: applications.length, openRequests: requests.length },
  })

  const statusTag = (status: string) => status === 'accepted'
    ? <Tag color="green" bordered={false}>{t('Confirmed')}</Tag>
    : status === 'completed' ? <Tag bordered={false}>{t('Completed')}</Tag> : <Tag color="gold" bordered={false}>{t('Awaiting confirmation')}</Tag>

  return (
    <DashboardPage className="reception-home admin-overview">
      <header className="admin-hero">
        <div>
          <h2>{firstName ? t('Good day, {name}', undefined, { name: firstName }) : t('Reception')}</h2>
          <p>{today.format('dddd, D MMMM')}</p>
        </div>
        <div className="admin-hero-actions">
          <Button shape="round" size="large" icon={<CalendarOutlined />} onClick={() => navigate('/shared/interventions/appointments')}>{t('Book appointment')}</Button>
          <Button type="primary" shape="round" size="large" icon={<UserAddOutlined />} onClick={() => navigate('/operations/participants/new')}>{t('Register walk-in')}</Button>
        </div>
      </header>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={handlesRequests ? 6 : 8}><AdminKpiTile loading={loading} icon={<CalendarOutlined />} label={t('Appointments today')} value={todays.length} /></Col>
        <Col xs={24} sm={12} xl={handlesRequests ? 6 : 8}><AdminKpiTile loading={loading} icon={<CalendarOutlined />} label={t('Awaiting confirmation')} value={awaitingConfirmation} /></Col>
        <Col xs={24} sm={12} xl={handlesRequests ? 6 : 8}><AdminKpiTile loading={loading} icon={<AuditOutlined />} label={t('Applications to review')} value={applications.length} /></Col>
        {handlesRequests && <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<TeamOutlined />} label={t('Open requests')} value={requests.length} /></Col>}
      </Row>

      <Row gutter={[16, 16]} className="reception-row">
        <Col xs={24} lg={14}>
          <Card className="admin-card" bordered={false}>
            <div className="admin-card-head">
              <div>
                <h3>{t('Today\'s appointments')}</h3>
                <span>{t('{count} more this week', undefined, { count: upcomingWeek })}</span>
              </div>
              <Button type="text" size="small" onClick={() => navigate('/shared/interventions/appointments')}>{t('Open calendar')} <RightOutlined /></Button>
            </div>
            {loading ? <Skeleton active /> : todays.length ? (
              <ol className="reception-agenda">
                {todays.map((row) => (
                  <li key={row.id}>
                    <time>{row.start.format('HH:mm')}</time>
                    <div>
                      <strong>{row.participantName || t('SME')}</strong>
                      <span>{[row.interventionTitle, row.assigneeName].filter(Boolean).join(' · ')}</span>
                    </div>
                    {statusTag(row.status)}
                  </li>
                ))}
              </ol>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No appointments today.')} />}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card className="admin-card" bordered={false}>
            <div className="admin-card-head">
              <div>
                <h3>{t('Applications to review')}</h3>
                <span>{t('Operations or a project admin decides these')}</span>
              </div>
              <Button type="text" size="small" onClick={() => navigate('/shared/applications')}>{t('View all')} <RightOutlined /></Button>
            </div>
            {loading ? <Skeleton active /> : newestApplications.length ? (
              <ul className="reception-list">
                {newestApplications.slice(0, 6).map((row) => (
                  <li key={row.id}>
                    <div>
                      <strong>{row.businessName || row.participantName || t('SME')}</strong>
                      <span>{[row.programName, row.submittedAt?.format('D MMM')].filter(Boolean).join(' · ')}</span>
                    </div>
                    {row.source === 'walk_in' && <span className="admin-role-tag">{t('Walk-in')}</span>}
                  </li>
                ))}
              </ul>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Nothing waiting for review.')} />}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="reception-row">
        {handlesRequests && (
          <Col xs={24} lg={14}>
            <Card className="admin-card" bordered={false}>
              <div className="admin-card-head">
                <div>
                  <h3>{t('Connection requests')}</h3>
                  <span>{t('Mark contacted or forward to a staff member')}</span>
                </div>
                <Button type="text" size="small" onClick={() => navigate('/operations/connection-requests')}>{t('View all')} <RightOutlined /></Button>
              </div>
              {loading ? <Skeleton active /> : requests.length ? (
                <ul className="reception-list">
                  {requests.slice(0, 5).map((row) => (
                    <li key={row.id}>
                      <div>
                        <strong>{row.smeName}</strong>
                        <span>{[row.targetName, row.areaOfSupport].filter(Boolean).join(' · ')}</span>
                      </div>
                      {row.forwardedToName
                        ? <Typography.Text type="secondary">{t('Forwarded to {name}', undefined, { name: row.forwardedToName })}</Typography.Text>
                        : <Tag color={row.status === 'pending' ? 'gold' : 'blue'} bordered={false}>{row.status === 'pending' ? t('New') : t('Contacted')}</Tag>}
                    </li>
                  ))}
                </ul>
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No open requests.')} />}
            </Card>
          </Col>
        )}
        <Col xs={24} lg={handlesRequests ? 10 : 24}>
          <Card className="admin-card" bordered={false}>
            <div className="admin-card-head">
              <div>
                <h3>{t('Quick actions')}</h3>
              </div>
            </div>
            <div className="reception-actions">
              <button type="button" onClick={() => navigate('/operations/participants/new')}><span className="admin-kpi-icon"><UserAddOutlined /></span><strong>{t('Register walk-in')}</strong><small>{t('Capture a new SME; their application goes for review')}</small></button>
              <button type="button" onClick={() => navigate('/shared/interventions/appointments')}><span className="admin-kpi-icon"><CalendarOutlined /></span><strong>{t('Book appointment')}</strong><small>{t('Book, move or confirm a meeting')}</small></button>
              <button type="button" onClick={() => navigate('/shared/participants')}><span className="admin-kpi-icon"><IdcardOutlined /></span><strong>{t('Find an SME')}</strong><small>{t('Look up contact details and update phone numbers')}</small></button>
            </div>
          </Card>
        </Col>
      </Row>
    </DashboardPage>
  )
}

export default ReceptionHomePage
