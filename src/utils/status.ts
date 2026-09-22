export type ItemTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success'

export const TAG_COLOR: Record<ItemTone, string> = {
    neutral: 'default',
    info: 'blue',
    warning: 'gold',
    danger: 'red',
    success: 'green',
}

/**
 * Statuses reach the UI in whatever casing the source collection stored them
 * ('in_progress', 'AWAITING_CONFIRMATION', 'accepted'), so every label is normalised
 * to one house form ('In Progress', 'Awaiting Confirmation', 'Accepted') before it is shown.
 */
export const formatStatus = (status: string) => String(status || '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')

export const statusTone = (status: string): ItemTone => {
    const value = String(status || '').replace(/[_-]+/g, ' ').trim().toLowerCase()
    if (['missing', 'expired', 'overdue', 'rejected', 'declined', 'not uploaded'].includes(value)) return 'danger'
    if (['completed', 'complete', 'submitted', 'valid', 'approved', 'confirmed', 'done'].includes(value)) return 'success'
    if (['in progress', 'active', 'started'].includes(value)) return 'info'
    if (value.startsWith('awaiting') || ['pending', 'assigned', 'pending assignment', 'sent'].includes(value)) return 'warning'
    return 'neutral'
}
