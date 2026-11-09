import { useEffect, useState } from 'react'
import { Button, Empty, List, Space, Tag, Typography } from 'antd'
import { CheckCircleOutlined, FormOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { MotionCard } from '@/components/shared/MotionCard'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listMySurveys, type MySurvey } from '@/services/trainingSurveysService'
import { useLanguage } from '@/providers/LanguageProvider'

type Props = {
    /** Where one survey is answered: /learner/surveys or /company/surveys. */
    basePath: string
    /** A learner's classes, so only surveys for them show. */
    classIds?: string[]
    /** Show the card even with no open surveys (the company's own Surveys page). */
    showEmpty?: boolean
}

/** The open surveys for this learner or client company, those still to answer first. */
export const MySurveysCard = ({ basePath, classIds = [], showEmpty = false }: Props) => {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const [surveys, setSurveys] = useState<MySurvey[]>()
    const classKey = classIds.join(',')

    useEffect(() => {
        if (!user) return undefined
        let cancelled = false
        listMySurveys(user, classKey ? classKey.split(',') : []).then(
            (rows) => { if (!cancelled) setSurveys(rows) },
            () => { if (!cancelled) setSurveys([]) },
        )
        return () => { cancelled = true }
    }, [classKey, user])

    if (!surveys || (!surveys.length && !showEmpty)) return null
    const toAnswer = surveys.filter((row) => !row.response).length

    return (
        <MotionCard title={<Space><FormOutlined />{t('Surveys')}{toAnswer > 0 && <Tag color="gold">{t('{count} to answer', undefined, { count: toAnswer })}</Tag>}</Space>}>
            <List
                dataSource={surveys}
                locale={{ emptyText: <Empty description={t('No surveys for you right now.')} /> }}
                renderItem={({ survey, response }) => (
                    <List.Item
                        actions={[
                            <Button key="open" type={response ? 'default' : 'primary'} onClick={() => navigate(`${basePath}/${survey.id}`)}>
                                {response ? t('Change my answers') : t('Answer')}
                            </Button>,
                        ]}
                    >
                        <List.Item.Meta
                            title={<Space wrap>{survey.title}{response && <Tag color="green" icon={<CheckCircleOutlined />}>{t('Answered')}</Tag>}</Space>}
                            description={<Typography.Text type="secondary">{survey.description || t('{count} question(s)', undefined, { count: survey.questions.length })}</Typography.Text>}
                        />
                    </List.Item>
                )}
            />
        </MotionCard>
    )
}
