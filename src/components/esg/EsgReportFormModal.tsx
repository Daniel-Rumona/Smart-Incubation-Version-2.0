import { useEffect, useMemo, useState } from 'react'
import { Alert, App, AutoComplete, Checkbox, Col, DatePicker, Form, Input, Modal, Row, Segmented, Select, Space, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { COUNTRY_CODES, ESG_FRAMEWORKS, ESG_SECTORS, countryName, sectorStandardFor, suggestedFrameworksFor } from '@/config/esgStandards'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { FunderSelect } from '@/components/training/FunderSelect'
import { createEsgReport, updateEsgReportSetup } from '@/services/esgReportsService'
import { useLanguage } from '@/providers/LanguageProvider'
import type { EsgAssurance, EsgClaim, EsgReport, EsgReportValues } from '@/types/esg'

type FormValues = {
    clientName: string
    sector: string
    country: string
    period: [Dayjs, Dayjs]
    publicationDate?: Dayjs
    claim: EsgClaim
    frameworks: string[]
    otherFrameworks?: string
    funderId?: string | null
    approvedBy?: string
    approverRole?: string
    approvedOn?: Dayjs
    assurance: EsgAssurance
    assuranceProvider?: string
}

type Props = {
    /** The report whose setup is edited; omitted for a new report. */
    report?: EsgReport
    /** Client organisations already known (training learners' organisations), offered as the client name. */
    knownClients: string[]
    onClose: () => void
    onSaved: (reportId: string) => void
}

/** Shown only while open (mounted by the parent), so it starts from the report each time. */
export const EsgReportFormModal = ({ report, knownClients, onClose, onSaved }: Props) => {
    const { t, language } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [form] = Form.useForm<FormValues>()
    const [saving, setSaving] = useState(false)
    const sector = Form.useWatch('sector', form)
    const period = Form.useWatch('period', form)
    const assurance = Form.useWatch('assurance', form)

    useEffect(() => {
        const lastYear = dayjs().subtract(1, 'year')
        form.setFieldsValue({
            clientName: report?.clientName || '',
            sector: report?.sector || 'other',
            country: report?.country || 'ZA',
            period: report?.periodStart && report.periodEnd
                ? [dayjs(report.periodStart), dayjs(report.periodEnd)]
                : [lastYear.startOf('year'), lastYear.endOf('year')],
            publicationDate: report?.publicationDate ? dayjs(report.publicationDate) : undefined,
            claim: report?.claim || 'with_reference',
            frameworks: report?.frameworks || suggestedFrameworksFor('ZA'),
            otherFrameworks: report?.otherFrameworks || '',
            funderId: report?.funderId || null,
            approvedBy: report?.approvedBy || '',
            approverRole: report?.approverRole || '',
            approvedOn: report?.approvedOn ? dayjs(report.approvedOn) : undefined,
            assurance: report?.assurance || 'none',
            assuranceProvider: report?.assuranceProvider || '',
        })
    }, [form, report])

    const countries = useMemo(() => COUNTRY_CODES
        .map((code) => ({ value: code, label: countryName(code, language === 'zu' ? 'zu' : 'en') }))
        .sort((a, b) => a.label.localeCompare(b.label)), [language])
    const sectorStandard = sectorStandardFor(sector || '')
    const periodStart = period?.[0]?.format('YYYY-MM-DD') || ''

    const submit = async () => {
        if (!user) return
        const values = await form.validateFields()
        const payload: EsgReportValues = {
            clientName: values.clientName,
            sector: values.sector,
            country: values.country,
            periodStart: values.period[0].format('YYYY-MM-DD'),
            periodEnd: values.period[1].format('YYYY-MM-DD'),
            publicationDate: values.publicationDate?.format('YYYY-MM-DD') || '',
            claim: values.claim,
            frameworks: values.frameworks || [],
            otherFrameworks: values.otherFrameworks || '',
            funderId: values.funderId || undefined,
            approvedBy: values.approvedBy || '',
            approverRole: values.approverRole || '',
            approvedOn: values.approvedOn?.format('YYYY-MM-DD') || '',
            assurance: values.assurance || 'none',
            assuranceProvider: values.assuranceProvider || '',
        }
        setSaving(true)
        try {
            const id = report ? (await updateEsgReportSetup(user, report.id, payload), report.id) : await createEsgReport(user, payload)
            message.success(report ? t('Report details saved.') : t('Report created.'))
            onSaved(id)
        } catch {
            message.error(t('The report could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal open title={report ? t('Report details') : t('New ESG report')} okText={report ? t('Save') : t('Create report')} onOk={() => void submit()} confirmLoading={saving} onCancel={onClose} width={680}>
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item name="clientName" label={t('Client organisation')} rules={[{ required: true, whitespace: true, message: t('Enter the client the report is for.') }]}>
                    <AutoComplete
                        options={knownClients.map((name) => ({ value: name }))}
                        filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())}
                        placeholder={t('Type the client\'s name')}
                        maxLength={160}
                    />
                </Form.Item>
                <Row gutter={12}>
                    <Col xs={24} sm={12}>
                        <Form.Item name="sector" label={t('Sector')} extra={sectorStandard ? t('{standard} applies.', undefined, { standard: `${sectorStandard.id}: ${sectorStandard.title}` }) : t('GRI has no Sector Standard for this sector: the Universal and Topic Standards apply.')}>
                            <Select options={ESG_SECTORS.map((item) => ({ value: item.key, label: t(item.label) }))} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                        <Form.Item name="country" label={t('Country')}>
                            <Select
                                showSearch
                                optionFilterProp="label"
                                options={countries}
                                // A new country brings its own frameworks; the ones that apply everywhere stay as chosen.
                                onChange={(country: string) => {
                                    const kept = (form.getFieldValue('frameworks') as string[] || []).filter((id) => !ESG_FRAMEWORKS.find((item) => item.id === id)?.countries)
                                    form.setFieldValue('frameworks', [...new Set([...kept, ...suggestedFrameworksFor(country)])])
                                }}
                            />
                        </Form.Item>
                    </Col>
                </Row>
                <Row gutter={12}>
                    <Col xs={24} sm={14}>
                        <Form.Item name="period" label={t('Reporting period')} rules={[{ required: true, message: t('Choose the reporting period.') }]}>
                            <DatePicker.RangePicker style={{ width: '100%' }} format="D MMM YYYY" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} sm={10}>
                        <Form.Item name="publicationDate" label={t('Planned publication')} extra={t('Decides which GRI Standards are in effect.')}>
                            <DatePicker style={{ width: '100%' }} format="D MMM YYYY" />
                        </Form.Item>
                    </Col>
                </Row>
                <Form.Item name="claim" label={t('GRI claim')}>
                    <Segmented block options={[{ value: 'with_reference', label: t('With reference to GRI') }, { value: 'in_accordance', label: t('In accordance with GRI') }]} />
                </Form.Item>
                <Form.Item name="frameworks" label={t('Also aligned to')}>
                    <Checkbox.Group style={{ width: '100%' }}>
                        <Space orientation="vertical" style={{ width: '100%' }}>
                            {ESG_FRAMEWORKS.map((framework) => (
                                <Checkbox key={framework.id} value={framework.id}>
                                    <Typography.Text>{framework.label(periodStart)}</Typography.Text>
                                    <br />
                                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{framework.note}</Typography.Text>
                                </Checkbox>
                            ))}
                        </Space>
                    </Checkbox.Group>
                </Form.Item>
                <Form.Item name="otherFrameworks" label={t('Other frameworks or local rules (optional)')}>
                    <Input maxLength={300} placeholder={t('e.g. a client\'s lender requirements, B-BBEE reporting')} />
                </Form.Item>
                <Form.Item name="funderId" label={t('Funded by (optional)')} extra={t('The report counts in this funder\'s report.')}>
                    <FunderSelect />
                </Form.Item>
                <Typography.Title level={5} style={{ marginTop: 4 }}>{t('Approval and assurance')}</Typography.Title>
                <Typography.Paragraph type="secondary">{t('Published reports say who approved them and how the figures were checked (GRI 2-5 and 2-14). Fill this in once the client signs off.')}</Typography.Paragraph>
                <Row gutter={12}>
                    <Col xs={24} sm={9}>
                        <Form.Item name="approvedBy" label={t('Approved by')}>
                            <Input maxLength={120} placeholder={t('e.g. Thabo Nkosi')} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} sm={9}>
                        <Form.Item name="approverRole" label={t('Role')}>
                            <Input maxLength={120} placeholder={t('e.g. Managing Director, for the board')} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} sm={6}>
                        <Form.Item name="approvedOn" label={t('Date')}>
                            <DatePicker style={{ width: '100%' }} format="D MMM YYYY" />
                        </Form.Item>
                    </Col>
                </Row>
                <Row gutter={12}>
                    <Col xs={24} sm={assurance && assurance !== 'none' ? 12 : 24}>
                        <Form.Item name="assurance" label={t('How the figures were checked')}>
                            <Select options={[
                                { value: 'none', label: t('Not independently checked') },
                                { value: 'internal', label: t('Reviewed internally') },
                                { value: 'limited', label: t('Independent limited assurance') },
                                { value: 'reasonable', label: t('Independent reasonable assurance') },
                            ]} />
                        </Form.Item>
                    </Col>
                    {assurance && assurance !== 'none' && (
                        <Col xs={24} sm={12}>
                            <Form.Item name="assuranceProvider" label={assurance === 'internal' ? t('Reviewed by') : t('Assurance provider')}>
                                <Input maxLength={160} />
                            </Form.Item>
                        </Col>
                    )}
                </Row>
                <Alert type="info" showIcon message={t('GRI Standards apply by the report\'s publication date: for example, reports published from 1 January 2027 use GRI 102 Climate Change and GRI 103 Energy instead of GRI 305 and 302.')} />
            </Form>
        </Modal>
    )
}
