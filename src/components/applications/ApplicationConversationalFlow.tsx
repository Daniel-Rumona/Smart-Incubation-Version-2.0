import { useEffect, useMemo, useState } from 'react'
import { Button, Card, DatePicker, Grid, Input, Progress, Tag, Typography, Upload, theme } from 'antd'
import {
    ArrowLeftOutlined,
    ArrowRightOutlined,
    AppstoreOutlined,
    BulbOutlined,
    CheckOutlined,
    CloseOutlined,
    FileTextOutlined,
    MessageOutlined,
    PlusOutlined,
    SafetyCertificateOutlined,
    SearchOutlined,
    ThunderboltOutlined,
    UploadOutlined,
    WarningOutlined,
} from '@ant-design/icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import dayjs from 'dayjs'
import type {
    ApplicationFormValues,
    ProgramDocumentRequirement,
    ProgramInterventionGroup,
    ProgramQuestion,
} from '@/types/application'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input
const { useBreakpoint } = Grid

type FlowScreen =
    | 'welcome'
    | 'motivation'
    | 'challenges'
    | 'presence'
    | 'swotStrengths'
    | 'swotWeaknesses'
    | 'swotOpportunities'
    | 'swotThreats'
    | 'profileIntro'
    | 'profileQuestion'
    | 'documentsIntro'
    | 'documents'
    | 'supportIntro'
    | 'supportAreas'
    | 'supportDepartment'

type FlowDirection = 'forward' | 'backward'

type SwotCategory = 'strengths' | 'weaknesses' | 'opportunities' | 'threats'

const SWOT_ORDER: SwotCategory[] = ['strengths', 'weaknesses', 'opportunities', 'threats']

const SWOT_CONFIG: Record<SwotCategory, {
    screen: FlowScreen
    field: 'swotStrengths' | 'swotWeaknesses' | 'swotOpportunities' | 'swotThreats'
    label: string
    question: string
    placeholder: string
    sentiment: 'positive' | 'negative'
    Icon: typeof ThunderboltOutlined
}> = {
    strengths: { screen: 'swotStrengths', field: 'swotStrengths', label: 'Strengths', question: 'What does your business do well?', placeholder: 'e.g. Strong customer relationships', sentiment: 'positive', Icon: ThunderboltOutlined },
    weaknesses: { screen: 'swotWeaknesses', field: 'swotWeaknesses', label: 'Weaknesses', question: 'Where does your business struggle?', placeholder: 'e.g. Limited working capital', sentiment: 'negative', Icon: WarningOutlined },
    opportunities: { screen: 'swotOpportunities', field: 'swotOpportunities', label: 'Opportunities', question: 'What external factors could help you grow?', placeholder: 'e.g. New export markets opening up', sentiment: 'positive', Icon: BulbOutlined },
    threats: { screen: 'swotThreats', field: 'swotThreats', label: 'Threats', question: 'What external factors could hurt your business?', placeholder: 'e.g. New competitors entering the market', sentiment: 'negative', Icon: SafetyCertificateOutlined },
}

const MIN_MOTIVATION_CHARS = 80
const DEFAULT_ALLOWED_FORMATS = ['pdf', 'jpg', 'jpeg', 'png']

const normaliseChallengeItems = (value?: string): string[] => {
    if (!value) return []
    return value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
}

const normaliseQuestionOptions = (question: ProgramQuestion): string[] => {
    if (Array.isArray(question.options)) return question.options.map((item) => String(item).trim()).filter(Boolean)
    if (typeof question.options === 'string') {
        return question.options.split(',').map((item) => item.trim()).filter(Boolean)
    }
    return []
}

type TypewriterPhraseProps = {
    text: string
    reducedMotion: boolean
    speed?: number
    delay?: number
}

function TypewriterPhrase({ text, reducedMotion, speed = 42, delay = 320 }: TypewriterPhraseProps) {
    const [renderedText, setRenderedText] = useState(text)
    const [visibleCharacters, setVisibleCharacters] = useState(reducedMotion ? text.length : 0)

    // Restart the animation when the phrase itself changes, adjusted during
    // render (React's supported pattern for resetting state from a changed
    // prop) rather than as a synchronous setState inside an effect.
    if (renderedText !== text) {
        setRenderedText(text)
        setVisibleCharacters(reducedMotion ? text.length : 0)
    }

    useEffect(() => {
        if (reducedMotion) return

        let intervalId: number | null = null

        const delayId = window.setTimeout(() => {
            intervalId = window.setInterval(() => {
                setVisibleCharacters((current) => {
                    if (current >= text.length) {
                        if (intervalId !== null) window.clearInterval(intervalId)
                        return text.length
                    }
                    return current + 1
                })
            }, speed)
        }, delay)

        return () => {
            window.clearTimeout(delayId)
            if (intervalId !== null) window.clearInterval(intervalId)
        }
    }, [delay, reducedMotion, speed, text])

    const typing = visibleCharacters < text.length

    return (
        <span aria-hidden={false} style={{ borderRight: typing ? '2px solid currentColor' : '2px solid transparent', paddingRight: 2 }}>
            {text.slice(0, visibleCharacters)}
        </span>
    )
}

type Props = {
    values: ApplicationFormValues
    onValuesChange: (patch: Partial<ApplicationFormValues>) => void
    programQuestions: ProgramQuestion[]
    documents: ProgramDocumentRequirement[]
    onDocumentsChange: (documents: ProgramDocumentRequirement[]) => void
    isForcedInterventionProgram: boolean
    interventionGroups: ProgramInterventionGroup[]
    interventionSelections: Record<string, string[]>
    onInterventionSelectionsChange: (value: Record<string, string[]>) => void
    onComplete: () => void
    programName?: string
    saving?: boolean
}

export default function ApplicationConversationalFlow({
    values,
    onValuesChange,
    programQuestions,
    documents,
    onDocumentsChange,
    isForcedInterventionProgram,
    interventionGroups,
    interventionSelections,
    onInterventionSelectionsChange,
    onComplete,
    programName,
    saving = false,
}: Props) {
    const { token } = theme.useToken()
    const reduceMotion = useReducedMotion()
    const screens = useBreakpoint()

    const [screen, setScreen] = useState<FlowScreen>('welcome')
    const [direction, setDirection] = useState<FlowDirection>('forward')
    const [profileIndex, setProfileIndex] = useState(0)
    const [profileOptionSearch, setProfileOptionSearch] = useState('')
    const [activeSupportArea, setActiveSupportArea] = useState<string | null>(null)

    const [challenges, setChallenges] = useState<string[]>(() => normaliseChallengeItems(values.challenges))
    const [challengeInput, setChallengeInput] = useState('')

    useEffect(() => {
        onValuesChange({ challenges: challenges.join('\n') })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [challenges])

    const [swotItems, setSwotItems] = useState<Record<SwotCategory, string[]>>(() => ({
        strengths: normaliseChallengeItems(values.swotStrengths),
        weaknesses: normaliseChallengeItems(values.swotWeaknesses),
        opportunities: normaliseChallengeItems(values.swotOpportunities),
        threats: normaliseChallengeItems(values.swotThreats),
    }))
    const [swotInputs, setSwotInputs] = useState<Record<SwotCategory, string>>({ strengths: '', weaknesses: '', opportunities: '', threats: '' })

    useEffect(() => {
        onValuesChange({
            swotStrengths: swotItems.strengths.join('\n'),
            swotWeaknesses: swotItems.weaknesses.join('\n'),
            swotOpportunities: swotItems.opportunities.join('\n'),
            swotThreats: swotItems.threats.join('\n'),
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [swotItems])

    const addSwotItem = (category: SwotCategory) => {
        const value = swotInputs[category].trim()
        if (!value) return
        if (swotItems[category].some((item) => item.toLowerCase() === value.toLowerCase())) {
            setSwotInputs((previous) => ({ ...previous, [category]: '' }))
            return
        }
        setSwotItems((previous) => ({ ...previous, [category]: [...previous[category], value] }))
        setSwotInputs((previous) => ({ ...previous, [category]: '' }))
    }

    const removeSwotItem = (category: SwotCategory, index: number) => {
        setSwotItems((previous) => ({ ...previous, [category]: previous[category].filter((_, itemIndex) => itemIndex !== index) }))
    }

    const motivationChars = (values.motivation || '').trim().length
    const canContinueMotivation = motivationChars >= MIN_MOTIVATION_CHARS
    const motivationProgress = Math.min(100, Math.round((motivationChars / MIN_MOTIVATION_CHARS) * 100))

    const hasProfileQuestions = programQuestions.length > 0
    const hasDocuments = documents.length > 0
    const hasSupport = !isForcedInterventionProgram && interventionGroups.length > 0

    const activeProfileQuestion = programQuestions[profileIndex]
    const activeProfileAnswer = activeProfileQuestion
        ? String(values.profile?.[activeProfileQuestion.id] ?? '')
        : ''
    const activeProfileAnswerList: string[] = activeProfileQuestion && Array.isArray(values.profile?.[activeProfileQuestion.id])
        ? (values.profile?.[activeProfileQuestion.id] as string[])
        : []

    const activeProfileOptions = useMemo(
        () => (activeProfileQuestion ? normaliseQuestionOptions(activeProfileQuestion) : []),
        [activeProfileQuestion],
    )
    const isMultiSelect = activeProfileQuestion?.type === 'multi_select'
    const isChoiceType = activeProfileQuestion?.type === 'dropdown' || activeProfileQuestion?.type === 'select' || activeProfileQuestion?.type === 'single_select' || isMultiSelect
    const isLongText = activeProfileQuestion?.type === 'textarea' || activeProfileQuestion?.type === 'longText' || activeProfileQuestion?.type === 'long_text'

    const usesChoiceCards = isChoiceType && activeProfileOptions.length >= 1 && activeProfileOptions.length <= 8
    const usesSearchList = isChoiceType && activeProfileOptions.length > 8

    const isYesNo = !isMultiSelect &&
        activeProfileOptions.length === 2 &&
        activeProfileOptions.some((option) => option.trim().toLowerCase() === 'yes') &&
        activeProfileOptions.some((option) => option.trim().toLowerCase() === 'no')

    const choiceCardColumns = (() => {
        const count = activeProfileOptions.length
        if (count <= 1) return 1
        if (!screens.md) return 2
        if (count === 6) return 3
        if (count === 4 || count === 8) return 4
        return 2
    })()

    const filteredLargeProfileOptions = useMemo(() => {
        const search = profileOptionSearch.trim().toLowerCase()
        if (!search) return activeProfileOptions
        return activeProfileOptions.filter((option) => option.toLowerCase().includes(search))
    }, [activeProfileOptions, profileOptionSearch])

    // Clears the search box when the question changes, adjusted during render
    // rather than as a synchronous setState in an effect.
    const [lastProfileQuestionId, setLastProfileQuestionId] = useState(activeProfileQuestion?.id)
    if (lastProfileQuestionId !== activeProfileQuestion?.id) {
        setLastProfileQuestionId(activeProfileQuestion?.id)
        setProfileOptionSearch('')
    }

    const profileProgress = programQuestions.length ? Math.round(((profileIndex + 1) / programQuestions.length) * 100) : 0

    const requiredMissingDocuments = documents.filter((item) => item.isRequired !== false && !(item.file || item.uploadedUrl))
    const readyDocuments = documents.filter((item) => Boolean(item.file || item.uploadedUrl))
    const documentsProgress = documents.length ? Math.round((readyDocuments.length / documents.length) * 100) : 100

    const selectedInterventionCount = Object.values(interventionSelections).reduce((total, ids) => total + ids.length, 0)

    const activeInterventionGroup = interventionGroups.find((group) => group.area === activeSupportArea) || null

    const goTo = (nextScreen: FlowScreen, nextDirection: FlowDirection = 'forward') => {
        setDirection(nextDirection)
        setScreen(nextScreen)
    }

    const afterPresence = () => goTo('swotStrengths')

    const afterSwot = () => {
        if (hasProfileQuestions) return goTo('profileIntro')
        if (hasDocuments) return goTo('documentsIntro')
        if (hasSupport) return goTo('supportIntro')
        onComplete()
    }

    const afterProfileQuestions = () => {
        if (hasDocuments) return goTo('documentsIntro')
        if (hasSupport) return goTo('supportIntro')
        onComplete()
    }

    const afterDocuments = () => {
        if (hasSupport) return goTo('supportIntro')
        onComplete()
    }

    const startProfileQuestions = () => {
        setProfileIndex(0)
        goTo('profileQuestion')
    }

    const setProfileAnswer = (value: string) => {
        if (!activeProfileQuestion) return
        onValuesChange({ profile: { [activeProfileQuestion.id]: value } })
    }

    const toggleProfileMultiAnswer = (option: string) => {
        if (!activeProfileQuestion) return
        const current = activeProfileAnswerList
        const maxSelections = Number(activeProfileQuestion.maxSelections || 0)
        const selected = current.includes(option)
        let next: string[]
        if (selected) {
            next = current.filter((item) => item !== option)
        } else {
            if (maxSelections && current.length >= maxSelections) return
            next = [...current, option]
        }
        onValuesChange({ profile: { [activeProfileQuestion.id]: next } })
    }

    const activeProfileHasAnswer = isMultiSelect ? activeProfileAnswerList.length > 0 : Boolean(activeProfileAnswer.trim())

    const continueProfileQuestion = () => {
        if (!activeProfileQuestion) return
        if (activeProfileQuestion.required !== false && !activeProfileHasAnswer) return

        if (profileIndex >= programQuestions.length - 1) {
            afterProfileQuestions()
            return
        }

        setDirection('forward')
        setProfileIndex((index) => index + 1)
    }

    const backProfileQuestion = () => {
        setDirection('backward')
        if (profileIndex === 0) {
            goTo('presence', 'backward')
            return
        }
        setProfileIndex((index) => Math.max(0, index - 1))
    }

    const updateDocument = (requirementId: string, patch: Partial<ProgramDocumentRequirement>) => {
        onDocumentsChange(documents.map((item) => (item.requirementId === requirementId ? { ...item, ...patch } : item)))
    }

    const toggleIntervention = (area: string, interventionId: string) => {
        const current = interventionSelections[area] || []
        const selected = current.includes(interventionId)
        onInterventionSelectionsChange({
            ...interventionSelections,
            [area]: selected ? current.filter((id) => id !== interventionId) : [...current, interventionId],
        })
    }

    const addChallenge = () => {
        const value = challengeInput.trim()
        if (!value) return
        if (challenges.some((item) => item.toLowerCase() === value.toLowerCase())) {
            setChallengeInput('')
            return
        }
        setChallenges((previous) => [...previous, value])
        setChallengeInput('')
    }

    const removeChallenge = (index: number) => {
        setChallenges((previous) => previous.filter((_, itemIndex) => itemIndex !== index))
    }

    const transition = reduceMotion
        ? { initial: { opacity: 1, x: 0 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 1, x: 0 }, transition: { duration: 0 } }
        : {
            initial: { opacity: 0, x: direction === 'forward' ? 32 : -32 },
            animate: { opacity: 1, x: 0 },
            exit: { opacity: 0, x: direction === 'forward' ? -32 : 32 },
            transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
        }

    const motionKey = screen === 'profileQuestion'
        ? `${screen}-${profileIndex}`
        : screen === 'supportDepartment'
            ? `${screen}-${activeSupportArea || 'none'}`
            : screen

    const cardStyle = { borderRadius: 24, border: `1px solid ${token.colorBorderSecondary}` }
    const introCardStyle = { ...cardStyle, background: token.colorBgContainer }
    const bodyPad = { body: { padding: 'clamp(22px, 4vw, 36px)' } }
    const introBodyPad = { body: { padding: 'clamp(28px, 5vw, 48px)', textAlign: 'center' as const } }

    const renderNavRow = (backLabel: string, onBack: () => void, nextLabel: string, onNext: () => void, nextDisabled = false, nextLoading = false) => (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 22 }}>
            <Button size="middle" icon={<ArrowLeftOutlined />} onClick={onBack} style={{ width: '100%', borderRadius: 10, fontWeight: 600 }}>
                {backLabel}
            </Button>
            <Button
                type="primary"
                size="middle"
                disabled={nextDisabled}
                loading={nextLoading}
                icon={<ArrowRightOutlined />}
                iconPosition="end"
                onClick={onNext}
                style={{ width: '100%', borderRadius: 10, fontWeight: 600 }}
            >
                {nextLabel}
            </Button>
        </div>
    )

    const renderIntro = (icon: React.ReactNode, eyebrow: string, heading: string, body: string, cta: string, onNext: () => void, onBack?: () => void, nextDisabled = false) => (
        <Card variant="borderless" styles={introBodyPad} style={introCardStyle}>
            <div style={{ width: 68, height: 68, margin: '0 auto 20px', borderRadius: 22, display: 'grid', placeItems: 'center', background: token.colorPrimaryBg, color: token.colorPrimary, fontSize: 26 }} aria-hidden="true">
                {icon}
            </div>
            <Text style={{ display: 'block', marginBottom: 8, color: token.colorPrimary, fontWeight: 700 }}>{eyebrow}</Text>
            <Title level={2} style={{ marginBottom: 10 }}>
                <TypewriterPhrase reducedMotion={Boolean(reduceMotion)} text={heading} />
            </Title>
            <Paragraph type="secondary" style={{ maxWidth: 560, margin: '0 auto 24px', fontSize: 15, lineHeight: 1.7 }}>
                {body}
            </Paragraph>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                {onBack && (
                    <Button size="large" icon={<ArrowLeftOutlined />} onClick={onBack} style={{ minWidth: 140, height: 48, borderRadius: 12, fontWeight: 600 }}>
                        Back
                    </Button>
                )}
                <Button type="primary" size="large" disabled={nextDisabled} icon={<ArrowRightOutlined />} iconPosition="end" onClick={onNext} style={{ minWidth: 180, height: 48, borderRadius: 12, fontWeight: 600 }}>
                    {cta}
                </Button>
            </div>
        </Card>
    )

    const renderChoiceCard = (option: string, selected: boolean, onClick: () => void, key: string, showYesNoIcon = false) => {
        const optionKey = option.trim().toLowerCase()
        const yesNoIcon = showYesNoIcon ? (optionKey === 'yes' ? <CheckOutlined /> : <CloseOutlined />) : null

        return (
            <button
                key={key}
                type="button"
                role={isMultiSelect ? 'checkbox' : 'radio'}
                aria-checked={selected}
                onClick={onClick}
                style={{
                    appearance: 'none',
                    width: '100%',
                    minHeight: showYesNoIcon ? 78 : 64,
                    padding: showYesNoIcon ? '12px 14px' : '10px 12px',
                    borderRadius: 14,
                    border: `1px solid ${selected ? token.colorPrimary : token.colorBorder}`,
                    background: selected ? token.colorPrimaryBg : token.colorBgContainer,
                    color: selected ? token.colorPrimary : token.colorText,
                    cursor: 'pointer',
                    font: 'inherit',
                    fontWeight: selected ? 700 : 600,
                    textAlign: 'center',
                    transition: 'border-color .2s ease, background .2s ease, color .2s ease',
                    outline: 'none',
                }}
            >
                {showYesNoIcon ? (
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                        <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 12, display: 'grid', placeItems: 'center', background: selected ? token.colorPrimary : token.colorFillSecondary, color: selected ? token.colorTextLightSolid : token.colorTextSecondary, fontSize: 16, flex: '0 0 auto' }}>
                            {yesNoIcon}
                        </span>
                        <span>{option}</span>
                    </span>
                ) : (
                    <span>{option}</span>
                )}
            </button>
        )
    }

    const renderSwotStep = (category: SwotCategory) => {
        const config = SWOT_CONFIG[category]
        const items = swotItems[category]
        const index = SWOT_ORDER.indexOf(category)
        const isFirst = index === 0
        const isLast = index === SWOT_ORDER.length - 1
        const accent = config.sentiment === 'positive' ? token.colorSuccess : token.colorError
        const accentBg = config.sentiment === 'positive' ? token.colorSuccessBg : token.colorErrorBg
        const accentBorder = config.sentiment === 'positive' ? token.colorSuccessBorder : token.colorErrorBorder

        return (
            <Card styles={bodyPad} style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: accentBg, color: accent, fontSize: 16, flex: '0 0 auto' }}>
                        <config.Icon />
                    </span>
                    <Title level={2} style={{ margin: 0 }}>{config.label}</Title>
                </div>
                <Paragraph type="secondary" style={{ fontSize: 15, marginBottom: 18, maxWidth: 620 }}>
                    {config.question} Optional, but it helps reviewers understand your business at a glance.
                </Paragraph>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10 }}>
                    <Input
                        size="large"
                        value={swotInputs[category]}
                        placeholder={config.placeholder}
                        onChange={(event) => setSwotInputs((previous) => ({ ...previous, [category]: event.target.value }))}
                        onPressEnter={(event) => {
                            event.preventDefault()
                            addSwotItem(category)
                        }}
                        style={{ borderRadius: 12 }}
                    />
                    <Button type="primary" size="large" icon={<PlusOutlined />} disabled={!swotInputs[category].trim()} onClick={() => addSwotItem(category)} style={{ borderRadius: 12, background: accent, borderColor: accent }}>
                        Add
                    </Button>
                </div>

                <div style={{ marginTop: 18, display: 'grid', gap: 10, maxHeight: 250, overflowY: 'auto' }}>
                    {items.length === 0 ? (
                        <div style={{ padding: '24px 18px', borderRadius: 14, border: `1px dashed ${token.colorBorder}`, textAlign: 'center', color: token.colorTextSecondary }}>
                            No {config.label.toLowerCase()} added yet.
                        </div>
                    ) : (
                        items.map((item, itemIndex) => (
                            <div key={`${item}-${itemIndex}`} style={{ display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr) 36px', alignItems: 'center', gap: 10, padding: '12px 12px 12px 14px', borderRadius: 14, border: `1px solid ${accentBorder}`, background: accentBg }}>
                                <div style={{ width: 30, height: 30, borderRadius: 10, display: 'grid', placeItems: 'center', background: accent, color: '#fff', fontWeight: 700, fontSize: 12 }}>
                                    {itemIndex + 1}
                                </div>
                                <Text style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{item}</Text>
                                <Button type="text" danger aria-label={`Remove ${item}`} icon={<CloseOutlined />} onClick={() => removeSwotItem(category, itemIndex)} />
                            </div>
                        ))
                    )}
                </div>

                {renderNavRow(
                    'Back',
                    () => goTo(isFirst ? 'presence' : SWOT_CONFIG[SWOT_ORDER[index - 1]].screen, 'backward'),
                    isLast ? 'Finish section' : 'Continue',
                    () => (isLast ? afterSwot() : goTo(SWOT_CONFIG[SWOT_ORDER[index + 1]].screen)),
                    false,
                )}
            </Card>
        )
    }

    const renderDocumentCard = (document: ProgramDocumentRequirement) => {
        const hasFile = Boolean(document.file || document.uploadedUrl)
        const allowedFormats = document.allowedFormats?.length ? document.allowedFormats : DEFAULT_ALLOWED_FORMATS
        const completed = hasFile && (!document.requiresExpiry || Boolean(document.expiryDate))

        return (
            <Card key={document.requirementId} size="small" style={{ borderRadius: 14, borderColor: completed ? token.colorSuccessBorder : token.colorBorderSecondary }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                        <Text strong>{document.type}</Text>
                        {document.description && (
                            <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                                {document.description}
                            </Text>
                        )}
                        <Text type="secondary" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                            {allowedFormats.join(', ').toUpperCase()} · Max {document.maxSizeMB || 10} MB
                        </Text>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
                        {hasFile && (
                            <Tag color="success" icon={<CheckOutlined />} style={{ marginInlineEnd: 0 }}>
                                Uploaded
                            </Tag>
                        )}
                        <Upload
                            beforeUpload={(file) => {
                                updateDocument(document.requirementId, { file, status: 'ready' })
                                return false
                            }}
                            fileList={document.file ? [{ uid: document.requirementId, name: document.file.name, status: 'done' as const }] : []}
                            onRemove={() => {
                                updateDocument(document.requirementId, { file: null, status: 'missing' })
                                return true
                            }}
                            maxCount={1}
                            showUploadList={false}
                        >
                            <Button size="small" type={hasFile ? 'default' : 'primary'} icon={<UploadOutlined />}>
                                {hasFile ? 'Replace' : 'Upload'}
                            </Button>
                        </Upload>
                    </div>
                </div>

                {document.requiresExpiry && (
                    <div style={{ marginTop: 12 }}>
                        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 5 }}>
                            Expiry date
                        </Text>
                        <DatePicker
                            style={{ width: '100%' }}
                            value={document.expiryDate ? dayjs(document.expiryDate) : null}
                            onChange={(date) => updateDocument(document.requirementId, { expiryDate: date ? date.format('YYYY-MM-DD') : null })}
                        />
                    </div>
                )}
            </Card>
        )
    }

    const renderHeader = () => {
        if (['welcome', 'profileIntro', 'documentsIntro', 'supportIntro'].includes(screen)) return null

        if (screen === 'profileQuestion') {
            return (
                <div style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                        <Text type="secondary" style={{ fontSize: 13 }}>Programme questions</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>{profileIndex + 1} of {programQuestions.length}</Text>
                    </div>
                    <Progress percent={profileProgress} showInfo={false} size="small" strokeColor={token.colorPrimary} trailColor={token.colorBorderSecondary} />
                </div>
            )
        }

        if (screen === 'documents') {
            return (
                <div style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                        <Text type="secondary" style={{ fontSize: 13 }}>Documents</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>{readyDocuments.length} of {documents.length} ready</Text>
                    </div>
                    <Progress percent={documentsProgress} showInfo={false} size="small" strokeColor={requiredMissingDocuments.length ? token.colorPrimary : token.colorSuccess} trailColor={token.colorBorderSecondary} />
                </div>
            )
        }

        if (screen === 'supportAreas' || screen === 'supportDepartment') {
            return (
                <div style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <Text type="secondary" style={{ fontSize: 13 }}>Support needs</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>{selectedInterventionCount} selected</Text>
                    </div>
                </div>
            )
        }

        const swotScreenIndex = SWOT_ORDER.findIndex((category) => SWOT_CONFIG[category].screen === screen)
        if (swotScreenIndex >= 0) {
            return (
                <div style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                        <Text type="secondary" style={{ fontSize: 13 }}>SWOT analysis</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>{swotScreenIndex + 1} of {SWOT_ORDER.length}</Text>
                    </div>
                    <Progress percent={Math.round(((swotScreenIndex + 1) / SWOT_ORDER.length) * 100)} showInfo={false} size="small" strokeColor={token.colorPrimary} trailColor={token.colorBorderSecondary} />
                </div>
            )
        }

        const stepLabels: Partial<Record<FlowScreen, string>> = { motivation: '1 of 3', challenges: '2 of 3', presence: '3 of 3' }
        const stepPercent: Partial<Record<FlowScreen, number>> = { motivation: 33, challenges: 66, presence: 100 }
        return (
            <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                    <Text type="secondary" style={{ fontSize: 13 }}>Getting to know your business</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{stepLabels[screen]}</Text>
                </div>
                <Progress percent={stepPercent[screen] || 0} showInfo={false} size="small" strokeColor={token.colorPrimary} trailColor={token.colorBorderSecondary} />
            </div>
        )
    }

    return (
        <div style={{ width: '100%', maxWidth: 760, margin: '0 auto' }}>
            {renderHeader()}

            <AnimatePresence mode="wait" initial={false}>
                <motion.div key={motionKey} {...transition}>
                    {screen === 'welcome' && renderIntro(
                        <MessageOutlined />,
                        'Application assistant',
                        programName ? `Let's apply to ${programName}.` : "Let's start your application.",
                        "I'll guide you through a few short questions about your business, the support you need, and the documents required. We'll do one question at a time, and your progress is saved as you go.",
                        "Let's begin",
                        () => goTo('motivation'),
                    )}

                    {screen === 'motivation' && (
                        <Card styles={bodyPad} style={cardStyle}>
                            <Title level={2} style={{ marginBottom: 8 }}>Why do you want to join this programme?</Title>
                            <Paragraph type="secondary" style={{ fontSize: 15, marginBottom: 18, maxWidth: 620 }}>
                                Tell us where your business is now, what you want to achieve, and how you hope the programme can help you get there.
                            </Paragraph>

                            <TextArea
                                value={values.motivation || ''}
                                onChange={(event) => onValuesChange({ motivation: event.target.value })}
                                placeholder="Write your motivation here..."
                                style={{ height: 220, fontSize: 16, lineHeight: 1.65, borderRadius: 14, resize: 'none' }}
                            />

                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                                <Progress type="circle" percent={motivationProgress} size={28} showInfo={false} strokeColor={canContinueMotivation ? token.colorSuccess : token.colorPrimary} />
                                <Text type="secondary" style={{ fontSize: 13 }}>{motivationChars} / {MIN_MOTIVATION_CHARS} characters</Text>
                                {saving && <Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>Saving...</Text>}
                            </div>

                            {renderNavRow('Back', () => goTo('welcome', 'backward'), 'Continue', () => goTo('challenges'), !canContinueMotivation)}
                        </Card>
                    )}

                    {screen === 'challenges' && (
                        <Card styles={bodyPad} style={cardStyle}>
                            <Title level={2} style={{ marginBottom: 8 }}>What challenges are holding your business back?</Title>
                            <Paragraph type="secondary" style={{ fontSize: 15, marginBottom: 18, maxWidth: 620 }}>
                                Add one challenge at a time. This helps us understand where you need support.
                            </Paragraph>

                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10 }}>
                                <Input
                                    size="large"
                                    value={challengeInput}
                                    placeholder="e.g. Finding new customers"
                                    onChange={(event) => setChallengeInput(event.target.value)}
                                    onPressEnter={(event) => {
                                        event.preventDefault()
                                        addChallenge()
                                    }}
                                    style={{ borderRadius: 12 }}
                                />
                                <Button type="primary" size="large" icon={<PlusOutlined />} disabled={!challengeInput.trim()} onClick={addChallenge} style={{ borderRadius: 12 }}>
                                    Add
                                </Button>
                            </div>

                            <div style={{ marginTop: 18, display: 'grid', gap: 10, maxHeight: 250, overflowY: 'auto' }}>
                                {challenges.length === 0 ? (
                                    <div style={{ padding: '24px 18px', borderRadius: 14, border: `1px dashed ${token.colorBorder}`, textAlign: 'center', color: token.colorTextSecondary }}>
                                        No challenges added yet.
                                    </div>
                                ) : (
                                    challenges.map((challenge, index) => (
                                        <div key={`${challenge}-${index}`} style={{ display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr) 36px', alignItems: 'center', gap: 10, padding: '12px 12px 12px 14px', borderRadius: 14, border: `1px solid ${token.colorBorderSecondary}`, background: token.colorFillQuaternary }}>
                                            <div style={{ width: 30, height: 30, borderRadius: 10, display: 'grid', placeItems: 'center', background: token.colorPrimaryBg, color: token.colorPrimary, fontWeight: 700, fontSize: 12 }}>
                                                {index + 1}
                                            </div>
                                            <Text style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{challenge}</Text>
                                            <Button type="text" danger aria-label={`Remove challenge ${index + 1}`} icon={<CloseOutlined />} onClick={() => removeChallenge(index)} />
                                        </div>
                                    ))
                                )}
                            </div>

                            {renderNavRow('Back', () => goTo('motivation', 'backward'), 'Continue', () => goTo('presence'), challenges.length === 0)}
                        </Card>
                    )}

                    {screen === 'presence' && (
                        <Card styles={bodyPad} style={cardStyle}>
                            <Title level={2} style={{ marginBottom: 8 }}>Where does your business show up online?</Title>
                            <Paragraph type="secondary" style={{ fontSize: 15, marginBottom: 18, maxWidth: 620 }}>
                                This is optional, but it helps us understand how customers find you.
                            </Paragraph>

                            <div style={{ display: 'grid', gap: 16 }}>
                                {([
                                    { key: 'facebook' as const, label: 'Facebook' },
                                    { key: 'instagram' as const, label: 'Instagram' },
                                    { key: 'linkedIn' as const, label: 'LinkedIn' },
                                ]).map(({ key, label }) => (
                                    <div key={key}>
                                        <Text style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>{label}</Text>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                                            {['Yes', 'No'].map((option) =>
                                                renderChoiceCard(option, values[key] === option, () => onValuesChange({ [key]: option }), `${key}-${option}`, true),
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {renderNavRow('Back', () => goTo('challenges', 'backward'), 'Continue', afterPresence, false)}
                        </Card>
                    )}

                    {screen === 'swotStrengths' && renderSwotStep('strengths')}
                    {screen === 'swotWeaknesses' && renderSwotStep('weaknesses')}
                    {screen === 'swotOpportunities' && renderSwotStep('opportunities')}
                    {screen === 'swotThreats' && renderSwotStep('threats')}

                    {screen === 'profileIntro' && renderIntro(
                        <MessageOutlined />,
                        'Application assistant',
                        'Now I need a little more about your business.',
                        `These questions are specific to${programName ? ` ${programName}` : ' this programme'}. I'll ask them one at a time so you can focus on each answer.`,
                        'Continue',
                        startProfileQuestions,
                        () => goTo('swotThreats', 'backward'),
                    )}

                    {screen === 'profileQuestion' && activeProfileQuestion && (
                        <Card styles={bodyPad} style={cardStyle}>
                            <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>Question {profileIndex + 1}</Text>
                            <Title level={2} style={{ marginBottom: 22 }}>{activeProfileQuestion.label || activeProfileQuestion.question}</Title>

                            {isChoiceType ? (
                                usesChoiceCards ? (
                                    <div role="group" aria-label={activeProfileQuestion.label} style={{ display: 'grid', gridTemplateColumns: `repeat(${choiceCardColumns}, minmax(0, 1fr))`, gap: 10, width: '100%' }}>
                                        {activeProfileOptions.map((option) =>
                                            renderChoiceCard(
                                                option,
                                                isMultiSelect ? activeProfileAnswerList.includes(option) : activeProfileAnswer === option,
                                                () => (isMultiSelect ? toggleProfileMultiAnswer(option) : setProfileAnswer(option)),
                                                option,
                                                isYesNo,
                                            ),
                                        )}
                                    </div>
                                ) : usesSearchList ? (
                                    <div>
                                        <Input
                                            size="large"
                                            allowClear
                                            prefix={<SearchOutlined />}
                                            value={profileOptionSearch}
                                            placeholder={`Search ${activeProfileOptions.length} options`}
                                            onChange={(event) => setProfileOptionSearch(event.target.value)}
                                            style={{ borderRadius: 12, marginBottom: 10 }}
                                        />
                                        <div role="group" aria-label={activeProfileQuestion.label} style={{ display: 'grid', gap: 8, maxHeight: 300, overflowY: 'auto', paddingRight: 4 }}>
                                            {filteredLargeProfileOptions.length > 0 ? (
                                                filteredLargeProfileOptions.map((option) => {
                                                    const selected = isMultiSelect ? activeProfileAnswerList.includes(option) : activeProfileAnswer === option
                                                    return (
                                                        <button
                                                            key={option}
                                                            type="button"
                                                            role={isMultiSelect ? 'checkbox' : 'radio'}
                                                            aria-checked={selected}
                                                            onClick={() => (isMultiSelect ? toggleProfileMultiAnswer(option) : setProfileAnswer(option))}
                                                            style={{ appearance: 'none', width: '100%', minHeight: 48, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 28px', alignItems: 'center', gap: 12, padding: '10px 12px 10px 14px', borderRadius: 12, border: `1px solid ${selected ? token.colorPrimary : token.colorBorderSecondary}`, background: selected ? token.colorPrimaryBg : token.colorBgContainer, color: selected ? token.colorPrimary : token.colorText, cursor: 'pointer', font: 'inherit', fontWeight: selected ? 700 : 500, textAlign: 'left', outline: 'none' }}
                                                        >
                                                            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{option}</span>
                                                            <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: 9, display: 'grid', placeItems: 'center', background: selected ? token.colorPrimary : token.colorFillSecondary, color: selected ? token.colorTextLightSolid : 'transparent', fontSize: 12 }}>
                                                                <CheckOutlined />
                                                            </span>
                                                        </button>
                                                    )
                                                })
                                            ) : (
                                                <div style={{ padding: '22px 16px', textAlign: 'center', border: `1px dashed ${token.colorBorder}`, borderRadius: 12, color: token.colorTextSecondary }}>
                                                    No options match &quot;{profileOptionSearch}&quot;.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : null
                            ) : isLongText ? (
                                <TextArea
                                    value={activeProfileAnswer}
                                    placeholder={activeProfileQuestion.placeholder || 'Type your answer'}
                                    onChange={(event) => setProfileAnswer(event.target.value)}
                                    style={{ borderRadius: 12, minHeight: 140 }}
                                />
                            ) : (
                                <Input
                                    size="large"
                                    value={activeProfileAnswer}
                                    placeholder={activeProfileQuestion.placeholder || 'Type your answer'}
                                    onChange={(event) => setProfileAnswer(event.target.value)}
                                    onPressEnter={() => {
                                        if (activeProfileAnswer.trim()) continueProfileQuestion()
                                    }}
                                    style={{ borderRadius: 12 }}
                                />
                            )}

                            <Text type="secondary" style={{ display: 'block', minHeight: 20, marginTop: 12, fontSize: 12 }}>
                                {saving ? 'Saving...' : 'Your answer is saved automatically.'}
                            </Text>

                            {renderNavRow(
                                'Back',
                                backProfileQuestion,
                                profileIndex === programQuestions.length - 1 ? 'Finish section' : 'Continue',
                                continueProfileQuestion,
                                activeProfileQuestion.required !== false && !activeProfileHasAnswer,
                            )}
                        </Card>
                    )}

                    {screen === 'documentsIntro' && renderIntro(
                        <FileTextOutlined />,
                        'Application assistant',
                        'Let’s collect your documents.',
                        'Upload each document once, and I’ll keep track of what still needs your attention.',
                        'Continue',
                        () => goTo('documents'),
                        () => goTo(hasProfileQuestions ? 'profileQuestion' : 'swotThreats', 'backward'),
                    )}

                    {screen === 'documents' && (
                        <Card styles={bodyPad} style={cardStyle}>
                            <Title level={2} style={{ marginBottom: 8 }}>Required documents</Title>
                            <Paragraph type="secondary" style={{ fontSize: 15, marginBottom: 18, maxWidth: 620 }}>
                                Tap a document to upload it. Documents marked required must be provided before you submit.
                            </Paragraph>

                            <div style={{ display: 'grid', gap: 10 }}>
                                {documents.map((document) => renderDocumentCard(document))}
                            </div>

                            {renderNavRow('Back', () => goTo('documentsIntro', 'backward'), 'Continue', afterDocuments, false)}
                        </Card>
                    )}

                    {screen === 'supportIntro' && renderIntro(
                        <AppstoreOutlined />,
                        'Application assistant',
                        'Almost there — let’s look at the support your business needs.',
                        'Pick the areas that best match what your business needs help with.',
                        'Continue',
                        () => goTo('supportAreas'),
                        () => goTo(hasDocuments ? 'documents' : hasProfileQuestions ? 'profileQuestion' : 'swotThreats', 'backward'),
                    )}

                    {screen === 'supportAreas' && (
                        <Card styles={bodyPad} style={cardStyle}>
                            <Title level={2} style={{ marginBottom: 18 }}>Choose your support areas</Title>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                                {interventionGroups.map((group) => {
                                    const count = (interventionSelections[group.area] || []).length
                                    return (
                                        <button
                                            key={group.area}
                                            type="button"
                                            onClick={() => {
                                                setActiveSupportArea(group.area)
                                                goTo('supportDepartment')
                                            }}
                                            style={{ appearance: 'none', flex: '1 1 200px', textAlign: 'left', padding: '14px 16px', borderRadius: 14, border: `1px solid ${count ? token.colorPrimary : token.colorBorderSecondary}`, background: count ? token.colorPrimaryBg : token.colorBgContainer, cursor: 'pointer', font: 'inherit' }}
                                        >
                                            <Text strong style={{ color: count ? token.colorPrimary : token.colorText, display: 'block' }}>{group.area}</Text>
                                            <Text type="secondary" style={{ fontSize: 12 }}>{count ? `${count} selected` : `${group.interventions.length} options`}</Text>
                                        </button>
                                    )
                                })}
                            </div>

                            {renderNavRow('Back', () => goTo('supportIntro', 'backward'), 'Continue', onComplete, false)}
                        </Card>
                    )}

                    {screen === 'supportDepartment' && activeInterventionGroup && (
                        <Card styles={bodyPad} style={cardStyle}>
                            <Title level={2} style={{ marginBottom: 18 }}>{activeInterventionGroup.area}</Title>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                                {activeInterventionGroup.interventions.map((intervention) => {
                                    const selected = (interventionSelections[activeInterventionGroup.area] || []).includes(intervention.id)
                                    return (
                                        <div key={intervention.id} style={{ flex: '1 1 200px' }}>
                                            {renderChoiceCard(intervention.title, selected, () => toggleIntervention(activeInterventionGroup.area, intervention.id), intervention.id)}
                                        </div>
                                    )
                                })}
                            </div>

                            {renderNavRow('Back to areas', () => goTo('supportAreas', 'backward'), 'Done', () => goTo('supportAreas'), false)}
                        </Card>
                    )}
                </motion.div>
            </AnimatePresence>
        </div>
    )
}
