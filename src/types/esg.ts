/**
 * ESG reporting (client module, see config/clientModules.ts): one report per client organisation and reporting
 * period. The four registers follow the facilitator's own ESG toolkit workbook (ESG Data Register, ESG Risk Register,
 * Stakeholder Map, 90 Day Action Plan) column for column, so her sheets import as they are. Values are kept as typed
 * ("12 500", "n/a"); dates as `YYYY-MM-DD`, audit times as ISO strings.
 */

export type EsgPillar = 'E' | 'S' | 'G'

export type EsgIndicator = {
    id: string
    pillar: EsgPillar
    indicator: string
    unit: string
    baseline: string
    current: string
    target: string
    period: string
    owner: string
    evidence: string
    qualityCheck: string
    /** The GRI disclosure the figure reports against (e.g. '302-1'), suggested from the indicator name. */
    disclosure: string
}

export type EsgRisk = {
    id: string
    pillar: EsgPillar
    risk: string
    stakeholders: string
    /** 1-5 */
    likelihood: number | null
    /** 1-5 */
    impact: number | null
    mitigation: string
    owner: string
    reviewDate: string
    status: string
}

export type EsgStakeholder = {
    id: string
    stakeholder: string
    concern: string
    /** 1-5 */
    influence: number | null
    /** 1-5 */
    impact: number | null
    engagement: string
    owner: string
    nextReview: string
}

export type EsgAction = {
    id: string
    pillar: EsgPillar
    action: string
    baseline: string
    target: string
    kpi: string
    owner: string
    startDate: string
    dueDate: string
    budget: string
    evidence: string
    status: string
}

export type EsgRegisterKey = 'indicators' | 'risks' | 'stakeholders' | 'actions'

/** GHG Protocol scopes: 1 direct (fuel burnt), 2 purchased electricity, 3 the rest of the value chain. */
export type EsgScope = 1 | 2 | 3

/**
 * One line of the carbon footprint: an activity recorded month by month and the factor that turns it into emissions.
 * The factor and its source are saved on the line (not looked up later), so a past report stays as calculated.
 */
export type EsgEmissionSource = {
    id: string
    /** A key of EMISSION_SOURCES (config/esgEmissions.ts), or 'custom'. */
    kind: string
    scope: EsgScope
    label: string
    unit: string
    /** kg CO2e per unit; null until entered (e.g. the grid factor outside South Africa). */
    factor: number | null
    factorSource: string
    /** Counts towards the South African carbon tax estimate: Scope 1 fuels other than petrol and diesel. */
    taxable: boolean
    /** The twelve months from the start of the reporting period; null where nothing was recorded. */
    monthly: Array<number | null>
}

/** Whether the client pays carbon tax directly (runs activities listed in the Carbon Tax Act above the thresholds). */
export type EsgCarbonTaxPayer = 'no' | 'yes' | 'unsure'

export type EsgFootprint = {
    sources: EsgEmissionSource[]
    carbonTaxPayer: EsgCarbonTaxPayer
    /** The tax-free allowances the client claims, as a percentage (60 basic for fuel combustion, at most 95). */
    allowancePct: number
}

/** How the report's figures were checked (GRI 2-5). */
export type EsgAssurance = 'none' | 'internal' | 'limited' | 'reasonable'

export type EsgReportStatus = 'draft' | 'in_review' | 'final'

/** "With reference to" the GRI Standards, or the stricter "in accordance with" (every GRI 2 disclosure and the index). */
export type EsgClaim = 'with_reference' | 'in_accordance'

/** A drafted section of the written report. AI drafts may only use the report's own figures. */
export type EsgNarrativeSection = {
    key: string
    title: string
    text: string
    draftedAt?: string
    /** Figures in the text that are not in the report's data: shown until checked or edited. */
    unmatchedFigures?: string[]
}

export type EsgReport = {
    id: string
    companyCode: string
    /** The client organisation the report is for. */
    clientName: string
    /** A key of ESG_SECTORS (config/esgStandards.ts). */
    sector: string
    /** ISO 3166 alpha-2. */
    country: string
    periodStart: string
    periodEnd: string
    /** When the report will be published: decides which GRI Standards are in effect. */
    publicationDate: string
    claim: EsgClaim
    /** Ids of the regional and national frameworks applied (ESG_FRAMEWORKS). */
    frameworks: string[]
    /** Any other framework or rule the client reports under, as text. */
    otherFrameworks: string
    /** The funder of the report (trainingFunders), whose funder report counts it. */
    funderId?: string
    /** The client's record (trainingOrganisations) when the client is a registered company: it sees the report once it is in review or final. */
    organisationId?: string
    status: EsgReportStatus
    indicators: EsgIndicator[]
    risks: EsgRisk[]
    stakeholders: EsgStakeholder[]
    actions: EsgAction[]
    narrative: EsgNarrativeSection[]
    /** Scope 1, 2 and 3 emissions from the client's activity data. */
    footprint: EsgFootprint
    /** Who approved the report for the client (GRI 2-14): name, role and date (`YYYY-MM-DD`). */
    approvedBy: string
    approverRole: string
    approvedOn: string
    assurance: EsgAssurance
    /** Who reviewed or assured the figures, when anyone did. */
    assuranceProvider: string
    createdAt?: string
    createdBy?: string
    updatedAt?: string
    updatedBy?: string
}

export type EsgReportValues = Pick<EsgReport, 'clientName' | 'sector' | 'country' | 'periodStart' | 'periodEnd' | 'publicationDate' | 'claim' | 'frameworks' | 'otherFrameworks' | 'approvedBy' | 'approverRole' | 'approvedOn' | 'assurance' | 'assuranceProvider'> & Partial<Pick<EsgReport, 'funderId'>>
