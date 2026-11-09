import { useEffect, useMemo, useState } from 'react'
import { Alert, Col, Row, Space, Tag, Typography, type TableProps } from 'antd'
import { ClockCircleOutlined, EditOutlined, SafetyCertificateOutlined, TeamOutlined } from '@ant-design/icons'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { getMyOrganisationResults } from '@/services/companyPortalService'
import { listTrainingClassesForOrganisation } from '@/services/trainingOrganisationsService'
import { useLanguage } from '@/providers/LanguageProvider'
import { useMyOrganisation } from '@/pages/company/useMyOrganisation'
import { classDatesLabel } from '@/utils/trainingFormat'
import type { OrganisationAttempt, OrganisationLearnerResult, TrainingClass } from '@/types/training'

/**
 * A client company's people and their assessments: the pre-assessment and post-assessment scores, what is waiting to
 * be marked, and who can write an assessment now (they write it from their own training page). Scores only.
 */
export default function CompanyAssessmentsPage() {
    const { t } = useLanguage()
    const { user } = useMyOrganisation()
    const [results, setResults] = useState<OrganisationLearnerResult[]>()
    const [classes, setClasses] = useState<TrainingClass[]>([])
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        if (!user) return
        let cancelled = false
        Promise.all([getMyOrganisationResults(), listTrainingClassesForOrganisation(user)]).then(([rows, classRows]) => {
            if (cancelled) return
            setResults(rows)
            setClasses(classRows)
        }, () => { if (!cancelled) { setFailed(true); setResults([]) } })
        return () => { cancelled = true }
    }, [user])

    const all = useMemo(() => results || [], [results])
    const classById = useMemo(() => new Map(classes.map((row) => [row.id, row])), [classes])
    const awaiting = all.filter((row) => [...row.pre, ...row.post].some((attempt) => attempt.status === 'submitted')).length
    const canWriteNow = all.filter((row) => row.canWrite.length > 0)

    const attemptLabel = (attempt?: OrganisationAttempt) => {
        if (!attempt) return <Typography.Text type="secondary">{t('Not written')}</Typography.Text>
        if (attempt.status === 'marked') return <Typography.Text strong>{attempt.scorePct}%</Typography.Text>
        return <Tag color={attempt.status === 'submitted' ? 'gold' : 'blue'}>{attempt.status === 'submitted' ? t('Awaiting marking') : t('Writing now')}</Tag>
    }
    const postCell = (row: OrganisationLearnerResult) => (
        <Space orientation="vertical" size={0}>
            {attemptLabel(row.post[row.post.length - 1])}
            {row.post.length > 1 && <Typography.Text type="secondary">{t('{count} attempts · best {pct}%', undefined, { count: row.post.length, pct: row.bestPostPct ?? 0 })}</Typography.Text>}
        </Space>
    )
    const statusCell = (row: OrganisationLearnerResult) => {
        if (row.certified) return <Tag color="green" icon={<SafetyCertificateOutlined />}>{t('Passed')}</Tag>
        if (row.canWrite.length) {
            return <Tag color="blue" icon={<EditOutlined />}>{row.canWrite.includes('pre') ? t('Pre-assessment open now') : row.post.length ? t('Reassessment open now') : t('Post-assessment open now')}</Tag>
        }
        return <Typography.Text type="secondary">{t('Pass mark {pct}%', undefined, { pct: row.passMarkPct })}</Typography.Text>
    }
    const classCell = (row: OrganisationLearnerResult) => {
        const trainingClass = classById.get(row.classId)
        return trainingClass
            ? <Space orientation="vertical" size={0}><span>{trainingClass.courseTitle}</span><Typography.Text type="secondary">{classDatesLabel(trainingClass)}</Typography.Text></Space>
            : '—'
    }

    const columns: TableProps<OrganisationLearnerResult>['columns'] = [
        { title: t('Name'), dataIndex: 'name', render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
        { title: t('Class'), key: 'class', render: (_, row) => classCell(row) },
        { title: t('Pre-assessment'), key: 'pre', align: 'center', render: (_, row) => attemptLabel(row.pre[0]) },
        { title: t('Post-assessment'), key: 'post', align: 'center', render: (_, row) => postCell(row) },
        { title: t('Result'), key: 'status', render: (_, row) => statusCell(row) },
    ]

    return (
        <DashboardPage className="training-page">
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={!results} icon={<TeamOutlined />} label={t('People')} value={all.length} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!results} icon={<EditOutlined />} label={t('Can write an assessment now')} mobileTitle={t('Open now')} value={canWriteNow.length} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!results} icon={<ClockCircleOutlined />} label={t('Awaiting marking')} mobileTitle={t('To be marked')} value={awaiting} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!results} icon={<SafetyCertificateOutlined />} label={t('Passed')} value={all.filter((row) => row.certified).length} /></Col>
            </Row>
            {canWriteNow.length > 0 && (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 14 }}
                    message={t('{names} can write an assessment now. They open it from their own training page with the sign-in they were sent.', undefined, { names: canWriteNow.map((row) => row.name).join(', ') })}
                />
            )}
            <ResponsiveDataView
                rowKey="learnerId"
                rows={all}
                columns={columns}
                loading={!results}
                emptyText={failed ? t('The assessments could not be loaded. Refresh the page to try again.') : t('None of your people has an assessment yet.')}
                renderCard={(row) => (
                    <Space orientation="vertical" style={{ width: '100%' }}>
                        <Space style={{ justifyContent: 'space-between', width: '100%' }}><Typography.Text strong>{row.name}</Typography.Text>{statusCell(row)}</Space>
                        {classCell(row)}
                        <Space wrap><Typography.Text type="secondary">{t('Pre-assessment')}:</Typography.Text>{attemptLabel(row.pre[0])}</Space>
                        <Space wrap><Typography.Text type="secondary">{t('Post-assessment')}:</Typography.Text>{postCell(row)}</Space>
                    </Space>
                )}
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
                {t('You see scores only. The questions, your people\'s answers and the memo stay with your training provider.')}
            </Typography.Paragraph>
        </DashboardPage>
    )
}
