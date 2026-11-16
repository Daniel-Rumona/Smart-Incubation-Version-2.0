import { Timestamp, collection, onSnapshot, query, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'

/*
 * The user's own watches and chasers (`agentWatches`). They are created by the agent once the user
 * confirms (ai-backend/agent_watches.py) and checked nightly (functions/src/agentWatches.ts). The browser
 * only reads them; stopping goes through stopAgentWatch in agentService.
 */

export type AgentWatchStatus = 'active' | 'done' | 'stopped' | 'expired'

export type AgentWatchSummary = {
  id: string
  kind: 'watch' | 'chaser'
  status: AgentWatchStatus
  title: string
  request: string
  /** When the watch stops, or the chaser's deadline. */
  endsAt: string | null
  lastRunAt: string | null
  createdAt: string | null
  /** Chasers: how many of the items are done. */
  done?: number
  total?: number
  goal?: 'accepted' | 'completed'
  nudgesEach?: number
  escalation?: string
}

const iso = (value: unknown) => (value instanceof Timestamp ? value.toDate().toISOString() : null)

export const subscribeMyAgentWatches = (uid: string, onWatches: (watches: AgentWatchSummary[]) => void, onError?: (error: Error) => void) =>
  onSnapshot(
    query(collection(getFirebaseDb(), 'agentWatches'), where('uid', '==', uid)),
    (snapshot) => onWatches(snapshot.docs.map((record): AgentWatchSummary => {
      const data = record.data()
      const items = Array.isArray(data.items) ? data.items as Array<{ done?: boolean }> : []
      return {
        id: record.id,
        kind: data.kind === 'chaser' ? 'chaser' : 'watch' as const,
        status: (['active', 'done', 'stopped', 'expired'].includes(data.status) ? data.status : 'active') as AgentWatchStatus,
        title: String(data.title || 'Watch'),
        request: String(data.request || ''),
        endsAt: iso(data.dueAt) || iso(data.endsAt),
        lastRunAt: iso(data.lastRunAt),
        createdAt: iso(data.createdAt),
        ...(data.kind === 'chaser' ? {
          done: items.filter((item) => item.done).length,
          total: items.length,
          goal: data.goal === 'completed' ? 'completed' as const : 'accepted' as const,
          nudgesEach: Number(data.nudgesEach) || 2,
          escalation: String(data.escalation?.status || 'none'),
        } : {}),
      }
    }).sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''))),
    (error) => onError?.(error),
  )
