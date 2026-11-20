/**
 * Addresses that can never receive mail: the domains reserved for testing and documentation (RFC 2606 and RFC 6761),
 * which every demo and seed account uses (`*.test`, `example.com`, ...). The mail host accepts them and bounces them
 * later, and enough bounces get the sending account blocked, so sendMailRecord skips them before sending.
 */
const RESERVED_TOP_LEVEL = new Set(['test', 'example', 'invalid', 'localhost'])
const RESERVED_DOMAINS = new Set(['example.com', 'example.net', 'example.org'])

export const isReservedTestAddress = (email: string | null | undefined): boolean => {
  const domain = String(email || '').trim().toLowerCase().split('@')[1] || ''
  if (!domain) return false
  const labels = domain.replace(/\.$/, '').split('.')
  const topLevel = labels[labels.length - 1]
  const lastTwo = labels.slice(-2).join('.')
  return RESERVED_TOP_LEVEL.has(topLevel) || RESERVED_DOMAINS.has(lastTwo)
}
