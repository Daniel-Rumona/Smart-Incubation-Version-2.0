import { CloseCircleOutlined, LoadingOutlined, LockOutlined, LoginOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { completePasswordAction, readPasswordActionEmail } from '@/services/passwordActionService'
import { getRoleHomePath } from '@/utils/roleRouting'
import '@/styles/auth/email-verification.css'
import { useLanguage } from '@/providers/LanguageProvider'

const { Paragraph, Text, Title } = Typography

type PasswordForm = { password: string, confirmPassword: string }
// checking: reading the link; ready: choose a password; failed: expired or used link; signInNeeded: password saved but sign-in failed
type PageState = 'checking' | 'ready' | 'failed' | 'signInNeeded'

/** Landing page for invite and password-reset emails (see buildPasswordActionUrl in functions/src/index.ts). */
export default function SetPasswordPage() {
    const { t } = useLanguage()
    const navigate = useNavigate()
    const [params] = useSearchParams()
    const [form] = Form.useForm<PasswordForm>()
    const code = params.get('oobCode') || ''
    const isInvite = params.get('invite') === '1'
    const [state, setState] = useState<PageState>(code ? 'checking' : 'failed')
    const [email, setEmail] = useState('')
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState('')

    useEffect(() => {
        if (!code) return
        let mounted = true
        readPasswordActionEmail(code)
            .then((address) => {
                if (!mounted) return
                setEmail(address)
                setState('ready')
            })
            .catch(() => {
                if (mounted) setState('failed')
            })
        return () => {
            mounted = false
        }
    }, [code])

    const save = async ({ password }: PasswordForm) => {
        setSaving(true)
        setSaveError('')
        let profile
        try {
            profile = await completePasswordAction(code, email, password)
        } catch (error) {
            const authCode = (error as { code?: string })?.code || ''
            if (authCode === 'auth/expired-action-code' || authCode === 'auth/invalid-action-code') setState('failed')
            else if (authCode === 'auth/weak-password') setSaveError(t('welcome.password.rule'))
            // The password is already saved when only the sign-in step fails (for example a deactivated account).
            else if (authCode.startsWith('auth/') && authCode !== 'auth/network-request-failed') setState('signInNeeded')
            else setSaveError(t('Your password could not be saved. Check your connection and try again.'))
            setSaving(false)
            return
        }
        // A full reload so the workspace reads the updated profile rather than the one cached at sign-in.
        if (!profile.emailVerified) window.location.assign('/email-verification')
        else window.location.assign(profile.firstLoginComplete ? getRoleHomePath(profile.role, profile.isApplicant, profile.smeOnboardingComplete) : '/welcome')
    }

    const copy = {
        checking: { title: t('Checking your link'), body: t('One moment while we open your secure link.') },
        ready: isInvite
            ? { title: t('Set your password'), body: t("Choose a password for {email}. You'll use it to sign in to Smart Incubation.", undefined, { email }) }
            : { title: t('Choose a new password'), body: t('Choose a new password for {email}.', undefined, { email }) },
        failed: { title: t("This link can't be used"), body: isInvite
            ? t('It may have expired or already been used. Ask your programme administrator to send you a new invitation.')
            : t('It may have expired or already been used. Request a new link from the sign-in page.') },
        signInNeeded: { title: t('Password saved'), body: t('Your password is set, but we could not sign you in automatically. Sign in with your new password to continue.') },
    }[state]

    const iconState = state === 'failed' ? 'failed' : state === 'checking' ? 'waiting' : 'success'
    const icon = state === 'checking' ? <LoadingOutlined /> : state === 'failed' ? <CloseCircleOutlined /> : <LockOutlined />

    return (
        <main className="email-verification-page">
            <Card className="email-verification-card" variant="borderless">
                <span className={`email-verification-icon is-${iconState}`}>{icon}</span>
                <Text className="email-verification-kicker">{t('Smart Incubation')}</Text>
                <Title level={1}>{copy.title}</Title>
                <Paragraph>{copy.body}</Paragraph>

                {state === 'ready' && (
                    <Form form={form} layout="vertical" requiredMark={false} className="set-password-form" onFinish={(values) => void save(values)}>
                        {/* Lets password managers save the new password against the right account. */}
                        <input type="email" name="email" value={email} autoComplete="username" readOnly hidden />
                        <Form.Item
                            name="password"
                            label={t('welcome.password.new')}
                            rules={[
                                { required: true },
                                { min: 8 },
                                { pattern: /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, message: t('welcome.password.rule') },
                            ]}
                        >
                            <Input.Password autoComplete="new-password" size="large" autoFocus />
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
                        {saveError && <Alert type="error" showIcon title={saveError} className="set-password-error" />}
                        <Button type="primary" htmlType="submit" size="large" block loading={saving}>
                            {isInvite ? t('Set password and continue') : t('Save password and sign in')}
                        </Button>
                    </Form>
                )}

                {(state === 'failed' || state === 'signInNeeded') && (
                    <Space wrap className="email-verification-actions">
                        <Button type={state === 'signInNeeded' ? 'primary' : 'default'} size="large" shape="round" icon={<LoginOutlined />} onClick={() => navigate('/auth', { replace: true })}>
                            {state === 'signInNeeded' ? t('Sign in') : t('Back to sign in')}
                        </Button>
                    </Space>
                )}
            </Card>
        </main>
    )
}
