import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert, App, Button, Card, DatePicker, Empty, Progress, Tag, Tooltip, Typography, Upload } from 'antd'
import {
    ArrowRightOutlined,
    CalendarOutlined,
    CheckCircleFilled,
    ClockCircleFilled,
    CloseCircleFilled,
    EditOutlined,
    ExclamationCircleFilled,
    EyeOutlined,
    FileProtectOutlined,
    InfoCircleFilled,
    UploadOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Helmet } from 'react-helmet'
import { useSearchParams } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { requirementKeyFor } from '@/config/complianceDocuments'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import {
    loadMyCompliance,
    saveMyComplianceDocument,
    type ComplianceDisplayStatus,
    type MyCompliance,
    type MyComplianceDocument,
} from '@/services/incubateeComplianceService'
import '@/styles/incubatee.css'
import '@/styles/incubatee-compliance.css'

const { Text, Title } = Typography
const { Dragger } = Upload

const MAX_FILE_MB = 10
const ACCEPTED_FILES = '.pdf,.png,.jpg,.jpeg,.webp'

type GroupKey = 'action' | 'review' | 'good'

const STATUS_META: Record<ComplianceDisplayStatus, { label: string, color: string, icon: ReactNode }> = {
    missing: { label: 'Missing', color: 'default', icon: <CloseCircleFilled /> },
    queried: { label: 'Needs changes', color: 'volcano', icon: <ExclamationCircleFilled /> },
    expired: { label: 'Expired', color: 'orange', icon: <ClockCircleFilled /> },
    pending: { label: 'In review', color: 'gold', icon: <InfoCircleFilled /> },
    valid: { label: 'Valid', color: 'green', icon: <CheckCircleFilled /> },
}

/** What the SME should do next; required, broken documents first. */
const needsAction = (document: MyComplianceDocument) =>
    document.status === 'missing' || document.status === 'queried' || document.status === 'expired' || document.expiringSoon

const sortRank = (document: MyComplianceDocument) => {
    const rank = { queried: 0, expired: 1, missing: 2, pending: 4, valid: 5 }[document.status]
    const soon = document.expiringSoon && document.status === 'valid' ? 3 : rank
    return (document.required ? 0 : 10) + soon
}

/** Valid documents that expire soon stay under "All good"; the next-step card still picks them up. */
const groupOf = (document: MyComplianceDocument): GroupKey => {
    if (document.status === 'pending') return 'review'
    if (document.status === 'valid') return 'good'
    return 'action'
}

const GROUPS: { key: GroupKey, label: string, icon: ReactNode }[] = [
    { key: 'action', label: 'Needs your action', icon: <ExclamationCircleFilled /> },
    { key: 'review', label: 'Waiting for review', icon: <ClockCircleFilled /> },
    { key: 'good', label: 'All good', icon: <CheckCircleFilled /> },
]

const formatDate = (value: string | null) => (value ? dayjs(value).format('D MMM YYYY') : null)

export const DocumentHub = () => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [searchParams, setSearchParams] = useSearchParams()

    const [compliance, setCompliance] = useState<MyCompliance | null>(null)
    const [loadFailed, setLoadFailed] = useState(false)

    // One modal for uploading, replacing and re-dating a document.
    const [active, setActive] = useState<MyComplianceDocument | null>(null)
    const [file, setFile] = useState<File | null>(null)
    const [issueDate, setIssueDate] = useState<Dayjs | null>(null)
    const [expiryDate, setExpiryDate] = useState<Dayjs | null>(null)
    const [saving, setSaving] = useState(false)

    const openDocument = useCallback((document: MyComplianceDocument) => {
        setActive(document)
        setFile(null)
        setIssueDate(document.issueDate ? dayjs(document.issueDate) : null)
        setExpiryDate(document.expiryDate ? dayjs(document.expiryDate) : null)
    }, [])

    // Deep link from the dashboard (/incubatee/compliance?upload=1&type=<document>), read once on arrival
    // and acted on as soon as the documents are known.
    const deepLink = useRef(searchParams.get('upload') === '1' ? searchParams.get('type') || '' : null)

    const load = useCallback(async () => {
        if (!user) return
        try {
            const result = await loadMyCompliance(user)
            setCompliance(result)
            setLoadFailed(false)

            if (deepLink.current !== null) {
                const wanted = requirementKeyFor(deepLink.current)
                const target = result.documents.find((document) => document.key === wanted)
                    || result.documents.find((document) => document.status === 'missing' && document.required)
                deepLink.current = null
                if (target) openDocument(target)
                setSearchParams((current) => {
                    const next = new URLSearchParams(current)
                    next.delete('upload')
                    next.delete('type')
                    return next
                }, { replace: true })
            }
        } catch (error) {
            console.error('Could not load compliance documents.', error)
            setLoadFailed(true)
        }
    }, [openDocument, setSearchParams, user])

    useEffect(() => {
        // load() only sets state after its await, which this rule cannot see.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load()
    }, [load])

    const documents = useMemo(
        () => [...(compliance?.documents || [])].sort((left, right) => sortRank(left) - sortRank(right)),
        [compliance],
    )

    const required = documents.filter((document) => document.required)
    const requiredValid = required.filter((document) => document.status === 'valid').length
    const score = required.length ? Math.round((requiredValid / required.length) * 100) : 100
    const grouped = useMemo(() => {
        const groups: Record<GroupKey, MyComplianceDocument[]> = { action: [], review: [], good: [] }
        documents.forEach((document) => groups[groupOf(document)].push(document))
        return groups
    }, [documents])
    const expiringCount = grouped.good.filter((document) => document.expiringSoon).length
    // The list is already sorted by urgency, so the first document that needs action is the next step.
    const nextDocument = documents.find(needsAction) || null

    const closeModal = () => {
        if (saving) return
        setActive(null)
        setFile(null)
    }

    const datesChanged = Boolean(active) && (
        (issueDate?.format('YYYY-MM-DD') || null) !== active?.issueDate
        || (expiryDate?.format('YYYY-MM-DD') || null) !== active?.expiryDate
    )
    const datesInvalid = Boolean(issueDate && expiryDate && expiryDate.isBefore(issueDate, 'day'))
    const canSave = Boolean(active) && !datesInvalid && (Boolean(file) || (Boolean(active?.url) && datesChanged))

    const save = async () => {
        if (!user || !compliance || !active || !canSave) return
        try {
            setSaving(true)
            await saveMyComplianceDocument(user, compliance, {
                document: active,
                file,
                issueDate: issueDate?.format('YYYY-MM-DD') || null,
                expiryDate: expiryDate?.format('YYYY-MM-DD') || null,
            })
            message.success(file ? t('Uploaded. Operations will review it shortly.') : t('Dates updated.'))
            setActive(null)
            setFile(null)
            await load()
        } catch (error) {
            console.error('Could not save compliance document.', error)
            message.error(file ? t('The document could not be uploaded. Please try again.') : t('The dates could not be updated.'))
        } finally {
            setSaving(false)
        }
    }

    const beforeUpload = (candidate: File) => {
        const extension = candidate.name.split('.').pop()?.toLowerCase() || ''
        if (!ACCEPTED_FILES.split(',').includes(`.${extension}`)) {
            message.error(t('Please choose a PDF or an image (PNG, JPG, WEBP).'))
            return Upload.LIST_IGNORE
        }
        if (candidate.size > MAX_FILE_MB * 1024 * 1024) {
            message.error(t('That file is larger than {size} MB.', undefined, { size: MAX_FILE_MB }))
            return Upload.LIST_IGNORE
        }
        setFile(candidate)
        return false
    }

    if (!user || (!compliance && !loadFailed)) {
        return <PageSkeleton variant="dashboard" label={t('Loading your compliance documents')} />
    }

    const header = (
        <Helmet>
            <title>{t('Compliance Tracking | Smart Incubation')}</title>
        </Helmet>
    )

    if (loadFailed || !compliance) {
        return (
            <DashboardPage className="incubatee-page incubatee-compliance-page">
                {header}
                <Alert
                    type="error"
                    showIcon
                    message={t('Your compliance documents could not be loaded.')}
                    action={<Button onClick={() => void load()}>{t('Try again')}</Button>}
                />
            </DashboardPage>
        )
    }

    if (!compliance.participantId) {
        return (
            <DashboardPage className="incubatee-page incubatee-compliance-page">
                {header}
                <div className="compliance-empty">
                    <Empty
                        image={<FileProtectOutlined className="compliance-empty-icon" />}
                        description={
                            <>
                                <Title level={5}>{t('Compliance opens once you join a programme')}</Title>
                                <Text type="secondary">{t('After your application is accepted, the documents your programme needs will appear here.')}</Text>
                            </>
                        }
                    />
                </div>
            </DashboardPage>
        )
    }

    const statusTag = (document: MyComplianceDocument) => {
        const meta = STATUS_META[document.status]
        return (
            <span className="compliance-tags">
                <Tag color={meta.color} icon={meta.icon} variant="filled">{t(meta.label)}</Tag>
                {document.expiringSoon && <Tag color="orange" variant="filled">{t('Expires soon')}</Tag>}
                {!document.required && <Tag variant="filled">{t('Optional')}</Tag>}
            </span>
        )
    }

    const primaryLabel = (document: MyComplianceDocument) => {
        if (document.status === 'missing') return t('Upload')
        if (document.status === 'queried' || document.status === 'expired') return t('Upload new')
        if (document.expiringSoon) return t('Renew')
        return t('Replace')
    }

    const nextStepText = (document: MyComplianceDocument) => {
        const date = formatDate(document.expiryDate) || ''
        if (document.status === 'queried') return document.comment ? `${t('Operations asked for changes')}: “${document.comment}”` : t('Operations asked for changes')
        if (document.status === 'expired') return t('This document expired on {date}. Upload a current one.', undefined, { date })
        if (document.status === 'missing') return t('Upload this document so operations can review it.')
        return t('It expires on {date}. Upload the renewed one before then.', undefined, { date })
    }

    const nextStepLabel = (document: MyComplianceDocument) => {
        if (document.status === 'queried') return t('Upload new version')
        if (document.status === 'missing') return t('Upload')
        return t('Renew')
    }

    const jumpTo = (group: GroupKey) => {
        window.document.getElementById(`compliance-group-${group}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    const metrics: { key: string, group: GroupKey, label: string, value: number, icon: ReactNode }[] = [
        { key: 'valid', group: 'good', label: t('Valid'), value: grouped.good.length, icon: <CheckCircleFilled /> },
        { key: 'action', group: 'action', label: t('Needs action'), value: grouped.action.length, icon: <ExclamationCircleFilled /> },
        { key: 'review', group: 'review', label: t('In review'), value: grouped.review.length, icon: <ClockCircleFilled /> },
        { key: 'expiring', group: 'good', label: t('Expiring soon'), value: expiringCount, icon: <CalendarOutlined /> },
    ]

    return (
        <DashboardPage className="incubatee-page incubatee-compliance-page">
            {header}

            <section className="compliance-summary">
                {/* The shared metric card has no ring, so the score borrows its card styles. */}
                <Card className="dashboard-metric-card compliance-score-card" bordered>
                    <div className="dashboard-metric-row">
                        <Progress
                            type="circle"
                            percent={score}
                            size={44}
                            strokeWidth={10}
                            strokeColor="#6d5dfb"
                            format={(percent) => <span className="compliance-score-value">{percent}%</span>}
                        />
                        <div className="dashboard-metric-copy">
                            <Text strong>{t('Compliance')}</Text>
                            <Text type="secondary" className="dashboard-metric-label">
                                {t('{valid} of {total} valid', undefined, { valid: requiredValid, total: required.length })}
                            </Text>
                        </div>
                    </div>
                </Card>

                {metrics.map((metric) => (
                    <DashboardMetricCard
                        key={metric.key}
                        icon={metric.icon}
                        label={metric.label}
                        value={metric.value}
                        onClick={metric.value > 0 ? () => jumpTo(metric.group) : undefined}
                    />
                ))}
            </section>

            {nextDocument ? (
                <section className={`compliance-next is-${nextDocument.status}${nextDocument.expiringSoon ? ' is-expiring' : ''}`}>
                    <span className="compliance-next-eyebrow"><ArrowRightOutlined /> {t('Next step')}</span>
                    <div className="compliance-next-body">
                        <span className="compliance-next-icon" aria-hidden="true">{STATUS_META[nextDocument.status].icon}</span>
                        <div className="compliance-next-text">
                            <Text strong className="compliance-next-name">{t(nextDocument.name)}</Text>
                            <Text type="secondary">{nextStepText(nextDocument)}</Text>
                        </div>
                        <Button type="primary" size="large" icon={<UploadOutlined />} onClick={() => openDocument(nextDocument)}>
                            {nextStepLabel(nextDocument)}
                        </Button>
                    </div>
                </section>
            ) : (
                <section className="compliance-next is-done">
                    <div className="compliance-next-body">
                        <span className="compliance-next-icon" aria-hidden="true"><CheckCircleFilled /></span>
                        <div className="compliance-next-text">
                            <Text strong className="compliance-next-name">{t('Nothing needs your attention right now.')}</Text>
                            {grouped.review.length > 0 && (
                                <Text type="secondary">{t('Operations is reviewing {count} of your documents.', undefined, { count: grouped.review.length })}</Text>
                            )}
                        </div>
                    </div>
                </section>
            )}

            {GROUPS.filter((group) => grouped[group.key].length > 0).map((group) => (
                <section key={group.key} id={`compliance-group-${group.key}`} className={`compliance-group is-${group.key}`}>
                    <h3 className="compliance-group-head">
                        <span aria-hidden="true">{group.icon}</span> {t(group.label)}
                    </h3>
                    <ul className="compliance-list">
                        {grouped[group.key].map((document) => (
                            <li key={document.key} className={`compliance-row is-${document.status}${document.expiringSoon ? ' is-expiring' : ''}${document.url ? ' has-file' : ''}`}>
                                <span className="compliance-row-icon" aria-hidden="true">{STATUS_META[document.status].icon}</span>

                                <div className="compliance-row-main">
                                    <div className="compliance-row-title">
                                        <Text strong>{t(document.name)}</Text>
                                        {statusTag(document)}
                                    </div>
                                    <Text type="secondary" className="compliance-row-meta">
                                        {document.url
                                            ? [
                                                document.fileName,
                                                document.expiryDate ? t('Expires {date}', undefined, { date: formatDate(document.expiryDate) || '' }) : t('No expiry date'),
                                            ].filter(Boolean).join(' · ')
                                            : t('Not uploaded yet')}
                                    </Text>
                                    {document.status === 'queried' && document.comment && (
                                        <div className="compliance-row-comment">
                                            <ExclamationCircleFilled /> <span>{document.comment}</span>
                                        </div>
                                    )}
                                </div>

                                <div className="compliance-row-actions">
                                    {document.url && (
                                        <Tooltip title={t('View file')}>
                                            <Button type="text" shape="circle" icon={<EyeOutlined />} href={document.url} target="_blank" rel="noopener noreferrer" aria-label={t('View file')} />
                                        </Tooltip>
                                    )}
                                    {document.url && (
                                        <Tooltip title={t('Edit dates')}>
                                            <Button type="text" shape="circle" icon={<EditOutlined />} onClick={() => openDocument(document)} aria-label={t('Edit dates')} />
                                        </Tooltip>
                                    )}
                                    <Button icon={<UploadOutlined />} onClick={() => openDocument(document)}>
                                        {primaryLabel(document)}
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            ))}

            <ResponsiveModal
                open={Boolean(active)}
                title={active ? (active.url ? t('Update {name}', undefined, { name: t(active.name) }) : t('Upload {name}', undefined, { name: t(active.name) })) : null}
                onClose={closeModal}
                footer={[
                    <Button key="cancel" onClick={closeModal} disabled={saving}>{t('Cancel')}</Button>,
                    <Button key="save" type="primary" loading={saving} disabled={!canSave} onClick={() => void save()}>
                        {file || !active?.url ? t('Upload') : t('Save dates')}
                    </Button>,
                ]}
            >
                {active && (
                    <div className="compliance-modal">
                        {active.status === 'queried' && active.comment && (
                            <Alert type="warning" showIcon message={t('Operations asked for changes')} description={active.comment} />
                        )}
                        {active.url && (
                            <div className="compliance-modal-current">
                                {statusTag(active)}
                                <a href={active.url} target="_blank" rel="noopener noreferrer"><EyeOutlined /> {active.fileName || t('Current file')}</a>
                            </div>
                        )}

                        <div className="compliance-modal-dates">
                            <label>
                                <span>{t('Issue date')}</span>
                                <DatePicker value={issueDate} onChange={setIssueDate} style={{ width: '100%' }} disabledDate={(day) => day.isAfter(dayjs(), 'day')} />
                            </label>
                            <label>
                                <span>{t('Expiry date')} <Text type="secondary">({t('if it has one')})</Text></span>
                                <DatePicker value={expiryDate} onChange={setExpiryDate} style={{ width: '100%' }} status={datesInvalid ? 'error' : undefined} />
                            </label>
                        </div>
                        {datesInvalid && <Text type="danger">{t('The expiry date must be after the issue date.')}</Text>}

                        <Dragger
                            accept={ACCEPTED_FILES}
                            beforeUpload={beforeUpload}
                            maxCount={1}
                            fileList={file ? [{ uid: 'compliance-file', name: file.name, status: 'done' }] : []}
                            onRemove={() => setFile(null)}
                        >
                            <p className="ant-upload-drag-icon"><UploadOutlined /></p>
                            <p className="ant-upload-text">{active.url ? t('Drop a new file to replace the current one') : t('Drop the file here or click to choose')}</p>
                            <p className="ant-upload-hint">{t('PDF or image, up to {size} MB. A new file goes back to operations for review.', undefined, { size: MAX_FILE_MB })}</p>
                        </Dragger>
                    </div>
                )}
            </ResponsiveModal>
        </DashboardPage>
    )
}

export default DocumentHub
