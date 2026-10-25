import { reload, updatePassword } from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseAuth, getFirebaseDb, getFirebaseStorage } from '@/config/firebase'
import { requestBrandedVerificationEmail } from '@/services/brandedEmailService'
import { encodeSignatureStrokes, type SignatureStrokes } from '@/utils/signatureStrokes'

export type OnboardingRole = 'incubatee' | 'consultant'

export const saveOnboardingRole = async (role: OnboardingRole, profile?: { name?: string, email?: string }) => {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new Error('You are not signed in.')

  const db = getFirebaseDb()
  const batch = writeBatch(db)
  const userRef = doc(db, 'users', user.uid)
  const updates = {
    role,
    onboardingRoleSelectedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(role === 'incubatee' ? { smeOnboardingComplete: false } : {}),
  }

  batch.set(userRef, updates, { merge: true })

  if (role === 'consultant') {
    const consultantRef = doc(db, 'consultantProfiles', user.uid)
    const consultantSnapshot = await getDoc(consultantRef)

    if (!consultantSnapshot.exists()) {
      batch.set(consultantRef, {
        uid: user.uid,
        name: profile?.name || user.displayName || '',
        email: (profile?.email || user.email || '').toLowerCase(),
        phone: '',
        alternativePhone: '',
        phoneIsWhatsApp: false,
        alternativePhoneIsWhatsApp: false,
        profileImageUrl: '',
        verificationStatus: 'unverified',
        headline: '',
        bio: '',
        experienceYears: 0,
        specialties: [],
        country: '',
        province: '',
        physicalAddress: '',
        operatingLocation: '',
        serviceRadiusKm: 25,
        currency: 'USD',
        services: [],
        availability: [],
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Harare',
        acceptingClients: true,
        status: 'draft',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    }
  }

  await batch.commit()
}

export const refreshEmailVerification = async () => {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new Error('You are not signed in.')
  await reload(user)
  if (user.emailVerified) {
    await setDoc(doc(getFirebaseDb(), 'users', user.uid), {
      emailVerified: true,
      emailVerifiedAt: serverTimestamp(),
    }, { merge: true })
  }
  return user.emailVerified
}

export const resendEmailVerification = requestBrandedVerificationEmail

export const updateOnboardingPassword = async (password: string) => {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new Error('You are not signed in.')
  await updatePassword(user, password)
  const updates = {
    mustChangePassword: false,
    passwordChangedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  await Promise.all([
    setDoc(doc(getFirebaseDb(), 'users', user.uid), updates, { merge: true }),
    setDoc(doc(getFirebaseDb(), 'userIdentities', user.uid), updates, { merge: true }),
  ])
}

/**
 * Saves the signature image and, for a drawn signature, the pen movement behind it so signing can replay it.
 * Typed and uploaded signatures clear any old strokes, which would no longer match the image.
 */
export const saveOnboardingSignature = async (signature: Blob, filename = 'signature.png', strokes: SignatureStrokes | null = null) => {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new Error('You are not signed in.')

  const extension = filename.split('.').pop()?.toLowerCase() || 'png'
  const storagePath = `user-signatures/${user.uid}/${Date.now()}.${extension}`
  const storageRef = ref(getFirebaseStorage(), storagePath)
  await uploadBytes(storageRef, signature)
  const signatureURL = await getDownloadURL(storageRef)
  const updates = {
    signatureURL,
    signature: {
      url: signatureURL,
      storagePath,
      updatedAt: new Date().toISOString(),
    },
    signatureStrokes: strokes ? encodeSignatureStrokes(strokes) : null,
    signatureUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  await Promise.all([
    setDoc(doc(getFirebaseDb(), 'users', user.uid), updates, { merge: true }),
    setDoc(doc(getFirebaseDb(), 'userIdentities', user.uid), updates, { merge: true }),
  ])

  return signatureURL
}

/** Roughly E.164 or local format: optional +, then 9 to 15 digits once spaces, dashes and brackets are removed. */
export const isValidWhatsAppNumber = (value: string) => /^\+?\d{9,15}$/.test(value.replace(/[\s\-()]/g, ''))

/**
 * Records the person's WhatsApp choice on their own user document. Opting in also marks the number as a
 * WhatsApp number so the bot can recognise them. Declining keeps any number already saved but blocks alerts.
 * Consent is stored with source and time so it can be audited; replying STOP later overrides it server-side.
 */
export const saveWhatsAppConsent = async (input: ({ optIn: true, phone: string } | { optIn: false }) & { source?: 'welcome' | 'profile' }) => {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new Error('You are not signed in.')
  const phone = input.optIn ? input.phone.trim() : ''
  if (input.optIn && !isValidWhatsAppNumber(phone)) throw new Error('Enter a valid WhatsApp number.')

  await setDoc(doc(getFirebaseDb(), 'users', user.uid), {
    ...(input.optIn ? { phone, phoneIsWhatsApp: true } : {}),
    whatsappConsent: { status: input.optIn ? 'opted_in' : 'declined', source: input.source || 'welcome', at: new Date().toISOString(), ...(phone ? { phone } : {}) },
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export const completeFirstLogin = async () => {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new Error('You are not signed in.')
  await setDoc(doc(getFirebaseDb(), 'users', user.uid), {
    firstLoginComplete: true,
    firstLoginCompletedAt: serverTimestamp(),
  }, { merge: true })
}
