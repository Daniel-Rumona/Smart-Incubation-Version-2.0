import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query, updateDoc, where } from 'firebase/firestore'
import { agentApiBaseUrl } from '@/config/agent'
import { getFirebaseDb } from '@/config/firebase'
import { getAgentAuthHeaders } from '@/services/agentAuth'
import type { FullIdentity } from '@/types/identity'
import { BASIC_CARBON_TAX_ALLOWANCE, withFootprintIndicators } from '@/config/esgEmissions'
import type {
    EsgAction,
    EsgAssurance,
    EsgCarbonTaxPayer,
    EsgClaim,
    EsgEmissionSource,
    EsgFootprint,
    EsgIndicator,
    EsgNarrativeSection,
    EsgPillar,
    EsgRegisterKey,
    EsgReport,
    EsgReportStatus,
    EsgReportValues,
    EsgRisk,
    EsgStakeholder,
} from '@/types/esg'

/**
 * ESG reports (client module `esgReporting`). Every record carries the company code and every query filters on it, so
 * firestore.rules can confirm the reader runs ESG reporting in that company before returning anything.
 */

const REPORTS = 'esgReports'
const ESG_STAFF_ROLES = new Set<string>(['projectadmin', 'operations'])

export const canRunEsg = (user?: Pick<FullIdentity, 'role' | 'companyCode'> | null) =>
    Boolean(user && ESG_STAFF_ROLES.has(user.role) && String(user.companyCode || '').trim())

const esgCompanyOf = (user?: FullIdentity | null) => {
    if (!user || !canRunEsg(user)) throw new Error('forbidden')
    return String(user.companyCode).trim()
}

const text = (value: unknown) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')
const trimmed = (value: unknown) => text(value).trim()
const now = () => new Date().toISOString()
const pillar = (value: unknown): EsgPillar => (value === 'S' || value === 'G' ? value : 'E')
const score = (value: unknown) => (typeof value === 'number' && value >= 1 && value <= 5 ? Math.round(value) : null)
const list = <T>(value: unknown, map: (row: Record<string, unknown>) => T): T[] =>
    (Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object').map(map) : [])
const STATUSES: EsgReportStatus[] = ['draft', 'in_review', 'final']
const ASSURANCE: EsgAssurance[] = ['none', 'internal', 'limited', 'reasonable']
const TAX_PAYER: EsgCarbonTaxPayer[] = ['no', 'yes', 'unsure']
const quantity = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

const toFootprint = (value: unknown): EsgFootprint => {
    const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const allowance = quantity(data.allowancePct)
    return {
        sources: list<EsgEmissionSource>(data.sources, (row) => ({
            id: trimmed(row.id),
            kind: trimmed(row.kind) || 'custom',
            scope: row.scope === 1 || row.scope === 2 ? row.scope : 3,
            label: text(row.label),
            unit: text(row.unit),
            factor: quantity(row.factor),
            factorSource: text(row.factorSource),
            taxable: row.taxable === true,
            monthly: Array.from({ length: 12 }, (_, index) => quantity(Array.isArray(row.monthly) ? row.monthly[index] : null)),
        })),
        carbonTaxPayer: TAX_PAYER.includes(data.carbonTaxPayer as EsgCarbonTaxPayer) ? data.carbonTaxPayer as EsgCarbonTaxPayer : 'unsure',
        allowancePct: allowance === null ? BASIC_CARBON_TAX_ALLOWANCE : allowance,
    }
}

export const toEsgReport = (id: string, data: Record<string, unknown>): EsgReport => ({
    id,
    companyCode: trimmed(data.companyCode),
    clientName: trimmed(data.clientName),
    sector: trimmed(data.sector) || 'other',
    country: trimmed(data.country),
    periodStart: trimmed(data.periodStart),
    periodEnd: trimmed(data.periodEnd),
    publicationDate: trimmed(data.publicationDate),
    claim: data.claim === 'in_accordance' ? 'in_accordance' : 'with_reference' as EsgClaim,
    frameworks: Array.isArray(data.frameworks) ? data.frameworks.filter((item): item is string => typeof item === 'string') : [],
    otherFrameworks: trimmed(data.otherFrameworks),
    funderId: trimmed(data.funderId) || undefined,
    organisationId: trimmed(data.organisationId) || undefined,
    status: STATUSES.includes(data.status as EsgReportStatus) ? data.status as EsgReportStatus : 'draft',
    indicators: list<EsgIndicator>(data.indicators, (row) => ({
        id: trimmed(row.id), pillar: pillar(row.pillar), indicator: text(row.indicator), unit: text(row.unit), baseline: text(row.baseline),
        current: text(row.current), target: text(row.target), period: text(row.period), owner: text(row.owner), evidence: text(row.evidence),
        qualityCheck: text(row.qualityCheck), disclosure: trimmed(row.disclosure),
    })),
    risks: list<EsgRisk>(data.risks, (row) => ({
        id: trimmed(row.id), pillar: pillar(row.pillar), risk: text(row.risk), stakeholders: text(row.stakeholders), likelihood: score(row.likelihood),
        impact: score(row.impact), mitigation: text(row.mitigation), owner: text(row.owner), reviewDate: text(row.reviewDate), status: text(row.status),
    })),
    stakeholders: list<EsgStakeholder>(data.stakeholders, (row) => ({
        id: trimmed(row.id), stakeholder: text(row.stakeholder), concern: text(row.concern), influence: score(row.influence), impact: score(row.impact),
        engagement: text(row.engagement), owner: text(row.owner), nextReview: text(row.nextReview),
    })),
    actions: list<EsgAction>(data.actions, (row) => ({
        id: trimmed(row.id), pillar: pillar(row.pillar), action: text(row.action), baseline: text(row.baseline), target: text(row.target), kpi: text(row.kpi),
        owner: text(row.owner), startDate: text(row.startDate), dueDate: text(row.dueDate), budget: text(row.budget), evidence: text(row.evidence), status: text(row.status),
    })),
    narrative: list<EsgNarrativeSection>(data.narrative, (row) => ({
        key: trimmed(row.key), title: text(row.title), text: text(row.text),
        ...(trimmed(row.draftedAt) ? { draftedAt: trimmed(row.draftedAt) } : {}),
        ...(Array.isArray(row.unmatchedFigures) && row.unmatchedFigures.length ? { unmatchedFigures: row.unmatchedFigures.map(String) } : {}),
    })),
    footprint: toFootprint(data.footprint),
    approvedBy: trimmed(data.approvedBy),
    approverRole: trimmed(data.approverRole),
    approvedOn: trimmed(data.approvedOn),
    assurance: ASSURANCE.includes(data.assurance as EsgAssurance) ? data.assurance as EsgAssurance : 'none',
    assuranceProvider: trimmed(data.assuranceProvider),
    createdAt: trimmed(data.createdAt) || undefined,
    createdBy: trimmed(data.createdBy) || undefined,
    updatedAt: trimmed(data.updatedAt) || undefined,
    updatedBy: trimmed(data.updatedBy) || undefined,
})

export const listEsgReports = async (user: FullIdentity) => {
    const companyCode = esgCompanyOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), REPORTS), where('companyCode', '==', companyCode)))
    return snapshot.docs.map((row) => toEsgReport(row.id, row.data())).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || a.clientName.localeCompare(b.clientName))
}

export const subscribeEsgReport = (user: FullIdentity, reportId: string, onChange: (report: EsgReport | null) => void, onError: () => void) => {
    esgCompanyOf(user)
    return onSnapshot(doc(getFirebaseDb(), REPORTS, reportId), (snapshot) => onChange(snapshot.exists() ? toEsgReport(snapshot.id, snapshot.data()) : null), onError)
}

const cleanValues = (values: EsgReportValues) => ({
    clientName: values.clientName.trim(),
    sector: values.sector,
    country: values.country,
    periodStart: values.periodStart,
    periodEnd: values.periodEnd,
    publicationDate: values.publicationDate,
    claim: values.claim,
    frameworks: [...new Set(values.frameworks)],
    otherFrameworks: values.otherFrameworks.trim(),
    funderId: values.funderId || null,
    approvedBy: values.approvedBy.trim(),
    approverRole: values.approverRole.trim(),
    approvedOn: values.approvedOn,
    assurance: values.assurance,
    assuranceProvider: values.assurance === 'none' ? '' : values.assuranceProvider.trim(),
})

/** The registered client company with this name, so its people see the report (none when training is off). */
const organisationIdFor = async (companyCode: string, clientName: string) => {
    const snapshot = await getDocs(query(collection(getFirebaseDb(), 'trainingOrganisations'), where('companyCode', '==', companyCode))).catch(() => null)
    return snapshot?.docs.find((row) => String(row.data().name || '').trim().toLowerCase() === clientName.trim().toLowerCase())?.id || null
}

export const createEsgReport = async (user: FullIdentity, values: EsgReportValues) => {
    const companyCode = esgCompanyOf(user)
    const created = await addDoc(collection(getFirebaseDb(), REPORTS), {
        ...cleanValues(values),
        organisationId: await organisationIdFor(companyCode, values.clientName),
        companyCode,
        status: 'draft',
        indicators: [],
        risks: [],
        stakeholders: [],
        actions: [],
        narrative: [],
        footprint: { sources: [], carbonTaxPayer: 'unsure', allowancePct: BASIC_CARBON_TAX_ALLOWANCE },
        createdAt: now(),
        createdBy: user.uid,
        updatedAt: now(),
        updatedBy: user.uid,
    })
    return created.id
}

const update = async (user: FullIdentity, reportId: string, changes: Record<string, unknown>) => {
    esgCompanyOf(user)
    await updateDoc(doc(getFirebaseDb(), REPORTS, reportId), { ...changes, updatedAt: now(), updatedBy: user.uid })
}

export const updateEsgReportSetup = async (user: FullIdentity, reportId: string, values: EsgReportValues) =>
    update(user, reportId, { ...cleanValues(values), organisationId: await organisationIdFor(esgCompanyOf(user), values.clientName) })

export const saveEsgRegister = (user: FullIdentity, reportId: string, key: EsgRegisterKey, rows: Array<EsgIndicator | EsgRisk | EsgStakeholder | EsgAction>) =>
    update(user, reportId, { [key]: rows })

/** Saves the carbon footprint and puts each recorded scope's total in the figures (GRI 305-1/2/3), in one write. */
export const saveEsgFootprint = (user: FullIdentity, report: Pick<EsgReport, 'id' | 'indicators'>, footprint: EsgFootprint) =>
    update(user, report.id, { footprint, indicators: withFootprintIndicators(report.indicators, footprint) })

export const saveEsgNarrative = (user: FullIdentity, reportId: string, narrative: EsgNarrativeSection[]) => update(user, reportId, { narrative })

export const setEsgReportStatus = (user: FullIdentity, reportId: string, status: EsgReportStatus) => update(user, reportId, { status })

export const deleteEsgReport = async (user: FullIdentity, reportId: string) => {
    esgCompanyOf(user)
    await deleteDoc(doc(getFirebaseDb(), REPORTS, reportId))
}

/**
 * Asks the assistant to draft the report's written sections from its own data (ai-backend/esg_report_agent.py). The
 * backend reads the saved report itself, so save the registers first. Figures in a draft that are not in the data are
 * returned in `unmatchedFigures` for the facilitator to check.
 */
export const draftEsgSections = async (reportId: string, sections: string[], standards: string[]) => {
    if (!agentApiBaseUrl) throw new Error('assistant_unavailable')
    const response = await fetch(`${agentApiBaseUrl}/api/esg/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAgentAuthHeaders()) },
        body: JSON.stringify({ reportId, sections, standards }),
    })
    const body = await response.json().catch(() => ({})) as { sections?: EsgNarrativeSection[], detail?: string }
    if (!response.ok) throw new Error(body.detail || 'draft_failed')
    return (body.sections || []).map((section) => ({ ...section, draftedAt: now() }))
}
