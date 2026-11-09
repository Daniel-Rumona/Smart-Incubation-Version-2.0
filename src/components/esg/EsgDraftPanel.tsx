import { useMemo, useState } from 'react'
import { Alert, App, Button, Collapse, Input, List, Progress, Space, Tag, Typography } from 'antd'
import { CheckCircleOutlined, DownloadOutlined, RobotOutlined, SaveOutlined, WarningOutlined } from '@ant-design/icons'
import { alignedStandards } from '@/config/esgStandards'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { draftEsgSections, saveEsgNarrative } from '@/services/esgReportsService'
import { useLanguage } from '@/providers/LanguageProvider'
import { ESG_SECTIONS, checkEsgReport } from '@/utils/esgReportChecks'
import { downloadEsgReportDocx } from '@/utils/esgReportDocx'
import type { EsgNarrativeSection, EsgReport } from '@/types/esg'

type Props = {
    report: EsgReport
    provider: { name: string, logoUrl?: string | null }
    /** The sections open in the list, kept by the page so they stay open when a saved draft remounts the panel. */
    openSections: string[]
    onOpenSections: (keys: string[]) => void
}

/**
 * The written report: how ready it is, what to check, the sections (written by hand or drafted with AI from the
 * figures) and the Word report. Mounted with a key that changes with the saved sections, so edits start from what is
 * saved.
 */
export const EsgDraftPanel = ({ report, provider, openSections, onOpenSections }: Props) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [sections, setSections] = useState<EsgNarrativeSection[]>(() => ESG_SECTIONS.map((section) => report.narrative.find((item) => item.key === section.key) || { key: section.key, title: section.title, text: '' }))
    const [dirty, setDirty] = useState(false)
    const [busy, setBusy] = useState<string | null>(null)
    const [showChecks, setShowChecks] = useState(false)

    const checks = useMemo(() => checkEsgReport({ ...report, narrative: sections }), [report, sections])

    const save = async (next = sections) => {
        if (!user) return
        await saveEsgNarrative(user, report.id, next.filter((section) => section.text.trim()))
        setDirty(false)
    }

    const draft = async (keys: string[]) => {
        if (!user || !keys.length) return
        setBusy(keys.length > 1 ? 'all' : keys[0])
        try {
            const aligned = alignedStandards(report)
            const standards = [
                ...aligned.universal.map((item) => `${item.id}: ${item.title}`),
                aligned.sector ? `${aligned.sector.id}: ${aligned.sector.title}` : 'No GRI Sector Standard for this sector',
                ...aligned.topics.map((item) => `${item.id}: ${item.title}`),
                ...aligned.frameworks.map((item) => item.label),
            ]
            const drafted = await draftEsgSections(report.id, keys, standards)
            const next = sections.map((section) => drafted.find((item) => item.key === section.key) || section)
            setSections(next)
            await save(next)
            const flagged = drafted.filter((item) => item.unmatchedFigures?.length).length
            message.success(flagged
                ? t('Drafted. {count} section(s) mention figures that are not in the data: check them.', undefined, { count: flagged })
                : t('Drafted from the report\'s figures. Read and edit before it goes out.'))
        } catch (error) {
            message.error(error instanceof Error && error.message === 'assistant_unavailable'
                ? t('The assistant is not available here.')
                : t('The sections could not be drafted. Save the figures first, then try again.'))
        } finally {
            setBusy(null)
        }
    }

    const download = async () => {
        setBusy('word')
        try {
            if (dirty) await save()
            const { logoEmbedded } = await downloadEsgReportDocx({ ...report, narrative: sections.filter((section) => section.text.trim()) }, provider)
            if (!logoEmbedded && provider.logoUrl) message.info(t('The report was made without the logo, which could not be loaded.'))
        } catch {
            message.error(t('The Word report could not be made.'))
        } finally {
            setBusy(null)
        }
    }

    const empty = sections.filter((section) => !section.text.trim()).map((section) => section.key)
    const written = sections.length - empty.length

    return (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                <Space wrap size={16}>
                    <Space size={8}>
                        <Progress type="circle" percent={Math.round((written / sections.length) * 100)} size={44} />
                        <Typography.Text>{t('{written} of {count} sections written', undefined, { written, count: sections.length })}</Typography.Text>
                    </Space>
                    {checks.length > 0
                        ? <Button type="link" icon={<WarningOutlined />} onClick={() => setShowChecks((value) => !value)} style={{ paddingInline: 0 }}>{t('{count} thing(s) to check', undefined, { count: checks.length })}</Button>
                        : <Tag color="green" icon={<CheckCircleOutlined />}>{t('Nothing to check')}</Tag>}
                </Space>
                <Space wrap>
                    <Button icon={<SaveOutlined />} disabled={!dirty} onClick={() => void save().then(() => message.success(t('Saved.')), () => message.error(t('The sections could not be saved.')))}>{dirty ? t('Save changes') : t('Saved')}</Button>
                    <Button type="primary" icon={<DownloadOutlined />} loading={busy === 'word'} onClick={() => void download()}>{t('Download the Word report')}</Button>
                </Space>
            </Space>

            {showChecks && checks.length > 0 && (
                <List
                    size="small"
                    bordered
                    dataSource={checks}
                    renderItem={(check) => (
                        <List.Item>
                            <Space align="start">
                                <Tag color={check.level === 'error' ? 'red' : 'gold'}>{t(check.area)}</Tag>
                                <Typography.Text>{check.message}</Typography.Text>
                            </Space>
                        </List.Item>
                    )}
                />
            )}

            <Alert
                type="info"
                showIcon
                message={t('Write each section yourself, or let AI draft it from this report\'s figures. AI never invents figures: any number not in the figures is flagged for you to check.')}
                action={empty.length > 0 && (
                    <Button size="small" icon={<RobotOutlined />} loading={busy === 'all'} disabled={Boolean(busy)} onClick={() => void draft(empty)}>
                        {t('Draft the {count} empty section(s)', undefined, { count: empty.length })}
                    </Button>
                )}
            />

            <Collapse
                activeKey={openSections}
                onChange={(keys) => onOpenSections(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
                items={sections.map((section) => ({
                    key: section.key,
                    label: <Space wrap>{t(section.title)}{section.text.trim() ? <Tag color="green">{t('Written')}</Tag> : <Tag>{t('Empty')}</Tag>}{section.unmatchedFigures?.length ? <Tag color="gold">{t('Check figures')}</Tag> : null}</Space>,
                    children: (
                        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                            {section.unmatchedFigures?.length ? (
                                <Alert type="warning" showIcon message={t('Not in the figures: {figures}. Check or remove before it goes out.', undefined, { figures: section.unmatchedFigures.join(', ') })} />
                            ) : null}
                            <Input.TextArea
                                value={section.text}
                                autoSize={{ minRows: 4, maxRows: 16 }}
                                placeholder={t('Write this section, or draft it with AI.')}
                                onChange={(event) => {
                                    setDirty(true)
                                    setSections((current) => current.map((item) => item.key === section.key ? { ...item, text: event.target.value, unmatchedFigures: undefined } : item))
                                }}
                            />
                            <Button size="small" icon={<RobotOutlined />} loading={busy === section.key} disabled={Boolean(busy)} onClick={() => void draft([section.key])}>
                                {section.text.trim() ? t('Redraft with AI') : t('Draft with AI')}
                            </Button>
                        </Space>
                    ),
                }))}
            />
        </Space>
    )
}
