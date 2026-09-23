import { Button, Checkbox, Input, Radio, Select, Space, Switch, Tooltip } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { QUIZ_QUESTION_TYPES, generateQuizQuestionId, type QuizQuestion, type QuizQuestionType } from '@/services/courseTemplatesService'

type QuizEditorProps = {
    quiz: QuizQuestion[]
    onChange: (quiz: QuizQuestion[]) => void
}

const emptyQuestion = (): QuizQuestion => ({
    id: generateQuizQuestionId(),
    type: 'single',
    question: '',
    required: false,
    options: ['Option 1', 'Option 2'],
    correctOptions: [],
})

export const QuizEditor = ({ quiz, onChange }: QuizEditorProps) => {
    const patch = (id: string, updates: Partial<QuizQuestion>) =>
        onChange(quiz.map((question) => (question.id === id ? { ...question, ...updates } : question)))

    const changeType = (id: string, type: QuizQuestionType) =>
        onChange(quiz.map((question) => {
            if (question.id !== id) return question
            return {
                ...question,
                type,
                options: type === 'text' ? undefined : (question.options?.length ? question.options : ['Option 1', 'Option 2']),
                correctOptions: type === 'text' ? undefined : (question.correctOptions || []),
            }
        }))

    const addQuestion = () => onChange([...quiz, emptyQuestion()])
    const removeQuestion = (id: string) => onChange(quiz.filter((question) => question.id !== id))

    const patchOption = (id: string, index: number, value: string) =>
        onChange(quiz.map((question) => {
            if (question.id !== id) return question
            const previous = question.options?.[index]
            const options = [...(question.options || [])]
            options[index] = value
            // Keep the correct-answer marking pointed at the same option after a rename.
            const correctOptions = (question.correctOptions || []).map((option) => (option === previous ? value : option))
            return { ...question, options, correctOptions }
        }))

    const addOption = (id: string) =>
        onChange(quiz.map((question) => (question.id === id
            ? { ...question, options: [...(question.options || []), `Option ${(question.options?.length || 0) + 1}`] }
            : question)))

    const removeOption = (id: string, index: number) =>
        onChange(quiz.map((question) => {
            if (question.id !== id) return question
            const removed = question.options?.[index]
            const options = (question.options || []).filter((_, position) => position !== index)
            const correctOptions = (question.correctOptions || []).filter((option) => option !== removed)
            return { ...question, options, correctOptions }
        }))

    return (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {quiz.map((question, index) => (
                <div key={question.id} className="quiz-question-block">
                    <div className="quiz-question-block-head">
                        <span className="survey-outline-index" style={{ display: 'inline-block' }}>{index + 1}</span>
                        <Select
                            size="small"
                            value={question.type}
                            onChange={(type) => changeType(question.id, type)}
                            options={QUIZ_QUESTION_TYPES}
                            style={{ width: 150 }}
                        />
                        <Tooltip title="Required">
                            <span className="survey-setting is-row" style={{ marginLeft: 'auto' }}>
                                <span>Required</span>
                                <Switch size="small" checked={question.required} onChange={(required) => patch(question.id, { required })} />
                            </span>
                        </Tooltip>
                        <Tooltip title="Delete question">
                            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeQuestion(question.id)} />
                        </Tooltip>
                    </div>

                    <Input.TextArea
                        size="small"
                        autoSize={{ minRows: 1, maxRows: 3 }}
                        value={question.question}
                        placeholder="Ask a question"
                        onChange={(event) => patch(question.id, { question: event.target.value })}
                        style={{ marginTop: 8 }}
                    />

                    {question.type !== 'text' && (
                        <Space direction="vertical" size={6} className="survey-options" style={{ marginTop: 8, width: '100%' }}>
                            {(question.options || []).map((option, optionIndex) => (
                                <Space.Compact key={optionIndex} block style={{ alignItems: 'center' }}>
                                    {question.type === 'single' ? (
                                        <Radio
                                            checked={(question.correctOptions || [])[0] === option}
                                            onChange={() => patch(question.id, { correctOptions: [option] })}
                                            style={{ marginRight: 6 }}
                                        />
                                    ) : (
                                        <Checkbox
                                            checked={(question.correctOptions || []).includes(option)}
                                            onChange={(event) => {
                                                const current = question.correctOptions || []
                                                const next = event.target.checked ? [...current, option] : current.filter((value) => value !== option)
                                                patch(question.id, { correctOptions: next })
                                            }}
                                            style={{ marginRight: 6 }}
                                        />
                                    )}
                                    <Input
                                        size="small"
                                        value={option}
                                        onChange={(event) => patchOption(question.id, optionIndex, event.target.value)}
                                    />
                                    <Button
                                        size="small"
                                        danger
                                        icon={<DeleteOutlined />}
                                        onClick={() => removeOption(question.id, optionIndex)}
                                    />
                                </Space.Compact>
                            ))}

                            <Button block size="small" type="dashed" icon={<PlusOutlined />} onClick={() => addOption(question.id)}>
                                Add option
                            </Button>
                        </Space>
                    )}
                </div>
            ))}

            <Button block type="dashed" icon={<PlusOutlined />} onClick={addQuestion}>Add quiz question</Button>
        </Space>
    )
}

export default QuizEditor
