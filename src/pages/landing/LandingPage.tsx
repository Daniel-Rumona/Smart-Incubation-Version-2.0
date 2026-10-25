import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dropdown, Space, Typography } from 'antd'
import type { MenuProps } from 'antd'
import {
    ArrowRightOutlined,
    BankOutlined,
    BarChartOutlined,
    BulbOutlined,
    CheckCircleOutlined,
    DownOutlined,
    FileSearchOutlined,
    FormOutlined,
    FundProjectionScreenOutlined,
    UpOutlined,
    GlobalOutlined,
    LineChartOutlined,
    MailOutlined,
    MoonOutlined,
    PhoneOutlined,
    ProjectOutlined,
    RobotOutlined,
    RocketOutlined,
    TranslationOutlined,
    WhatsAppOutlined,
    SafetyCertificateOutlined,
    SunOutlined,
    TeamOutlined,
    ThunderboltOutlined,
} from '@ant-design/icons'
import { AnimatePresence, MotionConfig, motion, type Variants } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { LANGUAGES, type LanguageCode } from '@/config/languages'
import { useLanguage, tEnglish } from '@/providers/LanguageProvider'
import { useThemeMode } from '@/providers/ThemeProvider'
import { useAgent } from '@/providers/AgentProvider'
import { HolidayBanner } from '@/components/shared/HolidayBanner'
import { trackEvent } from '@/lib/analytics'
import { CONTACT_EMAIL, CONTACT_PHONE, PRIVACY_URL, TERMS_URL } from '@/config/company'
import LandingProductPreview from './LandingProductPreview'
import '@/styles/landing/LandingPage.css'

const SIGNUP_PATH = '/auth?mode=signup'
const SIGNIN_PATH = '/auth'
const mailto = (subject: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`

// Headline numbers shown under the hero. The strip stays hidden while this list is empty.
// Example: { value: '1,000+', label: 'SMEs supported' }
const stats: { value: string, label: string }[] = []

type Highlight = {
    key: string
    title: string
    text: string
    icon: React.ReactNode
}

const highlights: Highlight[] = [
    {
        key: 'whatsapp',
        title: 'Updates on WhatsApp',
        text: 'SMEs and staff check plans, interventions and appointments, and get reminders, straight from WhatsApp.',
        icon: <WhatsAppOutlined />,
    },
    {
        key: 'language',
        title: 'English and isiZulu',
        text: 'Use the platform in the language you are most comfortable with.',
        icon: <TranslationOutlined />,
    },
    {
        key: 'ai',
        title: 'AI assistant built in',
        text: 'Get help drafting business plans, practising your pitch and understanding every page.',
        icon: <RobotOutlined />,
    },
]

type EcosystemItem = {
    key: string
    labelKey: string
    fallback: string
    icon: React.ReactNode
}

type AudienceCard = {
    key: string
    titleKey: string
    titleFallback: string
    textKey: string
    textFallback: string
    icon: React.ReactNode
    ctaLabel: string
    // Either an in-app route or an external href (mailto).
    ctaPath?: string
    ctaHref?: string
}

type Role = 'incubator' | 'sme' | 'funder' | 'facilitator'

type Step = {
    key: string
    title: string
    text: string
    icon: React.ReactNode
    roles: Role[]
}

const roleLabels: Record<Role, string> = {
    incubator: 'Incubator',
    sme: 'SME',
    funder: 'Funder',
    facilitator: 'Facilitator',
}

const ecosystemItems: EcosystemItem[] = [
    { key: 'funding', labelKey: 'landing.leaf.funding', fallback: 'Funding', icon: <FundProjectionScreenOutlined /> },
    { key: 'mentorship', labelKey: 'landing.leaf.mentorship', fallback: 'Mentorship', icon: <TeamOutlined /> },
    { key: 'diagnostics', labelKey: 'landing.leaf.diagnostics', fallback: 'Diagnostics', icon: <LineChartOutlined /> },
    { key: 'programs', labelKey: 'landing.leaf.programs', fallback: 'Programs', icon: <BankOutlined /> },
    { key: 'tracking', labelKey: 'landing.leaf.tracking', fallback: 'Tracking', icon: <BarChartOutlined /> },
    { key: 'oversight', labelKey: 'landing.leaf.oversight', fallback: 'Oversight', icon: <SafetyCertificateOutlined /> },
]

const steps: Step[] = [
    {
        key: 'launch',
        title: 'Launch a programme',
        text: 'Incubators set up the programme, its entry criteria and the support on offer. Funders can sponsor it.',
        icon: <ProjectOutlined />,
        roles: ['incubator', 'funder'],
    },
    {
        key: 'apply',
        title: 'Apply and get selected',
        text: 'SMEs apply online in minutes, and the incubator reviews and accepts them.',
        icon: <FormOutlined />,
        roles: ['sme', 'incubator'],
    },
    {
        key: 'diagnose',
        title: 'Diagnose and plan',
        text: 'A business diagnostic pinpoints gaps and turns into a support plan made for that SME.',
        icon: <FileSearchOutlined />,
        roles: ['sme', 'incubator'],
    },
    {
        key: 'support',
        title: 'Deliver support',
        text: 'Facilitators deliver interventions, with proof of evidence captured along the way.',
        icon: <TeamOutlined />,
        roles: ['sme', 'facilitator'],
    },
    {
        key: 'report',
        title: 'Report impact',
        text: 'Verified outcomes feed live dashboards and funder reports.',
        icon: <BarChartOutlined />,
        roles: ['incubator', 'funder'],
    },
]

const audienceCards: AudienceCard[] = [
    {
        key: 'sme',
        titleKey: 'landing.carousel.sme.title',
        titleFallback: 'For SMEs',
        textKey: 'landing.carousel.sme.text',
        textFallback: 'Access support, mentorship, funding opportunities and clear growth tracking.',
        icon: <RocketOutlined />,
        ctaLabel: 'Apply now',
        ctaPath: SIGNUP_PATH,
    },
    {
        key: 'incubator',
        titleKey: 'landing.carousel.incubator.title',
        titleFallback: 'For Incubators',
        textKey: 'landing.carousel.incubator.text',
        textFallback: 'Manage programs, interventions, evidence, reporting and stakeholder visibility.',
        icon: <BankOutlined />,
        ctaLabel: 'Book a demo',
        ctaHref: mailto('Smart Incubation demo request'),
    },
    {
        key: 'funders',
        titleKey: 'landing.carousel.funders.title',
        titleFallback: 'For Funders',
        textKey: 'landing.carousel.funders.text',
        textFallback: 'View verified pipelines, performance signals and funding impact.',
        icon: <CheckCircleOutlined />,
        ctaLabel: 'Talk to us',
        ctaHref: mailto('Smart Incubation for funders'),
    },
]

const fadeUp: Variants = {
    hidden: { opacity: 0, y: 18 },
    show: (delay = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.5, delay, ease: 'easeOut' } }),
}

const LandingPage: React.FC = () => {
    const navigate = useNavigate()
    const heroCtaRef = useRef<HTMLDivElement>(null)
    const finalCtaRef = useRef<HTMLDivElement>(null)
    const showcaseGridRef = useRef<HTMLDivElement>(null)

    const { t, language, setLanguage } = useLanguage()
    const { mode, toggleTheme } = useThemeMode()
    const { registerPageContext } = useAgent()

    const [languageOpen, setLanguageOpen] = useState(false)
    const [heroCtaHidden, setHeroCtaHidden] = useState(false)
    const [finalCtaVisible, setFinalCtaVisible] = useState(false)
    const [activeCard, setActiveCard] = useState(0)
    const showStickyCta = heroCtaHidden && !finalCtaVisible

    useEffect(() => {
        registerPageContext({
            pageKey: 'landing',
            pageName: 'Landing Page',
            purpose: 'Single-page landing page introducing the incubation platform.',
            metrics: {
                audienceCards: audienceCards.length,
                ecosystemItems: ecosystemItems.length,
                steps: steps.length,
            },
            dataSummary: {
                layout: 'Hero with product preview, how-it-works steps, audience cards with their own calls to action, closing call-to-action and footer.',
            },
            allowedActions: [
                {
                    key: 'explain_platform',
                    label: tEnglish('Explain platform'),
                    description: tEnglish('Explain the purpose of the platform.'),
                },
            ],
            updatedAt: new Date().toISOString(),
        })
    }, [registerPageContext])

    useEffect(() => {
        if (typeof IntersectionObserver === 'undefined') return

        const heroEl = heroCtaRef.current
        const finalEl = finalCtaRef.current
        if (!heroEl || !finalEl) return

        const heroObserver = new IntersectionObserver(
            ([entry]) => setHeroCtaHidden(!entry.isIntersecting),
            { threshold: 0.01 },
        )
        const finalObserver = new IntersectionObserver(
            ([entry]) => setFinalCtaVisible(entry.isIntersecting),
            { threshold: 0.15 },
        )
        heroObserver.observe(heroEl)
        finalObserver.observe(finalEl)
        return () => {
            heroObserver.disconnect()
            finalObserver.disconnect()
        }
    }, [])

    useEffect(() => {
        const el = showcaseGridRef.current
        if (!el) return

        const handleScroll = () => {
            const card = el.firstElementChild as HTMLElement | null
            if (!card) return
            const step = card.offsetWidth + 14
            const index = Math.round(el.scrollLeft / step)
            setActiveCard(Math.max(0, Math.min(index, audienceCards.length - 1)))
        }

        el.addEventListener('scroll', handleScroll, { passive: true })
        return () => el.removeEventListener('scroll', handleScroll)
    }, [])

    const languageMenuItems = useMemo<MenuProps['items']>(
        () =>
            Object.entries(LANGUAGES).map(([value, label]) => ({
                key: value,
                label: (
                    <span className="landing-language-item">
                        <span>{label}</span>
                        {language === value && <CheckCircleOutlined />}
                    </span>
                ),
                onClick: () => {
                    setLanguage(value as LanguageCode)
                    setLanguageOpen(false)
                },
            })),
        [language, setLanguage],
    )

    const scrollToSection = (id: string) => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    // Every landing call to action goes through here so clicks show up in analytics (when it is switched on).
    const track = (cta: string, source: string) => trackEvent('landing_cta_click', { cta, source })

    const goSignup = (source: string) => {
        track('get_started', source)
        navigate(SIGNUP_PATH)
    }

    const goSignin = (source: string) => {
        track('sign_in', source)
        navigate(SIGNIN_PATH)
    }

    const openAudienceCta = (card: AudienceCard) => {
        track(card.ctaLabel.toLowerCase().replace(/\s+/g, '_'), `audience_${card.key}`)
        if (card.ctaPath) navigate(card.ctaPath)
        else if (card.ctaHref) window.location.href = card.ctaHref
    }

    const year = new Date().getFullYear()

    return (
        <MotionConfig reducedMotion="user">
            <main className="landing-page">
                <div className="landing-bg" aria-hidden="true">
                    <div className="landing-glow landing-glow-left" />
                    <div className="landing-glow landing-glow-right" />
                    <div className="landing-grid-texture" />
                </div>

                <HolidayBanner />

                <header className="landing-topbar">
                    <span className="landing-brand">
                        <span className="landing-brand-mark">
                            <BulbOutlined />
                        </span>
                        <span className="landing-brand-text">{t('Smart Incubation')}</span>
                    </span>

                    <Space size={6} className="landing-topbar-actions">
                        <Button
                            type="text"
                            shape="circle"
                            className="landing-icon-button"
                            icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                            onClick={toggleTheme}
                            aria-label={t('Toggle theme')}
                        />

                        <Dropdown
                            open={languageOpen}
                            onOpenChange={setLanguageOpen}
                            trigger={['click']}
                            placement="bottomRight"
                            menu={{ items: languageMenuItems }}
                        >
                            <Button
                                type="text"
                                className="landing-icon-button landing-language-button"
                                icon={<GlobalOutlined />}
                                aria-label={t('Change language')}
                            >
                                {language.toUpperCase()}
                            </Button>
                        </Dropdown>

                        <Button
                            type="text"
                            className="landing-signin"
                            onClick={() => goSignin('topbar')}
                        >
                            {t('Sign in')}
                        </Button>
                    </Space>
                </header>

                <section className="landing-hero">
                    <div className="landing-hero-inner">
                        <div className="landing-hero-copy">
                            <motion.span
                                className="landing-eyebrow"
                                initial="hidden"
                                animate="show"
                                variants={fadeUp}
                            >
                                <ThunderboltOutlined />
                                {t('landing.eyebrow', 'AI-powered incubation platform')}
                            </motion.span>

                            <motion.div initial="hidden" animate="show" variants={fadeUp} custom={0.08}>
                                <Typography.Title level={1} className="landing-title">
                                    {t('landing.hero.titleLine1', 'One platform to grow')}
                                    <span className="landing-title-accent">
                                        {t('landing.hero.titleLine2', 'ventures and impact')}
                                    </span>
                                </Typography.Title>
                            </motion.div>

                            <motion.div initial="hidden" animate="show" variants={fadeUp} custom={0.16}>
                                <Typography.Paragraph className="landing-subtitle">
                                    {t(
                                        'Smart Incubation connects SMEs, incubators, funders and ecosystem partners with funding, mentorship, diagnostics and real-time oversight — all in one place.',
                                    )}
                                </Typography.Paragraph>
                            </motion.div>

                            <motion.div
                                ref={heroCtaRef}
                                className="landing-cta-group"
                                initial="hidden"
                                animate="show"
                                variants={fadeUp}
                                custom={0.24}
                            >
                                <Button
                                    type="primary"
                                    size="large"
                                    className="landing-get-started"
                                    icon={<ArrowRightOutlined />}
                                    onClick={() => goSignup('hero')}
                                >
                                    {t('landing.getStarted', 'Get Started')}
                                </Button>

                                <Button
                                    type="text"
                                    size="large"
                                    className="landing-secondary-cta"
                                    icon={<DownOutlined />}
                                    onClick={() => scrollToSection('landing-how')}
                                >
                                    {t('landing.seeHow', 'See how it works')}
                                </Button>
                            </motion.div>

                            <motion.div
                                className="landing-marquee"
                                initial="hidden"
                                animate="show"
                                variants={fadeUp}
                                custom={0.32}
                            >
                                <div className="landing-marquee-track">
                                    {[...ecosystemItems, ...ecosystemItems].map((item, index) => (
                                        <span
                                            className="landing-pill"
                                            key={`${item.key}-${index}`}
                                            aria-hidden={index >= ecosystemItems.length || undefined}
                                        >
                                            <span className="landing-pill-icon">{item.icon}</span>
                                            <strong>{t(item.labelKey, item.fallback)}</strong>
                                        </span>
                                    ))}
                                </div>
                            </motion.div>
                        </div>

                        <motion.div
                            className="landing-preview-wrap"
                            initial={{ opacity: 0, y: 24 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, delay: 0.15 }}
                        >
                            <LandingProductPreview />
                        </motion.div>
                    </div>

                    <motion.button
                        type="button"
                        className="landing-scroll-cue"
                        onClick={heroCtaHidden ? scrollToTop : () => scrollToSection('landing-how')}
                        aria-label={heroCtaHidden ? t('Scroll to top') : t('Scroll to explore')}
                        animate={{ y: [0, 8, 0] }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    >
                        {heroCtaHidden ? <UpOutlined /> : <DownOutlined />}
                    </motion.button>
                </section>

                {stats.length > 0 && (
                    <section className="landing-stats" aria-label={t('Platform in numbers')}>
                        {stats.map(stat => (
                            <div className="landing-stat" key={stat.label}>
                                <strong>{stat.value}</strong>
                                <span>{t(stat.label)}</span>
                            </div>
                        ))}
                    </section>
                )}

                <section className="landing-how" id="landing-how">
                    <motion.div
                        className="landing-section-head"
                        initial={{ opacity: 0, y: 16 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, amount: 0.4 }}
                        transition={{ duration: 0.5 }}
                    >
                        <span className="landing-section-kicker">{t('How it works')}</span>
                        <Typography.Title level={2}>{t('From application to measurable impact')}</Typography.Title>
                        <Typography.Paragraph>
                            {t('Incubators, SMEs, facilitators and funders work through one shared journey, so nothing gets lost between them.')}
                        </Typography.Paragraph>
                    </motion.div>

                    <ol className="landing-steps">
                        {steps.map((step, index) => (
                            <motion.li
                                key={step.key}
                                className="landing-step"
                                initial={{ opacity: 0, y: 24 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true, amount: 0.3 }}
                                transition={{ duration: 0.45, delay: index * 0.08 }}
                            >
                                <div className="landing-step-top">
                                    <span className="landing-step-icon">{step.icon}</span>
                                    <span className="landing-step-number">{String(index + 1).padStart(2, '0')}</span>
                                </div>
                                <Typography.Text strong>{t(step.title)}</Typography.Text>
                                <Typography.Paragraph>{t(step.text)}</Typography.Paragraph>
                                <span className="landing-step-roles">
                                    {step.roles.map(role => (
                                        <span key={role} className={`landing-role landing-role-${role}`}>
                                            {t(roleLabels[role])}
                                        </span>
                                    ))}
                                </span>
                            </motion.li>
                        ))}
                    </ol>
                </section>

                <section className="landing-showcase" id="landing-showcase">
                    <motion.div
                        className="landing-section-head"
                        initial={{ opacity: 0, y: 16 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, amount: 0.4 }}
                        transition={{ duration: 0.5 }}
                    >
                        <Typography.Title level={2}>
                            {t('landing.showcase.title', 'Built for every side of the ecosystem')}
                        </Typography.Title>
                        <Typography.Paragraph>
                            {t('Whichever seat you sit in, Smart Incubation gives you the tools and visibility to move faster.')}
                        </Typography.Paragraph>
                    </motion.div>

                    <div className="landing-showcase-grid" ref={showcaseGridRef}>
                        {audienceCards.map((card, index) => (
                            <motion.div
                                key={card.key}
                                className="landing-audience-card"
                                initial={{ opacity: 0, y: 24 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true, amount: 0.3 }}
                                transition={{ duration: 0.45, delay: index * 0.08 }}
                                whileHover={{ y: -6 }}
                            >
                                <span className="landing-audience-icon">{card.icon}</span>
                                <Typography.Text strong>{t(card.titleKey, card.titleFallback)}</Typography.Text>
                                <Typography.Paragraph>{t(card.textKey, card.textFallback)}</Typography.Paragraph>
                                <Button
                                    type={index === 0 ? 'primary' : 'default'}
                                    className="landing-audience-cta"
                                    onClick={() => openAudienceCta(card)}
                                >
                                    {t(card.ctaLabel)}
                                    <ArrowRightOutlined />
                                </Button>
                            </motion.div>
                        ))}
                    </div>

                    <div className="landing-showcase-dots" aria-hidden="true">
                        {audienceCards.map((card, index) => (
                            <span
                                key={card.key}
                                className={`landing-showcase-dot${index === activeCard ? ' is-active' : ''}`}
                            />
                        ))}
                    </div>

                    {/* What every side gets, folded into this section instead of a separate "Built for" block. */}
                    <motion.div
                        className="landing-highlights-grid landing-showcase-highlights"
                        aria-label={t('Built for the way SMEs work')}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, amount: 0.3 }}
                        transition={{ duration: 0.5 }}
                    >
                        {highlights.map(item => (
                            <div className="landing-highlight" key={item.key}>
                                <span className={`landing-highlight-icon landing-highlight-${item.key}`}>{item.icon}</span>
                                <div>
                                    <Typography.Text strong>{t(item.title)}</Typography.Text>
                                    <Typography.Paragraph>{t(item.text)}</Typography.Paragraph>
                                </div>
                            </div>
                        ))}
                    </motion.div>
                </section>

                <motion.section
                    className="landing-final-cta"
                    ref={finalCtaRef}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.5 }}
                    transition={{ duration: 0.5 }}
                >
                    <Typography.Title level={2}>
                        {t('landing.final.title', 'Ready to grow smarter?')}
                    </Typography.Title>
                    <Typography.Paragraph>
                        {t('landing.final.subtitle', 'Join the platform bringing incubation, funding and oversight together.')}
                    </Typography.Paragraph>
                    <div className="landing-final-actions">
                        <Button
                            type="primary"
                            size="large"
                            className="landing-get-started"
                            icon={<ArrowRightOutlined />}
                            onClick={() => goSignup('final')}
                        >
                            {t('landing.getStarted', 'Get Started')}
                        </Button>
                        <Button
                            size="large"
                            className="landing-secondary-cta landing-outline-cta"
                            href={mailto('Smart Incubation demo request')}
                            onClick={() => track('book_a_demo', 'final')}
                        >
                            {t('Book a demo')}
                        </Button>
                    </div>
                </motion.section>

                <footer className="landing-footer">
                    <div className="landing-footer-inner">
                        <div className="landing-footer-brand">
                            <span className="landing-brand">
                                <span className="landing-brand-mark">
                                    <BulbOutlined />
                                </span>
                                <span className="landing-brand-text">{t('Smart Incubation')}</span>
                            </span>
                            <p>{t('Incubation, funding and oversight in one place.')}</p>
                        </div>

                        <nav className="landing-footer-col" aria-label={t('Platform')}>
                            <strong>{t('Platform')}</strong>
                            <button type="button" onClick={() => scrollToSection('landing-how')}>{t('How it works')}</button>
                            <button type="button" onClick={() => scrollToSection('landing-showcase')}>{t('Who it is for')}</button>
                            <button type="button" onClick={() => goSignin('footer')}>{t('Sign in')}</button>
                        </nav>

                        <nav className="landing-footer-col landing-footer-contact" aria-label={t('Company')}>
                            <strong>{t('Company')}</strong>
                            <a href={mailto('Smart Incubation enquiry')} onClick={() => track('contact_email', 'footer')}>
                                <MailOutlined /> {CONTACT_EMAIL}
                            </a>
                            <a href={`tel:${CONTACT_PHONE.replace(/\s+/g, '')}`} onClick={() => track('contact_phone', 'footer')}>
                                <PhoneOutlined /> {CONTACT_PHONE}
                            </a>
                            <a href={mailto('Smart Incubation demo request')} onClick={() => track('book_a_demo', 'footer')}>
                                {t('Book a demo')}
                            </a>
                        </nav>

                        <nav className="landing-footer-col" aria-label={t('Legal')}>
                            <strong>{t('Legal')}</strong>
                            <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">{t('Privacy policy')}</a>
                            <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">{t('Terms of use')}</a>
                        </nav>
                    </div>

                    <div className="landing-footer-bottom">
                        <span>© {year} {t('Smart Incubation')}</span>
                        <span>{t('Built by Quantilytix')}</span>
                    </div>
                </footer>

                <AnimatePresence>
                    {showStickyCta && (
                        <motion.div
                            className="landing-sticky-cta"
                            initial={{ y: 80, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 80, opacity: 0 }}
                            transition={{ duration: 0.28, ease: 'easeOut' }}
                        >
                            <span className="landing-sticky-cta-text">
                                {t('landing.stickyCta', 'Ready when you are.')}
                            </span>
                            <Button
                                type="primary"
                                className="landing-get-started landing-sticky-cta-button"
                                icon={<ArrowRightOutlined />}
                                onClick={() => goSignup('sticky')}
                            >
                                {t('landing.getStarted', 'Get Started')}
                            </Button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </main>
        </MotionConfig>
    )
}

export default LandingPage
