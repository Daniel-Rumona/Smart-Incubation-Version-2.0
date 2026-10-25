import { Card, Result } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import { FEATURES, type FeatureKey } from '@/config/entitlements'
import { useLanguage } from '@/providers/LanguageProvider'

/** Shown in place of a page that belongs to a premium feature the company's plan does not include. */
export const FeatureLocked = ({ feature }: { feature: FeatureKey }) => {
  const { t } = useLanguage()
  return (
    <Card bordered={false}>
      <Result
        icon={<LockOutlined />}
        title={t(FEATURES[feature].label)}
        subTitle={t('This feature is not included in your organisation’s plan. Ask your platform administrator about upgrading.')}
      />
    </Card>
  )
}

export default FeatureLocked
