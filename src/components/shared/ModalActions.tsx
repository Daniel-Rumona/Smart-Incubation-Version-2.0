import type { PropsWithChildren } from 'react'

/**
 * The action row of a modal or sheet. There is no Cancel/Close button (the × closes the dialog); the remaining
 * buttons share the full row width. Styles in styles/global.css.
 */
export const ModalActions = ({ children }: PropsWithChildren) => <div className="modal-actions">{children}</div>
