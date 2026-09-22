import { Alert, App, Button, Card, Col, ConfigProvider, Descriptions, Input, Modal, Row, Space, Tag, theme as antdTheme, Typography, type TableProps } from 'antd'
import { CheckCircleOutlined, DownloadOutlined, FileAddOutlined, PlusOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { getFirebaseDb, isFirebaseConfigured } from '@/config/firebase'
import { hasRolePermission } from '@/config/permissions'
import { lightTheme } from '@/config/theme'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import {
    confirmDiagnosticPlan,
    listDiagnosticInterventionOptions,
    listDiagnosticPlanParticipants,
    saveDiagnosticPlan,
} from '@/services/diagnosticPlansService'
import type { DiagnosticInterventionOption, DiagnosticPlanParticipant } from '@/types/diagnosticPlan'
import { useAssignedInterventions } from '@/contexts/AssignedInterventionsContext'
import { buildLivePlanItems, livePlanProgress } from '@/utils/liveDiagnosticPlan'
import '@/styles/operations-diagnostics.css'

type StatusFilter = 'All' | 'Draft' | 'Confirmed'

type AiSuggestedIntervention = {
    area: string
    title: string
    matchedOption?: DiagnosticInterventionOption
}

const statusColor = (status: DiagnosticPlanParticipant['plan']['status']) => status === 'Confirmed' ? 'green' : 'orange'
const emptyValue = 'N/A'

const cleanFileName = (value: string) =>
    value.replace(/[^\w.-]+/g, '-').replace(/(^-|-$)/g, '').toLowerCase() || 'diagnostic-plan'

const escapeHtml = (value: unknown) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[char] || char)

const normalizeText = (value: unknown) =>
    String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

const displayValue = (value: unknown) =>
    String(value ?? '').trim() || emptyValue

const displayScore = (value: unknown) => {
    if (value === undefined || value === null || value === '') return emptyValue
    const text = String(value)
    return text.endsWith('%') ? text : `${text}%`
}

const formatDate = (value: unknown) => {
    if (!value) return emptyValue

    const candidate = typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function'
        ? value.toDate()
        : typeof value === 'object' && value && 'seconds' in value && typeof value.seconds === 'number'
            ? new Date(value.seconds * 1000)
            : new Date(value as string | number | Date)

    return Number.isNaN(candidate.getTime()) ? emptyValue : candidate.toLocaleDateString()
}

const getRecordValue = (record: Record<string, unknown> | undefined, aliases: string[]) => {
    if (!record) return undefined

    for (const key of aliases) {
        if (record[key] !== undefined && record[key] !== null && record[key] !== '') return record[key]
    }

    const normalizedLookup = new Map(
        Object.entries(record).map(([key, value]) => [normalizeText(key), value]),
    )

    for (const key of aliases) {
        const value = normalizedLookup.get(normalizeText(key))
        if (value !== undefined && value !== null && value !== '') return value
    }

    return undefined
}

const getAiRecommendation = (participant: DiagnosticPlanParticipant): Record<string, unknown> => {
    const raw = participant as unknown as Record<string, unknown>

    return (
        raw.aiRecommendation as Record<string, unknown> | undefined
        || {}
    )
}

const getAiField = (participant: DiagnosticPlanParticipant, aliases: string[]) => {
    const recommendation = getAiRecommendation(participant)
    return getRecordValue(recommendation, aliases)
}

const getAiRecommendedInterventions = (
    participant: DiagnosticPlanParticipant,
    catalogue: DiagnosticInterventionOption[],
): AiSuggestedIntervention[] => {
    const recommendation = getAiRecommendation(participant)

    const recommended = getRecordValue(recommendation, [
        'Recommended Interventions',
        'RecommendedInterventions',
        'recommendedInterventions',
    ])

    if (!recommended || typeof recommended !== 'object' || Array.isArray(recommended)) return []

    const catalogueByTitle = new Map(
        catalogue.map((item) => [normalizeText(item.title), item]),
    )

    return Object.entries(recommended as Record<string, unknown>).flatMap(([area, value]) => {
        if (normalizeText(area) === 'error') return []
        if (!Array.isArray(value)) return []

        return value.flatMap((titleValue) => {
            const title = String(titleValue ?? '').trim()
            if (!title || normalizeText(title) === 'error') return []

            return [{
                area,
                title,
                matchedOption: catalogueByTitle.get(normalizeText(title)),
            }]
        })
    })
}

const DividerTitle = ({ children }: { children: string }) => (
    <div className="diagnostic-document-divider">
        <span>{children}</span>
    </div>
)

export const DiagnosticPlansPage = () => {
    const { message } = App.useApp()
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const { assignments } = useAssignedInterventions()

    const [participants, setParticipants] = useState<DiagnosticPlanParticipant[]>([])
    const [catalogue, setCatalogue] = useState<DiagnosticInterventionOption[]>([])
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState<StatusFilter>('All')
    const [selected, setSelected] = useState<DiagnosticPlanParticipant>()
    const [selectedInterventions, setSelectedInterventions] = useState<DiagnosticInterventionOption[]>([])
    const [companyLogoUrl, setCompanyLogoUrl] = useState('')

    const companyCode = String(user?.companyCode || '').trim()
    const canManage = !!user && hasRolePermission(user.role, 'manage_diagnostic_plans', user.permissions)

    const tt = (key: string, fallback: string) => {
        const value = t(key)
        return value === key ? fallback : value
    }

    const load = async () => {
        if (!user) return

        try {
            setLoading(true)

            const [participantRows, interventionRows] = await Promise.all([
                listDiagnosticPlanParticipants(user, activeProgramId),
                listDiagnosticInterventionOptions(companyCode),
            ])

            setParticipants(participantRows)
            setCatalogue(interventionRows)

            console.log('[DiagnosticPlansPage] loaded', {
                companyCode,
                participants: participantRows.length,
                interventions: interventionRows.length,
                firstIntervention: interventionRows[0],
                selectedAiRecommendation: participantRows[0]?.aiRecommendation,
            })
        } catch {
            message.error(t('operations.diagnostics.loadError'))
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [activeProgramId, user?.uid, companyCode])

    useEffect(() => {
        let cancelled = false

        const loadCompanyLogo = async () => {
            if (!isFirebaseConfigured || !companyCode) {
                setCompanyLogoUrl('')
                return
            }

            try {
                const snapshot = await getDoc(doc(getFirebaseDb(), 'companies', companyCode))
                if (!cancelled) {
                    setCompanyLogoUrl(String(snapshot.exists() ? snapshot.data()?.logoUrl || '' : '').trim())
                }
            } catch {
                if (!cancelled) setCompanyLogoUrl('')
            }
        }

        void loadCompanyLogo()

        return () => {
            cancelled = true
        }
    }, [companyCode])

    const companyCatalogue = useMemo(() => catalogue, [catalogue])

    const openPlan = (participant: DiagnosticPlanParticipant) => {
        const known = new Map(companyCatalogue.map((item) => [item.interventionId, item]))
        const openedAiSuggestions = getAiRecommendedInterventions(participant, companyCatalogue)

        console.log('[DiagnosticPlansPage] opened SME', {
            businessName: participant.businessName,
            applicationId: participant.applicationId,
            catalogueCount: companyCatalogue.length,
            aiRecommendation: (participant as unknown as Record<string, unknown>).aiRecommendation,
            aiSuggestionCount: openedAiSuggestions.length,
            aiSuggestions: openedAiSuggestions,
            currentPlanInterventions: participant.plan.interventions,
        })

        setSelected(participant)
        setSelectedInterventions(participant.plan.interventions.map((item) => known.get(item.interventionId) || item))
    }

    const persist = async (confirm = false) => {
        if (!user || !selected) return

        if (confirm && !user.signatureURL) {
            message.error('Set up your signature before confirming the growth plan.')
            return
        }

        try {
            setSaving(true)
            await saveDiagnosticPlan(user, selected, selectedInterventions)
            if (confirm) await confirmDiagnosticPlan(user, selected, user.signatureURL)

            message.success(t(confirm ? 'operations.diagnostics.confirmedMessage' : 'operations.diagnostics.saved'))
            await load()
            setSelected(undefined)
        } catch (error) {
            console.error('[DIAGNOSTIC PLANS] Save/confirmation failed:', error)
            const detail = error instanceof Error ? error.message : ''
            message.error(detail && detail !== 'forbidden'
                ? `${t('operations.diagnostics.saveError')} (${detail})`
                : t('operations.diagnostics.saveError'))
        } finally {
            setSaving(false)
        }
    }

    const rows = useMemo(() => participants.filter((participant) => {
        const needle = search.trim().toLowerCase()

        return (
            (!needle || `${participant.businessName} ${participant.participantName || ''} ${participant.email || ''}`.toLowerCase().includes(needle))
            && (status === 'All' || participant.plan.status === status)
        )
    }), [participants, search, status])

    const liveForParticipant = (participant: DiagnosticPlanParticipant, interventions = participant.plan.interventions) => buildLivePlanItems(interventions, assignments.filter(assignment => String(assignment.participantId || '') === participant.id) as unknown as Array<Record<string, unknown>>)
    const selectedLiveInterventions = useMemo(() => selected ? liveForParticipant(selected, selectedInterventions) : [], [assignments, selected, selectedInterventions]) // eslint-disable-line react-hooks/exhaustive-deps

    const aiSuggestions = useMemo(() => {
        if (!selected) return []
        return getAiRecommendedInterventions(selected, companyCatalogue)
    }, [selected, companyCatalogue])

    const matchedAiSuggestions = useMemo(
        () => aiSuggestions.filter((item) => item.matchedOption),
        [aiSuggestions],
    )

    const metrics = useMemo(() => ({
        participants: participants.length,
        confirmed: participants.filter((item) => item.plan.status === 'Confirmed').length,
        draft: participants.filter((item) => item.plan.status === 'Draft').length,
        interventions: participants.reduce((total, item) => total + item.plan.interventions.length, 0),
    }), [participants])

    useRegisterAgentPageContext({
        pageKey: 'operations-diagnostic-plans',
        pageName: t('nav.diagnosticPlans'),
        purpose: t('operations.diagnostics.subtitle'),
        filters: { search, status, activeProgramId, companyCode },
        metrics,
        tables: { visiblePlans: rows.length },
        selectedRecord: selected?.businessName,
    })

    const columns: TableProps<DiagnosticPlanParticipant>['columns'] = [
        {
            title: t('operations.participants.enterprise'),
            dataIndex: 'businessName',
            render: (value: string, row) => (
                <Space orientation="vertical" size={0}>
                    <Typography.Text strong>{value}</Typography.Text>
                    <Typography.Text type="secondary">{row.email || t('common.noEmail')}</Typography.Text>
                </Space>
            ),
        },
        {
            title: t('operations.participants.programme'),
            dataIndex: 'programName',
            render: (value?: string) => value || t('common.unassigned'),
        },
        {
            title: t('operations.diagnostics.interventions'),
            render: (_, row) => row.plan.interventions.length,
        },
        {
            title: t('common.status'),
            render: (_, row) => (
                <Tag color={statusColor(row.plan.status)}>
                    {t(`operations.diagnostics.${row.plan.status.toLowerCase()}`)}
                </Tag>
            ),
        },
        {
            title: t('common.actions'),
            render: (_, row) => (
                <Button onClick={() => openPlan(row)}>
                    {tt('common.view', 'View')}
                </Button>
            ),
        },
    ]

    const addMatchedAiSuggestions = () => {
        setSelectedInterventions((current) => {
            const existing = new Set(current.map((item) => item.interventionId))
            const additions = matchedAiSuggestions
                .map((item) => item.matchedOption)
                .filter((item): item is DiagnosticInterventionOption => !!item && !existing.has(item.interventionId))

            return [...current, ...additions]
        })
    }

    const operationsSignature = (participant: DiagnosticPlanParticipant) => participant.plan.confirmedMeta?.operations
    const smeSignature = (participant: DiagnosticPlanParticipant) =>
        participant.plan.confirmedMeta?.participant
        || participant.plan.confirmedMeta?.incubatee
        || participant.plan.confirmedMeta?.sme

    const signatureHtml = (title: string, meta?: { name?: string, email?: string, signatureURL?: string, confirmedAt?: string }) => `
        <td>
            <strong>${escapeHtml(title)}</strong><br />
            ${meta?.signatureURL ? `<img class="signature-img" src="${escapeHtml(meta.signatureURL)}" alt="${escapeHtml(title)} signature" />` : '<div class="signature-missing">Pending signature</div>'}
            <div>${escapeHtml(displayValue(meta?.name || meta?.email))}</div>
            <div>${escapeHtml(meta?.confirmedAt ? new Date(meta.confirmedAt).toLocaleString() : emptyValue)}</div>
        </td>
    `

    const buildDocumentHtml = (participant: DiagnosticPlanParticipant) => {
        const interventions = selectedInterventions.length ? selectedInterventions : participant.plan.interventions
        const opsMeta = operationsSignature(participant)
        const smeMeta = smeSignature(participant)
        const participantAiSuggestions = getAiRecommendedInterventions(participant, companyCatalogue)
        const participantAiScore = getAiField(participant, ['AI Score', 'aiScore'])
        const participantAiRecommendation = getAiField(participant, ['AI Recommendation', 'aiRecommendation'])
        const participantAiJustification = getAiField(participant, ['Justification', 'justification'])

        const swotRows = Array.from({
            length: Math.max(
                participant.swot.strengths.length,
                participant.swot.weaknesses.length,
                participant.swot.opportunities.length,
                participant.swot.threats.length,
                1,
            ),
        }).map((_, index) => `
            <tr>
                <td>${escapeHtml(participant.swot.strengths[index] || emptyValue)}</td>
                <td>${escapeHtml(participant.swot.weaknesses[index] || emptyValue)}</td>
                <td>${escapeHtml(participant.swot.opportunities[index] || emptyValue)}</td>
                <td>${escapeHtml(participant.swot.threats[index] || emptyValue)}</td>
            </tr>
        `).join('')

        const liveInterventions = liveForParticipant(participant, interventions)
        const interventionRows = liveInterventions.length
            ? liveInterventions.map((item, index) => `
                <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(item.title)}</td>
                    <td>${escapeHtml(item.areaOfSupport || emptyValue)}</td>
                    <td>${escapeHtml(item.status)}</td>
                    <td>${item.progress}%</td>
                </tr>
            `).join('')
            : `<tr><td colspan="5">${escapeHtml(t('operations.diagnostics.noSelectedInterventions'))}</td></tr>`

        const aiRows = participantAiSuggestions.length
            ? participantAiSuggestions.map((item, index) => `
                <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(item.title)}</td>
                    <td>${escapeHtml(item.area)}</td>
                </tr>
            `).join('')
            : `<tr><td colspan="3">${escapeHtml(emptyValue)}</td></tr>`

        return `<!doctype html>
            <html>
            <head>
                <meta charset="utf-8" />
                <title>${escapeHtml(participant.businessName)} Diagnostic Growth Plan</title>
                <style>
                    body { font-family: Arial, sans-serif; color: #1f2937; margin: 28px; }
                    .header { border: 1px solid #d9d9d9; padding: 28px; display: table; width: 100%; box-sizing: border-box; }
                    .logo, .title { display: table-cell; vertical-align: middle; }
                    .logo { width: 230px; text-align: center; }
                    .logo img { max-width: 190px; max-height: 82px; object-fit: contain; }
                    .logo-fallback { border: 1px solid #d9d9d9; padding: 18px; font-weight: 700; color: #334155; }
                    .enterprise { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
                    h1 { font-size: 34px; margin: 0; color: #111827; }
                    h2 { border-bottom: 1px solid #d9d9d9; color: #111827; font-size: 18px; margin-top: 28px; padding-bottom: 8px; text-align: center; }
                    table { border-collapse: collapse; width: 100%; margin-top: 12px; table-layout: fixed; }
                    th, td { border: 1px solid #d9d9d9; padding: 9px 10px; vertical-align: top; word-break: normal; overflow-wrap: anywhere; }
                    th { background: #f8fafc; text-align: left; }
                    .label { background: #f8fafc; font-weight: 700; width: 22%; }
                    .signature-img { display: block; height: 70px; margin: 12px 0; max-width: 190px; object-fit: contain; }
                    .signature-missing { border: 1px dashed #cbd5e1; color: #64748b; margin: 12px 0; padding: 22px; text-align: center; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="logo">${companyLogoUrl ? `<img src="${escapeHtml(companyLogoUrl)}" alt="Company logo" />` : '<div class="logo-fallback">Company Logo</div>'}</div>
                    <div class="title">
                        <div class="enterprise">${escapeHtml(participant.businessName || 'SME')}</div>
                        <h1>Diagnostic Growth Plan</h1>
                    </div>
                </div>

                <h2>Business Overview</h2>
                <table>
                    <tr><td class="label">Business Owner</td><td>${escapeHtml(displayValue(participant.participantName))}</td><td class="label">SME Name</td><td>${escapeHtml(displayValue(participant.businessName))}</td></tr>
                    <tr><td class="label">Program</td><td>${escapeHtml(displayValue(participant.programName))}</td><td class="label">Email</td><td>${escapeHtml(displayValue(participant.email))}</td></tr>
                    <tr><td class="label">Sector</td><td>${escapeHtml(displayValue(participant.sector))}</td><td class="label">Stage</td><td>${escapeHtml(displayValue(participant.stage))}</td></tr>
                    <tr><td class="label">Province</td><td>${escapeHtml(displayValue(participant.province))}</td><td class="label">Plan Status</td><td>${escapeHtml(participant.plan.status)}</td></tr>
                </table>

                <h2>Application Summary</h2>
                <table>
                    <tr><td class="label">Applied</td><td>${escapeHtml(formatDate(participant.applicationSummary.submittedAt))}</td><td class="label">Compliance Score</td><td>${escapeHtml(displayScore(participant.applicationSummary.complianceScore))}</td></tr>
                    <tr><td class="label">AI Score</td><td>${escapeHtml(displayValue(participantAiScore ?? participant.applicationSummary.aiScore))}</td><td class="label">AI Recommendation</td><td>${escapeHtml(displayValue(participantAiRecommendation ?? participant.applicationSummary.aiRecommendation))}</td></tr>
                    <tr><td class="label">AI Justification</td><td colspan="3">${escapeHtml(displayValue(participantAiJustification))}</td></tr>
                    <tr><td class="label">Motivation</td><td colspan="3">${escapeHtml(displayValue(participant.applicationSummary.motivation))}</td></tr>
                    <tr><td class="label">Challenges</td><td colspan="3">${escapeHtml(displayValue(participant.applicationSummary.challenges))}</td></tr>
                </table>

                <h2>AI Suggested Interventions</h2>
                <table>
                    <tr><th>#</th><th>Intervention</th><th>Area of Support</th></tr>
                    ${aiRows}
                </table>

                <h2>SWOT Analysis</h2>
                <table>
                    <tr><th>Strengths</th><th>Weaknesses</th><th>Opportunities</th><th>Threats</th></tr>
                    ${swotRows}
                </table>

                <h2>Required Interventions</h2>
                <p><strong>Live overall progress:</strong> ${livePlanProgress(liveInterventions)}%</p>
                <table>
                    <tr><th>#</th><th>Title</th><th>Area of Support</th><th>Live Status</th><th>Progress</th></tr>
                    ${interventionRows}
                </table>

                <h2>Signatures</h2>
                <table><tr>${signatureHtml('Operations Signature', opsMeta)}${signatureHtml('SME Signature', smeMeta)}</tr></table>
            </body>
            </html>`
    }

    const downloadDocument = (participant: DiagnosticPlanParticipant) => {
        const blob = new Blob([buildDocumentHtml(participant)], { type: 'application/msword;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')

        link.href = url
        link.download = `${cleanFileName(participant.businessName)}-diagnostic-growth-plan.doc`

        document.body.appendChild(link)
        link.click()
        link.remove()

        URL.revokeObjectURL(url)
    }

    return (
        <DashboardPage className="operations-diagnostics-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}>
                    <DashboardMetricCard icon={<TeamOutlined />} label={t('nav.participants')} value={metrics.participants} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        icon={<CheckCircleOutlined />}
                        label={t('operations.diagnostics.confirmedPlans')}
                        value={metrics.confirmed}
                        hint={status === 'Confirmed' ? tt('operations.diagnostics.filterActive', 'Filter active — click to clear') : tt('operations.diagnostics.clickToFilter', 'Click to filter')}
                        clickable
                        onClick={() => setStatus((current) => current === 'Confirmed' ? 'All' : 'Confirmed')}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        icon={<FileAddOutlined />}
                        label={t('operations.diagnostics.draftPlans')}
                        value={metrics.draft}
                        hint={status === 'Draft' ? tt('operations.diagnostics.filterActive', 'Filter active — click to clear') : tt('operations.diagnostics.clickToFilter', 'Click to filter')}
                        clickable
                        onClick={() => setStatus((current) => current === 'Draft' ? 'All' : 'Draft')}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard icon={<FileAddOutlined />} label={t('operations.diagnostics.interventions')} value={metrics.interventions} />
                </Col>
            </Row>

            <FilterBar
                primary={(
                    <Input
                        prefix={<SearchOutlined />}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t('operations.diagnostics.search')}
                        allowClear
                    />
                )}
            />

            <Card>
                <ResponsiveDataView
                    rowKey={(row) => `${row.applicationId}-${row.id}`}
                    rows={rows}
                    columns={columns}
                    loading={loading}
                    emptyText={t('operations.diagnostics.empty')}
                    renderCard={(row) => (
                        <Space orientation="vertical" size={8}>
                            <Typography.Text strong>{row.businessName}</Typography.Text>
                            <Typography.Text type="secondary">{row.email || t('common.noEmail')}</Typography.Text>
                            <Space wrap>
                                <Tag>{row.programName || t('common.unassigned')}</Tag>
                                <Tag color={statusColor(row.plan.status)}>
                                    {t(`operations.diagnostics.${row.plan.status.toLowerCase()}`)}
                                </Tag>
                            </Space>
                            <Typography.Text>
                                {row.plan.interventions.length} {t('operations.diagnostics.interventions').toLowerCase()}
                            </Typography.Text>
                            <Button onClick={() => openPlan(row)}>
                                {tt('common.view', 'View')}
                            </Button>
                        </Space>
                    )}
                />
            </Card>

            <Modal
                open={!!selected}
                onCancel={() => setSelected(undefined)}
                title={selected?.businessName}
                footer={selected ? (
                    <Space wrap className="diagnostic-modal-footer">
                        <Button danger onClick={() => setSelected(undefined)}>
                            {t('common.cancel')}
                        </Button>

                        <Button icon={<DownloadOutlined />} onClick={() => downloadDocument(selected)}>{t('common.download')}</Button>

                        {canManage && selected.plan.status !== 'Confirmed' && (
                            <>
                                <Button loading={saving} onClick={() => void persist()}>
                                    {t('common.save')}
                                </Button>
                                <Button
                                    type="primary"
                                    loading={saving}
                                    disabled={!selectedInterventions.length || !user?.signatureURL}
                                    onClick={() => void persist(true)}
                                >
                                    {t('operations.diagnostics.confirmPlan')}
                                </Button>
                            </>
                        )}
                    </Space>
                ) : null}
                width={1040}
                centered
                className="diagnostic-plan-modal"
            >
                {selected && (
                    <Space orientation="vertical" size={16} className="operations-diagnostic-detail">
                        {selected.plan.status !== 'Confirmed' && (
                            <Alert type="info" showIcon message={t('operations.diagnostics.reviewHint')} />
                        )}

                        {selected.plan.status !== 'Confirmed' && !user?.signatureURL && (
                            <Alert type="warning" showIcon message="Set up your signature before confirming the growth plan." />
                        )}

                        {/* The paper is always a light page, so the antd components rendered inside it (Descriptions,
                            Card, Tag...) need light-theme tokens even when the app is in dark mode, or their text
                            renders in dark-mode-appropriate light colors that are invisible on the white paper. */}
                        <ConfigProvider theme={{ ...lightTheme, algorithm: antdTheme.defaultAlgorithm }}>
                        <article className="diagnostic-document">
                            <header className="diagnostic-document-header">
                                <div className="diagnostic-document-logo">
                                    {companyLogoUrl
                                        ? <img src={companyLogoUrl} alt="Company logo" />
                                        : <Typography.Text strong>Company Logo</Typography.Text>}
                                </div>

                                <div className="diagnostic-document-title">
                                    <Typography.Text>{selected.businessName || 'SME'}</Typography.Text>
                                    <Typography.Title level={2}>Diagnostic Growth Plan</Typography.Title>
                                </div>
                            </header>

                            <DividerTitle>Business Overview</DividerTitle>

                            <Descriptions
                                bordered
                                size="small"
                                column={{ xs: 1, md: 2 }}
                                className="diagnostic-clean-descriptions"
                                items={[
                                    { key: 'owner', label: 'Business Owner', children: displayValue(selected.participantName) },
                                    { key: 'business', label: 'SME Name', children: displayValue(selected.businessName) },
                                    { key: 'program', label: t('operations.participants.programme'), children: selected.programName || t('common.unassigned') },
                                    { key: 'email', label: t('common.email'), children: selected.email || t('common.noEmail') },
                                    { key: 'sector', label: t('common.sector'), children: displayValue(selected.sector) },
                                    { key: 'stage', label: t('common.stage'), children: displayValue(selected.stage) },
                                    { key: 'province', label: t('common.province'), children: displayValue(selected.province) },
                                    {
                                        key: 'status',
                                        label: t('common.status'),
                                        children: (
                                            <Tag color={statusColor(selected.plan.status)}>
                                                {t(`operations.diagnostics.${selected.plan.status.toLowerCase()}`)}
                                            </Tag>
                                        ),
                                    },
                                ]}
                            />

                            <DividerTitle>SWOT Analysis</DividerTitle>

                            <div className="diagnostic-table-wrap">
                                <table className="diagnostic-document-table">
                                    <thead>
                                        <tr>
                                            <th>{t('operations.diagnostics.strengths')}</th>
                                            <th>{t('operations.diagnostics.weaknesses')}</th>
                                            <th>{t('operations.diagnostics.opportunities')}</th>
                                            <th>{t('operations.diagnostics.threats')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Array.from({
                                            length: Math.max(
                                                selected.swot.strengths.length,
                                                selected.swot.weaknesses.length,
                                                selected.swot.opportunities.length,
                                                selected.swot.threats.length,
                                                1,
                                            ),
                                        }).map((_, index) => (
                                            <tr key={index}>
                                                <td>{selected.swot.strengths[index] || emptyValue}</td>
                                                <td>{selected.swot.weaknesses[index] || emptyValue}</td>
                                                <td>{selected.swot.opportunities[index] || emptyValue}</td>
                                                <td>{selected.swot.threats[index] || emptyValue}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {aiSuggestions.length > 0 && (
                                <>
                                    <DividerTitle>{tt('operations.diagnostics.aiSuggestedInterventions', 'AI Suggested Interventions')}</DividerTitle>

                                    <Card
                                        size="small"
                                        className="diagnostic-ai-suggestions-card"
                                        extra={canManage && selected.plan.status !== 'Confirmed' && matchedAiSuggestions.length > 0 ? (
                                            <Button size="small" icon={<PlusOutlined />} onClick={addMatchedAiSuggestions}>
                                                {tt('operations.diagnostics.addMatchedSuggestions', 'Add matched')}
                                            </Button>
                                        ) : null}
                                    >
                                        <Space direction="vertical" size={10} className="diagnostic-ai-suggestions-list">
                                            {aiSuggestions.map((item) => (
                                                <div key={`${item.area}-${item.title}`} className="diagnostic-ai-suggestion-item">
                                                    <div>
                                                        <Typography.Text strong>{item.title}</Typography.Text>
                                                        <Typography.Text type="secondary">{item.area}</Typography.Text>
                                                    </div>
                                                    <Tag color={item.matchedOption ? 'blue' : 'orange'}>
                                                        {item.matchedOption
                                                            ? tt('operations.diagnostics.catalogueMatch', 'Catalogue match')
                                                            : tt('operations.diagnostics.notInCatalogue', 'Not in catalogue')}
                                                    </Tag>
                                                </div>
                                            ))}
                                        </Space>
                                    </Card>
                                </>
                            )}

                            <DividerTitle>{t('operations.diagnostics.requiredInterventions')}</DividerTitle>

                            <div className="diagnostic-table-wrap">
                                <table className="diagnostic-document-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>{t('incubatee.tracker.intervention')}</th>
                                            <th>{t('incubatee.tracker.area')}</th>
                                            <th>Status</th>
                                            <th>Progress</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedLiveInterventions.length ? selectedLiveInterventions.map((item, index) => (
                                            <tr key={item.interventionId || item.title}>
                                                <td>{index + 1}</td>
                                                <td>{item.title}</td>
                                                <td>{item.areaOfSupport || emptyValue}</td>
                                                <td><Tag color={item.status === 'Completed' ? 'green' : item.status === 'In progress' ? 'blue' : item.status === 'Awaiting action' ? 'orange' : 'default'}>{item.status}</Tag></td>
                                                <td>{item.progress}%</td>
                                            </tr>
                                        )) : (
                                            <tr>
                                                <td colSpan={5}>{t('operations.diagnostics.noSelectedInterventions')}</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            <DividerTitle>Signatures</DividerTitle>

                            <Row gutter={[12, 12]}>
                                <Col xs={24} md={12}>
                                    <div className="diagnostic-signature-box">
                                        <Typography.Text strong>Operations Signature</Typography.Text>
                                        {operationsSignature(selected)?.signatureURL
                                            ? <img src={operationsSignature(selected)?.signatureURL} alt="Operations signature" />
                                            : <div className="diagnostic-signature-empty">Pending signature</div>}
                                        <Typography.Text>{displayValue(operationsSignature(selected)?.name || operationsSignature(selected)?.email)}</Typography.Text>
                                        <Typography.Text type="secondary">
                                            {operationsSignature(selected)?.confirmedAt
                                                ? new Date(operationsSignature(selected)?.confirmedAt || '').toLocaleString()
                                                : emptyValue}
                                        </Typography.Text>
                                    </div>
                                </Col>

                                <Col xs={24} md={12}>
                                    <div className="diagnostic-signature-box">
                                        <Typography.Text strong>SME Signature</Typography.Text>
                                        {smeSignature(selected)?.signatureURL
                                            ? <img src={smeSignature(selected)?.signatureURL} alt="SME signature" />
                                            : <div className="diagnostic-signature-empty">Pending signature</div>}
                                        <Typography.Text>{displayValue(smeSignature(selected)?.name || smeSignature(selected)?.email)}</Typography.Text>
                                        <Typography.Text type="secondary">
                                            {smeSignature(selected)?.confirmedAt
                                                ? new Date(smeSignature(selected)?.confirmedAt || '').toLocaleString()
                                                : emptyValue}
                                        </Typography.Text>
                                    </div>
                                </Col>
                            </Row>
                        </article>
                        </ConfigProvider>
                    </Space>
                )}
            </Modal>
        </DashboardPage>
    )
}
