import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Button, Card, Form, Grid, Progress, Segmented, Space, Spin, Steps, Typography } from 'antd'
import {
    ArrowLeftOutlined,
    ArrowRightOutlined,
    AuditOutlined,
    BankOutlined,
    CheckCircleOutlined,
    EnvironmentOutlined,
    ExclamationCircleOutlined,
    FileProtectOutlined,
    FormOutlined,
    PhoneOutlined,
    RobotOutlined,
    SaveOutlined,
    ShopOutlined,
    UserOutlined,
} from '@ant-design/icons'
import DashboardPageShell from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage, tr, tEnglish } from '@/providers/LanguageProvider'
import { getApplicantProfileBundle, isApplicantProfileComplete, saveApplicantProfile } from '@/services/applicantService'
import { getNextProgramToApply } from '@/services/applicantJourneyService'
import ApplicantJourneySteps from '@/components/applicant/ApplicantJourneySteps'
import type { ApplicantProfile, ApplicantProfileBundle, ApplicantProfileInput, BusinessDirector } from '@/types/applicant'
import ApplicantProfileAIAssist from '@/components/applicant/ApplicantProfileAIAssist'
import ApplicantProfileManualForm from '@/components/applicant/ApplicantProfileManualForm'
import ApplicantProfileReviewStep from '@/components/applicant/ApplicantProfileReviewStep'
import BusinessProfileSections from '@/components/applicant/BusinessProfileSections'
import { BUSINESS_PROFILE_SECTIONS, hasProfileValue, type BusinessProfileSectionKey } from '@/components/applicant/businessProfileSectionsConfig'
import '@/styles/applicant/applicant-profile.css'
import '@/styles/applicant/business-profile.css'

const { Text } = Typography
const { useBreakpoint } = Grid

type ApplicantInputMode = 'manual' | 'ai'

export type ApplicantProfileFormValues = Partial<Omit<ApplicantProfile, 'id' | 'uid'>> & {
    fullName?: string
    participantName?: string
    email?: string
    gender?: string
    idNumber?: string
    phone?: string
    alternativePhone?: string
    maritalStatus?: string
    employmentStatus?: string
    educationLevel?: string
    disabilityStatus?: string
    businessName?: string
    sector?: string
    natureOfBusiness?: string
    beeLevel?: string
    youthOwnedPercent?: number
    femaleOwnedPercent?: number
    blackOwnedPercent?: number
    directors?: BusinessDirector[]
    registrationStatus?: string
    registrationNumber?: string
    dateOfRegistration?: unknown
    yearsOfTrading?: number
    businessAddress?: string
    city?: string
    postalCode?: string
    province?: string
    hostCommunity?: string
    locationType?: string
    aiRawDump?: string
}

const stepItems = [
    { get title() { return tr('Personal') }, icon: <UserOutlined /> },
    { get title() { return tr('Contact') }, icon: <PhoneOutlined /> },
    { get title() { return tr('Business') }, icon: <ShopOutlined /> },
    { get title() { return tr('Compliance') }, icon: <FileProtectOutlined /> },
    { get title() { return tr('Location') }, icon: <EnvironmentOutlined /> },
    { get title() { return tr('Review') }, icon: <CheckCircleOutlined /> },
]

const requiredProfileFields: Array<keyof ApplicantProfileFormValues> = [
    'participantName',
    'email',
    'phone',
    'gender',
    'businessName',
    'sector',
    'natureOfBusiness',
    'yearsOfTrading',
    'province',
    'city',
    'businessAddress',
]

function hasValue(value: unknown) {
    return value !== undefined && value !== null && String(value).trim() !== ''
}

function calculateCompletion(values: ApplicantProfileFormValues) {
    const completed = requiredProfileFields.filter((field) => hasValue(values[field])).length
    return Math.round((completed / requiredProfileFields.length) * 100)
}

function normalizeLoadedProfile(
    profile: ApplicantProfileBundle | null | undefined,
    user: { displayName?: string | null; email?: string | null }
): ApplicantProfileFormValues {
    const ownership = profile?.businessProfile.ownership as Record<string, unknown> | undefined
    const source = {
        ...(profile?.applicantProfile || {}),
        ...(profile?.businessProfile || {}),
        ...(ownership || {}),
    } as ApplicantProfileFormValues

    return {
        ...source,
        participantName: source.participantName || source.fullName || user.displayName || '',
        fullName: source.fullName || source.participantName || user.displayName || '',
        email: user.email || source.email || '',
        phone: source.phone,
        gender: source.gender,
        idNumber: source.idNumber,
        alternativePhone: source.alternativePhone,
        maritalStatus: source.maritalStatus,
        employmentStatus: source.employmentStatus,
        educationLevel: source.educationLevel,
        disabilityStatus: source.disabilityStatus,
        businessName: source.businessName,
        sector: source.sector,
        natureOfBusiness: source.natureOfBusiness,
        beeLevel: source.beeLevel,
        youthOwnedPercent: source.youthOwnedPercent,
        femaleOwnedPercent: source.femaleOwnedPercent,
        blackOwnedPercent: source.blackOwnedPercent,
        directors: Array.isArray(source.directors) ? source.directors : [],
        registrationStatus: source.registrationStatus,
        registrationNumber: source.registrationNumber,
        dateOfRegistration: source.dateOfRegistration,
        yearsOfTrading: source.yearsOfTrading,
        province: source.province,
        city: source.city,
        postalCode: source.postalCode,
        businessAddress: source.businessAddress,
        hostCommunity: source.hostCommunity,
        locationType: source.locationType,
    }
}

type ApplicantProfilePageProps = {
    /**
     * `incubatee` is the same business profile for an SME already accepted into a programme:
     * no application journey, no "before applying" wording, and saving stays on the page.
     */
    mode?: 'applicant' | 'incubatee'
}

export const ApplicantProfilePage = ({ mode = 'applicant' }: ApplicantProfilePageProps) => {
    const isIncubatee = mode === 'incubatee'
    const [form] = Form.useForm<ApplicantProfileFormValues>()
    const { message } = App.useApp()
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const screens = useBreakpoint()
    const isMobile = !screens.md

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [hasProfile, setHasProfile] = useState(false)
    const [activeMode, setActiveMode] = useState<ApplicantInputMode>('manual')
    const [activeStep, setActiveStep] = useState(0)
    const [aiRawDump, setAiRawDump] = useState('')
    const [missingFields, setMissingFields] = useState<string[]>([])
    const [formSnapshot, setFormSnapshot] = useState<ApplicantProfileFormValues>({})
    // Business profile (incubatee mode): one section open at a time, the AI sheet, and AI answers waiting to be saved.
    const [editingSection, setEditingSection] = useState<BusinessProfileSectionKey | null>(null)
    const [aiOpen, setAiOpen] = useState(false)
    const [aiPending, setAiPending] = useState(false)
    const [loadedValues, setLoadedValues] = useState<ApplicantProfileFormValues>({})

    const watchedValues = Form.useWatch([], form)
    const accountEmail = user?.email || ''

    const liveValues = useMemo(() => {
        return {
            ...formSnapshot,
            ...(watchedValues || {}),
            ...form.getFieldsValue(true),
            email: accountEmail,
        } as ApplicantProfileFormValues
    }, [accountEmail, form, formSnapshot, watchedValues])

    const completion = useMemo(() => calculateCompletion(liveValues), [liveValues])

    useEffect(() => {
        // The route guard only renders this page for a signed-in user, so `loading` simply waits for one.
        if (!user) return

        const loadProfile = async () => {
            try {
                setLoading(true)
                const profile = await getApplicantProfileBundle(user.uid, user.email)
                const values = normalizeLoadedProfile(profile, user)
                form.setFieldsValue(values)
                setFormSnapshot(values)
                setLoadedValues(values)
                setHasProfile(isApplicantProfileComplete(profile))
                setAiRawDump(values.aiRawDump || '')
            } catch (error) {
                console.error(error)
                message.error(isIncubatee ? t('Your business profile could not be loaded.') : t('applicant.profile.loadError', 'Failed to load applicant profile'))
            } finally {
                setLoading(false)
            }
        }

        void loadProfile()
    }, [form, isIncubatee, message, t, user])

    useRegisterAgentPageContext({
        pageKey: 'applicant-profile',
        pageName: isIncubatee ? 'Business profile' : tEnglish('applicant.profile.title', 'Applicant Profile'),
        purpose: tEnglish('applicant.profile.subtitle', 'Complete personal, business, compliance, and operating details for applications.'),
        currentFilters: { inputMode: activeMode, activeStep: stepItems[activeStep]?.title || 'Unknown' },
        metrics: {
            profileSaved: hasProfile,
            completion,
            missingRequiredFields: requiredProfileFields.filter((field) => !hasValue(liveValues[field])),
        },
        dataSummary: {
            applicant: liveValues.participantName || liveValues.fullName || 'Not captured',
            businessName: liveValues.businessName || 'Not captured',
            sector: liveValues.sector || 'Not captured',
            province: liveValues.province || 'Not captured',
            aiMissingFields: missingFields,
        },
        allowedActions: [
            {
                key: 'save_applicant_profile',
                label: t('Save applicant profile'),
                description: t('Save the applicant profile using the applicant service.'),
            },
        ],
        updatedAt: new Date().toISOString(),
    })

    const handleValuesChange = () => {
        setFormSnapshot(form.getFieldsValue(true))
    }

    const goToStep = (nextStep: number) => {
        setFormSnapshot(form.getFieldsValue(true))
        setActiveStep(Math.max(0, Math.min(stepItems.length - 1, nextStep)))
    }

    const handleApplyExtractedFields = (values: Partial<ApplicantProfileFormValues>, extractedMissingFields: string[]) => {
        form.setFieldsValue({ ...values, email: accountEmail })
        setTimeout(() => setFormSnapshot(form.getFieldsValue(true)), 0)
        setMissingFields(extractedMissingFields)
        // The assistant keeps asking follow-ups, so its sheet stays open; the sections behind it
        // show its answers, and nothing is stored until the SME saves them.
        if (isIncubatee) setAiPending(true)
    }

    const discardAiAnswers = () => {
        form.setFieldsValue(loadedValues)
        setFormSnapshot(loadedValues)
        setAiPending(false)
    }

    const openSection = (section: BusinessProfileSectionKey) => {
        setEditingSection(section)
        window.setTimeout(() => window.document.getElementById(`business-profile-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
    }

    const handleSave = async (): Promise<boolean> => {
        if (!user) {
            message.error(t('applicant.profile.signIn', 'You must be signed in to save your applicant profile'))
            return false
        }

        try {
            setSaving(true)
            await form.validateFields()

            // Read the form itself rather than the last render's values: the directors list writes
            // to the form and saves in the same moment.
            const current = { ...liveValues, ...form.getFieldsValue(true) } as ApplicantProfileFormValues
            const values = {
                ...current,
                email: accountEmail,
                participantName: current.participantName || current.fullName,
                fullName: current.fullName || current.participantName,
                aiRawDump,
            } as ApplicantProfileFormValues

            if (values.registrationStatus === 'not_registered') {
                values.registrationNumber = undefined
                values.dateOfRegistration = undefined
            }

            if (values.gender !== 'Male' && values.gender !== 'Female') {
                form.setFields([{ name: 'gender', errors: ['Gender must be Male or Female'] }])
                setActiveStep(0)
                if (isIncubatee) setEditingSection('personal')
                message.error(t('Gender must be Male or Female'))
                return false
            }

            await saveApplicantProfile(user.uid, user.email, values as ApplicantProfileInput)
            setHasProfile(true)
            setFormSnapshot(values)
            setLoadedValues(values)
            if (isIncubatee) {
                message.success(t('Business profile saved'))
                setAiPending(false)
                return true
            }

            message.success(
                completion >= 100
                    ? t('applicant.profile.completed', 'Applicant profile completed')
                    : t('applicant.profile.saveSuccess', 'Applicant profile saved')
            )

            // Details done: carry on into the application for the programme they came for, instead of a programmes list.
            if (completion >= 100) {
                const nextProgramId = await getNextProgramToApply(user.uid, user.email).catch(() => '')
                if (nextProgramId) navigate(`/applicant/programs/${nextProgramId}/apply`)
            }
            return true
        } catch (error) {
            // antd's validateFields rejects with the fields that failed; anything else is a save error.
            const errorFields = (error as { errorFields?: Array<{ name?: (string | number)[], errors?: string[] }> } | null)?.errorFields
            if (Array.isArray(errorFields)) {
                const first = errorFields[0]
                if (first?.name) form.scrollToField(first.name, { behavior: 'smooth', block: 'center' })
                message.error(first?.errors?.[0] || t('applicant.profile.requiredError', 'Please complete the required fields'))
                return false
            }

            console.error(error)
            message.error(isIncubatee ? t('Your business profile could not be saved.') : t('applicant.profile.saveError', 'Failed to save applicant profile'))
            return false
        } finally {
            setSaving(false)
        }
    }

    const mobileStepItems = stepItems.map((item, index) => ({
        label: item.icon,
        value: index,
    }))

    if (isIncubatee) {
        if (loading) return <PageSkeleton variant="detail" label={t('Loading your business profile')} />

        const missingRequired = requiredProfileFields.filter((field) => !hasProfileValue(liveValues[field]))
        const missingLabels = missingRequired
            .map((name) => BUSINESS_PROFILE_SECTIONS.flatMap((section) => section.fields).find((field) => field.name === name)?.label)
            .filter(Boolean)
            .map((label) => t(label as string))
        const firstMissingSection = BUSINESS_PROFILE_SECTIONS.find((section) => section.fields.some((field) => missingRequired.includes(field.name)))
        const place = [liveValues.city, liveValues.province].filter(Boolean).join(', ')
        // The few facts a programme team looks for first, as tags under the business name.
        const years = Number(liveValues.yearsOfTrading)
        const headerFacts = [
            liveValues.registrationStatus === 'registered' ? { key: 'registered', label: t('Registered'), positive: true } : null,
            liveValues.registrationStatus === 'not_registered' ? { key: 'not-registered', label: t('Not registered') } : null,
            hasProfileValue(liveValues.beeLevel) ? { key: 'bee', label: liveValues.beeLevel === 'Not sure' ? t('B-BBEE level not sure') : `B-BBEE ${liveValues.beeLevel}` } : null,
            years > 0 ? { key: 'years', label: years === 1 ? t('Trading 1 year') : t('Trading {count} years', undefined, { count: years }) } : null,
            hasProfileValue(liveValues.blackOwnedPercent) ? { key: 'black', label: t('{percent}% Black-owned', undefined, { percent: Number(liveValues.blackOwnedPercent) }) } : null,
        ].filter(Boolean) as { key: string, label: string, positive?: boolean }[]

        return (
            <DashboardPageShell className="business-profile-page">
                <section className="business-profile-header">
                    <Progress
                        type="circle"
                        percent={completion}
                        size={48}
                        strokeWidth={10}
                        strokeColor="#6d5dfb"
                        format={(percent) => <span className="business-profile-score">{percent}%</span>}
                    />
                    <div className="business-profile-header-text">
                        <Text strong className="business-profile-name">{liveValues.businessName || t('Business profile')}</Text>
                        <Text type="secondary">{[liveValues.sector, place].filter(Boolean).join(' · ') || t('Keep your personal and business details up to date. Your programme team uses them for your plan and reports.')}</Text>
                        {headerFacts.length > 0 && (
                            <div className="business-profile-facts">
                                {headerFacts.map((fact) => <span key={fact.key} className={`business-profile-fact${fact.positive ? ' is-positive' : ''}`}>{fact.label}</span>)}
                            </div>
                        )}
                    </div>
                    <Button icon={<RobotOutlined />} disabled={Boolean(editingSection)} onClick={() => setAiOpen(true)}>{t('Fill with AI')}</Button>
                </section>

                {aiPending ? (
                    <section className="business-profile-notice is-ai">
                        <RobotOutlined className="business-profile-notice-icon" aria-hidden="true" />
                        <div className="business-profile-notice-text">
                            <Text strong>{t('AI filled in some details')}</Text>
                            <Text type="secondary">{t('Check them below, then save. Nothing is stored until you do.')}</Text>
                        </div>
                        <div className="business-profile-notice-actions">
                            <Button onClick={discardAiAnswers} disabled={saving}>{t('Discard')}</Button>
                            <Button type="primary" loading={saving} onClick={() => void handleSave()}>{t('Save')}</Button>
                        </div>
                    </section>
                ) : missingRequired.length > 0 && firstMissingSection && !editingSection && (
                    <section className="business-profile-notice">
                        <ExclamationCircleOutlined className="business-profile-notice-icon" aria-hidden="true" />
                        <div className="business-profile-notice-text">
                            <Text strong>{missingRequired.length === 1 ? t('1 detail missing') : t('{count} details missing', undefined, { count: missingRequired.length })}</Text>
                            <Text type="secondary">{missingLabels.join(', ')}</Text>
                        </div>
                        <div className="business-profile-notice-actions">
                            <Button type="primary" onClick={() => openSection(firstMissingSection.key)}>{missingRequired.length === 1 ? t('Add it') : t('Add them')}</Button>
                        </div>
                    </section>
                )}

                <BusinessProfileSections
                    form={form}
                    values={liveValues}
                    email={accountEmail}
                    requiredFields={requiredProfileFields}
                    editing={editingSection}
                    onEdit={setEditingSection}
                    onValuesChange={handleValuesChange}
                    onSave={handleSave}
                    saving={saving}
                />

                <ResponsiveModal
                    open={aiOpen}
                    onClose={() => setAiOpen(false)}
                    title={t('Fill with AI')}
                    width={720}
                    destroyOnHidden={false}
                    footer={<Button onClick={() => setAiOpen(false)}>{t('Done')}</Button>}
                >
                    <ApplicantProfileAIAssist
                        rawDump={aiRawDump}
                        currentValues={liveValues}
                        missingFields={missingFields}
                        onRawDumpChange={setAiRawDump}
                        onApplyExtractedFields={handleApplyExtractedFields}
                    />
                </ResponsiveModal>
            </DashboardPageShell>
        )
    }

    if (loading) {
        return (
            <DashboardPageShell className="applicant-profile-page">
                <div className="applicant-profile-loading">
                    <Spin size="large" />
                    <Text type="secondary">{isIncubatee ? t('Loading your business profile') : t('applicant.profile.loading', 'Loading applicant profile...')}</Text>
                </div>
            </DashboardPageShell>
        )
    }

    return (
        <DashboardPageShell className="applicant-profile-page">
            <div className="applicant-profile-shell">
                {!isIncubatee && <ApplicantJourneySteps current={0} />}
                <Card className="applicant-profile-hero" bordered={false}>
                    <div className="applicant-profile-hero-main">
                        <div className="applicant-profile-hero-icon">
                            {activeMode === 'manual' ? <FormOutlined /> : <RobotOutlined />}
                        </div>
                        <div className="applicant-profile-hero-copy">
                            <Typography.Title level={3}>{isIncubatee ? t('Business profile') : t('applicant.profile.title', 'Applicant Profile')}</Typography.Title>
                            <Text type="secondary">
                                {isIncubatee
                                    ? t('Keep your personal and business details up to date. Your programme team uses them for your plan and reports.')
                                    : t('applicant.profile.subtitle', 'Complete your personal and business details before applying to a programme.')}
                            </Text>
                        </div>
                    </div>

                    <div className="applicant-profile-hero-actions">
                        <Segmented
                            value={activeMode}
                            block={isMobile}
                            onChange={(value) => setActiveMode(value as ApplicantInputMode)}
                            options={[
                                { label: t('Manual'), value: 'manual', icon: <FormOutlined /> },
                                { label: t('AI Assist'), value: 'ai', icon: <RobotOutlined /> },
                            ]}
                        />
                        <div className="applicant-profile-progress">
                            <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
                                <Text type="secondary">{t('Profile completion')}</Text>
                                <Text strong>{completion}%</Text>
                            </Space>
                            <Progress percent={completion} showInfo={false} size="small" status={completion >= 100 ? 'success' : 'active'} />
                        </div>
                    </div>
                </Card>

                <div className="applicant-profile-metrics">
                    <DashboardMetricCard
                        icon={<CheckCircleOutlined />}
                        label={t('applicant.profile.status', 'Status')}
                        value={hasProfile ? t('applicant.profile.saved', 'Saved') : t('applicant.profile.setup', 'Setup')}
                    />
                    <DashboardMetricCard
                        icon={<ShopOutlined />}
                        label={t('applicant.profile.business', 'Business')}
                        value={liveValues.businessName || t('applicant.profile.notAdded', 'Not added')}
                    />
                    <DashboardMetricCard
                        icon={<BankOutlined />}
                        label={t('applicant.profile.sector', 'Sector')}
                        value={liveValues.sector || t('applicant.profile.notAdded', 'Not added')}
                    />
                    <DashboardMetricCard
                        icon={<AuditOutlined />}
                        label={t('applicant.profile.missing', 'Missing')}
                        value={String(requiredProfileFields.filter((field) => !hasValue(liveValues[field])).length)}
                    />
                </div>

                <Card className="applicant-profile-card" bordered={false}>
                    {activeMode === 'ai' ? (
                        <ApplicantProfileAIAssist
                            rawDump={aiRawDump}
                            currentValues={liveValues}
                            missingFields={missingFields}
                            onRawDumpChange={setAiRawDump}
                            onApplyExtractedFields={handleApplyExtractedFields}
                        />
                    ) : (
                        <Form
                            form={form}
                            layout="vertical"
                            requiredMark
                            preserve
                            onValuesChange={handleValuesChange}
                            validateMessages={{
                                required: '${label} is required',
                                types: { email: 'Enter a valid email address' },
                            }}
                        >
                            <div className="applicant-profile-step-nav">
                                {isMobile ? (
                                    <Segmented block value={activeStep} onChange={(value) => goToStep(Number(value))} options={mobileStepItems} />
                                ) : (
                                    <Steps size="small" current={activeStep} onChange={goToStep} items={stepItems} />
                                )}
                            </div>

                            {activeStep < stepItems.length - 1 ? (
                                <ApplicantProfileManualForm activeStep={activeStep} email={accountEmail} />
                            ) : (
                                <ApplicantProfileReviewStep values={liveValues} />
                            )}

                            <div className="applicant-profile-actions">
                                <Button icon={<ArrowLeftOutlined />} disabled={activeStep === 0} onClick={() => goToStep(activeStep - 1)}>
                                    {t('Previous')}
                                </Button>

                                <Space className="applicant-profile-actions-right">
                                    {activeStep < stepItems.length - 1 ? (
                                        <Button type="primary" icon={<ArrowRightOutlined />} iconPosition="end" onClick={() => goToStep(activeStep + 1)}>
                                            {t('Next')}
                                        </Button>
                                    ) : null}

                                    <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
                                        {t('applicant.profile.save', 'Save profile')}
                                    </Button>
                                </Space>
                            </div>
                        </Form>
                    )}
                </Card>
            </div>
        </DashboardPageShell>
    )
}
