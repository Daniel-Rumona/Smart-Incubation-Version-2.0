import { Card, Empty, Grid, List, Space, Table as AntTable, Typography, type TableProps } from 'antd'
import type { ReactNode } from 'react'
import { useLanguage } from '@/providers/LanguageProvider'

const readValue = <T extends object>(row: T, dataIndex: unknown) => {
  if (Array.isArray(dataIndex)) return dataIndex.reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[String(key)] : undefined, row)
  return typeof dataIndex === 'string' || typeof dataIndex === 'number' ? (row as Record<string, unknown>)[String(dataIndex)] : undefined
}

export const ResponsiveTable = <T extends object>(props: TableProps<T>) => {
  const { t } = useLanguage()
  const isMobile = !Grid.useBreakpoint().md
  if (!isMobile) {
    const pagination = props.pagination === false
      ? false
      : { ...props.pagination, position: props.pagination?.position || ['bottomCenter' as const], showSizeChanger: false }
    return <AntTable {...props} pagination={pagination} />
  }
  const columns = props.columns || []
  const pageSize = typeof props.pagination === 'object' ? props.pagination.pageSize : 5

  return <List
    loading={props.loading}
    dataSource={props.dataSource ? [...props.dataSource] : []}
    locale={{ emptyText: typeof props.locale?.emptyText === 'function' ? props.locale.emptyText() : props.locale?.emptyText || <Empty /> }}
    pagination={props.pagination === false ? false : { pageSize: pageSize || 5, align: 'center', hideOnSinglePage: true, showSizeChanger: false }}
    renderItem={(row, index) => <List.Item className="responsive-list-item"><Card className="responsive-list-card responsive-table-card"><Space orientation="vertical" size={7}>
      {columns.map((column, columnIndex) => {
        if (!('dataIndex' in column || 'render' in column)) return null
        const value = readValue(row, 'dataIndex' in column ? column.dataIndex : undefined)
        const rendered = 'render' in column && column.render ? column.render(value, row, index) : value
        const content = rendered && typeof rendered === 'object' && 'children' in rendered ? rendered.children : rendered
        const title = 'title' in column && typeof column.title !== 'function' ? column.title : undefined
        return <div className="responsive-table-field" key={String(('key' in column && column.key) || ('dataIndex' in column && column.dataIndex) || columnIndex)}>
          {title && <Typography.Text type="secondary">{title as ReactNode}</Typography.Text>}
          <div>{(content as ReactNode) || t('N/A')}</div>
        </div>
      })}
    </Space></Card></List.Item>}
  />
}
