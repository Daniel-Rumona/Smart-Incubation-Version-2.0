import { getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean)

// Optional: only needed for Google Analytics (see src/lib/analytics.ts).
const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID

export const firebaseApp = isFirebaseConfigured
  ? getApps()[0] ?? initializeApp(measurementId ? { ...firebaseConfig, measurementId } : firebaseConfig)
  : undefined

const requireFirebaseApp = () => {
  if (!firebaseApp) {
    throw new Error('Firebase is not configured. Add the required VITE_FIREBASE environment variables.')
  }

  return firebaseApp
}

export const getFirebaseAuth = () => getAuth(requireFirebaseApp())
export const getFirebaseDb = () => getFirestore(requireFirebaseApp())
export const getFirebaseStorage = () => getStorage(requireFirebaseApp())
