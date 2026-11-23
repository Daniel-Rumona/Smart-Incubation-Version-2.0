import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Checkbox, Col, Form, Input, Modal, Row, Select, Space, Typography } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { bookProspectIntoClass } from '@/services/prospectsService'
import { saveTrainingOrganisation } from '@/services/trainingOrganisationsService'
import { listTrainingClasses } from '@/services/trainingService'
import { prospectName, type Prospect } from '@/types/prospects'
import type { TrainingClass } from '@/types/training'
import { classDatesLabel } from '@/utils/trainingFormat'
import { classPhase } from '@/utils/trainingResults'

/**
 * Training: books a prospect into a class. A person books themselves; a company books its contact person and anyone
 * else it sends. They become learners in the class (the facilitator invites them as usual), the prospect moves to
 * "Booked", and a company can be registered as a client company at the same time.
 */
type Person = { name: string, email?: string, phone?: string }

export function BookIntoClassModal({ prospect, onClose, onBooked }: { prospect: Prospect, onClose: () => void, onBooked: () => void }) {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [form] = Form.useForm<{ classId: string, people: Person[], registerClient: boolean }>()
    const [classes, setClasses] = useState<TrainingClass[]>()
    const [saving, setSaving] = useState(false)
    const isCompany = prospect.kind === 'business'

    useEffect(() => {
        if (!user) return
        let cancelled = false
        void listTrainingClasses(user).catch(() => []).then((rows) => { if (!cancelled) setClasses(rows) })
        return () => { cancelled = true }
    }, [user])

    // Classes still to come or running, soonest first; finished ones cannot take new learners.
    const open = useMemo(() => (classes || [])
        .filter((row) => classPhase(row) !== 'finished')
        .sort((a, b) => a.startDate.localeCompare(b.startDate)), [classes])
    const interested = prospect.interest?.trim().toLowerCase()

    const book = async () => {
        if (!user) return
        const values = await form.validateFields()
        const trainingClass = open.find((row) => row.id === values.classId)
        if (!trainingClass) return
        setSaving(true)
        try {
            const label = `${trainingClass.courseTitle}, ${classDatesLabel(trainingClass)}`
            const { added, skipped } = await bookProspectIntoClass(user, prospect, { id: trainingClass.id, label }, values.people)
            if (isCompany && values.registerClient && !prospect.organisationId) {
                await saveTrainingOrganisation(user, { name: prospect.businessName, contactName: prospect.contactName, contactEmail: prospect.email, phone: prospect.phone })
                    .catch((error) => { if (!(error instanceof Error && error.message === 'duplicate_organisation')) throw error })
            }
            message.success(skipped
                ? t('{added} booked into {course}; {skipped} already in the class.', undefined, { added, skipped, course: trainingClass.courseTitle })
                : t('{added} booked into {course}. Invite them from the class when you are ready.', undefined, { added, course: trainingClass.courseTitle }))
            onBooked()
        } catch {
            message.error(t('The booking could not be made.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal
            open
            width={680}
            title={t('Book {name} into a class', undefined, { name: prospectName(prospect) })}
            okText={t('Book')}
            okButtonProps={{ disabled: !open.length }}
            confirmLoading={saving}
            onOk={() => void book()}
            onCancel={onClose}
            destroyOnHidden
        >
            {classes && !open.length && <Alert type="warning" showIcon title={t('There is no upcoming class. Create one under Classes first.')} />}
            <Form
                form={form}
                layout="vertical"
                requiredMark={false}
                initialValues={{
                    classId: open.find((row) => interested && row.courseTitle.toLowerCase() === interested)?.id,
                    people: [{ name: prospect.contactName, email: prospect.email, phone: prospect.phone }],
                    registerClient: isCompany && !prospect.organisationId,
                }}
                key={open.length}
            >
                <Form.Item name="classId" label={t('Class')} rules={[{ required: true, message: t('Choose a class.') }]}>
                    <Select
                        loading={!classes}
                        placeholder={t('Choose a class')}
                        options={open.map((row) => ({ value: row.id, label: `${row.courseTitle} · ${classDatesLabel(row)}${classPhase(row) === 'running' ? ` · ${t('running')}` : ''}` }))}
                    />
                </Form.Item>
                <Typography.Text strong>{isCompany ? t('Who {company} is sending', undefined, { company: prospect.businessName }) : t('Learner')}</Typography.Text>
                <Form.List name="people">
                    {(fields, { add, remove }) => (
                        <>
                            {fields.map((field) => (
                                <Row gutter={8} key={field.key} align="top" style={{ marginTop: 8 }}>
                                    <Col xs={24} sm={8}><Form.Item name={[field.name, 'name']} rules={[{ required: true, whitespace: true, message: t('Name') }]} style={{ marginBottom: 8 }}><Input placeholder={t('Name')} maxLength={120} /></Form.Item></Col>
                                    <Col xs={24} sm={8}><Form.Item name={[field.name, 'email']} rules={[{ type: 'email', message: t('Enter a valid email address.') }]} style={{ marginBottom: 8 }}><Input placeholder={t('Email')} maxLength={160} /></Form.Item></Col>
                                    <Col xs={20} sm={7}><Form.Item name={[field.name, 'phone']} style={{ marginBottom: 8 }}><Input placeholder={t('Phone')} maxLength={40} /></Form.Item></Col>
                                    <Col xs={4} sm={1}>{fields.length > 1 && <Button type="text" icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} aria-label={t('Remove')} />}</Col>
                                </Row>
                            ))}
                            {isCompany && <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ name: '' })} style={{ marginTop: 4 }}>{t('Add another person')}</Button>}
                        </>
                    )}
                </Form.List>
                {isCompany && !prospect.organisationId && (
                    <Form.Item name="registerClient" valuePropName="checked" style={{ marginTop: 16, marginBottom: 0 }}>
                        <Checkbox>{t('Also register {company} as a client company', undefined, { company: prospect.businessName })}</Checkbox>
                    </Form.Item>
                )}
                <Space style={{ marginTop: 12 }}><Typography.Text type="secondary">{t('They are added to the class as learners; invite them from the class when you are ready.')}</Typography.Text></Space>
            </Form>
        </Modal>
    )
}
