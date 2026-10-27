import { collection, getDocs } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'

export type AgentRatingCategory = 'Intervention agent' | 'System agent' | 'WhatsApp bot'

export type AgentRatingRecord = {
  id: string
  agentId: string
  agentName: string
  category: AgentRatingCategory
  channel: string
  rating: number
  companyCode: string
  userUid: string
  context: string
  createdAt?: Date
}

export const listAgentRatings = async (user: FullIdentity): Promise<AgentRatingRecord[]> => {
  if (user.role !== 'systemadmin') throw new Error('forbidden')
  const snapshot = await getDocs(collection(getFirebaseDb(), 'agentConversationRatings'))
  return snapshot.docs.flatMap(record => {
    const data = record.data()
    const rating = Number(data.rating)
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) return []
    const whatsapp = data.channel === 'whatsapp' || data.agentId === 'whatsapp-bot'
    const intervention = !whatsapp && (data.agentType === 'intervention' || data.assignmentId || data.interventionTitle)
    const category: AgentRatingCategory = whatsapp ? 'WhatsApp bot' : intervention ? 'Intervention agent' : 'System agent'
    return [{
      id: record.id,
      agentId: String(data.agentId || (whatsapp ? 'whatsapp-bot' : intervention ? 'legacy-intervention-agent' : 'workspace-assistant')),
      agentName: String(data.agentName || (whatsapp ? 'WhatsApp Bot' : intervention ? data.interventionTitle || 'Intervention Agent' : 'Workspace Assistant')),
      category,
      channel: String(data.channel || (whatsapp ? 'whatsapp' : 'web')),
      rating,
      companyCode: String(data.companyCode || ''),
      userUid: String(data.userUid || data.participantId || ''),
      context: String(data.interventionTitle || data.pageName || data.pageKey || ''),
      createdAt: data.createdAt?.toDate?.(),
    }]
  }).sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
}
