import { Alert, App, Button, Card, Col, Descriptions, Form, Input, Row, Select, Space, Steps, Typography, Upload, type UploadProps } from 'antd'
import { ArrowLeftOutlined, FileDoneOutlined, UploadOutlined, UserAddOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import { BEE_LEVELS, BUSINESS_SECTORS } from '@/config/businessProfileOptions'
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
  // Reception registers walk-ins for review: no compliance documents, and the result is a pending application.
  const isReception = user?.role === 'admin'
  // The programme's extra questions are a step only when it has any.
  const hasQuestions = Boolean(config?.questions.length)
  const hasDocuments = !isReception && Boolean(config?.documents.length)
  const stepKeys = ['details', ...(hasQuestions ? ['questions'] : []), ...(hasDocuments ? ['documents'] : []), 'review'] as Array<'details' | 'questions' | 'documents' | 'review'>
  const stepKey = stepKeys[step]
  const lastStep = stepKeys.length - 1

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
    if (stepKey === 'details') {
      await form.validateFields(detailFields)
    }
    if (stepKey === 'questions' && config?.questions.length) {
      await form.validateFields(config.questions.map((question) => ['onboardingAnswers', question.id]))
    }
    if (stepKey === 'documents' && missingDocuments.length) {
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
      if (isReception) {
        message.success(t('Walk-in registered. Their application is waiting for review.'))
        navigate('/shared/applications')
        return
      }
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
      navigate('/shared/participants')
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      message.error(code === 'email_in_use'
        ? t('That email already belongs to a staff account. Use the SME’s own email address.')
        : code === 'already_registered'
          ? t('This SME already has an application for this programme.')
          : code || t('operations.participants.createError'))
    } finally {
      setSaving(false)
    }
  }

  if (isAllPrograms) return <DashboardPage><Alert type="warning" showIcon message={t('operations.participants.selectProgramme')} action={<Button onClick={() => navigate('/shared/participants')}>{t('common.back')}</Button>} /></DashboardPage>

  return <DashboardPage className="operations-participant-onboarding">
    <Card title={isReception ? t('Register a walk-in SME') : t('operations.participants.add')} extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/shared/participants')}>{t('Back to SMEs')}</Button>}>
      <Alert type="info" showIcon message={`${t('operations.participants.programme')}: ${config?.name || activeProgramId}`} style={{ marginBottom: 16 }} />
      <Steps current={step} responsive items={stepKeys.map((key) => ({
        title: key === 'details' ? t('operations.participants.details') : key === 'questions' ? t('operations.participants.questions') : key === 'documents' ? t('Compliance documents') : t('common.review'),
      }))} />
      <Form form={form} layout="vertical" className="operations-onboarding-form">
        <Row gutter={[14, 0]} style={stepKey === 'details' ? undefined : { display: 'none' }}>
          <Col xs={24} md={12}><Form.Item name="participantName" label={t('common.name')} rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="email" label={t('common.email')} rules={[{ required: true }, { type: 'email' }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="businessName" label={t('operations.participants.enterprise')} rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="phone" label={t('common.phone')}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="sector" label={t('common.sector')}><Select showSearch allowClear placeholder={t('Select sector')} options={BUSINESS_SECTORS.map((value) => ({ value, label: t(value) }))} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="stage" label={t('operations.participants.stage')}><Select allowClear options={stages.map((value) => ({ value, label: t(value) }))} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="province" label={t('common.province')}><Select showSearch options={provinces.map((value) => ({ value, label: value }))} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="beeLevel" label={t('common.beeLevel')}><Select allowClear placeholder={t('Select level')} options={BEE_LEVELS.map((value) => ({ value, label: t(value) }))} /></Form.Item></Col>
        </Row>
        {hasQuestions && <Space orientation="vertical" className="operations-onboarding-section" style={stepKey === 'questions' ? undefined : { display: 'none' }}>
          {config?.questions.map(questionField)}
        </Space>}
        {stepKey === 'documents' && <Space orientation="vertical" className="operations-onboarding-section">
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
        {stepKey === 'review' && <Space orientation="vertical" className="operations-onboarding-section">
          <Alert type="success" showIcon icon={<FileDoneOutlined />} message={isReception ? t('They get an email to set their password. Their application goes to operations as Pending.') : t('operations.participants.reviewHint')} />
          <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} items={[
            { key: 'name', label: t('common.name'), children: values.participantName },
            { key: 'email', label: t('common.email'), children: values.email },
            { key: 'enterprise', label: t('operations.participants.enterprise'), children: values.businessName },
            { key: 'phone', label: t('common.phone'), children: values.phone || '—' },
            { key: 'sector', label: t('common.sector'), children: values.sector ? t(values.sector) : '—' },
            { key: 'stage', label: t('operations.participants.stage'), children: values.stage ? t(values.stage) : '—' },
            { key: 'province', label: t('common.province'), children: values.province || '—' },
            { key: 'bee', label: t('common.beeLevel'), children: values.beeLevel ? t(values.beeLevel) : '—' },
            { key: 'program', label: t('operations.participants.programme'), children: config?.name },
            ...(hasQuestions ? [{ key: 'questions', label: t('operations.participants.questions'), children: Object.keys(values.onboardingAnswers || {}).length }] : []),
            ...(hasDocuments ? [{ key: 'documents', label: t('Compliance documents'), children: Object.keys(documents).length }] : []),
          ]} />
        </Space>}
        <div className="operations-onboarding-footer">
          <Button icon={<ArrowLeftOutlined />} onClick={() => step ? setStep((current) => current - 1) : navigate('/shared/participants')}>{step ? t('common.back') : t('common.cancel')}</Button>
          {step < lastStep ? <Button type="primary" onClick={() => void next()}>{t('common.continue')}</Button> : <Button type="primary" icon={<UserAddOutlined />} loading={saving} onClick={() => void save()}>{isReception ? t('Register walk-in') : t('operations.participants.create')}</Button>}
        </div>
      </Form>
    </Card>
  </DashboardPage>
}
