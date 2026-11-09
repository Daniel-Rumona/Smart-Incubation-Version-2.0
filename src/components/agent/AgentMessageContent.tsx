import type { ReactNode } from 'react'

/**
 * Renders an assistant reply's light markdown (headings, numbered and bulleted lists, **bold**) as elements.
 * Same formatting as the standard Agentic home's replies.
 */

const renderInlineFormatting = (text: string): ReactNode[] =>
    text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => (
        part.startsWith('**') && part.endsWith('**')
            ? <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
            : <span key={`${part}-${index}`}>{part}</span>
    ))

export const AgentMessageContent = ({ content }: { content: string }) => {
    const blocks: Array<{ type: 'paragraph' | 'heading' | 'ordered' | 'unordered', items: string[], start?: number }> = []
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
        if ((type === 'ordered' || type === 'unordered') && previous?.type === type) previous.items.push(value)
        else blocks.push({ type, items: [value], start: type === 'ordered' ? orderedSequence + 1 : undefined })
        if (type === 'ordered') orderedSequence += 1
    }

    return (
        <>
            {blocks.map((block, index) => {
                if (block.type === 'heading') return <h3 key={index}>{renderInlineFormatting(block.items[0])}</h3>
                if (block.type === 'ordered') return <ol key={index} start={block.start}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineFormatting(item)}</li>)}</ol>
                if (block.type === 'unordered') return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineFormatting(item)}</li>)}</ul>
                return <p key={index}>{renderInlineFormatting(block.items[0])}</p>
            })}
        </>
    )
}
