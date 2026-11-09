import { useState } from 'react'
import { App, Checkbox, Col, Modal, Row, Typography } from 'antd'
import { COMPANY_DETAIL_FIELDS, COMPANY_DOCUMENTS, LEARNER_DETAIL_FIELDS, type TrainingDetailsSettings } from '@/config/trainingDetails'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { saveTrainingDetailsSettings } from '@/services/trainingDetailsService'
import { useLanguage } from '@/providers/LanguageProvider'

/**
 * The facilitator chooses what to ask: of each client company (its details and documents, after its director's
 * invite) and of each learner. The choices come from what Smartinc already asks of SMEs.
 */
export const DetailsSettingsModal = ({ open, settings, onClose, onSaved }: { open: boolean, settings: TrainingDetailsSettings, onClose: () => void, onSaved: () => void }) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    // Mounted each time it opens (see TrainingCompaniesPage), so it starts from the saved choices.
    const [draft, setDraft] = useState(settings)
    const [saving, setSaving] = useState(false)

    const save = async () => {
        if (!user) return
        setSaving(true)
        try {
            await saveTrainingDetailsSettings(user, draft)
            message.success(t('Saved. Companies and learners are asked for these from now on.'))
            onSaved()
        } catch {
            message.error(t('The choices could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const group = (title: string, description: string, items: Array<{ key: string, label: string }>, key: keyof TrainingDetailsSettings) => (
        <section style={{ marginBottom: 18 }}>
            <Typography.Title level={5} style={{ marginBottom: 2 }}>{title}</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>{description}</Typography.Paragraph>
            <Checkbox.Group value={draft[key]} onChange={(values) => setDraft((current) => ({ ...current, [key]: values as string[] }))} style={{ width: '100%' }}>
                <Row gutter={[8, 6]}>
                    {items.map((item) => <Col key={item.key} xs={24} sm={12}><Checkbox value={item.key}>{t(item.label)}</Checkbox></Col>)}
                </Row>
            </Checkbox.Group>
        </section>
    )

    return (
        <Modal open={open} title={t('Details to ask for')} okText={t('Save')} confirmLoading={saving} onOk={() => void save()} onCancel={onClose} width={680} destroyOnHidden>
            {group(t('About each company'), t('Their director fills these in after you give them access. Keep it short.'), COMPANY_DETAIL_FIELDS, 'companyFields')}
            {group(t('Company documents'), t('Uploaded by the company with its details.'), COMPANY_DOCUMENTS, 'companyDocuments')}
            {group(t('About each learner'), t('Asked when you add a learner or a company books one, and on the learner\'s training page. Your funder report counts them, for example women and men trained.'), LEARNER_DETAIL_FIELDS, 'learnerFields')}
        </Modal>
    )
}
