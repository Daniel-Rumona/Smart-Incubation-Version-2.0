/**
 * The reporting standards an ESG report is aligned to, worked out from the client's sector and country and the
 * report's dates. GRI Standards take effect by the publication date of the report; national rules (King) by the
 * financial year.
 *
 * Only references are kept (standard numbers, disclosure numbers and short titles), never the Standards' text.
 * Before charging for reports built on this, check GRI's Licensed Software & Tools Program. Effective dates checked in
 * November 2026: GRI 14 Mining and GRI 101 Biodiversity apply to reports published from 1 January 2026 (GRI 101
 * replaces GRI 304); GRI 102 Climate Change and GRI 103 Energy from 1 January 2027 (replacing GRI 305, Disclosure
 * 201-2 and GRI 302); King V applies to financial years starting from 1 January 2026; TSRS 1 and 2 (Türkiye) apply to
 * companies in the KGK's scope; the EU's ESRS are being simplified (check before relying on them).
 */
import type { EsgPillar } from '@/types/esg'

export type EsgSector = { key: string, label: string, /** The GRI Sector Standard, when GRI has one. */ griSector?: string }

export const ESG_SECTORS: EsgSector[] = [
    { key: 'mining', label: 'Mining', griSector: 'GRI 14' },
    { key: 'oil_gas', label: 'Oil and gas', griSector: 'GRI 11' },
    { key: 'coal', label: 'Coal', griSector: 'GRI 12' },
    { key: 'agriculture', label: 'Agriculture, aquaculture and fishing', griSector: 'GRI 13' },
    { key: 'manufacturing', label: 'Manufacturing' },
    { key: 'retail', label: 'Retail and consumer goods' },
    { key: 'financial', label: 'Financial services' },
    { key: 'construction', label: 'Construction and property' },
    { key: 'energy', label: 'Electricity and utilities' },
    { key: 'transport', label: 'Transport and logistics' },
    { key: 'hospitality', label: 'Hospitality and tourism' },
    { key: 'technology', label: 'Technology and telecoms' },
    { key: 'health', label: 'Health care' },
    { key: 'education', label: 'Education and training' },
    { key: 'public', label: 'Public sector and non-profit' },
    { key: 'other', label: 'Other' },
]

export type GriStandard = {
    id: string
    title: string
    kind: 'universal' | 'sector' | 'topic'
    pillar?: EsgPillar
    /** Applies to reports published on or after this date. */
    effectiveFrom?: string
    /** Replaced for reports published on or after this date... */
    replacedFrom?: string
    /** ...by this standard. */
    replacedBy?: string
}

const topic = (id: string, title: string, pillar: EsgPillar, extra: Partial<GriStandard> = {}): GriStandard => ({ id, title, kind: 'topic', pillar, ...extra })

export const GRI_STANDARDS: GriStandard[] = [
    { id: 'GRI 1', title: 'Foundation 2021', kind: 'universal' },
    { id: 'GRI 2', title: 'General Disclosures 2021', kind: 'universal' },
    { id: 'GRI 3', title: 'Material Topics 2021', kind: 'universal' },
    { id: 'GRI 11', title: 'Oil and Gas Sector 2021', kind: 'sector' },
    { id: 'GRI 12', title: 'Coal Sector 2022', kind: 'sector' },
    { id: 'GRI 13', title: 'Agriculture, Aquaculture and Fishing Sectors 2022', kind: 'sector' },
    { id: 'GRI 14', title: 'Mining Sector 2024', kind: 'sector', effectiveFrom: '2026-01-01' },
    topic('GRI 101', 'Biodiversity 2024', 'E', { effectiveFrom: '2026-01-01' }),
    topic('GRI 102', 'Climate Change 2025', 'E', { effectiveFrom: '2027-01-01' }),
    topic('GRI 103', 'Energy 2025', 'E', { effectiveFrom: '2027-01-01' }),
    topic('GRI 201', 'Economic Performance 2016', 'G'),
    topic('GRI 202', 'Market Presence 2016', 'S'),
    topic('GRI 203', 'Indirect Economic Impacts 2016', 'S'),
    topic('GRI 204', 'Procurement Practices 2016', 'S'),
    topic('GRI 205', 'Anti-corruption 2016', 'G'),
    topic('GRI 206', 'Anti-competitive Behavior 2016', 'G'),
    topic('GRI 207', 'Tax 2019', 'G'),
    topic('GRI 301', 'Materials 2016', 'E'),
    topic('GRI 302', 'Energy 2016', 'E', { replacedFrom: '2027-01-01', replacedBy: 'GRI 103' }),
    topic('GRI 303', 'Water and Effluents 2018', 'E'),
    topic('GRI 304', 'Biodiversity 2016', 'E', { replacedFrom: '2026-01-01', replacedBy: 'GRI 101' }),
    topic('GRI 305', 'Emissions 2016', 'E', { replacedFrom: '2027-01-01', replacedBy: 'GRI 102' }),
    topic('GRI 306', 'Waste 2020', 'E'),
    topic('GRI 308', 'Supplier Environmental Assessment 2016', 'E'),
    topic('GRI 401', 'Employment 2016', 'S'),
    topic('GRI 402', 'Labor/Management Relations 2016', 'S'),
    topic('GRI 403', 'Occupational Health and Safety 2018', 'S'),
    topic('GRI 404', 'Training and Education 2016', 'S'),
    topic('GRI 405', 'Diversity and Equal Opportunity 2016', 'S'),
    topic('GRI 406', 'Non-discrimination 2016', 'S'),
    topic('GRI 407', 'Freedom of Association and Collective Bargaining 2016', 'S'),
    topic('GRI 408', 'Child Labor 2016', 'S'),
    topic('GRI 409', 'Forced or Compulsory Labor 2016', 'S'),
    topic('GRI 413', 'Local Communities 2016', 'S'),
    topic('GRI 414', 'Supplier Social Assessment 2016', 'S'),
    topic('GRI 415', 'Public Policy 2016', 'G'),
    topic('GRI 416', 'Customer Health and Safety 2016', 'S'),
    topic('GRI 418', 'Customer Privacy 2016', 'S'),
]

export type GriDisclosure = {
    /** e.g. '302-1' or '2-15' */
    id: string
    title: string
    pillar: EsgPillar
    /** Words in an indicator's name (or unit) that point to this disclosure; the longest match wins. */
    keywords: string[]
}

const disclosure = (id: string, title: string, pillar: EsgPillar, keywords: string[] = []): GriDisclosure => ({ id, title, pillar, keywords })

export const GRI_DISCLOSURES: GriDisclosure[] = [
    disclosure('2-1', 'Organizational details', 'G'),
    disclosure('2-2', 'Entities included in the organization\'s sustainability reporting', 'G'),
    disclosure('2-3', 'Reporting period, frequency and contact point', 'G'),
    disclosure('2-5', 'External assurance', 'G'),
    disclosure('2-6', 'Activities, value chain and other business relationships', 'G', ['value chain']),
    disclosure('2-7', 'Employees', 'S', ['employees', 'headcount', 'staff numbers', 'workforce']),
    disclosure('2-8', 'Workers who are not employees', 'S', ['contractors', 'contract workers']),
    disclosure('2-9', 'Governance structure and composition', 'G', ['board', 'directors', 'governance structure']),
    disclosure('2-12', 'Role of the highest governance body in overseeing the management of impacts', 'G', ['board oversight']),
    disclosure('2-14', 'Role of the highest governance body in sustainability reporting', 'G'),
    disclosure('2-15', 'Conflicts of interest', 'G', ['conflict', 'conflicts']),
    disclosure('2-16', 'Communication of critical concerns', 'G', ['whistleblowing', 'whistle-blowing', 'critical concerns']),
    disclosure('2-22', 'Statement on sustainable development strategy', 'G', ['sustainability strategy']),
    disclosure('2-23', 'Policy commitments', 'G', ['policy', 'policies']),
    disclosure('2-25', 'Processes to remediate negative impacts', 'G', ['remediation']),
    disclosure('2-26', 'Mechanisms for seeking advice and raising concerns', 'G', ['grievance', 'grievances', 'complaints mechanism']),
    disclosure('2-27', 'Compliance with laws and regulations', 'G', ['fines', 'penalties', 'non-compliance', 'legal compliance']),
    disclosure('2-29', 'Approach to stakeholder engagement', 'G', ['stakeholder engagement', 'stakeholder']),
    disclosure('2-30', 'Collective bargaining agreements', 'S', ['collective bargaining', 'union']),
    disclosure('3-1', 'Process to determine material topics', 'G', ['materiality assessment']),
    disclosure('3-2', 'List of material topics', 'G', ['material topics']),
    disclosure('3-3', 'Management of material topics', 'G'),
    disclosure('201-1', 'Direct economic value generated and distributed', 'G', ['revenue', 'turnover', 'economic value']),
    disclosure('201-2', 'Financial implications and other risks and opportunities due to climate change', 'E', ['climate risk', 'climate-related risk']),
    disclosure('203-1', 'Infrastructure investments and services supported', 'S', ['infrastructure investment']),
    disclosure('204-1', 'Proportion of spending on local suppliers', 'S', ['local suppliers', 'local procurement', 'local spend', 'procurement']),
    disclosure('205-2', 'Communication and training about anti-corruption policies and procedures', 'G', ['anti-corruption training', 'ethics training', 'code of conduct training']),
    disclosure('205-3', 'Confirmed incidents of corruption and actions taken', 'G', ['corruption', 'bribery', 'fraud']),
    disclosure('207-1', 'Approach to tax', 'G', ['tax']),
    disclosure('301-1', 'Materials used by weight or volume', 'E', ['materials', 'raw materials', 'paper', 'packaging']),
    disclosure('301-2', 'Recycled input materials used', 'E', ['recycled input', 'recycled content']),
    disclosure('302-1', 'Energy consumption within the organization', 'E', ['electricity', 'energy consumption', 'energy use', 'fuel', 'diesel', 'petrol', 'gas consumption', 'kwh', 'mwh', 'gj']),
    disclosure('302-3', 'Energy intensity', 'E', ['energy intensity']),
    disclosure('302-4', 'Reduction of energy consumption', 'E', ['energy saving', 'energy savings', 'energy reduction']),
    disclosure('303-3', 'Water withdrawal', 'E', ['water withdrawal', 'water abstraction']),
    disclosure('303-4', 'Water discharge', 'E', ['water discharge', 'effluent']),
    disclosure('303-5', 'Water consumption', 'E', ['water', 'kl', 'm3']),
    disclosure('305-1', 'Direct (Scope 1) GHG emissions', 'E', ['scope 1 emissions', 'scope 1', 'direct emissions', 'ghg emissions', 'carbon emissions', 'co2', 'tco2e', 'emissions']),
    disclosure('305-2', 'Energy indirect (Scope 2) GHG emissions', 'E', ['scope 2 emissions', 'scope 2']),
    disclosure('305-3', 'Other indirect (Scope 3) GHG emissions', 'E', ['scope 3 emissions', 'scope 3']),
    disclosure('305-4', 'GHG emissions intensity', 'E', ['emissions intensity', 'carbon intensity']),
    disclosure('305-5', 'Reduction of GHG emissions', 'E', ['emissions reduction', 'reduction of emissions']),
    disclosure('305-7', 'Nitrogen oxides (NOx), sulfur oxides (SOx), and other significant air emissions', 'E', ['nox', 'sox', 'air emissions', 'dust', 'particulate']),
    disclosure('306-3', 'Waste generated', 'E', ['waste generated', 'waste']),
    disclosure('306-4', 'Waste diverted from disposal', 'E', ['recycled', 'recycling', 'waste diverted', 'diverted']),
    disclosure('306-5', 'Waste directed to disposal', 'E', ['landfill', 'incineration', 'waste to disposal']),
    disclosure('308-1', 'New suppliers that were screened using environmental criteria', 'E', ['supplier environmental', 'suppliers screened environmental']),
    disclosure('401-1', 'New employee hires and employee turnover', 'S', ['hires', 'turnover rate', 'staff turnover', 'attrition', 'resignations']),
    disclosure('401-3', 'Parental leave', 'S', ['parental leave', 'maternity']),
    disclosure('403-5', 'Worker training on occupational health and safety', 'S', ['safety training', 'ohs training', 'health and safety training', 'safety induction', 'induction']),
    disclosure('403-8', 'Workers covered by an occupational health and safety management system', 'S', ['safety management system', 'iso 45001']),
    disclosure('403-9', 'Work-related injuries', 'S', ['injury', 'injuries', 'ltifr', 'lost time', 'fatality', 'fatalities', 'safety incidents', 'incidents']),
    disclosure('403-10', 'Work-related ill health', 'S', ['ill health', 'occupational disease']),
    disclosure('404-1', 'Average hours of training per year per employee', 'S', ['training hours', 'hours of training']),
    disclosure('404-2', 'Programs for upgrading employee skills and transition assistance programs', 'S', ['skills development', 'upskilling', 'bursaries', 'learnerships']),
    disclosure('404-3', 'Percentage of employees receiving regular performance and career development reviews', 'S', ['performance review', 'performance reviews']),
    disclosure('405-1', 'Diversity of governance bodies and employees', 'S', ['women', 'female', 'gender', 'diversity', 'youth employment', 'disability']),
    disclosure('405-2', 'Ratio of basic salary and remuneration of women to men', 'S', ['pay gap', 'gender pay', 'remuneration ratio']),
    disclosure('406-1', 'Incidents of discrimination and corrective actions taken', 'S', ['discrimination', 'harassment']),
    disclosure('408-1', 'Operations and suppliers at significant risk for incidents of child labor', 'S', ['child labour', 'child labor']),
    disclosure('413-1', 'Operations with local community engagement, impact assessments, and development programs', 'S', ['community', 'communities', 'social investment', 'csi', 'ced']),
    disclosure('414-1', 'New suppliers that were screened using social criteria', 'S', ['supplier social', 'suppliers screened social']),
    disclosure('415-1', 'Political contributions', 'G', ['political']),
    disclosure('416-1', 'Assessment of the health and safety impacts of product and service categories', 'S', ['product safety']),
    disclosure('418-1', 'Substantiated complaints concerning breaches of customer privacy and losses of customer data', 'S', ['privacy', 'data breach', 'data breaches', 'popia', 'customer data']),
]

const DISCLOSURES_BY_ID = new Map(GRI_DISCLOSURES.map((item) => [item.id, item]))
const STANDARDS_BY_ID = new Map(GRI_STANDARDS.map((item) => [item.id, item]))

export const griDisclosure = (id?: string) => (id ? DISCLOSURES_BY_ID.get(id) : undefined)
export const griStandard = (id?: string) => (id ? STANDARDS_BY_ID.get(id) : undefined)

/** 'GRI 302' for '302-1', 'GRI 2' for '2-15'. */
export const standardOfDisclosure = (id: string) => `GRI ${id.split('-')[0]}`

const onOrAfter = (date: string, from?: string) => Boolean(from) && Boolean(date) && date >= (from as string)

/**
 * The standard a disclosure is reported under for a report published on `publicationDate`: the disclosure's own
 * standard, or its successor once that has replaced it (e.g. 305-1 under GRI 102 from 2027).
 */
export const disclosureInEffect = (id: string, publicationDate: string) => {
    const item = griDisclosure(id)
    const own = griStandard(standardOfDisclosure(id))
    // Disclosure 201-2 moves to GRI 102 with the emissions disclosures.
    const successorId = id === '201-2' ? (onOrAfter(publicationDate, '2027-01-01') ? 'GRI 102' : undefined)
        : own && onOrAfter(publicationDate, own.replacedFrom) ? own.replacedBy : undefined
    const successor = griStandard(successorId)
    return {
        id,
        title: item?.title || id,
        standard: successor || own,
        /** Set when the report falls under the newer standard: the disclosure is then reported there. */
        replacedBy: successor ? `${successor.id}: ${successor.title}` : undefined,
    }
}

/** The disclosure an indicator most likely reports against, from its name and unit (longest keyword wins). */
export const suggestDisclosure = (indicator: string, unit = '') => {
    const haystack = ` ${`${indicator} ${unit}`.toLowerCase().replace(/[^a-z0-9%-]+/g, ' ')} `
    let best: { id: string, length: number } | null = null
    for (const item of GRI_DISCLOSURES) {
        for (const keyword of item.keywords) {
            if (haystack.includes(` ${keyword} `) || (keyword.includes(' ') && haystack.includes(keyword))) {
                if (!best || keyword.length > best.length) best = { id: item.id, length: keyword.length }
            }
        }
    }
    return best?.id || ''
}

/** The GRI Sector Standard for the client's sector, if GRI has published one. */
export const sectorStandardFor = (sectorKey: string) => griStandard(ESG_SECTORS.find((sector) => sector.key === sectorKey)?.griSector)

const EU_COUNTRIES = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']

export type EsgFramework = {
    id: string
    /** National or regional frameworks are suggested for clients in these countries; global ones are opt-in. */
    countries?: string[]
    label: (periodStart: string) => string
    /** A few words, for where space is short (the report page's "Follows" line). */
    short: (periodStart: string) => string
    note: string
}

export const ESG_FRAMEWORKS: EsgFramework[] = [
    {
        id: 'ifrs-s',
        label: () => 'IFRS S1 and IFRS S2 (ISSB)',
        short: () => 'IFRS S1/S2',
        note: 'Investor-focused sustainability and climate disclosures; the global baseline many countries are adopting (Türkiye\'s TSRS among them).',
    },
    {
        id: 'tsrs',
        countries: ['TR'],
        label: () => 'TSRS 1 and TSRS 2 (Türkiye Sustainability Reporting Standards)',
        short: () => 'TSRS',
        note: 'Required for companies in the KGK\'s scope: those over two of the three size thresholds (assets, revenue, employees) in two consecutive periods; the thresholds were raised for periods from 2025. Based on IFRS S1 and S2. Check the KGK list of companies in scope.',
    },
    {
        id: 'jse',
        countries: ['ZA'],
        label: () => 'JSE Sustainability and Climate Disclosure Guidance (2022)',
        short: () => 'JSE guidance',
        note: 'Guidance for JSE-listed companies, aligned with GRI and IFRS S2; useful for South African clients that report to investors.',
    },
    {
        id: 'king',
        countries: ['ZA'],
        label: (periodStart) => (periodStart >= '2026-01-01' ? 'King V Code on Corporate Governance (South Africa)' : 'King IV Code on Corporate Governance (South Africa)'),
        short: (periodStart) => (periodStart >= '2026-01-01' ? 'King V' : 'King IV'),
        note: 'King V (released 31 October 2025) applies to financial years starting on or after 1 January 2026; King IV before that. Governance disclosures on an apply-and-explain basis.',
    },
    {
        id: 'esrs',
        countries: EU_COUNTRIES,
        label: () => 'ESRS (EU Corporate Sustainability Reporting Directive)',
        short: () => 'ESRS',
        note: 'Since the 2026 Omnibus the CSRD covers companies with more than 1,000 employees and €450 million turnover; simplified ESRS are expected to apply from financial year 2027. Check the current status before relying on it.',
    },
]

export const esgFramework = (id: string) => ESG_FRAMEWORKS.find((framework) => framework.id === id)

/** The national and regional frameworks suggested for a client in this country. */
export const suggestedFrameworksFor = (country: string) =>
    ESG_FRAMEWORKS.filter((framework) => framework.countries?.includes(country)).map((framework) => framework.id)

/** Every country, by ISO 3166 code (names come from the browser in the reader's language). */
export const COUNTRY_CODES = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI '
    + 'CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK '
    + 'HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM '
    + 'MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE '
    + 'SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ')

export const countryName = (code: string, locale = 'en') => {
    try {
        return new Intl.DisplayNames([locale], { type: 'region' }).of(code) || code
    } catch {
        return code
    }
}

/**
 * Everything the report is aligned to, with the reasons, for the Standards tab and the report's "About this report".
 */
export const alignedStandards = (report: { sector: string, country: string, periodStart: string, publicationDate: string, frameworks: string[], indicators: Array<{ disclosure: string }> }) => {
    const sector = sectorStandardFor(report.sector)
    const reasons: string[] = []
    if (sector) {
        reasons.push(`${sector.id}: ${sector.title} applies to the ${ESG_SECTORS.find((item) => item.key === report.sector)?.label.toLowerCase()} sector`
            + (sector.effectiveFrom && !onOrAfter(report.publicationDate, sector.effectiveFrom) ? ' (in effect for reports published from 1 January 2026; earlier use is voluntary).' : '.'))
    } else {
        reasons.push('GRI has no Sector Standard for this sector yet: the Universal and Topic Standards apply.')
    }
    const disclosures = [...new Set(report.indicators.map((item) => item.disclosure).filter(Boolean))]
    const topics = new Map<string, GriStandard>()
    for (const id of disclosures) {
        const resolved = disclosureInEffect(id, report.publicationDate)
        if (resolved.standard && resolved.standard.kind === 'topic') topics.set(resolved.standard.id, resolved.standard)
        if (resolved.replacedBy) reasons.push(`${id} is reported under ${resolved.replacedBy}, which replaces it for reports published from ${resolved.standard?.effectiveFrom}.`)
    }
    const frameworks = report.frameworks.map(esgFramework).filter((item): item is EsgFramework => Boolean(item))
    return {
        universal: GRI_STANDARDS.filter((item) => item.kind === 'universal'),
        sector,
        topics: [...topics.values()].sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4))),
        frameworks: frameworks.map((framework) => ({ id: framework.id, label: framework.label(report.periodStart), short: framework.short(report.periodStart), note: framework.note })),
        reasons: [...new Set(reasons)],
    }
}
