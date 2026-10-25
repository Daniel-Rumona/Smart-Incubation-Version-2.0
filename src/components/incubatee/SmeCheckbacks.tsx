import { useMemo, useState } from 'react'
import { App, Button, Input, Segmented, Typography } from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { SME_CHECKBACK_ANSWERS, recordSmeCheckback, smeCheckbackRound, type SmeCheckbackAnswer } from '@/services/smeCheckbackService'
import type { IncubateeIntervention } from '@/types/incubatee'

type Props = {
    interventions: IncubateeIntervention[]
    onAnswered: () => void
}

/**
 * "Has this change happened?" for each completed intervention whose check-back is open to the SME. Their answer sits
 * beside the facilitator's (it never changes the official result) and feeds Impact analysis. Shown only when one is open.
 */
export function SmeCheckbacks({ interventions, onAnswered }: Props) {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [answers, setAnswers] = useState<Record<string, SmeCheckbackAnswer>>({})
    const [notes, setNotes] = useState<Record<string, string>>({})
    const [saving, setSaving] = useState<string>()

    const open = useMemo(() => interventions
        .map((item) => ({ item, round: smeCheckbackRound(item.raw) }))
        .filter((entry): entry is { item: IncubateeIntervention, round: number } => entry.round !== null), [interventions])

    if (!open.length || !user) return null

    const send = async (item: IncubateeIntervention, round: number) => {
        const answer = answers[item.id]
        if (!answer) return
        try {
            setSaving(item.id)
            await recordSmeCheckback(item.id, { answer, round, note: notes[item.id] }, { uid: user.uid, name: user.name || user.displayName || '' })
            message.success(t('Thank you, your answer is saved.'))
            onAnswered()
        } catch {
            message.error(t('Your answer could not be saved. Please try again.'))
        } finally {
            setSaving(undefined)
        }
    }

    return (
        <section className="sme-checkbacks" aria-label={t('Check-backs')}>
            <h3 className="interventions-group-head"><SyncOutlined aria-hidden /> {t('Check-backs')}</h3>
            {open.map(({ item, round }) => {
                const definition = (item.raw.outcomeDefinition || {}) as { intendedOutcome?: string }
                return (
                    <div key={item.id} className="sme-checkback">
                        <Typography.Text strong>{item.title}</Typography.Text>
                        {definition.intendedOutcome && (
                            <Typography.Text type="secondary">{t('It set out to: {change}', undefined, { change: definition.intendedOutcome })}</Typography.Text>
                        )}
                        <Typography.Text className="sme-checkback-question">{t('From what you see in your business, has this change happened?')}</Typography.Text>
                        <Segmented<SmeCheckbackAnswer>
                            block
                            value={answers[item.id]}
                            onChange={(value) => setAnswers((current) => ({ ...current, [item.id]: value }))}
                            options={SME_CHECKBACK_ANSWERS.map((option) => ({ value: option.value, label: t(option.label) }))}
                        />
                        {answers[item.id] && (
                            <>
                                <Input.TextArea
                                    rows={2}
                                    maxLength={500}
                                    value={notes[item.id]}
                                    onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                                    placeholder={t('Optional: what have you seen? For example “we now invoice every month”.')}
                                />
                                <Button type="primary" block loading={saving === item.id} onClick={() => void send(item, round)}>{t('Send answer')}</Button>
                            </>
                        )}
                    </div>
                )
            })}
        </section>
    )
}

export default SmeCheckbacks
