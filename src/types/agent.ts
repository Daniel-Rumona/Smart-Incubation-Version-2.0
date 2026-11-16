export type AgentCrudAction = {
  key: string
  label: string
  description: string
  requiresConfirmation?: boolean
}

export type AgentPageContext = {
  pageKey: string
  pageName: string
  purpose: string
  currentFilters?: Record<string, unknown>
  metrics?: Record<string, unknown>
  dataSummary?: Record<string, unknown>
  allowedActions?: AgentCrudAction[]
  /** Who is asking, so the assistant greets them by their own name (never one from the data). */
  viewer?: { name?: string, role?: string, companyCode?: string }
  updatedAt: string
}

export type AgentProposalSummaryRow = {
  label: string
  value: string
}

/** A write the assistant has prepared but not performed. Nothing happens until the user confirms it. */
export type AgentProposal = {
  id: string
  tool: string
  title: string
  summary: AgentProposalSummaryRow[]
  warnings: string[]
  expiresAt: string
  requiresConfirmation: boolean
}

export type AgentProposalStatus = 'pending' | 'confirming' | 'executed' | 'cancelled' | 'failed'

/**
 * A card the nightly watch run posts into the chat (functions/src/agentWatches.ts): a watch that fired,
 * a chaser's progress, or a chaser asking whether to escalate.
 */
export type AgentWatchCardType = 'watch_fired' | 'chaser_progress' | 'chaser_done' | 'chaser_escalation' | 'watch_ended'

export type AgentWatchCardItem = {
  label: string
  detail?: string
  /** done: finished; waiting: still outstanding; nudged: a reminder went out this run; stuck: out of nudges. */
  state?: 'done' | 'waiting' | 'nudged' | 'stuck' | 'match'
}

export type AgentWatchCard = {
  type: AgentWatchCardType
  watchId: string
  title: string
  body?: string
  items?: AgentWatchCardItem[]
  /** Chaser escalation: what the user decided, once they have. */
  response?: 'escalated' | 'declined'
}

export type AgentChatMessage = {
  id: string
  role: 'user' | 'agent'
  content: string
  /** When it was saved; messages older than 24 hours are not shown or sent as context. */
  createdAt?: string
  card?: AgentWatchCard
  /** An agent reply still being worked on (shown as "thinking"); cleared when the result or error arrives. */
  pending?: boolean
  rateable?: boolean
  rating?: number
  proposal?: AgentProposal
  proposalStatus?: AgentProposalStatus
  proposalNote?: string
}
