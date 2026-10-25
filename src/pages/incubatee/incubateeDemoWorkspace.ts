import type { IncubateeIntervention, IncubateeWorkspace } from '@/types/incubatee'

/**
 * Fixture behind `?demo=1` on the incubatee dashboard. It exists so the layout can be
 * shown and reviewed without a seeded participant, so it deliberately covers every state
 * the page renders: interventions waiting on acceptance and on confirmation, forms that
 * are open and forms that are done, read and unread notifications.
 */

const daysFromNow = (days: number) => {
    const date = new Date()
    date.setDate(date.getDate() + days)
    return date
}

const intervention = (
    id: string,
    title: string,
    areaOfSupport: string,
    status: IncubateeIntervention['status'],
    progress: number,
    overrides: Partial<IncubateeIntervention> = {},
): IncubateeIntervention => ({
    id,
    interventionId: `int-${id}`,
    participantId: 'demo-participant',
    programId: 'demo-program',
    title,
    areaOfSupport,
    progress,
    status,
    resources: [],
    raw: {},
    ...overrides,
})

export const buildDemoIncubateeWorkspace = (): IncubateeWorkspace => ({
    participantId: 'demo-participant',
    applicationId: 'demo-application',
    programId: 'demo-program',
    programName: 'Township Enterprise Accelerator',
    businessName: 'Kasi Fresh Produce',
    growthPlanConfirmed: true,
    growthPlanAvailable: true,
    outstandingDocuments: 3,
    swotItems: [],
    requiredInterventions: [
        { id: 'req-1', title: 'Financial management fundamentals', areaOfSupport: 'Finance', executionMode: 'multi_step' },
        { id: 'req-2', title: 'Market access readiness', areaOfSupport: 'Market access', executionMode: 'single_session' },
    ],
    assignedInterventions: [
        intervention('demo-1', 'Cash flow forecasting workshop', 'Finance', 'Not Started', 0, {
            assigneeName: 'Nomsa Dlamini',
            dueDate: daysFromNow(5),
        }),
        intervention('demo-2', 'Retail compliance pack review', 'Compliance', 'Not Started', 0, {
            assigneeName: 'Sipho Ndlovu',
            dueDate: daysFromNow(9),
        }),
        intervention('demo-3', 'Supplier negotiation coaching', 'Market access', 'Awaiting Confirmation', 100, {
            assigneeName: 'Thandi Mokoena',
            dueDate: daysFromNow(-2),
        }),
        intervention('demo-4', 'Digital marketing sprint', 'Marketing', 'In Progress', 45, {
            assigneeName: 'Lerato Khumalo',
            dueDate: daysFromNow(14),
        }),
        intervention('demo-5', 'Business model canvas refresh', 'Strategy', 'Completed', 100, {
            assigneeName: 'Nomsa Dlamini',
            feedback: { rating: 5, comments: 'Very practical session.' },
        }),
    ],
    requests: [
        { id: 'demo-request-1', areaOfSupport: 'Operations', interventionTitle: 'Stock management system setup', reason: 'Losing stock to spoilage each month.', status: 'Pending' },
    ],
    forms: [
        { id: 'demo-form-1', kind: 'survey', title: 'Quarterly growth survey', status: 'assigned', dueAt: daysFromNow(4) },
        { id: 'demo-form-2', kind: 'assessment', title: 'Financial readiness assessment', status: 'in progress', dueAt: daysFromNow(11) },
        { id: 'demo-form-3', kind: 'survey', title: 'Programme onboarding survey', status: 'submitted', updatedAt: daysFromNow(-12) },
        { id: 'demo-form-4', kind: 'assessment', title: 'Baseline business assessment', status: 'completed', updatedAt: daysFromNow(-30) },
    ],
    notifications: [
        { id: 'demo-note-1', type: 'compliance_alert', title: 'Tax clearance certificate expires in 7 days', createdAt: daysFromNow(0), read: false },
        { id: 'demo-note-2', type: 'intervention_assigned', title: 'New intervention assigned: Cash flow forecasting workshop', createdAt: daysFromNow(-1), read: false },
        { id: 'demo-note-3', type: 'form_assigned', title: 'Quarterly growth survey is now open', createdAt: daysFromNow(-3), read: true },
        { id: 'demo-note-4', type: 'growth_plan', title: 'Your growth plan was confirmed', createdAt: daysFromNow(-9), read: true },
    ],
})

export type OutstandingDocument = {
    id: string
    title: string
    status: string
    fileName?: string
    expiryDate?: string
}

/** Matches `outstandingDocuments: 3` above, so the metric and its modal agree. */
export const buildDemoOutstandingDocuments = (): OutstandingDocument[] => [
    { id: 'demo-doc-1', title: 'Tax Clearance Certificate', status: 'expired', fileName: 'tax-clearance-2024.pdf', expiryDate: '2025-08-31' },
    { id: 'demo-doc-2', title: 'B-BBEE Certificate', status: 'missing' },
    { id: 'demo-doc-3', title: 'Proof of Business Address', status: 'pending review', fileName: 'lease-agreement.pdf' },
]
