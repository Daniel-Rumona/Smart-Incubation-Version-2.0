import { useMemo, useState } from 'react'
import { App, Button, Input, Modal, Popconfirm, Space, Tag, Tooltip, Typography, Upload, type TableProps } from 'antd'
import { CheckOutlined, DeleteOutlined, EditOutlined, EyeOutlined, FileExcelOutlined, MailOutlined, QuestionCircleOutlined, SearchOutlined, UploadOutlined, UserAddOutlined } from '@ant-design/icons'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { LearnerFormModal } from '@/components/training/LearnerFormModal'
import { LearnerImportModal } from '@/components/training/LearnerImportModal'
import { OrganisationChips, OrganisationSections } from '@/components/training/OrganisationFilter'
import { ResultTag } from '@/components/training/TrainingTags'
import { usesFirebaseEmulators } from '@/config/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { ID_DOCUMENT_ACCEPT, idDocumentProblem, openIdDocument } from '@/services/trainingIdDocumentsService'
import { inviteTrainingLearner, removeTrainingLearner, reviewLearnerIdDocument, uploadLearnerIdDocument } from '@/services/trainingService'
import { useLanguage } from '@/providers/LanguageProvider'
import { ALL_ORGANISATIONS, inOrganisation, maskIdNumber, organisationsOf } from '@/utils/trainingFormat'
import type { TrainingClass, TrainingLearner, TrainingLearnerResult } from '@/types/training'

type Props = {
    trainingClass: TrainingClass
    learners: TrainingLearner[]
    results: TrainingLearnerResult[]
    loading: boolean
}

const inviteError = (error: unknown) => (error instanceof Error ? error.message : '')

export const LearnersPanel = ({ trainingClass, learners, results, loading }: Props) => {
    const { t } = useLanguage()
    const { message, modal } = App.useApp()
    const { user } = useFullIdentity()
    const [search, setSearch] = useState('')
    const [organisation, setOrganisation] = useState(ALL_ORGANISATIONS)
    const [editing, setEditing] = useState<TrainingLearner | 'new' | null>(null)
    const [importing, setImporting] = useState(false)
    const [busy, setBusy] = useState<string | null>(null)
    const [querying, setQuerying] = useState<TrainingLearner | null>(null)
    const [queryNote, setQueryNote] = useState('')

    const organisations = useMemo(() => organisationsOf(learners), [learners])
    // Learners imported without an email are in the class but cannot be invited until their email is added.
    const notInvited = learners.filter((learner) => !learner.uid && learner.email)
    const statusOf = (learnerId: string) => results.find((result) => result.learner.id === learnerId)?.status

    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return learners.filter((learner) =>
            inOrganisation(organisation)(learner)
            && (!needle || `${learner.name} ${learner.email} ${learner.organisation}`.toLowerCase().includes(needle)))
    }, [learners, organisation, search])

    const describeInviteError = (error: unknown) => {
        const code = inviteError(error)
        if (code === 'email_already_exists') return t('This email address already has a Smartinc account that is not a learner account. Use another address for the learner.')
        if (code === 'functions_unavailable') return t('Invitations are not available in this environment.')
        if (code === 'permission_denied') return t('Learner invitations are not switched on for your company.')
        return t('The invitation could not be sent.')
    }

    // Local testing: the emulators send no email, so the set-password links are shown here instead.
    const showLocalLinks = (links: Array<{ name: string, link: string | null }>) => {
        const shown = links.filter((item) => item.link)
        if (!usesFirebaseEmulators || !shown.length) return
        modal.info({
            title: t('Local testing: no email is sent'),
            width: 640,
            content: (
                <Space orientation="vertical" style={{ width: '100%' }}>
                    <Typography.Text type="secondary">{t('This copy of Smartinc runs on the local emulators, which do not send email. Open the link (in a private window, or after signing out) to set the learner\'s password.')}</Typography.Text>
                    {shown.map((item) => (
                        <div key={item.name}>
                            <Typography.Text strong>{item.name}</Typography.Text>
                            <Typography.Paragraph copyable style={{ marginBottom: 0, wordBreak: 'break-all' }}>{item.link}</Typography.Paragraph>
                        </div>
                    ))}
                </Space>
            ),
        })
    }

    const invite = async (learner: TrainingLearner) => {
        if (!user) return
        setBusy(`invite:${learner.id}`)
        try {
            const { setPasswordLink } = await inviteTrainingLearner(user, learner, trainingClass.courseTitle)
            message.success(t('Sign-in link sent to {email}.', undefined, { email: learner.email }))
            showLocalLinks([{ name: learner.name, link: setPasswordLink }])
        } catch (error) {
            message.error(describeInviteError(error))
        } finally {
            setBusy(null)
        }
    }

    const inviteAll = async () => {
        if (!user || !notInvited.length) return
        setBusy('invite:all')
        let sent = 0
        const failed: string[] = []
        const links: Array<{ name: string, link: string | null }> = []
        for (const learner of notInvited) {
            try {
                const { setPasswordLink } = await inviteTrainingLearner(user, learner, trainingClass.courseTitle)
                links.push({ name: learner.name, link: setPasswordLink })
                sent += 1
            } catch {
                failed.push(learner.name)
            }
        }
        setBusy(null)
        if (sent) message.success(t('Sign-in links sent to {count} learner(s).', undefined, { count: sent }))
        showLocalLinks(links)
        if (failed.length) message.error(t('Not sent to: {names}.', undefined, { names: failed.join(', ') }))
    }

    const remove = async (learner: TrainingLearner) => {
        if (!user) return
        try {
            await removeTrainingLearner(user, learner)
            message.success(t('{name} removed from the class.', undefined, { name: learner.name }))
        } catch {
            message.error(t('The learner could not be removed.'))
        }
    }

    const uploadFor = async (learner: TrainingLearner, file: File) => {
        if (!user) return
        const problem = idDocumentProblem(file)
        if (problem) {
            message.error(problem === 'size' ? t('The file is larger than 10 MB.') : t('Upload a PDF or a photo (JPG, PNG or WEBP).'))
            return
        }
        setBusy(`id:${learner.id}`)
        try {
            await uploadLearnerIdDocument(user, learner, file)
            message.success(t('ID copy uploaded for {name}.', undefined, { name: learner.name }))
        } catch {
            message.error(t('The ID copy could not be uploaded.'))
        } finally {
            setBusy(null)
        }
    }

    const view = async (learner: TrainingLearner) => {
        if (!learner.idDocument) return
        try {
            await openIdDocument(learner.idDocument)
        } catch {
            message.error(t('The file could not be opened.'))
        }
    }

    const review = async (learner: TrainingLearner, status: 'verified' | 'queried', note?: string) => {
        if (!user) return
        setBusy(`review:${learner.id}`)
        try {
            await reviewLearnerIdDocument(user, learner, status, note)
            message.success(status === 'verified' ? t('ID copy verified.') : t('ID copy queried. The learner sees your note.'))
            setQuerying(null)
            setQueryNote('')
        } catch {
            message.error(t('The ID copy could not be updated.'))
        } finally {
            setBusy(null)
        }
    }

    const accountCell = (learner: TrainingLearner) => !learner.email ? (
        <Tooltip title={t('Edit the learner to add their email, then invite them.')}><Tag>{t('No email')}</Tag></Tooltip>
    ) : learner.uid ? (
        <Space size={4} wrap>
            <Tag color="green">{t('Invited')}</Tag>
            <Tooltip title={t('Send the sign-in link again')}>
                <Button size="small" type="text" icon={<MailOutlined />} loading={busy === `invite:${learner.id}`} onClick={() => void invite(learner)} aria-label={t('Send the sign-in link again')} />
            </Tooltip>
        </Space>
    ) : (
        <Button size="small" icon={<MailOutlined />} loading={busy === `invite:${learner.id}`} onClick={() => void invite(learner)}>{t('Invite')}</Button>
    )

    const idCopyCell = (learner: TrainingLearner) => {
        const document = learner.idDocument
        const uploadButton = (
            <Upload accept={ID_DOCUMENT_ACCEPT} showUploadList={false} beforeUpload={(file) => { void uploadFor(learner, file); return false }}>
                <Button size="small" icon={<UploadOutlined />} loading={busy === `id:${learner.id}`}>{document ? t('Replace') : t('Upload')}</Button>
            </Upload>
        )
        if (!document) return <Space size={4} wrap><Tag>{t('Not uploaded')}</Tag>{uploadButton}</Space>
        return (
            <Space size={4} wrap>
                <Tag color={document.status === 'verified' ? 'green' : document.status === 'queried' ? 'red' : 'gold'}>
                    {document.status === 'verified' ? t('Verified') : document.status === 'queried' ? t('Queried') : t('To check')}
                </Tag>
                <Tooltip title={t('View')}><Button size="small" icon={<EyeOutlined />} onClick={() => void view(learner)} aria-label={t('View')} /></Tooltip>
                {document.status !== 'verified' && (
                    <Tooltip title={t('Verify')}><Button size="small" icon={<CheckOutlined />} loading={busy === `review:${learner.id}`} onClick={() => void review(learner, 'verified')} aria-label={t('Verify')} /></Tooltip>
                )}
                <Tooltip title={t('Query')}><Button size="small" icon={<QuestionCircleOutlined />} onClick={() => { setQuerying(learner); setQueryNote(document.note || '') }} aria-label={t('Query')} /></Tooltip>
                {uploadButton}
            </Space>
        )
    }

    const actions = (learner: TrainingLearner) => (
        <Space onClick={(event) => event.stopPropagation()}>
            <Tooltip title={t('Edit learner')}><Button icon={<EditOutlined />} onClick={() => setEditing(learner)} aria-label={t('Edit learner')} /></Tooltip>
            <Popconfirm
                title={t('Remove {name} from the class?', undefined, { name: learner.name })}
                description={t('Their attendance, assessment attempts and ID copy for this class are removed too.')}
                okText={t('Remove')}
                okButtonProps={{ danger: true }}
                onConfirm={() => remove(learner)}
            >
                <Tooltip title={t('Remove learner')}><Button danger icon={<DeleteOutlined />} aria-label={t('Remove learner')} /></Tooltip>
            </Popconfirm>
        </Space>
    )

    const columns: TableProps<TrainingLearner>['columns'] = [
        {
            title: t('Learner'),
            dataIndex: 'name',
            render: (value: string, learner) => (
                <Space orientation="vertical" size={0}>
                    <Typography.Text strong>{value}</Typography.Text>
                    {learner.email && <Typography.Text type="secondary">{learner.email}</Typography.Text>}
                    {(!learner.email || !learner.idNumber) && <Tag color="gold" style={{ marginTop: 4, width: 'fit-content' }}>{t('Details to complete')}</Tag>}
                </Space>
            ),
        },
        { title: t('Organisation'), dataIndex: 'organisation' },
        { title: t('ID or passport'), dataIndex: 'idNumber', render: (value: string) => maskIdNumber(value) },
        { title: t('Sign-in'), key: 'account', render: (_, learner) => accountCell(learner) },
        { title: t('ID copy'), key: 'idCopy', render: (_, learner) => idCopyCell(learner) },
        { title: t('Result'), key: 'result', render: (_, learner) => { const status = statusOf(learner.id); return status ? <ResultTag status={status} /> : '—' } },
        { title: '', key: 'actions', align: 'right', render: (_, learner) => actions(learner) },
    ]

    return (
        <>
            <FilterBar
                compact
                primary={(
                    <>
                        <Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search name, email or organisation')} allowClear />
                    </>
                )}
                actions={(
                    <>
                        {notInvited.length > 0 && (
                            <Popconfirm
                                title={t('Send sign-in links to {count} learner(s)?', undefined, { count: notInvited.length })}
                                description={t('Each gets an email to set a password and open their training page.')}
                                okText={t('Send')}
                                onConfirm={inviteAll}
                            >
                                <Button icon={<MailOutlined />} loading={busy === 'invite:all'}>{t('Invite all ({count})', undefined, { count: notInvited.length })}</Button>
                            </Popconfirm>
                        )}
                        <Button icon={<FileExcelOutlined />} onClick={() => setImporting(true)}>{t('Import from Excel')}</Button>
                        <Button type="primary" icon={<UserAddOutlined />} onClick={() => setEditing('new')}>{t('Add learner')}</Button>
                    </>
                )}
            />
            <OrganisationChips learners={learners} value={organisation} onChange={setOrganisation} />
            <OrganisationSections
                rows={visible}
                grouped={organisation === ALL_ORGANISATIONS && !loading}
                summary={(rows) => {
                    const invited = rows.filter((learner) => learner.uid).length
                    const passed = rows.filter((learner) => statusOf(learner.id) === 'passed').length
                    return [t('{count} invited', undefined, { count: invited }), passed ? t('{count} passed', undefined, { count: passed }) : ''].filter(Boolean).join(' · ')
                }}
            >
            {(rows) => <ResponsiveDataView
                rowKey="id"
                rows={rows}
                columns={columns}
                loading={loading}
                emptyText={learners.length ? t('No learners match these filters.') : t('No learners yet. Add the learners attending this class, or import them from Excel.')}
                renderCard={(learner) => (
                    <Space orientation="vertical" style={{ width: '100%' }}>
                        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Typography.Text strong>{learner.name}</Typography.Text>
                            {(() => { const status = statusOf(learner.id); return status ? <ResultTag status={status} /> : null })()}
                        </Space>
                        <Typography.Text type="secondary">{[learner.organisation, learner.email].filter(Boolean).join(' · ')}</Typography.Text>
                        <Space wrap>{accountCell(learner)}</Space>
                        <Space wrap><Typography.Text type="secondary">{t('ID copy')}</Typography.Text>{idCopyCell(learner)}</Space>
                        {actions(learner)}
                    </Space>
                )}
            />}
            </OrganisationSections>
            <LearnerFormModal
                open={editing !== null}
                classId={trainingClass.id}
                learner={editing && editing !== 'new' ? editing : undefined}
                organisations={organisations}
                onClose={() => setEditing(null)}
            />
            {importing && <LearnerImportModal trainingClass={trainingClass} learners={learners} onClose={() => setImporting(false)} />}
            <Modal
                open={querying !== null}
                title={t('Query the ID copy of {name}', undefined, { name: querying?.name || '' })}
                okText={t('Send query')}
                okButtonProps={{ disabled: !queryNote.trim(), loading: querying ? busy === `review:${querying.id}` : false }}
                onOk={() => { if (querying) void review(querying, 'queried', queryNote) }}
                onCancel={() => { setQuerying(null); setQueryNote('') }}
                destroyOnHidden
            >
                <Typography.Paragraph type="secondary">{t('Say what needs fixing, for example "The copy is not readable". The learner sees this and can upload again.')}</Typography.Paragraph>
                <Input.TextArea value={queryNote} onChange={(event) => setQueryNote(event.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} maxLength={300} />
            </Modal>
        </>
    )
}
