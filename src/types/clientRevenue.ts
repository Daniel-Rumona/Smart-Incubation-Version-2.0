/**
 * The client-module company's own income (awareness training and ESG reporting), recorded by its staff, and the
 * read-only summary its funder sees. Amounts are in rand.
 */

export type RevenueService = 'training' | 'esg_reporting' | 'other'

export type RevenueStatus = 'invoiced' | 'paid'

export type ClientRevenueEntry = {
    id: string
    companyCode: string
    /** Invoice date, `YYYY-MM-DD`. */
    date: string
    /** The client organisation billed. */
    organisation: string
    service: RevenueService
    /** The class or ESG report the income is for, when there is one. */
    classId?: string
    reportId?: string
    /** The funder this income counts for (trainingFunders); otherwise that of its class or report. */
    funderId?: string
    description: string
    amount: number
    status: RevenueStatus
    paidOn?: string
    createdAt?: string
    createdBy?: string
    updatedAt?: string
    updatedBy?: string
}

export type ClientRevenueValues = Omit<ClientRevenueEntry, 'id' | 'companyCode' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>

/** A funder of the company (trainingFunders). Classes, learners, ESG reports and income can be marked as funded by it. */
export type TrainingFunder = {
    id: string
    companyCode: string
    name: string
    contactName: string
    contactEmail: string
}

/** A funder's sign-in. */
export type TrainingFunderAccount = { uid: string, name: string, email: string, funderId: string }

/**
 * What the funder sees (Cloud Function getClientFunderSummary): totals only. No learner names, ID numbers or contact
 * details leave the company; client organisations are listed by name, as invoiced.
 */
export type ClientFunderSummary = {
    companyName: string
    /** The funder whose view this is; null for the whole company (staff only). */
    funderName: string | null
    generatedAt: string
    revenue: {
        last12Months: number
        thisYear: number
        paid: number
        outstanding: number
        byService: Record<RevenueService, number>
        /** The last 12 months, oldest first: `YYYY-MM`. */
        byMonth: Array<{ month: string, training: number, esgReporting: number, other: number }>
    }
    training: {
        classes: number
        classesFinished: number
        learners: number
        learnersCertified: number
        /** Certified learners of finished classes over the learners of finished classes. */
        passRatePct: number | null
        byMonth: Array<{ month: string, learners: number, classes: number }>
        /** Of the learners trained: gender, youth (under 35) and disability, as given or read from an SA ID number. */
        people: { female: number, male: number, genderUnknown: number, youth: number, ageUnknown: number, withDisability: number }
    }
    /** The businesses served that gave their details. */
    businesses: {
        withDetails: number
        baselineRevenue: number
        withBaselineRevenue: number
        employees: number
        /** Businesses that recorded monthly figures in the last 12 months: as a yearly rate, against their own baseline. */
        withLatestFigures: number
        latestRevenue: number
        revenueGrowthPct: number | null
        latestEmployees: number
        beeLevels: Array<{ level: string, count: number }>
    }
    esg: {
        reports: number
        final: number
        inProgress: number
        countries: string[]
        sectors: string[]
    }
    organisations: Array<{ name: string, learners: number, certified: number, esgReports: number, revenue: number }>
}
