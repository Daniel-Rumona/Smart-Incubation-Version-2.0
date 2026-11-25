import { useEffect, useMemo, useState } from 'react'
import { Card, Col, Progress, Row, Table, Typography } from 'antd'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { watchTeamEvents } from '@/services/teamEventsService'
import type { Prospect } from '@/types/prospects'
import type { TeamEvent } from '@/types/teamEvents'
import { eventSignups, signupFunnel, signupsByPerson } from '@/utils/teamEventStats'

/**
 * Prospects keeps the results of the events where the team looked for SMEs (the events themselves live on the
 * Appointments calendar): how each did, and who on the team brings people in. Hidden until there is such an event.
 */
export function ProspectsFromEvents({ prospects }: { prospects?: Prospect[] }) {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const [events, setEvents] = useState<TeamEvent[]>([])

    useEffect(() => {
        if (!user) return
        return watchTeamEvents(user, (rows) => setEvents(rows.filter((row) => row.recruiting)))
    }, [user])

    const rows = useMemo(() => events
        .map((event) => ({ event, ...signupFunnel(eventSignups(event, prospects || [])) }))
        .sort((a, b) => b.event.startTime.localeCompare(a.event.startTime)), [events, prospects])
    const people = useMemo(() => signupsByPerson(events, prospects || []), [events, prospects])

    if (!events.length) return null

    return (
        <Row gutter={[14, 14]} style={{ marginTop: 16 }}>
            <Col xs={24} lg={13}>
                <Card title={t('From events')} extra={<Typography.Link onClick={() => navigate('/shared/interventions/appointments')}>{t('Events calendar')}</Typography.Link>}>
                    <Table
                        size="small"
                        rowKey={(row) => row.event.id}
                        loading={!prospects}
                        pagination={rows.length > 6 ? { pageSize: 6 } : false}
                        dataSource={rows}
                        columns={[
                            {
                                title: t('Event'),
                                key: 'event',
                                render: (_, row) => (
                                    <div>
                                        <strong>{row.event.title}</strong>
                                        <div><Typography.Text type="secondary">{dayjs(row.event.startTime).format('D MMM YYYY')} · {t('{count} going', undefined, { count: row.event.attendees.length })}</Typography.Text></div>
                                    </div>
                                ),
                            },
                            { title: t('Sign-ups'), dataIndex: 'signedUp', align: 'right' },
                            { title: t('Applied'), dataIndex: 'applied', align: 'right', responsive: ['sm'] },
                            { title: t('Joined'), dataIndex: 'joined', align: 'right' },
                        ]}
                    />
                </Card>
            </Col>
            <Col xs={24} lg={11}>
                <Card title={t('Who brings people in')}>
                    <Table
                        size="small"
                        rowKey="uid"
                        loading={!prospects}
                        pagination={false}
                        dataSource={people}
                        locale={{ emptyText: t('No sign-ups through the team’s codes yet.') }}
                        columns={[
                            { title: t('Team member'), dataIndex: 'name' },
                            { title: t('Sign-ups'), dataIndex: 'signups', align: 'right' },
                            { title: t('Joined'), dataIndex: 'joined', align: 'right' },
                            {
                                title: t('Joined share'),
                                key: 'share',
                                responsive: ['md'],
                                render: (_, row) => <Progress percent={row.signups ? Math.round((row.joined / row.signups) * 100) : 0} size="small" />,
                            },
                        ]}
                    />
                </Card>
            </Col>
        </Row>
    )
}
