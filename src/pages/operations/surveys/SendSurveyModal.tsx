import { useEffect, useMemo, useState } from 'react'
import { App, Empty, Input, Modal, Select, Table } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { sendSurveyToParticipants, type SurveyTemplate } from '@/services/surveyTemplatesService'
import { listSendableParticipants, type ParticipantOption } from '@/services/surveyResponsesService'
import type { WorkspaceProgram } from '@/services/workspaceProgramsService'
import { useLanguage } from '@/providers/LanguageProvider'

type SendSurveyModalProps = {
    open: boolean
    templates: SurveyTemplate[]
    programs: WorkspaceProgram[]
    companyCode?: string
    onClose: () => void
    onSent: () => void
}

/** Hand-picks an audience for a published survey, alongside the automatic fan-out that runs on publish. */
export const SendSurveyModal = ({ open, templates, programs, companyCode, onClose, onSent }: SendSurveyModalProps) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const published = useMemo(() => templates.filter((template) => template.status === 'published'), [templates])

    const [templateId, setTemplateId] = useState<string | undefined>(undefined)
    const [participants, setParticipants] = useState<ParticipantOption[]>()
    const [search, setSearch] = useState('')
    const [selectedIds, setSelectedIds] = useState<string[]>([])
    const [sending, setSending] = useState(false)

    const template = published.find((row) => row.id === templateId)

    useEffect(() => {
        if (!open) {
            setTemplateId(undefined)
            setParticipants(undefined)
            setSearch('')
            setSelectedIds([])
        }
    }, [open])

    useEffect(() => {
        if (!template || !companyCode) {
            setParticipants(undefined)
            return
        }
        setSelectedIds([])
        void listSendableParticipants(companyCode, template.programId)
            .then(setParticipants)
            .catch(() => {
                message.error(t('Participants could not be loaded.'))
                setParticipants([])
            })
    }, [template, companyCode]) // eslint-disable-line react-hooks/exhaustive-deps

    const visible = (participants || []).filter((row) => !search.trim() || row.name.toLowerCase().includes(search.trim().toLowerCase()))
    const programName = (programId?: string) => programs.find((row) => row.id === programId)?.name || 'Not scoped'

    const send = async () => {
        if (!template) {
            message.error(t('Choose a survey to send.'))
            return
        }
        if (!selectedIds.length) {
            message.error(t('Select at least one participant.'))
            return
        }

        setSending(true)
        try {
            const sent = await sendSurveyToParticipants(template, selectedIds)
            if (sent) {
                message.success(`Sent to ${sent} participant${sent === 1 ? '' : 's'}.`)
            } else {
                message.info(t('Everyone selected already has this survey.'))
            }
            onSent()
            onClose()
        } catch {
            message.error(t('The survey could not be sent.'))
        } finally {
            setSending(false)
        }
    }

    return (
        <Modal
            open={open}
            title={t('Send survey')}
            width={720}
            onCancel={onClose}
            okText={t('Send')}
            confirmLoading={sending}
            onOk={() => void send()}
            okButtonProps={{ disabled: !template || !selectedIds.length }}
        >
            <Select
                className="survey-response-control"
                placeholder={t('Choose a published survey')}
                value={templateId}
                onChange={setTemplateId}
                options={published.map((row) => ({ value: row.id, label: `${row.title} · ${programName(row.programId)}` }))}
                notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No published surveys yet')} />}
                style={{ marginBottom: 14 }}
            />

            {template && (
                <>
                    <Input
                        allowClear
                        prefix={<SearchOutlined />}
                        placeholder={t('Search participants')}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        style={{ marginBottom: 12, maxWidth: 320 }}
                    />

                    <Table
                        size="small"
                        rowKey="id"
                        loading={!participants}
                        dataSource={visible}
                        pagination={{ pageSize: 8, size: 'small', hideOnSinglePage: true }}
                        rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys as string[]) }}
                        columns={[{ title: t('Participant'), dataIndex: 'name' }]}
                        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No participants in this programme')} /> }}
                    />
                </>
            )}
        </Modal>
    )
}

export default SendSurveyModal
