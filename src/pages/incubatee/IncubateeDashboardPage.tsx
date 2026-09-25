import { App, Button, Col, Empty, Modal, Row, Skeleton } from 'antd'
import {
    AuditOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    FileTextOutlined,
    FormOutlined,
    SolutionOutlined,
    TeamOutlined,
} from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import MetricsGrid from '@/components/shared/MetricsGrid'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage, tEnglish } from '@/providers/LanguageProvider'
import {
    canAcceptIncubateeIntervention,
    canConfirmIncubateeIntervention,
    listIncubateeOutstandingComplianceDocuments,
    loadIncubateeWorkspace,
} from '@/services/incubateeWorkspaceService'
import type { IncubateeFormAssignment, IncubateeIntervention, IncubateeWorkspace } from '@/types/incubatee'
import '@/styles/incubatee.css'
import { MotionCard } from '@/components/shared/MotionCard'
import { IncubateeItemList, type DashboardItem } from './IncubateeItemList'
import { describeDue } from './incubateeDashboardStatus'
import { buildDemoIncubateeWorkspace, buildDemoOutstandingDocuments, type OutstandingDocument } from './incubateeDemoWorkspace'

type MetricKey = 'documents' | 'accept' | 'confirm' | 'forms'

const isOpenForm = (form: IncubateeFormAssignment) => !['completed', 'submitted'].includes(form.status.toLowerCase())

export const IncubateeDashboardPage = () => {
    const { message } = App.useApp()
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    // `?demo=1` swaps the live workspace for a fixture so the layout can be shown without a seeded participant.
    const isDemo = searchParams.get('demo') === '1'
    const [workspace, setWorkspace] = useState<IncubateeWorkspace | null>()
    const [openMetric, setOpenMetric] = useState<MetricKey | null>(null)
    // Compliance documents are only a count on the workspace, so the list is fetched when it is asked for.
    const [documents, setDocuments] = useState<OutstandingDocument[]>()

    const load = async () => {
        if (isDemo) {
            setWorkspace(buildDemoIncubateeWorkspace())
            return
        }
        if (!user) return
        try {
            setWorkspace(await loadIncubateeWorkspace(user))
        } catch {
            message.error(t('incubatee.common.loadError'))
            setWorkspace(null)
        }
    }

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [user, isDemo]) // eslint-disable-line react-hooks/exhaustive-deps

    const openDocuments = () => {
        setOpenMetric('documents')
        if (documents) return
        if (isDemo) {
            setDocuments(buildDemoOutstandingDocuments())
            return
        }
        if (!user) return
        void listIncubateeOutstandingComplianceDocuments(user)
            .then(setDocuments)
            .catch(() => setDocuments([]))
    }

    const toAccept = useMemo(
        () => workspace?.assignedInterventions.filter(canAcceptIncubateeIntervention) || [],
        [workspace],
    )
    const toConfirm = useMemo(
        () => workspace?.assignedInterventions.filter(canConfirmIncubateeIntervention) || [],
        [workspace],
    )
    const openForms = useMemo(() => workspace?.forms.filter(isOpenForm) || [], [workspace])
    const decisions = useMemo(() => [...toAccept, ...toConfirm], [toAccept, toConfirm])
    const unread = workspace?.notifications.filter((item) => !item.read).length || 0

    useRegisterAgentPageContext({
        pageKey: 'incubatee-dashboard',
        pageName: tEnglish('incubatee.dashboard.title'),
        purpose: tEnglish('incubatee.dashboard.subtitle'),
        metrics: {
            documentsOutstanding: workspace?.outstandingDocuments || 0,
            interventionsToAccept: toAccept.length,
            completionsToConfirm: toConfirm.length,
            formsToComplete: openForms.length,
            unread,
        },
    })

    const reviewAction = (
        <Button
            size="small"
            type="text"
            onClick={() => navigate('/incubatee/interventions')}
        >
            {t('common.review')}
        </Button>
    )

    const interventionItem = (item: IncubateeIntervention): DashboardItem => ({
        id: item.id,
        title: item.title,
        meta: [item.areaOfSupport || t('common.unassigned'), item.assigneeName, describeDue(item.dueDate)].filter(Boolean).join(' · '),
        status: item.status,
        icon: canConfirmIncubateeIntervention(item) ? <CheckCircleOutlined /> : <ClockCircleOutlined />,
        action: reviewAction,
    })

    const formItem = (item: IncubateeFormAssignment): DashboardItem => ({
        id: item.id,
        title: item.title,
        meta: [t(`incubatee.forms.${item.kind}`), describeDue(item.dueAt)].filter(Boolean).join(' · '),
        status: item.status,
        icon: item.kind === 'survey' ? <FormOutlined /> : <SolutionOutlined />,
    })

    const documentItem = (item: OutstandingDocument): DashboardItem => ({
        id: item.id,
        title: item.title,
        meta: item.fileName
            ? [item.fileName, item.expiryDate && `${t('incubatee.dashboard.expires')} ${item.expiryDate}`].filter(Boolean).join(' · ')
            : t('incubatee.dashboard.notUploaded'),
        status: item.status,
        icon: <AuditOutlined />,
    })

    // `undefined` is still loading, `null` means the participant has no accepted programme.
    const loading = workspace === undefined
    if (!loading && !workspace) return <DashboardPage><Empty description={t('incubatee.common.noAcceptedProgram')} /></DashboardPage>

    const metricModals: Record<MetricKey, { title: string, items: DashboardItem[], emptyText: string, action?: { label: string, path: string }, pending?: boolean }> = {
        documents: {
            title: t('incubatee.dashboard.pendingDocuments'),
            items: (documents || []).map(documentItem),
            emptyText: t('incubatee.dashboard.noDocuments'),
            action: { label: t('incubatee.dashboard.openCompliance'), path: '/incubatee/compliance' },
            pending: !documents,
        },
        accept: {
            title: t('incubatee.dashboard.pendingInterventions'),
            items: toAccept.map(interventionItem),
            emptyText: t('incubatee.dashboard.noPendingInterventions'),
            action: { label: t('incubatee.dashboard.openTracker'), path: '/incubatee/interventions' },
        },
        confirm: {
            title: t('incubatee.dashboard.toConfirm'),
            items: toConfirm.map(interventionItem),
            emptyText: t('incubatee.dashboard.noToConfirm'),
            action: { label: t('incubatee.dashboard.openTracker'), path: '/incubatee/interventions' },
        },
        forms: {
            title: t('incubatee.dashboard.pendingForms'),
            items: openForms.map(formItem),
            emptyText: t('incubatee.dashboard.noOpenForms'),
        },
    }

    const activeModal = openMetric ? metricModals[openMetric] : null

    return <DashboardPage className="incubatee-page dashboard-home-page">
        <MetricsGrid>
            <DashboardMetricCard
                loading={loading}
                clickable
                icon={<FileTextOutlined />}
                label={t('incubatee.dashboard.pendingDocuments')}
                mobileTitle={t('incubatee.dashboard.pendingDocumentsMobile', 'Compliance')}
                value={workspace?.outstandingDocuments || 0}
                onClick={openDocuments}
            />

            <DashboardMetricCard
                loading={loading}
                clickable
                onMobile={false}
                icon={<TeamOutlined />}
                label={t('incubatee.dashboard.pendingInterventions')}
                value={toAccept.length}
                onClick={() => setOpenMetric('accept')}
            />

            <DashboardMetricCard
                loading={loading}
                clickable
                icon={<CheckCircleOutlined />}
                label={t('incubatee.dashboard.toConfirm')}
                mobileTitle={t('incubatee.dashboard.toConfirmMobile', 'Completions')}
                value={toConfirm.length}
                onClick={() => setOpenMetric('confirm')}
            />

            <DashboardMetricCard
                loading={loading}
                clickable
                onMobile={false}
                icon={<FormOutlined />}
                label={t('incubatee.dashboard.pendingForms')}
                value={openForms.length}
                onClick={() => setOpenMetric('forms')}
            />
        </MetricsGrid>

        <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
                <MotionCard
                    loading={loading}
                    title={t('incubatee.dashboard.decisions')}
                    extra={<Button type="primary" size="small" onClick={() => navigate('/incubatee/interventions')}>{t('incubatee.dashboard.openTracker')}</Button>}
                    className="incubatee-card"
                >
                    <IncubateeItemList
                        items={decisions.map(interventionItem)}
                        emptyText={t('incubatee.dashboard.noPendingInterventions')}
                    />
                </MotionCard>
            </Col>

            <Col xs={24} lg={12}>
                <MotionCard
                    loading={loading}
                    title={t('incubatee.dashboard.actionCentre')}
                    className="incubatee-card"
                >
                    <IncubateeItemList
                        items={(workspace?.forms || []).map(formItem)}
                        emptyText={t('incubatee.dashboard.noForms')}
                    />
                </MotionCard>
            </Col>
        </Row>

        <Modal
            open={Boolean(activeModal)}
            title={activeModal?.title}
            onCancel={() => setOpenMetric(null)}
            className="incubatee-metric-modal"
            footer={activeModal?.action
                ? <Button type="primary" onClick={() => navigate(activeModal.action!.path)}>{activeModal.action.label}</Button>
                : null}
        >
            {activeModal?.pending
                ? <Skeleton active paragraph={{ rows: 3 }} title={false} />
                : <IncubateeItemList items={activeModal?.items || []} emptyText={activeModal?.emptyText || ''} />}
        </Modal>
    </DashboardPage>
}

export default IncubateeDashboardPage
