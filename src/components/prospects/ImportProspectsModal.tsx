import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Checkbox, Form, Input, Modal, Select, Space, Table, Tag, Typography, Upload } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { CONSENT_SOURCES, PROSPECT_SOURCES, allowsPeople, type ConsentSource, type ProspectModule, type ProspectSource } from '@/config/prospects'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { importProspects, listKnownRecords, sameBusinessName, type ImportRow, type KnownRecord } from '@/services/prospectsService'
import { prospectName, type Prospect } from '@/types/prospects'
import { contactKeys, sharedKeys } from '@/utils/contactKeys'
import { readProspectRows, readProspects, type ParsedProspect } from '@/utils/prospectImport'
import { readSpreadsheetRows } from '@/utils/spreadsheetRows'

/**
 * Imports a list (an attendance register, an event list): a CSV file, or cells pasted from Excel. Rows already on
 * record (same phone, email or registration number, here or in the list itself) are left out. Everyone on the list
 * must have agreed to be kept on record; how they agreed is saved with each one.
 */
export function ImportProspectsModal({ module, existing, owners, onClose, onImported, initial }: {
    module: ProspectModule
    existing: Prospect[]
    owners: Array<{ uid: string, name: string }>
    onClose: () => void
    onImported: () => void
    /** Rows handed over by another page (a training class), instead of a file. */
    initial?: { rows: ParsedProspect[], source: ProspectSource, sourceDetail: string }
}) {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [text, setText] = useState('')
    const [fileName, setFileName] = useState('')
    const [sheet, setSheet] = useState<string[][] | null>(null)
    const [source, setSource] = useState<ProspectSource>(initial?.source || 'import')
    const [sourceDetail, setSourceDetail] = useState(initial?.sourceDetail || '')
    const [ownerUid, setOwnerUid] = useState<string>()
    const [consentSource, setConsentSource] = useState<ConsentSource>('register')
    const [contactAllowed, setContactAllowed] = useState(false)
    const [confirmed, setConfirmed] = useState(false)
    const [saving, setSaving] = useState(false)
    const [known, setKnown] = useState<KnownRecord[]>([])

    useEffect(() => {
        if (!user) return
        let cancelled = false
        void listKnownRecords(user, module).catch(() => []).then((rows) => { if (!cancelled) setKnown(rows) })
        return () => { cancelled = true }
    }, [module, user])

    const peopleAllowed = allowsPeople(module)
    const parsed = useMemo(() => {
        if (!initial) return sheet ? readProspectRows(sheet, peopleAllowed) : readProspects(text, peopleAllowed)
        const rows = initial.rows.filter((row) => row.businessName || (peopleAllowed && row.contactName))
        return { rows, mapping: {}, skipped: initial.rows.length - rows.length }
    }, [initial, peopleAllowed, sheet, text])
    // Each row with what it already is: a prospect, a client company or participant, or earlier in this list.
    const checked = useMemo(() => {
        const seen: Array<{ keys: ReturnType<typeof contactKeys>, name: string, what: string }> = [
            ...known.map((row) => ({ keys: row.keys, name: row.name, what: row.kind === 'client' ? t('Already a client: skipped') : t('Already a participant: skipped') })),
            ...existing.map((row) => ({ keys: row.keys, name: row.kind === 'business' ? prospectName(row) : '', what: t('Already a prospect: skipped') })),
        ]
        return parsed.rows.map((row, index) => {
            const keys = contactKeys(row)
            const match = seen.find((other) => sharedKeys(keys, other.keys).length > 0 || (row.businessName && sameBusinessName(row.businessName, other.name)))
            seen.push({ keys, name: row.businessName || '', what: t('Twice in this list: skipped') })
            return { key: index, row, duplicate: match?.what || '' }
        })
    }, [existing, known, parsed.rows, t])
    const toAdd = checked.filter((item) => !item.duplicate)

    const save = async () => {
        if (!user || !toAdd.length || !confirmed) return
        setSaving(true)
        try {
            const rows: ImportRow[] = toAdd.map(({ row }) => ({
                kind: row.kind, businessName: row.businessName || '', contactName: row.contactName || '', phone: row.phone || '', email: row.email || '',
                registrationNumber: row.registrationNumber || '', sector: row.sector || '', province: row.province || '', ownership: [],
                source, sourceDetail: sourceDetail || fileName, interest: row.interest, ownerUid, notes: row.notes || '',
            }))
            const added = await importProspects(user, module, rows, { source: consentSource, contactAllowed, note: sourceDetail || fileName || undefined })
            message.success(t('{count} prospects added.', undefined, { count: added }))
            onImported()
        } catch {
            message.error(t('The list could not be imported.'))
        } finally {
            setSaving(false)
        }
    }

    const found = Object.keys(parsed.mapping).length
    return (
        <Modal
            open
            width={820}
            title={initial ? t('Add to prospects') : t('Import prospects')}
            okText={t('Add {count} prospects', undefined, { count: toAdd.length })}
            okButtonProps={{ disabled: !toAdd.length || !confirmed }}
            confirmLoading={saving}
            onOk={() => void save()}
            onCancel={onClose}
            destroyOnHidden
        >
            {!initial && (
                <Space orientation="vertical" style={{ width: '100%' }}>
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                        {t('Upload an Excel (.xlsx) or CSV file, or copy the cells from Excel or Google Sheets (including the header row) and paste them below. Columns such as Name, Business, Phone, Email, Sector and Province are recognised.')}
                    </Typography.Paragraph>
                    <Upload
                        accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        showUploadList={false}
                        beforeUpload={(file) => {
                            void readSpreadsheetRows(file)
                                .then((rows) => { setSheet(rows); setText(''); setFileName(file.name) })
                                .catch(() => message.error(t('That file could not be read. Save it as .xlsx or .csv and try again.')))
                            return false
                        }}
                    >
                        <Button icon={<UploadOutlined />}>{t('Choose an Excel or CSV file')}</Button>
                    </Upload>
                    <Input.TextArea rows={5} value={text} onChange={(event) => { setText(event.target.value); setSheet(null); setFileName('') }} placeholder={t('…or paste the cells here')} />
                    {fileName && <Typography.Text type="secondary">{fileName}</Typography.Text>}
                    {(text || sheet) && !found && <Alert type="warning" showIcon title={t('No known column names in the first row. Name the columns, e.g. Name, Business, Phone, Email.')} />}
                </Space>
            )}
            {checked.length > 0 && (
                <>
                    <Table
                        style={{ marginTop: 16 }}
                        size="small"
                        dataSource={checked}
                        pagination={{ pageSize: 6, hideOnSinglePage: true }}
                        scroll={{ x: 'max-content' }}
                        columns={[
                            { title: t('Name'), key: 'name', render: (_, item) => item.row.businessName || item.row.contactName },
                            { title: t('Contact'), key: 'contact', render: (_, item) => [item.row.contactName && item.row.businessName ? item.row.contactName : '', item.row.phone, item.row.email].filter(Boolean).join(' · ') || '—' },
                            { title: '', key: 'state', render: (_, item) => (item.duplicate ? <Tag color="gold">{item.duplicate}</Tag> : <Tag color="green">{t('New')}</Tag>) },
                        ]}
                    />
                    {parsed.skipped > 0 && <Typography.Text type="secondary">{peopleAllowed ? t('{count} rows without a name were left out.', undefined, { count: parsed.skipped }) : t('{count} rows without a business name were left out: programmes take businesses only.', undefined, { count: parsed.skipped })}</Typography.Text>}
                    <Form layout="vertical" style={{ marginTop: 16 }}>
                        <Space wrap style={{ width: '100%' }}>
                            <Form.Item label={t('Where they came from')} style={{ minWidth: 200 }}>
                                <Select value={source} onChange={setSource} options={PROSPECT_SOURCES.map((option) => ({ value: option.key, label: t(option.label) }))} />
                            </Form.Item>
                            <Form.Item label={t('Which one')} style={{ minWidth: 240 }}>
                                <Input value={sourceDetail} onChange={(event) => setSourceDetail(event.target.value)} placeholder={fileName || t('e.g. the event or class')} maxLength={160} />
                            </Form.Item>
                            <Form.Item label={t('Who follows up')} style={{ minWidth: 200 }}>
                                <Select allowClear value={ownerUid} onChange={setOwnerUid} options={owners.map((row) => ({ value: row.uid, label: row.name }))} />
                            </Form.Item>
                        </Space>
                        <Form.Item label={t('How they agreed')}>
                            <Select value={consentSource} onChange={setConsentSource} options={CONSENT_SOURCES.map((option) => ({ value: option.key, label: t(option.label) }))} />
                        </Form.Item>
                        <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}>
                            {t('Everyone on this list agreed that we keep their details to follow up')}
                        </Checkbox>
                        <br />
                        <Checkbox checked={contactAllowed} onChange={(event) => setContactAllowed(event.target.checked)} style={{ marginTop: 8 }}>
                            {t('They also agreed to receive WhatsApp or email from us')}
                        </Checkbox>
                    </Form>
                </>
            )}
        </Modal>
    )
}
