import { Alert, Button, Card, Col, Divider, Form, Input, InputNumber, Modal, Progress, Row, Segmented, Space, Tag, Typography, Upload } from 'antd'
import type { UploadFile } from 'antd'
import { BulbOutlined, CheckCircleOutlined, FileTextOutlined, RobotOutlined, SaveOutlined, UploadOutlined, WarningOutlined } from '@ant-design/icons'
import { useMemo, useState } from 'react'
import { analyseInterventionUpdate } from '@/services/interventionAiService'
import type { AiReview, InterventionRow, ProgressUpdateForm, UpdateMode } from '@/types/interventions'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const { Text, Paragraph } = Typography

type AIInterventionUpdateModalProps = {
  open: boolean
  row?: InterventionRow
  mode: UpdateMode
  saving?: boolean
  onCancel: () => void
  onApply: (values: ProgressUpdateForm, source: UpdateMode) => Promise<void> | void
}

const readinessTag = (review: AiReview) => {
  if (review.completionReadiness === 'ready') return <Tag color="green" icon={<CheckCircleOutlined />}>{tr('Ready for completion review')}</Tag>
  if (review.completionReadiness === 'close') return <Tag color="gold" icon={<BulbOutlined />}>{tr('Close to completion')}</Tag>
  return <Tag icon={<WarningOutlined />}>{tr('Needs more work')}</Tag>
}

/**
 * Interventions with a numeric target (e.g. "20 hours of coaching" or "5 site visits") track
 * progress by accumulating hours or units against that target, not just a typed percentage.
 * Which field applies depends on the intervention's own target metric - showing both regardless
 * of target type is what made "Units completed" meaningless on interventions with no such target.
 */
const targetFieldFor = (row: InterventionRow) => {
  const targetType = String(row.raw.targetType || '').toLowerCase()
  if (targetType !== 'number') return null

  const targetValue = row.raw.targetValue
  const targetActual = row.raw.targetActual
  const metric = String(row.raw.targetMetric || '').toLowerCase()
  const isHours = metric.includes('hour')
  const unitLabel = row.raw.targetMetric || (isHours ? 'hours' : 'units')

  return {
    fieldName: isHours ? 'hoursAdded' as const : 'unitsAdded' as const,
    label: isHours ? 'Hours worked this update' : 'Units completed this update',
    help: targetValue
      ? `Target: ${targetValue} ${unitLabel}${targetActual != null ? ` · ${targetActual} logged so far` : ''}`
      : undefined,
  }
}

type FormValues = Omit<ProgressUpdateForm, 'evidenceFiles'> & { sourceText?: string; evidenceFiles?: UploadFile[] }

export const AIInterventionUpdateModal = ({ open, row, mode, saving, onCancel, onApply }: AIInterventionUpdateModalProps) => {
  const { t } = useLanguage()
  const [form] = Form.useForm<FormValues>()
  const [activeMode, setActiveMode] = useState<UpdateMode>(mode)
  const [review, setReview] = useState<AiReview>()
  const [analysing, setAnalysing] = useState(false)

  const title = useMemo(() => {
    if (!row) return 'Update intervention'
    return activeMode === 'ai' ? `AI update: ${row.title}` : `Manual update: ${row.title}`
  }, [activeMode, row])

  const targetField = row ? targetFieldFor(row) : null

  const resetAndClose = () => {
    setReview(undefined)
    setAnalysing(false)
    form.resetFields()
    onCancel()
  }

  const prepareDefaults = () => {
    if (!row) return
    form.setFieldsValue({
      hoursAdded: undefined,
      unitsAdded: undefined,
      progressAfter: row.progress,
      notes: String(row.raw.notes || ''),
      sourceText: '',
      evidenceFiles: [],
    })
    setReview(undefined)
    setActiveMode(mode)
  }

  const runAiReview = async () => {
    if (!row) return
    const sourceText = String(form.getFieldValue('sourceText') || '').trim()
    if (!sourceText) return

    try {
      setAnalysing(true)
      const nextReview = await analyseInterventionUpdate({ sourceText, intervention: row.raw })
      setReview(nextReview)
      form.setFieldsValue({
        hoursAdded: nextReview.suggestedHours,
        unitsAdded: nextReview.suggestedUnits,
        progressAfter: nextReview.suggestedProgress,
        notes: nextReview.polishedNotes,
      })
    } finally {
      setAnalysing(false)
    }
  }

  const applyFields = (
    <>
      <Row gutter={12}>
        {targetField && (
          <Col xs={24} md={8}>
            <Form.Item name={targetField.fieldName} label={targetField.label} help={targetField.help}>
              <InputNumber min={0} step={targetField.fieldName === 'hoursAdded' ? 0.25 : 1} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        )}
        <Col xs={24} md={targetField ? 16 : 24}>
          <Form.Item name="progressAfter" label={t('Progress after')} rules={[{ required: true, message: tr('Progress is required.') }]}>
            <InputNumber min={0} max={100} style={{ width: '100%' }} addonAfter="%" />
          </Form.Item>
        </Col>
      </Row>

      <Form.Item name="notes" label={t('Final progress notes')}>
        <Input.TextArea rows={4} />
      </Form.Item>

      <Form.Item noStyle shouldUpdate={(previous, current) => previous.progressAfter !== current.progressAfter}>
        {({ getFieldValue }) => (getFieldValue('progressAfter') ?? 0) >= 100 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={t('This marks the intervention 100% complete.')}
            description={t('Attach proof of evidence below before applying the update.')}
          />
        )}
      </Form.Item>

      <Form.Item
        name="evidenceFiles"
        label={t('Proof of evidence')}
        extra={tr('Optional unless this update reaches 100%.')}
        valuePropName="fileList"
        getValueFromEvent={(event) => (Array.isArray(event) ? event : event?.fileList)}
        dependencies={['progressAfter']}
        rules={[
          ({ getFieldValue }) => ({
            validator(_, value: UploadFile[] | undefined) {
              if ((getFieldValue('progressAfter') ?? 0) >= 100 && !(value && value.length > 0)) {
                return Promise.reject(new Error('Attach proof of evidence before marking this 100% complete.'))
              }
              return Promise.resolve()
            },
          }),
        ]}
      >
        <Upload beforeUpload={() => false} multiple>
          <Button icon={<UploadOutlined />}>{t('Attach evidence')}</Button>
        </Upload>
      </Form.Item>
    </>
  )

  return (
    <Modal
      open={open}
      title={title}
      onCancel={resetAndClose}
      footer={null}
      width={900}
      destroyOnClose
      afterOpenChange={(isOpen) => {
        if (isOpen) prepareDefaults()
      }}
    >
      {row && (
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => onApply({ ...values, evidenceFiles: (values.evidenceFiles || []).map((file) => file.name) }, activeMode)}
        >
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small">
              <Row gutter={[12, 12]} align="middle">
                <Col xs={24} md={8}>
                  <Space direction="vertical" size={0}>
                    <Text strong>{row.beneficiaryName}</Text>
                    <Text type="secondary">{row.programmeName || t('Assigned programme')}</Text>
                  </Space>
                </Col>
                <Col xs={24} md={9}>
                  <Progress percent={row.progress} size="small" />
                </Col>
                <Col xs={24} md={7}>
                  <Segmented
                    block
                    value={activeMode}
                    onChange={(value) => {
                      setActiveMode(value as UpdateMode)
                      setReview(undefined)
                    }}
                    options={[
                      { value: 'manual', label: t('Manual') },
                      { value: 'ai', label: t('AI') },
                    ]}
                  />
                </Col>
              </Row>
            </Card>

            {activeMode === 'manual' && (
              <Card size="small" title={t('Manual progress capture')}>
                {applyFields}
              </Card>
            )}

            {activeMode === 'ai' && (
              <Card size="small" title={<Space><RobotOutlined /> {t('AI progress assistant')}</Space>}>
                {/*
                  Plain flex div, not antd's Space: a global rule (.ant-modal .ant-modal-body
                  .ant-space:has(> .ant-space-item > .ant-btn)) forces ANY Space in a modal body
                  that contains a button into a horizontal, equal-width row - meant for footer-style
                  action rows, but it doesn't care that this Space also holds an Alert and a form
                  field. That's what squashed the alert/textarea/button onto one line.
                */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
                  <Alert
                    type="info"
                    showIcon
                    message={t('Describe the work completed in plain language. The assistant will extract hours, deliverables, progress, blockers, next steps, and evidence suggestions.')}
                  />

                  <Form.Item
                    name="sourceText"
                    label={t('Work update')}
                    rules={[{ required: true, message: tr('Describe what was completed before running AI review.') }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Input.TextArea
                      rows={4}
                      placeholder={t('Example: Completed 3 hours with the SME, reviewed bookkeeping records, identified missing invoices, and prepared the next action list.')}
                    />
                  </Form.Item>

                  <Button icon={<RobotOutlined />} onClick={() => void runAiReview()} loading={analysing}>
                    {t('Analyse update')}
                  </Button>

                  {review && (
                    <>
                      <Divider style={{ margin: 0 }} />

                      <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <Space wrap size={8}>
                          <Tag color="blue">{t('Confidence')} {Math.round(review.confidence || 0)}%</Tag>
                          {review.suggestedProgress != null && <Tag color="green">{t('Suggested progress')} {review.suggestedProgress}%</Tag>}
                          {readinessTag(review)}
                        </Space>

                        <div>
                          <Text strong>{t('AI summary')}</Text>
                          <Paragraph style={{ marginBottom: 0 }}>{review.summary}</Paragraph>
                        </div>

                        {review.blockers.length > 0 && (
                          <Alert type="warning" showIcon message={t('Detected blockers')} description={review.blockers.join(' ')} />
                        )}

                        {review.nextSteps.length > 0 && (
                          <div>
                            <Text strong>{t('Recommended next steps')}</Text>
                            <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                              {review.nextSteps.map((item) => <li key={item}>{item}</li>)}
                            </ul>
                          </div>
                        )}

                        {review.proofSuggestions.length > 0 && (
                          <div>
                            <Text strong>{t('Suggested evidence')}</Text>
                            <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
                              {review.proofSuggestions.map((proof) => (
                                <Col xs={24} md={12} key={proof.id}>
                                  <Card size="small" type="inner">
                                    <Space align="start">
                                      <FileTextOutlined />
                                      <Space direction="vertical" size={0}>
                                        <Text strong>{proof.label}</Text>
                                        <Text type="secondary">{proof.reason}</Text>
                                        {proof.required && <Tag color="red">{t('Required before completion')}</Tag>}
                                      </Space>
                                    </Space>
                                  </Card>
                                </Col>
                              ))}
                            </Row>
                          </div>
                        )}
                      </Space>

                      <Divider style={{ margin: 0 }} />
                      <Text strong>{t('Apply this update')}</Text>

                      {applyFields}
                    </>
                  )}
                </div>
              </Card>
            )}

            <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
              <Button onClick={resetAndClose}>{t('Cancel')}</Button>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving || analysing} disabled={activeMode === 'ai' && !review}>
                {t('Apply update')}
              </Button>
            </Space>
          </Space>
        </Form>
      )}
    </Modal>
  )
}

export default AIInterventionUpdateModal
