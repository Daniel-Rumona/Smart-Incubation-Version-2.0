import { Alert, App, Button, Card, Col, Dropdown, Form, Grid, Input, Radio, Row, Select, Space, Typography, Upload } from 'antd'
import type { UploadProps } from 'antd'
import {
    ArrowLeftOutlined,
    ArrowRightOutlined,
    AimOutlined,
    BankOutlined,
    CheckCircleOutlined,
    ClearOutlined,
    EditOutlined,
    EnvironmentOutlined,
    FontSizeOutlined,
    GlobalOutlined,
    HighlightOutlined,
    InboxOutlined,
    LockOutlined,
    LaptopOutlined,
    MoonOutlined,
    RiseOutlined,
    SafetyCertificateOutlined,
    SaveOutlined,
    ShopOutlined,
    TeamOutlined,
    TrophyOutlined,
    SignatureOutlined,
    SolutionOutlined,
    UploadOutlined,
    SunOutlined,
} from '@ant-design/icons'
import { useEffect, useRef, useState } from 'react'
import SignatureCanvas from 'react-signature-canvas'
import html2canvas from 'html2canvas'
import { Navigate } from 'react-router-dom'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { useThemeMode } from '@/providers/ThemeProvider'
import { LANGUAGES, type LanguageCode } from '@/config/languages'
import {
    completeFirstLogin,
    saveOnboardingRole,
    saveOnboardingSignature,
    updateOnboardingPassword,
    type OnboardingRole,
} from '@/services/onboardingService'
import { getConsultantProfile, saveConsultantProfile } from '@/services/consultantMarketplaceService'
import type { ConsultantMarketplaceProfile } from '@/types/consultantMarketplace'
import { provincesForCountry } from '@/config/sadc'
import { getRoleHomePath } from '@/utils/roleRouting'
import '@/styles/welcome.css'

type PasswordValues = {
    password: string
    confirmPassword: string
}

type WelcomeStepKey =
    | 'intro'
    | 'role'
    | 'password'
    | 'consultantLocation'
    | 'consultantReach'
    | 'consultantExpertise'
    | 'consultantExperience'
    | 'consultantAbout'
    | 'consultantReview'
    | 'signature'
    | 'complete'
type SignatureMode = 'typed' | 'drawn' | 'upload'

type TypingMessageProps = {
    text: string
    speed?: number
    startDelay?: number
    onComplete?: () => void
}

const { Paragraph, Text, Title } = Typography

const fontOptions = ['Dancing Script', 'Great Vibes', 'Pacifico', 'Satisfy']
const supportedConsultantCountries = ['South Africa', 'Zimbabwe'] as const
const currencyForCountry = (country: string) => (country === 'South Africa' ? 'ZAR' : country === 'Zimbabwe' ? 'ZWL' : '')

const dataURLToBlob = async (dataUrl: string) => {
    const response = await fetch(dataUrl)
    return response.blob()
}

const waitForSignatureFont = async (font: string) => {
    if (!('fonts' in document)) return
    await document.fonts.load(`40px "${font}"`)
    await document.fonts.ready
}

const TypingMessage = ({ text, speed = 34, startDelay = 220, onComplete }: TypingMessageProps) => {
    const [visibleText, setVisibleText] = useState('')
    const onCompleteRef = useRef(onComplete)

    useEffect(() => {
        onCompleteRef.current = onComplete
    }, [onComplete])

    useEffect(() => {
        let index = 0
        let timeoutId: number | undefined
        let cancelled = false
        timeoutId = window.setTimeout(() => setVisibleText(''), 0)

        const typeNextCharacter = () => {
            if (cancelled) return
            index += 1
            setVisibleText(text.slice(0, index))
            if (index >= text.length) {
                timeoutId = window.setTimeout(() => onCompleteRef.current?.(), 1000)
                return
            }
            const lastCharacter = text[index - 1]
            const punctuationDelay = /[.!?]/.test(lastCharacter) ? speed * 6 : lastCharacter === ',' ? speed * 3 : speed
            timeoutId = window.setTimeout(typeNextCharacter, punctuationDelay)
        }

        timeoutId = window.setTimeout(typeNextCharacter, startDelay)
        return () => {
            cancelled = true
            if (timeoutId) window.clearTimeout(timeoutId)
        }
    }, [speed, startDelay, text])

    return <Paragraph className="welcome-guide-copy" aria-live="polite">{visibleText}{visibleText.length < text.length && <span className="welcome-typing-cursor" aria-hidden="true" />}</Paragraph>
}


export const WelcomePage = () => {
    const screens = Grid.useBreakpoint()
    const isMobile = !screens.md
    const { message } = App.useApp()
    const { t, language, setLanguage } = useLanguage()
    const { mode: themeMode, toggleTheme } = useThemeMode()
    const { user, loading } = useFullIdentity()
    const [passwordForm] = Form.useForm<PasswordValues>()

    const [activeStep, setActiveStep] = useState<WelcomeStepKey>('intro')
    const [history, setHistory] = useState<WelcomeStepKey[]>([])
    const [editingFromReview, setEditingFromReview] = useState(false)
    const [messageComplete, setMessageComplete] = useState(false)
    const [selectedRole, setSelectedRole] = useState<OnboardingRole>()
    const [savingRole, setSavingRole] = useState(false)
    const [passwordComplete, setPasswordComplete] = useState(false)
    const [signatureComplete, setSignatureComplete] = useState(false)
    const [signatureURL, setSignatureURL] = useState(user?.signatureURL || '')
    const [signatureMode, setSignatureMode] = useState<SignatureMode>('typed')
    const [typedName, setTypedName] = useState(user?.displayName || user?.name || '')
    const [typedFont, setTypedFont] = useState(fontOptions[0])
    const [savingPassword, setSavingPassword] = useState(false)
    const [savingSignature, setSavingSignature] = useState(false)
    const [finishing, setFinishing] = useState(false)
    const [consultantSetup, setConsultantSetup] = useState<
        Pick<ConsultantMarketplaceProfile, 'headline' | 'bio' | 'experienceYears' | 'specialties' | 'country' | 'province' | 'physicalAddress' | 'operatingLocation' | 'serviceRadiusKm' | 'currency'>
    >({
        headline: '', bio: '', experienceYears: 0, specialties: [],
        country: '',
        province: '',
        physicalAddress: '',
        operatingLocation: '',
        serviceRadiusKm: 25,
        currency: 'USD',
    })
    const [savingConsultantSetup, setSavingConsultantSetup] = useState(false)
    const styledSignatureRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<SignatureCanvas>(null)

    useEffect(() => {
        const timeoutId = window.setTimeout(() => setMessageComplete(false), 0)
        return () => window.clearTimeout(timeoutId)
    }, [activeStep])

    useEffect(() => {
        if (!user) return

        const timeout = window.setTimeout(() => {
            if (user.signatureURL) setSignatureURL(user.signatureURL)
            if (!typedName.trim()) setTypedName(user.displayName || user.name || '')

            if ((selectedRole ?? user.role) === 'consultant') {
                void getConsultantProfile(user.uid, { name: user.displayName, email: user.email })
                    .then((profile) =>
                        setConsultantSetup({
                            headline: profile.headline || '', bio: profile.bio || '', experienceYears: profile.experienceYears || 0,
                            specialties: profile.specialties || [],
                            country: profile.country,
                            province: profile.province,
                            physicalAddress: profile.physicalAddress || profile.operatingLocation,
                            operatingLocation: profile.operatingLocation,
                            serviceRadiusKm: profile.serviceRadiusKm,
                            currency: profile.currency,
                        }),
                    )
                    .catch(() => undefined)
            }
        }, 0)

        return () => window.clearTimeout(timeout)
    }, [selectedRole, typedName, user])

    if (loading) return <LoadingOverlay tip={t('welcome.loading')} />
    if (!user) return <Navigate to="/auth" replace />
    if (!user.emailVerified) return <Navigate to="/email-verification" replace />
    if (user.firstLoginComplete) {
        return <Navigate to={getRoleHomePath(user.role, user.isApplicant, user.smeOnboardingComplete)} replace />
    }

    const effectiveRole = selectedRole ?? user.role
    const firstName = (user.displayName || user.name || '').trim().split(/\s+/)[0]
    const hasSignature = Boolean(signatureComplete || user.signatureURL || signatureURL)
    const languageItems = Object.entries(LANGUAGES).map(([value, label]) => ({
        key: value,
        label,
        onClick: () => setLanguage(value as LanguageCode),
    }))

    const goTo = (nextStep: WelcomeStepKey) => {
        setHistory((currentHistory) => [...currentHistory, activeStep])
        setActiveStep(nextStep)
    }

    const back = () => {
        setHistory((currentHistory) => {
            const nextHistory = [...currentHistory]
            const previousStep = nextHistory.pop()
            if (previousStep) setActiveStep(previousStep)
            return nextHistory
        })
    }

    const resolveStepAfterRole = (role: OnboardingRole) => {
        if (user.mustChangePassword === true && !passwordComplete) return 'password' as const
        if (role === 'consultant') return 'consultantLocation' as const
        if (!hasSignature) return 'signature' as const
        return 'complete' as const
    }

    const resolveStepAfterPassword = () => {
        if (effectiveRole === 'consultant') return 'consultantLocation' as const
        if (!hasSignature) return 'signature' as const
        return 'complete' as const
    }

    const conversationText: Record<WelcomeStepKey, string> = {
        intro: `Hi${firstName ? ` ${firstName}` : ''}, I’m Thuso. Welcome to Smart Incubation. I’ll guide you through setting up your workspace one thing at a time. Nothing complicated. Ready to get started?`,
        role: 'Great. First, tell me what best describes how you’ll use Smart Incubation so I can set the right workspace up for you.',
        password:
            'Perfect. Now that we’ve got that out of the way, let’s secure your account. Create a password that only you know, then we’ll move on.',
        signature:
            'Good, that part is done. Next, let’s add your signature. You can type it, draw it, or upload one, and we’ll use it when you acknowledge plans and documents.',
        consultantLocation: editingFromReview ? 'Let’s revisit your location details. Update anything that needs changing, then save this section.' : 'Let’s make your profile useful from day one. Where are you based, and what area should clients recognise as your home base?',
        consultantReach: editingFromReview ? 'You’re editing your reach settings. Adjust the travel radius or currency, then update this section.' : 'Great. How far are you comfortable travelling for in-person work, and which currency should we use for your daily rate?',
        consultantExpertise: editingFromReview ? 'Let’s refine your expertise. Add or remove the areas that best represent your work, then update this section.' : 'What kind of help do you enjoy giving most? Pick every area that reflects your experience.',
        consultantExperience: editingFromReview ? 'Updating your experience? Choose the range that best reflects your professional journey.' : 'That’s a strong foundation. How many years have you spent building this expertise?',
        consultantAbout: editingFromReview ? 'You can polish your headline or introduction here, then update your profile.' : 'One last profile detail: give clients a short headline and a little context about how you help businesses.',
        consultantReview: editingFromReview ? 'Your update is reflected below. Review the details once more, then continue when everything looks right.' : 'Here’s a quick look at your consultant profile. Check the details, then we’ll finish your setup.',
        complete:
            'That’s everything I needed. Your setup is complete and your workspace is ready. Let’s take you in.',
    }

    const saveRole = async () => {
        if (!selectedRole) return

        try {
            setSavingRole(true)
            await saveOnboardingRole(selectedRole, { name: user.displayName, email: user.email })
            goTo(resolveStepAfterRole(selectedRole))
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('Your role could not be saved.'))
        } finally {
            setSavingRole(false)
        }
    }

    const savePassword = async (values: PasswordValues) => {
        try {
            setSavingPassword(true)
            await updateOnboardingPassword(values.password)
            setPasswordComplete(true)
            message.success(t('welcome.password.success'))
            goTo(resolveStepAfterPassword())
        } catch (error) {
            const detail =
                error instanceof Error && error.message.includes('requires-recent-login')
                    ? t('welcome.password.relogin', 'Please sign in again, then update your password.')
                    : error instanceof Error
                        ? error.message
                        : t('welcome.password.error')
            message.error(detail)
        } finally {
            setSavingPassword(false)
        }
    }

    const persistSignature = async (signature: Blob, filename: string, successMessage: string) => {
        try {
            setSavingSignature(true)
            const url = await saveOnboardingSignature(signature, filename)
            setSignatureURL(url)
            setSignatureComplete(true)
            message.success(successMessage)
            goTo('complete')
        } catch (error) {
            message.error(
                error instanceof Error
                    ? error.message
                    : t('welcome.signature.error', 'Your signature could not be saved.'),
            )
        } finally {
            setSavingSignature(false)
        }
    }

    const saveTypedSignature = async () => {
        if (!typedName.trim()) {
            message.error(t('welcome.signature.typedRequired', 'Please enter your full name.'))
            return
        }

        if (!styledSignatureRef.current) {
            message.error(t('welcome.signature.previewMissing', 'Signature preview is not ready.'))
            return
        }

        await waitForSignatureFont(typedFont)
        const canvas = await html2canvas(styledSignatureRef.current, { backgroundColor: '#ffffff' })
        const blob = await dataURLToBlob(canvas.toDataURL('image/png'))
        await persistSignature(blob, 'typed.png', t('welcome.signature.typedSuccess', 'Typed signature saved.'))
    }

    const saveDrawnSignature = async () => {
        const canvas = canvasRef.current

        if (!canvas || canvas.isEmpty()) {
            message.warning(t('welcome.signature.drawRequired', 'Please draw your signature first.'))
            return
        }

        const blob = await dataURLToBlob(canvas.toDataURL('image/png'))
        await persistSignature(blob, 'drawn.png', t('welcome.signature.drawSuccess', 'Drawn signature saved.'))
    }

    const clearDrawnSignature = () => canvasRef.current?.clear()

    const saveConsultantSetupDetails = async () => {
        try {
            setSavingConsultantSetup(true)
            const currentProfile = await getConsultantProfile(user.uid, {
                name: user.displayName,
                email: user.email,
            })

            await saveConsultantProfile({
                ...currentProfile,
                ...consultantSetup,
                operatingLocation: consultantSetup.physicalAddress,
            })

            goTo('consultantReview')
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('Your operating area could not be saved.'))
        } finally {
            setSavingConsultantSetup(false)
        }
    }

    const continueConsultant = (next: WelcomeStepKey) => goTo(next)
    const beginReviewEdit = (step: WelcomeStepKey) => {
        setEditingFromReview(true)
        goTo(step)
    }

    const uploadProps: UploadProps = {
        multiple: false,
        accept: '.png,.jpg,.jpeg,.gif,.webp',
        showUploadList: false,
        customRequest: async ({ file, onError, onSuccess }) => {
            try {
                const uploadedFile = file as File
                await persistSignature(
                    uploadedFile,
                    uploadedFile.name,
                    t('welcome.signature.uploadSuccess', 'Signature image uploaded.'),
                )
                onSuccess?.('ok')
            } catch (error) {
                onError?.(
                    error instanceof Error
                        ? error
                        : new Error(t('welcome.signature.error', 'Your signature could not be saved.')),
                )
            }
        },
    }

    const finish = async () => {
        try {
            setFinishing(true)
            await completeFirstLogin()
            const destination = getRoleHomePath(
                effectiveRole,
                effectiveRole === 'incubatee',
                effectiveRole === 'incubatee' ? false : user.smeOnboardingComplete,
            )
            window.location.assign(destination)
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('welcome.finish.error'))
        } finally {
            setFinishing(false)
        }
    }

    return (
        <main className={`welcome-page welcome-step-${activeStep} welcome-mode-${signatureMode}`}>
            <div className="welcome-floating-actions">
                <Dropdown trigger={['click']} placement="bottomRight" menu={{ items: languageItems, selectable: true, selectedKeys: [language] }}>
                    <Button aria-label={t('Change language')} title={LANGUAGES[language]} className="welcome-floating-btn" icon={<GlobalOutlined />}><span className="welcome-control-label">{LANGUAGES[language]}</span></Button>
                </Dropdown>
                <Button className="welcome-floating-btn" onClick={toggleTheme} icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}>
                    <span className="welcome-control-label">{themeMode === 'dark' ? t('common.lightMode', 'Light') : t('common.darkMode', 'Dark')}</span>
                </Button>
            </div>
            <Card className="welcome-shell" bordered={false}>
                <section key={activeStep} className="welcome-conversation-stage">
                    <div className={`welcome-guide-message${activeStep === 'intro' ? ' is-intro' : ''}`}>
                        <Text className="welcome-guide-label">{t('THUSO · YOUR SETUP GUIDE')}</Text>
                        <TypingMessage text={conversationText[activeStep]} onComplete={() => setMessageComplete(true)} />
                    </div>

                    {activeStep === 'intro' && messageComplete && (
                        <div className="welcome-reveal welcome-intro-action">
                            <Button type="primary" size="large" icon={<ArrowRightOutlined />} onClick={() => goTo('role')}>
                                {t('Let’s get started')}
                            </Button>
                        </div>
                    )}

                    {activeStep === 'role' && messageComplete && (
                        <div className="welcome-panel welcome-role-panel welcome-reveal">
                            <div className="welcome-role-grid" role="radiogroup" aria-label={t('What best describes you?')}>
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={selectedRole === 'incubatee'}
                                    className={`welcome-role-card${selectedRole === 'incubatee' ? ' is-selected' : ''}`}
                                    onClick={() => setSelectedRole('incubatee')}
                                >
                                    <span className="welcome-role-icon is-sme">
                                        <ShopOutlined />
                                    </span>
                                    <span className="welcome-role-copy">
                                        <strong>{t('SME')}</strong>
                                        <small>
                                            {t('I run or represent a business and want support, programmes, tools, or expert guidance.')}
                                        </small>
                                    </span>
                                    <CheckCircleOutlined className="welcome-role-check" />
                                </button>

                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={selectedRole === 'consultant'}
                                    className={`welcome-role-card${selectedRole === 'consultant' ? ' is-selected' : ''}`}
                                    onClick={() => setSelectedRole('consultant')}
                                >
                                    <span className="welcome-role-icon is-consultant">
                                        <SolutionOutlined />
                                    </span>
                                    <span className="welcome-role-copy">
                                        <strong>{t('Consultant')}</strong>
                                        <small>
                                            {t('I offer professional expertise and want to support SMEs through services and interventions.')}
                                        </small>
                                    </span>
                                    <CheckCircleOutlined className="welcome-role-check" />
                                </button>
                            </div>

                            <div className="welcome-actions-row"><Button size="large" icon={<ArrowLeftOutlined />} onClick={back}>{t('Back')}</Button><Button type="primary" size="large" icon={<ArrowRightOutlined />} loading={savingRole} disabled={!selectedRole} onClick={() => void saveRole()}>{selectedRole === 'incubatee' ? t('Continue as SME') : selectedRole === 'consultant' ? t('Continue as consultant') : t('Choose how you’ll use Smart Incubation')}</Button></div>
                        </div>
                    )}

                    {activeStep === 'password' && messageComplete && (
                        <div className="welcome-panel welcome-reveal">
                            <div className="welcome-section-heading">
                                <span className="welcome-panel-icon">
                                    <LockOutlined />
                                </span>
                                <div>
                                    <Title level={4}>{t('welcome.password.title')}</Title>
                                    <Paragraph>{t('welcome.password.body')}</Paragraph>
                                </div>
                            </div>

                            <Form
                                form={passwordForm}
                                layout="vertical"
                                requiredMark={false}
                                className="welcome-password-form"
                                onFinish={savePassword}
                            >
                                <Form.Item
                                    name="password"
                                    label={t('welcome.password.new')}
                                    rules={[
                                        { required: true },
                                        { min: 8 },
                                        {
                                            pattern: /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/,
                                            message: t('welcome.password.rule'),
                                        },
                                    ]}
                                >
                                    <Input.Password autoComplete="new-password" size="large" />
                                </Form.Item>

                                <Form.Item
                                    name="confirmPassword"
                                    label={t('welcome.password.confirm')}
                                    dependencies={['password']}
                                    rules={[
                                        { required: true },
                                        ({ getFieldValue }) => ({
                                            validator(_, value) {
                                                return !value || getFieldValue('password') === value
                                                    ? Promise.resolve()
                                                    : Promise.reject(new Error(t('auth.passwordMismatch')))
                                            },
                                        }),
                                    ]}
                                >
                                    <Input.Password autoComplete="new-password" size="large" />
                                </Form.Item>

                                <Button type="primary" htmlType="submit" size="large" block loading={savingPassword}>
                                    {passwordComplete ? t('welcome.password.saved') : t('welcome.password.save')}
                                </Button>
                            </Form>
                        </div>
                    )}

                    {activeStep === 'signature' && messageComplete && (
                        <div className="welcome-panel welcome-signature-panel welcome-reveal">
                            <div className="welcome-section-heading">
                                <span className="welcome-panel-icon">
                                    <SignatureOutlined />
                                </span>
                                <div>
                                    <Title level={4}>{t('welcome.signature.title', 'Add your signature')}</Title>
                                    <Paragraph>
                                        {t(
                                            'welcome.signature.body',
                                            'Choose the method that feels easiest. You can replace the signature later from your profile.',
                                        )}
                                    </Paragraph>
                                </div>
                            </div>

                            <div className="welcome-signature-builder">
                                <Space direction="vertical" size={14} className="welcome-signature-stack">
                                    <Space size={8}>
                                        <EditOutlined />
                                        <Text strong>{t('welcome.signature.modeTitle', 'Choose how to create your signature')}</Text>
                                    </Space>

                                    <Radio.Group
                                        value={signatureMode}
                                        onChange={(event) => setSignatureMode(event.target.value)}
                                        className="welcome-signature-modes"
                                    >
                                        <Row gutter={[12, 12]}>
                                            <Col xs={24} md={8}>
                                                <Radio.Button value="typed">{t('welcome.signature.modeTyped', 'Type')}</Radio.Button>
                                            </Col>
                                            <Col xs={24} md={8}>
                                                <Radio.Button value="drawn">{t('welcome.signature.modeDrawn', 'Draw')}</Radio.Button>
                                            </Col>
                                            <Col xs={24} md={8}>
                                                <Radio.Button value="upload">{t('welcome.signature.modeUpload', 'Upload')}</Radio.Button>
                                            </Col>
                                        </Row>
                                    </Radio.Group>

                                    {signatureMode === 'typed' && (
                                        <div className="welcome-signature-section">
                                            <Space direction="vertical" size={12} className="welcome-signature-stack">
                                                <Space size={8}>
                                                    <FontSizeOutlined />
                                                    <Text strong>{t('welcome.signature.typedTitle', 'Typed signature')}</Text>
                                                </Space>

                                                <Row gutter={[12, 12]} className="welcome-signature-stack">
                                                    <Col xs={24} md={12}>
                                                        <Input
                                                            size="large"
                                                            placeholder={t('welcome.signature.fullName', 'Your full name')}
                                                            value={typedName}
                                                            onChange={(event) => setTypedName(event.target.value)}
                                                        />
                                                    </Col>
                                                    <Col xs={24} md={12}>
                                                        <Select
                                                            size="large"
                                                            value={typedFont}
                                                            onChange={setTypedFont}
                                                            options={fontOptions.map((font) => ({
                                                                label: <span style={{ fontFamily: `"${font}", cursive` }}>{font}</span>,
                                                                value: font,
                                                            }))}
                                                            className="welcome-signature-font"
                                                        />
                                                    </Col>
                                                </Row>

                                                <div
                                                    ref={styledSignatureRef}
                                                    className="welcome-signature-preview"
                                                    style={{ fontFamily: `"${typedFont}", cursive` }}
                                                >
                                                    {typedName || t('welcome.signature.preview', 'Your styled signature')}
                                                </div>

                                                <div className="welcome-actions-row"><Button size="large" icon={<ArrowLeftOutlined />} onClick={back}>{t('Back')}</Button><Button type="primary" size="large" icon={<SaveOutlined />} loading={savingSignature} disabled={!typedName.trim()} onClick={() => void saveTypedSignature()}>{t('welcome.signature.saveTyped', 'Save typed signature')}</Button></div>
                                            </Space>
                                        </div>
                                    )}

                                    {signatureMode === 'drawn' && (
                                        <div className="welcome-signature-section">
                                            <Space direction="vertical" size={12} className="welcome-signature-stack">
                                                <Space size={8}>
                                                    <HighlightOutlined />
                                                    <Text strong>{t('welcome.signature.drawnTitle', 'Drawn signature')}</Text>
                                                </Space>

                                                <Text type="secondary">
                                                    {t(
                                                        'welcome.signature.drawnBody',
                                                        'Sign inside the box below. Use clear strokes so the saved result looks professional.',
                                                    )}
                                                </Text>

                                                <div className="welcome-signature-canvas">
                                                    <SignatureCanvas
                                                        ref={canvasRef}
                                                        penColor="black"
                                                        canvasProps={{
                                                            width: isMobile ? Math.min(520, window.innerWidth - 64) : 520,
                                                            height: 180,
                                                        }}
                                                    />
                                                </div>

                                                <Row gutter={[12, 12]} className="welcome-signature-stack">
                                                    <Col xs={24} md={12}>
                                                        <Button size="large" block icon={<ClearOutlined />} onClick={clearDrawnSignature}>
                                                            {t('common.clear', 'Clear')}
                                                        </Button>
                                                    </Col>
                                                    <Col xs={24} md={12}>
                                                        <Button
                                                            type="primary"
                                                            size="large"
                                                            block
                                                            icon={<SaveOutlined />}
                                                            loading={savingSignature}
                                                            onClick={() => void saveDrawnSignature()}
                                                        >
                                                            {t('welcome.signature.saveDrawn', 'Save drawn signature')}
                                                        </Button>
                                                    </Col>
                                                </Row>
                                            </Space>
                                        </div>
                                    )}

                                    {signatureMode === 'upload' && (
                                        <div className="welcome-signature-section">
                                            <Space direction="vertical" size={12} className="welcome-signature-stack">
                                                <Alert
                                                    type="info"
                                                    showIcon
                                                    icon={<UploadOutlined />}
                                                    message={t('welcome.signature.uploadTitle', 'Upload a signature image')}
                                                    description={t(
                                                        'welcome.signature.uploadBody',
                                                        'Use a clear PNG or JPG image of your signature for the best result.',
                                                    )}
                                                />

                                                <Upload.Dragger {...uploadProps} className="welcome-signature-dragger">
                                                    <p className="ant-upload-drag-icon">
                                                        <InboxOutlined />
                                                    </p>
                                                    <p className="ant-upload-text">
                                                        {t('welcome.signature.choose', 'Click or drag a signature image here to upload')}
                                                    </p>
                                                    <p className="ant-upload-hint">
                                                        {t(
                                                            'welcome.signature.uploadHint',
                                                            'The image will be stored securely and used on approvals and platform confirmations.',
                                                        )}
                                                    </p>
                                                </Upload.Dragger>
                                            </Space>
                                        </div>
                                    )}

                                    {signatureURL && (
                                        <div className="welcome-signature-current">
                                            <Text strong>{t('welcome.signature.current', 'Current signature preview')}</Text>
                                            <img src={signatureURL} alt={t('welcome.signature.alt', 'Your signature')} />
                                        </div>
                                    )}
                                </Space>
                            </div>
                        </div>
                    )}

                    {activeStep === 'consultantLocation' && messageComplete && (
                        <div className="welcome-panel welcome-consultant-panel welcome-reveal">
                            <div className="welcome-section-heading">
                                <span className="welcome-panel-icon">
                                    <EnvironmentOutlined />
                                </span>
                                <div>
                                    <Title level={4}>{t('Where are you based?')}</Title>
                                    <Paragraph>
                                        {t(
                                            'welcome.consultantSetup.body',
                                            'This helps Smart Incubation match in-person interventions to consultants within a practical travel distance.',
                                        )}
                                    </Paragraph>
                                </div>
                            </div>

                            <Form layout="vertical" requiredMark={false} className="welcome-consultant-form">
                                <Row gutter={[12, 12]}>
                                    <Col xs={24} md={12}>
                                        <Form.Item label={t('welcome.consultantSetup.country', 'Country')} required>
                                            <Select
                                                size="large"
                                                value={consultantSetup.country || undefined}
                                                placeholder={t('welcome.consultantSetup.countryPlaceholder', 'Select a SADC country')}
                                                options={supportedConsultantCountries.map((value) => ({ value, label: value }))}
                                                onChange={(country) =>
                                                    setConsultantSetup((current) => ({
                                                        ...current,
                                                        country,
                                                        province: '',
                                                        currency: currencyForCountry(country),
                                                    }))
                                                }
                                            />
                                        </Form.Item>
                                    </Col>

                                    <Col xs={24} md={12}>
                                        <Form.Item label={t('welcome.consultantSetup.province', 'Province / region')} required>
                                            <Select
                                                size="large"
                                                value={consultantSetup.province || undefined}
                                                placeholder={t(
                                                    'welcome.consultantSetup.provincePlaceholder',
                                                    'Select a province or region',
                                                )}
                                                disabled={!consultantSetup.country}
                                                options={provincesForCountry(consultantSetup.country).map((value) => ({
                                                    value,
                                                    label: value,
                                                }))}
                                                onChange={(province) => setConsultantSetup((current) => ({ ...current, province }))}
                                            />
                                        </Form.Item>
                                    </Col>

                                    <Col xs={24}>
                                        <Form.Item label={t('welcome.consultantSetup.address', 'Physical address')} required>
                                            <Input
                                                size="large"
                                                value={consultantSetup.physicalAddress}
                                                placeholder={t(
                                                    'welcome.consultantSetup.addressPlaceholder',
                                                    'Street, suburb, town/city',
                                                )}
                                                onChange={(event) =>
                                                    setConsultantSetup((current) => ({
                                                        ...current,
                                                        physicalAddress: event.target.value,
                                                        operatingLocation: event.target.value,
                                                    }))
                                                }
                                            />
                                        </Form.Item>
                                    </Col>
                                </Row>

                                <div className="welcome-actions-row">{!editingFromReview && <Button size="large" icon={<ArrowLeftOutlined />} onClick={back}>{t('Back')}</Button>}<Button type="primary" size="large" icon={<ArrowRightOutlined />} loading={savingConsultantSetup} disabled={!consultantSetup.country || !consultantSetup.province || !consultantSetup.physicalAddress.trim()} onClick={() => continueConsultant(editingFromReview ? 'consultantReview' : 'consultantReach')}>{editingFromReview ? t('Update') : t('Continue')}</Button></div>
                            </Form>
                        </div>
                    )}

                    {activeStep === 'consultantReach' && messageComplete && (
                        <div className="welcome-panel welcome-reveal">
                            <div className="welcome-section-heading"><span className="welcome-panel-icon"><AimOutlined /></span><div><Title level={4}>{t('How far do you travel?')}</Title><Paragraph>{t('Choose the radius that feels realistic for in-person work.')}</Paragraph></div></div>
                            <div className="welcome-choice-grid" role="radiogroup" aria-label={t('Service radius')}>
                                {[10, 25, 50, 100, 250].map((radius) => <button type="button" role="radio" aria-checked={consultantSetup.serviceRadiusKm === radius} key={radius} className={`welcome-choice-card${consultantSetup.serviceRadiusKm === radius ? ' is-selected' : ''}`} onClick={() => setConsultantSetup((current) => ({ ...current, serviceRadiusKm: radius }))}><AimOutlined /><strong>{radius === 250 ? t('250+ km') : `${radius} km`}</strong><small>{radius <= 25 ? t('Nearby') : radius <= 100 ? t('Regional') : t('Wide reach')}</small></button>)}
                            </div>
                            <Title level={5}>{t('Preferred daily-rate currency')}</Title>
                            <div className="welcome-choice-grid welcome-choice-grid-compact" role="radiogroup" aria-label={t('Currency')}>
                                {(consultantSetup.country === 'South Africa' ? ['ZAR'] : consultantSetup.country === 'Zimbabwe' ? ['ZWL'] : []).map((currency) => <button type="button" role="radio" aria-checked={consultantSetup.currency === currency} key={currency} className={`welcome-choice-card${consultantSetup.currency === currency ? ' is-selected' : ''}`} onClick={() => setConsultantSetup((current) => ({ ...current, currency }))}><BankOutlined /><strong>{currency}</strong><small>{consultantSetup.country}</small></button>)}
                            </div>
                            <div className="welcome-actions-row">{!editingFromReview && <Button size="large" icon={<ArrowLeftOutlined />} onClick={back}>{t('Back')}</Button>}<Button type="primary" size="large" icon={<ArrowRightOutlined />} onClick={() => continueConsultant(editingFromReview ? 'consultantReview' : 'consultantExpertise')}>{editingFromReview ? t('Update') : t('Continue')}</Button></div>
                        </div>
                    )}

                    {activeStep === 'consultantExpertise' && messageComplete && (
                        <div className="welcome-panel welcome-reveal">
                            <div className="welcome-section-heading"><span className="welcome-panel-icon"><RiseOutlined /></span><div><Title level={4}>{t('What do you specialise in?')}</Title><Paragraph>{t('Select all the areas where you can make a practical difference.')}</Paragraph></div></div>
                            <div className="welcome-choice-grid" role="group" aria-label={t('Areas of expertise')}>
                                {[['Strategy & growth', RiseOutlined], ['Finance & accounting', BankOutlined], ['Marketing & sales', TeamOutlined], ['Operations', AimOutlined], ['People & HR', TeamOutlined], ['Technology & digital', LaptopOutlined], ['Legal & compliance', SafetyCertificateOutlined], ['Procurement', ShopOutlined]].map(([label, Icon]) => { const value = String(label); const selected = consultantSetup.specialties.includes(value); return <button type="button" key={value} className={`welcome-choice-card${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={() => setConsultantSetup((current) => ({ ...current, specialties: selected ? current.specialties.filter((item) => item !== value) : [...current.specialties, value] }))}><Icon /><strong>{value}</strong></button> })}
                            </div>
                            <div className="welcome-actions-row">{!editingFromReview && <Button size="large" icon={<ArrowLeftOutlined />} onClick={back}>{t('Back')}</Button>}<Button type="primary" size="large" icon={<ArrowRightOutlined />} disabled={!consultantSetup.specialties.length} onClick={() => continueConsultant(editingFromReview ? 'consultantReview' : 'consultantExperience')}>{editingFromReview ? t('Update') : t('Continue')}</Button></div>
                        </div>
                    )}

                    {activeStep === 'consultantExperience' && messageComplete && (
                        <div className="welcome-panel welcome-reveal">
                            <div className="welcome-section-heading"><span className="welcome-panel-icon"><TrophyOutlined /></span><div><Title level={4}>{t('Years of experience')}</Title><Paragraph>{t('Choose the range that best reflects your professional journey.')}</Paragraph></div></div>
                            <div className="welcome-choice-grid welcome-choice-grid-compact" role="radiogroup" aria-label={t('Years of experience')}>
                                {[1, 3, 6, 10].map((years) => <button type="button" role="radio" aria-checked={consultantSetup.experienceYears === years} key={years} className={`welcome-choice-card${consultantSetup.experienceYears === years ? ' is-selected' : ''}`} onClick={() => setConsultantSetup((current) => ({ ...current, experienceYears: years }))}><TrophyOutlined /><strong>{years === 1 ? t('0–2 years') : years === 3 ? t('3–5 years') : years === 6 ? t('6–9 years') : t('10+ years')}</strong></button>)}
                            </div>
                            <div className="welcome-actions-row">{!editingFromReview && <Button size="large" icon={<ArrowLeftOutlined />} onClick={back}>{t('Back')}</Button>}<Button type="primary" size="large" icon={<ArrowRightOutlined />} onClick={() => continueConsultant(editingFromReview ? 'consultantReview' : 'consultantAbout')}>{editingFromReview ? t('Update') : t('Continue')}</Button></div>
                        </div>
                    )}

                    {activeStep === 'consultantAbout' && messageComplete && (
                        <div className="welcome-panel welcome-reveal">
                            <div className="welcome-section-heading"><span className="welcome-panel-icon"><EditOutlined /></span><div><Title level={4}>{t('Tell clients a little about you')}</Title><Paragraph>{t('A clear headline and short introduction make your profile feel human.')}</Paragraph></div></div>
                            <Form layout="vertical" requiredMark={false} className="welcome-consultant-form">
                                <Form.Item label={t('Profile headline')}><Input size="large" value={consultantSetup.headline} placeholder={t('e.g. Growth strategist for early-stage businesses')} onChange={(event) => setConsultantSetup((current) => ({ ...current, headline: event.target.value }))} /></Form.Item>
                                <Form.Item label={t('About your work')}><Input.TextArea rows={4} value={consultantSetup.bio} placeholder={t('What can a business expect when working with you?')} onChange={(event) => setConsultantSetup((current) => ({ ...current, bio: event.target.value }))} /></Form.Item>
                                <div className="welcome-actions-row">{!editingFromReview && <Button size="large" icon={<ArrowLeftOutlined />} onClick={back}>{t('Back')}</Button>}<Button type="primary" size="large" icon={<ArrowRightOutlined />} loading={savingConsultantSetup} onClick={() => void saveConsultantSetupDetails()}>{editingFromReview ? t('Update') : t('Save profile and continue')}</Button></div>
                            </Form>
                        </div>
                    )}

                    {activeStep === 'consultantReview' && messageComplete && (
                        <div className="welcome-panel welcome-reveal">
                            <div className="welcome-section-heading"><span className="welcome-panel-icon"><CheckCircleOutlined /></span><div><Title level={4}>{t('Review your profile')}</Title><Paragraph>{t('Everything look right? You can edit these details later from your profile.')}</Paragraph></div></div>
                            <div className="welcome-review-grid">
                                <button type="button" onClick={() => beginReviewEdit('consultantLocation')}><span className="welcome-edit-icon"><EditOutlined /></span><Text type="secondary">{t('Based in')}</Text><strong>{consultantSetup.province}, {consultantSetup.country}</strong></button>
                                <button type="button" onClick={() => beginReviewEdit('consultantReach')}><span className="welcome-edit-icon"><EditOutlined /></span><Text type="secondary">{t('Service radius')}</Text><strong>{consultantSetup.serviceRadiusKm} {t('km ·')} {consultantSetup.currency}</strong></button>
                                <button type="button" onClick={() => beginReviewEdit('consultantExpertise')}><span className="welcome-edit-icon"><EditOutlined /></span><Text type="secondary">{t('Expertise')}</Text><strong>{consultantSetup.specialties.join(', ') || t('Not selected')}</strong></button>
                                <button type="button" onClick={() => beginReviewEdit('consultantExperience')}><span className="welcome-edit-icon"><EditOutlined /></span><Text type="secondary">{t('Experience')}</Text><strong>{consultantSetup.experienceYears >= 10 ? t('10+ years') : consultantSetup.experienceYears >= 6 ? t('6–9 years') : consultantSetup.experienceYears >= 3 ? t('3–5 years') : t('0–2 years')}</strong></button>
                            </div>
                            <Button type="primary" size="large" block icon={<ArrowRightOutlined />} onClick={() => { setEditingFromReview(false); goTo(!hasSignature ? 'signature' : 'complete') }}>{t('Looks good')}</Button>
                        </div>
                    )}

                    {activeStep === 'complete' && messageComplete && (
                        <div className="welcome-panel welcome-complete-panel welcome-reveal">
                            <span className="welcome-panel-icon is-complete">
                                <CheckCircleOutlined />
                            </span>
                            <Title level={3}>{t('welcome.finish.title')}</Title>
                            <Paragraph>{t('welcome.finish.body')}</Paragraph>
                            <Button
                                type="primary"
                                size="large"
                                block
                                icon={<ArrowRightOutlined />}
                                loading={finishing}
                                onClick={() => void finish()}
                            >
                                {t('welcome.finish.continue')}
                            </Button>
                        </div>
                    )}
                </section>

                {history.length > 0 && activeStep !== 'complete' && messageComplete && (
                    <Button className="welcome-back" type="text" icon={<ArrowLeftOutlined />} onClick={back}>
                        {t('common.back')}
                    </Button>
                )}
            </Card>
        </main>
    )
}
