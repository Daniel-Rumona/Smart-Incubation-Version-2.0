import { Button, Input } from 'antd'
import { DownOutlined, ExportOutlined, FolderOpenOutlined, FolderOutlined, SearchOutlined, UpOutlined } from '@ant-design/icons'
import { useMemo, useState, type ReactNode } from 'react'
import { useLanguage } from '@/providers/LanguageProvider'
import type { InterventionDocument } from '@/services/interventionDocumentsService'
import '@/styles/incubatee-simple.css'

const LATEST_SHOWN = 6

type Props = {
    /** Newest first. */
    documents: InterventionDocument[]
    iconFor: (row: InterventionDocument) => ReactNode
    dateOf: (value: unknown) => string | null
    /** The seal badge the Full view shows; only shown here under "Show more detail". */
    sealFor: (row: InterventionDocument) => ReactNode
    emptyAction?: ReactNode
}

/**
 * Simple view of the SME's document library. Left: the newest files, each with one Open button. Right: the same
 * files by piece of work; picking one narrows the list to it. "Show more detail" adds search, who made each file,
 * and the seal badge.
 */
export const InterventionDocumentsSimple = ({ documents, iconFor, dateOf, sealFor, emptyAction }: Props) => {
    const { t } = useLanguage()
    const [showMore, setShowMore] = useState(false)
    const [showAll, setShowAll] = useState(false)
    const [work, setWork] = useState<string | null>(null)
    const [search, setSearch] = useState('')

    const works = useMemo(() => {
        const counts = new Map<string, number>()
        documents.forEach((row) => counts.set(row.interventionTitle, (counts.get(row.interventionTitle) || 0) + 1))
        return [...counts.entries()].map(([title, count]) => ({ title, count }))
    }, [documents])

    const needle = showMore ? search.trim().toLowerCase() : ''
    const matching = documents.filter((row) => (!work || row.interventionTitle === work)
        && (!needle || `${row.fileName} ${row.interventionTitle}`.toLowerCase().includes(needle)))
    const shown = showAll || work || needle ? matching : matching.slice(0, LATEST_SHOWN)

    if (!documents.length) {
        return (
            <div className="sme-simple is-tracker">
                <div className="sme-simple-main">
                    <h2 className="sme-simple-greeting">{t('Your documents')}</h2>
                    <section className="sme-simple-next is-done">
                        <FolderOpenOutlined className="sme-simple-empty-icon" aria-hidden="true" />
                        <h3>{t('No documents yet')}</h3>
                        <p>{t("Files from your interventions will appear here as they're produced.")}</p>
                        {emptyAction}
                    </section>
                </div>
            </div>
        )
    }

    return (
        <div className={`sme-simple is-tracker${works.length > 1 ? ' has-side' : ''}`}>
            <div className="sme-simple-main">
                <div className="sme-simple-title-row">
                    <h2 className="sme-simple-greeting">{work || t('Your documents')}</h2>
                    <span>{t('{count} documents', undefined, { count: matching.length })}</span>
                </div>
                <p className="sme-simple-summary">{work ? t('Files from this piece of work, newest first.') : t('Files from your support, newest first.')}</p>

                {showMore && (
                    <Input className="sme-simple-doc-search" prefix={<SearchOutlined />} placeholder={t('Search documents')} value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
                )}

                <ul className="sme-simple-tasks">
                    {shown.map((row) => (
                        <li key={row.id} className="sme-simple-task">
                            <span className="sme-simple-task-icon" aria-hidden="true">{iconFor(row)}</span>
                            <span className="sme-simple-task-text">
                                <span className="sme-simple-doc-name" title={row.fileName}>{row.fileName}</span>
                                <small>{[work ? '' : row.interventionTitle, dateOf(row.createdAt) || t('Recently')].filter(Boolean).join(' · ')}</small>
                                {showMore && <small className="sme-simple-detail-line">{row.agentName || t('Intervention workspace')}</small>}
                            </span>
                            <span className="sme-simple-task-actions">
                                {showMore && sealFor(row)}
                                <Button size="small" icon={<ExportOutlined />} href={row.fileUrl} target="_blank" rel="noreferrer">{t('Open')}</Button>
                            </span>
                        </li>
                    ))}
                </ul>
                {!shown.length && <p className="sme-simple-summary">{t('No documents match your search.')}</p>}

                <div className="sme-simple-footer">
                    {!work && !needle && matching.length > LATEST_SHOWN
                        ? <Button type="link" size="small" onClick={() => setShowAll(!showAll)}>{showAll ? t('Show only the newest') : t('Show all {count}', undefined, { count: matching.length })}</Button>
                        : work ? <Button type="link" size="small" onClick={() => setWork(null)}>{t('Back to all documents')}</Button> : <span />}
                    <button type="button" className="sme-simple-more is-inline" aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>
                        {showMore ? t('Show less') : t('Show more detail')} {showMore ? <UpOutlined /> : <DownOutlined />}
                    </button>
                </div>
            </div>

            {works.length > 1 && (
                <aside className="sme-simple-side" aria-label={t('By piece of work')}>
                    <section className="sme-simple-side-card">
                        <span className="sme-simple-side-label">{t('By piece of work')}</span>
                        <ul className="sme-simple-status">
                            {works.map((entry) => (
                                <li key={entry.title}>
                                    <button type="button" className={`sme-simple-status-row${work === entry.title ? ' is-active' : ''}`} aria-pressed={work === entry.title} onClick={() => setWork(work === entry.title ? null : entry.title)}>
                                        <FolderOutlined aria-hidden="true" />
                                        <span className="sme-simple-row-text">
                                            <span>{entry.title}</span>
                                            <small>{t('{count} documents', undefined, { count: entry.count })}</small>
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                </aside>
            )}
        </div>
    )
}
