import {
  ArrowLeftOutlined,
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
  App,
  Button,
  Divider,
  Dropdown,
  Form,
  Grid,
  Input,
  Modal,
  Segmented,
  Space,
  Typography,
} from 'antd'
import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useThemeMode } from '@/providers/ThemeProvider'
import { useLanguage } from '@/providers/LanguageProvider'
import {
  loginUser,
  loginWithFacebook,
  loginWithGoogle,
  registerUser,
  sendPasswordResetLink,
} from '@/services/authService'
import { getAuthFriendlyError } from '@/utils/authErrors'
import { getRoleHomePath } from '@/utils/roleRouting'
import { LANGUAGES, type LanguageCode } from '@/config/languages'
import { HolidayBanner } from '@/components/shared/HolidayBanner'
import '@/styles/auth/auth.css'

const { Title, Paragraph, Text } = Typography
const { useBreakpoint } = Grid

type AuthMode = 'login' | 'signup'

type AuthFormValues = {
  name?: string
  email: string
  password: string
  confirmPassword?: string
}

type ResetPasswordValues = {
  email: string
}

export default function AuthPage() {
  const navigate = useNavigate()
  const screens = useBreakpoint()
  const { message } = App.useApp()
  const { mode: themeMode, toggleTheme } = useThemeMode()
  const { t, language, setLanguage } = useLanguage()

  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [loading, setLoading] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  const [form] = Form.useForm<AuthFormValues>()
  const [resetForm] = Form.useForm<ResetPasswordValues>()

  const isLogin = authMode === 'login'
  const isMobile = !screens.md
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
        submit: t('auth.loginButton', 'Log in'),
      }
    }

    return {
      title: t('auth.signupTitle', 'Create your account'),
      subtitle: t(
        'auth.signupSubtitle',
        'Create your login details. Thuso will guide your account setup next.',
      ),
      submit: t('auth.signupButton', 'Create account'),
    }
  }, [isLogin, t])

  const handleModeChange = (value: AuthMode) => {
    setAuthMode(value)
    form.resetFields()
  }

  const redirectAfterAuth = (role?: string, isApplicant = false, firstLoginComplete = false, emailVerified = false, smeOnboardingComplete = true) => {
    if (!emailVerified) {
      navigate('/email-verification', { replace: true })
      return
    }

    navigate(firstLoginComplete ? getRoleHomePath(role, isApplicant, smeOnboardingComplete) : '/welcome', { replace: true })
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)

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
      message.error(getAuthFriendlyError(error))
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    try {
      setLoading(true)

      const { profile } = await loginWithGoogle()

      message.success(t('auth.googleSuccess', 'Google sign-in successful'))
      redirectAfterAuth(profile.role, profile.isApplicant, profile.firstLoginComplete, profile.emailVerified, profile.smeOnboardingComplete)
    } catch (error) {
      message.error(getAuthFriendlyError(error))
    } finally {
      setLoading(false)
    }
  }

  const handleFacebookLogin = async () => {
    try {
      setLoading(true)

      const { profile } = await loginWithFacebook()

      message.success(t('auth.facebookSuccess', 'Facebook sign-in successful'))
      redirectAfterAuth(profile.role, profile.isApplicant, profile.firstLoginComplete, profile.emailVerified, profile.smeOnboardingComplete)
    } catch (error) {
      message.error(getAuthFriendlyError(error))
    } finally {
      setLoading(false)
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
      message.error(getAuthFriendlyError(error))
    } finally {
      setResetLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-floating-actions">
        <Button
          className="auth-floating-btn"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/')}
        >
          {!isMobile && t('common.back', 'Back')}
        </Button>

        <Space size={8}>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{ items: languageItems, selectable: true, selectedKeys: [language] }}
          >
            <Button className="auth-floating-btn" icon={<GlobalOutlined />}>
              {!isMobile && LANGUAGES[language]}
            </Button>
          </Dropdown>

          <Button className="auth-floating-btn" onClick={toggleTheme}>
            {themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            {!isMobile && (
              <span>
                {themeMode === 'dark'
                  ? t('common.lightMode', 'Light')
                  : t('common.darkMode', 'Dark')}
              </span>
            )}
          </Button>
        </Space>
      </div>

      <HolidayBanner />

      <section className="auth-shell">
        <div className="auth-card">
          <div className="auth-form-panel">
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
                      <span>{t('auth.loginTab', 'Login')}</span>
                    </span>
                  ),
                  value: 'login',
                },
                {
                  label: (
                    <span className="auth-segment-label">
                      <UserAddOutlined />
                      <span>{t('auth.signupTab', 'Sign up')}</span>
                    </span>
                  ),
                  value: 'signup',
                },
              ]}
            />

            <AnimatePresence mode="wait">
              <motion.div
                key={authMode}
                initial={{ opacity: 0, x: isLogin ? -18 : 18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: isLogin ? 18 : -18 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="auth-motion-panel"
              >
                <div className="auth-heading">
                  <Title level={1}>{copy.title}</Title>
                  <Paragraph>{copy.subtitle}</Paragraph>
                </div>

                <Form<AuthFormValues>
                  form={form}
                  layout="vertical"
                  requiredMark={false}
                  className="auth-form"
                  onFinish={handleSubmit}
                >
                  {!isLogin && (
                    <Form.Item
                      name="name"
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
                        placeholder={t('auth.fullName', 'Full name')}
                        autoComplete="name"
                      />
                    </Form.Item>
                  )}

                  <Form.Item
                    name="email"
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
                      placeholder={t('auth.email', 'Email address')}
                      autoComplete="email"
                    />
                  </Form.Item>

                  <Form.Item
                    name="password"
                    rules={[
                      {
                        required: true,
                        message: t(
                          'auth.passwordRequired',
                          'Please enter your password.',
                        ),
                      },
                      {
                        min: 6,
                        message: t(
                          'auth.passwordTooShort',
                          'Password must be at least 6 characters.',
                        ),
                      },
                    ]}
                  >
                    <Input.Password
                      size="large"
                      prefix={<LockOutlined />}
                      placeholder={t('auth.password', 'Password')}
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                      iconRender={(visible) =>
                        visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />
                      }
                    />
                  </Form.Item>

                  {!isLogin && (
                    <Form.Item
                      name="confirmPassword"
                      dependencies={['password']}
                      rules={[
                        {
                          required: true,
                          message: t(
                            'auth.confirmPasswordRequired',
                            'Please confirm your password.',
                          ),
                        },
                        ({ getFieldValue }) => ({
                          validator(_, value) {
                            if (!value || getFieldValue('password') === value) {
                              return Promise.resolve()
                            }

                            return Promise.reject(
                              new Error(
                                t(
                                  'auth.passwordMismatch',
                                  'The passwords do not match.',
                                ),
                              ),
                            )
                          },
                        }),
                      ]}
                    >
                      <Input.Password
                        size="large"
                        prefix={<LockOutlined />}
                        placeholder={t(
                          'auth.confirmPassword',
                          'Confirm password',
                        )}
                        autoComplete="new-password"
                        iconRender={(visible) =>
                          visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />
                        }
                      />
                    </Form.Item>
                  )}

                  {isLogin && (
                    <div className="auth-forgot-row">
                      <Button type="link" onClick={openResetModal}>
                        {t('auth.forgotPassword', 'Forgot password?')}
                      </Button>
                    </div>
                  )}

                  <Button
                    type="primary"
                    htmlType="submit"
                    size="large"
                    block
                    loading={loading}
                    className="auth-submit-btn"
                  >
                    {copy.submit}
                  </Button>
                </Form>

                <Divider plain className="auth-divider">
                  <Text>{t('auth.continueWith', 'Or sign in with')}</Text>
                </Divider>

                <div className="auth-socials">
                  <Button
                    block
                    size="large"
                    icon={<GoogleOutlined />}
                    onClick={handleGoogleLogin}
                    loading={loading}
                    className="auth-social-btn"
                  >
                    {t('auth.google', 'Continue with Google')}
                  </Button>

                  <Button
                    block
                    size="large"
                    icon={<FacebookFilled />}
                    onClick={handleFacebookLogin}
                    loading={loading}
                    className="auth-social-btn"
                  >
                    {t('auth.facebook', 'Continue with Facebook')}
                  </Button>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

        </div>
      </section>

      <Modal
        title={t('auth.resetTitle', 'Reset password')}
        open={resetOpen}
        onCancel={() => setResetOpen(false)}
        onOk={handleSendResetLink}
        okText={t('auth.sendResetLink', 'Send reset link')}
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
          layout="vertical"
          requiredMark={false}
        >
          <Form.Item
            name="email"
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
              placeholder={t('auth.email', 'Email address')}
              autoComplete="email"
            />
          </Form.Item>
        </Form>
      </Modal>
    </main>
  )
}
