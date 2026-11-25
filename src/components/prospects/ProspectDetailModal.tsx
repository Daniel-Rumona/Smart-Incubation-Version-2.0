import { useEffect, useMemo, useState } from 'react'
import { Button, Descriptions, Modal, Space, Steps, Tag, Typography } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import { PROSPECT_SOURCES, PROSPECT_STATUSES, isClosedStatus, statusOption, type ProspectModule } from '@/config/prospects'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { listProspectEvents } from '@/services/prospectsService'
import { prospectName, type Prospect, type ProspectEvent } from '@/types/prospects'
import { formatDate } from '@/utils/prospectFormat'

/**
 * What a click on a prospect shows: the basics, the chain of stages it has been through (with the date each was
 * reached), and the latest notes. Changes are made from "Edit details".
 */
export function ProspectDetailModal({ prospect, module, onClose, onEdit }: { prospect: Prospect, module: ProspectModule, onClose: () => void, onEdit: () => void }) {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const [events, setEvents] = useState<ProspectEvent[]>([])

    useEffect(() => {
        if (!user) return
        let cancelled = false
        void listProspectEvents(user, prospect).catch(() => [] as ProspectEvent[]).then((rows) => { if (!cancelled) setEvents(rows) })
        return () => { cancelled = true }
    }, [prospect, user])

    const chain = useMemo(() => {
        const open = PROSPECT_STATUSES[module].filter((option) => !isClosedStatus(option.key))
        const closed = isClosedStatus(prospect.status)
        // When the first event for each stage happened (events come newest first).
        const reachedAt = new Map<string, string>()
        for (const event of [...events].reverse()) if (!reachedAt.has(event.to)) reachedAt.set(event.to, event.at)
        const furthest = Math.max(0, ...open.map((option, index) => (reachedAt.has(option.key) || option.key === prospect.status ? index : 0)))
        const currentIndex = closed ? furthest : open.findIndex((option) => option.key === prospect.status)
        const items = open.map((option, index) => ({
            title: t(option.label),
            content: reachedAt.get(option.key) ? formatDate(reachedAt.get(option.key)) : (index === 0 ? formatDate(prospect.createdAt) : ''),
        }))
        if (closed) items.push({ title: t(statusOption(module, prospect.status).label), content: formatDate(prospect.statusChangedAt) })
        return { items, current: closed ? items.length - 1 : currentIndex, closed }
    }, [events, module, prospect, t])

    const source = [t(PROSPECT_SOURCES.find((option) => option.key === prospect.source)?.label || 'Other'), prospect.sourceDetail].filter(Boolean).join(' · ')
    const details: Array<{ label: string, value: string }> = [
        { label: prospect.kind === 'person' ? t('Name') : t('Contact person'), value: prospect.contactName },
        { label: t('Phone'), value: prospect.phone },
        { label: t('Email'), value: prospect.email },
        { label: t('Came from'), value: source },
        { label: module === 'training' ? t('Interested in') : t('Programme'), value: prospect.programName || prospect.interest || '' },
        { label: t('Follows up'), value: prospect.ownerName || '' },
        { label: t('Next follow-up'), value: prospect.nextFollowUpAt ? formatDate(prospect.nextFollowUpAt) : '' },
        { label: t('Sector'), value: prospect.sector },
        { label: t('Province'), value: prospect.province },
        { label: t('Registration number'), value: prospect.registrationNumber },
        { label: t('Agreed to messages'), value: prospect.consent.contactAllowed ? t('Yes') : t('No') },
        { label: t('Added'), value: formatDate(prospect.createdAt) },
        ...prospect.extraDetails.map((detail) => ({ label: detail.label, value: detail.value })),
    ].filter((row) => row.value)
    const noted = events.filter((event) => event.note).slice(0, 5)

    return (
        <Modal
            open
            width={760}
            title={<Space>{prospectName(prospect)}<Tag color={statusOption(module, prospect.status).color}>{t(statusOption(module, prospect.status).label)}</Tag></Space>}
            onCancel={onClose}
            destroyOnHidden
            footer={[
                <Button key="close" onClick={onClose}>{t('Close')}</Button>,
                <Button key="edit" type="primary" icon={<EditOutlined />} onClick={onEdit}>{t('Edit details')}</Button>,
            ]}
        >
            <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }} items={details.map((row, index) => ({ key: index, label: row.label, children: row.value }))} style={{ marginBottom: 20 }} />

            <Typography.Title level={5}>{t('Progress')}</Typography.Title>
            <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
                <Steps size="small" current={chain.current} status={chain.closed ? 'error' : 'process'} items={chain.items} style={{ minWidth: 520 }} />
            </div>

            {prospect.notes && (
                <>
                    <Typography.Title level={5} style={{ marginTop: 16 }}>{t('Notes')}</Typography.Title>
                    <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{prospect.notes}</Typography.Paragraph>
                </>
            )}

            {noted.length > 0 && (
                <>
                    <Typography.Title level={5} style={{ marginTop: 16 }}>{t('Recent activity')}</Typography.Title>
                    <Space orientation="vertical" size={4}>
                        {noted.map((event) => (
                            <Typography.Text key={event.id}>
                                {event.note}
                                <Typography.Text type="secondary">{` · ${event.byName} · ${formatDate(event.at)}`}</Typography.Text>
                            </Typography.Text>
                        ))}
                    </Space>
                </>
            )}
        </Modal>
    )
}
