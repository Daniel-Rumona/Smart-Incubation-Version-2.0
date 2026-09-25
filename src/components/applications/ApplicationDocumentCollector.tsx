import { Button, Card, Col, DatePicker, Empty, Row, Space, Tag, Typography, Upload } from 'antd'
import { CalendarOutlined, FileDoneOutlined, UploadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { ProgramDocumentRequirement } from '@/types/application'
import { useLanguage } from '@/providers/LanguageProvider'

const { Text, Paragraph } = Typography

type Props = {
  documents: ProgramDocumentRequirement[]
  onChange: (documents: ProgramDocumentRequirement[]) => void
  activeRequirementId?: string
}

export default function ApplicationDocumentCollector({ documents, onChange, activeRequirementId }: Props) {
  const { t } = useLanguage()
  const updateDocument = (requirementId: string, patch: Partial<ProgramDocumentRequirement>) => {
    onChange(documents.map((item) => (item.requirementId === requirementId ? { ...item, ...patch } : item)))
  }

  if (!documents.length) {
    return (
      <Card className="program-application-soft-card">
        <Empty description={t('No document requirements have been configured for this programme.')} />
      </Card>
    )
  }

  return (
    <Row gutter={[12, 12]}>
      {documents.map((item) => {
        const isActive = activeRequirementId === item.requirementId
        const hasFile = Boolean(item.file || item.uploadedUrl)
        const allowedFormats = item.allowedFormats?.length ? item.allowedFormats : ['pdf', 'jpg', 'jpeg', 'png']

        return (
          <Col xs={24} key={item.requirementId}>
            <Card className={`program-application-doc-card${isActive ? ' is-active' : ''}`} size="small">
              <div className="program-application-doc-main">
                <div className="program-application-doc-copy">
                  <Space wrap size={6}>
                    <FileDoneOutlined />
                    <Text strong>{item.type}</Text>
                    {item.isRequired !== false ? <Tag color="red">{t('Required')}</Tag> : <Tag color="blue">{t('Optional')}</Tag>}
                    {item.requiresExpiry ? <Tag icon={<CalendarOutlined />} color="orange">{t('Expiry date needed')}</Tag> : null}
                    {hasFile ? <Tag color="green">{t('Added')}</Tag> : <Tag>{t('Missing')}</Tag>}
                  </Space>

                  {item.description ? (
                    <Paragraph type="secondary" className="program-application-doc-description">
                      {item.description}
                    </Paragraph>
                  ) : null}

                  <Text type="secondary" className="program-application-help-text">
                    {allowedFormats.join(', ').toUpperCase()} {t('· Max')} {item.maxSizeMB || 10} {t('MB')}
                  </Text>
                </div>

                <div className="program-application-doc-actions">
                  <Upload
                    beforeUpload={(file) => {
                      updateDocument(item.requirementId, { file, status: 'ready' })
                      return false
                    }}
                    fileList={
                      item.file
                        ? [{ uid: item.requirementId, name: item.file.name, status: 'done' }]
                        : item.fileName
                          ? [{ uid: item.requirementId, name: item.fileName, status: 'done' }]
                          : []
                    }
                    onRemove={() => updateDocument(item.requirementId, { file: null, uploadedUrl: null, fileName: null, storagePath: null, status: 'missing' })}
                    maxCount={1}
                  >
                    <Button block icon={<UploadOutlined />}>
                      {hasFile ? t('Replace document') : t('Upload document')}
                    </Button>
                  </Upload>

                  {item.requiresExpiry ? (
                    <DatePicker
                      style={{ width: '100%' }}
                      value={item.expiryDate ? dayjs(item.expiryDate) : null}
                      onChange={(date) => updateDocument(item.requirementId, { expiryDate: date ? date.format('YYYY-MM-DD') : null })}
                      placeholder={t('Expiry date')}
                    />
                  ) : null}
                </div>
              </div>
            </Card>
          </Col>
        )
      })}
    </Row>
  )
}
