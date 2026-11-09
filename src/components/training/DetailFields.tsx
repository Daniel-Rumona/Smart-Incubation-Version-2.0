import { Col, DatePicker, Form, Input, InputNumber, Row, Select } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useLanguage } from '@/providers/LanguageProvider'
import type { DetailField } from '@/config/trainingDetails'

/** A date stored as `YYYY-MM-DD`, edited with a date picker. */
const DateValue = ({ value, onChange }: { value?: string, onChange?: (value: string) => void }) => (
    <DatePicker
        style={{ width: '100%' }}
        format="D MMM YYYY"
        value={value && dayjs(value).isValid() ? dayjs(value) : null}
        onChange={(date: Dayjs | null) => onChange?.(date ? date.format('YYYY-MM-DD') : '')}
    />
)

/**
 * The details asked of a company or a learner (config/trainingDetails.ts), as form items under `name` (e.g. 'details').
 * `required` makes every one of them required.
 */
export const DetailFields = ({ fields, name = 'details', required = false }: { fields: DetailField[], name?: string, required?: boolean }) => {
    const { t } = useLanguage()
    const rules = required ? [{ required: true, message: t('Fill this in.') }] : []
    return (
        <Row gutter={12}>
            {fields.map((field) => (
                <Col key={field.key} xs={24} sm={field.kind === 'paragraph' || field.kind === 'text' && field.key === 'businessAddress' ? 24 : 12}>
                    <Form.Item name={[name, field.key]} label={t(field.label)} extra={field.help ? t(field.help) : undefined} rules={rules}>
                        {field.kind === 'select' ? (
                            <Select allowClear showSearch optionFilterProp="label" options={(field.options || []).map((item) => ({ value: item.value, label: t(item.label) }))} />
                        ) : field.kind === 'date' ? (
                            <DateValue />
                        ) : field.kind === 'paragraph' ? (
                            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={1000} />
                        ) : field.kind === 'number' ? (
                            <InputNumber min={0} style={{ width: '100%' }} />
                        ) : field.kind === 'percent' ? (
                            <InputNumber min={0} max={100} suffix="%" style={{ width: '100%' }} />
                        ) : field.kind === 'money' ? (
                            <InputNumber min={0} step={1000} prefix="R" style={{ width: '100%' }} />
                        ) : (
                            <Input maxLength={200} />
                        )}
                    </Form.Item>
                </Col>
            ))}
        </Row>
    )
}
