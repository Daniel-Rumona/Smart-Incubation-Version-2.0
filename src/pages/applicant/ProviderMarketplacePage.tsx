import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { App, Alert, Avatar, Button, Card, Col, DatePicker, Descriptions, Empty, Form, Input, InputNumber, Modal, Pagination, Row, Segmented, Select, Space, Tag, Typography } from 'antd'
import { BulbOutlined, CheckCircleOutlined, CloseOutlined, RobotOutlined, SearchOutlined, SendOutlined, UnorderedListOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import DashboardHeader from '@/components/shared/DashboardHeader'
import DashboardPage from '@/components/shared/DashboardPage'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listActiveAgents } from '@/services/agentRegistryService'
import { loadSavedSuggestions, matchToSteps, requestSuggestions, suggestionsAvailable, type SavedSuggestions, type SuggestedStep } from '@/services/roadmapSuggestionsService'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { listPublishedConsultants } from '@/services/consultantMarketplaceService'
import { acceptConnectionPlan, askForPlanChanges, createConnectionRequest, declineConnectionRequest, lastMessage, listConnectionRequestsForSme, sendConnectionMessage, subscribeToConnectionRequestsForSme } from '@/services/connectionRequestService'
import { ConnectionThread, PlanSummary, connectionStatusColor, connectionStatusText, formatMoney } from '@/components/marketplace/ConnectionThread'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { isPlatformOwnerSme, resolveSmeCompanyCode } from '@/services/companiesService'
import type { ConsultantMarketplaceProfile } from '@/types/consultantMarketplace'
import type { AgentDefinition } from '@/types/agentOrchestration'
import type { ConnectionRequest, ConnectionRequestDeliveryMode, ConnectionRequestStatus, ConnectionRequestUrgency } from '@/types/connectionRequest'
import '@/styles/consultant.css'
import { useLanguage, tr, tEnglish } from '@/providers/LanguageProvider'
import { singleActionFooter } from '@/components/shared/modalFooter'
import { ModalActions } from '@/components/shared/ModalActions'

const { Text } = Typography
const PAGE_SIZE = 10

type ProviderView = 'consultants' | 'agents' | 'requests'
type RequestTarget = { type: 'consultant'; profile: ConsultantMarketplaceProfile } | { type: 'agent'; agent: AgentDefinition }

type RequestFormValues = {
  areaOfSupport: string
  deliveryMode: ConnectionRequestDeliveryMode
  preferredStartDate: Dayjs
  engagementDays?: number
  urgency: ConnectionRequestUrgency
  budget?: number
  note: string
}

const deliveryModeOptions = [
  { get label() { return tr('Online') }, value: 'online' },
  { get label() { return tr('In person') }, value: 'in_person' },
  { get label() { return tr('Hybrid') }, value: 'hybrid' },
  { get label() { return tr('No preference') }, value: 'no_preference' },
]

const urgencyOptions = [
  { get label() { return tr('Low - within the next quarter') }, value: 'low' },
  { get label() { return tr('Normal - within a month') }, value: 'normal' },
  { get label() { return tr('High - as soon as possible') }, value: 'high' },
]

// Agent requests are still handled by operations; consultant requests by the consultant (see ConnectionThread).
const agentStatusHelp: Record<ConnectionRequestStatus, string> = {
  pending: 'Waiting for the operations team to review your choice.',
  contacted: 'Operations has reached out to arrange the engagement.',
  proposed: 'Operations has proposed how to go ahead.',
  matched: 'You have been matched. The agent will work with you.',
  declined: 'This request was not taken further.',
}

const formatDate = (value: unknown) => {
  const date = (value as { toDate?: () => Date })?.toDate?.() ?? (value instanceof Date ? value : undefined)
  return date ? date.toLocaleDateString('en-ZA') : 'Just now'
}

const targetIdOf = (target: RequestTarget) => target.type === 'consultant' ? target.profile.uid : target.agent.id
const targetNameOf = (target: RequestTarget) => target.type === 'consultant'
  ? (target.profile.name || target.profile.headline)
  : target.agent.name


type Suggestion = { score: number; step?: SuggestedStep; target: RequestTarget }
type MatchLevel = 'strong' | 'good' | 'possible'

/** How much of a step a provider's offer covers: strong from 60% of its words, good from 35%, possible below. */
const matchLevel = (score: number): MatchLevel => (score >= 0.6 ? 'strong' : score >= 0.35 ? 'good' : 'possible')
const MATCH_LABELS: Record<MatchLevel, string> = { strong: 'Strong match', good: 'Good match', possible: 'Possible match' }

/** Three steps in one colour plus the words, so the strength never rests on colour alone. */
function MatchMeter({ level, compact = false }: { level: MatchLevel; compact?: boolean }) {
  const { t } = useLanguage()
  const filled = level === 'strong' ? 3 : level === 'good' ? 2 : 1
  return (
    <span className={`fs-meter is-${level}${compact ? ' is-compact' : ''}`}>
      <span className="fs-meter-bars" aria-hidden="true">{[0, 1, 2].map((index) => <i key={index} className={index < filled ? 'is-filled' : undefined} />)}</span>
      <span className="fs-meter-label">{t(MATCH_LABELS[level])}</span>
    </span>
  )
}

/** A consultant's photo or initials, or a robot for an AI agent. */
function ProviderAvatar({ target }: { target: RequestTarget }) {
  if (target.type === 'agent') return <Avatar className="fs-avatar is-agent" icon={<RobotOutlined />} />
  const { profile } = target
  const initials = (profile.name || profile.headline || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
  return <Avatar className="fs-avatar" src={profile.profileImageUrl || undefined}>{initials}</Avatar>
}
export default function ProviderMarketplacePage() {
  const { t } = useLanguage()
  const { user } = useFullIdentity()
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
  const [form] = Form.useForm<RequestFormValues>()
  const [view, setView] = useState<ProviderView>('consultants')
  const [consultants, setConsultants] = useState<ConsultantMarketplaceProfile[]>([])
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [myRequests, setMyRequests] = useState<ConnectionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [requestTarget, setRequestTarget] = useState<RequestTarget>()
  const [submitting, setSubmitting] = useState(false)
  const [openRequestId, setOpenRequestId] = useState<string | null>(null)
  const [changesFor, setChangesFor] = useState<ConnectionRequest | null>(null)
  const [changesText, setChangesText] = useState('')
  const [acting, setActing] = useState(false)
  const [params] = useSearchParams()

  // Opened from an email or notification link: ?view=requests&request={id}.
  useEffect(() => {
    if (params.get('view') === 'requests') setView('requests')
    // From the roadmap's "Find a consultant": start with that area searched.
    const searched = params.get('q')
    if (searched) setSearch(searched)
    const linked = params.get('request')
    if (linked) setOpenRequestId(linked)
  }, [params])

  const uid = user?.uid
  const loadRequests = useCallback(async () => {
    if (!uid) return
    setMyRequests(await listConnectionRequestsForSme(uid))
  }, [uid])

  useEffect(() => {
    Promise.all([listPublishedConsultants(), listActiveAgents(), uid ? listConnectionRequestsForSme(uid) : Promise.resolve([])])
      .then(([consultantRows, agentRows, requestRows]) => {
        setConsultants(consultantRows)
        setAgents(agentRows)
        setMyRequests(requestRows)
      })
      .catch(() => message.error(t('Consultants and agents could not be loaded right now.')))
      .finally(() => setLoading(false))
  }, [message, uid, t])

  // Keep Requests and an open conversation live while either party is looking at it.
  useEffect(() => {
    if (!uid) return
    return subscribeToConnectionRequestsForSme(uid, setMyRequests)
  }, [uid])

  const openRequestIds = useMemo(
    () => new Set(myRequests.filter((row) => row.status === 'pending' || row.status === 'contacted' || row.status === 'proposed').map((row) => row.targetId)),
    [myRequests],
  )

  const filteredConsultants = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return consultants
    return consultants.filter((profile) => {
      const text = `${profile.headline} ${profile.bio} ${profile.specialties.join(' ')}`.toLowerCase()
      return text.includes(term)
    })
  }, [consultants, search])

  const filteredAgents = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return agents
    return agents.filter((agent) => `${agent.name} ${agent.description} ${agent.capabilities.join(' ')}`.toLowerCase().includes(term))
  }, [agents, search])

  const pagedConsultants = filteredConsultants.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  /** The support areas a target can actually deliver, so the SME picks from real offers instead of typing one. */
  const supportOptions = useMemo(() => {
    if (!requestTarget) return []
    const values = requestTarget.type === 'consultant'
      ? requestTarget.profile.services.map((service) => service.areaOfSupport).filter(Boolean)
      : requestTarget.agent.capabilities
    return Array.from(new Set(values)).map((value) => ({ label: value, value }))
  }, [requestTarget])

  const currency = requestTarget?.type === 'consultant' ? (requestTarget.profile.currency || 'ZAR') : 'ZAR'

  const openRequest = (target: RequestTarget) => {
    setRequestTarget(target)
    const firstService = target.type === 'consultant' ? target.profile.services[0] : undefined
    form.setFieldsValue({
      areaOfSupport: firstService?.areaOfSupport || (target.type === 'agent' ? target.agent.capabilities[0] : undefined),
      deliveryMode: (firstService?.deliveryMode as ConnectionRequestDeliveryMode) || 'no_preference',
      preferredStartDate: dayjs().add(7, 'day'),
      engagementDays: undefined,
      urgency: 'normal',
      budget: user?.consultingBudget,
      note: '',
    } as RequestFormValues)
  }

  // "Not sure who can help?" The SME says what's holding the business back; the AI suggests steps (the same answer
  // the roadmap uses), and the consultants and agents whose offer matches those steps are suggested here.
  const [challenge, setChallenge] = useState('')
  const [suggested, setSuggested] = useState<SavedSuggestions | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [editingChallenge, setEditingChallenge] = useState(false)
  useEffect(() => {
    if (!uid) return
    let active = true
    loadSavedSuggestions(uid)
      .then((saved) => { if (active && saved) { setSuggested(saved); setChallenge(saved.challenge) } })
      .catch(() => undefined)
    return () => { active = false }
  }, [uid])
  const suggestWho = async () => {
    if (!user || !challenge.trim()) return
    setSuggesting(true)
    try {
      setSuggested(await requestSuggestions(user, challenge))
      setEditingChallenge(false)
    } catch {
      message.error(t('Suggestions couldn’t be made just now. Try again in a moment.'))
    } finally {
      setSuggesting(false)
    }
  }
  // Suggestions ranked by how well each offer matches the AI's steps (or just the step the SME picked).
  const [stepFilter, setStepFilter] = useState<string | null>(null)
  const consultantText = (profile: ConsultantMarketplaceProfile) => [
    profile.headline, profile.bio, profile.specialties.join(' '),
    ...profile.services.map((service) => `${service.areaOfSupport} ${service.interventionExamples.join(' ')}`),
  ].join(' ')
  const agentText = (agent: AgentDefinition) => `${agent.name} ${agent.description} ${agent.capabilities.join(' ')}`
  const suggestions = useMemo<Suggestion[]>(() => {
    const steps = (suggested?.items || []).filter((step) => !stepFilter || step.title === stepFilter)
    if (!steps.length) return []
    const people = consultants
      .map((profile) => ({ ...matchToSteps(consultantText(profile), steps), target: { type: 'consultant' as const, profile } }))
      .filter((row) => row.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
    const bots = agents
      .map((agent) => ({ ...matchToSteps(agentText(agent), steps), target: { type: 'agent' as const, agent } }))
      .filter((row) => row.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 2)
    return [...people, ...bots].sort((left, right) => right.score - left.score)
  }, [agents, consultants, stepFilter, suggested]) // eslint-disable-line react-hooks/exhaustive-deps
  // How strong each browse row's match is, so the list can show it too.
  const matchFor = useMemo(() => new Map(suggestions.map((row) => [targetIdOf(row.target), row])), [suggestions])

  // "Use this plan": every step with its best-matched helper, changeable or removable; steps given to the same
  // helper go out as one request, so a consultant replies with one priced plan covering them all.
  type PlanRow = { step: SuggestedStep; targetId: string | null; removed: boolean }
  const [planOpen, setPlanOpen] = useState(false)
  const [planRows, setPlanRows] = useState<PlanRow[]>([])
  const [planSending, setPlanSending] = useState(false)
  const [planSent, setPlanSent] = useState<Array<{ target: RequestTarget; steps: string[] }> | null>(null)
  const allTargets = useMemo<RequestTarget[]>(() => [
    ...consultants.map((profile) => ({ type: 'consultant' as const, profile })),
    ...agents.map((agent) => ({ type: 'agent' as const, agent })),
  ], [agents, consultants])
  const targetById = useMemo(() => new Map(allTargets.map((target) => [targetIdOf(target), target])), [allTargets])
  const textOf = (target: RequestTarget) => (target.type === 'consultant' ? consultantText(target.profile) : agentText(target.agent))
  /** Everyone ranked for one step: best first, then the rest. */
  const rankedFor = (step: SuggestedStep) => allTargets
    .map((target) => ({ target, score: matchToSteps(textOf(target), [step]).score }))
    .sort((left, right) => right.score - left.score)
  const openPlan = () => {
    const rows = (suggested?.items || []).map((step) => {
      const best = rankedFor(step)[0]
      return { step, targetId: best && best.score > 0 ? targetIdOf(best.target) : null, removed: false }
    })
    setPlanRows(rows)
    setPlanSent(null)
    setPlanOpen(true)
  }
  const updatePlanRow = (index: number, change: Partial<PlanRow>) =>
    setPlanRows((rows) => rows.map((row, at) => (at === index ? { ...row, ...change } : row)))
  // One group per helper; helpers already asked are shown but not sent again.
  const planGroups = useMemo(() => {
    const groups = new Map<string, { target: RequestTarget; steps: SuggestedStep[]; alreadyAsked: boolean }>()
    planRows.filter((row) => !row.removed && row.targetId).forEach((row) => {
      const target = targetById.get(row.targetId as string)
      if (!target) return
      const id = targetIdOf(target)
      const group = groups.get(id) || { target, steps: [], alreadyAsked: openRequestIds.has(id) }
      group.steps.push(row.step)
      groups.set(id, group)
    })
    return [...groups.values()]
  }, [openRequestIds, planRows, targetById])
  const groupsToSend = planGroups.filter((group) => !group.alreadyAsked)
  const unassignedSteps = planRows.filter((row) => !row.removed && !row.targetId).length

  const sendPlan = async () => {
    if (!user || !groupsToSend.length) return
    setPlanSending(true)
    const sent: Array<{ target: RequestTarget; steps: string[] }> = []
    try {
      for (const group of groupsToSend) {
        const titles = group.steps.map((step) => step.title)
        await createConnectionRequest({
          smeUid: user.uid,
          smeName: user.displayName || user.name || user.email,
          smeEmail: user.email,
          targetType: group.target.type,
          targetId: targetIdOf(group.target),
          targetName: targetNameOf(group.target),
          companyCode: resolveSmeCompanyCode(user),
          areaOfSupport: group.steps[0].areaOfSupport || group.steps[0].title,
          deliveryMode: 'no_preference',
          preferredStartDate: dayjs().add(7, 'day').format('YYYY-MM-DD'),
          urgency: 'normal',
          currency: group.target.type === 'consultant' ? group.target.profile.currency || 'ZAR' : 'ZAR',
          note: [
            titles.length === 1 ? tEnglish('I’d like help with this step from my plan:') : tEnglish('I’d like help with these steps from my plan:'),
            ...titles.map((title) => `• ${title}`),
            '',
            suggested?.challenge || '',
          ].join('\n').trim(),
          planSteps: titles,
        })
        sent.push({ target: group.target, steps: titles })
      }
      setPlanSent(sent)
      await loadRequests()
    } catch (error) {
      if (sent.length) setPlanSent(sent)
      message.error(error instanceof Error ? error.message : t('Some requests couldn’t be sent. Try the rest again.'))
    } finally {
      setPlanSending(false)
    }
  }

  // Thuso (the page helper) sees who's on offer and what the SME said, so it can recommend someone too.
  useRegisterAgentPageContext({
    pageKey: 'sme-marketplace',
    pageName: 'Find support',
    purpose: 'Help the SME choose a consultant or AI agent for what is holding the business back, then send them a request.',
    currentFilters: { view, search },
    metrics: { consultants: consultants.length, agents: agents.length, openRequests: openRequestIds.size },
    dataSummary: {
      challenge: suggested?.challenge || null,
      suggestedSteps: (suggested?.items || []).map((item) => ({ title: item.title, area: item.areaOfSupport, why: item.reason })),
      consultants: consultants.slice(0, 40).map((profile) => ({
        name: profile.name,
        headline: profile.headline,
        areas: profile.services.map((service) => service.areaOfSupport),
        specialties: profile.specialties,
        deliveryModes: [...new Set(profile.services.map((service) => service.deliveryMode))],
        dayRateFrom: profile.services[0]?.rate ?? null,
        currency: profile.currency,
        location: [profile.operatingLocation, profile.province].filter(Boolean).join(', '),
      })),
      agents: agents.map((agent) => ({ name: agent.name, description: agent.description, capabilities: agent.capabilities })),
    },
    allowedActions: [],
    updatedAt: new Date().toISOString(),
  })

  const closeRequest = () => {
    setRequestTarget(undefined)
    form.resetFields()
  }

  const submitRequest = async () => {
    if (!user || !requestTarget) return
    let values: RequestFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    setSubmitting(true)
    try {
      await createConnectionRequest({
        smeUid: user.uid,
        smeName: user.displayName || user.name || user.email,
        smeEmail: user.email,
        targetType: requestTarget.type,
        targetId: targetIdOf(requestTarget),
        targetName: targetNameOf(requestTarget),
        companyCode: resolveSmeCompanyCode(user),
        areaOfSupport: values.areaOfSupport,
        deliveryMode: values.deliveryMode,
        preferredStartDate: values.preferredStartDate?.format('YYYY-MM-DD'),
        engagementDays: values.engagementDays,
        urgency: values.urgency,
        budget: values.budget,
        currency,
        note: values.note,
      })
      message.success(requestTarget.type === 'consultant'
        ? t('Request sent. {name} will reply here, and we’ll let you know by email.', undefined, { name: requestTarget.profile.name || targetNameOf(requestTarget) })
        : t('Request sent. Our operations team will follow up with you.'))
      closeRequest()
      await loadRequests()
      setView('requests')
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('Your request could not be sent.'))
    } finally {
      setSubmitting(false)
    }
  }

  const openedRequest = myRequests.find((row) => row.id === openRequestId) || null
  const act = async (action: () => Promise<unknown>, success?: string) => {
    setActing(true)
    try {
      await action()
      if (success) message.success(success)
      await loadRequests()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('That could not be saved.'))
    } finally {
      setActing(false)
    }
  }
  const confirmAccept = (request: ConnectionRequest) => modal.confirm({
    title: t('Accept {name}’s plan?', undefined, { name: request.targetName }),
    content: t('{count} interventions start with {name}, totalling {total}. You arrange payment with them directly.', undefined, {
      count: request.plan?.items.length || 0,
      name: request.targetName,
      total: formatMoney(request.plan?.total || 0, request.plan?.currency),
    }),
    okText: t('Accept plan'),
    onOk: () => act(() => acceptConnectionPlan(request.id), t('Plan accepted. Your consultant can start.')),
  })
  const confirmDecline = (request: ConnectionRequest) => {
    let reason = ''
    modal.confirm({
      title: t('Decline this plan?'),
      content: <Input.TextArea rows={3} maxLength={500} placeholder={t('Let {name} know why (optional).', undefined, { name: request.targetName })} onChange={(event) => { reason = event.target.value }} />,
      okText: t('Decline'),
      okButtonProps: { danger: true },
      onOk: () => user && act(() => declineConnectionRequest(request, user, 'sme', reason), t('Plan declined.')),
    })
  }


  /** The service area (consultant) or capability (agent) that best fits a step, to say why it's suggested. */
  const offerFor = (target: RequestTarget, step: SuggestedStep) => {
    const offers = target.type === 'consultant'
      ? target.profile.services.map((service) => service.areaOfSupport).concat(target.profile.specialties)
      : target.agent.capabilities
    const ranked = offers.filter(Boolean).map((offer) => ({ offer, ...matchToSteps(offer, [step]) })).sort((left, right) => right.score - left.score)
    return ranked[0]?.score ? ranked[0].offer : offers[0] || ''
  }
  const modeLabel = (mode: string) => (mode === 'in_person' ? t('in person') : mode === 'hybrid' ? t('hybrid') : t('online'))
  /** The practical facts an SME compares: price, where, and how it's delivered. */
  const factsFor = (target: RequestTarget) => {
    if (target.type === 'agent') return t('Starts once operations confirm')
    const { profile } = target
    const rates = profile.services.map((service) => service.rate).filter((rate) => rate > 0)
    const modes = [...new Set(profile.services.map((service) => service.deliveryMode).filter(Boolean))]
    return [
      rates.length ? t('From {rate} / day', undefined, { rate: formatMoney(Math.min(...rates), profile.currency || 'ZAR') }) : '',
      profile.province || profile.operatingLocation,
      modes.map(modeLabel).join(' / '),
    ].filter(Boolean).join(' · ')
  }
  /** One provider as a slim row in the browse list. */
  const providerRow = (target: RequestTarget) => {
    const id = targetIdOf(target)
    const match = matchFor.get(id)
    const tags = target.type === 'consultant'
      ? [...new Set(target.profile.services.map((service) => service.areaOfSupport).concat(target.profile.specialties).filter(Boolean))]
      : target.agent.capabilities
    const sub = target.type === 'consultant'
      ? [target.profile.headline && target.profile.headline !== target.profile.name ? target.profile.headline : '', target.profile.experienceYears ? t('{count} years', undefined, { count: target.profile.experienceYears }) : ''].filter(Boolean).join(' · ')
      : target.agent.description
    return (
      <div key={id} className="fs-row">
        <ProviderAvatar target={target} />
        <div className="fs-row-main">
          <div className="fs-row-name">
            <Text strong ellipsis>{targetNameOf(target)}</Text>
            {match && <MatchMeter level={matchLevel(match.score)} compact />}
          </div>
          {sub && <Text type="secondary" className="fs-row-sub" ellipsis>{sub}</Text>}
          <div className="fs-row-tags">
            {tags.slice(0, 3).map((tag) => <span key={tag} className="fs-tag">{tag}</span>)}
            {tags.length > 3 && <span className="fs-tag is-more">+{tags.length - 3}</span>}
          </div>
        </div>
        <Text type="secondary" className="fs-row-facts">{factsFor(target)}</Text>
        {openRequestIds.has(id)
          ? <Tag bordered={false} className="fs-status">{t('Request sent')}</Tag>
          : <Button size="small" icon={<SendOutlined />} onClick={() => openRequest(target)}>{target.type === 'agent' ? t('Request') : t('Send a request')}</Button>}
      </div>
    )
  }

  // The marketplace belongs to the platform owner's independently registered SMEs. Once an SME is
  // in a programme - QTX's own included - support is requested through their interventions page.
  if (!isPlatformOwnerSme(user) || !user?.isApplicant) {
    return (
      <DashboardPage className="consultant-page">
        <DashboardHeader title={t('Find a consultant or agent')} />
        <Card className="dashboard-section-card">
          <Empty
            description={t('Your programme provides consultants and agents directly. Request support from your interventions page and your programme team will assign the right person.')}
          >
            <Button type="primary" onClick={() => navigate('/incubatee/interventions')}>{t('Go to interventions')}</Button>
          </Empty>
        </Card>
      </DashboardPage>
    )
  }

  if (loading) return <PageSkeleton variant="table" label={t('Loading consultants and agents')} />

  return (
    <DashboardPage className="consultant-page">

      {view !== 'requests' && (
        <Card
          className="dashboard-section-card fs-helper"
          title={<Space><BulbOutlined />{suggested && !editingChallenge ? t('Suggested for you') : t('Not sure who can help?')}</Space>}
          extra={suggested && !editingChallenge && suggested.items.length > 0 ? <Button type="primary" icon={<UnorderedListOutlined />} onClick={openPlan}>{t('Use this plan')}</Button> : undefined}
        >
          {suggested && !editingChallenge ? (
            <div className="fs-helper-body">
              {suggested.items.length > 1 && <Text type="secondary">{t('{count} steps from what you told us. Get help with all of them at once, or pick one below.', undefined, { count: suggested.items.length })}</Text>}
              <div className="fs-quote">
                <Text type="secondary" className="fs-quote-text">“{suggested.challenge}”</Text>
                <Button size="small" onClick={() => setEditingChallenge(true)}>{t('Change')}</Button>
              </div>
              {suggested.items.length > 1 && (
                <div className="fs-chips" role="group" aria-label={t('Filter by step')}>
                  <button type="button" className={`fs-chip${!stepFilter ? ' is-on' : ''}`} onClick={() => setStepFilter(null)}>{t('All steps')}</button>
                  {suggested.items.map((step) => (
                    <button key={step.title} type="button" className={`fs-chip${stepFilter === step.title ? ' is-on' : ''}`} onClick={() => setStepFilter(step.title)}>{step.title}</button>
                  ))}
                </div>
              )}
              {suggestions.length ? (
                <div className="fs-suggestions">
                  {suggestions.map((row, index) => {
                    const level = matchLevel(row.score)
                    const id = targetIdOf(row.target)
                    return (
                      <div key={id} className={`fs-suggestion${index === 0 ? ' is-top' : ''}`}>
                        <div className="fs-who">
                          <ProviderAvatar target={row.target} />
                          <div className="fs-who-text">
                            <Text strong ellipsis>{targetNameOf(row.target)}</Text>
                            <span className="fs-kind">{row.target.type === 'agent' ? t('AI agent') : t('Consultant')}</span>
                          </div>
                        </div>
                        <MatchMeter level={level} />
                        {row.step && <Text type="secondary" className="fs-why">{t('For')} <Text strong>{row.step.title}</Text>{offerFor(row.target, row.step) ? ` · ${t('offers {offer}', undefined, { offer: offerFor(row.target, row.step) })}` : ''}</Text>}
                        <Text type="secondary" className="fs-facts">{factsFor(row.target)}</Text>
                        {openRequestIds.has(id)
                          ? <Tag bordered={false} className="fs-status">{t('Request sent · waiting for a reply')}</Tag>
                          : <Button size="small" type={index === 0 ? 'primary' : 'default'} className="fs-action" onClick={() => openRequest(row.target)}>{row.target.type === 'agent' ? t('Request this agent') : t('Send a request')}</Button>}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <Text type="secondary">{t('No one listed matches those steps yet: {steps}. Browse below, or ask Thuso.', undefined, { steps: suggested.items.map((item) => item.title).join(', ') })}</Text>
              )}
              <Text type="secondary" className="fs-note">{t('Match strength compares each step with what the consultant or agent says they offer.')}</Text>
            </div>
          ) : (
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Text type="secondary">{t('Tell us what’s holding the business back, and we’ll suggest consultants and AI agents who can help.')}</Text>
              <Input.TextArea rows={2} maxLength={800} value={challenge} onChange={(event) => setChallenge(event.target.value)} placeholder={t('For example: we keep running out of cash at month end, and we don’t know our real costs.')} />
              <Space wrap>
                <Button type="primary" icon={<BulbOutlined />} loading={suggesting} disabled={!challenge.trim() || !suggestionsAvailable} onClick={() => void suggestWho()}>{t('Suggest who can help')}</Button>
                {suggested && <Button onClick={() => { setEditingChallenge(false); setChallenge(suggested.challenge) }}>{t('Cancel')}</Button>}
              </Space>
            </Space>
          )}
        </Card>
      )}

      <Card className="dashboard-section-card">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div className="fs-toolbar">
            <Segmented
              value={view}
              onChange={(value) => { setView(value as ProviderView); setPage(1) }}
              options={[
                { label: `${t('Consultants')} ${filteredConsultants.length}`, value: 'consultants' },
                { label: `${t('AI agents')} ${filteredAgents.length}`, value: 'agents' },
                { label: `${t('My requests')} ${myRequests.length}`, value: 'requests' },
              ]}
            />
            {view !== 'requests' && (
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder={t('Search name, skill or area')}
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1) }}
                className="fs-search"
              />
            )}
          </div>

          {view === 'consultants' && (
            filteredConsultants.length ? (
              <>
                <div className="fs-list">
                  {pagedConsultants.map((profile) => providerRow({ type: 'consultant', profile }))}
                </div>
                {filteredConsultants.length > PAGE_SIZE && (
                  <div className="consultant-centered-pagination">
                    <Pagination current={page} pageSize={PAGE_SIZE} total={filteredConsultants.length} onChange={setPage} showSizeChanger={false} />
                  </div>
                )}
              </>
            ) : <Empty description={t('No published consultants match your search yet.')} />
          )}

          {view === 'agents' && (
            filteredAgents.length
              ? <div className="fs-list">{filteredAgents.map((agent) => providerRow({ type: 'agent', agent }))}</div>
              : <Empty description={t('No AI agents match your search yet.')} />
          )}

          {view === 'requests' && (
            myRequests.length ? (
              <div className="marketplace-request-list">
                {myRequests.map((row) => {
                  const planWaiting = row.targetType === 'consultant' && row.status === 'proposed'
                  return (
                    <div key={row.id} role="button" tabIndex={0} className={`marketplace-request-row${planWaiting ? ' is-waiting' : ''}`} onClick={() => setOpenRequestId(row.id)} onKeyDown={(event) => { if (event.key === 'Enter') setOpenRequestId(row.id) }}>
                      <div className="marketplace-request-main">
                        <Text strong>{row.targetName}</Text>
                        <Text type="secondary">{[row.targetType === 'agent' ? t('AI agent') : t('Consultant'), row.areaOfSupport, `${t('Sent')} ${formatDate(row.createdAt)}`].filter(Boolean).join(' · ')}</Text>
                        {row.targetType === 'consultant' && lastMessage(row) && <Text type="secondary" className="marketplace-request-quote">“{lastMessage(row)?.text}”</Text>}
                      </div>
                      <Tag bordered={false} color={connectionStatusColor[row.status]} className="marketplace-request-tag">
                        {row.targetType === 'agent' ? t(row.status === 'matched' ? 'Matched' : row.status === 'declined' ? 'Declined' : 'With operations') : t(connectionStatusText(row.status, 'sme', row.declinedBy))}
                      </Tag>
                    </div>
                  )
                })}
              </div>
            ) : <Empty description={t('You have not requested a consultant or agent yet.')} />
          )}
        </Space>
      </Card>

      <Modal
        open={Boolean(requestTarget)}
        title={requestTarget ? `Request ${targetNameOf(requestTarget)}` : ''}
        onCancel={closeRequest}
        onOk={() => void submitRequest()}
        confirmLoading={submitting}
        okText={t('Send request')}
        {...singleActionFooter()}
        destroyOnHidden
        width={620}
      >
        {requestTarget && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label={t('You selected')}>{targetNameOf(requestTarget)}</Descriptions.Item>
              {requestTarget.type === 'consultant' && requestTarget.profile.services.length > 0 && (
                <Descriptions.Item label={t('Day rate from')}>{currency} {requestTarget.profile.services[0].rate.toLocaleString()}</Descriptions.Item>
              )}
            </Descriptions>

            <Form form={form} layout="vertical" requiredMark>
              <Form.Item
                name="areaOfSupport"
                label={t('What support do you need?')}
                rules={[{ required: true, message: tr('Choose or describe the support you need.') }]}
              >
                <Select
                  showSearch
                  allowClear
                  options={supportOptions}
                  placeholder={t('Select an area of support')}
                  {...(supportOptions.length === 0 ? { mode: 'tags' as const } : {})}
                />
              </Form.Item>

              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item name="deliveryMode" label={t('How would you like it delivered?')} rules={[{ required: true, message: tr('Choose a delivery mode.') }]}>
                    <Select options={deliveryModeOptions} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="urgency" label={t('How urgent is it?')} rules={[{ required: true, message: tr('Choose an urgency.') }]}>
                    <Select options={urgencyOptions} />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col xs={24} md={8}>
                  <Form.Item name="preferredStartDate" label={t('Preferred start date')} rules={[{ required: true, message: tr('Choose a preferred start date.') }]}>
                    <DatePicker style={{ width: '100%' }} disabledDate={(date) => date.isBefore(dayjs(), 'day')} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="engagementDays" label={t('Estimated days needed')}>
                    <InputNumber min={1} max={260} style={{ width: '100%' }} placeholder={t('e.g. 5')} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="budget" label={`Your budget (${currency})`}>
                    <InputNumber min={0} style={{ width: '100%' }} placeholder={t('Optional')} />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                name="note"
                label={t('Tell the consultant what you need')}
                rules={[{ required: true, message: tr('Describe what you need help with.') }, { min: 15, message: tr('Please give at least a sentence of detail.') }]}
              >
                <Input.TextArea rows={4} placeholder={t('Describe your business challenge, what you have tried, and the outcome you want.')} showCount maxLength={800} />
              </Form.Item>
            </Form>

            <Text type="secondary">{requestTarget.type === 'consultant'
              ? t('The consultant replies on your Requests tab and can send you a plan with prices. Nothing starts until you accept it.')
              : t('Your request goes to the operations team, who confirm availability and arrange the engagement.')}</Text>
          </Space>
        )}
      </Modal>

      {/* One request: the consultant's plan (accept, ask for changes, decline) and the conversation. */}
      <ResponsiveModal open={!!openedRequest} onClose={() => setOpenRequestId(null)} title={openedRequest?.targetName} width={640} centered>
        {openedRequest && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space wrap size={8}>
              <Tag bordered={false} color={connectionStatusColor[openedRequest.status]}>
                {openedRequest.targetType === 'agent' ? t(agentStatusHelp[openedRequest.status]) : t(connectionStatusText(openedRequest.status, 'sme', openedRequest.declinedBy))}
              </Tag>
              <Text type="secondary">{[openedRequest.areaOfSupport, openedRequest.preferredStartDate && `${t('Preferred start:')} ${openedRequest.preferredStartDate}`].filter(Boolean).join(' · ')}</Text>
            </Space>
            {openedRequest.reviewerNote && <Alert type="info" showIcon message={t('Operations note')} description={openedRequest.reviewerNote} />}
            {openedRequest.targetType === 'consultant' && openedRequest.plan && (
              <div>
                <Text className="marketplace-section-title">{openedRequest.status === 'matched' ? t('Agreed plan') : t('{name}’s plan', undefined, { name: openedRequest.targetName })}</Text>
                <PlanSummary plan={openedRequest.plan} />
                {openedRequest.status === 'proposed' && (
                  <div className="marketplace-actions" style={{ marginTop: 12 }}>
                    <Button type="primary" icon={<CheckCircleOutlined />} loading={acting} onClick={() => confirmAccept(openedRequest)}>{t('Accept plan')}</Button>
                    <Button onClick={() => setChangesFor(openedRequest)}>{t('Ask for changes')}</Button>
                    <Button danger onClick={() => confirmDecline(openedRequest)}>{t('Decline')}</Button>
                  </div>
                )}
              </div>
            )}
            {openedRequest.targetType === 'consultant' && (
              <div>
                <Text className="marketplace-section-title">{t('Conversation')}</Text>
                <ConnectionThread
                  request={openedRequest}
                  viewer="sme"
                  onSend={['pending', 'contacted', 'proposed'].includes(openedRequest.status) && user ? (text) => act(() => sendConnectionMessage(openedRequest, user, 'sme', text)) : undefined}
                  placeholder={t('Write to {name}', undefined, { name: openedRequest.targetName })}
                />
              </div>
            )}
          </Space>
        )}
      </ResponsiveModal>

      <ResponsiveModal
        open={!!changesFor}
        onClose={() => setChangesFor(null)}
        title={t('What would you like changed?')}
        width={480}
        centered
        footer={<ModalActions><Button type="primary" loading={acting} disabled={!changesText.trim()} onClick={() => changesFor && user && void act(() => askForPlanChanges(changesFor, user, changesText), t('Sent. {name} can now revise the plan.', undefined, { name: changesFor.targetName })).then(() => { setChangesFor(null); setChangesText('') })}>{t('Send')}</Button></ModalActions>}
      >
        <Input.TextArea rows={4} maxLength={1000} value={changesText} onChange={(event) => setChangesText(event.target.value)} placeholder={t('For example: can the sessions be in person, and finish before December?')} />
      </ResponsiveModal>

      <ResponsiveModal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        title={planSent ? undefined : t('Your plan, with who can help')}
        width={680}
        centered
        footer={planSent ? (
          <Space wrap>
            <Button type="primary" onClick={() => { setPlanOpen(false); setView('requests') }}>{t('See my requests')}</Button>
            <Button onClick={() => navigate('/applicant/roadmap')}>{t('Open roadmap')}</Button>
          </Space>
        ) : (
          <div className="fs-plan-footer">
            <Button onClick={() => setPlanOpen(false)}>{t('Cancel')}</Button>
            <Button type="primary" className="fs-plan-send" loading={planSending} disabled={!groupsToSend.length} onClick={() => void sendPlan()}>
              {groupsToSend.length === 1 ? t('Send 1 request') : t('Send {count} requests', undefined, { count: groupsToSend.length })}
            </Button>
          </div>
        )}
      >
        {planSent ? (
          <div className="fs-plan-sent">
            <Text strong className="fs-plan-sent-title"><CheckCircleOutlined /> {planSent.length === 1 ? t('1 request sent') : t('{count} requests sent', undefined, { count: planSent.length })}</Text>
            <Text type="secondary">{t('We’ll let you know by email when they reply. Your roadmap shows these steps as requested.')}</Text>
            <div className="fs-list">
              {planSent.map((row) => (
                <div key={targetIdOf(row.target)} className="fs-row fs-plan-sent-row">
                  <ProviderAvatar target={row.target} />
                  <div className="fs-row-main"><Text strong>{targetNameOf(row.target)}</Text><Text type="secondary" className="fs-row-sub">{row.steps.join(' · ')}</Text></div>
                  <Tag bordered={false} color="gold" className="fs-status">{row.target.type === 'agent' ? t('With operations') : t('Waiting for a reply')}</Tag>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="fs-plan">
            <Text type="secondary">{t('We picked the best match for each step. Change anyone, or remove a step you don’t need.')}</Text>
            {planRows.map((row, index) => (
              <div key={row.step.title} className={`fs-plan-step${row.removed ? ' is-removed' : ''}`}>
                <span className="fs-plan-num">{index + 1}</span>
                <div className="fs-plan-step-main">
                  <Text strong>{row.step.title}</Text>
                  {row.removed ? (
                    <Text type="secondary">{t('Removed')} · <Button type="link" size="small" className="fs-inline-link" onClick={() => updatePlanRow(index, { removed: false })}>{t('Add it back')}</Button></Text>
                  ) : (
                    <Select
                      className="fs-plan-pick"
                      value={row.targetId ?? undefined}
                      placeholder={t('Choose who can help')}
                      onChange={(value) => updatePlanRow(index, { targetId: value })}
                      showSearch
                      optionFilterProp="label"
                      options={(() => {
                        const ranked = rankedFor(row.step)
                        const option = (item: { target: RequestTarget; score: number }) => ({
                          value: targetIdOf(item.target),
                          label: `${targetNameOf(item.target)} · ${item.target.type === 'agent' ? t('AI agent') : t('Consultant')}`,
                          display: (
                            <span className="fs-plan-option">
                              <span className="fs-plan-option-name">{targetNameOf(item.target)}</span>
                              <span className="fs-plan-option-kind">{item.target.type === 'agent' ? t('AI agent') : t('Consultant')}</span>
                              {item.score > 0 && <MatchMeter level={matchLevel(item.score)} compact />}
                            </span>
                          ),
                        })
                        const matched = ranked.filter((item) => item.score > 0).map(option)
                        const rest = ranked.filter((item) => item.score <= 0).map(option)
                        return [
                          ...(matched.length ? [{ label: t('Matches this step'), options: matched }] : []),
                          ...(rest.length ? [{ label: t('Anyone else'), options: rest }] : []),
                        ]
                      })()}
                      optionRender={(option) => (option.data as { display?: ReactNode }).display ?? option.label}
                    />
                  )}
                </div>
                {!row.removed && <Button type="text" size="small" icon={<CloseOutlined />} aria-label={t('Remove this step')} onClick={() => updatePlanRow(index, { removed: true })} />}
              </div>
            ))}
            {planGroups.length > 0 && (
              <div className="fs-plan-summary">
                {planGroups.map((group) => (
                  <div key={targetIdOf(group.target)} className="fs-plan-summary-row">
                    <span>
                      <Text strong>{targetNameOf(group.target)}</Text>
                      {' · '}
                      {group.steps.length === 1 ? t('1 request for 1 step') : t('1 request for {count} steps', undefined, { count: group.steps.length })}
                    </span>
                    <Text type="secondary">
                      {group.alreadyAsked ? t('already asked, not sent again') : group.target.type === 'agent' ? t('operations confirm') : t('replies with a priced plan')}
                    </Text>
                  </div>
                ))}
              </div>
            )}
            {unassignedSteps > 0 && <Text type="warning">{unassignedSteps === 1 ? t('1 step has no one chosen yet, so it won’t be sent.') : t('{count} steps have no one chosen yet, so they won’t be sent.', undefined, { count: unassignedSteps })}</Text>}
            <Text type="secondary" className="fs-note">{t('Nothing is booked or paid yet. Each consultant replies with a plan you can accept, change or decline.')}</Text>
          </div>
        )}
      </ResponsiveModal>
    </DashboardPage>
  )
}
