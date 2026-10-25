/**
 * Company plans and premium features.
 *
 * A company's plan lives on `companies/{code}.subscription` and is only ever written by a platform admin:
 *   { tier: 'basic' | 'standard' | 'premium', addOns?: FeatureKey[] }
 * A feature is on when the tier includes it OR it was added individually as an add-on.
 *
 * Companies with no `subscription` field at all (created before plans existed) keep every feature, so
 * introducing plans never switches anything off for an existing customer. New self-service companies are
 * created on `basic`.
 *
 * What each tier includes is data (`systemSettings/plans`, see PlanFeatures below), with TIERS as the default.
 * The same rules are mirrored in functions/src/entitlements.ts and ai-backend/entitlements.py; keep the
 * three in step.
 */

export type FeatureKey = 'whatsappComms' | 'agenticSupport'
export type PlanTier = 'basic' | 'standard' | 'premium'

export const FEATURES: Record<FeatureKey, { label: string; description: string }> = {
  whatsappComms: {
    label: 'WhatsApp reminders and follow-ups',
    description: 'Deadline digests, follow-up reminders and the WhatsApp follow-up flow.',
  },
  agenticSupport: {
    label: 'Agentic support',
    description: 'The Agentic home, agent-delivered interventions and agent workspaces, and AI actions in the assistant. Without it the assistant gives basic answers only.',
  },
}

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[]

export const TIERS: Record<PlanTier, { label: string; features: FeatureKey[] }> = {
  basic: { label: 'Basic', features: [] },
  standard: { label: 'Standard', features: ['whatsappComms'] },
  premium: { label: 'Premium', features: ['whatsappComms', 'agenticSupport'] },
}

export type Subscription = { tier?: PlanTier; addOns?: FeatureKey[] } | null | undefined

export const isFeatureKey = (value: unknown): value is FeatureKey => FEATURE_KEYS.includes(value as FeatureKey)
export const isPlanTier = (value: unknown): value is PlanTier => value === 'basic' || value === 'standard' || value === 'premium'
export const PLAN_TIERS = Object.keys(TIERS) as PlanTier[]

/**
 * What each plan includes. Platform admins edit this on the Company plans page; it is stored in
 * `systemSettings/plans` as `{ tiers: { basic: { features: [...] }, ... } }`. A missing document or tier falls back
 * to the defaults in TIERS, so nothing changes until an admin saves.
 */
export type PlanFeatures = Record<PlanTier, FeatureKey[]>

export const DEFAULT_PLAN_FEATURES: PlanFeatures = { basic: TIERS.basic.features, standard: TIERS.standard.features, premium: TIERS.premium.features }

export const normalizePlanFeatures = (raw: unknown): PlanFeatures => {
  const tiers = (raw && typeof raw === 'object' ? (raw as { tiers?: unknown }).tiers : undefined) as Record<string, { features?: unknown }> | undefined
  return Object.fromEntries(PLAN_TIERS.map((tier) => {
    const features = tiers?.[tier]?.features
    return [tier, Array.isArray(features) ? features.filter(isFeatureKey) : DEFAULT_PLAN_FEATURES[tier]]
  })) as PlanFeatures
}

export type Entitlements = { legacy: boolean; tier: PlanTier | 'legacy'; features: Record<FeatureKey, boolean> }

export const resolveEntitlements = (subscription: Subscription, planFeatures: PlanFeatures = DEFAULT_PLAN_FEATURES): Entitlements => {
  if (!subscription || typeof subscription !== 'object' || !isPlanTier(subscription.tier)) {
    return { legacy: true, tier: 'legacy', features: { whatsappComms: true, agenticSupport: true } }
  }
  const included = new Set<FeatureKey>([
    ...planFeatures[subscription.tier],
    ...(Array.isArray(subscription.addOns) ? subscription.addOns.filter(isFeatureKey) : []),
  ])
  return {
    legacy: false,
    tier: subscription.tier,
    features: { whatsappComms: included.has('whatsappComms'), agenticSupport: included.has('agenticSupport') },
  }
}
