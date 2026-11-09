import { useMemo, useState } from 'react'
import { Alert, App, Button, Input, Modal, Space, Table, Tag, Typography, Upload, type TableProps } from 'antd'
import { DownloadOutlined, InboxOutlined } from '@ant-design/icons'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { MAX_IMPORTED_LEARNERS, addTrainingLearners, learnerNameKey } from '@/services/trainingService'
import { useLanguage } from '@/providers/LanguageProvider'
import { buildLearnerTemplate, findLearnerSheet, readSpreadsheetFile, type LearnerSheet, type SpreadsheetLearner } from '@/utils/learnerSpreadsheet'
import { maskIdNumber } from '@/utils/trainingFormat'
import type { TrainingClass, TrainingLearner } from '@/types/training'

type Props = {
    trainingClass: TrainingClass
    /** The class's learners now, so people already in it are not added twice. */
    learners: TrainingLearner[]
    onClose: () => void
}

type RowStatus = 'ready' | 'no_email' | 'in_class' | 'twice' | 'bad_email' | 'no_organisation'
type PreviewRow = SpreadsheetLearner & { status: RowStatus }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([buildLearnerTemplate() as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'learners-template.xlsx'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
}

/** Adds a class's learners from an Excel workbook or CSV file: the facilitator's own register, or the template. */
export const LearnerImportModal = ({ trainingClass, learners, onClose }: Props) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [sheet, setSheet] = useState<LearnerSheet | null>(null)
    const [fileName, setFileName] = useState('')
    const [problem, setProblem] = useState('')
    const [fallbackOrganisation, setFallbackOrganisation] = useState('')
    const [saving, setSaving] = useState(false)

    const read = async (file: File) => {
        setProblem('')
        setSheet(null)
        setFileName(file.name)
        try {
            const found = findLearnerSheet(await readSpreadsheetFile(file))
            if (!found) setProblem(t('No learner list was found. The sheet needs a header row with a Learner name (or Name) column.'))
            else if (!found.learners.length) setProblem(t('The "{sheet}" sheet has the headers but no learners under them yet.', undefined, { sheet: found.sheet }))
            else if (found.learners.length > MAX_IMPORTED_LEARNERS) setProblem(t('The sheet has {count} learners. Import at most {max} at a time.', undefined, { count: found.learners.length, max: MAX_IMPORTED_LEARNERS }))
            else setSheet(found)
        } catch (error) {
            setProblem(error instanceof Error && error.message === 'xls_not_supported'
                ? t('This is an older Excel file (.xls). Save it as an Excel workbook (.xlsx) or CSV, then choose it again.')
                : t('The file could not be read. Choose an Excel workbook (.xlsx) or a CSV file.'))
        }
    }

    const rows = useMemo<PreviewRow[]>(() => {
        if (!sheet) return []
        // Same rule as addTrainingLearners: the same email, or the same name and organisation.
        const classEmails = new Set(learners.map((learner) => learner.email).filter(Boolean))
        const classNames = new Set(learners.map((learner) => learnerNameKey(learner.name, learner.organisation)))
        const seenEmails = new Set<string>()
        const seenNames = new Set<string>()
        return sheet.learners.map((row) => {
            const organisation = row.organisation || fallbackOrganisation.trim()
            const nameKey = learnerNameKey(row.name, organisation)
            const status: RowStatus = row.email && !EMAIL.test(row.email) ? 'bad_email'
                : !organisation ? 'no_organisation'
                    : (row.email && classEmails.has(row.email)) || classNames.has(nameKey) ? 'in_class'
                        : (row.email && seenEmails.has(row.email)) || seenNames.has(nameKey) ? 'twice'
                            : row.email ? 'ready' : 'no_email'
            if (row.email) seenEmails.add(row.email)
            seenNames.add(nameKey)
            return { ...row, organisation, status }
        })
    }, [fallbackOrganisation, learners, sheet])

    const toAdd = rows.filter((row) => row.status === 'ready' || row.status === 'no_email')
    const missingOrganisation = Boolean(sheet?.learners.some((row) => !row.organisation))

    const save = async () => {
        if (!user || !toAdd.length) return
        setSaving(true)
        try {
            const { added, skipped } = await addTrainingLearners(user, trainingClass.id, toAdd.map((row) => ({
                name: row.name,
                organisation: row.organisation,
                email: row.email,
                idNumber: row.idNumber,
                phone: row.phone,
            })))
            message.success(skipped
                ? t('Added {added} learner(s); {skipped} were already in the class.', undefined, { added, skipped })
                : t('Added {added} learner(s).', undefined, { added }))
            onClose()
        } catch {
            message.error(t('The learners could not be added.'))
        } finally {
            setSaving(false)
        }
    }

    const statusTag = (status: RowStatus) => ({
        ready: <Tag color="green">{t('Ready')}</Tag>,
        no_email: <Tag color="gold">{t('No email: cannot be invited yet')}</Tag>,
        in_class: <Tag>{t('Already in the class')}</Tag>,
        twice: <Tag>{t('Twice in the file')}</Tag>,
        bad_email: <Tag color="red">{t('Email not valid')}</Tag>,
        no_organisation: <Tag color="red">{t('No organisation')}</Tag>,
    })[status]

    const columns: TableProps<PreviewRow>['columns'] = [
        { title: t('Row'), dataIndex: 'row', width: 64 },
        { title: t('Learner'), dataIndex: 'name' },
        { title: t('Organisation'), dataIndex: 'organisation', render: (value: string) => value || '—' },
        { title: t('Email'), dataIndex: 'email', render: (value: string) => value || '—' },
        { title: t('ID or passport'), dataIndex: 'idNumber', render: (value: string) => maskIdNumber(value) },
        { title: '', key: 'status', render: (_, row) => statusTag(row.status) },
    ]

    return (
        <Modal
            open
            width={880}
            title={t('Import learners from Excel')}
            okText={toAdd.length ? t('Add {count} learner(s)', undefined, { count: toAdd.length }) : t('Add learners')}
            okButtonProps={{ disabled: !toAdd.length, loading: saving }}
            onOk={() => void save()}
            onCancel={onClose}
        >
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    {t('Choose an Excel workbook (.xlsx) or CSV file with a header row. The learner\'s name and organisation are read, and their email, ID or passport number and phone when the sheet has those columns. Your attendance register works as it is. Learners without an email are added too; add their email later to invite them.')}
                </Typography.Paragraph>
                <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>{t('Download the template')}</Button>
                <Upload.Dragger
                    accept=".xlsx,.csv"
                    multiple={false}
                    showUploadList={false}
                    beforeUpload={(file) => { void read(file); return false }}
                >
                    <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                    <p className="ant-upload-text">{fileName || t('Click or drop the spreadsheet here')}</p>
                </Upload.Dragger>
                {problem && <Alert type="warning" showIcon message={problem} />}
                {sheet && (
                    <>
                        <Alert
                            type="info"
                            showIcon
                            message={t('{count} learner(s) on the "{sheet}" sheet. {ready} will be added.', undefined, { count: sheet.learners.length, sheet: sheet.sheet, ready: toAdd.length })}
                        />
                        {missingOrganisation && (
                            <Input
                                value={fallbackOrganisation}
                                onChange={(event) => setFallbackOrganisation(event.target.value)}
                                addonBefore={t('Organisation for rows without one')}
                                maxLength={160}
                            />
                        )}
                        <Table<PreviewRow> rowKey="row" size="small" columns={columns} dataSource={rows} pagination={{ pageSize: 8, hideOnSinglePage: true }} scroll={{ x: 'max-content' }} />
                    </>
                )}
            </Space>
        </Modal>
    )
}
