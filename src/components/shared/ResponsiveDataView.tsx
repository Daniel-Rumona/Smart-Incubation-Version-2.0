import { Card, Empty, Grid, List, Skeleton, Table, type TableProps } from 'antd'
import type { ReactNode } from 'react'

type ResponsiveDataViewProps<T extends object> = {
  rows: T[]
  columns: TableProps<T>['columns']
  rowKey: keyof T | ((row: T) => string)
  renderCard: (row: T) => ReactNode
  emptyText: string
  loading?: boolean
  onRowClick?: (row: T) => void
  rowClassName?: TableProps<T>['rowClassName']
}

const PAGE_SIZE = 5
const SKELETON_ROWS = Array.from({ length: PAGE_SIZE }, (_, index) => ({ __skeleton: index }))

export const ResponsiveDataView = <T extends object>({
  rows,
  columns,
  rowKey,
  renderCard,
  emptyText,
  loading,
  onRowClick,
  rowClassName,
}: ResponsiveDataViewProps<T>) => {
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  // First load: show the table's own shape as shimmering placeholders instead of an empty box with a spinner.
  const showSkeleton = Boolean(loading) && rows.length === 0

  if (!isMobile) {
    if (showSkeleton) {
      const skeletonColumns = (columns || []).map((column) => ({
        ...column,
        sorter: undefined,
        filters: undefined,
        onFilter: undefined,
        render: () => <Skeleton.Input active size="small" block style={{ minWidth: 48 }} />,
      }))
      return (
        <Table
          rowKey="__skeleton"
          columns={skeletonColumns as unknown as TableProps<{ __skeleton: number }>['columns']}
          dataSource={SKELETON_ROWS}
          pagination={false}
          scroll={{ x: 560 }}
        />
      )
    }
    return (
      <Table
        rowKey={rowKey as TableProps<T>['rowKey']}
        columns={columns}
        dataSource={rows}
        loading={loading}
        rowClassName={rowClassName}
        onRow={onRowClick ? (row) => ({ onClick: () => onRowClick(row) }) : undefined}
        pagination={{ pageSize: PAGE_SIZE, position: ['bottomCenter'], showSizeChanger: false }}
        locale={{ emptyText: <Empty description={emptyText} /> }}
        scroll={{ x: 560 }}
      />
    )
  }

  if (showSkeleton) {
    return (
      <List
        dataSource={SKELETON_ROWS}
        renderItem={(row) => (
          <List.Item key={row.__skeleton} className="responsive-list-item">
            <Card className="responsive-list-card"><Skeleton active title paragraph={{ rows: 2 }} /></Card>
          </List.Item>
        )}
      />
    )
  }

  return (
    <List
      loading={loading}
      dataSource={rows}
      locale={{ emptyText: <Empty description={emptyText} /> }}
      pagination={{
        pageSize: PAGE_SIZE,
        align: 'center',
        hideOnSinglePage: true,
        showSizeChanger: false,
      }}
      renderItem={(row) => <List.Item className="responsive-list-item"><Card className="responsive-list-card">{renderCard(row)}</Card></List.Item>}
    />
  )
}
