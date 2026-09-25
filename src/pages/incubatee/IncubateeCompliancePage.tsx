import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Col,
    DatePicker,
    Descriptions,
    Grid,
    message,
    Modal,
    Progress,
    Row,
    Segmented,
    Select,
    Space,
    Table,
    Tag,
    Tooltip,
    Typography,
    Upload,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    BarChartOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    ExclamationCircleOutlined,
    EyeOutlined,
    FileTextOutlined,
    PlusOutlined,
    SaveOutlined,
    TableOutlined,
    UploadOutlined,
} from '@ant-design/icons'
import { onAuthStateChanged, getAuth } from 'firebase/auth'
import {
    collection,
    getDoc,
    getDocs,
    query,
    Timestamp,
    updateDoc,
    where,
    type DocumentReference,
} from 'firebase/firestore'
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage'
import { Helmet } from 'react-helmet'
import dayjs, { Dayjs } from 'dayjs'
import Highcharts from 'highcharts'
import { useSearchParams } from 'react-router-dom'
import { db } from '@/firebase'
import { MotionCard } from '@/components/shared/MotionCard'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { FilterBar } from '@/components/shared/FilterBar'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import '@/styles/incubatee.css'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const { Text } = Typography
const { Option } = Select
const { useBreakpoint } = Grid
const { Dragger } = Upload

Highcharts.setOptions({ credits: { enabled: false } })

const documentTypes = [
    'Certified ID Copy',
    'Proof of Address',
    'B-BBEE Certificate',
    'Tax PIN',
    'CIPC',
    'Management Accounts',
    'Three Months Bank Statements',
]

type ViewKey = 'data' | 'risk'

type ComplianceRow = {
    key: string
    type: string
    status: string
    issue: string
    expiry: string
    url: string | null
    fileName: string | null
    verificationStatus: string
    verificationComment: string
    uploadedAt?: any
    issueDateRaw?: any
    expiryDateRaw?: any
}

const openInNewTab = (url?: string | null) => {
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
}

const toTimestamp = (d?: Dayjs | null) => {
    return d && d.isValid() ? Timestamp.fromDate(d.toDate()) : null
}

const toDayjs = (val: any): Dayjs | null => {
    if (!val) return null
    if (val?.toDate && typeof val.toDate === 'function') return dayjs(val.toDate())
    if (typeof val === 'object' && typeof val?.seconds === 'number') return dayjs(new Date(val.seconds * 1000))
    if (typeof dayjs.isDayjs === 'function' && dayjs.isDayjs(val)) return val.isValid() ? val : null
    if (val instanceof Date && Number.isFinite(val.getTime())) return dayjs(val)
    if (typeof val === 'number') {
        const ms = val.toString().length === 10 ? val * 1000 : val
        const d = dayjs(ms)
        return d.isValid() ? d : null
    }
    if (typeof val === 'string') {
        const s = val.trim()
        const d = dayjs(s)
        if (d.isValid()) return d
        const d2 = new Date(s)
        return Number.isFinite(d2.getTime()) ? dayjs(d2) : null
    }
    return null
}

const formatAnyDate = (val: any) => {
    if (!val) return '-'
    const d = toDayjs(val)
    return d?.isValid() ? d.format('YYYY-MM-DD') : '-'
}

const isExpired = (expiry: string, statusLower: string) => {
    if (statusLower === 'expired') return true
    if (!expiry || expiry === '-') return false
    const d = dayjs(expiry, 'YYYY-MM-DD', true)
    return d.isValid() ? d.isBefore(dayjs(), 'day') : false
}

const isExpiringSoon = (expiry: string, days = 30) => {
    if (!expiry || expiry === '-') return false
    const d = dayjs(expiry, 'YYYY-MM-DD', true)
    if (!d.isValid()) return false
    const diff = d.diff(dayjs(), 'day')
    return diff >= 0 && diff <= days
}

const getStatusTag = (status: string) => {
    const s = (status || '').toLowerCase()
    const colorMap: Record<string, string> = {
        valid: 'green',
        approved: 'blue',
        expired: 'orange',
        missing: 'red',
        pending: 'gold',
        rejected: 'volcano',
    }
    return <Tag color={colorMap[s] || 'default'}>{s ? s.toUpperCase() : '-'}</Tag>
}

const getReviewTag = (verificationStatus: string) => {
    const vs = (verificationStatus || 'unverified').toLowerCase()
    const color = vs === 'verified' ? 'green' : vs === 'queried' ? 'red' : 'orange'
    const label = vs === 'verified' ? 'Verified' : vs === 'queried' ? 'Queried' : 'Unverified'
    return <Tag color={color}>{label}</Tag>
}

export const DocumentHub: React.FC = () => {
    const { t } = useLanguage()
    const screens = useBreakpoint()
    const isMobile = !screens.md
    const [searchParams, setSearchParams] = useSearchParams()

    const [complianceDocs, setComplianceDocs] = useState<ComplianceRow[]>([])
    const [loading, setLoading] = useState(true)

    const [statusFilter, setStatusFilter] = useState('all')
    const [missingDocsList, setMissingDocsList] = useState<string[]>([])

    const [isAddModalVisible, setIsAddModalVisible] = useState(false)
    const [selectedType, setSelectedType] = useState('')
    const [uploadFile, setUploadFile] = useState<File | null>(null)
    const [issueDateAdd, setIssueDateAdd] = useState<Dayjs | null>(null)
    const [expiryDateAdd, setExpiryDateAdd] = useState<Dayjs | null>(null)
    const [addUploading, setAddUploading] = useState(false)

    const [appRef, setAppRef] = useState<DocumentReference | null>(null)
    const [participantId, setParticipantId] = useState<string | null>(null)
    const [view, setView] = useState<ViewKey>('data')

    const [detailsOpen, setDetailsOpen] = useState(false)
    const [replaceOpen, setReplaceOpen] = useState(false)
    const [activeRow, setActiveRow] = useState<ComplianceRow | null>(null)
    const [editIssue, setEditIssue] = useState<Dayjs | null>(null)
    const [editExpiry, setEditExpiry] = useState<Dayjs | null>(null)
    const [detailsSaving, setDetailsSaving] = useState(false)
    const [replaceFile, setReplaceFile] = useState<File | null>(null)
    const [replaceUploading, setReplaceUploading] = useState(false)

    useEffect(() => {
        if (searchParams.get('upload') !== '1') return
        const requestedType = String(searchParams.get('type') || '')
        setSelectedType(documentTypes.includes(requestedType) ? requestedType : '')
        setUploadFile(null)
        setIssueDateAdd(null)
        setExpiryDateAdd(null)
        setIsAddModalVisible(true)
        const next = new URLSearchParams(searchParams)
        next.delete('upload')
        next.delete('type')
        setSearchParams(next, { replace: true })
    }, [searchParams, setSearchParams])

    /** Opens the upload modal already pointed at one required document type. */
    const openUploadFor = (type: string) => {
        setSelectedType(documentTypes.includes(type) ? type : '')
        setUploadFile(null)
        setIssueDateAdd(null)
        setExpiryDateAdd(null)
        setIsAddModalVisible(true)
    }

    const normalizeDocs = (docs: any[]) => {
        const statusOf = (s: any) => (s || 'missing').toString().toLowerCase()

        const hasFileForType = (type: string) =>
            docs.some(d => d?.type === type && !!(d.url || d.link || d.fileUrl))

        const isExplicitMissing = (type: string) =>
            docs.some(d => d?.type === type && statusOf(d.status) === 'missing')

        const missingTypes = documentTypes.filter(dt => !hasFileForType(dt) || isExplicitMissing(dt))

        const normalizedDocs: ComplianceRow[] = docs.map((d: any, index: number) => {
            const statusLower = statusOf(d.status)
            const expiry = formatAnyDate(d.expiryDate)
            const issue = formatAnyDate(d.issueDate)
            const vs = (d.verificationStatus || 'unverified').toString().toLowerCase()

            return {
                key: `${d.type}-${index}`,
                type: d.type,
                status: statusLower,
                issue,
                expiry,
                url: d.url || d.link || d.fileUrl || null,
                fileName: d.fileName || null,
                verificationStatus: vs,
                verificationComment: d.verificationComment || '',
                uploadedAt: d.uploadedAt,
                issueDateRaw: d.issueDate,
                expiryDateRaw: d.expiryDate,
            }
        })

        setMissingDocsList(missingTypes)
        setComplianceDocs(normalizedDocs)
    }

    useEffect(() => {
        const auth = getAuth()
        setLoading(true)

        const unsub = onAuthStateChanged(auth, async user => {
            try {
                if (!user?.email) {
                    normalizeDocs([])
                    return
                }

                const participantSnap = await getDocs(
                    query(collection(db, 'participants'), where('email', '==', user.email))
                )

                if (participantSnap.empty) {
                    normalizeDocs([])
                    return
                }

                const pid = participantSnap.docs[0].id
                setParticipantId(pid)

                const appSnap = await getDocs(
                    query(collection(db, 'applications'), where('participantId', '==', pid))
                )

                if (appSnap.empty) {
                    normalizeDocs([])
                    return
                }

                const appDoc = appSnap.docs[0]
                const appData = appDoc.data() as any
                const docsRaw = appData.complianceDocuments || []
                const docs = Array.isArray(docsRaw) ? docsRaw : Object.values(docsRaw)

                setAppRef(appDoc.ref)
                normalizeDocs(docs)
            } catch (e) {
                console.error(e)
                message.error(t('Failed to load documents'))
            } finally {
                setLoading(false)
            }
        })

        return () => unsub()
    }, [t])

    const refreshFromServer = async () => {
        if (!appRef) return
        const snap = await getDoc(appRef)
        const data = (snap.data() || {}) as any
        const docsRaw = data.complianceDocuments || []
        const docs = Array.isArray(docsRaw) ? docsRaw : Object.values(docsRaw)
        normalizeDocs(docs)
    }

    async function uploadComplianceDoc(type: string, file: File, issue?: Dayjs | null, expiry?: Dayjs | null) {
        if (!appRef || !participantId) {
            message.error(t('Cannot upload: missing app reference.'))
            return null
        }

        const storage = getStorage()
        const safeType = type.replace(/[^\w-]+/g, '_')
        const path = `compliance/${participantId}/${safeType}/${Date.now()}_${file.name}`
        const sref = ref(storage, path)

        await uploadBytes(sref, file)
        const url = await getDownloadURL(sref)

        const snap = await getDoc(appRef)
        const data = (snap.data() || {}) as any
        const docsRaw = data.complianceDocuments || []
        const current = Array.isArray(docsRaw) ? docsRaw : Object.values(docsRaw)
        const next = [...current]
        const idx = next.findIndex((d: any) => d?.type === type)

        const newEntry = {
            ...(idx >= 0 ? next[idx] : {}),
            type,
            status: 'pending',
            url,
            fileName: file.name,
            uploadedAt: Timestamp.now(),
            issueDate: toTimestamp(issue),
            expiryDate: toTimestamp(expiry),
            verificationStatus: 'unverified',
            verificationComment: '',
            lastVerifiedBy: '',
            lastVerifiedAt: '',
        }

        if (idx >= 0) next[idx] = newEntry
        else next.push(newEntry)

        await updateDoc(appRef, { complianceDocuments: next })
        return newEntry
    }

    async function updateComplianceDocDates(type: string, issue?: Dayjs | null, expiry?: Dayjs | null) {
        // Throwing keeps the caller honest: it cannot report success on a write that never happened.
        if (!appRef) throw new Error('This application record could not be found, so the dates were not saved.')

        const snap = await getDoc(appRef)
        const data = (snap.data() || {}) as any
        const docsRaw = data.complianceDocuments || []
        const current = Array.isArray(docsRaw) ? docsRaw : Object.values(docsRaw)
        const next = [...current]
        const idx = next.findIndex((d: any) => d?.type === type)

        if (idx < 0) {
            message.error(t('Cannot update: document entry not found.'))
            return
        }

        next[idx] = {
            ...next[idx],
            issueDate: toTimestamp(issue),
            expiryDate: toTimestamp(expiry),
            lastEditedAt: Timestamp.now(),
        }

        await updateDoc(appRef, { complianceDocuments: next })
    }

    /**
     * Every required document is a row, uploaded or not. An SME with nothing on file
     * used to see an empty table beside a "still missing" count, with no way to tell
     * which documents were wanted.
     */
    const documentRows = useMemo<ComplianceRow[]>(() => {
        const uploaded = new Map(complianceDocs.map((row) => [row.type, row]))

        const required = documentTypes.map((type) => uploaded.get(type) || ({
            key: `missing-${type}`,
            type,
            status: 'missing',
            issue: '-',
            expiry: '-',
            url: null,
            fileName: null,
            verificationStatus: 'unverified',
            verificationComment: '',
        } as ComplianceRow))

        // Anything uploaded that is not on the required list still belongs in the table.
        const extras = complianceDocs.filter((row) => !documentTypes.includes(row.type))

        return [...required, ...extras]
    }, [complianceDocs])

    const counts = useMemo(() => {
        let missing = 0
        let valid = 0
        let expired = 0
        let queried = 0
        let expiringSoon = 0

        documentRows.forEach((row) => {
            const status = String(row.status || 'missing').toLowerCase()
            const isExpiredRow = isExpired(row.expiry, status)

            if (status === 'missing' || !row.url) missing++
            if (isExpiredRow) expired++
            if (row.verificationStatus === 'queried') queried++
            if (['valid', 'approved'].includes(status) && !isExpiredRow) valid++
            if (!isExpiredRow && isExpiringSoon(row.expiry, 30)) expiringSoon++
        })

        return { missing, valid, expired, queried, expiringSoon }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [documentRows])

    const missingCount = counts.missing
    const validCount = counts.valid
    const expiredCount = counts.expired
    const queriedCount = counts.queried
    const expiringSoonCount = counts.expiringSoon

    /**
     * The share of required documents that are actually valid. A document that is
     * missing, expired or queried is simply not valid, so nothing is on file means
     * nothing is scored — the old penalty model floored an empty file at 40%.
     */
    const complianceScore = useMemo(() => {
        const total = documentTypes.length || 1
        return Math.round((validCount / total) * 100)
    }, [validCount])

    const riskSeriesData = useMemo(() => {
        const total = documentTypes.length || 1
        // Colours carry the meaning here: red is missing, amber expired, violet queried,
        // green fine. A default palette made "risk" read as neutral blue.
        return [
            { name: 'Missing', y: missingCount, color: '#dc2626' },
            { name: 'Expired', y: expiredCount, color: '#d97706' },
            { name: 'Queried', y: queriedCount, color: '#7c3aed' },
            { name: 'Valid', y: Math.max(0, total - missingCount - expiredCount - queriedCount), color: '#059669' },
        ].filter(p => Number(p.y) > 0)
    }, [missingCount, expiredCount, queriedCount])

    const visibleDocs = useMemo(() => {
        if (statusFilter === 'all') return documentRows
        if (statusFilter === 'missing') return documentRows.filter((row) => String(row.status || 'missing').toLowerCase() === 'missing' || !row.url)
        if (statusFilter === 'queried') return documentRows.filter((row) => row.verificationStatus === 'queried')
        if (statusFilter === 'expired') return documentRows.filter((row) => isExpired(row.expiry, String(row.status || '')))
        return documentRows.filter((row) => String(row.status || '').trim().toLowerCase() === statusFilter)
    }, [documentRows, statusFilter])

    const riskOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: 'pie', height: isMobile ? 240 : Math.max(240, Math.min(380, Math.round(window.innerHeight * 0.4))), backgroundColor: 'transparent' },
            title: { text: '' },
            legend: { enabled: false },
            tooltip: { pointFormat: '<b>{point.y}</b>' },
            plotOptions: {
                pie: {
                    innerSize: '70%',
                    dataLabels: {
                        enabled: true,
                        formatter: function () {
                            const y = Number(this.y ?? 0)
                            if (y <= 0) return ''
                            return `${this.name}: ${y}`
                        },
                    },
                },
            },
            series: [{ name: tr('Count'), type: 'pie', data: riskSeriesData }],
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [riskSeriesData, isMobile]
    )

    const resetAddModal = () => {
        setIsAddModalVisible(false)
        setSelectedType('')
        setUploadFile(null)
        setIssueDateAdd(null)
        setExpiryDateAdd(null)
    }

    const handleAddNew = async () => {
        if (!selectedType || !uploadFile) {
            message.error(t('Please select a type and file.'))
            return
        }

        try {
            setAddUploading(true)
            const entry = await uploadComplianceDoc(selectedType, uploadFile, issueDateAdd, expiryDateAdd)
            if (!entry) return
            await refreshFromServer()
            message.success(`Uploaded ${selectedType}`)
            resetAddModal()
        } catch (e) {
            console.error(e)
            message.error(t('Failed to upload document.'))
        } finally {
            setAddUploading(false)
        }
    }

    const prepareActiveRow = (row: ComplianceRow) => {
        setActiveRow(row)
        setEditIssue(toDayjs(row.issueDateRaw))
        setEditExpiry(toDayjs(row.expiryDateRaw))
        setReplaceFile(null)
    }

    const openDetails = (row: ComplianceRow) => {
        prepareActiveRow(row)
        setDetailsOpen(true)
    }

    const openReplace = (row: ComplianceRow) => {
        prepareActiveRow(row)
        setDetailsOpen(false)
        setReplaceOpen(true)
    }

    const closeDetails = () => {
        setDetailsOpen(false)
        setActiveRow(null)
        setEditIssue(null)
        setEditExpiry(null)
        setReplaceFile(null)
    }

    const closeReplace = () => {
        setReplaceOpen(false)
        setActiveRow(null)
        setEditIssue(null)
        setEditExpiry(null)
        setReplaceFile(null)
    }

    const canSaveDates = useMemo(() => {
        if (!activeRow) return false
        const currentIssue = toDayjs(activeRow.issueDateRaw)?.startOf('day')?.valueOf() ?? null
        const nextIssue = editIssue?.startOf('day')?.valueOf() ?? null
        const currentExpiry = toDayjs(activeRow.expiryDateRaw)?.startOf('day')?.valueOf() ?? null
        const nextExpiry = editExpiry?.startOf('day')?.valueOf() ?? null
        return currentIssue !== nextIssue || currentExpiry !== nextExpiry
    }, [activeRow, editIssue, editExpiry])

    const saveDates = async () => {
        if (!activeRow) return
        try {
            setDetailsSaving(true)
            await updateComplianceDocDates(activeRow.type, editIssue, editExpiry)
            await refreshFromServer()
            message.success(t('Dates updated'))
        } catch (e) {
            console.error(e)
            message.error(e instanceof Error ? e.message : t('The dates could not be updated.'))
        } finally {
            setDetailsSaving(false)
        }
    }

    const doReplaceUpload = async () => {
        if (!activeRow || !replaceFile) return

        try {
            setReplaceUploading(true)
            const entry = await uploadComplianceDoc(activeRow.type, replaceFile, editIssue, editExpiry)
            if (!entry) return
            await refreshFromServer()
            message.success(t('Replacement uploaded'))
            closeReplace()
        } catch (e) {
            console.error(e)
            message.error(t('Upload failed'))
        } finally {
            setReplaceUploading(false)
        }
    }

    const columns: ColumnsType<ComplianceRow> = [
        {
            title: t('Document'),
            dataIndex: 'type',
            key: 'type',
            render: (v: any) => <Text strong>{String(v || '').trim() || '-'}</Text>,
        },
        {
            title: t('Status'),
            dataIndex: 'status',
            key: 'status',
            render: (v: any) => getStatusTag(String(v || 'missing')),
        },
        {
            title: t('Review'),
            key: 'review',
            render: (_: any, record: ComplianceRow) => (
                <Space size={8}>
                    {getReviewTag(record.verificationStatus)}
                    {record.verificationStatus === 'queried' && record.verificationComment ? (
                        <Tooltip title={<div style={{ maxWidth: 320 }}><b>{t('Reason:')}</b> {record.verificationComment}</div>}>
                            <ExclamationCircleOutlined style={{ color: '#fa541c' }} />
                        </Tooltip>
                    ) : null}
                </Space>
            ),
        },
        {
            title: t('Expiry'),
            dataIndex: 'expiry',
            key: 'expiry',
            render: (_: any, record: ComplianceRow) => {
                const expired = isExpired(record.expiry, record.status)
                const soon = !expired && isExpiringSoon(record.expiry, 30)
                return (
                    <Space size={8}>
                        <Text>{record.expiry}</Text>
                        {expired ? <Tag color="red">{t('EXPIRED')}</Tag> : soon ? <Tag color="orange">{t('EXPIRING')}</Tag> : null}
                    </Space>
                )
            },
        },
        {
            title: t('Actions'),
            key: 'actions',
            width: 190,
            render: (_: any, record: ComplianceRow) => (
                <Space>
                    <Tooltip title={t('Details')}>
                        <Button type="text" shape="circle" icon={<FileTextOutlined />} onClick={() => openDetails(record)} />
                    </Tooltip>
                    <Tooltip title={record.url ? t('Open') : t('No file')}>
                        <Button
                            type="text"
                            shape="circle"
                            icon={<EyeOutlined />}
                            disabled={!record.url}
                            onClick={() => openInNewTab(record.url)}
                        />
                    </Tooltip>
                    <Tooltip title={record.url ? t('Replace document') : t('Upload document')}>
                        <Button
                            type={record.url ? 'text' : 'primary'}
                            shape="circle"
                            icon={<UploadOutlined />}
                            onClick={() => (record.url ? openReplace(record) : openUploadFor(record.type))}
                        />
                    </Tooltip>
                </Space>
            ),
        },
    ]

    const renderMobileCards = () => (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {loading ? (
                <Card loading style={{ borderRadius: 14 }} />
            ) : visibleDocs.length === 0 ? (
                <Alert
                    type="info"
                    showIcon
                    message={t('No documents uploaded yet')}
                    description={t('Use Add Document to upload your first compliance file.')}
                />
            ) : (
                visibleDocs.map(d => {
                    const expired = isExpired(d.expiry, d.status)
                    const soon = !expired && isExpiringSoon(d.expiry, 30)

                    return (
                        <Card key={d.key} style={{ border: '1px solid #d6e4ff', borderRadius: 16 }} bodyStyle={{ padding: 14 }}>
                            <Space direction="vertical" style={{ width: '100%' }} size={12}>
                                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                    <Text strong style={{ fontSize: 15 }}>{d.type}</Text>
                                    <Space size={6} wrap>
                                        {getStatusTag(d.status)}
                                        {getReviewTag(d.verificationStatus)}
                                        {expired ? <Tag color="red">{t('EXPIRED')}</Tag> : soon ? <Tag color="orange">{t('EXPIRING')}</Tag> : null}
                                    </Space>
                                </Space>

                                <Descriptions bordered size="small" column={1}>
                                    <Descriptions.Item label={t('Issue Date')}>{d.issue}</Descriptions.Item>
                                    <Descriptions.Item label={t('Expiry Date')}>{d.expiry}</Descriptions.Item>
                                </Descriptions>

                                {d.verificationStatus === 'queried' && d.verificationComment ? (
                                    <Alert type="warning" showIcon message={t('Queried')} description={d.verificationComment} />
                                ) : null}

                                <Button
                                    type="primary"
                                    size="large"
                                    shape='round'
                                    block
                                    icon={<UploadOutlined />}
                                    onClick={() => openReplace(d)}
                                    style={{ height: 46, fontWeight: 700 }}
                                >
                                    {t('Replace Document')}
                                </Button>

                                <Row gutter={[10, 10]}>
                                    <Col span={12}>
                                        <Button
                                            block
                                            shape='round'
                                            variant='filled'
                                            color='geekblue'
                                            style={{ border: '1px solid dodgerblue' }}
                                            icon={<FileTextOutlined />}
                                            onClick={() => openDetails(d)}>
                                            {t('Details')}
                                        </Button>
                                    </Col>
                                    <Col span={12}>
                                        <Button
                                            block
                                            shape='round'
                                            variant='filled'
                                            color='geekblue'
                                            style={{ border: '1px solid dodgerblue' }}
                                            icon={<EyeOutlined />}
                                            disabled={!d.url} onClick={() => openInNewTab(d.url)}>
                                            {t('View')}
                                        </Button>
                                    </Col>
                                </Row>
                            </Space>
                        </Card>
                    )
                })
            )}
        </Space>
    )

    const addButton = (
        <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsAddModalVisible(true)}
        >
            {isMobile ? t('Add') : t('Add document')}
        </Button>
    )

    const viewSwitch = (
        <Segmented
            value={view}
            onChange={(next) => setView(next as ViewKey)}
            options={[
                { label: t('Data'), value: 'data', icon: <TableOutlined /> },
                { label: t('Risk'), value: 'risk', icon: <BarChartOutlined /> },
            ]}
        />
    )

    return (
        <DashboardPage className="incubatee-page incubatee-compliance-page">
            <Helmet>
                <title>{t('Compliance Tracking | Smart Incubation')}</title>
            </Helmet>

            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}>
                    <DashboardMetricCard icon={<CheckCircleOutlined />} label={t('Valid documents')} value={validCount} />
                </Col>

                <Col xs={12} lg={6}>
                    <DashboardMetricCard icon={<ExclamationCircleOutlined />} label={t('Still missing')} value={missingCount} />
                </Col>

                <Col xs={12} lg={6}>
                    <DashboardMetricCard icon={<ClockCircleOutlined />} label={t('Expired')} value={expiredCount} />
                </Col>

                <Col xs={12} lg={6}>
                    <DashboardMetricCard icon={<FileTextOutlined />} label={t('Queried by operations')} value={queriedCount} />
                </Col>
            </Row>

            <FilterBar
                primary={
                    <>
                        <Select
                            value={statusFilter}
                            onChange={setStatusFilter}
                            options={[
                                { value: 'all', label: t('All statuses') },
                                { value: 'valid', label: t('Valid') },
                                { value: 'missing', label: t('Missing') },
                                { value: 'expired', label: t('Expired') },
                                { value: 'queried', label: t('Queried') },
                            ]}
                        />

                        {viewSwitch}
                    </>
                }
                actions={addButton}
            />

            {/* The filter bar collapses into a modal on phones, so these stay out here. */}
            {isMobile && (
                <div className="incubatee-metrics-mobile-actions">
                    {viewSwitch}
                    {addButton}
                </div>
            )}

            {view === 'risk' ? (
                <div className="incubatee-compliance-charts">
                    <MotionCard className="incubatee-metrics-panel" title={t('Compliance score')}>
                        <div className="compliance-score">
                            <Progress
                                type="dashboard"
                                gapDegree={180}
                                percent={complianceScore}
                                size={isMobile ? 180 : 220}
                                strokeColor={complianceScore >= 80 ? '#059669' : complianceScore >= 50 ? '#d97706' : '#dc2626'}
                                format={(percent) => (
                                    <span className="compliance-score-value">
                                        <strong>{percent}%</strong>
                                        <span>{`${validCount} of ${documentTypes.length} valid`}</span>
                                    </span>
                                )}
                            />

                            <div className="compliance-score-legend">
                                <span><i className="is-valid" />{t('Valid')} {validCount}</span>
                                <span><i className="is-missing" />{t('Missing')} {missingCount}</span>
                                <span><i className="is-expired" />{t('Expired')} {expiredCount}</span>
                                <span><i className="is-queried" />{t('Queried')} {queriedCount}</span>
                            </div>
                        </div>
                    </MotionCard>

                    <MotionCard className="incubatee-metrics-panel" title={t('Risk drivers')}>
                        <ThemedHighcharts options={riskOptions} />
                    </MotionCard>
                </div>
            ) : (
                <MotionCard
                    className="incubatee-metrics-panel"
                    title={t('Compliance documents')}
                    extra={
                        <Text type="secondary">
                            {`${visibleDocs.length} of ${documentRows.length}`}
                            {expiringSoonCount ? ` · ${expiringSoonCount} expiring soon` : ''}
                        </Text>
                    }
                >
                    {isMobile ? renderMobileCards() : (
                        <Table
                            size="small"
                            columns={columns}
                            dataSource={visibleDocs}
                            loading={loading}
                            pagination={{ pageSize: 8, size: 'small', hideOnSinglePage: true }}
                            rowKey="key"
                            onRow={record => ({ onDoubleClick: () => openDetails(record) })}
                            scroll={{ x: 920 }}
                        />
                    )}
                </MotionCard>
            )}

            <Modal
                title={<Space><UploadOutlined /><span>{t('Upload new document')}</span></Space>}
                open={isAddModalVisible}
                onCancel={resetAddModal}
                width={520}
                destroyOnClose
                footer={[
                    <Button key="cancel" onClick={resetAddModal}>{t('Cancel')}</Button>,
                    <Button key="upload" type="primary" icon={<UploadOutlined />} loading={addUploading} disabled={!selectedType || !uploadFile} onClick={handleAddNew}>
                        {t('Upload Document')}
                    </Button>,
                ]}
                style={{ borderRadius: 14 }}
            >
                <Alert
                    type="info"
                    showIcon
                    message={t('Upload a clear document')}
                    description={t('Expiry date can be left blank if it does not apply.')}
                    style={{ marginBottom: 14, borderRadius: 12 }}
                />

                <Space direction="vertical" style={{ width: '100%' }} size={12}>
                    <Select
                        placeholder={t('Select document type')}
                        style={{ width: '100%' }}
                        value={selectedType || undefined}
                        onChange={setSelectedType}
                        showSearch
                        optionFilterProp="children"
                    >
                        {missingDocsList.map(type => <Option key={type} value={type}>{type}</Option>)}
                    </Select>

                    <Row gutter={[12, 12]}>
                        <Col xs={24} md={12}><DatePicker placeholder={t('Issue Date')} style={{ width: '100%' }} value={issueDateAdd} onChange={setIssueDateAdd} /></Col>
                        <Col xs={24} md={12}><DatePicker placeholder={t('Expiry Date')} style={{ width: '100%' }} value={expiryDateAdd} onChange={setExpiryDateAdd} /></Col>
                    </Row>

                    <Dragger
                        beforeUpload={file => {
                            setUploadFile(file as File)
                            return false
                        }}
                        maxCount={1}
                        fileList={uploadFile ? [{ uid: 'new-doc', name: uploadFile.name } as any] : []}
                        onRemove={() => setUploadFile(null)}
                    >
                        <p className="ant-upload-drag-icon"><UploadOutlined /></p>
                        <p className="ant-upload-text">{t('Select or drag document here')}</p>
                        <p className="ant-upload-hint">{t('PDF or image files are recommended.')}</p>
                    </Dragger>
                </Space>
            </Modal>

            <Modal
                title={<Space><FileTextOutlined /><span>{t('Document details')}</span></Space>}
                open={detailsOpen}
                onCancel={closeDetails}
                width={620}
                destroyOnClose
                footer={
                    <Row gutter={[10, 10]} style={{ width: '100%' }}>
                        <Col xs={12} md={6}>
                            <Button
                                danger
                                block
                                shape="round"
                                icon={<ExclamationCircleOutlined />}
                                onClick={closeDetails}
                            >
                                {t('Close')}
                            </Button>
                        </Col>

                        {activeRow?.url ? (
                            <>
                                <Col xs={12} md={6}>
                                    <Button
                                        block
                                        shape="round"
                                        icon={<UploadOutlined />}
                                        onClick={() => activeRow && openReplace(activeRow)}
                                    >
                                        {t('Replace')}
                                    </Button>
                                </Col>

                                <Col xs={12} md={6}>
                                    <Button
                                        block
                                        shape="round"
                                        icon={<EyeOutlined />}
                                        onClick={() => openInNewTab(activeRow?.url)}
                                    >
                                        {t('View')}
                                    </Button>
                                </Col>

                                <Col xs={12} md={6}>
                                    <Button
                                        block
                                        shape="round"
                                        type="primary"
                                        icon={<SaveOutlined />}
                                        loading={detailsSaving}
                                        disabled={!canSaveDates}
                                        onClick={saveDates}
                                    >
                                        {t('Save')}
                                    </Button>
                                </Col>
                            </>
                        ) : (
                            <Col xs={12} md={12}>
                                <Button
                                    block
                                    shape="round"
                                    type="primary"
                                    icon={<UploadOutlined />}
                                    onClick={() => {
                                        closeDetails()
                                        if (activeRow) openUploadFor(activeRow.type)
                                    }}
                                >
                                    {t('Upload document')}
                                </Button>
                            </Col>
                        )}
                    </Row>
                }
                style={{ borderRadius: 14 }}
            >
                {activeRow ? (
                    <Space direction="vertical" style={{ width: '100%' }} size={14}>
                        <Descriptions bordered size="small" column={isMobile ? 1 : 2}>
                            <Descriptions.Item label={t('Type')}><Text strong>{activeRow.type}</Text></Descriptions.Item>
                            <Descriptions.Item label={t('Status')}>{getStatusTag(activeRow.status)}</Descriptions.Item>
                            <Descriptions.Item label={t('Review')}>{getReviewTag(activeRow.verificationStatus)}</Descriptions.Item>
                            <Descriptions.Item label={t('File')}>{activeRow.fileName || '-'}</Descriptions.Item>
                        </Descriptions>

                        {activeRow.url ? (
                            <Row gutter={[12, 12]}>
                                <Col xs={24} md={12}>
                                    <DatePicker placeholder={t('Issue date')} style={{ width: '100%' }} value={editIssue} onChange={setEditIssue} />
                                </Col>
                                <Col xs={24} md={12}>
                                    <DatePicker placeholder={t('Expiry date')} style={{ width: '100%' }} value={editExpiry} onChange={setEditExpiry} />
                                </Col>
                            </Row>
                        ) : (
                            <Alert
                                type="info"
                                showIcon
                                message={t('Nothing uploaded yet')}
                                description={t('Upload this document to record its issue and expiry dates.')}
                            />
                        )}

                        {activeRow.verificationStatus === 'queried' && activeRow.verificationComment ? (
                            <Alert type="warning" showIcon message={t('Queried by reviewer')} description={activeRow.verificationComment} />
                        ) : null}
                    </Space>
                ) : <Text type="secondary">{t('No document selected.')}</Text>}
            </Modal>

            <Modal
                title={<Space><UploadOutlined /><span>{t('Replace document')}</span></Space>}
                open={replaceOpen}
                onCancel={closeReplace}
                width={520}
                destroyOnClose
                footer={
                    <Row gutter={[10, 10]} style={{ width: '100%' }}>
                        <Col xs={12} md={6}>
                            <Button
                                danger
                                block
                                shape="round"
                                icon={<ExclamationCircleOutlined />}
                                onClick={closeReplace}
                            >
                                {t('Close')}
                            </Button>
                        </Col>

                        <Col xs={12} md={6}>
                            <Button
                                block
                                shape="round"
                                icon={<UploadOutlined />}
                                loading={replaceUploading}
                                disabled={!activeRow || !replaceFile}
                                onClick={doReplaceUpload}
                            >
                                {t('Upload')}
                            </Button>
                        </Col>

                        <Col xs={12} md={6}>
                            <Button
                                block
                                shape="round"
                                icon={<EyeOutlined />}
                                disabled={!activeRow?.url}
                                onClick={() => openInNewTab(activeRow?.url)}
                            >
                                {t('View')}
                            </Button>
                        </Col>

                        <Col xs={12} md={6}>
                            <Button
                                block
                                shape="round"
                                type="primary"
                                icon={<SaveOutlined />}
                                loading={detailsSaving}
                                disabled={!activeRow || !canSaveDates}
                                onClick={saveDates}
                            >
                                {t('Save')}
                            </Button>
                        </Col>
                    </Row>
                }
                style={{ borderRadius: 14 }}
                styles={{ body: { paddingTop: 8 } }}
            >
                {activeRow ? (
                    <Space direction="vertical" style={{ width: '100%' }} size={14}>
                        <Alert
                            type="warning"
                            showIcon
                            message={`Replacing: ${activeRow.type}`}
                            description={t('This will replace the current file and reset the document for review.')}
                            style={{ borderRadius: 12 }}
                        />

                        <Descriptions bordered size="small" column={1}>
                            <Descriptions.Item label={t('Current File')}>{activeRow.fileName || '-'}</Descriptions.Item>
                            <Descriptions.Item label={t('Current Status')}>{getStatusTag(activeRow.status)}</Descriptions.Item>
                        </Descriptions>

                        <Row gutter={[12, 12]}>
                            <Col xs={24} md={12}>
                                <DatePicker placeholder={t('Issue Date')} style={{ width: '100%' }} value={editIssue} onChange={setEditIssue} />
                            </Col>
                            <Col xs={24} md={12}>
                                <DatePicker placeholder={t('Expiry Date')} style={{ width: '100%' }} value={editExpiry} onChange={setEditExpiry} />
                            </Col>
                        </Row>

                        <Dragger
                            beforeUpload={file => {
                                setReplaceFile(file as File)
                                return false
                            }}
                            maxCount={1}
                            fileList={replaceFile ? [{ uid: 'replace-doc', name: replaceFile.name } as any] : []}
                            onRemove={() => setReplaceFile(null)}
                        >
                            <p className="ant-upload-drag-icon"><UploadOutlined /></p>
                            <p className="ant-upload-text">{t('Select the replacement document')}</p>
                            <p className="ant-upload-hint">{t('The file is only uploaded when Upload Replacement is clicked.')}</p>
                        </Dragger>

                        {activeRow.url ? (
                            <Button icon={<EyeOutlined />} onClick={() => openInNewTab(activeRow.url)}>
                                {t('View Current Document')}
                            </Button>
                        ) : null}
                    </Space>
                ) : <Text type="secondary">{t('No document selected.')}</Text>}
            </Modal>
        </DashboardPage>
    )
}

export default DocumentHub
