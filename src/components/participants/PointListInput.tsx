import { Button, Input } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/participant-drawer.css'

export type PointTone = 'green' | 'orange' | 'blue' | 'red'

/**
 * A bulleted list editor for a form field. The field's value stays a newline-separated string (blank lines are
 * dropped when saved), so it drops into the same forms and save code that used a plain text area. Adding a point
 * is done by the caller (a button beside the field's label) by appending a newline to the value.
 */
export default function PointListInput({ value, onChange, placeholder, tone = 'blue' }: { value?: string | string[]; onChange?: (value: string) => void; placeholder?: string; tone?: PointTone }) {
  const { t } = useLanguage()
  const rows = (Array.isArray(value) ? value.join('\n') : String(value ?? '')).split('\n')
  const emit = (next: string[]) => onChange?.(next.join('\n'))

  return (
    <div className={`pd-points is-${tone}`}>
      {rows.map((row, index) => (
        <div key={index} className="pd-point">
          <span className="pd-point-bullet" aria-hidden />
          <Input
            value={row}
            placeholder={placeholder}
            onChange={event => emit(rows.map((current, i) => (i === index ? event.target.value : current)))}
            onPressEnter={() => row.trim() && emit([...rows.slice(0, index + 1), '', ...rows.slice(index + 1)])}
            autoFocus={index > 0 && index === rows.length - 1 && !row}
            suffix={rows.length > 1 || row
              ? <Button type="text" size="small" icon={<CloseOutlined />} aria-label={t('Remove')} onClick={() => emit(rows.length > 1 ? rows.filter((_, i) => i !== index) : [''])} />
              : null}
          />
        </div>
      ))}
    </div>
  )
}
