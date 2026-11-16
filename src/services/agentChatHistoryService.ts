import {
  Timestamp,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import type { AgentChatMessage, AgentProposalStatus, AgentWatchCard } from '@/types/agent'

/*
 * The AI page chat, saved in `agentChatMessages`. Everything is kept; the user sees (and the agent is
 * sent as context) only the last 24 hours. The browser writes the user's own turns and the agent's
 * replies; the nightly watch run (Admin SDK) adds watch and chaser cards. See firestore.rules.
 */

export const AGENT_CHAT_COLLECTION = 'agentChatMessages'
export const AGENT_CHAT_WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_LOADED = 200

type StoredMessage = {
  uid: string
  role: 'user' | 'agent'
  content?: string
  createdAt?: Timestamp | null
  proposal?: AgentChatMessage['proposal']
  proposalStatus?: AgentProposalStatus
  proposalNote?: string
  card?: AgentWatchCard
}

const toMessage = (id: string, data: StoredMessage): AgentChatMessage => ({
  id,
  role: data.role === 'user' ? 'user' : 'agent',
  content: String(data.content || ''),
  createdAt: data.createdAt?.toDate?.().toISOString(),
  ...(data.proposal ? { proposal: data.proposal, proposalStatus: data.proposalStatus || 'pending' } : {}),
  ...(data.proposalNote ? { proposalNote: data.proposalNote } : {}),
  ...(data.card ? { card: data.card } : {}),
})

/** Within the 24-hour window (messages without a time yet are the ones being written now). */
export const isWithinChatWindow = (message: AgentChatMessage, now = Date.now()) =>
  !message.createdAt || now - new Date(message.createdAt).getTime() <= AGENT_CHAT_WINDOW_MS

/**
 * The last 24 hours of this user's chat, live: saved turns and any watch or chaser cards posted since.
 * Errors (offline, missing index) leave the chat empty rather than breaking the page.
 */
export const subscribeRecentAgentChat = (
  uid: string,
  onMessages: (messages: AgentChatMessage[]) => void,
) => {
  const since = Timestamp.fromMillis(Date.now() - AGENT_CHAT_WINDOW_MS)
  const recent = query(
    collection(getFirebaseDb(), AGENT_CHAT_COLLECTION),
    where('uid', '==', uid),
    where('createdAt', '>=', since),
    orderBy('createdAt', 'asc'),
    limit(MAX_LOADED),
  )
  return onSnapshot(
    recent,
    (snapshot) => onMessages(snapshot.docs.map((record) => toMessage(record.id, record.data() as StoredMessage))),
    (error) => console.warn('[AGENT CHAT] History could not be loaded', error),
  )
}

/** Save one finished turn. The id is the message's own, so the live listener recognises it. */
export const saveAgentChatMessage = async (
  uid: string,
  companyCode: string | null | undefined,
  message: AgentChatMessage,
) => {
  if (message.pending) return
  try {
    await setDoc(doc(getFirebaseDb(), AGENT_CHAT_COLLECTION, message.id), {
      uid,
      companyCode: companyCode || null,
      role: message.role,
      content: message.content.slice(0, 19000),
      createdAt: serverTimestamp(),
      ...(message.proposal ? { proposal: message.proposal, proposalStatus: message.proposalStatus || 'pending' } : {}),
    })
  } catch (error) {
    console.warn('[AGENT CHAT] Message could not be saved', error)
  }
}

/** Record what happened to a proposal (confirmed, cancelled, failed) on its saved message. */
export const saveAgentProposalStatus = async (messageId: string, proposalStatus: AgentProposalStatus, proposalNote?: string) => {
  try {
    await updateDoc(doc(getFirebaseDb(), AGENT_CHAT_COLLECTION, messageId), {
      proposalStatus,
      proposalNote: proposalNote || null,
    })
  } catch (error) {
    console.warn('[AGENT CHAT] Proposal status could not be saved', error)
  }
}
