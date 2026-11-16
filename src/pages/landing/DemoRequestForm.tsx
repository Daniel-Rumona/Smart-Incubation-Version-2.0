import { useState } from 'react'
import { Alert, Button, Form, Input, Radio, Result } from 'antd'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '@/config/firebase'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { useLanguage } from '@/providers/LanguageProvider'
import { trackEvent } from '@/lib/analytics'

/**
 * "Book a demo": a short form so the team knows who is asking and can prepare the right demo. It goes to the
 * submitDemoRequest Cloud Function (functions/src/demoRequests.ts), which saves it and emails the sales contacts.
 * If that fails, the visitor can still send the pre-written email (fallbackMailto).
 */

type Role = 'incubator' | 'funder' | 'sme' | 'consultant' | 'other'
type Size = 'small' | 'medium' | 'large'
type Values = { role?: Role; name?: string; email?: string; organisation?: string; phone?: string; size?: Size; interest?: string; availability?: string; website?: string }

const ROLE_OPTIONS: Array<{ value: Role; label: string; hint: string }> = [
    { value: 'incubator', label: 'Incubator / ESD programme team', hint: 'You run a programme for SMEs' },
    { value: 'funder', label: 'Funder or corporate sponsor', hint: 'You fund or sponsor a programme' },
    { value: 'sme', label: 'SME', hint: 'You run a small business' },
    { value: 'consultant', label: 'Consultant or service provider', hint: 'You deliver support to SMEs' },
    { value: 'other', label: 'Government / other', hint: 'Something else' },
]

export function DemoRequestForm({ open, onClose, fallbackMailto }: { open: boolean; onClose: () => void; fallbackMailto: string }) {
    const { t, language } = useLanguage()
    const [form] = Form.useForm<Values>()
    const role = Form.useWatch('role', form)
    const [sending, setSending] = useState(false)
    const [sent, setSent] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const close = () => {
        onClose()
        // Reset after the sheet has closed, so it doesn't visibly empty while animating out.
        window.setTimeout(() => { setSent(false); setError(null); form.resetFields() }, 300)
    }

    const submit = async (values: Values) => {
        setSending(true)
        setError(null)
        try {
            await httpsCallable(getFunctions(firebaseApp, 'us-central1'), 'submitDemoRequest')({ ...values, language })
            trackEvent('landing_cta_click', { cta: 'demo_request_sent', source: values.role || '' })
            setSent(true)
        } catch (failure) {
            const code = (failure as { code?: string })?.code || ''
            setError(code.includes('resource-exhausted')
                ? t('Too many requests from this connection. Please try again later or email us directly.')
                : code.includes('invalid-argument')
                    ? (failure as Error).message
                    : t('Your request could not be sent. Please try again, or email us directly.'))
        } finally {
            setSending(false)
        }
    }

    const needsOrganisation = role && role !== 'sme'
    const asksSize = role === 'incubator' || role === 'funder'

    return (
        <ResponsiveModal
            open={open}
            onClose={close}
            title={sent ? undefined : t('Book a demo')}
            width={560}
            centered
            className="demo-request"
            destroyOnHidden={false}
            footer={sent ? null : <Button type="primary" block size="large" loading={sending} onClick={() => form.submit()}>{t('Send request')}</Button>}
        >
            {sent ? (
                <Result
                    status="success"
                    title={t('Thanks, we’ll be in touch')}
                    subTitle={t('We’ll email you to arrange a time for your demo.')}
                    extra={<Button type="primary" onClick={close}>{t('Done')}</Button>}
                />
            ) : (
                <Form form={form} layout="vertical" requiredMark="optional" onFinish={(values) => void submit(values)} className="demo-request-form">
                    <p className="demo-request-intro">{t('Tell us a little about you so we can prepare the right demo.')}</p>

                    <Form.Item name="role" label={t('Which best describes you?')} rules={[{ required: true, message: t('Choose the option that best describes you.') }]}>
                        <Radio.Group className="demo-request-roles">
                            {ROLE_OPTIONS.map((option) => (
                                <Radio.Button key={option.value} value={option.value}>
                                    <strong>{t(option.label)}</strong>
                                    <small>{t(option.hint)}</small>
                                </Radio.Button>
                            ))}
                        </Radio.Group>
                    </Form.Item>

                    <div className="demo-request-pair">
                        <Form.Item name="name" label={t('Your name')} rules={[{ required: true, message: t('Enter your name.') }]}>
                            <Input autoComplete="name" maxLength={120} />
                        </Form.Item>
                        <Form.Item name="email" label={t('Work email')} rules={[{ required: true, type: 'email', message: t('Enter a valid email address.') }]}>
                            <Input autoComplete="email" inputMode="email" maxLength={200} />
                        </Form.Item>
                    </div>

                    <div className="demo-request-pair">
                        <Form.Item name="organisation" label={t('Organisation')} rules={needsOrganisation ? [{ required: true, message: t('Enter your organisation.') }] : []}>
                            <Input autoComplete="organization" maxLength={160} />
                        </Form.Item>
                        <Form.Item name="phone" label={t('Phone')}>
                            <Input autoComplete="tel" inputMode="tel" maxLength={40} />
                        </Form.Item>
                    </div>

                    {asksSize && (
                        <Form.Item name="size" label={t('How many SMEs are in your programme?')}>
                            <Radio.Group optionType="button" className="demo-request-size" options={[
                                { value: 'small', label: t('Under 20') },
                                { value: 'medium', label: t('20 to 100') },
                                { value: 'large', label: t('More than 100') },
                            ]} />
                        </Form.Item>
                    )}

                    <Form.Item name="interest" label={t('What would you like to see?')}>
                        <Input.TextArea rows={2} maxLength={500} placeholder={t('For example: diagnostics, funder reporting, WhatsApp updates')} />
                    </Form.Item>

                    <Form.Item name="availability" label={t('When suits you?')}>
                        <Input maxLength={160} placeholder={t('For example: Tuesday or Thursday mornings')} />
                    </Form.Item>

                    {/* Honeypot: hidden from people, filled in by simple bots. */}
                    <Form.Item name="website" className="demo-request-trap" aria-hidden="true">
                        <Input tabIndex={-1} autoComplete="off" />
                    </Form.Item>

                    {error && (
                        <Alert
                            type="error"
                            showIcon
                            message={error}
                            action={<a href={fallbackMailto}>{t('Email us instead')}</a>}
                        />
                    )}
                </Form>
            )}
        </ResponsiveModal>
    )
}

export default DemoRequestForm
