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

export type AgentChatMessage = {
  id: string
  role: 'user' | 'agent'
  content: string
  rateable?: boolean
  rating?: number
  proposal?: AgentProposal
  proposalStatus?: AgentProposalStatus
  proposalNote?: string
}
