import { Checkbox, DatePicker, Input, Radio, Rate, Select, Typography, Upload } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import type { SurveyField } from '@/services/surveyTemplatesService'
import { useLanguage } from '@/providers/LanguageProvider'

/** How a question will look to the SME answering it. Inert: nothing here submits. */
export const SurveyFieldPreview = ({ field }: { field: SurveyField }) => {
    const { t } = useLanguage()
    switch (field.type) {
        case 'text':
            return <Input placeholder={field.placeholder} />
        case 'textarea':
            return <Input.TextArea rows={3} placeholder={field.placeholder} />
        case 'number':
            return <Input type="number" placeholder={field.placeholder} />
        case 'email':
            return <Input type="email" placeholder={field.placeholder} />
        case 'select':
            return <Select style={{ width: '100%' }} placeholder={field.placeholder} options={(field.options || []).map((option) => ({ value: option, label: option }))} />
        case 'checkbox':
            return <Checkbox.Group options={(field.options || []).map((option) => ({ label: option, value: option }))} />
        case 'radio':
            return <Radio.Group options={(field.options || []).map((option) => ({ label: option, value: option }))} />
        case 'date':
            return <DatePicker style={{ width: '100%' }} />
        case 'file':
            return (
                <Upload.Dragger multiple={false} maxCount={1} beforeUpload={() => false} className="survey-field-dragger">
                    <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                    <p className="ant-upload-text">{t('Drag and drop a file here')}</p>
                    <p className="ant-upload-hint">{t('or click to browse')}</p>
                </Upload.Dragger>
            )
        case 'rating':
            return <Rate />
        case 'heading':
            return <Typography.Title level={5} className="survey-field-heading">{field.label || t('Section')}</Typography.Title>
        default:
            return null
    }
}

export default SurveyFieldPreview
