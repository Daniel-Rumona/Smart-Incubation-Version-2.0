/*
 * How a WhatsApp reminder is laid out.
 *
 * The same content is rendered two ways:
 *   - the approved template (WHATSAPP_ALERT_TEMPLATE): greeting, headline and the most urgent item go into its three
 *     variables, so the card keeps its own layout;
 *   - plain text (inside the 24-hour window, or no template configured): full line breaks.
 * WhatsApp does not allow line breaks, tabs or runs of spaces inside a template variable.
 */

export type AlertItem = {
  title: string
  sme: string
  overdue: boolean
  /** "due 12 Oct", "4 days overdue" ... shown after the SME name. */
  when: string
}

export type AlertParts = {
  firstName: string
  /** "2 follow-up checks due" */
  headline: string
  items: AlertItem[]
}

const MAX_ITEMS = 3
const flat = (value: string) => value.replace(/\s+/g, ' ').trim()

export const shortDate = (date: Date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

const itemLine = (item: AlertItem) => flat(`${item.overdue ? '⚠️' : '🗓️'} ${item.title} · ${item.sme} · ${item.when}`)

/** Free-form message with real line breaks, for plain text sends. */
export const alertPlainText = (parts: AlertParts, callToAction: string) => [
  '🔔 *Smart Incubation*',
  '',
  `Hi ${parts.firstName || 'there'} 👋 You have *${parts.headline}*:`,
  '',
  ...parts.items.slice(0, MAX_ITEMS).map(itemLine),
  ...(parts.items.length > MAX_ITEMS ? [`…and ${parts.items.length - MAX_ITEMS} more`] : []),
  '',
  callToAction,
].join('\n')

/** The three body variables of the structured template: first name, headline, most urgent item (+ how many more). */
export const alertStructuredParams = (parts: AlertParts): [string, string, string] => {
  const first = parts.items[0]
  const more = parts.items.length > 1 ? ` (+${parts.items.length - 1} more)` : ''
  return [flat(parts.firstName) || 'there', flat(parts.headline), first ? `${itemLine(first)}${more}` : '—']
}
