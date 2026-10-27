import type { ModalProps } from 'antd'

/**
 * For antd's own Modal footer: hide the Cancel button (the × closes the dialog) and stretch the main button across
 * the row. Spread it in place of okButtonProps: `{...singleActionFooter({ disabled: !ready })}`.
 * Not for Modal.confirm / modal.confirm, which has no × and keeps its Cancel.
 */
export const singleActionFooter = (okButtonProps?: ModalProps['okButtonProps']): Pick<ModalProps, 'okButtonProps' | 'cancelButtonProps'> => ({
  okButtonProps: { ...okButtonProps, block: true },
  cancelButtonProps: { style: { display: 'none' } },
})
