import { useEffect, useState } from 'react'
import { Button, Typography } from 'antd'
import { CheckOutlined, EditOutlined, FileDoneOutlined } from '@ant-design/icons'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import SignDocumentModal from '@/components/shared/SignDocumentModal'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { confirmIncubateeGrowthPlan, loadIncubateeWorkspace } from '@/services/incubateeWorkspaceService'
import type { IncubateeWorkspace } from '@/types/incubatee'
import { markPlanReadyShown } from '@/utils/planReadyPrompt'
import '@/styles/incubatee-plan-ready.css'

const { Text, Title } = Typography

const EASE_OUT = [0.23, 1, 0.32, 1] as const

const formatDate = (value?: string) => (value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')

/**
 * Shown once per sign-in after operations approves the SME's growth plan, until the SME confirms
 * it. The plan settles in piece by piece: a first-time moment, so it gets a little ceremony.
 */
export default function IncubateePlanReadyPage() {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const reduce = useReducedMotion()

    const [workspace, setWorkspace] = useState<IncubateeWorkspace | null>()
    const [signing, setSigning] = useState(false)
    const [confirmed, setConfirmed] = useState(false)

    useEffect(() => {
        if (!user) return
        markPlanReadyShown(user.uid)
        const timeout = window.setTimeout(() => {
            void loadIncubateeWorkspace(user)
                .then((loaded) => {
                    // Nothing to confirm (already done, or not ready): this page has no job.
                    if (!loaded?.growthPlanAvailable || loaded.growthPlanConfirmed) {
                        navigate('/incubatee', { replace: true })
                        return
                    }
                    setWorkspace(loaded)
                })
                .catch((error) => {
                    console.error('Could not load the growth plan.', error)
                    navigate('/incubatee', { replace: true })
                })
        }, 0)
        return () => window.clearTimeout(timeout)
    }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

    if (!workspace) return <PageSkeleton variant="detail" label={t('Loading your growth plan')} />

    // Signing happens in SignDocumentModal, which writes the signature out while this saves;
    // the "all set" screen follows once the person closes it.
    const confirm = async () => {
        if (!user) throw new Error('not-ready')
        await confirmIncubateeGrowthPlan(workspace, user)
    }
    const signError = (error: unknown) => (error instanceof Error && error.message === 'missing-signature'
        ? t('Please set up your signature on the Welcome page before confirming.')
        : t('The diagnostic plan could not be confirmed.'))

    const firstName = (user?.name || user?.displayName || '').trim().split(/\s+/)[0]
    const interventions = workspace.requiredInterventions
    const approval = workspace.operationsPlanConfirmation
    const hasSignature = Boolean(user?.signatureURL)

    // Entrances rise a short way and fade in (ease-out, ~half a second), one after another.
    // Reduced motion keeps the fade and drops the movement.
    const rise: Variants = {
        hidden: { opacity: 0, transform: reduce ? 'translateY(0px)' : 'translateY(14px)' },
        shown: { opacity: 1, transform: 'translateY(0px)', transition: { duration: reduce ? 0.2 : 0.5, ease: EASE_OUT } },
    }
    const sequence: Variants = {
        hidden: {},
        shown: { transition: { staggerChildren: reduce ? 0 : 0.12, delayChildren: reduce ? 0 : 0.1 } },
    }
    const list: Variants = {
        hidden: {},
        shown: { transition: { staggerChildren: reduce ? 0 : 0.06, delayChildren: reduce ? 0 : 0.15 } },
    }
    // The badge pops in with a little spring; nothing appears from nothing, so it starts at 0.6.
    const pop: Variants = {
        hidden: { opacity: 0, transform: reduce ? 'scale(1)' : 'scale(0.6)' },
        shown: { opacity: 1, transform: 'scale(1)', transition: reduce ? { duration: 0.2 } : { type: 'spring', duration: 0.6, bounce: 0.3 } },
    }

    return (
        <DashboardPage className="incubatee-page plan-ready-page">
            <AnimatePresence mode="wait" initial>
                {!confirmed ? (
                    <motion.section
                        key="ready"
                        className="plan-ready"
                        variants={sequence}
                        initial="hidden"
                        animate="shown"
                        exit={{ opacity: 0, transform: reduce ? 'translateY(0px)' : 'translateY(-8px)', transition: { duration: 0.2, ease: EASE_OUT } }}
                    >
                        <motion.span className="plan-ready-badge" variants={pop} aria-hidden="true"><FileDoneOutlined /></motion.span>

                        <motion.div variants={rise}>
                            <Title level={2} className="plan-ready-title">
                                {firstName ? t('Your growth plan is ready, {name}', undefined, { name: firstName }) : t('Your growth plan is ready')}
                            </Title>
                        </motion.div>
                        <motion.div variants={rise}>
                            <Text type="secondary" className="plan-ready-intro">
                                {workspace.programName
                                    ? t('Operations has put together the support {business} will get in {programme}. Have a look, then confirm it to get started.', undefined, { business: workspace.businessName, programme: workspace.programName })
                                    : t('Operations has put together the support {business} will get. Have a look, then confirm it to get started.', undefined, { business: workspace.businessName })}
                            </Text>
                        </motion.div>

                        <motion.div className="plan-ready-card" variants={rise}>
                            <div className="plan-ready-card-head">
                                <Text strong>{t("What's in your plan")}</Text>
                                <Text type="secondary" className="plan-ready-count">
                                    {interventions.length === 1 ? t('1 intervention') : t('{count} interventions', undefined, { count: interventions.length })}
                                </Text>
                            </div>
                            <motion.ol className="plan-ready-list" variants={list}>
                                {interventions.map((item, index) => {
                                    const steps = item.steps?.length || 0
                                    return (
                                        <motion.li key={item.id || index} className="plan-ready-item" variants={rise}>
                                            <span className="plan-ready-number" aria-hidden="true">{index + 1}</span>
                                            <span className="plan-ready-item-text">
                                                <Text strong>{item.title}</Text>
                                                <Text type="secondary" className="plan-ready-meta">
                                                    {[item.areaOfSupport || t('General support'), steps > 1 ? t('{count} steps', undefined, { count: steps }) : null].filter(Boolean).join(' · ')}
                                                </Text>
                                            </span>
                                        </motion.li>
                                    )
                                })}
                            </motion.ol>
                        </motion.div>

                        {approval && (
                            <motion.div className="plan-ready-card plan-ready-approval" variants={rise}>
                                <span className="plan-ready-tick" aria-hidden="true"><CheckOutlined /></span>
                                <span className="plan-ready-item-text">
                                    <Text strong>{t('Approved by operations')}</Text>
                                    <Text type="secondary" className="plan-ready-meta">{[approval.name || approval.email, formatDate(approval.confirmedAt)].filter(Boolean).join(' · ')}</Text>
                                </span>
                                {approval.signatureURL && <img src={approval.signatureURL} alt={t('Operations signature')} className="plan-ready-signature" />}
                            </motion.div>
                        )}

                        <motion.div className="plan-ready-actions" variants={rise}>
                            {hasSignature ? (
                                <>
                                    <Button type="primary" size="large" onClick={() => setSigning(true)} className="plan-ready-confirm">
                                        {t('Confirm with my signature')}
                                    </Button>
                                    <Text type="secondary" className="plan-ready-note">{t('Your saved signature is added and the plan is acknowledged.')}</Text>
                                </>
                            ) : (
                                <>
                                    <Button type="primary" size="large" icon={<EditOutlined />} onClick={() => navigate('/welcome')} className="plan-ready-confirm">
                                        {t('Set up your signature first')}
                                    </Button>
                                    <Text type="secondary" className="plan-ready-note">{t('Your plan is signed off with your saved signature. Add it on the Welcome page, then come back to confirm.')}</Text>
                                </>
                            )}
                            <Button type="link" onClick={() => navigate('/incubatee/diagnostic-plan')}>{t('Read the full plan first')}</Button>
                            <Button type="text" size="small" className="plan-ready-later" onClick={() => navigate('/incubatee')}>{t('Remind me later')}</Button>
                        </motion.div>
                    </motion.section>
                ) : (
                    <motion.section key="done" className="plan-ready is-done" variants={sequence} initial="hidden" animate="shown">
                        <motion.span className="plan-ready-badge is-done" variants={pop} aria-hidden="true"><CheckOutlined /></motion.span>
                        <motion.div variants={rise}>
                            <Title level={2} className="plan-ready-title">{t("You're all set")}</Title>
                        </motion.div>
                        <motion.div variants={rise}>
                            <Text type="secondary" className="plan-ready-intro">
                                {t('Your plan is confirmed. Your facilitators will be in touch about your first sessions.')}
                            </Text>
                        </motion.div>
                        <motion.div className="plan-ready-actions" variants={rise}>
                            <Button type="primary" size="large" className="plan-ready-confirm" onClick={() => navigate('/incubatee', { replace: true })}>
                                {t('Go to my dashboard')}
                            </Button>
                        </motion.div>
                    </motion.section>
                )}
            </AnimatePresence>

            <SignDocumentModal
                open={signing}
                onClose={() => setSigning(false)}
                title={t('Sign your growth plan')}
                description={t('This applies your saved signature and accepts the interventions on the plan.')}
                signLabel={t('Sign and confirm')}
                onSign={confirm}
                onSigned={() => setConfirmed(true)}
                signedText={t('Diagnostic plan confirmed')}
                errorText={signError}
            />
        </DashboardPage>
    )
}
