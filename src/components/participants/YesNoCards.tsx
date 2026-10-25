import { CheckCircleFilled } from '@ant-design/icons'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/participant-drawer.css'

export type YesNo = 'yes' | 'no'

/**
 * Two compact selectable cards, Yes and No, for a Form.Item. Each card always shows a marker (an empty ring until
 * chosen). Both unselected means "not answered", which is different from No.
 */
export default function YesNoCards({ value, onChange }: { value?: YesNo; onChange?: (value: YesNo) => void }) {
  const { t } = useLanguage()
  return (
    <div className="pd-yesno" role="radiogroup">
      {(['yes', 'no'] as const).map(option => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={`pd-yesno-card is-${option}${value === option ? ' is-selected' : ''}`}
          onClick={() => onChange?.(option)}
        >
          {value === option ? <CheckCircleFilled className="pd-yesno-check" /> : <span className="pd-yesno-ring" aria-hidden />}
          <span>{option === 'yes' ? t('Yes') : t('No')}</span>
        </button>
      ))}
    </div>
  )
}
