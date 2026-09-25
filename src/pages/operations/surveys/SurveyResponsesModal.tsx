import { useEffect, useState } from 'react'
import { App, Button, Modal, Table, Tag } from 'antd'
import { ArrowLeftOutlined, EyeOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import SurveyResponseViewer from '@/components/surveys/SurveyResponseViewer'
import { listResponsesForTemplate, type SurveyResponseRow } from '@/services/surveyResponsesService'
import type { SurveyTemplate } from '@/services/surveyTemplatesService'
import { useLanguage } from '@/providers/LanguageProvider'

const STATUS_TONE: Record<SurveyResponseRow['status'], string> = {
    'not started': 'default',
    'in progress': 'blue',
    submitted: 'green',
}

const STATUS_LABEL: Record<SurveyResponseRow['status'], string> = {
    'not started': 'Not started',
    'in progress': 'In progress',
    submitted: 'Submitted',
}

type SurveyResponsesModalProps = {
    template: SurveyTemplate | null
    onClose: () => void
}

/** Who a survey went to, where each one stands, and their answers once submitted. */
export const SurveyResponsesModal = ({ template, onClose }: SurveyResponsesModalProps) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const [rows, setRows] = useState<SurveyResponseRow[]>()
    const [selected, setSelected] = useState<SurveyResponseRow | null>(null)

    useEffect(() => {
        if (!template?.id) {
            setRows(undefined)
            setSelected(null)
            return
        }
        setSelected(null)
        void listResponsesForTemplate(template.id)
            .then(setRows)
            .catch(() => {
                message.error(t('Responses could not be loaded.'))
                setRows([])
            })
    }, [template]) // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <Modal
            open={Boolean(template)}
            onCancel={onClose}
            footer={null}
            width={760}
            centered
            title={selected ? selected.participantName : `${template?.title || 'Survey'} · Responses`}
        >
            {selected ? (
                <>
                    <Button icon={<ArrowLeftOutlined />} onClick={() => setSelected(null)} style={{ marginBottom: 16 }}>
                        {t('Back to participants')}
                    </Button>
                    <SurveyResponseViewer fields={template?.fields || []} answers={selected.answers || {}} />
                </>
            ) : (
                <Table
                    size="small"
                    rowKey="participantId"
                    loading={!rows}
                    dataSource={rows}
                    pagination={{ pageSize: 8, size: 'small', hideOnSinglePage: true }}
                    columns={[
                        { title: t('Participant'), dataIndex: 'participantName' },
                        {
                            title: t('Status'),
                            dataIndex: 'status',
                            width: 130,
                            render: (status: SurveyResponseRow['status']) => <Tag color={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Tag>,
                        },
                        {
                            title: t('Last update'),
                            width: 130,
                            render: (_, row) => {
                                const value = row.submittedAt || row.updatedAt
                                return value ? dayjs(value).format('DD MMM YYYY') : '—'
                            },
                        },
                        {
                            title: t('Action'),
                            width: 130,
                            render: (_, row) => (
                                <Button size="small" icon={<EyeOutlined />} disabled={row.status !== 'submitted'} onClick={() => setSelected(row)}>
                                    {t('View')}
                                </Button>
                            ),
                        },
                    ]}
                />
            )}
        </Modal>
    )
}

export default SurveyResponsesModal
