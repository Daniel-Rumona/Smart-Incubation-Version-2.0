import { useState } from 'react'
import { App, Button, Tooltip, Typography, Upload } from 'antd'
import { DeleteOutlined, InboxOutlined } from '@ant-design/icons'
import MaterialIcon from '@/components/lms/MaterialIcon'
import { MATERIAL_ACCEPT, isSupportedMaterial, uploadCourseMaterial } from '@/services/courseMaterialsService'
import type { LessonMaterial } from '@/services/courseTemplatesService'
import { formatFileSize } from '@/lib/fileSize'
import { useLanguage } from '@/providers/LanguageProvider'

type MaterialsEditorProps = {
    materials: LessonMaterial[]
    onChange: (materials: LessonMaterial[]) => void
}

/** Reference files for a lesson. Learners can open them, and the AI can read them during the lesson chat. */
export const MaterialsEditor = ({ materials, onChange }: MaterialsEditorProps) => {
    const { message } = App.useApp()
    const { t } = useLanguage()
    const [uploading, setUploading] = useState(false)

    const add = async (file: File) => {
        if (!isSupportedMaterial(file)) {
            message.error(t('Use a PDF, Word (.docx), text or Markdown file.'))
            return
        }

        setUploading(true)
        try {
            const { material, readable } = await uploadCourseMaterial(file)
            onChange([...materials, material])
            if (readable) message.success(t('Material added — the AI can read it.'))
            else message.warning(t('Added, but no readable text was found (a scanned PDF?), so the AI cannot read it.'))
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('The file could not be uploaded.'))
        } finally {
            setUploading(false)
        }
    }

    return (
        <div className="lesson-materials-editor">
            <Typography.Text strong>{t('Materials')}</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: '2px 0 10px' }}>
                {t('PDF or Word (.docx) files for this lesson. Learners can open them and ask the AI about them.')}
            </Typography.Paragraph>

            {materials.length > 0 && (
                <ul className="lesson-materials-list">
                    {materials.map((material) => (
                        <li key={material.id}>
                            <MaterialIcon kind={material.kind} />
                            <a href={material.url} target="_blank" rel="noreferrer" className="lesson-material-name">{material.name}</a>
                            <span className="lesson-material-meta">
                                {formatFileSize(material.size)}
                                {material.chars === 0 && <em> · {t('not readable by AI')}</em>}
                            </span>
                            <Tooltip title={t('Remove')}>
                                <Button
                                    size="small"
                                    shape="circle"
                                    danger
                                    icon={<DeleteOutlined />}
                                    aria-label={t('Remove')}
                                    onClick={() => onChange(materials.filter((item) => item.id !== material.id))}
                                />
                            </Tooltip>
                        </li>
                    ))}
                </ul>
            )}

            <Upload.Dragger
                accept={MATERIAL_ACCEPT}
                multiple={false}
                showUploadList={false}
                disabled={uploading}
                beforeUpload={(file) => { void add(file); return Upload.LIST_IGNORE }}
            >
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p className="ant-upload-text">{uploading ? t('Reading and uploading…') : t('Drop a file here, or click to browse')}</p>
            </Upload.Dragger>
        </div>
    )
}

export default MaterialsEditor
