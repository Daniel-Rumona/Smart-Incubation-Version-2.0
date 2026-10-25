import { Badge, Button, Dropdown, Grid, Input, Popconfirm, Segmented, Select, Space, Tooltip, Typography, Upload } from 'antd'
import { SlidersOutlined } from '@ant-design/icons'
import { Children, Fragment, isValidElement, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { MotionCard, SunkenPanel } from '@/components/shared/MotionCard'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { useLanguage } from '@/providers/LanguageProvider'
import { useFitSteps } from '@/hooks/useFitSteps'

type FilterBarProps = {
  title?: ReactNode
  primary: ReactNode
  advanced?: ReactNode
  actions?: ReactNode
  /**
   * Skip the mobile "Filters" button and modal, and render `primary` (plus
   * `actions`) inline instead. The modal exists to tuck away more filters
   * than a phone screen can show at once — a page with only a control or two
   * and no `advanced` section has nothing worth hiding behind it.
   * Pages with a search box get the search-plus-Filters layout on phones regardless.
   */
  compact?: boolean
  /** How many filters are narrowed from their default, for the badge on the phone Filters button. Worked out from the controls when omitted. */
  activeFilters?: number
}

type ControlProps = { value?: unknown, options?: unknown[], children?: ReactNode }

/** The controls a page passed, with fragments and Space wrappers opened up. */
const controlsOf = (node: ReactNode): ReactNode[] =>
  Children.toArray(node).flatMap((child) =>
    isValidElement(child) && (child.type === Fragment || child.type === Space)
      ? controlsOf((child.props as ControlProps).children)
      : [child])

const isSearch = (node: ReactNode): node is ReactElement => isValidElement(node) && (node.type === Input || node.type === Input.Search)
const isViewSwitch = (node: ReactNode) => isValidElement(node) && node.type === Segmented

type SegmentedOption = string | number | { value: string | number, label?: ReactNode, icon?: ReactNode, disabled?: boolean }
type SegmentedProps = { value?: string | number, onChange?: (value: string | number) => void, options?: SegmentedOption[] }

/**
 * On phones a switch with more than three options doesn't fit, and a sideways-scrolling bar hides some of them,
 * so it becomes a full-width dropdown with the same options (icons kept) and the same value and handler.
 */
const PhoneViewSwitch = ({ view }: { view: ReactElement }) => {
  const { value, onChange, options = [] } = view.props as SegmentedProps
  if (options.length <= 3) return view
  return (
    <Select
      className="filter-bar-view-select"
      value={value}
      onChange={(next) => onChange?.(next)}
      options={options.map((option) => (typeof option === 'object'
        ? { value: option.value, disabled: option.disabled, label: <span className="filter-bar-view-option">{option.icon}{option.label ?? option.value}</span> }
        : { value: option, label: option }))}
    />
  )
}
// Buttons some pages place among their filters (export, clear, add) stay on the page with the actions.
const ACTION_TYPES: unknown[] = [Button, Dropdown, Tooltip, Popconfirm, Upload]
const isAction = (node: ReactNode) => isValidElement(node) && ACTION_TYPES.includes(node.type)

const optionValue = (option: unknown) => (option && typeof option === 'object' && 'value' in option ? (option as { value: unknown }).value : option)

/** A control counts as active when it holds a value other than "all" or its first option. */
const isNarrowed = (node: ReactNode) => {
  if (!isValidElement(node)) return false
  const { value, options } = node.props as ControlProps
  if (value === undefined || value === null || value === '') return false
  if (Array.isArray(value) && !value.length) return false
  if (typeof value === 'string' && value.toLowerCase() === 'all') return false
  if (Array.isArray(options) && options.length && optionValue(options[0]) === value) return false
  return true
}

export const FilterBar = ({ title, primary, advanced, actions, compact = false, activeFilters }: FilterBarProps) => {
  const { t } = useLanguage()
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const inline = compact && !advanced
  // Desktop keeps one row. When labels run long (some languages), optional detail goes first, then buttons
  // drop to their icons, then the unselected view labels, and only then does the row wrap.
  const rowRef = useRef<HTMLDivElement>(null)
  useFitSteps(rowRef, ['detail', 'detail buttons', 'detail buttons views', 'detail buttons views wrap'], !isMobile, (row, step) => {
    // A button reduced to its icon still shows its name on hover.
    row.querySelectorAll<HTMLElement>('.ant-btn').forEach((button) => {
      if (step.includes('buttons') && !button.title && button.querySelector('.ant-btn-icon')) {
        const name = Array.from(button.children)
          .filter((part) => !part.classList.contains('ant-btn-icon'))
          .map((part) => part.textContent?.trim())
          .filter(Boolean)
          .join(' · ')
        if (name) { button.title = name; button.dataset.fitTitle = '' }
      } else if (!step.includes('buttons') && 'fitTitle' in button.dataset) {
        button.removeAttribute('title')
        delete button.dataset.fitTitle
      }
    })
  })

  // Phones: the search box and view switches (which change what the page shows) stay on screen, and so do the
  // page's buttons; only the narrowing filters move into a bottom sheet behind a Filters button. Desktop keeps the full row.
  const controls = [...controlsOf(primary), ...controlsOf(advanced)]
  const search = controls.find(isSearch)
  const views = controls.filter(isViewSwitch)
  const inlineActions = controls.filter(isAction)
  const sheetFilters = controls.filter((control) => control !== search && !isViewSwitch(control) && !isAction(control))
  const searchLayout = isMobile && (!!search || (!inline && views.length > 0))
  const narrowed = activeFilters ?? sheetFilters.filter(isNarrowed).length

  const filtersButton = (block: boolean) => (
    <Badge count={narrowed} size="small" offset={[-4, 4]} className={block ? 'filter-bar-filters-block' : undefined}>
      {block
        ? <Button block icon={<SlidersOutlined />} onClick={() => setAdvancedOpen(true)}>{t('common.filters')}</Button>
        : <Button icon={<SlidersOutlined />} aria-label={t('common.filters')} onClick={() => setAdvancedOpen(true)} />}
    </Badge>
  )

  const renderBody = () => {
    if (searchLayout) {
      return (
        <div className="filter-bar-mobile">
          {search && (
            <div className="filter-bar-search-row">
              {search}
              {sheetFilters.length > 0 && filtersButton(false)}
            </div>
          )}
          {views.length > 0 && <div className="filter-bar-views">{views.map((view, index) => isValidElement(view) ? <PhoneViewSwitch key={view.key ?? index} view={view} /> : view)}</div>}
          {(!search && sheetFilters.length > 0) || actions || inlineActions.length > 0
            ? (
              <div className="filter-bar-mobile-actions">
                {!search && sheetFilters.length > 0 && filtersButton(true)}
                {inlineActions}
                {actions}
              </div>
            )
            : null}
        </div>
      )
    }
    if (isMobile && !inline) return <Button block icon={<SlidersOutlined />} onClick={() => setAdvancedOpen(true)}>{t('common.filters')}</Button>
    return (
      <div className={`filter-bar-primary${isMobile ? ' is-stacked' : ''}`}>
        <div className="filter-bar-controls" ref={rowRef}>
          {primary}
          {actions}
          {advanced && <Button icon={<SlidersOutlined />} onClick={() => setAdvancedOpen(true)}>{t('common.moreFilters')}</Button>}
        </div>
      </div>
    )
  }

  const sheetContent = searchLayout ? sheetFilters : <>{isMobile && primary}{advanced}</>
  const hasSheet = searchLayout ? sheetFilters.length > 0 : !inline

  return (
    <>
      <MotionCard className="filter-bar">
        <SunkenPanel className="filter-bar-panel">
          {title && <Typography.Title level={5} className="filter-bar-title">{title}</Typography.Title>}
          {renderBody()}
        </SunkenPanel>
      </MotionCard>

      {hasSheet && (
        <ResponsiveModal
          open={advancedOpen}
          title={t('common.filters')}
          onClose={() => setAdvancedOpen(false)}
          footer={<Button type="primary" block onClick={() => setAdvancedOpen(false)}>{t('common.applyFilters')}</Button>}
          centered
          destroyOnHidden={false}
          className="filter-modal"
        >
          <div className="filter-modal-grid">{sheetContent}</div>
        </ResponsiveModal>
      )}
    </>
  )
}
