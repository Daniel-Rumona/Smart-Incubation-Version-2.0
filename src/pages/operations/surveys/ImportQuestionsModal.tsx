import { useMemo, useState } from 'react'
import { Alert, App, Button, Checkbox, List, Modal, Radio, Space, Spin, Tag, Typography, Upload } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import {
    MAX_SURVEY_DOCUMENT_BYTES,
    SURVEY_DOCUMENT_ACCEPT,
    extractSurveyQuestions,
    type ExtractedSurveyMeta,
    type SurveyExtractionResult,
} from '@/services/surveyQuestionExtractionService'
import { SURVEY_FIELD_TYPES, type SurveyField } from '@/services/surveyTemplatesService'
import { isAgentApiConfigured } from '@/config/agent'
import { useLanguage } from '@/providers/LanguageProvider'

export type ImportOptions = { replace: boolean, applyMeta: boolean }

type ImportQuestionsModalProps = {
    open: boolean
    /** Current survey category, sent as a hint to the extractor. */
    category?: string
    hasExistingFields: boolean
    onClose: () => void
    /** Receives only the questions still ticked in the review list. */
    onImport: (fields: SurveyField[], meta: ExtractedSurveyMeta, options: ImportOptions) => void
}

const typeLabel = (type: string) => SURVEY_FIELD_TYPES.find((item) => item.value === type)?.label || type

const megabytes = MAX_SURVEY_DOCUMENT_BYTES / (1024 * 1024)

export const ImportQuestionsModal = ({ open, category, hasExistingFields, onClose, onImport }: ImportQuestionsModalProps) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const [file, setFile] = useState<File | null>(null)
    const [analysing, setAnalysing] = useState(false)
    const [result, setResult] = useState<SurveyExtractionResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [skipped, setSkipped] = useState<Set<string>>(new Set())
    const [applyMeta, setApplyMeta] = useState(true)
    const [replace, setReplace] = useState(false)

    const reset = () => {
        setFile(null)
        setAnalysing(false)
        setResult(null)
        setError(null)
        setSkipped(new Set())
        setApplyMeta(true)
        setReplace(false)
    }

    const close = () => {
        if (analysing) return
        reset()
        onClose()
    }

    const analyse = async (target: File) => {
        setAnalysing(true)
        setError(null)
        setResult(null)
        setSkipped(new Set())
        try {
            setResult(await extractSurveyQuestions({ file: target, category }))
        } catch (thrown) {
            setError(thrown instanceof Error ? thrown.message : 'The questions could not be read from this document.')
        } finally {
            setAnalysing(false)
        }
    }

    const toggle = (id: string) => setSkipped((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
    })

    const selected = useMemo(() => (result?.fields || []).filter((field) => !skipped.has(field.id)), [result, skipped])

    const apply = () => {
        if (!result || !selected.length) return
        onImport(selected, result.meta, { replace, applyMeta })
        message.success(`${selected.length} question${selected.length === 1 ? '' : 's'} imported.`)
        reset()
        onClose()
    }

    return (
        <Modal
            open={open}
            onCancel={close}
            title={t('Import questions from a document')}
            width={720}
            maskClosable={!analysing}
            className="survey-import-modal"
            footer={[
                <Button key="cancel" onClick={close} disabled={analysing}>{t('Cancel')}</Button>,
                <Button key="apply" type="primary" disabled={!result || !selected.length} onClick={apply}>
                    {selected.length ? `Add ${selected.length} question${selected.length === 1 ? '' : 's'}` : t('Add questions')}
                </Button>,
            ]}
        >
            <Space direction="vertical" size={16} className="survey-import-stack">
                {!isAgentApiConfigured && (
                    <Alert
                        type="warning"
                        showIcon
                        message={t('The AI service is not configured for this environment')}
                        description={t('Set VITE_AGENT_API_BASE_URL to enable importing.')}
                    />
                )}

                <Upload.Dragger
                    accept={SURVEY_DOCUMENT_ACCEPT}
                    multiple={false}
                    maxCount={1}
                    disabled={analysing || !isAgentApiConfigured}
                    showUploadList={false}
                    // The AI service does the reading, so antd must never post the file itself.
                    beforeUpload={(selectedFile) => {
                        if (selectedFile.size > MAX_SURVEY_DOCUMENT_BYTES) {
                            message.error(`Choose a file under ${megabytes}MB.`)
                            return Upload.LIST_IGNORE
                        }
                        setFile(selectedFile)
                        void analyse(selectedFile)
                        return false
                    }}
                >
                    <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                    <p className="ant-upload-text">{file ? file.name : t('Click or drag a questionnaire here')}</p>
                    <p className="ant-upload-hint">{t('Word, PDF, text, Markdown or CSV, up to')} {megabytes}{t('MB.')}</p>
                </Upload.Dragger>

                {analysing && (
                    <div className="survey-import-busy">
                        <Spin />
                        <Typography.Text type="secondary">{t('Reading the document…')}</Typography.Text>
                    </div>
                )}

                {error && (
                    <Alert
                        type="error"
                        showIcon
                        message={t('Import failed')}
                        description={error}
                        action={file ? <Button size="small" onClick={() => void analyse(file)}>{t('Retry')}</Button> : null}
                    />
                )}

                {result && (
                    <>
                        {result.warnings.map((warning) => <Alert key={warning} type="warning" showIcon message={warning} />)}

                        <Alert
                            type="info"
                            showIcon
                            message={`Found ${result.fields.length} question${result.fields.length === 1 ? '' : 's'}. Untick anything you do not want.`}
                        />

                        {(result.meta.title || result.meta.description) && (
                            <Checkbox checked={applyMeta} onChange={(event) => setApplyMeta(event.target.checked)}>
                                {t('Also use the document\'s title')}{result.meta.description ? t(' and description') : ''}
                                {result.meta.title ? ` (“${result.meta.title}”)` : ''}
                            </Checkbox>
                        )}

                        {hasExistingFields && (
                            <Radio.Group value={replace ? 'replace' : 'append'} onChange={(event) => setReplace(event.target.value === 'replace')}>
                                <Radio value="append">{t('Add to existing questions')}</Radio>
                                <Radio value="replace">{t('Replace all existing questions')}</Radio>
                            </Radio.Group>
                        )}

                        <List
                            size="small"
                            bordered
                            className="survey-import-review"
                            dataSource={result.fields}
                            renderItem={(field) => (
                                <List.Item>
                                    <Space align="start" className="survey-import-review-row">
                                        <Checkbox checked={!skipped.has(field.id)} onChange={() => toggle(field.id)} />

                                        <div className="survey-import-review-copy">
                                            <Typography.Text strong={field.type === 'heading'} delete={skipped.has(field.id)}>
                                                {field.label}
                                            </Typography.Text>

                                            <Space size={6} wrap className="survey-import-review-meta">
                                                <Tag>{typeLabel(field.type)}</Tag>
                                                {field.required && <Tag color="red">{t('Required')}</Tag>}
                                                {field.options?.length ? (
                                                    <Typography.Text type="secondary">{field.options.join(' · ')}</Typography.Text>
                                                ) : null}
                                            </Space>
                                        </div>
                                    </Space>
                                </List.Item>
                            )}
                        />
                    </>
                )}
            </Space>
        </Modal>
    )
}

export default ImportQuestionsModal
