import { Alert, App, Button, Card, Form, Input, Select, Space, Steps, Typography } from 'antd'
import { ArrowLeftOutlined, SendOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { getApplicantProfileBundle, isApplicantProfileComplete, listApplicantPrograms, submitApplicantApplication } from '@/services/applicantService'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import type { ApplicantProgram } from '@/types/applicant'
import '@/styles/applicant.css'

type Question = { id: string, label?: string, question?: string, type?: string, options?: string[] | string, required?: boolean, maxSelections?: number }
type ApplicationForm = {
  motivation: string
  challenges?: string
  profile?: Record<string, string>
}

export const ApplicantApplicationPage = () => {
  const { message } = App.useApp()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { programId = '' } = useParams()
  const { user } = useFullIdentity()
  const [form] = Form.useForm<ApplicationForm>()
  const [program, setProgram] = useState<ApplicantProgram & { onboardingQuestions?: Question[], companyCode?: string }>()
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof getApplicantProfileBundle>>>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!user) return
    Promise.all([listApplicantPrograms(user), getApplicantProfileBundle(user.uid, user.email)])
      .then(([programs, profile]) => {
        setProgram(programs.find((item) => item.id === programId))
        setProfile(profile)
      })
      .catch(() => message.error(t('applicant.application.loadError')))
      .finally(() => setLoading(false))
  }, [form, message, programId, t, user])

  if (loading) return <LoadingOverlay tip={t('applicant.application.loading')} />
  if (!program || !user) return <DashboardPage><Alert type="warning" showIcon message={t('applicant.application.notFound')} /></DashboardPage>
  if (!isApplicantProfileComplete(profile)) return <DashboardPage><Alert type="warning" showIcon message={t('applicant.application.profileRequired')} action={<Button onClick={() => navigate('/applicant/profile')}>{t('applicant.application.completeProfile')}</Button>} /></DashboardPage>
  const questions = program.onboardingQuestions || []
  const submit = async () => {
    try {
      const values = await form.validateFields()
      if (!profile) return
      setSaving(true)
      await submitApplicantApplication(user.uid, user.email, {
        ...profile.applicantProfile,
        ...profile.businessProfile,
        ...values,
        businessName: profile.businessProfile.businessName,
        applicantProfileId: profile.applicantProfile.id || user.uid,
        businessProfileId: profile.businessProfile.id || user.uid,
        programId: program.id,
        programName: program.name,
        companyCode: program.companyCode,
      })
      message.success(t('applicant.application.submitted'))
      navigate('/applicant/application-tracker')
    } catch (error) {
      if (error instanceof Error) message.error(t('applicant.application.error'))
    } finally {
      setSaving(false)
    }
  }
  const questionField = (question: Question) => {
    const options = Array.isArray(question.options) ? question.options : String(question.options || '').split(',').map((value) => value.trim()).filter(Boolean)
    const label = question.label || question.question || 'Programme question'
    const maxSelections = Number(question.maxSelections || 0)
    const rules = [
      ...(question.required !== false ? [{ required: true, message: `Please answer: ${label}` }] : []),
      ...(question.type === 'multi_select' && maxSelections ? [{ validator: (_: unknown, value?: string[]) => !value || value.length <= maxSelections ? Promise.resolve() : Promise.reject(new Error(`Choose no more than ${maxSelections} answers.`)) }] : []),
    ]
    return <Form.Item key={question.id} name={['profile', question.id]} label={label} rules={rules}>
      {question.type === 'multi_select' ? <Select mode="multiple" maxCount={maxSelections || undefined} options={options.map((value) => ({ value, label: value }))} />
        : ['dropdown', 'single_select', 'select'].includes(question.type || '') ? <Select options={options.map((value) => ({ value, label: value }))} />
          : question.type === 'yes_no' ? <Select options={[{ value: 'yes', label: t('Yes') }, { value: 'no', label: t('No') }]} />
            : ['long_text', 'longText', 'textarea'].includes(question.type || '') ? <Input.TextArea rows={4} /> : <Input type={question.type === 'number' ? 'number' : 'text'} />}
    </Form.Item>
  }

  return <DashboardPage className="applicant-page">
    <Card className="applicant-card" title={program.name} extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/applicant/programs')}>{t('common.back')}</Button>}>
      <Steps current={step} responsive items={[{ title: t('applicant.application.motivation') }, { title: t('applicant.application.profile') }, { title: t('common.review') }]} />
      <Form form={form} layout="vertical" className="applicant-application-form">
        {step === 0 && <><Alert type="success" showIcon message={t('applicant.application.profileReused')} style={{ marginBottom: 14 }} /><Form.Item name="motivation" label={t('operations.applications.motivation')} rules={[{ required: true }]}><Input.TextArea rows={5} /></Form.Item><Form.Item name="challenges" label={t('operations.applications.challenges')}><Input.TextArea rows={4} /></Form.Item></>}
        {step === 1 && <Space orientation="vertical" className="applicant-full-width">{questions.length ? questions.map(questionField) : <Alert type="info" showIcon message={t('applicant.application.noQuestions')} />}</Space>}
        {step === 2 && <Card size="small"><Typography.Title level={5}>{t('applicant.application.ready')}</Typography.Title><Typography.Paragraph type="secondary">{t('applicant.application.reviewHint')}</Typography.Paragraph></Card>}
        <div className="applicant-form-footer">
          <Button disabled={step === 0} onClick={() => setStep((current) => current - 1)}>{t('common.back')}</Button>
          {step < 2 ? <Button type="primary" onClick={() => setStep((current) => current + 1)}>{t('common.continue')}</Button> : <Button type="primary" icon={<SendOutlined />} loading={saving} onClick={() => void submit()}>{t('applicant.application.submit')}</Button>}
        </div>
      </Form>
    </Card>
  </DashboardPage>
}
