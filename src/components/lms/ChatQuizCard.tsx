import { Button } from 'antd'
import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons'
import type { ChatQuiz } from '@/lib/lessonQuiz'
import { useLanguage } from '@/providers/LanguageProvider'

type ChatQuizCardProps = {
    quiz: ChatQuiz
    /** Index the learner picked, once they have. */
    picked?: number
    onPick: (index: number) => void
    onNext: () => void
}

/** A multiple-choice question inside the chat: tap an option, get instant feedback, then move to the next. */
export const ChatQuizCard = ({ quiz, picked, onPick, onNext }: ChatQuizCardProps) => {
    const { t } = useLanguage()
    const answered = picked !== undefined

    return (
        <div className="chat-quiz">
            <strong className="chat-quiz-question">{quiz.question}</strong>

            <div className="chat-quiz-options">
                {quiz.options.map((option, index) => {
                    const state = !answered ? '' : index === quiz.correctIndex ? ' is-correct' : index === picked ? ' is-wrong' : ' is-dim'

                    return (
                        <button type="button" key={index} className={`chat-quiz-option${state}`} disabled={answered} onClick={() => onPick(index)}>
                            <span className="chat-quiz-letter">{'ABCDEF'[index]}</span>
                            <span>{option}</span>
                            {answered && index === quiz.correctIndex && <CheckCircleFilled />}
                            {answered && index === picked && index !== quiz.correctIndex && <CloseCircleFilled />}
                        </button>
                    )
                })}
            </div>

            {answered && (
                <div className="chat-quiz-feedback">
                    <Button size="small" type="primary" shape="round" onClick={onNext}>{t('Next question')}</Button>
                </div>
            )}
        </div>
    )
}

export default ChatQuizCard
