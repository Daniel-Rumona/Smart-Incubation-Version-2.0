import { deleteField, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { PLAN_TIERS, isFeatureKey, isPlanTier, normalizePlanFeatures, type FeatureKey, type PlanFeatures, type PlanTier } from '@/config/entitlements'
import type { FullIdentity } from '@/types/identity'

/** `legacy` = no plan recorded, so the company keeps every feature (nothing was ever switched off). */
export type CompanyPlan = { tier: PlanTier | 'legacy'; addOns: FeatureKey[] }

export const getCompanyPlan = async (companyCode: string): Promise<CompanyPlan> => {
  const snapshot = await getDoc(doc(getFirebaseDb(), 'companies', companyCode))
  const subscription = snapshot.data()?.subscription as { tier?: unknown; addOns?: unknown } | undefined
  if (!subscription || !isPlanTier(subscription.tier)) return { tier: 'legacy', addOns: [] }
  return { tier: subscription.tier, addOns: Array.isArray(subscription.addOns) ? subscription.addOns.filter(isFeatureKey) : [] }
}

/** Platform admins only (the Firestore rules enforce this too). Choosing `legacy` removes the plan record. */
export const saveCompanyPlan = async (user: FullIdentity, companyCode: string, plan: CompanyPlan) => {
  if (!['systemadmin', 'admin'].includes(user.role)) throw new Error('forbidden')
  const ref = doc(getFirebaseDb(), 'companies', companyCode)
  if (plan.tier === 'legacy') {
    await updateDoc(ref, { subscription: deleteField(), updatedAt: serverTimestamp(), updatedByUid: user.uid })
    return
  }
  await updateDoc(ref, {
    subscription: { tier: plan.tier, addOns: plan.addOns.filter(isFeatureKey), updatedByUid: user.uid, updatedByEmail: user.email },
    updatedAt: serverTimestamp(),
    updatedByUid: user.uid,
  })
}

/** What each plan tier includes, from `systemSettings/plans` (defaults when it has never been saved). */
export const getPlanFeatures = async (): Promise<PlanFeatures> => {
  const snapshot = await getDoc(doc(getFirebaseDb(), 'systemSettings', 'plans'))
  return normalizePlanFeatures(snapshot.exists() ? snapshot.data() : undefined)
}

/**
 * Platform admins only (the Firestore rules enforce this too). Saves every tier together, so the document always
 * describes the whole set. Cloud Functions and the AI backend cache it for up to a minute.
 */
export const savePlanFeatures = async (user: FullIdentity, planFeatures: PlanFeatures) => {
  if (!['systemadmin', 'admin'].includes(user.role)) throw new Error('forbidden')
  await setDoc(doc(getFirebaseDb(), 'systemSettings', 'plans'), {
    tiers: Object.fromEntries(PLAN_TIERS.map((tier) => [tier, { features: planFeatures[tier].filter(isFeatureKey) }])),
    updatedAt: serverTimestamp(),
    updatedByUid: user.uid,
    updatedByEmail: user.email,
  })
}
