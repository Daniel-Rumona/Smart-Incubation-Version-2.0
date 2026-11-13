import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, App, Grid, Avatar, Button, Col, Drawer, Empty, Input, Modal, Popover, Row, Skeleton, Space, Table, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    AppstoreOutlined,
    AuditOutlined,
    BookOutlined,
    CalendarOutlined,
    CameraOutlined,
    ClockCircleOutlined,
    CloudOutlined,
    CopyOutlined,
    DatabaseOutlined,
    DeleteOutlined,
    ExportOutlined,
    FileDoneOutlined,
    FileImageOutlined,
    FileOutlined,
    FilePdfOutlined,
    FileProtectOutlined,
    FileTextOutlined,
    FolderFilled,
    FolderOutlined,
    HomeOutlined,
    IdcardOutlined,
    PictureOutlined,
    ReadOutlined,
    ReloadOutlined,
    RightOutlined,
    SafetyCertificateOutlined,
    SearchOutlined,
    SignatureOutlined,
    SolutionOutlined,
    TrophyOutlined,
    UserOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '@/config/firebase'
import { USER_ROLE_LABELS, type UserRole } from '@/config/roles'

import { AdminKpiTile } from '@/components/admin/AdminKpiTile'
import '@/styles/admin-dashboard.css'
import '@/styles/admin-storage.css'

const formatRole = (role: string) => USER_ROLE_LABELS[role as UserRole] || role
const functions = getFunctions(firebaseApp, 'us-central1')

dayjs.extend(relativeTime)

const { Text } = Typography

/*
 * Storage: browse, open and delete the files in Firebase Storage. Everything
 * goes through the admin callables in functions/src/storageBrowser.ts, since
 * storage.rules only lets each path's own users read it. Those callables also
 * turn the ids in a path into names, and say whose file it is.
 */

type StoredFile = {
    path: string
    size: number
    contentType: string | null
    updated: string | null
    created: string | null
    customMetadata: Record<string, string>
}
type Resolved = {
    id: string
    kind: string
    kindLabel: string
    name: string
    detail: string | null
    role: string | null
    person: boolean
    ownerName: string | null
}
type FileWithUrl = StoredFile & { url: string; owner: Resolved | null; uploader: Resolved | null; trail: Array<Resolved & { folder: string }> }
type ListResult = {
    prefix: string
    folders: string[]
    files: StoredFile[]
    labels: Record<string, Resolved>
    owners: Record<string, Resolved | null>
    nextPageToken: string | null
}
type Area = { prefix: string; count: number; bytes: number; latest: string | null; capped: boolean }
type Overview = { areas: Area[]; rootFiles: StoredFile[] }
type MeasureResult = { prefix: string; count: number; bytes: number; capped: boolean }
type Row = { key: string; kind: 'folder' | 'file'; name: string; path: string; file?: StoredFile; label?: Resolved; owner?: Resolved | null }

const listFolder = httpsCallable<{ prefix: string; pageToken?: string | null }, ListResult>(functions, 'adminStorageList')
const loadOverview = httpsCallable<Record<string, never>, Overview>(functions, 'adminStorageOverview', { timeout: 300_000 })
const measureFolder = httpsCallable<{ prefix: string }, MeasureResult>(functions, 'adminStorageMeasure', { timeout: 300_000 })
const fileUrl = httpsCallable<{ path: string }, FileWithUrl>(functions, 'adminStorageFileUrl')
const deleteFiles = httpsCallable<{ paths: string[]; reason: string }, { deleted: string[]; failed: Array<{ path: string; error: string }> }>(
    functions,
    'adminStorageDelete'
)

/** What each top-level folder holds, in words. Unknown folders show their own name. */
const AREAS: Record<string, { label: string; description: string; icon: React.ReactNode }> = {
    'user-profiles': { label: 'Profile photos', description: 'Profile images uploaded by users', icon: <UserOutlined /> },
    'consultant-profiles': { label: 'Consultant photos', description: 'Consultant marketplace profile images', icon: <UserOutlined /> },
    'company-logos': { label: 'Company logos', description: 'Logos uploaded during company setup', icon: <PictureOutlined /> },
    'user-signatures': { label: 'User signatures', description: 'Signatures captured during onboarding', icon: <SignatureOutlined /> },
    'intervention-documents': { label: 'Intervention documents', description: 'Documents generated for SME interventions', icon: <FileTextOutlined /> },
    'surveyResponses': { label: 'Survey attachments', description: 'Files submitted with survey responses', icon: <FileDoneOutlined /> },
    'courseMaterials': { label: 'Course materials', description: 'Files attached to learning courses', icon: <ReadOutlined /> },
    'academyMaterials': { label: 'Course materials', description: 'Files attached to Academy courses', icon: <ReadOutlined /> },
    'academySubmissions': { label: 'Learner submissions', description: 'Work learners hand in on courses', icon: <FileDoneOutlined /> },
    'agreements': { label: 'Signed agreements', description: 'Countersigned agreement PDFs per SME', icon: <FileProtectOutlined /> },
    'appointments': { label: 'Appointment photos', description: 'Coverage photos from appointments', icon: <CalendarOutlined /> },
    'assignedInterventions': { label: 'Intervention proof', description: 'Evidence and progress files per intervention', icon: <SolutionOutlined /> },
    'certificate_templates': { label: 'Certificate templates', description: 'Fillable PDFs used to issue certificates', icon: <SafetyCertificateOutlined /> },
    'certificates': { label: 'Issued certificates', description: 'Certificates generated per training', icon: <TrophyOutlined /> },
    'collaborative-reports': { label: 'Report files', description: 'Report templates and section evidence', icon: <FileTextOutlined /> },
    'compliance': { label: 'Compliance documents', description: 'Uploaded by SMEs after onboarding', icon: <AuditOutlined /> },
    'compliance-documents': { label: 'Compliance documents (older)', description: 'Earlier compliance uploads', icon: <AuditOutlined /> },
    'consolidatedMOVs': { label: 'Consolidated MOVs', description: 'Monthly MOV packs per department', icon: <FileDoneOutlined /> },
    'facilities': { label: 'Facility photos', description: 'Issue and gap photos per centre', icon: <CameraOutlined /> },
    'feature-releases': { label: 'Release images', description: 'Screenshots for feature announcements', icon: <PictureOutlined /> },
    'intervention-evidence': { label: 'Intervention evidence', description: 'Evidence per programme, SME and intervention', icon: <SolutionOutlined /> },
    'library': { label: 'Library', description: 'Files people share in the library', icon: <BookOutlined /> },
    'mov-documents': { label: 'MOV documents', description: 'Means of verification per SME and intervention', icon: <FileDoneOutlined /> },
    'participant_documents': { label: 'Application documents', description: 'Captured during application and onboarding', icon: <IdcardOutlined /> },
    'profile-images': { label: 'Profile photos', description: 'One avatar per user', icon: <UserOutlined /> },
    'programLogos': { label: 'Programme logos', description: 'Logos shown on programmes', icon: <PictureOutlined /> },
    'projectProposals': { label: 'Project proposals', description: 'Proposal files, staff only', icon: <FileTextOutlined /> },
    'reports': { label: 'Reports', description: 'Generated report files', icon: <FileTextOutlined /> },
    'signatures': { label: 'Signatures', description: 'Saved signature images per user', icon: <SignatureOutlined /> },
    'synthetic': { label: 'Synthetic data', description: 'Generated test data', icon: <DatabaseOutlined /> },
    'training_attendees': { label: 'Attendee ID copies', description: 'ID copies per training attendee', icon: <IdcardOutlined /> },
    'training_enrollments': { label: 'Training enrolments', description: 'Company documents per training', icon: <TrophyOutlined /> },
    'workflowQueries': { label: 'Query attachments', description: 'Files attached when resolving queries', icon: <SolutionOutlined /> }
}

const areaOf = (prefix: string) => {
    const key = prefix.split('/')[0]
    return AREAS[key] || { label: key, description: 'Files in this folder', icon: <FolderOutlined /> }
}

const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
    const value = bytes / 1024 ** i
    return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

const baseName = (path: string) => path.replace(/\/$/, '').split('/').pop() || path

/** A folder with no record behind it, in words: "2026-10" -> "October 2026", "monthly-summary" -> "Monthly summary". */
const folderTitle = (path: string) => {
    const name = baseName(path)
    if (/^\d{4}-\d{2}$/.test(name)) return dayjs(`${name}-01`).format('MMMM YYYY')
    if (/^[a-z]+([-_][a-z]+)*$/i.test(name)) {
        const words = name.replace(/[-_]+/g, ' ').toLowerCase()
        return words.charAt(0).toUpperCase() + words.slice(1)
    }
    return name
}

/** "1714030000000_ID copy.pdf" -> "ID copy.pdf": drops the upload timestamp most paths start with. */
const displayName = (path: string) => {
    const name = baseName(path)
    const stripped = name.replace(/^\d{12,14}[_-]/, '').replace(/^[0-9a-f]{8}-[0-9a-f-]{27}_/i, '')
    return stripped || name
}

const initialsOf = (name: string) =>
    name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || '?'

const fileKind = (contentType: string | null, path: string) => {
    if (contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(path)) return 'image'
    if (contentType === 'application/pdf' || /\.pdf$/i.test(path)) return 'pdf'
    return 'file'
}

const FileIcon: React.FC<{ file: StoredFile; small?: boolean }> = ({ file, small }) => {
    const kind = fileKind(file.contentType, file.path)
    return (
        <span className={`storage-icon-disc is-${kind}${small ? ' is-small' : ''}`}>
            {kind === 'image' ? <FileImageOutlined /> : kind === 'pdf' ? <FilePdfOutlined /> : <FileOutlined />}
        </span>
    )
}

/** "application/vnd.openxmlformats-officedocument.wordprocessingml.document" is no use in a table cell. */
const typeLabel = (file: StoredFile) => {
    const ext = file.path.includes('.') ? file.path.split('.').pop()!.toUpperCase() : ''
    if (ext && ext.length <= 5) return ext
    if (file.contentType?.startsWith('image/')) return file.contentType.split('/')[1].toUpperCase()
    return file.contentType?.split('/').pop()?.split('.').pop()?.toUpperCase().slice(0, 6) || 'FILE'
}

const ownerSubline = (owner: Resolved) => {
    const kind = owner.role ? formatRole(owner.role) || owner.kindLabel : owner.kindLabel
    return owner.detail ? `${kind} · ${owner.detail}` : kind
}

const OwnerChip: React.FC<{ owner: Resolved | null | undefined }> = ({ owner }) =>
    owner ? (
        <div className='storage-owner'>
            <Avatar size={26}>{initialsOf(owner.name)}</Avatar>
            <div className='storage-owner-copy'>
                <strong title={owner.name}>{owner.name}</strong>
                <small title={ownerSubline(owner)}>{ownerSubline(owner)}</small>
            </div>
        </div>
    ) : (
        <Tooltip title="This file's path doesn't name a person or SME">
            <Text type='secondary'>—</Text>
        </Tooltip>
    )

const errorText = (e: any) => String(e?.message || e || 'Something went wrong').replace(/^FirebaseError:\s*/, '')

const StoragePage: React.FC = () => {
    const { message } = App.useApp()
    const isMobile = !Grid.useBreakpoint().md

    const [prefix, setPrefix] = useState('')

    const [overview, setOverview] = useState<Overview | null>(null)
    const [overviewLoading, setOverviewLoading] = useState(false)

    const [listing, setListing] = useState<ListResult | null>(null)
    const [loading, setLoading] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [filter, setFilter] = useState('')
    const [pathInput, setPathInput] = useState('')
    const [jumpOpen, setJumpOpen] = useState(false)

    const [measure, setMeasure] = useState<MeasureResult | null>(null)
    const [measuring, setMeasuring] = useState(false)

    const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([])
    const [detail, setDetail] = useState<FileWithUrl | null>(null)
    const [detailLoading, setDetailLoading] = useState<string | null>(null)

    const [deleteTargets, setDeleteTargets] = useState<string[]>([])
    const [deleteReason, setDeleteReason] = useState('')
    const [deleting, setDeleting] = useState(false)

    /** Breadcrumb names survive moving up and down, so a crumb keeps its name once it has been seen. */
    const [knownLabels, setKnownLabels] = useState<Record<string, Resolved>>({})

    const fetchOverview = useCallback(async () => {
        setOverviewLoading(true)
        setError(null)
        try {
            const { data } = await loadOverview({})
            setOverview(data)
        } catch (e) {
            setError(errorText(e))
        } finally {
            setOverviewLoading(false)
        }
    }, [])

    /** The folder last asked for: a slower reply for a folder already left is dropped. */
    const latestPrefix = useRef('')
    const fetchFolder = useCallback(async (target: string) => {
        latestPrefix.current = target
        setLoading(true)
        setError(null)
        try {
            const { data } = await listFolder({ prefix: target })
            if (latestPrefix.current !== target) return
            setListing(data)
            setKnownLabels(prev => ({ ...prev, ...data.labels }))
        } catch (e) {
            if (latestPrefix.current !== target) return
            setListing(null)
            setError(errorText(e))
        } finally {
            if (latestPrefix.current === target) setLoading(false)
        }
    }, [])

    useEffect(() => {
        setSelectedKeys([])
        setMeasure(null)
        setFilter('')
        setPathInput(prefix)
        // Drop the previous folder at once so its rows don't linger while the new one loads.
        setListing(null)
        if (prefix) fetchFolder(prefix)
        else {
            latestPrefix.current = ''
            setLoading(false)
            if (!overview) fetchOverview()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefix])

    const refresh = () => (prefix ? fetchFolder(prefix) : fetchOverview())

    const loadMore = async () => {
        if (!listing?.nextPageToken) return
        setLoadingMore(true)
        try {
            const { data } = await listFolder({ prefix, pageToken: listing.nextPageToken })
            if (latestPrefix.current !== prefix) return
            setListing(prev =>
                prev && {
                    ...data,
                    folders: Array.from(new Set([...prev.folders, ...data.folders])),
                    files: [...prev.files, ...data.files],
                    labels: { ...prev.labels, ...data.labels },
                    owners: { ...prev.owners, ...data.owners }
                }
            )
            setKnownLabels(prev => ({ ...prev, ...data.labels }))
        } catch (e) {
            message.error(errorText(e))
        } finally {
            setLoadingMore(false)
        }
    }

    const runMeasure = async () => {
        setMeasuring(true)
        try {
            const { data } = await measureFolder({ prefix })
            if (latestPrefix.current === prefix) setMeasure(data)
        } catch (e) {
            message.error(errorText(e))
        } finally {
            setMeasuring(false)
        }
    }

    const openDetail = async (path: string) => {
        setDetailLoading(path)
        try {
            const { data } = await fileUrl({ path })
            setDetail(data)
        } catch (e) {
            message.error(errorText(e))
        } finally {
            setDetailLoading(null)
        }
    }

    const copy = async (text: string, what: string) => {
        try {
            await navigator.clipboard.writeText(text)
            message.success(`${what} copied`)
        } catch {
            message.error('Could not copy to the clipboard')
        }
    }

    /** Accepts a folder ("a/b", "a/b/") or a file path; a file opens in the details panel. */
    const goToPath = () => {
        setJumpOpen(false)
        const raw = pathInput.trim().replace(/^\/+/, '')
        if (!raw) return setPrefix('')
        const looksLikeFile = !raw.endsWith('/') && /\.[a-z0-9]{1,6}$/i.test(raw)
        if (looksLikeFile) {
            setPrefix(raw.slice(0, raw.lastIndexOf('/') + 1))
            openDetail(raw)
        } else {
            setPrefix(raw.endsWith('/') ? raw : `${raw}/`)
        }
    }

    const confirmDelete = async () => {
        setDeleting(true)
        try {
            const { data } = await deleteFiles({ paths: deleteTargets, reason: deleteReason.trim() })
            if (data.deleted.length) message.success(`${plural(data.deleted.length, 'file')} deleted`)
            if (data.failed.length) message.error(`${data.failed.length} could not be deleted: ${data.failed.map(f => `${baseName(f.path)} (${f.error})`).join(', ')}`)
            const gone = new Set(data.deleted)
            setListing(prev => prev && { ...prev, files: prev.files.filter(f => !gone.has(f.path)) })
            setOverview(prev => prev && { ...prev, rootFiles: prev.rootFiles.filter(f => !gone.has(f.path)) })
            setSelectedKeys(prev => prev.filter(k => !gone.has(String(k))))
            if (detail && gone.has(detail.path)) setDetail(null)
            setMeasure(null)
            setDeleteTargets([])
            setDeleteReason('')
            void fetchOverview()
        } catch (e) {
            message.error(errorText(e))
        } finally {
            setDeleting(false)
        }
    }

    /** Folders show as cards and files in the table: a folder has no type, size or date, so table columns would sit empty. */
    const { folderRows, fileRows } = useMemo(() => {
        if (!listing) return { folderRows: [] as Row[], fileRows: [] as Row[] }
        const needle = filter.trim().toLowerCase()
        const match = (r: Row) => !needle || [r.name, r.path, r.label?.detail, r.owner?.name, r.owner?.detail].some(v => v?.toLowerCase().includes(needle))
        return {
            folderRows: listing.folders
                .map((f): Row => ({ key: `folder:${f}`, kind: 'folder', name: listing.labels[f]?.name || folderTitle(f), path: f, label: listing.labels[f] }))
                .filter(match),
            fileRows: listing.files
                .map((f): Row => ({ key: f.path, kind: 'file', name: displayName(f.path), path: f.path, file: f, owner: listing.owners[f.path] }))
                .filter(match)
        }
    }, [listing, filter])

    /** Owner column only where it says something: hidden when every file belongs to the folder's own person. */
    const folderOwner = listing?.labels[prefix]
    const showOwnerColumn = fileRows.some(r => r.owner && r.owner.id !== folderOwner?.id)

    const totals = useMemo(() => {
        const areas = overview?.areas || []
        return {
            files: areas.reduce((t, a) => t + a.count, 0) + (overview?.rootFiles.length || 0),
            bytes: areas.reduce((t, a) => t + a.bytes, 0) + (overview?.rootFiles || []).reduce((t, f) => t + f.size, 0),
            capped: areas.some(a => a.capped),
            latest: areas.map(a => a.latest || '').sort().pop() || null,
            largest: [...areas].sort((a, b) => b.bytes - a.bytes)[0]
        }
    }, [overview])

    const crumbs = prefix.split('/').filter(Boolean)
    const crumbLabel = (i: number) => {
        const folder = `${crumbs.slice(0, i + 1).join('/')}/`
        if (i === 0) return areaOf(crumbs[0]).label
        return knownLabels[folder]?.name || folderTitle(folder)
    }

    const columns: ColumnsType<Row> = [
        {
            title: 'Name',
            dataIndex: 'name',
            sorter: (a, b) => a.name.localeCompare(b.name),
            render: (_, row) => (
                    <div className='storage-name-cell' onClick={() => openDetail(row.path)} title={row.path}>
                        <FileIcon file={row.file!} small />
                        <div className='storage-name-copy'>
                            <strong>{row.name}</strong>
                            <small>
                                {isMobile
                                    ? [row.owner?.name, formatBytes(row.file!.size)].filter(Boolean).join(' · ')
                                    : row.file!.created
                                      ? `Uploaded ${dayjs(row.file!.created).format('D MMM YYYY')}`
                                      : baseName(row.path)}
                            </small>
                        </div>
                    </div>
                )
        },
        ...(isMobile
            ? []
            : [
                  ...(showOwnerColumn
                      ? [
                            {
                                title: 'Owner',
                                width: 240,
                                render: (_: unknown, row: Row) => <OwnerChip owner={row.owner} />
                            }
                        ]
                      : []),
                  {
                      title: 'Type',
                      width: 90,
                      render: (_: unknown, row: Row) => (row.file ? <span className='storage-type-tag'>{typeLabel(row.file)}</span> : null)
                  },
                  {
                      title: 'Updated',
                      width: 130,
                      sorter: (a: Row, b: Row) => (a.file?.updated || '').localeCompare(b.file?.updated || ''),
                      render: (_: unknown, row: Row) =>
                          row.file?.updated ? (
                              <Tooltip title={dayjs(row.file.updated).format('D MMM YYYY HH:mm')}>
                                  <Text type='secondary'>{dayjs(row.file.updated).fromNow()}</Text>
                              </Tooltip>
                          ) : null
                  },
                  {
                      title: 'Size',
                      width: 90,
                      align: 'right' as const,
                      sorter: (a: Row, b: Row) => (a.file?.size || 0) - (b.file?.size || 0),
                      render: (_: unknown, row: Row) => (row.file ? formatBytes(row.file.size) : null)
                  }
              ]),
        {
            title: '',
            width: isMobile ? 48 : 96,
            align: 'right',
            render: (_, row) => (
                <Space size={0}>
                    {!isMobile && (
                        <Tooltip title='Open'>
                            <Button type='text' size='small' icon={<ExportOutlined />} loading={detailLoading === row.path} onClick={() => openDetail(row.path)} />
                        </Tooltip>
                    )}
                    <Tooltip title='Delete'>
                        <Button type='text' size='small' danger icon={<DeleteOutlined />} onClick={() => setDeleteTargets([row.path])} />
                    </Tooltip>
                </Space>
            )
        }
    ]

    const folderSubline = (row: Row) => {
        const label = row.label
        // Ids stay out of sight; the row's tooltip still has the raw folder name.
        if (!label) return null
        if (label.ownerName) return `For ${label.ownerName}`
        return label.detail
    }
    const folderKind = (row: Row) => (row.label ? (row.label.role ? formatRole(row.label.role) || row.label.kindLabel : row.label.kindLabel) : null)

    const jumpBox = (
        <div style={{ width: isMobile ? 260 : 360 }}>
            <Input.Search
                autoFocus
                value={pathInput}
                onChange={e => setPathInput(e.target.value)}
                onSearch={goToPath}
                placeholder='e.g. compliance/abc123/ or a full file path'
                enterButton='Go'
            />
        </div>
    )

    const detailKind = detail ? fileKind(detail.contentType, detail.path) : 'file'
    const rootFiles = overview?.rootFiles || []

    return (
        <div className='admin-overview'>
            <Helmet>
                <title>Storage | Smart Incubation</title>
            </Helmet>

            <div className='storage-head'>
                <div>
                    <h2>Storage</h2>
                    <p>Every file uploaded to the platform, by area, with who it belongs to.</p>
                </div>
                <Space wrap>
                    <Popover trigger='click' placement='bottomRight' open={jumpOpen} onOpenChange={setJumpOpen} content={jumpBox} title='Go to a path'>
                        <Button icon={<SearchOutlined />}>Go to path</Button>
                    </Popover>
                    <Tooltip title='Refresh'>
                        <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading || overviewLoading} aria-label='Refresh' />
                    </Tooltip>
                </Space>
            </div>

            {error && <Alert type='error' showIcon message={prefix ? 'Could not load this folder' : 'Could not load storage'} description={error} style={{ marginBottom: 16 }} />}

            {!prefix ? (
                <>
                    <Row gutter={[16, 16]}>
                        <Col xs={24} sm={12} xl={6}>
                            <AdminKpiTile
                                compact
                                loading={overviewLoading && !overview}
                                icon={<FileOutlined />}
                                label='Files'
                                value={totals.files}
                                note={totals.capped ? 'Large areas counted up to 5,000 files' : undefined}
                            />
                        </Col>
                        <Col xs={24} sm={12} xl={6}>
                            <AdminKpiTile compact loading={overviewLoading && !overview} icon={<CloudOutlined />} label='Space used' value={formatBytes(totals.bytes)} />
                        </Col>
                        <Col xs={24} sm={12} xl={6}>
                            <AdminKpiTile
                                compact
                                loading={overviewLoading && !overview}
                                icon={<AppstoreOutlined />}
                                label='Largest area'
                                value={totals.largest ? areaOf(totals.largest.prefix).label : 'None'}
                                note={totals.largest ? formatBytes(totals.largest.bytes) : undefined}
                            />
                        </Col>
                        <Col xs={24} sm={12} xl={6}>
                            <AdminKpiTile
                                compact
                                loading={overviewLoading && !overview}
                                icon={<ClockCircleOutlined />}
                                label='Last upload'
                                value={totals.latest ? dayjs(totals.latest).fromNow() : 'None'}
                                note={totals.latest ? dayjs(totals.latest).format('D MMM YYYY HH:mm') : undefined}
                            />
                        </Col>
                    </Row>

                    <div className='storage-section-title'>
                        <h3>Areas</h3>
                        <span>{overview ? `${plural(overview.areas.length, 'folder')} at the top of the bucket` : ''}</span>
                    </div>

                    {overviewLoading && !overview ? (
                        <div className='storage-areas'>
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className='storage-area'>
                                    <Skeleton active avatar paragraph={{ rows: 2 }} />
                                </div>
                            ))}
                        </div>
                    ) : overview && overview.areas.length ? (
                        <div className='storage-areas'>
                            {[...overview.areas]
                                .sort((a, b) => b.bytes - a.bytes)
                                .map(area => {
                                    const info = areaOf(area.prefix)
                                    const share = totals.bytes ? (area.bytes / totals.bytes) * 100 : 0
                                    return (
                                        <button key={area.prefix} type='button' className='storage-area' onClick={() => setPrefix(area.prefix)}>
                                            <div className='storage-area-top'>
                                                <span className='storage-icon-disc'>{info.icon}</span>
                                                <div style={{ minWidth: 0 }}>
                                                    <span className='storage-area-name'>{info.label}</span>
                                                    <span className='storage-area-desc'>{info.description}</span>
                                                </div>
                                            </div>
                                            <div className='storage-area-stats'>
                                                <strong>{formatBytes(area.bytes)}</strong>
                                                <span>
                                                    {area.count.toLocaleString()}
                                                    {area.capped ? '+' : ''} file{area.count === 1 ? '' : 's'}
                                                </span>
                                            </div>
                                            <div className='storage-area-bar' aria-hidden='true'>
                                                <i style={{ width: `${Math.max(share, 1)}%` }} />
                                            </div>
                                            <div className='storage-area-foot'>
                                                <span className='storage-mono'>{area.prefix}</span>
                                                <span>{area.latest ? dayjs(area.latest).fromNow() : ''}</span>
                                            </div>
                                        </button>
                                    )
                                })}
                        </div>
                    ) : (
                        !overviewLoading && <Empty description='No files in storage yet' />
                    )}

                    {rootFiles.length > 0 && (
                        <>
                            <div className='storage-section-title'>
                                <h3>Loose files</h3>
                                <span>Stored at the top of the bucket, outside any folder</span>
                            </div>
                            <div className='admin-card ant-card' style={{ padding: 8 }}>
                                {rootFiles.map(f => (
                                    <div key={f.path} className='storage-name-cell' style={{ padding: 8 }} onClick={() => openDetail(f.path)}>
                                        <FileIcon file={f} small />
                                        <div className='storage-name-copy'>
                                            <strong>{baseName(f.path)}</strong>
                                            <small>{formatBytes(f.size)}</small>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </>
            ) : (
                <div className='admin-card ant-card' style={{ padding: isMobile ? 14 : 20 }}>
                    <div className='storage-toolbar'>
                        <nav className='storage-crumbs' aria-label='Folder path'>
                            <button type='button' className='storage-crumb' onClick={() => setPrefix('')}>
                                <HomeOutlined />
                                <span>All areas</span>
                            </button>
                            {crumbs.map((part, i) => {
                                const target = `${crumbs.slice(0, i + 1).join('/')}/`
                                const current = i === crumbs.length - 1
                                const label = crumbLabel(i)
                                return (
                                    <React.Fragment key={target}>
                                        <RightOutlined className='storage-crumb-sep' />
                                        <Tooltip title={label !== part ? part : undefined}>
                                            <button
                                                type='button'
                                                className={current ? 'storage-crumb is-current' : 'storage-crumb'}
                                                onClick={() => !current && setPrefix(target)}
                                                aria-current={current ? 'page' : undefined}
                                            >
                                                {i === 0 && areaOf(part).icon}
                                                <span>{label}</span>
                                            </button>
                                        </Tooltip>
                                    </React.Fragment>
                                )
                            })}
                        </nav>
                        <Input
                            className='storage-filter'
                            prefix={<SearchOutlined />}
                            value={filter}
                            onChange={e => setFilter(e.target.value)}
                            placeholder='Filter by name or owner'
                            allowClear
                        />
                        <Button icon={<DatabaseOutlined />} loading={measuring} onClick={runMeasure}>
                            Measure
                        </Button>
                    </div>

                    {listing && (
                        <div className='storage-summary'>
                            <span>
                                <strong>{plural(listing.folders.length, 'folder')}</strong> · <strong>{plural(listing.files.length, 'file')}</strong>
                                {listing.nextPageToken ? ' loaded so far' : ' here'}
                            </span>
                            {listing.files.length > 0 && (
                                <span>
                                    <strong>{formatBytes(listing.files.reduce((t, f) => t + f.size, 0))}</strong> in these files
                                </span>
                            )}
                            {measure && measure.prefix === prefix && (
                                <span>
                                    Everything inside: <strong>{plural(measure.count, 'file')}</strong>, <strong>{formatBytes(measure.bytes)}</strong>
                                    {measure.capped ? ' (stopped counting at this many)' : ''}
                                </span>
                            )}
                        </div>
                    )}

                    {selectedKeys.length > 0 && (
                        <Alert
                            type='info'
                            style={{ marginBottom: 10 }}
                            message={`${plural(selectedKeys.length, 'file')} selected`}
                            action={
                                <Space>
                                    <Button size='small' onClick={() => setSelectedKeys([])}>
                                        Clear
                                    </Button>
                                    <Button size='small' danger icon={<DeleteOutlined />} onClick={() => setDeleteTargets(selectedKeys.map(String))}>
                                        Delete selected
                                    </Button>
                                </Space>
                            }
                        />
                    )}

                    {!listing && !error ? (
                        <div className='storage-folders' aria-busy='true' aria-label='Loading folder'>
                            <Skeleton.Input active size='small' style={{ width: 180, height: 14, marginBottom: 4 }} />
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className='storage-folder is-skeleton'>
                                    <Skeleton.Avatar active size={36} shape='square' />
                                    <span className='storage-name-copy'>
                                        <Skeleton.Input active size='small' style={{ width: 120 + ((i * 47) % 140), height: 14 }} />
                                        <Skeleton.Input active size='small' style={{ width: 90 + ((i * 31) % 80), height: 10, marginTop: 6 }} />
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : listing && !folderRows.length && !fileRows.length ? (
                        <Empty description={filter ? 'Nothing here matches that' : 'This folder is empty'} />
                    ) : null}

                    {folderRows.length > 0 && (
                        <>
                            {fileRows.length > 0 && <div className='storage-group-label'>Folders</div>}
                            <div className='storage-folders'>
                                {folderRows.map(row => (
                                    <button key={row.key} type='button' className='storage-folder' onClick={() => setPrefix(row.path)} title={baseName(row.path)}>
                                        {row.label?.person ? (
                                            <Avatar size={36}>{initialsOf(row.name)}</Avatar>
                                        ) : (
                                            <span className='storage-icon-disc is-small is-folder'>
                                                <FolderFilled />
                                            </span>
                                        )}
                                        <span className='storage-name-copy'>
                                            <strong>{row.name}</strong>
                                            {folderSubline(row) && <small>{folderSubline(row)}</small>}
                                        </span>
                                        {folderKind(row) && <span className='storage-kind-tag'>{folderKind(row)}</span>}
                                        <RightOutlined className='storage-folder-chevron' />
                                    </button>
                                ))}
                            </div>
                        </>
                    )}

                    {fileRows.length > 0 && (
                        <>
                            {folderRows.length > 0 && <div className='storage-group-label'>Files</div>}
                            <Table<Row>
                                className='storage-table'
                                rowKey='key'
                                size='middle'
                                loading={loading}
                                columns={columns}
                                dataSource={fileRows}
                                pagination={fileRows.length > 100 ? { pageSize: 100, showSizeChanger: false } : false}
                                rowSelection={{
                                    selectedRowKeys: selectedKeys,
                                    onChange: keys => setSelectedKeys(keys.slice(0, 50))
                                }}
                                scroll={{ x: isMobile ? undefined : showOwnerColumn ? 860 : 620 }}
                            />
                        </>
                    )}

                    {listing?.nextPageToken && (
                        <div style={{ textAlign: 'center', marginTop: 12 }}>
                            <Button onClick={loadMore} loading={loadingMore}>
                                Load more
                            </Button>
                        </div>
                    )}
                </div>
            )}

            <Drawer
                rootClassName='admin-modal'
                open={!!detail}
                onClose={() => setDetail(null)}
                width={isMobile ? '100%' : 560}
                title={detail ? displayName(detail.path) : ''}
                extra={
                    detail && (
                        <Space>
                            <Button type='primary' icon={<ExportOutlined />} href={detail.url} target='_blank' rel='noopener noreferrer'>
                                Open
                            </Button>
                            <Tooltip title='Delete'>
                                <Button danger icon={<DeleteOutlined />} onClick={() => setDeleteTargets([detail.path])} />
                            </Tooltip>
                        </Space>
                    )
                }
            >
                {detail && (
                    <Space direction='vertical' size={18} style={{ width: '100%' }}>
                        {(detailKind === 'image' || detailKind === 'pdf') && (
                            <div className='storage-preview'>
                                {detailKind === 'image' ? <img src={detail.url} alt={displayName(detail.path)} /> : <iframe title={displayName(detail.path)} src={detail.url} />}
                            </div>
                        )}

                        <div className='storage-owner-card'>
                            {detail.owner ? (
                                <>
                                    <Avatar size={40}>{initialsOf(detail.owner.name)}</Avatar>
                                    <div style={{ minWidth: 0 }}>
                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                            Belongs to
                                        </Text>
                                        <div style={{ fontWeight: 600 }}>{detail.owner.name}</div>
                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                            {ownerSubline(detail.owner)}
                                        </Text>
                                        {detail.uploader && detail.uploader.id !== detail.owner.id && (
                                            <div style={{ fontSize: 12, marginTop: 4 }}>
                                                <Text type='secondary'>Uploaded by </Text>
                                                {detail.uploader.name}
                                                <Text type='secondary'> · {ownerSubline(detail.uploader)}</Text>
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <Avatar size={40} icon={<UserOutlined />} />
                                    <Text type='secondary'>This file's path doesn't name a person or SME.</Text>
                                </>
                            )}
                        </div>

                        {detail.trail.length > 0 && (
                            <div className='storage-trail'>
                                <span className='storage-trail-chip'>
                                    {areaOf(detail.path).icon} {areaOf(detail.path).label}
                                </span>
                                {detail.trail.map(t => (
                                    <Tooltip key={t.folder} title={t.id}>
                                        <span className='storage-trail-chip'>
                                            <em>{t.kindLabel}</em> {t.name}
                                        </span>
                                    </Tooltip>
                                ))}
                            </div>
                        )}

                        <dl className='storage-facts'>
                            <dt>Size</dt>
                            <dd>{formatBytes(detail.size)}</dd>
                            <dt>Type</dt>
                            <dd>{detail.contentType || 'Unknown'}</dd>
                            <dt>Uploaded</dt>
                            <dd>{detail.created ? dayjs(detail.created).format('D MMM YYYY HH:mm') : '—'}</dd>
                            <dt>Updated</dt>
                            <dd>{detail.updated ? dayjs(detail.updated).format('D MMM YYYY HH:mm') : '—'}</dd>
                            {Object.entries(detail.customMetadata).map(([key, value]) => (
                                <React.Fragment key={key}>
                                    <dt>{key}</dt>
                                    <dd>{value}</dd>
                                </React.Fragment>
                            ))}
                            <dt>Path</dt>
                            <dd className='storage-mono'>{detail.path}</dd>
                        </dl>

                        <Space wrap>
                            <Button icon={<CopyOutlined />} onClick={() => copy(detail.path, 'Path')}>
                                Copy path
                            </Button>
                            <Button icon={<CopyOutlined />} onClick={() => copy(detail.url, 'Download link')}>
                                Copy download link
                            </Button>
                        </Space>
                    </Space>
                )}
            </Drawer>

            <Modal
                open={deleteTargets.length > 0}
                title={deleteTargets.length === 1 ? 'Delete this file?' : `Delete ${deleteTargets.length} files?`}
                okText='Delete'
                okButtonProps={{ danger: true, disabled: deleteReason.trim().length < 3, loading: deleting }}
                onOk={confirmDelete}
                onCancel={() => {
                    if (deleting) return
                    setDeleteTargets([])
                    setDeleteReason('')
                }}
            >
                <Space direction='vertical' size={12} style={{ width: '100%' }}>
                    <Alert
                        type='warning'
                        showIcon
                        message='This cannot be undone.'
                        description='Records that link to these files (compliance, evidence, agreements, signatures) will show a broken link. Each deletion is logged with your reason.'
                    />
                    <div style={{ maxHeight: 160, overflow: 'auto' }}>
                        {deleteTargets.map(p => (
                            <div key={p} className='storage-mono' style={{ padding: '2px 0' }}>
                                {p}
                            </div>
                        ))}
                    </div>
                    <Input.TextArea
                        value={deleteReason}
                        onChange={e => setDeleteReason(e.target.value)}
                        placeholder='Reason for deleting (required)'
                        autoSize={{ minRows: 2, maxRows: 4 }}
                        maxLength={500}
                    />
                </Space>
            </Modal>
        </div>
    )
}

export default StoragePage
