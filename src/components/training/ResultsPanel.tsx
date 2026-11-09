import { useMemo, useState } from 'react'
import { Alert, App, Button, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography, type TableProps } from 'antd'
import { DownloadOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons'
import { FilterBar } from '@/components/shared/FilterBar'
import { MotionCard } from '@/components/shared/MotionCard'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { CertificateDownloadButton } from '@/components/training/CertificateDownloadButton'
import { ResultTag } from '@/components/training/TrainingTags'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { downloadCsv } from '@/pages/consultant/ConsultantWorkspaceUtils'
import { cancelTrainingCertificate, reissueTrainingCertificate, type CertificateIssueDetails } from '@/services/trainingCertificatesService'
import { useLanguage } from '@/providers/LanguageProvider'
import { ALL_ORGANISATIONS, inOrganisation, organisationsOf, pctLabel, resultLabel } from '@/utils/trainingFormat'
import { OrganisationChips, OrganisationSections } from '@/components/training/OrganisationFilter'
import type { TrainingCertificate, TrainingClass, TrainingLearnerResult, TrainingResultStatus } from '@/types/training'

type Props = {
    trainingClass: TrainingClass
    results: TrainingLearnerResult[]
    loading: boolean
    certificates: TrainingCertificate[]
    /** What a reissued certificate prints (the class, company and facilitator as they are now). */
    certificateDetails: CertificateIssueDetails
    /** Certificates are issued without the facilitator's signature until one is saved on their profile. */
    signatureMissing: boolean
    /** False for a course without group work: its column leaves the table and the export. */
    showGroups: boolean
}

type OrganisationSummary = { organisation: string, learners: number, passed: number, averagePost?: number, averageGain?: number }

const average = (values: number[]) => (values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : undefined)

export const ResultsPanel = ({ trainingClass, results, loading, certificates, certificateDetails, signatureMissing, showGroups }: Props) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [organisation, setOrganisation] = useState(ALL_ORGANISATIONS)
    const [status, setStatus] = useState<'all' | TrainingResultStatus>('all')
    const [cancelling, setCancelling] = useState<TrainingCertificate | null>(null)
    const [cancelReason, setCancelReason] = useState('')
    const [busy, setBusy] = useState<string | null>(null)

    const certificateOf = (learnerId: string) =>
        certificates.find((certificate) => certificate.learnerId === learnerId && certificate.status === 'valid')

    const reissue = async (certificate: TrainingCertificate, result: TrainingLearnerResult) => {
        if (!user) return
        setBusy(certificate.id)
        try {
            await reissueTrainingCertificate(user, certificate, result.learner, certificateDetails)
            message.success(t('A new certificate was issued to {name}; the old one is cancelled.', undefined, { name: result.learner.name }))
        } catch {
            message.error(t('The certificate could not be reissued.'))
        } finally {
            setBusy(null)
        }
    }

    const cancel = async () => {
        if (!user || !cancelling || !cancelReason.trim()) return
        setBusy(cancelling.id)
        try {
            await cancelTrainingCertificate(user, cancelling, cancelReason)
            message.success(t('Certificate {number} cancelled. Its verification page now says so.', undefined, { number: cancelling.certificateNumber }))
            setCancelling(null)
            setCancelReason('')
        } catch {
            message.error(t('The certificate could not be cancelled.'))
        } finally {
            setBusy(null)
        }
    }

    const certificateCell = (result: TrainingLearnerResult) => {
        const certificate = certificateOf(result.learner.id)
        if (!certificate) {
            return result.status === 'passed'
                ? <Typography.Text type="secondary">{t('Issuing…')}</Typography.Text>
                : <Typography.Text type="secondary">{t('When passed')}</Typography.Text>
        }
        return (
            <Space orientation="vertical" size={4}>
                <Space size={4} wrap>
                    <Tag color="green">{certificate.certificateNumber}</Tag>
                    {result.status !== 'passed' && (
                        <Tooltip title={t('Marks changed after it was issued. Cancel it if the learner should not have it.')}>
                            <Tag color="orange">{t('No longer meets the pass rule')}</Tag>
                        </Tooltip>
                    )}
                </Space>
                <Space size={4} wrap>
                    <CertificateDownloadButton certificate={certificate} size="small" label={t('PDF')} />
                    <Popconfirm
                        title={t('Reissue this certificate?')}
                        description={t('Use this after correcting the learner\'s details. The current certificate is cancelled and a new number is issued.')}
                        okText={t('Reissue')}
                        onConfirm={() => reissue(certificate, result)}
                    >
                        <Button size="small" icon={<ReloadOutlined />} loading={busy === certificate.id}>{t('Reissue')}</Button>
                    </Popconfirm>
                    <Button size="small" danger icon={<StopOutlined />} onClick={() => { setCancelling(certificate); setCancelReason('') }}>{t('Cancel')}</Button>
                </Space>
            </Space>
        )
    }

    const organisations = useMemo(() => organisationsOf(results.map((result) => result.learner)), [results])
    const visible = useMemo(() => results.filter((result) =>
        inOrganisation(organisation)(result.learner)
        && (status === 'all' || result.status === status)), [organisation, results, status])

    /** Per client organisation, for reporting back to each client. Improvement compares learners with both tests marked. */
    const summaries = useMemo<OrganisationSummary[]>(() => organisations.map((name) => {
        const own = results.filter((result) => result.learner.organisation.toLowerCase() === name.toLowerCase())
        const posts = own.flatMap((result) => (typeof result.postScorePct === 'number' ? [result.postScorePct] : []))
        const gains = own.flatMap((result) => (typeof result.postScorePct === 'number' && typeof result.preScorePct === 'number'
            ? [result.postScorePct - result.preScorePct] : []))
        return {
            organisation: name,
            learners: own.length,
            passed: own.filter((result) => result.status === 'passed').length,
            averagePost: average(posts),
            averageGain: average(gains),
        }
    }), [organisations, results])

    const groupLabel = (result: TrainingLearnerResult) => {
        if (!result.group) return t('No group')
        if (!result.group.markedAt) return `${result.group.name} · ${t('not marked')}`
        const mark = `${result.group.total ?? 0}/${result.group.maxTotal}`
        return result.groupParticipated ? `${result.group.name} · ${mark}` : `${result.group.name} · ${t('did not take part')}`
    }

    const exportResults = () => {
        const exported = downloadCsv(`results-${trainingClass.startDate}.csv`, visible.map((result) => ({
            [t('Learner name')]: result.learner.name,
            [t('Organisation')]: result.learner.organisation,
            [t('Email address')]: result.learner.email,
            [t('Pre-assessment %')]: result.preScorePct ?? '',
            [t('Post-assessment %')]: result.postScorePct ?? '',
            [t('Post-assessment attempts')]: result.postAttempts,
            ...(showGroups ? { [t('Group assignment')]: groupLabel(result) } : {}),
            [t('Result')]: resultLabel(result.status, t),
            [t('Certificate')]: certificateOf(result.learner.id)?.certificateNumber || '',
        })))
        if (!exported) message.info(t('There are no results to export.'))
    }

    const columns: TableProps<TrainingLearnerResult>['columns'] = [
        {
            title: t('Learner'),
            key: 'learner',
            render: (_, result) => (
                <Space orientation="vertical" size={0}>
                    <Typography.Text strong>{result.learner.name}</Typography.Text>
                    <Typography.Text type="secondary">{result.learner.organisation}</Typography.Text>
                </Space>
            ),
        },
        { title: t('Pre-assessment'), key: 'pre', align: 'center', render: (_, result) => pctLabel(result.preScorePct) },
        {
            title: t('Post-assessment'),
            key: 'post',
            align: 'center',
            render: (_, result) => (
                <Space orientation="vertical" size={0}>
                    <span>{pctLabel(result.postScorePct)}</span>
                    {result.postAttempts > 1 && <Typography.Text type="secondary">{t('{count} attempts', undefined, { count: result.postAttempts })}</Typography.Text>}
                </Space>
            ),
        },
        ...(showGroups ? [{ title: t('Group assignment'), key: 'group', render: (_: unknown, result: TrainingLearnerResult) => groupLabel(result) }] : []),
        { title: t('Result'), key: 'status', render: (_, result) => <ResultTag status={result.status} /> },
        { title: t('Certificate'), key: 'certificate', render: (_, result) => certificateCell(result) },
    ]

    const summaryColumns: TableProps<OrganisationSummary>['columns'] = [
        { title: t('Organisation'), dataIndex: 'organisation' },
        { title: t('Learners'), dataIndex: 'learners', align: 'center' },
        { title: t('Passed'), key: 'passed', align: 'center', render: (_, row) => <Tag color={row.passed === row.learners ? 'green' : undefined}>{row.passed}/{row.learners}</Tag> },
        { title: t('Average post-assessment'), key: 'post', align: 'center', render: (_, row) => pctLabel(row.averagePost) },
        { title: t('Average improvement'), key: 'gain', align: 'center', render: (_, row) => typeof row.averageGain === 'number' ? `${row.averageGain > 0 ? '+' : ''}${row.averageGain} ${t('points')}` : '—' },
    ]

    return (
        <>
            {signatureMissing && (
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={t('Certificates are issued automatically when a learner passes. Add your signature on your profile so it appears on them.')}
                />
            )}
            <FilterBar
                compact
                primary={(
                    <>
                        <Select
                            value={status}
                            onChange={setStatus}
                            options={[
                                { value: 'all', label: t('All results') },
                                ...(['passed', 'awaiting_marking', 'awaiting_group', 'reassessment_available', 'not_passed', 'not_started'] as TrainingResultStatus[])
                                    .map((value) => ({ value, label: resultLabel(value, t) })),
                            ]}
                        />
                    </>
                )}
                actions={<Button icon={<DownloadOutlined />} onClick={exportResults}>{t('Export results')}</Button>}
            />
            <OrganisationChips learners={results.map((result) => result.learner)} value={organisation} onChange={setOrganisation} />
            <OrganisationSections
                rows={visible.map((result) => ({ ...result, organisation: result.learner.organisation }))}
                grouped={organisation === ALL_ORGANISATIONS && !loading}
                summary={(rows) => t('{passed} of {count} passed', undefined, { passed: rows.filter((result) => result.status === 'passed').length, count: rows.length })}
            >
            {(rows) => <ResponsiveDataView
                rowKey={(result) => result.learner.id}
                rows={rows}
                columns={columns}
                loading={loading}
                emptyText={results.length ? t('No learners match these filters.') : t('Results appear once learners are added.')}
                renderCard={(result) => (
                    <Space orientation="vertical" style={{ width: '100%' }}>
                        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Typography.Text strong>{result.learner.name}</Typography.Text>
                            <ResultTag status={result.status} />
                        </Space>
                        <Typography.Text type="secondary">{result.learner.organisation}</Typography.Text>
                        <Typography.Text>{t('Pre-assessment {pre} · Post-assessment {post}', undefined, { pre: pctLabel(result.preScorePct), post: pctLabel(result.postScorePct) })}</Typography.Text>
                        <Typography.Text type="secondary">{groupLabel(result)}</Typography.Text>
                        {certificateCell(result)}
                    </Space>
                )}
            />}
            </OrganisationSections>
            <Modal
                open={cancelling !== null}
                title={t('Cancel certificate {number}?', undefined, { number: cancelling?.certificateNumber || '' })}
                okText={t('Cancel certificate')}
                okButtonProps={{ danger: true, disabled: !cancelReason.trim(), loading: cancelling ? busy === cancelling.id : false }}
                cancelText={t('Keep it')}
                onOk={() => void cancel()}
                onCancel={() => setCancelling(null)}
                destroyOnHidden
            >
                <Typography.Paragraph type="secondary">{t('The certificate stays on record, marked cancelled, and anyone checking it is told it is no longer valid.')}</Typography.Paragraph>
                <Input.TextArea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder={t('Reason')} autoSize={{ minRows: 2, maxRows: 4 }} maxLength={200} />
            </Modal>
            {summaries.length > 0 && (
                <MotionCard title={t('By organisation')} style={{ marginTop: 16 }}>
                    <Table rowKey="organisation" size="small" pagination={false} columns={summaryColumns} dataSource={summaries} scroll={{ x: true }} />
                </MotionCard>
            )}
        </>
    )
}
