import { useState } from 'react'
import { App, Button, Flex, InputNumber, Popover, Typography } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import { useLanguage } from '@/providers/LanguageProvider'
import { funderOrgErrorMessage, setLinkFunding, type FunderLink } from '@/services/funderOrganisationsService'
import { formatCurrencyZAR } from '@/services/smePerformanceMetrics'

/**
 * The funding committed to one programme link (rand), shown inline with a small editor. Either side can set it: the
 * implementor in a programme's funders, the funder in "Programmes you fund". The Impact page totals it and works out
 * the cost per job and per SME from it.
 */
export default function FundingAmountEditor({ link }: { link: FunderLink }) {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<number | null>(link.fundingAmount)
  const [saving, setSaving] = useState(false)

  const save = async (amount: number | null) => {
    setSaving(true)
    try {
      await setLinkFunding(link.id, amount)
      message.success(amount === null ? t('Funding cleared.') : t('Funding saved.'))
      setOpen(false)
    } catch (error) {
      message.error(funderOrgErrorMessage(error, t('The funding could not be saved.'), ''))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={(next) => { setOpen(next); if (next) setValue(link.fundingAmount) }}
      title={t('Funding committed to {programme}', undefined, { programme: link.programName })}
      content={<Flex vertical gap={8} style={{ width: 260 }}>
        <InputNumber<number>
          value={value}
          onChange={(next) => setValue(typeof next === 'number' ? next : null)}
          min={0}
          step={10000}
          prefix="R"
          style={{ width: '100%' }}
          formatter={(raw) => (raw === undefined || raw === null || String(raw) === '' ? '' : Number(raw).toLocaleString('en-ZA'))}
          parser={(raw) => Number(String(raw || '').replace(/[^0-9.]/g, '')) || 0}
          placeholder="2 500 000"
          aria-label={t('Funding committed, in rand')}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('The total for this programme, in rand. The Impact page uses it for cost per job and per SME.')}</Typography.Text>
        <Flex justify="flex-end" gap={8}>
          {link.fundingAmount !== null && <Button size="small" onClick={() => void save(null)} loading={saving}>{t('Clear')}</Button>}
          <Button size="small" type="primary" disabled={value === null} loading={saving} onClick={() => void save(value)}>{t('Save')}</Button>
        </Flex>
      </Flex>}
    >
      <Button type="link" size="small" className="funder-funding-link" icon={<EditOutlined />}>
        {link.fundingAmount === null ? t('Add funding amount') : t('Funding: {amount}', undefined, { amount: formatCurrencyZAR(link.fundingAmount) })}
      </Button>
    </Popover>
  )
}
