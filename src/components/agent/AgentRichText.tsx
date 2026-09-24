import { useState, type ReactNode } from 'react'

type ContentBlock = {
    type: 'paragraph' | 'heading' | 'ordered' | 'unordered'
    items: string[]
    start?: number
}

/** A follow-up offered on a single list item: tap the item, pick one, and its prompt is sent. */
export type RichTextItemAction = {
    label: string
    prompt: (item: string) => string
}

const formatInline = (text: string): ReactNode[] => text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, index) => (
        part.startsWith('**') && part.endsWith('**')
            ? <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
            : <span key={`${part}-${index}`}>{part}</span>
    ))

type AgentRichTextProps = {
    content: string
    /** When set, list items become tappable and offer these follow-ups. */
    itemActions?: RichTextItemAction[]
    onItemAction?: (prompt: string) => void
}

export const AgentRichText = ({ content, itemActions, onItemAction }: AgentRichTextProps) => {
    const [openItem, setOpenItem] = useState<string | null>(null)
    const blocks: ContentBlock[] = []
    let orderedSequence = 0

    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line) continue

        const heading = line.match(/^#{1,4}\s+(.+)$/)
        const ordered = line.match(/^\d+[.)]\s+(.+)$/)
        const unordered = line.match(/^[-*]\s+(.+)$/)
        const type = heading ? 'heading' : ordered ? 'ordered' : unordered ? 'unordered' : 'paragraph'
        const value = heading?.[1] || ordered?.[1] || unordered?.[1] || line
        const previous = blocks.at(-1)

        if ((type === 'ordered' || type === 'unordered') && previous?.type === type) {
            previous.items.push(value)
        } else {
            blocks.push({ type, items: [value], start: type === 'ordered' ? orderedSequence + 1 : undefined })
        }

        if (type === 'ordered') orderedSequence += 1
    }

    const interactive = Boolean(itemActions?.length && onItemAction)

    const renderItem = (item: string, key: string) => {
        if (!interactive) return <li key={key}>{formatInline(item)}</li>

        const open = openItem === key
        return (
            <li key={key} className={`agent-rich-item${open ? ' is-open' : ''}`}>
                <button type="button" className="agent-rich-item-text" aria-expanded={open} onClick={() => setOpenItem(open ? null : key)}>
                    {formatInline(item)}
                </button>
                {open && (
                    <span className="agent-rich-item-actions">
                        {itemActions?.map((action) => (
                            <button
                                type="button"
                                key={action.label}
                                onClick={() => { setOpenItem(null); onItemAction?.(action.prompt(item.replace(/\*\*/g, ''))) }}
                            >
                                {action.label}
                            </button>
                        ))}
                    </span>
                )}
            </li>
        )
    }

    return (
        <div className="agent-rich-text">
            {blocks.map((block, index) => {
                if (block.type === 'heading') return <h4 key={index}>{formatInline(block.items[0])}</h4>
                if (block.type === 'ordered') return <ol key={index} start={block.start}>{block.items.map((item, itemIndex) => renderItem(item, `${index}-${itemIndex}`))}</ol>
                if (block.type === 'unordered') return <ul key={index}>{block.items.map((item, itemIndex) => renderItem(item, `${index}-${itemIndex}`))}</ul>
                return <p key={index}>{formatInline(block.items[0])}</p>
            })}
        </div>
    )
}
