import { useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Descriptions, InputNumber, Radio, Select, Space, Steps, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import DashboardHeader from '@/components/shared/DashboardHeader'
import DashboardPage from '@/components/shared/DashboardPage'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listCompaniesForOnboarding, type WorkspaceCompany } from '@/services/companiesService'
import { getApplicantProfileBundle, isApplicantProfileComplete } from '@/services/applicantService'
import { completeSmeOnboarding, skipSmeOnboarding } from '@/services/smeOnboardingService'
import { listOpenPrograms, listProgramsForCompany, type OpenWorkspaceProgram, type WorkspaceProgram } from '@/services/workspaceProgramsService'
import type { SmeOnboardingPath } from '@/types/smeOnboarding'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const { Text, Paragraph } = Typography

type StepKey = 'start' | 'company' | 'program' | 'budget' | 'openProgram' | 'review'

const stepTitle: Record<StepKey, string> = {
  start: 'Company',
  company: 'Select company',
  program: 'Select program',
  budget: 'Budget & needs',
  openProgram: 'Select program',
  review: 'Review',
}

export default function SmeOnboardingPage() {
  const { t } = useLanguage()
  const { user } = useFullIdentity()
  const { message } = App.useApp()
  const navigate = useNavigate()

  const [hasCompany, setHasCompany] = useState<boolean>()
  const [companies, setCompanies] = useState<WorkspaceCompany[]>([])
  const [companiesLoading, setCompaniesLoading] = useState(true)
  const [companyCode, setCompanyCode] = useState<string>()

  const [companyPrograms, setCompanyPrograms] = useState<WorkspaceProgram[]>([])
  const [companyProgramsLoading, setCompanyProgramsLoading] = useState(true)

  const [consultingBudget, setConsultingBudget] = useState<number>()
  const [currency, setCurrency] = useState('USD')
  const [wantsSpecificProgram, setWantsSpecificProgram] = useState<boolean>()

  const [openPrograms, setOpenPrograms] = useState<OpenWorkspaceProgram[]>([])
  const [openProgramsLoading, setOpenProgramsLoading] = useState(true)

  const [selectedProgramId, setSelectedProgramId] = useState<string>()
  const [currentKey, setCurrentKey] = useState<StepKey>('start')
  const [submitting, setSubmitting] = useState(false)

  const stepKeys = useMemo<StepKey[]>(() => {
    if (hasCompany === true) return ['start', 'company', 'program', 'review']
    if (hasCompany === false) {
      return wantsSpecificProgram ? ['start', 'budget', 'openProgram', 'review'] : ['start', 'budget', 'review']
    }
    return ['start']
  }, [hasCompany, wantsSpecificProgram])

  useEffect(() => {
    listCompaniesForOnboarding()
      .then(setCompanies)
      .catch(() => message.error(t('Companies could not be loaded. You can still continue without one.')))
      .finally(() => setCompaniesLoading(false))
  }, [message, t])

  useEffect(() => {
    if (!companyCode) return
    listProgramsForCompany(companyCode)
      .then(setCompanyPrograms)
      .catch(() => message.error(t('Programmes for this company could not be loaded.')))
      .finally(() => setCompanyProgramsLoading(false))
  }, [companyCode, message, t])

  useEffect(() => {
    if (currentKey !== 'openProgram') return
    listOpenPrograms()
      .then(setOpenPrograms)
      .catch(() => message.error(t('Open programmes could not be loaded.')))
      .finally(() => setOpenProgramsLoading(false))
  }, [currentKey, message, t])

  const goTo = (key: StepKey) => setCurrentKey(key)

  const goNext = () => {
    const index = stepKeys.indexOf(currentKey)
    const next = stepKeys[index + 1]
    if (next) goTo(next)
  }

  const goBack = () => {
    const index = stepKeys.indexOf(currentKey)
    const previous = stepKeys[index - 1]
    if (previous) goTo(previous)
  }

  const selectedCompany = companies.find((company) => company.code === companyCode)
  const selectedProgram = [...companyPrograms, ...openPrograms].find((program) => program.id === selectedProgramId)

  const canProceed = () => {
    if (currentKey === 'start') return hasCompany !== undefined
    if (currentKey === 'company') return Boolean(companyCode)
    if (currentKey === 'budget') return wantsSpecificProgram !== undefined
    if (currentKey === 'openProgram') return Boolean(selectedProgramId)
    return true
  }

  const skip = async () => {
    if (!user) return
    try {
      await skipSmeOnboarding(user.uid, user.companyCode)
    } catch {
      // Non-blocking — the applicant profile page still works even if this write fails.
    }
    navigate('/applicant/profile')
  }

  const finish = async () => {
    if (!user) return
    setSubmitting(true)
    try {
      const path: SmeOnboardingPath = hasCompany ? 'company_program' : wantsSpecificProgram ? 'open_program' : 'marketplace'
      await completeSmeOnboarding(user.uid, {
        hasCompany: Boolean(hasCompany),
        companyCode: hasCompany ? companyCode : undefined,
        companyName: hasCompany ? selectedCompany?.name : undefined,
        selectedProgramId,
        consultingBudget,
        wantsSpecificProgram,
        path,
      })

      if (selectedProgramId) {
        const bundle = await getApplicantProfileBundle(user.uid, user.email)
        navigate(isApplicantProfileComplete(bundle) ? `/applicant/programs/${selectedProgramId}/apply` : '/applicant/profile')
      } else if (path === 'marketplace') {
        navigate('/applicant/marketplace')
      } else {
        navigate('/applicant/profile')
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('Your answers could not be saved.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!user) return <LoadingOverlay tip={t('Loading your account')} />

  return (
    <DashboardPage className="applicant-page">
      <DashboardHeader
        title={t('Let\'s set up your workspace')}
        subtitle={tr('A few quick questions so we can connect you with the right programme, consultants, or agents.')}
        actions={<Button type="link" onClick={() => void skip()}>{t('Skip for now')}</Button>}
      />
      <Card className="dashboard-section-card">
        <Steps
          size="small"
          current={stepKeys.indexOf(currentKey)}
          items={stepKeys.map((key) => ({ title: stepTitle[key] }))}
          style={{ marginBottom: 24 }}
        />

        {currentKey === 'start' && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Text strong>{t('Does your business already belong to a company using this platform?')}</Text>
            <Radio.Group
              value={hasCompany}
              onChange={(event) => { setHasCompany(event.target.value); setSelectedProgramId(undefined) }}
              optionType="button"
              buttonStyle="solid"
              options={[{ label: t('Yes, we already use this platform'), value: true }, { label: t('No, I\'m a general SME'), value: false }]}
            />
          </Space>
        )}

        {currentKey === 'company' && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Text strong>{t('Which company do you belong to?')}</Text>
            <Select
              showSearch
              loading={companiesLoading}
              placeholder={t('Search for your company')}
              style={{ width: '100%' }}
              value={companyCode}
              onChange={setCompanyCode}
              filterOption={(input, option) => (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())}
              options={companies.map((company) => ({ value: company.code, label: company.name }))}
            />
            <Button type="link" style={{ padding: 0 }} onClick={() => { setHasCompany(false); setCompanyCode(undefined); goTo('budget') }}>
              {t('My company isn\'t listed')}
            </Button>
          </Space>
        )}

        {currentKey === 'program' && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Text strong>{t('Which programme would you like to apply to at')} {selectedCompany?.name}?</Text>
            {!companyProgramsLoading && !companyPrograms.length && (
              <Paragraph type="secondary">{t('No programmes are currently open at this company. You can continue and pick one later from your dashboard.')}</Paragraph>
            )}
            <Select
              allowClear
              loading={companyProgramsLoading}
              placeholder={t('Select a programme (optional)')}
              style={{ width: '100%' }}
              value={selectedProgramId}
              onChange={setSelectedProgramId}
              options={companyPrograms.map((program) => ({ value: program.id, label: program.name }))}
            />
          </Space>
        )}

        {currentKey === 'budget' && (
          <Space direction="vertical" size={20} style={{ width: '100%' }}>
            <div>
              <Text strong>{t('What\'s your budget for consulting support?')}</Text>
              <Space.Compact style={{ width: '100%', marginTop: 8 }}>
                <Select value={currency} onChange={setCurrency} style={{ width: 100 }} options={['USD', 'ZAR', 'ZWL'].map((value) => ({ value, label: value }))} />
                <InputNumber min={0} value={consultingBudget} onChange={(value) => setConsultingBudget(Number(value) || undefined)} style={{ width: '100%' }} placeholder={t('e.g. 5000')} />
              </Space.Compact>
              <Paragraph type="secondary" style={{ marginTop: 6, marginBottom: 0 }}>
                {t('This helps us filter consultants and agents that fit what you can spend. You can update it anytime.')}
              </Paragraph>
            </div>
            <div>
              <Text strong>{t('Do you need a specific programme?')}</Text>
              <div style={{ marginTop: 8 }}>
                <Radio.Group
                  value={wantsSpecificProgram}
                  onChange={(event) => { setWantsSpecificProgram(event.target.value); setSelectedProgramId(undefined) }}
                  optionType="button"
                  buttonStyle="solid"
                  options={[{ label: t('Yes'), value: true }, { label: t('No, just show me consultants and agents'), value: false }]}
                />
              </div>
            </div>
          </Space>
        )}

        {currentKey === 'openProgram' && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Text strong>{t('These programmes are open to SMEs outside their own company')}</Text>
            {!openProgramsLoading && !openPrograms.length && (
              <Paragraph type="secondary">{t('No open programmes are available right now. Go back and choose "No" to browse consultants and agents instead.')}</Paragraph>
            )}
            <Select
              loading={openProgramsLoading}
              placeholder={t('Select an open programme')}
              style={{ width: '100%' }}
              value={selectedProgramId}
              onChange={setSelectedProgramId}
              options={openPrograms.map((program) => ({ value: program.id, label: `${program.name}${program.companyName ? ` — ${program.companyName}` : ''}` }))}
            />
          </Space>
        )}

        {currentKey === 'review' && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Text strong>{t('Review your answers')}</Text>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label={t('Company')}>{hasCompany ? selectedCompany?.name || companyCode : t('General SME (no company)')}</Descriptions.Item>
              {!hasCompany && <Descriptions.Item label={t('Budget')}>{consultingBudget ? `${currency} ${consultingBudget}` : t('Not specified')}</Descriptions.Item>}
              <Descriptions.Item label={t('Programme')}>{selectedProgram?.name || t('None selected yet')}</Descriptions.Item>
              {!hasCompany && !selectedProgramId && <Descriptions.Item label={t('Next step')}>{t('Browse consultants and agents')}</Descriptions.Item>}
            </Descriptions>
          </Space>
        )}

        <Space style={{ marginTop: 24 }}>
          {stepKeys.indexOf(currentKey) > 0 && <Button onClick={goBack}>{t('Back')}</Button>}
          {currentKey !== 'review'
            ? <Button type="primary" disabled={!canProceed()} onClick={goNext}>{t('Continue')}</Button>
            : <Button type="primary" loading={submitting} onClick={() => void finish()}>{t('Confirm')}</Button>}
        </Space>
      </Card>
    </DashboardPage>
  )
}
