import React, { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown, Space, Typography } from 'antd'
import type { MenuProps } from 'antd'
import {
    ArrowRightOutlined,
    BarChartOutlined,
    BulbOutlined,
    CheckCircleOutlined,
    FileSearchOutlined,
    FormOutlined,
    GlobalOutlined,
    MoonOutlined,
    ProjectOutlined,
    RobotOutlined,
    TranslationOutlined,
    WhatsAppOutlined,
    SunOutlined,
    TeamOutlined,
} from '@ant-design/icons'
import { MotionConfig, motion, type Variants } from 'framer-motion'
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

// What sets the platform apart; shown straight under the hero.
const highlights: Highlight[] = [
    {
        key: 'whatsapp',
        title: 'Works on WhatsApp',
        text: 'Plans, appointments and reminders where SMEs already are.',
        icon: <WhatsAppOutlined />,
    },
    {
        key: 'language',
        title: 'English and isiZulu',
        text: 'Everyone works in the language they prefer.',
        icon: <TranslationOutlined />,
    },
    {
        key: 'ai',
        title: 'AI assistant built in',
        text: 'Drafts business plans, coaches pitches and explains every page.',
        icon: <RobotOutlined />,
    },
]

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

const steps: Step[] = [
    {
        key: 'launch',
        title: 'Launch a programme',
        text: 'Set entry criteria and the support on offer. Funders can sponsor it.',
        icon: <ProjectOutlined />,
        roles: ['incubator', 'funder'],
    },
    {
        key: 'apply',
        title: 'Select SMEs',
        text: 'SMEs apply online. You review and accept them.',
        icon: <FormOutlined />,
        roles: ['sme', 'incubator'],
    },
    {
        key: 'diagnose',
        title: 'Diagnose and plan',
        text: 'A diagnostic finds the gaps and becomes a growth plan for each SME.',
        icon: <FileSearchOutlined />,
        roles: ['sme', 'incubator'],
    },
    {
        key: 'support',
        title: 'Deliver support',
        text: 'Facilitators deliver interventions and capture proof of evidence.',
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

const fadeUp: Variants = {
    hidden: { opacity: 0, y: 18 },
    show: (delay = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.5, delay, ease: 'easeOut' } }),
}

const LandingPage: React.FC = () => {
    const navigate = useNavigate()

    const { t, language, setLanguage } = useLanguage()
    const { mode, toggleTheme } = useThemeMode()
    const { registerPageContext } = useAgent()

    const [languageOpen, setLanguageOpen] = useState(false)

    useEffect(() => {
        registerPageContext({
            pageKey: 'landing',
            pageName: 'Landing Page',
            purpose: 'Single-page landing page introducing the incubation platform to incubators, with a way in for SMEs.',
            metrics: {
                highlights: highlights.length,
                steps: steps.length,
            },
            dataSummary: {
                layout: 'Hero with product preview and two calls to action (book a demo, apply to a programme), three highlights, how-it-works steps, closing call-to-action and footer.',
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

    // Every landing call to action goes through here so clicks show up in analytics (when it is switched on).
    const track = (cta: string, source: string) => trackEvent('landing_cta_click', { cta, source })

    const goApply = (source: string) => {
        track('apply_to_programme', source)
        navigate(SIGNUP_PATH)
    }

    const goSignin = (source: string) => {
        track('sign_in', source)
        navigate(SIGNIN_PATH)
    }

    // The same two actions sit in the hero and the closing section.
    const renderCtas = (source: string) => (
        <>
            <Button
                type="primary"
                size="large"
                className="landing-get-started"
                icon={<ArrowRightOutlined />}
                href={mailto('Smart Incubation demo request')}
                onClick={() => track('book_a_demo', source)}
            >
                {t('Book a demo')}
            </Button>
            <Button
                size="large"
                className="landing-secondary-cta"
                onClick={() => goApply(source)}
            >
                {t('Apply to a programme')}
            </Button>
        </>
    )

    const year = new Date().getFullYear()

    return (
        <MotionConfig reducedMotion="user">
            <main className="landing-page">
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
                            <motion.div initial="hidden" animate="show" variants={fadeUp}>
                                <Typography.Title level={1} className="landing-title">
                                    {t('Run your incubation programme')}{' '}
                                    <span className="landing-title-accent">{t('in one place')}</span>
                                </Typography.Title>
                            </motion.div>

                            <motion.div initial="hidden" animate="show" variants={fadeUp} custom={0.08}>
                                <Typography.Paragraph className="landing-subtitle">
                                    {t('Applications, diagnostics, support and funder reports in one shared journey.')}
                                </Typography.Paragraph>
                            </motion.div>

                            <motion.div
                                className="landing-cta-group"
                                initial="hidden"
                                animate="show"
                                variants={fadeUp}
                                custom={0.16}
                            >
                                {renderCtas('hero')}
                            </motion.div>

                            <motion.p
                                className="landing-cta-hint"
                                initial="hidden"
                                animate="show"
                                variants={fadeUp}
                                custom={0.2}
                            >
                                {t('SMEs: use the link your incubator sent you, or apply here.')}
                            </motion.p>
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
                </section>

                <motion.section
                    className="landing-highlights"
                    aria-label={t('What makes it different')}
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
                </motion.section>

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

                <motion.section
                    className="landing-final-cta"
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.5 }}
                    transition={{ duration: 0.5 }}
                >
                    <Typography.Title level={2}>{t('See it with your own programme')}</Typography.Title>
                    <Typography.Paragraph>{t('We\'ll walk you through setup, delivery and reporting.')}</Typography.Paragraph>
                    <div className="landing-final-actions">{renderCtas('final')}</div>
                </motion.section>

                <footer className="landing-footer">
                    <span>© {year} {t('Smart Incubation')} · {t('Built by Quantilytix')}</span>
                    <nav className="landing-footer-links" aria-label={t('Contact us')}>
                        <a href={mailto('Smart Incubation enquiry')} onClick={() => track('contact_email', 'footer')}>{CONTACT_EMAIL}</a>
                        <a href={`tel:${CONTACT_PHONE.replace(/\s+/g, '')}`} onClick={() => track('contact_phone', 'footer')}>{CONTACT_PHONE}</a>
                        <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">{t('Privacy policy')}</a>
                        <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">{t('Terms of use')}</a>
                    </nav>
                </footer>
            </main>
        </MotionConfig>
    )
}

export default LandingPage
