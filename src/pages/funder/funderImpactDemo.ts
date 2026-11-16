import type { FunderImpact, ImpactBlock, ImpactPanel } from '@/services/funderImpactService'

/**
 * Made-up figures for the Impact page's demo mode (/funder/impact?demo=1): a funder with six implementors and ten
 * programmes, enough to show the panels, the picker and the ranking. Nothing is read or written.
 */

type Seed = { key: string; name: string; implementor: string; smes: number; funding: number; growth: number; jobs: number }

const PROGRAMMES: Seed[] = [
  { key: 'demo-p1', name: 'Township Retail Growth', implementor: 'Ubuntu Incubator', smes: 64, funding: 14_500_000, growth: 82, jobs: 57 },
  { key: 'demo-p2', name: 'Green Tech Accelerator', implementor: 'Ubuntu Incubator', smes: 48, funding: 9_800_000, growth: 74, jobs: 41 },
  { key: 'demo-p3', name: 'Women in Agri Accelerator', implementor: 'Agri Hub SA', smes: 74, funding: 17_400_000, growth: 61, jobs: 71 },
  { key: 'demo-p4', name: 'Supplier Development 2026', implementor: 'Siyakha Enterprise', smes: 46, funding: 11_200_000, growth: 54, jobs: 43 },
  { key: 'demo-p5', name: 'Clean Energy Installers', implementor: 'Siyakha Enterprise', smes: 22, funding: 6_100_000, growth: 49, jobs: 18 },
  { key: 'demo-p6', name: 'Youth Makers Lab', implementor: 'Kasi Labs', smes: 38, funding: 5_200_000, growth: 91, jobs: 34 },
  { key: 'demo-p7', name: 'Digital Market Access', implementor: 'Kasi Labs', smes: 30, funding: 4_300_000, growth: 67, jobs: 22 },
  { key: 'demo-p8', name: 'Rural Food Processing', implementor: 'Thusa Development', smes: 27, funding: 7_900_000, growth: 38, jobs: 25 },
  { key: 'demo-p9', name: 'Construction Contractors', implementor: 'Mzansi Builders Trust', smes: 19, funding: 8_600_000, growth: 29, jobs: 31 },
  { key: 'demo-p10', name: 'Mining Supplier Readiness', implementor: 'Mzansi Builders Trust', smes: 24, funding: 10_300_000, growth: 44, jobs: 27 },
]

const AREAS = ['Market access', 'Financial management', 'Compliance', 'Marketing', 'Clean energy', 'Mentorship']

/** A plausible full set of figures from a few numbers, the same shape the real loader gives. */
const blockFrom = (seeds: Seed[], index: number): ImpactBlock => {
  const smes = seeds.reduce((sum, row) => sum + row.smes, 0)
  const funding = seeds.reduce((sum, row) => sum + row.funding, 0)
  const jobsCreated = seeds.reduce((sum, row) => sum + row.jobs, 0)
  const revenueGrowth = Math.round(seeds.reduce((sum, row) => sum + row.growth * row.smes, 0) / Math.max(1, smes))
  const interventions = Math.round(smes * 1.6)
  return {
    smes,
    jobsCreated,
    jobsSustained: Math.round(smes * 13.5),
    revenueGrowth,
    smesWithRevenue: Math.round(smes * 0.86),
    funding,
    costPerJob: jobsCreated ? Math.round(funding / jobsCreated) : null,
    costPerSme: smes ? Math.round(funding / smes) : null,
    programmes: seeds.length,
    fundedProgrammes: seeds.length,
    ownershipKnown: Math.round(smes * 0.97),
    blackOwned: Math.round(smes * 0.94),
    blackWomenOwned: Math.round(smes * 0.44),
    womenOwned: Math.round(smes * 0.52),
    youthOwned: Math.round(smes * 0.31),
    interventionsCompleted: interventions,
    meetingsHeld: Math.round(smes * 4.2),
    meetingHours: Math.round(smes * 8.6),
    areas: AREAS
      .map((area, position) => ({ area, completed: Math.max(1, Math.round(interventions * (0.28 - position * 0.04) + ((index + position) % 3))) }))
      .sort((left, right) => right.completed - left.completed),
  }
}

export const buildDemoImpact = (): FunderImpact => {
  const implementorNames = [...new Set(PROGRAMMES.map((row) => row.implementor))]
  const implementors: ImpactPanel[] = implementorNames.map((name, index) => ({
    key: `demo-i${index + 1}`,
    name,
    ...blockFrom(PROGRAMMES.filter((row) => row.implementor === name), index),
  })).sort((left, right) => right.smes - left.smes)
  const programmes: ImpactPanel[] = PROGRAMMES.map((row, index) => ({
    key: row.key,
    name: row.name,
    implementor: row.implementor,
    ...blockFrom([row], index),
  })).sort((left, right) => right.smes - left.smes)
  return { totals: blockFrom(PROGRAMMES, 0), implementors, programmes, fundingTracked: true }
}
