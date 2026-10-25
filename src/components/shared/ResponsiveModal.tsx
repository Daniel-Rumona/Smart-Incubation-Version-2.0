import type { PropsWithChildren, ReactNode } from 'react'
import { Drawer, Grid, Modal } from 'antd'

import '@/styles/responsive-modal.css'

type ResponsiveModalProps = PropsWithChildren<{
    open: boolean
    title?: ReactNode
    onClose: () => void
    /** Buttons pinned to the bottom of the sheet on mobile, or the modal footer on desktop. */
    footer?: ReactNode
    /** Desktop modal width. */
    width?: number
    className?: string
    destroyOnHidden?: boolean
    /** Desktop only: centre the modal vertically. */
    centered?: boolean
}>

/**
 * A centred modal on desktop and a bottom sheet on phones, where the actions sit within thumb
 * reach and the content gets the full width. Short "are you sure?" confirmations should stay a
 * plain Modal.
 */
export default function ResponsiveModal({
    open,
    title,
    onClose,
    footer = null,
    width = 520,
    className = '',
    destroyOnHidden = true,
    centered = false,
    children,
}: ResponsiveModalProps) {
    const isMobile = !Grid.useBreakpoint().md

    if (isMobile) {
        return (
            <Drawer
                open={open}
                onClose={onClose}
                title={title}
                placement="bottom"
                // Close on the right, like the desktop modals (styled to match in responsive-modal.css).
                closable={{ placement: 'end' }}
                size="auto"
                footer={footer}
                destroyOnHidden={destroyOnHidden}
                rootClassName={`responsive-modal-sheet ${className}`.trim()}
            >
                {children}
            </Drawer>
        )
    }

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={title}
            footer={footer}
            width={width}
            centered={centered}
            destroyOnHidden={destroyOnHidden}
            className={className}
        >
            {children}
        </Modal>
    )
}
