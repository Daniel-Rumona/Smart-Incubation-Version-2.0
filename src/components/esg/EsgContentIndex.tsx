import { useMemo } from 'react'
import { Table, Typography } from 'antd'
import { useLanguage } from '@/providers/LanguageProvider'
import { contentIndex } from '@/utils/esgReportChecks'
import { statementOfUse } from '@/utils/esgReportDocx'
import type { EsgReport } from '@/types/esg'

/** The GRI content index the report ends with: built from the figures' GRI links and the written sections. */
export const EsgContentIndex = ({ report }: { report: EsgReport }) => {
    const { t } = useLanguage()
    const index = useMemo(() => contentIndex(report), [report])
    return (
        <>
            <Typography.Paragraph type="secondary">{statementOfUse(report)}</Typography.Paragraph>
            <Table
                rowKey="disclosure"
                size="small"
                pagination={false}
                dataSource={index}
                scroll={{ x: 'max-content' }}
                columns={[
                    { title: t('GRI Standard'), dataIndex: 'standard' },
                    { title: t('Disclosure'), key: 'disclosure', render: (_, row) => `${row.disclosure} ${row.title}` },
                    { title: t('Where in the report'), dataIndex: 'location' },
                ]}
                locale={{ emptyText: t('Link the figures to GRI disclosures (More detail on Figures) and write the sections to build the index.') }}
            />
        </>
    )
}
