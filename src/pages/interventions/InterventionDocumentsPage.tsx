import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { App, Button, Empty, Input, Select, Tag, Tooltip, Typography } from 'antd'
import {
  CloseCircleOutlined,
  ExportOutlined,
  FileDoneOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { FilterBar } from '@/components/shared/FilterBar'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listInterventionDocuments, verifyInterventionDocument, type DocumentVerificationResult, type InterventionDocument } from '@/services/interventionDocumentsService'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/intervention-documents.css'

const dateValue = (value: unknown) => {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate() as Date
  const parsed = new Date(String(value || ''))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const formatDate = (value: unknown, withYear = true) =>
  dateValue(value)?.toLocaleDateString(undefined, withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' }) || null

type FileKind = 'pdf' | 'word' | 'sheet' | 'image' | 'other'

const fileKind = (row: InterventionDocument): FileKind => {
  const type = `${row.contentType || ''} ${row.fileName.split('.').pop() || ''}`.toLowerCase()
  if (type.includes('pdf')) return 'pdf'
  if (/word|docx?\b/.test(type)) return 'word'
  if (/sheet|excel|xlsx?\b|csv/.test(type)) return 'sheet'
  if (/image|png|jpe?g|webp|gif/.test(type)) return 'image'
  return 'other'
}

const FILE_ICONS: Record<FileKind, ReactNode> = {
  pdf: <FilePdfOutlined />,
  word: <FileWordOutlined />,
  sheet: <FileExcelOutlined />,
  image: <FileImageOutlined />,
  other: <FileOutlined />,
}

type DocumentGroup = {
  key: string
  title: string
  documents: InterventionDocument[]
  latest: unknown
}

export default function InterventionDocumentsPage() {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user } = useFullIdentity()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [rows, setRows] = useState<InterventionDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [intervention, setIntervention] = useState('all')
  const [verifyingId, setVerifyingId] = useState('')
  const [verification, setVerification] = useState<Record<string, DocumentVerificationResult>>({})
  const operational = user?.role === 'operations' || user?.role === 'projectadmin'

  useEffect(() => {
    if (!user) return
    // `loading` starts true, so the first load shows the skeleton without setting it here.
    void listInterventionDocuments(user)
      .then(setRows)
      .catch(error => {
        console.error('[INTERVENTION DOCUMENTS] Load failed:', error)
        message.error(t('The intervention document library could not be loaded.'))
      })
      .finally(() => setLoading(false))
  }, [message, user, t])

  const interventionOptions = useMemo(() => [
    { value: 'all', label: t('All interventions') },
    ...Array.from(new Set(rows.map(row => row.interventionTitle))).sort().map(value => ({ value, label: value })),
  ], [rows, t])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter(row => (intervention === 'all' || row.interventionTitle === intervention)
      && (!needle || `${row.fileName} ${row.interventionTitle} ${row.participantName} ${row.programName || ''}`.toLowerCase().includes(needle)))
      .sort((a, b) => (dateValue(b.createdAt)?.getTime() || 0) - (dateValue(a.createdAt)?.getTime() || 0))
  }, [intervention, rows, search])

  // One group per intervention (per SME too, for operations), newest activity first. `filtered` is
  // already newest first, so each group's first document is its latest.
  const groups = useMemo(() => {
    const byKey = new Map<string, DocumentGroup>()
    filtered.forEach(row => {
      const key = `${operational ? row.participantId : ''}:${row.interventionId || row.interventionTitle}`
      const group = byKey.get(key)
      if (group) group.documents.push(row)
      else byKey.set(key, { key, title: operational ? `${row.interventionTitle} · ${row.participantName}` : row.interventionTitle, documents: [row], latest: row.createdAt })
    })
    return [...byKey.values()]
  }, [filtered, operational])

  const verify = async (row: InterventionDocument) => {
    setVerifyingId(row.id)
    try {
      const result = await verifyInterventionDocument(row)
      setVerification(current => ({ ...current, [row.id]: result }))
      if (result.status === 'verified') message.success(result.message)
      else if (result.status === 'altered') message.error(result.message)
      else message.warning(result.message)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('The document could not be verified.'))
    } finally {
      setVerifyingId('')
    }
  }

  const provenanceTag = (row: InterventionDocument) => {
    const result = verification[row.id]
    if (result?.status === 'verified') return <Tag color="green" icon={<SafetyCertificateOutlined />}>{t('Verified')}</Tag>
    if (result?.status === 'altered') return <Tag color="red" icon={<CloseCircleOutlined />}>{t('Invalid')}</Tag>
    // Unsigned files are older ones produced before signing existed. That only matters to the
    // operations team checking files, so SMEs see a badge only on files that are signed.
    if (result?.status === 'unsigned' || !row.signature) return operational ? <Tag>{t('No seal')}</Tag> : null
    // The system seals each file it generates; no person signs these. Only Verify proves the seal is genuine.
    return <Tooltip title={t('Carries the seal the system added when it created this file.')}><Tag color="purple" icon={<SafetyCertificateOutlined />}>{t('Sealed')}</Tag></Tooltip>
  }

  if (!user || (loading && rows.length === 0)) {
    return <PageSkeleton variant="table" label={t('Loading your documents')} />
  }

  const sealedCount = rows.filter(row => row.signature).length

  return <DashboardPage className="intervention-documents-page">
    <section className="documents-summary">
      <DashboardMetricCard icon={<FileDoneOutlined />} label={t('Documents')} value={rows.length} />
      <DashboardMetricCard icon={<FolderOutlined />} label={t('Interventions')} value={new Set(rows.map(row => row.interventionId || row.interventionTitle)).size} />
      {operational
        ? <DashboardMetricCard icon={<TeamOutlined />} label={t('SMEs')} value={new Set(rows.map(row => row.participantId)).size} />
        : <DashboardMetricCard icon={<SafetyCertificateOutlined />} label={t('Sealed')} value={sealedCount} />}
    </section>

    {rows.length > 0 && (
      <FilterBar
        primary={<>
          <Input prefix={<SearchOutlined />} placeholder={operational ? t('Search documents, interventions, SMEs...') : t('Search documents')} value={search} onChange={event => setSearch(event.target.value)} allowClear />
          <Select value={intervention} onChange={setIntervention} options={interventionOptions} popupMatchSelectWidth={false} />
        </>}
      />
    )}

    {rows.length === 0 ? (
      <section className="documents-empty">
        <FolderOpenOutlined className="documents-empty-icon" />
        <Typography.Text strong>{t('No documents yet')}</Typography.Text>
        <Typography.Text type="secondary">{t("Files from your interventions will appear here as they're produced.")}</Typography.Text>
        {pathname.startsWith('/incubatee') && (
          <Button onClick={() => navigate('/incubatee/interventions')}>{t('Go to interventions')}</Button>
        )}
      </section>
    ) : groups.length === 0 ? (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No documents match your search.')} />
    ) : groups.map(group => (
      <section key={group.key} className="documents-group">
        <h3 className="documents-group-head">
          <FolderOutlined aria-hidden="true" />
          <span className="documents-group-title">{group.title}</span>
          <span className="documents-group-meta">
            {t('{count} documents', undefined, { count: group.documents.length })}
            {formatDate(group.latest, false) ? ` · ${t('latest {date}', undefined, { date: formatDate(group.latest, false) || '' })}` : ''}
          </span>
        </h3>
        <ul className="documents-list">
          {group.documents.map(row => {
            const kind = fileKind(row)
            return (
              <li key={row.id} className="documents-row">
                <span className={`documents-row-icon is-${kind}`} aria-hidden="true">{FILE_ICONS[kind]}</span>
                <div className="documents-row-main">
                  <Typography.Text strong className="documents-row-name" title={row.fileName}>{row.fileName}</Typography.Text>
                  <Typography.Text type="secondary" className="documents-row-meta">
                    {[row.agentName || t('Intervention workspace'), formatDate(row.createdAt) || t('Recently')].join(' · ')}
                  </Typography.Text>
                </div>
                <div className="documents-row-actions">
                  {provenanceTag(row)}
                  <Button icon={<ExportOutlined />} href={row.fileUrl} target="_blank" rel="noreferrer">{t('Open')}</Button>
                  {/* Checking a file's signature is a review task for operations; SMEs only see whether it is signed. */}
                  {operational && (
                    <Tooltip title={t('Verify')}>
                      <Button type="text" shape="circle" icon={<SafetyCertificateOutlined />} loading={verifyingId === row.id} onClick={() => void verify(row)} aria-label={t('Verify')} />
                    </Tooltip>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    ))}
  </DashboardPage>
}
