import { getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, initializeFirestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'
import { connectStorageEmulator, getStorage } from 'firebase/storage'

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

// Local testing only: `npm run dev:emulators` (.env.emulators) points the app at the Firebase emulators started by
// `npm run emulators`. Never set in a deployed build.
export const usesFirebaseEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'

if (firebaseApp && usesFirebaseEmulators) {
  const host = '127.0.0.1'
  connectAuthEmulator(getAuth(firebaseApp), `http://${host}:9099`, { disableWarnings: true })
  // Long polling: the emulator only speaks HTTP/1.1, where the streams of earlier page loads hold the browser's six
  // connections to it for a while, so a few quick reloads leave the next page waiting on Firestore.
  connectFirestoreEmulator(initializeFirestore(firebaseApp, { experimentalForceLongPolling: true }), host, 8080)
  connectStorageEmulator(getStorage(firebaseApp), host, 9199)
  // The callable services all use the us-central1 instance (getFunctions(firebaseApp, 'us-central1')).
  connectFunctionsEmulator(getFunctions(firebaseApp, 'us-central1'), host, 5001)
}

const requireFirebaseApp = () => {
  if (!firebaseApp) {
    throw new Error('Firebase is not configured. Add the required VITE_FIREBASE environment variables, or for the local test setup start the app with `npm run dev:emulators` (or everything with `npm run walkthrough`).')
  }

  return firebaseApp
}

export const getFirebaseAuth = () => getAuth(requireFirebaseApp())
export const getFirebaseDb = () => getFirestore(requireFirebaseApp())
export const getFirebaseStorage = () => getStorage(requireFirebaseApp())
