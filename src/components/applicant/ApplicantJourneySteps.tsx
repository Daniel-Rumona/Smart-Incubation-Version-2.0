import { Steps } from 'antd'
import { AuditOutlined, FormOutlined, UserOutlined } from '@ant-design/icons'
import { useLanguage } from '@/providers/LanguageProvider'

/**
 * The applicant's path in one strip: tell us about you, apply, then follow the application. Shown on each of those
 * pages so they read as one flow even though they stay separate screens.
 */
export const ApplicantJourneySteps = ({ current }: { current: 0 | 1 | 2 }) => {
  const { t } = useLanguage()
  return (
    <Steps
      size="small"
      current={current}
      responsive={false}
      style={{ margin: '4px 0 16px' }}
      items={[
        { title: t('Your details'), icon: <UserOutlined /> },
        { title: t('Application'), icon: <FormOutlined /> },
        { title: t('Tracking'), icon: <AuditOutlined /> },
      ]}
    />
  )
}

export default ApplicantJourneySteps
