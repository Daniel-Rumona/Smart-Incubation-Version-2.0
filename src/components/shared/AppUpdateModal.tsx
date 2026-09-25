import { useEffect, useRef, useState } from 'react'
import { Button, Flex, Modal } from 'antd'
import { useLanguage } from '@/providers/LanguageProvider'

const CHECK_INTERVAL_MS = 5 * 60 * 1000

const fetchIndexHtml = async (): Promise<string | null> => {
    try {
        const response = await fetch(`/index.html?_=${Date.now()}`, { cache: 'no-store' })
        if (!response.ok) return null
        return await response.text()
    } catch {
        return null
    }
}

export const AppUpdateModal = () => {
    const { t } = useLanguage()
    const [open, setOpen] = useState(false)
    const baselineRef = useRef<string | null>(null)
    const dismissedRef = useRef(false)

    useEffect(() => {
        // Vite's dev server transforms index.html on the fly, so it isn't stable
        // across requests. Update checks only make sense against a real deploy.
        if (import.meta.env.DEV) return

        let cancelled = false

        const checkForUpdate = async () => {
            if (!navigator.onLine) return

            const html = await fetchIndexHtml()
            if (cancelled || html === null) return

            if (baselineRef.current === null) {
                baselineRef.current = html
                return
            }

            if (html !== baselineRef.current && !dismissedRef.current) {
                setOpen(true)
            }
        }

        void checkForUpdate()
        const intervalId = window.setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS)

        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') void checkForUpdate()
        }
        document.addEventListener('visibilitychange', onVisibilityChange)

        return () => {
            cancelled = true
            window.clearInterval(intervalId)
            document.removeEventListener('visibilitychange', onVisibilityChange)
        }
    }, [])

    const handleRefresh = () => {
        window.location.reload()
    }

    const handleLater = () => {
        dismissedRef.current = true
        setOpen(false)
    }

    return (
        <Modal
            open={open}
            centered
            closable={false}
            maskClosable={false}
            keyboard={false}
            title={t('New update available')}
            footer={
                <Flex gap={12} style={{ width: '100%' }}>
                    <Button block onClick={handleLater} style={{ flex: '1 1 0' }}>
                        {t('Later')}
                    </Button>
                    <Button block type="primary" onClick={handleRefresh} style={{ flex: '1 1 0' }}>
                        {t('Refresh')}
                    </Button>
                </Flex>
            }
        >
            <p>{t('A new version of this app is available. Refresh now to get the latest updates and improvements.')}</p>
        </Modal>
    )
}
