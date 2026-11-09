import { useEffect, useState } from 'react'
import { App, Button, Form, List, Popconfirm, Space, Tag, Typography, Upload } from 'antd'
import { CheckCircleOutlined, DeleteOutlined, EyeOutlined, UploadOutlined } from '@ant-design/icons'
import { DetailFields } from '@/components/training/DetailFields'
import { COMPANY_DETAIL_FIELDS, COMPANY_DOCUMENTS, fieldsFor, type TrainingDetailsSettings } from '@/config/trainingDetails'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    ORG_DOCUMENT_ACCEPT,
    openOrganisationDocument,
    orgDocumentProblem,
    removeOrganisationDocument,
    saveOrganisationDetails,
    uploadOrganisationDocument,
} from '@/services/trainingDetailsService'
import { useLanguage } from '@/providers/LanguageProvider'
import type { TrainingDetails, TrainingOrganisation } from '@/types/training'

/**
 * A client company's business details and documents, as the facilitator asks for them. The company fills it in after
 * its invite (`firstTime`: every detail is needed to send it, or it can be saved to finish later); the facilitator and
 * the company can correct it afterwards.
 */
export const CompanyDetailsForm = ({ organisation, settings, firstTime = false, part = 'all', onSaved }: {
    organisation: TrainingOrganisation
    settings: TrainingDetailsSettings
    firstTime?: boolean
    /** The details, the documents, or both (the details step after the invite, and the facilitator's drawer). */
    part?: 'all' | 'details' | 'documents'
    onSaved: () => void
}) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [form] = Form.useForm<{ details: TrainingDetails }>()
    const [saving, setSaving] = useState<'save' | 'submit' | null>(null)
    const [uploading, setUploading] = useState<string | null>(null)
    const fields = part === 'documents' ? [] : fieldsFor(COMPANY_DETAIL_FIELDS, settings.companyFields)
    const documents = part === 'details' ? [] : COMPANY_DOCUMENTS.filter((item) => settings.companyDocuments.includes(item.key))

    // Only when the details are shown: the documents alone have no form to fill.
    const showsDetails = fields.length > 0
    useEffect(() => {
        if (showsDetails) form.setFieldsValue({ details: organisation.details })
    }, [form, organisation, showsDetails])

    const save = async (submit: boolean) => {
        if (!user) return
        if (submit) {
            await form.validateFields()
            const missing = documents.filter((item) => !organisation.documents[item.key])
            if (missing.length) {
                message.error(t('Upload these first: {documents}.', undefined, { documents: missing.map((item) => t(item.label)).join(', ') }))
                return
            }
        }
        setSaving(submit ? 'submit' : 'save')
        try {
            await saveOrganisationDetails(user, organisation, form.getFieldsValue().details || {}, submit)
            message.success(submit && firstTime ? t('Thank you. Your company\'s details were sent.') : t('Details saved.'))
            onSaved()
        } catch {
            message.error(t('The details could not be saved.'))
        } finally {
            setSaving(null)
        }
    }

    const upload = async (key: string, file: File) => {
        if (!user) return
        const problem = orgDocumentProblem(file)
        if (problem) {
            message.error(problem === 'size' ? t('The file is larger than 10 MB.') : t('Upload a PDF or a photo (JPG or PNG).'))
            return
        }
        setUploading(key)
        try {
            // Unsaved answers are kept: the record reloads after the upload.
            if (fields.length) await saveOrganisationDetails(user, organisation, form.getFieldsValue().details || {}, false)
            await uploadOrganisationDocument(user, organisation, key, file)
            message.success(t('Document uploaded.'))
            onSaved()
        } catch {
            message.error(t('The document could not be uploaded.'))
        } finally {
            setUploading(null)
        }
    }

    const remove = async (key: string) => {
        if (!user) return
        try {
            await removeOrganisationDocument(user, organisation, key)
            onSaved()
        } catch {
            message.error(t('The document could not be removed.'))
        }
    }

    return (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            {fields.length > 0 && (
                <Form form={form} layout="vertical" requiredMark={false}>
                    <DetailFields fields={fields} required={firstTime} />
                </Form>
            )}
            {documents.length > 0 && (
                <section>
                    {part === 'all' && <Typography.Title level={5}>{t('Documents')}</Typography.Title>}
                    <List
                        dataSource={documents}
                        renderItem={(item) => {
                            const stored = organisation.documents[item.key]
                            return (
                                <List.Item
                                    extra={(
                                        <Space wrap>
                                            {stored && <Button size="small" icon={<EyeOutlined />} onClick={() => void openOrganisationDocument(stored).catch(() => message.error(t('The file could not be opened.')))}>{t('View')}</Button>}
                                            <Upload accept={ORG_DOCUMENT_ACCEPT} showUploadList={false} beforeUpload={(file) => { void upload(item.key, file); return false }}>
                                                <Button size="small" icon={<UploadOutlined />} loading={uploading === item.key}>{stored ? t('Replace') : t('Upload')}</Button>
                                            </Upload>
                                            {stored && (
                                                <Popconfirm title={t('Remove this document?')} okText={t('Remove')} okButtonProps={{ danger: true }} onConfirm={() => remove(item.key)}>
                                                    <Button size="small" danger icon={<DeleteOutlined />} aria-label={t('Remove')} />
                                                </Popconfirm>
                                            )}
                                        </Space>
                                    )}
                                >
                                    <List.Item.Meta
                                        title={<Space wrap size={6}>{t(item.label)}{stored ? <Tag color="green" icon={<CheckCircleOutlined />}>{t('Uploaded')}</Tag> : <Tag>{t('Not uploaded')}</Tag>}</Space>}
                                        description={stored?.fileName}
                                    />
                                </List.Item>
                            )
                        }}
                    />
                </section>
            )}
            {(fields.length > 0 || firstTime) && <Space wrap>
                {firstTime && <Button loading={saving === 'save'} onClick={() => void save(false)}>{t('Save and finish later')}</Button>}
                <Button type="primary" loading={saving === 'submit'} onClick={() => void save(true)}>{firstTime ? t('Send our details') : t('Save details')}</Button>
            </Space>}
        </Space>
    )
}
