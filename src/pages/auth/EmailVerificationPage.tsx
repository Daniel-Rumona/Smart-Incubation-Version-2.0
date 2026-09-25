import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, LoginOutlined, MailOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Space, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getFirebaseAuth } from '@/config/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { confirmEmailVerificationCode } from '@/services/emailVerificationActionService'
import { resendEmailVerification } from '@/services/onboardingService'
import { getRoleHomePath } from '@/utils/roleRouting'
import '@/styles/auth/email-verification.css'
import { useLanguage } from '@/providers/LanguageProvider'

const { Paragraph, Text, Title } = Typography

type VerificationState = 'checking' | 'success' | 'missing' | 'failed' | 'waiting'

export default function EmailVerificationPage() {
    const { t } = useLanguage()
    const navigate = useNavigate()
    const [params] = useSearchParams()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [state, setState] = useState<VerificationState>('checking')
    const [resending, setResending] = useState(false)

    const code = params.get('oobCode') || ''
    const isActionLink = params.get('mode') === 'verifyEmail' || !!code
    const isSignedIn = !!getFirebaseAuth().currentUser

    useEffect(() => {
        if (!isActionLink) {
            setState(user?.emailVerified ? 'success' : 'waiting')
            return
        }

        if (!code) {
            setState('missing')
            return
        }

        let mounted = true
        confirmEmailVerificationCode(code)
            .then(() => {
                if (mounted) setState('success')
            })
            .catch(() => {
                if (mounted) setState('failed')
            })

        return () => {
            mounted = false
        }
    }, [code, isActionLink, user?.emailVerified])

    const icon = useMemo(() => {
        if (state === 'checking') return <LoadingOutlined />
        if (state === 'success') return <CheckCircleOutlined />
        if (state === 'waiting') return <MailOutlined />
        return <CloseCircleOutlined />
    }, [state])

    const goToSystem = () => {
        if (!user) {
            navigate('/auth', { replace: true })
            return
        }

        window.location.assign(user.firstLoginComplete ? getRoleHomePath(user.role, user.isApplicant) : '/welcome')
    }

    const resend = async () => {
        try {
            setResending(true)
            const result = await resendEmailVerification()
            setState('waiting')
            if (result.verified) {
                setState('success')
                message.success(t('Your email is already verified.'))
            } else if (result.throttled) {
                message.info(t('A verification email was sent recently. Please wait a minute before requesting another one.'))
            } else {
                message.success(t('Verification email sent. Please check your inbox and spam folder.'))
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('Verification email could not be sent.'))
        } finally {
            setResending(false)
        }
    }

    const title = {
        checking: 'Verifying your email',
        success: 'Email verified',
        missing: 'Verification link is incomplete',
        failed: 'Verification link could not be used',
        waiting: 'Check your email',
    }[state]

    const body = {
        checking: 'Please wait while Smart Incubation confirms your secure verification link.',
        success: 'Your account email is confirmed. You can continue to your Smart Incubation workspace.',
        missing: 'This link is missing the secure code. Request a new verification email from the system.',
        failed: 'The link may have expired or already been used. Request a new verification email and try again.',
        waiting: 'We sent a branded Smart Incubation verification link to your inbox. Open it to continue.',
    }[state]

    return (
        <main className="email-verification-page">
            <Card className="email-verification-card" variant="borderless">
                <span className={`email-verification-icon is-${state}`}>{icon}</span>
                <Text className="email-verification-kicker">{t('Smart Incubation')}</Text>
                <Title level={1}>{title}</Title>
                <Paragraph>{body}</Paragraph>

                {state === 'success' && (
                    <Alert type="success" showIcon title={t('Your email address is verified.')} />
                )}

                {state === 'waiting' && (
                    <Alert type="info" showIcon title={t('Keep this tab open, then return after opening the email link.')} />
                )}

                {(state === 'missing' || state === 'failed') && (
                    <Alert type="warning" showIcon title={t('Need a fresh link?')} description={t('Use the resend option while signed in, or sign in again and request a new verification email.')} />
                )}

                <Space wrap className="email-verification-actions">
                    {state === 'success' && (
                        <Button type="primary" size="large" icon={<LoginOutlined />} onClick={goToSystem}>
                            {t('Continue to system')}
                        </Button>
                    )}

                    {state !== 'checking' && state !== 'success' && isSignedIn && (
                        <Button
                            size="large"
                            shape='round'
                            icon={<ReloadOutlined />} loading={resending} onClick={() => void resend()}>
                            {t('Resend verification email')}
                        </Button>
                    )}

                    {state !== 'checking' && state !== 'success' && (
                        <Button
                            size="large"
                            shape='round'
                            onClick={() => navigate('/auth', { replace: true })}>
                            {t('Back to sign in')}
                        </Button>
                    )}
                </Space>
            </Card>
        </main>
    )
}
