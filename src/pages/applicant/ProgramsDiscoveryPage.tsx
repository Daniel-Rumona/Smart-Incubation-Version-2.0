import { App, Button, Card, Col, Empty, Input, Modal, Pagination, Row, Segmented, Select, Space, Tag, Typography } from 'antd'
import { AppstoreOutlined, FileTextOutlined, SearchOutlined, StarOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPageShell from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage, tEnglish } from '@/providers/LanguageProvider'
import { getApplicantProfileBundle, isApplicantProfileComplete, listApplicantApplications, listApplicantPrograms } from '@/services/applicantService'
import type { ApplicantProgram } from '@/types/applicant'
import '@/styles/applicant.css'

type ProgramView = 'all' | 'suggested'
const PAGE_SIZE = 5

export const ProgramsDiscoveryPage = () => {
    const { message } = App.useApp()
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)
    const [programs, setPrograms] = useState<ApplicantProgram[]>([])
    const [appliedProgramIds, setAppliedProgramIds] = useState(new Set<string>())
    const [view, setView] = useState<ProgramView>('all')
    const [type, setType] = useState('all')
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const [activeProgram, setActiveProgram] = useState<ApplicantProgram>()
    const [profileComplete, setProfileComplete] = useState(false)

    useEffect(() => {
        const loadPrograms = async () => {
            try {
                const [programRows, applications, profile] = await Promise.all([
                    listApplicantPrograms(user),
                    user ? listApplicantApplications(user.uid, user.email) : Promise.resolve([]),
                    user ? getApplicantProfileBundle(user.uid, user.email) : Promise.resolve(null),
                ])
                setPrograms(programRows)
                setProfileComplete(isApplicantProfileComplete(profile))
                setAppliedProgramIds(new Set(applications.map((application) => application.programId).filter((id): id is string => Boolean(id))))
            } catch {
                message.error(t('applicant.programs.error'))
            } finally {
                setLoading(false)
            }
        }

        void loadPrograms()
    }, [message, t, user])

    const suggestedPrograms = useMemo(() => programs.filter((program) => {
        const text = `${program.name ?? ''} ${program.description ?? ''}`.toLowerCase()
        return ['business', 'funding', 'market', 'support'].some((word) => text.includes(word))
    }), [programs])
    const types = useMemo(() => [...new Set(programs.map((program) => program.type).filter((value): value is string => Boolean(value)))], [programs])
    const filteredPrograms = useMemo(() => {
        const source = view === 'suggested' ? suggestedPrograms : programs
        const term = search.trim().toLowerCase()
        return source.filter((program) => (type === 'all' || program.type === type) && (!term || `${program.name ?? ''} ${program.description ?? ''}`.toLowerCase().includes(term)))
    }, [programs, search, suggestedPrograms, type, view])
    const displayedPrograms = filteredPrograms.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    useRegisterAgentPageContext({
        pageKey: 'applicant-programs',
        pageName: tEnglish('applicant.programs.title'),
        purpose: tEnglish('applicant.programs.subtitle'),
        filters: { search, type, view },
        metrics: { available: programs.length, suggested: suggestedPrograms.length, applied: appliedProgramIds.size },
        tables: { visiblePrograms: displayedPrograms.length },
    })

    return (
        <DashboardPageShell className="applicant-page applicant-programs-page">
            <Row gutter={[12, 12]} className="applicant-metrics">
                <Col xs={12} md={8} className="applicant-metric-col"><DashboardMetricCard loading={loading} icon={<AppstoreOutlined />} label={t('applicant.programs.available')} value={programs.length} hint={t('applicant.programs.open')} /></Col>
                <Col xs={12} md={8} className="applicant-metric-col"><DashboardMetricCard loading={loading} icon={<StarOutlined />} label={t('applicant.programs.suggested')} value={suggestedPrograms.length} hint={t('applicant.programs.matched')} /></Col>
                <Col xs={12} md={8} className="applicant-metric-col"><DashboardMetricCard loading={loading} icon={<FileTextOutlined />} label={t('applicant.programs.applications')} value={appliedProgramIds.size} hint={t('applicant.programs.submitted')} /></Col>
            </Row>

            <FilterBar
                compact
                primary={
                    <>
                        {suggestedPrograms.length > 0 && (
                            <Segmented block value={view} onChange={(value) => { setView(value as ProgramView); setPage(1) }} options={[{ label: t('applicant.programs.all'), value: 'all' }, { label: t('applicant.programs.suggested'), value: 'suggested' }]} />
                        )}
                        <Input prefix={<SearchOutlined />} placeholder={t('applicant.programs.search')} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} allowClear />
                        <Select value={type} onChange={(value) => { setType(value); setPage(1) }} options={[{ label: t('applicant.programs.allTypes'), value: 'all' }, ...types.map((value) => ({ label: value, value }))]} />
                    </>
                }
            />

            {displayedPrograms.length ? (
                <>
                    <Row gutter={[14, 14]}>
                        {displayedPrograms.map((program) => {
                            const applied = appliedProgramIds.has(program.id)
                            return <Col xs={24} md={12} xl={8} key={program.id}><Card className="applicant-card applicant-program-card motion-card" hoverable><Space orientation="vertical" size={10}><Space wrap><Tag color="purple">{program.type ?? t('applicant.programs.general')}</Tag>{program.cohortYear && <Tag>{program.cohortYear}</Tag>}</Space><Typography.Title level={4}>{program.name ?? t('applicant.programs.untitled')}</Typography.Title><Typography.Paragraph type="secondary" ellipsis={{ rows: 3 }}>{program.description ?? t('applicant.programs.noDetails')}</Typography.Paragraph><Button block type={applied ? 'default' : 'primary'} disabled={applied} onClick={() => setActiveProgram(program)}>{applied ? t('applicant.programs.applied') : t('applicant.programs.view')}</Button></Space></Card></Col>
                        })}
                    </Row>
                    {filteredPrograms.length > PAGE_SIZE && <Pagination className="applicant-pagination" current={page} pageSize={PAGE_SIZE} total={filteredPrograms.length} onChange={setPage} showSizeChanger={false} />}
                </>
            ) : <Card className="applicant-card"><Empty description={t('applicant.programs.empty')} /></Card>}

            <Modal
                open={Boolean(activeProgram)}
                title={activeProgram?.name ?? t('applicant.programs.details')} onCancel={() => setActiveProgram(undefined)}
                footer={
                    <Button
                        type="primary"
                        onClick={() =>
                            activeProgram && navigate(
                                profileComplete ? `/applicant/programs/${activeProgram.id}/apply` : '/applicant/profile'
                            )}>
                        {profileComplete ? t('applicant.programs.start') : t('applicant.application.completeProfile')}
                    </Button>}>
                <Typography.Paragraph>
                    {activeProgram?.description ?? t('applicant.programs.noDetails')}</Typography.Paragraph>
                {!profileComplete && <Typography.Text type="warning">{t('applicant.application.profileRequired')}</Typography.Text>}
            </Modal>
        </DashboardPageShell>
    )
}
