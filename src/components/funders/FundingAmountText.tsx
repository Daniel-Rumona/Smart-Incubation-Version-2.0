import dayjs from 'dayjs'
import { Typography } from 'antd'
import { useLanguage } from '@/providers/LanguageProvider'
import type { FunderLink } from '@/services/funderOrganisationsService'
import { formatCurrencyZAR } from '@/services/smePerformanceMetrics'

/**
 * The funding committed to a programme, read-only, for the funder: the implementor records it (FundingAmountEditor),
 * so the funder sees the amount with who set it and when, never a figure without its source.
 */
export default function FundingAmountText({ link, compact = false }: { link: FunderLink; compact?: boolean }) {
  const { t } = useLanguage()
  if (link.fundingAmount === null) {
    return <Typography.Text type="secondary" className="funder-funding-text">{t('Funding not entered by {company} yet', undefined, { company: link.companyName })}</Typography.Text>
  }
  const source = link.fundingUpdatedSide === 'systemadmin' ? t('a system admin') : link.companyName
  return (
    <span className="funder-funding-text">
      <b>{formatCurrencyZAR(link.fundingAmount)}</b>
      {!compact && (
        <Typography.Text type="secondary">
          {' · '}{link.fundingUpdatedAt
            ? t('set by {source} on {date}', undefined, { source, date: dayjs(link.fundingUpdatedAt).format('D MMM YYYY') })
            : t('set by {source}', undefined, { source })}
        </Typography.Text>
      )}
    </span>
  )
}
