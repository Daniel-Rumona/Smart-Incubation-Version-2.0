import { useMemo, useState } from 'react'
import { App, Button, Checkbox, Input, Select, Space, Tooltip, Typography, type TableProps } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { OrganisationChips } from '@/components/training/OrganisationFilter'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { downloadCsv } from '@/pages/consultant/ConsultantWorkspaceUtils'
import { recordTrainingAttendance, saveTrainingAttendanceRemark } from '@/services/trainingService'
import { useLanguage } from '@/providers/LanguageProvider'
import { ALL_ORGANISATIONS, hoursLabel, inOrganisation } from '@/utils/trainingFormat'
import { hoursOfDay, trainingDays } from '@/utils/trainingResults'
import type { TrainingAttendanceMode, TrainingClass, TrainingLearner } from '@/types/training'

type Props = {
    trainingClass: TrainingClass
    learners: TrainingLearner[]
    loading: boolean
}

/**
 * The daily register. Attendance is recorded for the record and the client organisations; it does not affect passing.
 * In a hybrid class each present learner is marked as there in person or online.
 */
export const AttendancePanel = ({ trainingClass, learners, loading }: Props) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [organisation, setOrganisation] = useState(ALL_ORGANISATIONS)
    const [saving, setSaving] = useState<string | null>(null)
    const [remarks, setRemarks] = useState<Record<string, string>>({})

    const days = trainingDays(trainingClass.dayCount)
    const dayDate = (day: string) => dayjs(trainingClass.startDate).add(Number(day) - 1, 'day')
    // Each company's learners together.
    const visible = useMemo(
        () => learners.filter(inOrganisation(organisation))
            .sort((left, right) => left.organisation.localeCompare(right.organisation) || left.name.localeCompare(right.name)),
        [learners, organisation],
    )
    const hybrid = trainingClass.deliveryMode === 'hybrid'
    const presentOn = (day: string) => visible.filter((learner) => learner.attendance[day]?.present).length
    const onlineOn = (day: string) => visible.filter((learner) => learner.attendance[day]?.present && learner.attendance[day]?.mode === 'online').length
    const modeLabel = (mode?: TrainingAttendanceMode) => (mode === 'online' ? t('Online') : t('In person'))

    const mark = async (learner: TrainingLearner, day: string, present: boolean, mode?: TrainingAttendanceMode) => {
        if (!user) return
        setSaving(`${learner.id}:${day}`)
        try {
            await recordTrainingAttendance(user, learner.id, day, present, hybrid ? mode || learner.attendance[day]?.mode || 'in_person' : undefined)
        } catch {
            message.error(t('Attendance could not be saved.'))
        } finally {
            setSaving(null)
        }
    }

    const saveRemark = async (learner: TrainingLearner) => {
        const value = remarks[learner.id]
        if (!user || value === undefined || value.trim() === (learner.attendanceRemark || '')) return
        try {
            await saveTrainingAttendanceRemark(user, learner.id, value)
        } catch {
            message.error(t('The remark could not be saved.'))
        }
    }

    const dayCheckbox = (learner: TrainingLearner, day: string) => {
        const entry = learner.attendance[day]
        const box = (
            <Checkbox
                checked={entry?.present === true}
                disabled={saving === `${learner.id}:${day}`}
                onChange={(event) => void mark(learner, day, event.target.checked)}
                aria-label={t('{name} present on day {day}', undefined, { name: learner.name, day })}
            />
        )
        const marked = entry?.recordedBy === 'learner'
            ? <Tooltip title={t('Signed in by the learner')}>{box}</Tooltip>
            : box
        if (!hybrid || !entry?.present) return marked
        return (
            <Space size={4}>
                {marked}
                <Select<TrainingAttendanceMode>
                    size="small"
                    value={entry.mode || 'in_person'}
                    disabled={saving === `${learner.id}:${day}`}
                    onChange={(mode) => void mark(learner, day, true, mode)}
                    options={[{ value: 'in_person', label: t('In person') }, { value: 'online', label: t('Online') }]}
                    style={{ width: 96 }}
                    aria-label={t('How {name} attended day {day}', undefined, { name: learner.name, day })}
                />
            </Space>
        )
    }

    const remarkInput = (learner: TrainingLearner) => (
        <Input
            value={remarks[learner.id] ?? learner.attendanceRemark ?? ''}
            onChange={(event) => setRemarks((current) => ({ ...current, [learner.id]: event.target.value }))}
            onBlur={() => void saveRemark(learner)}
            onPressEnter={() => void saveRemark(learner)}
            placeholder={t('Remark')}
            maxLength={200}
        />
    )

    const exportRegister = () => {
        const exported = downloadCsv(`attendance-${trainingClass.startDate}.csv`, visible.map((learner) => ({
            [t('Date')]: trainingClass.startDate,
            [t('Learner name')]: learner.name,
            [t('Organisation')]: learner.organisation,
            ...Object.fromEntries(days.map((day) => {
                const entry = learner.attendance[day]
                const present = hybrid ? `${t('Present')} (${modeLabel(entry?.mode).toLowerCase()})` : t('Present')
                return [t('Day {day}', undefined, { day }), entry ? (entry.present ? present : t('Absent')) : '']
            })),
            [t('Remarks')]: learner.attendanceRemark || '',
        })))
        if (!exported) message.info(t('There are no learners to export.'))
    }

    const columns: TableProps<TrainingLearner>['columns'] = [
        {
            title: t('Learner'),
            dataIndex: 'name',
            render: (value: string, learner) => (
                <Space orientation="vertical" size={0}>
                    <Typography.Text strong>{value}</Typography.Text>
                    <Typography.Text type="secondary">{learner.organisation}</Typography.Text>
                </Space>
            ),
        },
        ...days.map((day) => ({
            title: (
                <Space orientation="vertical" size={0} style={{ textAlign: 'center' }}>
                    <span>{t('Day {day}', undefined, { day })}</span>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{[dayDate(day).format('ddd D MMM'), hoursLabel(hoursOfDay(trainingClass, day))].filter(Boolean).join(' · ')}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {presentOn(day)}/{visible.length}{hybrid && presentOn(day) ? ` · ${t('{count} online', undefined, { count: onlineOn(day) })}` : ''}
                    </Typography.Text>
                </Space>
            ),
            key: `day-${day}`,
            align: 'center' as const,
            render: (_: unknown, learner: TrainingLearner) => dayCheckbox(learner, day),
        })),
        { title: t('Remarks'), key: 'remark', width: 260, render: (_, learner) => remarkInput(learner) },
    ]

    return (
        <>
            <FilterBar
                compact
                primary={<Typography.Text type="secondary">{t('Tick who is present each day. Attendance does not affect passing.')}</Typography.Text>}
                actions={<Button icon={<DownloadOutlined />} onClick={exportRegister}>{t('Export register')}</Button>}
            />
            <OrganisationChips learners={learners} value={organisation} onChange={setOrganisation} />
            <ResponsiveDataView
                rowKey="id"
                rows={visible}
                columns={columns}
                loading={loading}
                emptyText={learners.length ? t('No learners from this organisation.') : t('Add learners to start the register.')}
                renderCard={(learner) => (
                    <Space orientation="vertical" style={{ width: '100%' }}>
                        <Typography.Text strong>{learner.name}</Typography.Text>
                        <Typography.Text type="secondary">{learner.organisation}</Typography.Text>
                        <Space wrap>
                            {days.map((day) => (
                                <Space key={day} size={4}>
                                    {dayCheckbox(learner, day)}
                                    <span>{t('Day {day}', undefined, { day })}</span>
                                </Space>
                            ))}
                        </Space>
                        {remarkInput(learner)}
                    </Space>
                )}
            />
        </>
    )
}
