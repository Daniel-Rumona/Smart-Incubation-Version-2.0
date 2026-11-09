import type { EsgEmissionSource, EsgFootprint, EsgIndicator, EsgScope } from '@/types/esg'
import type { SpreadsheetSheet } from '@/utils/learnerSpreadsheet'

/**
 * The carbon footprint of an ESG report (GHG Protocol Scope 1, 2 and 3): the activities a facilitator records month by
 * month, their default emission factors and where each comes from, the totals, the figures they put in the report
 * (GRI 305-1/2/3), the South African carbon tax estimate, and the import of her carbon footprint workbook.
 *
 * Factors are kg CO2e per unit and are copied onto each source line when it is added, with their source, so a report
 * stays as calculated when factors are updated here. Update the tables below when DFFE or DESNZ publish new ones.
 * No runtime imports, so the calculations also run under Node in tests.
 */

const DESNZ = 'UK DESNZ greenhouse gas conversion factors 2025'

/**
 * Location-based grid emission factors by country, kg CO2e per kWh, from each country's official publisher, keyed by
 * the data year the factor describes. `national` is the factor for purchased electricity (Scope 2); `losses` the
 * transmission and distribution losses (Scope 3), or null where the national factor already includes them.
 * Countries not listed get a blank factor for the facilitator to enter.
 */
export type GridFactor = { country: string, year: number, national: number, losses: number | null, source: string, lossesSource: string, note?: string }

const DFFE = (year: number, gazette: string): Pick<GridFactor, 'source' | 'lossesSource'> => ({
    source: `DFFE national generation grid emission factor ${year} (${gazette})`,
    lossesSource: `DFFE transmission and distribution loss grid emission factors ${year} (${gazette})`,
})
const ETKB_2023 = 'Republic of Türkiye Ministry of Energy and Natural Resources, electricity consumption point emission factor 2023 (ETKB-EVÇED-FRM-042, published 26 December 2025)'

export const GRID_FACTORS: GridFactor[] = [
    // South Africa: DFFE Grid Emission Factors Reports. The national generation factor (NGGEF) is the one DFFE gives for Scope 2.
    { country: 'ZA', year: 2021, national: 0.985, losses: 0.089, ...DFFE(2021, 'Government Gazette 50071, February 2024') },
    { country: 'ZA', year: 2022, national: 0.931, losses: 0.085, ...DFFE(2022, 'Government Gazette 51495, 1 November 2024') },
    { country: 'ZA', year: 2023, national: 0.906, losses: 0.082, ...DFFE(2023, 'Government Gazette 53079, 25 July 2025') },
    { country: 'ZA', year: 2024, national: 0.96, losses: 0.092, ...DFFE(2024, 'Government Gazette 55353, 11 September 2026') },
    // Türkiye: the consumption point factors already include grid losses. Most businesses are connected to the
    // distribution grid (0.469); sites fed directly from the transmission grid use 0.436.
    {
        country: 'TR', year: 2023, national: 0.469, losses: null,
        source: `${ETKB_2023}: consumers connected to the distribution grid (sites fed from the transmission grid: 0.436)`,
        lossesSource: 'Türkiye\'s consumption point factor already includes grid losses: leave this line out.',
        note: 'Sites fed directly from the transmission grid: change the factor to 0.436.',
    },
    // United Kingdom: DESNZ conversion factors (published each June for that calendar year).
    { country: 'GB', year: 2025, national: 0.177, losses: 0.01853, source: `${DESNZ}: UK electricity, per kWh`, lossesSource: `${DESNZ}: transmission and distribution, UK electricity, per kWh` },
]

/** The countries with a built-in grid factor. */
export const GRID_FACTOR_COUNTRIES = [...new Set(GRID_FACTORS.map((item) => item.country))]

/**
 * A country's grid factors for a data year: that year's, or the latest published before it (the earliest for older
 * years); undefined for a country without built-in factors.
 */
export const gridFactorsFor = (year: number, country = 'ZA') => {
    const sorted = GRID_FACTORS.filter((item) => item.country === country).sort((a, b) => a.year - b.year)
    return [...sorted].reverse().find((item) => item.year <= year) || sorted[0]
}

/** South Africa's carbon tax rate per tonne CO2e by calendar year (Carbon Tax Act 15 of 2019, as amended). */
export const SA_CARBON_TAX_RATES: Record<number, number> = { 2022: 144, 2023: 159, 2024: 190, 2025: 236, 2026: 308 }

/** The rate for a year; years after the last announced rate use that rate and say so. */
export const carbonTaxRate = (year: number): { rate: number, year: number, announced: boolean } | null => {
    if (SA_CARBON_TAX_RATES[year]) return { rate: SA_CARBON_TAX_RATES[year], year, announced: true }
    const latest = Math.max(...Object.keys(SA_CARBON_TAX_RATES).map(Number))
    return year > latest ? { rate: SA_CARBON_TAX_RATES[latest], year: latest, announced: false } : null
}

/** The basic tax-free allowance for fuel combustion; with the other allowances, at most 95% in total. */
export const BASIC_CARBON_TAX_ALLOWANCE = 60
export const MAX_CARBON_TAX_ALLOWANCE = 95

type FactorContext = { country: string, year: number }
type Factor = { value: number | null, source: string }

export type EmissionSourceKind = {
    kind: string
    scope: EsgScope
    label: string
    unit: string
    hint: string
    taxable: boolean
    factor: (context: FactorContext) => Factor
}

const desnz = (value: number, name: string): (() => Factor) => () => ({ value, source: `${DESNZ}: ${name}` })

const grid = (part: 'national' | 'losses') => ({ country, year }: FactorContext): Factor => {
    const factors = gridFactorsFor(year, country)
    if (!factors) return { value: null, source: 'Enter the grid emission factor published for the client\'s country.' }
    return part === 'national' ? { value: factors.national, source: factors.source } : { value: factors.losses, source: factors.lossesSource }
}

/** The sources offered, by scope, in the order the footprint lists them. */
export const EMISSION_SOURCES: EmissionSourceKind[] = [
    { kind: 'vehicle_diesel', scope: 1, label: 'Company vehicles: diesel', unit: 'litres', taxable: false, hint: 'Fuel for vehicles the client owns or controls.', factor: desnz(2.66155, 'Diesel (100% mineral diesel), per litre') },
    { kind: 'vehicle_petrol', scope: 1, label: 'Company vehicles: petrol', unit: 'litres', taxable: false, hint: 'Fuel for vehicles the client owns or controls.', factor: desnz(2.33984, 'Petrol (100% mineral petrol), per litre') },
    { kind: 'generator_diesel', scope: 1, label: 'Generators and machinery: diesel', unit: 'litres', taxable: false, hint: 'Diesel for generators, plant and equipment on site.', factor: desnz(2.66155, 'Diesel (100% mineral diesel), per litre') },
    { kind: 'lpg_kg', scope: 1, label: 'LPG (gas bottles, forklifts, kitchens)', unit: 'kg', taxable: true, hint: 'LPG bought by weight, e.g. 9 kg and 48 kg bottles.', factor: desnz(2.93936, 'LPG, 2 939.36 kg CO2e per tonne, per kg') },
    { kind: 'lpg_litres', scope: 1, label: 'LPG / propane by volume', unit: 'litres', taxable: true, hint: 'LPG or propane bought by the litre.', factor: desnz(1.55713, 'LPG, per litre') },
    { kind: 'natural_gas', scope: 1, label: 'Natural gas', unit: 'GJ', taxable: true, hint: 'Piped gas as billed, in gigajoules.', factor: desnz(50.82222, 'Natural gas, 0.18296 kg CO2e per kWh (gross CV) x 277.78 kWh per GJ') },
    { kind: 'coal', scope: 1, label: 'Coal', unit: 'tonnes', taxable: true, hint: 'Coal burnt in boilers, furnaces or kilns.', factor: desnz(2395.28994, 'Coal (industrial), per tonne') },
    { kind: 'paraffin', scope: 1, label: 'Paraffin', unit: 'litres', taxable: true, hint: 'Paraffin (illuminating kerosene) for heating or cooking.', factor: desnz(2.54016, 'Burning oil, per litre') },
    { kind: 'electricity', scope: 2, label: 'Electricity from the grid', unit: 'kWh', taxable: false, hint: 'Electricity bought from Eskom or the municipality, from the bills.', factor: grid('national') },
    { kind: 'grid_losses', scope: 3, label: 'Electricity grid losses', unit: 'kWh', taxable: false, hint: 'The same kWh as the electricity line: the share lost in transmission and distribution.', factor: grid('losses') },
    { kind: 'commuting_fuel', scope: 3, label: 'Employee commuting: car fuel', unit: 'litres', taxable: false, hint: 'Litres of petrol staff use to get to work (distance / 100 x litres per 100 km).', factor: desnz(2.33984, 'Petrol (100% mineral petrol), per litre') },
    { kind: 'car_km', scope: 3, label: 'Business travel and commuting by car', unit: 'km', taxable: false, hint: 'Kilometres in cars the client does not own.', factor: desnz(0.16725, 'Average car, unknown fuel, per km') },
    { kind: 'flights_short', scope: 3, label: 'Flights under 3 700 km (domestic and regional)', unit: 'passenger km', taxable: false, hint: 'Distance flown per passenger, e.g. Johannesburg to Cape Town is about 1 270 km.', factor: desnz(0.12786, 'Short-haul flight, average passenger, with radiative forcing, per passenger km') },
    { kind: 'flights_long', scope: 3, label: 'Flights over 3 700 km', unit: 'passenger km', taxable: false, hint: 'Distance flown per passenger on long-haul flights.', factor: desnz(0.15282, 'Long-haul flight, average passenger, with radiative forcing, per passenger km') },
]

export const emissionSourceKind = (kind: string) => EMISSION_SOURCES.find((item) => item.kind === kind)

export const SCOPE_LABELS: Record<EsgScope, string> = {
    1: 'Scope 1: direct emissions',
    2: 'Scope 2: purchased electricity',
    3: 'Scope 3: value chain',
}

export const EMPTY_FOOTPRINT: EsgFootprint = { sources: [], carbonTaxPayer: 'unsure', allowancePct: BASIC_CARBON_TAX_ALLOWANCE }

/** The year and month (1-12) a reporting period starts in; January of the current year when it is not set. */
const periodStartOf = (periodStart: string) => {
    const match = /^(\d{4})-(\d{2})/.exec(periodStart || '')
    return match ? { year: Number(match[1]), month: Number(match[2]) } : { year: new Date().getFullYear(), month: 1 }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The twelve months of the reporting period, e.g. "Mar 2025" ... "Feb 2026". */
export const footprintMonths = (periodStart: string) => {
    const start = periodStartOf(periodStart)
    return Array.from({ length: 12 }, (_, index) => {
        const offset = start.month - 1 + index
        const year = start.year + Math.floor(offset / 12)
        return { year, month: (offset % 12) + 1, label: `${MONTHS[offset % 12]} ${year}` }
    })
}

/** The data year a period's factors are chosen for: the year most of its months fall in. */
export const footprintDataYear = (periodStart: string) => {
    const counts = new Map<number, number>()
    for (const month of footprintMonths(periodStart)) counts.set(month.year, (counts.get(month.year) || 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
}

let counter = 0
const newSourceId = () => `src${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** A new line for a source from the list, with its factor for the client's country and the period's data year. */
export const newEmissionSource = (kind: string, context: FactorContext): EsgEmissionSource => {
    const item = emissionSourceKind(kind)
    if (!item) {
        return { id: newSourceId(), kind: 'custom', scope: 3, label: '', unit: '', factor: null, factorSource: '', taxable: false, monthly: Array(12).fill(null) }
    }
    const factor = item.factor(context)
    return { id: newSourceId(), kind, scope: item.scope, label: item.label, unit: item.unit, factor: factor.value, factorSource: factor.source, taxable: item.taxable, monthly: Array(12).fill(null) }
}

export const sourceUsage = (source: EsgEmissionSource) => source.monthly.reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)
export const sourceHasUsage = (source: EsgEmissionSource) => source.monthly.some((value) => typeof value === 'number' && value !== 0)

/** Tonnes CO2e of a line; 0 while it has no factor. */
export const sourceTonnes = (source: EsgEmissionSource) => (typeof source.factor === 'number' ? (sourceUsage(source) * source.factor) / 1000 : 0)

export const footprintTotals = (footprint: EsgFootprint) => {
    const byScope: Record<EsgScope, number> = { 1: 0, 2: 0, 3: 0 }
    const monthly = Array(12).fill(0) as number[]
    for (const source of footprint.sources) {
        byScope[source.scope] += sourceTonnes(source)
        if (typeof source.factor !== 'number') continue
        source.monthly.forEach((value, index) => { if (typeof value === 'number') monthly[index] += (value * (source.factor as number)) / 1000 })
    }
    const scopesRecorded = ([1, 2, 3] as EsgScope[]).filter((scope) => footprint.sources.some((source) => source.scope === scope))
    return {
        byScope,
        total: byScope[1] + byScope[2] + byScope[3],
        monthly,
        scopesRecorded,
        /** Lines with usage but no factor: their emissions are missing from the totals. */
        missingFactor: footprint.sources.filter((source) => sourceHasUsage(source) && typeof source.factor !== 'number'),
    }
}

export type CarbonTaxEstimate =
    | { applies: false, reason: 'not_south_africa' | 'not_a_payer' | 'unsure' }
    | {
        applies: true
        /** Scope 1 tonnes from the taxable fuels. */
        tonnes: number
        years: Array<{ year: number, tonnes: number, rate: number | null, announced: boolean }>
        gross: number
        allowancePct: number
        net: number
        /** Some months fall in a year without a rate on file. */
        missingRate: boolean
    }

/**
 * The client's carbon tax, estimated: only for a South African client that pays it directly, only on Scope 1
 * emissions from the taxable fuels (petrol and diesel carry the tax at the pump through the carbon fuel levy), each
 * month at its calendar year's rate, less the tax-free allowances claimed. The client's SARS return decides the figure.
 */
export const carbonTaxEstimate = (footprint: EsgFootprint, report: { country: string, periodStart: string }): CarbonTaxEstimate => {
    if (report.country !== 'ZA') return { applies: false, reason: 'not_south_africa' }
    if (footprint.carbonTaxPayer !== 'yes') return { applies: false, reason: footprint.carbonTaxPayer === 'no' ? 'not_a_payer' : 'unsure' }
    const months = footprintMonths(report.periodStart)
    const byYear = new Map<number, number>()
    for (const source of footprint.sources) {
        if (source.scope !== 1 || !source.taxable || typeof source.factor !== 'number') continue
        source.monthly.forEach((value, index) => {
            if (typeof value !== 'number') return
            const year = months[index].year
            byYear.set(year, (byYear.get(year) || 0) + (value * (source.factor as number)) / 1000)
        })
    }
    const years = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, tonnes]) => {
        const rate = carbonTaxRate(year)
        return { year, tonnes, rate: rate?.rate ?? null, announced: rate?.announced ?? false }
    })
    const allowancePct = Math.min(MAX_CARBON_TAX_ALLOWANCE, Math.max(0, footprint.allowancePct))
    const gross = years.reduce((sum, item) => sum + item.tonnes * (item.rate ?? 0), 0)
    return {
        applies: true,
        tonnes: years.reduce((sum, item) => sum + item.tonnes, 0),
        years,
        gross,
        allowancePct,
        net: gross * (1 - allowancePct / 100),
        missingRate: years.some((item) => item.rate === null && item.tonnes > 0),
    }
}

/** "per litre" rather than "per litres". */
export const perUnit = (unit: string) => unit.replace(/s$/, '')

/** "1 135.42": spaces between thousands and a decimal point, as the report's figures are written. */
export const formatQuantity = (value: number, decimals = 2) => {
    const fixed = (Math.round(value * 10 ** decimals) / 10 ** decimals).toFixed(decimals).replace(/\.?0+$/, '')
    const [whole, fraction] = fixed.split('.')
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
    return fraction ? `${grouped}.${fraction}` : grouped
}

/** The report figures the footprint fills in, one per scope, with their GRI disclosures. */
export const FOOTPRINT_INDICATORS: Array<{ scope: EsgScope, id: string, name: string, disclosure: string }> = [
    { scope: 1, id: 'footprint-scope-1', name: 'Scope 1 GHG emissions (direct)', disclosure: '305-1' },
    { scope: 2, id: 'footprint-scope-2', name: 'Scope 2 GHG emissions (purchased electricity)', disclosure: '305-2' },
    { scope: 3, id: 'footprint-scope-3', name: 'Scope 3 GHG emissions (value chain)', disclosure: '305-3' },
]

const FOOTPRINT_EVIDENCE = 'Carbon footprint: activity data x emission factors (see Climate change and energy)'

/**
 * The figures with each recorded scope's total put in: the footprint's own line, else the client's existing line for
 * that GRI disclosure in tCO2e (keeping its name, baseline, target and evidence), else a new line.
 */
export const withFootprintIndicators = (indicators: EsgIndicator[], footprint: EsgFootprint): EsgIndicator[] => {
    const totals = footprintTotals(footprint)
    const next = [...indicators]
    for (const item of FOOTPRINT_INDICATORS) {
        if (!totals.scopesRecorded.includes(item.scope)) continue
        const current = formatQuantity(totals.byScope[item.scope])
        const index = next.findIndex((row) => row.id === item.id) >= 0
            ? next.findIndex((row) => row.id === item.id)
            : next.findIndex((row) => row.disclosure === item.disclosure && /co2/i.test(row.unit))
        if (index >= 0) {
            const row = next[index]
            next[index] = { ...row, pillar: 'E', unit: 'tCO2e', current, disclosure: item.disclosure, evidence: row.evidence.trim() || FOOTPRINT_EVIDENCE }
        } else {
            next.push({
                id: item.id, pillar: 'E', indicator: item.name, unit: 'tCO2e', baseline: '', current, target: '', period: 'Reporting period',
                owner: '', evidence: FOOTPRINT_EVIDENCE, qualityCheck: '', disclosure: item.disclosure,
            })
        }
    }
    return next
}

// Her carbon footprint workbook ("Carbon Footprint Calculator"): blocks headed by a title (Natural Gas, Electricity,
// Company Owned Vehicles (Diesel), ...) over a "Month | Usage ... | E-Factor | CO2e (tonnes)" header and twelve months.
// Usage comes across; factors are replaced by this page's, except for blocks it has no factor for (custom lines).

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const kindForBlock = (title: string) => {
    const key = normalise(title)
    if (key.includes('naturalgas')) return 'natural_gas'
    if (key.includes('electricity')) return 'electricity'
    if (key.includes('commut')) return 'commuting_fuel'
    if (key.includes('vehicle') && key.includes('diesel')) return 'vehicle_diesel'
    if (key.includes('vehicle') && (key.includes('petrol') || key.includes('gas'))) return 'vehicle_petrol'
    if (key.includes('generator')) return 'generator_diesel'
    if (key.includes('businesstravel') || key.includes('flight')) return 'flights_short'
    if (key.includes('propane') || key.includes('lpg')) return 'lpg_litres'
    if (key.includes('coal')) return 'coal'
    if (key.includes('paraffin') || key.includes('kerosene')) return 'paraffin'
    return null
}

export type FootprintWorkbookImport = {
    sheet: string
    sources: EsgEmissionSource[]
    /** The workbook's own factors that were replaced, e.g. "Electricity: 0.88 -> 0.96 kg CO2e per kWh". */
    replacedFactors: string[]
    /** Blocks without a factor here or in the workbook: their factor needs entering. */
    needFactor: string[]
}

const number = (value: string | undefined) => {
    const text = String(value ?? '').replace(/\s/g, '').replace(',', '.')
    if (!text) return null
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : null
}

/** The blocks of the first sheet that has any usage recorded; null when no sheet looks like her calculator. */
export const importFootprintWorkbook = (sheets: SpreadsheetSheet[], context: FactorContext & { periodStart: string }): FootprintWorkbookImport | null => {
    const startMonth = periodStartOf(context.periodStart).month
    for (const sheet of sheets) {
        const rows = sheet.rows
        const scopeHeaders: Array<{ row: number, column: number, scope: EsgScope }> = []
        rows.forEach((row, rowIndex) => row.forEach((cell, column) => {
            const match = /^scope\s*([123])$/i.exec(String(cell || '').trim())
            if (match) scopeHeaders.push({ row: rowIndex, column, scope: Number(match[1]) as EsgScope })
        }))
        const sources: EsgEmissionSource[] = []
        const replacedFactors: string[] = []
        const needFactor: string[] = []
        rows.forEach((row, rowIndex) => row.forEach((cell, column) => {
            if (normalise(String(cell || '')) !== 'month') return
            const title = String(rows[rowIndex - 1]?.[column] || '').trim()
            if (!title) return
            const headers = row.map((value) => normalise(String(value || '')))
            const usageColumn = headers.findIndex((header, index) => index > column && header.startsWith('usage'))
            const factorColumn = headers.findIndex((header, index) => index > column && header.includes('factor'))
            const tonnesColumn = headers.findIndex((header, index) => index > column && header.includes('co2'))
            if (usageColumn < 0) return
            const monthly: Array<number | null> = Array(12).fill(null)
            // The workbook's factor per unit of the usage column, from its own result (tonnes / usage): its factor
            // column can be per another unit (electricity is entered in kWh, its factor is per MWh).
            const implied: number[] = []
            const stated: number[] = []
            for (let offset = 1; offset <= 12; offset += 1) {
                const line = rows[rowIndex + offset] || []
                const monthIndex = MONTH_KEYS.indexOf(normalise(String(line[column] || '')).slice(0, 3))
                if (monthIndex < 0) continue
                const usage = number(line[usageColumn])
                monthly[(monthIndex + 1 - startMonth + 12) % 12] = usage
                const tonnes = tonnesColumn >= 0 ? number(line[tonnesColumn]) : null
                if (usage && tonnes !== null) implied.push((tonnes * 1000) / usage)
                const factor = factorColumn >= 0 ? number(line[factorColumn]) : null
                if (factor) stated.push(factor * 1000)
            }
            if (!monthly.some((value) => typeof value === 'number' && value !== 0)) return
            const theirFactor = implied.find((value) => value > 0) ?? stated[0] ?? null
            const kind = kindForBlock(title)
            if (kind) {
                const source = { ...newEmissionSource(kind, context), monthly }
                if (theirFactor !== null && source.factor !== null && Math.abs(theirFactor - source.factor) > 1e-6) {
                    replacedFactors.push(`${title}: ${formatQuantity(theirFactor, 5)} -> ${formatQuantity(source.factor, 5)} kg CO2e per ${perUnit(source.unit)}`)
                }
                if (source.factor === null) needFactor.push(title)
                sources.push(source)
                return
            }
            const scope = scopeHeaders.filter((header) => header.row < rowIndex && header.column <= column).sort((a, b) => b.column - a.column || b.row - a.row)[0]?.scope ?? 3
            const unit = /\(([^)]+)\)/.exec(String(row[usageColumn] || ''))?.[1]?.trim() || 'units'
            if (theirFactor === null) needFactor.push(title)
            sources.push({
                ...newEmissionSource('custom', context), scope, label: title, unit, monthly, factor: theirFactor,
                factorSource: theirFactor === null ? '' : 'From the client\'s carbon footprint workbook',
            })
        }))
        if (sources.length) return { sheet: sheet.name, sources, replacedFactors, needFactor }
    }
    return null
}
