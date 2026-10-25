import React, { useEffect, useMemo, useState } from 'react'
import {
    Row,
    Col,
    Tag,
    Button,
    Progress,
    Input,
    message,
    Typography,
    Modal,
    Descriptions,
    Space,
    Alert,
    Form,
    InputNumber,
    Select,
    DatePicker,
    Card,
    Segmented,
    Avatar,
    Dropdown,
    Grid
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    TeamOutlined,
    PlusOutlined,
    CheckCircleOutlined,
    WarningOutlined,
    EyeOutlined,
    BarChartOutlined,
    InfoCircleOutlined,
    EditOutlined,
    SaveOutlined,
    StopOutlined,
    DeploymentUnitOutlined,
    SafetyCertificateOutlined,
    ShopOutlined,
    UserOutlined,
    GlobalOutlined,
    RadarChartOutlined,
    EllipsisOutlined,
    SearchOutlined,
} from '@ant-design/icons'
import { db } from '@/firebase/config'
import {
    collection,
    getDocs,
    query,
    where,
    documentId,
    getDoc,
    doc,
    updateDoc,
    addDoc,
    serverTimestamp,
    writeBatch,
    limit
} from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { listWorkspacePrograms, matchesActiveProgram } from '@/services/workspaceProgramsService'
import dayjs from 'dayjs'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import {
    DetailShell,
    ParticipantHero,
    ParticipantDrawerSkeleton,
    SlidingTabs,
    TabPanel,
    KeyFigures,
    type KeyFigure
} from '@/components/participants/ParticipantDrawerParts'
import { initialsOf } from '@/utils/initials'
import PointListInput from '@/components/participants/PointListInput'
import YesNoCards from '@/components/participants/YesNoCards'
import PlatformLinksInput, { type PlatformLink } from '@/components/participants/PlatformLinksInput'
import { ComplianceOverview, InterventionsPanel, SwotTab, TrendCard, type TrendRow } from '@/components/participants/ParticipantDrawerTabs'
import { buildLivePlanItems, livePlanProgress, type LivePlanItem } from '@/utils/liveDiagnosticPlan'
import { readSwotItems, type SwotItem } from '@/utils/swotOutcomes'
import { loadDefinitions } from '@/services/interventionDefinitionLookup'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import '@/styles/operations-participants.css'
import { useLanguage } from '@/providers/LanguageProvider'

const { Text } = Typography
const { TextArea } = Input
const { Option } = Select

const stages = ['Startup', 'Growth', 'Mature', 'Decline']
const provinces = [
    'Eastern Cape',
    'Free State',
    'Gauteng',
    'KwaZulu-Natal',
    'Limpopo',
    'Mpumalanga',
    'North West',
    'Northern Cape',
    'Western Cape'
]
const developmentTypes = ['Enterprise Development', 'Supplier Development']
const sectors = [
    'Agriculture',
    'Mining',
    'Manufacturing',
    'Electricity, Gas and Water',
    'Construction',
    'Wholesale and Retail Trade',
    'Transport, Storage and Communication',
    'Finance, Real Estate and Business Services',
    'Community, Social and Personal Services',
    'Tourism and Hospitality',
    'Information Technology',
    'Education',
    'Health and Social Work',
    'Arts and Culture',
    'Automotive',
    'Chemical',
    'Textile',
    'Forestry and Logging',
    'Fishing',
    'Other'
]

type AnyDoc = Record<string, any>

type ParticipantRow = {
    id: string
    applicationId?: string
    businessName?: string
    participantName?: string
    sector?: string
    stage?: string
    email?: string
    programId?: string
    programName?: string
    imageUrl?: string
    interventions?: {
        required?: any[]
        completed?: any[]
        assigned?: any[]
        participationRate?: number
    }
    progress?: number
    appliedAt?: any
    registeredByLabel?: string
    complianceScore?: number
    riskLevel?: string
    complianceStatus?: string
}

type ViewData = {
    participantId: string
    applicationId: string | null
    participant: AnyDoc | null
    application: AnyDoc | null
    applicantProfile: AnyDoc | null
    businessProfile: AnyDoc | null
    diagnosticPlan: AnyDoc | null
    /** Plan interventions with their catalogue steps, for the live plan view. */
    planItems: AnyDoc[]
    assignments: AnyDoc[]
    programName?: string
    programId?: string
    auditTrail: AnyDoc[]
}

const calculateProgress = (required: number, completed: number) => {
    if (!required || required === 0) return 0
    return Math.round((completed / required) * 100)
}

const formatDateOnly = (v: any) => {
    const parsed = parseUnknownDate(v)
    return parsed ? parsed.format('YYYY-MM-DD') : ''
}

const parseUnknownDate = (value: any): dayjs.Dayjs | null => {
    if (!value) return null

    if (dayjs.isDayjs(value)) {
        return value.isValid() ? value : null
    }

    if (value?.toDate?.()) {
        const parsed = dayjs(value.toDate())
        return parsed.isValid() ? parsed : null
    }

    if (value instanceof Date) {
        const parsed = dayjs(value)
        return parsed.isValid() ? parsed : null
    }

    if (typeof value === 'string') {
        const raw = value.trim()
        if (!raw) return null

        const parsed = dayjs(raw)
        return parsed.isValid() ? parsed : null
    }

    return null
}

const toDatePickerValue = (value: any) => {
    const parsed = parseUnknownDate(value)
    return parsed && parsed.isValid() ? parsed : null
}

const toFirestoreDateOrNull = (value: any) => {
    const parsed = parseUnknownDate(value)
    return parsed ? parsed.startOf('day').toDate() : null
}

const riskColor = (risk?: string) => {
    switch (String(risk || '').toLowerCase()) {
        case 'low':
            return 'green'
        case 'medium':
            return 'orange'
        case 'high':
            return 'red'
        default:
            return 'default'
    }
}

const labelOrHide = (v: any) => {
    if (v === null || v === undefined) return null
    const s = String(v).trim()
    if (!s || s === '-' || s === '—') return null
    return s
}

const chunkArray = <T,>(items: T[], size: number) => {
    const out: T[][] = []
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
    return out
}

/**
 * Runs one of the extra lookups that fill in a participant row (profiles, plans, documents). Not every role may
 * read every collection (directors can't read applicant or business profiles), so a refused lookup leaves those
 * details blank instead of failing the whole list. Any other error still fails it.
 */
const optionalDocs = async (run: () => Promise<{ docs: Array<{ id: string, data: () => unknown }> }>) => {
    try {
        return (await run()).docs
    } catch (error) {
        if ((error as { code?: string })?.code === 'permission-denied') return []
        throw error
    }
}

// `field` is where the link is stored: websiteUrl on the participant, the others under socialMedia.
const DIGITAL_CHANNELS = [
    { key: 'website', field: 'websiteUrl', question: 'Does the business have a website?', label: 'Website', placeholder: 'https://' },
    { key: 'facebook', field: 'facebook', question: 'Does the business have a Facebook page?', label: 'Facebook', placeholder: 'Facebook page link' },
    { key: 'instagram', field: 'instagram', question: 'Does the business have an Instagram account?', label: 'Instagram', placeholder: 'Instagram link or handle' },
    { key: 'x', field: 'x', question: 'Does the business have an X account?', label: 'X', placeholder: 'X link or handle' },
    { key: 'linkedIn', field: 'linkedIn', question: 'Does the business have a LinkedIn page?', label: 'LinkedIn', placeholder: 'LinkedIn page link' },
    { key: 'other', field: 'otherPlatforms', question: 'Is the business on any other online platform?', label: 'Other platforms', placeholder: '' }
] as const

// Other platforms are a list of { platform, link }. Records saved before the list existed hold one plain link in `other`.
const otherPlatformsOf = (participant: AnyDoc | null | undefined): PlatformLink[] => {
    const stored = participant?.socialMedia?.otherPlatforms
    if (Array.isArray(stored)) {
        return stored
            .map((row: AnyDoc) => ({ platform: String(row?.platform || '').trim(), link: String(row?.link || '').trim() }))
            .filter((row: PlatformLink) => row.platform && row.link)
    }
    const legacy = String(participant?.socialMedia?.other || '').trim()
    return legacy ? [{ platform: 'Other', link: legacy }] : []
}

const otherPlatformsText = (list: PlatformLink[]) => list.map(row => `${row.platform}: ${row.link}`).join(' · ')

const channelLink = (participant: AnyDoc | null | undefined, field: string): string =>
    field === 'otherPlatforms'
        ? otherPlatformsText(otherPlatformsOf(participant))
        : String(field === 'websiteUrl' ? participant?.websiteUrl || '' : participant?.socialMedia?.[field] || '').trim()

const SWOT_FIELDS: Array<{ name: 'swotStrengths' | 'swotWeaknesses' | 'swotOpportunities' | 'swotThreats'; label: string; tone: 'green' | 'orange' | 'blue' | 'red' }> = [
    { name: 'swotStrengths', label: 'Strengths', tone: 'green' },
    { name: 'swotWeaknesses', label: 'Weaknesses', tone: 'orange' },
    { name: 'swotOpportunities', label: 'Opportunities', tone: 'blue' },
    { name: 'swotThreats', label: 'Threats', tone: 'red' }
]

const normalizeLineArray = (value: any): string[] => {
    if (Array.isArray(value)) {
        return value
            .map(v => String(v || '').trim())
            .filter(Boolean)
    }

    return String(value || '')
        .split('\n')
        .map(v => v.trim())
        .filter(Boolean)
}

const pickEditedValue = <T,>(formValue: T | undefined, fallbackValue: T) =>
    formValue === undefined ? fallbackValue : formValue

const normalizeValueForCompare = (value: any) => {
    if (dayjs.isDayjs(value)) return value.format('YYYY-MM-DD')
    if (value?.toDate?.()) return dayjs(value.toDate()).format('YYYY-MM-DD')
    if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean)
    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((acc: Record<string, any>, key) => {
                acc[key] = normalizeValueForCompare(value[key])
                return acc
            }, {})
    }
    if (value === undefined || value === null) return null
    return value
}

const stringifyCompare = (value: any) => JSON.stringify(normalizeValueForCompare(value))

const buildAuditChanges = (before: AnyDoc, after: AnyDoc, _scope: 'participant' | 'application') => {
    const labels: Record<string, string> = {
        participantName: 'Owner Name',
        businessName: 'SME Name',
        email: 'Email',
        phone: 'Phone',
        gender: 'Gender',
        idNumber: 'ID Number',
        beeLevel: 'B-BBEE Level',
        youthOwnedPercent: 'Youth-Owned %',
        femaleOwnedPercent: 'Female-Owned %',
        blackOwnedPercent: 'Black-Owned %',
        dateOfRegistration: 'Date of Registration',
        yearsOfTrading: 'Years of Trading',
        registrationNumber: 'Registration Number',
        sector: 'Sector',
        stage: 'Stage',
        developmentType: 'Development Type',
        age: 'Age',
        ageGroup: 'Age Group',
        natureOfBusiness: 'Nature of Business',
        businessAddress: 'Business Address',
        businessAddressProvince: 'Province',
        businessAddressCity: 'City',
        province: 'Province',
        city: 'City',
        locationType: 'Location Type',
        location: 'Location',
        postalCode: 'Postal Code',
        hub: 'Host Community',
        websiteUrl: 'Website URL',
        facebook: 'Facebook',
        instagram: 'Instagram',
        x: 'X',
        linkedIn: 'LinkedIn',
        other: 'Other Link',
        swotStrengths: 'SWOT Strengths',
        swotWeaknesses: 'SWOT Weaknesses',
        swotOpportunities: 'SWOT Opportunities',
        swotThreats: 'SWOT Threats'
    }

    const changes: Array<{
        field: string
        label: string
        before: any
        after: any
    }> = []

    const keys = Object.keys({ ...before, ...after })

    keys.forEach(key => {
        const prev = before[key]
        const next = after[key]

        if (stringifyCompare(prev) !== stringifyCompare(next)) {
            changes.push({
                field: key,
                label: labels[key] || key,
                before: normalizeValueForCompare(prev),
                after: normalizeValueForCompare(next)
            })
        }
    })

    return changes
}

const extractNumericValue = (value: any): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value

    if (typeof value === 'string') {
        const cleaned = value.replace(/,/g, '').trim()
        if (!cleaned) return null
        const parsed = Number(cleaned)
        return Number.isFinite(parsed) ? parsed : null
    }

    if (value && typeof value === 'object') {
        const directCandidates = [
            value.value,
            value.total,
            value.count,
            value.headcount,
            value.staffCount,
            value.numberOfEmployees
        ]

        for (const candidate of directCandidates) {
            const parsed = extractNumericValue(candidate)
            if (parsed !== null) return parsed
        }

        const numericValues = Object.values(value)
            .map(item => extractNumericValue(item))
            .filter((num): num is number => num !== null)

        if (numericValues.length) {
            return numericValues.reduce((sum, num) => sum + num, 0)
        }
    }

    return null
}

const mapHistoryObjectToRows = (obj: Record<string, any>) =>
    Object.entries(obj || {})
        .map(([period, rawValue]) => ({
            period,
            value: extractNumericValue(rawValue)
        }))
        .filter(row => row.value !== null)
        .sort((a, b) => a.period.localeCompare(b.period))

const renderAuditValue = (value: any) => {
    if (value === null || value === undefined || value === '') return '—'

    if (Array.isArray(value)) {
        return value.length ? value.join(', ') : '—'
    }

    if (typeof value === 'object') {
        return Object.values(value).filter(Boolean).join(', ') || '—'
    }

    return String(value)
}

void renderAuditValue

const normalizedStatus = (value: any) => String(value || '').trim().toLowerCase()

/** Share of an SME's compliance documents that are valid, 0-100; undefined when it has none. One definition for the list and the SME view. */
const complianceScoreOf = (docs: AnyDoc[]): number | undefined =>
    docs.length ? Math.round((docs.filter(doc => normalizedStatus(doc.currentStatus) === 'valid').length / docs.length) * 100) : undefined

// The confirmed growth plan is the source of truth for required interventions. Applications can carry an empty
// `requiredInterventions: []`, which is truthy, so sources are chosen by "has items", not by "exists".
const firstNonEmpty = (...sources: any[]): any[] => {
    for (const source of sources) {
        const list = asArray(source)
        if (list.length) return list
    }
    return []
}

const asArray = (value: any): any[] => {
    if (Array.isArray(value)) return value
    if (value && typeof value === 'object') return Object.values(value)
    return []
}

export const ParticipantsPage: React.FC = () => {
    const { t } = useLanguage()
    const navigate = useNavigate()
    const { user } = useFullIdentity()
    const { getSetting, settings, loading: settingsLoading } = useSystemSettings()
    const smeDivisionModel = String(
        settings?.smeDivisionModel ||
        getSetting<string>('smeDivisionModel', 'registered_consultant_only')
    )

    const [editForm] = Form.useForm()
    const screens = Grid.useBreakpoint()
    // Tablet and phone get a bottom sheet; desktop keeps the centered modal.
    const isCompact = !screens.lg
    const [tabDirection, setTabDirection] = useState<1 | -1>(1)
    const [viewSegment, setViewSegment] = useState<
        'overview' | 'business' | 'swot' | 'compliance' | 'interventions' | 'financials'
    >('overview')

    const [editSegment, setEditSegment] = useState<
        'profile' | 'business' | 'digital' | 'swot'
    >('profile')

    const { activeProgramId, isAllPrograms } = useActiveProgramId()

    const [participants, setParticipants] = useState<ParticipantRow[]>([])
    const [searchText, setSearchText] = useState('')
    const [quickFilter, setQuickFilter] = useState<'all' | 'needs-assignment'>('all')
    const [loading, setLoading] = useState(true)
    const [savingEdit, setSavingEdit] = useState(false)
    const [removingParticipant, setRemovingParticipant] = useState(false)
    const [, setProgramNameMap] = useState<Record<string, string>>({})
    const [programOptions, setProgramOptions] = useState<Array<{ value: string; label: string }>>([])
    const [assignProgramOpen, setAssignProgramOpen] = useState(false)
    const [assigningProgram, setAssigningProgram] = useState(false)
    const [selectedProgramId, setSelectedProgramId] = useState<string>()

    const [metrics, setMetrics] = useState({
        totalParticipants: 0,
        totalRequiredInterventions: 0,
        totalCompletedInterventions: 0,
        totalNeedingAssignment: 0
    })

    const [viewOpen, setViewOpen] = useState(false)
    const [viewLoading, setViewLoading] = useState(false)
    const [viewRecord, setViewRecord] = useState<ParticipantRow | null>(null)
    const [viewData, setViewData] = useState<ViewData | null>(null)
    const [editMode, setEditMode] = useState(false)

    const [removeModalOpen, setRemoveModalOpen] = useState(false)
    const [removalReason, setRemovalReason] = useState('')

    const canLoad = !!user?.companyCode && !!activeProgramId && !settingsLoading

    const canAssignProgram =
        !editMode &&
        !!viewData?.participantId &&
        !String(viewData?.participant?.programId || viewData?.application?.programId || viewData?.programId || '').trim()



    const refreshList = async () => {
        if (!canLoad) {
            setParticipants([])
            setProgramNameMap({})
            setLoading(false)
            return
        }

        setLoading(true)
        try {
            const companyCode = String((user as any).companyCode || '').trim()
            const role = String((user as any)?.role || '').toLowerCase()
            const myUid = (user as any)?.uid || null
            const myEmail = (user as any)?.email || null

            const participantConstraints: any[] = [
                where('companyCode', '==', companyCode)
            ]

            if (!isAllPrograms) {
                participantConstraints.push(where('programId', '==', activeProgramId))
            }

            const participantSnap = await getDocs(
                query(collection(db, 'participants'), ...participantConstraints)
            )

            const participantRows: AnyDoc[] = participantSnap.docs.map(d => ({
                id: d.id,
                ...(d.data() as AnyDoc)
            }) as AnyDoc).filter((participant: AnyDoc) => {
                const status = normalizedStatus(participant.status)
                if (status === 'inactive' || status === 'exited' || status === 'removed' || status === 'discontinued') return false
                if (!matchesActiveProgram(user, activeProgramId, participant.programId)) return false

                const shouldSeparateConsultantSmes =
                    smeDivisionModel === 'consultants_register_their_smes'

                if (role === 'consultant' && shouldSeparateConsultantSmes) {
                    const acceptedBy = participant.acceptedBy || {}
                    const ownerUid = participant.uid || participant.ownerUid
                    const ownerEmail = participant.email
                    return (myUid && (acceptedBy.uid === myUid || ownerUid === myUid)) ||
                        (myEmail && (acceptedBy.email === myEmail || ownerEmail === myEmail))
                }

                return true
            })

            const participantIds = Array.from(
                new Set(participantRows.map(p => p.id).filter(Boolean))
            ) as string[]

            const applicationIds = Array.from(
                new Set(participantRows.map(p => String(p.applicationId || '').trim()).filter(Boolean))
            )

            const applicantProfileIds = Array.from(
                new Set(participantRows.map(p => String(p.applicantProfileId || p.uid || '').trim()).filter(Boolean))
            )

            const businessProfileIds = Array.from(
                new Set(participantRows.map(p => String(p.businessProfileId || p.id || '').trim()).filter(Boolean))
            )

            const programIds = Array.from(
                new Set(participantRows.map(p => String(p.programId || '').trim()).filter(Boolean))
            )

            // The applications rule only allows reading one's own company, so the query must filter on it too.
            const applicationDocs: Record<string, AnyDoc> = {}
            for (const chunk of chunkArray(applicationIds, 10)) {
                const apps = await optionalDocs(() => getDocs(
                    query(collection(db, 'applications'), where('companyCode', '==', companyCode), where(documentId(), 'in', chunk))
                ))
                apps.forEach(app => {
                    applicationDocs[app.id] = { id: app.id, ...(app.data() as AnyDoc) }
                })
            }

            const applicantProfiles: Record<string, AnyDoc> = {}
            for (const chunk of chunkArray(applicantProfileIds, 10)) {
                const profiles = await optionalDocs(() => getDocs(
                    query(collection(db, 'applicantProfiles'), where(documentId(), 'in', chunk))
                ))
                profiles.forEach(profile => {
                    applicantProfiles[profile.id] = { id: profile.id, ...(profile.data() as AnyDoc) }
                })
            }

            // The SME's picture lives on their user account (same id as the applicant profile). The rules only allow
            // reading accounts one at a time, and not every account is readable, so a denied read just leaves initials.
            const userImages: Record<string, string> = {}
            const userReads = await Promise.allSettled(applicantProfileIds.map(id => getDoc(doc(db, 'users', id))))
            userReads.forEach((result, index) => {
                if (result.status !== 'fulfilled' || !result.value.exists()) return
                const image = String((result.value.data() as AnyDoc).profileImageUrl || '').trim()
                if (image) userImages[applicantProfileIds[index]] = image
            })

            const businessProfiles: Record<string, AnyDoc> = {}
            for (const chunk of chunkArray(businessProfileIds, 10)) {
                const profiles = await optionalDocs(() => getDocs(
                    query(collection(db, 'businessProfiles'), where(documentId(), 'in', chunk))
                ))
                profiles.forEach(profile => {
                    businessProfiles[profile.id] = { id: profile.id, ...(profile.data() as AnyDoc) }
                })
            }

            // Staff may read every compliance document; a director only their own company's, which the query must say.
            const complianceScope = role === 'director' ? [where('companyCode', '==', companyCode)] : []
            const complianceDocsByParticipant: Record<string, AnyDoc[]> = {}
            for (const chunk of chunkArray(participantIds, 10)) {
                const documents = await optionalDocs(() => getDocs(
                    query(collection(db, 'complianceDocuments'), ...complianceScope, where('participantId', 'in', chunk))
                ))
                documents.forEach(docSnap => {
                    const raw: AnyDoc = { id: docSnap.id, ...(docSnap.data() as AnyDoc) }
                    const pid = String(raw.participantId || '').trim()
                    complianceDocsByParticipant[pid] = [...(complianceDocsByParticipant[pid] || []), raw]
                })
            }

            const diagnosticPlansByApplication: Record<string, AnyDoc> = {}
            for (const chunk of chunkArray(applicationIds, 10)) {
                const plans = await optionalDocs(() => getDocs(
                    query(collection(db, 'diagnosticPlans'), where(documentId(), 'in', chunk))
                ))
                plans.forEach(plan => {
                    diagnosticPlansByApplication[plan.id] = { id: plan.id, ...(plan.data() as AnyDoc) }
                })
            }

            const completedByParticipantId: Record<string, number> = {}
            const completionsSnap = await getDocs(
                query(collection(db, 'interventionCompletions'), where('companyCode', '==', companyCode))
            )
            completionsSnap.docs.forEach(completion => {
                const pid = String((completion.data() as AnyDoc).participantId || '').trim()
                if (!pid) return
                completedByParticipantId[pid] = (completedByParticipantId[pid] || 0) + 1
            })

            const names: Record<string, string> = {}
            for (const chunk of chunkArray(programIds, 10)) {
                const progSnap = await getDocs(
                    query(collection(db, 'programs'), where(documentId(), 'in', chunk))
                )
                progSnap.docs.forEach(docSnap => {
                    const raw = docSnap.data() as AnyDoc
                    names[docSnap.id] = String(
                        raw?.name || raw?.title || raw?.programName || docSnap.id
                    ).trim()
                })
            }
            setProgramNameMap(names)

            const rows: ParticipantRow[] = participantRows.map(participant => {
                const participantId = participant.id
                const application = applicationDocs[String(participant.applicationId || '').trim()] || {}
                const businessProfile = businessProfiles[String(participant.businessProfileId || participant.id || '').trim()] || {}
                const applicantProfile = applicantProfiles[String(participant.applicantProfileId || participant.uid || '').trim()] || {}
                const diagnosticPlan = diagnosticPlansByApplication[String(participant.applicationId || '').trim()] || {}
                const required = firstNonEmpty(
                    diagnosticPlan.interventions,
                    application.interventions?.required,
                    application.requiredInterventions,
                    participant.requiredInterventions
                )
                const completed = Array.from({ length: completedByParticipantId[participantId] || 0 })
                const assigned = asArray(participant.assignedInterventions || application.assignedInterventions)

                const progress = calculateProgress(required.length, completed.length)
                const reg = participant.acceptedBy || application.reviewedBy || application.createdBy || null
                const registeredByLabel = reg?.name || reg?.email || reg?.uid || ''
                const programId = String(participant.programId || application.programId || businessProfile.programId || '').trim()
                const complianceDocs = complianceDocsByParticipant[participantId] || []
                const complianceScore = complianceScoreOf(complianceDocs)

                return {
                    id: participantId,
                    applicationId: participant.applicationId || application.id,
                    participantName: participant.participantName || applicantProfile.participantName || businessProfile.participantName || application.participantName,
                    businessName: participant.businessName || businessProfile.businessName || application.businessName,
                    sector: participant.sector || businessProfile.sector || application.sector,
                    stage: participant.stage || businessProfile.stage || application.stage,
                    email: participant.email || applicantProfile.email || businessProfile.email || application.email,
                    programId,
                    programName: names[programId] || application.programName || programId,
                    imageUrl: [
                        participant.profileImageUrl,
                        businessProfile.logoUrl,
                        applicantProfile.profileImageUrl,
                        userImages[String(participant.applicantProfileId || participant.uid || '').trim()]
                    ].map(value => String(value || '').trim()).find(Boolean) || undefined,
                    interventions: {
                        required,
                        completed,
                        assigned,
                        participationRate: application.interventions?.participationRate || participant.interventions?.participationRate || 0
                    },
                    progress,
                    appliedAt: participant.acceptedAt || application.acceptedAt || application.submittedAt || participant.createdAt || null,
                    registeredByLabel,
                    complianceScore,
                    riskLevel: application.riskLevel || participant.riskLevel || participant.risk || undefined,
                    complianceStatus: application.complianceStatus || participant.complianceStatus || undefined
                }
            })

            setParticipants(rows)
        } catch (e) {
            console.error(e)
            message.error(t('Failed to load participants'))
            setParticipants([])
            setProgramNameMap({})
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        refreshList()
    }, [
        canLoad,
        user?.companyCode,
        (user as any)?.role,
        (user as any)?.uid,
        (user as any)?.email,
        activeProgramId,
        isAllPrograms,
        settingsLoading,
        smeDivisionModel
    ])

    useEffect(() => {
        const fetchPrograms = async () => {

            try {
                const companyCode = String((user as any)?.companyCode || '').trim()
                if (!companyCode) {
                    setProgramOptions([])
                    return
                }

                const options = (await listWorkspacePrograms(user)).map(program => ({
                    value: program.id,
                    label: program.name
                }))

                setProgramOptions(options)
            } catch (error) {
                console.error('Failed to load programs:', error)
                setProgramOptions([])
            }
        }

        fetchPrograms()
    }, [user])

    useEffect(() => {
        setMetrics({
            totalParticipants: participants.length,
            totalRequiredInterventions: participants.reduce(
                (a, p) => a + (p.interventions?.required?.length || 0),
                0
            ),
            totalCompletedInterventions: participants.reduce(
                (a, p) => a + (p.interventions?.completed?.length || 0),
                0
            ),
            totalNeedingAssignment: participants.filter(
                p => (p.interventions?.assigned?.length || 0) === 0
            ).length
        })
    }, [participants])

    const filteredParticipants = useMemo(() => {
        let filtered = participants

        if (quickFilter === 'needs-assignment') {
            filtered = filtered.filter(p => (p.interventions?.assigned?.length || 0) === 0)
        }

        if (searchText.trim()) {
            const s = searchText.trim().toLowerCase()
            filtered = filtered.filter(
                p =>
                    String(p.businessName || '').toLowerCase().includes(s) ||
                    String(p.participantName || '').toLowerCase().includes(s) ||
                    String(p.sector || '').toLowerCase().includes(s) ||
                    String(p.email || '').toLowerCase().includes(s) ||
                    String(p.programName || '').toLowerCase().includes(s)
            )
        }

        return filtered
    }, [participants, searchText, quickFilter])

    const loadAuditTrail = async (participantId: string, applicationId?: string | null) => {
        try {
            const snap = await getDocs(
                query(
                    collection(db, 'participantAuditTrail'),
                    where('participantId', '==', participantId),
                    limit(50)
                )
            )

            const rows: AnyDoc[] = snap.docs
                .map(d => ({ id: d.id, ...(d.data() as AnyDoc) }) as AnyDoc)
                .sort((a, b) => {
                    const aMs = a?.createdAt?.toDate?.()?.getTime?.() || 0
                    const bMs = b?.createdAt?.toDate?.()?.getTime?.() || 0
                    return bMs - aMs
                })

            if (!applicationId) return rows
            return rows.filter(x => !x.applicationId || x.applicationId === applicationId)
        } catch (error) {
            console.error('Failed to load audit trail:', error)
            return []
        }
    }

    const assignProgramToParticipant = async () => {
        if (!viewData?.participantId) {
            message.error(t('SME record not found'))
            return
        }

        const programId = String(selectedProgramId || '').trim()
        if (!programId) {
            message.error(t('Please select a program'))
            return
        }

        const pickedProgram = programOptions.find(p => p.value === programId)
        const programName = pickedProgram?.label || programId

        setAssigningProgram(true)

        try {
            const updatedBy = {
                uid: (user as any)?.uid || null,
                email: (user as any)?.email || null,
                name: (user as any)?.name || (user as any)?.displayName || null,
                role: (user as any)?.role || null
            }
            const batch = writeBatch(db)
            if (viewData.applicationId) {
                batch.update(doc(db, 'applications', viewData.applicationId), {
                    programId,
                    programName,
                    updatedAt: serverTimestamp(),
                    updatedBy
                })
            }
            batch.update(doc(db, 'participants', viewData.participantId), {
                programId,
                updatedAt: serverTimestamp(),
                updatedBy
            })
            const businessProfileId = String(
                viewData.businessProfile?.id ||
                viewData.participant?.businessProfileId ||
                viewData.application?.businessProfileId ||
                viewData.participantId
            ).trim()
            if (businessProfileId) {
                batch.set(doc(db, 'businessProfiles', businessProfileId), {
                    programId,
                    updatedAt: serverTimestamp()
                }, { merge: true })
            }
            await batch.commit()

            await addDoc(collection(db, 'participantAuditTrail'), {
                participantId: viewData.participantId,
                applicationId: viewData.applicationId || null,
                companyCode: String((user as any)?.companyCode || '').trim(),
                actionType: 'program_assigned',
                programId,
                programName,
                changes: [
                    {
                        field: 'programId',
                        label: 'Program',
                        before: null,
                        after: {
                            programId,
                            programName
                        },
                        scope: 'application'
                    }
                ],
                createdAt: serverTimestamp(),
                createdBy: {
                    uid: (user as any)?.uid || null,
                    email: (user as any)?.email || null,
                    name: (user as any)?.name || (user as any)?.displayName || null,
                    role: (user as any)?.role || null
                }
            })

            message.success(t('Program assigned successfully'))
            setAssignProgramOpen(false)
            setSelectedProgramId(undefined)

            await openView({
                ...viewRecord!,
                programId,
                applicationId: viewData.applicationId || viewRecord?.applicationId,
                programName
            })

            await refreshList()
        } catch (error: any) {
            console.error(error)
            message.error(error?.message || t('Failed to assign program'))
        } finally {
            setAssigningProgram(false)
        }
    }

    const fillEditForm = (mergedParticipant: AnyDoc | null, applicationData: AnyDoc | null) => {
        editForm.resetFields()
        // Yes when a link is stored, No when it was recorded that there is none, unanswered otherwise.
        const presence = Object.fromEntries(DIGITAL_CHANNELS.map(channel => [
            `presence_${channel.key}`,
            channelLink(mergedParticipant, channel.field) ? 'yes' : mergedParticipant?.digitalPresence?.[channel.key] === false ? 'no' : undefined
        ]))
        editForm.setFieldsValue({
            ...presence,
            participantName: mergedParticipant?.participantName || applicationData?.participantName || '',
            businessName: mergedParticipant?.businessName || applicationData?.businessName || '',
            email: mergedParticipant?.email || applicationData?.email || '',
            phone: mergedParticipant?.phone || '',
            gender: mergedParticipant?.gender || applicationData?.gender || undefined,
            idNumber: mergedParticipant?.idNumber || '',
            beeLevel: mergedParticipant?.beeLevel || '',
            youthOwnedPercent: mergedParticipant?.ownership?.youthOwnedPercent ?? mergedParticipant?.youthOwnedPercent ?? 0,
            femaleOwnedPercent: mergedParticipant?.ownership?.femaleOwnedPercent ?? mergedParticipant?.femaleOwnedPercent ?? 0,
            blackOwnedPercent: mergedParticipant?.ownership?.blackOwnedPercent ?? mergedParticipant?.blackOwnedPercent ?? 0,
            dateOfRegistration: toDatePickerValue(mergedParticipant?.dateOfRegistration),
            yearsOfTrading: mergedParticipant?.yearsOfTrading ?? 0,
            registrationNumber: mergedParticipant?.registrationNumber || '',
            sector: mergedParticipant?.sector || applicationData?.sector || undefined,
            stage: mergedParticipant?.stage || applicationData?.stage || undefined,
            developmentType: mergedParticipant?.developmentType || undefined,
            age: mergedParticipant?.age ?? null,
            natureOfBusiness: mergedParticipant?.natureOfBusiness || '',
            businessAddress: mergedParticipant?.businessAddress || '',
            businessAddressProvince: mergedParticipant?.province || undefined,
            businessAddressCity: mergedParticipant?.city || '',
            locationType: mergedParticipant?.locationType || undefined,
            location: mergedParticipant?.location || '',
            postalCode: mergedParticipant?.postalCode || '',
            hub: mergedParticipant?.hub || '',
            websiteUrl: mergedParticipant?.websiteUrl || '',
            facebook: mergedParticipant?.socialMedia?.facebook || '',
            instagram: mergedParticipant?.socialMedia?.instagram || '',
            x: mergedParticipant?.socialMedia?.x || '',
            linkedIn: mergedParticipant?.socialMedia?.linkedIn || '',
            otherPlatforms: otherPlatformsOf(mergedParticipant),
            swotStrengths: Array.isArray(mergedParticipant?.swot?.strengths)
                ? mergedParticipant.swot.strengths.join('\n')
                : '',
            swotWeaknesses: Array.isArray(mergedParticipant?.swot?.weaknesses)
                ? mergedParticipant.swot.weaknesses.join('\n')
                : '',
            swotOpportunities: Array.isArray(mergedParticipant?.swot?.opportunities)
                ? mergedParticipant.swot.opportunities.join('\n')
                : '',
            swotThreats: Array.isArray(mergedParticipant?.swot?.threats)
                ? mergedParticipant.swot.threats.join('\n')
                : ''
        })
    }

    // A point list's value is newline-separated text; a trailing newline is a new empty point.
    const addPoint = (name: string) => {
        const current = String(editForm.getFieldValue(name) ?? '')
        editForm.setFieldValue(name, `${current}\n`)
    }

    const cancelEdit = () => {
        if (viewData) fillEditForm(viewData.participant, viewData.application)
        else editForm.resetFields()
        setEditSegment('profile')
        setEditMode(false)
    }

    const secondaryActions = [
        ...(canAssignProgram ? [{ key: 'assign', icon: <DeploymentUnitOutlined />, label: t('Assign Program'), danger: false, disabled: false, onClick: () => setAssignProgramOpen(true) }] : []),
        {
            key: 'discontinue',
            icon: <StopOutlined />,
            label: t('Discontinue'),
            danger: true,
            disabled: !viewData?.applicationId || ['removed', 'discontinued'].includes(String(viewData?.application?.applicationStatus || '').toLowerCase()),
            onClick: () => setRemoveModalOpen(true)
        }
    ]

    const closeView = () => {
        setViewOpen(false)
        setViewRecord(null)
        setViewData(null)
        setEditMode(false)
        setViewSegment('overview')
        setEditSegment('profile')
        editForm.resetFields()
    }

    const viewIndex = viewRecord ? filteredParticipants.findIndex(row => row.id === viewRecord.id) : -1
    const stepView = (offset: 1 | -1) => {
        const next = filteredParticipants[viewIndex + offset]
        if (!next) return
        setViewSegment('overview')
        void openView(next)
    }

    const openView = async (record: ParticipantRow) => {
        setViewLoading(true)
        setViewRecord(record)
        setViewOpen(true)
        setEditMode(false)
        setViewData(null)
        editForm.resetFields()

        try {
            const participantRef = doc(db, 'participants', record.id)
            const participantSnap = await getDoc(participantRef)

            let applicationDocId = record.applicationId || null
            let applicationData: AnyDoc | null = null

            if (applicationDocId) {
                const appRef = doc(db, 'applications', applicationDocId)
                const appSnap = await getDoc(appRef)
                if (appSnap.exists()) {
                    applicationData = { id: appSnap.id, ...(appSnap.data() as AnyDoc) }
                }
            }

            if (!applicationData) {
                const qConstraints: any[] = [
                    where('participantId', '==', record.id),
                    where('companyCode', '==', String((user as any)?.companyCode || '').trim())
                ]

                if (record.programId) {
                    qConstraints.push(where('programId', '==', record.programId))
                }

                const appSnap = await getDocs(query(collection(db, 'applications'), ...qConstraints, limit(1)))
                if (!appSnap.empty) {
                    const first = appSnap.docs[0]
                    applicationDocId = first.id
                    applicationData = { id: first.id, ...(first.data() as AnyDoc) }
                }
            }

            const participantData: AnyDoc | null = participantSnap.exists()
                ? { id: participantSnap.id, ...(participantSnap.data() as AnyDoc) }
                : null

            const applicantProfileId = String(
                participantData?.applicantProfileId ||
                applicationData?.applicantProfileId ||
                participantData?.uid ||
                applicationData?.uid ||
                ''
            ).trim()

            const businessProfileId = String(
                participantData?.businessProfileId ||
                applicationData?.businessProfileId ||
                record.id ||
                ''
            ).trim()

            const [applicantProfileSnap, businessProfileSnap, complianceSnap, diagnosticPlanSnap, assignmentSnap] = await Promise.all([
                applicantProfileId ? getDoc(doc(db, 'applicantProfiles', applicantProfileId)) : Promise.resolve(null),
                businessProfileId ? getDoc(doc(db, 'businessProfiles', businessProfileId)) : Promise.resolve(null),
                getDocs(query(collection(db, 'complianceDocuments'), where('participantId', '==', record.id))),
                applicationDocId ? getDoc(doc(db, 'diagnosticPlans', applicationDocId)) : Promise.resolve(null),
                getDocs(query(collection(db, 'assignedInterventions'), where('companyCode', '==', String((user as any)?.companyCode || '').trim()), where('participantId', '==', record.id)))
            ])

            const applicantProfile = applicantProfileSnap && applicantProfileSnap.exists()
                ? { id: applicantProfileSnap.id, ...(applicantProfileSnap.data() as AnyDoc) }
                : null
            const businessProfile = businessProfileSnap && businessProfileSnap.exists()
                ? { id: businessProfileSnap.id, ...(businessProfileSnap.data() as AnyDoc) }
                : null
            const complianceDocuments: AnyDoc[] = complianceSnap.docs.map(d => ({ id: d.id, ...(d.data() as AnyDoc) } as AnyDoc))
            const diagnosticPlan: AnyDoc | null = diagnosticPlanSnap && diagnosticPlanSnap.exists()
                ? { id: diagnosticPlanSnap.id, ...(diagnosticPlanSnap.data() as AnyDoc) }
                : null
            const assignments: AnyDoc[] = assignmentSnap.docs.map(d => ({ id: d.id, ...(d.data() as AnyDoc) } as AnyDoc))
            const planCompanyCode = String(diagnosticPlan?.companyCode || applicationData?.companyCode || (user as any)?.companyCode || '')
            const requiredList = firstNonEmpty(
                diagnosticPlan?.interventions,
                applicationData?.interventions?.required,
                applicationData?.requiredInterventions,
                participantData?.requiredInterventions
            )
            const definitions = await loadDefinitions(
                db,
                requiredList.map(item => ({ interventionId: String(item?.interventionId || item?.id || ''), companyCode: planCompanyCode }))
            )
            const planItems: AnyDoc[] = requiredList.map(item => {
                const definition = definitions.get(String(item?.interventionId || item?.id || ''), planCompanyCode) || {}
                return {
                    ...item,
                    areaOfSupport: item?.areaOfSupport || definition.areaOfSupport,
                    executionMode: item?.executionMode || definition.executionMode,
                    steps: Array.isArray(item?.steps) ? item.steps : definition.steps
                }
            })
            const mergedParticipant: AnyDoc = {
                ...(applicantProfile || {}),
                ...(businessProfile || {}),
                ...(participantData || {}),
                complianceDocuments
            }
            const auditTrail = await loadAuditTrail(record.id, applicationDocId)

            const hydrated: ViewData = {
                participantId: record.id,
                applicationId: applicationDocId,
                participant: mergedParticipant,
                application: applicationData,
                applicantProfile,
                businessProfile,
                diagnosticPlan,
                planItems,
                assignments,
                programId: record.programId,
                programName: record.programName,
                auditTrail
            }

            setViewData(hydrated)

            fillEditForm(mergedParticipant, applicationData)
        } catch (error) {
            console.error(error)
            message.error(t('Failed to load full SME details'))
        } finally {
            setViewLoading(false)
        }
    }

    const saveEdits = async () => {
        if (!viewData?.participantId || !viewData?.participant || !viewData?.application) {
            message.error(t('Missing participant data to update'))
            return
        }

        setSavingEdit(true)

        try {
            await editForm.validateFields()
            const values = editForm.getFieldsValue(true)

            // Only a Yes keeps a link; No or unanswered clears it. The answer itself is stored so "No" can be told from "unknown".
            const digitalPresence: Record<string, boolean | null> = {}
            DIGITAL_CHANNELS.forEach(channel => {
                // A Yes with no link entered (the field is only validated while its tab is open) counts as unanswered.
                const isList = channel.field === 'otherPlatforms'
                const entered = isList
                    ? (Array.isArray(values.otherPlatforms) ? values.otherPlatforms : []).filter((row: PlatformLink) => String(row?.platform || '').trim() && String(row?.link || '').trim())
                    : String(values[channel.field] || '').trim()
                const choice = values[`presence_${channel.key}`] === 'yes' && !entered.length ? undefined : values[`presence_${channel.key}`]
                digitalPresence[channel.key] = choice === 'yes' ? true : choice === 'no' ? false : null
                values[channel.field] = choice !== 'yes' ? (isList ? [] : '') : isList ? (entered as PlatformLink[]).map(row => ({ platform: row.platform.trim(), link: row.link.trim() })) : values[channel.field]
            })

            const swot = {
                strengths: normalizeLineArray(values.swotStrengths),
                weaknesses: normalizeLineArray(values.swotWeaknesses),
                opportunities: normalizeLineArray(values.swotOpportunities),
                threats: normalizeLineArray(values.swotThreats)
            }

            const swotListsFor = (source: AnyDoc | null | undefined) => ({
                strengths: values.swotStrengths === undefined ? source?.swot?.strengths || [] : swot.strengths,
                weaknesses: values.swotWeaknesses === undefined ? source?.swot?.weaknesses || [] : swot.weaknesses,
                opportunities: values.swotOpportunities === undefined ? source?.swot?.opportunities || [] : swot.opportunities,
                threats: values.swotThreats === undefined ? source?.swot?.threats || [] : swot.threats
            })
            const survivingSwotItems = (source: AnyDoc | null | undefined): { swotItems?: SwotItem[] } => {
                const existing = readSwotItems(source)
                if (!existing.length) return {}
                const lists = swotListsFor(source) as Record<string, string[]>
                return { swotItems: existing.filter(item => (lists[item.quadrant] || []).includes(item.text)) }
            }

            const stageValue = String(values.stage || '').trim()
            const ageValue =
                values.age !== undefined && values.age !== null && values.age !== ''
                    ? Number(values.age)
                    : null

            const ageGroup =
                typeof ageValue === 'number'
                    ? ageValue <= 35
                        ? 'Youth'
                        : ageValue <= 59
                            ? 'Adult'
                            : 'Senior'
                    : null

            const participantBeforeComparable = {
                participantName: viewData.participant?.participantName || null,
                businessName: viewData.participant?.businessName || null,
                email: viewData.participant?.email || null,
                phone: viewData.participant?.phone || null,
                gender: viewData.participant?.gender || null,
                idNumber: viewData.participant?.idNumber || null,
                beeLevel: viewData.participant?.beeLevel || null,
                youthOwnedPercent: viewData.participant?.youthOwnedPercent ?? 0,
                femaleOwnedPercent: viewData.participant?.femaleOwnedPercent ?? 0,
                blackOwnedPercent: viewData.participant?.blackOwnedPercent ?? 0,
                dateOfRegistration: viewData.participant?.dateOfRegistration || null,
                yearsOfTrading: viewData.participant?.yearsOfTrading ?? 0,
                registrationNumber: viewData.participant?.registrationNumber || null,
                sector: viewData.participant?.sector || null,
                stage: viewData.participant?.stage || null,
                developmentType: viewData.participant?.developmentType || null,
                age: viewData.participant?.age ?? null,
                ageGroup: viewData.participant?.ageGroup ?? null,
                natureOfBusiness: viewData.participant?.natureOfBusiness || null,
                businessAddress: viewData.participant?.businessAddress || null,
                businessAddressProvince:
                    viewData.participant?.businessAddressProvince || viewData.participant?.province || null,
                businessAddressCity:
                    viewData.participant?.businessAddressCity || viewData.participant?.city || null,
                province: viewData.participant?.province || null,
                city: viewData.participant?.city || null,
                locationType: viewData.participant?.locationType || null,
                location: viewData.participant?.location || null,
                postalCode: viewData.participant?.postalCode || null,
                hub: viewData.participant?.hub || null,
                websiteUrl: viewData.participant?.websiteUrl || null,
                facebook: viewData.participant?.socialMedia?.facebook || null,
                instagram: viewData.participant?.socialMedia?.instagram || null,
                x: viewData.participant?.socialMedia?.x || null,
                linkedIn: viewData.participant?.socialMedia?.linkedIn || null,
                other: otherPlatformsText(otherPlatformsOf(viewData.participant)) || null,
                swotStrengths: viewData.participant?.swot?.strengths || [],
                swotWeaknesses: viewData.participant?.swot?.weaknesses || [],
                swotOpportunities: viewData.participant?.swot?.opportunities || [],
                swotThreats: viewData.participant?.swot?.threats || []
            }

            const participantAfterComparable = {
                participantName: pickEditedValue(values.participantName, viewData.participant?.participantName || null),
                businessName: pickEditedValue(values.businessName, viewData.participant?.businessName || null),
                email: pickEditedValue(values.email, viewData.participant?.email || null),
                phone: pickEditedValue(values.phone, viewData.participant?.phone || null),
                gender: pickEditedValue(values.gender, viewData.participant?.gender || null),
                idNumber: pickEditedValue(values.idNumber, viewData.participant?.idNumber || null),
                beeLevel: pickEditedValue(values.beeLevel, viewData.participant?.beeLevel || null),
                youthOwnedPercent: pickEditedValue(values.youthOwnedPercent, viewData.participant?.youthOwnedPercent ?? 0),
                femaleOwnedPercent: pickEditedValue(values.femaleOwnedPercent, viewData.participant?.femaleOwnedPercent ?? 0),
                blackOwnedPercent: pickEditedValue(values.blackOwnedPercent, viewData.participant?.blackOwnedPercent ?? 0),
                dateOfRegistration:
                    values.dateOfRegistration === undefined
                        ? viewData.participant?.dateOfRegistration || null
                        : toFirestoreDateOrNull(values.dateOfRegistration),
                yearsOfTrading: pickEditedValue(values.yearsOfTrading, viewData.participant?.yearsOfTrading ?? 0),
                registrationNumber: pickEditedValue(values.registrationNumber, viewData.participant?.registrationNumber || null),
                sector: pickEditedValue(values.sector, viewData.participant?.sector || null),
                stage: values.stage === undefined ? viewData.participant?.stage || null : stageValue || null,
                developmentType: pickEditedValue(values.developmentType, viewData.participant?.developmentType || null),
                age: values.age === undefined ? viewData.participant?.age ?? null : ageValue,
                ageGroup:
                    values.age === undefined
                        ? viewData.participant?.ageGroup ?? null
                        : ageGroup,
                natureOfBusiness: pickEditedValue(values.natureOfBusiness, viewData.participant?.natureOfBusiness || null),
                businessAddress: pickEditedValue(values.businessAddress, viewData.participant?.businessAddress || null),
                businessAddressProvince:
                    values.businessAddressProvince === undefined
                        ? viewData.participant?.businessAddressProvince || viewData.participant?.province || null
                        : values.businessAddressProvince || null,
                businessAddressCity:
                    values.businessAddressCity === undefined
                        ? viewData.participant?.businessAddressCity || viewData.participant?.city || null
                        : values.businessAddressCity || null,
                province:
                    values.businessAddressProvince === undefined
                        ? viewData.participant?.province || null
                        : values.businessAddressProvince || null,
                city:
                    values.businessAddressCity === undefined
                        ? viewData.participant?.city || null
                        : values.businessAddressCity || null,
                locationType: pickEditedValue(values.locationType, viewData.participant?.locationType || null),
                location: pickEditedValue(values.location, viewData.participant?.location || null),
                postalCode: pickEditedValue(values.postalCode, viewData.participant?.postalCode || null),
                hub: pickEditedValue(values.hub, viewData.participant?.hub || null),
                websiteUrl: pickEditedValue(values.websiteUrl, viewData.participant?.websiteUrl || null),
                facebook: pickEditedValue(values.facebook, viewData.participant?.socialMedia?.facebook || null),
                instagram: pickEditedValue(values.instagram, viewData.participant?.socialMedia?.instagram || null),
                x: pickEditedValue(values.x, viewData.participant?.socialMedia?.x || null),
                linkedIn: pickEditedValue(values.linkedIn, viewData.participant?.socialMedia?.linkedIn || null),
                other: otherPlatformsText(values.otherPlatforms) || null,
                swotStrengths:
                    values.swotStrengths === undefined ? viewData.participant?.swot?.strengths || [] : swot.strengths,
                swotWeaknesses:
                    values.swotWeaknesses === undefined ? viewData.participant?.swot?.weaknesses || [] : swot.weaknesses,
                swotOpportunities:
                    values.swotOpportunities === undefined ? viewData.participant?.swot?.opportunities || [] : swot.opportunities,
                swotThreats:
                    values.swotThreats === undefined ? viewData.participant?.swot?.threats || [] : swot.threats
            }

            const applicationBeforeComparable = {
                participantName: viewData.application?.participantName || null,
                businessName: viewData.application?.businessName || null,
                email: viewData.application?.email || null,
                gender: viewData.application?.gender || null,
                stage: viewData.application?.stage || null,
                sector: viewData.application?.sector || null,
                province: viewData.application?.province || null,
                hub: viewData.application?.hub || null,
                swotStrengths: viewData.application?.swot?.strengths || [],
                swotWeaknesses: viewData.application?.swot?.weaknesses || [],
                swotOpportunities: viewData.application?.swot?.opportunities || [],
                swotThreats: viewData.application?.swot?.threats || []
            }

            const applicationAfterComparable = {
                participantName: pickEditedValue(values.participantName, viewData.application?.participantName || null),
                businessName: pickEditedValue(values.businessName, viewData.application?.businessName || null),
                email: pickEditedValue(values.email, viewData.application?.email || null),
                gender: pickEditedValue(values.gender, viewData.application?.gender || null),
                stage: values.stage === undefined ? viewData.application?.stage || null : stageValue || null,
                sector: pickEditedValue(values.sector, viewData.application?.sector || null),
                province:
                    values.businessAddressProvince === undefined
                        ? viewData.application?.province || null
                        : values.businessAddressProvince || null,
                hub: pickEditedValue(values.hub, viewData.application?.hub || null),
                swotStrengths:
                    values.swotStrengths === undefined ? viewData.application?.swot?.strengths || [] : swot.strengths,
                swotWeaknesses:
                    values.swotWeaknesses === undefined ? viewData.application?.swot?.weaknesses || [] : swot.weaknesses,
                swotOpportunities:
                    values.swotOpportunities === undefined ? viewData.application?.swot?.opportunities || [] : swot.opportunities,
                swotThreats:
                    values.swotThreats === undefined ? viewData.application?.swot?.threats || [] : swot.threats
            }

            const participantChanges = buildAuditChanges(
                participantBeforeComparable,
                participantAfterComparable,
                'participant'
            )

            const applicationChanges = buildAuditChanges(
                applicationBeforeComparable,
                applicationAfterComparable,
                'application'
            )

            const rawChanges = [...participantChanges, ...applicationChanges]

            const allChanges = Array.from(
                new Map(
                    rawChanges
                        .filter(change => stringifyCompare(change.before) !== stringifyCompare(change.after))
                        .map(change => [
                            change.field,
                            {
                                field: change.field,
                                label: change.label,
                                before: change.before,
                                after: change.after
                            }
                        ])
                ).values()
            )

            if (!allChanges.length) {
                message.info(t('No changes detected'))
                return
            }

            const updatedBy = {
                uid: (user as any)?.uid || null,
                email: (user as any)?.email || null,
                name: (user as any)?.name || (user as any)?.displayName || null,
                role: (user as any)?.role || null
            }

            const applicantProfileId = String(
                viewData.applicantProfile?.id ||
                viewData.participant?.applicantProfileId ||
                viewData.participant?.uid ||
                viewData.application?.applicantProfileId ||
                viewData.application?.uid ||
                viewData.participantId
            ).trim()

            const businessProfileId = String(
                viewData.businessProfile?.id ||
                viewData.participant?.businessProfileId ||
                viewData.application?.businessProfileId ||
                viewData.participantId
            ).trim()

            const nextBusinessName = pickEditedValue(values.businessName, viewData.participant?.businessName || '')
            const nextParticipantName = pickEditedValue(values.participantName, viewData.participant?.participantName || '')
            const nextEmail = pickEditedValue(values.email, viewData.participant?.email || '')
            const nextPhone = pickEditedValue(values.phone, viewData.participant?.phone || '')
            const nextProvince = values.businessAddressProvince === undefined
                ? viewData.participant?.province || ''
                : values.businessAddressProvince || ''
            const nextCity = values.businessAddressCity === undefined
                ? viewData.participant?.city || ''
                : values.businessAddressCity || ''
            const nextSector = pickEditedValue(values.sector, viewData.participant?.sector || '')
            const nextStage = values.stage === undefined ? viewData.participant?.stage || '' : stageValue || ''
            const nextBeeLevel = pickEditedValue(values.beeLevel, viewData.participant?.beeLevel || '')

            const participantUpdatePayload: AnyDoc = {
                uid: viewData.participant?.uid || viewData.application?.uid || viewData.participantId,
                applicationId: viewData.applicationId || viewData.participant?.applicationId || null,
                applicantProfileId,
                businessProfileId,
                programId: viewData.participant?.programId || viewData.application?.programId || viewData.programId || null,
                companyCode: String((user as any)?.companyCode || viewData.participant?.companyCode || '').trim() || null,
                departmentId: viewData.participant?.departmentId || viewData.application?.departmentId || null,
                businessName: nextBusinessName,
                participantName: nextParticipantName,
                email: nextEmail,
                phone: nextPhone,
                sector: nextSector,
                stage: nextStage,
                province: nextProvince,
                beeLevel: nextBeeLevel,
                status: viewData.participant?.status || 'active',
                updatedAt: serverTimestamp(),
                updatedBy
            }

            const applicantProfileUpdatePayload: AnyDoc = {
                uid: viewData.participant?.uid || viewData.application?.uid || viewData.participantId,
                participantName: nextParticipantName,
                email: nextEmail,
                phone: nextPhone,
                gender: pickEditedValue(values.gender, viewData.participant?.gender || ''),
                idNumber: pickEditedValue(values.idNumber, viewData.participant?.idNumber || ''),
                age: values.age === undefined ? viewData.participant?.age ?? null : ageValue,
                ageGroup: values.age === undefined ? viewData.participant?.ageGroup ?? null : ageGroup,
                province: nextProvince,
                city: nextCity,
                updatedAt: serverTimestamp()
            }

            const businessProfileUpdatePayload: AnyDoc = {
                ownerUid: viewData.participant?.uid || viewData.application?.uid || viewData.participantId,
                applicantProfileId,
                businessName: nextBusinessName,
                participantName: nextParticipantName,
                email: nextEmail,
                phone: nextPhone,
                sector: nextSector,
                natureOfBusiness: pickEditedValue(values.natureOfBusiness, viewData.participant?.natureOfBusiness || ''),
                stage: nextStage,
                beeLevel: nextBeeLevel,
                registrationNumber: pickEditedValue(values.registrationNumber, viewData.participant?.registrationNumber || ''),
                dateOfRegistration:
                    values.dateOfRegistration === undefined
                        ? viewData.participant?.dateOfRegistration || null
                        : toFirestoreDateOrNull(values.dateOfRegistration),
                yearsOfTrading: pickEditedValue(values.yearsOfTrading, viewData.participant?.yearsOfTrading ?? 0),
                developmentType: pickEditedValue(values.developmentType, viewData.participant?.developmentType || ''),
                ownership: {
                    youthOwnedPercent: pickEditedValue(values.youthOwnedPercent, viewData.participant?.ownership?.youthOwnedPercent ?? viewData.participant?.youthOwnedPercent ?? 0),
                    femaleOwnedPercent: pickEditedValue(values.femaleOwnedPercent, viewData.participant?.ownership?.femaleOwnedPercent ?? viewData.participant?.femaleOwnedPercent ?? 0),
                    blackOwnedPercent: pickEditedValue(values.blackOwnedPercent, viewData.participant?.ownership?.blackOwnedPercent ?? viewData.participant?.blackOwnedPercent ?? 0)
                },
                businessAddress: pickEditedValue(values.businessAddress, viewData.participant?.businessAddress || ''),
                province: nextProvince,
                city: nextCity,
                postalCode: pickEditedValue(values.postalCode, viewData.participant?.postalCode || ''),
                hub: pickEditedValue(values.hub, viewData.participant?.hub || ''),
                websiteUrl: pickEditedValue(values.websiteUrl, viewData.participant?.websiteUrl || ''),
                digitalPresence,
                socialMedia: {
                    facebook: pickEditedValue(values.facebook, viewData.participant?.socialMedia?.facebook || ''),
                    instagram: pickEditedValue(values.instagram, viewData.participant?.socialMedia?.instagram || ''),
                    x: pickEditedValue(values.x, viewData.participant?.socialMedia?.x || ''),
                    linkedIn: pickEditedValue(values.linkedIn, viewData.participant?.socialMedia?.linkedIn || ''),
                    otherPlatforms: values.otherPlatforms as PlatformLink[]
                },
                swot: {
                    strengths: values.swotStrengths === undefined ? viewData.participant?.swot?.strengths || [] : swot.strengths,
                    weaknesses: values.swotWeaknesses === undefined ? viewData.participant?.swot?.weaknesses || [] : swot.weaknesses,
                    opportunities: values.swotOpportunities === undefined ? viewData.participant?.swot?.opportunities || [] : swot.opportunities,
                    threats: values.swotThreats === undefined ? viewData.participant?.swot?.threats || [] : swot.threats
                },
                ...survivingSwotItems(viewData.participant),
                companyCode: String((user as any)?.companyCode || viewData.participant?.companyCode || '').trim() || null,
                programId: viewData.participant?.programId || viewData.application?.programId || viewData.programId || null,
                updatedAt: serverTimestamp()
            }

            const applicationUpdatePayload: AnyDoc = {
                participantName: pickEditedValue(values.participantName, viewData.application?.participantName || ''),
                businessName: pickEditedValue(values.businessName, viewData.application?.businessName || ''),
                email: pickEditedValue(values.email, viewData.application?.email || ''),
                gender: pickEditedValue(values.gender, viewData.application?.gender || ''),
                stage: values.stage === undefined ? viewData.application?.stage || '' : stageValue || '',
                province:
                    values.businessAddressProvince === undefined
                        ? viewData.application?.province || ''
                        : values.businessAddressProvince || '',
                hub: pickEditedValue(values.hub, viewData.application?.hub || ''),
                swot: {
                    strengths: values.swotStrengths === undefined ? viewData.application?.swot?.strengths || [] : swot.strengths,
                    weaknesses: values.swotWeaknesses === undefined ? viewData.application?.swot?.weaknesses || [] : swot.weaknesses,
                    opportunities: values.swotOpportunities === undefined ? viewData.application?.swot?.opportunities || [] : swot.opportunities,
                    threats: values.swotThreats === undefined ? viewData.application?.swot?.threats || [] : swot.threats
                },
                ...survivingSwotItems(viewData.application),
                updatedAt: serverTimestamp(),
                updatedBy
            }

            if (values.sector !== undefined) {
                applicationUpdatePayload.sector = values.sector || ''
            }

            if (values.sector) {
                applicationUpdatePayload.sector = values.sector
            }

            const batch = writeBatch(db)
            batch.update(doc(db, 'participants', viewData.participantId), participantUpdatePayload)
            batch.set(doc(db, 'applicantProfiles', applicantProfileId), applicantProfileUpdatePayload, { merge: true })
            batch.set(doc(db, 'businessProfiles', businessProfileId), businessProfileUpdatePayload, { merge: true })

            if (viewData.applicationId) {
                batch.update(doc(db, 'applications', viewData.applicationId), applicationUpdatePayload)
            }

            await batch.commit()

            await addDoc(collection(db, 'participantAuditTrail'), {
                participantId: viewData.participantId,
                applicationId: viewData.applicationId || null,
                companyCode: String((user as any)?.companyCode || '').trim(),
                programId: viewData.application?.programId || viewData.programId || null,
                programName: viewData.programName || viewData.application?.programName || null,
                actionType: 'profile_updated',
                changes: allChanges,
                createdAt: serverTimestamp(),
                createdBy: {
                    uid: (user as any)?.uid || null,
                    email: (user as any)?.email || null,
                    name: (user as any)?.name || (user as any)?.displayName || null,
                    role: (user as any)?.role || null
                }
            })

            message.success(t('SME details updated'))
            setEditMode(false)

            await openView({
                ...viewRecord!,
                participantName: values.participantName,
                businessName: values.businessName,
                email: values.email,
                sector: values.sector,
                stage: values.stage
            })

            await refreshList()
        } catch (error: any) {
            console.error(error)
            message.error(error?.message || t('Failed to update SME details'))
        } finally {
            setSavingEdit(false)
        }
    }

    const removeFromProgram = async () => {
        if (!viewData?.participantId || !viewData?.applicationId || !viewData?.application) {
            message.error(t('Program record not found'))
            return
        }

        const reason = String(removalReason || '').trim()
        if (!reason) {
            message.error(t('A reason for discontinuing is required'))
            return
        }

        setRemovingParticipant(true)

        try {
            const participant = viewData.participant || {}
            const application = viewData.application || {}
            const removalPayload = {
                participantId: viewData.participantId,
                applicationId: viewData.applicationId,
                companyCode: String((user as any)?.companyCode || '').trim(),
                programId: application.programId || viewData.programId || null,
                programName: viewData.programName || application.programName || null,
                participantName: participant.participantName || application.participantName || null,
                businessName: participant.businessName || application.businessName || null,
                email: participant.email || application.email || null,
                previousApplicationStatus: application.applicationStatus || null,
                reason,
                removedAt: serverTimestamp(),
                removedBy: {
                    uid: (user as any)?.uid || null,
                    email: (user as any)?.email || null,
                    name: (user as any)?.name || (user as any)?.displayName || null,
                    role: (user as any)?.role || null
                }
            }

            await addDoc(collection(db, 'participantProgramRemovals'), removalPayload)

            await updateDoc(doc(db, 'applications', viewData.applicationId), {
                applicationStatus: 'removed',
                removedFromProgram: true,
                discontinuedAt: new Date(),
                removedAt: serverTimestamp(),
                removedReason: reason,
                removedBy: {
                    uid: (user as any)?.uid || null,
                    email: (user as any)?.email || null,
                    name: (user as any)?.name || (user as any)?.displayName || null,
                    role: (user as any)?.role || null
                },
                updatedAt: serverTimestamp()
            })

            // Stamp the cut-off so current metrics stop counting this SME while past periods keep
            // showing them up to the day they were discontinued.
            const discontinuedAt = new Date()
            await updateDoc(doc(db, 'participants', viewData.participantId), {
                status: 'discontinued',
                discontinuedAt,
                discontinuedReason: reason,
                updatedAt: serverTimestamp()
            })
            const stampDiscontinued = async (collectionName: 'assignedInterventions' | 'appointments') => {
                const snap = await getDocs(query(collection(db, collectionName), where('participantId', '==', viewData.participantId)))
                for (let index = 0; index < snap.docs.length; index += 400) {
                    const batch = writeBatch(db)
                    snap.docs.slice(index, index + 400).forEach((row) => batch.update(row.ref, { participantDiscontinuedAt: discontinuedAt }))
                    await batch.commit()
                }
            }
            await stampDiscontinued('assignedInterventions')
            await stampDiscontinued('appointments')

            await addDoc(collection(db, 'participantAuditTrail'), {
                participantId: viewData.participantId,
                applicationId: viewData.applicationId,
                companyCode: String((user as any)?.companyCode || '').trim(),
                programId: application.programId || viewData.programId || null,
                programName: viewData.programName || application.programName || null,
                actionType: 'discontinued',
                reason,
                createdAt: serverTimestamp(),
                createdBy: {
                    uid: (user as any)?.uid || null,
                    email: (user as any)?.email || null,
                    name: (user as any)?.name || (user as any)?.displayName || null,
                    role: (user as any)?.role || null
                }
            })

            message.success(t('SME discontinued'))
            setRemoveModalOpen(false)
            setRemovalReason('')
            setViewOpen(false)
            setViewData(null)
            setViewRecord(null)
            await refreshList()
        } catch (error: any) {
            console.error(error)
            message.error(error?.message || t('Failed to discontinue SME'))
        } finally {
            setRemovingParticipant(false)
        }
    }

    const columns: ColumnsType<ParticipantRow> = useMemo(() => {
        const base: ColumnsType<ParticipantRow> = [
            {
                title: t('SME Name'),
                dataIndex: 'businessName',
                key: 'businessName',
                render: (v: any, record: ParticipantRow) => (
                    <Space size={10}>
                        <Avatar src={record.imageUrl} size={32}>{initialsOf(v || record.participantName)}</Avatar>
                        <Text strong>{labelOrHide(v) || ''}</Text>
                    </Space>
                )
            },
            ...(isAllPrograms
                ? [
                    {
                        title: t('Program'),
                        dataIndex: 'programName',
                        key: 'programName',
                        render: (v: any) => (
                            <Tag color="blue">{labelOrHide(v) || '—'}</Tag>
                        )
                    }
                ]
                : []),
            {
                title: t('Sector'),
                dataIndex: 'sector',
                key: 'sector',
                render: (v: any) => labelOrHide(v) || ''
            },
            {
                title: t('Stage'),
                dataIndex: 'stage',
                key: 'stage',
                render: (v: any) => labelOrHide(v) || ''
            },
            {
                title: t('Required'),
                key: 'required',
                render: (_: any, record: ParticipantRow) => record.interventions?.required?.length ?? 0
            },
            {
                title: t('Completed'),
                key: 'completed',
                render: (_: any, record: ParticipantRow) => record.interventions?.completed?.length ?? 0
            },
            {
                title: t('Progress'),
                key: 'progress',
                render: (_: any, record: ParticipantRow) => (
                    <Progress
                        percent={record.progress || 0}
                        size="small"
                        status={(record.progress || 0) === 100 ? 'success' : 'active'}
                    />
                )
            },
            {
                title: t('Actions'),
                key: 'actions',
                render: (_: any, record: ParticipantRow) => (
                    <Space size={8}>
                        <Button
                            icon={<EyeOutlined />}
                            onClick={() => openView(record)}
                        >
                            {t('View')}
                        </Button>

                        {!String(record.programId || '').trim() && (
                            <Button
                                icon={<DeploymentUnitOutlined />}
                                onClick={async () => {
                                    await openView(record)
                                    setAssignProgramOpen(true)
                                }}
                            >
                                {t('Assign Program')}
                            </Button>
                        )}

                        <Button
                            icon={<BarChartOutlined />}
                            onClick={() => navigate(`/operations/participants/control-tower/${record.id}`)}
                        >
                            {t('Control Tower')}
                        </Button>
                    </Space>
                )
            }
        ]

        return base
    }, [activeProgramId, isAllPrograms, navigate, user?.role, t])

    const currentParticipant = viewData?.participant || {}
    const livePlanItems = useMemo(
        () => (viewData ? (buildLivePlanItems(viewData.planItems as unknown as Array<{ title: string }>, viewData.assignments) as unknown as LivePlanItem[]) : []),
        [viewData]
    )
    const currentApplication = viewData?.application || {}
    const complianceDocs = Array.isArray(currentParticipant?.complianceDocuments)
        ? currentParticipant.complianceDocuments
        : []
    const complianceScore = complianceScoreOf(complianceDocs)
    const revenueHistory = currentParticipant?.revenueHistory || {}
    const headcountHistory = currentParticipant?.headcountHistory || {}

    const revenueMonthlyRows = mapHistoryObjectToRows(revenueHistory?.monthly || {})
    const revenueAnnualRows = mapHistoryObjectToRows(revenueHistory?.annual || {})
    const headcountMonthlyRows = mapHistoryObjectToRows(headcountHistory?.monthly || {})
    const headcountAnnualRows = mapHistoryObjectToRows(headcountHistory?.annual || {})

    const toTrend = (rows: Array<{ period: string; value: number | null }>): TrendRow[] =>
        rows.flatMap(row => (row.value === null ? [] : [{ period: row.period, value: row.value }]))

    const latestRevenue = revenueMonthlyRows.length ? revenueMonthlyRows[revenueMonthlyRows.length - 1] : null
    const latestHeadcount = headcountMonthlyRows.length ? headcountMonthlyRows[headcountMonthlyRows.length - 1] : null
    const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
    const complianceFigure = complianceScore ?? null
    const keyFigures: KeyFigure[] = [
        {
            key: 'revenue',
            label: t('Revenue'),
            prefix: 'R',
            value: latestRevenue ? Number(latestRevenue.value) : numberOrNull(currentParticipant?.revenue),
            hint: latestRevenue ? latestRevenue.period : undefined
        },
        {
            key: 'headcount',
            label: t('Employees'),
            value: latestHeadcount ? Number(latestHeadcount.value) : numberOrNull(currentParticipant?.employeeCount),
            hint: latestHeadcount ? latestHeadcount.period : undefined
        },
        {
            key: 'interventions',
            label: t('Interventions done'),
            value: livePlanItems.filter(item => item.status === 'Completed').length,
            suffix: ` / ${livePlanItems.length}`,
            tone: livePlanItems.length && livePlanItems.every(item => item.status === 'Completed') ? 'good' : 'default'
        },
        {
            key: 'compliance',
            label: t('Compliance'),
            value: complianceFigure,
            suffix: '%',
            tone: complianceFigure === null ? 'default' : complianceFigure >= 80 ? 'good' : complianceFigure >= 50 ? 'warn' : 'bad'
        }
    ]

    return (
        <DashboardPage className="operations-participants-page">
            <Row gutter={[12, 12]} className="operations-participants-metrics dashboard-metrics-row">
                <Col xs={12} lg={6}>
                    <DashboardMetricCard icon={<TeamOutlined />} loading={loading} label={t('Total SMEs')} value={metrics.totalParticipants} clickable active={quickFilter === 'all'} onClick={() => setQuickFilter('all')} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard icon={<PlusOutlined />} loading={loading} label={t('Required Interventions')} value={metrics.totalRequiredInterventions} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard icon={<CheckCircleOutlined />} loading={loading} label={t('Completed Interventions')} value={metrics.totalCompletedInterventions} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard icon={<WarningOutlined />} loading={loading} label={t('Need Assignment')} value={metrics.totalNeedingAssignment} clickable active={quickFilter === 'needs-assignment'} onClick={() => setQuickFilter('needs-assignment')} />
                </Col>
            </Row>

            <FilterBar
                primary={
                    <Input
                        prefix={<SearchOutlined />}
                        placeholder={
                            isAllPrograms
                                ? t('Search by SME name, program, sector, or email')
                                : t('Search by SME name, sector, or email')
                        }
                        value={searchText}
                        onChange={e => setSearchText(e.target.value)}
                        allowClear
                    />
                }
                actions={
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        disabled={isAllPrograms}
                        onClick={() =>
                            navigate('/operations/participants/new', {
                                state: { activeProgramId }
                            })
                        }
                    >
                        {t('Add SME')}
                    </Button>
                }
            />

            <Card className="operations-participants-card">
                <ResponsiveDataView
                    rows={filteredParticipants}
                    columns={columns}
                    rowKey={record => `${record.id}-${record.programId || 'na'}`}
                    loading={loading}
                    emptyText={t('No SMEs found')}
                    renderCard={record => (
                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            <Text strong>{record.businessName || t('Unnamed SME')}</Text>
                            <Text type="secondary">{record.email || t('No email')}</Text>
                            <Space wrap>
                                <Tag>{record.programName || t('Unassigned')}</Tag>
                                {record.stage ? <Tag>{record.stage}</Tag> : null}
                            </Space>
                            <Progress percent={record.progress || 0} size="small" />
                            <Space wrap>
                                <Button size="small" onClick={() => openView(record)}>{t('View')}</Button>
                                {!String(record.programId || '').trim() && (
                                    <Button
                                        size="small"
                                        icon={<DeploymentUnitOutlined />}
                                        onClick={async () => {
                                            await openView(record)
                                            setAssignProgramOpen(true)
                                        }}
                                    >
                                        {t('Assign Program')}
                                    </Button>
                                )}
                            </Space>
                        </Space>
                    )}
                />
            </Card>

            <DetailShell
                compact={isCompact}
                open={viewOpen}
                onClose={closeView}
                title={viewRecord ? (
                    <ParticipantHero
                        name={viewRecord.businessName || t('Unnamed SME')}
                        owner={viewRecord.participantName}
                        imageUrl={viewRecord.imageUrl}
                        progress={viewData ? livePlanProgress(livePlanItems) : undefined}
                        position={editMode ? undefined : { index: Math.max(viewIndex, 0), total: filteredParticipants.length }}
                        onPrevious={viewIndex > 0 ? () => stepView(-1) : undefined}
                        onNext={viewIndex >= 0 && viewIndex < filteredParticipants.length - 1 ? () => stepView(1) : undefined}
                        previousLabel={t('Previous SME')}
                        nextLabel={t('Next SME')}
                        tags={
                            <>
                                {viewRecord.stage ? <Tag color="purple">{viewRecord.stage}</Tag> : null}
                                {viewRecord.sector ? <Tag>{viewRecord.sector}</Tag> : null}
                                {isAllPrograms && viewRecord.programName ? <Tag color="blue">{viewRecord.programName}</Tag> : null}
                                {viewRecord.riskLevel ? <Tag color={riskColor(viewRecord.riskLevel)}>{`${viewRecord.riskLevel} ${t('risk')}`}</Tag> : null}
                            </>
                        }
                    />
                ) : t('SME Details')}
                footer={
                    <div className="pd-footer">
                        {editMode ? null : secondaryActions.length > 1 ? (
                            <Dropdown
                                trigger={['click']}
                                placement="topLeft"
                                menu={{ items: secondaryActions.map(action => ({ key: action.key, icon: action.icon, label: action.label, danger: action.danger, disabled: action.disabled, onClick: action.onClick })) }}
                            >
                                <Button icon={<EllipsisOutlined />}>{t('More')}</Button>
                            </Dropdown>
                        ) : secondaryActions.map(action => (
                            <Button key={action.key} danger={action.danger} icon={action.icon} disabled={action.disabled} onClick={action.onClick}>
                                {action.label}
                            </Button>
                        ))}
                        {editMode ? <Button onClick={cancelEdit}>{t('Cancel')}</Button> : null}
                        {!editMode ? (
                            <Button type="primary" icon={<EditOutlined />} disabled={!viewData} onClick={() => setEditMode(true)}>
                                {t('Edit')}
                            </Button>
                        ) : (
                            <Button type="primary" icon={<SaveOutlined />} loading={savingEdit} onClick={saveEdits}>
                                {t('Save Changes')}
                            </Button>
                        )}
                    </div>
                }
            >
                {viewLoading ? (
                    <ParticipantDrawerSkeleton />
                ) : !viewData ? (
                    <Alert type="warning" showIcon message={t('No record selected')} />
                ) : (
                    <div className="pd-body">
                        {!editMode ? (
                            <>
                                <SlidingTabs
                                    id="view"
                                    value={viewSegment}
                                    onChange={(value, direction) => {
                                        setTabDirection(direction)
                                        setViewSegment(value as typeof viewSegment)
                                    }}
                                    tabs={[
                                        { value: 'overview', icon: <InfoCircleOutlined />, label: t('Overview') },
                                        { value: 'business', icon: <ShopOutlined />, label: t('Business') },
                                        { value: 'swot', icon: <RadarChartOutlined />, label: t('SWOT') },
                                        { value: 'compliance', icon: <SafetyCertificateOutlined />, label: t('Compliance') },
                                        { value: 'interventions', icon: <DeploymentUnitOutlined />, label: t('Interventions') },
                                        { value: 'financials', icon: <BarChartOutlined />, label: t('Financials') }
                                    ]}
                                />

                                <TabPanel tabKey={viewSegment} direction={tabDirection}>
                                {viewSegment === 'overview' && (
                                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                                    <KeyFigures figures={keyFigures} />
                                    <Card size="small" title={t('Profile')}>
                                        <Descriptions layout="vertical" size="small" column={2} className="pd-fields">
                                            <Descriptions.Item label={t('Owner Name')}>
                                                {currentParticipant?.participantName || currentApplication?.participantName || '—'}
                                            </Descriptions.Item>
                                            <Descriptions.Item label={t('SME Name')}>
                                                {currentParticipant?.businessName || currentApplication?.businessName || '—'}
                                            </Descriptions.Item>

                                            {isAllPrograms && (
                                                <Descriptions.Item label={t('Program')}>
                                                    {viewData.programName || currentApplication?.programName || '—'}
                                                </Descriptions.Item>
                                            )}

                                            <Descriptions.Item label={t('Email')}>
                                                {currentParticipant?.email || currentApplication?.email || '—'}
                                            </Descriptions.Item>
                                            <Descriptions.Item label={t('Phone')}>{currentParticipant?.phone || '—'}</Descriptions.Item>
                                            <Descriptions.Item label={t('Gender')}>
                                                {currentParticipant?.gender || currentApplication?.gender || '—'}
                                            </Descriptions.Item>
                                            <Descriptions.Item label={t('ID Number')}>{currentParticipant?.idNumber || '—'}</Descriptions.Item>
                                            <Descriptions.Item label={t('B-BBEE Level')}>{currentParticipant?.beeLevel || '—'}</Descriptions.Item>
                                            <Descriptions.Item label={t('Youth-Owned %')}>{currentParticipant?.youthOwnedPercent ?? 0}%</Descriptions.Item>
                                            <Descriptions.Item label={t('Female-Owned %')}>{currentParticipant?.femaleOwnedPercent ?? 0}%</Descriptions.Item>
                                            <Descriptions.Item label={t('Black-Owned %')}>{currentParticipant?.blackOwnedPercent ?? 0}%</Descriptions.Item>
                                            <Descriptions.Item label={t('Date of Registration')}>
                                                {formatDateOnly(currentParticipant?.dateOfRegistration) || '—'}
                                            </Descriptions.Item>
                                            <Descriptions.Item label={t('Years of Trading')}>{currentParticipant?.yearsOfTrading ?? '—'}</Descriptions.Item>
                                            <Descriptions.Item label={t('Registration Number')}>{currentParticipant?.registrationNumber || '—'}</Descriptions.Item>
                                            <Descriptions.Item label={t('Age')}>{currentParticipant?.age ?? '—'}</Descriptions.Item>
                                            <Descriptions.Item label={t('Age Group')}>{currentParticipant?.ageGroup || '—'}</Descriptions.Item>
                                            <Descriptions.Item label={t('Sector')}>
                                                {currentParticipant?.sector || currentApplication?.sector || '—'}
                                            </Descriptions.Item>
                                            <Descriptions.Item label={t('Stage')}>
                                                {currentParticipant?.stage || currentApplication?.stage || '—'}
                                            </Descriptions.Item>
                                            <Descriptions.Item label={t('Development Type')}>{currentParticipant?.developmentType || '—'}</Descriptions.Item>
                                        </Descriptions>
                                    </Card>
                                    </Space>
                                )}

                                {viewSegment === 'business' && (
                                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                                        <Card size="small" title={t('Business & Location')}>
                                            <Descriptions layout="vertical" size="small" column={2} className="pd-fields">
                                                <Descriptions.Item label={t('Nature of Business')} span={2}>
                                                    {currentParticipant?.natureOfBusiness || '—'}
                                                </Descriptions.Item>
                                                <Descriptions.Item label={t('Business Address')} span={2}>
                                                    {currentParticipant?.businessAddress || '—'}
                                                </Descriptions.Item>
                                                <Descriptions.Item label={t('Province')}>
                                                    {currentParticipant?.businessAddressProvince || currentParticipant?.province || '—'}
                                                </Descriptions.Item>
                                                <Descriptions.Item label={t('City')}>
                                                    {currentParticipant?.businessAddressCity || currentParticipant?.city || '—'}
                                                </Descriptions.Item>
                                                <Descriptions.Item label={t('Location Type')}>{currentParticipant?.locationType || '—'}</Descriptions.Item>
                                                <Descriptions.Item label={t('Location')}>{currentParticipant?.location || '—'}</Descriptions.Item>
                                                <Descriptions.Item label={t('Postal Code')}>{currentParticipant?.postalCode || '—'}</Descriptions.Item>
                                                <Descriptions.Item label={t('Host Community')}>{currentParticipant?.hub || '—'}</Descriptions.Item>
                                            </Descriptions>
                                        </Card>

                                        <Card size="small" title={t('Digital Presence')}>
                                            <Descriptions layout="vertical" size="small" column={2} className="pd-fields">
                                                {DIGITAL_CHANNELS.map(channel => {
                                                    const link = channelLink(currentParticipant, channel.field)
                                                    return (
                                                        <Descriptions.Item key={channel.key} label={t(channel.label)}>
                                                            {link
                                                                ? link
                                                                : currentParticipant?.digitalPresence?.[channel.key] === false
                                                                    ? <Tag>{t('None')}</Tag>
                                                                    : <Text type="secondary">{t('Not answered')}</Text>}
                                                        </Descriptions.Item>
                                                    )
                                                })}
                                            </Descriptions>
                                        </Card>

                                    </Space>
                                )}

                                {viewSegment === 'swot' && (
                                    <SwotTab swot={currentParticipant?.swot} items={readSwotItems(currentApplication)} planItems={livePlanItems} />
                                )}

                                {viewSegment === 'compliance' && (
                                    <ComplianceOverview
                                        score={complianceScore}
                                        status={currentApplication?.complianceStatus || currentParticipant?.complianceStatus}
                                        risk={currentApplication?.riskLevel || currentParticipant?.riskLevel || currentParticipant?.risk || undefined}
                                        riskColor={riskColor(String(currentApplication?.riskLevel || currentParticipant?.riskLevel || currentParticipant?.risk || ''))}
                                        docs={complianceDocs}
                                    />
                                )}

                                {viewSegment === 'interventions' && (
                                    <InterventionsPanel items={livePlanItems} />
                                )}

                                {viewSegment === 'financials' && (
                                    <div className="pd-trends">
                                        <TrendCard
                                            title={t('Revenue')}
                                            prefix="R "
                                            color="#6d5dfb"
                                            monthly={toTrend(revenueMonthlyRows)}
                                            annual={toTrend(revenueAnnualRows)}
                                            empty={t('No revenue data')}
                                        />
                                        <TrendCard
                                            title={t('Headcount')}
                                            color="#13c2c2"
                                            monthly={toTrend(headcountMonthlyRows)}
                                            annual={toTrend(headcountAnnualRows)}
                                            empty={t('No headcount data')}
                                        />
                                    </div>
                                )}

                                </TabPanel>
                                {/* {viewSegment === 'audit' && (
                                    <Card
                                        size="small"
                                        title={
                                            <Space>
                                                <HistoryOutlined />
                                                <span>Recent Changes</span>
                                            </Space>
                                        }
                                    >
                                        {Array.isArray(viewData.auditTrail) && viewData.auditTrail.length ? (
                                            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                                {viewData.auditTrail.map((entry: any) => (
                                                    <Card
                                                        key={entry.id}
                                                        size="small"
                                                        style={{
                                                            borderRadius: 12,
                                                            border: '1px solid #e6f4ff',
                                                            background: '#fcfeff'
                                                        }}
                                                    >
                                                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                                            <Descriptions size="small" column={2} bordered>
                                                                <Descriptions.Item label="Action">
                                                                    <Tag color="blue">{String(entry.actionType || 'updated')}</Tag>
                                                                </Descriptions.Item>
                                                                <Descriptions.Item label="When">
                                                                    {formatDate(entry.createdAt) || '—'}
                                                                </Descriptions.Item>
                                                                <Descriptions.Item label="By" span={2}>
                                                                    {entry?.createdBy?.name || entry?.createdBy?.email || 'Unknown'}
                                                                </Descriptions.Item>
                                                            </Descriptions>

                                                            {entry.reason ? (
                                                                <Alert
                                                                    type="warning"
                                                                    showIcon
                                                                    message={`Reason: ${String(entry.reason)}`}
                                                                />
                                                            ) : null}

                                                            {Array.isArray(entry.changes) && entry.changes.length ? (
                                                                <Descriptions size="small" column={1} bordered>
                                                                    {entry.changes.map((change: any, idx: number) => (
                                                                        <Descriptions.Item
                                                                            key={`${entry.id}-${idx}`}
                                                                            label={change.label || change.field}
                                                                        >
                                                                            <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                                                                <Text type="secondary">
                                                                                    Previous: {renderAuditValue(change.before)}
                                                                                </Text>
                                                                                <Text strong style={{ color: '#1677ff' }}>
                                                                                    New: {renderAuditValue(change.after)}
                                                                                </Text>
                                                                            </Space>
                                                                        </Descriptions.Item>
                                                                    ))}
                                                                </Descriptions>
                                                            ) : (
                                                                <Alert type="info" showIcon message="No field changes recorded" />
                                                            )}
                                                        </Space>
                                                    </Card>
                                                ))}
                                            </Space>
                                        ) : (
                                            <Alert type="info" showIcon message="No audit trail yet" />
                                        )}
                                    </Card>
                                )} */}
                            </>
                        ) : (
                            <>
                                <Segmented
                                    block
                                    value={editSegment}
                                    onChange={(value) => setEditSegment(value as typeof editSegment)}
                                    options={[
                                        {
                                            label: (
                                                <Space size={8}>
                                                    <UserOutlined />
                                                    {t('Profile')}
                                                </Space>
                                            ),
                                            value: 'profile'
                                        },
                                        {
                                            label: (
                                                <Space size={8}>
                                                    <ShopOutlined />
                                                    {t('Business')}
                                                </Space>
                                            ),
                                            value: 'business'
                                        },
                                        {
                                            label: (
                                                <Space size={8}>
                                                    <GlobalOutlined />
                                                    {t('Digital')}
                                                </Space>
                                            ),
                                            value: 'digital'
                                        },
                                        {
                                            label: (
                                                <Space size={8}>
                                                    <RadarChartOutlined />
                                                    {t('SWOT')}
                                                </Space>
                                            ),
                                            value: 'swot'
                                        }
                                    ]}
                                />

                                <Form form={editForm} layout="vertical">
                                    <Card size="small" title={t('Edit SME Details')}>
                                        {editSegment === 'profile' && (
                                            <Row gutter={[16, 0]}>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="participantName" label={t('Owner Name')} rules={[{ required: true }]}>
                                                        <Input />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="businessName" label={t('SME Name')} rules={[{ required: true }]}>
                                                        <Input />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="email" label={t('Email')} rules={[{ required: true, type: 'email' }]}>
                                                        <Input />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="phone" label={t('Phone')}>
                                                        <Input />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="gender" label={t('Gender')}>
                                                        <Select allowClear>
                                                            <Option value="Male">{t('Male')}</Option>
                                                            <Option value="Female">{t('Female')}</Option>
                                                            <Option value="Other">{t('Other')}</Option>
                                                        </Select>
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="idNumber" label={t('ID Number')}>
                                                        <Input />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="beeLevel" label={t('B-BBEE Level')}>
                                                        <Input />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="dateOfRegistration" label={t('Date of Registration')}>
                                                        <DatePicker style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={8}>
                                                    <Form.Item name="youthOwnedPercent" label={t('Youth-Owned %')}>
                                                        <InputNumber min={0} max={100} style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={8}>
                                                    <Form.Item name="femaleOwnedPercent" label={t('Female-Owned %')}>
                                                        <InputNumber min={0} max={100} style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={8}>
                                                    <Form.Item name="blackOwnedPercent" label={t('Black-Owned %')}>
                                                        <InputNumber min={0} max={100} style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={8}>
                                                    <Form.Item name="yearsOfTrading" label={t('Years of Trading')}>
                                                        <InputNumber min={0} style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={8}>
                                                    <Form.Item name="age" label={t('Age')}>
                                                        <InputNumber min={0} style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="registrationNumber" label={t('Registration Number')}>
                                                        <Input />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="developmentType" label={t('Development Type')}>
                                                        <Select allowClear>
                                                            {developmentTypes.map(type => (
                                                                <Option key={type} value={type}>{type}</Option>
                                                            ))}
                                                        </Select>
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="sector" label={t('Sector')}>
                                                        <Select allowClear>
                                                            {sectors.map(s => (
                                                                <Option key={s} value={s}>{s}</Option>
                                                            ))}
                                                        </Select>
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="stage" label={t('Stage')}>
                                                        <Select allowClear>
                                                            {stages.map(s => (
                                                                <Option key={s} value={s}>{s}</Option>
                                                            ))}
                                                        </Select>
                                                    </Form.Item>
                                                </Col>
                                            </Row>
                                        )}

                                        {editSegment === 'business' && (
                                            <Row gutter={[16, 0]}>
                                                <Col xs={24}>
                                                    <Form.Item name="natureOfBusiness" label={t('Nature of Business')}>
                                                        <TextArea rows={3} />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24}>
                                                    <Form.Item name="businessAddress" label={t('Business Address')}>
                                                        <Input />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="businessAddressProvince" label={t('Province')}>
                                                        <Select allowClear>
                                                            {provinces.map(p => (
                                                                <Option key={p} value={p}>{p}</Option>
                                                            ))}
                                                        </Select>
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="businessAddressCity" label={t('City')}>
                                                        <Input />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="locationType" label={t('Location Type')}>
                                                        <Select allowClear>
                                                            <Option value="Urban">{t('Urban')}</Option>
                                                            <Option value="Township">{t('Township')}</Option>
                                                            <Option value="Rural">{t('Rural')}</Option>
                                                        </Select>
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="location" label={t('Location / Area Name')}>
                                                        <Input />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="postalCode" label={t('Postal Code')}>
                                                        <Input />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name="hub" label={t('Host Community')}>
                                                        <Input />
                                                    </Form.Item>
                                                </Col>
                                            </Row>
                                        )}

                                        {editSegment === 'digital' && (
                                            <div className="pd-channels">
                                                {DIGITAL_CHANNELS.map(channel => {
                                                    const presenceName = `presence_${channel.key}`
                                                    const isList = channel.field === 'otherPlatforms'
                                                    return (
                                                        <div key={channel.key} className="pd-channel">
                                                            <div className="pd-channel-head">
                                                                <div className="pd-channel-question">{t(channel.question)}</div>
                                                                <Form.Item name={presenceName} noStyle>
                                                                    <YesNoCards />
                                                                </Form.Item>
                                                            </div>
                                                            <div>
                                                                <Form.Item noStyle shouldUpdate={(previous, next) => previous[presenceName] !== next[presenceName]}>
                                                                    {({ getFieldValue }) => getFieldValue(presenceName) === 'yes' ? (
                                                                        <Form.Item
                                                                            name={channel.field}
                                                                            className="pd-channel-field"
                                                                            rules={[isList
                                                                                ? {
                                                                                    validator: (_, list: PlatformLink[] | undefined) =>
                                                                                        (list || []).some(row => String(row?.platform || '').trim() && String(row?.link || '').trim())
                                                                                            ? Promise.resolve()
                                                                                            : Promise.reject(new Error(t('Add at least one platform and its link')))
                                                                                }
                                                                                : { required: true, message: t('Enter the link') }]}
                                                                        >
                                                                            {isList ? <PlatformLinksInput /> : <Input placeholder={t(channel.placeholder)} />}
                                                                        </Form.Item>
                                                                    ) : null}
                                                                </Form.Item>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}

                                        {editSegment === 'swot' && (
                                            <Row gutter={[16, 0]}>
                                                {SWOT_FIELDS.map(field => (
                                                    <Col xs={24} md={12} key={field.name}>
                                                        <Form.Item
                                                            name={field.name}
                                                            className="pd-swot-field"
                                                            colon={false}
                                                            label={
                                                                <div className="pd-swot-field-label">
                                                                    <span>{t(field.label)}</span>
                                                                    <Button size="small" icon={<PlusOutlined />} onClick={() => addPoint(field.name)}>
                                                                        {t('Add point')}
                                                                    </Button>
                                                                </div>
                                                            }
                                                        >
                                                            <PointListInput tone={field.tone} placeholder={t('Add a point')} />
                                                        </Form.Item>
                                                    </Col>
                                                ))}
                                            </Row>
                                        )}

                                        {/* <Space>
                                            <Button shape="round" onClick={() => setEditMode(false)}>
                                                Cancel Edit
                                            </Button>
                                            <Button
                                                shape="round"
                                                type="primary"
                                                icon={<SaveOutlined />}
                                                loading={savingEdit}
                                                onClick={saveEdits}
                                            >
                                                Save Changes
                                            </Button>
                                        </Space> */}
                                    </Card>
                                </Form>
                            </>
                        )}
                    </div>
                )}
            </DetailShell>

            <Modal
                title={t('Assign Program')}
                open={assignProgramOpen}
                confirmLoading={assigningProgram}
                onCancel={() => {
                    setAssignProgramOpen(false)
                    setSelectedProgramId(undefined)
                }}
                onOk={assignProgramToParticipant}
                okText={t('Assign')}
            >
                <Alert
                    type="info"
                    showIcon
                    message={t('This is only available for SMEs that currently have no program.')}
                    style={{ marginBottom: 16 }}
                />

                <Text strong>{t('Select Program')}</Text>
                <Select
                    value={selectedProgramId}
                    onChange={setSelectedProgramId}
                    placeholder={t('Select program')}
                    style={{ width: '100%', marginTop: 8 }}
                    options={programOptions}
                    showSearch
                    optionFilterProp="label"
                />
            </Modal>

            <Modal
                title={t('Discontinue SME')}
                open={removeModalOpen}
                confirmLoading={removingParticipant}
                onCancel={() => {
                    setRemoveModalOpen(false)
                    setRemovalReason('')
                }}
                onOk={removeFromProgram}
                okText={t('Discontinue SME')}
                okButtonProps={{ danger: true, disabled: !removalReason.trim() }}
            >
                <Alert
                    type="error"
                    showIcon
                    message={t('This action is irreversible.')}
                    description={t('Once discontinued, this SME can only be reinstated by contacting an admin. Their metrics, interventions and appointments stop counting towards current progress, but stay visible in past periods up to today, and a permanent audit trail is saved.')}
                    style={{ marginBottom: 16 }}
                />
                <Text strong>{t('Reason')}</Text>
                <TextArea
                    rows={4}
                    value={removalReason}
                    onChange={e => setRemovalReason(e.target.value)}
                    placeholder={t('Enter the reason for discontinuing this SME')}
                    style={{ marginTop: 8 }}
                />
            </Modal>
        </DashboardPage>
    )
}

export default ParticipantsPage
