import { Empty } from 'antd'
import { Helmet } from 'react-helmet'
import DashboardHeader from '@/components/shared/DashboardHeader'
import DashboardPage from '@/components/shared/DashboardPage'
import { MotionCard } from '@/components/shared/Header'
import { useLanguage, tr } from '@/providers/LanguageProvider'

export default function ImpactAnalysisPage() {
  const { t } = useLanguage()
  return (
    <DashboardPage className="operations-impact-analysis-page">
      <Helmet>
        <title>{t('Impact Analysis | Smart Incubation')}</title>
      </Helmet>

      <DashboardHeader
        title={t('Impact Analysis')}
        subtitle={tr('Impact analysis will appear here once live intervention outcomes and SME metrics are available.')}
      />

      <MotionCard>
        <Empty description={t('No live impact data available yet.')} />
      </MotionCard>
    </DashboardPage>
  )
}
