import { useEffect, useState } from 'react'
import { Button, Card, Checkbox, Form, Input, Radio, Result, Select, Skeleton, Typography } from 'antd'
import { useParams } from 'react-router-dom'
import { PROSPECT_PROVINCES, PROSPECT_SECTORS, withCurrent } from '@/config/prospects'
import { isFirebaseConfigured } from '@/config/firebase'
import { useLanguage } from '@/providers/LanguageProvider'
import { callableMessage } from '@/services/programLinkService'
import { getSignupInfo, submitSignup, type SignupInfo } from '@/services/prospectsService'
import '@/styles/training.css'

/**
 * Public page behind an event's QR code or WhatsApp link (/p/<code>): a business or a person leaves their details
 * and agrees to be kept on record, and the company's team follows up. No sign-in. A hidden field catches bots.
 */
type Values = { kind: 'business' | 'person', businessName?: string, contactName: string, phone?: string, email?: string, sector?: string, province?: string, interest?: string, consent: boolean, contactAllowed?: boolean, website?: string }

export default function ProspectSignupPage() {
    const { t } = useLanguage()
    const { code = '' } = useParams()
    const [form] = Form.useForm<Values>()
    const kind = Form.useWatch('kind', form)
    const [info, setInfo] = useState<SignupInfo | null>()
    const [sending, setSending] = useState(false)
    const [done, setDone] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        if (!isFirebaseConfigured || !code) return
        let cancelled = false
        void getSignupInfo(code)
            .then((found) => { if (!cancelled) setInfo(found) })
            .catch(() => { if (!cancelled) setInfo(null) })
        return () => { cancelled = true }
    }, [code])

    const submit = async () => {
        const values = await form.validateFields()
        setSending(true)
        setError('')
        try {
            await submitSignup({ ...values, code })
            setDone(true)
        } catch (failure) {
            setError(callableMessage(failure, t('Your details could not be sent. Please try again.')))
        } finally {
            setSending(false)
        }
    }

    const company = info?.companyName || t('the programme team')
    return (
        <main className="verify-certificate-page">
            <Card className="verify-certificate-card">
                {info === undefined && isFirebaseConfigured && code ? (
                    <Skeleton active paragraph={{ rows: 6 }} />
                ) : !info ? (
                    <Result status="warning" title={t('This sign-up link is closed')} subTitle={t('Ask the person who shared it for a new one.')} />
                ) : done ? (
                    <Result status="success" title={t('Thank you!')} subTitle={t('{company} has your details and will be in touch.', undefined, { company })} />
                ) : (
                    <>
                        {info.logoUrl && <img src={info.logoUrl} alt="" style={{ maxHeight: 56, marginBottom: 12 }} />}
                        <Typography.Title level={3} style={{ marginTop: 0 }}>{info.label || t('Register your interest')}</Typography.Title>
                        <Typography.Paragraph type="secondary">
                            {info.module === 'training'
                                ? t('Leave your details and {company} will contact you about its trainings and services.', undefined, { company })
                                : t('Leave your details and {company} will contact you about its programmes for small businesses.', undefined, { company })}
                        </Typography.Paragraph>
                        <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: 'business', consent: false, contactAllowed: false }}>
                            <Form.Item name="kind" hidden={info.module !== 'training'}>
                                <Radio.Group optionType="button" options={[{ value: 'business', label: info.module === 'training' ? t('For my company') : t('For my business') }, { value: 'person', label: t('For myself') }]} />
                            </Form.Item>
                            {kind !== 'person' && (
                                <Form.Item name="businessName" label={info.module === 'training' ? t('Company name') : t('Business name')} rules={[{ required: true, whitespace: true, message: t('Enter the name.') }]}>
                                    <Input maxLength={160} autoComplete="organization" />
                                </Form.Item>
                            )}
                            <Form.Item name="contactName" label={t('Your name')} rules={[{ required: true, whitespace: true, message: t('Enter your name.') }]}>
                                <Input maxLength={120} autoComplete="name" />
                            </Form.Item>
                            <Form.Item name="phone" label={t('Phone (WhatsApp)')}><Input maxLength={40} autoComplete="tel" inputMode="tel" /></Form.Item>
                            <Form.Item name="email" label={t('Email')} rules={[{ type: 'email', message: t('Enter a valid email address.') }]}><Input maxLength={160} autoComplete="email" inputMode="email" /></Form.Item>
                            {kind !== 'person' && <Form.Item name="sector" label={t('Sector')}><Select allowClear showSearch options={withCurrent(PROSPECT_SECTORS).map((option) => ({ ...option, label: t(option.label) }))} /></Form.Item>}
                            <Form.Item name="province" label={t('Province')}><Select allowClear showSearch options={withCurrent(PROSPECT_PROVINCES)} /></Form.Item>
                            {info.module === 'training' && <Form.Item name="interest" label={t('What are you interested in?')}><Input maxLength={160} /></Form.Item>}
                            {/* Hidden from people; bots fill it in. */}
                            <Form.Item name="website" style={{ position: 'absolute', left: -10000, height: 0, overflow: 'hidden' }} aria-hidden>
                                <Input tabIndex={-1} autoComplete="off" />
                            </Form.Item>
                            <Form.Item
                                name="consent"
                                valuePropName="checked"
                                rules={[{ validator: (_, value) => (value ? Promise.resolve() : Promise.reject(new Error(t('Please agree so we can keep your details.')))) }]}
                            >
                                <Checkbox>{t('I agree that {company} keeps my details to contact me about this. I can ask for them to be removed at any time.', undefined, { company })}</Checkbox>
                            </Form.Item>
                            <Form.Item name="contactAllowed" valuePropName="checked">
                                <Checkbox>{t('You may send me WhatsApp messages or emails about it')}</Checkbox>
                            </Form.Item>
                            {error && <Typography.Paragraph type="danger">{error}</Typography.Paragraph>}
                            <Button type="primary" block size="large" loading={sending} onClick={() => void submit()}>{t('Send my details')}</Button>
                        </Form>
                    </>
                )}
            </Card>
        </main>
    )
}
