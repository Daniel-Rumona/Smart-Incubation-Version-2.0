import { Tag } from 'antd'
import { classDatesLabel } from '@/utils/trainingFormat'
import type { TrainingClass } from '@/types/training'
import type { TrainingSurvey } from '@/types/trainingSurveys'

type Translate = (key: string, fallback?: string, vars?: Record<string, string | number>) => string

export const surveyStatusTag = (survey: TrainingSurvey, t: Translate) => survey.status === 'open'
    ? <Tag color="green">{t('Open')}</Tag>
    : survey.status === 'closed' ? <Tag>{t('Closed')}</Tag> : <Tag color="gold">{t('Draft')}</Tag>

/** Who a survey goes to, in words: "Learners: ESG Awareness Training, 2-4 Nov" or "Client companies". */
export const surveyAudienceLabel = (survey: Pick<TrainingSurvey, 'audience' | 'classIds'>, classes: TrainingClass[], t: Translate) => {
    if (survey.audience === 'companies') return t('Client companies')
    if (!survey.classIds.length) return t('Learners of every class')
    const names = survey.classIds.map((id) => classes.find((row) => row.id === id)).filter(Boolean).map((row) => `${row?.courseTitle}, ${classDatesLabel(row as TrainingClass)}`)
    return t('Learners: {classes}', undefined, { classes: names.join('; ') || t('a class that was removed') })
}

