import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { Avatar, Button, Drawer, Modal, Progress, Skeleton, Tooltip, Typography } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useCountUp } from 'react-countup'
import { initialsOf } from '@/utils/initials'
import '@/styles/participant-drawer.css'

const { Text, Title } = Typography

const SPRING = { type: 'spring', stiffness: 380, damping: 32 } as const

/* ---------- Shell: modal on desktop, bottom sheet on tablet and phone ---------- */

export function DetailShell({ compact, open, onClose, title, footer, children }: { compact: boolean; open: boolean; onClose: () => void; title: ReactNode; footer: ReactNode; children: ReactNode }) {
  if (compact) {
    return (
      <Drawer open={open} onClose={onClose} placement="bottom" height="92dvh" destroyOnHidden className="pd-drawer pd-sheet" title={title} footer={footer} closable={{ placement: 'end' }}>
        {children}
      </Drawer>
    )
  }
  return (
    <Modal open={open} onCancel={onClose} width={1100} centered destroyOnHidden className="pd-modal" title={title} footer={footer} styles={{ body: { maxHeight: '68vh', overflowY: 'auto', overflowX: 'hidden' } }}>
      {children}
    </Modal>
  )
}

/* ---------- Hero header ---------- */

type HeroProps = {
  name: string
  owner?: string
  imageUrl?: string
  tags: ReactNode
  /** Overall intervention progress, 0-100. Leave undefined while it is still loading. */
  progress?: number
  position?: { index: number; total: number }
  onPrevious?: () => void
  onNext?: () => void
  previousLabel: string
  nextLabel: string
}

export function ParticipantHero({ name, owner, imageUrl, tags, progress, position, onPrevious, onNext, previousLabel, nextLabel }: HeroProps) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      className="pd-hero"
      initial={reduced ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
    >
      <Avatar className="pd-hero-avatar" src={imageUrl} size={56}>{initialsOf(name || owner)}</Avatar>
      <div className="pd-hero-main">
        <Title level={4} className="pd-hero-name">{name}</Title>
        {owner ? <Text type="secondary">{owner}</Text> : null}
      </div>
      <div className="pd-hero-tags">{tags}</div>
      <div className="pd-hero-side">
        {progress === undefined
          ? <Skeleton.Avatar active size={56} />
          : <Tooltip title={`${progress}%`}><Progress type="circle" size={56} percent={progress} strokeWidth={9} /></Tooltip>}
        {position && position.total > 1 ? (
          <div className="pd-hero-nav">
            <Tooltip title={previousLabel}><Button size="small" shape="circle" icon={<LeftOutlined />} disabled={!onPrevious} onClick={onPrevious} aria-label={previousLabel} /></Tooltip>
            <Text type="secondary" className="pd-hero-position">{position.index + 1} / {position.total}</Text>
            <Tooltip title={nextLabel}><Button size="small" shape="circle" icon={<RightOutlined />} disabled={!onNext} onClick={onNext} aria-label={nextLabel} /></Tooltip>
          </div>
        ) : null}
      </div>
    </motion.div>
  )
}

/* ---------- Sliding tabs ---------- */

export type SlidingTab = { value: string; label: ReactNode; icon?: ReactNode }

/** Underline tabs whose indicator glides between the labels. `onChange` also reports which way the user moved. */
export function SlidingTabs({ tabs, value, onChange, id }: { tabs: SlidingTab[]; value: string; onChange: (value: string, direction: 1 | -1) => void; id: string }) {
  const reduced = useReducedMotion()
  const current = tabs.findIndex(tab => tab.value === value)
  return (
    <div className="pd-tabs" role="tablist">
      {tabs.map((tab, index) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          className={`pd-tab${tab.value === value ? ' is-active' : ''}`}
          onClick={() => tab.value !== value && onChange(tab.value, index > current ? 1 : -1)}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.value === value ? <motion.span layoutId={`pd-tab-indicator-${id}`} className="pd-tab-indicator" transition={reduced ? { duration: 0 } : SPRING} /> : null}
        </button>
      ))}
    </div>
  )
}

/** Cross-fades and slides the tab content in the direction the user moved. */
export function TabPanel({ tabKey, direction, children }: { tabKey: string; direction: 1 | -1; children: ReactNode }) {
  const reduced = useReducedMotion()
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={tabKey}
        initial={reduced ? false : { opacity: 0, x: 28 * direction }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduced ? undefined : { opacity: 0, x: -20 * direction }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

/* ---------- Key figures ---------- */

export type KeyFigure = { key: string; label: string; value: number | null; prefix?: string; suffix?: string; hint?: string; tone?: 'default' | 'good' | 'warn' | 'bad' }

function CountUp({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const { update } = useCountUp({ ref: ref as RefObject<HTMLElement>, end: value, duration: 1, separator: ',', prefix, suffix, startOnMount: true })
  useEffect(() => { update(value) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref}>{`${prefix}${value.toLocaleString()}${suffix}`}</span>
}

export function KeyFigures({ figures }: { figures: KeyFigure[] }) {
  const reduced = useReducedMotion()
  return (
    <div className="pd-figures">
      {figures.map((figure, index) => (
        <motion.div
          key={figure.key}
          className={`pd-figure is-${figure.tone || 'default'}`}
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING, delay: reduced ? 0 : index * 0.05 }}
        >
          <Text type="secondary" className="pd-figure-label">{figure.label}</Text>
          <div className="pd-figure-value">
            {figure.value === null ? '—' : <CountUp value={figure.value} prefix={figure.prefix} suffix={figure.suffix} />}
          </div>
          {figure.hint ? <Text type="secondary" className="pd-figure-hint">{figure.hint}</Text> : null}
        </motion.div>
      ))}
    </div>
  )
}

/* ---------- Skeleton ---------- */

export function ParticipantDrawerSkeleton() {
  return (
    <div className="pd-skeleton" aria-busy="true">
      <div className="pd-figures">
        {[0, 1, 2, 3].map(item => <div key={item} className="pd-figure"><Skeleton active title={false} paragraph={{ rows: 2, width: ['50%', '80%'] }} /></div>)}
      </div>
      <Skeleton active paragraph={{ rows: 6 }} />
    </div>
  )
}
