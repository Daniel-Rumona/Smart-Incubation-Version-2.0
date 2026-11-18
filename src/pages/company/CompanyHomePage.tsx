import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Progress, Skeleton, Typography } from 'antd'
import { BellOutlined, CalendarOutlined, FolderOpenOutlined, IdcardOutlined, RightOutlined, SafetyCertificateOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons'
import DashboardPage from '@/components/shared/DashboardPage'
import { CompanyDetailsForm } from '@/components/training/CompanyDetailsForm'
import { MySurveysCard } from '@/components/training/MySurveysCard'
import { useMyOrganisation } from '@/pages/company/useMyOrganisation'
import { teamOf } from '@/pages/company/companyTeam'
import { listMyOrganisationLearners, listTrainingClassesForOrganisation } from '@/services/trainingOrganisationsService'
import { organisationCompleteness } from '@/services/trainingDetailsService'
import { useLanguage } from '@/providers/LanguageProvider'
import { classDatesLabel } from '@/utils/trainingFormat'
import { classPhase } from '@/utils/trainingResults'
import type { TrainingClass, TrainingLearner } from '@/types/training'
import '@/styles/company-portal.css'

/**
 * A client company's home: how far its team's training has come, and what needs doing. Nothing else: the team,
 * profile and certificates each have their own page, one tap away.
 */
export default function CompanyHomePage() {
    const { t } = useLanguage()
    const navigate = useNavigate()
    const { user, organisation, detailsSettings, provider, reload } = useMyOrganisation()
    const [learners, setLearners] = useState<TrainingLearner[]>()
    const [classes, setClasses] = useState<TrainingClass[]>([])

    useEffect(() => {
        if (!user || !organisation) return
        let cancelled = false
        Promise.all([listMyOrganisationLearners(user), listTrainingClassesForOrganisation(user)])
            .then(([people, rows]) => { if (!cancelled) { setLearners(people); setClasses(rows) } }, () => { if (!cancelled) setLearners([]) })
        return () => { cancelled = true }
    }, [user, organisation])

    const team = useMemo(() => (organisation && learners ? teamOf(organisation, learners, classes) : []), [organisation, learners, classes])
    const classById = useMemo(() => new Map(classes.map((row) => [row.id, row])), [classes])

    if (organisation === null) return <DashboardPage><Alert type="warning" showIcon message={t('Your company is no longer registered with {provider}. Please contact them.', undefined, { provider })} /></DashboardPage>
    if (!organisation || !learners) return <DashboardPage><Skeleton active paragraph={{ rows: 8 }} /></DashboardPage>

    // After the invite, the company's details come first, as before.
    const asksDetails = detailsSettings.companyFields.length + detailsSettings.companyDocuments.length > 0
    if (asksDetails && !organisation.detailsSubmittedAt) {
        return (
            <DashboardPage className="training-page">
                <Card title={t('Tell {provider} about {company}', undefined, { provider, company: organisation.name })}>
                    <Typography.Paragraph type="secondary">{t('{provider} asks every company it trains for these details and documents. You can save and finish later.', undefined, { provider })}</Typography.Paragraph>
                    <CompanyDetailsForm organisation={organisation} settings={detailsSettings} firstTime onSaved={() => void reload()} />
                </Card>
            </DashboardPage>
        )
    }

    const certified = team.filter((person) => person.status === 'certified').length
    const inTraining = team.filter((person) => person.status === 'in_class' || person.status === 'booked').length
    const percent = team.length ? Math.round((certified / team.length) * 100) : 0
    const completeness = organisationCompleteness(organisation, detailsSettings)
    const nextClass = learners
        .map((learner) => classById.get(learner.classId))
        .filter((row): row is TrainingClass => !!row && classPhase(row) !== 'finished')
        .sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
    const bookedOnNext = nextClass ? learners.filter((learner) => learner.classId === nextClass.id).length : 0
    const firstName = String(user?.name || user?.displayName || '').trim().split(/\s+/)[0]

    const notices = [
        ...(!team.length ? [{ key: 'team', icon: <UserAddOutlined />, tone: 'warn', text: t('Add the people to be trained. If it is just you, add yourself.'), action: t('Add to team'), to: '/company/team' }] : []),
        ...(asksDetails && !completeness.complete ? [{ key: 'profile', icon: <IdcardOutlined />, tone: 'warn', text: t('Some of your company details or documents are still missing.'), action: t('Finish profile'), to: '/company/profile' }] : []),
        ...(nextClass ? [{ key: 'class', icon: <CalendarOutlined />, tone: 'info', text: t('{course} starts {date}: {count} of your team booked.', undefined, { course: nextClass.courseTitle, date: classDatesLabel(nextClass), count: bookedOnNext }), action: t('See team'), to: '/company/team' }] : []),
        ...(team.some((person) => person.status === 'not_booked') && classes.some((row) => classPhase(row) !== 'finished') ? [{ key: 'book', icon: <TeamOutlined />, tone: 'info', text: t('{count} of your team are not booked on a class yet.', undefined, { count: team.filter((person) => person.status === 'not_booked').length }), action: t('Book them'), to: '/company/team' }] : []),
        ...(certified ? [{ key: 'certs', icon: <SafetyCertificateOutlined />, tone: 'good', text: t('{count} certificate(s) ready to download.', undefined, { count: certified }), action: t('Certificates'), to: '/company/certificates' }] : []),
    ]

    return (
        <DashboardPage className="training-page cp-page">
            <div className="cp-hello">
                <Typography.Title level={3} style={{ margin: 0 }}>{firstName ? t('Hello, {name}', undefined, { name: firstName }) : t('Hello')}</Typography.Title>
                <Typography.Text type="secondary">{t('{company} · training with {provider}', undefined, { company: organisation.name, provider })}</Typography.Text>
            </div>

            <Card className="cp-progress">
                <div className="cp-progress-row">
                    <Progress type="circle" percent={percent} size={112} strokeColor="#16a34a" format={() => <span className="cp-progress-number">{certified}/{team.length}</span>} />
                    <div>
                        <Typography.Title level={4} style={{ margin: 0 }}>{t('Team certified')}</Typography.Title>
                        <Typography.Paragraph type="secondary" style={{ margin: '4px 0 12px' }}>
                            {team.length
                                ? t('{certified} of {total} certified, {training} booked or in a class.', undefined, { certified, total: team.length, training: inTraining })
                                : t('Nobody on your team yet.')}
                        </Typography.Paragraph>
                        <Button type="primary" size="large" icon={<TeamOutlined />} onClick={() => navigate('/company/team')}>{t('Open my team')}</Button>
                    </div>
                </div>
            </Card>

            <Card title={<span><BellOutlined /> {t('What needs doing')}</span>} className="cp-notices">
                {notices.length === 0 && <Typography.Text type="secondary">{t('Nothing needs doing right now.')}</Typography.Text>}
                {notices.map((notice) => (
                    <button key={notice.key} type="button" className={`cp-notice cp-notice-${notice.tone}`} onClick={() => navigate(notice.to)}>
                        <span className="cp-notice-icon" aria-hidden="true">{notice.icon}</span>
                        <span className="cp-notice-text">{notice.text}</span>
                        <span className="cp-notice-action">{notice.action} <RightOutlined /></span>
                    </button>
                ))}
                <MySurveysCard basePath="/company/surveys" />
            </Card>

            <div className="cp-shortcuts">
                <Button size="large" icon={<SafetyCertificateOutlined />} onClick={() => navigate('/company/certificates')}>{t('Certificates')}</Button>
                <Button size="large" icon={<FolderOpenOutlined />} onClick={() => navigate('/company/documents')}>{t('Course materials')}</Button>
                <Button size="large" icon={<IdcardOutlined />} onClick={() => navigate('/company/profile')}>{t('Company profile')}</Button>
            </div>
        </DashboardPage>
    )
}
