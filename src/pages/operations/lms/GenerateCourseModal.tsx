import { useState } from 'react'
import { App, Button, Checkbox, Modal, Radio, Select, Space, Spin, Switch, Typography, Upload } from 'antd'
import { InboxOutlined, RobotOutlined } from '@ant-design/icons'
import { generateCourseFromText, generateQuizForLesson, type GeneratedCourse } from '@/services/courseGenerationService'
import { MATERIAL_ACCEPT, extractMaterialText, isSupportedMaterial, uploadCourseMaterial } from '@/services/courseMaterialsService'
import type { CourseLesson, QuizQuestion } from '@/services/courseTemplatesService'
import { useLanguage } from '@/providers/LanguageProvider'

type Step = 'upload' | 'review' | 'quizzes'

type GenerateCourseModalProps = {
    open: boolean
    hasLessons: boolean
    onClose: () => void
    onLessons: (lessons: CourseLesson[], meta: { title: string, description: string }, replace: boolean) => void
    onQuiz: (lessonId: string, quiz: QuizQuestion[]) => void
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

const GenerateCourseBody = ({ open, hasLessons, onClose, onLessons, onQuiz }: GenerateCourseModalProps) => {
    const { message } = App.useApp()
    const { t } = useLanguage()

    const [step, setStep] = useState<Step>('upload')
    const [busy, setBusy] = useState<string | null>(null)
    const [file, setFile] = useState<File | null>(null)
    const [text, setText] = useState('')
    const [generated, setGenerated] = useState<GeneratedCourse | null>(null)
    const [selected, setSelected] = useState<string[]>([])
    const [replace, setReplace] = useState(false)
    const [attach, setAttach] = useState(true)
    const [added, setAdded] = useState<CourseLesson[]>([])
    const [quizTargets, setQuizTargets] = useState<string[]>([])
    const [count, setCount] = useState(3)

    const build = async (chosen: File) => {
        if (!isSupportedMaterial(chosen)) {
            message.error(t('Use a PDF, Word (.docx), text or Markdown file.'))
            return
        }

        try {
            setBusy(t('Reading the file…'))
            const extracted = await extractMaterialText(chosen)
            if (extracted.length < 200) throw new Error(t('There is not enough readable text in that file (a scanned PDF?).'))

            setBusy(t('Building lessons…'))
            const course = await generateCourseFromText(extracted, chosen.name)

            setFile(chosen)
            setText(extracted)
            setGenerated(course)
            setSelected(course.lessons.map((lesson) => lesson.id))
            setStep('review')
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('The lessons could not be built.'))
        } finally {
            setBusy(null)
        }
    }

    const addLessons = async () => {
        if (!generated || !file) return
        let lessons = generated.lessons.filter((lesson) => selected.includes(lesson.id))

        try {
            if (attach) {
                setBusy(t('Attaching the file…'))
                const { material } = await uploadCourseMaterial(file, text)
                lessons = lessons.map((lesson) => ({ ...lesson, materials: [material] }))
            }
        } catch (error) {
            message.warning(error instanceof Error ? error.message : t('The file could not be attached, so the lessons were added without it.'))
        } finally {
            setBusy(null)
        }

        onLessons(lessons, { title: generated.title, description: generated.description }, replace)
        setAdded(lessons)
        setQuizTargets(lessons.map((lesson) => lesson.id))
        setStep('quizzes')
    }

    const generateQuizzes = async () => {
        const targets = added.filter((lesson) => quizTargets.includes(lesson.id))
        let failed = 0

        for (const [position, lesson] of targets.entries()) {
            setBusy(t('Writing quiz {n} of {total}…', undefined, { n: position + 1, total: targets.length }))
            try {
                onQuiz(lesson.id, await generateQuizForLesson(lesson, count))
            } catch {
                failed += 1
            }
        }

        setBusy(null)
        if (failed) message.warning(t('{count} quiz(zes) could not be written — you can add them from the lesson.', undefined, { count: failed }))
        else message.success(t('Quizzes added.'))
        onClose()
    }

    return (
        <Modal
            open={open}
            onCancel={() => !busy && onClose()}
            footer={null}
            width={640}
            title={<Space><RobotOutlined />{t('Build a course from a file')}</Space>}
            destroyOnHidden
        >
            <Spin spinning={Boolean(busy)} tip={busy || undefined}>
                {step === 'upload' && (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                            {t('Upload a PDF or Word document. The AI reads it, splits it into lessons, and you review them before anything is added.')}
                        </Typography.Paragraph>
                        <Upload.Dragger
                            accept={MATERIAL_ACCEPT}
                            multiple={false}
                            showUploadList={false}
                            disabled={Boolean(busy)}
                            beforeUpload={(chosen) => { void build(chosen); return Upload.LIST_IGNORE }}
                        >
                            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                            <p className="ant-upload-text">{t('Drop a file here, or click to browse')}</p>
                        </Upload.Dragger>
                    </Space>
                )}

                {step === 'review' && generated && (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <div>
                            <Typography.Title level={5} style={{ margin: 0 }}>{generated.title || file?.name}</Typography.Title>
                            {generated.description && <Typography.Text type="secondary">{generated.description}</Typography.Text>}
                        </div>

                        <div className="generate-lessons-list">
                            {generated.lessons.map((lesson) => (
                                <label key={lesson.id} className="generate-lesson-row">
                                    <Checkbox
                                        checked={selected.includes(lesson.id)}
                                        onChange={(event) => setSelected((current) => event.target.checked ? [...current, lesson.id] : current.filter((id) => id !== lesson.id))}
                                    />
                                    <span>
                                        <strong>{lesson.title}</strong>
                                        <small>{t('{words} words', undefined, { words: wordCount(lesson.body) })} · {lesson.body.replace(/\s+/g, ' ').slice(0, 110)}…</small>
                                    </span>
                                </label>
                            ))}
                        </div>

                        {hasLessons && (
                            <Radio.Group value={replace} onChange={(event) => setReplace(event.target.value)}>
                                <Radio value={false}>{t('Add after my existing lessons')}</Radio>
                                <Radio value>{t('Replace my existing lessons')}</Radio>
                            </Radio.Group>
                        )}

                        <Space>
                            <Switch checked={attach} onChange={setAttach} />
                            <span>{t('Attach the file to each lesson so learners can open it and ask the AI about it')}</span>
                        </Space>

                        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
                            <Button onClick={onClose}>{t('Cancel')}</Button>
                            <Button type="primary" disabled={!selected.length} onClick={() => void addLessons()}>
                                {t('Add {count} lessons', undefined, { count: selected.length })}
                            </Button>
                        </Space>
                    </Space>
                )}

                {step === 'quizzes' && (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <Typography.Title level={5} style={{ margin: 0 }}>{t('Lessons added. Add quizzes based on the content?')}</Typography.Title>
                        <Typography.Text type="secondary">{t('The AI writes questions from each lesson\'s own text. You can edit or remove them afterwards.')}</Typography.Text>

                        <div className="generate-lessons-list">
                            {added.map((lesson) => (
                                <label key={lesson.id} className="generate-lesson-row">
                                    <Checkbox
                                        checked={quizTargets.includes(lesson.id)}
                                        onChange={(event) => setQuizTargets((current) => event.target.checked ? [...current, lesson.id] : current.filter((id) => id !== lesson.id))}
                                    />
                                    <span><strong>{lesson.title}</strong></span>
                                </label>
                            ))}
                        </div>

                        <Space>
                            <span>{t('Questions per lesson')}</span>
                            <Select value={count} onChange={setCount} style={{ width: 80 }} options={[2, 3, 4, 5].map((value) => ({ value, label: value }))} />
                        </Space>

                        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
                            <Button onClick={onClose}>{t('Skip')}</Button>
                            <Button type="primary" disabled={!quizTargets.length} onClick={() => void generateQuizzes()}>{t('Generate quizzes')}</Button>
                        </Space>
                    </Space>
                )}
            </Spin>
        </Modal>
    )
}

/** Remounted on every open so a previous run's file and lessons never linger. */
export const GenerateCourseModal = (props: GenerateCourseModalProps) => (
    <GenerateCourseBody {...props} key={props.open ? 'open' : 'closed'} />
)

export default GenerateCourseModal
