import type { CSSProperties } from 'react'
import { CheckCircleFilled } from '@ant-design/icons'

export type OptionCardItem<T extends string> = { value: T; label: string; description?: string }

type Props<T extends string> = {
  options: Array<OptionCardItem<T>>
  /** Supplied by Form.Item when this is its direct child. */
  value?: T
  onChange?: (value: T) => void
  /** Columns on wide screens (collapses to one column on phones). */
  columns?: 1 | 2 | 3
  ariaLabel?: string
}

/** Selectable cards with a title and a one-line explanation; a Form.Item-compatible radio group. */
export const OptionCards = <T extends string>({ options, value, onChange, columns = 2, ariaLabel }: Props<T>) => (
  <div className="welcome-option-grid" role="radiogroup" aria-label={ariaLabel} style={{ '--option-columns': columns } as CSSProperties}>
    {options.map((option) => {
      const selected = value === option.value
      return (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={selected}
          className={`welcome-option${selected ? ' is-selected' : ''}`}
          onClick={() => onChange?.(option.value)}
        >
          <span className="welcome-option-copy">
            <strong>{option.label}</strong>
            {option.description && <small>{option.description}</small>}
          </span>
          <CheckCircleFilled className="welcome-option-check" />
        </button>
      )
    })}
  </div>
)

export default OptionCards
