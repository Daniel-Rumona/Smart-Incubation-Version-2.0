/** "Acme Bakery" -> "AB", "Thabo" -> "TH". Used when a person or business has no picture. */
export const initialsOf = (value: unknown) => {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0]?.slice(0, 2) || '?').toUpperCase()
}
