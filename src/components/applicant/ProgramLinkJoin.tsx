import { useState } from 'react'
import { Alert, App, Button, Input, Space, Typography } from 'antd'
import { LinkOutlined } from '@ant-design/icons'
import { useLanguage } from '@/providers/LanguageProvider'
import { callableMessage, getProgramLinkInfo, parseProgramLink, type ProgramLinkInfo } from '@/services/programLinkService'
import { useJoinProgramByLink } from '@/hooks/useJoinProgramByLink'
import '@/styles/applicant/program-link-join.css'

const { Text } = Typography

/**
 * "Have a programme link?" For SMEs who opened a programme link on one device but signed up on another,
 * without it: pasting the link (or programme id) puts them in that programme.
 */
export const ProgramLinkJoin = ({ compact = false }: { compact?: boolean }) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const joinProgram = useJoinProgramByLink()
    const [value, setValue] = useState('')
    const [info, setInfo] = useState<ProgramLinkInfo>()
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)

    const check = async () => {
        const programId = parseProgramLink(value)
        setInfo(undefined)
        setError('')
        if (!programId) {
            setError(t('That does not look like a programme link. It looks like …/join/abc123.'))
            return
        }
        try {
            setBusy(true)
            const found = await getProgramLinkInfo(programId)
            if (!found.selfApplication) setError(t('This organisation registers its own SMEs. Please contact the programme team.'))
            else if (!found.open) setError(t(found.direct ? 'This programme is not taking new SMEs right now.' : 'This programme is not accepting applications right now.'))
            else setInfo(found)
        } catch (cause) {
            setError(callableMessage(cause, t('That programme link could not be found.')))
        } finally {
            setBusy(false)
        }
    }

    const join = async () => {
        if (!info) return
        try {
            setBusy(true)
            await joinProgram(info.programId)
        } catch (cause) {
            message.error(callableMessage(cause, t('You could not be added to that programme.')))
            setBusy(false)
        }
    }

    return (
        <div className={`program-link-join${compact ? ' is-compact' : ''}`}>
            <Text strong><LinkOutlined /> {t('Have a programme link?')}</Text>
            {!compact && <Text type="secondary">{t('If a programme sent you a link, paste it here to join that programme.')}</Text>}
            <Space.Compact style={{ width: '100%' }}>
                <Input
                    value={value}
                    onChange={(event) => { setValue(event.target.value); setInfo(undefined); setError('') }}
                    onPressEnter={() => void check()}
                    placeholder={t('Paste the programme link')}
                    allowClear
                />
                <Button onClick={() => void check()} loading={busy && !info} disabled={!value.trim()}>{t('Check')}</Button>
            </Space.Compact>
            {error && <Alert type="warning" showIcon message={error} />}
            {info && (
                <Alert
                    type="success"
                    showIcon
                    message={t('{programme}, offered by {company}', undefined, { programme: info.programName, company: info.companyName || '' })}
                    action={<Button type="primary" size="small" loading={busy} onClick={() => void join()}>{t(info.direct ? 'Join' : 'Join and apply')}</Button>}
                />
            )}
        </div>
    )
}
