import { useState } from 'react'
import { App, Button, Dropdown, type MenuProps } from 'antd'
import { DownloadOutlined, FileSearchOutlined, FileTextOutlined } from '@ant-design/icons'
import { useLanguage } from '@/providers/LanguageProvider'
import { exportReport, type ReportExportData, type ReportTemplateId } from '@/services/reportExport'
import '@/styles/report-export.css'

type ReportExportButtonProps = {
  /** Called when a template is picked, so the export always reflects the filters on screen right now. */
  buildData: () => ReportExportData
  disabled?: boolean
}

export const ReportExportButton = ({ buildData, disabled }: ReportExportButtonProps) => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const [exporting, setExporting] = useState(false)

  const run = async (template: ReportTemplateId) => {
    try {
      setExporting(true)
      message.open({ key: 'report-export', type: 'loading', content: t('Preparing your report…'), duration: 0 })
      const { aiGenerated } = await exportReport(buildData(), template)
      if (aiGenerated) message.open({ key: 'report-export', type: 'success', content: t('Report downloaded.') })
      else message.open({ key: 'report-export', type: 'warning', content: t('Report downloaded. The AI summary service was unavailable, so the narrative was built from the figures.') })
    } catch {
      message.open({ key: 'report-export', type: 'error', content: t('Report could not be generated.') })
    } finally {
      setExporting(false)
    }
  }

  const option = (icon: React.ReactNode, title: string, description: string) => (
    <div className="report-export-option">
      <span className="report-export-option-icon">{icon}</span>
      <span className="report-export-option-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
    </div>
  )

  const items: MenuProps['items'] = [
    {
      key: 'executive',
      label: option(<FileTextOutlined />, t('Executive summary'), t('1-2 pages: AI summary, headline figures and recommended actions')),
    },
    {
      key: 'detailed',
      label: option(<FileSearchOutlined />, t('Detailed report'), t('Full report with data tables and commentary for each section')),
    },
  ]

  return (
    <Dropdown
      trigger={['click']}
      placement="bottomRight"
      classNames={{ root: 'report-export-menu' }}
      menu={{ items, onClick: ({ key }) => void run(key as ReportTemplateId) }}
      disabled={disabled || exporting}
    >
      <Button type="primary" icon={<DownloadOutlined />} loading={exporting} disabled={disabled}>
        {t('Export report')}
      </Button>
    </Dropdown>
  )
}
