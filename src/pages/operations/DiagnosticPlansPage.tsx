import { Alert, App, Button, Col, ConfigProvider, Descriptions, Dropdown, Empty, Grid, Input, Row, Segmented, Select, Skeleton, Tag, theme as antdTheme, Tooltip, Typography } from 'antd'
import { ArrowLeftOutlined, CloseOutlined, DownloadOutlined, EditOutlined, FallOutlined, LockOutlined, PlusOutlined, RiseOutlined, SearchOutlined, SortAscendingOutlined, SortDescendingOutlined, UnorderedListOutlined } from '@ant-design/icons'
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore'
import { isDiscontinuedRecord } from '@/services/discontinuedSmes'
import { useEffect, useMemo, useState } from 'react'
import DashboardPage from '@/components/shared/DashboardPage'
import SignDocumentModal from '@/components/shared/SignDocumentModal'
import { getFirebaseDb, isFirebaseConfigured } from '@/config/firebase'
import { hasRolePermission } from '@/config/permissions'
import { lightTheme } from '@/config/theme'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage, tEnglish } from '@/providers/LanguageProvider'
import {
    confirmDiagnosticPlan,
    listDiagnosticInterventionOptions,
    listDiagnosticPlanParticipants,
    saveDiagnosticPlan,
} from '@/services/diagnosticPlansService'
import type { DiagnosticInterventionOption, DiagnosticPlanParticipant } from '@/types/diagnosticPlan'
import { useAssignedInterventions } from '@/contexts/AssignedInterventionsContext'
import { buildLivePlanItems, livePlanProgress, planStatusColor, type LivePlanItem } from '@/utils/liveDiagnosticPlan'
import SwotOutcomeCard from '@/components/interventions/SwotOutcomeCard'
import PlanOutcomeChips from '@/components/interventions/PlanOutcomeChips'
import '@/styles/operations-diagnostics.css'

type StatusFilter = 'Draft' | 'Confirmed' | 'All'
type PanelTab = 'build' | 'document'
type QueueSort = 'name' | 'name-desc' | 'progress-asc' | 'progress-desc' | 'interventions' | 'signature'

type AiSuggestedIntervention = {
    area: string
    title: string
    matchedOption?: DiagnosticInterventionOption
}

const statusColor = (status: DiagnosticPlanParticipant['plan']['status']) => status === 'Confirmed' ? 'green' : 'orange'
const emptyValue = 'N/A'
const keyOf = (participant: DiagnosticPlanParticipant) => `${participant.applicationId}-${participant.id}`

const cleanFileName = (value: string) =>
    value.replace(/[^\w.-]+/g, '-').replace(/(^-|-$)/g, '').toLowerCase() || 'diagnostic-plan'

const escapeHtml = (value: unknown) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[char] || char)

const normalizeText = (value: unknown) =>
    String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

const displayValue = (value: unknown) =>
    String(value ?? '').trim() || emptyValue

const displayScore = (value: unknown) => {
    if (value === undefined || value === null || value === '') return emptyValue
    const text = String(value)
    return text.endsWith('%') ? text : `${text}%`
}

const formatDate = (value: unknown) => {
    if (!value) return emptyValue

    const candidate = typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function'
        ? value.toDate()
        : typeof value === 'object' && value && 'seconds' in value && typeof value.seconds === 'number'
            ? new Date(value.seconds * 1000)
            : new Date(value as string | number | Date)

    return Number.isNaN(candidate.getTime()) ? emptyValue : candidate.toLocaleDateString()
}

const getRecordValue = (record: Record<string, unknown> | undefined, aliases: string[]) => {
    if (!record) return undefined

    for (const key of aliases) {
        if (record[key] !== undefined && record[key] !== null && record[key] !== '') return record[key]
    }

    const normalizedLookup = new Map(
        Object.entries(record).map(([key, value]) => [normalizeText(key), value]),
    )

    for (const key of aliases) {
        const value = normalizedLookup.get(normalizeText(key))
        if (value !== undefined && value !== null && value !== '') return value
    }

    return undefined
}

const getAiRecommendation = (participant: DiagnosticPlanParticipant): Record<string, unknown> => {
    const raw = participant as unknown as Record<string, unknown>
    return (raw.aiRecommendation as Record<string, unknown> | undefined) || {}
}

const getAiField = (participant: DiagnosticPlanParticipant, aliases: string[]) =>
    getRecordValue(getAiRecommendation(participant), aliases)

const getAiRecommendedInterventions = (
    participant: DiagnosticPlanParticipant,
    catalogue: DiagnosticInterventionOption[],
): AiSuggestedIntervention[] => {
    const recommended = getRecordValue(getAiRecommendation(participant), [
        'Recommended Interventions',
        'RecommendedInterventions',
        'recommendedInterventions',
    ])

    if (!recommended || typeof recommended !== 'object' || Array.isArray(recommended)) return []

    const catalogueByTitle = new Map(catalogue.map((item) => [normalizeText(item.title), item]))

    return Object.entries(recommended as Record<string, unknown>).flatMap(([area, value]) => {
        if (normalizeText(area) === 'error') return []
        if (!Array.isArray(value)) return []

        return value.flatMap((titleValue) => {
            const title = String(titleValue ?? '').trim()
            if (!title || normalizeText(title) === 'error') return []
            return [{ area, title, matchedOption: catalogueByTitle.get(normalizeText(title)) }]
        })
    })
}

const sameInterventions = (left: DiagnosticInterventionOption[], right: DiagnosticInterventionOption[]) =>
    left.length === right.length && left.every((item, index) => item.interventionId === right[index]?.interventionId)

const DividerTitle = ({ children }: { children: string }) => (
    <div className="diagnostic-document-divider">
        <span>{children}</span>
    </div>
)

/**
 * Growth plans, reviewed one SME after another: the queue on the left, the selected plan on the right. A draft is
 * worked on in Build (the SWOT, the plan's interventions and the AI suggestions, in ordinary app UI); Document is
 * the read-only paper exactly as it is signed and downloaded. Signing always happens on the Document, so what is
 * signed is what was just seen, and confirming moves on to the next draft. A confirmed plan opens on its Document.
 */
export const DiagnosticPlansPage = () => {
    const { message, modal } = App.useApp()
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const { assignments: loadedAssignments } = useAssignedInterventions()
    const screens = Grid.useBreakpoint()
    const stacked = !screens.lg

    const [participants, setParticipants] = useState<DiagnosticPlanParticipant[]>([])
    const [catalogue, setCatalogue] = useState<DiagnosticInterventionOption[]>([])
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [signing, setSigning] = useState(false)
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState<StatusFilter>('Draft')
    const [sort, setSort] = useState<QueueSort>('name')
    const [selectedKey, setSelectedKey] = useState<string>()
    const [selectedInterventions, setSelectedInterventions] = useState<DiagnosticInterventionOption[]>([])
    const [tab, setTab] = useState<PanelTab>('build')
    // Phones and small tablets show one panel at a time: the queue, or the plan with a way back.
    const [planOpen, setPlanOpen] = useState(false)
    // Changing a confirmed plan: Build opens on its interventions, and the change is signed again by both sides.
    const [changing, setChanging] = useState(false)
    const [companyLogoUrl, setCompanyLogoUrl] = useState('')
    // The company's assignments as they change (a step confirmed, a session delivered), so progress is live.
    const [liveAssignments, setLiveAssignments] = useState<Array<Record<string, unknown>> | null>(null)

    const companyCode = String(user?.companyCode || '').trim()
    const canManage = !!user && hasRolePermission(user.role, 'manage_diagnostic_plans', user.permissions)
    const selected = participants.find((participant) => keyOf(participant) === selectedKey)
    const isDraft = selected?.plan.status === 'Draft'
    const editable = canManage && (isDraft || changing)
    const panel: PanelTab = editable ? tab : 'document'
    const assignments = liveAssignments ?? (loadedAssignments as unknown as Array<Record<string, unknown>>)

    useEffect(() => {
        if (!companyCode) return
        return onSnapshot(
            query(collection(getFirebaseDb(), 'assignedInterventions'), where('companyCode', '==', companyCode)),
            (snapshot) => setLiveAssignments(snapshot.docs
                .map((record) => ({ ...record.data(), id: record.id }) as Record<string, unknown>)
                .filter((row) => !isDiscontinuedRecord(row as { participantDiscontinuedAt?: unknown }))),
            (error) => console.error('[DIAGNOSTIC PLANS] Live assignments failed:', error),
        )
    }, [companyCode])

    const load = async () => {
        if (!user) return []
        try {
            setLoading(true)
            const [participantRows, interventionRows] = await Promise.all([
                listDiagnosticPlanParticipants(user, activeProgramId),
                listDiagnosticInterventionOptions(companyCode),
            ])
            setParticipants(participantRows)
            setCatalogue(interventionRows)
            return participantRows
        } catch {
            message.error(t('operations.diagnostics.loadError'))
            return []
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        // Drafts are the work, so the queue opens on them; with none waiting it opens on every plan instead of an empty list.
        const timeout = window.setTimeout(() => void load().then((rows) => {
            if (rows.length && !rows.some((row) => row.plan.status === 'Draft')) setStatus('All')
        }), 0)
        return () => window.clearTimeout(timeout)
    }, [activeProgramId, user?.uid, companyCode]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        let cancelled = false
        const loadCompanyLogo = async () => {
            if (!isFirebaseConfigured || !companyCode) {
                setCompanyLogoUrl('')
                return
            }
            try {
                const snapshot = await getDoc(doc(getFirebaseDb(), 'companies', companyCode))
                if (!cancelled) setCompanyLogoUrl(String(snapshot.exists() ? snapshot.data()?.logoUrl || '' : '').trim())
            } catch {
                if (!cancelled) setCompanyLogoUrl('')
            }
        }
        void loadCompanyLogo()
        return () => { cancelled = true }
    }, [companyCode])

    const filteredRows = useMemo(() => participants.filter((participant) => {
        const needle = search.trim().toLowerCase()
        return (
            (!needle || `${participant.businessName} ${participant.participantName || ''} ${participant.email || ''}`.toLowerCase().includes(needle))
            && (status === 'All' || participant.plan.status === status)
        )
    }), [participants, search, status])

    // The programme only tells rows apart under All programmes, and only when the plans span more than one.
    const showProgramme = isAllPrograms && new Set(participants.map((participant) => participant.programId || '')).size > 1

    const counts = useMemo(() => ({
        draft: participants.filter((item) => item.plan.status === 'Draft').length,
        confirmed: participants.filter((item) => item.plan.status === 'Confirmed').length,
    }), [participants])

    const select = (participant: DiagnosticPlanParticipant | undefined, catalogueRows = catalogue) => {
        const known = new Map(catalogueRows.map((item) => [item.interventionId, item]))
        setSelectedKey(participant ? keyOf(participant) : undefined)
        setSelectedInterventions(participant ? participant.plan.interventions.map((item) => known.get(item.interventionId) || item) : [])
        setTab('build')
        setChanging(false)
    }

    const dirty = !!selected && !sameInterventions(selectedInterventions, selected.plan.interventions)

    const startChange = () => {
        if (!selected) return
        select(selected)
        setChanging(true)
    }

    const cancelChange = () => {
        if (selected) select(selected)
    }

    // Signing happens on the Document, so what is signed is what was seen. From Build, the bar's button switches to the
    // Document and brings its signing banner into view; on the Document already, it opens the signature step straight away.
    const startSigning = () => {
        if (panel === 'document') {
            setSigning(true)
            return
        }
        setTab('document')
        window.setTimeout(() => document.querySelector('.diagnostic-plan')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
    }

    // Switching SME with unsaved changes asks first, so a half-built plan isn't lost by a stray click.
    const open = (participant: DiagnosticPlanParticipant) => {
        const go = () => { select(participant); setPlanOpen(true) }
        if (!dirty || keyOf(participant) === selectedKey) return go()
        modal.confirm({
            title: t('Leave without saving?'),
            content: t('Your changes to {name} are not saved.', undefined, { name: selected?.businessName || '' }),
            okText: t('Leave'),
            cancelText: t('Stay'),
            onOk: go,
        })
    }


    const saveErrorText = (error: unknown) => {
        const detail = error instanceof Error ? error.message : ''
        return detail && detail !== 'forbidden'
            ? `${t('operations.diagnostics.saveError')} (${detail})`
            : t('operations.diagnostics.saveError')
    }

    const persist = async () => {
        if (!user || !selected) return
        try {
            setSaving(true)
            await saveDiagnosticPlan(user, selected, selectedInterventions)
            message.success(t('operations.diagnostics.saved'))
            const fresh = await load()
            const again = fresh.find((row) => keyOf(row) === selectedKey)
            if (again) setSelectedInterventions(again.plan.interventions.map((item) => catalogue.find((option) => option.interventionId === item.interventionId) || item))
        } catch (error) {
            console.error('[DIAGNOSTIC PLANS] Save failed:', error)
            message.error(saveErrorText(error))
        } finally {
            setSaving(false)
        }
    }

    // Confirming signs the plan in SignDocumentModal, which writes the signature out while this saves.
    const signAndConfirm = async () => {
        if (!user || !selected) throw new Error('not-ready')
        try {
            await saveDiagnosticPlan(user, selected, selectedInterventions)
            await confirmDiagnosticPlan(user, selected, user.signatureURL)
        } catch (error) {
            console.error('[DIAGNOSTIC PLANS] Confirmation failed:', error)
            throw error
        }
    }

    // After signing, the next draft in the queue opens, so a reviewer can work straight through. A signed change
    // stays on its plan: the SME now has to sign it too.
    const afterSigned = async () => {
        const done = selectedKey
        if (changing) {
            const fresh = await load()
            const again = fresh.find((row) => keyOf(row) === done)
            select(again)
            message.success(t('Change signed. {name} is asked to sign the changed plan.', undefined, { name: again?.businessName || '' }))
            return
        }
        const fresh = await load()
        const next = fresh.find((row) => row.plan.status === 'Draft' && keyOf(row) !== done
            && (!search.trim() || `${row.businessName} ${row.participantName || ''} ${row.email || ''}`.toLowerCase().includes(search.trim().toLowerCase())))
        select(next)
        if (!next) setPlanOpen(false)
        message.success(next ? t('Plan confirmed. Next: {name}', undefined, { name: next.businessName }) : t('Plan confirmed. No drafts left.'))
    }

    // Progress follows each intervention's current definition in the catalogue (its steps and their weights), even
    // when the definition changed after the plan was signed.
    const definitions = useMemo(() => new Map(catalogue.map((item) => [item.interventionId, item])), [catalogue])
    const withDefinitions = (items: DiagnosticInterventionOption[]) => items.map((item) => {
        const definition = definitions.get(item.interventionId)
        return definition ? { ...item, executionMode: definition.executionMode, steps: definition.steps } : item
    })
    const liveForParticipant = (participant: DiagnosticPlanParticipant, interventions = participant.plan.interventions) =>
        buildLivePlanItems(withDefinitions(interventions), assignments.filter((assignment) => String(assignment.participantId || '') === participant.id))
    const selectedLiveInterventions = useMemo(() => selected ? liveForParticipant(selected, selectedInterventions) : [], [assignments, definitions, selected, selectedInterventions]) // eslint-disable-line react-hooks/exhaustive-deps

    // Once work on an intervention has started (assigned, in progress or done), it can't be taken out of a signed plan:
    // its assignments and progress would be left pointing at nothing.
    const lockedIds = useMemo(() => {
        if (!changing || !selected) return new Set<string>()
        return new Set(liveForParticipant(selected)
            .filter((item) => item.status !== 'Not assigned' && item.status !== 'Declined')
            .map((item) => String(item.interventionId || '')))
    }, [assignments, changing, definitions, selected]) // eslint-disable-line react-hooks/exhaustive-deps

    const progressOf = (participant: DiagnosticPlanParticipant) => livePlanProgress(liveForParticipant(participant))
    const smeHasSigned = (participant: DiagnosticPlanParticipant) => {
        const meta = participant.plan.confirmedMeta
        return [meta?.participant, meta?.incubatee, meta?.sme].some((entry) => !!entry?.signatureURL || !!entry?.automatic || !!entry?.confirmedAt)
    }

    // The queue in the chosen order; ties fall back to the name so the order is stable. Drafts have no progress yet,
    // so progress sorts put them after confirmed plans.
    const progressKey = (participant: DiagnosticPlanParticipant) => (participant.plan.status === 'Confirmed' ? progressOf(participant) : null)
    const byName = (left: DiagnosticPlanParticipant, right: DiagnosticPlanParticipant) => left.businessName.localeCompare(right.businessName)
    const compare = (left: DiagnosticPlanParticipant, right: DiagnosticPlanParticipant) => {
        if (sort === 'name-desc') return byName(right, left)
        if (sort === 'progress-asc' || sort === 'progress-desc') {
            const a = progressKey(left)
            const b = progressKey(right)
            if (a === null || b === null) return a === b ? byName(left, right) : a === null ? 1 : -1
            return (sort === 'progress-asc' ? a - b : b - a) || byName(left, right)
        }
        if (sort === 'interventions') return right.plan.interventions.length - left.plan.interventions.length || byName(left, right)
        if (sort === 'signature') {
            const waiting = (participant: DiagnosticPlanParticipant) => (participant.plan.status === 'Confirmed' && !smeHasSigned(participant) ? 0 : 1)
            return waiting(left) - waiting(right) || byName(left, right)
        }
        return byName(left, right)
    }
    const rows = [...filteredRows].sort(compare)
    const rowKeys = rows.map(keyOf).join('|')

    // Keep a plan on screen on wide screens: the first in the queue when nothing (or something filtered out) is chosen.
    useEffect(() => {
        if (stacked || loading) return
        if (selected && rows.some((row) => keyOf(row) === selectedKey)) return
        const timeout = window.setTimeout(() => select(rows[0]), 0)
        return () => window.clearTimeout(timeout)
    }, [rowKeys, stacked, loading]) // eslint-disable-line react-hooks/exhaustive-deps

    const SORTS: Array<{ key: QueueSort, label: string, icon: React.ReactNode }> = [
        { key: 'name', label: t('Name, A to Z'), icon: <SortAscendingOutlined /> },
        { key: 'name-desc', label: t('Name, Z to A'), icon: <SortDescendingOutlined /> },
        { key: 'progress-asc', label: t('Progress, lowest first'), icon: <RiseOutlined /> },
        { key: 'progress-desc', label: t('Progress, highest first'), icon: <FallOutlined /> },
        { key: 'interventions', label: t('Most interventions'), icon: <UnorderedListOutlined /> },
        { key: 'signature', label: t('SME to sign first'), icon: <EditOutlined /> },
    ]
    const currentSort = SORTS.find((item) => item.key === sort) || SORTS[0]

    const aiSuggestions = selected ? getAiRecommendedInterventions(selected, catalogue) : []
    const inPlan = useMemo(() => new Set(selectedInterventions.map((item) => item.interventionId)), [selectedInterventions])
    const addable = useMemo(() => {
        const byArea = new Map<string, DiagnosticInterventionOption[]>()
        catalogue.filter((item) => !inPlan.has(item.interventionId)).forEach((item) => {
            const area = item.areaOfSupport || t('Other')
            byArea.set(area, [...(byArea.get(area) || []), item])
        })
        return Array.from(byArea.entries()).sort(([left], [right]) => left.localeCompare(right))
            .map(([area, items]) => ({ label: area, title: area, options: items.map((item) => ({ value: item.interventionId, label: item.title })) }))
    }, [catalogue, inPlan, t])

    const add = (option?: DiagnosticInterventionOption) => {
        if (!option || inPlan.has(option.interventionId)) return
        setSelectedInterventions((current) => [...current, option])
    }
    const remove = (interventionId: string) => {
        if (lockedIds.has(interventionId)) return
        setSelectedInterventions((current) => current.filter((item) => item.interventionId !== interventionId))
    }

    useRegisterAgentPageContext({
        pageKey: 'operations-diagnostic-plans',
        pageName: tEnglish('nav.diagnosticPlans'),
        purpose: tEnglish('operations.diagnostics.subtitle'),
        filters: { search, status, activeProgramId, companyCode },
        metrics: { participants: participants.length, confirmed: counts.confirmed, draft: counts.draft },
        tables: { visiblePlans: rows.length },
        selectedRecord: selected?.businessName,
    })

    const operationsSignature = (participant: DiagnosticPlanParticipant) => participant.plan.confirmedMeta?.operations
    const smeSignature = (participant: DiagnosticPlanParticipant) =>
        participant.plan.confirmedMeta?.participant
        || participant.plan.confirmedMeta?.incubatee
        || participant.plan.confirmedMeta?.sme

    const signatureHtml = (title: string, meta?: { name?: string, email?: string, signatureURL?: string, confirmedAt?: string, automatic?: boolean }) => `
        <td>
            <strong>${escapeHtml(title)}</strong><br />
            ${meta?.signatureURL ? `<img class="signature-img" src="${escapeHtml(meta.signatureURL)}" alt="${escapeHtml(title)} signature" />` : `<div class="signature-missing">${meta?.automatic ? 'Confirmed automatically (programme set list)' : 'Pending signature'}</div>`}
            <div>${escapeHtml(displayValue(meta?.name || meta?.email))}</div>
            <div>${escapeHtml(meta?.confirmedAt ? new Date(meta.confirmedAt).toLocaleString() : emptyValue)}</div>
        </td>
    `

    const buildDocumentHtml = (participant: DiagnosticPlanParticipant) => {
        const interventions = keyOf(participant) === selectedKey ? selectedInterventions : participant.plan.interventions
        const opsMeta = operationsSignature(participant)
        const smeMeta = smeSignature(participant)
        const participantAiSuggestions = getAiRecommendedInterventions(participant, catalogue)
        const participantAiScore = getAiField(participant, ['AI Score', 'aiScore'])
        const participantAiRecommendation = getAiField(participant, ['AI Recommendation', 'aiRecommendation'])
        const participantAiJustification = getAiField(participant, ['Justification', 'justification'])

        const swotRows = Array.from({
            length: Math.max(participant.swot.strengths.length, participant.swot.weaknesses.length, participant.swot.opportunities.length, participant.swot.threats.length, 1),
        }).map((_, index) => `
            <tr>
                <td>${escapeHtml(participant.swot.strengths[index] || emptyValue)}</td>
                <td>${escapeHtml(participant.swot.weaknesses[index] || emptyValue)}</td>
                <td>${escapeHtml(participant.swot.opportunities[index] || emptyValue)}</td>
                <td>${escapeHtml(participant.swot.threats[index] || emptyValue)}</td>
            </tr>
        `).join('')

        const liveInterventions = liveForParticipant(participant, interventions)
        const interventionRows = liveInterventions.length
            ? liveInterventions.map((item, index) => `
                <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(item.title)}</td>
                    <td>${escapeHtml(item.areaOfSupport || emptyValue)}</td>
                    <td>${escapeHtml(item.status)}</td>
                    <td>${item.progress}%</td>
                </tr>
            `).join('')
            : `<tr><td colspan="5">${escapeHtml(t('operations.diagnostics.noSelectedInterventions'))}</td></tr>`

        const aiRows = participantAiSuggestions.length
            ? participantAiSuggestions.map((item, index) => `
                <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(item.title)}</td>
                    <td>${escapeHtml(item.area)}</td>
                </tr>
            `).join('')
            : `<tr><td colspan="3">${escapeHtml(emptyValue)}</td></tr>`

        return `<!doctype html>
            <html>
            <head>
                <meta charset="utf-8" />
                <title>${escapeHtml(participant.businessName)} Diagnostic Growth Plan</title>
                <style>
                    body { font-family: Arial, sans-serif; color: #1f2937; margin: 28px; }
                    .header { border: 1px solid #d9d9d9; padding: 28px; display: table; width: 100%; box-sizing: border-box; }
                    .logo, .title { display: table-cell; vertical-align: middle; }
                    .logo { width: 230px; text-align: center; }
                    .logo img { max-width: 190px; max-height: 82px; object-fit: contain; }
                    .logo-fallback { border: 1px solid #d9d9d9; padding: 18px; font-weight: 700; color: #334155; }
                    .enterprise { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
                    h1 { font-size: 34px; margin: 0; color: #111827; }
                    h2 { border-bottom: 1px solid #d9d9d9; color: #111827; font-size: 18px; margin-top: 28px; padding-bottom: 8px; text-align: center; }
                    table { border-collapse: collapse; width: 100%; margin-top: 12px; table-layout: fixed; }
                    th, td { border: 1px solid #d9d9d9; padding: 9px 10px; vertical-align: top; word-break: normal; overflow-wrap: anywhere; }
                    th { background: #f8fafc; text-align: left; }
                    .label { background: #f8fafc; font-weight: 700; width: 22%; }
                    .signature-img { display: block; height: 70px; margin: 12px 0; max-width: 190px; object-fit: contain; }
                    .signature-missing { border: 1px dashed #cbd5e1; color: #64748b; margin: 12px 0; padding: 22px; text-align: center; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="logo">${companyLogoUrl ? `<img src="${escapeHtml(companyLogoUrl)}" alt="Company logo" />` : '<div class="logo-fallback">Company Logo</div>'}</div>
                    <div class="title">
                        <div class="enterprise">${escapeHtml(participant.businessName || 'SME')}</div>
                        <h1>Diagnostic Growth Plan</h1>
                    </div>
                </div>

                <h2>Business Overview</h2>
                <table>
                    <tr><td class="label">Business Owner</td><td>${escapeHtml(displayValue(participant.participantName))}</td><td class="label">SME Name</td><td>${escapeHtml(displayValue(participant.businessName))}</td></tr>
                    <tr><td class="label">Program</td><td>${escapeHtml(displayValue(participant.programName))}</td><td class="label">Email</td><td>${escapeHtml(displayValue(participant.email))}</td></tr>
                    <tr><td class="label">Sector</td><td>${escapeHtml(displayValue(participant.sector))}</td><td class="label">Stage</td><td>${escapeHtml(displayValue(participant.stage))}</td></tr>
                    <tr><td class="label">Province</td><td>${escapeHtml(displayValue(participant.province))}</td><td class="label">Plan Status</td><td>${escapeHtml(participant.plan.status)}</td></tr>
                </table>

                <h2>Application Summary</h2>
                <table>
                    <tr><td class="label">Applied</td><td>${escapeHtml(formatDate(participant.applicationSummary.submittedAt))}</td><td class="label">Compliance Score</td><td>${escapeHtml(displayScore(participant.applicationSummary.complianceScore))}</td></tr>
                    <tr><td class="label">AI Score</td><td>${escapeHtml(displayValue(participantAiScore ?? participant.applicationSummary.aiScore))}</td><td class="label">AI Recommendation</td><td>${escapeHtml(displayValue(participantAiRecommendation ?? participant.applicationSummary.aiRecommendation))}</td></tr>
                    <tr><td class="label">AI Justification</td><td colspan="3">${escapeHtml(displayValue(participantAiJustification))}</td></tr>
                    <tr><td class="label">Motivation</td><td colspan="3">${escapeHtml(displayValue(participant.applicationSummary.motivation))}</td></tr>
                    <tr><td class="label">Challenges</td><td colspan="3">${escapeHtml(displayValue(participant.applicationSummary.challenges))}</td></tr>
                </table>

                <h2>AI Suggested Interventions</h2>
                <table>
                    <tr><th>#</th><th>Intervention</th><th>Area of Support</th></tr>
                    ${aiRows}
                </table>

                <h2>SWOT Analysis</h2>
                <table>
                    <tr><th>Strengths</th><th>Weaknesses</th><th>Opportunities</th><th>Threats</th></tr>
                    ${swotRows}
                </table>

                <h2>Required Interventions</h2>
                <p><strong>Live overall progress:</strong> ${livePlanProgress(liveInterventions)}%</p>
                <table>
                    <tr><th>#</th><th>Title</th><th>Area of Support</th><th>Live Status</th><th>Progress</th></tr>
                    ${interventionRows}
                </table>

                <h2>Signatures</h2>
                <table><tr>${signatureHtml('Operations Signature', opsMeta)}${signatureHtml('SME Signature', smeMeta)}</tr></table>
            </body>
            </html>`
    }

    const downloadDocument = (participant: DiagnosticPlanParticipant) => {
        const blob = new Blob([buildDocumentHtml(participant)], { type: 'application/msword;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${cleanFileName(participant.businessName)}-diagnostic-growth-plan.doc`
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
    }

    const statusLabel = (value: DiagnosticPlanParticipant['plan']['status']) => t(`operations.diagnostics.${value.toLowerCase()}`)

    const signatureBox = (title: string, meta?: { name?: string, email?: string, signatureURL?: string, confirmedAt?: string, automatic?: boolean }) => (
        <div className="diagnostic-signature-box">
            <Typography.Text strong>{title}</Typography.Text>
            {meta?.signatureURL
                ? <img src={meta.signatureURL} alt={title} />
                : <div className="diagnostic-signature-empty">{t(meta?.automatic ? 'Confirmed automatically' : 'To be signed')}</div>}
            <Typography.Text>{displayValue(meta?.name || meta?.email)}</Typography.Text>
            <Typography.Text type="secondary">{meta?.confirmedAt ? new Date(meta.confirmedAt).toLocaleString() : emptyValue}</Typography.Text>
        </div>
    )

    const queue = (
        <aside className="diagnostic-queue">
            <Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('operations.diagnostics.search')} allowClear />
            <div className="diagnostic-queue-tools">
                <Dropdown
                    trigger={['click']}
                    menu={{
                        selectable: true,
                        selectedKeys: [sort],
                        items: SORTS.map((item) => ({ key: item.key, label: item.label, icon: item.icon })),
                        onClick: ({ key }) => setSort(key as QueueSort),
                    }}
                >
                    <Tooltip title={t('Sort: {order}', undefined, { order: currentSort.label })}>
                        <Button icon={currentSort.icon} aria-label={t('Sort: {order}', undefined, { order: currentSort.label })} />
                    </Tooltip>
                </Dropdown>
                <Segmented<StatusFilter>
                    className="diagnostic-queue-filter"
                    value={status}
                    onChange={setStatus}
                    options={[
                        { value: 'Draft', label: `${t('operations.diagnostics.draft')} ${counts.draft}` },
                        { value: 'Confirmed', label: `${t('operations.diagnostics.confirmed')} ${counts.confirmed}` },
                        { value: 'All', label: t('All') },
                    ]}
                />
            </div>
            <div className="diagnostic-queue-head">
                <span>{t('{count} SMEs', undefined, { count: rows.length })}</span>
                <span>{status === 'Draft' ? t('operations.diagnostics.interventions') : t('Progress')}</span>
            </div>
            <div className="diagnostic-queue-rows">
                {loading && !participants.length ? <Skeleton active paragraph={{ rows: 4 }} /> : rows.length ? rows.map((row) => {
                    const confirmed = row.plan.status === 'Confirmed'
                    // A confirmed plan shows its live progress; a draft, how many interventions it holds so far.
                    const figure = confirmed ? `${progressOf(row)}%` : String(row.plan.interventions.length)
                    const awaitingSme = confirmed && !smeHasSigned(row)
                    return (
                        <button key={keyOf(row)} type="button" className={`diagnostic-queue-row${keyOf(row) === selectedKey && !stacked ? ' is-current' : ''}${showProgramme ? '' : ' is-compact'}`} onClick={() => open(row)}>
                            <strong>{row.businessName}</strong>
                            <strong className="diagnostic-queue-count" title={confirmed ? t('Plan progress') : t('Interventions')}>{figure}</strong>
                            {/* With one programme chosen every row would repeat it, so it only shows under All programmes. */}
                            {showProgramme && <span>{row.programName || t('common.unassigned')}</span>}
                            {awaitingSme
                                ? <Tag color="gold">{row.plan.amended ? t('Changed · SME to sign') : t('SME to sign')}</Tag>
                                : <Tag color={statusColor(row.plan.status)}>{statusLabel(row.plan.status)}</Tag>}
                        </button>
                    )
                }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={status === 'Draft' && !search ? t('No drafts waiting.') : t('operations.diagnostics.empty')} />}
            </div>
        </aside>
    )

    const buildView = selected && (
        <div className="diagnostic-build">
            <section className="diagnostic-build-card">
                <h3>{t('SWOT')}</h3>
                <div className="diagnostic-swot">
                    {([
                        ['strengths', 'is-good'],
                        ['weaknesses', 'is-bad'],
                        ['opportunities', 'is-info'],
                        ['threats', 'is-warn'],
                    ] as const).map(([key, tone]) => (
                        <div key={key} className={`diagnostic-swot-quad ${tone}`}>
                            <strong>{t(`operations.diagnostics.${key}`)}</strong>
                            {selected.swot[key].length
                                ? <ul>{selected.swot[key].map((item) => <li key={item}>{item}</li>)}</ul>
                                : <span className="diagnostic-muted">{t('None captured')}</span>}
                        </div>
                    ))}
                </div>
            </section>

            <div className="diagnostic-build-columns">
                <section className="diagnostic-build-card">
                    <h3>{t('Interventions in this plan')} <span className="diagnostic-muted">{selectedInterventions.length}</span></h3>
                    <div className="diagnostic-picks">
                        {selectedInterventions.length ? selectedInterventions.map((item) => {
                            const locked = lockedIds.has(item.interventionId)
                            return (
                                <div key={item.interventionId} className={`diagnostic-pick${locked ? ' is-locked' : ''}`}>
                                    <span>
                                        {item.title}
                                        {locked && <small>{t('Work has started, so it stays in the plan')}</small>}
                                    </span>
                                    {item.areaOfSupport && <Tag bordered={false}>{item.areaOfSupport}</Tag>}
                                    {locked
                                        ? <Tooltip title={t('Work has started, so it stays in the plan')}><LockOutlined className="diagnostic-lock" aria-label={t('Locked')} /></Tooltip>
                                        : <Button type="text" size="small" icon={<CloseOutlined />} aria-label={t('Remove {title}', undefined, { title: item.title })} onClick={() => remove(item.interventionId)} />}
                                </div>
                            )
                        }) : <span className="diagnostic-muted">{t('Nothing in the plan yet. Add from the suggestions or the catalogue.')}</span>}
                    </div>
                    <Select
                        className="diagnostic-adder"
                        showSearch
                        value={null}
                        placeholder={<><PlusOutlined /> {t('Add from catalogue')}</>}
                        options={addable}
                        optionFilterProp="label"
                        onChange={(value: string | null) => add(catalogue.find((item) => item.interventionId === value))}
                        notFoundContent={t('Everything in the catalogue is already in the plan.')}
                    />
                </section>

                <section className="diagnostic-build-card">
                    <h3>{t('AI suggestions')}</h3>
                    {aiSuggestions.length ? (
                        <div className="diagnostic-suggestions">
                            {aiSuggestions.map((item) => {
                                const added = !!item.matchedOption && inPlan.has(item.matchedOption.interventionId)
                                return (
                                    <div key={`${item.area}-${item.title}`} className="diagnostic-suggestion">
                                        <span>
                                            {item.title}
                                            <small className={item.matchedOption ? '' : 'is-missing'}>{item.matchedOption ? item.area : t('Not in the catalogue')}</small>
                                        </span>
                                        <Button size="small" disabled={!item.matchedOption || added} onClick={() => add(item.matchedOption)}>
                                            {added ? t('Added') : t('Add')}
                                        </Button>
                                    </div>
                                )
                            })}
                        </div>
                    ) : <span className="diagnostic-muted">{t('No suggestions for this SME.')}</span>}
                </section>
            </div>
        </div>
    )

    const documentView = selected && (
        // The paper is always a light page, so the antd components inside it need light-theme tokens even in dark
        // mode, or their text renders in colours meant for a dark background.
        <ConfigProvider theme={{ ...lightTheme, algorithm: antdTheme.defaultAlgorithm }}>
            <article className="diagnostic-document">
                <header className="diagnostic-document-header">
                    <div className="diagnostic-document-logo">
                        {companyLogoUrl ? <img src={companyLogoUrl} alt={t('Company logo')} /> : <Typography.Text strong>{t('Company Logo')}</Typography.Text>}
                    </div>
                    <div className="diagnostic-document-title">
                        <Typography.Text>{selected.businessName || t('SME')}</Typography.Text>
                        <Typography.Title level={2}>{t('Diagnostic Growth Plan')}</Typography.Title>
                    </div>
                </header>

                <DividerTitle>{t('Business Overview')}</DividerTitle>
                <Descriptions
                    bordered
                    size="small"
                    column={{ xs: 1, md: 2 }}
                    className="diagnostic-clean-descriptions"
                    items={[
                        { key: 'owner', label: t('Business Owner'), children: displayValue(selected.participantName) },
                        { key: 'program', label: t('operations.participants.programme'), children: selected.programName || t('common.unassigned') },
                        { key: 'sector', label: t('common.sector'), children: displayValue(selected.sector) },
                        { key: 'province', label: t('common.province'), children: displayValue(selected.province) },
                    ]}
                />

                <DividerTitle>{t('SWOT Analysis')}</DividerTitle>
                <div className="diagnostic-table-wrap">
                    <table className="diagnostic-document-table">
                        <thead>
                            <tr>
                                <th>{t('operations.diagnostics.strengths')}</th>
                                <th>{t('operations.diagnostics.weaknesses')}</th>
                                <th>{t('operations.diagnostics.opportunities')}</th>
                                <th>{t('operations.diagnostics.threats')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({ length: Math.max(selected.swot.strengths.length, selected.swot.weaknesses.length, selected.swot.opportunities.length, selected.swot.threats.length, 1) }).map((_, index) => (
                                <tr key={index}>
                                    <td>{selected.swot.strengths[index] || emptyValue}</td>
                                    <td>{selected.swot.weaknesses[index] || emptyValue}</td>
                                    <td>{selected.swot.opportunities[index] || emptyValue}</td>
                                    <td>{selected.swot.threats[index] || emptyValue}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {selected.plan.status === 'Confirmed' && <SwotOutcomeCard items={selected.swotItems} planItems={liveForParticipant(selected) as unknown as LivePlanItem[]} />}

                <DividerTitle>{selected.plan.status === 'Confirmed' ? t('Interventions and progress') : t('operations.diagnostics.interventions')}</DividerTitle>
                <div className="diagnostic-table-wrap">
                    <table className="diagnostic-document-table">
                        <thead>
                            <tr>
                                <th style={{ width: 40 }}>#</th>
                                <th>{t('incubatee.tracker.intervention')}</th>
                                <th>{t('incubatee.tracker.area')}</th>
                                {selected.plan.status === 'Confirmed' && <><th>{t('Status')}</th><th>{t('Progress')}</th><th>{t('Outcome')}</th></>}
                            </tr>
                        </thead>
                        <tbody>
                            {selectedLiveInterventions.length ? selectedLiveInterventions.map((item, index) => (
                                <tr key={item.interventionId || item.title}>
                                    <td>{index + 1}</td>
                                    <td>{item.title}</td>
                                    <td>{item.areaOfSupport || emptyValue}</td>
                                    {selected.plan.status === 'Confirmed' && (
                                        <>
                                            <td><Tag color={planStatusColor(item.status)}>{item.status}</Tag>{item.totalSteps > 1 && <span className="diagnostic-steps">{item.completedSteps}/{item.totalSteps} {t('steps confirmed')}</span>}</td>
                                            <td>{item.progress}%</td>
                                            <td><PlanOutcomeChips outcome={item.outcome} /></td>
                                        </>
                                    )}
                                </tr>
                            )) : (
                                <tr><td colSpan={selected.plan.status === 'Confirmed' ? 6 : 3}>{t('operations.diagnostics.noSelectedInterventions')}</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <DividerTitle>{t('Signatures')}</DividerTitle>
                <Row gutter={[12, 12]}>
                    <Col xs={24} md={12}>{signatureBox(t('Operations Signature'), operationsSignature(selected))}</Col>
                    <Col xs={24} md={12}>{signatureBox(t('SME Signature'), smeSignature(selected))}</Col>
                </Row>
            </article>
        </ConfigProvider>
    )

    // Build: the button takes you to the Document to read what you sign. Document: it opens the signature step.
    const signLabel = panel === 'build' ? t('Review and sign') : changing ? t('Sign the change') : t('Sign and confirm')

    const planPanel = selected ? (
        <section className="diagnostic-plan">
            <div className="diagnostic-actionbar">
                {stacked && <Button className="diagnostic-back" icon={<ArrowLeftOutlined />} aria-label={t('Back to SMEs')} title={t('Back to SMEs')} onClick={() => setPlanOpen(false)} />}
                <div className="diagnostic-actionbar-who">
                    <strong>{selected.businessName}</strong>
                    <span>
                        {[selected.participantName, t('{count} interventions', undefined, { count: selectedInterventions.length })].filter(Boolean).join(' · ')}
                        {dirty && <> · <span className="diagnostic-unsaved">{t('Unsaved changes')}</span></>}
                    </span>
                </div>
                {!editable && <Tag className="diagnostic-actionbar-status" color={statusColor(selected.plan.status)}>{statusLabel(selected.plan.status)}</Tag>}
                {/* Phones: back, name and status share the first line; the actions take the next. */}
                {stacked && <span className="diagnostic-actionbar-break" aria-hidden="true" />}
                {editable && (
                    <Segmented<PanelTab>
                        value={panel}
                        onChange={setTab}
                        options={[{ value: 'build', label: t('Build') }, { value: 'document', label: t('Document') }]}
                    />
                )}
                <Button icon={<DownloadOutlined />} onClick={() => downloadDocument(selected)}>{t('common.download')}</Button>
                {editable && changing ? (
                    // A change to a signed plan is only saved by signing it again: saving clears the SME's signature.
                    <>
                        <Button onClick={cancelChange}>{t('Cancel change')}</Button>
                        <Button
                            type="primary"
                            disabled={!dirty || !selectedInterventions.length || !user?.signatureURL}
                            onClick={startSigning}
                        >
                            {signLabel}
                        </Button>
                    </>
                ) : editable ? (
                    <>
                        <Button loading={saving} disabled={!dirty} onClick={() => void persist()}>{t('common.save')}</Button>
                        <Button
                            type="primary"
                            disabled={!selectedInterventions.length || !user?.signatureURL}
                            onClick={startSigning}
                        >
                            {signLabel}
                        </Button>
                    </>
                ) : (
                    canManage && !isDraft && <Button onClick={startChange}>{t('Change plan')}</Button>
                )}
            </div>

            {changing && panel === 'build' && (
                <Alert
                    type="info"
                    showIcon
                    message={t('Changing a signed plan')}
                    description={t('Add interventions, or remove ones no work has started on. You sign the change, then {name} is asked to sign the changed plan.', undefined, { name: selected.businessName })}
                />
            )}
            {editable && !user?.signatureURL && <Alert type="warning" showIcon message={t('Set up your signature before confirming the growth plan.')} />}
            {!editable && !isDraft && !smeHasSigned(selected) && (
                <Alert type="warning" showIcon message={selected.plan.amended ? t('The plan was changed. Waiting for {name} to sign the changed plan.', undefined, { name: selected.businessName }) : t('Waiting for {name} to sign the plan.', undefined, { name: selected.businessName })} />
            )}

            {panel === 'build' ? buildView : documentView}
        </section>
    ) : (
        <div className="diagnostic-plan-empty">
            {loading ? <Skeleton active /> : <Empty description={status === 'Draft' && counts.confirmed && !counts.draft ? t('Every plan is confirmed.') : t('Choose an SME to see their plan.')} />}
        </div>
    )

    return (
        <DashboardPage className="operations-diagnostics-page">
            <div className={`diagnostic-split${stacked ? ' is-stacked' : ''}`}>
                {(!stacked || !planOpen) && queue}
                {(!stacked || planOpen) && planPanel}
            </div>

            <SignDocumentModal
                open={signing}
                onClose={() => setSigning(false)}
                title={changing ? t('Sign the changed plan') : t('Sign the growth plan')}
                description={selected ? (changing
                    ? t('This applies your saved signature to the changed plan for {name}. They are then asked to sign it too.', undefined, { name: selected.businessName })
                    : t('This applies your saved signature and approves the plan for {name}.', undefined, { name: selected.businessName })) : undefined}
                signLabel={changing ? t('Sign the change') : t('Sign and confirm')}
                onSign={signAndConfirm}
                onSigned={() => void afterSigned()}
                signedText={changing ? t('Change signed.') : t('operations.diagnostics.confirmedMessage')}
                errorText={saveErrorText}
            />
        </DashboardPage>
    )
}
