import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseDb, getFirebaseStorage } from '@/config/firebase'

export type UserProfileValues = {
  name: string
  bio: string
  phone: string
  phoneIsWhatsApp: boolean
  alternativePhone: string
  alternativePhoneIsWhatsApp: boolean
  profileImageUrl: string
}

export const getUserProfile = async (uid: string): Promise<UserProfileValues & { saved: boolean }> => {
  const snapshot = await getDoc(doc(getFirebaseDb(), 'users', uid))
  const data = snapshot.data() || {}
  return {
    name: String(data.displayName || data.name || ''),
    saved: Boolean(data.profileSavedAt),
    bio: String(data.bio || ''),
    phone: String(data.phone || ''),
    phoneIsWhatsApp: data.phoneIsWhatsApp === true,
    alternativePhone: String(data.alternativePhone || ''),
    alternativePhoneIsWhatsApp: data.alternativePhoneIsWhatsApp === true,
    profileImageUrl: String(data.profileImageUrl || ''),
  }
}

/** A user may edit their own record (Firestore rules block changing `role`, so it is never written here). */
export const saveUserProfile = async (uid: string, values: UserProfileValues) => {
  const name = values.name.trim()
  await updateDoc(doc(getFirebaseDb(), 'users', uid), {
    name,
    displayName: name,
    bio: values.bio.trim(),
    phone: values.phone.trim(),
    phoneIsWhatsApp: values.phoneIsWhatsApp && Boolean(values.phone.trim()),
    alternativePhone: values.alternativePhone.trim(),
    alternativePhoneIsWhatsApp: values.alternativePhoneIsWhatsApp && Boolean(values.alternativePhone.trim()),
    profileImageUrl: values.profileImageUrl.trim(),
    profileSavedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export const uploadUserProfileImage = async (uid: string, file: File) => {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const storageRef = ref(getFirebaseStorage(), `user-profiles/${uid}/${Date.now()}.${extension}`)
  await uploadBytes(storageRef, file, { contentType: file.type || 'image/jpeg' })
  return getDownloadURL(storageRef)
}

/** The company's display name; falls back to the code if the record is missing or unreadable. */
export const getCompanyName = async (companyCode: string) => {
  try {
    const snapshot = await getDoc(doc(getFirebaseDb(), 'companies', companyCode))
    const data = snapshot.data() || {}
    return String(data.companyName || data.name || companyCode)
  } catch {
    return companyCode
  }
}
