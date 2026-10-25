import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, Typography } from 'antd'
import { CheckCircleFilled, EditOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import SignatureReplay from '@/components/shared/SignatureReplay'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'

import '@/styles/signature-replay.css'

const { Text } = Typography

type SignDocumentModalProps = {
    open: boolean
    onClose: () => void
    title: ReactNode
    /** What signing does, in a sentence. */
    description?: ReactNode
    signLabel?: string
    /** Saves the signature. Throwing keeps the modal open with the error. */
    onSign: () => Promise<void>
    /** Runs once the person has seen it signed and closes the modal, e.g. to reload the page. */
    onSigned?: () => void
    signedText?: ReactNode
    /** Turns a failed save into the message shown in the modal. */
    errorText?: (error: unknown) => string
}

type Phase = 'ready' | 'signing' | 'signed'

/**
 * The moment of signing: the person's signature writes itself onto the line while it is saved,
 * replaying the pen movement from when they set it up. The drawing doubles as the progress
 * indicator, so a quick save still feels deliberate and a slow one never looks stuck.
 */
export default function SignDocumentModal({ open, onClose, title, description, signLabel, onSign, onSigned, signedText, errorText }: SignDocumentModalProps) {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const [phase, setPhase] = useState<Phase>('ready')
    const [error, setError] = useState('')
    // Signed means both the save landed and the signature finished writing.
    const progress = useRef({ saved: false, written: false })
    const attempt = useRef(0)

    useEffect(() => {
        if (!open) return
        progress.current = { saved: false, written: false }
        // Each opening starts on a blank line.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPhase('ready')
        setError('')
    }, [open])

    const settle = () => {
        if (progress.current.saved && progress.current.written) setPhase(current => (current === 'signing' ? 'signed' : current))
    }

    const sign = async () => {
        const run = ++attempt.current
        progress.current = { saved: false, written: false }
        setError('')
        setPhase('signing')
        try {
            await onSign()
            if (run !== attempt.current) return
            progress.current.saved = true
            settle()
        } catch (failure) {
            if (run !== attempt.current) return
            setPhase('ready')
            setError(errorText?.(failure) || t('Your signature could not be applied. Please try again.'))
        }
    }

    const finish = () => {
        const signed = phase === 'signed'
        onClose()
        if (signed) onSigned?.()
    }

    // Closing mid-save would leave the person unsure whether it went through.
    const close = () => { if (phase !== 'signing') finish() }

    const signerName = user?.name || user?.displayName || user?.email || ''
    const hasSignature = Boolean(user?.signatureURL)
    const today = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

    const footer = !hasSignature
        ? <Button type="primary" size="large" icon={<EditOutlined />} onClick={() => { onClose(); navigate('/welcome') }}>{t('Set up signature')}</Button>
        : phase === 'signed'
            ? <Button type="primary" size="large" onClick={finish}>{t('Done')}</Button>
            : <Button type="primary" size="large" icon={<EditOutlined />} loading={phase === 'signing'} onClick={() => void sign()}>{phase === 'signing' ? t('Signing...') : signLabel || t('Sign')}</Button>

    return (
        <ResponsiveModal open={open} onClose={close} title={title} footer={footer} width={480} centered className="sign-document-modal">
            {description && <Text type="secondary" className="sign-document-description">{description}</Text>}
            {!hasSignature ? (
                <Alert type="warning" showIcon message={t('Set up your signature first')} description={t('Add your signature on the Welcome page, then come back to sign.')} />
            ) : (
                <>
                    <div className={`sign-document-sheet is-${phase}`}>
                        <div className="sign-document-line">
                            <span className="sign-document-mark" aria-hidden="true">×</span>
                            {phase === 'ready' && <span className="sign-document-placeholder">{t('Sign here')}</span>}
                            <SignatureReplay
                                strokes={user?.signatureStrokes}
                                imageUrl={user?.signatureURL}
                                playing={phase !== 'ready'}
                                alt={t('{name} signature', undefined, { name: signerName })}
                                onComplete={() => { progress.current.written = true; settle() }}
                            />
                        </div>
                        <div className="sign-document-meta">
                            <Text strong>{signerName}</Text>
                            <Text type="secondary">{today}</Text>
                        </div>
                    </div>
                    <div className="sign-document-status" aria-live="polite">
                        {phase === 'signed' && <Text className="sign-document-done"><CheckCircleFilled /> {signedText || t('Signed')}</Text>}
                    </div>
                    {error && <Alert type="error" showIcon message={error} />}
                </>
            )}
        </ResponsiveModal>
    )
}
