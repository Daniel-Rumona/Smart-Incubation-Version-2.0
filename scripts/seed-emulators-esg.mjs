// ESG reporting, revenue and the funder for the awareness training company in the local emulators (used by
// seed-emulators.mjs). Two client reports in the shape of the facilitator's ESG toolkit workbook: a South African
// mining client (GRI 14, JSE guidance, King IV) and a Turkish retailer (no GRI sector standard, TSRS); six months of
// income from trainings and ESG reports; and a funder who signs in to the read-only funder report. Fixed ids, so
// re-running restores the same records without touching anything else.

let counter = 0
const id = (prefix) => `${prefix}-${String(++counter).padStart(3, '0')}`

const indicator = (pillar, name, unit, baseline, current, target, period, owner, evidence, disclosure) => ({
    id: id('ind'), pillar, indicator: name, unit, baseline, current, target, period, owner, evidence, qualityCheck: 'Checked against source records', disclosure,
})
const risk = (pillar, name, stakeholders, likelihood, impact, mitigation, owner, reviewDate, status) => ({
    id: id('risk'), pillar, risk: name, stakeholders, likelihood, impact, mitigation, owner, reviewDate, status,
})
const stakeholder = (name, concern, influence, impact, engagement, owner, nextReview) => ({
    id: id('stk'), stakeholder: name, concern, influence, impact, engagement, owner, nextReview,
})
const action = (pillar, name, baseline, target, kpi, owner, startDate, dueDate, budget, evidence, status) => ({
    id: id('act'), pillar, action: name, baseline, target, kpi, owner, startDate, dueDate, budget, evidence, status,
})

const DESNZ = 'UK DESNZ greenhouse gas conversion factors 2025'
const GAZETTE_2024 = 'Government Gazette 55353, 11 September 2026'
const ELECTRICITY = [94600, 92400, 90200, 88000, 89100, 91300, 92400, 93500, 94600, 92400, 90200, 91300]
const source = (kind, scope, label, unit, factor, factorSource, taxable, monthly) => ({
    id: id('src'), kind, scope, label, unit, factor, factorSource, taxable, monthly,
})

export const ESG_REPORT_IDS = { kgalagadi: 'tns-esg-kgalagadi-fy2026', anatolia: 'tns-esg-anatolia-2025' }

/** Writes the records; `seedPerson` creates the funder's sign-in. Returns the sign-ins and how many records were written. */
export const seedEsgAndRevenue = async ({ db, seedPerson, signature, day, companyCode, companyName, keletsoUid, classIds }) => {
    const now = new Date().toISOString()
    const batch = db.batch()
    let records = 0
    const put = (path, data) => {
        batch.set(db.doc(path), data)
        records += 1
    }

    batch.set(db.doc(`companies/${companyCode}`), { esgReportingEnabled: true }, { merge: true })

    put(`esgReports/${ESG_REPORT_IDS.kgalagadi}`, {
        companyCode, clientName: 'Kgalagadi Mining (Pty) Ltd', sector: 'mining', country: 'ZA',
        periodStart: '2025-03-01', periodEnd: '2026-02-28', publicationDate: '2026-06-30', claim: 'with_reference',
        frameworks: ['jse', 'king'], otherFrameworks: 'Social and Labour Plan (Mineral and Petroleum Resources Development Act)', status: 'in_review',
        indicators: [
            indicator('E', 'Electricity consumption', 'kWh', '1 250 000', '1 100 000', '1 000 000', 'Monthly', 'Plant engineer', 'Utility invoices', '302-1'),
            indicator('E', 'Diesel consumption', 'litres', '410 000', '395 000', '360 000', 'Monthly', 'Plant engineer', 'Fuel logbook', '302-1'),
            indicator('E', 'Scope 1 emissions', 'tCO2e', '1 180', '1 104.22', '1 000', 'Annual', 'SHE manager', 'Fuel records with national emission factors', '305-1'),
            indicator('E', 'Scope 2 emissions', 'tCO2e', '1 162', '1 056', '950', 'Annual', 'SHE manager', 'Electricity use with the grid emission factor', '305-2'),
            { ...indicator('E', 'Scope 3 GHG emissions (value chain)', 'tCO2e', '', '149.01', '', 'Reporting period', 'SHE manager', 'Carbon footprint: activity data x emission factors (see Climate change and energy)', '305-3'), id: 'footprint-scope-3' },
            indicator('E', 'Water consumption', 'kL', '85 000', '79 500', '75 000', 'Monthly', 'Plant engineer', 'Meter readings', '303-5'),
            indicator('E', 'Waste to landfill', 'kg', '42 000', '38 500', '30 000', 'Monthly', 'SHE manager', 'Waste contractor notes', '306-5'),
            indicator('S', 'Safety training completion', '%', '62', '88', '100', 'Quarterly', 'SHE manager', 'Training register', '403-5'),
            indicator('S', 'Lost time injury frequency rate', 'LTIFR', '0.62', '0.41', '0.30', 'Quarterly', 'SHE manager', 'SHE incident register', '403-9'),
            indicator('S', 'Women in the workforce', '%', '18', '21', '25', 'Annual', 'HR manager', 'Payroll', '405-1'),
            indicator('S', 'Spend on local suppliers', '%', '34', '41', '50', 'Annual', 'Procurement lead', 'Procurement system', '204-1'),
            indicator('S', 'Community investment', 'ZAR', '1 200 000', '1 450 000', '1 500 000', 'Annual', 'Community liaison', 'Social and Labour Plan report', '413-1'),
            indicator('G', 'Conflicts disclosed', 'count', '3', '5', '', 'Quarterly', 'Company secretary', 'Conflict register', '2-15'),
            indicator('G', 'Anti-corruption training completion', '%', '40', '72', '100', 'Annual', 'Company secretary', 'Training register', '205-2'),
        ],
        risks: [
            risk('E', 'Unplanned energy interruption', 'Staff/customers', 4, 4, 'Backup and efficiency plan', 'Plant engineer', '2026-08-31', 'Open'),
            risk('S', 'Inadequate induction', 'Workers', 3, 5, 'Training and induction register', 'SHE manager', '2026-08-31', 'Open'),
            risk('G', 'Undisclosed supplier conflict', 'Customers/owners', 2, 4, 'Conflict policy and disclosure', 'Company secretary', '2026-09-30', 'Open'),
            risk('E', 'Water scarcity in the catchment', 'Local communities', 3, 4, 'Water recycling at the plant', 'Plant engineer', '2026-09-30', 'Monitoring'),
            risk('S', 'Community concern over local jobs', 'Local communities', 3, 5, 'Local hiring targets and a quarterly community forum', 'HR manager', '2026-09-30', 'Open'),
        ],
        stakeholders: [
            stakeholder('Employees', 'Safety and fair treatment', 4, 5, 'Toolbox talk', 'SHE manager', '2026-09-30'),
            stakeholder('Customers', 'Reliable ESG evidence', 5, 4, 'Questionnaire', 'Commercial manager', '2026-12-31'),
            stakeholder('Local communities', 'Jobs, water and dust', 4, 5, 'Quarterly community forum', 'Community liaison', '2026-09-30'),
            stakeholder('Mining regulator', 'Social and Labour Plan commitments', 5, 3, 'Annual Social and Labour Plan report', 'Company secretary', '2027-03-31'),
        ],
        actions: [
            action('E', 'Collect monthly utility data', 'No consistent records', 'Three months of records', 'Records collected', 'Plant engineer', '2026-03-01', '2026-05-31', '15 000', 'Utility invoices', 'In progress'),
            action('S', 'Refresh safety induction', '62% inducted', '100% staff induction', 'Completion %', 'SHE manager', '2026-03-01', '2026-06-30', '40 000', 'Training register', 'In progress'),
            action('G', 'Introduce conflict register', 'No register', 'All relevant staff briefed', 'Briefing %', 'Company secretary', '2026-03-15', '2026-04-30', '5 000', 'Signed declarations', 'Done'),
            action('E', 'Install solar at the workshop', 'Grid only', '250 kWp installed', 'kWp installed', 'Plant engineer', '2026-06-01', '2026-12-31', '2 400 000', 'Contractor sign-off', 'Not started'),
        ],
        // Mar 2025 - Feb 2026, factors as config/esgEmissions.ts gives them for a South African 2025 period:
        // Scope 1 1 104.22 t, Scope 2 1 056 t, Scope 3 149.01 t (the figures above).
        footprint: {
            carbonTaxPayer: 'no',
            allowancePct: 60,
            sources: [
                source('vehicle_diesel', 1, 'Company vehicles: diesel', 'litres', 2.66155, `${DESNZ}: Diesel (100% mineral diesel), per litre`, false, [33970, 33180, 32390, 31600, 31995, 32785, 33180, 33575, 33970, 33180, 32390, 32785]),
                source('lpg_kg', 1, 'LPG (gas bottles, forklifts, kitchens)', 'kg', 2.93936, `${DESNZ}: LPG, 2 939.36 kg CO2e per tonne, per kg`, true, Array(12).fill(1500)),
                source('electricity', 2, 'Electricity from the grid', 'kWh', 0.96, `DFFE national generation grid emission factor 2024 (${GAZETTE_2024})`, false, ELECTRICITY),
                source('grid_losses', 3, 'Electricity grid losses', 'kWh', 0.092, `DFFE transmission and distribution loss grid emission factors 2024 (${GAZETTE_2024})`, false, ELECTRICITY),
                source('car_km', 3, 'Business travel and commuting by car', 'km', 0.16725, `${DESNZ}: Average car, unknown fuel, per km`, false, Array(12).fill(20000)),
                source('flights_short', 3, 'Flights under 3 700 km (domestic and regional)', 'passenger km', 0.12786, `${DESNZ}: Short-haul flight, average passenger, with radiative forcing, per passenger km`, false, Array(12).fill(5000)),
            ],
        },
        approvedBy: '', approverRole: '', approvedOn: '', assurance: 'internal', assuranceProvider: 'Kgalagadi Mining SHE department',
        narrative: [],
        createdAt: now, createdBy: keletsoUid, updatedAt: now, updatedBy: keletsoUid,
    })

    put(`esgReports/${ESG_REPORT_IDS.anatolia}`, {
        companyCode, clientName: 'Anatolia Retail A.Ş.', sector: 'retail', country: 'TR',
        periodStart: '2025-01-01', periodEnd: '2025-12-31', publicationDate: '2026-05-31', claim: 'with_reference',
        frameworks: ['tsrs'], otherFrameworks: '', status: 'draft',
        indicators: [
            indicator('E', 'Electricity consumption', 'MWh', '4 800', '4 650', '4 400', 'Monthly', 'Facilities manager', 'Utility invoices', '302-1'),
            indicator('E', 'Scope 2 emissions', 'tCO2e', '2 160', '2 090', '1 950', 'Annual', 'Sustainability lead', 'Electricity use with the grid emission factor', '305-2'),
            indicator('E', 'Packaging materials', 'tonnes', '320', '300', '280', 'Annual', 'Operations manager', 'Supplier invoices', '301-1'),
            indicator('S', 'Employees', 'headcount', '1 240', '1 310', '', 'Annual', 'HR manager', 'Payroll', '2-7'),
            indicator('S', 'Women in management', '%', '31', '34', '40', 'Annual', 'HR manager', 'HR system', '405-1'),
            indicator('S', 'Data breaches', 'count', '0', '0', '0', 'Annual', 'IT manager', 'Incident log', '418-1'),
        ],
        risks: [
            risk('E', 'Rising energy costs at stores', 'Customers/owners', 4, 3, 'Store energy audits', 'Facilities manager', '2026-06-30', 'Open'),
            risk('S', 'Customer data breach', 'Customers', 2, 5, 'Data protection training and access controls', 'IT manager', '2026-06-30', 'Open'),
        ],
        stakeholders: [
            stakeholder('Customers', 'Data privacy and product packaging', 5, 4, 'Customer survey', 'Marketing manager', '2026-12-31'),
            stakeholder('Employees', 'Career growth', 3, 4, 'Annual engagement survey', 'HR manager', '2026-12-31'),
        ],
        actions: [
            action('E', 'Store LED retrofit', '40% of stores', 'All stores', 'Stores retrofitted', 'Facilities manager', '2026-02-01', '2026-11-30', '', 'Contractor sign-off', 'In progress'),
        ],
        narrative: [],
        createdAt: now, createdBy: keletsoUid, updatedAt: now, updatedBy: keletsoUid,
    })

    // Six months of income: trainings per organisation, and the two ESG reports.
    const income = [
        [-144, 'Kgalagadi Mining (Pty) Ltd', 'training', null, null, 'ESG Awareness Training, June class (6 learners)', 27000, 'paid'],
        [-106, 'Marula Logistics', 'training', null, null, 'ESG Awareness Training, July class (3 learners)', 13500, 'paid'],
        [-80, 'Kgalagadi Mining (Pty) Ltd', 'esg_reporting', null, ESG_REPORT_IDS.kgalagadi, 'ESG report FY2026, deposit', 45000, 'paid'],
        [-59, 'Anatolia Retail A.Ş.', 'training', null, null, 'ESG Awareness Training, online (4 learners)', 18000, 'paid'],
        [-29, 'Kgalagadi Mining (Pty) Ltd', 'training', classIds.done, null, 'ESG Awareness Training, October class', 4500, 'paid'],
        [-29, 'Marula Logistics', 'training', classIds.done, null, 'ESG Awareness Training, October class', 4500, 'paid'],
        [-29, 'Anatolia Retail A.Ş.', 'training', classIds.done, null, 'ESG Awareness Training, October class', 4500, 'invoiced'],
        [-14, 'Anatolia Retail A.Ş.', 'esg_reporting', null, ESG_REPORT_IDS.anatolia, 'ESG report 2025 (TSRS)', 60000, 'invoiced'],
        [-1, 'Kgalagadi Mining (Pty) Ltd', 'training', classIds.now, null, 'ESG Awareness Training, November class (2 learners)', 9000, 'invoiced'],
        [-1, 'Marula Logistics', 'training', classIds.now, null, 'ESG Awareness Training, November class (2 learners)', 9000, 'invoiced'],
        [-1, 'Anatolia Retail A.Ş.', 'training', classIds.now, null, 'ESG Awareness Training, November class (1 learner)', 4500, 'invoiced'],
    ]
    income.forEach(([offset, organisation, service, classId, reportId, description, amount, status], index) => {
        put(`clientRevenue/tns-income-${String(index + 1).padStart(2, '0')}`, {
            companyCode, date: day(offset), organisation, service, classId, reportId, description, amount, status,
            paidOn: status === 'paid' ? day(offset + 21) : null,
            createdAt: now, createdBy: keletsoUid, updatedAt: now, updatedBy: keletsoUid,
        })
    })
    await batch.commit()

    const funder = { uid: 'tns-funder', email: 'funder@greenfund.test', name: 'Thandeka Mthethwa' }
    await seedPerson({
        ...funder, role: 'funder', companyCode, companyName, signature,
        extra: { jobTitle: 'Green Enterprise Fund' },
    })
    return { records, signIns: [{ email: funder.email, role: 'funder', note: `${companyName}: Green Enterprise Fund (sees the funder report)` }] }
}
