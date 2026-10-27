import { useEffect, useState } from 'react'
import { Card, Typography } from 'antd'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { loadImpactAnalytics, type ImpactAnalytics } from '@/services/impactAnalyticsService'
import '@/styles/follow-ups.css'

/**
 * Check-backs still to chase and outcomes the SME disputes, for completed interventions in the active programme.
 * These used to sit on Impact analysis; they are work to follow up, so they live with intervention monitoring.
 */
export const FollowUpsToChaseCard = () => {
    const { t } = useLanguage()
    const { user, loading: identityLoading } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const [data, setData] = useState<ImpactAnalytics | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (identityLoading || !user) return
        // Starts out loading; when the programme changes, the previous figures stay until the new ones arrive.
        let cancelled = false
        loadImpactAnalytics(user, { activeProgramId, isAllPrograms })
            .then((result) => { if (!cancelled) setData(result) })
            .catch((error) => {
                console.error('[FOLLOW-UPS] Failed to load check-backs:', error)
                if (!cancelled) setData(null)
            })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [activeProgramId, identityLoading, isAllPrograms, user])

    const hasCheckbacks = !!data && (data.checkbacks.answered + data.checkbacks.overdue + data.outcomes.checkback_due + data.outcomes.no_checkback) > 0
    const disputes = data?.smeCheckbacks.disputes || []

    // Nothing to chase yet: leave the card out instead of showing an empty box.
    if (!loading && !hasCheckbacks && !disputes.length) return null

    return (
        <Card loading={loading || identityLoading} title={t('Follow-ups to chase')}>
            {data && (
                <>
                    <div className="follow-ups-figures">
                        <div className={data.checkbacks.overdue ? 'is-risk' : undefined}>
                            <strong>{data.checkbacks.overdue}</strong>
                            <span>{t('Overdue')}</span>
                            <small>{t('Past their check-back date')}</small>
                        </div>
                        <div>
                            <strong>{data.outcomes.checkback_due}</strong>
                            <span>{t('Due')}</span>
                            <small>{t('Waiting on an answer')}</small>
                        </div>
                        <div>
                            <strong>{data.outcomes.no_checkback}</strong>
                            <span>{t('No check-back set')}</span>
                            <small>{t('Completed without a date')}</small>
                        </div>
                        <div>
                            <strong>{data.checkbacks.answered ? `${Math.round((data.checkbacks.viaWhatsapp / data.checkbacks.answered) * 100)}%` : '—'}</strong>
                            <span>{t('Answered on WhatsApp')}</span>
                            <small>{t('Of {count} answers', undefined, { count: data.checkbacks.answered })}</small>
                        </div>
                    </div>

                    {/* Achieved by the facilitator, but the SME said No for the same round: worth a conversation. */}
                    {disputes.length > 0 && (
                        <>
                            <Typography.Text strong className="follow-ups-disputes-title">
                                {t('Disputed outcomes')} ({disputes.length})
                            </Typography.Text>
                            <div className="follow-ups-disputes">
                                {disputes.map((dispute) => (
                                    <div key={dispute.id}>
                                        <Typography.Text strong>{dispute.title}</Typography.Text>
                                        <Typography.Text type="secondary">{dispute.smeName}</Typography.Text>
                                        <Typography.Text>{t('Facilitator: Achieved · SME: No')}</Typography.Text>
                                        {dispute.note && <Typography.Text type="secondary" italic>“{dispute.note}”</Typography.Text>}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </>
            )}
        </Card>
    )
}
