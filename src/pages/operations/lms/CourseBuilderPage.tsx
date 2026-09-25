import { useEffect, useState } from 'react'
import { App, Button, Empty, Form, Grid, Input, Modal, Select, Skeleton, Space, Switch, Tag, Tooltip, Typography } from 'antd'
import {
    ArrowLeftOutlined,
    CopyOutlined,
    DeleteOutlined,
    EyeOutlined,
    PlayCircleOutlined,
    PlusOutlined,
    QuestionCircleOutlined,
    RobotOutlined,
    SaveOutlined,
    SendOutlined,
    UnorderedListOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import { MotionCard } from '@/components/shared/MotionCard'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { ALL_PROGRAMS, useActiveProgramId } from '@/hooks/useActiveProgramId'
import { isAgentApiConfigured } from '@/config/agent'
import { listWorkspacePrograms, type WorkspaceProgram } from '@/services/workspaceProgramsService'
import {
    COURSE_CATEGORIES,
    assignCourseToProgramme,
    generateLessonId,
    generateQuizQuestionId,
    loadCourseTemplate,
    saveCourseTemplate,
    type CourseLesson,
    type CourseTemplate,
} from '@/services/courseTemplatesService'
import LessonOutline from './LessonOutline'
import PreviewCourseModal from './PreviewCourseModal'
import QuizEditor from './QuizEditor'
import '@/styles/survey-builder.css'
import '@/styles/course-lesson.css'
import { useLanguage } from '@/providers/LanguageProvider'

const LMS_PATH = '/operations/lms'

const emptyTemplate = (): CourseTemplate => ({
    title: '',
    description: '',
    lessons: [],
    status: 'draft',
    category: 'Onboarding',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
})

const emptyLesson = (): CourseLesson => ({
    id: generateLessonId(),
    title: 'New lesson',
    body: '',
})

/** Compared against the saved copy to know whether leaving would lose work. */
const fingerprint = (course: CourseTemplate | null) => course
    ? JSON.stringify({
        title: course.title.trim(),
        description: course.description.trim(),
        status: course.status,
        category: course.category,
        programId: course.programId,
        lessons: course.lessons,
    })
    : null

export default function CourseBuilderPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const params = useParams<{ id?: string }>()
    const { activeProgramId } = useActiveProgramId()
    const screens = Grid.useBreakpoint()
    const isCompact = !screens.xl

    // Seeded once: a new course starts scoped to whatever programme the workspace is filtered to.
    const [course, setCourse] = useState<CourseTemplate>(() => ({
        ...emptyTemplate(),
        programId: activeProgramId && activeProgramId !== ALL_PROGRAMS ? activeProgramId : undefined,
    }))
    const [baseline, setBaseline] = useState<string | null>(() => (params.id ? null : fingerprint(emptyTemplate())))
    const [programs, setPrograms] = useState<WorkspaceProgram[]>([])
    // `${lessonId}:content` or `${lessonId}:quiz` — the quiz is its own selectable section, not folded into the lesson.
    const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
    const [loading, setLoading] = useState(Boolean(params.id))
    const [saving, setSaving] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [previewOpen, setPreviewOpen] = useState(false)
    const [outlineOpen, setOutlineOpen] = useState(false)

    useEffect(() => {
        if (!user) return
        void listWorkspacePrograms(user).then(setPrograms).catch(() => setPrograms([]))
    }, [user])

    useEffect(() => {
        if (!params.id) return
        void loadCourseTemplate(params.id)
            .then((template) => {
                if (!template) {
                    message.error(t('That course could not be found.'))
                    navigate(LMS_PATH)
                    return
                }
                setCourse(template)
                setBaseline(fingerprint(template))
                setSelectedStepId(template.lessons[0] ? `${template.lessons[0].id}:content` : null)
            })
            .catch(() => message.error(t('The course could not be loaded.')))
            .finally(() => setLoading(false))
    }, [params.id]) // eslint-disable-line react-hooks/exhaustive-deps

    const isDirty = baseline !== null && fingerprint(course) !== baseline
    const [selectedLessonId, selectedSection] = selectedStepId?.split(':') as [string, 'content' | 'quiz'] || [undefined, undefined]
    const selectedLesson = course.lessons.find((lesson) => lesson.id === selectedLessonId)
    const selectedIndex = course.lessons.findIndex((lesson) => lesson.id === selectedLessonId)
    const quizCount = course.lessons.reduce((sum, lesson) => sum + (lesson.quiz?.length || 0), 0)
    const reviewCount = course.lessons.filter((lesson) => lesson.aiReviewEnabled).length

    const patchCourse = (updates: Partial<CourseTemplate>) => setCourse((current) => ({ ...current, ...updates, updatedAt: new Date().toISOString() }))

    const patchLesson = (id: string, updates: Partial<CourseLesson>) => setCourse((current) => ({
        ...current,
        lessons: current.lessons.map((lesson) => (lesson.id === id ? { ...lesson, ...updates } : lesson)),
    }))

    const addLesson = () => {
        const lesson = emptyLesson()
        setCourse((current) => ({ ...current, lessons: [...current.lessons, lesson] }))
        setSelectedStepId(`${lesson.id}:content`)
    }

    const addQuiz = (lessonId: string) => {
        patchLesson(lessonId, { quiz: [{ id: generateQuizQuestionId(), type: 'single', question: '', required: false, options: ['Option 1', 'Option 2'], correctOptions: [] }] })
        setSelectedStepId(`${lessonId}:quiz`)
    }

    const removeQuiz = (lessonId: string) => {
        patchLesson(lessonId, { quiz: undefined })
        setSelectedStepId(`${lessonId}:content`)
    }

    const duplicateLesson = (id: string) => {
        const source = course.lessons.find((lesson) => lesson.id === id)
        if (!source) return
        const copy: CourseLesson = { ...source, id: generateLessonId(), title: `${source.title} (copy)` }
        const index = course.lessons.findIndex((lesson) => lesson.id === id)
        const lessons = [...course.lessons]
        lessons.splice(index + 1, 0, copy)
        setCourse((current) => ({ ...current, lessons }))
        setSelectedStepId(`${copy.id}:content`)
    }

    const removeLesson = (id: string) => setCourse((current) => {
        const lessons = current.lessons.filter((lesson) => lesson.id !== id)
        setSelectedStepId(lessons[0] ? `${lessons[0].id}:content` : null)
        return { ...current, lessons }
    })

    const reorderLessons = (from: number, to: number) => setCourse((current) => {
        const lessons = [...current.lessons]
        const [moved] = lessons.splice(from, 1)
        lessons.splice(to, 0, moved)
        return { ...current, lessons }
    })

    const save = async (status: 'draft' | 'published') => {
        if (!course.title.trim()) {
            setSettingsOpen(true)
            message.error(t('Give the course a title first.'))
            return
        }
        if (!course.lessons.length) {
            message.error(t('Add at least one lesson.'))
            return
        }
        if (!course.programId) {
            setSettingsOpen(true)
            message.error(t('Choose the programme this course belongs to.'))
            return
        }

        setSaving(true)
        try {
            const next = { ...course, status }
            const id = await saveCourseTemplate(next, user)
            const saved = { ...next, id }
            setCourse(saved)
            setBaseline(fingerprint(saved))

            if (status !== 'published') {
                message.success(t('Draft saved.'))
                return
            }

            // Publishing is what puts the course in front of the programme's SMEs.
            const assigned = await assignCourseToProgramme(saved)
            message.success(assigned
                ? `Course published and sent to ${assigned} SME${assigned === 1 ? '' : 's'}.`
                : t('Course published. Everyone on this programme already has it.'))
        } catch {
            message.error(t('The course could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const goBack = () => {
        if (!isDirty || !course.lessons.length) {
            navigate(LMS_PATH)
            return
        }
        Modal.confirm({
            title: t('Save as draft before leaving?'),
            content: t('This course has unsaved changes.'),
            okText: t('Save draft'),
            cancelText: t('Discard'),
            onOk: async () => { await save('draft'); navigate(LMS_PATH) },
            onCancel: () => navigate(LMS_PATH),
        })
    }

    const outlinePanel = (
        <LessonOutline
            lessons={course.lessons}
            selectedId={selectedStepId}
            onSelect={(stepId) => { setSelectedStepId(stepId); setOutlineOpen(false) }}
            onReorder={reorderLessons}
        />
    )

    const settingsForm = (
        <Form layout="vertical">
            <Form.Item label={t('Programme')} required tooltip={t('Only this programme\'s participants receive the course.')}>
                <Select
                    value={course.programId}
                    onChange={(value) => patchCourse({ programId: value })}
                    placeholder={t('Select a programme')}
                    showSearch
                    optionFilterProp="label"
                    allowClear
                    options={programs.map((program) => ({ value: program.id, label: program.name }))}
                />
            </Form.Item>

            <Form.Item label={t('Title')} required>
                <Input value={course.title} onChange={(event) => patchCourse({ title: event.target.value })} placeholder={t('Course title')} />
            </Form.Item>

            <Form.Item label={t('Description')}>
                <Input.TextArea rows={3} value={course.description} onChange={(event) => patchCourse({ description: event.target.value })} placeholder={t('What is this course about?')} />
            </Form.Item>

            <Form.Item label={t('Category')}>
                <Select
                    value={course.category}
                    onChange={(value) => patchCourse({ category: value })}
                    options={COURSE_CATEGORIES.map((category) => ({ value: category, label: category }))}
                />
            </Form.Item>

            <Form.Item label={t('Department')} tooltip={t('Taken from your own workspace scope.')}>
                <Tag color="purple">{course.department || user?.departmentId || t('Not set')}</Tag>
            </Form.Item>
        </Form>
    )

    return (
        <DashboardPage className="survey-builder-page">
            <MotionCard className="survey-builder-bar">
                <div className="survey-builder-bar-inner">
                    <Space size={8} className="survey-builder-bar-side">
                        <Button icon={<ArrowLeftOutlined />} onClick={goBack}>{t('Back')}</Button>
                        {isCompact && <Button icon={<UnorderedListOutlined />} onClick={() => setOutlineOpen(true)}>{t('Outline')}</Button>}
                        <Button type="primary" icon={<PlusOutlined />} onClick={addLesson}>{t('Add lesson')}</Button>
                    </Space>

                    <button type="button" className="survey-builder-identity" onClick={() => setSettingsOpen(true)}>
                        <strong>{course.title.trim() || t('Untitled course')}</strong>
                        <span>{course.description.trim() || t('Add a description')}</span>
                    </button>

                    <Space size={8} className="survey-builder-bar-side is-end">
                        <Button icon={<EyeOutlined />} disabled={!course.lessons.length} onClick={() => setPreviewOpen(true)}>{t('Preview')}</Button>
                        <Button icon={<SaveOutlined />} loading={saving} onClick={() => void save('draft')}>{t('Save draft')}</Button>
                        <Button type="primary" icon={<SendOutlined />} loading={saving} onClick={() => void save('published')}>{t('Publish')}</Button>
                    </Space>
                </div>
            </MotionCard>

            <div className={`survey-builder-grid${isCompact ? ' is-compact' : ''}`}>
                {!isCompact && (
                    <MotionCard
                        loading={loading}
                        className="survey-builder-panel survey-builder-outline"
                        title={t('Outline')}
                        extra={<Button type="text" size="small" icon={<PlusOutlined />} onClick={addLesson} />}
                    >
                        {outlinePanel}
                    </MotionCard>
                )}

                <div className="survey-builder-canvas">
                    {loading ? <MotionCard loading className="survey-builder-panel" /> : selectedLesson && selectedSection === 'quiz' ? (
                        <MotionCard className="survey-builder-panel survey-builder-question">
                            <div className="survey-question-head">
                                <span className="survey-question-number"><QuestionCircleOutlined /> {t('Quiz')}</span>

                                <Tooltip title={t('Remove this quiz')}>
                                    <Button shape="circle" danger icon={<DeleteOutlined />} onClick={() => removeQuiz(selectedLesson.id)} />
                                </Tooltip>
                            </div>

                            <Typography.Paragraph type="secondary" style={{ marginTop: 4 }}>
                                {t('Shown to the SME as its own step, right after "')}{selectedLesson.title || t('this lesson')}".
                            </Typography.Paragraph>

                            <div style={{ marginTop: 14 }}>
                                <QuizEditor
                                    quiz={selectedLesson.quiz || []}
                                    onChange={(quiz) => patchLesson(selectedLesson.id, { quiz: quiz.length ? quiz : undefined })}
                                />
                            </div>
                        </MotionCard>
                    ) : selectedLesson ? (
                        <MotionCard className="survey-builder-panel survey-builder-question">
                            <div className="survey-question-head">
                                <span className="survey-question-number">{String(selectedIndex + 1).padStart(2, '0')}</span>

                                <Space size={8}>
                                    <Tooltip title={t('Duplicate lesson')}>
                                        <Button shape="circle" icon={<CopyOutlined />} onClick={() => duplicateLesson(selectedLesson.id)} />
                                    </Tooltip>
                                    <Tooltip title={t('Delete lesson')}>
                                        <Button shape="circle" danger icon={<DeleteOutlined />} onClick={() => removeLesson(selectedLesson.id)} />
                                    </Tooltip>
                                </Space>
                            </div>

                            <div className="survey-question-label">
                                <Input.TextArea
                                    variant="borderless"
                                    autoSize={{ minRows: 1, maxRows: 3 }}
                                    value={selectedLesson.title}
                                    onChange={(event) => patchLesson(selectedLesson.id, { title: event.target.value })}
                                    placeholder={t('Lesson title')}
                                />
                            </div>

                            <Input
                                prefix={<PlayCircleOutlined />}
                                value={selectedLesson.videoUrl || ''}
                                onChange={(event) => patchLesson(selectedLesson.id, { videoUrl: event.target.value })}
                                placeholder={t('Video link (YouTube, Vimeo, or a direct video URL) — optional')}
                                style={{ marginTop: 12 }}
                            />

                            <Input.TextArea
                                rows={8}
                                value={selectedLesson.body}
                                onChange={(event) => patchLesson(selectedLesson.id, { body: event.target.value })}
                                placeholder={t('Write the lesson content the SME will read…')}
                                style={{ marginTop: 12 }}
                            />

                            <div className="lesson-quiz-editor">
                                {selectedLesson.quiz?.length ? (
                                    <Space direction="vertical" size={4}>
                                        <Typography.Text strong>
                                            <QuestionCircleOutlined /> {t('This lesson has a quiz —')} {selectedLesson.quiz.length} {t('question')}{selectedLesson.quiz.length === 1 ? '' : 's'}
                                        </Typography.Text>
                                        <Button size="small" onClick={() => setSelectedStepId(`${selectedLesson.id}:quiz`)}>{t('Edit quiz')}</Button>
                                    </Space>
                                ) : (
                                    <Button size="small" icon={<PlusOutlined />} onClick={() => addQuiz(selectedLesson.id)}>
                                        {t('Add a quiz after this lesson')}
                                    </Button>
                                )}

                                {isAgentApiConfigured && (
                                    <div className="survey-setting is-row" style={{ marginTop: 14 }}>
                                        <span><RobotOutlined /> {t('AI review after this lesson')}</span>
                                        <Switch
                                            size="small"
                                            checked={Boolean(selectedLesson.aiReviewEnabled)}
                                            onChange={(aiReviewEnabled) => patchLesson(selectedLesson.id, { aiReviewEnabled })}
                                        />
                                    </div>
                                )}
                            </div>
                        </MotionCard>
                    ) : (
                        <MotionCard className="survey-builder-panel survey-builder-empty">
                            {course.lessons.length ? (
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Select a lesson from the outline')} />
                            ) : (
                                <>
                                    <Typography.Title level={4}>{t('Start building your course')}</Typography.Title>
                                    <Typography.Paragraph type="secondary">{t('Add your first lesson, then arrange them in the outline.')}</Typography.Paragraph>
                                    <Button type="primary" icon={<PlusOutlined />} onClick={addLesson}>{t('Add lesson')}</Button>
                                </>
                            )}
                        </MotionCard>
                    )}
                </div>

                {!isCompact && (
                    <div className="survey-builder-side">
                        <MotionCard loading={loading} className="survey-builder-panel" title={t('Course at a glance')}>
                            <div className="survey-snapshot-row"><span>{t('Lessons')}</span><strong>{course.lessons.length}</strong></div>
                            <div className="survey-snapshot-row"><span>{t('Quiz questions')}</span><strong>{quizCount}</strong></div>
                            {isAgentApiConfigured && <div className="survey-snapshot-row"><span>{t('AI reviews')}</span><strong>{reviewCount}</strong></div>}
                            <div className="survey-snapshot-row"><span>{t('Status')}</span><Tag color={course.status === 'published' ? 'green' : 'default'}>{course.status === 'published' ? t('Published') : t('Draft')}</Tag></div>
                            <div className="survey-snapshot-row"><span>{t('Changes')}</span><Tag color={isDirty ? 'orange' : 'green'}>{isDirty ? t('Unsaved') : t('Saved')}</Tag></div>
                        </MotionCard>
                    </div>
                )}
            </div>

            <Modal
                open={settingsOpen}
                title={t('Course settings')}
                width={520}
                onCancel={() => setSettingsOpen(false)}
                footer={<Button type="primary" onClick={() => setSettingsOpen(false)}>{t('Done')}</Button>}
            >
                {settingsForm}
            </Modal>

            <PreviewCourseModal
                open={previewOpen}
                title={course.title}
                description={course.description}
                lessons={course.lessons}
                onClose={() => setPreviewOpen(false)}
            />

            <Modal
                open={outlineOpen}
                title={t('Outline')}
                footer={null}
                onCancel={() => setOutlineOpen(false)}
                className="survey-outline-modal"
            >
                {loading ? <Skeleton active /> : outlinePanel}
            </Modal>
        </DashboardPage>
    )
}
