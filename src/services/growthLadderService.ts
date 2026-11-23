import dayjs from 'dayjs'
import { addDoc, collection, deleteField, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { getDocsInScope, loadDataScope } from '@/services/funderScopeService'
import { monthToDate } from '@/services/smeMetricsService'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import {
    evaluateLadder, ladderHistory, quartersOnStep, stepsGained, TOP_RUNG,
    type LadderInput, type LadderPoint, type LadderResult,
} from '@/services/growthLadder'
import type { FullIdentity } from '@/types/identity'

type AnyDoc = Record<string, unknown>

/**
 * Where an SME stands in the programme:
 * - active: still in, and sent monthly figures in the last 3 completed months;
 * - quiet: still in, but no monthly figures in that time;
 * - graduated: marked as graduated by operations;
 * - removed: discontinued (taken off the programme).
 */
export type LadderStatus = 'active' | 'quiet' | 'graduated' | 'removed'

export type LadderSme = {
    id: string
    name: string
    programId: string
    programName: string
    /** The programme's cohort year, or the year the SME joined when the programme has none. */
    cohort: string
    joinedAt: string
    status: LadderStatus
    graduatedAt: string | null
    graduationNote: string | null
    current: LadderResult
    history: LadderPoint[]
    stepsGained: number
    quartersOnStep: number
    /** Below the top step and on the same step for three quarters or more, while still in the programme. */
    stuck: boolean
    /** The newest month with figures (YYYY-MM), when there is one. */
    lastReportMonth: string | null
    /** Opportunities couldn't be read (the In the market and Winning work steps then show as not met). */
    opportunitiesUnavailable: boolean
}

export const STUCK_QUARTERS = 3

const text = (value: unknown, fallback = '') => (typeof value === 'string' && value.trim() ? value.trim() : fallback)
const number = (value: unknown) => {
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
}
const isoDate = (value: unknown): string | null => {
    if (!value) return null
    if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') return dayjs((value as { toDate: () => Date }).toDate()).format('YYYY-MM-DD')
    if (typeof value === 'object' && value && 'seconds' in value) return dayjs(Number((value as { seconds: number }).seconds) * 1000).format('YYYY-MM-DD')
    const parsed = dayjs(value as string)
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null
}

const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size))

/** One SME's monthly figures and opportunities, in the shape the ladder reads. */
const loadLadderInput = async (participantId: string): Promise<LadderInput & { opportunitiesUnavailable: boolean }> => {
    const db = getFirebaseDb()
    const [history, opportunities] = await Promise.all([
        getDocs(collection(db, 'monthlyPerformance', participantId, 'history')).then(snapshot => snapshot.docs).catch(() => []),
        getDocs(collection(db, 'smeOpportunities', participantId, 'items')).then(snapshot => snapshot.docs).catch(() => null),
    ])
    const months = history.flatMap((row) => {
        const data = row.data() as AnyDoc
        const date = monthToDate(text(data.month, row.id))
        if (!date) return []
        const permanent = number(data.headPermanent)
        const temporary = number(data.headTemporary)
        return [{
            month: date.format('YYYY-MM'),
            revenue: number(data.revenue) ?? null,
            jobs: permanent === undefined && temporary === undefined ? null : (permanent || 0) + (temporary || 0),
        }]
    })
    return {
        months,
        opportunities: (opportunities || []).map((row) => {
            const data = row.data() as AnyDoc
            return { stage: text(data.stage), submittedAt: text(data.submittedAt) || null }
        }),
        opportunitiesUnavailable: opportunities === null,
    }
}

/** Every SME in the user's scope (removed and graduated ones too, for the cohort table), with its ladder. */
export const listGrowthLadder = async (user: FullIdentity, activeProgramId?: string | null): Promise<LadderSme[]> => {
    const scope = await loadDataScope(user)
    if (!scope.length) return []
    const db = getFirebaseDb()
    const [participantDocs, programSnaps] = await Promise.all([
        getDocsInScope(scope, 'participants'),
        Promise.all(scope.map(entry => getDocs(query(collection(db, 'programs'), where('companyCode', '==', entry.companyCode))))),
    ])
    const programs = new Map(programSnaps.flatMap(snapshot => snapshot.docs).map((row) => {
        const data = row.data() as AnyDoc
        return [row.id, { name: text(data.name, text(data.programName, row.id)), cohortYear: text(String(data.cohortYear ?? '')) }]
    }))

    const participants = participantDocs
        .map(row => ({ id: row.id, ...(row.data() as AnyDoc) }) as { id: string } & AnyDoc)
        .filter(row => matchesActiveProgram(user, activeProgramId || 'all', text(row.programId)))

    const today = dayjs().format('YYYY-MM-DD')
    const quietBefore = dayjs().subtract(3, 'month').format('YYYY-MM')
    const rows: LadderSme[] = []
    // A few SMEs at a time, rather than every history read at once.
    for (const batch of chunks(participants, 6)) {
        rows.push(...await Promise.all(batch.map(async (participant) => {
            const input = await loadLadderInput(participant.id)
            const programId = text(participant.programId)
            const program = programs.get(programId)
            const joinedAt = isoDate(participant.acceptedAt) || isoDate(participant.createdAt) || today
            const graduatedAt = isoDate(participant.graduatedAt)
            const removedAt = isoDate(participant.discontinuedAt) || (['discontinued', 'removed'].includes(text(participant.status).toLowerCase()) ? isoDate(participant.updatedAt) || today : null)
            const lastReportMonth = input.months.map(row => row.month).sort().at(-1) || null
            const status: LadderStatus = removedAt ? 'removed' : graduatedAt ? 'graduated' : lastReportMonth && lastReportMonth >= quietBefore ? 'active' : 'quiet'
            // The ladder stops when the SME leaves: its last step is the one it left on.
            const until = removedAt || graduatedAt || today
            const history = ladderHistory(input, joinedAt, until)
            const onStep = quartersOnStep(history)
            const current = evaluateLadder(input, until)
            return {
                id: participant.id,
                name: text(participant.businessName, text(participant.participantName, 'Unnamed SME')),
                programId,
                programName: program?.name || text(participant.programName, 'Unassigned'),
                cohort: program?.cohortYear || joinedAt.slice(0, 4),
                joinedAt,
                status,
                graduatedAt,
                graduationNote: text(participant.graduationNote) || null,
                current,
                history,
                stepsGained: stepsGained(history),
                quartersOnStep: onStep,
                stuck: (status === 'active' || status === 'quiet') && current.rung < TOP_RUNG && onStep >= STUCK_QUARTERS,
                lastReportMonth,
                opportunitiesUnavailable: input.opportunitiesUnavailable,
            }
        })))
    }
    return rows.sort((left, right) => right.current.rung - left.current.rung || left.name.localeCompare(right.name))
}

export type CohortSurvival = { cohort: string, programName: string, counted: number, active: number, quiet: number, graduated: number, removed: number, activeShare: number }

/** Lex-style survival table: per programme cohort, how many are still going, gone quiet, graduated or removed. */
export const cohortSurvival = (rows: LadderSme[]): CohortSurvival[] => {
    const groups = new Map<string, LadderSme[]>()
    rows.forEach(row => {
        const key = JSON.stringify([row.programName, row.cohort])
        groups.set(key, [...(groups.get(key) || []), row])
    })
    return [...groups.entries()].map(([key, smes]) => {
        const [programName, cohort] = JSON.parse(key) as [string, string]
        const count = (status: LadderStatus) => smes.filter(row => row.status === status).length
        const active = count('active')
        return { cohort, programName, counted: smes.length, active, quiet: count('quiet'), graduated: count('graduated'), removed: count('removed'), activeShare: smes.length ? Math.round((active / smes.length) * 100) : 0 }
    }).sort((left, right) => left.programName.localeCompare(right.programName) || left.cohort.localeCompare(right.cohort))
}

/** Operations marks an SME as graduated: it has completed the programme (the positive exit, next to removal). */
export const markGraduated = async (user: FullIdentity, sme: LadderSme, note: string) => {
    const db = getFirebaseDb()
    await updateDoc(doc(db, 'participants', sme.id), {
        graduatedAt: serverTimestamp(),
        graduationNote: note.trim() || null,
        graduationStep: sme.current.rung,
        graduatedBy: { uid: user.uid, name: user.displayName || user.email || null },
        updatedAt: serverTimestamp(),
    })
    await addDoc(collection(db, 'participantAuditTrail'), {
        participantId: sme.id,
        companyCode: user.companyCode || null,
        action: 'graduated',
        note: note.trim() || null,
        ladderStep: sme.current.rung,
        actorUid: user.uid,
        actorName: user.displayName || user.email || null,
        createdAt: serverTimestamp(),
    }).catch(() => undefined)
}

/** Takes a graduation back (marked by mistake). */
export const undoGraduation = async (user: FullIdentity, sme: LadderSme) => {
    const db = getFirebaseDb()
    await updateDoc(doc(db, 'participants', sme.id), {
        graduatedAt: deleteField(),
        graduationNote: deleteField(),
        graduationStep: deleteField(),
        graduatedBy: deleteField(),
        updatedAt: serverTimestamp(),
    })
    await addDoc(collection(db, 'participantAuditTrail'), {
        participantId: sme.id,
        companyCode: user.companyCode || null,
        action: 'graduation_undone',
        actorUid: user.uid,
        actorName: user.displayName || user.email || null,
        createdAt: serverTimestamp(),
    }).catch(() => undefined)
}
