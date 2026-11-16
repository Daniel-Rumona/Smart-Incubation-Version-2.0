import { useMemo, useState } from 'react'
import { Alert, App, Button, Checkbox, Empty, Segmented, Space, Spin, Tag, Typography } from 'antd'
import { CheckCircleOutlined, PlusOutlined, ReloadOutlined, RobotOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { ModalActions } from '@/components/shared/ModalActions'
import SurveyResponseViewer from '@/components/surveys/SurveyResponseViewer'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import {
    addGapInterventionsToPlan,
    analyseGapResponse,
    gapAnalysisAvailable,
    type GapSuggestedIntervention,
    type StoredGapAnalysis,
} from '@/services/gapAnalysisService'
import type { SurveyResponseRow } from '@/services/surveyResponsesService'
import type { SurveyTemplate } from '@/services/surveyTemplatesService'
import type { DiagnosticInterventionOption, DiagnosticPlanParticipant } from '@/types/diagnosticPlan'

type GapReviewModalProps = {
    template: SurveyTemplate
    row: SurveyResponseRow | null
    analysis?: StoredGapAnalysis
    participant?: DiagnosticPlanParticipant
    catalogue: DiagnosticInterventionOption[]
    onClose: () => void
    /** A new or updated analysis, so the list can show it without reloading. */
    onAnalysed: (analysis: StoredGapAnalysis) => void
    /** The plan changed; the page reloads its participants so "on plan" stays true. */
    onPlanChanged: () => void
}

type View = 'analysis' | 'answers'

const PRIORITY_COLOR = { High: 'red', Medium: 'orange', Low: 'green' } as const

/** One SME's gap analysis: their answers, the AI read of them, and the interventions it proposes. */
export default function GapReviewModal({ template, row, analysis, participant, catalogue, onClose, onAnalysed, onPlanChanged }: GapReviewModalProps) {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    // The page keys this modal by SME, so these start fresh for each one.
    const [view, setView] = useState<View>(() => (analysis ? 'analysis' : 'answers'))
    const [analysing, setAnalysing] = useState(false)
    const [adding, setAdding] = useState(false)
    const [error, setError] = useState<string | null>(null)
    /** Suggestions the reviewer flipped away from the default ticks. */
    const [toggled, setToggled] = useState<Set<string>>(new Set())

    const onPlan = useMemo(() => new Set((participant?.plan.interventions || []).map((item) => item.interventionId)), [participant])

    // Ticked by default: suggestions for High and Medium gaps.
    const preselected = useMemo(() => new Set((analysis?.result.gaps || [])
        .filter((gap) => gap.priority !== 'Low')
        .flatMap((gap) => gap.interventions.map((item) => item.interventionId))), [analysis])

    const selected = useMemo(() => {
        const ids = new Set<string>()
        analysis?.result.gaps.forEach((gap) => gap.interventions.forEach((item) => {
            if (!onPlan.has(item.interventionId) && preselected.has(item.interventionId) !== toggled.has(item.interventionId)) ids.add(item.interventionId)
        }))
        return ids
    }, [analysis, onPlan, preselected, toggled])

    const suggestions = useMemo(() => {
        const unique = new Map<string, GapSuggestedIntervention>()
        analysis?.result.gaps.forEach((gap) => gap.interventions.forEach((item) => unique.set(item.interventionId, item)))
        return unique
    }, [analysis])

    const chosen = [...selected].map((id) => suggestions.get(id)).filter(Boolean) as GapSuggestedIntervention[]

    const isStale = Boolean(analysis && row?.submittedAt && analysis.responseSubmittedAt && row.submittedAt > analysis.responseSubmittedAt)

    const analyse = async () => {
        if (!user || !row) return
        setAnalysing(true)
        setError(null)
        try {
            const result = await analyseGapResponse({ user, template, row, participant, catalogue })
            onAnalysed(result)
            setView('analysis')
        } catch (thrown) {
            setError(thrown instanceof Error ? thrown.message : t('The gap analysis could not be generated.'))
        } finally {
            setAnalysing(false)
        }
    }

    const addToPlan = async () => {
        if (!user || !participant || !analysis || !chosen.length) return
        setAdding(true)
        try {
            const added = await addGapInterventionsToPlan({ user, participant, analysis, interventions: chosen })
            onAnalysed({ ...analysis, addedInterventionIds: [...new Set([...analysis.addedInterventionIds, ...chosen.map((item) => item.interventionId)])] })
            onPlanChanged()
            message.success(added
                ? `${added} intervention${added === 1 ? '' : 's'} added to ${participant.businessName}'s diagnostic plan.`
                : t('Those interventions are already on the diagnostic plan.'))
            if (participant.plan.status === 'Confirmed' && added) {
                message.info(t('The plan was already signed, so the SME will be asked to confirm it again.'))
            }
        } catch (thrown) {
            const reason = thrown instanceof Error ? thrown.message : ''
            message.error(reason === 'forbidden'
                ? t('You do not have permission to change diagnostic plans.')
                : t('The diagnostic plan could not be updated.'))
        } finally {
            setAdding(false)
        }
    }

    const toggle = (id: string) => setToggled((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
    })

    const canPlan = Boolean(participant?.applicationId)
    const result = analysis?.result

    const footer = view === 'analysis' && result ? (
        <ModalActions>
            <Button icon={<ReloadOutlined />} loading={analysing} disabled={!gapAnalysisAvailable} onClick={() => void analyse()}>
                {t('Regenerate')}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} loading={adding} disabled={!chosen.length || !canPlan} onClick={() => void addToPlan()}>
                {chosen.length ? `Add ${chosen.length} to diagnostic plan` : t('Add to diagnostic plan')}
            </Button>
        </ModalActions>
    ) : null

    return (
        <ResponsiveModal
            open={Boolean(row)}
            onClose={onClose}
            width={980}
            centered
            className="gap-review-modal"
            title={row ? `${participant?.businessName || row.participantName} · ${template.title}` : ''}
            footer={footer}
        >
            {row && (
                <Space direction="vertical" size={16} className="gap-review-stack">
                    <div className="gap-review-head">
                        <Segmented
                            value={view}
                            onChange={(value) => setView(value as View)}
                            options={[
                                { value: 'analysis', label: t('AI gap analysis'), icon: <RobotOutlined /> },
                                { value: 'answers', label: t('Answers') },
                            ]}
                        />
                        <Typography.Text type="secondary">
                            {row.submittedAt ? `${t('Submitted')} ${dayjs(row.submittedAt).format('DD MMM YYYY')}` : ''}
                            {analysis ? ` · ${t('Analysed')} ${dayjs(analysis.generatedAt).format('DD MMM YYYY')}` : ''}
                        </Typography.Text>
                    </div>

                    {error && <Alert type="error" showIcon message={t('Analysis failed')} description={error} />}

                    {view === 'answers' ? (
                        <>
                            {!analysis && (
                                <Alert
                                    type="info"
                                    showIcon
                                    message={t('No AI analysis yet')}
                                    description={t('Generate one to score each business area, list the gaps and suggest interventions from your catalogue.')}
                                    action={(
                                        <Button type="primary" icon={<RobotOutlined />} loading={analysing} disabled={!gapAnalysisAvailable} onClick={() => void analyse()}>
                                            {t('Analyse')}
                                        </Button>
                                    )}
                                />
                            )}
                            <SurveyResponseViewer fields={template.fields} answers={row.answers || {}} />
                        </>
                    ) : analysing ? (
                        <div className="gap-review-busy"><Spin /><Typography.Text type="secondary">{t('Reading the answers and matching interventions…')}</Typography.Text></div>
                    ) : !result ? (
                        <Empty description={t('This response has not been analysed yet.')}>
                            <Button type="primary" icon={<RobotOutlined />} disabled={!gapAnalysisAvailable} onClick={() => void analyse()}>{t('Analyse')}</Button>
                        </Empty>
                    ) : (
                        <>
                            {isStale && <Alert type="warning" showIcon message={t('The SME resubmitted after this analysis. Regenerate it to include their latest answers.')} />}
                            {!canPlan && <Alert type="warning" showIcon message={t('This SME has no accepted application, so there is no diagnostic plan to add interventions to.')} />}
                            {result.warnings.map((warning) => <Alert key={warning} type="info" showIcon message={warning} />)}

                            {result.summary && <Typography.Paragraph className="gap-review-summary">{result.summary}</Typography.Paragraph>}

                            <div className="gap-review-columns">
                                <section className="gap-review-section">
                                    <Typography.Title level={5}>{t('Diagnostic scorecard')}</Typography.Title>
                                    <Typography.Text type="secondary" className="gap-review-scale">{t('1 = critical, 5 = strong')}</Typography.Text>
                                    {result.scorecard.length ? result.scorecard.map((entry) => (
                                        <div key={entry.area} className="gap-score-row" title={entry.finding}>
                                            <span className="gap-score-area">{entry.area}</span>
                                            <span className="gap-score-track" aria-hidden>
                                                <span className={`gap-score-fill is-${entry.score <= 2 ? 'low' : entry.score === 3 ? 'mid' : 'high'}`} style={{ width: `${(entry.score / 5) * 100}%` }} />
                                            </span>
                                            <strong className="gap-score-value">{entry.score}/5</strong>
                                        </div>
                                    )) : <Typography.Text type="secondary">{t('No business areas were scored.')}</Typography.Text>}
                                </section>

                                <section className="gap-review-section">
                                    <Typography.Title level={5}>{t('Strengths')}</Typography.Title>
                                    {result.strengths.length ? (
                                        <ul className="gap-review-list">{result.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
                                    ) : <Typography.Text type="secondary">{t('None noted.')}</Typography.Text>}
                                </section>
                            </div>

                            <section className="gap-review-section">
                                <Typography.Title level={5}>{`${t('Gaps found')} (${result.gaps.length})`}</Typography.Title>
                                {result.gaps.length ? (
                                    <div className="gap-finding-list">
                                        {result.gaps.map((gap, index) => (
                                            <article key={`${gap.finding}-${index}`} className="gap-finding">
                                                <div className="gap-finding-head">
                                                    <Tag color={PRIORITY_COLOR[gap.priority]}>{gap.priority}</Tag>
                                                    {gap.area && <Typography.Text type="secondary">{gap.area}</Typography.Text>}
                                                </div>
                                                <Typography.Text strong>{gap.finding}</Typography.Text>
                                                {(gap.rootCause || gap.impact) && (
                                                    <dl className="gap-finding-detail">
                                                        {gap.rootCause && <><dt>{t('Root cause')}</dt><dd>{gap.rootCause}</dd></>}
                                                        {gap.impact && <><dt>{t('Business impact')}</dt><dd>{gap.impact}</dd></>}
                                                    </dl>
                                                )}
                                                <div className="gap-finding-interventions">
                                                    <span className="gap-finding-label">{t('Suggested interventions')}</span>
                                                    {gap.interventions.length ? gap.interventions.map((item) => (
                                                        onPlan.has(item.interventionId) ? (
                                                            <Tag key={item.interventionId} icon={<CheckCircleOutlined />} color="green">{`${item.title} · ${t('on plan')}`}</Tag>
                                                        ) : (
                                                            <Checkbox key={item.interventionId} checked={selected.has(item.interventionId)} disabled={!canPlan} onChange={() => toggle(item.interventionId)}>
                                                                {item.title}{item.areaOfSupport ? <Typography.Text type="secondary">{` · ${item.areaOfSupport}`}</Typography.Text> : null}
                                                            </Checkbox>
                                                        )
                                                    )) : <Typography.Text type="secondary">{t('Nothing in the intervention catalogue fits this gap.')}</Typography.Text>}
                                                    {gap.reason && gap.interventions.length > 0 && <Typography.Text type="secondary" className="gap-finding-reason">{gap.reason}</Typography.Text>}
                                                </div>
                                            </article>
                                        ))}
                                    </div>
                                ) : <Typography.Text type="secondary">{t('No gaps were identified.')}</Typography.Text>}
                            </section>
                        </>
                    )}
                </Space>
            )}
        </ResponsiveModal>
    )
}
