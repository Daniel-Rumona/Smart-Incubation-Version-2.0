import { useState } from 'react'
import { DownloadOutlined } from '@ant-design/icons'
import MaterialIcon from '@/components/lms/MaterialIcon'
import { formatFileSize } from '@/lib/fileSize'
import type { LessonMaterial } from '@/services/courseTemplatesService'
import { useLanguage } from '@/providers/LanguageProvider'

export type MaterialAction = {
    /** English label; translated when shown. */
    label: string
    /** English instruction sent to the assistant, followed by the material's name. */
    instruction: string
}

type MaterialsPanelProps = {
    materials: LessonMaterial[]
    /** Ids of materials whose text the assistant can read; others can be opened but not asked about. */
    readableIds: Set<string>
    loading?: boolean
    actions: MaterialAction[]
    onAction: (material: LessonMaterial, action: MaterialAction) => void
}

/** The lesson's reading material, shown beside the AI conversation. Tap one to pick what to ask about it. */
export const MaterialsPanel = ({ materials, readableIds, loading, actions, onAction }: MaterialsPanelProps) => {
    const { t } = useLanguage()
    const [openId, setOpenId] = useState<string | null>(materials[0]?.id ?? null)

    return (
        <div className="materials-panel">
            <p className="materials-panel-hint">
                {loading ? t('Loading materials…') : t('Tap a file to summarise it, simplify it or ask for an example.')}
            </p>

            {materials.map((material) => {
                const open = openId === material.id
                const readable = readableIds.has(material.id)

                return (
                    <div key={material.id} className={`materials-panel-item${open ? ' is-open' : ''}`}>
                        <button type="button" className="materials-panel-head" aria-expanded={open} onClick={() => setOpenId(open ? null : material.id)}>
                            <MaterialIcon kind={material.kind} />
                            <span className="materials-panel-name">
                                <strong>{material.name}</strong>
                                <small>{formatFileSize(material.size)}</small>
                            </span>
                        </button>

                        {open && (
                            <div className="materials-panel-actions">
                                {readable ? actions.map((action) => (
                                    <button type="button" key={action.label} onClick={() => onAction(material, action)}>{t(action.label)}</button>
                                )) : (
                                    <small>{loading ? t('Loading materials…') : t('The AI cannot read this file, but you can still open it.')}</small>
                                )}
                                <a href={material.url} target="_blank" rel="noreferrer" className="materials-panel-open"><DownloadOutlined /> {t('Open file')}</a>
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}

export default MaterialsPanel
