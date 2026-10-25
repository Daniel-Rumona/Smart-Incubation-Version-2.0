import { Empty, Segmented, Table, Typography, type TableProps } from 'antd'
import { AreaChartOutlined, TableOutlined } from '@ant-design/icons'
import type Highcharts from 'highcharts'
import { useState, type ReactNode } from 'react'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { useLanguage } from '@/providers/LanguageProvider'

type View = 'chart' | 'table'

type ChartDetailsModalProps<T extends object> = {
    open: boolean
    onClose: () => void
    title: ReactNode
    /** One line under the title saying what the chart counts. */
    description?: ReactNode
    /** The card's chart options; the modal makes it taller. */
    chart: Highcharts.Options
    columns: TableProps<T>['columns']
    rows: T[]
    rowKey: keyof T | ((row: T) => string)
    emptyText: string
    onRowClick?: (row: T) => void
}

/** A wider look at a report chart, with the rows behind it one switch away. */
export const ChartDetailsModal = <T extends object>({ open, onClose, title, description, chart, columns, rows, rowKey, emptyText, onRowClick }: ChartDetailsModalProps<T>) => {
    const { t } = useLanguage()
    const [view, setView] = useState<View>('chart')

    return (
        <ResponsiveModal open={open} onClose={() => { onClose(); setView('chart') }} title={title} width={1040} centered className="chart-details-modal">
            <div className="chart-details-head">
                {description ? <Typography.Text type="secondary">{description}</Typography.Text> : <span />}
                <Segmented<View>
                    value={view}
                    onChange={setView}
                    options={[
                        { value: 'chart', label: t('Chart'), icon: <AreaChartOutlined /> },
                        { value: 'table', label: t('Table'), icon: <TableOutlined /> },
                    ]}
                />
            </div>
            {view === 'chart' ? (
                rows.length ? <ThemedHighcharts options={{ ...chart, chart: { ...chart.chart, height: 420 } }} /> : <Empty description={emptyText} />
            ) : (
                <Table<T>
                    size="middle"
                    rowKey={rowKey as TableProps<T>['rowKey']}
                    columns={columns}
                    dataSource={rows}
                    rowClassName={onRowClick ? () => 'is-clickable' : undefined}
                    onRow={onRowClick ? (row) => ({ onClick: () => onRowClick(row) }) : undefined}
                    pagination={rows.length > 10 ? { pageSize: 10, showSizeChanger: false, position: ['bottomCenter'] } : false}
                    locale={{ emptyText: <Empty description={emptyText} /> }}
                    scroll={{ x: 640 }}
                />
            )}
        </ResponsiveModal>
    )
}

export default ChartDetailsModal
