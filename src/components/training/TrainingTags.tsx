import { Tag } from 'antd'
import { useLanguage } from '@/providers/LanguageProvider'
import { classStatusLabel, phaseLabel, resultLabel } from '@/utils/trainingFormat'
import type { TrainingClass, TrainingClassPhase, TrainingResultStatus } from '@/types/training'

/** The class's status; given the class, an ongoing one says which day it is on ("Day 2 of 3"). */
export const PhaseTag = ({ phase, trainingClass }: { phase: TrainingClassPhase, trainingClass?: Pick<TrainingClass, 'startDate' | 'dayCount' | 'hours' | 'dayHours'> }) => {
    const { t } = useLanguage()
    return (
        <Tag color={phase === 'running' ? 'green' : phase === 'upcoming' ? 'blue' : 'default'}>
            {trainingClass ? classStatusLabel(trainingClass, t) : phaseLabel(phase, t)}
        </Tag>
    )
}

const RESULT_COLORS: Record<TrainingResultStatus, string> = {
    not_started: 'default',
    awaiting_marking: 'gold',
    reassessment_available: 'orange',
    awaiting_group: 'gold',
    passed: 'green',
    not_passed: 'red',
}

export const ResultTag = ({ status }: { status: TrainingResultStatus }) => {
    const { t } = useLanguage()
    return <Tag color={RESULT_COLORS[status]}>{resultLabel(status, t)}</Tag>
}
