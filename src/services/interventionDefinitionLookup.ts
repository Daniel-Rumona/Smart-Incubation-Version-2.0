import { doc, getDoc, type Firestore } from 'firebase/firestore'

/**
 * Plan items and assignments point at a definition by `interventionId`, but two companies can use the same id
 * (for example both run "business-plan-refresh") while defining it differently. A company's own definition lives in
 * `interventions/<COMPANY>__<interventionId>`. Lookup order:
 *   1. the company's own definition (`<COMPANY>__<id>`),
 *   2. the plain `interventions/<id>` document (definitions created before company ids existed).
 */
export const companyDefinitionId = (companyCode: string | undefined | null, interventionId: string) => {
  const company = String(companyCode || '').trim().toUpperCase()
  return company ? `${company}__${interventionId}` : ''
}

export type DefinitionRef = { interventionId: string; companyCode?: string | null }

export type DefinitionIndex = {
  /** The definition for an intervention, or undefined when neither lookup finds one. */
  get: (interventionId: string, companyCode?: string | null) => Record<string, unknown> | undefined
}

export const loadDefinitions = async (db: Firestore, refs: DefinitionRef[]): Promise<DefinitionIndex> => {
  const wanted = new Set<string>()
  refs.forEach(({ interventionId, companyCode }) => {
    if (!interventionId) return
    wanted.add(interventionId)
    const scoped = companyDefinitionId(companyCode, interventionId)
    if (scoped) wanted.add(scoped)
  })
  const snapshots = await Promise.all([...wanted].map(id => getDoc(doc(db, 'interventions', id))))
  const byDocumentId = new Map<string, Record<string, unknown>>(
    snapshots.filter(snapshot => snapshot.exists()).map(snapshot => [snapshot.id, snapshot.data() as Record<string, unknown>]),
  )

  return {
    get: (interventionId, companyCode) => {
      const scoped = companyDefinitionId(companyCode, interventionId)
      return (scoped ? byDocumentId.get(scoped) : undefined) || byDocumentId.get(interventionId)
    },
  }
}
