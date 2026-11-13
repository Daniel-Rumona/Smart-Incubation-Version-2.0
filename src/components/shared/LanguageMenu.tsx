import type { ReactElement } from 'react'
import { Dropdown } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
import { LANGUAGES, type LanguageCode } from '@/config/languages'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/language-menu.css'

/** How each language names itself, and its name in English when that differs (shown underneath). */
const LANGUAGE_DETAILS: Record<LanguageCode, { code: string; english?: string }> = {
    en: { code: 'EN' },
    zu: { code: 'ZU', english: 'Zulu' },
}

/**
 * The language picker on the public pages (landing, sign-in, welcome). Each option shows its code, its own name and,
 * where it differs, its English name; the current one is tinted and ticked. Wraps whatever trigger button the page uses.
 */
export function LanguageMenu({ children }: { children: ReactElement }) {
    const { t, language, setLanguage } = useLanguage()
    const items = (Object.entries(LANGUAGES) as Array<[LanguageCode, string]>).map(([value, name]) => {
        const details = LANGUAGE_DETAILS[value]
        const selected = value === language
        return {
            key: value,
            label: (
                <span className="language-option" lang={value}>
                    <span className="language-option-code" aria-hidden="true">{details.code}</span>
                    <span className="language-option-names">
                        <strong>{name}</strong>
                        {details.english && <small>{details.english}</small>}
                    </span>
                    <CheckOutlined className="language-option-check" aria-hidden="true" style={{ visibility: selected ? 'visible' : 'hidden' }} />
                </span>
            ),
            onClick: () => setLanguage(value),
        }
    })

    return (
        <Dropdown
            trigger={['click']}
            placement="bottomRight"
            rootClassName="language-menu"
            menu={{ items, selectable: true, selectedKeys: [language], 'aria-label': t('Change language') }}
            popupRender={(menu) => (
                <div className="language-menu-panel">
                    <span className="language-menu-title">{t('Language')}</span>
                    {menu}
                </div>
            )}
        >
            {children}
        </Dropdown>
    )
}

export default LanguageMenu
