import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { App, Button, Card, Form, Grid, Progress, Segmented, Typography } from 'antd'
import {
    ArrowLeftOutlined,
    ArrowRightOutlined,
    CheckCircleOutlined,
    EnvironmentOutlined,
    ExclamationCircleOutlined,
    FileProtectOutlined,
    PhoneOutlined,
    RobotOutlined,
    ShopOutlined,
    UserOutlined,
} from '@ant-design/icons'
import DashboardPageShell from '@/components/shared/DashboardPage'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage, tr, tEnglish } from '@/providers/LanguageProvider'
import { getApplicantProfileBundle, isApplicantProfileComplete, saveApplicantProfile } from '@/services/applicantService'
import { getNextProgramToApply, isDirectProgram } from '@/services/applicantJourneyService'
import type { ApplicantProfile, ApplicantProfileBundle, ApplicantProfileInput, BusinessDirector } from '@/types/applicant'
import ApplicantProfileAIAssist from '@/components/applicant/ApplicantProfileAIAssist'
import ApplicantProfileManualForm from '@/components/applicant/ApplicantProfileManualForm'
import ApplicantProfileReviewStep from '@/components/applicant/ApplicantProfileReviewStep'
import BusinessProfileSections from '@/components/applicant/BusinessProfileSections'
import { BUSINESS_PROFILE_SECTIONS, hasProfileValue, type BusinessProfileSectionKey } from '@/components/applicant/businessProfileSectionsConfig'
import { REQUIRED_PROFILE_FIELDS } from '@/utils/applicantProfileCompletion'
import '@/styles/applicant/applicant-profile.css'
import '@/styles/applicant/business-profile.css'

const { Text } = Typography
const { useBreakpoint } = Grid


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

/** What each setup step asks for, its required fields, and a line on why it matters. */
const stepGuide: Array<{ title: string, hint: string, required: Array<keyof ApplicantProfileFormValues> }> = [
    { title: 'About you', hint: 'Who the programme team will be working with.', required: ['participantName', 'email', 'gender'] },
    { title: 'Contact details', hint: 'How the programme team reaches you.', required: ['phone'] },
    { title: 'Your business', hint: 'What a programme team reads first.', required: ['businessName', 'sector', 'natureOfBusiness', 'yearsOfTrading'] },
    { title: 'Registration and compliance', hint: 'Optional, but many programmes ask for it.', required: [] },
    { title: 'Where you operate', hint: 'Some programmes are for specific provinces or communities.', required: ['province', 'city', 'businessAddress'] },
    { title: 'Check and save', hint: 'Look everything over before you save.', required: [] },
]

// Shared with the SME dashboard, so both say the same about what's missing.
const requiredProfileFields = REQUIRED_PROFILE_FIELDS as unknown as Array<keyof ApplicantProfileFormValues>

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
    const [nextProgramId, setNextProgramId] = useState('')
    // The next programme takes no application: the button joins it instead of continuing an application.
    const [nextProgramDirect, setNextProgramDirect] = useState(false)
    const { message } = App.useApp()
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    // Sent here from the SME dashboard because required details are missing (often an SME the programme team added).
    const [searchParams] = useSearchParams()
    const finishing = isIncubatee && searchParams.get('finish') === '1'
    const screens = useBreakpoint()
    const isMobile = !screens.md

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [hasProfile, setHasProfile] = useState(false)
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
    // A first-time applicant is guided through the steps; once their profile is complete (and for SMEs already in a
    // programme) it's shown as sections, each edited on its own.
    const sectionsView = isIncubatee || hasProfile

    // The programme an applicant came for, so a finished profile can lead straight into that application.
    useEffect(() => {
        if (isIncubatee || !user) return
        void getNextProgramToApply(user.uid).then(async (id) => {
            setNextProgramId(id || '')
            setNextProgramDirect(await isDirectProgram(id).catch(() => false))
        }).catch(() => undefined)
    }, [isIncubatee, user])

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
        currentFilters: { inputMode: aiOpen ? 'ai' : 'manual', activeStep: stepItems[activeStep]?.title || 'Unknown' },
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
        if (sectionsView) setAiPending(true)
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
                if (sectionsView) setEditingSection('personal')
                message.error(t('Gender must be Male or Female'))
                return false
            }

            await saveApplicantProfile(user.uid, user.email, values as ApplicantProfileInput)
            const wasSectionsView = sectionsView
            const complete = calculateCompletion(values) >= 100
            // Each setup step saves as it goes; the sections view takes over only once everything required is in.
            setHasProfile((current) => current || complete)
            setFormSnapshot(values)
            setLoadedValues(values)
            if (wasSectionsView) {
                message.success(isIncubatee ? t('Business profile saved') : t('Profile saved'))
                setAiPending(false)
                return true
            }

            message.success(complete ? t('applicant.profile.completed', 'Applicant profile completed') : t('Saved. Carry on when you’re ready.'))

            // Details done: carry on into the application for the programme they came for, instead of a programmes list.
            if (complete) {
                const programId = nextProgramId || await getNextProgramToApply(user.uid).catch(() => '')
                if (programId) navigate(`/applicant/programs/${programId}/apply`)
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

    if (loading) return <PageSkeleton variant="detail" label={isIncubatee ? t('Loading your business profile') : t('applicant.profile.loading', 'Loading applicant profile...')} />

    // The AI assistant, opened from either view. It fills the form; nothing is stored until the person saves.
    const aiSheet = (
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
    )

    if (sectionsView) {

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
                            <Text type="secondary">{finishing ? `${t('Your programme team needs these before supporting you:')} ${missingLabels.join(', ')}` : missingLabels.join(', ')}</Text>
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

                {/* An SME who came to finish their details: everything is in, back to the workspace. */}
                {finishing && missingRequired.length === 0 && !editingSection && !aiPending && (
                    <section className="business-profile-notice is-ready">
                        <CheckCircleOutlined className="business-profile-notice-icon" aria-hidden="true" />
                        <div className="business-profile-notice-text">
                            <Text strong>{t('All your details are in')}</Text>
                            <Text type="secondary">{t('Your programme team can now support you with them.')}</Text>
                        </div>
                        <div className="business-profile-notice-actions">
                            <Button type="primary" icon={<ArrowRightOutlined />} iconPlacement="end" onClick={() => navigate('/incubatee')}>{t('Go to my dashboard')}</Button>
                        </div>
                    </section>
                )}

                {/* An applicant with everything in: the way on to an application. */}
                {!isIncubatee && missingRequired.length === 0 && !editingSection && !aiPending && (
                    <section className="business-profile-notice is-ready">
                        <CheckCircleOutlined className="business-profile-notice-icon" aria-hidden="true" />
                        <div className="business-profile-notice-text">
                            <Text strong>{t('Your profile is ready')}</Text>
                            <Text type="secondary">{nextProgramId ? (nextProgramDirect ? t('That is all this programme needs. Join it now.') : t('Carry on with the application you started.')) : t('Programmes use it to check you qualify.')}</Text>
                        </div>
                        <div className="business-profile-notice-actions">
                            <Button type="primary" icon={<ArrowRightOutlined />} iconPlacement="end" onClick={() => navigate(nextProgramId ? `/applicant/programs/${nextProgramId}/apply` : '/applicant/programs')}>
                                {nextProgramId ? t(nextProgramDirect ? 'Join the programme' : 'Continue your application') : t('Browse programmes')}
                            </Button>
                        </div>
                    </section>
                )}

                {aiSheet}
            </DashboardPageShell>
        )
    }

    // First visit: guided setup. Each step saves as it goes; the list shows what's done and what's left.
    const lastStep = stepItems.length - 1
    const missingIn = (step: number) => stepGuide[step].required.filter((field) => !hasValue(liveValues[field])).length
    const saveAndContinue = async () => {
        const saved = await handleSave()
        if (saved && activeStep < lastStep) goToStep(activeStep + 1)
    }

    return (
        <DashboardPageShell className="business-profile-page applicant-setup-page">
            <section className="business-profile-header applicant-setup-header">
                <Progress
                    type="circle"
                    percent={completion}
                    size={48}
                    strokeWidth={10}
                    strokeColor="#6d5dfb"
                    format={(percent) => <span className="business-profile-score">{percent}%</span>}
                />
                <div className="business-profile-header-text">
                    <Text strong className="business-profile-name">{t('Set up your business profile')}</Text>
                    <Text type="secondary">{t('Programmes use it to check you qualify. It takes about 5 minutes, and you can stop and come back.')}</Text>
                </div>
            </section>

            <section className="business-profile-notice is-ai">
                <RobotOutlined className="business-profile-notice-icon" aria-hidden="true" />
                <div className="business-profile-notice-text">
                    <Text strong>{t('Short on time?')}</Text>
                    <Text type="secondary">{t('Describe your business in a few sentences, and AI fills in what it can for you to check.')}</Text>
                </div>
                <div className="business-profile-notice-actions">
                    <Button icon={<RobotOutlined />} onClick={() => setAiOpen(true)}>{t('Fill with AI')}</Button>
                </div>
            </section>

            <Card className="applicant-setup" bordered={false}>
                <div className="applicant-setup-layout">
                    {isMobile ? (
                        <Segmented block value={activeStep} onChange={(value) => goToStep(Number(value))} options={mobileStepItems} />
                    ) : (
                        <nav className="applicant-setup-steps" aria-label={t('Profile steps')}>
                            {stepItems.map((item, index) => {
                                const left = missingIn(index)
                                const done = index < lastStep && left === 0 && stepGuide[index].required.length > 0
                                return (
                                    <button
                                        key={item.title}
                                        type="button"
                                        className={`applicant-setup-step${index === activeStep ? ' is-current' : ''}${done ? ' is-done' : ''}`}
                                        aria-current={index === activeStep ? 'step' : undefined}
                                        onClick={() => goToStep(index)}
                                    >
                                        <span className="applicant-setup-step-icon">{done && index !== activeStep ? <CheckCircleOutlined /> : item.icon}</span>
                                        <span className="applicant-setup-step-label">{item.title}</span>
                                        {left > 0 && <span className="applicant-setup-step-left">{t('{count} left', undefined, { count: left })}</span>}
                                    </button>
                                )
                            })}
                        </nav>
                    )}

                    <Form
                        form={form}
                        layout="vertical"
                        requiredMark
                        preserve
                        onValuesChange={handleValuesChange}
                        className="applicant-setup-form"
                        validateMessages={{
                            required: '${label} is required',
                            types: { email: 'Enter a valid email address' },
                        }}
                    >
                        <div className="applicant-setup-step-head">
                            <Text strong className="applicant-setup-step-title">{t(stepGuide[activeStep].title)}</Text>
                            <Text type="secondary">{t(stepGuide[activeStep].hint)}</Text>
                        </div>

                        {activeStep < lastStep ? (
                            <ApplicantProfileManualForm activeStep={activeStep} email={accountEmail} />
                        ) : (
                            <ApplicantProfileReviewStep values={liveValues} />
                        )}

                        <div className="applicant-setup-footer">
                            <Button icon={<ArrowLeftOutlined />} disabled={activeStep === 0} onClick={() => goToStep(activeStep - 1)}>{t('Back')}</Button>
                            <Button type="primary" className="applicant-setup-save" loading={saving} onClick={() => void saveAndContinue()}>
                                {activeStep < lastStep
                                    ? t('Save and continue to {step}', undefined, { step: stepItems[activeStep + 1].title })
                                    : t('applicant.profile.save', 'Save profile')}
                            </Button>
                        </div>
                    </Form>
                </div>
            </Card>

            {aiSheet}
        </DashboardPageShell>
    )
}
