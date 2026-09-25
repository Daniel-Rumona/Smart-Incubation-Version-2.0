import { Alert, App, Button, Card, Col, Descriptions, Form, Input, Row, Select, Space, Steps, Typography, Upload, type UploadProps } from 'antd'
import { ArrowLeftOutlined, FileDoneOutlined, UploadOutlined, UserAddOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { saveComplianceDocument, uploadComplianceFile } from '@/services/operationsComplianceService'
import { createOperationsParticipant, getProgramOnboardingConfig, type NewParticipant, type OnboardingQuestion, type ProgramOnboardingConfig } from '@/services/operationsParticipantOnboardingService'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/operations-participants.css'

const provinces = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape']
const stages = ['Startup', 'Growth', 'Mature', 'Decline']
const detailFields: Array<keyof NewParticipant> = ['participantName', 'email', 'businessName']

export const ParticipantOnboardingPage = () => {
  const { message } = App.useApp()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { user } = useFullIdentity()
  const { activeProgramId, isAllPrograms } = useActiveProgramId()
  const [form] = Form.useForm<NewParticipant>()
  const [config, setConfig] = useState<ProgramOnboardingConfig>()
  const [documents, setDocuments] = useState<Record<string, File>>({})
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const values = Form.useWatch([], form) || {}

  useEffect(() => {
    if (isAllPrograms) return
    void getProgramOnboardingConfig(activeProgramId).then(setConfig)
  }, [activeProgramId, isAllPrograms])

  const questionField = (question: OnboardingQuestion) => {
    const options = Array.isArray(question.options) ? question.options : String(question.options || '').split(',').map((value) => value.trim()).filter(Boolean)
    const label = question.label || question.question || 'Programme question'
    const maxSelections = Number(question.maxSelections || 0)
    const rules = [
      ...(question.required !== false ? [{ required: true, message: `Please answer: ${label}` }] : []),
      ...(question.type === 'multi_select' && maxSelections ? [{ validator: (_: unknown, value?: string[]) => !value || value.length <= maxSelections ? Promise.resolve() : Promise.reject(new Error(`Choose no more than ${maxSelections} answers.`)) }] : []),
    ]
    return <Form.Item key={question.id} name={['onboardingAnswers', question.id]} label={label} rules={rules}>
      {question.type === 'multi_select' ? <Select mode="multiple" maxCount={maxSelections || undefined} options={options.map((value) => ({ value, label: value }))} />
        : ['dropdown', 'single_select', 'select'].includes(question.type || '') ? <Select options={options.map((value) => ({ value, label: value }))} />
          : question.type === 'yes_no' ? <Select options={[{ value: 'yes', label: t('Yes') }, { value: 'no', label: t('No') }]} />
            : ['long_text', 'longText', 'textarea'].includes(question.type || '') ? <Input.TextArea rows={4} /> : <Input type={question.type === 'number' ? 'number' : 'text'} />}
    </Form.Item>
  }
  const missingDocuments = useMemo(() => (config?.documents || []).filter((document) => document.required && !documents[document.id]), [config?.documents, documents])

  const next = async () => {
    if (step === 0) {
      await form.validateFields(detailFields)
    }
    if (step === 1 && config?.questions.length) {
      await form.validateFields(config.questions.map((question) => ['onboardingAnswers', question.id]))
    }
    if (step === 2 && missingDocuments.length) {
      message.error(t('operations.participants.documentsRequired'))
      return
    }
    setStep((current) => current + 1)
  }

  const save = async () => {
    if (!user || !config) return
    try {
      const formValues = await form.validateFields()
      setSaving(true)
      const participantId = await createOperationsParticipant({ ...formValues, programId: activeProgramId, programName: config.name })
      await Promise.all(Object.entries(documents).map(async ([documentId, file]) => {
        const definition = config.documents.find((document) => document.id === documentId)
        if (!definition) return
        const url = await uploadComplianceFile(participantId, definition.title, file)
        await saveComplianceDocument(user, {
          participantId,
          programId: activeProgramId,
          companyCode: user.companyCode || undefined,
          type: definition.title,
          documentName: file.name,
          currentStatus: 'pending',
          fileName: file.name,
          url,
        })
      }))
      message.success(t('operations.participants.created'))
      navigate('/operations/participants/all')
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('operations.participants.createError'))
    } finally {
      setSaving(false)
    }
  }

  if (isAllPrograms) return <DashboardPage><Alert type="warning" showIcon message={t('operations.participants.selectProgramme')} action={<Button onClick={() => navigate('/operations/participants/all')}>{t('common.back')}</Button>} /></DashboardPage>

  return <DashboardPage className="operations-participant-onboarding">
    <Card title={t('operations.participants.add')} extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/operations/participants/all')}>{t('common.back')}</Button>}>
      <Alert type="info" showIcon message={`${t('operations.participants.programme')}: ${config?.name || activeProgramId}`} style={{ marginBottom: 16 }} />
      <Steps current={step} responsive items={[
        { title: t('operations.participants.details') },
        { title: t('operations.participants.questions') },
        { title: t('operations.compliance.documents') },
        { title: t('common.review') },
      ]} />
      <Form form={form} layout="vertical" className="operations-onboarding-form">
        {step === 0 && <Row gutter={[14, 0]}>
          <Col xs={24} md={12}><Form.Item name="participantName" label={t('common.name')} rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="email" label={t('common.email')} rules={[{ required: true }, { type: 'email' }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="businessName" label={t('operations.participants.enterprise')} rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="phone" label={t('common.phone')}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="sector" label={t('common.sector')}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="stage" label={t('operations.participants.stage')}><Select options={stages.map((value) => ({ value, label: value }))} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="province" label={t('common.province')}><Select showSearch options={provinces.map((value) => ({ value, label: value }))} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="beeLevel" label={t('common.beeLevel')}><Input /></Form.Item></Col>
        </Row>}
        {step === 1 && <Space orientation="vertical" className="operations-onboarding-section">
          {config?.questions.length ? config.questions.map(questionField) : <Alert type="info" showIcon message={t('applicant.application.noQuestions')} />}
        </Space>}
        {step === 2 && <Space orientation="vertical" className="operations-onboarding-section">
          <Typography.Paragraph type="secondary">{t('operations.participants.documentsHint')}</Typography.Paragraph>
          {(config?.documents || []).map((document) => {
            const uploadProps: UploadProps = { beforeUpload: (file) => { setDocuments((current) => ({ ...current, [document.id]: file })); return false }, maxCount: 1, onRemove: () => { setDocuments((current) => { const nextDocuments = { ...current }; delete nextDocuments[document.id]; return nextDocuments }) } }
            return <Card size="small" key={document.id} className="operations-onboarding-document">
              <Space orientation="vertical">
                <Typography.Text strong>{document.title}{document.required ? ' *' : ''}</Typography.Text>
                <Upload {...uploadProps}><Button icon={<UploadOutlined />}>{t('operations.compliance.chooseFile')}</Button></Upload>
              </Space>
            </Card>
          })}
        </Space>}
        {step === 3 && <Space orientation="vertical" className="operations-onboarding-section">
          <Alert type="success" showIcon icon={<FileDoneOutlined />} message={t('operations.participants.reviewHint')} />
          <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} items={[
            { key: 'name', label: t('common.name'), children: values.participantName },
            { key: 'email', label: t('common.email'), children: values.email },
            { key: 'enterprise', label: t('operations.participants.enterprise'), children: values.businessName },
            { key: 'program', label: t('operations.participants.programme'), children: config?.name },
            { key: 'questions', label: t('operations.participants.questions'), children: Object.keys(values.onboardingAnswers || {}).length },
            { key: 'documents', label: t('operations.compliance.documents'), children: Object.keys(documents).length },
          ]} />
        </Space>}
        <div className="operations-onboarding-footer">
          <Button icon={<ArrowLeftOutlined />} onClick={() => step ? setStep((current) => current - 1) : navigate('/operations/participants/all')}>{step ? t('common.back') : t('common.cancel')}</Button>
          {step < 3 ? <Button type="primary" onClick={() => void next()}>{t('common.continue')}</Button> : <Button type="primary" icon={<UserAddOutlined />} loading={saving} onClick={() => void save()}>{t('operations.participants.create')}</Button>}
        </div>
      </Form>
    </Card>
  </DashboardPage>
}
