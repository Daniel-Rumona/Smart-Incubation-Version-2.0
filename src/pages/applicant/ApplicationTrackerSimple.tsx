import { Button, Steps } from 'antd'
import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    DownOutlined,
    FileSearchOutlined,
    MessageOutlined,
    SearchOutlined,
    UpOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { openAssistant } from '@/components/agent/openAssistant'
import { useLanguage } from '@/providers/LanguageProvider'
import type { ApplicantApplication } from '@/types/applicant'
import '@/styles/incubatee-simple.css'

type Outcome = 'reviewing' | 'accepted' | 'declined'

export const outcomeOf = (application: ApplicantApplication): Outcome => {
    const status = String(application.applicationStatus || '').toLowerCase()
    if (status === 'accepted') return 'accepted'
    if (status === 'declined' || status === 'rejected') return 'declined'
    return 'reviewing'
}

const submittedOn = (application: ApplicantApplication) => {
    const value = application.submittedAt
    const date = value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function'
        ? dayjs((value as { toDate: () => Date }).toDate())
        : dayjs(value as string)
    return date.isValid() ? date : null
}

/**
 * Simple view of the SME's applications. Left: where the most recent one stands, in three plain steps, and what
 * happens next; any other applications listed under it. Right: help, and a way to find another programme.
 * "Show more detail" adds the dates and compliance scores the Full view shows.
 */
export const ApplicationTrackerSimple = ({ applications }: { applications: ApplicantApplication[] }) => {
    const { t } = useLanguage()
    const navigate = useNavigate()
    const [showMore, setShowMore] = useState(false)

    // Newest first; the one shown large is the newest still being reviewed, else the newest of all.
    const sorted = [...applications].sort((left, right) => (submittedOn(right)?.valueOf() || 0) - (submittedOn(left)?.valueOf() || 0))
    const focus = sorted.find((application) => outcomeOf(application) === 'reviewing') || sorted[0] || null
    const others = sorted.filter((application) => application.id !== focus?.id)
    const programmeName = (application: ApplicantApplication) => application.programName || t('applicant.tracker.fallbackProgram')

    const detail = (application: ApplicantApplication) => (showMore
        ? <small className="sme-simple-detail-line">{[
            submittedOn(application) ? t('Sent {date}', undefined, { date: submittedOn(application)!.format('D MMM YYYY') }) : '',
            t('Documents {score}%', undefined, { score: application.complianceScore ?? 0 }),
        ].filter(Boolean).join(' · ')}</small>
        : null)

    const shortStatus = (application: ApplicantApplication) => ({
        reviewing: t('Being reviewed'),
        accepted: t('Accepted'),
        declined: t('Not accepted this time'),
    })[outcomeOf(application)]

    if (!focus) {
        return (
            <div className="sme-simple is-tracker">
                <div className="sme-simple-main">
                    <h2 className="sme-simple-greeting">{t('Your applications')}</h2>
                    <section className="sme-simple-next is-done">
                        <FileSearchOutlined className="sme-simple-empty-icon" aria-hidden="true" />
                        <h3>{t('You have not applied to a programme yet')}</h3>
                        <p>{t('When you apply, you can follow your application here.')}</p>
                        <Button type="primary" size="large" icon={<SearchOutlined />} onClick={() => navigate('/applicant/programs')}>{t('Find a programme')}</Button>
                    </section>
                </div>
            </div>
        )
    }

    const outcome = outcomeOf(focus)
    const step = outcome === 'reviewing' ? 1 : 2

    return (
        <div className="sme-simple is-tracker has-side">
            <div className="sme-simple-main">
                <h2 className="sme-simple-greeting">{t('Your applications')}</h2>

                <section className="sme-simple-next" aria-label={programmeName(focus)}>
                    <span className="sme-simple-eyebrow">{shortStatus(focus)}</span>
                    <h3 className="sme-simple-app-title">{programmeName(focus)}</h3>
                    <Steps
                        className="sme-simple-app-steps"
                        size="small"
                        current={step}
                        status={outcome === 'declined' ? 'error' : outcome === 'accepted' ? 'finish' : 'process'}
                        items={[
                            { title: t('Sent'), description: submittedOn(focus)?.format('D MMM') },
                            { title: t('Being reviewed') },
                            { title: outcome === 'declined' ? t('Not accepted') : t('Decision') },
                        ]}
                    />
                    <p className="sme-simple-app-next">
                        {outcome === 'reviewing' && t('The programme team is looking at your application. You will see their decision here, and you can keep using your other support while you wait.')}
                        {outcome === 'accepted' && t('You are in. Your programme workspace is ready for you.')}
                        {outcome === 'declined' && t('This programme did not accept your application this time. You can apply to another one.')}
                    </p>
                    {detail(focus)}
                    {outcome === 'accepted' && (
                        // A full load, so the workspace re-reads the SME as a programme participant.
                        <Button type="primary" size="large" block icon={<CheckCircleOutlined />} onClick={() => window.location.assign('/incubatee')}>{t('Go to your programme')}</Button>
                    )}
                    {outcome === 'declined' && (
                        <Button type="primary" size="large" block icon={<SearchOutlined />} onClick={() => navigate('/applicant/programs')}>{t('Find another programme')}</Button>
                    )}
                </section>

                {others.length > 0 && (
                    <section>
                        <div className="sme-simple-list-title">{t('Your other applications')}</div>
                        <ul className="sme-simple-tasks">
                            {others.map((application) => {
                                const icon = { reviewing: <ClockCircleOutlined />, accepted: <CheckCircleOutlined />, declined: <CloseCircleOutlined /> }[outcomeOf(application)]
                                return (
                                    <li key={application.id} className="sme-simple-task">
                                        <span className={`sme-simple-task-icon is-${outcomeOf(application)}`} aria-hidden="true">{icon}</span>
                                        <span className="sme-simple-task-text">
                                            <span>{programmeName(application)}</span>
                                            <small>{shortStatus(application)}</small>
                                            {detail(application)}
                                        </span>
                                    </li>
                                )
                            })}
                        </ul>
                    </section>
                )}

                <div className="sme-simple-footer is-end">
                    <button type="button" className="sme-simple-more is-inline" aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>
                        {showMore ? t('Show less') : t('Show more detail')} {showMore ? <UpOutlined /> : <DownOutlined />}
                    </button>
                </div>
            </div>

            <aside className="sme-simple-side" aria-label={t('Help')}>
                <section className="sme-simple-side-card">
                    <span className="sme-simple-side-label">{t('Questions about your application?')}</span>
                    <span>{t('Thuso can explain what happens next and help you get ready.')}</span>
                    <Button block icon={<MessageOutlined />} onClick={openAssistant}>{t('Get help')}</Button>
                </section>
                <section className="sme-simple-side-card">
                    <span className="sme-simple-side-label">{t('Looking for more support?')}</span>
                    <Button type="link" size="small" icon={<SearchOutlined />} onClick={() => navigate('/applicant/programs')}>{t('Browse programmes')}</Button>
                </section>
            </aside>
        </div>
    )
}
