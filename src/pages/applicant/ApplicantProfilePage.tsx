import { useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Form, Grid, Progress, Segmented, Space, Spin, Steps, Typography } from 'antd'
import {
    ArrowLeftOutlined,
    ArrowRightOutlined,
    AuditOutlined,
    BankOutlined,
    CheckCircleOutlined,
    EnvironmentOutlined,
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
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage, tr, tEnglish } from '@/providers/LanguageProvider'
import { getApplicantProfileBundle, isApplicantProfileComplete, saveApplicantProfile } from '@/services/applicantService'
import type { ApplicantProfile, ApplicantProfileBundle, ApplicantProfileInput } from '@/types/applicant'
import ApplicantProfileAIAssist from '@/components/applicant/ApplicantProfileAIAssist'
import ApplicantProfileManualForm from '@/components/applicant/ApplicantProfileManualForm'
import ApplicantProfileReviewStep from '@/components/applicant/ApplicantProfileReviewStep'
import '@/styles/applicant/applicant-profile.css'

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

export const ApplicantProfilePage = () => {
    const [form] = Form.useForm<ApplicantProfileFormValues>()
    const { message } = App.useApp()
    const { t } = useLanguage()
    const { user } = useFullIdentity()
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
        if (!user) {
            setLoading(false)
            return
        }

        const loadProfile = async () => {
            try {
                setLoading(true)
                const profile = await getApplicantProfileBundle(user.uid, user.email)
                const values = normalizeLoadedProfile(profile, user)
                form.setFieldsValue(values)
                setFormSnapshot(values)
                setHasProfile(isApplicantProfileComplete(profile))
                setAiRawDump(values.aiRawDump || '')
            } catch (error) {
                console.error(error)
                message.error(t('applicant.profile.loadError', 'Failed to load applicant profile'))
            } finally {
                setLoading(false)
            }
        }

        void loadProfile()
    }, [form, message, t, user])

    useRegisterAgentPageContext({
        pageKey: 'applicant-profile',
        pageName: tEnglish('applicant.profile.title', 'Applicant Profile'),
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
    }

    const handleSave = async () => {
        if (!user) {
            message.error(t('applicant.profile.signIn', 'You must be signed in to save your applicant profile'))
            return
        }

        try {
            setSaving(true)
            await form.validateFields()

            const values = {
                ...liveValues,
                email: accountEmail,
                participantName: liveValues.participantName || liveValues.fullName,
                fullName: liveValues.fullName || liveValues.participantName,
                aiRawDump,
            } as ApplicantProfileFormValues

            if (values.registrationStatus === 'not_registered') {
                values.registrationNumber = undefined
                values.dateOfRegistration = undefined
            }

            if (values.gender !== 'Male' && values.gender !== 'Female') {
                form.setFields([{ name: 'gender', errors: ['Gender must be Male or Female'] }])
                setActiveStep(0)
                message.error(t('Gender must be Male or Female'))
                return
            }

            await saveApplicantProfile(user.uid, user.email, values as ApplicantProfileInput)
            setHasProfile(true)
            setFormSnapshot(values)
            message.success(
                completion >= 100
                    ? t('applicant.profile.completed', 'Applicant profile completed')
                    : t('applicant.profile.saveSuccess', 'Applicant profile saved')
            )
        } catch (error: any) {
            if (Array.isArray(error?.errorFields)) {
                const first = error.errorFields[0]
                if (first?.name) form.scrollToField(first.name, { behavior: 'smooth', block: 'center' })
                message.error(first?.errors?.[0] || t('applicant.profile.requiredError', 'Please complete the required fields'))
                return
            }

            console.error(error)
            message.error(t('applicant.profile.saveError', 'Failed to save applicant profile'))
        } finally {
            setSaving(false)
        }
    }

    const mobileStepItems = stepItems.map((item, index) => ({
        label: item.icon,
        value: index,
    }))

    if (loading) {
        return (
            <DashboardPageShell className="applicant-profile-page">
                <div className="applicant-profile-loading">
                    <Spin size="large" />
                    <Text type="secondary">{t('applicant.profile.loading', 'Loading applicant profile...')}</Text>
                </div>
            </DashboardPageShell>
        )
    }

    return (
        <DashboardPageShell className="applicant-profile-page">
            <div className="applicant-profile-shell">
                <Card className="applicant-profile-hero" bordered={false}>
                    <div className="applicant-profile-hero-main">
                        <div className="applicant-profile-hero-icon">
                            {activeMode === 'manual' ? <FormOutlined /> : <RobotOutlined />}
                        </div>
                        <div className="applicant-profile-hero-copy">
                            <Typography.Title level={3}>{t('applicant.profile.title', 'Applicant Profile')}</Typography.Title>
                            <Text type="secondary">
                                {t('applicant.profile.subtitle', 'Complete your personal and business details before applying to a programme.')}
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
