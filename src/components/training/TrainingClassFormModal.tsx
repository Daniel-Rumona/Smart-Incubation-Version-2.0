import { useEffect, useState } from 'react'
import { App, Col, DatePicker, Form, Input, InputNumber, Modal, Row, Segmented, Select, Space, Switch, Tag, TimePicker, Typography } from 'antd'
import { EnvironmentOutlined, SwapOutlined, VideoCameraOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { esgReportingOn } from '@/config/clientModules'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { FunderSelect } from '@/components/training/FunderSelect'
import { MEETING_PLATFORM_LABELS, detectMeetingPlatform, isMeetingUrl } from '@/utils/meetingLinks'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { createTrainingClass, updateTrainingClass } from '@/services/trainingService'
import { useLanguage } from '@/providers/LanguageProvider'
import { trainingDays } from '@/utils/trainingResults'
import type { TrainingAssessment, TrainingClass, TrainingClassHours, TrainingClassValues } from '@/types/training'

type TimeRange = [Dayjs, Dayjs]

type FormValues = Omit<TrainingClassValues, 'startDate' | 'hours' | 'dayHours'> & {
    startDate: Dayjs
    hoursRange: TimeRange
    /** Some days have their own hours (a shorter last day, say). */
    differentDays?: boolean
    dayRanges?: Record<string, TimeRange | undefined>
}

type Props = {
    open: boolean
    /** The class being edited; omitted for a new class. */
    trainingClass?: TrainingClass
    /** A new class starts from the most recent class's settings, so a repeat course needs only dates and venue. */
    template?: TrainingClass
    assessments: TrainingAssessment[]
    onCancel: () => void
    onSaved: (classId: string) => void
}

const TIME_FORMAT = 'HH:mm'
const DEFAULT_HOURS: TrainingClassHours = { start: '09:00', end: '16:00' }
const at = (time: string) => {
    const [hour, minute] = time.split(':').map(Number)
    return dayjs().hour(hour).minute(minute).second(0).millisecond(0)
}
const toRange = (hours: TrainingClassHours): TimeRange => [at(hours.start), at(hours.end)]
const toHours = (range?: TimeRange): TrainingClassHours | undefined =>
    (range?.[0] && range[1] ? { start: range[0].format(TIME_FORMAT), end: range[1].format(TIME_FORMAT) } : undefined)

export const TrainingClassFormModal = ({ open, trainingClass, template, assessments, onCancel, onSaved }: Props) => {
    const { t } = useLanguage()
    const { settings } = useSystemSettings()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [form] = Form.useForm<FormValues>()
    const [saving, setSaving] = useState(false)
    const deliveryMode = Form.useWatch('deliveryMode', form)
    const meetingUrl = Form.useWatch('meetingUrl', form)
    const assessmentId = Form.useWatch('assessmentId', form)
    const dayCount = Form.useWatch('dayCount', form)
    const differentDays = Form.useWatch('differentDays', form)
    // Group work needs the assessment's rubric to be marked against; a course without one passes on the post-assessment.
    // An assessment not in the list (still loading) is given the benefit of the doubt.
    const hasGroupWork = (id?: string) => {
        if (!id) return false
        const assessment = assessments.find((item) => item.id === id)
        return assessment ? (assessment.rubric?.length || 0) > 0 : true
    }
    const groupWorkPossible = hasGroupWork(assessmentId)
    const usesVenue = deliveryMode !== 'online'
    const usesLink = deliveryMode === 'online' || deliveryMode === 'hybrid'
    const days = trainingDays(Math.min(10, Math.max(1, Number(dayCount) || 1)))

    useEffect(() => {
        if (!open) return
        const source = trainingClass || template
        const hours = source?.hours || DEFAULT_HOURS
        form.setFieldsValue({
            courseTitle: source?.courseTitle || '',
            deliveryMode: source?.deliveryMode || 'in_person',
            venue: trainingClass?.venue || '',
            meetingUrl: trainingClass?.meetingUrl || '',
            startDate: trainingClass?.startDate ? dayjs(trainingClass.startDate) : undefined,
            dayCount: source?.dayCount || 1,
            hoursRange: toRange(hours),
            differentDays: Boolean(trainingClass?.dayHours && Object.keys(trainingClass.dayHours).length),
            // Every day starts from the usual hours; the edited class's own day hours replace them.
            dayRanges: Object.fromEntries(trainingDays(10).map((day) => [day, toRange(trainingClass?.dayHours?.[day] || hours)])),
            assessmentId: source?.assessmentId,
            preAssessmentId: source?.preAssessmentId,
            // Like the venue and link, the funder belongs to one run: a new class never inherits the last one's.
            funderId: trainingClass?.funderId,
            passMarkPct: source?.passMarkPct ?? 70,
            reassessmentsAllowed: source?.reassessmentsAllowed ?? 1,
            groupAssignmentRequired: (source?.groupAssignmentRequired ?? true) && hasGroupWork(source?.assessmentId),
        })
    }, [form, open, template, trainingClass]) // eslint-disable-line react-hooks/exhaustive-deps

    const submit = async () => {
        if (!user) return
        const { hoursRange, differentDays: perDay, dayRanges, ...values } = await form.validateFields()
        const payload: TrainingClassValues = {
            ...values,
            startDate: values.startDate.format('YYYY-MM-DD'),
            hours: toHours(hoursRange),
            dayHours: perDay
                ? Object.fromEntries(trainingDays(values.dayCount).flatMap((day) => {
                    const own = toHours(dayRanges?.[day])
                    return own ? [[day, own]] : []
                }))
                : undefined,
            groupAssignmentRequired: Boolean(values.groupAssignmentRequired) && hasGroupWork(values.assessmentId),
        }
        setSaving(true)
        try {
            const id = trainingClass
                ? (await updateTrainingClass(user, trainingClass.id, payload), trainingClass.id)
                : await createTrainingClass(user, payload)
            message.success(trainingClass ? t('Class updated.') : t('Class created.'))
            onSaved(id)
        } catch (error) {
            const code = error instanceof Error ? error.message : ''
            message.error(code === 'invalid_meeting_url'
                ? t('Paste the full meeting link, starting with https://.')
                : code === 'invalid_hours' ? t('The class must end after it starts.') : t('The class could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const endsAfterStart = async (_: unknown, range?: TimeRange) => {
        if (!range?.[0] || !range[1]) throw new Error(t('Enter the class hours.'))
        if (!range[1].isAfter(range[0])) throw new Error(t('The class must end after it starts.'))
    }

    return (
        <Modal
            open={open}
            title={trainingClass ? t('Edit class') : t('New class')}
            okText={trainingClass ? t('Save changes') : t('Create class')}
            onOk={() => void submit()}
            confirmLoading={saving}
            onCancel={onCancel}
            destroyOnHidden
            width={640}
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item name="courseTitle" label={t('Course')} rules={[{ required: true, whitespace: true, message: t('Enter the course name.') }]}>
                    <Input placeholder={esgReportingOn(settings) ? t('e.g. ESG Awareness Training') : t('e.g. Fire Safety Awareness Training')} maxLength={120} />
                </Form.Item>
                <Form.Item
                    name="deliveryMode"
                    label={t('How the class is held')}
                    extra={deliveryMode === 'hybrid' ? t('Some learners come to the venue and others join online. Each day\'s register records which.') : undefined}
                >
                    <Segmented
                        block
                        options={[
                            { value: 'in_person', label: t('In person'), icon: <EnvironmentOutlined /> },
                            { value: 'online', label: t('Online'), icon: <VideoCameraOutlined /> },
                            { value: 'hybrid', label: t('In person and online'), icon: <SwapOutlined /> },
                        ]}
                    />
                </Form.Item>
                {usesVenue && (
                    <Form.Item name="venue" label={t('Venue')} rules={[{ required: true, whitespace: true, message: t('Enter where the class takes place.') }]}>
                        <Input maxLength={160} />
                    </Form.Item>
                )}
                {usesLink && (
                    <Form.Item
                        name="meetingUrl"
                        label={t('Meeting link')}
                        extra={meetingUrl && isMeetingUrl(meetingUrl)
                            ? <Tag color="blue" style={{ marginTop: 6 }}>{t('Detected: {platform}', undefined, { platform: t(MEETING_PLATFORM_LABELS[detectMeetingPlatform(meetingUrl)]) })}</Tag>
                            : t('Paste the Zoom, Microsoft Teams or Google Meet link. Learners join from their training page.')}
                        rules={[{
                            required: true,
                            validator: async (_, value?: string) => {
                                if (!isMeetingUrl(value)) throw new Error(t('Paste the full meeting link, starting with https://.'))
                            },
                        }]}
                    >
                        <Input placeholder="https://" maxLength={500} inputMode="url" />
                    </Form.Item>
                )}
                <Row gutter={12}>
                    <Col xs={24} sm={12}>
                        <Form.Item name="startDate" label={t('First day')} rules={[{ required: true, message: t('Choose the first training day.') }]}>
                            <DatePicker style={{ width: '100%' }} format="D MMM YYYY" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                        <Form.Item name="dayCount" label={t('Training days')} rules={[{ required: true }]}>
                            <InputNumber min={1} max={10} style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                </Row>
                <Form.Item
                    name="hoursRange"
                    label={days.length > 1 ? t('Hours each day') : t('Hours')}
                    extra={t('The class shows as finished once the last day\'s end time has passed.')}
                    rules={[{ validator: endsAfterStart }]}
                >
                    <TimePicker.RangePicker format={TIME_FORMAT} minuteStep={15} needConfirm={false} style={{ width: '100%' }} />
                </Form.Item>
                {days.length > 1 && (
                    <Form.Item name="differentDays" label={t('Different hours on some days')} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                )}
                {days.length > 1 && differentDays && (
                    <Space orientation="vertical" size={0} style={{ width: '100%', marginBottom: 8 }}>
                        {days.map((day) => (
                            <Form.Item key={day} name={['dayRanges', day]} label={t('Day {day}', undefined, { day })} rules={[{ validator: endsAfterStart }]} style={{ marginBottom: 10 }}>
                                <TimePicker.RangePicker format={TIME_FORMAT} minuteStep={15} needConfirm={false} style={{ width: '100%' }} />
                            </Form.Item>
                        ))}
                    </Space>
                )}
                <Row gutter={12}>
                    <Col xs={24} sm={12}>
                        <Form.Item
                            name="preAssessmentId"
                            label={t('Pre-assessment')}
                            extra={assessments.length ? t('Written at the start; it does not count.') : t('Add assessments under Assessments, then choose them here.')}
                        >
                            <Select
                                allowClear
                                placeholder={t('Same as the post-assessment')}
                                options={assessments.filter((assessment) => assessment.use !== 'post').map((assessment) => ({ value: assessment.id, label: assessment.title }))}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                        <Form.Item name="assessmentId" label={t('Post-assessment')} extra={t('Written at the end; it decides who passes.')}>
                            <Select
                                allowClear
                                placeholder={t('Choose the post-assessment')}
                                options={assessments.filter((assessment) => assessment.use !== 'pre').map((assessment) => ({ value: assessment.id, label: assessment.title }))}
                                onChange={(value?: string) => form.setFieldValue('groupAssignmentRequired', hasGroupWork(value))}
                            />
                        </Form.Item>
                    </Col>
                </Row>
                <Row gutter={12}>
                    <Col xs={24} sm={12}>
                        <Form.Item name="passMarkPct" label={t('Post-assessment pass mark')} rules={[{ required: true }]}>
                            <InputNumber min={0} max={100} suffix="%" style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                        <Form.Item name="reassessmentsAllowed" label={t('Reassessments allowed')} rules={[{ required: true }]}>
                            <InputNumber min={0} max={5} style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                </Row>
                <Form.Item name="funderId" label={t('Funded by')} extra={t('The class and its learners count in this funder\'s report. A learner funded by someone else can be marked on the learner.')}>
                    <FunderSelect />
                </Form.Item>
                <Form.Item
                    name="groupAssignmentRequired"
                    label={t('Group assignment needed to pass')}
                    valuePropName="checked"
                    extra={groupWorkPossible
                        ? t('Switch off if this course has no group assignment.')
                        : t('This course has no group assignment (its assessment has no group rubric), so learners pass on the post-assessment alone.')}
                >
                    <Switch disabled={!groupWorkPossible} />
                </Form.Item>
                <Typography.Text type="secondary">
                    {t('A learner passes with a post-assessment score at or above the pass mark, plus taking part in a marked group assignment when that is switched on. Attendance is recorded but not required. Learners write assessments online once you open each one from the class\'s Assessments tab.')}
                </Typography.Text>
            </Form>
        </Modal>
    )
}
