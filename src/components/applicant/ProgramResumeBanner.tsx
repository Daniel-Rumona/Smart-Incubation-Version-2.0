import { useEffect, useState } from 'react'
import { Alert, App, Button, Space } from 'antd'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { callableMessage, forgetProgramLink, getProgramLinkInfo, type ProgramLinkInfo } from '@/services/programLinkService'
import { useJoinProgramByLink } from '@/hooks/useJoinProgramByLink'
import '@/styles/applicant/program-link-join.css'

const DISMISS_KEY = 'smart-incubation:program-resume-dismissed'

const isDismissed = (programId: string) => {
    try {
        return window.sessionStorage.getItem(DISMISS_KEY) === programId
    } catch {
        return false
    }
}

/**
 * Shown to an independent SME whose account still remembers a programme link they never finished joining
 * (e.g. they opened the link, then came back through the normal sign-in). Lets them pick it back up.
 */
export const ProgramResumeBanner = () => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const joinProgram = useJoinProgramByLink()
    const programId = user?.role === 'incubatee' && user.isApplicant && user.smeJourney === 'independent' ? user.pendingProgramId || '' : ''
    const [info, setInfo] = useState<ProgramLinkInfo>()
    const [hidden, setHidden] = useState(false)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        if (!programId || isDismissed(programId)) return
        let active = true
        getProgramLinkInfo(programId)
            .then((found) => {
                if (!active) return
                // A programme that can no longer be joined is simply forgotten.
                if (found.open && found.selfApplication) setInfo(found)
                else if (user) void forgetProgramLink(user.uid)
            })
            .catch(() => undefined)
        return () => { active = false }
    }, [programId, user])

    if (!programId || !info || hidden || isDismissed(programId)) return null

    const notNow = () => {
        try {
            window.sessionStorage.setItem(DISMISS_KEY, programId)
        } catch {
            // Hidden for this page view only.
        }
        setHidden(true)
    }

    const decline = () => {
        setHidden(true)
        if (user) void forgetProgramLink(user.uid)
    }

    const resume = async () => {
        try {
            setBusy(true)
            await joinProgram(programId)
        } catch (cause) {
            message.error(callableMessage(cause, t('You could not be added to that programme.')))
            setBusy(false)
        }
    }

    return (
        <Alert
            className="program-resume-banner"
            type="info"
            showIcon
            message={t('You started joining {programme}', undefined, { programme: info.programName })}
            description={info.companyName ? t('Offered by {company}. Continue to apply, or carry on using the platform on your own.', undefined, { company: info.companyName }) : t('Continue to apply, or carry on using the platform on your own.')}
            action={
                <Space direction="vertical" size={4}>
                    <Button type="primary" size="small" loading={busy} onClick={() => void resume()}>{t('Continue application')}</Button>
                    <Button size="small" onClick={notNow}>{t('Not now')}</Button>
                    <Button type="link" size="small" onClick={decline}>{t("Don't join")}</Button>
                </Space>
            }
        />
    )
}
