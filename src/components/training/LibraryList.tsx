import { useState } from 'react'
import { App, Button, List, Space, Tag, Typography } from 'antd'
import { FileOutlined, LinkOutlined } from '@ant-design/icons'
import { useLanguage } from '@/providers/LanguageProvider'
import { openLibraryItem } from '@/services/trainingLibraryService'
import { LIBRARY_CATEGORY_LABELS } from '@/utils/trainingFormat'
import type { TrainingLibraryItem } from '@/types/training'

/** The shared library items someone can open: a learner's course material, a client company's reading. */
export const LibraryList = ({ items, emptyText }: { items: TrainingLibraryItem[], emptyText: string }) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const [opening, setOpening] = useState<string | null>(null)

    const open = async (item: TrainingLibraryItem) => {
        setOpening(item.id)
        try {
            await openLibraryItem(item)
        } catch {
            message.error(t('The file could not be opened.'))
        } finally {
            setOpening(null)
        }
    }

    return (
        <List
            dataSource={items}
            locale={{ emptyText }}
            renderItem={(item) => (
                <List.Item extra={<Button loading={opening === item.id} onClick={() => void open(item)}>{item.kind === 'link' ? t('Open link') : t('Open')}</Button>}>
                    <List.Item.Meta
                        avatar={item.kind === 'link' ? <LinkOutlined /> : <FileOutlined />}
                        title={<Space wrap size={6}>{item.title}<Tag>{t(LIBRARY_CATEGORY_LABELS[item.category])}</Tag></Space>}
                        description={item.description ? <Typography.Text type="secondary">{item.description}</Typography.Text> : undefined}
                    />
                </List.Item>
            )}
        />
    )
}
