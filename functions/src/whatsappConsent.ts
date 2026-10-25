import { FieldValue, type Firestore } from 'firebase-admin/firestore'

/*
 * WhatsApp consent for proactive messages (deadline digests, follow-up reminders).
 *
 * Stored on the user document as `whatsappConsent: { status, source, at, phone? }`.
 * - opted_in:  the person agreed (welcome page, or replied SUBSCRIBE).
 * - declined:  the person chose "Not now" on the welcome page.
 * - opted_out: the person replied STOP.
 * Users with no record at all (accounts created before consent existed) keep receiving alerts, so the
 * rollout does not silently switch off existing reminders. Only an explicit declined / opted_out blocks.
 * Replies to a message the person sent first are never blocked by this.
 */

export type WhatsAppConsentStatus = 'opted_in' | 'declined' | 'opted_out'
export type WhatsAppConsentSource = 'welcome' | 'profile' | 'whatsapp_stop' | 'whatsapp_subscribe'

export const whatsappConsentStatus = (user: Record<string, unknown>): WhatsAppConsentStatus | null => {
  const status = (user.whatsappConsent as { status?: unknown } | undefined)?.status
  return status === 'opted_in' || status === 'declined' || status === 'opted_out' ? status : null
}

export const canReceiveWhatsAppAlerts = (user: Record<string, unknown>) => {
  const status = whatsappConsentStatus(user)
  return status !== 'declined' && status !== 'opted_out'
}

export async function recordWhatsAppConsent(
  db: Firestore,
  userId: string,
  status: WhatsAppConsentStatus,
  source: WhatsAppConsentSource,
  phone?: string,
) {
  await db.collection('users').doc(userId).set({
    whatsappConsent: {
      status,
      source,
      at: new Date().toISOString(),
      ...(phone ? { phone } : {}),
    },
    whatsappConsentHistory: FieldValue.arrayUnion({ status, source, at: new Date().toISOString() }),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

const STOP_WORDS = /^(stop|unsubscribe|opt[\s-]?out|stop all)[\s!.]*$/i
const SUBSCRIBE_WORDS = /^(subscribe|opt[\s-]?in|start alerts|resume alerts)[\s!.]*$/i

export const isStopRequest = (text: string) => STOP_WORDS.test(text.trim())
export const isSubscribeRequest = (text: string) => SUBSCRIBE_WORDS.test(text.trim())
