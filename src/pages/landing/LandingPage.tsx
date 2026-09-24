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
    FundProjectionScreenOutlined,
    UpOutlined,
    GlobalOutlined,
    LineChartOutlined,
    MoonOutlined,
    RocketOutlined,
    SafetyCertificateOutlined,
    SunOutlined,
    TeamOutlined,
    ThunderboltOutlined,
} from '@ant-design/icons'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { LANGUAGES, type LanguageCode } from '@/config/languages'
import { useLanguage } from '@/providers/LanguageProvider'
import { useThemeMode } from '@/providers/ThemeProvider'
import { useAgent } from '@/providers/AgentProvider'
import { HolidayBanner } from '@/components/shared/HolidayBanner'
import '@/styles/landing/LandingPage.css'

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
}

const ecosystemItems: EcosystemItem[] = [
    { key: 'funding', labelKey: 'landing.leaf.funding', fallback: 'Funding', icon: <FundProjectionScreenOutlined /> },
    { key: 'mentorship', labelKey: 'landing.leaf.mentorship', fallback: 'Mentorship', icon: <TeamOutlined /> },
    { key: 'diagnostics', labelKey: 'landing.leaf.diagnostics', fallback: 'Diagnostics', icon: <LineChartOutlined /> },
    { key: 'programs', labelKey: 'landing.leaf.programs', fallback: 'Programs', icon: <BankOutlined /> },
    { key: 'tracking', labelKey: 'landing.leaf.tracking', fallback: 'Tracking', icon: <BarChartOutlined /> },
    { key: 'oversight', labelKey: 'landing.leaf.oversight', fallback: 'Oversight', icon: <SafetyCertificateOutlined /> },
]

const audienceCards: AudienceCard[] = [
    {
        key: 'sme',
        titleKey: 'landing.carousel.sme.title',
        titleFallback: 'For SMEs',
        textKey: 'landing.carousel.sme.text',
        textFallback: 'Access support, mentorship, funding opportunities and clear growth tracking.',
        icon: <RocketOutlined />,
    },
    {
        key: 'incubator',
        titleKey: 'landing.carousel.incubator.title',
        titleFallback: 'For Incubators',
        textKey: 'landing.carousel.incubator.text',
        textFallback: 'Manage programs, interventions, evidence, reporting and stakeholder visibility.',
        icon: <BankOutlined />,
    },
    {
        key: 'funders',
        titleKey: 'landing.carousel.funders.title',
        titleFallback: 'For Funders',
        textKey: 'landing.carousel.funders.text',
        textFallback: 'View verified pipelines, performance signals and funding impact.',
        icon: <CheckCircleOutlined />,
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
            },
            dataSummary: {
                layout: 'Animated one-page hero, ecosystem marquee, audience showcase and closing call-to-action.',
            },
            allowedActions: [
                {
                    key: 'explain_platform',
                    label: 'Explain platform',
                    description: 'Explain the purpose of the platform.',
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

    const scrollToShowcase = () => {
        document.getElementById('landing-showcase')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    return (
        <main className="landing-page">
            <div className="landing-bg" aria-hidden="true">
                <div className="landing-glow landing-glow-left" />
                <div className="landing-glow landing-glow-right" />
                <div className="landing-grid-texture" />
            </div>

            <HolidayBanner />

            <header className="landing-topbar">
                <span className="landing-brand-mark">
                    <BulbOutlined />
                </span>

                <span className="landing-brand-text">
                    {t('landing.brand', 'Smart Incubator')}
                </span>

                <Space size={8} className="landing-topbar-actions">
                    <Button
                        type="text"
                        shape="circle"
                        className="landing-icon-button"
                        icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                        onClick={toggleTheme}
                        aria-label="Toggle theme"
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
                            shape="circle"
                            className="landing-icon-button"
                            icon={<GlobalOutlined />}
                            aria-label="Change language"
                        />
                    </Dropdown>
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
                                    'landing.hero.subtitle',
                                    'Smart Incubator connects SMEs, incubators, funders and ecosystem partners with funding, mentorship, diagnostics and real-time oversight — all in one place.',
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
                                onClick={() => navigate('/auth')}
                            >
                                {t('landing.getStarted', 'Get Started')}
                            </Button>

                            <Button
                                type="text"
                                size="large"
                                className="landing-secondary-cta"
                                icon={<DownOutlined />}
                                onClick={scrollToShowcase}
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
                                    <span className="landing-pill" key={`${item.key}-${index}`}>
                                        <span className="landing-pill-icon">{item.icon}</span>
                                        <strong>{t(item.labelKey, item.fallback)}</strong>
                                    </span>
                                ))}
                            </div>
                        </motion.div>
                    </div>

                    <motion.div
                        className="landing-orb-wrap"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.55, delay: 0.15 }}
                    >
                        <div className="landing-orb">
                            <div className="landing-ring landing-ring-one" />
                            <div className="landing-ring landing-ring-two" />
                            <div className="landing-ring landing-ring-three" />

                            <div className="landing-orbit landing-orbit-two">
                                <span className="landing-orbit-dot" />
                            </div>
                            <div className="landing-orbit landing-orbit-three">
                                <span className="landing-orbit-dot landing-orbit-dot-alt" />
                            </div>

                            <motion.div
                                className="landing-core-icon"
                                animate={{ y: [0, -6, 0], scale: [1, 1.05, 1] }}
                                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                            >
                                <ThunderboltOutlined />
                            </motion.div>

                            <Typography.Title level={3}>
                                {t('landing.system.title', 'Smart Incubation')}
                                <span>{t('landing.system.platform', 'Platform')}</span>
                            </Typography.Title>
                        </div>
                    </motion.div>
                </div>

                <motion.button
                    type="button"
                    className="landing-scroll-cue"
                    onClick={heroCtaHidden ? scrollToTop : scrollToShowcase}
                    aria-label={heroCtaHidden ? 'Scroll to top' : 'Scroll to explore'}
                    animate={{ y: [0, 8, 0] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                >
                    {heroCtaHidden ? <UpOutlined /> : <DownOutlined />}
                </motion.button>
            </section>

            <section className="landing-showcase" id="landing-showcase">
                <motion.div
                    className="landing-showcase-head"
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.4 }}
                    transition={{ duration: 0.5 }}
                >
                    <Typography.Title level={2}>
                        {t('landing.showcase.title', 'Built for every side of the ecosystem')}
                    </Typography.Title>
                    <Typography.Paragraph>
                        {t(
                            'landing.showcase.subtitle',
                            'Whichever seat you sit in, Smart Incubator gives you the tools and visibility to move faster.',
                        )}
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
                <Button
                    type="primary"
                    size="large"
                    className="landing-get-started"
                    icon={<ArrowRightOutlined />}
                    onClick={() => navigate('/auth')}
                >
                    {t('landing.getStarted', 'Get Started')}
                </Button>
            </motion.section>

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
                            onClick={() => navigate('/auth')}
                        >
                            {t('landing.getStarted', 'Get Started')}
                        </Button>
                    </motion.div>
                )}
            </AnimatePresence>
        </main>
    )
}

export default LandingPage
