import { Alert, App, Button, Card, Checkbox, Col, Dropdown, Form, Grid, Input, Radio, Row, Select, Space, Typography, Upload } from 'antd'
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
    MessageOutlined,
    PictureOutlined,
    SettingOutlined,
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
import { captureSignatureStrokes, type SignatureStrokes } from '@/utils/signatureStrokes'
import html2canvas from 'html2canvas'
import { Navigate } from 'react-router-dom'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { useThemeMode } from '@/providers/ThemeProvider'
import { LANGUAGES, type LanguageCode } from '@/config/languages'
import {
    completeFirstLogin,
    saveOnboardingRole,
    isValidWhatsAppNumber,
    saveOnboardingSignature,
    saveWhatsAppConsent,
    updateOnboardingPassword,
    type OnboardingRole,
} from '@/services/onboardingService'
import { getConsultantProfile, saveConsultantProfile } from '@/services/consultantMarketplaceService'
import { OptionCards } from '@/components/welcome/OptionCards'
import {
    cleanCompanyCode,
    companyCodeConflict,
    completeDirectorSetup,
    getCompanyOverview,
    isValidCompanyCode,
    uploadCompanyLogo,
    type DirectorSettingsInput,
} from '@/services/directorSetupService'
import { readPendingProgramLink } from '@/services/programLinkService'
import type { ConsultantMarketplaceProfile } from '@/types/consultantMarketplace'
import { provincesForCountry } from '@/config/sadc'
import { getRoleHomePath } from '@/utils/roleRouting'
import '@/styles/welcome.css'

type PasswordValues = {
    password: string
    confirmPassword: string
}

/** Roles only staff can give; people with them never choose a role in the welcome flow. */
const ASSIGNED_ONLY_ROLES: string[] = ['systemadmin', 'admin', 'projectadmin', 'projectmanager', 'operations', 'funder']
/** Roles that never sign documents (read-only funders, reception). */
const NO_SIGNATURE_ROLES: string[] = ['funder', 'admin']

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
    | 'directorCompany'
    | 'directorLogo'
    | 'directorSettings'
    | 'signature'
    | 'whatsapp'
    | 'complete'
type SignatureMode = 'typed' | 'drawn' | 'upload'

type DirectorSettingsFormValues = {
    consultantLabel: string
    hasDepartments: 'yes' | 'no'
    hasBranches: 'yes' | 'no'
    branchScopedManagement?: 'yes' | 'no'
    smeOnboardingModel: DirectorSettingsInput['smeOnboardingModel']
    assignmentModel: DirectorSettingsInput['assignmentModel']
    smeDivisionModel?: DirectorSettingsInput['smeDivisionModel']
    interventionScopeModel: DirectorSettingsInput['interventionScopeModel']
}

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
    const { message, modal } = App.useApp()
    const { t, language, setLanguage } = useLanguage()
    const { mode: themeMode, toggleTheme } = useThemeMode()
    const { user, loading, updateIdentity } = useFullIdentity()
    const [passwordForm] = Form.useForm<PasswordValues>()

    const [activeStep, setActiveStep] = useState<WelcomeStepKey>('intro')
    const [history, setHistory] = useState<WelcomeStepKey[]>([])
    const [editingFromReview, setEditingFromReview] = useState(false)
    const [messageComplete, setMessageComplete] = useState(false)
    const [selectedRole, setSelectedRole] = useState<OnboardingRole | 'director'>()
    // Arrived through a programme link: the role is SME and the programme is already chosen.
    const [cameFromProgramLink] = useState(() => Boolean(readPendingProgramLink()))
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
    const [whatsappDecided, setWhatsappDecided] = useState(false)
    const [whatsappPhone, setWhatsappPhone] = useState('')
    const [whatsappAgreed, setWhatsappAgreed] = useState(false)
    const [savingWhatsapp, setSavingWhatsapp] = useState(false)
    const [directorCompanyName, setDirectorCompanyName] = useState('')
    const [directorCompanyCode, setDirectorCompanyCode] = useState('')
    const [directorCodeProvided, setDirectorCodeProvided] = useState(false)
    const [directorCodeError, setDirectorCodeError] = useState('')
    const [checkingCompany, setCheckingCompany] = useState(false)
    const [directorLogoUrl, setDirectorLogoUrl] = useState('')
    const [uploadingLogo, setUploadingLogo] = useState(false)
    const [directorConfigured, setDirectorConfigured] = useState(false)
    const [savingDirector, setSavingDirector] = useState(false)
    const [settingsForm] = Form.useForm<DirectorSettingsFormValues>()
    const watchedAssignmentModel = Form.useWatch('assignmentModel', settingsForm)
    const watchedHasBranches = Form.useWatch('hasBranches', settingsForm)
    const watchedHasDepartments = Form.useWatch('hasDepartments', settingsForm)
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

    useEffect(() => {
        if (!user || user.role !== 'director' || !user.companyCode) return
        let cancelled = false
        void getCompanyOverview(user.companyCode, user.uid)
            .then((overview) => {
                if (cancelled) return
                if (overview.locked && overview.ownedByMe) {
                    setDirectorConfigured(true)
                    return
                }
                setDirectorCompanyCode(user.companyCode || '')
                setDirectorCodeProvided(overview.exists)
                if (overview.name) setDirectorCompanyName(overview.name)
                if (overview.logoUrl) setDirectorLogoUrl(overview.logoUrl)
            })
            .catch(() => undefined)
        return () => { cancelled = true }
    }, [user])

    if (loading) return <PageSkeleton variant="detail" label={t('welcome.loading')} />
    if (!user) return <Navigate to="/auth" replace />
    if (!user.emailVerified) return <Navigate to="/email-verification" replace />
    if (user.firstLoginComplete) {
        return <Navigate to={getRoleHomePath(user.role, user.isApplicant, user.smeOnboardingComplete)} replace />
    }

    const effectiveRole = selectedRole ?? user.role
    // Someone else gave this account its role: a role only staff can assign, or an account created for the person
    // (those must change the password they were invited with). Their role is set, so they never pick one here.
    const roleAssigned = ASSIGNED_ONLY_ROLES.includes(user.role) || user.mustChangePassword === true
    const firstName = (user.displayName || user.name || '').trim().split(/\s+/)[0]
    const hasSignature = Boolean(signatureComplete || user.signatureURL || signatureURL)
    // Funders and reception admins never sign documents, so they skip the signature step.
    const needsSignature = !hasSignature && !NO_SIGNATURE_ROLES.includes(effectiveRole)
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

    // Last setup step for every role: ask about WhatsApp updates once, unless a choice already exists.
    const alreadyDecidedWhatsapp = whatsappDecided || Boolean((user as unknown as { whatsappConsent?: unknown }).whatsappConsent)
    const afterSetup = () => (alreadyDecidedWhatsapp ? 'complete' as const : 'whatsapp' as const)

    // Directors cannot pick a role; they set up their company (name and code, logo, locked settings) instead.
    const directorNext = () => (directorConfigured ? (needsSignature ? 'signature' as const : afterSetup()) : 'directorCompany' as const)

    const resolveStepAfterRole = (role: string) => {
        if (user.mustChangePassword === true && !passwordComplete) return 'password' as const
        if (role === 'director') return directorNext()
        if (role === 'consultant') return 'consultantLocation' as const
        if (needsSignature) return 'signature' as const
        return afterSetup()
    }

    const resolveStepAfterPassword = () => {
        if (effectiveRole === 'director') return directorNext()
        if (effectiveRole === 'consultant') return 'consultantLocation' as const
        if (needsSignature) return 'signature' as const
        return afterSetup()
    }

    const conversationText: Record<WelcomeStepKey, string> = {
        intro: `Hi${firstName ? ` ${firstName}` : ''}, I’m Thuso. Welcome to Smart Incubation. I’ll guide you through setting up your workspace one thing at a time. Nothing complicated. Ready to get started?`,
        role: 'Great. First, tell me what best describes how you’ll use Smart Incubation so I can set the right workspace up for you.',
        password:
            'Perfect. Now that we’ve got that out of the way, let’s secure your account. Create a password that only you know, then we’ll move on.',
        signature:
            'Good, that part is done. Next, let’s add your signature. You can type it, draw it, or upload one, and we’ll use it when you acknowledge plans and documents.',
        directorCompany: 'Let’s set up your organisation first. Tell me your company’s name and choose a short, unique company code. It keeps your people, programmes and reports properly separated from other organisations.',
        directorLogo: 'Now add your company logo. It will appear on reports, dashboards and the documents we generate for you.',
        directorSettings: 'Last part for your company: how it operates. These choices shape onboarding and how interventions are assigned. Once you lock them they can’t be changed directly, so take a moment to review.',
        whatsapp: 'One more thing. I can send important updates, like deadlines, follow-up reminders and appointment notices, to your WhatsApp. It’s your choice, and you can stop any time by replying STOP.',
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
            if (selectedRole === 'director') {
                // The role itself is granted on the server when the company is locked (a new company only).
                goTo(resolveStepAfterRole('director'))
                return
            }
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

    const persistSignature = async (signature: Blob, filename: string, successMessage: string, strokes: SignatureStrokes | null = null) => {
        try {
            setSavingSignature(true)
            const url = await saveOnboardingSignature(signature, filename, strokes)
            updateIdentity({ signatureURL: url, signatureStrokes: strokes })
            setSignatureURL(url)
            setSignatureComplete(true)
            message.success(successMessage)
            goTo(afterSetup())
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

    const continueFromDirectorCompany = async () => {
        const name = directorCompanyName.trim()
        const code = cleanCompanyCode(directorCompanyCode)
        if (name.length < 2) {
            message.warning(t('Please enter your company name.'))
            return
        }
        if (!isValidCompanyCode(code)) {
            setDirectorCodeError(t('Use 3 to 20 letters or numbers with no spaces, for example QTX001.'))
            return
        }
        try {
            setCheckingCompany(true)
            const overview = await getCompanyOverview(code, user.uid)
            const conflict = companyCodeConflict(overview, directorCodeProvided && code === cleanCompanyCode(user.companyCode || ''))
            if (conflict) {
                setDirectorCodeError(t(conflict))
                return
            }
            setDirectorCodeError('')
            setDirectorCompanyCode(code)
            if (overview.logoUrl && !directorLogoUrl) setDirectorLogoUrl(overview.logoUrl)
            goTo('directorLogo')
        } catch {
            message.error(t('We could not check that company code. Please try again.'))
        } finally {
            setCheckingCompany(false)
        }
    }

    const uploadDirectorLogo = async (file: File) => {
        try {
            setUploadingLogo(true)
            setDirectorLogoUrl(await uploadCompanyLogo(file))
            message.success(t('Company logo uploaded.'))
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('The logo could not be uploaded.'))
        } finally {
            setUploadingLogo(false)
        }
    }

    const lockDirectorSettings = async () => {
        let values: DirectorSettingsFormValues
        try {
            values = await settingsForm.validateFields()
        } catch {
            return
        }
        const hasBranches = values.hasBranches === 'yes'
        const settings: DirectorSettingsInput = {
            consultantLabel: values.consultantLabel.trim(),
            hasDepartments: values.hasDepartments === 'yes',
            hasBranches,
            ...(hasBranches ? { branchScopedManagement: values.branchScopedManagement === 'yes' } : {}),
            smeOnboardingModel: values.smeOnboardingModel,
            assignmentModel: values.assignmentModel,
            ...(values.assignmentModel === 'consultant_self_assign' ? { smeDivisionModel: values.smeDivisionModel } : {}),
            interventionScopeModel: values.interventionScopeModel,
        }
        try {
            setSavingDirector(true)
            await completeDirectorSetup({ ...settings, companyName: directorCompanyName.trim(), companyCode: directorCompanyCode, logoUrl: directorLogoUrl || undefined })
            setDirectorConfigured(true)
            message.success(t('Company settings saved and locked.'))
            goTo(needsSignature ? 'signature' : afterSetup())
        } catch (error) {
            const reason = error instanceof Error ? error.message : t('Your company setup could not be saved.')
            message.error(reason)
            // A code taken by someone else sends the director back to fix it.
            if (/already in use|already has locked/i.test(reason)) {
                setDirectorCodeError(reason)
                setHistory((currentHistory) => currentHistory.slice(0, -2))
                setActiveStep('directorCompany')
            }
        } finally {
            setSavingDirector(false)
        }
    }

    const confirmLockSettings = () => {
        modal.confirm({
            title: t('Lock these settings?'),
            content: t('Once saved, these settings cannot be changed directly. Make sure they match how your organisation actually operates.'),
            okText: t('Yes, save and lock'),
            cancelText: t('Cancel'),
            onOk: lockDirectorSettings,
        })
    }

    const submitWhatsappChoice = async (optIn: boolean) => {
        try {
            setSavingWhatsapp(true)
            await saveWhatsAppConsent(optIn ? { optIn: true, phone: whatsappPhone } : { optIn: false })
            setWhatsappDecided(true)
            if (optIn) message.success(t('WhatsApp updates are on.'))
            goTo('complete')
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('Your WhatsApp choice could not be saved.'))
        } finally {
            setSavingWhatsapp(false)
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
        // The pen movement is kept with the image so signing can replay it. Points are in CSS pixels of the canvas.
        const surface = canvas.getCanvas()
        const strokes = captureSignatureStrokes(canvas.toData(), surface.offsetWidth || surface.width, surface.offsetHeight || surface.height)
        await persistSignature(blob, 'drawn.png', t('welcome.signature.drawSuccess', 'Drawn signature saved.'), strokes)
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

    // Panels that already show their own Back next to the primary button must not get a second one underneath.
    const consultantInlineSteps: WelcomeStepKey[] = ['consultantLocation', 'consultantReach', 'consultantExpertise', 'consultantExperience', 'consultantAbout']
    const hasInlineBack = activeStep === 'role'
        || activeStep === 'directorCompany'
        || activeStep === 'directorLogo'
        || activeStep === 'directorSettings'
        || (consultantInlineSteps.includes(activeStep) && !editingFromReview)
        || (activeStep === 'signature' && signatureMode === 'typed')

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
                            <Button type="primary" size="large" icon={<ArrowRightOutlined />} onClick={() => goTo(effectiveRole === 'director' || roleAssigned || (cameFromProgramLink && effectiveRole === 'incubatee') ? resolveStepAfterRole(effectiveRole) : 'role')}>
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

                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={selectedRole === 'director'}
                                    className={`welcome-role-card${selectedRole === 'director' ? ' is-selected' : ''}`}
                                    onClick={() => setSelectedRole('director')}
                                >
                                    <span className="welcome-role-icon is-director">
                                        <BankOutlined />
                                    </span>
                                    <span className="welcome-role-copy">
                                        <strong>{t('Director')}</strong>
                                        <small>
                                            {t('I lead an organisation and want to set up and oversee its programmes, teams and SMEs.')}
                                        </small>
                                    </span>
                                    <CheckCircleOutlined className="welcome-role-check" />
                                </button>
                            </div>

                            <div className="welcome-actions-row"><Button size="large" icon={<ArrowLeftOutlined />} onClick={back}>{t('Back')}</Button><Button type="primary" size="large" icon={<ArrowRightOutlined />} loading={savingRole} disabled={!selectedRole} onClick={() => void saveRole()}>{selectedRole === 'incubatee' ? t('Continue as SME') : selectedRole === 'consultant' ? t('Continue as consultant') : selectedRole === 'director' ? t('Continue as director') : t('Choose how you’ll use Smart Incubation')}</Button></div>
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
                                                    : Promise.reject(new Error(t("The passwords don't match.")))
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

                    {activeStep === 'directorCompany' && messageComplete && (
                        <div className="welcome-panel welcome-reveal">
                            <div className="welcome-section-heading">
                                <span className="welcome-panel-icon"><BankOutlined /></span>
                                <div>
                                    <Title level={4}>{t('Company details')}</Title>
                                    <Paragraph>{t('This keeps records, users and reporting tied to the correct organisation.')}</Paragraph>
                                </div>
                            </div>
                            <Form layout="vertical" requiredMark={false} className="welcome-consultant-form">
                                <Form.Item label={t('Company name')} required>
                                    <Input size="large" value={directorCompanyName} placeholder={t('e.g. Lepharo Incubation')} onChange={(event) => setDirectorCompanyName(event.target.value)} />
                                </Form.Item>
                                <Form.Item
                                    label={t('Company code')}
                                    required
                                    validateStatus={directorCodeError ? 'error' : undefined}
                                    help={directorCodeError || t('Must be unique, with no spaces. Example: QTX001')}
                                >
                                    <Input
                                        size="large"
                                        value={directorCompanyCode}
                                        disabled={directorCodeProvided}
                                        placeholder="QTX001"
                                        onChange={(event) => { setDirectorCompanyCode(event.target.value.toUpperCase()); setDirectorCodeError('') }}
                                    />
                                </Form.Item>
                                <Alert type="info" showIcon message={t('Make sure the name is correct and the code is final. You cannot change the code later.')} style={{ marginBottom: 16 }} />
                                <div className="welcome-actions-row">
                                    <Button size="large" icon={<ArrowLeftOutlined />} onClick={back}>{t('Back')}</Button>
                                    <Button type="primary" size="large" icon={<ArrowRightOutlined />} loading={checkingCompany} disabled={!directorCompanyName.trim() || !directorCompanyCode.trim()} onClick={() => void continueFromDirectorCompany()}>{t('Continue')}</Button>
                                </div>
                            </Form>
                        </div>
                    )}

                    {activeStep === 'directorLogo' && messageComplete && (
                        <div className="welcome-panel welcome-reveal">
                            <div className="welcome-section-heading">
                                <span className="welcome-panel-icon"><PictureOutlined /></span>
                                <div>
                                    <Title level={4}>{t('Upload your company logo')}</Title>
                                    <Paragraph>{t('Used on reports, dashboards and generated documents. PNG or JPG works best.')}</Paragraph>
                                </div>
                            </div>
                            <Upload.Dragger
                                multiple={false}
                                accept=".png,.jpg,.jpeg,.webp"
                                showUploadList={false}
                                disabled={uploadingLogo}
                                customRequest={async ({ file, onSuccess, onError }) => {
                                    try {
                                        await uploadDirectorLogo(file as File)
                                        onSuccess?.('ok')
                                    } catch (error) {
                                        onError?.(error instanceof Error ? error : new Error('Upload failed'))
                                    }
                                }}
                                className="welcome-signature-dragger"
                            >
                                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                                <p className="ant-upload-text">{uploadingLogo ? t('Uploading...') : t('Click or drag your logo here')}</p>
                                <p className="ant-upload-hint">{t('A high-resolution image gives the best result.')}</p>
                            </Upload.Dragger>
                            {directorLogoUrl && (
                                <div className="welcome-signature-current">
                                    <Text strong>{t('Preview')}</Text>
                                    <img src={directorLogoUrl} alt={t('Company logo')} style={{ maxHeight: 90, maxWidth: '100%', background: '#fff', padding: 8, borderRadius: 8 }} />
                                </div>
                            )}
                            <div className="welcome-actions-row" style={{ marginTop: 16 }}>
                                <Button size="large" icon={<ArrowLeftOutlined />} onClick={back}>{t('Back')}</Button>
                                <Button type="primary" size="large" icon={<ArrowRightOutlined />} disabled={!directorLogoUrl || uploadingLogo} onClick={() => goTo('directorSettings')}>{t('Continue')}</Button>
                            </div>
                        </div>
                    )}

                    {activeStep === 'directorSettings' && messageComplete && (
                        <div className="welcome-panel welcome-reveal">
                            <div className="welcome-section-heading">
                                <span className="welcome-panel-icon"><SettingOutlined /></span>
                                <div>
                                    <Title level={4}>{t('How your company operates')}</Title>
                                    <Paragraph>{t('These settings are locked once saved.')}</Paragraph>
                                </div>
                            </div>
                            <Alert type="warning" showIcon icon={<LockOutlined />} message={t('Locked configuration')} description={t('Review carefully before you lock. Later changes need an approved request.')} style={{ marginBottom: 16 }} />
                            <Form
                                form={settingsForm}
                                layout="vertical"
                                requiredMark={false}
                                className="welcome-consultant-form"
                                initialValues={{
                                    consultantLabel: 'Consultants',
                                    hasDepartments: 'yes',
                                    hasBranches: 'no',
                                    smeOnboardingModel: 'self_application',
                                    assignmentModel: 'ops_assign_consultant',
                                    interventionScopeModel: 'program_specific',
                                }}
                            >
                                <section className="welcome-settings-section">
                                    <h5>{t('Naming')}</h5>
                                    <Form.Item name="consultantLabel" label={t('What does your company call its consultants?')} rules={[{ required: true, message: t('Enter a name such as Mentors, Coaches or Advisors.') }]} extra={t('Examples: Mentors, Coaches, Advisors. Shown across the platform.')}>
                                        <Input size="large" placeholder={t('e.g. Mentors')} />
                                    </Form.Item>
                                </section>

                                <section className="welcome-settings-section">
                                    <h5>{t('Company structure')}</h5>
                                    <Form.Item name="hasDepartments" label={t('Does your company have departments?')} rules={[{ required: true }]}>
                                        <OptionCards options={[
                                            { value: 'yes', label: t('Yes'), description: t('Teams such as Finance or Programmes') },
                                            { value: 'no', label: t('No'), description: t('One team, no departments') },
                                        ]} />
                                    </Form.Item>
                                    <Form.Item name="hasBranches" label={t('Does your company have branches or offices?')} rules={[{ required: true }]}>
                                        <OptionCards options={[
                                            { value: 'yes', label: t('Yes'), description: t('Separate offices or sites') },
                                            { value: 'no', label: t('No'), description: t('A single location') },
                                        ]} />
                                    </Form.Item>
                                    {watchedHasBranches === 'yes' && (
                                        <Form.Item name="branchScopedManagement" label={t('Should consultants manage SMEs only within their office?')} rules={[{ required: true, message: t('Please choose an option.') }]}>
                                            <OptionCards options={[
                                                { value: 'yes', label: t('Yes, office only'), description: t('Consultants only see SMEs in their own office') },
                                                { value: 'no', label: t('No, across offices'), description: t('Consultants can work with any office') },
                                            ]} />
                                        </Form.Item>
                                    )}
                                </section>

                                <section className="welcome-settings-section">
                                    <h5>{t('SMEs and delivery')}</h5>
                                    <Form.Item name="smeOnboardingModel" label={t('How are SMEs onboarded?')} rules={[{ required: true }]}>
                                        <OptionCards options={[
                                            { value: 'self_application', label: t('SMEs apply themselves'), description: t('SMEs register and apply on their own') },
                                            { value: 'consultants_register_smes', label: t('Our team registers them'), description: t('Your team captures SME applications for them') },
                                        ]} />
                                    </Form.Item>
                                    <Form.Item name="assignmentModel" label={t('How are interventions assigned?')} rules={[{ required: true }]}>
                                        <OptionCards options={[
                                            { value: 'ops_assign_consultant', label: t('Operations assign'), description: t('Operations decide who delivers each intervention') },
                                            { value: 'consultant_self_assign', label: t('Consultants self-assign'), description: t('Consultants pick up interventions themselves') },
                                        ]} />
                                    </Form.Item>
                                    {watchedAssignmentModel === 'consultant_self_assign' && (
                                        <Form.Item name="smeDivisionModel" label={t('When consultants self-assign, how are SMEs divided?')} rules={[{ required: true, message: t('Please choose an option.') }]}>
                                            <OptionCards columns={3} options={[
                                                { value: 'system_equal_random', label: t('Shared equally'), description: t('Split equally and at random') },
                                                { value: 'ops_assign_smes_to_consultants', label: t('Operations match'), description: t('Operations match SMEs to consultants') },
                                                { value: 'consultants_register_their_smes', label: t('Their own SMEs'), description: t('Each consultant gets the SMEs they register') },
                                            ]} />
                                        </Form.Item>
                                    )}
                                </section>

                                <section className="welcome-settings-section">
                                    <h5>{t('Interventions')}</h5>
                                    <Form.Item name="interventionScopeModel" label={t('Intervention scope')} rules={[{ required: true }]}>
                                        <OptionCards options={[
                                            { value: 'program_specific', label: t('Programme specific'), description: t('Each intervention belongs to one programme') },
                                            { value: 'company_wide', label: t('Company wide'), description: t('Shared across all programmes') },
                                            { value: 'both', label: t('Both'), description: t('Choose per intervention') },
                                            ...(watchedHasDepartments === 'yes' ? [{ value: 'department_specific' as const, label: t('Department specific'), description: t('Tied to a department') }] : []),
                                        ]} />
                                    </Form.Item>
                                </section>

                                <div className="welcome-actions-row">
                                    <Button size="large" icon={<ArrowLeftOutlined />} onClick={back} disabled={savingDirector}>{t('Back')}</Button>
                                    <Button type="primary" size="large" icon={<LockOutlined />} loading={savingDirector} onClick={confirmLockSettings}>{t('Save and lock settings')}</Button>
                                </div>
                            </Form>
                        </div>
                    )}

                    {activeStep === 'whatsapp' && messageComplete && (
                        <div className="welcome-panel welcome-reveal">
                            <div className="welcome-section-heading">
                                <span className="welcome-panel-icon"><MessageOutlined /></span>
                                <div>
                                    <Title level={4}>{t('Get updates on WhatsApp')}</Title>
                                    <Paragraph>{t('Deadlines, follow-up reminders and appointment notices, sent to the number you choose.')}</Paragraph>
                                </div>
                            </div>
                            <Form layout="vertical" requiredMark={false} className="welcome-consultant-form">
                                <Form.Item
                                    label={t('WhatsApp number')}
                                    validateStatus={whatsappPhone && !isValidWhatsAppNumber(whatsappPhone) ? 'error' : undefined}
                                    help={whatsappPhone && !isValidWhatsAppNumber(whatsappPhone) ? t('Enter a valid number, for example +27 82 123 4567') : undefined}
                                >
                                    <Input size="large" inputMode="tel" autoComplete="tel" placeholder="+27 82 123 4567" value={whatsappPhone} onChange={(event) => setWhatsappPhone(event.target.value)} />
                                </Form.Item>
                                <Checkbox checked={whatsappAgreed} onChange={(event) => setWhatsappAgreed(event.target.checked)}>
                                    {t('I agree to receive Smart Incubation updates on WhatsApp at this number. Message frequency varies. I can reply STOP at any time to opt out.')}
                                </Checkbox>
                                <div className="welcome-actions-row" style={{ marginTop: 16 }}>
                                    <Button size="large" loading={savingWhatsapp} onClick={() => void submitWhatsappChoice(false)}>{t('Not now')}</Button>
                                    <Button type="primary" size="large" icon={<ArrowRightOutlined />} loading={savingWhatsapp} disabled={!whatsappAgreed || !isValidWhatsAppNumber(whatsappPhone)} onClick={() => void submitWhatsappChoice(true)}>{t('Turn on WhatsApp updates')}</Button>
                                </div>
                            </Form>
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
                            <Button type="primary" size="large" block icon={<ArrowRightOutlined />} onClick={() => { setEditingFromReview(false); goTo(needsSignature ? 'signature' : afterSetup()) }}>{t('Looks good')}</Button>
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

                {history.length > 0 && activeStep !== 'complete' && messageComplete && !hasInlineBack && (
                    <Button className="welcome-back" type="text" icon={<ArrowLeftOutlined />} onClick={back}>
                        {t('common.back')}
                    </Button>
                )}
            </Card>
        </main>
    )
}
