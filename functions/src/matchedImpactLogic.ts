// COPY of src/services/matchedImpactLogic.ts for the nightly agent watch run (agentWatches.ts).
// Functions compile from functions/src only, so the file is duplicated: keep the two in step.
/**
 * Which interventions are linked to a change in an SME measure (revenue, jobs).
 * Pure functions, no imports, so impactLogic.test.cjs runs without Firebase.
 *
 * For each SME that completed an intervention (SME-confirmed), the measure in the
 * months after completion is compared with the months before. The same comparison
 * is made for similar SMEs in the same programme that had not yet received that
 * intervention, over the same calendar months. The difference is the lift: the
 * change beyond what the cohort did anyway. It shows a link, never proof.
 */

export type MonthKey = string; // YYYY-MM

export type ImpactMetric = "revenue" | "jobs";

/**
 * How each measure changes: revenue as a percentage (so a R20k and a R2m business
 * compare fairly), jobs as a head count (a 3-person team adding one is not "+33%").
 */
export const IMPACT_METRICS: Record<ImpactMetric, { change: "percent" | "absolute"; unit: "points" | "jobs"; noDifference: number }> = {
  revenue: { change: "percent", unit: "points", noDifference: 1 },
  jobs: { change: "absolute", unit: "jobs", noDifference: 0.2 },
};

export type ImpactSme = {
  id: string;
  programId: string;
  sector: string;
  synthetic: boolean;
  /** The measure being analysed, by month. */
  values: Record<MonthKey, number>;
};

export type ImpactTreatment = {
  participantId: string;
  programId: string;
  interventionId: string;
  interventionTitle: string;
  month: MonthKey;
  /** The facilitator's check-back answer, when there is one. */
  outcome: "achieved" | "partial" | "not_yet" | null;
};

export type ImpactSettings = {
  beforeMonths: number[];
  afterMonths: number[];
  minMonthsEachSide: number;
  minTreated: number;
  minControls: number;
  earlyMin: number;
  resamples: number;
  seed: number;
};

export const DEFAULT_IMPACT_SETTINGS: ImpactSettings = {
  beforeMonths: [-3, -2, -1],
  afterMonths: [3, 4, 5, 6],
  minMonthsEachSide: 2,
  minTreated: 10,
  minControls: 10,
  earlyMin: 5,
  resamples: 1000,
  seed: 20261029,
};

export type ImpactStatus = "reportable" | "early" | "insufficient";

export type ImpactResult = {
  programId: string;
  interventionId: string;
  interventionTitle: string;
  metric: ImpactMetric;
  /** What the lift and changes are in: percentage points (revenue) or jobs per SME. */
  unit: "points" | "jobs";
  status: ImpactStatus;
  /**
   * Lift, treated change minus comparison change. For revenue the changes are
   * percentages and the lift is in points; for jobs both are jobs per SME. The
   * *Percent names predate jobs and are kept so stored results stay readable.
   */
  liftPercent: number | null;
  rangeLowPercent: number | null;
  rangeHighPercent: number | null;
  treatedChangePercent: number | null;
  comparisonChangePercent: number | null;
  treatedCount: number;
  comparisonCount: number;
  /** SMEs that completed it but lacked revenue on one side of the window. */
  treatedWithoutData: number;
  /** How the comparison SMEs were matched, most to least specific. */
  matching: { sectorAndBand: number; sector: number; programme: number };
  /** Share of treated SMEs that completed another intervention in the same window. */
  overlapShare: number;
  byOutcome: {
    achieved: { count: number; liftPercent: number | null };
    notAchieved: { count: number; liftPercent: number | null };
  };
  period: { from: MonthKey; to: MonthKey } | null;
  demo: boolean;
  headline: string | null;
};

/* ------------------------------------------------------------------ helpers */

export function addMonths(month: MonthKey, count: number): MonthKey {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + count, 1));
  return date.toISOString().slice(0, 7);
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const round1 = (value: number) => Math.round(value * 10) / 10;

/** Average of the measure over the months given (offsets from `month`), or null if too few months have data. */
export function windowAverage(sme: ImpactSme, month: MonthKey, offsets: number[], minMonths: number): number | null {
  const values = offsets
    .map((offset) => sme.values[addMonths(month, offset)])
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  return values.length >= minMonths ? mean(values) : null;
}

/**
 * Change in the window average: a percentage for revenue (null on a zero
 * baseline), a plain difference for jobs. Null without enough months either side.
 */
export function windowChange(sme: ImpactSme, month: MonthKey, settings: ImpactSettings, metric: ImpactMetric = "revenue"): number | null {
  const before = windowAverage(sme, month, settings.beforeMonths, settings.minMonthsEachSide);
  const after = windowAverage(sme, month, settings.afterMonths, settings.minMonthsEachSide);
  if (before === null || after === null) return null;
  if (IMPACT_METRICS[metric].change === "absolute") return after - before;
  if (before <= 0) return null;
  return ((after - before) / before) * 100;
}

/** Deterministic random numbers so a rerun on the same data gives the same range. */
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 90% range of the mean, by resampling the SMEs with replacement. */
export function resampleRange(values: number[], resamples: number, seed: number): [number, number] | null {
  if (values.length < 2) return null;
  const random = seededRandom(seed);
  const means: number[] = [];
  for (let i = 0; i < resamples; i += 1) {
    let sum = 0;
    for (let j = 0; j < values.length; j += 1) sum += values[Math.floor(random() * values.length)];
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(resamples * 0.05)], means[Math.min(resamples - 1, Math.floor(resamples * 0.95))]];
}

/** Low / middle / high band of the measure, split at the terciles of the baselines given. */
export function bandOf(value: number, baselines: number[]): number {
  const sorted = [...baselines].sort((a, b) => a - b);
  if (!sorted.length) return 1;
  const low = sorted[Math.floor(sorted.length / 3)];
  const high = sorted[Math.floor((sorted.length * 2) / 3)];
  return value < low ? 0 : value < high ? 1 : 2;
}

/* --------------------------------------------------------------------- core */

type Unit = { sme: ImpactSme; treatment: ImpactTreatment; change: number; effect: number; level: keyof ImpactResult["matching"] };

export function measureIntervention(
  programId: string,
  interventionId: string,
  smes: ImpactSme[],
  treatments: ImpactTreatment[],
  settings: ImpactSettings = DEFAULT_IMPACT_SETTINGS,
  metric: ImpactMetric = "revenue"
): ImpactResult {
  const cohort = smes.filter((sme) => sme.programId === programId);
  const byId = new Map(cohort.map((sme) => [sme.id, sme]));
  const forThis = treatments.filter((row) => row.programId === programId && row.interventionId === interventionId);
  const title = forThis[0]?.interventionTitle || interventionId;

  // Each SME counts once, at its first completion of this intervention.
  const firstMonth = new Map<string, ImpactTreatment>();
  for (const row of forThis) {
    const current = firstMonth.get(row.participantId);
    if (!current || row.month < current.month) firstMonth.set(row.participantId, row);
  }

  const lastAfter = Math.max(...settings.afterMonths);
  const units: Unit[] = [];
  const comparisonIds = new Set<string>();
  let treatedWithoutData = 0;
  const matching = { sectorAndBand: 0, sector: 0, programme: 0 };

  for (const treatment of firstMonth.values()) {
    const sme = byId.get(treatment.participantId);
    const change = sme ? windowChange(sme, treatment.month, settings, metric) : null;
    if (!sme || change === null) {
      treatedWithoutData += 1;
      continue;
    }

    // Comparison SMEs: same programme, not yet given this intervention by the end of
    // the window, with the measure on both sides of the same calendar months.
    const windowEnd = addMonths(treatment.month, lastAfter);
    const candidates = cohort
      .filter((other) => other.id !== sme.id)
      .filter((other) => {
        const theirs = firstMonth.get(other.id);
        return !theirs || theirs.month > windowEnd;
      })
      .map((other) => ({
        other,
        change: windowChange(other, treatment.month, settings, metric),
        baseline: windowAverage(other, treatment.month, settings.beforeMonths, settings.minMonthsEachSide),
      }))
      .filter((row): row is { other: ImpactSme; change: number; baseline: number } => row.change !== null && row.baseline !== null);
    if (!candidates.length) {
      treatedWithoutData += 1;
      continue;
    }

    const baseline = windowAverage(sme, treatment.month, settings.beforeMonths, settings.minMonthsEachSide) as number;
    const baselines = [baseline, ...candidates.map((row) => row.baseline)];
    const band = bandOf(baseline, baselines);
    const sameSector = candidates.filter((row) => row.other.sector && row.other.sector === sme.sector);
    const sameBand = sameSector.filter((row) => bandOf(row.baseline, baselines) === band);

    let level: Unit["level"];
    let chosen: typeof candidates;
    if (sameBand.length >= 3) {
      level = "sectorAndBand";
      chosen = sameBand;
    } else if (sameSector.length >= 3) {
      level = "sector";
      chosen = sameSector;
    } else {
      level = "programme";
      chosen = candidates;
    }
    matching[level] += 1;
    chosen.forEach((row) => comparisonIds.add(row.other.id));
    const comparisonChange = mean(chosen.map((row) => row.change));
    units.push({ sme, treatment, change, effect: change - comparisonChange, level });
  }

  const treatedCount = units.length;
  const comparisonCount = comparisonIds.size;
  const status: ImpactStatus =
    treatedCount >= settings.minTreated && comparisonCount >= settings.minControls
      ? "reportable"
      : treatedCount >= settings.earlyMin && comparisonCount >= settings.earlyMin
        ? "early"
        : "insufficient";

  const effects = units.map((unit) => unit.effect);
  const lift = effects.length ? mean(effects) : null;
  const range = resampleRange(effects, settings.resamples, settings.seed);
  const treatedChange = units.length ? mean(units.map((unit) => unit.change)) : null;

  // Other interventions completed by the same SME inside this window share the credit.
  const overlapping = units.filter((unit) => treatments.some((row) =>
    row.participantId === unit.sme.id &&
    row.interventionId !== interventionId &&
    row.month >= addMonths(unit.treatment.month, Math.min(...settings.beforeMonths)) &&
    row.month <= addMonths(unit.treatment.month, lastAfter)
  )).length;

  const split = (predicate: (unit: Unit) => boolean) => {
    const group = units.filter(predicate);
    return { count: group.length, liftPercent: group.length >= 3 ? round1(mean(group.map((unit) => unit.effect))) : null };
  };

  const months = units.map((unit) => unit.treatment.month).sort();
  const period = months.length ? { from: months[0], to: months[months.length - 1] } : null;
  const demo = units.some((unit) => unit.sme.synthetic) ||
    [...comparisonIds].some((id) => byId.get(id)?.synthetic);

  const result: ImpactResult = {
    programId,
    interventionId,
    interventionTitle: title,
    metric,
    unit: IMPACT_METRICS[metric].unit,
    status,
    liftPercent: lift === null ? null : round1(lift),
    rangeLowPercent: range ? round1(range[0]) : null,
    rangeHighPercent: range ? round1(range[1]) : null,
    treatedChangePercent: treatedChange === null ? null : round1(treatedChange),
    comparisonChangePercent: treatedChange === null || lift === null ? null : round1(treatedChange - lift),
    treatedCount,
    comparisonCount,
    treatedWithoutData,
    matching,
    overlapShare: treatedCount ? round1(overlapping / treatedCount) : 0,
    byOutcome: {
      achieved: split((unit) => unit.treatment.outcome === "achieved"),
      notAchieved: split((unit) => unit.treatment.outcome === "not_yet" || unit.treatment.outcome === "partial"),
    },
    period,
    demo,
    headline: null,
  };
  result.headline = impactHeadline(result);
  return result;
}

const monthLabel = (month: MonthKey) => {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [year, value] = month.split("-").map(Number);
  return `${names[value - 1]} ${year}`;
};

const signedPoints = (value: number) => `${value > 0 ? "+" : ""}${value}`;

/** The one line a funder may read. Only for reportable results; always "linked to", never "caused". */
export function impactHeadline(result: ImpactResult): string | null {
  if (result.status !== "reportable" || result.liftPercent === null || !result.period) return null;
  const metric = result.metric || "revenue";
  const size = Math.abs(result.liftPercent);
  const unit = metric === "jobs" ? "jobs" : "points";
  // A range that includes zero means no difference can't be ruled out, however large the estimate.
  const crossesZero = result.rangeLowPercent !== null && result.rangeHighPercent !== null &&
    result.rangeLowPercent <= 0 && result.rangeHighPercent >= 0;
  let finding: string;
  if (crossesZero || size < IMPACT_METRICS[metric].noDifference) {
    finding = `linked to no clear difference in ${metric === "jobs" ? "jobs" : "revenue growth"} against similar SMEs`;
  } else if (metric === "jobs") {
    finding = `linked to ${size} ${result.liftPercent > 0 ? "more" : "fewer"} job${size === 1 ? "" : "s"} per SME than similar SMEs`;
  } else {
    finding = `linked to revenue growth ${size} percentage points ${result.liftPercent > 0 ? "above" : "below"} similar SMEs`;
  }
  // A range only means something when the SMEs differed; seeded cohorts can all move alike.
  const range = result.rangeLowPercent !== null && result.rangeHighPercent !== null && result.rangeLowPercent !== result.rangeHighPercent
    ? `; likely range ${signedPoints(result.rangeLowPercent)} to ${signedPoints(result.rangeHighPercent)} ${unit}`
    : "";
  const when = result.period.from === result.period.to
    ? `in ${monthLabel(result.period.from)}`
    : `${monthLabel(result.period.from)}–${monthLabel(result.period.to)}`;
  return `${result.interventionTitle}: ${finding} ` +
    `(${result.treatedCount} SMEs completing it ${when}${range}).`;
}

/** Every (programme, intervention) pair with at least one completion, for one measure. */
export function measureAll(
  smes: ImpactSme[],
  treatments: ImpactTreatment[],
  settings: ImpactSettings = DEFAULT_IMPACT_SETTINGS,
  metric: ImpactMetric = "revenue"
) {
  const pairs = new Map<string, { programId: string; interventionId: string }>();
  treatments.forEach((row) => pairs.set(`${row.programId}__${row.interventionId}`, { programId: row.programId, interventionId: row.interventionId }));
  return [...pairs.values()].map((pair) => measureIntervention(pair.programId, pair.interventionId, smes, treatments, settings, metric));
}
