/*
 * An account marked inactive (or deleted) on the Users or Staff page must not keep working. The server also
 * disables the Firebase sign-in account, but that doesn't end a session that is already open, so the
 * identity provider checks the user record too and signs the person out; the sign-in page then says why.
 */

const NOTICE_KEY = 'smart-incubation-account-deactivated'

export const ACCOUNT_DEACTIVATED_MESSAGE = 'This account has been deactivated. Please contact your programme administrator.'

export const isDeactivatedProfile = (data: Record<string, unknown> | null | undefined) =>
  ['inactive', 'deleted'].includes(String(data?.status || '').trim().toLowerCase())

export const rememberDeactivatedSignOut = () => {
  try {
    window.sessionStorage.setItem(NOTICE_KEY, '1')
  } catch {
    // Storage blocked: the sign-in page just won't show the reason.
  }
}

/** Read once: true when the last session ended because the account was deactivated. */
export const takeDeactivatedNotice = () => {
  try {
    const flagged = window.sessionStorage.getItem(NOTICE_KEY) === '1'
    window.sessionStorage.removeItem(NOTICE_KEY)
    return flagged
  } catch {
    return false
  }
}
