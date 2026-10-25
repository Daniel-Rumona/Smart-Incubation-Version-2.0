// Firebase auth error code (e.g. 'auth/invalid-credential') from an error, if it has one.
export const getAuthErrorCode = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  if (error instanceof Error) return error.message.match(/auth\/[a-z-]+/)?.[0]
  return undefined
}

// The user closed or cancelled a Google/Facebook pop-up: not worth showing an error for.
export const isAuthCancelled = (error: unknown) =>
  ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'].includes(getAuthErrorCode(error) || '')

// English message for an auth error. Callers translate it at render time.
export const getAuthFriendlyError = (error: unknown) => {
  if (error instanceof Error && error.message.includes('Firebase is not configured')) {
    return 'Sign-in is not configured yet. Please contact an administrator.'
  }

  switch (getAuthErrorCode(error)) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'The email address or password is incorrect.'
    case 'auth/email-already-in-use':
      return 'An account already exists for this email address.'
    case 'auth/weak-password':
      return 'Please choose a stronger password.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.'
    case 'auth/network-request-failed':
      return 'We could not reach the server. Check your internet connection and try again.'
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact your programme administrator.'
    case 'auth/account-exists-with-different-credential':
      return 'This email is already linked to another sign-in method. Try signing in with that method instead.'
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in pop-up. Allow pop-ups for this site and try again.'
  }

  console.log('Unhandled auth error:', error)

  return 'Something went wrong. Please try again.'
}
