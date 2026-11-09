import type { ReactNode } from 'react'
import { Space, Tag, Typography } from 'antd'
import { BankOutlined } from '@ant-design/icons'
import { useLanguage } from '@/providers/LanguageProvider'
import { ALL_ORGANISATIONS, groupByOrganisation, organisationsOf, sameOrganisation } from '@/utils/trainingFormat'
import type { TrainingLearner } from '@/types/training'

/**
 * A class usually has several people from each client company. These show one company at a time (the chips) and,
 * with all companies shown, the learners in a section per company.
 */

export const OrganisationChips = ({ learners, value, onChange }: {
    learners: Pick<TrainingLearner, 'organisation'>[]
    value: string
    onChange: (value: string) => void
}) => {
    const { t } = useLanguage()
    const organisations = organisationsOf(learners)
    if (organisations.length < 2) return null
    const count = (organisation: string) => learners.filter((learner) => sameOrganisation(learner.organisation, organisation)).length
    return (
        <Space wrap size={[6, 6]} style={{ marginBottom: 12 }} role="group" aria-label={t('Show one company')}>
            <Typography.Text type="secondary"><BankOutlined /> {t('Companies')}</Typography.Text>
            <Tag.CheckableTag checked={value === ALL_ORGANISATIONS} onChange={() => onChange(ALL_ORGANISATIONS)}>
                {t('All')} ({learners.length})
            </Tag.CheckableTag>
            {organisations.map((organisation) => (
                <Tag.CheckableTag key={organisation} checked={value !== ALL_ORGANISATIONS && sameOrganisation(value, organisation)} onChange={() => onChange(organisation)}>
                    {organisation} ({count(organisation)})
                </Tag.CheckableTag>
            ))}
        </Space>
    )
}

/** With all companies shown and more than one company, a section per company; otherwise the rows as they are. */
export const OrganisationSections = <T extends Pick<TrainingLearner, 'organisation'>>({ rows, grouped, summary, children }: {
    rows: T[]
    grouped: boolean
    /** A short line under each company's name, e.g. "3 invited · 2 passed". */
    summary?: (rows: T[]) => string
    children: (rows: T[]) => ReactNode
}) => {
    const { t } = useLanguage()
    const groups = groupByOrganisation(rows)
    if (!grouped || groups.length < 2) return <>{children(rows)}</>
    return (
        <Space orientation="vertical" size={18} style={{ width: '100%' }}>
            {groups.map((group) => (
                <section key={group.organisation || '__none'} aria-label={group.organisation || t('No company')}>
                    <Space wrap size={[8, 2]} style={{ marginBottom: 8 }}>
                        <Typography.Title level={5} style={{ margin: 0 }}>{group.organisation || t('No company')}</Typography.Title>
                        <Typography.Text type="secondary">
                            {[group.rows.length === 1 ? t('1 learner') : t('{count} learners', undefined, { count: group.rows.length }), summary?.(group.rows)].filter(Boolean).join(' · ')}
                        </Typography.Text>
                    </Space>
                    {children(group.rows)}
                </section>
            ))}
        </Space>
    )
}
