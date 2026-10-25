import { useState } from 'react'
import { AutoComplete, Button, Input, Typography } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/participant-drawer.css'

export type PlatformLink = { platform: string; link: string }

const SUGGESTED_PLATFORMS = ['YouTube', 'TikTok', 'WhatsApp Business', 'Google Business Profile', 'Pinterest', 'Snapchat', 'Telegram', 'Online marketplace']

/**
 * Other online presence. One entry row (platform, link, Add platform) stays at the top; each platform added goes
 * into a list underneath with its details and a delete button, so the Add button never moves however many are added.
 * A Form.Item-compatible control: its value is the list of added platforms.
 */
export default function PlatformLinksInput({ value, onChange }: { value?: PlatformLink[]; onChange?: (value: PlatformLink[]) => void }) {
  const { t } = useLanguage()
  const reduced = useReducedMotion()
  const [draft, setDraft] = useState<PlatformLink>({ platform: '', link: '' })
  // Only completed entries are kept, so an empty row can never sit in the list.
  const list = (value || []).filter(row => row?.platform?.trim() && row?.link?.trim())
  const canAdd = Boolean(draft.platform.trim() && draft.link.trim())

  const add = () => {
    if (!canAdd) return
    onChange?.([...list, { platform: draft.platform.trim(), link: draft.link.trim() }])
    setDraft({ platform: '', link: '' })
  }

  return (
    <div className="pd-platforms">
      <div className="pd-platform-entry">
        <AutoComplete
          className="pd-platform-name"
          value={draft.platform}
          options={SUGGESTED_PLATFORMS.map(name => ({ value: name }))}
          placeholder={t('Platform')}
          filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())}
          onChange={platform => setDraft(current => ({ ...current, platform }))}
        />
        <Input
          className="pd-platform-link"
          value={draft.link}
          placeholder={t('Link or handle')}
          onChange={event => setDraft(current => ({ ...current, link: event.target.value }))}
          onPressEnter={event => { event.preventDefault(); add() }}
        />
        <Button type="primary" icon={<PlusOutlined />} disabled={!canAdd} onClick={add}>
          {t('Add platform')}
        </Button>
      </div>

      {list.length ? (
        <ul className="pd-platform-list">
          <AnimatePresence initial={false}>
            {list.map((row, index) => (
              <motion.li
                key={`${row.platform}-${row.link}-${index}`}
                className="pd-platform-item"
                layout={!reduced}
                initial={reduced ? false : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
              >
                <Typography.Text strong className="pd-platform-item-name">{row.platform}</Typography.Text>
                <Typography.Text type="secondary" ellipsis className="pd-platform-item-link">{row.link}</Typography.Text>
                <Button type="text" danger size="small" icon={<DeleteOutlined />} aria-label={t('Remove')} onClick={() => onChange?.(list.filter((_, i) => i !== index))} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : null}
    </div>
  )
}
