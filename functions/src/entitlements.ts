import type { Firestore } from 'firebase-admin/firestore'

/*
 * Company plan / premium features (server side). Mirrors src/config/entitlements.ts and ai-backend/entitlements.py.
 *
 * `companies/{code}.subscription = { tier: 'basic' | 'standard' | 'premium', addOns?: FeatureKey[] }`, written only by a
 * platform admin. A company with no subscription field keeps every feature (so plans never switch off an existing
 * customer); an empty company code (platform staff) is never restricted.
 *
 * What each tier includes is edited on the admin Company plans page and stored in `systemSettings/plans` as
 * `{ tiers: { basic: { features: [...] }, ... } }`. Without it (or for a tier it doesn't list) DEFAULT_TIER_FEATURES apply.
 */

export type FeatureKey = 'whatsappComms' | 'agenticSupport'
export type PlanTier = 'basic' | 'standard' | 'premium'
export type TierFeatures = Record<PlanTier, FeatureKey[]>

export const DEFAULT_TIER_FEATURES: TierFeatures = {
  basic: [],
  standard: ['whatsappComms'],
  premium: ['whatsappComms', 'agenticSupport'],
}
const FEATURE_KEYS: FeatureKey[] = ['whatsappComms', 'agenticSupport']
const TIERS: PlanTier[] = ['basic', 'standard', 'premium']
const isFeatureKey = (value: unknown): value is FeatureKey => FEATURE_KEYS.includes(value as FeatureKey)

export const normalizeTierFeatures = (raw: unknown): TierFeatures => {
  const tiers = (raw && typeof raw === 'object' ? (raw as { tiers?: unknown }).tiers : undefined) as Record<string, { features?: unknown }> | undefined
  return Object.fromEntries(TIERS.map(tier => {
    const features = tiers?.[tier]?.features
    return [tier, Array.isArray(features) ? features.filter(isFeatureKey) : DEFAULT_TIER_FEATURES[tier]]
  })) as TierFeatures
}

export const resolveFeatures = (subscription: unknown, tierFeatures: TierFeatures = DEFAULT_TIER_FEATURES): Record<FeatureKey, boolean> => {
  const sub = (subscription && typeof subscription === 'object' ? subscription : {}) as { tier?: unknown, addOns?: unknown }
  if (sub.tier !== 'basic' && sub.tier !== 'standard' && sub.tier !== 'premium') {
    return { whatsappComms: true, agenticSupport: true }
  }
  const included = new Set<FeatureKey>(tierFeatures[sub.tier])
  if (Array.isArray(sub.addOns)) sub.addOns.forEach(item => { if (isFeatureKey(item)) included.add(item) })
  return { whatsappComms: included.has('whatsappComms'), agenticSupport: included.has('agenticSupport') }
}

// Plan contents change rarely and digests check many companies in a row, so one read serves a minute.
const TIER_CACHE_MS = 60_000
let tierCache: { at: number, value: TierFeatures } | undefined

const loadTierFeatures = async (db: Firestore): Promise<TierFeatures> => {
  if (tierCache && Date.now() - tierCache.at < TIER_CACHE_MS) return tierCache.value
  try {
    const snapshot = await db.collection('systemSettings').doc('plans').get()
    tierCache = { at: Date.now(), value: normalizeTierFeatures(snapshot.data()) }
  } catch (error) {
    console.error('Plan contents lookup failed; using defaults', { error: String(error) })
    return tierCache?.value || DEFAULT_TIER_FEATURES
  }
  return tierCache.value
}

/** Does this company's plan include the feature? Read failures fail open so an outage never blocks a customer. */
export async function companyHasFeature(db: Firestore, companyCode: unknown, feature: FeatureKey): Promise<boolean> {
  const code = String(companyCode || '').trim()
  if (!code) return true
  try {
    const [snapshot, tierFeatures] = await Promise.all([db.collection('companies').doc(code).get(), loadTierFeatures(db)])
    return resolveFeatures(snapshot.data()?.subscription, tierFeatures)[feature]
  } catch (error) {
    console.error('Entitlement lookup failed; allowing', { companyCode: code, feature, error: String(error) })
    return true
  }
}

export const NOT_IN_PLAN_MESSAGE = 'That feature is not part of your organisation’s plan. Ask your platform administrator about upgrading.'
