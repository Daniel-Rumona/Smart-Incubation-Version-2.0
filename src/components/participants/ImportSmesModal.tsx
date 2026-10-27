import { useMemo, useState } from 'react'
import { Alert, App, Button, Modal, Progress, Space, Table, Tag, Typography, Upload } from 'antd'
import { DownloadOutlined, FileExcelOutlined } from '@ant-design/icons'
import { createOperationsParticipant } from '@/services/operationsParticipantOnboardingService'
import { readSpreadsheetRows } from '@/utils/spreadsheetRows'
import { useLanguage } from '@/providers/LanguageProvider'

/*
 * Adds many SMEs to one programme from an Excel or CSV sheet. Each row goes through the same server
 * function as "Add SME": the SME is accepted straight away and emailed a link to set their password.
 */

type Field = 'participantName' | 'email' | 'businessName' | 'phone' | 'sector' | 'province'
type ImportRow = Record<Field, string> & { key: number; problem?: string; result?: 'added' | 'failed'; error?: string }

const FIELDS: Array<{ field: Field; header: string; aliases: string[]; required?: boolean }> = [
    { field: 'participantName', header: 'Owner name', aliases: ['owner name', 'name', 'full name', 'participant name', 'contact name', 'owner'], required: true },
    { field: 'email', header: 'Email', aliases: ['email', 'email address', 'e-mail'], required: true },
    { field: 'businessName', header: 'Business name', aliases: ['business name', 'business', 'company', 'company name', 'enterprise'], required: true },
    { field: 'phone', header: 'Phone', aliases: ['phone', 'phone number', 'cell', 'cellphone', 'mobile', 'contact number'] },
    { field: 'sector', header: 'Sector', aliases: ['sector', 'industry'] },
    { field: 'province', header: 'Province', aliases: ['province', 'region'] },
]

const normalizeHeader = (value: string) => value.toLowerCase().replace(/[^a-z]+/g, ' ').trim()
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const toRows = (sheet: string[][]): { rows: ImportRow[]; missingColumns: string[] } => {
    const [header = [], ...body] = sheet
    const columns = new Map<Field, number>()
    header.forEach((cell, index) => {
        const match = FIELDS.find((item) => item.aliases.includes(normalizeHeader(cell)))
        if (match && !columns.has(match.field)) columns.set(match.field, index)
    })
    const missingColumns = FIELDS.filter((item) => item.required && !columns.has(item.field)).map((item) => item.header)
    const seen = new Set<string>()
    const rows = body.map((cells, key) => {
        const row = { key } as ImportRow
        for (const { field } of FIELDS) row[field] = columns.has(field) ? String(cells[columns.get(field)!] || '').trim() : ''
        row.email = row.email.toLowerCase()
        const missing = FIELDS.filter((item) => item.required && !row[item.field]).map((item) => item.header)
        if (missing.length) row.problem = `Missing ${missing.join(', ').toLowerCase()}`
        else if (!EMAIL_PATTERN.test(row.email)) row.problem = 'Email is not valid'
        else if (seen.has(row.email)) row.problem = 'Email appears twice'
        seen.add(row.email)
        return row
    })
    return { rows, missingColumns }
}

const downloadTemplate = () => {
    const csv = `${FIELDS.map((item) => item.header).join(',')}\nThandi Mokoena,thandi@example.co.za,Mokoena Bakery,0821234567,Food,Gauteng\n`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'sme-import-template.csv'
    link.click()
    URL.revokeObjectURL(url)
}

export default function ImportSmesModal({ open, programId, programName, onClose, onImported }: {
    open: boolean
    programId: string
    programName: string
    onClose: () => void
    onImported: () => void
}) {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const [fileName, setFileName] = useState('')
    const [rows, setRows] = useState<ImportRow[]>([])
    const [missingColumns, setMissingColumns] = useState<string[]>([])
    const [running, setRunning] = useState(false)
    const [done, setDone] = useState(0)
    const [total, setTotal] = useState(0)

    const ready = useMemo(() => rows.filter((row) => !row.problem && row.result !== 'added'), [rows])
    const added = rows.filter((row) => row.result === 'added').length
    const failed = rows.filter((row) => row.result === 'failed').length
    const finished = !running && rows.some((row) => row.result)

    const reset = () => { setFileName(''); setRows([]); setMissingColumns([]); setDone(0) }
    const close = () => { if (running) return; reset(); onClose() }

    const readFile = async (file: File) => {
        try {
            const parsed = toRows(await readSpreadsheetRows(file))
            setFileName(file.name)
            setRows(parsed.rows)
            setMissingColumns(parsed.missingColumns)
            setDone(0)
        } catch (error) {
            console.error(error)
            message.error(t('That file could not be read. Use an .xlsx or .csv file.'))
        }
        return false
    }

    const runImport = async () => {
        setRunning(true)
        setDone(0)
        setTotal(ready.length)
        // One at a time: each row creates an account and queues an email, so a burst gains little and risks rate limits.
        for (const row of ready) {
            try {
                await createOperationsParticipant({
                    email: row.email,
                    participantName: row.participantName,
                    businessName: row.businessName,
                    phone: row.phone || undefined,
                    sector: row.sector || undefined,
                    province: row.province || undefined,
                    programId,
                    programName,
                })
                setRows((current) => current.map((item) => item.key === row.key ? { ...item, result: 'added', error: undefined } : item))
            } catch (error) {
                setRows((current) => current.map((item) => item.key === row.key ? { ...item, result: 'failed', error: error instanceof Error ? error.message : String(error) } : item))
            }
            setDone((count) => count + 1)
        }
        setRunning(false)
        onImported()
    }

    return (
        <Modal
            open={open}
            centered
            width={860}
            title={`${t('Import SMEs into')} ${programName}`}
            onCancel={close}
            maskClosable={!running}
            closable={!running}
            footer={(
                <Space>
                    <Button onClick={close} disabled={running}>{t(finished ? 'Done' : 'Cancel')}</Button>
                    {!finished && <Button type="primary" loading={running} disabled={!ready.length || missingColumns.length > 0} onClick={() => void runImport()}>
                        {`${t('Add')} ${ready.length} ${t(ready.length === 1 ? 'SME' : 'SMEs')}`}
                    </Button>}
                    {finished && failed > 0 && <Button type="primary" onClick={() => void runImport()}>{t('Retry failed rows')}</Button>}
                </Space>
            )}
        >
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Typography.Text type="secondary">
                    {t('Each SME is added to this programme straight away and emailed a link to set their password and fill in their details.')}
                </Typography.Text>
                <Space wrap>
                    <Upload accept=".xlsx,.csv" showUploadList={false} beforeUpload={(file) => readFile(file)} disabled={running}>
                        <Button icon={<FileExcelOutlined />} disabled={running}>{fileName ? t('Choose a different file') : t('Choose Excel or CSV file')}</Button>
                    </Upload>
                    <Button type="link" icon={<DownloadOutlined />} onClick={downloadTemplate}>{t('Download template')}</Button>
                    {fileName && <Typography.Text>{fileName}</Typography.Text>}
                </Space>
                {!fileName && <Typography.Text type="secondary">{t('Columns')}: {FIELDS.map((item) => `${item.header}${item.required ? ' *' : ''}`).join(', ')}</Typography.Text>}
                {missingColumns.length > 0 && <Alert type="error" showIcon message={`${t('The sheet needs these columns')}: ${missingColumns.join(', ')}`} />}
                {(running || finished) && <Progress percent={total ? Math.round((done / total) * 100) : 100} status={running ? 'active' : failed ? 'exception' : 'success'} />}
                {finished && <Alert type={failed ? 'warning' : 'success'} showIcon message={`${added} ${t('added')}${failed ? ` · ${failed} ${t('failed')}` : ''}`} />}
                {rows.length > 0 && !missingColumns.length && (
                    <Table<ImportRow>
                        size="small"
                        rowKey="key"
                        dataSource={rows}
                        pagination={rows.length > 8 ? { pageSize: 8 } : false}
                        scroll={{ x: 640 }}
                        columns={[
                            { title: t('Owner name'), dataIndex: 'participantName' },
                            { title: t('Email'), dataIndex: 'email' },
                            { title: t('Business name'), dataIndex: 'businessName' },
                            {
                                title: t('Status'),
                                width: 200,
                                render: (_, row) => row.result === 'added' ? <Tag color="green">{t('Added')}</Tag>
                                    : row.result === 'failed' ? <Tag color="red" title={row.error}>{t('Failed')}</Tag>
                                    : row.problem ? <Tag color="orange">{t(row.problem)}</Tag>
                                    : <Tag>{t('Ready')}</Tag>,
                            },
                        ]}
                    />
                )}
            </Space>
        </Modal>
    )
}
