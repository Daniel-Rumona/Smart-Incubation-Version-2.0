import {
  ArrowLeftOutlined,
  BulbOutlined,
  CheckCircleFilled,
  EyeInvisibleOutlined,
  EyeTwoTone,
  FacebookFilled,
  GoogleOutlined,
  GlobalOutlined,
  LockOutlined,
  LoginOutlined,
  MailOutlined,
  MoonOutlined,
  SunOutlined,
  UserAddOutlined,
  UserOutlined,
} from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Divider,
  Dropdown,
  Form,
  Input,
  Modal,
  Segmented,
  Space,
  Typography,
} from 'antd'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useThemeMode } from '@/providers/ThemeProvider'
import { useLanguage } from '@/providers/LanguageProvider'
import {
  loginUser,
  loginWithFacebook,
  loginWithGoogle,
  registerUser,
  sendPasswordResetLink,
} from '@/services/authService'
import { getAuthErrorCode, getAuthFriendlyError, isAuthCancelled } from '@/utils/authErrors'
import { getRoleHomePath } from '@/utils/roleRouting'
import { readPendingProgramLink, rememberProgramLinkOnAccount } from '@/services/programLinkService'
import { getFirebaseAuth } from '@/config/firebase'
import { LANGUAGES, type LanguageCode } from '@/config/languages'
import { PRIVACY_URL, TERMS_URL } from '@/config/company'
import { HolidayBanner } from '@/components/shared/HolidayBanner'
// Photo: Unsplash (unsplash.com/photos/8kMbEUF8kIQ), free Unsplash licence.
import authPanelPhoto from '@/assets/auth-panel.jpg'
import { singleActionFooter } from '@/components/shared/modalFooter'
import '@/styles/auth/auth.css'

const { Title, Paragraph, Text } = Typography

type AuthMode = 'login' | 'signup'

// Which button is busy, so only that one shows a spinner.
type PendingAction = 'email' | 'google' | 'facebook' | null

type AuthFormValues = {
  name?: string
  email: string
  password: string
}

type ResetPasswordValues = {
  email: string
}

type AuthError = {
  message: string
  code?: string
}

const MIN_PASSWORD_LENGTH = 8

// Shown on the brand panel (desktop) beside the form.
const panelPoints = [
  'Apply to programmes and track your application',
  'Get a business diagnostic and a support plan made for you',
  'Updates and reminders on WhatsApp',
]

export default function AuthPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { mode: themeMode, toggleTheme } = useThemeMode()
  const { t, language, setLanguage } = useLanguage()

  const [searchParams] = useSearchParams()
  // A programme link lands on the register side; everyone else starts on login as before.
  const [authMode, setAuthMode] = useState<AuthMode>(() => (searchParams.get('mode') === 'signup' ? 'signup' : 'login'))
  const [pending, setPending] = useState<PendingAction>(null)
  const [authError, setAuthError] = useState<AuthError | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  const [form] = Form.useForm<AuthFormValues>()
  const [resetForm] = Form.useForm<ResetPasswordValues>()

  const isLogin = authMode === 'login'
  const languageItems = Object.entries(LANGUAGES).map(([value, label]) => ({
    key: value,
    label,
    onClick: () => setLanguage(value as LanguageCode),
  }))

  const copy = useMemo(() => {
    if (isLogin) {
      return {
        title: t('auth.loginTitle', 'Welcome back'),
        subtitle: t(
          'auth.loginSubtitle',
          'Sign in to continue managing your incubation workspace.',
        ),
        submit: t('auth.loginButton', 'Sign in'),
        socialDivider: t('auth.continueWith', 'Or sign in with'),
      }
    }

    return {
      title: t('auth.signupTitle', 'Create your account'),
      subtitle: t(
        'auth.signupSubtitle',
        'It takes a minute. Our assistant, Thuso, will help you set up your profile next.',
      ),
      submit: t('auth.signupButton', 'Create account'),
      socialDivider: t('Or sign up with'),
    }
  }, [isLogin, t])

  // Switching Sign in / Create account replays the form side's entrance (auth.css), so the new form
  // drifts in the same way the page did. The switch itself stays put: it is what was just pressed.
  const formPanelRef = useRef<HTMLDivElement>(null)
  const hasSwitchedMode = useRef(false)
  useEffect(() => {
    if (!hasSwitchedMode.current) { hasSwitchedMode.current = true; return }
    formPanelRef.current?.getAnimations({ subtree: true }).forEach((animation) => {
      if (!(animation instanceof CSSAnimation) || animation.animationName !== 'auth-rise-in') return
      const target = (animation.effect as KeyframeEffect | null)?.target
      if (target instanceof Element && target.closest('.auth-segmented, .auth-mobile-brand')) return
      animation.cancel()
      animation.play()
    })
  }, [authMode])

  // Keep the email when switching tabs; clear everything else.
  const handleModeChange = (value: AuthMode) => {
    setAuthMode(value)
    setAuthError(null)
    form.resetFields(['name', 'password'])
  }

  const showError = (error: unknown) => {
    if (isAuthCancelled(error)) return
    setAuthError({ message: getAuthFriendlyError(error), code: getAuthErrorCode(error) })
  }

  const redirectAfterAuth = (role?: string, isApplicant = false, firstLoginComplete = false, emailVerified = false, smeOnboardingComplete = true) => {
    // Before anything else: email verification is often finished on another device, which would lose a
    // programme link that only lives in this browser.
    const uid = getFirebaseAuth().currentUser?.uid
    if (uid && role === 'incubatee') void rememberProgramLinkOnAccount(uid)

    if (!emailVerified) {
      navigate('/email-verification', { replace: true })
      return
    }

    // An existing SME who opened a programme link: finish joining it instead of landing on their home page.
    if (firstLoginComplete && role === 'incubatee' && readPendingProgramLink()) {
      navigate('/applicant/onboarding', { replace: true })
      return
    }

    // Auth state and the identity provider update independently. Starting the workspace with a
    // fresh document load avoids redirecting a newly verified account through the stale identity
    // that was rendered by the sign-in page just before this success callback.
    window.location.assign(firstLoginComplete ? getRoleHomePath(role, isApplicant, smeOnboardingComplete) : '/welcome')
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setAuthError(null)
      setPending('email')

      if (isLogin) {
        const { profile } = await loginUser(values.email, values.password)

        message.success(t('auth.loginSuccess', 'Login successful'))
        redirectAfterAuth(profile.role, profile.isApplicant, profile.firstLoginComplete, profile.emailVerified, profile.smeOnboardingComplete)
        return
      }

      const { profile } = await registerUser({
        name: values.name || '',
        email: values.email,
        password: values.password,
      })

      message.success(
        t(
          'auth.signupSuccess',
          'Account created. A verification email has been sent to you.',
        ),
      )

      redirectAfterAuth(profile.role, profile.isApplicant, profile.firstLoginComplete, profile.emailVerified, profile.smeOnboardingComplete)
    } catch (error) {
      // validateFields rejects with field errors, which the form already shows inline.
      if (error && typeof error === 'object' && 'errorFields' in error) return
      showError(error)
    } finally {
      setPending(null)
    }
  }

  const handleSocialLogin = async (provider: 'google' | 'facebook') => {
    try {
      setAuthError(null)
      setPending(provider)

      const { profile } = provider === 'google' ? await loginWithGoogle() : await loginWithFacebook()

      message.success(
        provider === 'google'
          ? t('auth.googleSuccess', 'Google sign-in successful')
          : t('auth.facebookSuccess', 'Facebook sign-in successful'),
      )
      redirectAfterAuth(profile.role, profile.isApplicant, profile.firstLoginComplete, profile.emailVerified, profile.smeOnboardingComplete)
    } catch (error) {
      showError(error)
    } finally {
      setPending(null)
    }
  }

  const openResetModal = () => {
    const currentEmail = form.getFieldValue('email')
    resetForm.setFieldsValue({ email: currentEmail || '' })
    setResetOpen(true)
  }

  const handleSendResetLink = async () => {
    try {
      const values = await resetForm.validateFields()
      setResetLoading(true)

      await sendPasswordResetLink(values.email)

      message.success(
        t('auth.resetSent', 'Password reset link sent. Please check your email.'),
      )

      setResetOpen(false)
      resetForm.resetFields()
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return
      message.error(t(getAuthFriendlyError(error)))
    } finally {
      setResetLoading(false)
    }
  }

  // A follow-up link under the error, for the two mistakes people make most.
  const errorAction = (() => {
    if (authError?.code === 'auth/email-already-in-use' && !isLogin) {
      return (
        <Button type="link" size="small" onClick={() => handleModeChange('login')}>
          {t('Sign in instead')}
        </Button>
      )
    }
    if (authError?.code === 'auth/invalid-credential' && isLogin) {
      return (
        <Button type="link" size="small" onClick={openResetModal}>
          {t('Reset password')}
        </Button>
      )
    }
    return undefined
  })()

  // "By creating an account you agree to the {terms} and {privacy}." with the placeholders turned into links.
  const consentText = t('By creating an account you agree to the {terms} and {privacy}.')
    .split(/(\{terms\}|\{privacy\})/)
    .map((part, index) => {
      if (part === '{terms}') {
        return <a key={index} href={TERMS_URL} target="_blank" rel="noopener noreferrer">{t('Terms of Use')}</a>
      }
      if (part === '{privacy}') {
        return <a key={index} href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">{t('Privacy Policy')}</a>
      }
      return <Fragment key={index}>{part}</Fragment>
    })

  return (
    <main className="auth-page">
      {/* No bar: just the three controls, floating in the corners (the logo is on the card). */}
      <header className="auth-topbar">
        <Button
          type="text"
          shape="circle"
          className="auth-icon-btn"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/')}
          aria-label={t('common.back', 'Back')}
        />

        <Space size={6}>
          <Button
            type="text"
            shape="circle"
            className="auth-icon-btn"
            icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggleTheme}
            aria-label={t('Toggle theme')}
          />
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{ items: languageItems, selectable: true, selectedKeys: [language] }}
          >
            <Button
              type="text"
              className="auth-icon-btn auth-language-btn"
              icon={<GlobalOutlined />}
              aria-label={t('Change language')}
            >
              {language.toUpperCase()}
            </Button>
          </Dropdown>
        </Space>
      </header>

      <HolidayBanner />

      <section className="auth-shell">
        <div className="auth-card">
          <aside className="auth-brand-panel" aria-hidden="true">
            <img className="auth-brand-panel-photo" src={authPanelPhoto} alt="" />
            <div className="auth-brand-panel-shade" />
            <div className="auth-brand-panel-content">
              <span className="auth-brand-panel-kicker">{t('Smart Incubation')}</span>
              <p>{t('Connecting SMEs, incubators, facilitators and funders, from application to measurable impact.')}</p>
              <ul>
                {panelPoints.map(point => (
                  <li key={point}>
                    <CheckCircleFilled />
                    <span>{t(point)}</span>
                  </li>
                ))}
              </ul>
              <span className="auth-brand-panel-foot">{t('Available in English and isiZulu')}</span>
            </div>
          </aside>

          <div className="auth-form-panel" ref={formPanelRef}>
            {/* Phones only: the form sits on the page with the logo above it, instead of in a card. */}
            <div className="auth-mobile-brand" aria-hidden="true">
              <span className="auth-brand-mark"><BulbOutlined /></span>
              <span>{t('Smart Incubation')}</span>
            </div>

            <Segmented<AuthMode>
              block
              className="auth-segmented"
              value={authMode}
              onChange={handleModeChange}
              options={[
                {
                  label: (
                    <span className="auth-segment-label">
                      <LoginOutlined />
                      <span>{t('auth.loginTab', 'Sign in')}</span>
                    </span>
                  ),
                  value: 'login',
                },
                {
                  label: (
                    <span className="auth-segment-label">
                      <UserAddOutlined />
                      <span>{t('auth.signupTab', 'Create account')}</span>
                    </span>
                  ),
                  value: 'signup',
                },
              ]}
            />

            {/* No motion of its own: it rises with the rest of the form (auth.css), including on a switch. */}
            <div className="auth-motion-panel">
              <div className="auth-heading">
                <Title level={1}>{copy.title}</Title>
                <Paragraph>{copy.subtitle}</Paragraph>
              </div>
            </div>

            <Form<AuthFormValues>
              form={form}
              name="auth"
              layout="vertical"
              requiredMark={false}
              className="auth-form"
              onFinish={handleSubmit}
              onValuesChange={() => authError && setAuthError(null)}
            >
              {!isLogin && (
                <Form.Item
                  name="name"
                  label={t('auth.fullName', 'Full name')}
                  rules={[
                    {
                      required: true,
                      message: t(
                        'auth.nameRequired',
                        'Please enter your full name.',
                      ),
                    },
                  ]}
                >
                  <Input
                    size="large"
                    prefix={<UserOutlined />}
                    autoComplete="name"
                  />
                </Form.Item>
              )}

              <Form.Item
                name="email"
                label={t('auth.email', 'Email address')}
                rules={[
                  {
                    required: true,
                    message: t(
                      'auth.emailRequired',
                      'Please enter your email address.',
                    ),
                  },
                  {
                    type: 'email',
                    message: t(
                      'auth.emailInvalid',
                      'Please enter a valid email address.',
                    ),
                  },
                ]}
              >
                <Input
                  size="large"
                  prefix={<MailOutlined />}
                  placeholder="you@example.co.za"
                  autoComplete="email"
                />
              </Form.Item>

              <Form.Item
                name="password"
                label={t('auth.password', 'Password')}
                extra={!isLogin ? t('Use at least 8 characters.') : undefined}
                rules={[
                  {
                    required: true,
                    message: t(
                      'auth.passwordRequired',
                      'Please enter your password.',
                    ),
                  },
                  // Only new passwords need the minimum; existing accounts may have shorter ones.
                  ...(!isLogin
                    ? [{
                      min: MIN_PASSWORD_LENGTH,
                      message: t('Password must be at least 8 characters.'),
                    }]
                    : []),
                ]}
              >
                <Input.Password
                  size="large"
                  prefix={<LockOutlined />}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  iconRender={(visible) =>
                    visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />
                  }
                />
              </Form.Item>

              {isLogin && (
                <div className="auth-forgot-row">
                  <Button type="link" size="small" className="auth-forgot-link" onClick={openResetModal}>
                    {t('auth.forgotPassword', 'Forgot password?')}
                  </Button>
                </div>
              )}

              {authError && (
                <Alert
                  type="error"
                  showIcon
                  className="auth-error"
                  message={t(authError.message)}
                  action={errorAction}
                />
              )}

              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={pending === 'email'}
                disabled={pending !== null && pending !== 'email'}
                className="auth-submit-btn"
              >
                {copy.submit}
              </Button>

              {!isLogin && <p className="auth-consent">{consentText}</p>}
            </Form>

            <Divider plain className="auth-divider">
              <Text>{copy.socialDivider}</Text>
            </Divider>

            <div className="auth-socials">
              <Button
                block
                size="large"
                icon={<GoogleOutlined />}
                onClick={() => handleSocialLogin('google')}
                loading={pending === 'google'}
                disabled={pending !== null && pending !== 'google'}
                className="auth-social-btn"
              >
                {t('auth.google', 'Continue with Google')}
              </Button>

              <Button
                block
                size="large"
                icon={<FacebookFilled />}
                onClick={() => handleSocialLogin('facebook')}
                loading={pending === 'facebook'}
                disabled={pending !== null && pending !== 'facebook'}
                className="auth-social-btn"
              >
                {t('auth.facebook', 'Continue with Facebook')}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <Modal
        title={t('auth.resetTitle', 'Reset password')}
        open={resetOpen}
        onCancel={() => setResetOpen(false)}
        onOk={handleSendResetLink}
        okText={t('auth.sendResetLink', 'Send reset link')}
        {...singleActionFooter()}
        confirmLoading={resetLoading}
        centered
        className="auth-reset-modal"
      >
        <Paragraph className="auth-reset-copy">
          {t(
            'auth.resetBody',
            'Enter your email address and we will send you a password reset link.',
          )}
        </Paragraph>

        <Form<ResetPasswordValues>
          form={resetForm}
          name="reset-password"
          layout="vertical"
          requiredMark={false}
        >
          <Form.Item
            name="email"
            label={t('auth.email', 'Email address')}
            rules={[
              {
                required: true,
                message: t(
                  'auth.emailRequired',
                  'Please enter your email address.',
                ),
              },
              {
                type: 'email',
                message: t(
                  'auth.emailInvalid',
                  'Please enter a valid email address.',
                ),
              },
            ]}
          >
            <Input
              size="large"
              prefix={<MailOutlined />}
              autoComplete="email"
            />
          </Form.Item>
        </Form>
      </Modal>
    </main>
  )
}
