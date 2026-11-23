import { Button, Progress, Tooltip } from 'antd'
import {
    CheckOutlined,
    DownOutlined,
    EditOutlined,
    ExclamationCircleOutlined,
    EyeOutlined,
    FileAddOutlined,
    FileExclamationOutlined,
    FileProtectOutlined,
    SmileOutlined,
    UploadOutlined,
    UpOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useState, type ReactNode } from 'react'
import { useLanguage } from '@/providers/LanguageProvider'
import type { MyComplianceDocument } from '@/services/incubateeComplianceService'
import '@/styles/incubatee-simple.css'

type Props = {
    /** Already sorted by urgency (required, broken documents first). */
    documents: MyComplianceDocument[]
    nextDocument: MyComplianceDocument | null
    onOpen: (document: MyComplianceDocument) => void
}

const formatDate = (value: string | null) => (value ? dayjs(value).format('D MMM YYYY') : '')
const shortDate = (value: string | null) => (value ? dayjs(value).format('D MMM') : '')

/**
 * Simple view of the SME's compliance documents. Left: the document to sort out next and the others that need the
 * SME. Right, beside it on wide screens and below on phones: documents expiring soon, being checked, and in order.
 * Every button opens the page's own upload form, so the rules for files and dates are the same as Full view.
 */
export const IncubateeComplianceSimple = ({ documents, nextDocument, onOpen }: Props) => {
    const { t } = useLanguage()
    const [showMore, setShowMore] = useState(false)
    const [showGood, setShowGood] = useState(false)

    const required = documents.filter((document) => document.required)
    const inOrder = required.filter((document) => document.status === 'valid').length
    const notNext = (document: MyComplianceDocument) => document.key !== nextDocument?.key

    const needsYou = documents.filter((document) => notNext(document) && ['missing', 'queried', 'expired'].includes(document.status))
    const expiring = documents.filter((document) => notNext(document) && document.status === 'valid' && document.expiringSoon)
    const checking = documents.filter((document) => document.status === 'pending')
    const good = documents.filter((document) => notNext(document) && document.status === 'valid' && !document.expiringSoon)
    const hasSide = expiring.length + checking.length + good.length > 0

    // The plain-words reason under the next document's name.
    const reason = (document: MyComplianceDocument) => {
        if (document.status === 'queried') {
            return document.comment
                ? t('Operations asked for changes: "{comment}"', undefined, { comment: document.comment })
                : t('Operations asked for changes. Upload a new version.')
        }
        if (document.status === 'expired') return t('Your last one expired on {date}. Upload a current one.', undefined, { date: formatDate(document.expiryDate) })
        if (document.status === 'missing') return t('Your programme needs this document. Upload it so operations can check it.')
        return t('It expires on {date}. Upload the renewed one before then.', undefined, { date: formatDate(document.expiryDate) })
    }

    // The short line under a document in the lists.
    const summary = (document: MyComplianceDocument) => {
        if (document.status === 'missing') return document.required ? t('Not uploaded yet') : t('Optional · not uploaded yet')
        if (document.status === 'queried') return t('Operations asked for changes')
        if (document.status === 'expired') return t('Expired {date}', undefined, { date: shortDate(document.expiryDate) })
        if (document.status === 'pending') return t('Operations is checking it')
        if (document.expiringSoon) return t('Renew before {date}', undefined, { date: shortDate(document.expiryDate) })
        return ''
    }

    const actionLabel = (document: MyComplianceDocument) => {
        if (document.status === 'missing') return t('Upload')
        if (document.status === 'queried' || document.status === 'expired') return t('Upload new')
        return t('Renew')
    }

    // "Show more detail": the file and its expiry (nothing extra while no file is uploaded; the summary already says so).
    const detail = (document: MyComplianceDocument) => (showMore && document.url
        ? <small className="sme-simple-detail-line">{[
            document.fileName || t('Current file'),
            document.expiryDate ? t('Expires {date}', undefined, { date: formatDate(document.expiryDate) }) : t('No expiry date'),
            document.required ? '' : t('Optional'),
        ].filter(Boolean).join(' · ')}</small>
        : null)

    const fileTools = (document: MyComplianceDocument) => (showMore && document.url
        ? <span className="sme-simple-file-tools">
            <Tooltip title={t('View file')}>
                <Button type="text" size="small" icon={<EyeOutlined />} href={document.url} target="_blank" rel="noopener noreferrer" aria-label={t('View file')} />
            </Tooltip>
            <Tooltip title={t('Edit dates')}>
                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => onOpen(document)} aria-label={t('Edit dates')} />
            </Tooltip>
        </span>
        : null)

    const sideRow = (document: MyComplianceDocument, icon: ReactNode, action?: ReactNode) => (
        <li key={document.key} className="sme-simple-status-agent">
            {icon}
            <span className="sme-simple-row-text">
                <span>{t(document.name)}</span>
                {summary(document) && <small>{summary(document)}</small>}
                {detail(document)}
            </span>
            {fileTools(document)}
            {action}
        </li>
    )

    if (!documents.length) {
        return (
            <div className="sme-simple is-tracker">
                <div className="sme-simple-main">
                    <h2 className="sme-simple-greeting">{t('Your documents')}</h2>
                    <section className="sme-simple-next is-done">
                        <FileProtectOutlined className="sme-simple-empty-icon" aria-hidden="true" />
                        <h3>{t('No documents needed yet')}</h3>
                        <p>{t('When your programme asks for documents, they show here.')}</p>
                    </section>
                </div>
            </div>
        )
    }

    return (
        <div className={`sme-simple is-tracker${hasSide ? ' has-side' : ''}`}>
            <div className="sme-simple-main">
                <div className="sme-simple-title-row">
                    <h2 className="sme-simple-greeting">{t('Your documents')}</h2>
                    {required.length > 0 && <span>{t('{done} of {total} in order', undefined, { done: inOrder, total: required.length })}</span>}
                </div>
                {required.length > 0 && <Progress className="sme-simple-overall" percent={Math.round((inOrder / required.length) * 100)} showInfo={false} size="small" status="normal" strokeColor="var(--ant-color-primary)" />}

                {nextDocument ? (
                    <section className="sme-simple-next" aria-label={t('Do this next')}>
                        <span className="sme-simple-eyebrow">{t('Do this next')}</span>
                        <div className="sme-simple-next-body">
                            <span className="sme-simple-next-icon" aria-hidden="true">
                                {nextDocument.status === 'missing' ? <FileAddOutlined /> : <FileExclamationOutlined />}
                            </span>
                            <div>
                                <h3>{t(nextDocument.name)}</h3>
                                <p>{reason(nextDocument)}</p>
                                {detail(nextDocument)}
                            </div>
                        </div>
                        <Button type="primary" size="large" block icon={<UploadOutlined />} onClick={() => onOpen(nextDocument)}>{actionLabel(nextDocument)}</Button>
                    </section>
                ) : (
                    <section className="sme-simple-next is-done">
                        <SmileOutlined className="sme-simple-done-icon" aria-hidden="true" />
                        <h3>{t('Your documents are in order')}</h3>
                        {checking.length > 0 && <p>{t('Operations is reviewing {count} of your documents.', undefined, { count: checking.length })}</p>}
                    </section>
                )}

                {needsYou.length > 0 && (
                    <section>
                        <div className="sme-simple-list-title">{t('Also needs you')}</div>
                        <ul className="sme-simple-tasks">
                            {needsYou.map((document) => (
                                <li key={document.key} className="sme-simple-task">
                                    {document.status === 'missing'
                                        ? <FileAddOutlined className="sme-simple-task-icon" aria-hidden="true" />
                                        : <ExclamationCircleOutlined className="sme-simple-task-icon" aria-hidden="true" />}
                                    <span className="sme-simple-task-text">
                                        <span>{t(document.name)}</span>
                                        <small>{summary(document)}</small>
                                        {detail(document)}
                                    </span>
                                    <span className="sme-simple-task-actions">
                                        {fileTools(document)}
                                        <Button size="small" icon={<UploadOutlined />} onClick={() => onOpen(document)}>{actionLabel(document)}</Button>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <div className="sme-simple-footer is-end">
                    <button type="button" className="sme-simple-more is-inline" aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>
                        {showMore ? t('Show less') : t('Show more detail')} {showMore ? <UpOutlined /> : <DownOutlined />}
                    </button>
                </div>
            </div>

            {hasSide && (
                <aside className="sme-simple-side" aria-label={t('Your other documents')}>
                    {expiring.length > 0 && (
                        <section className="sme-simple-side-card">
                            <span className="sme-simple-side-label">{t('Expiring soon')}</span>
                            <ul className="sme-simple-status">
                                {expiring.map((document) => sideRow(document, null, <Button size="small" onClick={() => onOpen(document)}>{t('Renew')}</Button>))}
                            </ul>
                        </section>
                    )}

                    {checking.length > 0 && (
                        <section className="sme-simple-side-card">
                            <span className="sme-simple-side-label">{t('Being checked')}</span>
                            <ul className="sme-simple-status">
                                {checking.map((document) => sideRow(document, null))}
                            </ul>
                        </section>
                    )}

                    {good.length > 0 && (
                        <section className="sme-simple-side-card">
                            <div className="sme-simple-side-head">
                                <span className="sme-simple-side-label">{t('All in order')}</span>
                                <Button type="link" size="small" onClick={() => setShowGood(!showGood)} icon={showGood ? <UpOutlined /> : <DownOutlined />} iconPlacement="end">
                                    {showGood ? t('Hide') : t('Show {count}', undefined, { count: good.length })}
                                </Button>
                            </div>
                            {showGood && (
                                <ul className="sme-simple-status">
                                    {good.map((document) => sideRow(document, <CheckOutlined className="sme-simple-done-tick" aria-hidden="true" />))}
                                </ul>
                            )}
                        </section>
                    )}
                </aside>
            )}
        </div>
    )
}
