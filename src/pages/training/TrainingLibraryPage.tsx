import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, AutoComplete, Button, Col, Form, Input, Modal, Popconfirm, Progress, Row, Segmented, Select, Space, Table, Tag, Tooltip, Typography, Upload, type TableProps } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, EditOutlined, FileOutlined, FolderOpenOutlined, InboxOutlined, LinkOutlined, LoadingOutlined, RobotOutlined, SearchOutlined, TeamOutlined, UploadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    LIBRARY_ACCEPT,
    addLibraryFile,
    addLibraryLink,
    deleteLibraryItem,
    libraryFileProblem,
    listTrainingLibrary,
    openLibraryItem,
    updateLibraryItem,
} from '@/services/trainingLibraryService'
import { listTrainingClasses } from '@/services/trainingService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { LIBRARY_CATEGORY_LABELS } from '@/utils/trainingFormat'
import { guessLibraryDetails } from '@/utils/trainingLibraryGuess'
import type { TrainingLibraryAudience, TrainingLibraryCategory, TrainingLibraryItem, TrainingLibraryValues } from '@/types/training'

/**
 * Keletso's library: the documents she teaches from (manuals, slides, guides, templates), uploaded as they are. Each
 * document's title, type, course and who sees it are filled in from its file name and can be changed before saving;
 * nothing has to be typed. Shared items reach her learners (by course) and client companies; Q answers from the text
 * of PDF, Word and text files. Links (a website, a video) can be added too.
 */

type LinkValues = Omit<TrainingLibraryValues, 'description'>

/** A document waiting to be uploaded, with the details guessed from its name. */
type PendingDocument = {
    uid: string
    file: File
    title: string
    category: TrainingLibraryCategory
    courseTitle: string
    audience: TrainingLibraryAudience
    status: 'waiting' | 'uploading' | 'done' | 'failed'
}

const sizeLabel = (bytes?: number) => (bytes === undefined ? '' : bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

let pendingCounter = 0

export default function TrainingLibraryPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [form] = Form.useForm<LinkValues>()
    const [items, setItems] = useState<TrainingLibraryItem[]>()
    const [courses, setCourses] = useState<string[]>([])
    const [search, setSearch] = useState('')
    const [category, setCategory] = useState<'all' | TrainingLibraryCategory>('all')
    // A new link ('new') or an item whose details are being changed.
    const [editing, setEditing] = useState<TrainingLibraryItem | 'new' | null>(null)
    const [pending, setPending] = useState<PendingDocument[] | null>(null)
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        if (!user) return
        try {
            const [rows, classes] = await Promise.all([listTrainingLibrary(user), listTrainingClasses(user).catch(() => [])])
            setItems(rows)
            setCourses([...new Set(classes.map((row) => row.courseTitle).filter(Boolean))].sort())
        } catch {
            setItems([])
            message.error(t('The library could not be loaded.'))
        }
    }, [message, t, user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const all = useMemo(() => items || [], [items])
    const visible = all.filter((item) => (category === 'all' || item.category === category)
        && (!search.trim() || `${item.title} ${item.description} ${item.courseTitle} ${item.fileName || ''}`.toLowerCase().includes(search.trim().toLowerCase())))

    useRegisterAgentPageContext({
        pageKey: 'training-library',
        pageName: 'Library',
        purpose: 'The training company\'s library of documents (course material, reading, templates and references) and links. Shared items reach learners (for their course) and client companies; Q can answer from the text of PDF, Word and text files.',
        currentFilters: { search, category },
        metrics: { items: all.length, shared: all.filter((item) => item.audience === 'shared').length, readableByAssistant: all.filter((item) => item.textChars > 0).length },
        dataSummary: { items: visible.map((item) => ({ title: item.title, course: item.courseTitle || 'all courses', category: item.category, sharedWithLearners: item.audience === 'shared' })) },
    })

    const categoryOptions = (Object.keys(LIBRARY_CATEGORY_LABELS) as TrainingLibraryCategory[]).map((value) => ({ value, label: t(LIBRARY_CATEGORY_LABELS[value]) }))
    const audienceOptions = [{ value: 'shared', label: t('Learners and client companies') }, { value: 'staff', label: t('Only my team') }]
    const courseOptions = courses.map((value) => ({ value }))

    // Documents: chosen (one or many), checked, then uploaded one after another.
    const addPending = (file: File) => {
        if (libraryFileProblem(file)) {
            message.error(t('{name} is larger than 25 MB.', undefined, { name: file.name }))
            return
        }
        const guess = guessLibraryDetails(file.name, courses)
        setPending((current) => [...(current || []), { uid: `doc-${Date.now()}-${pendingCounter++}`, file, ...guess, status: 'waiting' }])
    }
    const changePending = (uid: string, changes: Partial<PendingDocument>) =>
        setPending((current) => (current || []).map((row) => (row.uid === uid ? { ...row, ...changes } : row)))

    const uploadPending = async () => {
        if (!user || !pending) return
        const queue = pending.filter((row) => row.status !== 'done')
        if (!queue.length) return
        if (queue.some((row) => !row.title.trim())) {
            message.error(t('Give every document a title.'))
            return
        }
        setSaving(true)
        let added = 0
        let failed = 0
        for (const row of queue) {
            changePending(row.uid, { status: 'uploading' })
            try {
                await addLibraryFile(user, { title: row.title, description: '', category: row.category, courseTitle: row.courseTitle, audience: row.audience }, row.file)
                changePending(row.uid, { status: 'done' })
                added += 1
            } catch {
                changePending(row.uid, { status: 'failed' })
                failed += 1
            }
        }
        setSaving(false)
        if (added) await load()
        if (failed) {
            message.error(t('{failed} document(s) could not be uploaded. Try them again.', undefined, { failed }))
        } else {
            message.success(t('{count} document(s) added to the library.', undefined, { count: added }))
            setPending(null)
        }
    }

    // Links, and changing an item's details.
    const startEdit = (item?: TrainingLibraryItem) => {
        setEditing(item || 'new')
        form.setFieldsValue({
            title: item?.title || '',
            category: item?.category || 'reference',
            courseTitle: item?.courseTitle || '',
            audience: item?.audience || 'shared',
            url: item?.url || '',
        })
    }

    const saveItem = async () => {
        if (!user || !editing) return
        const values = await form.validateFields()
        setSaving(true)
        try {
            // A description saved before stays as it was: it is no longer typed here.
            if (editing === 'new') await addLibraryLink(user, { ...values, description: '' })
            else await updateLibraryItem(user, editing, { ...values, description: editing.description })
            message.success(editing === 'new' ? t('Added to the library.') : t('Library item updated.'))
            setEditing(null)
            await load()
        } catch (error) {
            const code = error instanceof Error ? error.message : ''
            message.error(code === 'invalid_url' ? t('Paste the full link, starting with https://.') : t('The library item could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const remove = async (item: TrainingLibraryItem) => {
        if (!user) return
        try {
            await deleteLibraryItem(user, item)
            message.success(t('Removed from the library.'))
            await load()
        } catch {
            message.error(t('The library item could not be removed.'))
        }
    }

    const open = async (item: TrainingLibraryItem) => {
        try {
            await openLibraryItem(item)
        } catch {
            message.error(t('The file could not be opened.'))
        }
    }

    const audienceTag = (item: TrainingLibraryItem) => item.audience === 'shared'
        ? <Tag color="green" icon={<TeamOutlined />}>{t('Learners and companies')}</Tag>
        : <Tag>{t('Only your team')}</Tag>

    const actions = (item: TrainingLibraryItem) => (
        <Space onClick={(event) => event.stopPropagation()}>
            <Tooltip title={t('Edit')}><Button icon={<EditOutlined />} onClick={() => startEdit(item)} aria-label={t('Edit')} /></Tooltip>
            <Popconfirm title={t('Remove {title} from the library?', undefined, { title: item.title })} okText={t('Remove')} okButtonProps={{ danger: true }} onConfirm={() => remove(item)}>
                <Tooltip title={t('Remove')}><Button danger icon={<DeleteOutlined />} aria-label={t('Remove')} /></Tooltip>
            </Popconfirm>
        </Space>
    )

    const columns: TableProps<TrainingLibraryItem>['columns'] = [
        {
            title: t('Item'),
            key: 'title',
            render: (_, item) => (
                <Space align="start">
                    {item.kind === 'link' ? <LinkOutlined /> : <FileOutlined />}
                    <Space orientation="vertical" size={0}>
                        <Typography.Text strong>{item.title}</Typography.Text>
                        {item.description && <Typography.Text type="secondary">{item.description}</Typography.Text>}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{item.kind === 'link' ? item.url : [item.fileName, sizeLabel(item.size)].filter(Boolean).join(' · ')}</Typography.Text>
                    </Space>
                </Space>
            ),
        },
        { title: t('Type'), key: 'category', render: (_, item) => t(LIBRARY_CATEGORY_LABELS[item.category]) },
        { title: t('Course'), key: 'course', render: (_, item) => item.courseTitle || t('All courses') },
        { title: t('Who sees it'), key: 'audience', render: (_, item) => audienceTag(item) },
        { title: t('Q'), key: 'q', align: 'center', render: (_, item) => item.textChars ? <Tooltip title={t('Q can read this and answer from it')}><RobotOutlined /></Tooltip> : '—' },
        { title: t('Added'), key: 'added', render: (_, item) => item.createdAt ? dayjs(item.createdAt).format('D MMM YYYY') : '—' },
        { title: '', key: 'actions', align: 'right', render: (_, item) => actions(item) },
    ]

    const statusIcon = (row: PendingDocument) => ({
        waiting: null,
        uploading: <LoadingOutlined />,
        done: <CheckCircleOutlined style={{ color: '#389e0d' }} />,
        failed: <Tooltip title={t('Not uploaded. Save to try again.')}><CloseCircleOutlined style={{ color: '#cf1322' }} /></Tooltip>,
    }[row.status])

    const pendingColumns: TableProps<PendingDocument>['columns'] = [
        {
            title: t('Document'),
            key: 'file',
            width: 220,
            render: (_, row) => (
                <Space align="start">
                    {statusIcon(row) || <FileOutlined />}
                    <Space orientation="vertical" size={0}>
                        <Typography.Text style={{ wordBreak: 'break-word' }}>{row.file.name}</Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{sizeLabel(row.file.size)}</Typography.Text>
                    </Space>
                </Space>
            ),
        },
        {
            title: t('Title'),
            key: 'title',
            width: 220,
            render: (_, row) => <Input value={row.title} disabled={row.status === 'done' || saving} status={row.title.trim() ? undefined : 'error'} maxLength={160} onChange={(event) => changePending(row.uid, { title: event.target.value })} aria-label={t('Title')} />,
        },
        {
            title: t('Type'),
            key: 'category',
            width: 160,
            render: (_, row) => <Select value={row.category} disabled={row.status === 'done' || saving} options={categoryOptions} onChange={(value) => changePending(row.uid, { category: value })} style={{ width: '100%' }} aria-label={t('Type')} />,
        },
        {
            title: t('Course'),
            key: 'course',
            width: 180,
            render: (_, row) => <AutoComplete value={row.courseTitle} disabled={row.status === 'done' || saving} options={courseOptions} placeholder={t('All courses')} allowClear onChange={(value) => changePending(row.uid, { courseTitle: value || '' })} style={{ width: '100%' }} aria-label={t('Course')} />,
        },
        {
            title: t('Who sees it'),
            key: 'audience',
            width: 200,
            render: (_, row) => <Select value={row.audience} disabled={row.status === 'done' || saving} options={audienceOptions} onChange={(value) => changePending(row.uid, { audience: value })} style={{ width: '100%' }} aria-label={t('Who sees it')} />,
        },
        {
            title: '',
            key: 'remove',
            width: 52,
            render: (_, row) => row.status === 'done' ? null : (
                <Button danger icon={<DeleteOutlined />} disabled={saving} aria-label={t('Leave out')} onClick={() => setPending((current) => (current || []).filter((item) => item.uid !== row.uid))} />
            ),
        },
    ]

    const pendingRows = pending || []
    const finished = pendingRows.filter((row) => row.status === 'done' || row.status === 'failed').length
    const toUpload = pendingRows.filter((row) => row.status !== 'done').length

    return (
        <DashboardPage className="training-page">
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={8}><DashboardMetricCard loading={!items} icon={<FolderOpenOutlined />} label={t('Items')} value={all.length} /></Col>
                <Col xs={12} lg={8}><DashboardMetricCard loading={!items} icon={<TeamOutlined />} label={t('Shared with learners and companies')} mobileTitle={t('Shared')} value={all.filter((item) => item.audience === 'shared').length} /></Col>
                <Col xs={12} lg={8}><DashboardMetricCard loading={!items} icon={<RobotOutlined />} label={t('Q can read')} value={all.filter((item) => item.textChars > 0).length} /></Col>
            </Row>
            <FilterBar
                compact
                primary={(
                    <>
                        <Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search the library')} allowClear />
                        <Select value={category} onChange={setCategory} options={[{ value: 'all', label: t('Everything') }, ...categoryOptions]} />
                    </>
                )}
                actions={(
                    <Space wrap>
                        <Button icon={<LinkOutlined />} onClick={() => startEdit()}>{t('Add a link')}</Button>
                        <Button type="primary" icon={<UploadOutlined />} onClick={() => setPending([])}>{t('Upload documents')}</Button>
                    </Space>
                )}
            />
            <ResponsiveDataView
                rowKey="id"
                rows={visible}
                columns={columns}
                loading={!items}
                onRowClick={(item) => void open(item)}
                emptyText={all.length ? t('Nothing matches this search.') : t('The library is empty. Upload the documents you teach from: manuals, slides, guides, templates.')}
                renderCard={(item) => (
                    <Space orientation="vertical" style={{ width: '100%' }}>
                        <Typography.Text strong>{item.title}</Typography.Text>
                        <Space wrap>{audienceTag(item)}<Tag>{t(LIBRARY_CATEGORY_LABELS[item.category])}</Tag>{item.textChars > 0 && <Tag icon={<RobotOutlined />}>{t('Q can read')}</Tag>}</Space>
                        <Typography.Text type="secondary">{item.courseTitle || t('All courses')}</Typography.Text>
                        {actions(item)}
                    </Space>
                )}
            />

            <Modal
                open={pending !== null}
                title={t('Upload documents')}
                okText={toUpload > 1 ? t('Upload {count} documents', undefined, { count: toUpload }) : t('Upload')}
                okButtonProps={{ disabled: !toUpload }}
                confirmLoading={saving}
                onOk={() => void uploadPending()}
                onCancel={() => { if (!saving) setPending(null) }}
                destroyOnHidden
                width={1080}
            >
                <Space orientation="vertical" size={14} style={{ width: '100%' }}>
                    <Upload.Dragger
                        multiple
                        accept={LIBRARY_ACCEPT}
                        showUploadList={false}
                        disabled={saving}
                        beforeUpload={(file) => {
                            addPending(file)
                            return false
                        }}
                    >
                        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                        <p className="ant-upload-text">{t('Drop documents here, or click to choose them')}</p>
                        <p className="ant-upload-hint">{t('PDF, Word, PowerPoint, Excel, text or pictures, up to 25 MB each. Q can read PDF, Word and text files.')}</p>
                    </Upload.Dragger>
                    {pendingRows.length > 0 && (
                        <>
                            <Typography.Text type="secondary">{t('Each document\'s title, type, course and who sees it are filled in from its name. Change any of them before uploading.')}</Typography.Text>
                            <Table<PendingDocument> rowKey="uid" size="small" pagination={false} columns={pendingColumns} dataSource={pendingRows} scroll={{ x: 'max-content' }} />
                            {(saving || finished > 0) && <Progress percent={Math.round((finished / pendingRows.length) * 100)} size="small" />}
                        </>
                    )}
                </Space>
            </Modal>

            <Modal
                open={editing !== null}
                title={editing === 'new' ? t('Add a link') : t('Edit library item')}
                okText={t('Save')}
                confirmLoading={saving}
                onOk={() => void saveItem()}
                onCancel={() => setEditing(null)}
                destroyOnHidden
                width={620}
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    {(editing === 'new' || (editing !== null && editing.kind === 'link')) && (
                        <Form.Item name="url" label={t('Link')} rules={[{ required: true, message: t('Paste the link.') }]} extra={t('A website, a video or a shared folder.')}>
                            <Input placeholder="https://" maxLength={500} inputMode="url" />
                        </Form.Item>
                    )}
                    <Form.Item name="title" label={t('Title')} rules={[{ required: true, whitespace: true, message: t('Enter a title.') }]}><Input maxLength={160} /></Form.Item>
                    <Row gutter={12}>
                        <Col xs={24} sm={12}>
                            <Form.Item name="category" label={t('Type')}>
                                <Select options={categoryOptions} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                            <Form.Item name="courseTitle" label={t('Course')} extra={t('Leave empty for every course.')}>
                                <AutoComplete options={courseOptions} placeholder={t('All courses')} allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Form.Item name="audience" label={t('Who sees it')}>
                        <Segmented block options={audienceOptions} />
                    </Form.Item>
                </Form>
            </Modal>
        </DashboardPage>
    )
}
