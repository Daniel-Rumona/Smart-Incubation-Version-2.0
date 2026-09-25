import { App, Col, Input, Row, Select, Space, Tag, Typography, type TableProps } from 'antd'
import { AppstoreOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, SearchOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPageShell from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage, tEnglish } from '@/providers/LanguageProvider'
import { listApplicantApplications } from '@/services/applicantService'
import type { ApplicantApplication } from '@/types/applicant'
import '@/styles/applicant.css'

const statusColor = (status?: string) => {
    if (status?.toLowerCase() === 'accepted') return 'green'
    if (['declined', 'rejected'].includes(status?.toLowerCase() ?? '')) return 'red'
    return 'gold'
}

export const ApplicationTrackerPage = () => {
    const { message } = App.useApp()
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const [applications, setApplications] = useState<ApplicantApplication[]>([])
    const [loading, setLoading] = useState(false)
    const [status, setStatus] = useState('all')
    const [search, setSearch] = useState('')

    useEffect(() => {
        if (!user) return
        const loadApplications = async () => {
            try {
                setLoading(true)
                setApplications(await listApplicantApplications(user.uid, user.email))
            } catch {
                message.error(t('applicant.tracker.error'))
            } finally {
                setLoading(false)
            }
        }
        void loadApplications()
    }, [message, t, user])

    const counts = useMemo(() => ({
        accepted: applications.filter((row) => row.applicationStatus?.toLowerCase() === 'accepted').length,
        pending: applications.filter((row) => !['accepted', 'declined', 'rejected'].includes(row.applicationStatus?.toLowerCase() ?? '')).length,
        rejected: applications.filter((row) => ['declined', 'rejected'].includes(row.applicationStatus?.toLowerCase() ?? '')).length,
    }), [applications])
    const visibleApplications = useMemo(() => applications.filter((row) => {
        const normalizedStatus = row.applicationStatus?.toLowerCase() ?? 'pending'
        const matchesStatus = status === 'all' || (status === 'rejected' ? ['declined', 'rejected'].includes(normalizedStatus) : normalizedStatus === status)
        return matchesStatus && (!search.trim() || (row.programName ?? '').toLowerCase().includes(search.trim().toLowerCase()))
    }), [applications, search, status])

    useRegisterAgentPageContext({
        pageKey: 'applicant-application-tracker',
        pageName: tEnglish('applicant.tracker.title'),
        purpose: tEnglish('applicant.tracker.subtitle'),
        filters: { search, status },
        metrics: { total: applications.length, ...counts },
        tables: { visibleApplications: visibleApplications.length },
    })

    const columns: TableProps<ApplicantApplication>['columns'] = [
        { title: t('applicant.tracker.program'), dataIndex: 'programName', render: (value: string | undefined) => value ?? t('applicant.tracker.fallbackProgram') },
        { title: t('applicant.tracker.status'), dataIndex: 'applicationStatus', render: (value: string | undefined) => <Tag color={statusColor(value)}>{value?.toUpperCase() ?? t('applicant.tracker.pending').toUpperCase()}</Tag> },
        { title: t('applicant.tracker.compliance'), dataIndex: 'complianceScore', render: (value: number | undefined) => <Typography.Text strong>{value ?? 0}%</Typography.Text> },
    ]

    return (
        <DashboardPageShell className="applicant-page">
            <Row gutter={[12, 12]} className="applicant-metrics">
                <Col xs={12} md={6} className="applicant-metric-col"><DashboardMetricCard icon={<AppstoreOutlined />} label={t('applicant.tracker.total')} value={applications.length} /></Col>
                <Col xs={12} md={6} className="applicant-metric-col"><DashboardMetricCard icon={<ClockCircleOutlined />} label={t('applicant.tracker.pending')} value={counts.pending} /></Col>
                <Col xs={12} md={6} className="applicant-metric-col"><DashboardMetricCard icon={<CheckCircleOutlined />} label={t('applicant.tracker.accepted')} value={counts.accepted} /></Col>
                <Col xs={12} md={6} className="applicant-metric-col"><DashboardMetricCard icon={<CloseCircleOutlined />} label={t('applicant.tracker.rejected')} value={counts.rejected} /></Col>
            </Row>
            <FilterBar
                title={t('applicant.tracker.title')}
                primary={<Select value={status} onChange={setStatus} options={['all', 'pending', 'accepted', 'rejected'].map((value) => ({ value, label: t(`applicant.tracker.${value}`) }))} />}
                advanced={<Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('applicant.tracker.search')} allowClear />}
            />
            <ResponsiveDataView
                rowKey="id"
                rows={visibleApplications}
                columns={columns}
                loading={loading}
                emptyText={t('applicant.tracker.empty')}
                renderCard={(application) => (
                    <Space orientation="vertical" size={8}>
                        <Typography.Text strong>{application.programName ?? t('applicant.tracker.fallbackProgram')}</Typography.Text>
                        <Tag color={statusColor(application.applicationStatus)}>{application.applicationStatus?.toUpperCase() ?? t('applicant.tracker.pending').toUpperCase()}</Tag>
                        <Typography.Text type="secondary">{t('applicant.tracker.compliance')}: <strong>{application.complianceScore ?? 0}%</strong></Typography.Text>
                    </Space>
                )}
            />
        </DashboardPageShell>
    )
}
